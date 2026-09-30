require('dotenv').config();
const pool = require('./src/config/database');

async function checkTables() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('--- Existing Tables ---');
    res.rows.forEach(row => console.log(`- ${row.table_name}`));
    console.log('-----------------------');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to fetch tables:', err.message);
    process.exit(1);
  }
}

checkTables();
