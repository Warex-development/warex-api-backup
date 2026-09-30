const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const pool = require('../config/database');

/**
 * @route   GET /api/industries
 * @desc    Get all active industries for registration dropdown
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM industries WHERE is_active = true ORDER BY name ASC"
    );
    
    // Sort so 'Others' is always last
    const rows = result.rows;
    const othersIndex = rows.findIndex(i => i.name === 'Others');
    if (othersIndex > -1) {
      const others = rows.splice(othersIndex, 1)[0];
      rows.push(others);
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching industries:', error.message);
    res.status(500).json({ error: 'Failed to fetch industries' });
  }
});

/**
 * @route   POST /api/industries
 * @desc    Add a new industry
 * @access  Admin Only
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Admin only' });
    }

    const { name, icon, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Industry name is required' });

    const result = await pool.query(
      'INSERT INTO industries (name, icon, description) VALUES ($1, $2, $3) RETURNING *',
      [name, icon || '🏭', description]
    );

    res.status(201).json({
      message: 'Industry added successfully',
      industry: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding industry:', error.message);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Industry already exists' });
    }
    res.status(500).json({ error: 'Failed to add industry' });
  }
});

/**
 * @route   DELETE /api/industries/:id
 * @desc    Soft delete an industry (set is_active = false)
 * @access  Admin Only
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Admin only' });
    }

    const { id } = req.params;

    const result = await pool.query(
      'UPDATE industries SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Industry not found' });
    }

    res.json({
      message: 'Industry deactivated successfully',
      industry: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting industry:', error.message);
    res.status(500).json({ error: 'Failed to delete industry' });
  }
});

module.exports = router;
