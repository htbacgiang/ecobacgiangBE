const express = require('express');
const router = express.Router();
const db = require('../config/database');
const User = require('../models/User');
const { withAuth } = require('../middleware/auth');

// GET /api/address - Get user's addresses
router.get('/', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ addresses: user.address || [] });
  } catch (error) {
    console.error('Error fetching addresses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/address - Add new address
router.post('/', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If this is the first address or isDefault is true, set others to not default
    if (req.body.isDefault || user.address.length === 0) {
      user.address.forEach(addr => {
        addr.isDefault = false;
      });
      req.body.isDefault = true;
    }

    user.address.push(req.body);
    await user.save();

    return res.status(200).json({ message: 'Address added', addresses: user.address });
  } catch (error) {
    console.error('Error adding address:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/address/:index - Update address
router.put('/:index', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { index } = req.params;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.address[index]) {
      return res.status(404).json({ message: 'Address not found' });
    }

    // If setting as default, unset others
    if (req.body.isDefault) {
      user.address.forEach((addr, i) => {
        if (i !== parseInt(index)) {
          addr.isDefault = false;
        }
      });
    }

    user.address[index] = { ...user.address[index].toObject(), ...req.body };
    await user.save();

    return res.status(200).json({ message: 'Address updated', addresses: user.address });
  } catch (error) {
    console.error('Error updating address:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/address/:index - Delete address
router.delete('/:index', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { index } = req.params;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.address[index]) {
      return res.status(404).json({ message: 'Address not found' });
    }

    user.address.splice(index, 1);
    await user.save();

    return res.status(200).json({ message: 'Address deleted', addresses: user.address });
  } catch (error) {
    console.error('Error deleting address:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

