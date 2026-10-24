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
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected to PostgreSQL database...");

    await client.query("BEGIN;");

    // 1. Add business_id to automation_runs if not present
    console.log("Checking automation_runs.business_id...");
    await client.query(`
      ALTER TABLE automation_runs 
      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
    `);

    // Backfill business_id from campaign if null
    await client.query(`
      UPDATE automation_runs ar
      SET business_id = c.business_id
      FROM campaigns c
      WHERE ar.campaign_id = c.id AND ar.business_id IS NULL;
    `);

    // 2. Create contact_imports table if not exists
    console.log("Checking contact_imports table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_imports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        total_rows INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        invalid_count INTEGER NOT NULL DEFAULT 0,
        suppressed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL')),
        errors JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_contact_imports_business 
        ON contact_imports(business_id, created_at DESC);
    `);

    // 3. Create attachments table if not exists
    console.log("Checking attachments table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
        template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        storage_key VARCHAR(500) NOT NULL,
        storage_provider VARCHAR(50) NOT NULL DEFAULT 'local',
        storage_url TEXT,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_business_id ON attachments(business_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_campaign_id ON attachments(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_template_id ON attachments(template_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_attachments_storage_key ON attachments(storage_key);
    `);

    // 4. Create campaign_step_attachments table if not exists
    console.log("Checking campaign_step_attachments table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_step_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
        attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_step_attachment UNIQUE (campaign_step_id, attachment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_step ON campaign_step_attachments(campaign_step_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_attachment ON campaign_step_attachments(attachment_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_business ON campaign_step_attachments(business_id);
    `);

    // 5. Create template_attachments table if not exists
    console.log("Checking template_attachments table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
        attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_template_attachment UNIQUE (template_id, attachment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_template_attachments_template ON template_attachments(template_id);
      CREATE INDEX IF NOT EXISTS idx_template_attachments_attachment ON template_attachments(attachment_id);
      CREATE INDEX IF NOT EXISTS idx_template_attachments_business ON template_attachments(business_id);
    `);

    // 6. Ensure composite performance indexes on tenant tables
    console.log("Creating composite indexes for multi-tenant query patterns...");
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_automation_runs_biz ON automation_runs(business_id);",
      "CREATE INDEX IF NOT EXISTS idx_leads_biz_status ON leads(business_id, status);",
      "CREATE INDEX IF NOT EXISTS idx_leads_biz_created ON leads(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_campaigns_biz_status ON campaigns(business_id, status);",
      "CREATE INDEX IF NOT EXISTS idx_campaigns_biz_created ON campaigns(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_email_messages_biz_status ON email_messages(business_id, status);",
      "CREATE INDEX IF NOT EXISTS idx_email_messages_biz_created ON email_messages(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_email_events_biz_type ON email_events(business_id, event_type);",
      "CREATE INDEX IF NOT EXISTS idx_email_events_biz_created ON email_events(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_conversations_biz_status ON conversations(business_id, status);",
      "CREATE INDEX IF NOT EXISTS idx_conversations_biz_last_msg ON conversations(business_id, last_message_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_conversation_messages_biz_convo ON conversation_messages(business_id, conversation_id);",
      "CREATE INDEX IF NOT EXISTS idx_campaign_leads_biz_status ON campaign_leads(business_id, status);",
      "CREATE INDEX IF NOT EXISTS idx_campaign_leads_biz_next_run ON campaign_leads(business_id, next_run_at);",
      "CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_biz ON campaign_execution_logs(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_safety_audit_biz ON safety_audit_logs(business_id, created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_suppressions_biz_email ON suppressions(business_id, email);",
      "CREATE INDEX IF NOT EXISTS idx_sender_identities_biz ON sender_identities(business_id);",
    ];

    for (const idxSql of indexes) {
      await client.query(idxSql);
    }

    // 7. Enable RLS on all newly ensured tables
    console.log("Enabling RLS on tenant tables...");
    await client.query(`
      ALTER TABLE contact_imports ENABLE ROW LEVEL SECURITY;
      ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE campaign_step_attachments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE template_attachments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
    `);

    // Ensure service_role policy for newly ensured tables
    const newTables = [
      "contact_imports",
      "attachments",
      "campaign_step_attachments",
      "template_attachments",
    ];

    for (const t of newTables) {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = '${t}' AND policyname = 'service_role_${t}_all'
          ) THEN
            EXECUTE 'CREATE POLICY service_role_${t}_all ON ${t} FOR ALL TO service_role USING (true) WITH CHECK (true)';
          END IF;
        END $$;
      `);
    }

    await client.query("COMMIT;");
    console.log("Multi-tenant DB migration applied successfully!");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
