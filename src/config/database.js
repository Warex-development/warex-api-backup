const { Pool } = require('pg');

// Verify DATABASE_URL is present
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Create PostgreSQL pool with Supabase credentials and SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Supabase
  }
});

// Connection event handlers
pool.on('connect', () => {
  console.log('✓ New database connection established');
});

pool.on('error', (err) => {
  console.error('✗ Unexpected error on database connection pool:', err);
});

pool.on('remove', () => {
  console.log('✓ Database connection removed from pool');
});

module.exports = pool;
