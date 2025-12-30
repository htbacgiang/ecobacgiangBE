const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const { withAuth } = require('../middleware/auth');
const { syncOrderToAccounting } = require('../services/accountingService');

// POST /api/checkout - Create order from cart
router.post('/', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const {
      shippingAddress,
      phone,
      name,
      note,
      deliveryTime,
      coupon,
      discount,
      paymentMethod,
      orderItems,
      totalPrice,
      totalAfterDiscount,
      shippingFee,
      finalTotal,
    } = req.body;

    // Create order
    const order = new Order({
      user: req.userId,
      orderItems,
      shippingAddress,
      phone,
      name,
      note,
      deliveryTime,
      coupon,
      discount,
      totalPrice,
      totalAfterDiscount,
      shippingFee: shippingFee || 30000,
      finalTotal,
      paymentMethod,
      status: 'pending',
    });

    await order.save();

    // Clear cart after checkout
    await Cart.findOneAndUpdate(
      { user: req.userId },
      { products: [], cartTotal: 0, totalAfterDiscount: 0, coupon: '', discount: 0 }
    );

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
    console.error('Error creating order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

