const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { getMyWallet, adminGetBuyerWallet } = require('../controllers/walletController');

// Member route
router.get('/my', verifyToken, getMyWallet);

// Admin route
router.get('/buyer/:id', verifyToken, adminGetBuyerWallet);

module.exports = router;
