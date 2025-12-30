const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const db = require('../config/database');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmails');

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Email template for OTP verification
const otpEmailTemplate = (otp) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background-color: #009934;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 5px 5px 0 0;
        }
        .content {
          background-color: #f9f9f9;
          padding: 30px;
          border-radius: 0 0 5px 5px;
        }
        .otp-box {
          background-color: white;
          border: 2px solid #009934;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
        }
        .otp-code {
          font-size: 32px;
          font-weight: bold;
          color: #009934;
          letter-spacing: 5px;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          color: #666;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Mã Xác Nhận Đăng Ký</h1>
        </div>
        <div class="content">
          <p>Xin chào,</p>
          <p>Cảm ơn bạn đã đăng ký tài khoản tại Eco Bắc Giang.</p>
          <p>Vui lòng sử dụng mã OTP sau để xác nhận email của bạn:</p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <p>Mã OTP này có hiệu lực trong <strong>10 phút</strong>.</p>
          <p>Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email này.</p>
          <div class="footer">
            <p>Trân trọng,<br>Đội ngũ EcoBacGiang</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    console.log('Starting registration process...');

    const { name, email, password, conf_password, phone, agree } = req.body;

    // Validation
    if (!name || !email || !phone || !password || !conf_password) {
      return res.status(400).json({ message: 'Vui lòng điền hết các trường.' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'Địa chỉ email không hợp lệ.' });
    }
    if (password !== conf_password) {
      return res.status(400).json({ message: 'Mật khẩu không khớp.' });
    }
    if (agree !== true) {
      return res.status(400).json({
        message: 'Bạn phải đồng ý với Điều khoản & Chính sách bảo mật.',
      });
    }
    if (!/^\d{10,11}$/.test(phone)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ (10-11 chữ số).' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
    }

    await db.connectDb();
    console.log('DB connected');

    // Check if email or phone already exists
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: 'Địa chỉ email đã tồn tại.' });
    }
    if (await User.findOne({ phone })) {
      return res.status(400).json({ message: 'Số điện thoại đã được đăng ký.' });
    }

    // Hash password
    const cryptedPassword = await bcrypt.hash(password, 12);

    // Create new user
    const newUser = new User({
      name,
      email,
      phone,
      password: cryptedPassword,
      agree,
    });
    const addedUser = await newUser.save();
    console.log('User added to the database');

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to user
    addedUser.emailVerificationOTP = otp;
    addedUser.emailVerificationOTPExpiry = otpExpiry;
    addedUser.emailVerificationSentAt = new Date();
    await addedUser.save();

    // Send email with OTP
    try {
      await sendEmail(
        email,
        '',
        '',
        'Mã Xác Nhận Đăng Ký - EcoBacGiang',
        otpEmailTemplate(otp)
      );
    } catch (emailError) {
      console.error('Error sending email:', emailError);
    }

    return res.status(200).json({
      message: 'Đăng ký thành công! Mã xác nhận đã được gửi đến email của bạn.',
    });
  } catch (error) {
    console.error('Error:', error.stack || error.message);
    return res.status(500).json({ message: 'Đã xảy ra lỗi trong quá trình đăng ký.' });
  }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
  try {
    await db.connectDb();

    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        message: 'Vui lòng điền đầy đủ email và mật khẩu.',
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(400).json({
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(400).json({
        message: 'Tài khoản chưa được kích hoạt. Vui lòng kiểm tra email để kích hoạt tài khoản.',
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'fallback-secret-key-for-development',
      {
        expiresIn: '30d',
      }
    );

    // Prepare user data (exclude password)
    const userData = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      image: user.image,
      emailVerified: user.emailVerified,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
    };

    return res.status(200).json({
      status: true,
      message: 'Đăng nhập thành công.',
      user: userData,
      token: token,
    });
  } catch (error) {
    console.error('Signin error:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi đăng nhập.',
    });
  }
});

// POST /api/auth/verify-email-otp
router.post('/verify-email-otp', async (req, res) => {
  try {
    await db.connectDb();

    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        message: 'Vui lòng điền đầy đủ email và mã OTP.',
      });
    }

    // Normalize email (lowercase, trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(400).json({ message: 'Email không tồn tại trong hệ thống.' });
    }

    // Check if email already verified
    if (user.emailVerified) {
      return res.status(400).json({
        message: 'Email đã được xác nhận trước đó.',
      });
    }

    // Check if OTP exists
    if (!user.emailVerificationOTP) {
      return res.status(400).json({
        message: 'Không tìm thấy mã OTP. Vui lòng yêu cầu mã OTP mới.',
      });
    }

    // Check if OTP matches
    if (user.emailVerificationOTP !== otp) {
      return res.status(400).json({ message: 'Mã OTP không đúng.' });
    }

    // Check if OTP is expired
    if (!user.emailVerificationOTPExpiry || new Date() > user.emailVerificationOTPExpiry) {
      // Clear expired OTP
      user.emailVerificationOTP = undefined;
      user.emailVerificationOTPExpiry = undefined;
      await user.save();
      return res.status(400).json({
        message: 'Mã OTP đã hết hạn. Vui lòng yêu cầu mã OTP mới.',
      });
    }

    // Verify email and clear OTP
    user.emailVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;
    await user.save();

    return res.status(200).json({
      status: true,
      message: 'Xác nhận email thành công! Bạn có thể đăng nhập ngay.',
    });
  } catch (error) {
    console.error('Verify email OTP error:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi xác nhận email.',
    });
  }
});

// POST /api/auth/resend-email-otp
router.post('/resend-email-otp', async (req, res) => {
  try {
    await db.connectDb();

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Vui lòng cung cấp email.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(400).json({ message: 'Email không tồn tại trong hệ thống.' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email đã được xác nhận trước đó.' });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.emailVerificationOTP = otp;
    user.emailVerificationOTPExpiry = otpExpiry;
    user.emailVerificationSentAt = new Date();
    await user.save();

    // Send email
    try {
      await sendEmail(
        email,
        '',
        '',
        'Mã Xác Nhận Đăng Ký - EcoBacGiang',
        otpEmailTemplate(otp)
      );
    } catch (emailError) {
      console.error('Error sending email:', emailError);
    }

    return res.status(200).json({
      status: true,
      message: 'Mã OTP mới đã được gửi đến email của bạn.',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi gửi lại mã OTP.',
    });
  }
});

// POST /api/auth/change-password - Change password
router.post('/change-password', async (req, res) => {
  try {
    await db.connectDb();

    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Validate input
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message: 'Vui lòng điền đầy đủ các trường.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'Mật khẩu mới phải có ít nhất 6 ký tự.',
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        message: 'Mật khẩu xác nhận không khớp.',
      });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({
        message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
      });
    }

    // Verify token and get user
    if (!token) {
      return res.status(401).json({
        message: 'Vui lòng đăng nhập để đổi mật khẩu.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        token,
        process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'fallback-secret-key-for-development'
      );
    } catch (jwtError) {
      return res.status(401).json({
        message: 'Token không hợp lệ hoặc đã hết hạn.',
      });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({
        message: 'Người dùng không tồn tại.',
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: 'Mật khẩu hiện tại không đúng.',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({
      status: 'success',
      message: 'Đổi mật khẩu thành công!',
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi đổi mật khẩu.',
    });
  }
});

module.exports = router;

