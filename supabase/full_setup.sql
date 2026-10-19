-- ==============================================================================
-- Full Setup Script for Supabase (Tables + Indexes + Seed Data)
-- Project: Email Automation Platform
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reusable timestamp updater function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Businesses
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  website VARCHAR(255),
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_businesses_updated_at ON businesses;
CREATE TRIGGER set_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Users (Application-level user model)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_business_email UNIQUE (business_id, email)
);

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. Leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  company_name VARCHAR(255),
  job_title VARCHAR(100),
  industry VARCHAR(100),
  website VARCHAR(255),
  source VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'bounced', 'unsubscribed')),
  lead_score INTEGER DEFAULT 0,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_leads_business_email UNIQUE (business_id, email)
);

DROP TRIGGER IF EXISTS set_leads_updated_at ON leads;
CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4. Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'archived')),
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 5. Email Templates
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_email_templates_updated_at ON email_templates;
CREATE TRIGGER set_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Campaign Steps
CREATE TABLE IF NOT EXISTS campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  delay_value INTEGER NOT NULL DEFAULT 0,
  delay_unit VARCHAR(20) NOT NULL DEFAULT 'hours' CHECK (delay_unit IN ('minutes', 'hours', 'days')),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_steps_step UNIQUE (campaign_id, step_number)
);

DROP TRIGGER IF EXISTS set_campaign_steps_updated_at ON campaign_steps;
CREATE TRIGGER set_campaign_steps_updated_at
  BEFORE UPDATE ON campaign_steps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. Email Messages
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_step_id UUID REFERENCES campaign_steps(id) ON DELETE SET NULL,
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  provider_message_id VARCHAR(255),
  from_email VARCHAR(255) NOT NULL,
  to_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_email_messages_updated_at ON email_messages;
CREATE TRIGGER set_email_messages_updated_at
  BEFORE UPDATE ON email_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 8. Email Events
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email_message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'replied')),
  provider_event_id VARCHAR(255),
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_conversations_updated_at ON conversations;
CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 10. Automation Runs
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  workflow_name VARCHAR(255) NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_automation_runs_updated_at ON automation_runs;
CREATE TRIGGER set_automation_runs_updated_at
  BEFORE UPDATE ON automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 11. Activities
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Suppressions
CREATE TABLE IF NOT EXISTS suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  reason VARCHAR(100) NOT NULL DEFAULT 'unsubscribe' CHECK (reason IN ('unsubscribe', 'bounce', 'spam_complaint', 'manual')),
  source VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_suppressions_business_email UNIQUE (business_id, email)
);

DROP TRIGGER IF EXISTS set_suppressions_updated_at ON suppressions;
CREATE TRIGGER set_suppressions_updated_at
  BEFORE UPDATE ON suppressions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
CREATE INDEX IF NOT EXISTS idx_businesses_created_at ON businesses(created_at);

CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(business_id, role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(business_id, status);

CREATE INDEX IF NOT EXISTS idx_leads_business_id ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(business_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(business_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(business_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(business_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(business_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_templates_business_id ON email_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_status ON email_templates(business_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign_id ON campaign_steps(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_template_id ON campaign_steps(template_id);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_step_number ON campaign_steps(campaign_id, step_number);

CREATE INDEX IF NOT EXISTS idx_email_messages_business_id ON email_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_lead_id ON email_messages(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_campaign_id ON email_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(business_id, status);
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_id ON email_messages(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_scheduled ON email_messages(status, scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_email_messages_created_at ON email_messages(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_business_id ON email_events(business_id);
CREATE INDEX IF NOT EXISTS idx_email_events_message_id ON email_events(email_message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(business_id, event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_provider_id ON email_events(provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_events_timestamp ON email_events(business_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_business_id ON conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(business_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(business_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_business_id ON automation_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_lead_id ON automation_runs(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_campaign_id ON automation_runs(business_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created_at ON automation_runs(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activities_business_id ON activities(business_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(business_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(business_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suppressions_business_id ON suppressions(business_id);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(business_id, email);
CREATE INDEX IF NOT EXISTS idx_suppressions_created_at ON suppressions(business_id, created_at DESC);

-- ==============================================================================
-- DEVELOPMENT SEED DATA (OPTIONAL DEMO ENTITIES)
-- ==============================================================================
INSERT INTO businesses (id, name, industry, website, timezone, status, settings)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Acme Corp Demo', 'Software', 'https://acme-demo.test', 'America/New_York', 'active', '{"sending_quota": 5000, "tracking_enabled": true}'),
  ('b0000000-0000-4000-8000-000000000002', 'TechPulse Logistics Demo', 'Logistics', 'https://techpulse-demo.test', 'UTC', 'active', '{"sending_quota": 2500, "tracking_enabled": true}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, business_id, email, full_name, role, status)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'alex.admin@acme-demo.test', 'Alex Admin', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'sam.sales@acme-demo.test', 'Sam Sales', 'member', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leads (id, business_id, first_name, last_name, email, phone, company_name, job_title, industry, website, source, status, lead_score, owner_user_id, metadata)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Jordan', 'Lee', 'jordan.lee@example-client.test', '+1-555-0101', 'Nexus Retail', 'VP of Operations', 'Retail', 'https://nexus-retail.test', 'inbound_web', 'qualified', 85, 'a0000000-0000-4000-8000-000000000002', '{"intent": "high"}'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Taylor', 'Morgan', 'taylor.morgan@example-corp.test', '+1-555-0102', 'Vanguard Systems', 'Director of Engineering', 'Technology', 'https://vanguard-systems.test', 'cold_list', 'contacted', 60, 'a0000000-0000-4000-8000-000000000002', '{"intent": "medium"}'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Casey', 'River', 'casey.river@example-health.test', '+1-555-0103', 'BioHealth Labs', 'Head of Logistics', 'Healthcare', 'https://biohealth-labs.test', 'event_conference', 'new', 20, NULL, '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_templates (id, business_id, name, subject, body, variables, status)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Demo Outreach Step 1', 'Quick question regarding {{company_name}}', 'Hi {{first_name}},\n\nI noticed {{company_name}} is expanding. Would love to share how our platform streamlines email operations.\n\nBest,\nAlex', '["first_name", "company_name"]', 'active'),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Demo Follow-up Step 2', 'Following up on our conversation', 'Hi {{first_name}},\n\nFloating this back to the top of your inbox. Did you have a moment to review my prior note?\n\nBest,\nAlex', '["first_name"]', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaigns (id, business_id, name, description, status, timezone, settings)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Q4 Outbound SaaS Expansion', 'Targeted sequence for tech and retail executives', 'active', 'America/New_York', '{"daily_limit": 100, "track_opens": true, "track_clicks": true}'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Product Launch Waitlist', 'Nurture sequence for beta invitees', 'draft', 'UTC', '{"daily_limit": 50}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id, settings)
VALUES
  ('f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1, 'Initial Introductory Touch', 0, 'hours', 'active', 'e0000000-0000-4000-8000-000000000001', '{}'),
  ('f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 2, 'Follow-up Check-in', 48, 'hours', 'active', 'e0000000-0000-4000-8000-000000000002', '{"stop_on_reply": true}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_messages (id, business_id, lead_id, campaign_id, campaign_step_id, template_id, direction, provider_message_id, from_email, to_email, subject, body, status, sent_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'outbound', 'demo_provider_msg_001', 'alex.admin@acme-demo.test', 'jordan.lee@example-client.test', 'Quick question regarding Nexus Retail', 'Hi Jordan,\n\nI noticed Nexus Retail is expanding...', 'sent', NOW() - INTERVAL '2 days'),
  ('10000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'outbound', NULL, 'alex.admin@acme-demo.test', 'taylor.morgan@example-corp.test', 'Quick question regarding Vanguard Systems', 'Hi Taylor,\n\nI noticed Vanguard Systems is expanding...', 'queued', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_events (id, business_id, email_message_id, event_type, provider_event_id, event_timestamp, metadata)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'sent', 'demo_evt_sent_001', NOW() - INTERVAL '2 days', '{"relay": "demo-relay"}'),
  ('20000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'delivered', 'demo_evt_deliv_001', NOW() - INTERVAL '47 hours', '{"response": "250 2.0.0 OK"}'),
  ('20000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'opened', 'demo_evt_open_001', NOW() - INTERVAL '30 hours', '{"user_agent": "Mozilla/5.0"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO conversations (id, business_id, lead_id, status, last_message_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'active', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO automation_runs (id, business_id, workflow_name, lead_id, campaign_id, status, started_at, completed_at, metadata)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'q4_outbound_orchestration', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'completed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '5 seconds', '{"steps_executed": 1}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, business_id, lead_id, activity_type, description, metadata)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'lead_created', 'Demo lead imported from inbound channel', '{"channel": "web"}'),
  ('50000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'email_dispatched', 'Initial outreach email dispatched to Jordan Lee', '{"message_id": "10000000-0000-4000-8000-000000000001"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO suppressions (id, business_id, email, reason, source)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'optout@example-suppressed.test', 'unsubscribe', 'one_click_unsubscribe_header')
ON CONFLICT (id) DO NOTHING;
