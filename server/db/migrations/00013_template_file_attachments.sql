-- ==============================================================================
-- Migration: 00013_template_file_attachments.sql
-- Description: Allow attaching files directly to email templates
-- ==============================================================================

-- 1. Add template_id to attachments
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_template_id ON attachments(template_id);

-- 2. Template Attachments Junction Table
CREATE TABLE IF NOT EXISTS template_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_template_attachment UNIQUE (template_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_template_attachments_template ON template_attachments(template_id);
CREATE INDEX IF NOT EXISTS idx_template_attachments_attachment ON template_attachments(attachment_id);
CREATE INDEX IF NOT EXISTS idx_template_attachments_business ON template_attachments(business_id);
