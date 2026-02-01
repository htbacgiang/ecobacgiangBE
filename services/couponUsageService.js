const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCode(code) {
  return (code || '').toString().trim().toUpperCase();
}

function getUserStat(couponDoc, userId) {
  if (!couponDoc || !userId) return null;
  const uid = userId.toString();
  const stats = couponDoc.userStats || [];
  return stats.find((s) => s.user && s.user.toString() === uid) || null;
}

function ensureUserStat(couponDoc, userId) {
  if (!couponDoc.userStats) couponDoc.userStats = [];
  const existing = getUserStat(couponDoc, userId);
  if (existing) return existing;
  const created = { user: new mongoose.Types.ObjectId(userId), reservedCount: 0, usedCount: 0 };
  couponDoc.userStats.push(created);
  return created;
}

function validateCouponDoc(couponDoc) {
  const now = new Date();
  const start = parseDateSafe(couponDoc.startDate);
  const end = parseDateSafe(couponDoc.endDate);
  if (!start || !end) return { ok: false, message: 'Coupon có ngày bắt đầu/kết thúc không hợp lệ.' };
  if (now < start) return { ok: false, message: 'Mã giảm giá chưa có hiệu lực.' };
  if (now > end) return { ok: false, message: 'Mã giảm giá đã hết hạn.' };
  if (couponDoc.discount == null || couponDoc.discount <= 0 || couponDoc.discount > 100) {
    return { ok: false, message: 'Coupon có mức giảm giá không hợp lệ.' };
  }
  return { ok: true };
}

function validateLimits(couponDoc, userId, { includeReserved = true } = {}) {
  const globalLimit = couponDoc.globalUsageLimit;
  const perUserLimit = couponDoc.perUserUsageLimit;

  const used = couponDoc.usedCount || 0;
  const reserved = couponDoc.reservedCount || 0;
  const globalCurrent = used + (includeReserved ? reserved : 0);

  if (globalLimit != null && globalLimit >= 0 && globalCurrent >= globalLimit) {
    return { ok: false, message: 'Mã giảm giá đã hết lượt sử dụng.' };
  }

  if (userId && perUserLimit != null && perUserLimit >= 0) {
    const stat = getUserStat(couponDoc, userId);
    const userUsed = stat?.usedCount || 0;
    const userReserved = stat?.reservedCount || 0;
    const userCurrent = userUsed + (includeReserved ? userReserved : 0);
    if (userCurrent >= perUserLimit) {
      return { ok: false, message: 'Bạn đã dùng hết lượt áp dụng cho mã này.' };
    }
  }

  return { ok: true };
}

async function loadCouponByCode(code, session = null) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const q = Coupon.findOne({ coupon: normalized });
  if (session) q.session(session);
  return await q;
}

/**
 * Validate coupon for applying on cart (does NOT reserve/commit)
 */
async function validateForCart({ code, userId }) {
  const couponDoc = await loadCouponByCode(code);
  if (!couponDoc) return { ok: false, message: 'Mã giảm giá không hợp lệ.' };

  const dateOk = validateCouponDoc(couponDoc);
  if (!dateOk.ok) return dateOk;

  const limitOk = validateLimits(couponDoc, userId, { includeReserved: true });
  if (!limitOk.ok) return limitOk;

  return { ok: true, coupon: couponDoc };
}

/**
 * Reserve a coupon for a pending order (COD/BankTransfer).
 * This prevents oversubscription but is NOT counted as "used".
 */
async function reserveForOrder({ code, userId, session }) {
  const couponDoc = await loadCouponByCode(code, session);
  if (!couponDoc) throw new Error('Mã giảm giá không hợp lệ.');

  const dateOk = validateCouponDoc(couponDoc);
  if (!dateOk.ok) throw new Error(dateOk.message);

  const limitOk = validateLimits(couponDoc, userId, { includeReserved: true });
  if (!limitOk.ok) throw new Error(limitOk.message);

  couponDoc.reservedCount = (couponDoc.reservedCount || 0) + 1;
  const stat = ensureUserStat(couponDoc, userId);
  stat.reservedCount = (stat.reservedCount || 0) + 1;

  await couponDoc.save({ session });
  return couponDoc;
}

/**
 * Commit coupon usage when an order is paid successfully.
 * - If order had a reservation: move reserved -> used
 * - If no reservation: increment used directly (still checks limits)
 */
async function commitForPaidOrder({ code, userId, session, hasReservation = false }) {
  const couponDoc = await loadCouponByCode(code, session);
  if (!couponDoc) throw new Error('Mã giảm giá không hợp lệ.');

  const dateOk = validateCouponDoc(couponDoc);
  if (!dateOk.ok) throw new Error(dateOk.message);

  // If no reservation, ensure capacity at commit time
  if (!hasReservation) {
    const limitOk = validateLimits(couponDoc, userId, { includeReserved: false });
    if (!limitOk.ok) throw new Error(limitOk.message);
  }

  if (hasReservation) {
    couponDoc.reservedCount = Math.max(0, (couponDoc.reservedCount || 0) - 1);
  }
  couponDoc.usedCount = (couponDoc.usedCount || 0) + 1;

  const stat = ensureUserStat(couponDoc, userId);
  if (hasReservation) {
    stat.reservedCount = Math.max(0, (stat.reservedCount || 0) - 1);
  }
  stat.usedCount = (stat.usedCount || 0) + 1;

  await couponDoc.save({ session });
  return couponDoc;
}

/**
 * Release a reservation when an order is cancelled before payment.
 */
async function releaseReservation({ code, userId, session }) {
  const couponDoc = await loadCouponByCode(code, session);
  if (!couponDoc) return null;

  couponDoc.reservedCount = Math.max(0, (couponDoc.reservedCount || 0) - 1);
  const stat = ensureUserStat(couponDoc, userId);
  stat.reservedCount = Math.max(0, (stat.reservedCount || 0) - 1);

  await couponDoc.save({ session });
  return couponDoc;
}

module.exports = {
  normalizeCode,
  validateForCart,
  reserveForOrder,
  commitForPaidOrder,
  releaseReservation,
};


