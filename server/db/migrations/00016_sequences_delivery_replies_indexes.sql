-- ==============================================================================
-- Migration: 00016_sequences_delivery_replies_indexes.sql
-- Description: Add performance indexes for campaign execution, delivery tracking, and replies
-- ==============================================================================

-- 1. Campaign leads fast lookup by status and next_run_at
CREATE INDEX IF NOT EXISTS idx_campaign_leads_biz_lead_status ON campaign_leads(business_id, lead_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_biz_next_run ON campaign_leads(business_id, next_run_at);

-- 2. Fast webhook event matching by provider_message_id
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_msg_id ON email_messages(provider_message_id);

-- 3. Fast idempotency deduplication by provider_event_id
CREATE INDEX IF NOT EXISTS idx_email_events_provider_evt_id ON email_events(provider_event_id);

-- 4. Fast conversation thread resolution by contact
CREATE INDEX IF NOT EXISTS idx_conversations_biz_lead ON conversations(business_id, lead_id);
