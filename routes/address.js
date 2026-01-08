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

    if (!Array.isArray(user.address)) user.address = [];

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

// PUT /api/address/:addressId - Update address by subdocument _id (recommended)
router.put('/:addressId([0-9a-fA-F]{24})', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { addressId } = req.params;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const addr = user.address?.id(addressId);
    if (!addr) {
      return res.status(404).json({ message: 'Address not found' });
    }

    // If setting as default, unset others
    if (req.body.isDefault) {
      user.address.forEach((a) => {
        a.isDefault = a._id.toString() === addressId;
      });
    }

    Object.assign(addr, req.body);
    await user.save();

    return res.status(200).json({ message: 'Address updated', addresses: user.address });
  } catch (error) {
    console.error('Error updating address:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/address/:addressId - Delete address by subdocument _id (recommended)
router.delete('/:addressId([0-9a-fA-F]{24})', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { addressId } = req.params;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const addr = user.address?.id(addressId);
    if (!addr) {
      return res.status(404).json({ message: 'Address not found' });
    }

    const wasDefault = !!addr.isDefault;
    // Safer removal for subdocument arrays across mongoose versions
    user.address.pull({ _id: addressId });

    // If deleted default, promote first remaining address to default
    if (wasDefault && user.address.length > 0) {
      user.address.forEach((a, idx) => {
        a.isDefault = idx === 0;
      });
    }
    await user.save();

    return res.status(200).json({ message: 'Address deleted', addresses: user.address });
  } catch (error) {
    console.error('Error deleting address:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// --- Backward compatible index-based routes (legacy) ---
// PUT /api/address/:index - Update address by index
router.put('/:index(\\d+)', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { index } = req.params;
    const idx = parseInt(index, 10);
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.address?.[idx]) {
      return res.status(404).json({ message: 'Address not found' });
    }

    if (req.body.isDefault) {
      user.address.forEach((a, i) => {
        a.isDefault = i === idx;
      });
    }

    user.address[idx] = { ...user.address[idx].toObject(), ...req.body };
    await user.save();

    return res.status(200).json({ message: 'Address updated', addresses: user.address });
  } catch (error) {
    console.error('Error updating address (legacy index):', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/address/:index - Delete address by index
router.delete('/:index(\\d+)', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { index } = req.params;
    const idx = parseInt(index, 10);
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.address?.[idx]) {
      return res.status(404).json({ message: 'Address not found' });
    }

    const wasDefault = !!user.address[idx].isDefault;
    user.address.splice(idx, 1);

    if (wasDefault && user.address.length > 0) {
      user.address.forEach((a, i) => {
        a.isDefault = i === 0;
      });
    }

    await user.save();
    return res.status(200).json({ message: 'Address deleted', addresses: user.address });
  } catch (error) {
    console.error('Error deleting address (legacy index):', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

