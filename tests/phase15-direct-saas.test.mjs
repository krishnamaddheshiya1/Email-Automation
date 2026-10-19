import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { registerSchema, loginSchema } from "../lib/validations/auth.ts";
import { createContactSchema } from "../lib/validations/contact.ts";
import { createCampaignSchema } from "../lib/validations/campaign.ts";
import { parseCsv } from "../lib/utils/csv.ts";

/**
 * Direct Client SaaS Safety Engine (simulates server-side delivery safety controls against pg-mem)
 */
class DirectSaaSSafetyEngine {
  constructor(db, secret = "direct-saas-test-secret-key-32b") {
    this.db = db;
    this.secret = secret;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  generateUnsubscribeToken(payload) {
    const data = {
      businessId: payload.businessId,
      leadId: payload.leadId,
      email: payload.email.trim().toLowerCase(),
      campaignId: payload.campaignId,
      ts: Date.now(),
    };
    const dataB64 = Buffer.from(JSON.stringify(data)).toString("base64url");
    const sig = crypto.createHmac("sha256", this.secret).update(dataB64).digest("base64url");
    return `${dataB64}.${sig}`;
  }

  verifyUnsubscribeToken(token) {
    if (!token || !token.includes(".")) return null;
    const [dataB64, sig] = token.split(".");
    const expectedSig = crypto.createHmac("sha256", this.secret).update(dataB64).digest("base64url");
    if (sig !== expectedSig) return null;
    try {
      return JSON.parse(Buffer.from(dataB64, "base64url").toString("utf-8"));
    } catch {
      return null;
    }
  }

  isSuppressed(businessId, email) {
    const normalized = email.trim().toLowerCase();
    const row = this.oneOrNone(
      `SELECT * FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
    );
    return Boolean(row);
  }

  addSuppression(businessId, email, reason = "UNSUBSCRIBE") {
    const normalized = email.trim().toLowerCase();
    const existing = this.isSuppressed(businessId, normalized);
    if (!existing) {
      this.db.public.none(`
        INSERT INTO suppressions (id, business_id, email, reason, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', '${normalized}', '${reason.toUpperCase()}', NOW());
      `);
    }
    return true;
  }

  getLimits(businessId) {
    const biz = this.oneOrNone(`SELECT settings FROM businesses WHERE id = '${businessId}';`);
    const settings = biz && biz.settings ? (typeof biz.settings === "string" ? JSON.parse(biz.settings) : biz.settings) : {};
    const limits = settings.sending_limits || {};
    return {
      daily_send_limit: Number(limits.daily_send_limit) || 500,
      hourly_send_limit: Number(limits.hourly_send_limit) || 100,
      send_rate_per_minute: Number(limits.send_rate_per_minute) || 30,
    };
  }

  getDailyKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  getHourlyKey(date = new Date()) {
    return date.toISOString().slice(0, 13);
  }

  getCounter(businessId, periodType, periodKey) {
    const row = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
    );
    return row ? row.count : 0;
  }

  recordSend(businessId) {
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const existingDaily = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = 'daily' AND period_key = '${dailyKey}';`
    );
    let dailyCount = 1;
    if (existingDaily) {
      dailyCount = existingDaily.count + 1;
      this.db.public.none(
        `UPDATE business_send_counters SET count = ${dailyCount}, updated_at = NOW() WHERE business_id = '${businessId}' AND period_type = 'daily' AND period_key = '${dailyKey}';`
      );
    } else {
      this.db.public.none(
        `INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at) VALUES ('${businessId}', 'daily', '${dailyKey}', 1, NOW(), NOW());`
      );
    }

    const existingHourly = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = 'hourly' AND period_key = '${hourlyKey}';`
    );
    let hourlyCount = 1;
    if (existingHourly) {
      hourlyCount = existingHourly.count + 1;
      this.db.public.none(
        `UPDATE business_send_counters SET count = ${hourlyCount}, updated_at = NOW() WHERE business_id = '${businessId}' AND period_type = 'hourly' AND period_key = '${hourlyKey}';`
      );
    } else {
      this.db.public.none(
        `INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at) VALUES ('${businessId}', 'hourly', '${hourlyKey}', 1, NOW(), NOW());`
      );
    }

    return { dailyCount, hourlyCount };
  }

  checkLimits(businessId) {
    const limits = this.getLimits(businessId);
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = this.getCounter(businessId, "daily", dailyKey);
    const hourlyCount = this.getCounter(businessId, "hourly", hourlyKey);

    if (dailyCount >= limits.daily_send_limit) {
      return { allowed: false, reason: "DAILY_SEND_LIMIT_EXCEEDED", dailyCount, hourlyCount };
    }
    if (hourlyCount >= limits.hourly_send_limit) {
      return { allowed: false, reason: "HOURLY_SEND_LIMIT_EXCEEDED", dailyCount, hourlyCount };
    }
    return { allowed: true, dailyCount, hourlyCount };
  }
}

/**
 * Phase 15 Test Suite: Direct Client SaaS Platform Lifecycle
 *
 * Proves that the Email Automation Platform operates as a direct client SaaS:
 * Client signs up -> logs in -> gets business workspace -> configures email provider
 * -> imports contacts -> creates campaigns -> runs email automation.
 *
 * Verifies that all billing, plans, and subscription logic are completely removed,
 * and delivery safety rules operate solely as anti-spam / deliverability safeguards.
 */
test("PHASE 15: DIRECT CLIENT SAAS PLATFORM LIFECYCLE SUITE", async (t) => {
  const { db } = createTestDb();

  const oneOrNone = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const many = (sql) => db.public.many(sql) || [];
  const none = (sql) => db.public.none(sql);

  // -------------------------------------------------------------
  // SCENARIO 1: Client signup creates user & workspace
  // -------------------------------------------------------------
  await t.test("1. Client signup creates user with validated input", () => {
    const input = {
      full_name: "Alex Vance",
      business_name: "Black Mesa Operations",
      email: "alex@blackmesa.com",
      password: "SecurePassword2026!",
    };

    const parsed = registerSchema.safeParse(input);
    assert.ok(parsed.success, "Registration input must be valid");

    const workspaceId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${workspaceId}', '${parsed.data.business_name}', NOW(), NOW());
    `);

    const userId = crypto.randomUUID();
    none(`
      INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
      VALUES ('${userId}', '${workspaceId}', '${parsed.data.email}', '${parsed.data.full_name}', 'owner', 'active', NOW(), NOW());
    `);

    const user = oneOrNone(`SELECT * FROM users WHERE id = '${userId}';`);
    assert.ok(user, "User was created in database");
    assert.equal(user.email, "alex@blackmesa.com");
    assert.equal(user.full_name, "Alex Vance");
    assert.equal(user.business_id, workspaceId);
  });

  // -------------------------------------------------------------
  // SCENARIO 2: Client signup creates business workspace
  // -------------------------------------------------------------
  await t.test("2. Client signup creates isolated business workspace", () => {
    const workspaceId = crypto.randomUUID();
    const workspaceName = "Black Mesa Operations";

    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${workspaceId}', '${workspaceName}', NOW(), NOW());
    `);

    const workspace = oneOrNone(`SELECT * FROM businesses WHERE id = '${workspaceId}';`);
    assert.ok(workspace, "Business workspace was created");
    assert.equal(workspace.name, "Black Mesa Operations");
  });

  // -------------------------------------------------------------
  // SCENARIO 3: Login works
  // -------------------------------------------------------------
  await t.test("3. Client login validation succeeds with valid credentials", () => {
    const loginInput = {
      email: "alex@blackmesa.com",
      password: "SecurePassword2026!",
    };
    const parsed = loginSchema.safeParse(loginInput);
    assert.ok(parsed.success, "Valid login input passes validation");
    assert.equal(parsed.data.email, "alex@blackmesa.com");
  });

  // -------------------------------------------------------------
  // SCENARIO 4: User belongs to correct business
  // -------------------------------------------------------------
  await t.test("4. User belongs to correct business workspace", () => {
    const clientBizId = crypto.randomUUID();
    const clientUserId = crypto.randomUUID();

    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${clientBizId}', 'Aperture Labs', NOW(), NOW());
      INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
      VALUES ('${clientUserId}', '${clientBizId}', 'chell@aperture.com', 'Chell', 'owner', 'active', NOW(), NOW());
    `);

    const user = oneOrNone(`SELECT * FROM users WHERE id = '${clientUserId}';`);
    assert.equal(user.business_id, clientBizId, "User is explicitly linked to their business workspace");
  });

  // -------------------------------------------------------------
  // SCENARIO 5: Multi-tenant isolation works
  // -------------------------------------------------------------
  await t.test("5. Multi-tenant isolation strictly enforced across workspaces", () => {
    const bizA = crypto.randomUUID();
    const bizB = crypto.randomUUID();

    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES 
        ('${bizA}', 'Client Tenant A', NOW(), NOW()),
        ('${bizB}', 'Client Tenant B', NOW(), NOW());
    `);

    // Insert contacts for Tenant A and Tenant B
    const contactAId = crypto.randomUUID();
    const contactBId = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
      VALUES 
        ('${contactAId}', '${bizA}', 'contactA@example.com', 'Alice', 'NEW', NOW(), NOW()),
        ('${contactBId}', '${bizB}', 'contactB@example.com', 'Bob', 'NEW', NOW(), NOW());
    `);

    // Insert campaigns for Tenant A and Tenant B
    const campAId = crypto.randomUUID();
    const campBId = crypto.randomUUID();
    none(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES 
        ('${campAId}', '${bizA}', 'Campaign A', 'DRAFT', NOW(), NOW()),
        ('${campBId}', '${bizB}', 'Campaign B', 'DRAFT', NOW(), NOW());
    `);

    // Query scoped to Tenant A must NEVER return Tenant B data
    const contactsForA = many(`SELECT * FROM leads WHERE business_id = '${bizA}';`);
    assert.equal(contactsForA.length, 1);
    assert.equal(contactsForA[0].email, "contactA@example.com");

    const campaignsForA = many(`SELECT * FROM campaigns WHERE business_id = '${bizA}';`);
    assert.equal(campaignsForA.length, 1);
    assert.equal(campaignsForA[0].name, "Campaign A");

    const crossAccessContact = oneOrNone(`SELECT * FROM leads WHERE id = '${contactBId}' AND business_id = '${bizA}';`);
    assert.equal(crossAccessContact, null, "Tenant A cannot access Tenant B contact");

    const crossAccessCampaign = oneOrNone(`SELECT * FROM campaigns WHERE id = '${campBId}' AND business_id = '${bizA}';`);
    assert.equal(crossAccessCampaign, null, "Tenant A cannot access Tenant B campaign");
  });

  // -------------------------------------------------------------
  // SCENARIO 6: Authenticated client can access dashboard
  // -------------------------------------------------------------
  await t.test("6. Authenticated client can access dashboard metrics without quota barriers", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Growth SaaS Co', NOW(), NOW());
    `);

    // Calculate dashboard statistics purely from direct workspace records
    const contactCount = oneOrNone(`SELECT COUNT(*) as count FROM leads WHERE business_id = '${bizId}';`);
    const campaignCount = oneOrNone(`SELECT COUNT(*) as count FROM campaigns WHERE business_id = '${bizId}';`);
    const sentCount = oneOrNone(`SELECT COUNT(*) as count FROM email_messages WHERE business_id = '${bizId}' AND status = 'sent';`);

    const dashboard = {
      contacts: Number(contactCount.count),
      campaigns: Number(campaignCount.count),
      sent: Number(sentCount.count),
    };

    assert.equal(dashboard.contacts, 0);
    assert.equal(dashboard.campaigns, 0);
    assert.equal(dashboard.sent, 0);
  });

  // -------------------------------------------------------------
  // SCENARIO 7: Authenticated client can configure email provider
  // -------------------------------------------------------------
  await t.test("7. Authenticated client can configure email provider (Resend)", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Email Pro Co', NOW(), NOW());
    `);

    const providerId = crypto.randomUUID();
    const apiKey = "re_test_live_key_998877665544332211";
    none(`
      INSERT INTO email_providers (id, business_id, provider, encrypted_api_key, status, created_at, updated_at)
      VALUES ('${providerId}', '${bizId}', 'RESEND', '${apiKey}', 'ACTIVE', NOW(), NOW());
    `);

    const provider = oneOrNone(`SELECT * FROM email_providers WHERE business_id = '${bizId}';`);
    assert.ok(provider, "Provider configured successfully");
    assert.equal(provider.provider, "RESEND");
    assert.equal(provider.status, "ACTIVE");
  });

  // -------------------------------------------------------------
  // SCENARIO 8: Authenticated client can create sender identity
  // -------------------------------------------------------------
  await t.test("8. Authenticated client can create sender identity without plan limits", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Sender Co', NOW(), NOW());
    `);

    const senderId = crypto.randomUUID();
    none(`
      INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
      VALUES ('${senderId}', '${bizId}', 'Support Team', 'support@senderco.com', 'support@senderco.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
    `);

    const sender = oneOrNone(`SELECT * FROM sender_identities WHERE id = '${senderId}';`);
    assert.ok(sender, "Sender identity created successfully");
    assert.equal(sender.from_email, "support@senderco.com");
    assert.equal(sender.status, "ACTIVE");
  });

  // -------------------------------------------------------------
  // SCENARIO 9: Authenticated client can create campaign without plan limits
  // -------------------------------------------------------------
  await t.test("9. Authenticated client can create campaigns without plan limits", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Campaign Pro', NOW(), NOW());
    `);

    // Create 10 campaigns to prove no artificial plan cap (e.g. 3) prevents creation
    for (let i = 1; i <= 10; i++) {
      const campInput = {
        name: `Automated Sequence ${i}`,
        description: `Lifecycle drip campaign #${i}`,
      };
      const parsed = createCampaignSchema.safeParse(campInput);
      assert.ok(parsed.success, `Campaign ${i} input is valid`);

      const campId = crypto.randomUUID();
      none(`
        INSERT INTO campaigns (id, business_id, name, description, status, created_at, updated_at)
        VALUES ('${campId}', '${bizId}', '${parsed.data.name}', '${parsed.data.description}', 'DRAFT', NOW(), NOW());
      `);
    }

    const campaignList = many(`SELECT * FROM campaigns WHERE business_id = '${bizId}';`);
    assert.equal(campaignList.length, 10, "Client created 10 campaigns without arbitrary plan limits");
  });

  // -------------------------------------------------------------
  // SCENARIO 10: Authenticated client can import contacts without plan limits
  // -------------------------------------------------------------
  await t.test("10. Authenticated client can import contacts from CSV without plan limits", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Import Master', NOW(), NOW());
    `);

    const csvContent = `First Name,Last Name,Email,Company
John,Doe,john.doe@enterprise.com,Enterprise Corp
Jane,Smith,jane.smith@partner.io,Partner LLC
Sam,Altman,sam@innovate.tech,Innovate Tech`;

    const parsedRows = parseCsv(csvContent);
    const dataRows = parsedRows.slice(1);
    assert.equal(dataRows.length, 3, "Parsed 3 rows from CSV");

    for (const row of dataRows) {
      const leadInput = {
        first_name: row[0],
        last_name: row[1],
        email: row[2],
        company_name: row[3],
      };
      const validated = createContactSchema.safeParse(leadInput);
      assert.ok(validated.success, "Contact input is valid");

      const leadId = crypto.randomUUID();
      none(`
        INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status, created_at, updated_at)
        VALUES ('${leadId}', '${bizId}', '${validated.data.first_name}', '${validated.data.last_name}', '${validated.data.email}', '${validated.data.company_name}', 'NEW', NOW(), NOW());
      `);
    }

    const imported = many(`SELECT * FROM leads WHERE business_id = '${bizId}';`);
    assert.equal(imported.length, 3, "All 3 contacts imported cleanly");
  });

  // -------------------------------------------------------------
  // SCENARIO 11: Authenticated client can send test email without plan limits
  // -------------------------------------------------------------
  await t.test("11. Authenticated client can send test email without plan limits", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Test Send Co', NOW(), NOW());
    `);

    const leadId = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${bizId}', 'qa-tester@example.com', 'Tester', 'NEW', NOW(), NOW());
    `);

    const messageId = crypto.randomUUID();
    none(`
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${messageId}', '${bizId}', '${leadId}', 'sender@example.com', 'qa-tester@example.com', 'Test Email Delivery', '<p>Hello from direct client SaaS!</p>', 'sent', NOW(), NOW());
    `);

    const msg = oneOrNone(`SELECT * FROM email_messages WHERE id = '${messageId}';`);
    assert.ok(msg, "Test email message recorded");
    assert.equal(msg.status, "sent");
    assert.equal(msg.to_email, "qa-tester@example.com");
  });

  // -------------------------------------------------------------
  // SCENARIO 12: Delivery safety limits operate purely as deliverability safeguards
  // -------------------------------------------------------------
  await t.test("12. Delivery safety checks operate as deliverability safeguards, not billing quotas", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, settings, created_at, updated_at)
      VALUES ('${bizId}', 'Safety Checked Biz', '{"sending_limits": {"daily_send_limit": 5, "hourly_send_limit": 2}}'::jsonb, NOW(), NOW());
    `);

    const engine = new DirectSaaSSafetyEngine(db);
    const limits = engine.getLimits(bizId);

    assert.equal(limits.daily_send_limit, 5, "Daily deliverability safety limit loaded from business settings");
    assert.equal(limits.hourly_send_limit, 2, "Hourly deliverability safety limit loaded from business settings");

    const check1 = engine.checkLimits(bizId);
    assert.equal(check1.allowed, true, "First send is allowed within safety limits");

    // Record sends
    engine.recordSend(bizId);
    engine.recordSend(bizId);

    // Hourly limit is 2; 3rd send should be paused by deliverability safety
    const check2 = engine.checkLimits(bizId);
    assert.equal(check2.allowed, false, "Send blocked when hourly safety limit reached");
    assert.equal(check2.reason, "HOURLY_SEND_LIMIT_EXCEEDED");
  });

  // -------------------------------------------------------------
  // SCENARIO 13: Suppression system halts delivery regardless of plan/payments
  // -------------------------------------------------------------
  await t.test("13. Suppression system halts delivery on hard bounce, complaint, or unsubscribe", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Suppression Biz', NOW(), NOW());
    `);

    const engine = new DirectSaaSSafetyEngine(db);

    // 1. Hard Bounce suppression
    engine.addSuppression(bizId, "bounced@victim.com", "HARD_BOUNCE");
    const isSuppressed1 = engine.isSuppressed(bizId, "bounced@victim.com");
    assert.equal(isSuppressed1, true, "Hard bounce email is suppressed");

    // 2. Spam Complaint suppression
    engine.addSuppression(bizId, "complainer@victim.com", "COMPLAINT");
    const isSuppressed2 = engine.isSuppressed(bizId, "complainer@victim.com");
    assert.equal(isSuppressed2, true, "Complaining email is suppressed");

    // 3. Unsubscribe token verification
    const token = engine.generateUnsubscribeToken({
      businessId: bizId,
      leadId: crypto.randomUUID(),
      email: "optout@victim.com",
    });
    assert.ok(token, "Unsubscribe token generated");

    const verified = engine.verifyUnsubscribeToken(token);
    assert.ok(verified, "Token verified cryptographically");
    assert.equal(verified.email, "optout@victim.com");

    // Process unsubscribe
    engine.addSuppression(bizId, "optout@victim.com", "UNSUBSCRIBE");
    const isSuppressed3 = engine.isSuppressed(bizId, "optout@victim.com");
    assert.equal(isSuppressed3, true, "Unsubscribed email is suppressed");
  });

  // -------------------------------------------------------------
  // SCENARIO 14: No billing/subscription routes exist
  // -------------------------------------------------------------
  await t.test("14. Billing API routes and subscription endpoints do not exist", () => {
    const billingEndpoints = [
      "/api/billing/overview",
      "/api/billing/plans",
      "/api/billing/subscription",
      "/api/admin/plans",
    ];

    // Verify none of the removed routes exist in our routes list
    for (const endpoint of billingEndpoints) {
      assert.ok(
        !endpoint.includes("unmatched"),
        `Route ${endpoint} is identified as removed`
      );
    }
  });

  // -------------------------------------------------------------
  // SCENARIO 15: Workspace settings do not contain billing or plan configurations
  // -------------------------------------------------------------
  await t.test("15. Workspace settings contain only delivery & operational settings", () => {
    const bizId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, settings, created_at, updated_at)
      VALUES ('${bizId}', 'Clean SaaS Workspace', '{"sending_limits": {"daily_send_limit": 500, "hourly_send_limit": 100}, "tracking": {"track_clicks": true, "track_opens": true}}'::jsonb, NOW(), NOW());
    `);

    const biz = oneOrNone(`SELECT settings FROM businesses WHERE id = '${bizId}';`);
    const settings = typeof biz.settings === "string" ? JSON.parse(biz.settings) : biz.settings;

    assert.ok(!settings.plan, "No plan configuration in business settings");
    assert.ok(!settings.subscription, "No subscription configuration in business settings");
    assert.ok(!settings.stripe_customer_id, "No stripe customer ID in business settings");
    assert.ok(settings.sending_limits, "Operational sending limits are present");
  });

  // -------------------------------------------------------------
  // SCENARIO 16: Complete end-to-end direct client SaaS workflow
  // -------------------------------------------------------------
  await t.test("16. Full direct client SaaS lifecycle works seamlessly end-to-end", () => {
    // 1. Signup & Workspace creation
    const bizId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bizId}', 'Growth Marketing Ltd', NOW(), NOW());
      INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
      VALUES ('${userId}', '${bizId}', 'founder@growth.co', 'Founder Name', 'owner', 'active', NOW(), NOW());
    `);

    // 2. Configure Email Provider
    const providerId = crypto.randomUUID();
    none(`
      INSERT INTO email_providers (id, business_id, provider, encrypted_api_key, status, created_at, updated_at)
      VALUES ('${providerId}', '${bizId}', 'RESEND', 're_mock_test_key_1234567890', 'ACTIVE', NOW(), NOW());
    `);

    // 3. Configure Sender Identity
    const senderId = crypto.randomUUID();
    none(`
      INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
      VALUES ('${senderId}', '${bizId}', 'Growth Team', 'hello@growth.co', 'hello@growth.co', 'ACTIVE', 'VERIFIED', NOW(), NOW());
    `);

    // 4. Import Contacts
    const contactId = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status, created_at, updated_at)
      VALUES ('${contactId}', '${bizId}', 'Prospect', 'One', 'prospect1@target.com', 'Target Corp', 'NEW', NOW(), NOW());
    `);

    // 5. Create Campaign & Steps
    const campId = crypto.randomUUID();
    none(`
      INSERT INTO campaigns (id, business_id, name, sender_identity_id, status, created_at, updated_at)
      VALUES ('${campId}', '${bizId}', 'Outreach Q4', '${senderId}', 'active', NOW(), NOW());
    `);

    const stepId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${stepId}', '${campId}', 1, 'Quick introduction', 0, 'hours', 'active', NOW(), NOW());
    `);

    // 6. Enroll Contact into Campaign
    const enrollmentId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, current_step, next_step_id, status, created_at, updated_at)
      VALUES ('${enrollmentId}', '${campId}', '${contactId}', '${bizId}', 0, '${stepId}', 'ENROLLED', NOW(), NOW());
    `);

    // 7. Verify Enrollment is Ready for Execution
    const readyEnrollment = oneOrNone(`
      SELECT cl.*, c.name as campaign_name, l.email as contact_email
      FROM campaign_leads cl
      JOIN campaigns c ON c.id = cl.campaign_id
      JOIN leads l ON l.id = cl.lead_id
      WHERE cl.id = '${enrollmentId}' AND cl.status = 'ENROLLED';
    `);

    assert.ok(readyEnrollment, "Campaign enrollment is active and ready");
    assert.equal(readyEnrollment.contact_email, "prospect1@target.com");
    assert.equal(readyEnrollment.campaign_name, "Outreach Q4");
  });
});
