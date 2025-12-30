const express = require('express');
const router = express.Router();
const db = require('../config/database');
const SepayPayment = require('../models/SepayPayment');
const MomoPayment = require('../models/MomoPayment');
const crypto = require('crypto');
const { withAuth } = require('../middleware/auth');

// Thông tin tài khoản nhận tiền (CẬP NHẬT THEO THÔNG TIN THẬT CỦA BẠN)
const BANK_INFO = {
  bankId: process.env.SEPAY_BANK_ID || "TPB", // TPBank
  accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || "03924302701",
  accountName: process.env.SEPAY_ACCOUNT_NAME || "NGO QUANG TRUONG",
  description: process.env.SEPAY_DESCRIPTION || "Thanh toan don hang Eco Bac Giang"
};

// Function tạo VietQR theo chuẩn chính xác của VietQR.io
function createVietQR(paymentCode, amount, description = null) {
  const bankId = BANK_INFO.bankId;
  const accountNo = BANK_INFO.accountNumber;
  const accountName = BANK_INFO.accountName;
  // Sử dụng description từ tham số nếu có, nếu không thì dùng mặc định
  const transferDescription = description || BANK_INFO.description;

  const cleanAmount = Math.round(amount);
  const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${cleanAmount}&addInfo=${encodeURIComponent(transferDescription)}&accountName=${encodeURIComponent(accountName)}`;

  console.log("=== VIETQR CREATION ===");
  console.log(`Bank ID: ${bankId}`);
  console.log(`Account: ${accountNo}`);
  console.log(`Amount: ${cleanAmount}`);
  console.log(`Description: ${transferDescription}`);
  console.log(`QR URL: ${qrUrl}`);
  console.log("=======================");

  return qrUrl;
}

// Hàm tạo signature cho MoMo
function createMomoSignature(data, secretKey) {
  const signatureString = `accessKey=${data.accessKey}&amount=${data.amount}&extraData=${data.extraData}&ipnUrl=${data.ipnUrl}&orderId=${data.orderId}&orderInfo=${data.orderInfo}&partnerCode=${data.partnerCode}&redirectUrl=${data.redirectUrl}&requestId=${data.requestId}&requestType=${data.requestType}`;
  
  const signature = crypto.createHmac('sha256', secretKey)
    .update(signatureString)
    .digest('hex');
  
  return signature;
}

// POST /api/payment/sepay - Create Sepay payment
router.post('/sepay', withAuth, async (req, res) => {
  try {
    await db.connectDb();

    const { amount, orderInfo } = req.body;
    const userId = req.userId;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Số tiền không hợp lệ" });
    }

    // Tạo payment code unique
    const paymentCode = `ECOBG-${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Tạo QR URL với orderInfo nếu có
    const transferDescription = orderInfo || BANK_INFO.description;
    const qrUrl = createVietQR(paymentCode, amount, transferDescription);

    // Lưu payment vào database
    const payment = new SepayPayment({
      paymentCode,
      amount: Math.round(amount),
      userId,
      sepayData: {
        bankInfo: BANK_INFO,
        qrUrl,
        orderInfo: orderInfo || {}
      }
    });

    await payment.save();

    console.log("=== PAYMENT CREATED ===");
    console.log(`Payment Code: ${paymentCode}`);
    console.log(`Amount: ${amount}`);
    console.log(`QR URL: ${qrUrl}`);
    console.log(`Expires At: ${payment.expiresAt}`);
    console.log("=======================");

    // Response
    return res.status(200).json({
      success: true,
      paymentCode,
      qrUrl,
      amount: Math.round(amount),
      expiresAt: payment.expiresAt,
      bankInfo: BANK_INFO,
      message: "Payment created successfully"
    });

  } catch (error) {
    console.error("Create Sepay Payment Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

// POST /api/payment/momo - Create MoMo payment
router.post('/momo', withAuth, async (req, res) => {
  try {
    await db.connectDb();

    const { amount, orderInfo = "Thanh toan don hang" } = req.body;
    const userId = req.userId;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Số tiền không hợp lệ" });
    }

    if (!process.env.MOMO_PARTNER_CODE || !process.env.MOMO_ACCESS_KEY || !process.env.MOMO_SECRET_KEY) {
      return res.status(500).json({ error: "Cấu hình MoMo chưa hoàn tất" });
    }

    // Tạo payment code unique
    const paymentCode = `MOMO-${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Xác định callback URL
    const baseUrl = process.env.NEXTAUTH_URL || 
                   (process.env.NODE_ENV === 'production' 
                     ? 'https://ecobacgiang.vn' 
                     : 'http://localhost:3000');
    
    const callbackUrl = `${baseUrl}/api/momo-callback`;
    const redirectUrl = `${baseUrl}/checkout/success`;

    // Tạo request data cho MoMo
    const requestData = {
      partnerCode: process.env.MOMO_PARTNER_CODE,
      accessKey: process.env.MOMO_ACCESS_KEY,
      requestId: paymentCode,
      amount: Math.round(amount),
      orderId: paymentCode,
      orderInfo: orderInfo,
      redirectUrl: redirectUrl,
      ipnUrl: callbackUrl,
      requestType: "captureWallet",
      extraData: JSON.stringify({ userId }),
      signature: ""
    };

    // Tạo signature
    const signature = createMomoSignature(requestData, process.env.MOMO_SECRET_KEY);
    requestData.signature = signature;

    console.log('Creating MoMo payment with data:', requestData);

    // Gọi API MoMo
    const momoResponse = await fetch("https://test-payment.momo.vn/v2/gateway/api/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
    });

    if (!momoResponse.ok) {
      const errorData = await momoResponse.text();
      console.error("MoMo API Error:", errorData);
      return res.status(500).json({ 
        error: "Không thể tạo phiếu thanh toán MoMo",
        details: errorData 
      });
    }

    const momoData = await momoResponse.json();

    if (momoData.resultCode !== 0) {
      return res.status(500).json({ 
        error: "MoMo trả về lỗi",
        resultCode: momoData.resultCode,
        message: momoData.message 
      });
    }

    // Lưu thông tin thanh toán vào database
    const payment = new MomoPayment({
      paymentCode,
      status: "pending",
      amount: Math.round(amount),
      userId,
      momoData: momoData,
      requestData: requestData,
      payUrl: momoData.payUrl,
      deeplink: momoData.deeplink,
      qrCodeUrl: momoData.qrCodeUrl,
    });

    await payment.save();

    return res.status(200).json({
      success: true,
      paymentCode,
      payUrl: momoData.payUrl,
      deeplink: momoData.deeplink,
      qrCodeUrl: momoData.qrCodeUrl,
      amount: Math.round(amount),
      expiresAt: payment.expiresAt,
    });

  } catch (error) {
    console.error("Create MoMo Payment Error:", error);
    return res.status(500).json({ 
      error: "Lỗi server khi tạo thanh toán",
      message: error.message 
    });
  }
});

// GET /api/payment/sepay/status - Check Sepay payment status
router.get('/sepay/status', withAuth, async (req, res) => {
  try {
    await db.connectDb();

    const { paymentCode } = req.query;

    if (!paymentCode) {
      return res.status(400).json({ error: "Missing paymentCode" });
    }

    // Tìm payment trong database
    const payment = await SepayPayment.findOne({ paymentCode });

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        paymentCode
      });
    }

    // Kiểm tra nếu payment đã hết hạn
    const isExpired = payment.expiresAt && new Date() > payment.expiresAt;
    if (isExpired && payment.status === 'pending') {
      payment.status = 'expired';
      await payment.save();
    }

    return res.status(200).json({
      success: true,
      payment: {
        paymentCode: payment.paymentCode,
        status: payment.status,
        amount: payment.amount,
        userId: payment.userId,
        createdAt: payment.createdAt,
        expiresAt: payment.expiresAt,
        paidAt: payment.paidAt,
        transactionId: payment.transactionId,
        isExpired: isExpired
      }
    });

  } catch (error) {
    console.error("Check Sepay Status Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

// POST /api/payment/sepay/refresh - Refresh Sepay QR code
router.post('/sepay/refresh', withAuth, async (req, res) => {
  try {
    await db.connectDb();

    const { paymentCode } = req.body;

    if (!paymentCode) {
      return res.status(400).json({ error: "Missing paymentCode" });
    }

    // Tìm payment trong database
    const payment = await SepayPayment.findOne({ paymentCode });

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        paymentCode
      });
    }

    // Kiểm tra trạng thái payment
    if (payment.status !== "pending") {
      return res.status(400).json({
        error: "Payment is not in pending status",
        status: payment.status
      });
    }

    // Lấy orderInfo từ payment đã lưu hoặc dùng mặc định
    const orderInfo = payment.sepayData?.orderInfo || BANK_INFO.description;

    // Tạo QR mới với cùng orderInfo
    const newQrUrl = createVietQR(paymentCode, payment.amount, orderInfo);

    // Cập nhật expires time (30 phút)
    const newExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Cập nhật payment trong database
    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode },
      {
        expiresAt: newExpiresAt,
        'sepayData.qrUrl': newQrUrl,
        'sepayData.refreshedAt': new Date(),
        'sepayData.refreshCount': ((payment.sepayData?.refreshCount || 0) + 1)
      },
      { new: true }
    );

    console.log("=== QR REFRESHED SUCCESSFULLY ===");
    console.log(`Payment Code: ${paymentCode}`);
    console.log(`New QR URL: ${newQrUrl}`);
    console.log(`New Expires At: ${newExpiresAt}`);
    console.log("=================================");

    return res.status(200).json({
      success: true,
      paymentCode,
      qrUrl: newQrUrl,
      expiresAt: newExpiresAt,
      amount: payment.amount,
      message: "QR code refreshed successfully"
    });

  } catch (error) {
    console.error("Refresh Sepay QR Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

// POST /api/payment/sepay/confirm - Manually confirm Sepay payment
router.post('/sepay/confirm', withAuth, async (req, res) => {
  try {
    await db.connectDb();

    const { paymentCode, amount } = req.body;
    const userId = req.userId;

    if (!paymentCode) {
      return res.status(400).json({ error: "Missing paymentCode" });
    }

    console.log("=== MANUAL PAYMENT CONFIRMATION ===");
    console.log(`Payment Code: ${paymentCode}`);
    console.log(`User ID: ${userId}`);
    console.log(`Amount (optional): ${amount}`);

    // Tìm payment trong database
    let payment = await SepayPayment.findOne({ paymentCode });

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        paymentCode
      });
    }

    // Kiểm tra quyền: chỉ user tạo payment mới được confirm
    if (payment.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        error: "Unauthorized: You can only confirm your own payments"
      });
    }

    // Kiểm tra trạng thái
    if (payment.status === 'paid') {
      return res.status(400).json({
        error: "Payment already confirmed",
        paymentCode,
        paidAt: payment.paidAt
      });
    }

    if (payment.status === 'expired' || payment.status === 'cancelled') {
      return res.status(400).json({
        error: `Cannot confirm payment with status: ${payment.status}`
      });
    }

    // Nếu có amount, kiểm tra khớp
    if (amount && Math.abs(payment.amount - amount) > 1000) {
      console.warn(`⚠️ Amount mismatch: expected ${payment.amount}, got ${amount}`);
      // Vẫn cho phép confirm nhưng log warning
    }

    // Cập nhật payment status
    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode },
      {
        status: "paid",
        paidAt: new Date(),
        transactionId: `manual_${Date.now()}`,
        'sepayData.confirmedBy': userId,
        'sepayData.confirmedAt': new Date().toISOString(),
        'sepayData.confirmationSource': 'manual'
      },
      { new: true }
    );

    console.log("✅ Payment confirmed manually:", updatedPayment.paymentCode);

    // Emit socket event để notify frontend
    if (global.io) {
      global.io.to(updatedPayment.paymentCode).emit('payment_paid', {
        paymentCode: updatedPayment.paymentCode,
        amount: updatedPayment.amount,
        status: updatedPayment.status,
        paidAt: updatedPayment.paidAt,
        transactionId: updatedPayment.transactionId
      });
      console.log(`📡 Socket event emitted to room: ${updatedPayment.paymentCode}`);
    }

    return res.status(200).json({
      success: true,
      message: "Payment confirmed successfully",
      payment: {
        paymentCode: updatedPayment.paymentCode,
        status: updatedPayment.status,
        amount: updatedPayment.amount,
        paidAt: updatedPayment.paidAt,
        transactionId: updatedPayment.transactionId
      }
    });

  } catch (error) {
    console.error("Manual Confirm Payment Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

// POST /api/payment/sepay/webhook - Sepay webhook callback
// 
// LƯU Ý QUAN TRỌNG VỀ WEBHOOK:
// - Sepay webhook CẦN domain thật (public URL) để hoạt động
// - Khi chạy local (localhost), webhook KHÔNG THỂ hoạt động vì Sepay không thể gọi về localhost
// 
// GIẢI PHÁP:
// 1. Development (Local): Dùng nút "Đã chuyển khoản" để manually confirm (không cần webhook)
// 2. Development (Local với testing): Dùng ngrok để expose local server:
//    - Cài: npm install -g ngrok
//    - Chạy: ngrok http 5000
//    - Copy URL (ví dụ: https://abc123.ngrok.io) và config trong Sepay dashboard
// 3. Production: Deploy lên server có domain thật và config webhook URL trong Sepay dashboard
//
// Webhook URL format: https://yourdomain.com/api/payment/sepay/webhook
router.post('/sepay/webhook', async (req, res) => {
  try {
    await db.connectDb();

    const webhookData = req.body;
    const {
      gateway,
      transactionDate,
      accountNumber,
      transferType,
      transferAmount,
      amount,
      referenceCode,
      description,
      transactionId,
    } = webhookData;

    console.log("=== SEPAY WEBHOOK RECEIVED ===");
    console.log("Webhook Data:", JSON.stringify(webhookData, null, 2));
    console.log("Timestamp:", new Date().toISOString());

    const webhookAmount = transferAmount || amount;
    
    // Nếu không có referenceCode, vẫn có thể tìm theo amount và thời gian
    if (!webhookAmount) {
      return res.status(400).json({
        error: "Missing required field: amount",
        received: webhookData
      });
    }

    let payment = null;

    // Nếu có referenceCode, tìm theo referenceCode trước
    if (referenceCode) {
      console.log(`🔍 Searching payment by referenceCode: ${referenceCode}`);
      payment = await SepayPayment.findOne({
        paymentCode: referenceCode,
        status: "pending"
      });

      if (payment) {
        console.log(`✅ Found payment by referenceCode: ${payment.paymentCode}`);
      } else {
        console.log(`❌ No payment found with referenceCode: ${referenceCode}`);
      }
    }

    // Nếu không tìm thấy, tìm theo amount và thời gian gần đây
    if (!payment) {
      console.log(`🔍 Searching payment by amount: ${webhookAmount}`);
      
      // Tìm các payment pending trong vòng 2 giờ gần đây
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recentPayments = await SepayPayment.find({
        status: "pending",
        amount: { $gte: webhookAmount - 1000, $lte: webhookAmount + 1000 }, // Cho phép sai số 1000 VND
        createdAt: { $gte: twoHoursAgo }
      }).sort({ createdAt: -1 }).limit(10);

      console.log(`📊 Found ${recentPayments.length} recent pending payments with similar amount`);

      // Tìm payment khớp nhất (sai số nhỏ nhất)
      if (recentPayments.length > 0) {
        payment = recentPayments.reduce((best, current) => {
          const bestDiff = Math.abs(best.amount - webhookAmount);
          const currentDiff = Math.abs(current.amount - webhookAmount);
          return currentDiff < bestDiff ? current : best;
        });

        const amountDiff = Math.abs(payment.amount - webhookAmount);
        console.log(`✅ Found matching payment: ${payment.paymentCode}, amount diff: ${amountDiff}`);
        
        // Nếu sai số quá lớn (> 5000 VND), không match
        if (amountDiff > 5000) {
          console.warn(`⚠️ Amount difference too large (${amountDiff}), rejecting match`);
          payment = null;
        }
      }
    }

    if (!payment) {
      console.error("❌ Payment not found for webhook:", {
        referenceCode,
        amount: webhookAmount,
        webhookData
      });
      
      // Log tất cả pending payments để debug
      const allPending = await SepayPayment.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('paymentCode amount createdAt expiresAt');
      console.log("📋 Recent pending payments:", allPending);

      return res.status(404).json({
        error: "Payment not found",
        referenceCode: referenceCode || "N/A",
        amount: webhookAmount,
        suggestion: "Please check if payment code matches or use manual confirmation endpoint"
      });
    }

    // Cập nhật payment status
    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode: payment.paymentCode },
      {
        status: "paid",
        paidAt: new Date(),
        transactionId: transactionId || `sepay_${Date.now()}`,
        'sepayData.callbackData': {
          receivedAt: new Date().toISOString(),
          source: "webhook",
          ...webhookData
        }
      },
      { new: true }
    );

    console.log("✅ Payment updated via webhook:", updatedPayment.paymentCode);
    console.log(`💰 Amount: ${updatedPayment.amount}, Status: ${updatedPayment.status}`);

    // Emit socket event để notify frontend
    if (global.io) {
      global.io.to(updatedPayment.paymentCode).emit('payment_paid', {
        paymentCode: updatedPayment.paymentCode,
        amount: updatedPayment.amount,
        status: updatedPayment.status,
        paidAt: updatedPayment.paidAt,
        transactionId: updatedPayment.transactionId
      });
      console.log(`📡 Socket event emitted to room: ${updatedPayment.paymentCode}`);
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      paymentCode: updatedPayment.paymentCode,
      status: updatedPayment.status
    });

  } catch (error) {
    console.error("Sepay Webhook Error:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

// GET /api/payment/methods - Get available payment methods
router.get('/methods', (req, res) => {
  res.json({
    methods: ['COD', 'BankTransfer', 'Sepay', 'MoMo'],
  });
});

module.exports = router;
