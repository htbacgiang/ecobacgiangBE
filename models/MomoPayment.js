const mongoose = require('mongoose');

const MomoPaymentSchema = new mongoose.Schema({
  paymentCode: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'expired', 'cancelled', 'failed'],
    default: 'pending',
  },
  momoData: {
    type: mongoose.Schema.Types.Mixed,
  },
  requestData: {
    type: mongoose.Schema.Types.Mixed,
  },
  payUrl: String,
  deeplink: String,
  qrCodeUrl: String,
  transactionId: String,
  paidAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 phút
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.models.MomoPayment || mongoose.model('MomoPayment', MomoPaymentSchema);

