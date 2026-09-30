const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const pool = require('../config/database');

/**
 * GET /api/categories
 * Public route - Get all categories
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, created_at FROM categories 
       ORDER BY 
         CASE WHEN name = 'Other' THEN 1 ELSE 0 END, 
         name ASC`
    );
    
    return res.status(200).json({
      message: 'Categories retrieved successfully',
      categories: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching categories:', error.message);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/categories/:id
 * Public route - Get single category
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, name, created_at FROM categories WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    return res.status(200).json({
      message: 'Category retrieved successfully',
      category: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching category:', error.message);
    return res.status(500).json({ error: 'Failed to fetch category' });
  }
});

/**
 * POST /api/protected/admin/categories
 * Admin only - Create new category
 */
router.post('/admin/create', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create categories' });
    }
    
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    const result = await pool.query(
      'INSERT INTO categories (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    
    return res.status(201).json({
      message: 'Category created successfully',
      category: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating category:', error.message);
    return res.status(500).json({ error: 'Failed to create category' });
  }
});

/**
 * DELETE /api/protected/admin/categories/:id
 * Admin only - Delete category
 */
router.delete('/admin/:id', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete categories' });
    }
    
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 RETURNING id, name',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    return res.status(200).json({
      message: 'Category deleted successfully',
      category: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting category:', error.message);
    return res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
