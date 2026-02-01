const db = require('../config/database');
const Order = require('../models/Order');
const JournalEntry = require('../models/JournalEntry');
const Receivable = require('../models/Receivable');
const { createReceivableFromOrder } = require('../services/accountingService');

/**
 * Script để đồng bộ Receivables từ các đơn hàng hiện có
 * Chạy: node server/scripts/sync-receivables.js
 * 
 * Script này sẽ:
 * 1. Tìm các đơn hàng COD chưa được giao (tiền chưa về)
 * 2. Tìm các đơn hàng có journal entry với tài khoản 131 (Phải thu)
 * 3. Tạo Receivable cho các đơn hàng này
 */

async function syncReceivables() {
  try {
    console.log('🔄 Đang kết nối database...');
    await db.connectDb();
    
    console.log('📦 Đang tìm các đơn hàng cần tạo Receivable...');
    
    // 1. Tìm các đơn hàng COD chưa được giao (tiền chưa về - có thể coi là công nợ tạm thời)
    const codOrders = await Order.find({
      paymentMethod: 'COD',
      status: { $in: ['pending', 'processing', 'shipped'] }
    }).populate('user').lean();
    
    console.log(`\n📋 Tìm thấy ${codOrders.length} đơn hàng COD chưa giao`);
    
    // 2. Tìm các journal entries có tài khoản 131 (Phải thu khách hàng)
    const receivableEntries = await JournalEntry.find({
      status: 'posted',
      'lines.accountCode': '131'
    }).populate('sourceId').lean();
    
    console.log(`📋 Tìm thấy ${receivableEntries.length} journal entries có công nợ`);
    
    let created = 0;
    let skipped = 0;
    
    // 3. Tạo Receivable từ journal entries
    for (const entry of receivableEntries) {
      const orderId = entry.sourceId?._id || entry.sourceId;
      
      if (!orderId) {
        console.log(`⚠️  Journal entry ${entry._id} không có sourceId`);
        continue;
      }
      
      // Kiểm tra xem đã có Receivable chưa
      const existing = await Receivable.findOne({
        $or: [
          { journalEntry: entry._id },
          { order: orderId }
        ]
      });
      
      if (existing) {
        skipped++;
        continue;
      }
      
      // Tìm order
      const order = await Order.findById(orderId).populate('user').lean();
      if (!order) {
        console.log(`⚠️  Không tìm thấy đơn hàng ${orderId}`);
        continue;
      }
      
      if (!order.user) {
        console.log(`⚠️  Đơn hàng ${orderId} không có khách hàng`);
        continue;
      }
      
      // Tìm dòng có tài khoản 131
      const receivableLine = entry.lines.find(l => l.accountCode === '131');
      if (!receivableLine || receivableLine.debit === 0) {
        continue;
      }
      
      // Tính hạn thanh toán (30 ngày từ ngày tạo đơn)
      const dueDate = new Date(order.createdAt || entry.date);
      dueDate.setDate(dueDate.getDate() + 30);
      
      const receivable = new Receivable({
        journalEntry: entry._id,
        customer: order.user._id || order.user,
        order: orderId,
        originalAmount: receivableLine.debit,
        remainingAmount: receivableLine.debit,
        paymentStatus: 'unpaid',
        dueDate: dueDate,
        invoiceDate: order.createdAt || entry.date,
        description: `Đơn hàng ${entry.referenceNo} - ${order.name || 'Khách hàng'}`,
      });
      
      await receivable.save();
      created++;
      console.log(`✅ Đã tạo Receivable cho đơn hàng ${orderId} - ${entry.referenceNo}`);
    }
    
    // 4. Tạo Receivable cho các đơn hàng COD chưa giao (tùy chọn - có thể bỏ qua)
    // Vì COD chưa giao thì chưa có journal entry, nên có thể không tạo Receivable
    // Hoặc tạo như một dạng "công nợ tạm thời"
    
    console.log('\n✨ Hoàn tất!');
    console.log(`📊 Đã tạo: ${created} Receivables`);
    console.log(`🔄 Đã bỏ qua: ${skipped} (đã tồn tại)`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi sync receivables:', error);
    process.exit(1);
  }
}

// Chạy script
syncReceivables();

