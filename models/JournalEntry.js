const mongoose = require('mongoose');

/**
 * Journal Entry - Chứng Từ Kế Toán
 * Là "tờ phiếu" ghi nhận một nghiệp vụ kinh tế phát sinh hoàn chỉnh
 * Sử dụng cấu trúc Document Lồng Nhau (Embedded Document) cho phần Lines
 */

const JournalLineSchema = new mongoose.Schema({
  // Mã Tài Khoản: Tham chiếu đến Accounts
  accountCode: {
    type: String,
    required: true,
    ref: 'Account',
    index: true,
  },
  // Số tiền Nợ (Debit)
  debit: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Số tiền Có (Credit)
  credit: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Đối tượng: ID của Khách hàng hoặc Nhà cung cấp
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Có thể mở rộng thành Supplier sau
    default: null,
  },
  // Loại đối tượng: customer, supplier, employee
  partnerType: {
    type: String,
    enum: ['customer', 'supplier', 'employee', null],
    default: null,
  },
  // Diễn giải chi tiết cho dòng này
  description: {
    type: String,
    default: '',
  },
}, { _id: false });

const JournalEntrySchema = new mongoose.Schema({
  // Số chứng từ: Mã phiếu duy nhất (VD: PC-202311-001)
  referenceNo: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  // Ngày chứng từ: Ngày thực hiện giao dịch
  date: {
    type: Date,
    required: true,
    index: true,
  },
  // Ngày ghi sổ: Ngày giao dịch được ghi nhận vào hệ thống
  postingDate: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  // Ngày giao dịch cần điều chỉnh (chỉ dùng cho bút toán điều chỉnh)
  adjustedDate: {
    type: Date,
    default: null,
  },
  // Diễn giải: Mô tả ngắn gọn
  memo: {
    type: String,
    required: true,
    trim: true,
  },
  // Loại chứng từ
  entryType: {
    type: String,
    enum: [
      'manual',           // Nhập thủ công
      'sale',             // Bán hàng
      'purchase',         // Mua hàng
      'payment',          // Phiếu thu
      'receipt',          // Phiếu chi
      'transfer',         // Chuyển tiền nội bộ
      'adjusting',        // Điều chỉnh
      'adjustment',       // Điều chỉnh (alias)
      'depreciation',     // Khấu hao
      'inventory',        // Nhập/xuất kho
      'closing',          // Kết chuyển cuối kỳ
    ],
    default: 'manual',
  },
  // Liên kết gốc: ID của Đơn hàng hoặc ID của Nhân viên (để truy vết)
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  // Loại nguồn: order, invoice, expense, etc.
  sourceType: {
    type: String,
    enum: ['order', 'invoice', 'expense', 'depreciation', 'inventory', 'adjusting_entry', 'period_closing', 'MANUAL', 'SALES', 'INVENTORY_COST', null],
    default: null,
  },
  // Chi tiết Bút toán: Mảng các dòng định khoản
  lines: {
    type: [JournalLineSchema],
    required: true,
    validate: {
      validator: function(lines) {
        return lines && lines.length > 0;
      },
      message: 'Chứng từ phải có ít nhất một dòng bút toán',
    },
  },
  // Tổng Nợ (tính toán tự động)
  totalDebit: {
    type: Number,
    default: 0,
  },
  // Tổng Có (tính toán tự động)
  totalCredit: {
    type: Number,
    default: 0,
  },
  // Trạng thái: draft, posted, cancelled
  status: {
    type: String,
    enum: ['draft', 'posted', 'cancelled'],
    default: 'posted',
    index: true,
  },
  // Người tạo
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Middleware: Tính toán tổng Nợ và tổng Có trước khi lưu
JournalEntrySchema.pre('save', function(next) {
  if (this.lines && this.lines.length > 0) {
    this.totalDebit = this.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
    this.totalCredit = this.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  }
  this.updatedAt = Date.now();
  next();
});

// Index để truy vấn nhanh
JournalEntrySchema.index({ date: 1, status: 1 });
JournalEntrySchema.index({ postingDate: 1, status: 1 });
JournalEntrySchema.index({ entryType: 1, status: 1 });
JournalEntrySchema.index({ 'lines.accountCode': 1 });

// Virtual: Kiểm tra cân bằng (Nợ = Có)
JournalEntrySchema.virtual('isBalanced').get(function() {
  return Math.abs(this.totalDebit - this.totalCredit) < 0.01; // Cho phép sai số nhỏ do làm tròn
});

module.exports = mongoose.models.JournalEntry || mongoose.model("JournalEntry", JournalEntrySchema);
