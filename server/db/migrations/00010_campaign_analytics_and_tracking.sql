-- ==============================================================================
-- Migration: 00010_campaign_analytics_and_tracking.sql
-- Description: Phase 11 Campaign Analytics, Email Tracking & Event Infrastructure
-- ==============================================================================

-- 1. Extend email_messages with delivered_at and bounced_at timestamps
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;

-- 2. Extend email_events with campaign, step, lead, and enrollment references for high-performance analytics
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES campaign_leads(id) ON DELETE SET NULL;

-- 3. Update event_type CHECK constraint on email_events to include 'failed' and 'unsubscribed'
ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_event_type_check;
ALTER TABLE email_events ADD CONSTRAINT email_events_event_type_check CHECK (
  LOWER(event_type) IN (
    'sent',
    'delivered',
    'bounced',
    'complained',
    'failed',
    'unsubscribed',
    'opened',
    'clicked',
    'replied',
    'received'
  )
);

-- 4. Unique index on provider_event_id for strict deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_provider_event_id 
  ON email_events(provider_event_id) 
  WHERE provider_event_id IS NOT NULL;

-- 5. High-performance composite indexes for Campaign Analytics
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_analytics 
  ON email_events(business_id, campaign_id, event_type, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_campaign_step 
  ON email_events(campaign_id, campaign_step_id, event_type);

CREATE INDEX IF NOT EXISTS idx_email_events_lead_history 
  ON email_events(business_id, lead_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_campaign_analytics 
  ON email_messages(business_id, campaign_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_lead_history 
  ON email_messages(business_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_step_analytics 
  ON email_messages(campaign_id, campaign_step_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_status 
  ON campaign_leads(campaign_id, status);
