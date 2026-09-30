const pool = require('../config/database');

/**
 * Create a new notification for a user
 * @param {string} userId - UUID of the user
 * @param {string} title - Notification title
 * @param {string} message - Notification message body
 * @param {string} type - Notification type (system, listing, request, deal)
 * @param {string} link - Optional link for the notification
 */
async function createNotification(userId, title, message, type = 'system', link = null) {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [userId, title, message, type, link, false]
    );
    
    console.log(`🔔 [NOTIFICATION] Created for user ${userId}: ${title}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ [NOTIFICATION] Service error:', error.message);
    // Don't throw error to avoid breaking main flow if notification fails
    return null;
  }
}

async function notifyAdmins(title, message, type = 'system', link = null) {
  try {
    // Get all admin IDs
    const adminsResult = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    const adminIds = adminsResult.rows.map(row => row.id);

    if (adminIds.length === 0) return [];

    const promises = adminIds.map(adminId => 
      createNotification(adminId, title, message, type, link)
    );

    return await Promise.all(promises);
  } catch (error) {
    console.error('❌ [NOTIFICATION] Admin notification error:', error.message);
    return [];
  }
}

module.exports = { createNotification, notifyAdmins };
