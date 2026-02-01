const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  coupon: {
    type: String,
    trim: true,
    unique: true,
    uppercase: true,
    required: true,
    minLength: 4,
    maxLength: 10,
  },
  startDate: {
    type: String,
    required: true,
  },
  endDate: {
    type: String,
    required: true,
  },
  discount: {
    type: Number,
    required: true,
  },
  // Tổng số lượt có thể áp dụng (null => không giới hạn)
  globalUsageLimit: {
    type: Number,
    default: null,
    min: 0,
  },
  // Số lượt tối đa cho mỗi user (null => không giới hạn)
  perUserUsageLimit: {
    type: Number,
    default: null,
    min: 0,
  },
  // Đã sử dụng (chỉ tính khi thanh toán thành công)
  usedCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Đã giữ chỗ (đơn pending) - không tính là đã dùng
  reservedCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Thống kê theo user
  userStats: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      usedCount: { type: Number, default: 0, min: 0 },
      reservedCount: { type: Number, default: 0, min: 0 },
    },
  ],
}, {
  timestamps: true,
});

module.exports = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);

