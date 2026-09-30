require('dotenv').config({ path: '.env.prod' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT id, full_name, email, vat_number, created_at 
      FROM users 
      WHERE email LIKE 'mahesh_test%' OR email LIKE 'mahesh177%'
    `);
    console.log("Found users:");
    console.table(res.rows);

    const ids = res.rows.map(r => r.id);
    if (ids.length > 0) {
      await pool.query("DELETE FROM notifications WHERE user_id = ANY($1::uuid[])", [ids]);
      const deleteRes = await pool.query(
        "DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id",
        [ids]
      );
      console.log(`Deleted ${deleteRes.rowCount} users.`);
    } else {
      console.log("No test users found.");
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
