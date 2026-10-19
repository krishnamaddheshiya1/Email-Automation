-- Supabase default seed script
-- Mirrors server/db/seeds/dev_seed.sql

-- 1. Businesses
INSERT INTO businesses (id, name, industry, website, timezone, status, settings)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Acme Corp Demo', 'Software', 'https://acme-demo.test', 'America/New_York', 'active', '{"sending_quota": 5000, "tracking_enabled": true}'),
  ('b0000000-0000-4000-8000-000000000002', 'TechPulse Logistics Demo', 'Logistics', 'https://techpulse-demo.test', 'UTC', 'active', '{"sending_quota": 2500, "tracking_enabled": true}')
ON CONFLICT (id) DO NOTHING;

-- 2. Users
INSERT INTO users (id, business_id, email, full_name, role, status)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'alex.admin@acme-demo.test', 'Alex Admin', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'sam.sales@acme-demo.test', 'Sam Sales', 'member', 'active')
ON CONFLICT (id) DO NOTHING;

-- 3. Leads
INSERT INTO leads (id, business_id, first_name, last_name, email, phone, company_name, job_title, industry, website, source, status, lead_score, owner_user_id, metadata)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Jordan', 'Lee', 'jordan.lee@example-client.test', '+1-555-0101', 'Nexus Retail', 'VP of Operations', 'Retail', 'https://nexus-retail.test', 'inbound_web', 'qualified', 85, 'a0000000-0000-4000-8000-000000000002', '{"intent": "high"}'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Taylor', 'Morgan', 'taylor.morgan@example-corp.test', '+1-555-0102', 'Vanguard Systems', 'Director of Engineering', 'Technology', 'https://vanguard-systems.test', 'cold_list', 'contacted', 60, 'a0000000-0000-4000-8000-000000000002', '{"intent": "medium"}'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Casey', 'River', 'casey.river@example-health.test', '+1-555-0103', 'BioHealth Labs', 'Head of Logistics', 'Healthcare', 'https://biohealth-labs.test', 'event_conference', 'new', 20, NULL, '{}')
ON CONFLICT (id) DO NOTHING;

-- 4. Email Templates
INSERT INTO email_templates (id, business_id, name, subject, body, variables, status)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Demo Outreach Step 1', 'Quick question regarding {{company_name}}', 'Hi {{first_name}},\n\nI noticed {{company_name}} is expanding. Would love to share how our platform streamlines email operations.\n\nBest,\nAlex', '["first_name", "company_name"]', 'active'),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Demo Follow-up Step 2', 'Following up on our conversation', 'Hi {{first_name}},\n\nFloating this back to the top of your inbox. Did you have a moment to review my prior note?\n\nBest,\nAlex', '["first_name"]', 'active')
ON CONFLICT (id) DO NOTHING;

-- 5. Campaigns
INSERT INTO campaigns (id, business_id, name, description, status, timezone, settings)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Q4 Outbound SaaS Expansion', 'Targeted sequence for tech and retail executives', 'active', 'America/New_York', '{"daily_limit": 100, "track_opens": true, "track_clicks": true}'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Product Launch Waitlist', 'Nurture sequence for beta invitees', 'draft', 'UTC', '{"daily_limit": 50}')
ON CONFLICT (id) DO NOTHING;

-- 6. Campaign Steps
INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id, settings)
VALUES
  ('f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1, 'Initial Introductory Touch', 0, 'hours', 'active', 'e0000000-0000-4000-8000-000000000001', '{}'),
  ('f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 2, 'Follow-up Check-in', 48, 'hours', 'active', 'e0000000-0000-4000-8000-000000000002', '{"stop_on_reply": true}')
ON CONFLICT (id) DO NOTHING;

-- 7. Email Messages
INSERT INTO email_messages (id, business_id, lead_id, campaign_id, campaign_step_id, template_id, direction, provider_message_id, from_email, to_email, subject, body, status, sent_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'outbound', 'demo_provider_msg_001', 'alex.admin@acme-demo.test', 'jordan.lee@example-client.test', 'Quick question regarding Nexus Retail', 'Hi Jordan,\n\nI noticed Nexus Retail is expanding...', 'sent', NOW() - INTERVAL '2 days'),
  ('10000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'outbound', NULL, 'alex.admin@acme-demo.test', 'taylor.morgan@example-corp.test', 'Quick question regarding Vanguard Systems', 'Hi Taylor,\n\nI noticed Vanguard Systems is expanding...', 'queued', NULL)
ON CONFLICT (id) DO NOTHING;

-- 8. Email Events
INSERT INTO email_events (id, business_id, email_message_id, event_type, provider_event_id, event_timestamp, metadata)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'sent', 'demo_evt_sent_001', NOW() - INTERVAL '2 days', '{"relay": "demo-relay"}'),
  ('20000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'delivered', 'demo_evt_deliv_001', NOW() - INTERVAL '47 hours', '{"response": "250 2.0.0 OK"}'),
  ('20000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'opened', 'demo_evt_open_001', NOW() - INTERVAL '30 hours', '{"user_agent": "Mozilla/5.0"}')
ON CONFLICT (id) DO NOTHING;

-- 9. Conversations
INSERT INTO conversations (id, business_id, lead_id, status, last_message_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'active', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

-- 10. Automation Runs
INSERT INTO automation_runs (id, business_id, workflow_name, lead_id, campaign_id, status, started_at, completed_at, metadata)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'q4_outbound_orchestration', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'completed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '5 seconds', '{"steps_executed": 1}')
ON CONFLICT (id) DO NOTHING;

-- 11. Activities
INSERT INTO activities (id, business_id, lead_id, activity_type, description, metadata)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'lead_created', 'Demo lead imported from inbound channel', '{"channel": "web"}'),
  ('50000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'email_dispatched', 'Initial outreach email dispatched to Jordan Lee', '{"message_id": "10000000-0000-4000-8000-000000000001"}')
ON CONFLICT (id) DO NOTHING;

-- 12. Suppressions
INSERT INTO suppressions (id, business_id, email, reason, source)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'optout@example-suppressed.test', 'unsubscribe', 'one_click_unsubscribe_header')
ON CONFLICT (id) DO NOTHING;
