import { Pool } from "pg";
import fs from "fs";

// Load .env.local
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
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const campaignId = "cbef11d9-bbac-4676-a1b8-023fe3798954";

  console.log("=== 1. CAMPAIGN ===");
  const campRes = await pool.query("SELECT * FROM campaigns WHERE id = $1", [campaignId]);
  console.log(campRes.rows);

  console.log("\n=== 2. STEPS ===");
  const stepsRes = await pool.query(
    "SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_number ASC",
    [campaignId]
  );
  console.log(stepsRes.rows);

  console.log("\n=== 3. CAMPAIGN LEADS ===");
  const leadsRes = await pool.query(
    "SELECT cl.id, cl.lead_id, l.email as lead_email, l.first_name, cl.status, cl.current_step_id, cl.next_run_at, cl.last_error, cl.retry_count, cl.metadata FROM campaign_leads cl LEFT JOIN leads l ON l.id = cl.lead_id WHERE cl.campaign_id = $1",
    [campaignId]
  );
  console.log(JSON.stringify(leadsRes.rows, null, 2));

  console.log("\n=== 5. CHECK TABLES ===");
  const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log("Tables:", tablesRes.rows.map((r) => r.table_name));

  console.log("\n=== 6. EXECUTION LOGS FOR CAMPAIGN ===");
  try {
    const execRes = await pool.query("SELECT * FROM campaign_execution_logs WHERE campaign_id = $1", [campaignId]);
    console.log(execRes.rows);
  } catch (e) {
    console.log("Error querying campaign_execution_logs:", e.message);
  }

  console.log("\n=== 7. CONVERSATIONS ===");
  try {
    const convRes = await pool.query("SELECT * FROM conversations");
    console.log(convRes.rows);
  } catch (e) {
    console.log("Error querying conversations:", e.message);
  }

  console.log("\n=== 9. CONSTRAINTS ON CAMPAIGN_LEADS ===");
  const conRes = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'campaign_leads'::regclass"
  );
  console.log(conRes.rows);

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
