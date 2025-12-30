const mongoose = require('mongoose');

const SepayPaymentSchema = new mongoose.Schema({
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
    enum: ['pending', 'paid', 'expired', 'cancelled'],
    default: 'pending',
  },
  sepayData: {
    bankInfo: {
      bankId: String,
      accountNumber: String,
      accountName: String,
      description: String,
    },
    qrUrl: String,
    orderInfo: mongoose.Schema.Types.Mixed,
  },
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

module.exports = mongoose.models.SepayPayment || mongoose.model('SepayPayment', SepayPaymentSchema);

