// List all available routes for debugging
const routes = {
  'GET /health': 'Health check endpoint',
  'GET /api/products': 'Get all products',
  'GET /api/products/:slug': 'Get product by slug',
  'POST /api/products': 'Create product',
  'POST /api/products/check-slug': 'Check slug availability',
  'PUT /api/products/:id': 'Update product',
  'DELETE /api/products/:id': 'Delete product',
  'POST /api/auth/signup': 'User signup',
  'POST /api/auth/signin': 'User signin',
  'POST /api/auth/verify-email-otp': 'Verify email OTP',
  'POST /api/auth/resend-email-otp': 'Resend email OTP',
  'GET /api/user/me': 'Get current user (requires auth)',
  'GET /api/user/:userId': 'Get user by ID',
  'PUT /api/user/:userId': 'Update user (requires auth)',
  'GET /api/cart': 'Get cart (query: ?userId=xxx)',
  'POST /api/cart': 'Add to cart',
  'PUT /api/cart/:userId/:productId': 'Update cart item',
  'DELETE /api/cart/:userId/:productId': 'Remove from cart',
  'GET /api/orders': 'Get orders (requires auth)',
  'GET /api/orders/:id': 'Get order by ID (requires auth)',
  'POST /api/checkout': 'Create order (requires auth)',
  'GET /api/wishlist': 'Get wishlist (requires auth)',
  'POST /api/wishlist/:productId': 'Add to wishlist (requires auth)',
  'DELETE /api/wishlist/:productId': 'Remove from wishlist (requires auth)',
  'GET /api/address': 'Get addresses (requires auth)',
  'POST /api/address': 'Add address (requires auth)',
  'PUT /api/address/:index': 'Update address (requires auth)',
  'DELETE /api/address/:index': 'Delete address (requires auth)',
  'GET /api/coupon': 'Get coupons or validate (query: ?code=xxx)',
  'POST /api/subscription': 'Subscribe email',
  'POST /api/subscription/unsubscribe': 'Unsubscribe email',
  'POST /api/survey': 'Submit survey',
  'POST /api/contact': 'Submit contact form',
  'GET /api/contact': 'Get contacts (Admin only)',
  'PUT /api/contact/:id/status': 'Update contact status (Admin only)',
  'GET /api/posts': 'Get all posts',
  'GET /api/posts/:postId': 'Get post by ID',
  'POST /api/chat': 'Chat endpoint',
  'GET /api/payment/methods': 'Get payment methods'
};

console.log('📋 Available API Routes:');
console.log('========================\n');

Object.entries(routes).forEach(([route, description]) => {
  console.log(`${route.padEnd(40)} - ${description}`);
});

console.log('\n💡 Note: Routes marked "requires auth" need Authorization header:');
console.log('   Authorization: Bearer <token>\n');

module.exports = routes;

