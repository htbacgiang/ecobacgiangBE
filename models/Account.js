const mongoose = require('mongoose');

/**
 * Chart of Accounts (COA) - Danh mục Tài khoản
 * Quản lý danh sách các "ngăn chứa tiền" trong hệ thống kế toán
 */
const AccountSchema = new mongoose.Schema({
  // Mã tài khoản: Khóa định danh duy nhất (VD: 111, 511, 642)
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  // Tên tài khoản (VD: "Tiền mặt", "Doanh thu bán hàng")
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // Loại tài khoản: Phân loại để hệ thống biết cách cộng trừ
  accountType: {
    type: String,
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    required: true,
  },
  // Loại tài khoản hiển thị (tiếng Việt)
  accountTypeName: {
    type: String,
    enum: ['Tài sản', 'Nợ phải trả', 'Vốn chủ sở hữu', 'Doanh thu', 'Chi phí'],
  },
  // Cấp độ: Để quản lý tài khoản cha/con (1, 2, 3, 4...)
  level: {
    type: Number,
    default: 1,
    min: 1,
    max: 5,
  },
  // Tài khoản cha (parent account)
  parentCode: {
    type: String,
    ref: 'Account',
    default: null,
  },
  // Số dư hiện tại (tùy chọn - để truy xuất nhanh)
  balance: {
    type: Number,
    default: 0,
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

// Index để tìm kiếm nhanh
AccountSchema.index({ code: 1 });
AccountSchema.index({ accountType: 1 });
AccountSchema.index({ parentCode: 1 });

module.exports = mongoose.models.Account || mongoose.model("Account", AccountSchema);
