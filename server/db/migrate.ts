import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { getDbPool, closeDbPool } from "./client";

export async function runMigrations(customPool?: Pool) {
  const pool = customPool || getDbPool();
  const client = await pool.connect();

  try {
    console.log("Starting database migrations...");

    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch already applied migrations
    const { rows: appliedRows } = await client.query(
      "SELECT name FROM _migrations ORDER BY id ASC;"
    );
    const appliedSet = new Set(appliedRows.map((r: { name: string }) => r.name));

    // Read migration files from directory
    const migrationsDir = path.resolve(process.cwd(), "server/db/migrations");
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${migrationsDir}`);
    }

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    console.log(`Found ${migrationFiles.length} migration file(s).`);

    let appliedCount = 0;
    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        console.log(`- Migration already applied: ${file}`);
        continue;
      }

      console.log(`> Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf-8");

      await client.query("BEGIN;");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1);", [file]);
        await client.query("COMMIT;");
        appliedCount++;
        console.log(`✓ Applied migration: ${file}`);
      } catch (migrationErr) {
        await client.query("ROLLBACK;");
        console.error(`✗ Error applying migration ${file}:`, migrationErr);
        throw migrationErr;
      }
    }

    console.log(`Migrations complete. Successfully applied ${appliedCount} new migration(s).`);
    return { success: true, appliedCount };
  } finally {
    client.release();
  }
}

// Direct execution from CLI
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration failed:", err);
      await closeDbPool();
      process.exit(1);
    });
}
