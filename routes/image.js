const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { withAuth, optionalAuth } = require('../middleware/auth');

// Configure Cloudinary
// Kiểm tra xem có environment variables không
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

// Chỉ config nếu có đủ thông tin
if (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret) {
  cloudinary.config(cloudinaryConfig);
} else {
  console.warn('⚠️ Cloudinary chưa được cấu hình. Vui lòng thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET vào .env');
}

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// GET /api/image - Get all images from Cloudinary
router.get('/', optionalAuth, async (req, res) => {
  try {
    // Kiểm tra Cloudinary config
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ 
        error: 'Cloudinary chưa được cấu hình',
        message: 'Vui lòng thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET vào file .env trong thư mục server'
      });
    }

    const { type } = req.query;
    
    // Get images from Cloudinary
    const response = await cloudinary.api.resources({
      resource_type: 'image',
      type: 'upload',
      prefix: 'ecobacgiang',
      max_results: type === 'avatar' ? 200 : 1000,
    });

    const images = response.resources.map((resource) => ({
      id: resource.public_id,
      src: resource.secure_url,
      altText: resource.context?.alt || '',
      width: resource.width,
      height: resource.height,
      format: resource.format,
      bytes: resource.bytes,
      createdAt: resource.created_at,
    }));

    return res.status(200).json({ images });
  } catch (error) {
    console.error('Error fetching images:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/image - Upload new image to Cloudinary
router.post('/', optionalAuth, upload.single('image'), async (req, res) => {
  try {
    // Kiểm tra Cloudinary config
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ 
        error: 'Cloudinary chưa được cấu hình',
        message: 'Vui lòng thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET vào file .env trong thư mục server'
      });
    }

    if (!req.file) {
      console.error('No file received. Request body:', req.body);
      console.error('Request files:', req.files);
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { type } = req.query;
    const altText = req.body.altText || '';
    
    // Xử lý folder dựa trên type
    let folder = req.body.folder || 'ecobacgiang';
    if (type === 'avatar') {
      folder = 'ecobacgiang/avatar';
    }
    
    console.log('Uploading image:', {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      folder,
      type,
      altText
    });

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    // Update alt text if provided
    if (altText) {
      await cloudinary.uploader.add_context(
        `alt=${altText}`,
        [uploadResult.public_id]
      );
    }

    const imageData = {
      id: uploadResult.public_id,
      src: uploadResult.secure_url,
      altText: altText,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      createdAt: uploadResult.created_at,
    };

    return res.status(200).json(imageData);
  } catch (error) {
    console.error('Error uploading image:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/image/alt-text - Update alt text for an image
router.put('/alt-text', optionalAuth, async (req, res) => {
  try {
    // Kiểm tra Cloudinary config
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ 
        error: 'Cloudinary chưa được cấu hình',
        message: 'Vui lòng thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET vào file .env trong thư mục server'
      });
    }

    const { publicId, altText } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: 'publicId is required' });
    }

    // Update context (alt text) in Cloudinary
    await cloudinary.uploader.add_context(
      `alt=${altText || ''}`,
      [publicId]
    );

    return res.status(200).json({ 
      message: 'Alt text updated successfully',
      publicId,
      altText 
    });
  } catch (error) {
    console.error('Error updating alt text:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;

