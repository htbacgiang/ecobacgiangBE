const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const db = require('../config/database');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Receivable = require('../models/Receivable');
const Payable = require('../models/Payable');
const BankAccount = require('../models/BankAccount');
const FixedAsset = require('../models/FixedAsset');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const AccountingPeriod = require('../models/AccountingPeriod');
const { withAuth, optionalAuth } = require('../middleware/auth');
const { checkLockDate } = require('../middleware/lockDateCheck');

// ==========================================
// ACCOUNTS (Chart of Accounts)
// ==========================================

// GET /api/accounting/accounts - Lấy danh sách tài khoản
router.get('/accounts', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const accounts = await Account.find({ status: 'active' })
      .sort({ code: 1 })
      .lean();
    
    return res.status(200).json({ accounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách tài khoản' });
  }
});

// POST /api/accounting/accounts - Tạo tài khoản mới
router.post('/accounts', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { code, name, accountType, level, parentCode, notes } = req.body;
    
    // Validate
    if (!code || !name || !accountType) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }
    
    // Map accountType to accountTypeName
    const accountTypeMap = {
      'asset': 'Tài sản',
      'liability': 'Nợ phải trả',
      'equity': 'Vốn chủ sở hữu',
      'revenue': 'Doanh thu',
      'expense': 'Chi phí'
    };
    
    const account = new Account({
      code,
      name,
      accountType,
      accountTypeName: accountTypeMap[accountType],
      level: level || 1,
      parentCode: parentCode || null,
      notes: notes || '',
    });
    
    await account.save();
    
    return res.status(201).json({ 
      message: 'Tạo tài khoản thành công',
      account 
    });
  } catch (error) {
    console.error('Error creating account:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Mã tài khoản đã tồn tại' });
    }
    return res.status(500).json({ message: 'Lỗi khi tạo tài khoản' });
  }
});

// ==========================================
// JOURNAL ENTRIES (Chứng từ Kế toán)
// ==========================================

// GET /api/accounting/journal-entries - Lấy danh sách chứng từ
router.get('/journal-entries', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { 
      startDate, 
      endDate, 
      accountCode, 
      status = 'posted',
      page = 1,
      limit = 50 
    } = req.query;
    
    let query = { status };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    if (accountCode) {
      query['lines.accountCode'] = accountCode;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const entries = await JournalEntry.find(query)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await JournalEntry.countDocuments(query);
    
    return res.status(200).json({ 
      entries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách chứng từ' });
  }
});

// POST /api/accounting/journal-entries - Tạo chứng từ mới
router.post('/journal-entries', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { referenceNo, date, memo, entryType, lines, sourceId, sourceType } = req.body;
    
    // Validate
    if (!referenceNo || !date || !memo || !lines || lines.length === 0) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }
    
    // Validate balance: Tổng Nợ = Tổng Có
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ 
        message: 'Chứng từ không cân bằng. Tổng Nợ phải bằng Tổng Có',
        totalDebit,
        totalCredit
      });
    }
    
    // Validate account codes exist
    const accountCodes = [...new Set(lines.map(line => line.accountCode))];
    const accounts = await Account.find({ code: { $in: accountCodes } });
    
    if (accounts.length !== accountCodes.length) {
      return res.status(400).json({ message: 'Có tài khoản không tồn tại' });
    }
    
    // Tạo chứng từ
    const entry = new JournalEntry({
      referenceNo,
      date: new Date(date),
      postingDate: new Date(),
      memo,
      entryType: entryType || 'manual',
      lines: lines.map(line => ({
        accountCode: line.accountCode,
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
        partner: line.partner || null,
        partnerType: line.partnerType || null,
        description: line.description || '',
      })),
      sourceId: sourceId || null,
      sourceType: sourceType || null,
      createdBy: req.userId || null,
      status: 'posted',
    });
    
    await entry.save();
    
    // Update account balances (tùy chọn - có thể tính toán lại khi cần)
    // TODO: Implement balance update logic
    
    return res.status(201).json({ 
      message: 'Tạo chứng từ thành công',
      entry 
    });
  } catch (error) {
    console.error('Error creating journal entry:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    return res.status(500).json({ message: 'Lỗi khi tạo chứng từ' });
  }
});

// PUT /api/accounting/journal-entries/:id - Cập nhật chứng từ
router.put('/journal-entries/:id', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { id } = req.params;
    const { referenceNo, date, memo, entryType, lines, sourceId, sourceType } = req.body;
    
    // Tìm chứng từ
    const entry = await JournalEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Không tìm thấy chứng từ' });
    }
    
    // Kiểm tra Lock Date (nếu có)
    // TODO: Implement lock date check
    
    // Validate nếu có dữ liệu mới
    if (lines && lines.length > 0) {
      // Validate balance: Tổng Nợ = Tổng Có
      const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
      const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);
      
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ 
          message: 'Chứng từ không cân bằng. Tổng Nợ phải bằng Tổng Có',
          totalDebit,
          totalCredit
        });
      }
      
      // Validate account codes exist
      const accountCodes = [...new Set(lines.map(line => line.accountCode))];
      const accounts = await Account.find({ code: { $in: accountCodes } });
      
      if (accounts.length !== accountCodes.length) {
        return res.status(400).json({ message: 'Có tài khoản không tồn tại' });
      }
      
      // Cập nhật lines
      entry.lines = lines.map(line => ({
        accountCode: line.accountCode,
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
        partner: line.partner || null,
        partnerType: line.partnerType || null,
        description: line.description || '',
      }));
    }
    
    // Cập nhật các trường khác nếu có
    if (referenceNo) entry.referenceNo = referenceNo;
    if (date) entry.date = new Date(date);
    if (memo) entry.memo = memo;
    if (entryType) entry.entryType = entryType;
    if (sourceId !== undefined) entry.sourceId = sourceId;
    if (sourceType !== undefined) entry.sourceType = sourceType;
    
    entry.updatedAt = new Date();
    
    await entry.save();
    
    return res.status(200).json({ 
      message: 'Cập nhật chứng từ thành công',
      entry 
    });
  } catch (error) {
    console.error('Error updating journal entry:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    return res.status(500).json({ message: 'Lỗi khi cập nhật chứng từ' });
  }
});

// DELETE /api/accounting/journal-entries/:id - Xóa chứng từ
router.delete('/journal-entries/:id', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { id } = req.params;
    
    // Tìm chứng từ
    const entry = await JournalEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Không tìm thấy chứng từ' });
    }
    
    // Kiểm tra Lock Date (nếu có)
    // TODO: Implement lock date check
    
    // Kiểm tra xem có Receivable/Payable liên quan không
    const Receivable = require('../models/Receivable');
    const Payable = require('../models/Payable');
    
    const receivable = await Receivable.findOne({ journalEntry: id });
    const payable = await Payable.findOne({ journalEntry: id });
    
    if (receivable || payable) {
      return res.status(400).json({ 
        message: 'Không thể xóa chứng từ này vì đã có công nợ liên quan. Vui lòng xóa công nợ trước.',
        hasReceivable: !!receivable,
        hasPayable: !!payable
      });
    }
    
    // Xóa chứng từ
    await JournalEntry.findByIdAndDelete(id);
    
    return res.status(200).json({ 
      message: 'Xóa chứng từ thành công'
    });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return res.status(500).json({ message: 'Lỗi khi xóa chứng từ' });
  }
});

// GET /api/accounting/account-ledger/:accountCode - Sổ chi tiết tài khoản
router.get('/account-ledger/:accountCode', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { accountCode } = req.params;
    const { startDate, endDate } = req.query;
    
    let query = {
      status: 'posted',
      'lines.accountCode': accountCode
    };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const entries = await JournalEntry.find(query)
      .sort({ date: 1, createdAt: 1 })
      .lean();
    
    // Tính số dư lũy kế
    let runningBalance = 0;
    const ledgerLines = [];
    
    entries.forEach(entry => {
      const line = entry.lines.find(l => l.accountCode === accountCode);
      if (line) {
        runningBalance = runningBalance + parseFloat(line.debit) - parseFloat(line.credit);
        
        ledgerLines.push({
          date: entry.date,
          referenceNo: entry.referenceNo,
          memo: entry.memo,
          debit: line.debit,
          credit: line.credit,
          balance: runningBalance
        });
      }
    });
    
    return res.status(200).json({ 
      accountCode,
      lines: ledgerLines,
      endingBalance: runningBalance
    });
  } catch (error) {
    console.error('Error fetching account ledger:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy sổ chi tiết' });
  }
});

// GET /api/accounting/trial-balance - Bảng cân đối số phát sinh
router.get('/trial-balance', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    const { startDate, endDate } = req.query;
    
    let query = { status: 'posted' };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    // Sử dụng Aggregation để tính tổng Nợ/Có theo từng tài khoản
    const trialBalance = await JournalEntry.aggregate([
      { $match: query },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: '$lines.debit' },
          totalCredit: { $sum: '$lines.credit' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'code',
          as: 'account'
        }
      },
      { $unwind: '$account' },
      {
        $project: {
          accountCode: '$_id',
          accountName: '$account.name',
          accountType: '$account.accountType',
          totalDebit: 1,
          totalCredit: 1
        }
      },
      { $sort: { accountCode: 1 } }
    ]);
    
    return res.status(200).json({ trialBalance });
  } catch (error) {
    console.error('Error fetching trial balance:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy bảng cân đối' });
  }
});

// ==========================================
// RECEIVABLES (Công nợ Phải Thu)
// ==========================================

// GET /api/accounting/receivables - Lấy danh sách công nợ phải thu
// BƯỚC 3: Sử dụng MongoDB Aggregation để tính toán từ JournalEntry (TK 131)
router.get('/receivables', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { customer, paymentStatus, useAggregation = 'true' } = req.query;
    
    // Option 1: Dùng Aggregation từ JournalEntry (Khuyến nghị)
    if (useAggregation === 'true') {
      try {
        // Aggregation Pipeline: Tính toán công nợ từ JournalEntry với TK 131
        const receivablesAggregation = await JournalEntry.aggregate([
          // Bước 1: Lọc các JournalEntry có TK 131 (Phải thu khách hàng)
          {
            $match: {
              status: 'posted',
              'lines.accountCode': '131'
            }
          },
          // Bước 2: Unwind để tách từng dòng
          { $unwind: '$lines' },
          // Bước 3: Chỉ lấy dòng có TK 131
          {
            $match: {
              'lines.accountCode': '131',
              'lines.debit': { $gt: 0 } // Chỉ lấy dòng Nợ (tăng công nợ)
            }
          },
          // Bước 4: Group theo partner (khách hàng) và tính tổng
          {
            $group: {
              _id: {
                customer: '$lines.partner',
                journalEntry: '$_id',
                referenceNo: '$referenceNo',
                date: '$date',
                memo: '$memo'
              },
              totalDebit: { $sum: '$lines.debit' },
              // Lấy thông tin từ Receivable nếu có
              journalEntryId: { $first: '$_id' }
            }
          },
          // Bước 5: Lookup Receivable để lấy thông tin chi tiết
          {
            $lookup: {
              from: 'receivables',
              localField: 'journalEntryId',
              foreignField: 'journalEntry',
              as: 'receivable'
            }
          },
          // Bước 6: Unwind receivable (có thể null)
          {
            $unwind: {
              path: '$receivable',
              preserveNullAndEmptyArrays: true
            }
          },
          // Bước 7: Lookup customer
          {
            $lookup: {
              from: 'users',
              localField: '_id.customer',
              foreignField: '_id',
              as: 'customerInfo'
            }
          },
          {
            $unwind: {
              path: '$customerInfo',
              preserveNullAndEmptyArrays: true
            }
          },
          // Bước 8: Tính toán remainingAmount và daysOverdue
          {
            $project: {
              _id: { $ifNull: ['$receivable._id', '$_id.journalEntry'] },
              customer: {
                _id: '$_id.customer',
                name: { $ifNull: ['$customerInfo.name', 'Khách hàng'] },
                phone: { $ifNull: ['$customerInfo.phone', ''] },
                email: { $ifNull: ['$customerInfo.email', ''] }
              },
              journalEntry: '$_id.journalEntry',
              originalAmount: { $ifNull: ['$receivable.originalAmount', '$totalDebit'] },
              remainingAmount: { 
                $ifNull: [
                  '$receivable.remainingAmount', 
                  { $subtract: ['$totalDebit', 0] } // Mặc định = originalAmount nếu chưa có Receivable
                ]
              },
              paymentStatus: { $ifNull: ['$receivable.paymentStatus', 'unpaid'] },
              dueDate: { 
                $ifNull: [
                  '$receivable.dueDate', 
                  { $add: ['$_id.date', 30 * 24 * 60 * 60 * 1000] } // Mặc định +30 ngày
                ]
              },
              invoiceDate: { $ifNull: ['$receivable.invoiceDate', '$_id.date'] },
              description: { $ifNull: ['$receivable.description', '$_id.memo'] },
              referenceNo: '$_id.referenceNo',
              // Tính daysOverdue
              daysOverdue: {
                $let: {
                  vars: {
                    dueDate: { 
                      $ifNull: [
                        '$receivable.dueDate', 
                        { $add: ['$_id.date', 30 * 24 * 60 * 60 * 1000] }
                      ]
                    }
                  },
                  in: {
                    $floor: {
                      $divide: [
                        { $subtract: [new Date(), '$$dueDate'] },
                        1000 * 60 * 60 * 24
                      ]
                    }
                  }
                }
              }
            }
          },
          // Bước 9: Filter theo paymentStatus nếu có
          ...(paymentStatus ? [{
            $match: {
              paymentStatus: paymentStatus
            }
          }] : []),
          // Bước 10: Filter theo customer nếu có
          ...(customer ? [{
            $match: {
              'customer._id': new mongoose.Types.ObjectId(customer)
            }
          }] : []),
          // Bước 11: Sort theo dueDate
          { $sort: { dueDate: 1 } }
        ]);
        
        return res.status(200).json({ 
          receivables: receivablesAggregation,
          source: 'aggregation' // Đánh dấu dữ liệu từ aggregation
        });
      } catch (aggError) {
        console.error('Error in receivables aggregation:', aggError);
        // Fallback về cách cũ nếu aggregation lỗi
      }
    }
    
    // Option 2: Fallback - Dùng Receivable model (cách cũ)
    const { dueDate } = req.query;
    
    let query = {};
    if (customer) query.customer = customer;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (dueDate) {
      query.dueDate = { $lte: new Date(dueDate) }; // Quá hạn
    }
    
    const receivables = await Receivable.find(query)
      .populate('customer', 'name email phone')
      .populate('order')
      .populate('journalEntry')
      .sort({ dueDate: 1 })
      .lean();
    
    return res.status(200).json({ 
      receivables,
      source: 'model' // Đánh dấu dữ liệu từ model
    });
  } catch (error) {
    console.error('Error fetching receivables:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách công nợ' });
  }
});

// POST /api/accounting/receivables - Tạo công nợ phải thu mới (thủ công)
router.post('/receivables', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { 
      customer, 
      journalEntry, 
      originalAmount, 
      dueDate, 
      invoiceDate, 
      description,
      order // Optional - có thể không có nếu là công nợ tự tạo
    } = req.body;
    
    // Validate required fields
    if (!customer || !journalEntry || !originalAmount || !dueDate || !invoiceDate) {
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: customer, journalEntry, originalAmount, dueDate, invoiceDate' 
      });
    }
    
    // Kiểm tra xem đã có Receivable cho journalEntry này chưa
    const existing = await Receivable.findOne({ journalEntry });
    if (existing) {
      return res.status(400).json({ message: 'Công nợ cho chứng từ này đã tồn tại' });
    }
    
    // Tạo Receivable mới
    const receivable = new Receivable({
      journalEntry,
      customer,
      order: order || null, // Có thể null nếu là công nợ tự tạo
      originalAmount,
      remainingAmount: originalAmount, // Ban đầu còn lại = gốc
      paymentStatus: 'unpaid',
      dueDate: new Date(dueDate),
      invoiceDate: new Date(invoiceDate),
      description: description || '',
    });
    
    await receivable.save();
    
    // Populate để trả về đầy đủ thông tin
    await receivable.populate('customer', 'name email phone');
    await receivable.populate('journalEntry');
    if (order) {
      await receivable.populate('order');
    }
    
    return res.status(201).json({ 
      message: 'Tạo công nợ thành công',
      receivable 
    });
  } catch (error) {
    console.error('Error creating receivable:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo công nợ' });
  }
});

// GET /api/accounting/receivables/aging - Báo cáo tuổi nợ
router.get('/receivables/aging', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const receivables = await Receivable.find({ 
      remainingAmount: { $gt: 0 },
      paymentStatus: { $in: ['unpaid', 'partial'] }
    })
      .populate('customer', 'name email phone')
      .lean();
    
    const now = new Date();
    const aging = {
      current: [],
      overdue1to30: [],
      overdue31to60: [],
      overdue61to90: [],
      overdue90plus: []
    };
    
    receivables.forEach(rec => {
      // Lấy ngày hạn thanh toán (dueDate)
      // dueDate là required trong model, nhưng xử lý an toàn cho dữ liệu cũ
      let dueDate;
      
      if (rec.dueDate) {
        // Ưu tiên dùng dueDate (hạn thanh toán thực tế - cho cả receivables từ order và tự tạo)
        dueDate = new Date(rec.dueDate);
      } else if (rec.invoiceDate) {
        // Nếu không có dueDate, dùng invoiceDate + 30 ngày (mặc định)
        dueDate = new Date(rec.invoiceDate);
        dueDate.setDate(dueDate.getDate() + 30);
      } else {
        // Trường hợp không có cả 2, dùng createdAt + 30 ngày (fallback)
        dueDate = new Date(rec.createdAt || Date.now());
        dueDate.setDate(dueDate.getDate() + 30);
      }
      
      // Reset giờ về 0 để tính chính xác
      dueDate.setHours(0, 0, 0, 0);
      const nowReset = new Date(now);
      nowReset.setHours(0, 0, 0, 0);
      
      // Tính số ngày quá hạn (số dương = quá hạn, số âm = còn hạn)
      const daysOverdue = Math.floor((nowReset - dueDate) / (1000 * 60 * 60 * 24));
      const item = {
        ...rec,
        daysOverdue,
        calculatedDueDate: dueDate
      };
      
      // Phân nhóm theo tuổi nợ (sửa logic phân nhóm)
      if (daysOverdue < 0) {
        // Chưa đến hạn (còn hạn)
        aging.current.push(item);
      } else if (daysOverdue >= 0 && daysOverdue <= 30) {
        // Quá hạn 0-30 ngày
        aging.overdue1to30.push(item);
      } else if (daysOverdue > 30 && daysOverdue <= 60) {
        // Quá hạn 31-60 ngày
        aging.overdue31to60.push(item);
      } else if (daysOverdue > 60 && daysOverdue <= 90) {
        // Quá hạn 61-90 ngày
        aging.overdue61to90.push(item);
      } else {
        // Quá hạn > 90 ngày
        aging.overdue90plus.push(item);
      }
    });
    
    // Tính tổng theo nhóm
    const summary = {
      current: aging.current.reduce((sum, r) => sum + (r.remainingAmount || 0), 0),
      overdue1to30: aging.overdue1to30.reduce((sum, r) => sum + (r.remainingAmount || 0), 0),
      overdue31to60: aging.overdue31to60.reduce((sum, r) => sum + (r.remainingAmount || 0), 0),
      overdue61to90: aging.overdue61to90.reduce((sum, r) => sum + (r.remainingAmount || 0), 0),
      overdue90plus: aging.overdue90plus.reduce((sum, r) => sum + (r.remainingAmount || 0), 0)
    };
    
    return res.status(200).json({ aging, summary });
  } catch (error) {
    console.error('Error fetching aging report:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy báo cáo tuổi nợ' });
  }
});

// ==========================================
// PAYABLES (Công nợ Phải Trả)
// ==========================================

// GET /api/accounting/payables - Lấy danh sách công nợ phải trả
router.get('/payables', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { supplier, paymentStatus } = req.query;
    
    let query = {};
    if (supplier) query.supplier = supplier;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    
    const payables = await Payable.find(query)
      .populate('supplier', 'name email phone')
      .populate('journalEntry')
      .sort({ dueDate: 1 })
      .lean();
    
    return res.status(200).json({ payables });
  } catch (error) {
    console.error('Error fetching payables:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách công nợ phải trả' });
  }
});

// ==========================================
// BANK ACCOUNTS (Quỹ & Ngân hàng)
// ==========================================

// GET /api/accounting/bank-accounts - Lấy danh sách tài khoản ngân hàng/quỹ
router.get('/bank-accounts', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const bankAccounts = await BankAccount.find({ status: 'active' })
      .populate('accountCode')
      .sort({ type: 1, name: 1 })
      .lean();
    
    return res.status(200).json({ bankAccounts });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách tài khoản' });
  }
});

// ==========================================
// FIXED ASSETS (Tài sản Cố định)
// ==========================================

// GET /api/accounting/fixed-assets - Lấy danh sách tài sản cố định
router.get('/fixed-assets', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { status } = req.query;
    
    let query = {};
    if (status) query.status = status;
    
    const assets = await FixedAsset.find(query)
      .sort({ purchaseDate: -1 })
      .lean();
    
    return res.status(200).json({ assets });
  } catch (error) {
    console.error('Error fetching fixed assets:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách tài sản' });
  }
});

// ==========================================
// POST ENTRY (Hạch toán Tổng hợp - API Cốt lõi)
// ==========================================

/**
 * Helper function: Tìm hoặc tạo Partner (Customer/Supplier) từ tên
 * @param {String} partnerName - Tên đối tác
 * @param {String} type - 'income' (Customer) hoặc 'expense' (Supplier)
 * @param {Session} session - MongoDB session
 * @returns {Object} Partner document
 */
/**
 * Tìm hoặc tạo Partner mặc định cho công nợ thủ công
 * Đảm bảo luôn có một User hợp lệ để gắn công nợ
 */
async function findOrCreateDefaultPartner(type, session) {
  const defaultName = type === 'income' ? 'Partner_Default_Customer' : 'Partner_Default_Supplier';
  const defaultEmail = type === 'income' 
    ? 'partner.default.customer@partner.local' 
    : 'partner.default.supplier@partner.local';
  const role = type === 'income' ? 'customer' : 'supplier';
  
  // Tìm partner mặc định
  let defaultPartner = await User.findOne({
    email: defaultEmail,
    role: role
  }).session(session);
  
  // Nếu không có, tạo mới
  if (!defaultPartner) {
    // Tạo phone number giả cho partner (10 chữ số, bắt đầu bằng 0)
    const defaultPhone = type === 'income' ? '0900000000' : '0900000001';
    
    defaultPartner = new User({
      name: defaultName,
      email: defaultEmail,
      phone: defaultPhone, // Phone phải có 10-11 chữ số
      role: role,
      password: 'partner_no_password_' + Date.now(), // Password bắt buộc nhưng không dùng để đăng nhập
      agree: true, // Bắt buộc phải có
      isActive: true,
    });
    try {
      await defaultPartner.save({ session });
      console.log(`✅ Đã tạo ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} mặc định: ${defaultName}`);
    } catch (error) {
      // Nếu lỗi duplicate (có thể do transaction retry), tìm lại
      if (error.code === 11000 || error.message.includes('duplicate')) {
        defaultPartner = await User.findOne({
          email: defaultEmail,
          role: role
        }).session(session);
        if (!defaultPartner) {
          throw new Error(`Không thể tạo hoặc tìm ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} mặc định`);
        }
      } else {
        throw error;
      }
    }
  }
  
  return defaultPartner;
}

/**
 * Tìm hoặc tạo Partner từ tên và số điện thoại
 * Xử lý lỗi trùng lặp email bằng cách thêm timestamp
 */
async function findOrCreatePartner(partnerName, partnerPhone, type, session) {
  if (!partnerName || !partnerName.trim()) {
    throw new Error('Tên đối tác không được để trống');
  }
  
  const trimmedName = partnerName.trim();
  const role = type === 'income' ? 'customer' : 'supplier';
  
  // Log để debug
  console.log(`🔍 findOrCreatePartner được gọi với:`, {
    partnerName: trimmedName,
    partnerPhone: partnerPhone,
    partnerPhoneType: typeof partnerPhone,
    hasPhone: !!partnerPhone,
    phoneLength: partnerPhone ? partnerPhone.length : 0,
    role: role
  });
  
  // Tìm partner theo tên (case-insensitive)
  let partner = await User.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    role: role
  }).session(session);
  
  // Nếu tìm thấy partner theo tên, cập nhật phone nếu có phone từ form
  if (partner) {
    const oldPhone = partner.phone;
    console.log(`🔍 Tìm thấy partner theo tên "${trimmedName}", phone hiện tại: ${oldPhone || 'chưa có'}`);
    
    if (partnerPhone && typeof partnerPhone === 'string' && partnerPhone.trim() && partnerPhone.trim().length > 0) {
      const trimmedPhone = partnerPhone.trim();
      console.log(`📱 Có phone từ form: ${trimmedPhone}`);
      
      if (partner.phone !== trimmedPhone) {
        partner.phone = trimmedPhone;
        await partner.save({ session });
        console.log(`✅ Đã cập nhật phone cho partner "${trimmedName}" từ "${oldPhone || 'chưa có'}" thành "${trimmedPhone}"`);
      } else {
        console.log(`ℹ️ Phone đã đúng, không cần cập nhật: ${trimmedPhone}`);
      }
    } else {
      console.log(`ℹ️ Không có phone từ form cho partner "${trimmedName}", giữ nguyên phone hiện tại: ${oldPhone || 'chưa có'}`);
    }
    
    // Reload partner để đảm bảo có phone mới nhất
    partner = await User.findById(partner._id).session(session);
    console.log(`✅ Trả về partner "${trimmedName}" với phone: ${partner.phone || 'chưa có'}`);
    return partner;
  }
  
  // Nếu không tìm thấy, tạo mới
  if (!partner) {
    // Tạo email base từ tên
    const emailBase = `${trimmedName.toLowerCase().replace(/\s+/g, '.')}@partner.local`;
    
    // Thử tạo với email base trước
    let email = emailBase;
    let retryCount = 0;
    const maxRetries = 5;
    
    while (retryCount < maxRetries) {
      try {
        // Xác định phone sẽ sử dụng
        let finalPhone = null;
        console.log(`🔍 Kiểm tra phone từ form:`, { 
          partnerPhone, 
          type: typeof partnerPhone, 
          hasValue: !!partnerPhone,
          length: partnerPhone ? partnerPhone.length : 0,
          trimmed: partnerPhone ? partnerPhone.trim() : null
        });
        
        if (partnerPhone && typeof partnerPhone === 'string' && partnerPhone.trim() && partnerPhone.trim().length > 0) {
          const trimmedPhone = partnerPhone.trim();
          console.log(`📱 Sử dụng phone từ form: ${trimmedPhone}`);
          
          // Kiểm tra phone đã tồn tại chưa
          const existingPhoneUser = await User.findOne({ phone: trimmedPhone }).session(session);
          if (existingPhoneUser) {
            // Nếu phone đã tồn tại và cùng role, dùng user đó
            if (existingPhoneUser.role === role) {
              partner = existingPhoneUser;
              console.log(`✅ Đã tìm thấy ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} với phone: ${trimmedPhone}`);
              break;
            } else {
              // Phone tồn tại nhưng khác role, tạo email mới với timestamp
              email = `${trimmedName.toLowerCase().replace(/\s+/g, '.')}-${Date.now()}@partner.local`;
              retryCount++;
              continue;
            }
          }
          // Phone chưa tồn tại, sử dụng phone từ form
          finalPhone = trimmedPhone;
        } else {
          // Nếu không có phone từ form, dùng số mặc định
          const defaultPhone = '0987654321';
          console.log(`📱 Không có phone từ form, sử dụng số mặc định: ${defaultPhone}`);
          finalPhone = defaultPhone;
        }
        
        // Kiểm tra xem email đã tồn tại chưa
        const existingUser = await User.findOne({ email: email }).session(session);
        
        if (existingUser && existingUser.role === role) {
          // Nếu đã tồn tại và cùng role, cập nhật phone nếu có phone từ form
          partner = existingUser;
          const oldPhone = partner.phone;
          console.log(`🔍 Tìm thấy partner theo email "${email}", phone hiện tại: ${oldPhone || 'chưa có'}`);
          
          if (partnerPhone && typeof partnerPhone === 'string' && partnerPhone.trim() && partnerPhone.trim().length > 0) {
            const trimmedPhone = partnerPhone.trim();
            console.log(`📱 Có phone từ form: ${trimmedPhone}`);
            
            if (partner.phone !== trimmedPhone) {
              partner.phone = trimmedPhone;
              await partner.save({ session });
              console.log(`✅ Đã cập nhật phone cho ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} từ "${oldPhone || 'chưa có'}" thành "${trimmedPhone}"`);
            } else {
              console.log(`ℹ️ Phone đã đúng, không cần cập nhật: ${trimmedPhone}`);
            }
          } else {
            console.log(`ℹ️ Không có phone từ form, giữ nguyên phone hiện tại: ${oldPhone || 'chưa có'}`);
          }
          
          // Reload partner để đảm bảo có phone mới nhất
          partner = await User.findById(partner._id).session(session);
          console.log(`✅ Đã tìm thấy ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} với email: ${email}, phone: ${partner.phone || 'chưa có'}`);
          break;
        } else if (existingUser) {
          // Email tồn tại nhưng khác role, tạo email mới với timestamp
          email = `${trimmedName.toLowerCase().replace(/\s+/g, '.')}-${Date.now()}@partner.local`;
          retryCount++;
          continue;
        }
        
        // Tạo partner mới với phone đã xác định
        console.log(`📝 Tạo partner mới với phone: ${finalPhone}`);
        partner = new User({
          name: trimmedName,
          email: email,
          phone: finalPhone, // Phone từ form hoặc phone mặc định
          role: role,
          password: 'partner_no_password_' + Date.now(), // Password bắt buộc nhưng không dùng để đăng nhập
          agree: true, // Bắt buộc phải có
          isActive: true,
        });
        
        await partner.save({ session });
        
        // Reload partner để đảm bảo phone đã được lưu
        partner = await User.findById(partner._id).session(session);
        console.log(`✅ Đã tạo ${type === 'income' ? 'khách hàng' : 'nhà cung cấp'} mới: ${trimmedName} (email: ${email}, phone: ${partner.phone || 'chưa có'})`);
        
        if (!partner.phone) {
          console.error(`❌ LỖI: Partner vừa tạo không có phone!`);
        }
        
        break; // Thành công, thoát khỏi vòng lặp
        
      } catch (error) {
        // Xử lý lỗi duplicate email hoặc phone
        if (error.code === 11000 || error.message.includes('duplicate') || error.message.includes('email') || error.message.includes('phone')) {
          // Email hoặc phone đã tồn tại, tạo email mới với timestamp
          email = `${trimmedName.toLowerCase().replace(/\s+/g, '.')}-${Date.now()}@partner.local`;
          retryCount++;
          
          if (retryCount >= maxRetries) {
            // Nếu retry quá nhiều lần, dùng partner mặc định
            console.warn(`⚠️ Không thể tạo partner với tên "${trimmedName}" sau ${maxRetries} lần thử. Sử dụng partner mặc định.`);
            partner = await findOrCreateDefaultPartner(type, session);
            break;
          }
        } else {
          // Lỗi khác, throw lại
          console.error(`❌ Lỗi khi tạo partner "${trimmedName}":`, error);
          throw error;
        }
      }
    }
    
    // Nếu vẫn không có partner sau vòng lặp, dùng partner mặc định
    if (!partner) {
      console.warn(`⚠️ Không thể tạo partner với tên "${trimmedName}". Sử dụng partner mặc định.`);
      partner = await findOrCreateDefaultPartner(type, session);
    }
  }
  
  // Đảm bảo partner có ID hợp lệ
  if (!partner || !partner._id) {
    console.error(`❌ Partner không hợp lệ cho "${trimmedName}". Sử dụng partner mặc định.`);
    partner = await findOrCreateDefaultPartner(type, session);
  }
  
  return partner;
}

/**
 * POST /api/accounting/post-entry
 * API Hạch toán Tổng hợp: Xử lý tất cả các nghiệp vụ thay vì transactions đơn lẻ
 * 
 * Logic:
 * 1. Mở Transaction (Atomicity): Đảm bảo nếu lưu sổ cái lỗi thì các lệnh liên quan cũng bị hủy
 * 2. Logic Mapping & Định khoản: Chuyển đổi dữ liệu đơn giản từ frontend thành các dòng Nợ/Có
 * 3. Validation: Kiểm tra Tổng Debit == Tổng Credit trước khi lưu
 * 4. Tạo Receivable/Payable nếu paymentStatus = 'unpaid' và có partnerName + dueDate
 */
router.post('/post-entry', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const { 
      amount, 
      category, 
      description, 
      date, 
      reference, 
      notes, 
      paymentStatus,
      type, // 'income' hoặc 'expense' - để xác định hướng định khoản
      partnerName, // Tên đối tác (Khách hàng/NCC) - chỉ dùng khi paymentStatus = 'unpaid'
      partnerPhone, // Số điện thoại đối tác - chỉ dùng khi paymentStatus = 'unpaid'
      dueDate,     // Ngày hạn trả/thu - chỉ dùng khi paymentStatus = 'unpaid'
      journalEntryId // ID của JournalEntry cần update (nếu đang edit)
    } = req.body;
    
    // Debug: Log dữ liệu nhận được từ frontend
    console.log('📥 Dữ liệu nhận được từ frontend:', {
      paymentStatus,
      partnerName,
      partnerPhone,
      dueDate,
      type,
      partnerNameType: typeof partnerName,
      partnerPhoneType: typeof partnerPhone,
      dueDateType: typeof dueDate,
      rawBody: JSON.stringify({ paymentStatus, partnerName, partnerPhone, dueDate, type })
    });
    
    // Validate required fields
    if (!amount || !category || !description || !date || !type) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: amount, category, description, date, type' 
      });
    }
    
    if (!['income', 'expense'].includes(type)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Type phải là "income" hoặc "expense"' });
    }
    
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Số tiền phải lớn hơn 0' });
    }
    
    // Validation: Nếu paymentStatus = 'unpaid', bắt buộc phải có partnerName, partnerPhone và dueDate
    // Tạo biến để lưu partnerName đã được trim (không thể gán lại const)
    let trimmedPartnerName = null;
    let trimmedPartnerPhone = null;
    
    if (paymentStatus === 'unpaid') {
      console.log('🔍 Bắt đầu validation cho unpaid transaction:', { 
        partnerName, 
        partnerPhone,
        dueDate,
        partnerNameType: typeof partnerName,
        partnerPhoneType: typeof partnerPhone,
        dueDateType: typeof dueDate
      });
      
      // Kiểm tra partnerName: không được undefined, null, hoặc chuỗi rỗng
      if (!partnerName || (typeof partnerName === 'string' && !partnerName.trim())) {
        await session.abortTransaction();
        console.error('❌ Validation failed: partnerName is missing or empty', { partnerName, paymentStatus });
        return res.status(400).json({ 
          message: 'Khi chưa thanh toán, bắt buộc phải có Tên Đối tác (partnerName)' 
        });
      }
      // Kiểm tra partnerPhone: không bắt buộc, nhưng nếu có thì phải đúng format
      let trimmedPartnerPhone = null;
      if (partnerPhone && typeof partnerPhone === 'string' && partnerPhone.trim()) {
        const trimmedPhone = partnerPhone.trim();
        // Validate partnerPhone format: 10-11 chữ số
        const phoneRegex = /^[0-9]{10,11}$/;
        if (!phoneRegex.test(trimmedPhone)) {
        await session.abortTransaction();
          console.error('❌ Validation failed: partnerPhone format is invalid', { partnerPhone: trimmedPhone });
          return res.status(400).json({ 
            message: 'Số điện thoại phải có 10-11 chữ số' 
          });
        }
        trimmedPartnerPhone = trimmedPhone;
      } else {
        // Không có phone từ form, sẽ tạo phone mặc định sau
        console.log('ℹ️ Không có số điện thoại từ form, sẽ tạo số mặc định');
      }
      // Kiểm tra dueDate: không được undefined, null, hoặc chuỗi rỗng
      if (!dueDate || (typeof dueDate === 'string' && !dueDate.trim())) {
        await session.abortTransaction();
        console.error('❌ Validation failed: dueDate is missing or empty', { dueDate, paymentStatus });
        return res.status(400).json({ 
          message: 'Khi chưa thanh toán, bắt buộc phải có Hạn thanh toán (dueDate)' 
        });
      }
      // Validate dueDate format
      const dueDateObj = new Date(dueDate);
      if (isNaN(dueDateObj.getTime())) {
        await session.abortTransaction();
        console.error('❌ Validation failed: dueDate format is invalid', { dueDate });
        return res.status(400).json({ 
          message: 'Ngày hạn thanh toán không hợp lệ' 
        });
      }
      // Đảm bảo partnerName là chuỗi đã trim
      trimmedPartnerName = typeof partnerName === 'string' ? partnerName.trim() : String(partnerName).trim();
      console.log('✅ Validation passed for unpaid transaction:', { 
        originalPartnerName: partnerName,
        trimmedPartnerName: trimmedPartnerName,
        trimmedPartnerPhone: trimmedPartnerPhone || '(sẽ tạo mặc định)',
        dueDate 
      });
    } else {
      console.log('ℹ️ PaymentStatus không phải unpaid, không cần partnerName, partnerPhone và dueDate:', { paymentStatus });
    }
    
    // BƯỚC 2: Logic Định khoản Tự động (Auto-Posting Logic)
    // Mapping Category sang Tài khoản Kế toán theo nguyên tắc kế toán chuẩn
    const categoryMapping = {
      // Thu nhập
      'Bán hàng': {
        income: { accountCode: '511', name: 'Doanh thu bán hàng' },
        expense: null
      },
      'Dịch vụ': {
        income: { accountCode: '511', name: 'Doanh thu dịch vụ' },
        expense: null
      },
      'Đầu tư': {
        income: { accountCode: '711', name: 'Thu nhập khác' },
        expense: null
      },
      'Khác': {
        income: { accountCode: '711', name: 'Thu nhập khác' },
        expense: null
      },
      // Chi phí - Mapping theo bảng định khoản chuẩn
      'Nguyên vật liệu': {
        income: null,
        expense: { accountCode: '156', name: 'Hàng hóa' }, // TK 156: Hàng hóa (Kho)
        // Khi unpaid: Nợ 156 (Kho) / Có 331 (Phải trả NCC) - Nhập hàng mới
        // Khi paid: Nợ 156 (Kho) / Có 111/112 (Tiền) - Nhập hàng trả tiền ngay
        // Lưu ý: TK 152 là Nguyên vật liệu (dùng cho sản xuất), TK 156 là Hàng hóa (dùng cho thương mại)
      },
      'Lương nhân viên': {
        income: null,
        expense: { accountCode: '642', name: 'Chi phí quản lý doanh nghiệp' },
        // Đặc biệt: Nợ TK 642 / Có TK 334 (Phải trả lương) - theo Cơ sở Dồn tích
        // Không phụ thuộc vào paymentStatus, luôn ghi nhận công nợ lương
        specialCreditAccount: '334', // TK đặc biệt cho lương
        isSalary: true
      },
      'Marketing': {
        income: null,
        expense: { accountCode: '641', name: 'Chi phí bán hàng' },
        // Khi paid: Nợ 641 / Có 111/112 (Tiền)
        // Khi unpaid: Nợ 641 / Có 331 (Phải trả NCC)
      },
      'Vận chuyển': {
        income: null,
        expense: { accountCode: '642', name: 'Chi phí quản lý doanh nghiệp' },
      },
      'Điện nước': {
        income: null,
        expense: { accountCode: '642', name: 'Chi phí quản lý doanh nghiệp' },
        // Khi unpaid: Nợ 642 / Có 331 (Phải trả NCC) - Nhận hóa đơn, ghi nhận nợ phải trả
        // Khi paid: Nợ 642 / Có 111/112 (Tiền)
      },
      'Thuê mặt bằng': {
        income: null,
        expense: { accountCode: '642', name: 'Chi phí quản lý doanh nghiệp' },
      },
      'Bảo trì': {
        income: null,
        expense: { accountCode: '642', name: 'Chi phí quản lý doanh nghiệp' },
      },
      'Khác': {
        income: null,
        expense: { accountCode: '811', name: 'Chi phí khác' }
      }
    };
    
    // Lấy mapping cho category
    const mapping = categoryMapping[category] || categoryMapping['Khác'];
    const accountMapping = type === 'income' ? mapping.income : mapping.expense;
    
    if (!accountMapping) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: `Category "${category}" không hợp lệ cho type "${type}"` 
      });
    }
    
    // Xác định tài khoản CÓ (Credit) dựa trên category và paymentStatus
    let creditAccountCode = null;
    
    if (type === 'income') {
      // Thu nhập: Có TK Doanh thu (511/711) hoặc TK Doanh thu chưa thực hiện (3387)
      
      // Khách hàng đã thanh toán bằng tiền mặt/chuyển khoản (PAID)
      if (paymentStatus === 'paid') {
        // Bổ sung logic kiểm tra Doanh thu chưa thực hiện cho Bán hàng/Dịch vụ
        if (category === 'Bán hàng' || category === 'Dịch vụ') {
          // Trường hợp: Nhận tiền trước khi giao hàng
          // Ghi nhận Nghĩa vụ (Nợ phải trả) thay vì Doanh thu (TK 511)
          // Vì form này không biết hàng đã giao chưa, nên chuyển sang TK 3387 để điều chỉnh sau.
          creditAccountCode = '3387'; // TK Doanh thu chưa thực hiện (Nợ phải trả - Liability)
          // GHI CHÚ: Sau đó cần bút toán điều chỉnh: Nợ TK 3387 / Có TK 511 khi hàng thực sự được giao.
        } else {
          // Thu nhập khác (VD: Lãi tiền gửi - 711): Ghi nhận Doanh thu luôn
          creditAccountCode = accountMapping.accountCode; // TK 711
        }
      } else {
        // Chưa nhận tiền (unpaid): Ghi nhận Doanh thu bình thường (TK 511)
        creditAccountCode = accountMapping.accountCode; // TK 511
      }
    } else {
      // Chi phí: Xác định TK CÓ dựa trên category và paymentStatus
      if (mapping.isSalary && category === 'Lương nhân viên') {
        // Đặc biệt: Lương nhân viên luôn ghi Nợ 642 / Có 334 (Phải trả lương)
        // Theo Cơ sở Dồn tích: Ghi nhận chi phí lương phát sinh, không phụ thuộc paymentStatus
        creditAccountCode = mapping.specialCreditAccount || '334';
      } else if (paymentStatus === 'paid') {
        // Đã thanh toán: Có TK Tiền (111/1121)
        creditAccountCode = '1121'; // Tiền gửi ngân hàng (mặc định)
      } else {
        // Chưa thanh toán: Có TK Công nợ
        // Điện nước và các chi phí khác: Có TK 331 (Phải trả NCC)
        creditAccountCode = '331'; // Phải trả nhà cung cấp
      }
    }
    
    // Xác định tài khoản NỢ (Debit) dựa trên type và paymentStatus
    let debitAccountCode = null;
    let isDebt = false; // Flag để xác định có cần tạo Receivable/Payable không
    
    if (type === 'income') {
      // Thu nhập: Nợ TK Tiền/Công nợ
      if (paymentStatus === 'paid') {
        debitAccountCode = '1121'; // Tiền gửi ngân hàng
      } else {
        // LUỒNG COD: Ghi nhận Phải Thu (TK 131)
        debitAccountCode = '131'; // Phải thu khách hàng
        isDebt = true; // Cần tạo Receivable
      }
    } else {
      // Chi phí: Nợ TK Chi phí
      debitAccountCode = accountMapping.accountCode;
      
      // Nếu chưa thanh toán, cần tạo Payable
      if (paymentStatus === 'unpaid' && creditAccountCode === '331') {
        isDebt = true; // Cần tạo Payable
      }
    }
    
    // Debug: Log thông tin về isDebt và các điều kiện
    console.log('🔍 Debug thông tin định khoản:', {
      type,
      paymentStatus,
      debitAccountCode,
      creditAccountCode,
      isDebt,
      trimmedPartnerName,
      dueDate,
      hasPartnerName: !!trimmedPartnerName,
      hasDueDate: !!dueDate
    });
    
    // Helper function: Tự động tạo account code nếu chưa tồn tại
    async function ensureAccountExists(code, name, accountType, accountTypeName, level = 1, parentCode = null, notes = '') {
      let account = await Account.findOne({ code }).session(session);
      if (!account) {
        // Tự động tạo account code còn thiếu
        account = new Account({
          code,
          name,
          accountType,
          accountTypeName,
          level,
          parentCode,
          notes,
          status: 'active'
        });
        await account.save({ session });
        console.log(`✅ Đã tự động tạo tài khoản: ${code} - ${name}`);
      }
      return account;
    }
    
    // Mapping các account codes còn thiếu (không có trong seed script)
    const accountCodeDefinitions = {
      '111': { name: 'Tiền mặt', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Tiền mặt tại quỹ' },
      '1121': { name: 'Tiền gửi ngân hàng', accountType: 'asset', accountTypeName: 'Tài sản', level: 2, parentCode: '112', notes: 'Tiền gửi ngân hàng' },
      '131': { name: 'Phải thu khách hàng', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Các khoản phải thu từ khách hàng' },
      '156': { name: 'Hàng hóa', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Hàng hóa tồn kho' },
      '331': { name: 'Phải trả người bán', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Các khoản phải trả cho nhà cung cấp' },
      '334': { name: 'Phải trả người lao động', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Các khoản phải trả lương cho nhân viên' },
      '3387': { name: 'Doanh thu chưa thực hiện', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Khách hàng trả trước, chờ giao hàng. Theo Nguyên tắc Cơ sở Dồn tích, chỉ ghi nhận doanh thu khi đã giao hàng.' },
      '511': { name: 'Doanh thu bán hàng', accountType: 'revenue', accountTypeName: 'Doanh thu', level: 1, notes: 'Doanh thu từ việc bán hàng hóa, dịch vụ' },
      '641': { name: 'Chi phí bán hàng', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí liên quan đến bán hàng' },
      '642': { name: 'Chi phí quản lý doanh nghiệp', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí quản lý chung' },
      '711': { name: 'Thu nhập khác', accountType: 'revenue', accountTypeName: 'Doanh thu', level: 1, notes: 'Các khoản thu nhập khác ngoài doanh thu bán hàng' },
      '811': { name: 'Chi phí khác', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí khác không thuộc chi phí bán hàng hoặc quản lý' },
    };
    
    // Kiểm tra và tự động tạo các account codes còn thiếu
    const accountCodesToCheck = [debitAccountCode, creditAccountCode].filter(Boolean);
    const accounts = [];
    
    for (const code of accountCodesToCheck) {
      let account = await Account.findOne({ code }).session(session);
      if (!account) {
        // Tự động tạo account code nếu có định nghĩa
        const definition = accountCodeDefinitions[code];
        if (definition) {
          account = await ensureAccountExists(
            code,
            definition.name,
            definition.accountType,
            definition.accountTypeName,
            definition.level,
            definition.parentCode,
            definition.notes
          );
        } else {
          // Nếu không có định nghĩa, trả về lỗi với thông tin chi tiết
          await session.abortTransaction();
          return res.status(400).json({ 
            message: `Tài khoản ${code} không tồn tại và không có định nghĩa tự động. Vui lòng tạo tài khoản này trong hệ thống trước khi sử dụng.`,
            missingAccount: code,
            suggestion: 'Chạy script seed-accounts.js hoặc tạo tài khoản thủ công qua API POST /api/accounting/accounts'
          });
        }
      }
      accounts.push(account);
    }
    
    // Nếu đang edit (có journalEntryId), tìm entry cũ để update
    let existingEntry = null;
    if (journalEntryId) {
      console.log(`🔍 Đang tìm JournalEntry để edit: ${journalEntryId}`);
      existingEntry = await JournalEntry.findById(journalEntryId).session(session);
      if (!existingEntry) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Không tìm thấy chứng từ cần sửa' });
      }
      console.log(`✅ Tìm thấy JournalEntry để edit: ${existingEntry.referenceNo}`);
    } else {
      console.log('📝 Tạo JournalEntry mới (không có journalEntryId)');
    }
    
    // Tạo số chứng từ tự động nếu chưa có
    const referenceNo = reference || (existingEntry ? existingEntry.referenceNo : `JE-${new Date(date).getFullYear()}${String(new Date(date).getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-6)}`);
    
    // Kiểm tra số chứng từ đã tồn tại chưa (chỉ khi không phải đang edit entry hiện tại)
    if (!existingEntry || existingEntry.referenceNo !== referenceNo) {
      const duplicateEntry = await JournalEntry.findOne({ referenceNo }).session(session);
      if (duplicateEntry) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
      }
    }
    
    // Tạo các dòng bút toán theo nguyên tắc Nợ = Có
    const lines = [];
    
    if (type === 'income') {
      // Thu nhập: Nợ Tiền/Công nợ / Có Doanh thu hoặc Doanh thu chưa thực hiện
      lines.push({
        accountCode: debitAccountCode, // Nợ TK Tiền (1121) hoặc Công nợ (131)
        debit: amountNum,
        credit: 0,
        description: description,
      });
      
      // Xác định description cho TK Có dựa trên creditAccountCode
      let creditDescription = '';
      if (creditAccountCode === '3387') {
        // TK 3387: Doanh thu chưa thực hiện
        creditDescription = `Doanh thu chưa thực hiện - ${category} (Nhận tiền trước, chờ giao hàng)`;
      } else {
        // TK 511 hoặc 711: Doanh thu/Thu nhập
        creditDescription = `${accountMapping.name} - ${category}`;
      }
      
      lines.push({
        accountCode: creditAccountCode, // Có TK Doanh thu (511/711) hoặc Doanh thu chưa thực hiện (3387)
        debit: 0,
        credit: amountNum,
        description: creditDescription,
      });
    } else {
      // Chi phí: Nợ Chi phí / Có Tiền/Công nợ
      lines.push({
        accountCode: debitAccountCode, // Nợ TK Chi phí (621, 641, 642, 811, etc.)
        debit: amountNum,
        credit: 0,
        description: `${accountMapping.name} - ${category}`,
      });
      lines.push({
        accountCode: creditAccountCode, // Có TK Tiền (1121) hoặc Công nợ (331/334)
        debit: 0,
        credit: amountNum,
        description: description,
      });
    }
    
    // Validation: Kiểm tra Tổng Debit == Tổng Credit
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Chứng từ không cân bằng. Tổng Nợ phải bằng Tổng Có',
        totalDebit,
        totalCredit
      });
    }
    
    // Tạo hoặc cập nhật Journal Entry
    let entry;
    if (existingEntry) {
      // Update entry hiện có
      entry = existingEntry;
      entry.referenceNo = referenceNo;
      entry.date = new Date(date);
      entry.memo = description;
      entry.entryType = type === 'income' ? 'receipt' : 'payment';
      entry.lines = lines;
      entry.updatedAt = new Date();
      
      // Cập nhật notes nếu có (có thể lưu vào memo hoặc tạo field riêng)
      // Hiện tại notes được lưu trong memo, nếu cần có thể tạo field riêng sau
      if (notes) {
        // Có thể append notes vào memo hoặc tạo field riêng
        // Tạm thời giữ nguyên memo là description
      }
      
      console.log(`✅ Đang cập nhật JournalEntry ${entry._id} với dữ liệu mới`);
    } else {
      // Tạo entry mới
      entry = new JournalEntry({
        referenceNo,
        date: new Date(date),
        postingDate: new Date(),
        memo: description,
        entryType: type === 'income' ? 'receipt' : 'payment', // 'receipt' = Phiếu thu, 'payment' = Phiếu chi
        lines: lines,
        sourceType: 'MANUAL',
        createdBy: req.userId || null,
        status: 'posted',
      });
    }
    
    await entry.save({ session });
    
    // Log để debug
    if (existingEntry) {
      console.log(`✅ Đã cập nhật JournalEntry ${entry._id} thành công`);
    } else {
      console.log(`✅ Đã tạo JournalEntry ${entry._id} mới`);
    }
    
    // BƯỚC 3: Xử lý công nợ (Receivable/Payable)
    // Nếu đang edit, xóa Receivable/Payable cũ trước
    if (existingEntry) {
      const deletedReceivables = await Receivable.deleteMany({ journalEntry: entry._id }).session(session);
      const deletedPayables = await Payable.deleteMany({ journalEntry: entry._id }).session(session);
      console.log(`🗑️ Đã xóa ${deletedReceivables.deletedCount} Receivable và ${deletedPayables.deletedCount} Payable cũ`);
    }
    
    // Tạo công nợ (Receivable/Payable) nếu cần
    // Chỉ tạo khi paymentStatus = 'unpaid' và có partnerName + dueDate
    console.log('🔍 Kiểm tra tạo công nợ:', {
      isDebt,
      partnerName: trimmedPartnerName,
      dueDate,
      paymentStatus,
      type,
      debitAccountCode,
      creditAccountCode
    });
    
    // Kiểm tra lại partnerName và dueDate trước khi tạo Receivable/Payable
    // (đã được validate ở trên, nhưng kiểm tra lại để đảm bảo)
    // Sử dụng trimmedPartnerName thay vì partnerName (đã được trim ở validation)
    // CHỈ kiểm tra khi paymentStatus === 'unpaid' (vì chỉ khi đó mới cần tạo Receivable/Payable)
    const hasValidPartnerInfo = paymentStatus === 'unpaid' &&
                                 trimmedPartnerName && 
                                 typeof trimmedPartnerName === 'string' && 
                                 trimmedPartnerName.trim() && 
                                 trimmedPartnerName.length > 0 &&
                                 dueDate && 
                                 typeof dueDate === 'string' && 
                                 dueDate.trim() &&
                                 dueDate.length > 0;
    
    console.log('🔍 Kiểm tra hasValidPartnerInfo:', {
      paymentStatus,
      isDebt,
      trimmedPartnerName,
      dueDate,
      hasValidPartnerInfo,
      partnerNameType: typeof trimmedPartnerName,
      partnerNameValue: trimmedPartnerName,
      partnerNameLength: trimmedPartnerName ? trimmedPartnerName.length : 0,
      dueDateType: typeof dueDate,
      dueDateValue: dueDate,
      partnerNameCheck: trimmedPartnerName && typeof trimmedPartnerName === 'string' && trimmedPartnerName.trim() && trimmedPartnerName.length > 0,
      dueDateCheck: dueDate && typeof dueDate === 'string' && dueDate.trim() && dueDate.length > 0
    });
    
    if (isDebt && hasValidPartnerInfo) {
      try {
        // Tìm hoặc tạo Partner từ tên và số điện thoại (hàm này đã xử lý lỗi và fallback về partner mặc định)
        // Nếu không có phone, hàm sẽ dùng số mặc định 0987654321
        let partner;
        try {
          console.log(`🔍 Gọi findOrCreatePartner với:`, {
            partnerName: trimmedPartnerName,
            partnerPhone: trimmedPartnerPhone,
            partnerPhoneType: typeof trimmedPartnerPhone,
            hasPhone: !!trimmedPartnerPhone,
            phoneLength: trimmedPartnerPhone ? trimmedPartnerPhone.length : 0,
            phoneValue: trimmedPartnerPhone || '(sẽ dùng mặc định 0987654321)'
          });
          
          partner = await findOrCreatePartner(trimmedPartnerName, trimmedPartnerPhone, type, session);
          
          // Reload partner một lần nữa để đảm bảo có phone mới nhất
          partner = await User.findById(partner._id).session(session);
          
          console.log(`✅ Đã tìm/tạo Partner: ${trimmedPartnerName}`, {
            partnerId: partner._id,
            partnerPhone: partner.phone || 'chưa có',
            partnerPhoneFromForm: trimmedPartnerPhone || 'không có',
            phoneMatches: trimmedPartnerPhone ? (partner.phone === trimmedPartnerPhone) : 'N/A'
          });
          
          // Đảm bảo phone đã được lưu
          if (partner.phone) {
            console.log(`✅ Phone đã được lưu vào database: ${partner.phone}`);
            if (trimmedPartnerPhone && partner.phone !== trimmedPartnerPhone) {
              console.warn(`⚠️ Phone trong database (${partner.phone}) khác với phone từ form (${trimmedPartnerPhone})`);
            }
          } else {
            console.error(`❌ LỖI: Partner không có phone sau khi tạo/tìm!`);
          }
        } catch (partnerError) {
          console.error(`❌ Lỗi khi tạo/tìm partner "${trimmedPartnerName}":`, partnerError);
          // Fallback về partner mặc định
          console.log(`🔄 Sử dụng partner mặc định cho "${trimmedPartnerName}"`);
          partner = await findOrCreateDefaultPartner(type, session);
        }
        
        // Đảm bảo partner có ID hợp lệ
        if (!partner || !partner._id) {
          console.error(`❌ Partner không hợp lệ cho "${trimmedPartnerName}". Sử dụng partner mặc định.`);
          partner = await findOrCreateDefaultPartner(type, session);
        }
        
        // Final check: Đảm bảo partner có phone
        if (!partner.phone) {
          console.error(`❌ LỖI NGHIÊM TRỌNG: Partner cuối cùng không có phone!`, {
            partnerId: partner._id,
            partnerName: partner.name,
            partnerEmail: partner.email
          });
        }
        
        console.log(`🔍 Kiểm tra điều kiện tạo Receivable/Payable:`, {
          type,
          debitAccountCode,
          creditAccountCode,
          condition1: type === 'income' && debitAccountCode === '131',
          condition2: type === 'expense' && creditAccountCode === '331'
        });
        
        if (type === 'income' && debitAccountCode === '131') {
          // Tạo Receivable cho công nợ phải thu (COD)
          console.log(`📝 Bắt đầu tạo Receivable với dữ liệu:`, {
            journalEntry: entry._id,
            customer: partner._id,
            originalAmount: amountNum,
            dueDate: new Date(dueDate),
            invoiceDate: new Date(date),
            description: description || `Công nợ từ ${referenceNo} - Đối tác: ${trimmedPartnerName}`
          });
          
          const receivable = new Receivable({
            journalEntry: entry._id,
            customer: partner._id,
            originalAmount: amountNum,
            remainingAmount: amountNum,
            paymentStatus: 'unpaid',
            dueDate: new Date(dueDate), // Dùng hạn trả từ form
            invoiceDate: new Date(date),
            description: description || `Công nợ từ ${referenceNo} - Đối tác: ${trimmedPartnerName}`,
          });
          
          try {
          await receivable.save({ session });
            console.log(`✅ Đã tạo Receivable thành công:`, {
              receivableId: receivable._id,
              partnerName: trimmedPartnerName,
              partnerId: partner._id,
              dueDate: dueDate,
              dueDateObj: new Date(dueDate)
            });
          } catch (saveError) {
            console.error(`❌ Lỗi khi save Receivable:`, saveError);
            throw saveError; // Re-throw để catch bên ngoài xử lý
          }
        } else if (type === 'expense' && creditAccountCode === '331') {
          // Tạo Payable cho công nợ phải trả
          console.log(`📝 Bắt đầu tạo Payable với dữ liệu:`, {
            journalEntry: entry._id,
            supplier: partner._id,
            originalAmount: amountNum,
            dueDate: new Date(dueDate),
            invoiceDate: new Date(date),
            description: description || `Công nợ từ ${referenceNo} - Đối tác: ${trimmedPartnerName}`
          });
          
          // Map category sang billType enum hợp lệ
          // Payable.billType chỉ nhận: 'purchase', 'expense', 'service'
          let billType = 'expense'; // Mặc định
          if (category === 'Nguyên vật liệu' || category === 'Hàng hóa') {
            billType = 'purchase';
          } else if (category === 'Dịch vụ' || category === 'Marketing' || category === 'Vận chuyển') {
            billType = 'service';
          } else {
            // Các category khác như 'Điện nước', 'Thuê mặt bằng', 'Bảo trì', 'Lương nhân viên', 'Khác'
            billType = 'expense';
          }
          
          const payable = new Payable({
            journalEntry: entry._id,
            supplier: partner._id,
            billType: billType, // Dùng enum hợp lệ
            originalAmount: amountNum,
            remainingAmount: amountNum,
            paymentStatus: 'unpaid',
            dueDate: new Date(dueDate), // Dùng hạn trả từ form
            invoiceDate: new Date(date),
            description: description || `Công nợ từ ${referenceNo} - Đối tác: ${trimmedPartnerName} (${category})`,
            approvalStatus: 'approved',
            approvedBy: req.userId || null,
            approvedAt: new Date(),
          });
          
          try {
          await payable.save({ session });
            console.log(`✅ Đã tạo Payable thành công:`, {
              payableId: payable._id,
              partnerName: trimmedPartnerName,
              partnerId: partner._id,
              dueDate: dueDate,
              dueDateObj: new Date(dueDate)
            });
          } catch (saveError) {
            console.error(`❌ Lỗi khi save Payable:`, saveError);
            throw saveError; // Re-throw để catch bên ngoài xử lý
          }
        } else {
          console.warn(`⚠️ Không tạo Receivable/Payable vì không đúng điều kiện:`, {
            type,
            debitAccountCode,
            creditAccountCode,
            expectedForIncome: 'type=income && debitAccountCode=131',
            expectedForExpense: 'type=expense && creditAccountCode=331',
            actual: `type=${type}, debitAccountCode=${debitAccountCode}, creditAccountCode=${creditAccountCode}`
          });
        }
      } catch (error) {
        console.error('❌ Lỗi khi tạo Receivable/Payable:', error);
        console.error('❌ Chi tiết lỗi:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code
        });
        // Abort transaction và trả lỗi về frontend
        await session.abortTransaction();
        return res.status(500).json({ 
          message: 'Lỗi khi tạo công nợ (Receivable/Payable)',
          error: error.message,
          details: {
            partnerName: trimmedPartnerName,
            dueDate: dueDate,
            type: type
          }
        });
      }
    } else {
      // Log chi tiết tại sao không tạo Receivable/Payable
      if (isDebt) {
        console.warn(`⚠️ Không tạo Receivable/Payable vì thiếu thông tin:`, {
        isDebt,
          hasValidPartnerInfo,
          trimmedPartnerName,
          dueDate,
          partnerNameCheck: trimmedPartnerName && typeof trimmedPartnerName === 'string' && trimmedPartnerName.trim() && trimmedPartnerName.length > 0,
          dueDateCheck: dueDate && typeof dueDate === 'string' && dueDate.trim() && dueDate.length > 0
      });
    } else {
        console.log('ℹ️ Không cần tạo Receivable/Payable:', { 
          isDebt, 
          paymentStatus, 
          trimmedPartnerName, 
          dueDate,
          reason: paymentStatus === 'paid' ? 'Đã thanh toán' : 'Không phải công nợ'
        });
      }
    }
    
    // LƯU Ý: Lương nhân viên (TK 334) không tạo Payable vì:
    // - Payable model được thiết kế cho công nợ với nhà cung cấp (supplier required)
    // - Lương nhân viên đã được theo dõi đầy đủ qua JournalEntry với TK 334 (Phải trả người lao động)
    // - Có thể truy vết công nợ lương qua JournalEntry và TK 334 trong sổ cái
    
    // Commit transaction
    await session.commitTransaction();
    
    // Populate để trả về đầy đủ thông tin
    await entry.populate('createdBy', 'name email');
    
    return res.status(201).json({ 
      message: 'Hạch toán thành công',
      entry 
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error posting entry:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    
    return res.status(500).json({ 
      message: 'Lỗi khi hạch toán',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

// ==========================================
// INTERNAL TRANSFER (Luân chuyển Tiền nội bộ)
// ==========================================

/**
 * POST /api/accounting/internal-transfer
 * API Chuyển quỹ nội bộ: Chuyển tiền giữa các TK Tài sản (111, 1121, 1122, etc.)
 * 
 * Logic: Nợ TK To / Có TK From (Bút toán này không ảnh hưởng Lãi/Lỗ)
 * Ví dụ: Rút tiền từ Ngân hàng về Quỹ Tiền mặt
 *   - Nợ TK 111 (Tiền mặt) / Có TK 1121 (Tiền gửi ngân hàng)
 */
router.post('/internal-transfer', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const { 
      fromAccountCode,  // TK Nguồn (Có)
      toAccountCode,    // TK Đích (Nợ)
      amount,
      description,
      date,
      reference
    } = req.body;
    
    // Validate required fields
    if (!fromAccountCode || !toAccountCode || !amount || !date) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: fromAccountCode, toAccountCode, amount, date' 
      });
    }
    
    // Validate: Không được chuyển cùng một tài khoản
    if (fromAccountCode === toAccountCode) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Không thể chuyển tiền trong cùng một tài khoản' 
      });
    }
    
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Số tiền phải lớn hơn 0' });
    }
    
    // Kiểm tra tài khoản có tồn tại không
    const accounts = await Account.find({ 
      code: { $in: [fromAccountCode, toAccountCode] } 
    }).session(session);
    
    if (accounts.length !== 2) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Một hoặc nhiều tài khoản không tồn tại trong hệ thống',
        missingAccounts: [fromAccountCode, toAccountCode].filter(code => 
          !accounts.find(acc => acc.code === code)
        )
      });
    }
    
    // Validate: Cả hai TK phải là Tài sản (Asset)
    const fromAccount = accounts.find(acc => acc.code === fromAccountCode);
    const toAccount = accounts.find(acc => acc.code === toAccountCode);
    
    if (fromAccount.accountType !== 'asset' || toAccount.accountType !== 'asset') {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Chỉ có thể chuyển tiền giữa các Tài khoản Tài sản (Asset)' 
      });
    }
    
    // Tạo số chứng từ tự động nếu chưa có
    const referenceNo = reference || `TF-${new Date(date).getFullYear()}${String(new Date(date).getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-6)}`;
    
    // Kiểm tra số chứng từ đã tồn tại chưa
    const existingEntry = await JournalEntry.findOne({ referenceNo }).session(session);
    if (existingEntry) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    
    // Tạo các dòng bút toán: Nợ TK To / Có TK From
    const lines = [
      {
        accountCode: toAccountCode, // Nợ TK Đích
        debit: amountNum,
        credit: 0,
        description: description || `Chuyển từ TK ${fromAccountCode}`,
      },
      {
        accountCode: fromAccountCode, // Có TK Nguồn
        debit: 0,
        credit: amountNum,
        description: description || `Chuyển đến TK ${toAccountCode}`,
      }
    ];
    
    // Validation: Kiểm tra Tổng Nợ = Tổng Có
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Chứng từ không cân bằng. Tổng Nợ phải bằng Tổng Có',
        totalDebit,
        totalCredit
      });
    }
    
    // Tạo Journal Entry
    const entry = new JournalEntry({
      referenceNo,
      date: new Date(date),
      postingDate: new Date(),
      memo: description || `Chuyển quỹ: ${fromAccountCode} → ${toAccountCode}`,
      entryType: 'transfer',
      lines: lines,
      sourceType: 'MANUAL',
      createdBy: req.userId || null,
      status: 'posted',
    });
    
    await entry.save({ session });
    
    // Commit transaction
    await session.commitTransaction();
    
    // Populate để trả về đầy đủ thông tin
    await entry.populate('createdBy', 'name email');
    
    return res.status(201).json({ 
      message: 'Chuyển quỹ thành công',
      entry 
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error internal transfer:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    
    return res.status(500).json({ 
      message: 'Lỗi khi chuyển quỹ',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

// ==========================================
// FIXED ASSETS & DEPRECIATION (Tài sản Cố định & Khấu hao)
// ==========================================

/**
 * POST /api/accounting/fixed-assets
 * Tạo tài sản cố định mới và hạch toán mua tài sản
 */
router.post('/fixed-assets', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const {
      name,
      assetCode,
      originalCost,
      purchaseDate,
      usefulLife,
      purchaseAccountCode, // TK mua tài sản (111, 1121, 331, etc.)
      description,
      notes
    } = req.body;
    
    // Validate
    if (!name || !originalCost || !purchaseDate || !usefulLife || !purchaseAccountCode) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: name, originalCost, purchaseDate, usefulLife, purchaseAccountCode' 
      });
    }
    
    const costNum = parseFloat(originalCost);
    const lifeNum = parseInt(usefulLife);
    
    if (isNaN(costNum) || costNum <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Nguyên giá phải lớn hơn 0' });
    }
    
    if (isNaN(lifeNum) || lifeNum <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Thời gian sử dụng phải lớn hơn 0 tháng' });
    }
    
    // Kiểm tra tài khoản mua tài sản
    const purchaseAccount = await Account.findOne({ code: purchaseAccountCode }).session(session);
    if (!purchaseAccount) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Tài khoản mua tài sản không tồn tại' });
    }
    
    // Tạo Fixed Asset
    const fixedAsset = new FixedAsset({
      name,
      assetCode: assetCode || `FA-${Date.now()}`,
      originalCost: costNum,
      purchaseDate: new Date(purchaseDate),
      usefulLife: lifeNum,
      notes: notes || '',
    });
    
    await fixedAsset.save({ session });
    
    // Tạo bút toán mua tài sản: Nợ TK 211 (TSCĐ) / Có TK Mua (111/1121/331)
    const referenceNo = `FA-${new Date(purchaseDate).getFullYear()}${String(new Date(purchaseDate).getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-6)}`;
    
    const lines = [
      {
        accountCode: '211', // Tài sản cố định
        debit: costNum,
        credit: 0,
        description: `Mua tài sản: ${name}`,
      },
      {
        accountCode: purchaseAccountCode,
        debit: 0,
        credit: costNum,
        description: description || `Thanh toán mua tài sản: ${name}`,
      }
    ];
    
    const journalEntry = new JournalEntry({
      referenceNo,
      date: new Date(purchaseDate),
      postingDate: new Date(),
      memo: `Mua tài sản cố định: ${name}`,
      entryType: 'purchase',
      sourceId: fixedAsset._id,
      sourceType: 'fixed_asset',
      lines: lines,
      createdBy: req.userId || null,
      status: 'posted',
    });
    
    await journalEntry.save({ session });
    
    await session.commitTransaction();
    
    return res.status(201).json({
      message: 'Tạo tài sản cố định thành công',
      fixedAsset,
      journalEntry
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error creating fixed asset:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Mã tài sản đã tồn tại' });
    }
    
    return res.status(500).json({ 
      message: 'Lỗi khi tạo tài sản cố định',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/accounting/depreciation/calculate
 * Tính toán và hạch toán khấu hao cho tất cả tài sản cố định trong tháng
 * (Có thể gọi thủ công hoặc tự động qua Cron Job)
 */
router.post('/depreciation/calculate', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const { month } = req.body; // Format: YYYY-MM (VD: '2024-01')
    const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    
    // Lấy tất cả tài sản đang hoạt động
    const activeAssets = await FixedAsset.find({ 
      status: 'active' 
    }).session(session);
    
    const results = [];
    
    for (const asset of activeAssets) {
      // Kiểm tra xem đã khấu hao tháng này chưa
      const alreadyDepreciated = asset.depreciationHistory.some(
        dep => dep.month === targetMonth
      );
      
      if (alreadyDepreciated) {
        console.log(`Tài sản ${asset.name} đã được khấu hao trong tháng ${targetMonth}`);
        continue;
      }
      
      // Kiểm tra xem đã khấu hao hết chưa
      if (asset.accumulatedDepreciation >= asset.originalCost) {
        console.log(`Tài sản ${asset.name} đã khấu hao hết`);
        continue;
      }
      
      // Tính khấu hao tháng này
      const monthlyDepreciation = asset.monthlyDepreciation || (asset.originalCost / asset.usefulLife);
      const remainingValue = asset.originalCost - asset.accumulatedDepreciation;
      const depreciationAmount = Math.min(monthlyDepreciation, remainingValue); // Không khấu hao quá giá trị còn lại
      
      if (depreciationAmount <= 0) continue;
      
      // Tạo bút toán khấu hao: Nợ TK 642 / Có TK 214
      const referenceNo = `DEP-${targetMonth}-${asset.assetCode || asset._id.toString().slice(-6)}`;
      
      // Kiểm tra số chứng từ đã tồn tại chưa
      const existingEntry = await JournalEntry.findOne({ referenceNo }).session(session);
      if (existingEntry) {
        console.log(`Journal entry ${referenceNo} đã tồn tại`);
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
        createdBy: req.userId || null,
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
        journalEntry: journalEntry._id
      });
    }
    
    await session.commitTransaction();
    
    return res.status(200).json({
      message: `Đã tính khấu hao cho ${results.length} tài sản`,
      month: targetMonth,
      results
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error calculating depreciation:', error);
    return res.status(500).json({ 
      message: 'Lỗi khi tính khấu hao',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

// ==========================================
// TRANSACTIONS (Giao dịch nội bộ)
// ==========================================

// GET /api/accounting/transactions - Lấy danh sách giao dịch
router.get('/transactions', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { 
      type,
      category,
      paymentStatus,
      startDate,
      endDate,
      page = 1,
      limit = 100
    } = req.query;
    
    let query = {};
    
    if (type) query.type = type;
    if (category) query.category = category;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const transactions = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await Transaction.countDocuments(query);
    
    return res.status(200).json({ 
      transactions,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách giao dịch' });
  }
});

// POST /api/accounting/transactions - Tạo giao dịch mới
router.post('/transactions', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { type, amount, description, category, date, reference, notes, paymentStatus } = req.body;
    
    // Validate
    if (!type || !amount || !description || !category || !date) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }
    
    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ message: 'Loại giao dịch không hợp lệ' });
    }
    
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Số tiền phải lớn hơn 0' });
    }
    
    const transaction = new Transaction({
      type,
      amount: parseFloat(amount),
      description,
      category,
      date: new Date(date),
      reference: reference || '',
      notes: notes || '',
      paymentStatus: paymentStatus || 'paid',
      createdBy: req.userId || null,
    });
    
    await transaction.save();
    
    // Nếu paymentStatus = 'unpaid', tự động tạo công nợ
    if (paymentStatus === 'unpaid') {
      try {
        console.log(`Creating debt for transaction: type=${type}, amount=${amount}, paymentStatus=${paymentStatus}`);
        
        // Tìm hoặc tạo customer/supplier trước
        let customer = null;
        let supplier = null;
        
        if (type === 'income') {
          // Tìm customer mặc định hoặc tạo mới
          customer = await User.findOne({ role: 'customer' });
          if (!customer) {
            // Tạo customer mặc định từ thông tin transaction
            const customerName = description.split('-')[0]?.trim() || description.split(' ')[0] || 'Khách hàng';
            const customerEmail = `customer-${Date.now()}@temp.com`;
            customer = new User({
              name: customerName,
              email: customerEmail,
              phone: reference || '',
              role: 'customer',
              password: 'temp123456', // Password tạm
            });
            await customer.save();
            console.log(`Created default customer: ${customer._id}`);
          }
        } else {
          // Tìm supplier mặc định hoặc tạo mới
          supplier = await User.findOne({ role: 'supplier' });
          if (!supplier) {
            // Tạo supplier mặc định từ thông tin transaction
            const supplierName = description.split('-')[0]?.trim() || description.split(' ')[0] || 'Nhà cung cấp';
            const supplierEmail = `supplier-${Date.now()}@temp.com`;
            supplier = new User({
              name: supplierName,
              email: supplierEmail,
              phone: reference || '',
              role: 'supplier',
              password: 'temp123456', // Password tạm
            });
            await supplier.save();
            console.log(`Created default supplier: ${supplier._id}`);
          }
        }
        
        // Tìm tài khoản để tạo journalEntry
        let debtAccount = null;
        let counterpartAccount = null;
        
        if (type === 'income') {
          // Tài khoản Phải thu khách hàng (131)
          debtAccount = await Account.findOne({ code: '131' });
          if (!debtAccount) {
            debtAccount = await Account.findOne({ accountType: 'asset', status: 'active' });
          }
          // Tài khoản Doanh thu (511)
          counterpartAccount = await Account.findOne({ code: '511' });
          if (!counterpartAccount) {
            counterpartAccount = await Account.findOne({ accountType: 'revenue', status: 'active' });
          }
        } else {
          // Tài khoản Phải trả nhà cung cấp (331)
          debtAccount = await Account.findOne({ code: '331' });
          if (!debtAccount) {
            debtAccount = await Account.findOne({ accountType: 'liability', status: 'active' });
          }
          // Tài khoản Chi phí (632)
          counterpartAccount = await Account.findOne({ code: '632' });
          if (!counterpartAccount) {
            counterpartAccount = await Account.findOne({ accountType: 'expense', status: 'active' });
          }
        }
        
        // Tạo journalEntry nếu có đủ tài khoản
        let journalEntry = null;
        if (debtAccount && counterpartAccount) {
          const referenceNo = reference || `TXN-${transaction._id.toString().slice(-6)}`;
          journalEntry = new JournalEntry({
            referenceNo,
            date: new Date(date),
            postingDate: new Date(),
            memo: description,
            entryType: type === 'income' ? 'receipt' : 'payment',
            lines: [
              {
                accountCode: debtAccount.code,
                debit: type === 'income' ? parseFloat(amount) : 0,
                credit: type === 'expense' ? parseFloat(amount) : 0,
                description: description,
              },
              {
                accountCode: counterpartAccount.code,
                debit: type === 'expense' ? parseFloat(amount) : 0,
                credit: type === 'income' ? parseFloat(amount) : 0,
                description: description,
              }
            ],
            sourceId: transaction._id,
            sourceType: 'transaction',
            createdBy: req.userId || null,
            status: 'posted',
          });
          
          await journalEntry.save();
          console.log(`Created journalEntry: ${journalEntry._id}`);
        } else {
          console.warn('Cannot create journalEntry: missing accounts', { debtAccount: !!debtAccount, counterpartAccount: !!counterpartAccount });
        }
        
        // Tạo công nợ (tạo journalEntry đơn giản nếu chưa có)
        if (type === 'income' && customer) {
          // Nếu chưa có journalEntry, tạo một cái đơn giản
          if (!journalEntry) {
            // Tạo journalEntry đơn giản với 2 tài khoản khác nhau để cân bằng
            const referenceNo = reference || `TXN-${transaction._id.toString().slice(-6)}`;
            const account1 = await Account.findOne({ accountType: 'asset', status: 'active' });
            const account2 = await Account.findOne({ accountType: 'revenue', status: 'active' }) ||
                            await Account.findOne({ accountType: 'equity', status: 'active' }) ||
                            await Account.findOne({ status: 'active' });
            
            if (account1 && account2 && account1.code !== account2.code) {
              journalEntry = new JournalEntry({
                referenceNo,
                date: new Date(date),
                postingDate: new Date(),
                memo: description,
                entryType: 'receipt',
                lines: [
                  {
                    accountCode: account1.code,
                    debit: parseFloat(amount),
                    credit: 0,
                    description: description,
                  },
                  {
                    accountCode: account2.code,
                    debit: 0,
                    credit: parseFloat(amount),
                    description: description,
                  }
                ],
                sourceId: transaction._id,
                sourceType: 'transaction',
                createdBy: req.userId || null,
                status: 'posted',
              });
              await journalEntry.save();
              console.log(`Created simple journalEntry: ${journalEntry._id}`);
            }
          }
          
          if (journalEntry) {
            const receivable = new Receivable({
              journalEntry: journalEntry._id,
              customer: customer._id,
              originalAmount: parseFloat(amount),
              remainingAmount: parseFloat(amount),
              paymentStatus: 'unpaid',
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 ngày
              invoiceDate: new Date(date),
              description: description || `Công nợ từ giao dịch: ${reference || transaction._id}`,
            });
            
            await receivable.save();
            console.log(`Created Receivable: ${receivable._id} for transaction ${transaction._id}`);
          }
        } else if (type === 'expense' && supplier) {
          // Nếu chưa có journalEntry, tạo một cái đơn giản
          if (!journalEntry) {
            // Tạo journalEntry đơn giản với 2 tài khoản khác nhau để cân bằng
            const referenceNo = reference || `TXN-${transaction._id.toString().slice(-6)}`;
            const account1 = await Account.findOne({ accountType: 'liability', status: 'active' });
            const account2 = await Account.findOne({ accountType: 'expense', status: 'active' }) ||
                            await Account.findOne({ accountType: 'asset', status: 'active' }) ||
                            await Account.findOne({ status: 'active' });
            
            if (account1 && account2 && account1.code !== account2.code) {
              journalEntry = new JournalEntry({
                referenceNo,
                date: new Date(date),
                postingDate: new Date(),
                memo: description,
                entryType: 'payment',
                lines: [
                  {
                    accountCode: account1.code,
                    debit: 0,
                    credit: parseFloat(amount),
                    description: description,
                  },
                  {
                    accountCode: account2.code,
                    debit: parseFloat(amount),
                    credit: 0,
                    description: description,
                  }
                ],
                sourceId: transaction._id,
                sourceType: 'transaction',
                createdBy: req.userId || null,
                status: 'posted',
              });
              await journalEntry.save();
              console.log(`Created simple journalEntry: ${journalEntry._id}`);
            }
          }
          
          if (journalEntry) {
            const payable = new Payable({
              journalEntry: journalEntry._id,
              supplier: supplier._id,
              billType: 'expense',
              originalAmount: parseFloat(amount),
              remainingAmount: parseFloat(amount),
              paymentStatus: 'unpaid',
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 ngày
              invoiceDate: new Date(date),
              description: description || `Công nợ từ giao dịch: ${reference || transaction._id}`,
              approvalStatus: 'approved', // Tự động approve cho transaction thủ công
              approvedBy: req.userId || null,
              approvedAt: new Date(),
            });
            
            await payable.save();
            console.log(`Created Payable: ${payable._id} for transaction ${transaction._id}`);
          }
        }
      } catch (debtError) {
        console.error('Error creating debt for transaction:', debtError);
        console.error('Error stack:', debtError.stack);
        // Không throw error, chỉ log để transaction vẫn được tạo
      }
    }
    
    return res.status(201).json({ 
      message: 'Thêm giao dịch thành công',
      transaction 
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo giao dịch' });
  }
});

// PUT /api/accounting/transactions/:id - Cập nhật giao dịch
router.put('/transactions/:id', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { id } = req.params;
    const { type, amount, description, category, date, reference, notes, paymentStatus } = req.body;
    
    // Find transaction
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Không tìm thấy giao dịch' });
    }
    
    // Validate
    if (type && !['income', 'expense'].includes(type)) {
      return res.status(400).json({ message: 'Loại giao dịch không hợp lệ' });
    }
    
    if (amount !== undefined && parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Số tiền phải lớn hơn 0' });
    }
    
    // Update fields
    if (type) transaction.type = type;
    if (amount !== undefined) transaction.amount = parseFloat(amount);
    if (description) transaction.description = description;
    if (category) transaction.category = category;
    if (date) transaction.date = new Date(date);
    if (reference !== undefined) transaction.reference = reference;
    if (notes !== undefined) transaction.notes = notes;
    if (paymentStatus) transaction.paymentStatus = paymentStatus;
    transaction.updatedAt = new Date();
    
    await transaction.save();
    
    return res.status(200).json({ 
      message: 'Cập nhật giao dịch thành công',
      transaction 
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return res.status(500).json({ message: 'Lỗi khi cập nhật giao dịch' });
  }
});

// DELETE /api/accounting/transactions/:id - Xóa giao dịch
router.delete('/transactions/:id', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Không tìm thấy giao dịch' });
    }
    
    // Kiểm tra Lock Date
    const lockCheck = await checkLockDate(transaction.date);
    if (lockCheck.isLocked) {
      return res.status(403).json({ 
        message: lockCheck.message,
        lockDate: lockCheck.lockDate,
        periodName: lockCheck.periodName
      });
    }
    
    await Transaction.findByIdAndDelete(id);
    
    return res.status(200).json({ message: 'Xóa giao dịch thành công' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return res.status(500).json({ message: 'Lỗi khi xóa giao dịch' });
  }
});

// ==========================================
// FINANCIAL REPORTS (Báo cáo Tài chính)
// ==========================================

/**
 * GET /api/accounting/profit-loss
 * Báo cáo Kết quả Kinh doanh (P&L Statement)
 * Tính toán từ TK 5xx (Doanh thu), TK 6xx (Chi phí), TK 7xx (Thu nhập khác), TK 8xx (Chi phí khác)
 */
router.get('/profit-loss', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { startDate, endDate } = req.query;
    
    // Xây dựng query theo thời gian
    let dateQuery = { status: 'posted' };
    if (startDate || endDate) {
      dateQuery.date = {};
      if (startDate) dateQuery.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateQuery.date.$lte = end;
      }
    }
    
    // Aggregation: Tính tổng Credit của TK 5xx (Doanh thu)
    const revenueAggregation = await JournalEntry.aggregate([
      { $match: dateQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^5/ }, // TK 5xx
          'lines.credit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$lines.accountCode',
          totalCredit: { $sum: '$lines.credit' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'code',
          as: 'account'
        }
      },
      { $unwind: '$account' },
      {
        $project: {
          accountCode: '$_id',
          accountName: '$account.name',
          amount: '$totalCredit'
        }
      },
      { $sort: { accountCode: 1 } }
    ]);
    
    // Tính Doanh thu thuần (Tổng Credit TK 511)
    const netRevenue = revenueAggregation
      .filter(item => item.accountCode.startsWith('511'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Tính Thu nhập khác (Tổng Credit TK 711)
    const otherIncome = revenueAggregation
      .filter(item => item.accountCode.startsWith('711'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Aggregation: Tính tổng Debit của TK 6xx (Chi phí)
    const expenseAggregation = await JournalEntry.aggregate([
      { $match: dateQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^6/ }, // TK 6xx
          'lines.debit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: '$lines.debit' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'code',
          as: 'account'
        }
      },
      { $unwind: '$account' },
      {
        $project: {
          accountCode: '$_id',
          accountName: '$account.name',
          amount: '$totalDebit'
        }
      },
      { $sort: { accountCode: 1 } }
    ]);
    
    // Tính Giá vốn hàng bán (Tổng Debit TK 632)
    const costOfGoodsSold = expenseAggregation
      .filter(item => item.accountCode.startsWith('632'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Tính Chi phí bán hàng (Tổng Debit TK 641)
    const sellingExpenses = expenseAggregation
      .filter(item => item.accountCode.startsWith('641'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Tính Chi phí quản lý doanh nghiệp (Tổng Debit TK 642)
    const adminExpenses = expenseAggregation
      .filter(item => item.accountCode.startsWith('642'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Tính Chi phí tài chính (Tổng Debit TK 635)
    const financialExpenses = expenseAggregation
      .filter(item => item.accountCode.startsWith('635'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Tính Tổng chi phí khác (TK 6xx khác)
    const otherExpenses = expenseAggregation
      .filter(item => !item.accountCode.startsWith('632') && 
                      !item.accountCode.startsWith('641') && 
                      !item.accountCode.startsWith('642') &&
                      !item.accountCode.startsWith('635'))
      .reduce((sum, item) => sum + item.amount, 0);
    
    // Aggregation: Tính tổng Debit của TK 8xx (Chi phí khác)
    const otherCostsAggregation = await JournalEntry.aggregate([
      { $match: dateQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^8/ }, // TK 8xx
          'lines.debit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: '$lines.debit' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'code',
          as: 'account'
        }
      },
      { $unwind: '$account' },
      {
        $project: {
          accountCode: '$_id',
          accountName: '$account.name',
          amount: '$totalDebit'
        }
      },
      { $sort: { accountCode: 1 } }
    ]);
    
    const otherCosts = otherCostsAggregation.reduce((sum, item) => sum + item.amount, 0);
    
    // Tính toán các chỉ tiêu
    const grossProfit = netRevenue - costOfGoodsSold; // Lãi gộp
    const totalOperatingExpenses = sellingExpenses + adminExpenses + financialExpenses; // Tổng chi phí hoạt động
    const operatingProfit = grossProfit - totalOperatingExpenses; // Lợi nhuận hoạt động
    const totalOtherIncome = otherIncome; // Thu nhập khác
    const totalOtherCosts = otherExpenses + otherCosts; // Chi phí khác
    const profitBeforeTax = operatingProfit + totalOtherIncome - totalOtherCosts; // Lợi nhuận trước thuế
    
    // Thuế TNDN (giả sử 20%)
    const corporateTax = Math.max(0, profitBeforeTax * 0.2);
    const netProfit = profitBeforeTax - corporateTax; // Lợi nhuận sau thuế
    
    return res.status(200).json({
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      revenue: {
        netRevenue, // Doanh thu thuần
        otherIncome, // Thu nhập khác
        totalRevenue: netRevenue + otherIncome // Tổng doanh thu
      },
      costOfGoodsSold, // Giá vốn hàng bán
      grossProfit, // Lãi gộp
      operatingExpenses: {
        sellingExpenses, // Chi phí bán hàng
        adminExpenses, // Chi phí quản lý doanh nghiệp
        financialExpenses, // Chi phí tài chính
        total: totalOperatingExpenses
      },
      operatingProfit, // Lợi nhuận hoạt động
      otherItems: {
        otherIncome, // Thu nhập khác
        otherCosts: totalOtherCosts, // Chi phí khác
        net: totalOtherIncome - totalOtherCosts
      },
      profitBeforeTax, // Lợi nhuận trước thuế
      corporateTax, // Thuế TNDN
      netProfit, // Lợi nhuận sau thuế
      details: {
        revenueBreakdown: revenueAggregation,
        expenseBreakdown: expenseAggregation,
        otherCostsBreakdown: otherCostsAggregation
      }
    });
  } catch (error) {
    console.error('Error generating P&L report:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo báo cáo KQKD', error: error.message });
  }
});

/**
 * GET /api/accounting/balance-sheet-data
 * Bảng Cân đối Kế toán (Balance Sheet)
 * Tính Số dư Cuối Kỳ (SDCK) của tất cả các TK Tài sản (1xx, 2xx), Nợ (3xx), và Vốn (4xx)
 */
router.get('/balance-sheet-data', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { asOfDate } = req.query; // Ngày lập báo cáo (mặc định: hôm nay)
    const reportDate = asOfDate ? new Date(asOfDate) : new Date();
    
    // Xây dựng query: Lấy tất cả JournalEntry từ đầu đến ngày báo cáo
    const dateQuery = {
      status: 'posted',
      date: { $lte: reportDate }
    };
    
    // Aggregation: Tính số dư cuối kỳ cho từng tài khoản
    const accountBalances = await JournalEntry.aggregate([
      { $match: dateQuery },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: '$lines.debit' },
          totalCredit: { $sum: '$lines.credit' }
        }
      },
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'code',
          as: 'account'
        }
      },
      { $unwind: '$account' },
      {
        $project: {
          accountCode: '$_id',
          accountName: '$account.name',
          accountType: '$account.accountType',
          totalDebit: 1,
          totalCredit: 1,
          // Tính số dư dựa trên loại tài khoản
          balance: {
            $cond: {
              if: { $in: ['$account.accountType', ['asset', 'expense']] },
              then: { $subtract: ['$totalDebit', '$totalCredit'] }, // Tài sản/Chi phí: Dư Nợ
              else: { $subtract: ['$totalCredit', '$totalDebit'] } // Nợ/Vốn/Doanh thu: Dư Có
            }
          }
        }
      },
      { $sort: { accountCode: 1 } }
    ]);
    
    // Phân loại theo nhóm
    const assets = accountBalances.filter(item => 
      item.accountCode.startsWith('1') || item.accountCode.startsWith('2')
    );
    
    const liabilities = accountBalances.filter(item => 
      item.accountCode.startsWith('3')
    );
    
    const equity = accountBalances.filter(item => 
      item.accountCode.startsWith('4')
    );
    
    // Tính tổng
    // Tài sản: Dư Nợ (số dương)
    const totalAssets = assets.reduce((sum, item) => {
      const balance = item.balance || 0;
      return sum + (balance > 0 ? balance : 0); // Chỉ tính số dương
    }, 0);
    
    // Nợ phải trả: Dư Có (số dương)
    const totalLiabilities = liabilities.reduce((sum, item) => {
      const balance = item.balance || 0;
      return sum + (balance > 0 ? balance : 0); // Dư Có là số dương
    }, 0);
    
    // Vốn chủ sở hữu: Dư Có (số dương)
    const totalEquity = equity.reduce((sum, item) => {
      const balance = item.balance || 0;
      return sum + (balance > 0 ? balance : 0); // Dư Có là số dương
    }, 0);
    
    // Tính Lợi nhuận chưa phân phối (từ P&L)
    // Tính chính xác theo công thức P&L: Doanh thu - Chi phí
    const pnlQuery = {
      status: 'posted',
      date: { $lte: reportDate }
    };
    
    // Tính Doanh thu thuần (TK 511)
    const revenue511 = await JournalEntry.aggregate([
      { $match: pnlQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^511/ },
          'lines.credit': { $gt: 0 }
        }
      },
      { $group: { _id: null, total: { $sum: '$lines.credit' } } }
    ]);
    
    // Tính Thu nhập khác (TK 711)
    const revenue711 = await JournalEntry.aggregate([
      { $match: pnlQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^711/ },
          'lines.credit': { $gt: 0 }
        }
      },
      { $group: { _id: null, total: { $sum: '$lines.credit' } } }
    ]);
    
    // Tính Giá vốn (TK 632)
    const cost632 = await JournalEntry.aggregate([
      { $match: pnlQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^632/ },
          'lines.debit': { $gt: 0 }
        }
      },
      { $group: { _id: null, total: { $sum: '$lines.debit' } } }
    ]);
    
    // Tính Chi phí khác (TK 6xx, 8xx trừ 632)
    // Tính tổng tất cả TK 6xx, 8xx rồi trừ đi TK 632
    const expensesAll = await JournalEntry.aggregate([
      { $match: pnlQuery },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^6|^8/ },
          'lines.debit': { $gt: 0 }
        }
      },
      { $group: { _id: null, total: { $sum: '$lines.debit' } } }
    ]);
    
    const expensesOther = (expensesAll[0]?.total || 0) - (cost632[0]?.total || 0);
    
    const totalRevenue = (revenue511[0]?.total || 0) + (revenue711[0]?.total || 0);
    const totalCosts = (cost632[0]?.total || 0) + expensesOther;
    const profitBeforeTax = totalRevenue - totalCosts;
    
    // Thuế TNDN (20%)
    const corporateTax = Math.max(0, profitBeforeTax * 0.2);
    const netProfit = profitBeforeTax - corporateTax;
    
    // Lợi nhuận chưa phân phối = Lợi nhuận sau thuế (giả sử chưa phân phối)
    const retainedEarnings = netProfit;
    
    // Tổng Nguồn vốn = Nợ phải trả + Vốn chủ sở hữu + Lợi nhuận chưa phân phối
    const totalEquityAndLiabilities = totalLiabilities + totalEquity + retainedEarnings;
    
    // Kiểm tra cân bằng
    const balanceCheck = Math.abs(totalAssets - totalEquityAndLiabilities);
    const isBalanced = balanceCheck < 0.01; // Cho phép sai số nhỏ do làm tròn
    
    return res.status(200).json({
      reportDate: reportDate.toISOString().split('T')[0],
      assets: {
        items: assets,
        total: totalAssets
      },
      liabilities: {
        items: liabilities,
        total: totalLiabilities
      },
      equity: {
        items: equity,
        retainedEarnings, // Lợi nhuận chưa phân phối
        total: totalEquity + retainedEarnings
      },
      totalEquityAndLiabilities,
      balanceCheck: {
        isBalanced,
        difference: balanceCheck,
        message: isBalanced ? 'Bảng cân đối kế toán cân bằng' : `Cảnh báo: Chênh lệch ${balanceCheck.toLocaleString('vi-VN')} VNĐ`
      }
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo bảng cân đối kế toán', error: error.message });
  }
});

// ==========================================
// PERIOD CLOSING & ADJUSTING ENTRIES (Khóa Sổ & Điều chỉnh)
// ==========================================

/**
 * POST /api/accounting/close-period
 * Khóa sổ kỳ kế toán và tự động tạo bút toán kết chuyển
 * 
 * Logic:
 * 1. Kết chuyển Doanh thu (TK 5xx, 7xx) → TK 911
 * 2. Kết chuyển Chi phí (TK 6xx, 8xx) → TK 911
 * 3. Tính Lãi/Lỗ ròng từ TK 911
 * 4. Kết chuyển Lãi/Lỗ → TK 421 (Lợi nhuận chưa phân phối)
 */
router.post('/close-period', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const { periodId, lockDate, notes } = req.body;
    
    if (!periodId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Thiếu periodId' });
    }
    
    const period = await AccountingPeriod.findById(periodId).session(session);
    if (!period) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Không tìm thấy kỳ kế toán' });
    }
    
    if (period.status === 'closed') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Kỳ kế toán này đã được khóa sổ' });
    }
    
    const lockDateObj = lockDate ? new Date(lockDate) : period.endDate;
    
    // 1. Kết chuyển Doanh thu (TK 5xx, 7xx) → TK 911
    const revenueEntries = await JournalEntry.aggregate([
      {
        $match: {
          status: 'posted',
          date: { $gte: period.startDate, $lte: period.endDate }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^5|^7/ },
          'lines.credit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$lines.accountCode',
          totalCredit: { $sum: '$lines.credit' }
        }
      }
    ]).session(session);
    
    let totalRevenue = 0;
    const revenueClosingLines = [];
    
    revenueEntries.forEach(item => {
      const amount = item.totalCredit;
      totalRevenue += amount;
      
      // Có TK 5xx/7xx (giảm doanh thu)
      revenueClosingLines.push({
        accountCode: item._id,
        debit: amount,
        credit: 0,
        description: `Kết chuyển doanh thu kỳ ${period.periodName}`,
      });
    });
    
    // Nợ TK 911 (tăng doanh thu)
    if (totalRevenue > 0) {
      revenueClosingLines.push({
        accountCode: '911',
        debit: 0,
        credit: totalRevenue,
        description: `Tổng doanh thu kỳ ${period.periodName}`,
      });
    }
    
    // 2. Kết chuyển Chi phí (TK 6xx, 8xx) → TK 911
    const expenseEntries = await JournalEntry.aggregate([
      {
        $match: {
          status: 'posted',
          date: { $gte: period.startDate, $lte: period.endDate }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $regex: /^6|^8/ },
          'lines.debit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: '$lines.debit' }
        }
      }
    ]).session(session);
    
    let totalExpense = 0;
    const expenseClosingLines = [];
    
    expenseEntries.forEach(item => {
      const amount = item.totalDebit;
      totalExpense += amount;
      
      // Có TK 6xx/8xx (giảm chi phí)
      expenseClosingLines.push({
        accountCode: item._id,
        debit: 0,
        credit: amount,
        description: `Kết chuyển chi phí kỳ ${period.periodName}`,
      });
    });
    
    // Nợ TK 911 (tăng chi phí)
    if (totalExpense > 0) {
      expenseClosingLines.push({
        accountCode: '911',
        debit: totalExpense,
        credit: 0,
        description: `Tổng chi phí kỳ ${period.periodName}`,
      });
    }
    
    // 3. Tính Lãi/Lỗ ròng = Doanh thu - Chi phí
    const netProfit = totalRevenue - totalExpense;
    
    // 4. Kết chuyển Lãi/Lỗ → TK 421
    const profitClosingLines = [];
    
    if (netProfit > 0) {
      // Lãi: Nợ TK 911 / Có TK 421
      profitClosingLines.push({
        accountCode: '911',
        debit: netProfit,
        credit: 0,
        description: `Kết chuyển lãi ròng kỳ ${period.periodName}`,
      });
      profitClosingLines.push({
        accountCode: '421',
        debit: 0,
        credit: netProfit,
        description: `Lợi nhuận chưa phân phối kỳ ${period.periodName}`,
      });
    } else if (netProfit < 0) {
      // Lỗ: Nợ TK 421 / Có TK 911
      profitClosingLines.push({
        accountCode: '421',
        debit: Math.abs(netProfit),
        credit: 0,
        description: `Kết chuyển lỗ ròng kỳ ${period.periodName}`,
      });
      profitClosingLines.push({
        accountCode: '911',
        debit: 0,
        credit: Math.abs(netProfit),
        description: `Lỗ chưa phân phối kỳ ${period.periodName}`,
      });
    }
    
    // Tạo các Journal Entry cho kết chuyển
    const closingEntries = [];
    const today = new Date();
    
    // Bút toán kết chuyển doanh thu
    if (revenueClosingLines.length > 0) {
      const revenueEntry = new JournalEntry({
        referenceNo: `KC-DT-${period.periodName.replace(/\s+/g, '-')}-${Date.now().toString().slice(-6)}`,
        date: period.endDate,
        postingDate: today,
        memo: `Kết chuyển doanh thu kỳ ${period.periodName}`,
        entryType: 'closing',
        sourceType: 'period_closing',
        lines: revenueClosingLines,
        createdBy: req.userId || null,
        status: 'posted',
      });
      await revenueEntry.save({ session });
      closingEntries.push(revenueEntry);
    }
    
    // Bút toán kết chuyển chi phí
    if (expenseClosingLines.length > 0) {
      const expenseEntry = new JournalEntry({
        referenceNo: `KC-CP-${period.periodName.replace(/\s+/g, '-')}-${Date.now().toString().slice(-6)}`,
        date: period.endDate,
        postingDate: today,
        memo: `Kết chuyển chi phí kỳ ${period.periodName}`,
        entryType: 'closing',
        sourceType: 'period_closing',
        lines: expenseClosingLines,
        createdBy: req.userId || null,
        status: 'posted',
      });
      await expenseEntry.save({ session });
      closingEntries.push(expenseEntry);
    }
    
    // Bút toán kết chuyển lãi/lỗ
    if (profitClosingLines.length > 0) {
      const profitEntry = new JournalEntry({
        referenceNo: `KC-LN-${period.periodName.replace(/\s+/g, '-')}-${Date.now().toString().slice(-6)}`,
        date: period.endDate,
        postingDate: today,
        memo: `Kết chuyển lãi/lỗ ròng kỳ ${period.periodName}`,
        entryType: 'closing',
        sourceType: 'period_closing',
        lines: profitClosingLines,
        createdBy: req.userId || null,
        status: 'posted',
      });
      await profitEntry.save({ session });
      closingEntries.push(profitEntry);
    }
    
    // Cập nhật kỳ kế toán
    period.lockDate = lockDateObj;
    period.status = 'closed';
    period.closedAt = today;
    period.closedBy = req.userId || null;
    if (notes) period.notes = notes;
    period.updatedAt = today;
    
    await period.save({ session });
    
    await session.commitTransaction();
    
    return res.status(200).json({
      message: 'Khóa sổ kỳ kế toán thành công',
      period: {
        _id: period._id,
        periodName: period.periodName,
        lockDate: period.lockDate,
        status: period.status,
        closedAt: period.closedAt,
      },
      summary: {
        totalRevenue,
        totalExpense,
        netProfit,
      },
      closingEntries: closingEntries.map(entry => ({
        _id: entry._id,
        referenceNo: entry.referenceNo,
        memo: entry.memo,
      }))
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error closing period:', error);
    return res.status(500).json({ 
      message: 'Lỗi khi khóa sổ kỳ kế toán',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/accounting/adjusting-entry
 * Tạo bút toán điều chỉnh (Adjusting Entry)
 * Dùng để sửa chữa sai sót sau khi đã khóa sổ
 */
router.post('/adjusting-entry', withAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await db.connectDb();
    
    const {
      referenceNo,
      date, // Ngày hiện tại (ngày điều chỉnh)
      adjustedDate, // Ngày giao dịch cần điều chỉnh
      memo,
      lines, // Array of { accountCode, debit, credit, description }
      notes
    } = req.body;
    
    if (!date || !adjustedDate || !lines || lines.length < 2) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: date, adjustedDate, lines (ít nhất 2 dòng)' 
      });
    }
    
    // Validation: Kiểm tra tổng Nợ = Tổng Có
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Bút toán không cân bằng. Tổng Nợ phải bằng Tổng Có',
        totalDebit,
        totalCredit
      });
    }
    
    // Kiểm tra tài khoản có tồn tại không
    const accountCodes = [...new Set(lines.map(line => line.accountCode))];
    const accounts = await Account.find({ 
      code: { $in: accountCodes } 
    }).session(session);
    
    if (accounts.length !== accountCodes.length) {
      const missingAccounts = accountCodes.filter(code => 
        !accounts.find(acc => acc.code === code)
      );
      await session.abortTransaction();
      return res.status(400).json({ 
        message: 'Một hoặc nhiều tài khoản không tồn tại',
        missingAccounts
      });
    }
    
    // Tạo số chứng từ tự động nếu chưa có
    const refNo = referenceNo || `ADJ-${new Date(date).getFullYear()}${String(new Date(date).getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-6)}`;
    
    // Kiểm tra số chứng từ đã tồn tại chưa
    const existingEntry = await JournalEntry.findOne({ referenceNo: refNo }).session(session);
    if (existingEntry) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    
    // Tạo Journal Entry
    const entry = new JournalEntry({
      referenceNo: refNo,
      date: new Date(date), // Ngày điều chỉnh (ngày hiện tại)
      postingDate: new Date(),
      memo: memo || `Bút toán điều chỉnh cho giao dịch ngày ${new Date(adjustedDate).toLocaleDateString('vi-VN')}. ${notes || ''}`,
      entryType: 'adjusting',
      sourceType: 'adjusting_entry',
      adjustedDate: new Date(adjustedDate), // Ngày giao dịch cần điều chỉnh
      lines: lines.map(line => ({
        accountCode: line.accountCode,
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
        description: line.description || memo || '',
      })),
      createdBy: req.userId || null,
      status: 'posted',
      notes: notes || '',
    });
    
    await entry.save({ session });
    
    await session.commitTransaction();
    
    // Populate để trả về đầy đủ thông tin
    await entry.populate('createdBy', 'name email');
    
    return res.status(201).json({
      message: 'Tạo bút toán điều chỉnh thành công',
      entry
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Error creating adjusting entry:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Số chứng từ đã tồn tại' });
    }
    
    return res.status(500).json({ 
      message: 'Lỗi khi tạo bút toán điều chỉnh',
      error: error.message 
    });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/accounting/periods
 * Lấy danh sách các kỳ kế toán
 */
router.get('/periods', optionalAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const periods = await AccountingPeriod.find()
      .sort({ startDate: -1 })
      .populate('closedBy', 'name email')
      .lean();
    
    return res.status(200).json({ periods });
  } catch (error) {
    console.error('Error fetching periods:', error);
    return res.status(500).json({ message: 'Lỗi khi lấy danh sách kỳ kế toán' });
  }
});

/**
 * POST /api/accounting/periods
 * Tạo kỳ kế toán mới
 */
router.post('/periods', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    const { periodName, startDate, endDate, notes } = req.body;
    
    if (!periodName || !startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Thiếu thông tin bắt buộc: periodName, startDate, endDate' 
      });
    }
    
    const period = new AccountingPeriod({
      periodName,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      notes: notes || '',
    });
    
    await period.save();
    
    return res.status(201).json({
      message: 'Tạo kỳ kế toán thành công',
      period
    });
  } catch (error) {
    console.error('Error creating period:', error);
    return res.status(500).json({ 
      message: 'Lỗi khi tạo kỳ kế toán',
      error: error.message 
    });
  }
});

module.exports = router;
