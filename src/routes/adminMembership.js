const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const membershipController = require('../controllers/membershipController');

// All admin membership routes require authentication and admin role
router.use(verifyToken, isAdmin);

router.get('/requests', membershipController.adminGetAllRequests);
router.put('/approve/:id', membershipController.adminApproveRequest);
router.post('/update-plan', membershipController.adminDirectUpdatePlan);

module.exports = router;
