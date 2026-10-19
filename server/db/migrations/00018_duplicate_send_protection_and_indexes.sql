-- ==============================================================================
-- Migration: 00018_duplicate_send_protection_and_indexes.sql
-- Description: Indexes for duplicate-send prevention, open timestamps, and tenant isolation
-- ==============================================================================

-- 1. Extend email_messages with explicit open tracking timestamps
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

-- 2. Extend campaign_leads with manual override flag
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Core indexes for fast idempotency, duplicate send protection, and tenant isolation
CREATE INDEX IF NOT EXISTS idx_email_messages_camp_lead_step 
  ON email_messages(campaign_id, lead_id, campaign_step_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_biz_lead 
  ON email_messages(business_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_to_email_biz 
  ON email_messages(business_id, to_email);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_camp_lead 
  ON campaign_leads(campaign_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_leads_biz_email 
  ON leads(business_id, email);

CREATE INDEX IF NOT EXISTS idx_conversations_biz_lead 
  ON conversations(business_id, lead_id);
