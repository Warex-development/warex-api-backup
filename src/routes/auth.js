const express = require('express');
const router = express.Router();
const { register, login, adminLogin, forgotPassword, resetPassword, quickRegister } = require('../controllers/authController');
const { validateRegisterInput, validateLoginInput } = require('../middleware/validation');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimiter');

// POST /api/auth/register
router.post('/register', registerLimiter, validateRegisterInput, register);

// POST /api/auth/login
router.post('/login', authLimiter, validateLoginInput, login);

// POST /api/auth/admin-login
router.post('/admin-login', authLimiter, adminLogin);

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, forgotPassword);

// PUT /api/auth/reset-password (JWT required)
router.put('/reset-password', verifyToken, resetPassword);

// POST /api/auth/quick-register (Admin only)
router.post('/quick-register', verifyToken, isAdmin, quickRegister);

module.exports = router;
