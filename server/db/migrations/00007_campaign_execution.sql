-- ==============================================================================
-- Migration: 00007_campaign_execution.sql
-- Description: Phase 8 Campaign Execution Engine & Scheduling Infrastructure
-- ==============================================================================

-- 1. Expand campaign_leads (enrollments) with execution state fields
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS current_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS next_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Update status check constraint for campaign_leads to support Phase 8 enrollment lifecycle
ALTER TABLE campaign_leads DROP CONSTRAINT IF EXISTS campaign_leads_status_check;
ALTER TABLE campaign_leads ADD CONSTRAINT campaign_leads_status_check CHECK (
  LOWER(status) IN ('enrolled', 'running', 'paused', 'completed', 'stopped', 'failed', 'removed')
);

-- Index for high-performance worker polling
CREATE INDEX IF NOT EXISTS idx_campaign_leads_worker_polling 
  ON campaign_leads(status, next_run_at) 
  WHERE next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_step 
  ON campaign_leads(campaign_id, current_step);

-- 2. Campaign Step Execution Audit & Idempotency Log Table
CREATE TABLE IF NOT EXISTS campaign_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (LOWER(status) IN ('pending', 'claimed', 'success', 'failed', 'skipped')),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for execution logs
CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_enrollment ON campaign_execution_logs(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_campaign ON campaign_execution_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_business ON campaign_execution_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_step ON campaign_execution_logs(campaign_step_id);
CREATE INDEX IF NOT EXISTS idx_campaign_exec_logs_idempotency ON campaign_execution_logs(idempotency_key);
