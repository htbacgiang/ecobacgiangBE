const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const { withAuth } = require('../middleware/auth');
const { syncOrderToAccounting } = require('../services/accountingService');
const mongoose = require('mongoose');
const { normalizeCode, reserveForOrder, commitForPaidOrder } = require('../services/couponUsageService');
const SepayPayment = require('../models/SepayPayment');

// POST /api/checkout - Create order from cart
router.post('/', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await db.connectDb();
    const {
      shippingAddress,
      phone,
      name,
      note,
      deliveryTime,
      coupon,
      paymentMethod,
      orderItems,
      totalPrice,
      totalAfterDiscount,
      shippingFee,
      finalTotal,
      paymentCode,
    } = req.body;

    const couponCode = normalizeCode(coupon);
    let couponReserved = false;
    let couponCommitted = false;

    // For Sepay: if paymentCode is provided and payment is already paid, we can commit immediately.
    // IMPORTANT: to avoid duplicate order creation (webhook expects pending), we still create order as pending.
    // But we mark couponCommitted so status transition won't double count, and webhook can safely no-op commit.
    let sepayIsPaid = false;
    if (paymentMethod === 'Sepay' && paymentCode) {
      const payment = await SepayPayment.findOne({ paymentCode }).session(session);
      sepayIsPaid = !!payment && payment.status === 'paid';
    }

    if (couponCode) {
      if (sepayIsPaid) {
        await commitForPaidOrder({
          code: couponCode,
          userId: req.userId,
          session,
          hasReservation: false,
        });
        couponCommitted = true;
      } else {
        await reserveForOrder({ code: couponCode, userId: req.userId, session });
        couponReserved = true;
      }
    }

    // Create order
    const order = new Order({
      user: req.userId,
      orderItems,
      shippingAddress,
      phone,
      name,
      note,
      deliveryTime,
      coupon: couponCode,
      paymentCode: paymentCode || '',
      couponReserved,
      couponCommitted,
      totalPrice,
      totalAfterDiscount,
      shippingFee: shippingFee || 30000,
      finalTotal,
      paymentMethod,
      status: 'pending',
    });

    await order.save({ session });

    // Clear cart after checkout
    await Cart.findOneAndUpdate(
      { user: req.userId },
      { products: [], cartTotal: 0, totalAfterDiscount: 0, coupon: '', discount: 0 },
      { session }
    );

    await session.commitTransaction();

    // Đồng bộ đơn hàng vào kế toán (async, không chờ)
    syncOrderToAccounting(order, null, req.userId).catch(err => {
      console.error('Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
    });

    return res.status(200).json({
      status: 'success',
      order,
      message: 'Order created successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error creating order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    session.endSession();
  }
});

module.exports = router;

