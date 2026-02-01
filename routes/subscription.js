const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Subscription = require('../models/Subscription');
const { withAuth } = require('../middleware/auth');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmails');

// Email thông báo cho admin khi có đăng ký nhận tin mới
const adminNewSubscriptionTemplate = (subscriberEmail, subscribedAt, ipAddress) => {
  const timeStr = subscribedAt ? new Date(subscribedAt).toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN');
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #009934; color: white; padding: 16px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; border-top: none; }
        .info { background: white; padding: 16px; margin: 12px 0; border-radius: 8px; border-left: 4px solid #009934; }
        .label { font-weight: bold; color: #555; }
        .footer { margin-top: 20px; font-size: 12px; color: #666; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h2 style="margin:0;">Thông báo đăng ký nhận tin mới</h2></div>
        <div class="content">
          <p>Có người dùng vừa đăng ký nhận thông báo qua email.</p>
          <div class="info">
            <p><span class="label">Email đăng ký:</span> ${subscriberEmail}</p>
            <p><span class="label">Thời gian:</span> ${timeStr}</p>
            ${ipAddress ? `<p><span class="label">IP:</span> ${ipAddress}</p>` : ''}
          </div>
          <p>Bạn có thể xem danh sách tại trang quản trị → Danh sách email đăng ký.</p>
        </div>
        <div class="footer">Eco Bắc Giang – Hệ thống thông báo</div>
      </div>
    </body>
    </html>
  `;
};

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

    // Gửi email thông báo cho admin
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL_ADDRESS;
    if (adminEmail) {
      try {
        await sendEmail(
          adminEmail,
          '',
          '',
          '[Eco Bắc Giang] Có đăng ký nhận tin mới',
          adminNewSubscriptionTemplate(email, subscription.subscribedAt, req.ip)
        );
      } catch (emailErr) {
        console.error('Failed to send admin subscription notification:', emailErr);
        // Không fail request – đăng ký đã thành công, chỉ lỗi gửi thông báo admin
      }
    }

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

