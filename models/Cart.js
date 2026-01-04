const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema;

const cartSchema = new mongoose.Schema({
  products: [
    {
      product: { type: ObjectId, ref: 'Product', required: true },
      title: String,
      image: String,
      unit: String,
      quantity: Number,
      price: Number,
    },
  ],
  cartTotal: { type: Number, default: 0 },
  totalAfterDiscount: { type: Number, default: 0 },
  coupon: { type: String, default: '' },
  discount: { type: Number, default: 0 },
  user: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Pre-save hook to calculate cartTotal and totalAfterDiscount
cartSchema.pre('save', function(next) {
  // Calculate cartTotal from products
  this.cartTotal = this.products.reduce((sum, item) => {
    return sum + (item.price * (item.quantity || 0));
  }, 0);
  
  // Calculate totalAfterDiscount
  if (this.discount > 0) {
    this.totalAfterDiscount = this.cartTotal * (1 - this.discount / 100);
  } else {
    this.totalAfterDiscount = this.cartTotal;
  }
  
  next();
});

module.exports = mongoose.models.Cart || mongoose.model('Cart', cartSchema);

