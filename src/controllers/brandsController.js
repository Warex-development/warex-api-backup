const pool = require('../config/database');

exports.getBrands = async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM brands ORDER BY name ASC');
    const brands = result.rows.map(row => row.name);
    return res.status(200).json(brands);
  } catch (error) {
    console.error('❌ [BRANDS] Get brands error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve brands' });
  }
};
