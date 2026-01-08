const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
  orderItems: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      title: { type: String, required: true },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
      image: { type: String },
      unit: { type: String },
    },
  ],
  shippingAddress: {
    address: { type: String, required: true },
  },
  phone: { type: String, required: true },
  name: { type: String, required: true },
  note: { type: String },
  deliveryTime: { type: String }, // Thời gian giao hàng: 'business_hours' hoặc '17-18', '18-19', '19-20'
  coupon: { type: String },
  discount: { type: Number, default: 0 },
  // Dùng để chống tạo trùng đơn khi thanh toán online (Sepay/MoMo)
  paymentCode: { type: String, default: '' },
  // Tracking coupon usage timing
  couponReserved: { type: Boolean, default: false },
  couponCommitted: { type: Boolean, default: false },
  totalPrice: { type: Number, required: true },
  totalAfterDiscount: { type: Number },
  shippingFee: { type: Number, default: 30000 },
  finalTotal: { type: Number, required: true },
  paymentMethod: {
    type: String,
    enum: ['COD', 'BankTransfer', 'Sepay', 'MoMo'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema);

