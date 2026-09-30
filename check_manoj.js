const { Pool } = require('pg');

const prodUrl = 'postgresql://postgres.ivxgzvlebwapsnehdgyp:Warex2026hub@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function check() {
  const p = new Pool({ connectionString: prodUrl });
  try {
    const res = await p.query(`
      SELECT 
        u.*,
        (SELECT COUNT(id) FROM listings WHERE seller_id = u.id AND status != 'rejected' AND status != 'deleted') as active_listings
      FROM users u
      WHERE u.email ILIKE '%manoj.yadav%'
    `);
    console.log("MANOJ YADAV DATA:", JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await p.end();
  }
}

check();
