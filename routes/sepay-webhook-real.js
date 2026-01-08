const express = require('express');
const router = express.Router();
const db = require('../config/database');
const SepayPayment = require('../models/SepayPayment');
const Order = require('../models/Order');
const { normalizeUnit } = require('../utils/normalizeUnit');
const Cart = require('../models/Cart');
const User = require('../models/User');
const { syncOrderToAccounting } = require('../services/accountingService');
const { commitForPaidOrder, normalizeCode } = require('../services/couponUsageService');

// POST /api/sepay-webhook-real - Sepay webhook callback (real production webhook)
// Route này được Sepay gọi trực tiếp với URL: https://ecobacgiang.vn/api/sepay-webhook-real
// Logic giống với /api/payment/sepay/webhook nhưng path khác để Sepay có thể config
router.post('/', async (req, res) => {
  try {
    // Log toàn bộ request để debug
    console.log("=== SEPAY WEBHOOK REAL REQUEST ===");
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("Method:", req.method);
    console.log("URL:", req.url);
    console.log("IP:", req.ip);
    console.log("===================================");

    await db.connectDb();

    const webhookData = req.body;
    const {
      gateway,
      transactionDate,
      accountNumber,
      transferType,
      transferAmount,
      amount,
      referenceCode,
      description,
      transactionId,
    } = webhookData;

    console.log("=== SEPAY WEBHOOK REAL RECEIVED ===");
    console.log("Webhook Data:", JSON.stringify(webhookData, null, 2));
    console.log("Timestamp:", new Date().toISOString());

    const webhookAmount = transferAmount || amount;
    
    // Nếu không có referenceCode, vẫn có thể tìm theo amount và thời gian
    if (!webhookAmount) {
      return res.status(400).json({
        error: "Missing required field: amount",
        received: webhookData
      });
    }

    let payment = null;

    // Nếu có referenceCode, tìm theo referenceCode trước
    if (referenceCode) {
      console.log(`🔍 Searching payment by referenceCode: ${referenceCode}`);
      payment = await SepayPayment.findOne({
        paymentCode: referenceCode,
        status: "pending"
      });

      if (payment) {
        console.log(`✅ Found payment by referenceCode: ${payment.paymentCode}`);
      } else {
        console.log(`❌ No payment found with referenceCode: ${referenceCode}`);
      }
    }

    // Nếu không tìm thấy, tìm theo amount và thời gian gần đây
    if (!payment) {
      console.log(`🔍 Searching payment by amount: ${webhookAmount}`);
      
      // Tìm các payment pending trong vòng 2 giờ gần đây
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recentPayments = await SepayPayment.find({
        status: "pending",
        amount: { $gte: webhookAmount - 1000, $lte: webhookAmount + 1000 }, // Cho phép sai số 1000 VND
        createdAt: { $gte: twoHoursAgo }
      }).sort({ createdAt: -1 }).limit(10);

      console.log(`📊 Found ${recentPayments.length} recent pending payments with similar amount`);

      // Tìm payment khớp nhất (sai số nhỏ nhất)
      if (recentPayments.length > 0) {
        payment = recentPayments.reduce((best, current) => {
          const bestDiff = Math.abs(best.amount - webhookAmount);
          const currentDiff = Math.abs(current.amount - webhookAmount);
          return currentDiff < bestDiff ? current : best;
        });

        const amountDiff = Math.abs(payment.amount - webhookAmount);
        console.log(`✅ Found matching payment: ${payment.paymentCode}, amount diff: ${amountDiff}`);
        
        // Nếu sai số quá lớn (> 5000 VND), không match
        if (amountDiff > 5000) {
          console.warn(`⚠️ Amount difference too large (${amountDiff}), rejecting match`);
          payment = null;
        }
      }
    }

    if (!payment) {
      console.error("❌ Payment not found for webhook:", {
        referenceCode,
        amount: webhookAmount,
        webhookData
      });
      
      // Log tất cả pending payments để debug
      const allPending = await SepayPayment.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('paymentCode amount createdAt expiresAt');
      console.log("📋 Recent pending payments:", allPending);

      return res.status(404).json({
        error: "Payment not found",
        referenceCode: referenceCode || "N/A",
        amount: webhookAmount,
        suggestion: "Please check if payment code matches or use manual confirmation endpoint"
      });
    }

    // Cập nhật payment status - Đảm bảo callbackData được lưu đúng structure
    const callbackDataToSave = {
      receivedAt: new Date().toISOString(),
      source: "webhook-real",
      gateway: gateway,
      transactionDate: transactionDate,
      accountNumber: accountNumber,
      transferType: transferType,
      transferAmount: transferAmount,
      amount: amount,
      referenceCode: referenceCode,
      description: description,
      transactionId: transactionId,
      id: webhookData.id,
      ...webhookData // Include all other fields
    };

    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode: payment.paymentCode },
      {
        status: "paid",
        paidAt: transactionDate ? new Date(transactionDate) : new Date(),
        transactionId: transactionId || webhookData.id?.toString() || `sepay_${Date.now()}`,
        'sepayData.callbackData': callbackDataToSave
      },
      { new: true }
    );

    console.log("✅ Payment updated via webhook-real:", updatedPayment.paymentCode);
    console.log("✅ Callback data saved:", JSON.stringify(updatedPayment.sepayData?.callbackData, null, 2));

    console.log("✅ Payment updated via webhook-real:", updatedPayment.paymentCode);
    console.log(`💰 Amount: ${updatedPayment.amount}, Status: ${updatedPayment.status}`);

    // Tự động tạo đơn hàng khi thanh toán thành công
    try {
      console.log("🛒 Starting auto order creation...");
      
      // Tìm order pending ưu tiên theo paymentCode (giảm rủi ro match nhầm theo amount)
      let existingOrder = await Order.findOne({
        user: updatedPayment.userId,
        paymentMethod: 'Sepay',
        status: 'pending',
        paymentCode: updatedPayment.paymentCode
      }).sort({ createdAt: -1 });

      // Fallback: match theo amount (logic cũ)
      if (!existingOrder) {
        existingOrder = await Order.findOne({
          user: updatedPayment.userId,
          paymentMethod: 'Sepay',
          status: 'pending',
          finalTotal: updatedPayment.amount
        }).sort({ createdAt: -1 });
      }

      if (existingOrder) {
        // Cập nhật order status thành "paid"
        const previousStatus = existingOrder.status;
        existingOrder.status = 'paid';
        await existingOrder.save();
        console.log(`✅ Updated existing order ${existingOrder._id} to paid status`);

        // Commit coupon usage if needed (idempotent via flags)
        try {
          const code = normalizeCode(existingOrder.coupon);
          if (code && existingOrder.user && !existingOrder.couponCommitted) {
            await commitForPaidOrder({
              code,
              userId: existingOrder.user,
              session: null,
              hasReservation: !!existingOrder.couponReserved,
            });
            existingOrder.couponCommitted = true;
            existingOrder.couponReserved = false;
            await existingOrder.save();
          }
        } catch (couponErr) {
          console.error('Coupon commit error (webhook-real):', couponErr);
        }
        
        // Đồng bộ đơn hàng vào kế toán
        syncOrderToAccounting(existingOrder, previousStatus, updatedPayment.userId).catch(err => {
          console.error('Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
        });
      } else {
        // Tìm trong Cart để tạo order mới
        const cart = await Cart.findOne({ user: updatedPayment.userId });
        const user = await User.findById(updatedPayment.userId);
        
        if (cart && cart.products && cart.products.length > 0) {
          // Tính toán lại totals từ cart
          const totalPrice = cart.products.reduce((sum, item) => sum + (item.price * (item.quantity || 0)), 0);
          const totalAfterDiscount = cart.totalAfterDiscount || totalPrice;
          const shippingFee = 30000;
          const finalTotal = totalAfterDiscount + shippingFee;
          
          // Kiểm tra xem finalTotal có khớp với payment amount không (cho phép sai số 1000 VND)
          if (Math.abs(finalTotal - updatedPayment.amount) <= 1000) {
            // Tạo order từ cart
            const orderItems = cart.products.map(item => ({
              product: item.product,
              title: item.title || 'Sản phẩm',
              quantity: item.quantity || 1,
              price: item.price || 0,
              image: item.image || '',
              unit: normalizeUnit(item.unit) || ''
            }));

            const newOrder = new Order({
              user: updatedPayment.userId,
              orderItems,
              shippingAddress: {
                address: user?.address || 'Chưa có địa chỉ'
              },
              phone: user?.phone || '',
              name: user?.name || 'Khách hàng',
              note: `Thanh toán qua Sepay - Payment Code: ${updatedPayment.paymentCode}`,
              coupon: cart.coupon || '',
              discount: cart.discount || 0,
              totalPrice,
              totalAfterDiscount,
              shippingFee,
              finalTotal,
              paymentMethod: 'Sepay',
              status: 'paid', // Tự động đánh dấu là đã thanh toán
              paymentCode: updatedPayment.paymentCode,
              couponReserved: false,
              couponCommitted: false,
            });

            await newOrder.save();
            console.log(`✅ Created new order ${newOrder._id} from cart`);

            // Commit coupon usage if present (best-effort)
            try {
              const code = normalizeCode(newOrder.coupon);
              if (code && newOrder.user && !newOrder.couponCommitted) {
                await commitForPaidOrder({
                  code,
                  userId: newOrder.user,
                  session: null,
                  hasReservation: false,
                });
                newOrder.couponCommitted = true;
                await newOrder.save();
              }
            } catch (couponErr) {
              console.error('Coupon commit error (auto order creation):', couponErr);
            }

            // Xóa cart sau khi tạo order
            await Cart.findOneAndUpdate(
              { user: updatedPayment.userId },
              { products: [], cartTotal: 0, totalAfterDiscount: 0, coupon: '', discount: 0 }
            );
            console.log(`✅ Cleared cart for user ${updatedPayment.userId}`);

            // Đồng bộ đơn hàng vào kế toán
            syncOrderToAccounting(newOrder, null, updatedPayment.userId).catch(err => {
              console.error('Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
            });
          } else {
            console.warn(`⚠️ Cart total (${finalTotal}) doesn't match payment amount (${updatedPayment.amount}), skipping auto order creation`);
          }
        } else {
          console.log(`ℹ️ No cart found for user ${updatedPayment.userId}, skipping auto order creation`);
        }
      }
    } catch (orderError) {
      // Log lỗi nhưng không fail webhook
      console.error("❌ Error creating order automatically:", orderError);
      console.error("Order creation error stack:", orderError.stack);
    }

    // Emit socket event để notify frontend
    if (global.io) {
      global.io.to(updatedPayment.paymentCode).emit('payment_paid', {
        paymentCode: updatedPayment.paymentCode,
        amount: updatedPayment.amount,
        status: updatedPayment.status,
        paidAt: updatedPayment.paidAt,
        transactionId: updatedPayment.transactionId
      });
      console.log(`📡 Socket event emitted to room: ${updatedPayment.paymentCode}`);
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      paymentCode: updatedPayment.paymentCode,
      status: updatedPayment.status
    });

  } catch (error) {
    console.error("❌ Sepay Webhook Real Error:", error);
    console.error("Error stack:", error.stack);
    console.error("Request body:", JSON.stringify(req.body, null, 2));
    console.error("Request headers:", JSON.stringify(req.headers, null, 2));
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET endpoint để test webhook có accessible không
router.get('/', async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Sepay webhook endpoint is accessible",
    endpoint: "/api/sepay-webhook-real",
    method: "POST",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

