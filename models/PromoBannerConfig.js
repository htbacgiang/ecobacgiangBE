const mongoose = require('mongoose');

const promoBannerConfigSchema = new mongoose.Schema(
  {
    // Ngày giờ countdown
    countdownDate: {
      type: Date,
      required: true,
      default: () => new Date("2026-01-01T00:00:00"),
    },
    // Nội dung text
    subtitle: {
      type: String,
      default: "Khám phá Eco Bắc Giang",
    },
    title: {
      type: String,
      default: "Ưu đãi mua rau củ hữu cơ",
    },
    description: {
      type: String,
      default: "Sản phẩm sạch – tươi ngon từ nông trại của chúng tôi",
    },
    countdownLabel: {
      type: String,
      default: "Thời gian khuyến mãi còn lại",
    },
    buttonText: {
      type: String,
      default: "Mua ngay",
    },
    buttonLink: {
      type: String,
      default: "#",
    },
    // Hình ảnh
    backgroundImage: {
      type: String,
      default: "/banner.png",
    },
    // Trạng thái active
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Chỉ có một document duy nhất
promoBannerConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

const PromoBannerConfig = mongoose.models.PromoBannerConfig || mongoose.model("PromoBannerConfig", promoBannerConfigSchema);

module.exports = PromoBannerConfig;

