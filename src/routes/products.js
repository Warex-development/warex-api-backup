const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const pool = require('../config/database');

/**
 * GET /api/protected/my-products
 * Protected, member only - Get seller's own products
 */
router.get('/protected/my-products', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'member') {
      return res.status(403).json({ error: 'Only members can view their products' });
    }
    
    const result = await pool.query(`
      SELECT 
        p.id, p.name, p.oem, p.make, p.manufacturer, p.condition, p.year,
        p.bid_price, p.description, p.eta, p.availability, p.image_color,
        p.application, p.status, p.submitted_date, p.approved_date, p.created_at,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.seller_id = $1
      ORDER BY p.submitted_date DESC
    `, [req.user.id]);
    
    return res.status(200).json({
      message: 'Products retrieved successfully',
      products: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching products:', error.message);
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * GET /api/protected/admin/pending-products
 * Admin only - Get all pending products
 */
router.get('/protected/admin/pending-products', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view pending products' });
    }
    
    const result = await pool.query(`
      SELECT 
        p.id, p.name, p.oem, p.make, p.manufacturer, p.condition, p.year,
        p.bid_price, p.description, p.eta, p.availability, p.image_color,
        p.application, p.status, p.submitted_date, p.created_at,
        c.name as category_name,
        u.company_name as seller_company, u.full_name as seller_name, u.email as seller_email
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.seller_id = u.id
      WHERE p.status = 'pending'
      ORDER BY p.submitted_date ASC
    `);
    
    return res.status(200).json({
      message: 'Pending products retrieved successfully',
      products: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching pending products:', error.message);
    return res.status(500).json({ error: 'Failed to fetch pending products' });
  }
});

/**
 * PUT /api/protected/admin/approve-product/:id
 * Admin only - Approve a product
 */
router.put('/protected/admin/approve-product/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can approve products' });
    }
    
    const { id } = req.params;
    
    const result = await pool.query(`
      UPDATE products 
      SET status = 'LIVE', approved_date = NOW(), approved_by = $1
      WHERE id = $2
      RETURNING id, name, status, approved_date
    `, [req.user.id, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    return res.status(200).json({
      message: 'Product approved successfully',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Error approving product:', error.message);
    return res.status(500).json({ error: 'Failed to approve product' });
  }
});

/**
 * PUT /api/protected/admin/reject-product/:id
 * Admin only - Reject a product
 */
router.put('/protected/admin/reject-product/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can reject products' });
    }
    
    const { id } = req.params;
    const { reason } = req.body;
    
    const result = await pool.query(`
      UPDATE products 
      SET status = 'REJECTED', approved_by = $1
      WHERE id = $2
      RETURNING id, name, status
    `, [req.user.id, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    return res.status(200).json({
      message: 'Product rejected successfully',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Error rejecting product:', error.message);
    return res.status(500).json({ error: 'Failed to reject product' });
  }
});

/**
 * POST /api/protected/products
 * Protected, member role - Create new product
 */
router.post('/protected/products', verifyToken, async (req, res) => {
  try {
    // Check if user is a member/seller
    if (req.user.role !== 'member') {
      return res.status(403).json({ error: 'Only members can create products' });
    }
    
    const {
      name, oem, make, manufacturer, condition, year, bid_price, category_id,
      description, eta, availability, image_color, application
    } = req.body;
    
    // Validate required fields
    if (!name || !bid_price || !category_id) {
      return res.status(400).json({ 
        error: 'Required fields: name, bid_price, category_id' 
      });
    }
    
    const result = await pool.query(`
      INSERT INTO products (
        name, oem, make, manufacturer, condition, year, bid_price, category_id,
        description, eta, availability, image_color, application,
        status, seller_id, submitted_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING id, name, bid_price, category_id, status, seller_id, submitted_date
    `, [
      name, oem, make, manufacturer, condition, year, bid_price, category_id,
      description, eta, availability, image_color, 
      application || null, 'pending', req.user.id
    ]);
    
    return res.status(201).json({
      message: 'Product created successfully - pending admin approval',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating product:', error.message);
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

/**
 * GET /api/products
 * Public route - Get all LIVE products
 */
router.get('/', async (req, res) => {
  try {
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    
    const page = pageParam ? parseInt(pageParam) : null;
    const limit = limitParam ? parseInt(limitParam) : 20;

    // Only paginate if 'page' is a valid number > 0
    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      // Get paginated data
      const dataResult = await pool.query(`
        SELECT 
          p.id, p.name, p.oem, p.make, p.manufacturer, p.condition, p.year,
          p.bid_price, p.description, p.eta, p.availability, p.image_color,
          p.application, p.submitted_date, p.created_at,
          c.name as category_name,
          u.company_name as seller_company, u.full_name as seller_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON p.seller_id = u.id
        WHERE p.status = 'LIVE'
        ORDER BY p.submitted_date DESC
        LIMIT $1 OFFSET $2
      `, [safeLimit, offset]);

      // Get total count
      const countResult = await pool.query(`
        SELECT COUNT(*) FROM products WHERE status = 'LIVE'
      `);
      
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages
      });
    } else {
      // Backward compatibility: Return full dataset as an array
      const result = await pool.query(`
        SELECT 
          p.id, p.name, p.oem, p.make, p.manufacturer, p.condition, p.year,
          p.bid_price, p.description, p.eta, p.availability, p.image_color,
          p.application, p.submitted_date, p.created_at,
          c.name as category_name,
          u.company_name as seller_company, u.full_name as seller_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON p.seller_id = u.id
        WHERE p.status = 'LIVE'
        ORDER BY p.submitted_date DESC
      `);
      
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('Error fetching products:', error.message);
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/**
 * GET /api/products/:id
 * Public route - Get single product
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        p.id, p.name, p.oem, p.make, p.manufacturer, p.condition, p.year,
        p.bid_price, p.description, p.eta, p.availability, p.image_color,
        p.application, p.submitted_date, p.approved_date, p.created_at,
        c.name as category_name,
        u.company_name as seller_company, u.full_name as seller_name,
        u.email as seller_email
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.seller_id = u.id
      WHERE p.id = $1 AND p.status = 'LIVE'
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    return res.status(200).json({
      message: 'Product retrieved successfully',
      product: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching product:', error.message);
    return res.status(500).json({ error: 'Failed to fetch product' });
  }
});

module.exports = router;
