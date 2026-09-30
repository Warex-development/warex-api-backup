const pool = require('../config/database');
const { getMemberWalletDetails, getOrCreateWallet } = require('../services/walletService');

/**
 * GET /api/wallet/my
 * Member views their own wallet balance, breakdown, and transaction history.
 */
const getMyWallet = async (req, res) => {
  try {
    const details = await getMemberWalletDetails(req.user.id);
    return res.status(200).json(details);
  } catch (error) {
    console.error('❌ [WALLET] Get my wallet error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve wallet information' });
  }
};

/**
 * GET /api/wallet/buyer/:id
 * Admin checks a buyer's wallet info and eligible discount when creating/viewing deals.
 * Query params: ?base_amount=5000
 */
const adminGetBuyerWallet = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const baseAmount = parseFloat(req.query.base_amount) || 0;

    const details = await getMemberWalletDetails(id);
    const balance = parseFloat(details.balance) || 0;
    
    // Formula: MIN(wallet_balance, 0.10 * base_amount) — only if balance > 0
    const maxEligibleDiscount = balance > 0 ? Math.min(balance, Math.round(0.10 * baseAmount * 100) / 100) : 0;

    return res.status(200).json({
      user_id: id,
      ...details,
      base_amount: baseAmount,
      max_eligible_discount: maxEligibleDiscount,
      cap_percentage: 10
    });
  } catch (error) {
    console.error('❌ [WALLET ADMIN] Get buyer wallet error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve buyer wallet' });
  }
};

module.exports = {
  getMyWallet,
  adminGetBuyerWallet
};
