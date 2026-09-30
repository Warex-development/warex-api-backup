const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const { publicFormLimiter } = require('../middleware/rateLimiter');
const { submitContactForm, getAllMessages } = require('../controllers/contactController');

// --- PUBLIC ROUTES ---
router.post('/submit', publicFormLimiter, submitContactForm);

// --- ADMIN ROUTES ---
router.get('/admin/all', verifyToken, isAdmin, getAllMessages);

module.exports = router;
