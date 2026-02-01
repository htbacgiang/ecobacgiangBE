const mongoose = require('mongoose');

/**
 * Fixed Assets - Quản lý Tài sản Cố định
 * Máy tính, bàn ghế, máy in nhiệt... - tài sản cần phân bổ dần (Khấu hao)
 */
const FixedAssetSchema = new mongoose.Schema({
  // Tên tài sản (VD: Macbook Pro M1)
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // Mã tài sản (để quản lý)
  assetCode: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  // Nguyên giá: Giá trị ban đầu khi mua
  originalCost: {
    type: Number,
    required: true,
    min: 0,
  },
  // Ngày mua
  purchaseDate: {
    type: Date,
    required: true,
  },
  // Thời gian sử dụng (tháng)
  usefulLife: {
    type: Number,
    required: true,
    min: 1,
  },
  // Giá trị khấu hao tháng (tính toán: originalCost / usefulLife)
  monthlyDepreciation: {
    type: Number,
    default: 0,
  },
  // Khấu hao lũy kế: Đã mòn bao nhiêu
  accumulatedDepreciation: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Giá trị còn lại: originalCost - accumulatedDepreciation
  bookValue: {
    type: Number,
    default: 0,
  },
  // Trạng thái: active, sold, scrapped
  status: {
    type: String,
    enum: ['active', 'sold', 'scrapped'],
    default: 'active',
    index: true,
  },
  // Ngày bán/thải loại
  disposalDate: {
    type: Date,
    default: null,
  },
  // Danh sách lịch sử khấu hao
  depreciationHistory: [{
    month: {
      type: String, // Format: YYYY-MM
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    journalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
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

// Middleware: Tính toán monthlyDepreciation và bookValue
FixedAssetSchema.pre('save', function(next) {
  if (this.originalCost && this.usefulLife) {
    this.monthlyDepreciation = this.originalCost / this.usefulLife;
  }
  this.bookValue = this.originalCost - (this.accumulatedDepreciation || 0);
  this.updatedAt = Date.now();
  next();
});

// Index
FixedAssetSchema.index({ status: 1 });
FixedAssetSchema.index({ purchaseDate: 1 });

module.exports = mongoose.models.FixedAsset || mongoose.model("FixedAsset", FixedAssetSchema);
