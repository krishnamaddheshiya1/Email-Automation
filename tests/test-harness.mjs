import { newDb } from "pg-mem";
import fs from "fs";
import path from "path";
import crypto from "crypto";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.EMAIL_SECRET_ENCRYPTION_KEY =
  process.env.EMAIL_SECRET_ENCRYPTION_KEY || "test_mock_secret_encryption_key_32b_val";

export function createTestDb() {
  const db = newDb();

  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: db.public.getType("uuid"),
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  const schemaPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00001_core_schema.sql"
  );
  const indexesPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00002_core_indexes.sql"
  );
  const seedPath = path.resolve(
    process.cwd(),
    "server/db/seeds/dev_seed.sql"
  );

  let schemaSql = fs.readFileSync(schemaPath, "utf-8");
  // Strip plpgsql triggers and extensions that pg-mem parser does not implement
  schemaSql = schemaSql
    .replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, "")
    .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?LANGUAGE plpgsql;/gi, "")
    .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "");

  db.public.none(schemaSql);

  const indexesSql = fs.readFileSync(indexesPath, "utf-8");
  db.public.none(indexesSql);

  const campaignLeadsPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00005_campaign_leads.sql"
  );
  if (fs.existsSync(campaignLeadsPath)) {
    let clSql = fs.readFileSync(campaignLeadsPath, "utf-8");
    clSql = clSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(clSql);
    db.public.none("ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS email VARCHAR(255);");
    db.public.none("ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS current_step_id UUID;");
  }

  const campaignExecPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00007_campaign_execution.sql"
  );
  if (fs.existsSync(campaignExecPath)) {
    let ceSql = fs.readFileSync(campaignExecPath, "utf-8");
    ceSql = ceSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(ceSql);
  }

  const safetyDeliverabilityPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00008_safety_and_deliverability.sql"
  );
  if (fs.existsSync(safetyDeliverabilityPath)) {
    let sdSql = fs.readFileSync(safetyDeliverabilityPath, "utf-8");
    sdSql = sdSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "")
      .replace(/CHECK\s*\(\s*event_type\s+IN\s*\([\s\S]*?\)\s*\)/gi, "");
    db.public.none(sdSql);
  }

  const senderProviderPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00009_sender_and_provider_management.sql"
  );
  if (fs.existsSync(senderProviderPath)) {
    db.public.none("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_identity_id UUID;");
    let spSql = fs.readFileSync(senderProviderPath, "utf-8");
    spSql = spSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(spSql);
  }

  const analyticsPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00010_campaign_analytics_and_tracking.sql"
  );
  if (fs.existsSync(analyticsPath)) {
    db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;");
    db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;");
    db.public.none("ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_id UUID;");
    db.public.none("ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_step_id UUID;");
    db.public.none("ALTER TABLE email_events ADD COLUMN IF NOT EXISTS lead_id UUID;");
    db.public.none("ALTER TABLE email_events ADD COLUMN IF NOT EXISTS enrollment_id UUID;");
    let anSql = fs.readFileSync(analyticsPath, "utf-8");
    anSql = anSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(anSql);
  }

  const contactImportPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00011_contact_import_and_bulk_management.sql"
  );
  if (fs.existsSync(contactImportPath)) {
    let ciSql = fs.readFileSync(contactImportPath, "utf-8");
    ciSql = ciSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(ciSql);
  }

  const attachmentsPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00012_campaign_file_attachments.sql"
  );
  if (fs.existsSync(attachmentsPath)) {
    let attSql = fs.readFileSync(attachmentsPath, "utf-8");
    attSql = attSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(attSql);
  }

  const templateAttachmentsPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00013_template_file_attachments.sql"
  );
  if (fs.existsSync(templateAttachmentsPath)) {
    db.public.none("ALTER TABLE attachments ADD COLUMN IF NOT EXISTS template_id UUID;");
    let tplAttSql = fs.readFileSync(templateAttachmentsPath, "utf-8");
    tplAttSql = tplAttSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(tplAttSql);
  }

  const conversationsPath = path.resolve(
    process.cwd(),
    "server/db/migrations/00014_reply_inbox_and_conversations.sql"
  );
  if (fs.existsSync(conversationsPath)) {
    db.public.none("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS campaign_id UUID;");
    db.public.none("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject TEXT;");
    db.public.none("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_count INT DEFAULT 0;");
    let convSql = fs.readFileSync(conversationsPath, "utf-8");
    convSql = convSql
      .replace(/CREATE TRIGGER[\s\S]*?EXECUTE FUNCTION[^;]+;/gi, "")
      .replace(/ALTER TABLE [^;]+;/gi, "");
    db.public.none(convSql);
  }

  // Migration 00017 columns
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_type VARCHAR(50);");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_subtype VARCHAR(100);");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_message TEXT;");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_description TEXT;");

  // Migration 00018 columns
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ;");
  db.public.none("ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;");
  db.public.none("ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE;");

  return {
    db,
    seed: () => {
      let seedSql = fs.readFileSync(seedPath, "utf-8");
      db.public.none(seedSql);
    },
  };
}
