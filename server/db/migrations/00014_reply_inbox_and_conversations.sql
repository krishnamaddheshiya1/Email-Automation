-- ==============================================================================
-- Migration: 00014_reply_inbox_and_conversations.sql
-- Description: Reply Inbox, Conversation Threading, and Inbound Messages
-- ==============================================================================

-- 1. Extend conversations table with campaign association, subject, and unread counter
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_count INT NOT NULL DEFAULT 0;

-- 2. Create conversation_messages table for human-readable threaded communication
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  direction VARCHAR(20) NOT NULL CHECK (UPPER(direction) IN ('INBOUND', 'OUTBOUND')),
  sender_email VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  provider_message_id VARCHAR(255),
  in_reply_to VARCHAR(255),
  received_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Optimization Indexes for Multi-Tenant Querying, Threading, and Search
CREATE INDEX IF NOT EXISTS idx_conversations_business_last_msg ON conversations(business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_campaign ON conversations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_convo ON conversation_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_business ON conversation_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_provider_id ON conversation_messages(provider_message_id);
