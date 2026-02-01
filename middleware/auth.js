const jwt = require('jsonwebtoken');

/**
 * Middleware để verify JWT token và lấy userId
 * Sử dụng cho mobile app authentication
 */
const verifyToken = (req) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { error: 'Token không được cung cấp', userId: null };
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'fallback-secret-key-for-development'
    );

    if (!decoded || !decoded.id) {
      return { error: 'Token không hợp lệ', userId: null };
    }

    return { error: null, userId: decoded.id, user: decoded };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { error: 'Token đã hết hạn', userId: null };
    }
    return { error: 'Token không hợp lệ', userId: null };
  }
};

/**
 * Middleware để bảo vệ API route với JWT authentication
 */
const withAuth = (req, res, next) => {
  const { error, userId, user } = verifyToken(req);

  if (error || !userId) {
    return res.status(401).json({ 
      status: 'error',
      message: error || 'Unauthorized' 
    });
  }

  // Thêm userId và user vào request để handler có thể sử dụng
  req.userId = userId;
  req.user = user;

  next();
};

/**
 * Optional auth middleware - không bắt buộc phải có token
 * Nhưng nếu có token thì sẽ verify và thêm vào request
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { error, userId, user } = verifyToken(req);
    if (!error && userId) {
      req.userId = userId;
      req.user = user;
    }
  }
  
  next();
};

module.exports = {
  verifyToken,
  withAuth,
  optionalAuth
};

