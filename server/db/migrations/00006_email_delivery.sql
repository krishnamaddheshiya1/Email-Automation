-- ==============================================================================
-- Migration: 00006_email_delivery.sql
-- Description: Add metadata to email_messages and support bounce/complained statuses
-- ==============================================================================

-- Add metadata column to email_messages if not exists
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Update status check constraint on email_messages
ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_status_check;
ALTER TABLE email_messages ADD CONSTRAINT email_messages_status_check 
  CHECK (LOWER(status) IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'bounced', 'complained'));

-- Update event_type check constraint on email_events
ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_event_type_check;
ALTER TABLE email_events ADD CONSTRAINT email_events_event_type_check 
  CHECK (LOWER(event_type) IN ('sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'replied', 'received'));
