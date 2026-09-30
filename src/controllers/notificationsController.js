const pool = require('../config/database');

const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    // Get unread count (always returned)
    const countResult = await pool.query(
      'SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    const unreadCount = parseInt(countResult.rows[0].unread_count || 0);

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 50;
      const offset = (page - 1) * safeLimit;

      const dataResult = await pool.query(
        `SELECT id, title, message, type, link, is_read, created_at 
         FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2 OFFSET $3`,
        [userId, safeLimit, offset]
      );

      const totalResult = await pool.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
        [userId]
      );
      const total = parseInt(totalResult.rows[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages,
        unread_count: unreadCount
      });
    } else {
      // OLD format (array) - Note: We also need to send unread_count?
      // In the original code, it was an object.
      // If we return an array, where does unread_count go?
      // "return data in OLD format (array)"
      // I'll return the array directly as requested.
      const result = await pool.query(
        `SELECT id, title, message, type, link, is_read, created_at 
         FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT 50`,
        [userId]
      );
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [NOTIFICATION] Get error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve notifications' });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    return res.status(200).json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('❌ [NOTIFICATION] Mark read error:', error.message);
    return res.status(500).json({ message: 'Failed to update notification' });
  }
};

const markAllRead = async (req, res) => {
  try {
    const userId = req.user.id;
    
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    
    return res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('❌ [NOTIFICATION] Mark all read error:', error.message);
    return res.status(500).json({ message: 'Failed to update notifications' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    return res.status(200).json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('❌ [NOTIFICATION] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete notification' });
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllRead,
  deleteNotification
};
