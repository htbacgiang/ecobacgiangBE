const express = require('express');
const router = express.Router();
const db = require('../config/database');
const User = require('../models/User');
const { withAuth } = require('../middleware/auth');

// GET /api/wishlist - Get user's wishlist
router.get('/', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const user = await User.findById(req.userId).populate('wishlist.product');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ wishlist: user.wishlist || [] });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/wishlist/:productId - Add product to wishlist
router.post('/:productId', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { productId } = req.params;
    const { style } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if product already in wishlist
    const existingIndex = user.wishlist.findIndex(
      item => item.product.toString() === productId
    );

    if (existingIndex >= 0) {
      return res.status(400).json({ message: 'Product already in wishlist' });
    }

    user.wishlist.push({ product: productId, style });
    await user.save();

    return res.status(200).json({ message: 'Product added to wishlist', wishlist: user.wishlist });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/wishlist/:productId - Remove product from wishlist
router.delete('/:productId', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { productId } = req.params;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.wishlist = user.wishlist.filter(
      item => item.product.toString() !== productId
    );
    await user.save();

    return res.status(200).json({ message: 'Product removed from wishlist', wishlist: user.wishlist });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

