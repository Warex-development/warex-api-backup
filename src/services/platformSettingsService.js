const pool = require('../config/database');

const DEFAULT_BANK_DETAILS = {
  bank_name: 'Nepal Investment Mega Bank',
  account_name: 'Future Techniques P. Ltd.',
  account_number: '00401040250962',
  branch: 'Pulchowk'
};

/**
 * Initialize bank_accounts and platform_settings tables if not exists
 */
async function initTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bank_name VARCHAR(200) NOT NULL,
        account_name VARCHAR(200) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        branch VARCHAR(100) NOT NULL,
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_details JSONB;

      INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, is_default, is_active)
      SELECT 'Nepal Investment Mega Bank', 'Future Techniques P. Ltd.', '00401040250962', 'Pulchowk', true, true
      WHERE NOT EXISTS (SELECT 1 FROM bank_accounts);

      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.warn('Warning: Could not initialize bank_accounts tables:', err.message);
  }
}

/**
 * Get all active Bank Accounts
 */
async function getBankAccounts() {
  try {
    await initTables();
    const res = await pool.query(`
      SELECT * FROM bank_accounts 
      WHERE is_active = true 
      ORDER BY is_default DESC, created_at ASC
    `);
    if (res.rows.length === 0) {
      return [{ id: 'default', ...DEFAULT_BANK_DETAILS, is_default: true, is_active: true }];
    }
    return res.rows;
  } catch (err) {
    console.warn('Could not fetch bank accounts, returning fallback:', err.message);
    return [{ id: 'default', ...DEFAULT_BANK_DETAILS, is_default: true, is_active: true }];
  }
}

/**
 * Get a specific Bank Account by ID (or default)
 */
async function getBankAccountById(id) {
  try {
    await initTables();
    if (id) {
      const res = await pool.query(`SELECT * FROM bank_accounts WHERE id = $1 AND is_active = true LIMIT 1`, [id]);
      if (res.rows.length > 0) return res.rows[0];
    }
    // Return default bank account
    const defRes = await pool.query(`SELECT * FROM bank_accounts WHERE is_default = true AND is_active = true LIMIT 1`);
    if (defRes.rows.length > 0) return defRes.rows[0];

    const firstRes = await pool.query(`SELECT * FROM bank_accounts WHERE is_active = true ORDER BY created_at ASC LIMIT 1`);
    if (firstRes.rows.length > 0) return firstRes.rows[0];

    return DEFAULT_BANK_DETAILS;
  } catch (err) {
    console.warn('Could not fetch bank account by id:', err.message);
    return DEFAULT_BANK_DETAILS;
  }
}

/**
 * Create a new Bank Account (Admin)
 */
async function createBankAccount({ bank_name, account_name, account_number, branch, is_default = false }) {
  await initTables();
  if (is_default) {
    await pool.query(`UPDATE bank_accounts SET is_default = false`);
  }
  const res = await pool.query(`
    INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, is_default, is_active)
    VALUES ($1, $2, $3, $4, $5, true)
    RETURNING *
  `, [bank_name.trim(), account_name.trim(), account_number.trim(), branch.trim(), is_default]);
  return res.rows[0];
}

/**
 * Update a Bank Account (Admin)
 */
async function updateBankAccount(id, { bank_name, account_name, account_number, branch, is_default }) {
  await initTables();
  if (is_default) {
    await pool.query(`UPDATE bank_accounts SET is_default = false WHERE id != $1`, [id]);
  }
  const res = await pool.query(`
    UPDATE bank_accounts 
    SET bank_name = COALESCE($1, bank_name),
        account_name = COALESCE($2, account_name),
        account_number = COALESCE($3, account_number),
        branch = COALESCE($4, branch),
        is_default = COALESCE($5, is_default),
        updated_at = NOW()
    WHERE id = $6
    RETURNING *
  `, [bank_name?.trim(), account_name?.trim(), account_number?.trim(), branch?.trim(), is_default, id]);
  return res.rows[0];
}

/**
 * Deactivate / Delete Bank Account (Admin)
 */
async function deleteBankAccount(id) {
  await initTables();
  const res = await pool.query(`UPDATE bank_accounts SET is_active = false, is_default = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
  return res.rows[0];
}

/**
 * Backwards compatibility helper for getBankDetails
 */
async function getBankDetails() {
  return await getBankAccountById();
}

module.exports = {
  getBankAccounts,
  getBankAccountById,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getBankDetails,
  DEFAULT_BANK_DETAILS
};
