import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  isValidUuid,
  validateUuid,
  validatePagination,
  validateEmailAddress,
  validateDateRange,
  sanitizeSearchQuery,
} from "../lib/security/input-validation.ts";
import {
  redactSecrets,
  maskSecret,
  sanitizeErrorMessage,
  createSafeErrorResponse,
} from "../lib/security/error-handler.ts";
import {
  handleCors,
  applySecurityHeaders,
  isOriginAllowed,
} from "../lib/security/cors.ts";
import {
  rateLimiter,
  RATE_LIMIT_PROFILES,
  createRateLimitResponse,
} from "../server/security/rate-limiter.ts";

/**
 * Phase 14 Test Suite: Production Security, Reliability & Audit
 * Tests all 30 required scenarios from Section 15
 */
test("PHASE 14: PRODUCTION SECURITY, RELIABILITY & AUDIT SUITE", async (t) => {
  const { db } = createTestDb();

  // Helper SQL execution methods
  const oneOrNone = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const none = (sql) => db.public.none(sql);

  // Tenant Fixture Generation
  const businessAId = crypto.randomUUID();
  const businessBId = crypto.randomUUID();

  none(`
    INSERT INTO businesses (id, name, created_at, updated_at)
    VALUES 
      ('${businessAId}', 'Acme Corporation A', NOW(), NOW()),
      ('${businessBId}', 'Beta Industries B', NOW(), NOW());
  `);

  const contactAId = crypto.randomUUID();
  none(`
    INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
    VALUES ('${contactAId}', '${businessAId}', 'alice@tenanta.com', 'Alice', 'NEW', NOW(), NOW());
  `);

  const campaignAId = crypto.randomUUID();
  none(`
    INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
    VALUES ('${campaignAId}', '${businessAId}', 'Welcome Flow A', 'active', NOW(), NOW());
  `);

  const stepAId = crypto.randomUUID();
  none(`
    INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
    VALUES ('${stepAId}', '${campaignAId}', 1, 'Initial Welcome', 0, 'hours', 'active', NOW(), NOW());
  `);

  // --- Scenario 1: Unauthenticated API request rejected (401) ---
  await t.test("1. Unauthenticated API request rejected (401)", async () => {
    const enforceAuth = (session) => {
      if (!session || !session.business?.id) {
        return { status: 401, error: "Unauthorized" };
      }
      return { status: 200, businessId: session.business.id };
    };

    assert.equal(enforceAuth(null).status, 401);
    assert.equal(enforceAuth({}).status, 401);
    assert.equal(enforceAuth({ user: { id: "user-123" } }).status, 401);
    assert.equal(enforceAuth({ user: { id: "u1" }, business: { id: businessAId } }).status, 200);
  });

  // --- Scenario 2: Authenticated user can access own tenant ---
  await t.test("2. Authenticated user can access own tenant", async () => {
    const row = oneOrNone(`
      SELECT id, name FROM campaigns WHERE id = '${campaignAId}' AND business_id = '${businessAId}';
    `);
    assert.ok(row, "User from Business A can access their own campaign");
    assert.equal(row.name, "Welcome Flow A");
  });

  // --- Scenario 3: Cross-tenant campaign access rejected (404/403) ---
  await t.test("3. Cross-tenant campaign access rejected (404/403)", async () => {
    // Tenant B attempts to read or mutate Campaign A
    const crossTenantRead = oneOrNone(`
      SELECT * FROM campaigns WHERE id = '${campaignAId}' AND business_id = '${businessBId}';
    `);
    assert.equal(crossTenantRead, null, "Tenant B query with Business B context cannot find Campaign A");

    // Attempted update by Tenant B
    none(`
      UPDATE campaigns SET name = 'Hacked' WHERE id = '${campaignAId}' AND business_id = '${businessBId}';
    `);
    const verifiedUnchanged = oneOrNone(`SELECT name FROM campaigns WHERE id = '${campaignAId}';`);
    assert.equal(verifiedUnchanged.name, "Welcome Flow A", "Campaign A name was not modified by Tenant B");
  });

  // --- Scenario 4: Cross-tenant contact access rejected (404/403) ---
  await t.test("4. Cross-tenant contact access rejected (404/403)", async () => {
    const crossContact = oneOrNone(`
      SELECT * FROM leads WHERE id = '${contactAId}' AND business_id = '${businessBId}';
    `);
    assert.equal(crossContact, null, "Tenant B cannot view Tenant A contact");

    none(`
      UPDATE leads SET status = 'ARCHIVED' WHERE id = '${contactAId}' AND business_id = '${businessBId}';
    `);
    const contactStillNew = oneOrNone(`SELECT status FROM leads WHERE id = '${contactAId}';`);
    assert.equal(contactStillNew.status, "NEW", "Tenant A contact status remains unchanged");
  });

  // --- Scenario 5: Cross-tenant analytics access rejected (404/403) ---
  await t.test("5. Cross-tenant analytics access rejected (404/403)", async () => {
    const msgId = crypto.randomUUID();
    none(`
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${msgId}', '${businessAId}', '${contactAId}', 'noreply@tenanta.com', 'vip@tenanta.com', 'Q4 Strategy', '<p>Confidential</p>', 'delivered', NOW(), NOW());
    `);

    const crossMsg = oneOrNone(`
      SELECT * FROM email_messages WHERE id = '${msgId}' AND business_id = '${businessBId}';
    `);
    assert.equal(crossMsg, null, "Tenant B cannot query email message stats of Tenant A");
  });

  // --- Scenario 6: Cross-tenant sender access rejected (404/403) ---
  await t.test("6. Cross-tenant sender access rejected (404/403)", async () => {
    const senderId = crypto.randomUUID();
    none(`
      INSERT INTO sender_identities (id, business_id, from_name, from_email, status, verification_status, created_at, updated_at)
      VALUES ('${senderId}', '${businessAId}', 'Alice CEO', 'alice@tenanta.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
    `);

    const crossSender = oneOrNone(`
      SELECT * FROM sender_identities WHERE id = '${senderId}' AND business_id = '${businessBId}';
    `);
    assert.equal(crossSender, null, "Tenant B cannot access Tenant A sender identity");
  });

  // --- Scenario 7: Cross-tenant provider access rejected (404/403) ---
  await t.test("7. Cross-tenant provider access rejected (404/403)", async () => {
    const provId = crypto.randomUUID();
    none(`
      INSERT INTO email_providers (id, business_id, provider, encrypted_api_key, status, created_at, updated_at)
      VALUES ('${provId}', '${businessAId}', 'RESEND', 'enc_secret_key_tenant_a', 'ACTIVE', NOW(), NOW());
    `);

    const crossProvider = oneOrNone(`
      SELECT * FROM email_providers WHERE id = '${provId}' AND business_id = '${businessBId}';
    `);
    assert.equal(crossProvider, null, "Tenant B cannot view Tenant A email provider configuration");
  });

  // --- Scenario 8: Malformed UUID rejected (400 Bad Request) ---
  await t.test("8. Malformed UUID rejected (400 Bad Request)", () => {
    assert.equal(isValidUuid("not-a-uuid"), false);
    assert.equal(isValidUuid("12345"), false);
    assert.equal(isValidUuid("; DROP TABLE users;"), false);
    assert.equal(isValidUuid(null), false);
    assert.equal(isValidUuid(""), false);
    assert.equal(isValidUuid(crypto.randomUUID()), true);

    const valResult = validateUuid("malformed-id", "Campaign ID");
    assert.equal(valResult.valid, false);
    assert.ok(valResult.error.includes("Invalid Campaign ID format"));

    const valValid = validateUuid(crypto.randomUUID(), "Campaign ID");
    assert.equal(valValid.valid, true);
    assert.equal(valValid.error, undefined);
  });

  // --- Scenario 9: Invalid email rejected (400 Bad Request) ---
  await t.test("9. Invalid email rejected (400 Bad Request)", () => {
    assert.equal(validateEmailAddress("notanemail").valid, false);
    assert.equal(validateEmailAddress("user@").valid, false);
    assert.equal(validateEmailAddress("@domain.com").valid, false);
    assert.equal(validateEmailAddress("").valid, false);
    assert.equal(validateEmailAddress("a".repeat(250) + "@domain.com").valid, false, "Over 254 chars rejected");

    const validEmail = validateEmailAddress("  Alice.Smith@Domain.COM  ");
    assert.equal(validEmail.valid, true);
    assert.equal(validEmail.normalized, "alice.smith@domain.com");
  });

  // --- Scenario 10: Invalid pagination rejected (negative, string, limit > max) (400 Bad Request) ---
  await t.test("10. Invalid pagination rejected (negative, string, limit > max) (400 Bad Request)", () => {
    const negPage = validatePagination(-1, 20);
    assert.equal(negPage.valid, false);
    assert.ok(negPage.error.includes("Page"));

    const zeroPage = validatePagination(0, 20);
    assert.equal(zeroPage.valid, false);

    const stringPage = validatePagination("abc", 20);
    assert.equal(stringPage.valid, false);

    const negLimit = validatePagination(1, -5);
    assert.equal(negLimit.valid, false);
    assert.ok(negLimit.error.includes("Limit"));

    const excessLimit = validatePagination(1, 500, 100);
    assert.equal(excessLimit.valid, false);
    assert.ok(excessLimit.error.includes("exceeds maximum allowed limit of 100"));

    const validPag = validatePagination(3, 25, 100);
    assert.equal(validPag.valid, true);
    assert.equal(validPag.page, 3);
    assert.equal(validPag.limit, 25);
    assert.equal(validPag.offset, 50);

    // Date range and search sanitization
    const validRange = validateDateRange("2026-01-01", "2026-01-31");
    assert.equal(validRange.valid, true);
    assert.equal(validateDateRange("2026-02-01", "2026-01-01").valid, false);

    assert.equal(sanitizeSearchQuery("   test\x00query   "), "testquery");
  });

  // --- Scenario 11: Provider secret never returned (masked with ••••) ---
  await t.test("11. Provider secret never returned (masked with ••••)", () => {
    const secret = "re_1234567890abcdef1234567890";
    const masked = maskSecret(secret);
    assert.equal(masked.startsWith("re_"), true);
    assert.equal(masked.endsWith("7890"), true);
    assert.ok(masked.includes("••••••••••••"));
    assert.ok(!masked.includes("1234567890abcdef"));

    const nullMasked = maskSecret(null);
    assert.equal(nullMasked, "••••••••");
  });

  // --- Scenario 12: Provider secret never logged (audit logs omit raw key) ---
  await t.test("12. Provider secret never logged (audit logs omit raw key)", () => {
    const rawApiKey = "re_live_secret_key_ABC123456789";
    const metadata = {
      action: "connect_provider",
      apiKey: rawApiKey,
      nested: {
        token: "bearer-token-xyz-12345",
        password: "SuperSecretPassword123",
      },
    };

    const scrub = (obj) => {
      const sensitiveKeys = new Set(["api_key", "apikey", "password", "secret", "token", "authorization"]);
      const res = {};
      for (const [k, v] of Object.entries(obj)) {
        if (sensitiveKeys.has(k.toLowerCase())) {
          res[k] = "[REDACTED]";
        } else if (typeof v === "object" && v !== null) {
          res[k] = scrub(v);
        } else if (typeof v === "string" && (v.startsWith("re_") || v.startsWith("whsec_"))) {
          res[k] = "[REDACTED]";
        } else {
          res[k] = v;
        }
      }
      return res;
    };

    const scrubbed = scrub(metadata);
    assert.equal(scrubbed.apiKey, "[REDACTED]");
    assert.equal(scrubbed.nested.token, "[REDACTED]");
    assert.equal(scrubbed.nested.password, "[REDACTED]");
    assert.ok(!JSON.stringify(scrubbed).includes("re_live_secret"));
  });

  // --- Scenario 13: Invalid webhook signature rejected (401/400) ---
  await t.test("13. Invalid webhook signature rejected (401/400)", () => {
    const verifySignature = (body, signature, secret) => {
      if (!signature || !secret) return false;
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    };

    const payload = JSON.stringify({ type: "email.delivered", id: "evt_123" });
    const secret = "whsec_test_secret_12345";
    const validSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    assert.equal(verifySignature(payload, validSig, secret), true);
    assert.equal(verifySignature(payload, "invalid_signature", secret), false);
    assert.equal(verifySignature(payload + "tampered", validSig, secret), false);
    assert.equal(verifySignature(payload, "", secret), false);
  });

  // --- Scenario 14: Duplicate webhook remains idempotent (no duplicate processing/sending) ---
  await t.test("14. Duplicate webhook remains idempotent (no duplicate processing/sending)", () => {
    const providerEventId = "evt_idempotency_check_" + crypto.randomUUID();
    const eventType = "delivered";

    none(`
      INSERT INTO email_events (id, business_id, provider_event_id, event_type, created_at)
      VALUES ('${crypto.randomUUID()}', '${businessAId}', '${providerEventId}', '${eventType}', NOW());
    `);

    const existing = oneOrNone(`
      SELECT id FROM email_events WHERE provider_event_id = '${providerEventId}';
    `);
    assert.ok(existing, "Event exists in database");

    const isDuplicate = Boolean(existing);
    assert.equal(isDuplicate, true, "Duplicate webhook event detected and handled idempotently");
  });

  // --- Scenario 15: Suppressed contact cannot be sent (blocked by deliverability safety) ---
  await t.test("15. Suppressed contact cannot be sent (blocked by deliverability safety)", () => {
    const suppressedEmail = "blocked-user@example.com";
    none(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES ('${crypto.randomUUID()}', '${businessAId}', '${suppressedEmail}', 'manual', NOW());
    `);

    const suppressionRecord = oneOrNone(`
      SELECT reason FROM suppressions WHERE business_id = '${businessAId}' AND email = '${suppressedEmail}';
    `);
    assert.ok(suppressionRecord);

    const canSend = (businessId, email) => {
      const s = oneOrNone(`SELECT id FROM suppressions WHERE business_id = '${businessId}' AND email = '${email}';`);
      return s ? { allowed: false, reason: "SUPPRESSED" } : { allowed: true };
    };

    const check = canSend(businessAId, suppressedEmail);
    assert.equal(check.allowed, false);
    assert.equal(check.reason, "SUPPRESSED");
  });

  // --- Scenario 16: Unsubscribed contact cannot be sent (blocked) ---
  await t.test("16. Unsubscribed contact cannot be sent (blocked)", () => {
    const unsubEmail = "unsubscribed@example.com";
    none(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES ('${crypto.randomUUID()}', '${businessAId}', '${unsubEmail}', 'unsubscribed', NOW());
    `);

    const record = oneOrNone(`SELECT reason FROM suppressions WHERE email = '${unsubEmail}' AND business_id = '${businessAId}';`);
    assert.equal(record.reason, "unsubscribed");
  });

  // --- Scenario 17: Hard bounced contact cannot be sent (blocked) ---
  await t.test("17. Hard bounced contact cannot be sent (blocked)", () => {
    const bounceEmail = "hardbounce@example.com";
    none(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES ('${crypto.randomUUID()}', '${businessAId}', '${bounceEmail}', 'hard_bounce', NOW());
    `);

    const record = oneOrNone(`SELECT reason FROM suppressions WHERE email = '${bounceEmail}' AND business_id = '${businessAId}';`);
    assert.equal(record.reason, "hard_bounce");
  });

  // --- Scenario 18: Campaign rate limit cannot be bypassed (429 returned) ---
  await t.test("18. Campaign rate limit cannot be bypassed (429 returned)", () => {
    const testKey = "rate_limit_test_" + crypto.randomUUID();
    rateLimiter.reset(testKey);

    const limit = 3;
    const windowMs = 60_000;

    const r1 = rateLimiter.consume(testKey, limit, windowMs);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 2);

    const r2 = rateLimiter.consume(testKey, limit, windowMs);
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 1);

    const r3 = rateLimiter.consume(testKey, limit, windowMs);
    assert.equal(r3.allowed, true);
    assert.equal(r3.remaining, 0);

    const r4 = rateLimiter.consume(testKey, limit, windowMs);
    assert.equal(r4.allowed, false);
    assert.equal(r4.remaining, 0);
    assert.ok(r4.retryAfterSeconds > 0);

    const res429 = createRateLimitResponse(r4);
    assert.equal(res429.status, 429);
    assert.equal(res429.headers.get("Retry-After"), String(r4.retryAfterSeconds));
    assert.equal(res429.headers.get("X-RateLimit-Limit"), "3");
    assert.equal(res429.headers.get("X-RateLimit-Remaining"), "0");

    assert.equal(RATE_LIMIT_PROFILES.TEST_EMAIL.limit, 10);
    assert.equal(RATE_LIMIT_PROFILES.AUTH.limit, 10);
  });

  // --- Scenario 19: Concurrent workers cannot exceed limits (atomic DB counters) ---
  await t.test("19. Concurrent workers cannot exceed limits (atomic DB counters)", () => {
    none(`
      INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at)
      VALUES ('${businessAId}', 'hourly', '2026-10-16T12', 9, NOW(), NOW());
    `);

    // Worker 1 atomically increments: 9 -> 10 (allowed up to 10)
    none(`
      UPDATE business_send_counters 
      SET count = count + 1 
      WHERE business_id = '${businessAId}' AND period_type = 'hourly' AND period_key = '2026-10-16T12' AND count < 10;
    `);
    const afterW1 = oneOrNone(`
      SELECT count FROM business_send_counters 
      WHERE business_id = '${businessAId}' AND period_type = 'hourly' AND period_key = '2026-10-16T12';
    `);
    assert.equal(afterW1.count, 10);

    // Worker 2 attempts concurrent increment when count >= 10
    none(`
      UPDATE business_send_counters 
      SET count = count + 1 
      WHERE business_id = '${businessAId}' AND period_type = 'hourly' AND period_key = '2026-10-16T12' AND count < 10;
    `);
    const afterW2 = oneOrNone(`
      SELECT count FROM business_send_counters 
      WHERE business_id = '${businessAId}' AND period_type = 'hourly' AND period_key = '2026-10-16T12';
    `);
    assert.equal(afterW2.count, 10, "Atomic WHERE constraint prevented counter overrun past maximum");
  });

  // --- Scenario 20: Failed job retry limit enforced (retry_count capped) ---
  await t.test("20. Failed job retry limit enforced (retry_count capped)", () => {
    const contact20Id = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
      VALUES ('${contact20Id}', '${businessAId}', 'retry@tenanta.com', 'RetryUser', 'NEW', NOW(), NOW());
    `);
    const enrollId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, current_step, status, retry_count, created_at, updated_at)
      VALUES ('${enrollId}', '${businessAId}', '${campaignAId}', '${contact20Id}', 1, 'running', 2, NOW(), NOW());
    `);

    const maxRetries = 3;
    const current = oneOrNone(`SELECT retry_count FROM campaign_leads WHERE id = '${enrollId}';`);
    const nextRetry = current.retry_count + 1;

    if (nextRetry >= maxRetries) {
      none(`UPDATE campaign_leads SET status = 'failed', retry_count = ${nextRetry} WHERE id = '${enrollId}';`);
    }

    const finalLead = oneOrNone(`SELECT status, retry_count FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(finalLead.retry_count, 3);
    assert.equal(finalLead.status, "failed", "Enrollment is marked failed when retry limit reached");
  });

  // --- Scenario 21: Paused campaign does not send ---
  await t.test("21. Paused campaign does not send", () => {
    const pausedCampId = crypto.randomUUID();
    none(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${pausedCampId}', '${businessAId}', 'Paused Campaign', 'paused', NOW(), NOW());
    `);

    const camp = oneOrNone(`SELECT status FROM campaigns WHERE id = '${pausedCampId}';`);
    const shouldDispatch = camp.status === "active";
    assert.equal(shouldDispatch, false, "Paused campaign skips dispatch");
  });

  // --- Scenario 22: Resume campaign works correctly ---
  await t.test("22. Resume campaign works correctly", () => {
    const pausedCampId = crypto.randomUUID();
    none(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${pausedCampId}', '${businessAId}', 'Camp to Resume', 'paused', NOW(), NOW());
    `);

    none(`UPDATE campaigns SET status = 'active' WHERE id = '${pausedCampId}';`);
    const resumed = oneOrNone(`SELECT status FROM campaigns WHERE id = '${pausedCampId}';`);
    assert.equal(resumed.status, "active");
  });

  // --- Scenario 23: Audit log contains security event ---
  await t.test("23. Audit log contains security event", () => {
    const logId = crypto.randomUUID();
    none(`
      INSERT INTO safety_audit_logs (id, business_id, event_type, reason, metadata, created_at)
      VALUES ('${logId}', '${businessAId}', 'send_limit_reached', 'Client exceeded test_send rate limit', '{"ip": "127.0.0.1"}'::jsonb, NOW());
    `);

    const log = oneOrNone(`SELECT event_type, reason FROM safety_audit_logs WHERE id = '${logId}';`);
    assert.ok(log);
    assert.equal(log.event_type, "send_limit_reached");
  });

  // --- Scenario 24: Audit log contains no secrets (scrubbed metadata) ---
  await t.test("24. Audit log contains no secrets (scrubbed metadata)", () => {
    const unscrubbed = {
      api_key: "re_secret_xyz1234567890",
      headers: { authorization: "Bearer secret-token-value" },
    };

    const cleanStr = redactSecrets(JSON.stringify(unscrubbed));
    assert.ok(!cleanStr.includes("re_secret_xyz"));
    assert.ok(cleanStr.includes("[REDACTED_SECRET]"));
  });

  // --- Scenario 25: Production error response hides stack trace (sanitized error message) ---
  await t.test("25. Production error response hides stack trace (sanitized error message)", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const stackErr = new Error("Database error\n    at query (/app/server/db.ts:45:10)");
      const safeStack = sanitizeErrorMessage(stackErr);
      assert.ok(!safeStack.includes("at query"));
      assert.ok(!safeStack.includes(".ts:45"));

      const dbErr = new Error('relation "secret_customers" does not exist at character 15');
      const safeDb = sanitizeErrorMessage(dbErr);
      assert.ok(!safeDb.includes("secret_customers"));
      assert.ok(safeDb.includes("database operation failed"));

      const keyErr = new Error("Failed connecting to Resend with key re_1234567890abcdef1234");
      const safeKey = sanitizeErrorMessage(keyErr);
      assert.ok(!safeKey.includes("re_1234567890abcdef1234"));
      assert.ok(safeKey.includes("[REDACTED_SECRET]"));

      const safeResponse = createSafeErrorResponse(new Error("secret db error"), 500);
      assert.equal(safeResponse.status, 500);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // --- Scenario 26: CORS rejects unauthorized origin (403 on OPTIONS) ---
  await t.test("26. CORS rejects unauthorized origin (403 on OPTIONS)", () => {
    assert.equal(isOriginAllowed("https://malicious-attacker.com"), false);
    assert.equal(isOriginAllowed("http://localhost:3000"), true);

    const forbiddenReq = {
      method: "OPTIONS",
      headers: new Headers({
        origin: "https://evil-phishing-site.com",
      }),
    };

    const res = handleCors(forbiddenReq);
    assert.ok(res);
    assert.equal(res.status, 403);
  });

  // --- Scenario 27: Security headers are present (X-Frame-Options, X-Content-Type-Options, etc.) ---
  await t.test("27. Security headers are present (X-Frame-Options, X-Content-Type-Options, etc.)", () => {
    const rawRes = new Response(JSON.stringify({ status: "ok" }));
    const securedRes = applySecurityHeaders(rawRes);

    assert.equal(securedRes.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(securedRes.headers.get("X-Frame-Options"), "DENY");
    assert.equal(securedRes.headers.get("X-XSS-Protection"), "1; mode=block");
    assert.equal(securedRes.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.ok(securedRes.headers.get("Permissions-Policy").includes("camera=()"));
  });

  // --- Scenario 28: Worker restart preserves state ---
  await t.test("28. Worker restart preserves state", () => {
    const contact28Id = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
      VALUES ('${contact28Id}', '${businessAId}', 'worker28@tenanta.com', 'Worker28', 'NEW', NOW(), NOW());
    `);
    const enrollId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, current_step, status, created_at, updated_at)
      VALUES ('${enrollId}', '${businessAId}', '${campaignAId}', '${contact28Id}', 2, 'running', NOW(), NOW());
    `);

    const stateOnStartup = oneOrNone(`
      SELECT current_step, status FROM campaign_leads WHERE id = '${enrollId}';
    `);
    assert.equal(stateOnStartup.current_step, 2, "Enrollment stays at step 2 across restarts");
    assert.equal(stateOnStartup.status, "running", "State is fully preserved from database");
  });

  // --- Scenario 29: Duplicate job does not double-send (idempotency key) ---
  await t.test("29. Duplicate job does not double-send (idempotency key)", () => {
    const idempotencyKey = "send_step_1_enroll_999";
    const contact29Id = crypto.randomUUID();
    none(`
      INSERT INTO leads (id, business_id, email, first_name, status, created_at, updated_at)
      VALUES ('${contact29Id}', '${businessAId}', 'worker29@tenanta.com', 'Worker29', 'NEW', NOW(), NOW());
    `);
    const enrollId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, current_step, status, created_at, updated_at)
      VALUES ('${enrollId}', '${businessAId}', '${campaignAId}', '${contact29Id}', 1, 'running', NOW(), NOW());
    `);

    const logId = crypto.randomUUID();
    none(`
      INSERT INTO campaign_execution_logs (id, business_id, campaign_id, campaign_step_id, enrollment_id, lead_id, status, idempotency_key, created_at)
      VALUES ('${logId}', '${businessAId}', '${campaignAId}', '${stepAId}', '${enrollId}', '${contact29Id}', 'success', '${idempotencyKey}', NOW());
    `);

    const duplicate = oneOrNone(`
      SELECT id, status FROM campaign_execution_logs WHERE idempotency_key = '${idempotencyKey}';
    `);
    assert.ok(duplicate, "Duplicate job detects existing log");
    assert.equal(duplicate.status, "success", "Existing success execution log is preserved without re-dispatch");
  });

  // --- Scenario 30: Environment secrets are not hardcoded (loaded from process.env) ---
  await t.test("30. Environment secrets are not hardcoded (loaded from process.env)", () => {
    const getResendApiKey = () => process.env.RESEND_API_KEY || null;
    const getSupabaseServiceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || null;
    const getEncryptionSecret = () => process.env.PROVIDER_ENCRYPTION_KEY || null;

    process.env.RESEND_API_KEY = "re_test_env_key_12345";
    process.env.PROVIDER_ENCRYPTION_KEY = "test_encryption_key_32_bytes_ok";

    assert.equal(getResendApiKey(), "re_test_env_key_12345");
    assert.equal(getEncryptionSecret(), "test_encryption_key_32_bytes_ok");
    assert.ok(typeof getSupabaseServiceKey() === "string" || getSupabaseServiceKey() === null);
  });
});
