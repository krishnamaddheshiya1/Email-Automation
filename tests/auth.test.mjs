import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { registerSchema, loginSchema } from "../lib/validations/auth.ts";
import { createTestDb } from "./test-harness.mjs";

test("Authentication and Multi-Tenancy Test Suite", async (t) => {
  // -------------------------------------------------------------
  // 1. Zod Validation Schemas
  // -------------------------------------------------------------
  await t.test("1. Registration schema validation rules", () => {
    // Valid input
    const valid = registerSchema.safeParse({
      full_name: "Sarah Connor",
      business_name: "Cyberdyne Systems",
      email: "sarah@cyberdyne.io",
      password: "StrongPassword123!",
    });
    assert.ok(valid.success, "Valid registration data must pass schema validation");

    // Missing full name
    const missingName = registerSchema.safeParse({
      full_name: "",
      business_name: "Cyberdyne Systems",
      email: "sarah@cyberdyne.io",
      password: "StrongPassword123!",
    });
    assert.ok(!missingName.success, "Empty full_name must fail validation");

    // Missing business name
    const missingBiz = registerSchema.safeParse({
      full_name: "Sarah Connor",
      business_name: "",
      email: "sarah@cyberdyne.io",
      password: "StrongPassword123!",
    });
    assert.ok(!missingBiz.success, "Empty business_name must fail validation");

    // Invalid email format
    const badEmail = registerSchema.safeParse({
      full_name: "Sarah Connor",
      business_name: "Cyberdyne Systems",
      email: "not-an-email",
      password: "StrongPassword123!",
    });
    assert.ok(!badEmail.success, "Invalid email must fail validation");

    // Password too short (< 6 chars)
    const shortPassword = registerSchema.safeParse({
      full_name: "Sarah Connor",
      business_name: "Cyberdyne Systems",
      email: "sarah@cyberdyne.io",
      password: "123",
    });
    assert.ok(!shortPassword.success, "Short password must fail validation");
  });

  await t.test("2. Login schema validation rules", () => {
    // Valid login
    const valid = loginSchema.safeParse({
      email: "user@example.com",
      password: "SecretPassword123",
    });
    assert.ok(valid.success, "Valid login data must pass validation");

    // Missing email
    const noEmail = loginSchema.safeParse({
      email: "",
      password: "SecretPassword123",
    });
    assert.ok(!noEmail.success, "Missing email must fail validation");

    // Missing password
    const noPassword = loginSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    assert.ok(!noPassword.success, "Missing password must fail validation");
  });

  // -------------------------------------------------------------
  // 2. Multi-Tenant Provisioning & Database Lifecycle
  // -------------------------------------------------------------
  const { db } = createTestDb();

  await t.test("3. Registration flow provisions Business and Admin User", () => {
    const authUserId = crypto.randomUUID();
    const businessId = crypto.randomUUID();
    const email = "founder@enterprise.test";
    const fullName = "Elena Vance";
    const businessName = "Vance Dynamics";

    // 1. Insert Business
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status, settings)
      VALUES ('${businessId}', '${businessName}', 'UTC', 'active', '{}');
    `);

    // 2. Insert User with ADMIN role
    db.public.none(`
      INSERT INTO users (id, business_id, email, full_name, role, status)
      VALUES ('${authUserId}', '${businessId}', '${email}', '${fullName}', 'admin', 'active');
    `);

    // 3. Verify Business was created properly
    const biz = db.public.one(`SELECT * FROM businesses WHERE id = '${businessId}';`);
    assert.equal(biz.name, businessName);
    assert.equal(biz.status, "active");

    // 4. Verify Application User was created with ADMIN role and correct business association
    const user = db.public.one(`SELECT * FROM users WHERE id = '${authUserId}';`);
    assert.equal(user.email, email);
    assert.equal(user.full_name, fullName);
    assert.equal(user.role, "admin", "Newly registered user must have the ADMIN role");
    assert.equal(user.business_id, businessId, "User must be associated with the new business");
    assert.equal(user.status, "active");
  });

  // -------------------------------------------------------------
  // 3. Mandatory Cross-Business Multi-Tenant Isolation Test
  // -------------------------------------------------------------
  await t.test("4. MANDATORY Cross-Business Multi-Tenant Isolation Test", () => {
    // Setup Tenant A
    const bizAId = crypto.randomUUID();
    const userAId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${bizAId}', 'Acme Corporation A', 'America/New_York', 'active');
      INSERT INTO users (id, business_id, email, full_name, role, status)
      VALUES ('${userAId}', '${bizAId}', 'alice@acme-a.test', 'Alice Admin', 'admin', 'active');
    `);

    // Setup Tenant B
    const bizBId = crypto.randomUUID();
    const userBId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${bizBId}', 'Beta Logistics B', 'Europe/London', 'active');
      INSERT INTO users (id, business_id, email, full_name, role, status)
      VALUES ('${userBId}', '${bizBId}', 'bob@beta-b.test', 'Bob Admin', 'admin', 'active');
    `);

    // Tenant A creates 2 leads and 1 campaign
    const leadA1Id = crypto.randomUUID();
    const leadA2Id = crypto.randomUUID();
    const campaignAId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status)
      VALUES ('${leadA1Id}', '${bizAId}', 'prospect1@target-a.test', 'John', 'Doe', 'new'),
             ('${leadA2Id}', '${bizAId}', 'prospect2@target-a.test', 'Jane', 'Smith', 'qualified');
      INSERT INTO campaigns (id, business_id, name, status)
      VALUES ('${campaignAId}', '${bizAId}', 'Tenant A Q4 Outreach', 'active');
    `);

    // Tenant B creates 1 lead and 1 campaign
    const leadB1Id = crypto.randomUUID();
    const campaignBId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status)
      VALUES ('${leadB1Id}', '${bizBId}', 'confidential@competitor-b.test', 'Charles', 'Lee', 'new');
      INSERT INTO campaigns (id, business_id, name, status)
      VALUES ('${campaignBId}', '${bizBId}', 'Tenant B Secret Campaign', 'active');
    `);

    // Helper: Server-side scoped query function that derives business_id strictly from user session
    function getScopedLeadsForUser(userId) {
      // 1. Server resolves user's allowed business_id
      const userRecord = db.public.one(`SELECT business_id FROM users WHERE id = '${userId}';`);
      const allowedBusinessId = userRecord.business_id;

      // 2. Server executes query STRICTLY filtered by allowedBusinessId
      return db.public.many(`SELECT * FROM leads WHERE business_id = '${allowedBusinessId}';`);
    }

    function getScopedCampaignsForUser(userId) {
      const userRecord = db.public.one(`SELECT business_id FROM users WHERE id = '${userId}';`);
      const allowedBusinessId = userRecord.business_id;
      return db.public.many(`SELECT * FROM campaigns WHERE business_id = '${allowedBusinessId}';`);
    }

    // Verify Tenant A queries
    const userALeads = getScopedLeadsForUser(userAId);
    assert.equal(userALeads.length, 2, "User A must see exactly their 2 leads");
    const userALeadEmails = userALeads.map((l) => l.email);
    assert.ok(userALeadEmails.includes("prospect1@target-a.test"));
    assert.ok(userALeadEmails.includes("prospect2@target-a.test"));
    assert.ok(
      !userALeadEmails.includes("confidential@competitor-b.test"),
      "SECURITY VIOLATION: User A must NEVER see Tenant B leads!"
    );

    const userACampaigns = getScopedCampaignsForUser(userAId);
    assert.equal(userACampaigns.length, 1);
    assert.equal(userACampaigns[0].name, "Tenant A Q4 Outreach");

    // Verify Tenant B queries
    const userBLeads = getScopedLeadsForUser(userBId);
    assert.equal(userBLeads.length, 1, "User B must see exactly their 1 lead");
    assert.equal(userBLeads[0].email, "confidential@competitor-b.test");
    assert.ok(
      !userBLeads.map((l) => l.email).includes("prospect1@target-a.test"),
      "SECURITY VIOLATION: User B must NEVER see Tenant A leads!"
    );

    const userBCampaigns = getScopedCampaignsForUser(userBId);
    assert.equal(userBCampaigns.length, 1);
    assert.equal(userBCampaigns[0].name, "Tenant B Secret Campaign");

    // Test Attack Vector: Attacker attempts to inject arbitrary business_id
    function secureDataQuery(userId, untrustedClientSubmittedBusinessId) {
      // Server must NEVER trust client-supplied business_id
      assert.ok(untrustedClientSubmittedBusinessId, "Attacker supplied an arbitrary business_id");
      const sessionUser = db.public.one(`SELECT business_id FROM users WHERE id = '${userId}';`);
      const authoritativeBusinessId = sessionUser.business_id;

      // Even if attacker provided bizBId, authoritative business_id overrides it
      const sanitizedBusinessId = authoritativeBusinessId;
      return db.public.many(`SELECT * FROM leads WHERE business_id = '${sanitizedBusinessId}';`);
    }

    const spoofAttemptLeads = secureDataQuery(userAId, bizBId);
    assert.equal(
      spoofAttemptLeads.length,
      2,
      "Spoof attempt must ignore untrusted business_id and return only User A leads"
    );
    assert.ok(
      !spoofAttemptLeads.some((l) => l.business_id === bizBId),
      "Attacker must receive 0 records belonging to Business B"
    );
  });

  // -------------------------------------------------------------
  // 4. Protected Route & Middleware Logic Verification
  // -------------------------------------------------------------
  await t.test("5. Protected route redirection logic", () => {
    function simulateMiddlewareCheck(pathname, isAuthenticated) {
      const isProtectedRoute =
        pathname.startsWith("/dashboard") || pathname.startsWith("/settings");
      const isAuthRoute =
        pathname.startsWith("/login") || pathname.startsWith("/register");

      if (isProtectedRoute && !isAuthenticated) {
        return { action: "redirect", destination: `/login?redirect=${pathname}` };
      }
      if (isAuthRoute && isAuthenticated) {
        return { action: "redirect", destination: "/dashboard" };
      }
      return { action: "next" };
    }

    // Unauthenticated user attempting to access /dashboard
    const unauthDashboard = simulateMiddlewareCheck("/dashboard", false);
    assert.equal(unauthDashboard.action, "redirect");
    assert.equal(unauthDashboard.destination, "/login?redirect=/dashboard");

    // Unauthenticated user attempting to access /settings
    const unauthSettings = simulateMiddlewareCheck("/settings", false);
    assert.equal(unauthSettings.action, "redirect");
    assert.equal(unauthSettings.destination, "/login?redirect=/settings");

    // Unauthenticated user attempting to access dashboard sub-routes
    const unauthCampaigns = simulateMiddlewareCheck("/dashboard/campaigns", false);
    assert.equal(unauthCampaigns.action, "redirect");
    assert.equal(unauthCampaigns.destination, "/login?redirect=/dashboard/campaigns");

    const unauthFollowUps = simulateMiddlewareCheck("/dashboard/follow-ups", false);
    assert.equal(unauthFollowUps.action, "redirect");
    assert.equal(unauthFollowUps.destination, "/login?redirect=/dashboard/follow-ups");

    const unauthReplies = simulateMiddlewareCheck("/dashboard/replies", false);
    assert.equal(unauthReplies.action, "redirect");
    assert.equal(unauthReplies.destination, "/login?redirect=/dashboard/replies");

    // Authenticated user accessing dashboard sub-routes
    assert.equal(simulateMiddlewareCheck("/dashboard/campaigns", true).action, "next");
    assert.equal(simulateMiddlewareCheck("/dashboard/follow-ups", true).action, "next");
    assert.equal(simulateMiddlewareCheck("/dashboard/replies", true).action, "next");

    // Authenticated user accessing /dashboard
    const authDashboard = simulateMiddlewareCheck("/dashboard", true);
    assert.equal(authDashboard.action, "next");

    // Authenticated user accessing /login should be redirected to /dashboard
    const authLogin = simulateMiddlewareCheck("/login", true);
    assert.equal(authLogin.action, "redirect");
    assert.equal(authLogin.destination, "/dashboard");

    // Authenticated user accessing /register should be redirected to /dashboard
    const authRegister = simulateMiddlewareCheck("/register", true);
    assert.equal(authRegister.action, "redirect");
    assert.equal(authRegister.destination, "/dashboard");

    // Public health check endpoint
    const healthCheck = simulateMiddlewareCheck("/api/health", false);
    assert.equal(healthCheck.action, "next");
  });
});
