-- ==============================================================================
-- Migration: 00005_campaign_leads.sql
-- Description: Phase 6 Campaign Configuration & Contact Enrollment Junction Table
-- ==============================================================================

-- 1. Campaign to Contact (Lead) Relationship Table
CREATE TABLE IF NOT EXISTS campaign_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'ENROLLED' CHECK (LOWER(status) IN ('enrolled', 'running', 'paused', 'completed', 'stopped', 'failed', 'removed', 'replied')),
  current_step INTEGER NOT NULL DEFAULT 0,
  current_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL,
  next_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL,
  next_run_at TIMESTAMPTZ,
  email VARCHAR(255),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_leads UNIQUE (campaign_id, lead_id)
);

-- Trigger for auto-updating updated_at
CREATE TRIGGER set_campaign_leads_updated_at
  BEFORE UPDATE ON campaign_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes for fast multi-tenant queries & enrollment lookups
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead ON campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_business ON campaign_leads(business_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_status ON campaign_leads(campaign_id, status);

-- 2. Ensure Campaign and Campaign Steps Status Constraints Support Phase 6 Lifecycle
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (
  LOWER(status) IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'archived')
);

ALTER TABLE campaign_steps DROP CONSTRAINT IF EXISTS campaign_steps_status_check;
ALTER TABLE campaign_steps ADD CONSTRAINT campaign_steps_status_check CHECK (
  LOWER(status) IN ('active', 'paused', 'disabled', 'archived')
);
