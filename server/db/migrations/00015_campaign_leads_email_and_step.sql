-- ==============================================================================
-- Migration: 00015_campaign_leads_email_and_step.sql
-- Description: Add email and current_step_id columns to campaign_leads
-- ==============================================================================

ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS current_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_email ON campaign_leads(business_id, email);
