const { Pool } = require('pg');
require('dotenv').config();

async function testConnection() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully!');
    
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('📋 Tables found:', result.rows.map(r => r.table_name));
    
    const expected = ['users','categories','listings','buyer_requests',
                      'matches','quotes','deals','commissions',
                      'notifications','guest_leads'];
    
    const found = result.rows.map(r => r.table_name);
    const missing = expected.filter(t => !found.includes(t));
    
    if (missing.length === 0) {
      console.log('✅ All 10 tables present!');
    } else {
      console.log('❌ Missing tables:', missing);
    }
    
    client.release();
    pool.end();
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    pool.end();
  }
}

testConnection();
