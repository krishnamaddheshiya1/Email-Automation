-- ==============================================================================
-- Migration: 20261015000004_contacts_status.sql
-- Description: Expand leads status check constraint to support Phase 4 contact statuses
-- ==============================================================================

-- Drop existing check constraint if present
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

-- Add updated check constraint supporting Phase 4 contact lifecycle states
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  LOWER(status) IN (
    'new',
    'contacted',
    'replied',
    'interested',
    'not_interested',
    'qualified',
    'unqualified',
    'converted',
    'bounced',
    'unsubscribed',
    'archived'
  )
);

-- Multi-tenant index on lead source for fast filtering
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(business_id, source);
