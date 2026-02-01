const mongoose = require('mongoose');

/**
 * Accounting Period - Kỳ Kế toán
 * Quản lý các kỳ kế toán và ngày khóa sổ
 */
const AccountingPeriodSchema = new mongoose.Schema({
  // Tên kỳ (VD: "Tháng 1/2024", "Quý 1/2024", "Năm 2024")
  periodName: {
    type: String,
    required: true,
    trim: true,
  },
  // Ngày bắt đầu kỳ
  startDate: {
    type: Date,
    required: true,
  },
  // Ngày kết thúc kỳ
  endDate: {
    type: Date,
    required: true,
  },
  // Ngày khóa sổ (Lock Date) - Không được sửa/xóa giao dịch trước ngày này
  lockDate: {
    type: Date,
    default: null,
  },
  // Trạng thái: open, closed
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
    index: true,
  },
  // Ngày khóa sổ
  closedAt: {
    type: Date,
    default: null,
  },
  // Người khóa sổ
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Ghi chú
  notes: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index
AccountingPeriodSchema.index({ startDate: 1, endDate: 1 });
AccountingPeriodSchema.index({ status: 1 });
AccountingPeriodSchema.index({ lockDate: 1 });

module.exports = mongoose.models.AccountingPeriod || mongoose.model("AccountingPeriod", AccountingPeriodSchema);

