const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyToken } = require('../middleware/auth');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Admin only.' });
  }
};

// All analytics routes require authentication and admin role
router.use(verifyToken);
router.use(isAdmin);

router.get('/revenue', analyticsController.getRevenueAnalytics);
router.get('/deals', analyticsController.getDealsAnalytics);
router.get('/users', analyticsController.getUsersAnalytics);
router.get('/inventory', analyticsController.getInventoryAnalytics);

module.exports = router;
