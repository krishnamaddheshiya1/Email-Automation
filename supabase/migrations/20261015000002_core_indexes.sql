-- ==============================================================================
-- Migration: 20261015000002_core_indexes.sql
-- Description: Multi-tenant and high-performance indexes for core queries
-- ==============================================================================

-- 1. Businesses Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
CREATE INDEX IF NOT EXISTS idx_businesses_created_at ON businesses(created_at);

-- 2. Users Indexes
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(business_id, role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(business_id, status);

-- 3. Leads Indexes
CREATE INDEX IF NOT EXISTS idx_leads_business_id ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(business_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(business_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(business_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(business_id, created_at DESC);

-- 4. Campaigns Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(business_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(business_id, created_at DESC);

-- 5. Email Templates Indexes
CREATE INDEX IF NOT EXISTS idx_email_templates_business_id ON email_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_status ON email_templates(business_id, status);

-- 6. Campaign Steps Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign_id ON campaign_steps(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_template_id ON campaign_steps(template_id);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_step_number ON campaign_steps(campaign_id, step_number);

-- 7. Email Messages Indexes
CREATE INDEX IF NOT EXISTS idx_email_messages_business_id ON email_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_lead_id ON email_messages(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_campaign_id ON email_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(business_id, status);
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_id ON email_messages(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_scheduled ON email_messages(status, scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_email_messages_created_at ON email_messages(business_id, created_at DESC);

-- 8. Email Events Indexes
CREATE INDEX IF NOT EXISTS idx_email_events_business_id ON email_events(business_id);
CREATE INDEX IF NOT EXISTS idx_email_events_message_id ON email_events(email_message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(business_id, event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_provider_id ON email_events(provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_events_timestamp ON email_events(business_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(business_id, created_at DESC);

-- 9. Conversations Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_business_id ON conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(business_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(business_id, last_message_at DESC);

-- 10. Automation Runs Indexes
CREATE INDEX IF NOT EXISTS idx_automation_runs_business_id ON automation_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_lead_id ON automation_runs(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_campaign_id ON automation_runs(business_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created_at ON automation_runs(business_id, created_at DESC);

-- 11. Activities Indexes
CREATE INDEX IF NOT EXISTS idx_activities_business_id ON activities(business_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(business_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(business_id, created_at DESC);

-- 12. Suppressions Indexes
CREATE INDEX IF NOT EXISTS idx_suppressions_business_id ON suppressions(business_id);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(business_id, email);
CREATE INDEX IF NOT EXISTS idx_suppressions_created_at ON suppressions(business_id, created_at DESC);
