const mongoose = require('mongoose');

/**
 * Bank Accounts - Quản lý Quỹ & Ngân hàng
 * Định nghĩa các nơi chứa tiền: Tiền mặt, Tài khoản ngân hàng
 */
const BankAccountSchema = new mongoose.Schema({
  // Tên: "Tiền mặt tại văn phòng", "Vietcombank - 001..."
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  // Loại: cash (tiền mặt), bank (ngân hàng)
  type: {
    type: String,
    enum: ['cash', 'bank'],
    required: true,
  },
  // Mã Tài khoản Kế toán liên kết (VD: 111 cho tiền mặt, 1121 cho VCB)
  accountCode: {
    type: String,
    ref: 'Account',
    required: true,
    index: true,
  },
  // Số tài khoản ngân hàng (nếu là bank)
  bankAccountNumber: {
    type: String,
    default: '',
  },
  // Tên ngân hàng (nếu là bank)
  bankName: {
    type: String,
    default: '',
  },
  // Chi nhánh
  branch: {
    type: String,
    default: '',
  },
  // Số dư thực tế: Số dư được cập nhật liên tục sau mỗi giao dịch
  realBalance: {
    type: Number,
    default: 0,
  },
  // Số dư ban đầu (để khởi tạo)
  openingBalance: {
    type: Number,
    default: 0,
  },
  // Ngày số dư ban đầu
  openingDate: {
    type: Date,
    default: Date.now,
  },
  // Trạng thái: active, inactive
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
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
BankAccountSchema.index({ type: 1, status: 1 });
BankAccountSchema.index({ accountCode: 1 });

module.exports = mongoose.models.BankAccount || mongoose.model("BankAccount", BankAccountSchema);
