-- ==============================================================================
-- Migration: 00011_contact_import_and_bulk_management.sql
-- Description: Phase 12 Contact CSV Import History, Bulk Management & Audit Logs
-- ==============================================================================

-- 1. Contact Imports History Table
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

-- 2. Update Safety Audit Logs Event Type Constraint
ALTER TABLE safety_audit_logs DROP CONSTRAINT IF EXISTS safety_audit_logs_event_type_check;
ALTER TABLE safety_audit_logs ADD CONSTRAINT safety_audit_logs_event_type_check CHECK (
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
    'campaign_sender_changed',
    'import_started',
    'import_completed',
    'import_failed',
    'bulk_enrollment_started',
    'bulk_enrollment_completed'
  )
);
