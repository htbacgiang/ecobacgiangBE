const AccountingPeriod = require('../models/AccountingPeriod');

/**
 * Middleware kiểm tra Lock Date
 * Chặn việc sửa/xóa giao dịch có ngày nhỏ hơn Lock Date
 */
async function checkLockDate(transactionDate) {
  try {
    // Tìm kỳ kế toán có lockDate và transactionDate nằm trong kỳ đó
    const period = await AccountingPeriod.findOne({
      startDate: { $lte: transactionDate },
      endDate: { $gte: transactionDate },
      lockDate: { $ne: null },
      status: 'closed'
    }).lean();
    
    if (period && period.lockDate) {
      const lockDate = new Date(period.lockDate);
      const transDate = new Date(transactionDate);
      
      // Nếu ngày giao dịch nhỏ hơn hoặc bằng lockDate, chặn
      if (transDate <= lockDate) {
        return {
          isLocked: true,
          lockDate: period.lockDate,
          periodName: period.periodName,
          message: `Kỳ kế toán "${period.periodName}" đã được khóa sổ. Không thể sửa/xóa giao dịch trước ngày ${new Date(period.lockDate).toLocaleDateString('vi-VN')}`
        };
      }
    }
    
    return { isLocked: false };
  } catch (error) {
    console.error('Error checking lock date:', error);
    // Nếu có lỗi, cho phép tiếp tục (fail-safe)
    return { isLocked: false };
  }
}

module.exports = { checkLockDate };

