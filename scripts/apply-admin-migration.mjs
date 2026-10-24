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

async function main() {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync("server/db/migrations/00020_admin_panel_audit_logs.sql", "utf8");
    await client.query(sql);
    console.log("Migration 00020 applied successfully!");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
