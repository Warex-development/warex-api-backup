const pool = require('../config/database');
const { createNotification } = require('../services/notificationService');
const { sendMembershipRequestAlert } = require('../services/emailService');

const createUpgradeRequest = async (req, res) => {
  try {
    const { plan_type } = req.body;
    const userId = req.user.id;

    // Check if there's already a pending request
    const existing = await pool.query(
      "SELECT id FROM membership_requests WHERE user_id = $1 AND status = 'pending'",
      [userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a pending upgrade request' });
    }

    const result = await pool.query(
      `INSERT INTO membership_requests (user_id, plan_type) 
       VALUES ($1, $2) RETURNING *`,
      [userId, plan_type]
    );

    // Email alert
    const memberResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    await sendMembershipRequestAlert(memberResult.rows[0], plan_type);

    return res.status(201).json({
      message: 'Upgrade request submitted successfully',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [MEMBERSHIP] Create request error:', error.message);
    return res.status(500).json({ message: 'Failed to submit upgrade request' });
  }
};

const getMyRequests = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM membership_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [MEMBERSHIP] Get my requests error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve requests' });
  }
};

const adminGetAllRequests = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const result = await pool.query(`
      SELECT r.*, u.full_name, u.company_name, u.email, u.plan as current_plan
      FROM membership_requests r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [ADMIN MEMBERSHIP] Get all requests error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve requests' });
  }
};

const adminApproveRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const { plan_price, admin_note } = req.body;

    // Get request details
    const requestResult = await pool.query(
      "SELECT * FROM membership_requests WHERE id = $1",
      [id]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request is already processed' });
    }

    // 1. Update request status
    await pool.query(
      `UPDATE membership_requests SET 
        status = 'approved', 
        admin_note = $1, 
        plan_price = $2,
        approved_by = $3,
        approved_at = NOW(),
        updated_at = NOW() 
       WHERE id = $4`,
      [admin_note, plan_price, req.user.id, id]
    );

    // 2. Update user plan
    await pool.query(
      `UPDATE users SET 
        plan = $1, 
        plan_price = $2, 
        upgraded_at = NOW(), 
        plan_expiry = NOW() + INTERVAL '1 year'
       WHERE id = $3`,
      [request.plan_type, plan_price, request.user_id]
    );

    // 3. Log revenue if price > 0
    if (parseFloat(plan_price) > 0) {
      await pool.query(
        `INSERT INTO revenue_log (source_type, reference_id, amount, description, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        ['membership', request.user_id, plan_price, `Upgrade to ${request.plan_type}`, req.user.id]
      );
    }

    // 4. Notify user
    await createNotification(
      request.user_id,
      "Membership Upgraded",
      `Your account has been upgraded to ${request.plan_type}.`,
      "system",
      "/dashboard/profile"
    );

    return res.status(200).json({ message: 'Membership upgrade approved' });
  } catch (error) {
    console.error('❌ [ADMIN MEMBERSHIP] Approve request error:', error.message);
    return res.status(500).json({ message: 'Failed to approve upgrade' });
  }
};

const adminDirectUpdatePlan = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { userId, plan_type, plan_price, duration } = req.body;

    if (!userId || !plan_type) {
      return res.status(400).json({ message: 'User ID and Plan Type are required' });
    }

    let interval = "1 year";
    if (duration === 'monthly') interval = "1 month";
    else if (duration === 'quarterly') interval = "3 months";

    // 1. Update user record
    await pool.query(
      `UPDATE users SET 
        plan = $1, 
        plan_price = $2, 
        upgraded_at = NOW(), 
        plan_expiry = NOW() + INTERVAL '${interval}'
       WHERE id = $3`,
      [plan_type, plan_price || 0, userId]
    );

    // 2. Log revenue if price > 0
    if (parseFloat(plan_price) > 0) {
      await pool.query(
        `INSERT INTO revenue_log (source_type, reference_id, amount, description, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        ['membership_direct', userId, plan_price, `Direct Upgrade to ${plan_type}`, req.user.id]
      );
    }

    // 3. Notify user
    await createNotification(
      userId,
      "Membership Updated by Admin",
      `Your membership plan has been manually updated to ${plan_type} by WareX Admin.`,
      "system",
      "/dashboard/profile"
    );

    return res.status(200).json({ message: 'Membership plan updated successfully' });
  } catch (error) {
    console.error('❌ [ADMIN DIRECT MEMBERSHIP] Update error:', error.message);
    return res.status(500).json({ message: 'Failed to update membership' });
  }
};

module.exports = {
  createUpgradeRequest,
  getMyRequests,
  adminGetAllRequests,
  adminApproveRequest,
  adminDirectUpdatePlan
};
