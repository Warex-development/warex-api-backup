/**
 * setup-storage.js
 * 
 * Run this ONCE on a new/production environment to:
 *  1. Create all required Supabase storage buckets
 *  2. Print RLS policy SQL to apply in Supabase SQL Editor
 * 
 * Usage:
 *   node setup-storage.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Bucket Definitions ───────────────────────────────────────────────────────
const BUCKETS = [
  {
    name             : process.env.SUPABASE_BUCKET_LISTINGS || 'listing-images',
    public           : true,
    fileSizeLimit    : 10 * 1024 * 1024,
    allowedMimeTypes : ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
  },
  {
    name             : process.env.SUPABASE_BUCKET_AVATARS || 'avatars',
    public           : true,
    fileSizeLimit    : 5 * 1024 * 1024,
    allowedMimeTypes : ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    name             : process.env.SUPABASE_BUCKET_DOCS || 'vat-documents',
    public           : false,
    fileSizeLimit    : 10 * 1024 * 1024,
    allowedMimeTypes : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function setupStorage() {
  console.log('\n========== WareXhub Storage Setup ==========');
  console.log(`Supabase: ${SUPABASE_URL}\n`);

  // List existing
  const { data: existing, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) { console.error('❌ List buckets failed:', listErr.message); process.exit(1); }

  const existingNames = existing.map(b => b.name);
  console.log('Existing buckets:', existingNames.length ? existingNames.join(', ') : 'none\n');

  // Create missing buckets
  for (const bucket of BUCKETS) {
    process.stdout.write(`📦 ${bucket.name} (public: ${bucket.public}) ... `);

    if (existingNames.includes(bucket.name)) {
      console.log('✅ Already exists');
    } else {
      const { error } = await supabase.storage.createBucket(bucket.name, {
        public           : bucket.public,
        fileSizeLimit    : bucket.fileSizeLimit,
        allowedMimeTypes : bucket.allowedMimeTypes,
      });
      console.log(error ? `❌ ${error.message}` : '✅ Created');
    }
  }

  // Print policy SQL
  console.log('\n\n======================================================================');
  console.log(' COPY THIS SQL → Supabase Dashboard → SQL Editor → Run');
  console.log('======================================================================\n');

  for (const bucket of BUCKETS) {
    const b = bucket.name;
    console.log(`-- ── ${b} ─────────────────────────────────────`);

    if (bucket.public) {
      console.log(`CREATE POLICY IF NOT EXISTS "${b}_public_read"
ON storage.objects FOR SELECT TO anon, authenticated
USING ( bucket_id = '${b}' );
`);
    }

    console.log(`CREATE POLICY IF NOT EXISTS "${b}_auth_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK ( bucket_id = '${b}' );

CREATE POLICY IF NOT EXISTS "${b}_auth_update"
ON storage.objects FOR UPDATE TO authenticated
USING ( bucket_id = '${b}' );

CREATE POLICY IF NOT EXISTS "${b}_auth_delete"
ON storage.objects FOR DELETE TO authenticated
USING ( bucket_id = '${b}' );
`);
  }

  console.log('======================================================================');
  console.log('✅ Done! Buckets verified. Run the SQL above for policies.\n');
}

setupStorage().catch(e => { console.error('Fatal:', e.message); });
