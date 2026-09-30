const pool = require('../config/database');

const LISTING_CREDIT_AMOUNT = 500.00;

/**
 * Get or initialize wallet for a user.
 * Supports passing an existing client within a transaction.
 */
async function getOrCreateWallet(userId, client = pool) {
  let res = await client.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) {
    const insertRes = await client.query(
      `INSERT INTO wallets (user_id, balance, is_valid)
       VALUES ($1, 0.00, true)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );
    return insertRes.rows[0];
  }
  return res.rows[0];
}

/**
 * Credit NPR 500 on listing approval.
 * Idempotent: will not double-credit if already credited and not reversed.
 */
async function creditListingApproval(userId, listingId, client = pool) {
  // Check existing transactions for this listing
  const txCheck = await client.query(
    `SELECT type FROM wallet_transactions 
     WHERE user_id = $1 AND related_listing_id = $2 
     ORDER BY created_at DESC LIMIT 1`,
    [userId, listingId]
  );

  if (txCheck.rows.length > 0) {
    const lastType = txCheck.rows[0].type;
    // If last transaction was already a credit, do not double-credit
    if (lastType === 'credit_listing' || lastType === 'recredit_unhidden_listing') {
      console.log(`ℹ️ [WALLET] Listing ${listingId} already has active credit for user ${userId}. Skipping.`);
      return null;
    }
  }

  const wallet = await getOrCreateWallet(userId, client);
  const currentBalance = parseFloat(wallet.balance) || 0;
  const newBalance = currentBalance + LISTING_CREDIT_AMOUNT;

  // Update wallet
  await client.query(
    `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, wallet.id]
  );

  // Insert ledger record
  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, related_listing_id, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      wallet.id,
      userId,
      'credit_listing',
      LISTING_CREDIT_AMOUNT,
      newBalance,
      listingId,
      `Listing approved — credited NPR ${LISTING_CREDIT_AMOUNT}`
    ]
  );

  console.log(`💰 [WALLET] Credited NPR ${LISTING_CREDIT_AMOUNT} to user ${userId} for listing ${listingId}. Balance: ${newBalance}`);
  return { wallet: { ...wallet, balance: newBalance }, transaction: txRes.rows[0] };
}

/**
 * Reverse listing credit when listing is hidden or removed.
 * Enforces:
 * 1. Idempotency (does not reverse if already reversed or never credited).
 * 2. Balance floored at 0.00 (waives difference if balance is insufficient).
 */
async function reverseListingCredit(userId, listingId, reason = 'hidden', client = pool) {
  // Check if listing was credited and not already reversed
  const txCheck = await client.query(
    `SELECT type FROM wallet_transactions 
     WHERE user_id = $1 AND related_listing_id = $2 
     ORDER BY created_at DESC LIMIT 1`,
    [userId, listingId]
  );

  if (txCheck.rows.length === 0) {
    // Never credited before (e.g. unapproved listing)
    return null;
  }

  const lastType = txCheck.rows[0].type;
  if (lastType === 'reversal_hidden_listing' || lastType === 'reversal_deleted_listing') {
    // Already reversed
    console.log(`ℹ️ [WALLET] Listing ${listingId} already reversed for user ${userId}. Skipping.`);
    return null;
  }

  const wallet = await getOrCreateWallet(userId, client);
  const currentBalance = parseFloat(wallet.balance) || 0;
  const newBalance = currentBalance - LISTING_CREDIT_AMOUNT;

  const txType = reason === 'deleted' ? 'reversal_deleted_listing' : 'reversal_hidden_listing';
  const note = `Listing ${reason} — reversed NPR ${LISTING_CREDIT_AMOUNT}`;

  // Update wallet
  await client.query(
    `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, wallet.id]
  );

  // Insert ledger record
  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, related_listing_id, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      wallet.id,
      userId,
      txType,
      -LISTING_CREDIT_AMOUNT,
      newBalance,
      listingId,
      note
    ]
  );

  console.log(`🔻 [WALLET] Reversed listing credit for user ${userId}, listing ${listingId}. Deducted: NPR ${LISTING_CREDIT_AMOUNT}, New Balance: ${newBalance}`);
  return { wallet: { ...wallet, balance: newBalance }, transaction: txRes.rows[0] };
}

/**
 * Re-credit NPR 500 when a previously reversed listing is unhidden.
 */
async function recreditListingUnhide(userId, listingId, client = pool) {
  const txCheck = await client.query(
    `SELECT type FROM wallet_transactions 
     WHERE user_id = $1 AND related_listing_id = $2 
     ORDER BY created_at DESC LIMIT 1`,
    [userId, listingId]
  );

  if (txCheck.rows.length === 0) {
    // Was never credited; do normal approval credit check
    return await creditListingApproval(userId, listingId, client);
  }

  const lastType = txCheck.rows[0].type;
  if (lastType === 'credit_listing' || lastType === 'recredit_unhidden_listing') {
    // Already active credit
    return null;
  }

  const wallet = await getOrCreateWallet(userId, client);
  const currentBalance = parseFloat(wallet.balance) || 0;
  const newBalance = currentBalance + LISTING_CREDIT_AMOUNT;

  await client.query(
    `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, wallet.id]
  );

  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, related_listing_id, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      wallet.id,
      userId,
      'recredit_unhidden_listing',
      LISTING_CREDIT_AMOUNT,
      newBalance,
      listingId,
      `Listing unhidden — re-credited NPR ${LISTING_CREDIT_AMOUNT}`
    ]
  );

  console.log(`💰 [WALLET] Re-credited NPR ${LISTING_CREDIT_AMOUNT} to user ${userId} for unhidden listing ${listingId}. Balance: ${newBalance}`);
  return { wallet: { ...wallet, balance: newBalance }, transaction: txRes.rows[0] };
}

/**
 * Apply wallet discount on deal execution.
 * Debits buyer's wallet ledger with 'debit_purchase'.
 */
async function applyDealWalletDiscount(userId, dealId, discountAmount, client = pool) {
  const amount = parseFloat(discountAmount) || 0;
  if (amount <= 0) return null;

  const wallet = await getOrCreateWallet(userId, client);
  const currentBalance = parseFloat(wallet.balance) || 0;

  if (currentBalance < amount || currentBalance <= 0) {
    throw new Error(`Insufficient wallet balance (Available: NPR ${currentBalance}, Required: NPR ${amount})`);
  }

  const newBalance = currentBalance - amount;

  await client.query(
    `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, wallet.id]
  );

  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, related_deal_id, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      wallet.id,
      userId,
      'debit_purchase',
      -amount,
      newBalance,
      dealId,
      `Used in Deal purchase discount — NPR ${amount}`
    ]
  );

  console.log(`🛒 [WALLET] Debited NPR ${amount} from user ${userId} for deal ${dealId}. Balance: ${newBalance}`);
  return { wallet: { ...wallet, balance: newBalance }, transaction: txRes.rows[0] };
}

/**
 * Release/Revert wallet discount if deal is cancelled or revised during negotiation.
 */
async function releaseDealWalletDiscount(userId, dealId, partialAmount = null, client = pool) {
  // Check if there was a debit for this deal
  const txCheck = await client.query(
    `SELECT amount FROM wallet_transactions 
     WHERE user_id = $1 AND related_deal_id = $2 AND type = 'debit_purchase'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, dealId]
  );

  if (txCheck.rows.length === 0) return null;

  const totalDebited = Math.abs(parseFloat(txCheck.rows[0].amount));
  const debitedAmount = partialAmount !== null ? Math.min(parseFloat(partialAmount) || 0, totalDebited) : totalDebited;
  if (debitedAmount <= 0) return null;

  const wallet = await getOrCreateWallet(userId, client);
  const currentBalance = parseFloat(wallet.balance) || 0;
  const newBalance = currentBalance + debitedAmount;

  await client.query(
    `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, wallet.id]
  );

  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, related_deal_id, note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      wallet.id,
      userId,
      'hold_release_cancelled_deal',
      debitedAmount,
      newBalance,
      dealId,
      partialAmount !== null 
        ? `Proforma revised — refunded partial wallet discount NPR ${debitedAmount}` 
        : `Deal cancelled — refunded wallet discount NPR ${debitedAmount}`
    ]
  );

  console.log(`🔄 [WALLET] Released deal discount NPR ${debitedAmount} back to user ${userId}. Balance: ${newBalance}`);
  return { wallet: { ...wallet, balance: newBalance }, transaction: txRes.rows[0] };
}

/**
 * Fetch member's wallet breakdown and transaction log with linked listing and deal names.
 */
async function getMemberWalletDetails(userId) {
  const wallet = await getOrCreateWallet(userId);

  // Count active approved listings (strictly public & approved, which earn wallet rewards)
  const approvedListingsRes = await pool.query(
    `SELECT COUNT(*) FROM listings 
     WHERE seller_id = $1 AND status = 'approved' AND is_hidden = false`,
    [userId]
  );
  const approvedCount = parseInt(approvedListingsRes.rows[0].count) || 0;

  // Breakdown of all listings by status for transparent auditing
  const breakdownRes = await pool.query(
    `SELECT 
       COUNT(*) as total_count,
       COUNT(*) FILTER (WHERE status = 'approved' AND is_hidden = false) as active_approved_count,
       COUNT(*) FILTER (WHERE status = 'approved' AND is_hidden = true) as hidden_approved_count,
       COUNT(*) FILTER (WHERE status = 'deleted') as deleted_count,
       COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
       COUNT(*) FILTER (WHERE status = 'pending' OR status = 'correction_needed') as pending_count
     FROM listings 
     WHERE seller_id = $1`,
    [userId]
  );
  const listingBreakdown = {
    total_count: parseInt(breakdownRes.rows[0]?.total_count) || 0,
    active_approved_count: parseInt(breakdownRes.rows[0]?.active_approved_count) || 0,
    hidden_approved_count: parseInt(breakdownRes.rows[0]?.hidden_approved_count) || 0,
    deleted_count: parseInt(breakdownRes.rows[0]?.deleted_count) || 0,
    rejected_count: parseInt(breakdownRes.rows[0]?.rejected_count) || 0,
    pending_count: parseInt(breakdownRes.rows[0]?.pending_count) || 0,
  };

  // Calculate totals
  const statsRes = await pool.query(
    `SELECT 
       COALESCE(SUM(CASE WHEN type IN ('credit_listing', 'recredit_unhidden_listing') THEN amount ELSE 0 END), 0) as total_earned,
       COALESCE(SUM(CASE WHEN type = 'debit_purchase' THEN ABS(amount) ELSE 0 END), 0) as total_spent,
       COALESCE(SUM(CASE WHEN type IN ('reversal_hidden_listing', 'reversal_deleted_listing') THEN ABS(amount) ELSE 0 END), 0) as total_reversed
     FROM wallet_transactions 
     WHERE user_id = $1`,
    [userId]
  );
  
  const stats = statsRes.rows[0] || {};
  const totalEarned = parseFloat(stats.total_earned) || 0;
  const totalSpent = parseFloat(stats.total_spent) || 0;
  const totalReversed = parseFloat(stats.total_reversed) || 0;

  // Fetch transactions with joined listing and deal details
  const txRes = await pool.query(
    `SELECT wt.*,
            l.name as listing_name,
            l.request_id as listing_request_id,
            d.deal_id as deal_ref_id
     FROM wallet_transactions wt
     LEFT JOIN listings l ON wt.related_listing_id = l.id
     LEFT JOIN deals d ON wt.related_deal_id = d.id
     WHERE wt.user_id = $1 
     ORDER BY wt.created_at DESC 
     LIMIT 100`,
    [userId]
  );

  return {
    balance: parseFloat(wallet.balance) || 0,
    is_valid: wallet.is_valid,
    approved_listing_count: approvedCount,
    listing_breakdown: listingBreakdown,
    total_earned_from_listings: totalEarned,
    total_spent_on_deals: totalSpent,
    total_reversed: totalReversed,
    credit_per_listing: LISTING_CREDIT_AMOUNT,
    transactions: txRes.rows
  };
}

module.exports = {
  LISTING_CREDIT_AMOUNT,
  getOrCreateWallet,
  creditListingApproval,
  reverseListingCredit,
  recreditListingUnhide,
  applyDealWalletDiscount,
  releaseDealWalletDiscount,
  getMemberWalletDetails
};
