import { Pool } from "pg";
import { getDbPool, closeDbPool } from "./client";
import { runMigrations } from "./migrate";
import { runSeed } from "./seed";

export async function resetDatabase(customPool?: Pool) {
  const pool = customPool || getDbPool();
  const client = await pool.connect();

  try {
    console.log("Resetting database (dropping existing tables)...");
    await client.query("BEGIN;");

    const dropTablesSql = `
      DROP TABLE IF EXISTS suppressions CASCADE;
      DROP TABLE IF EXISTS activities CASCADE;
      DROP TABLE IF EXISTS automation_runs CASCADE;
      DROP TABLE IF EXISTS conversations CASCADE;
      DROP TABLE IF EXISTS email_events CASCADE;
      DROP TABLE IF EXISTS email_messages CASCADE;
      DROP TABLE IF EXISTS campaign_steps CASCADE;
      DROP TABLE IF EXISTS campaigns CASCADE;
      DROP TABLE IF EXISTS email_templates CASCADE;
      DROP TABLE IF EXISTS leads CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS businesses CASCADE;
      DROP TABLE IF EXISTS _migrations CASCADE;
      DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
    `;

    await client.query(dropTablesSql);
    await client.query("COMMIT;");
    console.log("✓ All tables dropped successfully.");

    await runMigrations(pool);
    await runSeed(pool);

    console.log("✓ Database successfully reset, migrated, and seeded.");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("✗ Failed to reset database:", err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution from CLI
if (process.argv[1]?.endsWith("reset.ts")) {
  resetDatabase()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Database reset failed:", err);
      await closeDbPool();
      process.exit(1);
    });
}
