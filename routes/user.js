const express = require('express');
const router = express.Router();
const db = require('../config/database');
const User = require('../models/User');
const { withAuth, optionalAuth } = require('../middleware/auth');

// GET /api/user - Get all users with pagination (admin only)
router.get('/', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin
    if (!req.userId || req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    const pageNo = parseInt(req.query.pageNo) || 0;
    const limit = parseInt(req.query.limit) || 5;
    const skip = pageNo * limit;

    // Get total count
    const total = await User.countDocuments({});
    
    // Get users with pagination
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Convert _id to id
    const usersCleaned = users.map((user) => ({
      id: user._id.toString(),
      ...user,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    }));

    return res.status(200).json({
      users: usersCleaned,
      total,
      pageNo,
      limit,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/user/me - Get current user info
router.get('/me', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/user/:userId - Get user by ID
router.get('/:userId', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { userId } = req.params;
    
    // Only allow users to view their own profile or admins to view any profile
    if (req.userId && req.user?.role !== 'admin' && req.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/user/:userId - Update user
router.put('/:userId', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { userId } = req.params;

    // Only allow users to update their own profile or admins to update any profile
    if (req.user?.role !== 'admin' && req.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const user = await User.findByIdAndUpdate(userId, req.body, { new: true }).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

