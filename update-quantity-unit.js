const { Client } = require('pg');

const devUrl = 'postgresql://postgres.jgtjtabsjkecneajloia:Warex2026hub@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
const prodUrl = 'postgresql://postgres.ivxgzvlebwapsnehdgyp:Warex2026hub@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function updateDatabases() {
  const devClient = new Client({ connectionString: devUrl });
  const prodClient = new Client({ connectionString: prodUrl });

  try {
    await devClient.connect();
    await prodClient.connect();

    console.log('Updating Dev database...');
    // Add quantity_unit column
    await devClient.query('ALTER TABLE listings ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(50) DEFAULT \'PCs\'');
    // Change quantity to NUMERIC
    await devClient.query('ALTER TABLE listings ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric');

    console.log('Updating Prod database...');
    // Add quantity_unit column
    await prodClient.query('ALTER TABLE listings ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(50) DEFAULT \'PCs\'');
    // Change quantity to NUMERIC
    await prodClient.query('ALTER TABLE listings ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric');

    console.log('✅ Both databases updated successfully!');
  } catch (error) {
    console.error('Error updating databases:', error);
  } finally {
    await devClient.end();
    await prodClient.end();
  }
}

updateDatabases();
