-- Migration: 00021_ensure_email_providers.sql
-- Description: Ensures email_providers table exists and updates sender_identities columns

CREATE TABLE IF NOT EXISTS email_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
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

ALTER TABLE sender_identities ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE sender_identities ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES email_providers(id) ON DELETE SET NULL;
