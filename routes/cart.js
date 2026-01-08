const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { withAuth, optionalAuth } = require('../middleware/auth');
const { normalizeUnit } = require('../utils/normalizeUnit');
const { validateForCart, normalizeCode } = require('../services/couponUsageService');

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

    // Backfill unit for existing carts (so frontend can detect "kg" and allow 0.5)
    const missingUnitItems = (cart.products || []).filter((p) => !p.unit);
    if (missingUnitItems.length > 0) {
      const productIds = missingUnitItems.map((p) => p.product);
      const products = await Product.find({ _id: { $in: productIds } })
        .select('_id unit')
        .lean();
      const unitMap = new Map(products.map((p) => [p._id.toString(), p.unit]));

      cart.products.forEach((item) => {
        if (!item.unit) {
          const u = unitMap.get(item.product.toString());
          if (u) item.unit = normalizeUnit(u);
        }
      });

      // Save so next time it's already present
      await cart.save();
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
    const { user, product, quantity, price, title, image, unit } = req.body;

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
      let resolvedUnit = unit;
      if (!resolvedUnit) {
        const prod = await Product.findById(product).select('unit').lean();
        resolvedUnit = prod?.unit;
      }
      resolvedUnit = normalizeUnit(resolvedUnit);
      cart.products.push({ product, title, image, unit: resolvedUnit, quantity: quantity || 1, price });
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
// IMPORTANT: Restrict :productId to Mongo ObjectId format so it doesn't match "/apply-coupon"
router.put('/:userId/:productId([0-9a-fA-F]{24})', async (req, res) => {
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
    // Support multiple client payload shapes
    // - { coupon: "ECO10" } (preferred)
    // - { code: "ECO10" }
    // - query ?coupon=ECO10
    const rawCoupon = req.body?.coupon ?? req.body?.code ?? req.query?.coupon ?? req.query?.code;

    // If client didn't send anything, don't silently clear existing coupon
    if (rawCoupon === undefined) {
      return res.status(400).json({ message: 'Thiếu mã giảm giá (coupon).' });
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const code = normalizeCode(rawCoupon);

    // Clear coupon
    if (!code) {
      cart.coupon = '';
      cart.discount = 0;
      // pre-save hook sẽ tính lại totalAfterDiscount theo cartTotal
      await cart.save();
      return res.status(200).json(cart);
    }

    // Always calculate based on DB coupon + current cartTotal (do NOT trust frontend)
    const result = await validateForCart({ code, userId });
    if (!result.ok) {
      return res.status(400).json({ message: result.message || 'Không thể áp dụng mã giảm giá.' });
    }

    cart.coupon = code;
    cart.discount = Number(result.coupon.discount || 0);
    
    await cart.save();
    return res.status(200).json(cart);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;

