import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { getDbPool, closeDbPool } from "./client";

export async function runSeed(customPool?: Pool) {
  const pool = customPool || getDbPool();
  const client = await pool.connect();

  try {
    console.log("Seeding development data...");
    const seedFile = path.resolve(process.cwd(), "server/db/seeds/dev_seed.sql");

    if (!fs.existsSync(seedFile)) {
      throw new Error(`Seed file not found at: ${seedFile}`);
    }

    const sql = fs.readFileSync(seedFile, "utf-8");
    await client.query("BEGIN;");
    await client.query(sql);
    await client.query("COMMIT;");

    console.log("✓ Successfully seeded development data.");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("✗ Error seeding data:", err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution from CLI
if (process.argv[1]?.endsWith("seed.ts")) {
  runSeed()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Seed failed:", err);
      await closeDbPool();
      process.exit(1);
    });
}
