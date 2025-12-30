const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Subscription = require('../models/Subscription');
const { withAuth } = require('../middleware/auth');
const User = require('../models/User');

// GET /api/subscription - Get list of subscriptions with pagination (Admin only)
router.get('/', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin
    const user = await User.findById(req.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Admin only.' 
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';

    // Build query
    const query = {};
    if (search) {
      query.email = { $regex: search, $options: 'i' };
    }
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const totalItems = await Subscription.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);

    // Fetch subscriptions
    const subscriptions = await Subscription.find(query)
      .sort({ subscribedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      data: subscriptions,
      pagination: {
        page,
        limit,
        total: totalPages,
        totalItems
      }
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// GET /api/subscription/stats - Get subscription statistics (Admin only)
router.get('/stats', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin
    const user = await User.findById(req.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Admin only.' 
      });
    }

    const total = await Subscription.countDocuments();
    const active = await Subscription.countDocuments({ status: 'active' });
    const unsubscribed = await Subscription.countDocuments({ status: 'unsubscribed' });
    
    // Get subscriptions by date (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSubscriptions = await Subscription.countDocuments({
      subscribedAt: { $gte: thirtyDaysAgo }
    });

    return res.status(200).json({
      success: true,
      data: {
        total,
        active,
        unsubscribed,
        recentSubscriptions
      }
    });
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// POST /api/subscription - Subscribe email
router.post('/', async (req, res) => {
  try {
    await db.connectDb();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    // Check if already subscribed
    const existing = await Subscription.findOne({ email, status: 'active' });
    if (existing) {
      return res.status(400).json({ 
        success: false,
        message: 'Email already subscribed' 
      });
    }

    const subscription = new Subscription({ 
      email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    await subscription.save();

    return res.status(200).json({ 
      success: true,
      message: 'Subscribed successfully' 
    });
  } catch (error) {
    console.error('Error subscribing:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// POST /api/subscription/unsubscribe - Unsubscribe email
router.post('/unsubscribe', async (req, res) => {
  try {
    await db.connectDb();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    await Subscription.findOneAndUpdate(
      { email },
      { status: 'unsubscribed', unsubscribedAt: new Date() }
    );

    return res.status(200).json({ 
      success: true,
      message: 'Unsubscribed successfully' 
    });
  } catch (error) {
    console.error('Error unsubscribing:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

module.exports = router;

