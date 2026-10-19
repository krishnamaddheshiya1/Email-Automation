-- ==============================================================================
-- Migration: 00008_safety_and_deliverability.sql
-- Description: Phase 9 Email Safety, Deliverability, and Suppression Controls
-- ==============================================================================

-- 1. Expand Check Constraint on Suppressions Table to Support Phase 9 Reasons
ALTER TABLE suppressions DROP CONSTRAINT IF EXISTS suppressions_reason_check;
ALTER TABLE suppressions DROP CONSTRAINT IF EXISTS suppressions_constraint_1;
ALTER TABLE suppressions ADD CONSTRAINT suppressions_reason_check
  CHECK (LOWER(reason) IN ('unsubscribe', 'unsubscribed', 'bounce', 'hard_bounce', 'complaint', 'spam_complaint', 'manual', 'invalid'));

-- Ensure case-insensitive normalized index on (business_id, LOWER(email))
CREATE INDEX IF NOT EXISTS idx_suppressions_business_email_lower 
  ON suppressions(business_id, LOWER(email));

-- 2. Webhook Idempotency: Unique Constraint on provider_event_id in email_events
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_events_provider_event_id 
  ON email_events(provider_event_id) 
  WHERE provider_event_id IS NOT NULL;

-- 3. Safety Audit Logs Table
CREATE TABLE IF NOT EXISTS safety_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL CHECK (
    event_type IN (
      'unsubscribe',
      'hard_bounce',
      'complaint',
      'manual_suppression',
      'suppression_removal',
      'campaign_blocked',
      'send_limit_reached',
      'provider_connected',
      'provider_validation_failed',
      'provider_disabled',
      'provider_health_check',
      'sender_created',
      'sender_updated',
      'sender_disabled',
      'campaign_sender_changed'
    )
  ),
  recipient_email VARCHAR(255),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_audit_logs_business_created 
  ON safety_audit_logs(business_id, created_at DESC);

-- 4. Database-Backed Business Sending Counters
CREATE TABLE IF NOT EXISTS business_send_counters (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_type VARCHAR(20) NOT NULL, -- 'daily', 'hourly'
  period_key VARCHAR(50) NOT NULL,  -- e.g. '2026-10-16', '2026-10-16T11'
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS idx_business_send_counters_lookup 
  ON business_send_counters(business_id, period_type, period_key);
