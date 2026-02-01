const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Coupon = require('../models/Coupon');

// GET /api/coupon - Get all coupons or validate coupon
router.get('/', async (req, res) => {
  try {
    await db.connectDb();
    const { coupon, code } = req.query;
    const couponCode = coupon || code;

    if (couponCode) {
      // Validate coupon code
      const foundCoupon = await Coupon.find({ coupon: couponCode.toUpperCase() });
      if (!foundCoupon || foundCoupon.length === 0) {
        return res.status(200).json([]); // Trả về array rỗng thay vì 404
      }

      // Return array format để tương thích với frontend
      return res.status(200).json(foundCoupon);
    }

    // Get all coupons
    const coupons = await Coupon.find({}).sort({ createdAt: -1 });
    return res.status(200).json(coupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/coupon - Create new coupon
router.post('/', async (req, res) => {
  try {
    await db.connectDb();
    const { coupon, startDate, endDate, discount, globalUsageLimit, perUserUsageLimit } = req.body;

    if (!coupon || !startDate || !endDate || discount == null) {
      return res.status(400).json({ 
        message: 'Vui lòng điền đầy đủ thông tin coupon.' 
      });
    }

    // Validate discount
    if (discount < 0 || discount > 100) {
      return res.status(400).json({ 
        message: 'Giảm giá phải từ 0 đến 100%' 
      });
    }

    // Check if coupon already exists
    const existingCoupon = await Coupon.findOne({ coupon: coupon.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({ 
        message: 'Mã giảm giá đã tồn tại' 
      });
    }

    // Create new coupon
    const newCoupon = new Coupon({
      coupon: coupon.toUpperCase(),
      startDate,
      endDate,
      discount,
      globalUsageLimit: globalUsageLimit === '' ? null : (globalUsageLimit == null ? null : Number(globalUsageLimit)),
      perUserUsageLimit: perUserUsageLimit === '' ? null : (perUserUsageLimit == null ? null : Number(perUserUsageLimit)),
    });

    if (newCoupon.globalUsageLimit != null && newCoupon.globalUsageLimit < 0) {
      return res.status(400).json({ message: 'Số lượng mã (global) phải >= 0' });
    }
    if (newCoupon.perUserUsageLimit != null && newCoupon.perUserUsageLimit < 0) {
      return res.status(400).json({ message: 'Số lượt / user phải >= 0' });
    }

    await newCoupon.save();
    return res.status(201).json(newCoupon);
  } catch (error) {
    console.error('Error creating coupon:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// PUT /api/coupon/:couponId - Update coupon
router.put('/:couponId', async (req, res) => {
  try {
    await db.connectDb();
    const { couponId } = req.params;
    const { coupon, startDate, endDate, discount, globalUsageLimit, perUserUsageLimit } = req.body;

    const updateData = {};
    if (coupon) updateData.coupon = coupon.toUpperCase();
    if (startDate) updateData.startDate = startDate;
    if (endDate) updateData.endDate = endDate;
    if (discount != null) {
      if (discount < 0 || discount > 100) {
        return res.status(400).json({ 
          message: 'Giảm giá phải từ 0 đến 100%' 
        });
      }
      updateData.discount = discount;
    }

    if (globalUsageLimit !== undefined) {
      const v = globalUsageLimit === '' || globalUsageLimit == null ? null : Number(globalUsageLimit);
      if (v != null && v < 0) return res.status(400).json({ message: 'Số lượng mã (global) phải >= 0' });
      updateData.globalUsageLimit = v;
    }
    if (perUserUsageLimit !== undefined) {
      const v = perUserUsageLimit === '' || perUserUsageLimit == null ? null : Number(perUserUsageLimit);
      if (v != null && v < 0) return res.status(400).json({ message: 'Số lượt / user phải >= 0' });
      updateData.perUserUsageLimit = v;
    }

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      couponId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedCoupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    return res.status(200).json(updatedCoupon);
  } catch (error) {
    console.error('Error updating coupon:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// DELETE /api/coupon/:couponId - Delete coupon
router.delete('/:couponId', async (req, res) => {
  try {
    await db.connectDb();
    const { couponId } = req.params;

    const deletedCoupon = await Coupon.findByIdAndDelete(couponId);

    if (!deletedCoupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    return res.status(200).json({ 
      message: 'Coupon deleted successfully',
      coupon: deletedCoupon 
    });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

module.exports = router;

