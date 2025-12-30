const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Cart = require('../models/Cart');
const { withAuth, optionalAuth } = require('../middleware/auth');

// GET /api/cart - Get user's cart
router.get('/', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { userId } = req.query;

    // Use userId from query or from auth token
    const targetUserId = userId || req.userId;

    if (!targetUserId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const cart = await Cart.findOne({ user: targetUserId });
    if (!cart) {
      return res.status(200).json({ products: [], cartTotal: 0 });
    }
    
    // Ensure cartTotal is calculated correctly before returning
    // The pre-save hook should handle this, but we'll recalculate here to be safe
    const calculatedTotal = cart.products.reduce((sum, item) => {
      return sum + (item.price || 0) * (item.quantity || 0);
    }, 0);
    
    // Update cartTotal if it's different (this will trigger pre-save hook)
    if (cart.cartTotal !== calculatedTotal) {
      cart.cartTotal = calculatedTotal;
      if (cart.discount > 0) {
        cart.totalAfterDiscount = cart.cartTotal * (1 - cart.discount / 100);
      } else {
        cart.totalAfterDiscount = cart.cartTotal;
      }
      await cart.save();
    }
    
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// POST /api/cart - Add product to cart
router.post('/', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { user, product, quantity, price, title, image } = req.body;

    // Use user from body or from auth token
    const targetUser = user || req.userId;

    if (!targetUser || !product) {
      return res.status(400).json({ message: 'User and product are required' });
    }

    let cart = await Cart.findOne({ user: targetUser });
    if (!cart) {
      cart = new Cart({ user: targetUser, products: [] });
    }
    const index = cart.products.findIndex(p => p.product.toString() === product);
    if (index >= 0) {
      cart.products[index].quantity += quantity || 1;
    } else {
      cart.products.push({ product, title, image, quantity: quantity || 1, price });
    }
    // cartTotal and totalAfterDiscount will be calculated automatically by pre-save hook
    await cart.save();
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// DELETE /api/cart/:userId/:productId - Remove product from cart
router.delete('/:userId/:productId', async (req, res) => {
  try {
    await db.connectDb();
    const { userId, productId } = req.params;
    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    cart.products = cart.products.filter(p => p.product.toString() !== productId);
    // cartTotal and totalAfterDiscount will be calculated automatically by pre-save hook
    await cart.save();
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// PUT /api/cart/:userId/:productId - Update product quantity in cart
router.put('/:userId/:productId', async (req, res) => {
  try {
    await db.connectDb();
    const { userId, productId } = req.params;
    const { quantity } = req.body;
    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    const productIndex = cart.products.findIndex(p => p.product.toString() === productId);
    if (productIndex >= 0) {
      cart.products[productIndex].quantity = quantity;
      // cartTotal and totalAfterDiscount will be calculated automatically by pre-save hook
      await cart.save();
    }
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// PUT /api/cart/:userId/apply-coupon - Apply coupon to cart
router.put('/:userId/apply-coupon', async (req, res) => {
  try {
    await db.connectDb();
    const { userId } = req.params;
    const { coupon, discount, totalAfterDiscount } = req.body;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    // Update coupon info
    cart.coupon = coupon || '';
    cart.discount = discount || 0;
    // cartTotal and totalAfterDiscount will be calculated automatically by pre-save hook
    // If totalAfterDiscount is provided, use it; otherwise it will be calculated
    if (totalAfterDiscount !== undefined && totalAfterDiscount !== null) {
      cart.totalAfterDiscount = totalAfterDiscount;
    }
    
    await cart.save();
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;

