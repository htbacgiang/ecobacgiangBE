/**
 * Script tính khấu hao tự động hàng tháng
 * Chạy vào đầu mỗi tháng để tính khấu hao cho tất cả tài sản cố định
 * 
 * Usage:
 *   node server/scripts/calculate-depreciation.js
 * 
 * Hoặc setup Cron Job:
 *   0 0 1 * * node /path/to/server/scripts/calculate-depreciation.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const db = require('../config/database');
const FixedAsset = require('../models/FixedAsset');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

async function calculateMonthlyDepreciation() {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const now = new Date();
    const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    console.log(`🔄 Bắt đầu tính khấu hao cho tháng ${targetMonth}...`);
    
    // Lấy tất cả tài sản đang hoạt động
    const activeAssets = await FixedAsset.find({ 
      status: 'active' 
    }).session(session);
    
    console.log(`📊 Tìm thấy ${activeAssets.length} tài sản đang hoạt động`);
    
    const results = [];
    
    for (const asset of activeAssets) {
      // Kiểm tra xem đã khấu hao tháng này chưa
      const alreadyDepreciated = asset.depreciationHistory.some(
        dep => dep.month === targetMonth
      );
      
      if (alreadyDepreciated) {
        console.log(`⏭️  Tài sản ${asset.name} đã được khấu hao trong tháng ${targetMonth}`);
        continue;
      }
      
      // Kiểm tra xem đã khấu hao hết chưa
      if (asset.accumulatedDepreciation >= asset.originalCost) {
        console.log(`✅ Tài sản ${asset.name} đã khấu hao hết`);
        continue;
      }
      
      // Tính khấu hao tháng này
      const monthlyDepreciation = asset.monthlyDepreciation || (asset.originalCost / asset.usefulLife);
      const remainingValue = asset.originalCost - asset.accumulatedDepreciation;
      const depreciationAmount = Math.min(monthlyDepreciation, remainingValue);
      
      if (depreciationAmount <= 0) continue;
      
      // Kiểm tra tài khoản có tồn tại không
      const accounts = await Account.find({
        code: { $in: ['642', '214'] }
      }).session(session);
      
      if (accounts.length !== 2) {
        console.error(`❌ Thiếu tài khoản 642 hoặc 214 cho tài sản ${asset.name}`);
        continue;
      }
      
      // Tạo bút toán khấu hao: Nợ TK 642 / Có TK 214
      const referenceNo = `DEP-${targetMonth}-${asset.assetCode || asset._id.toString().slice(-6)}`;
      
      // Kiểm tra số chứng từ đã tồn tại chưa
      const existingEntry = await JournalEntry.findOne({ referenceNo }).session(session);
      if (existingEntry) {
        console.log(`⏭️  Journal entry ${referenceNo} đã tồn tại`);
        continue;
      }
      
      const lines = [
        {
          accountCode: '642', // Chi phí quản lý doanh nghiệp
          debit: depreciationAmount,
          credit: 0,
          description: `Khấu hao tài sản: ${asset.name}`,
        },
        {
          accountCode: '214', // Hao mòn lũy kế TSCĐ
          debit: 0,
          credit: depreciationAmount,
          description: `Khấu hao lũy kế: ${asset.name}`,
        }
      ];
      
      const journalEntry = new JournalEntry({
        referenceNo,
        date: new Date(`${targetMonth}-01`),
        postingDate: new Date(),
        memo: `Khấu hao tháng ${targetMonth} - ${asset.name}`,
        entryType: 'depreciation',
        sourceId: asset._id,
        sourceType: 'depreciation',
        lines: lines,
        status: 'posted',
      });
      
      await journalEntry.save({ session });
      
      // Cập nhật Fixed Asset
      asset.accumulatedDepreciation += depreciationAmount;
      asset.bookValue = asset.originalCost - asset.accumulatedDepreciation;
      asset.depreciationHistory.push({
        month: targetMonth,
        amount: depreciationAmount,
        journalEntry: journalEntry._id,
      });
      
      await asset.save({ session });
      
      results.push({
        asset: asset.name,
        depreciationAmount,
        accumulatedDepreciation: asset.accumulatedDepreciation,
        bookValue: asset.bookValue,
      });
      
      console.log(`✅ Đã tính khấu hao ${depreciationAmount.toLocaleString('vi-VN')} VNĐ cho ${asset.name}`);
    }
    
    await session.commitTransaction();
    
    console.log(`\n✅ Hoàn thành! Đã tính khấu hao cho ${results.length} tài sản trong tháng ${targetMonth}`);
    console.log(`📊 Tổng số tiền khấu hao: ${results.reduce((sum, r) => sum + r.depreciationAmount, 0).toLocaleString('vi-VN')} VNĐ`);
    
    process.exit(0);
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Lỗi khi tính khấu hao:', error);
    process.exit(1);
  } finally {
    session.endSession();
    await mongoose.disconnect();
  }
}

// Chạy script
if (require.main === module) {
  calculateMonthlyDepreciation();
}

module.exports = { calculateMonthlyDepreciation };

