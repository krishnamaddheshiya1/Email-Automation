import { Pool } from "pg";
import fs from "fs";

const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
    const [k, ...v] = trimmed.split("=");
    if (!process.env[k]) {
      process.env[k] = v.join("=").replace(/^["']|["']$/g, "").trim();
    }
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

async function runAudit() {
  const client = await pool.connect();
  try {
    const { rows: cols } = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const tableMap = {};
    for (const c of cols) {
      if (!tableMap[c.table_name]) tableMap[c.table_name] = [];
      tableMap[c.table_name].push(c.column_name);
    }

    const { rows: rls } = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity 
      FROM pg_class 
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
      WHERE nspname = 'public' AND relkind = 'r'
      ORDER BY relname;
    `);

    const { rows: policies } = await client.query(`
      SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `);

    const { rows: constraints } = await client.query(`
      SELECT
        conrelid::regclass AS table_name,
        conname,
        contype,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY table_name, conname;
    `);

    const results = {
      tables: tableMap,
      rls,
      policies,
      constraints,
    };

    fs.mkdirSync("scratch", { recursive: true });
    fs.writeFileSync("scratch/audit-results.json", JSON.stringify(results, null, 2));
    console.log("Successfully wrote scratch/audit-results.json");
  } finally {
    client.release();
    await pool.end();
  }
}

runAudit().catch(console.error);
