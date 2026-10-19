-- ==============================================================================
-- Migration: 20261015000003_auth_and_rls.sql
-- Description: Row Level Security (RLS) policies and Auth integration
-- ==============================================================================

-- 1. Support case-insensitive role values (ADMIN, MEMBER, admin, member, owner)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (LOWER(role) IN ('owner', 'admin', 'member', 'viewer'));

-- 2. Helper function to retrieve the authenticated user's business_id
-- Checks auth.uid() from Supabase Auth JWT claims
CREATE OR REPLACE FUNCTION get_auth_business_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT business_id
    FROM public.users
    WHERE id = auth.uid()
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. Helper function to check if the authenticated user is an ADMIN or OWNER
CREATE OR REPLACE FUNCTION is_auth_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND LOWER(role) IN ('admin', 'owner')
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==============================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL BUSINESS-OWNED TABLES
-- ==============================================================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppressions ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- RLS POLICIES
-- ==============================================================================

-- 1. Businesses
CREATE POLICY "Users can view their own business"
  ON businesses FOR SELECT
  USING (id = get_auth_business_id());

CREATE POLICY "Admins can update their own business"
  ON businesses FOR UPDATE
  USING (id = get_auth_business_id() AND is_auth_admin())
  WITH CHECK (id = get_auth_business_id() AND is_auth_admin());

-- 2. Users
CREATE POLICY "Users can view members of their own business"
  ON users FOR SELECT
  USING (business_id = get_auth_business_id());

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND business_id = get_auth_business_id());

-- 3. Leads
CREATE POLICY "Users can view their business leads"
  ON leads FOR SELECT
  USING (business_id = get_auth_business_id());

CREATE POLICY "Users can insert their business leads"
  ON leads FOR INSERT
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Users can update their business leads"
  ON leads FOR UPDATE
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Users can delete their business leads"
  ON leads FOR DELETE
  USING (business_id = get_auth_business_id());

-- 4. Campaigns
CREATE POLICY "Users can view their business campaigns"
  ON campaigns FOR SELECT
  USING (business_id = get_auth_business_id());

CREATE POLICY "Users can insert their business campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Users can update their business campaigns"
  ON campaigns FOR UPDATE
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Admins can delete their business campaigns"
  ON campaigns FOR DELETE
  USING (business_id = get_auth_business_id() AND is_auth_admin());

-- 5. Campaign Steps
CREATE POLICY "Users can view their business campaign steps"
  ON campaign_steps FOR SELECT
  USING (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_auth_business_id()));

CREATE POLICY "Users can insert their business campaign steps"
  ON campaign_steps FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_auth_business_id()));

CREATE POLICY "Users can update their business campaign steps"
  ON campaign_steps FOR UPDATE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_auth_business_id()))
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_auth_business_id()));

CREATE POLICY "Users can delete their business campaign steps"
  ON campaign_steps FOR DELETE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_auth_business_id()));

-- 6. Email Templates
CREATE POLICY "Users can view their business email templates"
  ON email_templates FOR SELECT
  USING (business_id = get_auth_business_id());

CREATE POLICY "Users can insert their business email templates"
  ON email_templates FOR INSERT
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Users can update their business email templates"
  ON email_templates FOR UPDATE
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Users can delete their business email templates"
  ON email_templates FOR DELETE
  USING (business_id = get_auth_business_id());

-- 7. Email Messages
CREATE POLICY "Users can access their business email messages"
  ON email_messages FOR ALL
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

-- 8. Email Events
CREATE POLICY "Users can access their business email events"
  ON email_events FOR ALL
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

-- 9. Conversations
CREATE POLICY "Users can access their business conversations"
  ON conversations FOR ALL
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

-- 10. Automation Runs
CREATE POLICY "Users can access their business automation runs"
  ON automation_runs FOR ALL
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

-- 11. Activities
CREATE POLICY "Users can access their business activities"
  ON activities FOR ALL
  USING (business_id = get_auth_business_id())
  WITH CHECK (business_id = get_auth_business_id());

-- 12. Suppressions
CREATE POLICY "Users can view their business suppressions"
  ON suppressions FOR SELECT
  USING (business_id = get_auth_business_id());

CREATE POLICY "Users can insert their business suppressions"
  ON suppressions FOR INSERT
  WITH CHECK (business_id = get_auth_business_id());

CREATE POLICY "Admins can delete their business suppressions"
  ON suppressions FOR DELETE
  USING (business_id = get_auth_business_id() AND is_auth_admin());
