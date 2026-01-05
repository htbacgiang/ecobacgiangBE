const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    maSanPham: {
      type: String,
      required: [true, 'Mã sản phẩm là bắt buộc'],
      trim: true,
      unique: true,
      match: [/^[A-Za-z0-9_-]+$/, 'Mã sản phẩm chỉ được chứa chữ cái, số, dấu gạch dưới hoặc gạch ngang'],
    },
    name: {
      type: String,
      required: [true, 'Tên sản phẩm là bắt buộc'],
      trim: true,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
      required: [true, 'Giá sản phẩm là bắt buộc'],
    },
    promotionalPrice: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: function (value) {
          return !this.price || value <= this.price;
        },
        message: 'Giá khuyến mãi không được vượt quá giá thường',
      },
    },
    content: {
      type: String,
      default: '',
      trim: true,
    },
    isNew: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    category: {
      type: String,
      required: [true, 'Danh mục là bắt buộc'],
      trim: true,
    },
    categoryNameVN: {
      type: String,
      required: [true, 'Tên danh mục tiếng Việt là bắt buộc'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Mô tả sản phẩm là bắt buộc'],
      trim: true,
    },
    image: {
      type: [String],
      required: [true, 'Ảnh sản phẩm là bắt buộc'],
      validate: {
        validator: function (arr) {
          return arr.length > 0;
        },
        message: 'Phải có ít nhất một ảnh sản phẩm',
      },
    },
    slug: {
      type: String,
      required: [true, 'Slug là bắt buộc'],
      trim: true,
      unique: true,
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    reviewCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    stockStatus: {
      type: String,
      enum: ['Còn hàng', 'Hết hàng'],
      default: 'Còn hàng',
      trim: true,
    },
    unit: {
      type: String,
      // Keep legacy values, but normalize to "100g" going forward.
      enum: ['Kg', 'gam', '100gam', '100g', 'túi', 'hộp', 'chai'],
      default: 'Kg',
      required: [true, 'Đơn vị là bắt buộc'],
      trim: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
productSchema.index({ slug: 1 });
productSchema.index({ category: 1 });

// Soft delete middleware
productSchema.pre(/^find/, function (next) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);

