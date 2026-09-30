const { Pool } = require('pg');

// Verify DATABASE_URL is present
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

const isVercel = Boolean(process.env.VERCEL);

// Create PostgreSQL pool with Supabase credentials and SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Supabase
  },
  // Vercel serverless optimization: prevent connection exhaustion on Supabase
  max: isVercel ? 2 : 10,
  idleTimeoutMillis: isVercel ? 5000 : 30000,
  connectionTimeoutMillis: 5000
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
