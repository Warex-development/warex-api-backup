const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getMyNotifications,
  markAsRead,
  markAllRead,
  deleteNotification
} = require('../controllers/notificationsController');

// --- USER ROUTES ---
router.get('/my', verifyToken, getMyNotifications);
router.put('/:id/read', verifyToken, markAsRead);
router.put('/read-all', verifyToken, markAllRead);
router.delete('/:id', verifyToken, deleteNotification);

module.exports = router;
