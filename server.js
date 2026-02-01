const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

// Import database connection
const db = require('./config/database');

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
const imageRoutes = require('./routes/image');
const accountingRoutes = require('./routes/accounting');
const contactRoutes = require('./routes/contact');
const promoBannerRoutes = require('./routes/promo-banner');
const recruitmentRoutes = require('./routes/recruitment');
const sepayWebhookRealRoutes = require('./routes/sepay-webhook-real');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: '/api/socket',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// Make io available globally for routes
global.io = io;

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  socket.on('join_payment', (paymentCode) => {
    socket.join(paymentCode);
    console.log(`📦 Socket ${socket.id} joined payment room: ${paymentCode}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// Middleware
app.use(morgan('dev'));
// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Cho phép requests không có origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ CORS: Allowing request without origin (mobile app/Postman)');
      return callback(null, true);
    }
    
    // Cho phép tất cả origins trong development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`✅ CORS: Allowing origin in development: ${origin}`);
      return callback(null, true);
    }
    
    // Trong production, kiểm tra allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
    
    // Nếu có '*' trong allowed origins, cho phép tất cả
    if (allowedOrigins.includes('*')) {
      console.log(`✅ CORS: Allowing origin (wildcard): ${origin}`);
      return callback(null, true);
    }
    
    // Kiểm tra exact match
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ CORS: Allowing origin (exact match): ${origin}`);
      return callback(null, true);
    }
    
    // Kiểm tra domain match (ví dụ: *.ecobacgiang.vn)
    const domainMatch = allowedOrigins.some(allowed => {
      if (allowed.startsWith('*.')) {
        const domain = allowed.substring(2);
        return origin.endsWith('.' + domain) || origin === domain;
      }
      return false;
    });
    
    if (domainMatch) {
      console.log(`✅ CORS: Allowing origin (domain match): ${origin}`);
      return callback(null, true);
    }
    
    // Cho phép localhost và IP addresses trong development hoặc nếu không có ALLOWED_ORIGINS
    if (allowedOrigins.length === 0) {
      // Nếu không có ALLOWED_ORIGINS được set, cho phép tất cả trong development
      // Nhưng trong production, nên set ALLOWED_ORIGINS
      if (process.env.NODE_ENV === 'production') {
        console.warn(`⚠️ CORS: No ALLOWED_ORIGINS set in production. Allowing all origins (not recommended).`);
      }
      console.log(`✅ CORS: Allowing origin (no restrictions): ${origin}`);
      return callback(null, true);
    }
    
    // Cho phép localhost và IP addresses (cho development và testing)
    if (origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(origin)) {
      console.log(`✅ CORS: Allowing origin (localhost/IP): ${origin}`);
      return callback(null, true);
    }
    
    // Cho phép các domain có cùng base domain (ví dụ: ecobacgiang.vn và www.ecobacgiang.vn)
    const originHost = new URL(origin).hostname;
    const baseDomainMatch = allowedOrigins.some(allowed => {
      try {
        const allowedHost = new URL(allowed).hostname;
        // Kiểm tra cùng domain (ví dụ: ecobacgiang.vn và www.ecobacgiang.vn)
        const originParts = originHost.split('.');
        const allowedParts = allowedHost.split('.');
        if (originParts.length >= 2 && allowedParts.length >= 2) {
          const originDomain = originParts.slice(-2).join('.');
          const allowedDomain = allowedParts.slice(-2).join('.');
          return originDomain === allowedDomain;
        }
      } catch (e) {
        // Ignore URL parse errors
      }
      return false;
    });
    
    if (baseDomainMatch) {
      console.log(`✅ CORS: Allowing origin (same domain): ${origin}`);
      return callback(null, true);
    }
    
    console.warn(`❌ CORS: Blocked origin: ${origin}`);
    console.warn(`   Allowed origins: ${allowedOrigins.join(', ') || 'none'}`);
    console.warn(`   Current origin host: ${originHost}`);
    callback(new Error(`Not allowed by CORS. Origin: ${origin}. Please add it to ALLOWED_ORIGINS in .env`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'EcoBacGiang API Server is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
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
app.use('/api/image', imageRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/promo-banner', promoBannerRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/sepay-webhook-real', sepayWebhookRealRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    status: 'error', 
    message: 'Route not found' 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Connect to database and start server
db.connectDb()
  .then(() => {
    // Listen on all interfaces (0.0.0.0) để mobile app có thể kết nối
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
      console.log(`📱 Mobile API URL: http://10.0.2.2:${PORT}/api (Android Emulator)`);
      console.log(`🔌 Socket.IO path: /api/socket`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✅ CORS enabled for all origins in development mode`);
    });
  })
  .catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });

module.exports = app;

