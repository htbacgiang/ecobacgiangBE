const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const db = require('../config/database');
const Post = require('../models/Post');
const { withAuth } = require('../middleware/auth');
const User = require('../models/User');

// Helper function to safely get author ID
const getAuthorId = (post) => {
  if (!post) return null;
  
  // Kiểm tra post.author có tồn tại không
  if (!post.author) {
    console.log('Post has no author field:', post._id);
    return null;
  }
  
  try {
    // post.author có thể là ObjectId hoặc đã được populate
    if (post.author._id) {
      // Đã được populate
      return post.author._id.toString();
    } else if (post.author.toString) {
      // Là ObjectId
      return post.author.toString();
    } else {
      // Không phải ObjectId và không có _id
      console.log('Post author is not a valid ObjectId:', post._id, post.author);
      return null;
    }
  } catch (error) {
    console.error('Error getting author ID:', error, post._id);
    return null;
  }
};

// Configure Cloudinary
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// GET /api/posts/draft - Get all drafts for current user
router.get('/draft', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Get drafts for current user
    const drafts = await Post.find({ 
      author: req.userId,
      isDraft: true 
    })
      .sort({ updatedAt: -1 })
      .select('-content')
      .populate('author', 'name email');
    
    return res.status(200).json({ drafts });
  } catch (error) {
    console.error('Error fetching drafts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/posts/draft - Create or update draft
router.post('/draft', withAuth, upload.single('thumbnail'), async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    // Parse form data
    const { title, content, slug, meta, tags, category, postId } = req.body;
    
    // If postId exists, update existing draft
    if (postId) {
      const existingPost = await Post.findById(postId);
      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      // Check if user is the author or admin
      const existingAuthorId = getAuthorId(existingPost);
      if (!existingAuthorId) {
        return res.status(500).json({ error: 'Post author information is missing' });
      }
      if (existingAuthorId !== req.userId && user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. You can only edit your own posts.' 
        });
      }
      
      // Update fields
      if (title) existingPost.title = title;
      if (content) existingPost.content = content;
      if (slug) existingPost.slug = slug;
      if (meta) existingPost.meta = meta;
      if (category !== undefined) existingPost.category = category;
      existingPost.isDraft = true; // Ensure it stays as draft
      
      // Parse tags
      if (tags) {
        try {
          const tagsArray = typeof tags === 'string' ? JSON.parse(tags) : tags;
          if (Array.isArray(tagsArray)) {
            existingPost.tags = tagsArray;
          }
        } catch (e) {
          const tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
          existingPost.tags = tagsArray;
        }
      }
      
      // Handle thumbnail
      if (req.file) {
        // Upload new thumbnail
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
          return res.status(500).json({ 
            error: 'Cloudinary chưa được cấu hình' 
          });
        }

        // Delete old thumbnail if exists
        if (existingPost.thumbnail && existingPost.thumbnail.public_id) {
          try {
            await cloudinary.uploader.destroy(existingPost.thumbnail.public_id);
          } catch (e) {
            console.error('Error deleting old thumbnail:', e);
          }
        }

        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'ecobacgiang',
              resource_type: 'image',
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          uploadStream.end(req.file.buffer);
        });

        existingPost.thumbnail = {
          url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
        };
      } else if (req.body.thumbnail && typeof req.body.thumbnail === 'string' && req.body.thumbnail.trim()) {
        // Handle thumbnail URL from gallery
        const thumbnailUrl = req.body.thumbnail.trim();
        if (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://')) {
          const urlParts = thumbnailUrl.split('/');
          const uploadIndex = urlParts.findIndex(part => part === 'upload');
          if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
            const publicIdWithExt = urlParts.slice(uploadIndex + 1).join('/');
            const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
            
            existingPost.thumbnail = {
              url: thumbnailUrl,
              public_id: publicId,
            };
          } else {
            existingPost.thumbnail = {
              url: thumbnailUrl,
              public_id: null,
            };
          }
        }
      }
      
      await existingPost.save();
      return res.status(200).json({ post: existingPost });
    }
    
    // Create new draft
    // Validate required fields (more lenient for drafts)
    if (!title && !content) {
      return res.status(400).json({ 
        error: 'Title or content is required' 
      });
    }

    // Parse tags
    let tagsArray = [];
    if (tags) {
      try {
        tagsArray = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (!Array.isArray(tagsArray)) {
          tagsArray = [];
        }
      } catch (e) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
      }
    }

    // Generate slug if not provided
    const finalSlug = slug || `draft-${Date.now()}`;
    
    // Check if slug already exists
    const existingPost = await Post.findOne({ slug: finalSlug });
    if (existingPost) {
      return res.status(400).json({ error: 'Slug phải là duy nhất!' });
    }

    // Handle thumbnail
    let thumbnailData = null;
    if (req.file) {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ 
          error: 'Cloudinary chưa được cấu hình' 
        });
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'ecobacgiang',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      thumbnailData = {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    } else if (req.body.thumbnail && typeof req.body.thumbnail === 'string' && req.body.thumbnail.trim()) {
      // Handle thumbnail URL from gallery
      const thumbnailUrl = req.body.thumbnail.trim();
      if (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://')) {
        const urlParts = thumbnailUrl.split('/');
        const uploadIndex = urlParts.findIndex(part => part === 'upload');
        if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
          const publicIdWithExt = urlParts.slice(uploadIndex + 1).join('/');
          const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
          
          thumbnailData = {
            url: thumbnailUrl,
            public_id: publicId,
          };
        } else {
          thumbnailData = {
            url: thumbnailUrl,
            public_id: null,
          };
        }
      }
    }

    // Create new draft
    const newDraft = new Post({
      title: title || 'Nháp bài viết',
      content: content || '',
      slug: finalSlug,
      meta: meta || '',
      tags: tagsArray,
      category: category || '',
      author: req.userId,
      isDraft: true,
      thumbnail: thumbnailData,
    });

    await newDraft.save();

    return res.status(200).json({ post: newDraft });
  } catch (error) {
    console.error('Error saving draft:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/posts/draft - Publish draft (set isDraft = false)
router.put('/draft', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    const { postId } = req.body;
    if (!postId) {
      return res.status(400).json({ error: 'postId is required' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author or admin
    const publishAuthorId = getAuthorId(post);
    if (!publishAuthorId) {
      return res.status(500).json({ error: 'Post author information is missing' });
    }
    if (publishAuthorId !== req.userId && user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Access denied. You can only publish your own posts.' 
      });
    }

    // Publish the draft
    post.isDraft = false;
    await post.save();

    return res.status(200).json({ post });
  } catch (error) {
    console.error('Error publishing draft:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/posts - Get all posts with pagination and filters
router.get('/', async (req, res) => {
  try {
    await db.connectDb();
    
    const { limit, skip, includeDrafts } = req.query;
    
    // Parse query parameters
    const limitNum = limit ? parseInt(limit) : 50;
    const skipNum = skip ? parseInt(skip) : 0;
    const shouldIncludeDrafts = includeDrafts === 'true';
    
    // Build filter - exclude drafts unless includeDrafts=true
    // Chỉ lấy các bài viết có isDraft !== true (bao gồm false, null, undefined)
    const filter = shouldIncludeDrafts ? {} : { isDraft: { $ne: true } };
    
    // Fetch posts with pagination
    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .select('-content'); // Exclude content for list view
    
    return res.status(200).json({ posts });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/posts - Create new post
router.post('/', withAuth, upload.single('thumbnail'), async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    // Parse form data
    const { title, content, slug, meta, tags, category, isDraft } = req.body;
    
    // Validate required fields
    if (!title || !content || !slug || !meta) {
      return res.status(400).json({ 
        error: 'Title, content, slug, and meta are required' 
      });
    }

    // Parse tags (can be JSON string or array)
    let tagsArray = [];
    if (tags) {
      try {
        tagsArray = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (!Array.isArray(tagsArray)) {
          tagsArray = [];
        }
      } catch (e) {
        // If parsing fails, try splitting by comma
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
      }
    }

    // Check if slug already exists
    const existingPost = await Post.findOne({ slug });
    if (existingPost) {
      return res.status(400).json({ error: 'Slug phải là duy nhất!' });
    }

    // Upload thumbnail to Cloudinary if provided
    let thumbnailData = null;
    
    // Nếu có file upload mới
    if (req.file) {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ 
          error: 'Cloudinary chưa được cấu hình' 
        });
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'ecobacgiang',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      thumbnailData = {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    } 
    // Nếu không có file upload nhưng có thumbnail URL (chọn từ thư viện)
    else if (req.body.thumbnail && typeof req.body.thumbnail === 'string' && req.body.thumbnail.trim()) {
      const thumbnailUrl = req.body.thumbnail.trim();
      // Kiểm tra xem URL có phải là Cloudinary URL không
      if (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://')) {
        // Lấy public_id từ URL nếu có thể
        // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{public_id}.{ext}
        const urlParts = thumbnailUrl.split('/');
        const uploadIndex = urlParts.findIndex(part => part === 'upload');
        if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
          const publicIdWithExt = urlParts.slice(uploadIndex + 1).join('/');
          const publicId = publicIdWithExt.replace(/\.[^/.]+$/, ''); // Remove extension
          
          thumbnailData = {
            url: thumbnailUrl,
            public_id: publicId,
          };
        } else {
          // Nếu không parse được public_id, chỉ lưu URL
          thumbnailData = {
            url: thumbnailUrl,
            public_id: null,
          };
        }
      }
    }

    // Create new post
    const newPost = new Post({
      title,
      content,
      slug,
      meta,
      tags: tagsArray,
      category: category || '',
      author: req.userId,
      isDraft: isDraft === 'true' || isDraft === true,
      thumbnail: thumbnailData,
    });

    await newPost.save();

    return res.status(200).json({ post: newPost });
  } catch (error) {
    console.error('Error creating post:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PATCH /api/posts/:postId/status - Toggle post status (draft/published)
router.patch('/:postId/status', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    const { postId } = req.params;
    const { isDraft } = req.body;
    
    if (typeof isDraft !== 'boolean') {
      return res.status(400).json({ error: 'isDraft must be a boolean' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author or admin
    const statusAuthorId = getAuthorId(post);
    if (!statusAuthorId) {
      // Nếu không có author, chỉ admin mới được update
      if (user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. Only admin can update posts without author.' 
        });
      }
    } else {
      if (statusAuthorId !== req.userId && user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. You can only edit your own posts.' 
        });
      }
    }

    // Update isDraft status
    post.isDraft = isDraft;
    await post.save();

    return res.status(200).json({ post });
  } catch (error) {
    console.error('Error toggling post status:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/posts/:postId - Update post
router.put('/:postId', withAuth, upload.single('thumbnail'), async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    const { postId } = req.params;
    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author or admin
    const updateAuthorId = getAuthorId(post);
    
    // Nếu không có author, chỉ admin mới được update
    if (!updateAuthorId) {
      if (user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. Only admin can update posts without author.' 
        });
      }
    } else {
      // Nếu có author, kiểm tra quyền
      if (updateAuthorId !== req.userId && user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. You can only edit your own posts.' 
        });
      }
    }

    // Parse form data or JSON body
    const { title, content, slug, meta, tags, category, isDraft } = req.body;
    
    // Update fields
    if (title) post.title = title;
    if (content) post.content = content;
    if (slug) post.slug = slug;
    if (meta) post.meta = meta;
    if (category !== undefined) post.category = category;
    // Xử lý isDraft: có thể là boolean hoặc string 'true'/'false'
    if (isDraft !== undefined) {
      if (typeof isDraft === 'boolean') {
        post.isDraft = isDraft;
      } else if (typeof isDraft === 'string') {
        post.isDraft = isDraft === 'true' || isDraft === '1';
      } else {
        post.isDraft = Boolean(isDraft);
      }
    }

    // Parse tags
    if (tags) {
      try {
        const tagsArray = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (Array.isArray(tagsArray)) {
          post.tags = tagsArray;
        }
      } catch (e) {
        const tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
        post.tags = tagsArray;
      }
    }

    // Upload new thumbnail if provided
    // Nếu có file upload mới
    if (req.file) {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ 
          error: 'Cloudinary chưa được cấu hình' 
        });
      }

      // Delete old thumbnail from Cloudinary if exists
      if (post.thumbnail && post.thumbnail.public_id) {
        try {
          await cloudinary.uploader.destroy(post.thumbnail.public_id);
        } catch (e) {
          console.error('Error deleting old thumbnail:', e);
        }
      }

      // Upload new thumbnail
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'ecobacgiang',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      post.thumbnail = {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    } 
    // Nếu không có file upload nhưng có thumbnail URL (chọn từ thư viện)
    else if (req.body.thumbnail && typeof req.body.thumbnail === 'string' && req.body.thumbnail.trim()) {
      const thumbnailUrl = req.body.thumbnail.trim();
      // Kiểm tra xem URL có phải là Cloudinary URL không
      if (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://')) {
        // Lấy public_id từ URL nếu có thể
        const urlParts = thumbnailUrl.split('/');
        const uploadIndex = urlParts.findIndex(part => part === 'upload');
        if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
          const publicIdWithExt = urlParts.slice(uploadIndex + 1).join('/');
          const publicId = publicIdWithExt.replace(/\.[^/.]+$/, ''); // Remove extension
          
          post.thumbnail = {
            url: thumbnailUrl,
            public_id: publicId,
          };
        } else {
          // Nếu không parse được public_id, chỉ lưu URL
          post.thumbnail = {
            url: thumbnailUrl,
            public_id: null,
          };
        }
      }
    }

    await post.save();

    return res.status(200).json({ post });
  } catch (error) {
    console.error('Error updating post:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/posts/:postId - Delete post
router.delete('/:postId', withAuth, async (req, res) => {
  try {
    await db.connectDb();
    
    // Check if user is admin or author
    const user = await User.findById(req.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'author')) {
      return res.status(403).json({ 
        error: 'Access denied. Admin or author role required.' 
      });
    }

    const { postId } = req.params;
    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author or admin
    const deleteAuthorId = getAuthorId(post);
    
    // Nếu không có author, chỉ admin mới được xóa
    if (!deleteAuthorId) {
      if (user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. Only admin can delete posts without author.' 
        });
      }
    } else {
      // Nếu có author, kiểm tra quyền
      if (deleteAuthorId !== req.userId && user.role !== 'admin') {
        return res.status(403).json({ 
          error: 'Access denied. You can only delete your own posts.' 
        });
      }
    }

    // Delete thumbnail from Cloudinary if exists
    if (post.thumbnail && post.thumbnail.public_id) {
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        try {
          await cloudinary.uploader.destroy(post.thumbnail.public_id);
        } catch (e) {
          console.error('Error deleting thumbnail from Cloudinary:', e);
          // Continue with post deletion even if thumbnail deletion fails
        }
      }
    }

    // Delete post from database
    await Post.findByIdAndDelete(postId);

    return res.status(200).json({ 
      removed: true,
      message: 'Post deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/posts/:postId - Get post by ID or slug
router.get('/:postId', async (req, res) => {
  try {
    await db.connectDb();
    const { postId } = req.params;
    
    // Kiểm tra xem postId có phải là ObjectId hợp lệ không (24 hex characters)
    const mongoose = require('mongoose');
    const isValidObjectId = mongoose.Types.ObjectId.isValid(postId) && postId.length === 24;
    
    // Build query conditions
    const queryConditions = {
      $and: [
        { isDraft: false },
        {
          $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
          ]
        }
      ]
    };
    
    // Nếu là ObjectId hợp lệ, tìm theo _id hoặc slug
    // Nếu không phải ObjectId, chỉ tìm theo slug
    if (isValidObjectId) {
      queryConditions.$and.push({
        $or: [
          { _id: postId },
          { slug: postId }
        ]
      });
    } else {
      // Chỉ tìm theo slug nếu không phải ObjectId
      queryConditions.$and.push({ slug: postId });
    }
    
    const post = await Post.findOne(queryConditions);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    return res.status(200).json({ post });
  } catch (error) {
    console.error('Error fetching post:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;

