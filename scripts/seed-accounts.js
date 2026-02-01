const db = require('../config/database');
const Account = require('../models/Account');

/**
 * Script để seed các tài khoản kế toán cơ bản
 * Chạy: node server/scripts/seed-accounts.js
 */

const defaultAccounts = [
  // TÀI SẢN (Assets)
  { code: '111', name: 'Tiền mặt', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Tiền mặt tại quỹ và các địa điểm' },
  { code: '112', name: 'Tiền gửi ngân hàng', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Tiền gửi tại các ngân hàng' },
  { code: '1121', name: 'Tiền gửi ngân hàng - Vietcombank', accountType: 'asset', accountTypeName: 'Tài sản', level: 2, parentCode: '112', notes: 'Tài khoản ngân hàng Vietcombank' },
  { code: '1122', name: 'Tiền gửi ngân hàng - Techcombank', accountType: 'asset', accountTypeName: 'Tài sản', level: 2, parentCode: '112', notes: 'Tài khoản ngân hàng Techcombank' },
  { code: '131', name: 'Phải thu khách hàng', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Các khoản phải thu từ khách hàng' },
  { code: '133', name: 'Thuế GTGT được khấu trừ', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Thuế giá trị gia tăng được khấu trừ' },
  { code: '156', name: 'Hàng hóa', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Hàng hóa tồn kho' },
  { code: '211', name: 'Tài sản cố định hữu hình', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Máy móc, thiết bị, nhà cửa' },
  { code: '214', name: 'Hao mòn tài sản cố định', accountType: 'asset', accountTypeName: 'Tài sản', level: 1, notes: 'Giảm giá trị tài sản cố định' },
  
  // NỢ PHẢI TRẢ (Liabilities)
  { code: '331', name: 'Phải trả người bán', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Các khoản phải trả cho nhà cung cấp' },
  { code: '334', name: 'Phải trả người lao động', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Các khoản phải trả lương cho nhân viên' },
  { code: '3331', name: 'Thuế GTGT phải nộp', accountType: 'liability', accountTypeName: 'Nợ phải trả', level: 1, notes: 'Thuế giá trị gia tăng phải nộp' },
  
  // DOANH THU (Revenue)
  { code: '511', name: 'Doanh thu bán hàng', accountType: 'revenue', accountTypeName: 'Doanh thu', level: 1, notes: 'Doanh thu từ việc bán hàng hóa, dịch vụ' },
  { code: '5111', name: 'Doanh thu bán hàng hóa', accountType: 'revenue', accountTypeName: 'Doanh thu', level: 2, parentCode: '511', notes: 'Doanh thu bán sản phẩm' },
  { code: '711', name: 'Thu nhập khác', accountType: 'revenue', accountTypeName: 'Doanh thu', level: 1, notes: 'Các khoản thu nhập khác ngoài doanh thu bán hàng' },
  
  // CHI PHÍ (Expenses)
  { code: '632', name: 'Giá vốn hàng bán', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Chi phí giá vốn của hàng hóa đã bán' },
  { code: '641', name: 'Chi phí bán hàng', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí liên quan đến bán hàng' },
  { code: '642', name: 'Chi phí quản lý doanh nghiệp', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí quản lý chung' },
  { code: '811', name: 'Chi phí khác', accountType: 'expense', accountTypeName: 'Chi phí', level: 1, notes: 'Các chi phí khác không thuộc chi phí bán hàng hoặc quản lý' },
  { code: '6421', name: 'Chi phí nhân viên', accountType: 'expense', accountTypeName: 'Chi phí', level: 2, parentCode: '642', notes: 'Lương, phụ cấp, bảo hiểm' },
  { code: '6422', name: 'Chi phí vật liệu', accountType: 'expense', accountTypeName: 'Chi phí', level: 2, parentCode: '642', notes: 'Nguyên vật liệu, văn phòng phẩm' },
  { code: '6423', name: 'Chi phí vận chuyển', accountType: 'expense', accountTypeName: 'Chi phí', level: 2, parentCode: '642', notes: 'Chi phí vận chuyển, giao hàng' },
  { code: '6424', name: 'Chi phí marketing', accountType: 'expense', accountTypeName: 'Chi phí', level: 2, parentCode: '642', notes: 'Quảng cáo, marketing' },
  { code: '6425', name: 'Chi phí điện nước', accountType: 'expense', accountTypeName: 'Chi phí', level: 2, parentCode: '642', notes: 'Tiền điện, nước, internet' },
];

async function seedAccounts() {
  try {
    console.log('🔄 Đang kết nối database...');
    await db.connectDb();
    
    console.log('📦 Đang seed tài khoản kế toán...');
    let created = 0;
    let updated = 0;
    
    for (const acc of defaultAccounts) {
      const result = await Account.findOneAndUpdate(
        { code: acc.code },
        {
          ...acc,
          status: 'active',
          updatedAt: new Date(),
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
      
      if (result.isNew) {
        created++;
        console.log(`✅ Tạo mới: ${acc.code} - ${acc.name}`);
      } else {
        updated++;
        console.log(`🔄 Cập nhật: ${acc.code} - ${acc.name}`);
      }
    }
    
    console.log('\n✨ Hoàn tất!');
    console.log(`📊 Đã tạo: ${created} tài khoản`);
    console.log(`🔄 Đã cập nhật: ${updated} tài khoản`);
    console.log(`📈 Tổng cộng: ${defaultAccounts.length} tài khoản`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi seed tài khoản:', error);
    process.exit(1);
  }
}

// Chạy script
seedAccounts();

