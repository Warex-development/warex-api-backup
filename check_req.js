const pool = require('./src/config/database');

async function test() {
  try {
    const req = await pool.query("SELECT * FROM buyer_requests WHERE request_id = 'REQ-1785'");
    console.log('Request:', JSON.stringify(req.rows[0], null, 2));
    
    if (req.rows[0] && req.rows[0].listing_id) {
      const lst = await pool.query('SELECT id, name, status, is_hidden, category_id, oem_part_no FROM listings WHERE id = $1', [req.rows[0].listing_id]);
      console.log('Listing:', JSON.stringify(lst.rows[0], null, 2));
    }
  } catch(e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

test();
