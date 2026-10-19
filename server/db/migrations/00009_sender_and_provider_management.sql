-- ==============================================================================
-- Migration: 00009_sender_and_provider_management.sql
-- Description: Phase 10 Sender Identities and Email Provider Management
-- ==============================================================================

-- 1. Email Providers Configuration Table
CREATE TABLE IF NOT EXISTS email_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- e.g. 'RESEND'
  status VARCHAR(50) NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR')),
  encrypted_api_key TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_email_providers_business_provider UNIQUE (business_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_email_providers_business_status 
  ON email_providers(business_id, status);

-- 2. Sender Identities Table
CREATE TABLE IF NOT EXISTS sender_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES email_providers(id) ON DELETE SET NULL,
  from_name VARCHAR(255) NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  reply_to_email VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sender_identities_business_email UNIQUE (business_id, from_email)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_identities_business_email_lower 
  ON sender_identities(business_id, LOWER(from_email));

CREATE INDEX IF NOT EXISTS idx_sender_identities_business_status 
  ON sender_identities(business_id, status);

-- 3. Add sender_identity_id to Campaigns Table
ALTER TABLE campaigns 
  ADD COLUMN IF NOT EXISTS sender_identity_id UUID REFERENCES sender_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_sender_identity 
  ON campaigns(sender_identity_id);

-- 4. Expand Safety Audit Logs Event Type Constraint to Support Provider & Sender Lifecycle
ALTER TABLE safety_audit_logs DROP CONSTRAINT IF EXISTS safety_audit_logs_event_type_check;
ALTER TABLE safety_audit_logs DROP CONSTRAINT IF EXISTS safety_audit_logs_constraint_1;
ALTER TABLE safety_audit_logs ADD CONSTRAINT safety_audit_logs_event_type_check
  CHECK (
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
  );
