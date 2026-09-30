const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const { publicFormLimiter } = require('../middleware/rateLimiter');
const { createGuestLead, getAllLeads, updateLeadStatus } = require('../controllers/leadsController');

// --- PUBLIC ROUTES ---
// POST /api/leads/guest
router.post('/guest', publicFormLimiter, createGuestLead);

// --- ADMIN ROUTES ---
// GET /api/leads/admin/all
router.get('/admin/all', verifyToken, isAdmin, getAllLeads);
// PUT /api/leads/admin/:id/status
router.put('/admin/:id/status', verifyToken, isAdmin, updateLeadStatus);

module.exports = router;
