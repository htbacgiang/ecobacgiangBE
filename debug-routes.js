// Debug script to test all routes
require('dotenv').config();
const express = require('express');
const app = express();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const checkoutRoutes = require('./routes/checkout');
const wishlistRoutes = require('./routes/wishlist');
const addressRoutes = require('./routes/address');
const couponRoutes = require('./routes/coupon');
const paymentRoutes = require('./routes/payment');
const postRoutes = require('./routes/posts');
const subscriptionRoutes = require('./routes/subscription');
const surveyRoutes = require('./routes/survey');
const chatRoutes = require('./routes/chat');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/address', addressRoutes);
app.use('/api/coupon', couponRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/chat', chatRoutes);

// List all routes
function listRoutes(app) {
  const routes = [];
  
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Direct route
      const methods = Object.keys(middleware.route.methods);
      methods.forEach(method => {
        routes.push({
          method: method.toUpperCase(),
          path: middleware.route.path
        });
      });
    } else if (middleware.name === 'router') {
      // Router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods);
          methods.forEach(method => {
            routes.push({
              method: method.toUpperCase(),
              path: middleware.regexp.source.replace('\\/?', '').replace('(?=\\/|$)', '') + handler.route.path
            });
          });
        }
      });
    }
  });
  
  return routes;
}

console.log('🔍 Checking routes...\n');
const routes = listRoutes(app);
console.log(`Found ${routes.length} routes:\n`);
routes.forEach(route => {
  console.log(`  ${route.method.padEnd(6)} ${route.path}`);
});

