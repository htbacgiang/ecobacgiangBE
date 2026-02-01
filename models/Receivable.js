const mongoose = require('mongoose');

/**
 * Accounts Receivable - Quản lý Công nợ Phải Thu
 * Mỗi khi bán chịu 1 đơn hàng, hệ thống tạo ra một "Khoản Phải Thu"
 * Tận dụng collection JournalEntries bằng cách thêm các trường trạng thái
 */
const ReceivableSchema = new mongoose.Schema({
  // Tham chiếu đến Journal Entry gốc (chứng từ bán hàng)
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    required: true,
    unique: true,
    index: true,
  },
  // Khách hàng nợ
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Tham chiếu đến đơn hàng gốc (nếu có)
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  // Số tiền gốc: Tổng giá trị hóa đơn
  originalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  // Số tiền còn lại: Số tiền khách chưa trả
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
  // Hạn thanh toán: Ngày khách cam kết trả tiền
  dueDate: {
    type: Date,
    required: true,
    index: true,
  },
  // Ngày bán (để tính tuổi nợ)
  invoiceDate: {
    type: Date,
    required: true,
  },
  // Diễn giải
  description: {
    type: String,
    default: '',
  },
  // Danh sách các khoản thanh toán đã nhận (để truy vết)
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

// Middleware: Tự động cập nhật trạng thái dựa trên remainingAmount
ReceivableSchema.pre('save', function(next) {
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

// Index để truy vấn nhanh
ReceivableSchema.index({ customer: 1, paymentStatus: 1 });
ReceivableSchema.index({ dueDate: 1, paymentStatus: 1 });
ReceivableSchema.index({ invoiceDate: 1 });

module.exports = mongoose.models.Receivable || mongoose.model("Receivable", ReceivableSchema);
