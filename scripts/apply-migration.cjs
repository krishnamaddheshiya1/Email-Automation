const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Obtain connection string from environment or .env.local
let connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const m = envContent.match(/^(?:DIRECT_URL|DATABASE_URL)=(.*)$/m);
      if (m) connectionString = m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

async function main() {
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL or DIRECT_URL environment variable is required.');
    process.exit(1);
  }

  console.log('Connecting to Supabase PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log('Connected successfully!');

    const migrationFile = path.resolve(process.cwd(), 'supabase/migrations/20261019000001_consolidated_fixes.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    console.log('Executing migration 20261019000001_consolidated_fixes.sql...');

    await client.query(sql);
    console.log('Migration applied successfully!');
  } catch (err) {
    console.error('Failed to apply migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
