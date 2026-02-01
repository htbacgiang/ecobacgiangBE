const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Contact = require('../models/Contact');
const { withAuth } = require('../middleware/auth');
const User = require('../models/User');

// POST /api/contact - Submit contact form
router.post('/', async (req, res) => {
  try {
    await db.connectDb();
    const { name, phone, email, message } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'Vui lòng nhập họ và tên' 
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'Vui lòng nhập số điện thoại' 
      });
    }

    if (!/^\d{10,11}$/.test(phone.trim())) {
      return res.status(400).json({ 
        success: false,
        message: 'Số điện thoại phải có 10-11 chữ số' 
      });
    }

    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ 
        success: false,
        message: 'Email không hợp lệ' 
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'Vui lòng nhập yêu cầu tư vấn' 
      });
    }

    if (message.trim().length > 500) {
      return res.status(400).json({ 
        success: false,
        message: 'Tin nhắn không được vượt quá 500 ký tự' 
      });
    }

    // Create contact
    const contact = new Contact({
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : '',
      message: message.trim(),
      source: req.headers['user-agent']?.includes('Mobile') || req.body.source === 'mobile' ? 'mobile' : 'website',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    await contact.save();

    return res.status(200).json({ 
      success: true,
      message: 'Đăng ký tư vấn thành công!',
      data: {
        id: contact._id,
        name: contact.name,
        phone: contact.phone
      }
    });
  } catch (error) {
    console.error('Error submitting contact form:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Không thể gửi yêu cầu. Vui lòng thử lại sau.' 
    });
  }
});

// GET /api/contact - Get list of contacts (Admin only)
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
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const totalItems = await Contact.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);

    // Fetch contacts
    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      data: contacts,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// PUT /api/contact/:id/status - Update contact status (Admin only)
router.put('/:id/status', withAuth, async (req, res) => {
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

    const { status } = req.body;
    if (!['new', 'read', 'replied'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid status' 
      });
    }

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({ 
        success: false,
        message: 'Contact not found' 
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      data: contact
    });
  } catch (error) {
    console.error('Error updating contact status:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

module.exports = router;

