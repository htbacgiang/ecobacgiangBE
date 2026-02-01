#!/usr/bin/env node

/**
 * Script để tạo file .env cho Backend
 * Chạy: node create-env.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createEnv() {
  console.log('🔧 Tạo file .env cho Backend\n');

  // Hỏi thông tin
  const port = await question('Nhập Port (mặc định: 5000): ') || '5000';
  const nodeEnv = await question('Nhập NODE_ENV (mặc định: production): ') || 'production';
  
  console.log('\n📝 Nhập danh sách các domain được phép gọi API (CORS)');
  console.log('   Ví dụ: https://ecobacgiang.vn,https://www.ecobacgiang.vn');
  const allowedOrigins = await question('ALLOWED_ORIGINS: ');
  
  const mongodbUri = await question('Nhập MongoDB URI (mặc định: mongodb://localhost:27017/ecobacgiang): ') || 'mongodb://localhost:27017/ecobacgiang';
  
  // Tạo nội dung file
  const envContent = `# ============================================
# ECOBACGIANG BACKEND - ENVIRONMENT CONFIG
# ============================================

# Server Port
PORT=${port}

# Environment
NODE_ENV=${nodeEnv}

# ============================================
# CORS CONFIGURATION (QUAN TRỌNG!)
# ============================================
# Danh sách các domain được phép gọi API
# Phải có https:// hoặc http:// đầy đủ
# Không có dấu cách sau dấu phẩy
ALLOWED_ORIGINS=${allowedOrigins}

# ============================================
# DATABASE CONFIGURATION
# ============================================
# MongoDB Connection String
MONGODB_URI=${mongodbUri}

# ============================================
# EMAIL CONFIGURATION (Gmail App Password)
# ============================================
# Cấu hình để gửi email OTP cho đăng ký
# Hướng dẫn tạo App Password: https://support.google.com/accounts/answer/185833
SENDER_EMAIL_ADDRESS=your-email@gmail.com
SENDER_EMAIL_PASSWORD=your-16-digit-app-password
`;

  // Ghi file
  const envPath = path.join(__dirname, '.env');
  
  try {
    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Đã tạo file .env thành công!');
    console.log(`📁 Vị trí: ${envPath}\n`);
    console.log('📝 Các bước tiếp theo:');
    console.log('   1. Kiểm tra lại nội dung file .env');
    console.log('   2. Điền thông tin email nếu cần gửi OTP');
    console.log('   3. Restart backend: pm2 restart ecobacgiang-be\n');
  } catch (error) {
    console.error('❌ Lỗi khi tạo file:', error.message);
    process.exit(1);
  }

  rl.close();
}

// Chạy script
createEnv().catch(error => {
  console.error('❌ Lỗi:', error);
  process.exit(1);
});

