const express = require('express');
const router = express.Router();
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const RecruitmentApplication = require('../models/RecruitmentApplication');
const { sendEmail } = require('../utils/sendEmails');
const { withAuth } = require('../middleware/auth');

// Email template for recruitment application
const recruitmentEmailTemplate = (data) => {
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
        .info-box {
          background-color: white;
          border-left: 4px solid #009934;
          padding: 15px;
          margin: 15px 0;
        }
        .info-row {
          margin: 10px 0;
        }
        .info-label {
          font-weight: bold;
          color: #009934;
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
          <h1>Hồ sơ ứng tuyển mới</h1>
        </div>
        <div class="content">
          <p>Xin chào,</p>
          <p>Có một hồ sơ ứng tuyển mới từ website Eco Bắc Giang:</p>
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Vị trí ứng tuyển:</span> ${data.jobTitle || 'N/A'}
            </div>
            <div class="info-row">
              <span class="info-label">Họ và tên:</span> ${data.name}
            </div>
            <div class="info-row">
              <span class="info-label">Email:</span> ${data.email}
            </div>
            <div class="info-row">
              <span class="info-label">Số điện thoại:</span> ${data.phone}
            </div>
            ${data.introduction ? `
            <div class="info-row">
              <span class="info-label">Giới thiệu:</span><br>
              ${data.introduction.replace(/\n/g, '<br>')}
            </div>
            ` : ''}
            ${data.cvFileName ? `
            <div class="info-row">
              <span class="info-label">CV/Portfolio:</span> ${data.cvFileName}
            </div>
            ` : ''}
          </div>
          <p>Vui lòng kiểm tra và liên hệ với ứng viên sớm nhất có thể.</p>
          <div class="footer">
            <p>Trân trọng,<br>Hệ thống EcoBacGiang</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Parse form data with formidable
const parseForm = (req) => {
  return new Promise((resolve, reject) => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'recruitment');
    
    // Create upload directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir: uploadDir,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      multiples: false,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
};

// POST /api/recruitment/apply - Submit recruitment application
router.post('/apply', async (req, res) => {
  try {
    // Parse form data
    const { fields, files } = await parseForm(req);

    // Extract form fields - handle both array and string formats from formidable
    const name = (Array.isArray(fields.name) ? fields.name[0] : fields.name)?.trim() || '';
    const phone = (Array.isArray(fields.phone) ? fields.phone[0] : fields.phone)?.trim() || '';
    const email = (Array.isArray(fields.email) ? fields.email[0] : fields.email)?.trim() || '';
    const introduction = (Array.isArray(fields.introduction) ? fields.introduction[0] : fields.introduction)?.trim() || '';
    const jobTitle = (Array.isArray(fields.jobTitle) ? fields.jobTitle[0] : fields.jobTitle)?.trim() || '';
    const jobId = (Array.isArray(fields.jobId) ? fields.jobId[0] : fields.jobId)?.trim() || '';

    // Validation
    if (!name || !phone || !email) {
      return res.status(400).json({
        message: 'Vui lòng điền đầy đủ thông tin bắt buộc (Họ tên, Số điện thoại, Email).',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Địa chỉ email không hợp lệ.',
      });
    }

    // Handle file upload
    let cvFileName = null;
    let cvFilePath = null;

    if (files.cvFile) {
      const file = Array.isArray(files.cvFile) ? files.cvFile[0] : files.cvFile;
      
      // Validate file type
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.mimetype)) {
        // Delete uploaded file if invalid
        if (fs.existsSync(file.filepath)) {
          fs.unlinkSync(file.filepath);
        }
        return res.status(400).json({
          message: 'Chỉ chấp nhận file PDF hoặc DOCX.',
        });
      }

      // Generate unique filename
      const fileExt = path.extname(file.originalFilename || 'file');
      const uniqueFileName = `CV_${Date.now()}_${name.replace(/\s+/g, '_')}${fileExt}`;
      const newFilePath = path.join(path.dirname(file.filepath), uniqueFileName);

      // Rename file
      fs.renameSync(file.filepath, newFilePath);
      cvFileName = uniqueFileName;
      // Store relative path from public folder for easy access
      cvFilePath = `/uploads/recruitment/${uniqueFileName}`;
    }

    // Save to database
    await db.connectDb();
    const application = new RecruitmentApplication({
      name,
      phone,
      email,
      introduction,
      jobTitle,
      jobId,
      cvFileName,
      cvFilePath,
      status: 'pending'
    });
    await application.save();

    // Prepare email data
    const emailData = {
      name,
      phone,
      email,
      introduction,
      jobTitle,
      jobId,
      cvFileName,
    };

    // Send notification email to HR/admin
    try {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL_ADDRESS || 'tuyendung@ecobacgiang.vn';
      await sendEmail(
        adminEmail,
        '',
        '',
        `Hồ sơ ứng tuyển mới - ${jobTitle || 'Vị trí chung'}`,
        recruitmentEmailTemplate(emailData)
      );
    } catch (emailError) {
      console.error('Error sending recruitment email:', emailError);
      // Don't fail the request if email fails, but log it
    }

    // Send confirmation email to applicant
    try {
      const confirmationTemplate = `
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
              <h1>Cảm ơn bạn đã ứng tuyển!</h1>
            </div>
            <div class="content">
              <p>Xin chào ${name},</p>
              <p>Cảm ơn bạn đã quan tâm và gửi hồ sơ ứng tuyển cho vị trí <strong>${jobTitle || 'tại Eco Bắc Giang'}</strong>.</p>
              <p>Chúng tôi đã nhận được hồ sơ của bạn và sẽ xem xét trong thời gian sớm nhất. Nếu hồ sơ của bạn phù hợp, chúng tôi sẽ liên hệ với bạn qua email hoặc số điện thoại bạn đã cung cấp.</p>
              <p>Trong thời gian chờ đợi, bạn có thể tìm hiểu thêm về Eco Bắc Giang tại website của chúng tôi.</p>
              <div class="footer">
                <p>Trân trọng,<br>Đội ngũ Tuyển dụng - EcoBacGiang</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail(
        email,
        '',
        '',
        'Cảm ơn bạn đã ứng tuyển - Eco Bắc Giang',
        confirmationTemplate
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Don't fail the request if confirmation email fails
    }

    return res.status(200).json({
      success: true,
      message: 'Gửi hồ sơ ứng tuyển thành công! Chúng tôi sẽ liên hệ với bạn sớm nhất.',
    });
  } catch (error) {
    console.error('Recruitment apply error:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi xử lý hồ sơ ứng tuyển. Vui lòng thử lại sau.',
    });
  }
});

// GET /api/recruitment/list - Get list of applications (admin only)
router.get('/list', withAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    await db.connectDb();

    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const statusFilter = req.query.status || '';
    const jobTitleFilter = req.query.jobTitle || '';

    // Build query
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { jobTitle: { $regex: search, $options: 'i' } }
      ];
    }

    if (statusFilter) {
      query.status = statusFilter;
    }

    if (jobTitleFilter) {
      query.jobTitle = { $regex: jobTitleFilter, $options: 'i' };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const total = await RecruitmentApplication.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    // Fetch applications
    const applications = await RecruitmentApplication.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      data: applications,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching recruitment applications:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi lấy danh sách ứng viên.',
    });
  }
});

// GET /api/recruitment/stats - Get recruitment statistics (admin only)
router.get('/stats', withAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    await db.connectDb();

    const stats = {
      total: await RecruitmentApplication.countDocuments(),
      pending: await RecruitmentApplication.countDocuments({ status: 'pending' }),
      reviewing: await RecruitmentApplication.countDocuments({ status: 'reviewing' }),
      accepted: await RecruitmentApplication.countDocuments({ status: 'accepted' }),
      rejected: await RecruitmentApplication.countDocuments({ status: 'rejected' })
    };

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching recruitment stats:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi lấy thống kê ứng viên.',
    });
  }
});

// PUT /api/recruitment/update-status - Update application status (admin only)
router.put('/update-status', withAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    const { applicationId, status, notes } = req.body;

    // Validation
    if (!applicationId) {
      return res.status(400).json({ message: 'Application ID is required' });
    }

    const validStatuses = ['pending', 'reviewing', 'accepted', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await db.connectDb();

    // Update application
    const application = await RecruitmentApplication.findByIdAndUpdate(
      applicationId,
      {
        status,
        ...(notes !== undefined && { notes })
      },
      { new: true }
    );

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    return res.status(200).json({
      success: true,
      data: application,
      message: 'Trạng thái đã được cập nhật thành công'
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    return res.status(500).json({
      message: error.message || 'Đã xảy ra lỗi khi cập nhật trạng thái.',
    });
  }
});

module.exports = router;
