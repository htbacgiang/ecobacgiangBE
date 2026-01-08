const express = require('express');
const router = express.Router();
const db = require('../config/database');
const SepayPayment = require('../models/SepayPayment');
const MomoPayment = require('../models/MomoPayment');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const { normalizeUnit } = require('../utils/normalizeUnit');
const crypto = require('crypto');
const { withAuth } = require('../middleware/auth');
const { syncOrderToAccounting } = require('../services/accountingService');
const { commitForPaidOrder, normalizeCode } = require('../services/couponUsageService');

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

    // QUAN TRỌNG: Chỉ cho phép xác nhận thủ công khi đã có webhook từ Sepay
    // Kiểm tra xem đã có dữ liệu webhook từ Sepay chưa (bằng chứng đã chuyển khoản)
    const callbackData = payment.sepayData?.callbackData;
    const hasWebhookData = callbackData && (
      callbackData.source === 'webhook' || 
      callbackData.source === 'webhook-real' ||
      callbackData.transactionId ||
      callbackData.referenceCode ||
      callbackData.id ||
      callbackData.gateway ||
      callbackData.transferAmount ||
      callbackData.amount
    );

    console.log("🔍 Checking webhook data:", {
      hasCallbackData: !!callbackData,
      callbackData: callbackData,
      paymentStatus: payment.status,
      paymentCode: paymentCode
    });

    if (!hasWebhookData) {
      console.warn(`⚠️ Manual confirmation attempted without webhook data for payment: ${paymentCode}`);
      console.warn(`⚠️ Payment sepayData:`, JSON.stringify(payment.sepayData, null, 2));
      return res.status(400).json({
        error: "Không thể xác nhận thanh toán. Hệ thống chưa nhận được xác nhận từ ngân hàng.",
        message: "Vui lòng đợi vài phút để hệ thống tự động xác nhận sau khi chuyển khoản. Nếu đã chuyển khoản nhưng vẫn chưa được xác nhận, vui lòng liên hệ hỗ trợ.",
        paymentCode,
        suggestion: "Hệ thống sẽ tự động xác nhận khi nhận được thông báo từ ngân hàng. Vui lòng đợi trong vài phút.",
        debug: {
          hasCallbackData: !!callbackData,
          callbackDataKeys: callbackData ? Object.keys(callbackData) : []
        }
      });
    }

    // Nếu có amount, kiểm tra khớp
    if (amount && Math.abs(payment.amount - amount) > 1000) {
      console.warn(`⚠️ Amount mismatch: expected ${payment.amount}, got ${amount}`);
      // Vẫn cho phép confirm nhưng log warning vì đã có webhook data
    }

    // Cập nhật payment status (chỉ khi đã có webhook data)
    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode },
      {
        status: "paid",
        paidAt: payment.sepayData?.callbackData?.transactionDate ? 
               new Date(payment.sepayData.callbackData.transactionDate) : 
               new Date(),
        transactionId: payment.sepayData?.callbackData?.transactionId || 
                      payment.sepayData?.callbackData?.id?.toString() || 
                      `manual_${Date.now()}`,
        'sepayData.confirmedBy': userId,
        'sepayData.confirmedAt': new Date().toISOString(),
        'sepayData.confirmationSource': 'manual-with-webhook'
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

    // Cập nhật payment status - Đảm bảo callbackData được lưu đúng structure
    const callbackDataToSave = {
      receivedAt: new Date().toISOString(),
      source: "webhook",
      gateway: gateway,
      transactionDate: transactionDate,
      accountNumber: accountNumber,
      transferType: transferType,
      transferAmount: transferAmount,
      amount: amount,
      referenceCode: referenceCode,
      description: description,
      transactionId: transactionId,
      id: webhookData.id,
      ...webhookData // Include all other fields
    };

    const updatedPayment = await SepayPayment.findOneAndUpdate(
      { paymentCode: payment.paymentCode },
      {
        status: "paid",
        paidAt: transactionDate ? new Date(transactionDate) : new Date(),
        transactionId: transactionId || webhookData.id?.toString() || `sepay_${Date.now()}`,
        'sepayData.callbackData': callbackDataToSave
      },
      { new: true }
    );

    console.log("✅ Payment updated via webhook:", updatedPayment.paymentCode);
    console.log("✅ Callback data saved:", JSON.stringify(updatedPayment.sepayData?.callbackData, null, 2));

    // Tự động tạo đơn hàng khi thanh toán thành công
    try {
      console.log("🛒 Starting auto order creation...");
      
      // Tìm order pending ưu tiên theo paymentCode (giảm rủi ro match nhầm theo amount)
      let existingOrder = await Order.findOne({
        user: updatedPayment.userId,
        paymentMethod: 'Sepay',
        status: 'pending',
        paymentCode: updatedPayment.paymentCode
      }).sort({ createdAt: -1 });

      // Fallback: match theo amount (logic cũ)
      if (!existingOrder) {
        existingOrder = await Order.findOne({
          user: updatedPayment.userId,
          paymentMethod: 'Sepay',
          status: 'pending',
          finalTotal: updatedPayment.amount
        }).sort({ createdAt: -1 });
      }

      if (existingOrder) {
        // Cập nhật order status thành "paid"
        const previousStatus = existingOrder.status;
        existingOrder.status = 'paid';
        await existingOrder.save();
        console.log(`✅ Updated existing order ${existingOrder._id} to paid status`);

        // Commit coupon usage if needed (idempotent via flags)
        try {
          const code = normalizeCode(existingOrder.coupon);
          if (code && existingOrder.user && !existingOrder.couponCommitted) {
            await commitForPaidOrder({
              code,
              userId: existingOrder.user,
              session: null,
              hasReservation: !!existingOrder.couponReserved,
            });
            existingOrder.couponCommitted = true;
            existingOrder.couponReserved = false;
            await existingOrder.save();
          }
        } catch (couponErr) {
          console.error('Coupon commit error (payment webhook):', couponErr);
        }
        
        // Đồng bộ đơn hàng vào kế toán
        syncOrderToAccounting(existingOrder, previousStatus, updatedPayment.userId).catch(err => {
          console.error('Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
        });
      } else {
        // Tìm trong Cart để tạo order mới
        const cart = await Cart.findOne({ user: updatedPayment.userId });
        const user = await User.findById(updatedPayment.userId);
        
        if (cart && cart.products && cart.products.length > 0) {
          // Tính toán lại totals từ cart
          const totalPrice = cart.products.reduce((sum, item) => sum + (item.price * (item.quantity || 0)), 0);
          const totalAfterDiscount = cart.totalAfterDiscount || totalPrice;
          const shippingFee = 30000;
          const finalTotal = totalAfterDiscount + shippingFee;
          
          // Kiểm tra xem finalTotal có khớp với payment amount không (cho phép sai số 1000 VND)
          if (Math.abs(finalTotal - updatedPayment.amount) <= 1000) {
            // Tạo order từ cart
            const orderItems = cart.products.map(item => ({
              product: item.product,
              title: item.title || 'Sản phẩm',
              quantity: item.quantity || 1,
              price: item.price || 0,
              image: item.image || '',
            unit: normalizeUnit(item.unit) || ''
            }));

            const newOrder = new Order({
              user: updatedPayment.userId,
              orderItems,
              shippingAddress: {
                address: user?.address || 'Chưa có địa chỉ'
              },
              phone: user?.phone || '',
              name: user?.name || 'Khách hàng',
              note: `Thanh toán qua Sepay - Payment Code: ${updatedPayment.paymentCode}`,
              coupon: cart.coupon || '',
              discount: cart.discount || 0,
              totalPrice,
              totalAfterDiscount,
              shippingFee,
              finalTotal,
              paymentMethod: 'Sepay',
              status: 'paid', // Tự động đánh dấu là đã thanh toán
              paymentCode: updatedPayment.paymentCode,
              couponReserved: false,
              couponCommitted: false,
            });

            await newOrder.save();
            console.log(`✅ Created new order ${newOrder._id} from cart`);

            // Commit coupon usage if present (best-effort)
            try {
              const code = normalizeCode(newOrder.coupon);
              if (code && newOrder.user && !newOrder.couponCommitted) {
                await commitForPaidOrder({
                  code,
                  userId: newOrder.user,
                  session: null,
                  hasReservation: false,
                });
                newOrder.couponCommitted = true;
                await newOrder.save();
              }
            } catch (couponErr) {
              console.error('Coupon commit error (auto order creation):', couponErr);
            }

            // Xóa cart sau khi tạo order
            await Cart.findOneAndUpdate(
              { user: updatedPayment.userId },
              { products: [], cartTotal: 0, totalAfterDiscount: 0, coupon: '', discount: 0 }
            );
            console.log(`✅ Cleared cart for user ${updatedPayment.userId}`);

            // Đồng bộ đơn hàng vào kế toán
            syncOrderToAccounting(newOrder, null, updatedPayment.userId).catch(err => {
              console.error('Lỗi khi đồng bộ đơn hàng vào kế toán:', err);
            });
          } else {
            console.warn(`⚠️ Cart total (${finalTotal}) doesn't match payment amount (${updatedPayment.amount}), skipping auto order creation`);
          }
        } else {
          console.log(`ℹ️ No cart found for user ${updatedPayment.userId}, skipping auto order creation`);
        }
      }
    } catch (orderError) {
      // Log lỗi nhưng không fail webhook
      console.error("❌ Error creating order automatically:", orderError);
      console.error("Order creation error stack:", orderError.stack);
    }

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
