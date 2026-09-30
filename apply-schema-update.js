const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function main() {
  console.log('Applying database schema updates...');
  
  try {
    // Listings Table Updates
    await pool.query(`
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS warranty_months INTEGER DEFAULT 0;
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS update_status VARCHAR(50) DEFAULT 'none';
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS pending_updates JSONB;
    `);
    console.log('Added new columns to listings table.');

    // Deals Table Updates
    await pool.query(`
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS seller_nda_doc VARCHAR(500);
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS buyer_nda_doc VARCHAR(500);
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS nda_status VARCHAR(50) DEFAULT 'pending';
    `);
    console.log('Added new columns to deals table.');

    console.log('Schema updates applied successfully.');
  } catch (error) {
    console.error('Error applying schema updates:', error);
  } finally {
    pool.end();
  }
}

main();
