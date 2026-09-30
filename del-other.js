const { Pool } = require('pg'); 
require('dotenv').config(); 
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); 
pool.query("DELETE FROM categories WHERE name = 'Others'").then(() => { 
  console.log('Deleted Others'); 
  return pool.query("UPDATE categories SET name = 'Other' WHERE name = 'Others'");
}).then(() => {
  console.log('Done');
  pool.end(); 
}).catch(e => { 
  console.error(e); 
  pool.end(); 
});
