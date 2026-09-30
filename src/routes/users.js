const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const pool = require('../config/database');

// PUT /api/users/mode
router.put('/mode', verifyToken, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['buyer', 'seller', 'both'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    await pool.query(
      'UPDATE users SET mode = $1 WHERE id = $2',
      [mode, req.user.id]
    );

    console.log(`✅ [USER] Mode updated to ${mode} for: ${req.user.email}`);
    return res.status(200).json({ mode });
  } catch (error) {
    console.error('❌ [USER] Mode update error:', error.message);
    return res.status(500).json({ error: 'Failed to update mode' });
  }
});

// PUT /api/users/profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      mobile,
      company_name,
      industry,
      address
    } = req.body;

    // Build update query dynamically to only update allowed fields
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (first_name) { updates.push(`first_name = $${paramIdx++}`); values.push(first_name); }
    if (last_name) { updates.push(`last_name = $${paramIdx++}`); values.push(last_name); }
    if (email) { updates.push(`email = $${paramIdx++}`); values.push(email); }
    if (mobile) { updates.push(`mobile = $${paramIdx++}`); values.push(mobile); }
    if (company_name) { updates.push(`company_name = $${paramIdx++}`); values.push(company_name); }
    if (industry) { updates.push(`industry = $${paramIdx++}`); values.push(industry); }
    if (address) { updates.push(`address = $${paramIdx++}`); values.push(address); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Also update full_name if first/last name changed
    if (first_name || last_name) {
      // We'd need to get the current values if one is missing, but for simplicity:
      // Let's just use the ones provided and assume the user wants them updated.
      // Better: fetch current user first.
      const userRes = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.user.id]);
      const current = userRes.rows[0];
      const fn = first_name || current.first_name;
      const ln = last_name || current.last_name;
      updates.push(`full_name = $${paramIdx++}`);
      values.push(`${fn} ${ln}`.trim());
    }

    values.push(req.user.id);
    const query = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIdx} RETURNING id, first_name, last_name, full_name, email, mobile, company_name, industry, address, role, vat_number, status, mode`;

    const result = await pool.query(query, values);
    const updatedUser = result.rows[0];

    console.log(`✅ [USER] Profile updated for: ${updatedUser.email}`);
    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error('❌ [USER] Profile update error:', error.message);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/users/vat-document
 * Generate signed URL for user's own VAT document
 */
router.get('/vat-document', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT vat_document_path FROM users WHERE id = $1',
      [req.user.id]
    );

    const path = result.rows[0]?.vat_document_path;
    if (!path) {
      return res.status(404).json({ error: 'No VAT document found' });
    }

    // Extract relative path from full URL if needed (DB stores full URL)
    let storagePath = path;
    if (path.includes('/vat-documents/')) {
      storagePath = path.split('/vat-documents/')[1];
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data, error } = await supabase.storage
      .from('vat-documents')
      .createSignedUrl(storagePath, 300); // 5 min

    if (error) throw error;
    return res.json({ url: data.signedUrl });
  } catch (error) {
    console.error('❌ [USER] Signed URL error:', error.message);
    return res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

module.exports = router;
