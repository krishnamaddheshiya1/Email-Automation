-- ==============================================================================
-- Migration: 00023_performance_composite_indexes.sql
-- Description: Targeted composite and partial indexes for high-throughput queries:
--              duplicate send prevention, provider webhook resolution,
--              campaign enrollment count & eligibility, step template lookup,
--              and unread conversation counts.
-- ==============================================================================

-- 1. Step send duplicate check (campaign_id, step_id, lead_id)
CREATE INDEX IF NOT EXISTS idx_email_messages_camp_step_lead 
  ON email_messages (campaign_id, step_id, lead_id);

-- 2. Resend provider message ID lookup (webhooks & sync)
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_id 
  ON email_messages (provider_message_id) 
  WHERE provider_message_id IS NOT NULL;

-- 3. Lead message history lookup
CREATE INDEX IF NOT EXISTS idx_email_messages_lead_id 
  ON email_messages (lead_id);

-- 4. Campaign messages by business
CREATE INDEX IF NOT EXISTS idx_email_messages_biz_camp 
  ON email_messages (business_id, campaign_id);

-- 5. Email events provider lookup for webhook idempotency
CREATE INDEX IF NOT EXISTS idx_email_events_provider_event 
  ON email_events (provider_event_id) 
  WHERE provider_event_id IS NOT NULL;

-- 6. Email events by message id
CREATE INDEX IF NOT EXISTS idx_email_events_message_id 
  ON email_events (email_message_id);

-- 7. Campaign enrollment state lookup (canonical count & execution)
CREATE INDEX IF NOT EXISTS idx_campaign_leads_camp_status 
  ON campaign_leads (campaign_id, status);

-- 8. Due enrollments scheduling index
CREATE INDEX IF NOT EXISTS idx_campaign_leads_camp_next_run 
  ON campaign_leads (campaign_id, next_run_at) 
  WHERE next_run_at IS NOT NULL;

-- 9. Campaign active steps lookup
CREATE INDEX IF NOT EXISTS idx_campaign_steps_camp_status 
  ON campaign_steps (campaign_id, status);

-- 10. Step templates lookup
CREATE INDEX IF NOT EXISTS idx_campaign_steps_template 
  ON campaign_steps (template_id) 
  WHERE template_id IS NOT NULL;

-- 11. Active email templates by business
CREATE INDEX IF NOT EXISTS idx_email_templates_biz_status 
  ON email_templates (business_id, status);

-- 12. Unread conversation counts by business
CREATE INDEX IF NOT EXISTS idx_conversations_biz_unread 
  ON conversations (business_id, unread_count) 
  WHERE unread_count > 0;
