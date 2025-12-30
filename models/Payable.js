const mongoose = require('mongoose');

/**
 * Accounts Payable - Quản lý Công nợ Phải Trả
 * Quản lý các khoản nợ nhà cung cấp (NCC) và các chi phí vận hành chưa thanh toán
 */
const PayableSchema = new mongoose.Schema({
  // Tham chiếu đến Journal Entry gốc (chứng từ mua hàng/chi phí)
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    required: true,
    unique: true,
    index: true,
  },
  // Nhà cung cấp
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Có thể tạo Supplier model riêng sau
    required: true,
    index: true,
  },
  // Loại hóa đơn
  billType: {
    type: String,
    enum: ['purchase', 'expense', 'service'],
    required: true,
  },
  // Số tiền gốc
  originalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  // Số tiền còn nợ
  remainingAmount: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  // Trạng thái thanh toán
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial', 'paid'],
    default: 'unpaid',
    index: true,
  },
  // Hạn thanh toán
  dueDate: {
    type: Date,
    required: true,
    index: true,
  },
  // Ngày hóa đơn
  invoiceDate: {
    type: Date,
    required: true,
  },
  // Trạng thái phê duyệt
  approvalStatus: {
    type: String,
    enum: ['draft', 'approved', 'rejected'],
    default: 'draft',
    index: true,
  },
  // Người duyệt
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Ngày duyệt
  approvedAt: {
    type: Date,
    default: null,
  },
  // Diễn giải
  description: {
    type: String,
    default: '',
  },
  // Danh sách các khoản thanh toán đã thực hiện
  payments: [{
    paymentEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    allocatedAmount: {
      type: Number,
      default: 0,
    },
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Middleware: Tự động cập nhật trạng thái
PayableSchema.pre('save', function(next) {
  if (this.remainingAmount <= 0) {
    this.paymentStatus = 'paid';
  } else if (this.remainingAmount < this.originalAmount) {
    this.paymentStatus = 'partial';
  } else {
    this.paymentStatus = 'unpaid';
  }
  this.updatedAt = Date.now();
  next();
});

// Index
PayableSchema.index({ supplier: 1, paymentStatus: 1 });
PayableSchema.index({ dueDate: 1, paymentStatus: 1 });

module.exports = mongoose.models.Payable || mongoose.model("Payable", PayableSchema);
