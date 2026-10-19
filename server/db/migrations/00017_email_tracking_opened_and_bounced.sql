-- ==============================================================================
-- Migration: 00017_email_tracking_opened_and_bounced.sql
-- Description: Supports real open tracking, bounce tracking, and multi-step scheduler
-- ==============================================================================

-- 1. Extend email_messages status to include 'opened'
ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_status_check;
ALTER TABLE email_messages ADD CONSTRAINT email_messages_status_check 
  CHECK (LOWER(status) IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'opened', 'failed', 'cancelled', 'bounced', 'complained'));

-- 2. Add open tracking and bounce detail columns to email_messages
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_type VARCHAR(50);
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_subtype VARCHAR(100);
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounce_message TEXT;

-- 3. Extend campaign_leads status to include 'WAITING'
ALTER TABLE campaign_leads DROP CONSTRAINT IF EXISTS campaign_leads_status_check;
ALTER TABLE campaign_leads ADD CONSTRAINT campaign_leads_status_check 
  CHECK (LOWER(status) IN ('enrolled', 'running', 'waiting', 'completed', 'paused', 'stopped', 'failed', 'removed', 'replied'));

-- 4. High performance indexes for fast due-job claiming and event aggregation
CREATE INDEX IF NOT EXISTS idx_email_events_biz_camp_type ON email_events(business_id, campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_type_time ON email_events(event_type, event_timestamp);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_due_claim ON campaign_leads(campaign_id, status, next_run_at);
