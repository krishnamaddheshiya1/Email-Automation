-- ==============================================================================
-- Migration: 20261024000001_admin_access_control.sql
-- Description: Production-ready admin-controlled authentication and user access control
-- ==============================================================================

-- 1. Support access statuses: PENDING, ACTIVE, BLOCKED, REJECTED, INACTIVE, INVITED
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check 
  CHECK (LOWER(status) IN ('pending', 'active', 'blocked', 'rejected', 'inactive', 'invited'));

-- 2. Make users.business_id nullable for pending users awaiting workspace assignment
ALTER TABLE users ALTER COLUMN business_id DROP NOT NULL;

-- 3. Add platform administrator flag and last login timestamp
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 4. Support platform roles (including platform_admin and developer)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (LOWER(role) IN ('owner', 'admin', 'member', 'viewer', 'developer', 'superadmin', 'platform_admin'));

-- 5. Add allowed_email_domain to businesses table for company domain approval
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS allowed_email_domain VARCHAR(255);

-- 6. Create authorized_emails table for direct approval allowlist
CREATE TABLE IF NOT EXISTS authorized_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  auto_approve BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authorized_emails_email ON authorized_emails (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON users (LOWER(status));
CREATE INDEX IF NOT EXISTS idx_users_platform_admin ON users (is_platform_admin) WHERE is_platform_admin = TRUE;

-- 7. Row Level Security for authorized_emails
ALTER TABLE authorized_emails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'authorized_emails' AND policyname = 'service_role_authorized_emails_all'
  ) THEN
    EXECUTE 'CREATE POLICY service_role_authorized_emails_all ON authorized_emails FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;
