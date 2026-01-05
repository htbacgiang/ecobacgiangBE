const express = require('express');
const router = express.Router();
const db = require('../config/database');
const Product = require('../models/Product');
const { normalizeUnit } = require('../utils/normalizeUnit');

const VALID_UNITS = ['Kg', '100g', 'túi', 'hộp', 'chai'];

// GET /api/products - Get all products or by category
router.get('/', async (req, res) => {
  try {
    await db.connectDb();
    const { category, _id } = req.query;

    if (_id) {
      // Get product by ID
      const product = await Product.findById(_id).lean();
      if (!product) {
        return res.status(404).json({ status: 'error', err: 'Product not found' });
      }
      product.unit = normalizeUnit(product.unit);
      return res.json({
        status: 'success',
        product,
      });
    }

    // Get products with optional category filter
    const filter = category ? { category, isDeleted: { $ne: true } } : { isDeleted: { $ne: true } };
    const products = await Product.find(filter).lean();
    const productsNormalized = products.map((p) => ({ ...p, unit: normalizeUnit(p.unit) }));
    res.json({
      status: 'success',
      result: productsNormalized.length,
      products: productsNormalized,
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    return res.status(500).json({ status: 'error', err: 'Error fetching products' });
  }
});

// GET /api/products/:slug - Get product by slug
router.get('/:slug', async (req, res) => {
  try {
    await db.connectDb();
    const { slug } = req.params;
    const product = await Product.findOne({ slug }).lean();

    if (!product) {
      return res.status(404).json({ err: 'Product not found' });
    }

    product.unit = normalizeUnit(product.unit);

    res.json({
      status: 'success',
      product,
    });
  } catch (err) {
    console.error('Error fetching product by slug:', err);
    return res.status(500).json({ err: err.message });
  }
});

// POST /api/products - Create new product
router.post('/', async (req, res) => {
  const session = await Product.startSession();
  try {
    await db.connectDb();
    session.startTransaction();

    // Normalize slug
    if (req.body.slug) {
      req.body.slug = req.body.slug.trim().toLowerCase();
    }

    // Validate unit
    if (req.body.unit !== undefined) {
      req.body.unit = normalizeUnit(req.body.unit);
    }
    if (req.body.unit && !VALID_UNITS.includes(req.body.unit)) {
      await session.abortTransaction();
      return res.status(400).json({ status: 'error', err: 'Đơn vị phải là Kg, 100g, túi, hộp hoặc chai' });
    }

    // Check if maSanPham already exists
    const { maSanPham } = req.body;
    const existingProductByMaSanPham = await Product.findOne({ maSanPham, isDeleted: { $ne: true } }).session(session);
    if (existingProductByMaSanPham) {
      await session.abortTransaction();
      return res.status(400).json({ status: 'error', err: 'Mã sản phẩm (maSanPham) đã tồn tại' });
    }

    const product = new Product(req.body);
    await product.save({ session });

    await session.commitTransaction();
    res.json({
      status: 'success',
      product: { ...product.toObject(), unit: normalizeUnit(product.unit) },
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('Error creating product:', err);
    if (err.code === 11000) {
      if (err.keyPattern.maSanPham) {
        return res.status(400).json({ status: 'error', err: 'Mã sản phẩm (maSanPham) đã tồn tại' });
      }
      if (err.keyPattern.slug) {
        return res.status(400).json({ status: 'error', err: 'Slug đã tồn tại' });
      }
    }
    return res.status(500).json({ status: 'error', err: err.message || 'Error creating product' });
  } finally {
    session.endSession();
  }
});

// POST /api/products/check-slug - Check if slug exists
router.post('/check-slug', async (req, res) => {
  try {
    await db.connectDb();
    const { slug, _id } = req.body;
    if (!slug) {
      return res.status(400).json({ status: 'error', err: 'Slug is required' });
    }
    const normalizedSlug = slug.trim().toLowerCase();
    const query = { slug: normalizedSlug, isDeleted: { $ne: true } };
    if (_id) {
      query._id = { $ne: _id };
    }
    const existingProduct = await Product.findOne(query);
    if (existingProduct) {
      return res.status(400).json({ status: 'error', err: 'Slug đã tồn tại' });
    }
    res.json({ status: 'success' });
  } catch (err) {
    console.error('Error checking slug:', err);
    return res.status(500).json({ status: 'error', err: 'Error checking slug' });
  }
});

// PUT /api/products/:id - Update product
router.put('/:id', async (req, res) => {
  try {
    await db.connectDb();
    // Normalize slug
    if (req.body.slug) {
      req.body.slug = req.body.slug.trim().toLowerCase();
    }

    // Validate unit
    if (req.body.unit !== undefined) {
      req.body.unit = normalizeUnit(req.body.unit);
    }
    if (req.body.unit && !VALID_UNITS.includes(req.body.unit)) {
      return res.status(400).json({ status: 'error', err: 'Đơn vị phải là Kg, 100g, túi, hộp hoặc chai' });
    }

    const { maSanPham } = req.body;

    // Check if maSanPham is being changed to an existing one
    if (maSanPham) {
      const existingProductByMaSanPham = await Product.findOne({
        maSanPham,
        _id: { $ne: req.params.id },
        isDeleted: { $ne: true },
      });
      if (existingProductByMaSanPham) {
        return res.status(400).json({ status: 'error', err: 'Mã sản phẩm (maSanPham) đã tồn tại' });
      }
    }

    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) {
      return res.status(404).json({ status: 'error', err: 'Product not found' });
    }
    res.json({
      status: 'success',
      product: { ...product.toObject(), unit: normalizeUnit(product.unit) },
    });
  } catch (err) {
    console.error('Error updating product:', err);
    if (err.code === 11000) {
      if (err.keyPattern.maSanPham) {
        return res.status(400).json({ status: 'error', err: 'Mã sản phẩm (maSanPham) đã tồn tại' });
      }
      if (err.keyPattern.slug) {
        return res.status(400).json({ status: 'error', err: 'Slug đã tồn tại' });
      }
    }
    return res.status(500).json({ status: 'error', err: err.message || 'Error updating product' });
  }
});

// DELETE /api/products/:id - Soft delete product
router.delete('/:id', async (req, res) => {
  try {
    await db.connectDb();
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true },
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ status: 'error', err: 'Product not found' });
    }
    res.json({
      status: 'success',
      message: 'Product soft deleted',
    });
  } catch (err) {
    console.error('Error deleting product:', err);
    return res.status(500).json({ status: 'error', err: 'Error deleting product' });
  }
});

module.exports = router;

