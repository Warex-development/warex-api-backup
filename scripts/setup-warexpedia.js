/**
 * setup-warexpedia.js
 * 
 * One-time setup script for WarexPedia feature.
 * Creates the warexpedia_documents table and warexpedia-files storage bucket.
 * Safe to re-run — uses IF NOT EXISTS and checks for existing bucket.
 * 
 * Usage: npm run setup:warexpedia
 */

require('dotenv').config();
const pool = require('../src/config/database');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function setupTable() {
  console.log('\n📦 [WarexPedia] Creating warexpedia_documents table...');
  
  const sql = `
    CREATE TABLE IF NOT EXISTS public.warexpedia_documents (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      title varchar(300) NOT NULL,
      description text,
      file_url text NOT NULL,
      file_type varchar(50),
      file_size_kb integer,
      contributor_name varchar(150) NOT NULL,
      contributor_company varchar(200),
      contributor_email varchar(200) NOT NULL,
      contributor_phone varchar(30),
      user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
      extracted_text text,
      views integer DEFAULT 0,
      downloads integer DEFAULT 0,
      status varchar(30) DEFAULT 'published',
      verification_status varchar(30) DEFAULT 'not_verified',
      created_at timestamptz DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_wp_created
      ON public.warexpedia_documents(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_wp_status
      ON public.warexpedia_documents(status);

    ALTER TABLE public.warexpedia_documents ADD COLUMN IF NOT EXISTS verification_status varchar(30) DEFAULT 'not_verified';

    CREATE TABLE IF NOT EXISTS public.warexpedia_document_votes (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES public.warexpedia_documents(id) ON DELETE CASCADE,
      ip_address varchar(64) NOT NULL,
      vote varchar(10) NOT NULL,
      created_at timestamptz DEFAULT now(),
      UNIQUE(document_id, ip_address)
    );
  `;

  await pool.query(sql);
  console.log('✅ [WarexPedia] Table warexpedia_documents created/verified successfully.');
}

async function setupBucket() {
  console.log('\n📁 [WarexPedia] Setting up warexpedia-files storage bucket...');

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.error('❌ [WarexPedia] Failed to list buckets:', listError.message);
    return;
  }

  const exists = buckets.some(b => b.name === 'warexpedia-files');

  if (exists) {
    console.log('✅ [WarexPedia] Bucket warexpedia-files already exists. Skipping creation.');
    return;
  }

  const { error: createError } = await supabase.storage.createBucket('warexpedia-files', {
    public: true,
    fileSizeLimit: 20 * 1024 * 1024, // 20MB
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  });

  if (createError) {
    console.error('❌ [WarexPedia] Failed to create bucket:', createError.message);
    return;
  }

  console.log('✅ [WarexPedia] Bucket warexpedia-files created successfully (public, 20MB limit).');
}

async function main() {
  console.log('========== WarexPedia Setup ==========');
  
  try {
    await setupTable();
    await setupBucket();
    console.log('\n========== WarexPedia Setup Complete ==========\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ [WarexPedia] Setup failed:', error.message);
    process.exit(1);
  }
}

main();
