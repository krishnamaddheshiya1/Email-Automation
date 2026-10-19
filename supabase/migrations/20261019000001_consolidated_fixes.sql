-- ==============================================================================
-- Migration: 20261019000001_consolidated_fixes.sql
-- Description: Consolidated Schema Fixes for Email Automation Platform
--   1. Updates email_messages status constraint to support all lifecycle states
--   2. Adds open tracking and bounce metadata columns to email_messages
--   3. Ensures campaign_leads table exists for multi-step enrollments
--   4. Ensures conversation_messages table exists for Reply Inbox threading
--   5. Ensures sender_identities table exists for tenant sender management
--   6. Ensures suppressions table constraints and indexes
-- ==============================================================================

-- 1. Update email_messages status check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'email_messages' AND constraint_name = 'email_messages_status_check'
  ) THEN
    ALTER TABLE email_messages DROP CONSTRAINT email_messages_status_check;
  END IF;

  ALTER TABLE email_messages ADD CONSTRAINT email_messages_status_check
    CHECK (LOWER(status) IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'opened', 'bounced', 'failed', 'cancelled'));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not update email_messages_status_check constraint: %', SQLERRM;
END $$;

-- 2. Add open tracking and delivery columns to email_messages if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'open_count') THEN
    ALTER TABLE email_messages ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'opened_at') THEN
    ALTER TABLE email_messages ADD COLUMN opened_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'first_opened_at') THEN
    ALTER TABLE email_messages ADD COLUMN first_opened_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'last_opened_at') THEN
    ALTER TABLE email_messages ADD COLUMN last_opened_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'delivered_at') THEN
    ALTER TABLE email_messages ADD COLUMN delivered_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'bounced_at') THEN
    ALTER TABLE email_messages ADD COLUMN bounced_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'bounce_type') THEN
    ALTER TABLE email_messages ADD COLUMN bounce_type VARCHAR(50);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'bounce_subtype') THEN
    ALTER TABLE email_messages ADD COLUMN bounce_subtype VARCHAR(50);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'bounce_message') THEN
    ALTER TABLE email_messages ADD COLUMN bounce_message TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_messages' AND column_name = 'reply_to') THEN
    ALTER TABLE email_messages ADD COLUMN reply_to VARCHAR(255);
  END IF;
END $$;

-- 3. Create campaign_leads table for campaign enrollments and sequence tracking
CREATE TABLE IF NOT EXISTS campaign_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'ENROLLED' CHECK (UPPER(status) IN ('ENROLLED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'REPLIED', 'BOUNCED', 'CANCELLED')),
  current_step INTEGER NOT NULL DEFAULT 0,
  next_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL,
  next_run_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_leads_enrollment UNIQUE (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_due ON campaign_leads (status, next_run_at)
  WHERE status IN ('ENROLLED', 'WAITING') AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_leads_business ON campaign_leads (business_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead ON campaign_leads (lead_id);

-- 4. Create conversation_messages table for Reply Inbox threading
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  direction VARCHAR(20) NOT NULL DEFAULT 'INBOUND' CHECK (UPPER(direction) IN ('INBOUND', 'OUTBOUND')),
  sender_email VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL DEFAULT 'No Subject',
  body_text TEXT,
  body_html TEXT,
  provider_message_id VARCHAR(255),
  in_reply_to VARCHAR(255),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_convo ON conversation_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_provider_id ON conversation_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_messages_business ON conversation_messages (business_id);

-- 5. Add unread_count and campaign_id to conversations if missing, and update status constraint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'unread_count') THEN
    ALTER TABLE conversations ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'last_message_at') THEN
    ALTER TABLE conversations ADD COLUMN last_message_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'conversations' AND constraint_name = 'conversations_status_check'
  ) THEN
    ALTER TABLE conversations DROP CONSTRAINT conversations_status_check;
  END IF;

  ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
    CHECK (status IN ('active', 'open', 'replied', 'closed', 'archived', 'ACTIVE', 'OPEN', 'REPLIED', 'CLOSED', 'ARCHIVED'));
END $$;

-- 6. Create sender_identities table for tenant email senders
CREATE TABLE IF NOT EXISTS sender_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  from_name VARCHAR(255) NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  reply_to_email VARCHAR(255),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  provider VARCHAR(50) NOT NULL DEFAULT 'resend',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sender_identities_biz_email UNIQUE (business_id, from_email)
);

CREATE INDEX IF NOT EXISTS idx_sender_identities_business ON sender_identities (business_id);

-- 7. Suppressions table indexes & unique constraint
CREATE INDEX IF NOT EXISTS idx_suppressions_biz_email ON suppressions (business_id, LOWER(email));

-- 8. Enhance email_events with direct columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'business_id') THEN
    ALTER TABLE email_events ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'email_message_id') THEN
    ALTER TABLE email_events ADD COLUMN email_message_id UUID REFERENCES email_messages(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'campaign_id') THEN
    ALTER TABLE email_events ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'campaign_step_id') THEN
    ALTER TABLE email_events ADD COLUMN campaign_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'lead_id') THEN
    ALTER TABLE email_events ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'enrollment_id') THEN
    ALTER TABLE email_events ADD COLUMN enrollment_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'provider_event_id') THEN
    ALTER TABLE email_events ADD COLUMN provider_event_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'event_timestamp') THEN
    ALTER TABLE email_events ADD COLUMN event_timestamp TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_events' AND column_name = 'metadata') THEN
    ALTER TABLE email_events ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'email_events' AND constraint_name = 'email_events_event_type_check'
  ) THEN
    ALTER TABLE email_events DROP CONSTRAINT email_events_event_type_check;
  END IF;

  ALTER TABLE email_events ADD CONSTRAINT email_events_event_type_check
    CHECK (LOWER(event_type::text) IN (
      'sent', 'delivered', 'opened', 'clicked', 'bounced',
      'complained', 'unsubscribed', 'failed', 'replied', 'delivery_delayed'
    ));

  ALTER TABLE email_events ALTER COLUMN message_id DROP NOT NULL;
END $$;

-- 8. Enable Row Level Security (RLS) on new tables
ALTER TABLE campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sender_identities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_leads' AND policyname = 'service_role_campaign_leads') THEN
    CREATE POLICY service_role_campaign_leads ON campaign_leads FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_messages' AND policyname = 'service_role_conversation_messages') THEN
    CREATE POLICY service_role_conversation_messages ON conversation_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sender_identities' AND policyname = 'service_role_sender_identities') THEN
    CREATE POLICY service_role_sender_identities ON sender_identities FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
