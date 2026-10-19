-- ==============================================================================
-- Migration: 00012_campaign_file_attachments.sql
-- Description: Phase 15 File Attachments and Campaign Email Composer Foundation
-- ==============================================================================

-- 1. Attachments Metadata Table
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  storage_provider VARCHAR(50) NOT NULL DEFAULT 'local',
  storage_url TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast tenant scoping and campaign attachment lookups
CREATE INDEX IF NOT EXISTS idx_attachments_business_id ON attachments(business_id);
CREATE INDEX IF NOT EXISTS idx_attachments_campaign_id ON attachments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_attachments_storage_key ON attachments(storage_key);

-- Trigger for updated_at on attachments
CREATE TRIGGER set_attachments_updated_at
  BEFORE UPDATE ON attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Campaign Step Attachments Junction Table
CREATE TABLE IF NOT EXISTS campaign_step_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_step_attachment UNIQUE (campaign_step_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_step ON campaign_step_attachments(campaign_step_id);
CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_attachment ON campaign_step_attachments(attachment_id);
CREATE INDEX IF NOT EXISTS idx_campaign_step_attachments_business ON campaign_step_attachments(business_id);

-- 3. Update safety_audit_logs constraint to support attachment audit events
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
      'campaign_sender_changed',
      'import_started',
      'import_completed',
      'import_failed',
      'bulk_enrollment_started',
      'bulk_enrollment_completed',
      'auth_login_success',
      'auth_login_failed',
      'auth_registered',
      'campaign_created',
      'campaign_activated',
      'campaign_paused',
      'campaign_resumed',
      'campaign_completed',
      'test_email_sent',
      'webhook_received',
      'security_violation',
      'rate_limit_exceeded',
      'attachment_uploaded',
      'attachment_deleted',
      'attachment_attached',
      'attachment_removed',
      'attachment_rejected',
      'attachment_send_failed'
    )
  );
