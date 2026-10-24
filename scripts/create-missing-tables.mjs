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
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("Checking and creating campaign_execution_logs...");
  const sql = `
    CREATE TABLE IF NOT EXISTS campaign_execution_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
      enrollment_id UUID NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (LOWER(status) IN ('pending', 'claimed', 'success', 'failed', 'skipped')),
      idempotency_key VARCHAR(255) NOT NULL UNIQUE,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_enrollment ON campaign_execution_logs(enrollment_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_campaign ON campaign_execution_logs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_business ON campaign_execution_logs(business_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_step ON campaign_execution_logs(campaign_step_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_idempotency ON campaign_execution_logs(idempotency_key);
  `;

  await pool.query(sql);
  console.log("campaign_execution_logs table and indexes verified successfully!");

  // Also check safety_audit_logs if needed
  await pool.query(`
    CREATE TABLE IF NOT EXISTS safety_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      reason TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_safety_audit_logs_business ON safety_audit_logs(business_id);
    CREATE INDEX IF NOT EXISTS idx_safety_audit_logs_campaign ON safety_audit_logs(campaign_id);
  `);
  console.log("safety_audit_logs table and indexes verified successfully!");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
