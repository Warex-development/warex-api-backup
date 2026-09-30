/**
 * sync-upstream.js
 * Syncs updates from warex-api into warex-api-vercel while protecting
 * Vercel-specific files and configurations.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPSTREAM_DIR = path.resolve(__dirname, '../../warex-api');
const TARGET_DIR = path.resolve(__dirname, '..');

// Protected files that must NEVER be overwritten directly
const PROTECTED_FILES = new Set([
  'server.js',
  path.normalize('src/config/database.js'),
  path.normalize('api/index.js'),
  'vercel.json',
  '.vercelignore',
  'README.md',
  path.normalize('scripts/sync-upstream.js'),
  path.normalize('scripts/sync-upstream.bat')
]);

// Ignored directories & files
const IGNORED_PATHS = new Set([
  'node_modules',
  '.git',
  '.vercel'
]);

function getFileHash(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch (e) {
    return null;
  }
}

function copyRecursive(src, dest, relPath = '') {
  if (!fs.existsSync(src)) return;

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const currentRel = relPath ? path.join(relPath, entry.name) : entry.name;
    const normalizedRel = path.normalize(currentRel);

    if (IGNORED_PATHS.has(entry.name) || currentRel.startsWith('.env')) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyRecursive(srcPath, destPath, currentRel);
    } else {
      if (PROTECTED_FILES.has(normalizedRel)) {
        // For server.js and database.js, check if upstream has changed compared to last known
        const srcHash = getFileHash(srcPath);
        const destHash = getFileHash(destPath);
        if (srcHash && destHash && srcHash !== destHash) {
          console.warn(`\n⚠️  [PROTECTED FILE WARNING]: "${normalizedRel}" has differences in upstream warex-api!`);
          console.warn(`    --> This file was NOT overwritten to preserve Vercel configurations.`);
          console.warn(`    --> If you made new changes in warex-api for this file, please merge them manually.`);
        }
        continue;
      }

      // Safe to copy
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('🔄 Starting sync from warex-api to warex-api-vercel...');
console.log(`Source: ${UPSTREAM_DIR}`);
console.log(`Target: ${TARGET_DIR}\n`);

if (!fs.existsSync(UPSTREAM_DIR)) {
  console.error(`❌ Upstream directory not found at: ${UPSTREAM_DIR}`);
  process.exit(1);
}

copyRecursive(UPSTREAM_DIR, TARGET_DIR);
console.log('\n✅ Sync completed successfully!');
