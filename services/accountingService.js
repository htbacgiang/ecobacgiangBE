const JournalEntry = require('../models/JournalEntry');
const Receivable = require('../models/Receivable');
const Order = require('../models/Order');
const Product = require('../models/Product');

/**
 * Tự động tạo journal entry từ đơn hàng
 * Mapping rule: BÁN_HÀNG_TIỀN_MẶT hoặc BÁN_HÀNG_CÔNG_NỢ
 */
async function createSaleJournalEntry(order, userId = null) {
  try {
    await require('../config/database').connectDb();
    
    // Phương thức thanh toán đã nhận tiền (tiền đã vào tài khoản ngân hàng)
    const isBankTransfer = ['BankTransfer', 'Sepay', 'MoMo'].includes(order.paymentMethod);
    // COD: Tiền chưa về, chưa tạo journal entry (sẽ tạo khi giao hàng xong)
    const isCOD = order.paymentMethod === 'COD';
    
    // Tạo số chứng từ duy nhất
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    const referenceNo = `HD-${new Date(order.createdAt || Date.now()).getFullYear()}${String(new Date(order.createdAt || Date.now()).getMonth() + 1).padStart(2, '0')}-${randomStr}`;
    
    // Kiểm tra xem đã tạo journal entry chưa
    const existingEntry = await JournalEntry.findOne({ 
      sourceId: order._id,
      sourceType: 'order'
    });
    
    if (existingEntry) {
      console.log(`Journal entry đã tồn tại cho đơn hàng ${order._id}`);
      return existingEntry;
    }
    
    // COD: Chưa tạo journal entry khi pending
    // Chỉ tạo khi đơn hàng được shipped/delivered - lúc đó mới phát sinh công nợ Phải Thu
    if (isCOD && !['shipped', 'delivered'].includes(order.status)) {
      console.log(`Đơn hàng COD ${order._id} chưa được shipped/delivered, chưa tạo journal entry`);
      return null;
    }
    
    let lines = [];
    let isCredit = false; // Flag để xác định có cần tạo Receivable không
    
    if (isCOD && ['shipped', 'delivered'].includes(order.status)) {
      // COD đã shipped/delivered: Phát sinh công nợ Phải Thu (theo Nguyên tắc Cơ sở Dồn tích)
      // Nợ TK 131 (Phải thu khách hàng) / Có TK 511 (Doanh thu)
      // Lưu ý: Chưa thu tiền mặt, chỉ ghi nhận công nợ. Khi khách hàng thanh toán sẽ tạo Phiếu thu riêng.
      lines = [
        {
          accountCode: '131', // Phải thu khách hàng (Công nợ COD)
          debit: order.finalTotal,
          credit: 0,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Công nợ COD - Đơn hàng ${referenceNo}`,
        },
        {
          accountCode: '511', // Doanh thu
          debit: 0,
          credit: order.finalTotal,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Doanh thu bán hàng COD - Đơn hàng ${referenceNo}`,
        },
      ];
      isCredit = true; // Cần tạo Receivable
    } else if (isBankTransfer) {
      // Chuyển khoản/Sepay/MoMo: Tiền đã vào tài khoản ngân hàng
      // Nợ 1121 (Tiền gửi ngân hàng) / Có 511 (Doanh thu)
      lines = [
        {
          accountCode: '1121', // Tiền gửi ngân hàng (Vietcombank hoặc tài khoản mặc định)
          debit: order.finalTotal,
          credit: 0,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Bán hàng ${order.paymentMethod} - Đơn hàng ${referenceNo}`,
        },
        {
          accountCode: '511', // Doanh thu
          debit: 0,
          credit: order.finalTotal,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Doanh thu bán hàng - Đơn hàng ${referenceNo}`,
        },
      ];
    } else {
      // Trường hợp khác (nếu có): Xử lý như công nợ
      // Nợ 131 (Phải thu) / Có 511 (Doanh thu)
      lines = [
        {
          accountCode: '131', // Phải thu khách hàng
          debit: order.finalTotal,
          credit: 0,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Công nợ - Đơn hàng ${referenceNo}`,
        },
        {
          accountCode: '511', // Doanh thu
          debit: 0,
          credit: order.finalTotal,
          partner: order.user || null,
          partnerType: order.user ? 'customer' : null,
          description: `Doanh thu bán hàng - Đơn hàng ${referenceNo}`,
        },
      ];
    }
    
    // Tạo journal entry
    const journalEntry = new JournalEntry({
      referenceNo,
      date: order.createdAt || new Date(),
      postingDate: new Date(),
      memo: `Bán hàng - Đơn hàng ${order._id} - ${order.name || 'Khách hàng'}`,
      entryType: 'sale',
      sourceId: order._id,
      sourceType: 'order',
      lines: lines,
      createdBy: userId || null,
      status: 'posted',
    });
    
    await journalEntry.save();
    
    // Nếu là công nợ (COD shipped/delivered), tạo Receivable
    if (isCredit && order.user) {
      await createReceivableFromOrder(order, journalEntry);
    }
    
    console.log(`✅ Đã tạo journal entry ${referenceNo} cho đơn hàng ${order._id} - ${isCredit ? 'với Receivable' : 'không có Receivable'}`);
    return journalEntry;
    
  } catch (error) {
    console.error('❌ Lỗi khi tạo journal entry từ đơn hàng:', error);
    throw error;
  }
}

/**
 * Tạo Receivable từ đơn hàng công nợ
 */
async function createReceivableFromOrder(order, journalEntry) {
  try {
    // Kiểm tra xem đã tạo receivable chưa
    const existingReceivable = await Receivable.findOne({ 
      order: order._id 
    });
    
    if (existingReceivable) {
      console.log(`Receivable đã tồn tại cho đơn hàng ${order._id}`);
      return existingReceivable;
    }
    
    // Tính hạn thanh toán
    // Đối với COD: Hạn thanh toán = ngày shipped/delivered + số ngày quy định (mặc định 7 ngày cho COD)
    // Đối với công nợ khác: Hạn thanh toán = ngày tạo đơn + 30 ngày
    let dueDate;
    if (order.paymentMethod === 'COD') {
      // COD: Hạn thanh toán từ ngày shipped/delivered
      const shippedDate = order.updatedAt || order.createdAt || new Date();
      dueDate = new Date(shippedDate);
      dueDate.setDate(dueDate.getDate() + 7); // COD thường thu tiền trong 7 ngày
    } else {
      // Công nợ khác: Hạn thanh toán từ ngày tạo đơn
      dueDate = new Date(order.createdAt || Date.now());
      dueDate.setDate(dueDate.getDate() + 30); // Mặc định 30 ngày
    }
    
    const receivable = new Receivable({
      journalEntry: journalEntry._id,
      customer: order.user,
      order: order._id,
      originalAmount: order.finalTotal,
      remainingAmount: order.finalTotal,
      paymentStatus: 'unpaid',
      dueDate: dueDate,
      invoiceDate: order.createdAt || new Date(),
      description: `Đơn hàng ${journalEntry.referenceNo} - ${order.name || 'Khách hàng'}${order.paymentMethod === 'COD' ? ' (COD)' : ''}`,
    });
    
    await receivable.save();
    console.log(`✅ Đã tạo Receivable cho đơn hàng ${order._id}`);
    return receivable;
    
  } catch (error) {
    console.error('❌ Lỗi khi tạo Receivable:', error);
    throw error;
  }
}

/**
 * Cập nhật Receivable khi khách hàng thanh toán
 */
async function updateReceivableOnPayment(order, paymentAmount) {
  try {
    if (!order.user) return;
    
    const receivable = await Receivable.findOne({ 
      order: order._id 
    });
    
    if (!receivable) {
      console.log(`Không tìm thấy Receivable cho đơn hàng ${order._id}`);
      return;
    }
    
    // Giảm số tiền còn lại
    receivable.remainingAmount = Math.max(0, receivable.remainingAmount - paymentAmount);
    
    // Cập nhật trạng thái tự động qua middleware
    await receivable.save();
    
    console.log(`✅ Đã cập nhật Receivable cho đơn hàng ${order._id}`);
    return receivable;
    
  } catch (error) {
    console.error('❌ Lỗi khi cập nhật Receivable:', error);
    throw error;
  }
}

/**
 * Tạo journal entry khi thanh toán công nợ (Phiếu thu)
 */
async function createPaymentReceipt(order, paymentAmount, userId = null) {
  try {
    await require('../config/database').connectDb();
    
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    const referenceNo = `PT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${randomStr}`;
    
    // Tạo journal entry: Nợ 111/112 (Tiền) / Có 131 (Phải thu)
    const lines = [
      {
        accountCode: order.paymentMethod === 'COD' ? '111' : '1121', // Tiền mặt hoặc ngân hàng
        debit: paymentAmount,
        credit: 0,
        partner: order.user || null,
        partnerType: order.user ? 'customer' : null,
        description: `Thu tiền - Đơn hàng ${order._id}`,
      },
      {
        accountCode: '131', // Phải thu khách hàng
        debit: 0,
        credit: paymentAmount,
        partner: order.user || null,
        partnerType: order.user ? 'customer' : null,
        description: `Giảm công nợ - Đơn hàng ${order._id}`,
      },
    ];
    
    const journalEntry = new JournalEntry({
      referenceNo,
      date: new Date(),
      postingDate: new Date(),
      memo: `Phiếu thu - Thanh toán đơn hàng ${order._id}`,
      entryType: 'payment',
      sourceId: order._id,
      sourceType: 'order',
      lines: lines,
      createdBy: userId || null,
      status: 'posted',
    });
    
    await journalEntry.save();
    
    // Cập nhật Receivable
    await updateReceivableOnPayment(order, paymentAmount);
    
    console.log(`✅ Đã tạo Phiếu thu ${referenceNo} cho đơn hàng ${order._id}`);
    return journalEntry;
    
  } catch (error) {
    console.error('❌ Lỗi khi tạo Phiếu thu:', error);
    throw error;
  }
}

/**
 * Xử lý đồng bộ đơn hàng vào kế toán
 * Được gọi khi đơn hàng được tạo hoặc status thay đổi
 */
async function syncOrderToAccounting(order, previousStatus = null, userId = null) {
  try {
    const isBankTransfer = ['BankTransfer', 'Sepay', 'MoMo'].includes(order.paymentMethod);
    const isCOD = order.paymentMethod === 'COD';
    
    // Kiểm tra xem đã tạo journal entry chưa
    const existingEntry = await JournalEntry.findOne({ 
      sourceId: order._id,
      sourceType: 'order'
    });
    
    // Trường hợp 1: Đơn hàng mới được tạo (chưa có journal entry)
    if (!existingEntry) {
      if (isBankTransfer) {
        // Chuyển khoản/Sepay/MoMo: Tiền đã vào ngân hàng → Tạo journal entry ngay
        await createSaleJournalEntry(order, userId);
      } else if (isCOD && ['shipped', 'delivered'].includes(order.status)) {
        // COD đã shipped/delivered: Phát sinh công nợ Phải Thu (TK 131) → Tạo journal entry
        await createSaleJournalEntry(order, userId);
      } else if (isCOD && !['shipped', 'delivered'].includes(order.status)) {
        // COD chưa shipped/delivered: Chưa phát sinh công nợ → Không tạo journal entry
        console.log(`Đơn hàng COD ${order._id} chưa được shipped/delivered, chưa tạo journal entry`);
        return;
      } else {
        // Trường hợp khác: Có thể là công nợ
        if (['paid', 'delivered', 'processing'].includes(order.status)) {
          await createSaleJournalEntry(order, userId);
        }
      }
      return;
    }
    
    // Trường hợp 2: Đơn hàng đã có journal entry, status thay đổi
    // COD: Khi chuyển sang 'shipped' hoặc 'delivered' → Phát sinh công nợ Phải Thu (TK 131)
    if (isCOD && !['shipped', 'delivered'].includes(previousStatus) && ['shipped', 'delivered'].includes(order.status)) {
      // Nếu chưa có journal entry (trường hợp COD chưa shipped)
      if (!existingEntry) {
        await createSaleJournalEntry(order, userId);
      }
      return;
    }
    
    // BankTransfer/Sepay đã tạo journal entry từ đầu, không cần xử lý thêm khi status thay đổi
    // (vì tiền đã vào ngân hàng rồi)
    
  } catch (error) {
    console.error('❌ Lỗi khi đồng bộ đơn hàng vào kế toán:', error);
    // Không throw error để không ảnh hưởng đến flow chính
  }
}

module.exports = {
  createSaleJournalEntry,
  createReceivableFromOrder,
  updateReceivableOnPayment,
  createPaymentReceipt,
  syncOrderToAccounting,
};
