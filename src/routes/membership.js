const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const membershipController = require('../controllers/membershipController');

// User routes
router.post('/upgrade-request', verifyToken, membershipController.createUpgradeRequest);
router.get('/my-requests', verifyToken, membershipController.getMyRequests);

module.exports = router;
