require('dotenv').config();
const pool = require('./src/config/database');

async function createBrandsTable() {
  try {
    console.log('Creating brands table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brands (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ brands table created');

    console.log('Seeding initial brands...');
    await pool.query(`
      INSERT INTO brands (name) VALUES
      ('Grundfos'), ('KSB'), ('Kirloskar'), ('Alfa Laval'),
      ('Atlas Copco'), ('Ingersoll Rand'), ('Danfoss'),
      ('Siemens'), ('ABB'), ('Schneider Electric'),
      ('Emerson'), ('Endress Hauser'), ('Yokogawa'),
      ('SKF'), ('FAG'), ('Timken'), ('Others')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('✓ initial brands seeded');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createBrandsTable();
