const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const pool = require('../config/database');
const { createNotification } = require('../services/notificationService');
const { sendApprovalEmail, sendRejectionEmail, sendSuspensionEmail } = require('../services/emailService');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Function to generate 4-char alphanumeric temp password
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(4))
    .map(b => chars[b % chars.length])
    .join('');
};

console.log('📦 [Protected] Routes loaded');

// Prevent caching for all protected API routes
// This fixes the issue where browser shows 304 Not Modified and old data is displayed
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

/**
 * GET /api/protected/admin/vat-document/:userId
 * Admin-only: Generate signed URL for a user's VAT document
 */
router.get('/admin/vat-document/:userId', verifyToken, async (req, res) => {
  console.log('📁 [ADMIN] VAT DOC ROUTE HIT:', req.params.userId);
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { userId } = req.params;

    const result = await pool.query(
      'SELECT vat_document_path FROM users WHERE id = $1',
      [userId]
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
      .createSignedUrl(storagePath, 3600); // 1 hour

    if (error) throw error;
    return res.json({ url: data.signedUrl });
  } catch (error) {
    console.error('❌ [ADMIN] Signed URL error:', error.message);
    return res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

/**
 * Protected route - Requires authentication
 * GET /api/protected/profile
 */
router.get('/profile', verifyToken, async (req, res) => {
  try {
    console.log(`📋 [PROTECTED] Profile requested by user: ${req.user.email}`);
    
    // Get full user data from database
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    
    if (result.rows.length === 0) {
      console.log(`⚠️  [PROTECTED] User not found: ${req.user.id}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    console.log(`✅ [PROTECTED] Profile retrieved for: ${user.email}`);
    
    return res.status(200).json({
      message: 'Profile retrieved successfully',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        mobile: user.mobile,
        country: user.country,
        role: user.role,
        status: user.status,
        company_name: user.company_name,
        vat_document_path: user.vat_document_path,
        industry_other: user.industry_other,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('❌ [PROTECTED] Profile error:', error.message);
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

/**
 * Admin-only route - Get all users (Alias for frontend)
 */
router.get('/admin/users', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search : null;

    const baseFields = 'id, first_name, last_name, full_name, email, role, status, company_name, vat_number, mobile, industry, industry_other, country, code, vat_document_path, created_at, plan, plan_price, plan_expiry, mode, member_mode, rejection_reason, (SELECT COUNT(*) FROM listings WHERE seller_id = users.id) as total_listings';
    
    let whereClause = '';
    const params = [];
    
    if (search) {
      whereClause = `WHERE 
        full_name ILIKE $1 OR 
        email ILIKE $1 OR 
        company_name ILIKE $1 OR 
        vat_number ILIKE $1 OR 
        role ILIKE $1 OR 
        status ILIKE $1 OR 
        plan ILIKE $1 OR
        code ILIKE $1`;
      params.push(`%${search}%`);
    }

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      const dataResult = await pool.query(
        `SELECT ${baseFields} FROM users ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, safeLimit, offset]
      );

      const statsResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active' OR status = 'approved') as active,
          COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM users
        ${whereClause}
      `, params);
      const stats = statsResult.rows[0];
      const total = parseInt(stats.total);
      const totalPages = Math.ceil(total / safeLimit);

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages,
        total_active: parseInt(stats.active),
        total_pending: parseInt(stats.pending)
      });
    } else {
      // OLD format (array)
      const result = await pool.query(`SELECT ${baseFields} FROM users ${whereClause} ORDER BY created_at DESC`, params);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [ADMIN] Users list error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve users' });
  }
});

/**
 * Admin-only route - Get all users
 * GET /api/protected/admin/all-users
 */
router.get('/admin/all-users', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const baseFields = 'id, first_name, last_name, full_name, email, role, status, company_name, vat_number, mobile, industry, country, code, created_at, plan, plan_price, plan_expiry, mode, member_mode, rejection_reason, (SELECT COUNT(*) FROM listings WHERE seller_id = users.id) as total_listings';
    
    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      const dataResult = await pool.query(
        `SELECT ${baseFields} FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [safeLimit, offset]
      );

      const countResult = await pool.query('SELECT COUNT(*) FROM users');
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
      // OLD format (array)
      const result = await pool.query(`SELECT ${baseFields} FROM users ORDER BY created_at DESC`);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [ADMIN] All users list error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve users' });
  }
});

/**
 * Admin-only route - Get pending users
 * GET /api/protected/admin/pending-users
 */
router.get('/admin/pending-users', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const baseFields = 'id, first_name, last_name, full_name, email, company_name, vat_number, mobile, industry, industry_other, country, code, status, vat_document_path, created_at, plan, plan_price, plan_expiry, mode, member_mode, rejection_reason';
    
    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      const dataResult = await pool.query(
        `SELECT ${baseFields} FROM users WHERE status = 'pending' ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [safeLimit, offset]
      );

      const countResult = await pool.query("SELECT COUNT(*) FROM users WHERE status = 'pending'");
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
      // OLD format (array)
      const result = await pool.query(`SELECT ${baseFields} FROM users WHERE status = 'pending' ORDER BY created_at DESC`);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [ADMIN] Pending users list error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve pending users' });
  }
});

/**
 * Admin-only route - Approve user
 * PUT /api/protected/admin/approve-user/:id
 */
router.put('/admin/approve-user/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`✅ [ADMIN] Approve user request by: ${req.user.email} for user ID: ${id}`);
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      console.log(`⚠️  [ADMIN] Access denied - Not admin: ${req.user.email} (Role: ${req.user.role})`);
      return res.status(403).json({ 
        message: 'You do not have permission to access this resource'
      });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      console.log(`⚠️  [ADMIN] User not found for approval: ${id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Generate temp password at approval time
    const tempPassword = generateTempPassword();
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(tempPassword, saltRounds);

    // Update user status to 'active' and set new password
    const result = await pool.query(
      'UPDATE users SET status = $1, temp_password = $2, password_hash = $3 WHERE id = $4 RETURNING id, first_name, full_name, email, status, temp_password, vat_number, company_name',
      ['active', tempPassword, passwordHash, id]
    );
    
    const approvedUser = result.rows[0];
    
    console.log(`✅ [ADMIN] User approved successfully (ID: ${id}, Email: ${approvedUser.email})`);
    
    // Send notification
    try {
      await createNotification(
        id, 
        "Account Approved", 
        "Your WareXhub account has been approved.", 
        "system", 
        "/dashboard"
      );
    } catch (notifErr) {
      console.error('⚠️ [NOTIFICATION] Failed to create notification:', notifErr.message);
    }

    // Send email
    try {
      await sendApprovalEmail(
        approvedUser,
        approvedUser.temp_password
      );
    } catch (emailErr) {
      console.error('⚠️ [EMAIL] Failed to send approval email:', emailErr.message);
    }
    
    return res.status(200).json({
      message: 'User approved',
      temp_password: approvedUser.temp_password,
      user_email: approvedUser.email,
      vat_number: approvedUser.vat_number,
      first_name: approvedUser.first_name,
      company_name: approvedUser.company_name
    });
  } catch (error) {
    console.error('❌ [ADMIN] Approve user error:', error.message);
    return res.status(500).json({ message: 'Failed to approve user' });
  }
});

/**
 * Admin-only route - Reject user
 * PUT /api/protected/admin/reject-user/:id
 */
router.put('/admin/reject-user/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body; // rejection reason from admin
    
    console.log(`❌ [ADMIN] Reject user request by: ${req.user.email} for user ID: ${id}, reason: ${reason}`);
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      console.log(`⚠️  [ADMIN] Access denied - Not admin: ${req.user.email} (Role: ${req.user.role})`);
      return res.status(403).json({ 
        message: 'You do not have permission to access this resource'
      });
    }

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ message: 'A rejection reason of at least 5 characters is required' });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      console.log(`⚠️  [ADMIN] User not found for rejection: ${id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update user status to 'rejected' and save reason
    const result = await pool.query(
      `UPDATE users SET status = $1, rejection_reason = $2 WHERE id = $3 
       RETURNING id, first_name, full_name, email, status`,
      ['rejected', reason.trim(), id]
    );
    
    const rejectedUser = result.rows[0];
    
    console.log(`✅ [ADMIN] User rejected successfully (ID: ${id}, Email: ${rejectedUser.email})`);

    // Send notification to user with reason
    await createNotification(
      id,
      'Application Not Approved',
      `Your WareXhub membership application was not approved. Reason: ${reason.trim()}. You may contact us for clarification.`,
      'system',
      '/contact'
    ).catch(() => {}); // Non-blocking

    // Send email
    await sendRejectionEmail(rejectedUser, reason.trim());
    
    return res.status(200).json({
      message: 'User rejected',
      user: rejectedUser
    });
  } catch (error) {
    console.error('❌ [ADMIN] Reject user error:', error.message);
    return res.status(500).json({ message: 'Failed to reject user' });
  }
});

/**
 * Update profile - Requires authentication
 * PUT /api/protected/profile
 */
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { full_name, mobile, country, company_name } = req.body;
    
    console.log(`✏️  [PROTECTED] Profile update requested by: ${req.user.email}`);
    
    // Update user profile
    const result = await pool.query(
      'UPDATE users SET full_name = $1, mobile = $2, country = $3, company_name = $4 WHERE id = $5 RETURNING *',
      [full_name || req.user.full_name, mobile, country, company_name, req.user.id]
    );
    
    if (result.rows.length === 0) {
      console.log(`⚠️  [PROTECTED] User not found for update: ${req.user.id}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    console.log(`✅ [PROTECTED] Profile updated for: ${user.email}`);
    
    return res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        mobile: user.mobile,
        country: user.country,
        company_name: user.company_name
      }
    });
  } catch (error) {
    console.error('❌ [PROTECTED] Profile update error:', error.message);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * Delete account - Requires authentication
 * DELETE /api/protected/profile
 */
router.delete('/profile', verifyToken, async (req, res) => {
  try {
    console.log(`🗑️  [PROTECTED] Account deletion requested by: ${req.user.email}`);
    
    // Delete user
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, email', [req.user.id]);
    
    if (result.rows.length === 0) {
      console.log(`⚠️  [PROTECTED] User not found for deletion: ${req.user.id}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`✅ [PROTECTED] Account deleted: ${result.rows[0].email}`);
    
    return res.status(200).json({
      message: 'Account deleted successfully',
      user_id: result.rows[0].id
    });
  } catch (error) {
    console.error('❌ [PROTECTED] Account deletion error:', error.message);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * @route   PUT /api/protected/admin/users/:id/role
 * @desc    Change user role (admin only)
 * @access  Admin Only
 */
router.put('/admin/users/:id/role', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Admin only' });
    }

    const { id } = req.params;
    const { role } = req.body;

    if (!['member', 'admin', 'support', 'reviewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, full_name, role',
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'User role updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating user role:', error.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * @route   PUT /api/protected/admin/edit-approve/:id
 * @desc    Update user details and approve in one step
 * @access  Admin Only
 */
router.put('/admin/edit-approve/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { id } = req.params;
    const { first_name, last_name, email, mobile, company_name, vat_number, country, industry, industry_other } = req.body;
    const full_name = `${first_name} ${last_name}`;

    // Generate temp password at approval time
    const tempPassword = generateTempPassword();
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(tempPassword, saltRounds);

    // Update user
    const result = await pool.query(
      `UPDATE users 
       SET first_name = $1, last_name = $2, full_name = $3, email = $4, mobile = $5, 
           company_name = $6, vat_number = $7, country = $8, industry = $9, industry_other = $10,
           status = 'active', approved_on = NOW(), approved_by = $11,
           temp_password = $12, password_hash = $13
       WHERE id = $14 
       RETURNING id, first_name, full_name, email, status, temp_password, vat_number, company_name`,
      [first_name, last_name, full_name, email, mobile, company_name, vat_number, country, industry, industry_other, req.user.id, tempPassword, passwordHash, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];

    // Send notification
    try {
      await createNotification(
        id, 
        "Account Approved", 
        "Your WareXhub account has been approved after review.", 
        "system", 
        "/dashboard"
      );
    } catch (notifErr) {
      console.error('⚠️ [NOTIFICATION] Failed to create notification:', notifErr.message);
    }

    // Send email
    try {
      await sendApprovalEmail(updatedUser, updatedUser.temp_password);
    } catch (emailErr) {
      console.error('⚠️ [EMAIL] Failed to send approval email:', emailErr.message);
    }

    res.json({
      message: 'User updated and approved successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error in edit-approve:', error.message);
    res.status(500).json({ error: 'Failed to update and approve user' });
  }
});

/**
 * Admin-only route - Resend approval email
 */
router.post('/admin/resend-approval-email/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = result.rows[0];
    await sendApprovalEmail(user, user.temp_password);
    res.json({ message: 'Approval email resent' });
  } catch (error) {
    console.error('Error resending approval email:', error.message);
    res.status(500).json({ error: 'Failed to resend email' });
  }
});

/**
 * Admin-only route - Resend rejection email
 */
router.post('/admin/resend-rejection-email/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = result.rows[0];
    if (!user.rejection_reason) return res.status(400).json({ error: 'No rejection reason found for this user' });
    
    await sendRejectionEmail(user, user.rejection_reason);
    res.json({ message: 'Rejection email resent' });
  } catch (error) {
    console.error('Error resending rejection email:', error.message);
    res.status(500).json({ error: 'Failed to resend email' });
  }
});

/**
 * Admin-only route - Suspend user
 */
router.put('/admin/users/:id/suspend', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE users SET status = 'suspended' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    // Notify user
    await sendSuspensionEmail(result.rows[0]);
    res.json({ message: 'User suspended successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error suspending user:', error.message);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

/**
 * Admin-only route - Unsuspend user
 */
router.put('/admin/users/:id/unsuspend', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE users SET status = 'active' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User unsuspended successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error unsuspending user:', error.message);
    res.status(500).json({ error: 'Failed to unsuspend user' });
  }
});

/**
 * Admin-only route - Delete user
 */
router.delete('/admin/users/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;

    // Soft delete logic: change status to 'deleted'
    const result = await pool.query(
      "UPDATE users SET status = 'deleted', temp_password = NULL WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error deleting user:', error.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * Admin-only: Get All Bank Accounts
 */
router.get('/admin/bank-accounts', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { getBankAccounts } = require('../services/platformSettingsService');
    const accounts = await getBankAccounts();
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('Error fetching bank accounts:', error.message);
    res.status(500).json({ error: 'Failed to fetch bank accounts' });
  }
});

/**
 * Admin-only: Add a new Bank Account
 */
router.post('/admin/bank-accounts', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { createBankAccount } = require('../services/platformSettingsService');
    const account = await createBankAccount(req.body);
    res.json({ success: true, message: 'Bank account created successfully', account });
  } catch (error) {
    console.error('Error creating bank account:', error.message);
    res.status(500).json({ error: 'Failed to create bank account' });
  }
});

/**
 * Admin-only: Update a Bank Account
 */
router.put('/admin/bank-accounts/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { updateBankAccount } = require('../services/platformSettingsService');
    const account = await updateBankAccount(req.params.id, req.body);
    res.json({ success: true, message: 'Bank account updated successfully', account });
  } catch (error) {
    console.error('Error updating bank account:', error.message);
    res.status(500).json({ error: 'Failed to update bank account' });
  }
});

/**
 * Admin-only: Delete/Deactivate a Bank Account
 */
router.delete('/admin/bank-accounts/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { deleteBankAccount } = require('../services/platformSettingsService');
    const account = await deleteBankAccount(req.params.id);
    res.json({ success: true, message: 'Bank account removed successfully', account });
  } catch (error) {
    console.error('Error removing bank account:', error.message);
    res.status(500).json({ error: 'Failed to remove bank account' });
  }
});

module.exports = router;
