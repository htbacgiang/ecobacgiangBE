const nodemailer = require('nodemailer');

const {
  SENDER_EMAIL_ADDRESS,
  SENDER_EMAIL_PASSWORD,
} = process.env;

// Chuẩn hóa: trim và bỏ hết khoảng trắng trong App Password (Gmail hiển thị dạng "xxxx xxxx xxxx xxxx")
const normalizedEmail = (SENDER_EMAIL_ADDRESS || '').trim();
const normalizedPassword = (SENDER_EMAIL_PASSWORD || '').replace(/\s/g, '').trim();

// Validate email configuration
if (!normalizedEmail || !normalizedPassword) {
  console.error("❌ EMAIL CONFIGURATION ERROR:");
  console.error("Missing required environment variables:");
  if (!normalizedEmail) {
    console.error("  - SENDER_EMAIL_ADDRESS is not set or empty");
  }
  if (!normalizedPassword) {
    console.error("  - SENDER_EMAIL_PASSWORD is not set or empty (App Password 16 ký tự, có thể bỏ dấu cách)");
  }
  console.error("\n📝 Please add these to your .env file:");
  console.error("   SENDER_EMAIL_ADDRESS=your-email@gmail.com");
  console.error("   SENDER_EMAIL_PASSWORD=your-16-digit-app-password");
  console.error("\n📖 See HUONG_DAN_CAU_HINH_EMAIL_APP_PASSWORD.md for instructions\n");
}

// Send email using App Password
const sendEmail = (to, url, txt, subject, template) => {
  if (!normalizedEmail || !normalizedPassword) {
    const error = new Error(
      "Email configuration is missing. Please set SENDER_EMAIL_ADDRESS and SENDER_EMAIL_PASSWORD in your .env file."
    );
    console.error("Error sending email:", error.message);
    return Promise.reject(error);
  }

  const smtpTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: normalizedEmail,
      pass: normalizedPassword,
    },
  });

  // Use custom template if provided
  const htmlContent = template || `
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>${subject}</h2>
      <p>${txt}</p>
      ${url ? `<a href="${url}">${url}</a>` : ''}
    </div>
  `;

  const mailOptions = {
    from: normalizedEmail,
    to: to,
    subject: subject || 'EcoBacGiang',
    html: htmlContent,
  };

  return new Promise((resolve, reject) => {
    smtpTransport.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('Error sending email:', err);
        reject(err);
      } else {
        console.log('Email sent successfully:', info);
        resolve(info);
      }
    });
  });
};

module.exports = { sendEmail };

