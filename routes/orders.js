const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const db = require('../config/database');
const Order = require('../models/Order');
const Product = require('../models/Product');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const { withAuth, optionalAuth } = require('../middleware/auth');
const { syncOrderToAccounting } = require('../services/accountingService');
const { normalizeUnit } = require('../utils/normalizeUnit');

// GET /api/orders - Get user's orders (or all orders if admin)
router.get('/', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();

    let userId = null;
    let userRole = null;

    // Check JWT token from mobile app (Bearer token)
    if (req.userId) {
      userId = req.userId;
      userRole = req.user?.role || 'user';
    }

    // Get orders
    let orders;
    if (!userId) {
      // Không có token: Trong development, cho phép xem tất cả orders để test
      // Trong production, nên trả về empty array hoặc yêu cầu đăng nhập
      if (process.env.NODE_ENV === 'development' || req.query.allowPublic === 'true') {
        // Development mode: Trả về tất cả orders để dễ test
        orders = await Order.find({}).sort({ createdAt: -1 }).limit(100).lean();
      } else {
        // Production: Trả về empty array
        orders = [];
      }
    } else if (userRole === 'admin') {
      // Admin: Lấy tất cả đơn hàng
      orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    } else {
      // User: Chỉ lấy đơn hàng của mình
      orders = await Order.find({ user: userId })
        .sort({ createdAt: -1 })
        .lean();
    }

    // Convert _id to id and createdAt to ISO string
    const ordersCleaned = orders.map((order) => {
      return {
        id: order._id.toString(),
        ...order,
        createdAt:
          order.createdAt instanceof Date
            ? order.createdAt.toISOString()
            : order.createdAt,
      };
    });

    return res.status(200).json({ orders: ordersCleaned });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/orders/bestsellers - Get best selling products
router.get('/bestsellers', async (req, res) => {
  try {
    await db.connectDb();
    
    // Lấy danh sách đơn hàng không bị hủy
    const orders = await Order.find({ status: { $ne: 'cancelled' } }).lean();

    // Tính tổng số lượng sản phẩm theo title
    const productQuantities = {};
    orders.forEach((order) => {
      if (order.orderItems && Array.isArray(order.orderItems)) {
        order.orderItems.forEach((item) => {
          const productTitle = item.title || '';
          if (productTitle) {
            productQuantities[productTitle] = (productQuantities[productTitle] || 0) + (item.quantity || 0);
          }
        });
      }
    });

    // Lấy thông tin chi tiết sản phẩm từ collection Product
    const productTitles = Object.keys(productQuantities);
    if (productTitles.length === 0) {
      return res.status(200).json([]);
    }

    const products = await Product.find({ 
      name: { $in: productTitles },
      isDeleted: { $ne: true }
    }).lean();

    // Kết hợp thông tin sản phẩm với số lượng
    const sortedProducts = products
      .map((product) => ({
        _id: product._id,
        name: product.name,
        image: product.image || ['/images/placeholder.jpg'],
        rating: product.rating || 0,
        reviewCount: product.reviewCount || 0,
        price: product.price || 0,
        promotionalPrice: product.promotionalPrice || 0,
        stockStatus: product.stockStatus || 'Còn hàng',
        slug: product.slug,
        unit: normalizeUnit(product.unit) || 'unit',
        description: product.description || '',
        category: product.category || '',
        quantity: productQuantities[product.name] || 0
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return res.status(200).json(sortedProducts);
  } catch (error) {
    console.error('Error fetching bestsellers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/orders/:id - Get order by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { id } = req.params;
    const order = await Order.findById(id).populate('user', 'name email phone');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user has permission to view this order
    if (req.userId && req.user?.role !== 'admin' && order.user?._id?.toString() !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json({ order });
  } catch (error) {
    console.error('Error fetching order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/orders/:id - Delete order (admin only)
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { id } = req.params;

    // Check authentication
    if (!req.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    // Find and delete order
    const order = await Order.findByIdAndDelete(id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.status(200).json({
      message: 'Order deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/orders/:id - Update order (status, orderItems, totals)
router.patch('/:id', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { id } = req.params;
    const { status, orderItems, totalPrice, totalAfterDiscount, shippingFee, finalTotal, paymentMethod } = req.body;

    // Check authentication
    if (!req.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    // Find order
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Lưu trạng thái và phương thức thanh toán cũ để kiểm tra constraints
    const previousStatus = order.status;
    const previousPaymentMethod = order.paymentMethod;

    // --- CONSTRAINT 1: KHÓA PHƯƠNG THỨC THANH TOÁN (Nếu đã Paid/Shipped/Delivered) ---
    if (previousStatus === 'paid' || previousStatus === 'shipped' || previousStatus === 'delivered') {
      // Nếu trạng thái cũ đã paid/shipped/delivered, không cho phép thay đổi phương thức thanh toán
      if (paymentMethod !== undefined && paymentMethod !== previousPaymentMethod) {
        return res.status(400).json({ 
          message: 'Không thể thay đổi phương thức thanh toán khi đơn hàng đã được xử lý (paid/shipped/delivered).' 
        });
      }
    }

    // Prepare update data
    const updateData = {};

    // Update status if provided
    if (status !== undefined) {
      const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'processing'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status. Valid statuses: ' + validStatuses.join(', ') });
      }
      
      // --- CONSTRAINT 2: CHỈ CHO PHÉP TIẾN LÊN (Forward Progression) ---
      // Không cho phép chuyển lùi từ paid/shipped/delivered về pending
      if ((previousStatus === 'paid' || previousStatus === 'shipped' || previousStatus === 'delivered') && status === 'pending') {
        return res.status(400).json({ 
          message: `Không thể chuyển trạng thái lùi từ ${previousStatus} về pending.` 
        });
      }
      
      // Không cho phép chuyển lùi từ delivered về shipped/paid
      if (previousStatus === 'delivered' && (status === 'shipped' || status === 'paid' || status === 'pending')) {
        return res.status(400).json({ 
          message: `Không thể chuyển trạng thái lùi từ delivered về ${status}.` 
        });
      }
      
      // Không cho phép chuyển lùi từ shipped về paid/pending
      if (previousStatus === 'shipped' && (status === 'paid' || status === 'pending')) {
        return res.status(400).json({ 
          message: `Không thể chuyển trạng thái lùi từ shipped về ${status}.` 
        });
      }
      
      updateData.status = status; // Đặt status mới (ưu tiên từ user)
    }

    // Update paymentMethod if provided
    if (paymentMethod !== undefined) {
      const validPaymentMethods = ['COD', 'BankTransfer', 'Sepay', 'MoMo'];
      if (!validPaymentMethods.includes(paymentMethod)) {
        return res.status(400).json({ message: 'Invalid payment method. Valid methods: ' + validPaymentMethods.join(', ') });
      }
      updateData.paymentMethod = paymentMethod;
      
      // Logic Sepay tự động: Chỉ chạy khi KHÔNG có status mới được cung cấp từ user
      // Ưu tiên status từ user, không ghi đè
      // Chỉ tự động set paid khi:
      // 1. PaymentMethod = Sepay
      // 2. User KHÔNG gửi status mới (status === undefined) - QUAN TRỌNG: Ưu tiên status từ user
      // 3. Trạng thái hiện tại là pending (chưa được xử lý)
      if (paymentMethod === 'Sepay' && status === undefined && previousStatus === 'pending') {
        updateData.status = 'paid';
        console.log(`🔄 Tự động set status = 'paid' cho đơn hàng ${id} vì paymentMethod = Sepay`);
      }
      // Nếu user đã gửi status (ví dụ: 'shipped'), thì status đó sẽ được giữ nguyên
      // và không bị logic Sepay ghi đè
    }

    // Update orderItems if provided
    if (orderItems !== undefined && Array.isArray(orderItems)) {
      if (orderItems.length === 0) {
        return res.status(400).json({ message: 'Order must have at least one item' });
      }
      updateData.orderItems = orderItems;
    }

    // If orderItems changed, recalculate totals if not provided
    if (orderItems !== undefined && Array.isArray(orderItems) && orderItems.length > 0) {
      // If totals not provided, calculate them
      if (totalPrice === undefined || finalTotal === undefined) {
        const calculatedTotalPrice = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discount = order.discount || 0;
        const calculatedTotalAfterDiscount = calculatedTotalPrice - discount;
        const calculatedShippingFee = shippingFee !== undefined ? shippingFee : (order.shippingFee || 30000);
        const calculatedFinalTotal = calculatedTotalAfterDiscount + calculatedShippingFee;
        
        updateData.totalPrice = totalPrice !== undefined ? totalPrice : calculatedTotalPrice;
        updateData.totalAfterDiscount = totalAfterDiscount !== undefined ? totalAfterDiscount : calculatedTotalAfterDiscount;
        updateData.shippingFee = shippingFee !== undefined ? shippingFee : calculatedShippingFee;
        updateData.finalTotal = finalTotal !== undefined ? finalTotal : calculatedFinalTotal;
      } else {
        // Totals provided, use them
        if (totalPrice !== undefined) updateData.totalPrice = totalPrice;
        if (totalAfterDiscount !== undefined) updateData.totalAfterDiscount = totalAfterDiscount;
        if (shippingFee !== undefined) updateData.shippingFee = shippingFee;
        if (finalTotal !== undefined) updateData.finalTotal = finalTotal;
      }
    } else {
      // No orderItems update, only update totals if provided
      if (totalPrice !== undefined) updateData.totalPrice = totalPrice;
      if (totalAfterDiscount !== undefined) updateData.totalAfterDiscount = totalAfterDiscount;
      if (shippingFee !== undefined) updateData.shippingFee = shippingFee;
      if (finalTotal !== undefined) updateData.finalTotal = finalTotal;
    }

    // Update order
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('user', 'name email phone'); // Populate user để dùng trong accountingService

    // Đồng bộ vào kế toán nếu status thay đổi
    // Đặc biệt quan trọng cho COD: Khi chuyển sang shipped/delivered → Tạo công nợ Phải Thu (TK 131)
    const newStatus = updateData.status || previousStatus;
    if (newStatus !== previousStatus) {
      try {
        await syncOrderToAccounting(updatedOrder, previousStatus, req.userId);
        console.log(`✅ Đã đồng bộ đơn hàng ${id} vào kế toán: ${previousStatus} → ${newStatus}`);
      } catch (err) {
        console.error('❌ Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
        // Không throw error để không block response, nhưng log để debug
      }
    }

    // Convert _id to id
    const orderResponse = {
      id: updatedOrder._id.toString(),
      ...updatedOrder.toObject(),
      createdAt: updatedOrder.createdAt instanceof Date ? updatedOrder.createdAt.toISOString() : updatedOrder.createdAt,
    };

    // BƯỚC 2: Tự động hạch toán Giá vốn (COGS) khi đơn hàng được delivered/shipped
    const finalStatus = updateData.status || previousStatus;
    if ((finalStatus === 'delivered' || finalStatus === 'shipped') && previousStatus !== 'delivered' && previousStatus !== 'shipped') {
      // Gọi API post-cogs tự động (không chờ kết quả để không block response)
      postCOGSEntry(updatedOrder._id, req.userId).catch(err => {
        console.error('Lỗi khi hạch toán giá vốn:', err);
      });
    }

    return res.status(200).json({
      message: 'Order updated successfully',
      order: orderResponse,
    });
  } catch (error) {
    console.error('Error updating order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /api/orders/post-cogs
 * API Hạch toán Giá vốn Hàng bán (COGS) - Nguyên tắc Phù hợp
 * 
 * Trigger: Được gọi tự động khi đơn hàng được đánh dấu delivered/shipped
 * Logic: Tạo bút toán Nợ TK 632 (Giá vốn) / Có TK 156 (Hàng hóa)
 */
router.post('/post-cogs', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const { orderId } = req.body;
    
    if (!orderId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Thiếu orderId' });
    }
    
    const result = await postCOGSEntry(orderId, req.userId, session);
    
    await session.commitTransaction();
    
    return res.status(201).json({
      message: 'Hạch toán giá vốn thành công',
      journalEntry: result.journalEntry,
      productsUpdated: result.productsUpdated
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error posting COGS:', error);
    return res.status(500).json({ 
      message: 'Lỗi khi hạch toán giá vốn',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

/**
 * Hàm helper: Hạch toán Giá vốn cho một đơn hàng
 * @param {String|ObjectId} orderId - ID đơn hàng
 * @param {String|ObjectId} userId - ID người thực hiện
 * @param {Session} session - MongoDB session (optional)
 * @returns {Object} { journalEntry, productsUpdated }
 */
async function postCOGSEntry(orderId, userId = null, session = null) {
  try {
    await db.connectDb();
    
    // Lấy đơn hàng
    const order = await Order.findById(orderId).session(session || null);
    if (!order) {
      throw new Error('Không tìm thấy đơn hàng');
    }
    
    // Kiểm tra xem đã hạch toán giá vốn chưa
    const existingCOGSEntry = await JournalEntry.findOne({
      sourceId: orderId,
      sourceType: 'order',
      'lines.accountCode': '632', // TK Giá vốn
      status: 'posted'
    }).session(session || null);
    
    if (existingCOGSEntry) {
      console.log(`Giá vốn cho đơn hàng ${orderId} đã được hạch toán`);
      return {
        journalEntry: existingCOGSEntry,
        productsUpdated: []
      };
    }
    
    if (!order.orderItems || order.orderItems.length === 0) {
      throw new Error('Đơn hàng không có sản phẩm');
    }
    
    // Tính tổng giá vốn và cập nhật kho
    let totalCOGS = 0;
    const productsUpdated = [];
    
    for (const item of order.orderItems) {
      const productId = item.product;
      const quantitySold = item.quantity || 0;
      
      if (quantitySold <= 0) continue;
      
      // Lấy thông tin sản phẩm
      const product = await Product.findById(productId).session(session || null);
      if (!product) {
        console.warn(`Không tìm thấy sản phẩm ${productId}`);
        continue;
      }
      
      // Lấy giá vốn bình quân hiện tại (Moving Average)
      const averageCost = product.averageCost || product.price || 0;
      const currentStock = product.stock || 0;
      
      // Tính giá vốn cho item này
      const itemCOGS = averageCost * quantitySold;
      totalCOGS += itemCOGS;
      
      // Cập nhật số lượng tồn kho
      const newStock = Math.max(0, currentStock - quantitySold);
      
      // Cập nhật product (giữ nguyên averageCost vì đã dùng Moving Average)
      await Product.findByIdAndUpdate(
        productId,
        { 
          stock: newStock,
          updatedAt: new Date()
        },
        { session: session || null }
      );
      
      productsUpdated.push({
        productId: productId.toString(),
        productName: product.name,
        quantitySold,
        averageCost,
        itemCOGS,
        newStock
      });
    }
    
    if (totalCOGS <= 0) {
      throw new Error('Tổng giá vốn phải lớn hơn 0');
    }
    
    // Kiểm tra tài khoản có tồn tại không
    const accounts = await Account.find({
      code: { $in: ['632', '156'] }
    }).session(session || null);
    
    if (accounts.length !== 2) {
      throw new Error('Một hoặc nhiều tài khoản (632, 156) không tồn tại trong hệ thống');
    }
    
    // Tạo số chứng từ
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    const referenceNo = `COGS-${new Date(order.createdAt || Date.now()).getFullYear()}${String(new Date(order.createdAt || Date.now()).getMonth() + 1).padStart(2, '0')}-${randomStr}`;
    
    // Kiểm tra số chứng từ đã tồn tại chưa
    const existingEntry = await JournalEntry.findOne({ referenceNo }).session(session || null);
    if (existingEntry) {
      throw new Error('Số chứng từ đã tồn tại');
    }
    
    // Tạo các dòng bút toán: Nợ TK 632 (Giá vốn) / Có TK 156 (Hàng hóa)
    const lines = [
      {
        accountCode: '632', // Giá vốn hàng bán
        debit: totalCOGS,
        credit: 0,
        description: `Giá vốn đơn hàng ${order._id} - ${order.name || 'Khách hàng'}`,
      },
      {
        accountCode: '156', // Hàng hóa
        debit: 0,
        credit: totalCOGS,
        description: `Xuất kho bán hàng - Đơn hàng ${order._id}`,
      }
    ];
    
    // Validation: Kiểm tra Tổng Nợ = Tổng Có
    const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error('Chứng từ không cân bằng. Tổng Nợ phải bằng Tổng Có');
    }
    
    // Tạo Journal Entry
    const journalEntry = new JournalEntry({
      referenceNo,
      date: order.createdAt || new Date(),
      postingDate: new Date(),
      memo: `Hạch toán giá vốn - Đơn hàng ${order._id} - ${order.name || 'Khách hàng'}`,
      entryType: 'inventory',
      sourceId: orderId,
      sourceType: 'order',
      lines: lines,
      createdBy: userId || null,
      status: 'posted',
    });
    
    await journalEntry.save({ session: session || null });
    
    console.log(`✅ Đã hạch toán giá vốn ${totalCOGS.toLocaleString('vi-VN')} VNĐ cho đơn hàng ${orderId}`);
    
    return {
      journalEntry,
      productsUpdated
    };
    
  } catch (error) {
    console.error('Error in postCOGSEntry:', error);
    throw error;
  }
}

module.exports = router;

