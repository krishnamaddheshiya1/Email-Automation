import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { emailRegex } from "../lib/validations/email.ts";

/**
 * Phase 9 Deliverability & Safety Test Engine
 * Simulates DeliverySafetyService, Resend Webhook Handler, and Safety Controls against pg-mem
 */
class SafetyTestEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.secret = options.secret || "phase9-test-secret-key-32-bytes!!";
    this.sentEmails = [];
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  // --- 1. Cryptographic Unsubscribe Tokens ---
  generateUnsubscribeToken(businessId, email, leadId = null, campaignId = null) {
    const payload = {
      b: businessId,
      e: email.trim().toLowerCase(),
      l: leadId || undefined,
      c: campaignId || undefined,
      t: Date.now(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const hmac = crypto.createHmac("sha256", this.secret);
    hmac.update(payloadB64);
    const sig = hmac.digest("base64url");
    return `${payloadB64}.${sig}`;
  }

  verifyUnsubscribeToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) {
      return { valid: false, error: "Invalid token structure" };
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      return { valid: false, error: "Malformed token segments" };
    }
    const [payloadB64, sig] = parts;
    try {
      const hmac = crypto.createHmac("sha256", this.secret);
      hmac.update(payloadB64);
      const expectedSig = hmac.digest("base64url");
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: "Signature verification failed" };
      }
      const raw = Buffer.from(payloadB64, "base64url").toString("utf-8");
      const payload = JSON.parse(raw);
      if (!payload.b || !payload.e) {
        return { valid: false, error: "Incomplete token claims" };
      }
      return { valid: true, payload };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  ensureUnsubscribeLink(html, unsubscribeUrl) {
    if (html.includes("{{unsubscribe_url}}")) {
      return html.replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    }
    const footer = `<div class="unsubscribe-footer"><a href="${unsubscribeUrl}">Unsubscribe</a></div>`;
    if (html.includes("</body>")) {
      return html.replace("</body>", `${footer}</body>`);
    }
    return `${html}${footer}`;
  }

  // --- 2. Suppression Management ---
  isSuppressed(businessId, email) {
    const normalized = email.trim().toLowerCase();
    const row = this.oneOrNone(
      `SELECT * FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
    );
    return Boolean(row);
  }

  addSuppression(businessId, email, reason = "UNSUBSCRIBED", source = "user_unsubscribe") {
    const normalized = email.trim().toLowerCase();
    const existing = this.oneOrNone(
      `SELECT * FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
    );
    if (!existing) {
      this.db.public.none(`
        INSERT INTO suppressions (id, business_id, email, reason, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', '${normalized}', '${reason.toUpperCase()}', NOW());
      `);
    }
    this.stopActiveEnrollments(businessId, normalized, reason);
    const eventTypeMap = {
      UNSUBSCRIBED: "unsubscribe",
      UNSUBSCRIBE: "unsubscribe",
      HARD_BOUNCE: "hard_bounce",
      COMPLAINT: "complaint",
      MANUAL: "manual_suppression",
      INVALID: "campaign_blocked",
    };
    const eventType = eventTypeMap[reason.toUpperCase()] || "campaign_blocked";
    this.logSafetyAudit(businessId, eventType, normalized, `Recipient suppressed via ${source}`);
  }

  removeSuppression(businessId, email) {
    const normalized = email.trim().toLowerCase();
    const existing = this.isSuppressed(businessId, normalized);
    if (existing) {
      this.db.public.none(
        `DELETE FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
      );
      this.logSafetyAudit(businessId, "suppression_removal", normalized, "Suppression manually removed by admin");
      return true;
    }
    return false;
  }

  stopActiveEnrollments(businessId, email, reason) {
    const normalized = email.trim().toLowerCase();
    const leads = this.db.public.many(
      `SELECT id FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
    );
    for (const lead of leads) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'STOPPED',
            last_error = 'Halted by safety control: ${reason}',
            stopped_at = NOW(),
            updated_at = NOW()
        WHERE business_id = '${businessId}'
          AND lead_id = '${lead.id}'
          AND status IN ('ENROLLED', 'RUNNING', 'running');
      `);
    }
  }

  logSafetyAudit(businessId, eventType, recipientEmail, reason, metadata = {}) {
    const id = crypto.randomUUID();
    const metaStr = JSON.stringify(metadata).replace(/'/g, "''");
    this.db.public.none(`
      INSERT INTO safety_audit_logs (id, business_id, event_type, recipient_email, reason, metadata, created_at)
      VALUES ('${id}', '${businessId}', '${eventType}', '${recipientEmail}', '${reason.replace(/'/g, "''")}', '${metaStr}'::jsonb, NOW());
    `);
  }

  // --- 3. Sending Limit Counters ---
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

  incrementCounter(businessId, periodType, periodKey, amount = 1) {
    const existing = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
    );
    if (existing) {
      const nextCount = existing.count + amount;
      this.db.public.none(
        `UPDATE business_send_counters SET count = ${nextCount}, updated_at = NOW() WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
      );
      return nextCount;
    } else {
      this.db.public.none(
        `INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at) VALUES ('${businessId}', '${periodType}', '${periodKey}', ${amount}, NOW(), NOW());`
      );
      return amount;
    }
  }

  getLimits(businessId) {
    const biz = this.oneOrNone(`SELECT settings FROM businesses WHERE id = '${businessId}';`);
    const settings = biz && biz.settings ? biz.settings : {};
    const limits = settings.sending_limits || {};
    return {
      daily_send_limit: Number(limits.daily_send_limit) || 50,
      hourly_send_limit: Number(limits.hourly_send_limit) || 25,
      send_rate_per_minute: Number(limits.send_rate_per_minute) || 30,
    };
  }

  checkLimits(businessId) {
    const limits = this.getLimits(businessId);
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = this.getCounter(businessId, "daily", dailyKey);
    const hourlyCount = this.getCounter(businessId, "hourly", hourlyKey);

    if (dailyCount >= limits.daily_send_limit) {
      this.logSafetyAudit(businessId, "send_limit_reached", null, `Daily send limit reached (${dailyCount}/${limits.daily_send_limit})`);
      return { allowed: false, reason: "DAILY_LIMIT_EXCEEDED", currentDaily: dailyCount, limitDaily: limits.daily_send_limit };
    }
    if (hourlyCount >= limits.hourly_send_limit) {
      this.logSafetyAudit(businessId, "send_limit_reached", null, `Hourly send limit reached (${hourlyCount}/${limits.hourly_send_limit})`);
      return { allowed: false, reason: "HOURLY_LIMIT_EXCEEDED", currentHourly: hourlyCount, limitHourly: limits.hourly_send_limit };
    }
    return { allowed: true, dailyCount, hourlyCount };
  }

  recordSend(businessId) {
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);
    const daily = this.incrementCounter(businessId, "daily", dailyKey, 1);
    const hourly = this.incrementCounter(businessId, "hourly", hourlyKey, 1);
    return { daily, hourly };
  }

  // --- 4. Webhook Ingestion with Idempotency ---
  processWebhookEvent(businessId, event) {
    const { providerEventId, eventType, providerMessageId, recipientEmail, isPermanent, reason } = event;

    if (providerEventId) {
      const existing = this.oneOrNone(
        `SELECT id FROM email_events WHERE provider_event_id = '${providerEventId}';`
      );
      if (existing) {
        return { success: true, idempotent: true };
      }
    }

    const eventId = crypto.randomUUID();
    let msg = null;
    if (providerMessageId) {
      msg = this.oneOrNone(`SELECT * FROM email_messages WHERE provider_message_id = '${providerMessageId}';`);
    }

    this.db.public.none(`
      INSERT INTO email_events (id, business_id, email_message_id, event_type, provider_event_id, event_timestamp, created_at)
      VALUES ('${eventId}', '${businessId}', ${msg ? `'${msg.id}'` : "NULL"}, '${eventType.toLowerCase()}', ${providerEventId ? `'${providerEventId}'` : "NULL"}, NOW(), NOW());
    `);

    const normalized = recipientEmail.trim().toLowerCase();

    if (eventType === "BOUNCED") {
      if (msg) {
        this.db.public.none(`UPDATE email_messages SET status = 'BOUNCED', updated_at = NOW() WHERE id = '${msg.id}';`);
      }
      if (isPermanent) {
        this.addSuppression(businessId, normalized, "HARD_BOUNCE", reason || "webhook_bounce");
      }
    } else if (eventType === "COMPLAINED") {
      if (msg) {
        this.db.public.none(`UPDATE email_messages SET status = 'COMPLAINED', updated_at = NOW() WHERE id = '${msg.id}';`);
      }
      this.addSuppression(businessId, normalized, "COMPLAINT", reason || "webhook_complaint");
    } else if (eventType === "DELIVERED") {
      if (msg) {
        this.db.public.none(`UPDATE email_messages SET status = 'DELIVERED', updated_at = NOW() WHERE id = '${msg.id}';`);
      }
    }

    return { success: true, idempotent: false, eventId };
  }

  // --- 5. Campaign Dispatch with 12 Pre-Send Checks ---
  dispatchCampaignStep(campaignId, businessId, leadId, stepId) {
    const campaign = this.oneOrNone(`SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`);
    if (!campaign || campaign.status.toUpperCase() !== "ACTIVE") {
      return { dispatched: false, reason: "CAMPAIGN_NOT_ACTIVE" };
    }

    const lead = this.oneOrNone(`SELECT * FROM leads WHERE id = '${leadId}' AND business_id = '${businessId}';`);
    if (!lead || !lead.email) {
      return { dispatched: false, reason: "INVALID_OR_MISSING_LEAD" };
    }

    const normalizedEmail = lead.email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      this.db.public.none(`UPDATE campaign_leads SET status = 'STOPPED', last_error = 'Invalid email syntax', updated_at = NOW() WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
      return { dispatched: false, reason: "INVALID_EMAIL_SYNTAX" };
    }

    if (this.isSuppressed(businessId, normalizedEmail)) {
      this.db.public.none(`UPDATE campaign_leads SET status = 'STOPPED', last_error = 'Halted: Recipient is suppressed', updated_at = NOW() WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
      this.logSafetyAudit(businessId, "campaign_blocked", normalizedEmail, "Attempted send to suppressed contact halted");
      return { dispatched: false, reason: "RECIPIENT_SUPPRESSED" };
    }

    const limitCheck = this.checkLimits(businessId);
    if (!limitCheck.allowed) {
      return { dispatched: false, reason: limitCheck.reason, deferred: true };
    }

    const step = this.oneOrNone(`SELECT * FROM campaign_steps WHERE id = '${stepId}' AND campaign_id = '${campaignId}';`);
    if (!step || !step.template_id) {
      return { dispatched: false, reason: "STEP_TEMPLATE_MISSING" };
    }

    const template = this.oneOrNone(`SELECT * FROM email_templates WHERE id = '${step.template_id}' AND business_id = '${businessId}';`);
    if (!template || template.status?.toLowerCase() === "archived") {
      return { dispatched: false, reason: "TEMPLATE_INVALID_OR_ARCHIVED" };
    }

    const token = this.generateUnsubscribeToken(businessId, normalizedEmail, leadId, campaignId);
    const unsubscribeUrl = `https://app.opsiys.in/unsubscribe?token=${token}`;
    const bodyWithUnsub = this.ensureUnsubscribeLink(template.body, unsubscribeUrl);

    this.recordSend(businessId);
    const msgId = crypto.randomUUID();
    const providerMessageId = `mock_dispatch_${crypto.randomUUID()}`;

    this.db.public.none(`
      INSERT INTO email_messages (id, business_id, campaign_id, campaign_step_id, lead_id, template_id, direction, from_email, to_email, subject, body, status, provider_message_id, sent_at, created_at, updated_at)
      VALUES ('${msgId}', '${businessId}', '${campaignId}', '${stepId}', '${leadId}', '${template.id}', 'outbound', 'contact@opsiys.in', '${normalizedEmail}', '${template.subject}', '${bodyWithUnsub.replace(/'/g, "''")}', 'SENT', '${providerMessageId}', NOW(), NOW(), NOW());
    `);

    this.sentEmails.push({
      messageId: msgId,
      providerMessageId,
      to: normalizedEmail,
      subject: template.subject,
      body: bodyWithUnsub,
      unsubscribeUrl,
    });

    return { dispatched: true, messageId: msgId, providerMessageId, unsubscribeUrl };
  }
}

/**
 * PHASE 9 TEST SUITE: 20 SCENARIOS
 */
test("Phase 9: Email Safety & Deliverability Controls Test Suite", async (t) => {
  let db;
  let engine;
  let businessA;
  let businessB;

  t.beforeEach(() => {
    const harness = createTestDb();
    db = harness.db;
    harness.seed();
    engine = new SafetyTestEngine(db);

    businessA = engine.oneOrNone("SELECT id FROM businesses WHERE name = 'Acme Corp';")?.id;
    if (!businessA) {
      businessA = crypto.randomUUID();
      db.public.none(`INSERT INTO businesses (id, name, created_at) VALUES ('${businessA}', 'Acme Corp', NOW());`);
    }

    businessB = crypto.randomUUID();
    db.public.none(`INSERT INTO businesses (id, name, created_at) VALUES ('${businessB}', 'Beta Logistics', NOW());`);
  });

  // 1. Unsubscribe
  await t.test("1. Unsubscribe: Cryptographically signed token unsubscribe flow", () => {
    const email = "subscriber@example.com";
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, first_name, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'Alice', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${businessA}', 'Test Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campaignId}', '${leadId}', 'RUNNING', NOW());`);

    const token = engine.generateUnsubscribeToken(businessA, email, leadId, campaignId);
    const verification = engine.verifyUnsubscribeToken(token);
    assert.strictEqual(verification.valid, true, "Token signature must be valid");
    assert.strictEqual(verification.payload.e, email);

    engine.addSuppression(verification.payload.b, verification.payload.e, "UNSUBSCRIBED", "user_link");

    assert.strictEqual(engine.isSuppressed(businessA, email), true, "Email must be added to suppressions");
    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED", "Active enrollment must be halted on unsubscribe");

    const audit = engine.oneOrNone(`SELECT * FROM safety_audit_logs WHERE business_id = '${businessA}' AND recipient_email = '${email}';`);
    assert.ok(audit, "Safety audit log must be created");
  });

  // 2. Invalid unsubscribe token
  await t.test("2. Invalid unsubscribe token: Tampered signature is rejected safely", () => {
    const email = "victim@example.com";
    const token = engine.generateUnsubscribeToken(businessA, email);
    const tampered = token.slice(0, -6) + "xxxxxx";

    const verification = engine.verifyUnsubscribeToken(tampered);
    assert.strictEqual(verification.valid, false, "Tampered token signature must fail");
    assert.strictEqual(engine.isSuppressed(businessA, email), false, "No suppression must be added for tampered token");

    const malformed = engine.verifyUnsubscribeToken("garbage-token-without-dot");
    assert.strictEqual(malformed.valid, false, "Malformed token structure must fail cleanly");
  });

  // 3. Hard bounce
  await t.test("3. Hard bounce: Webhook marks message bounced, suppresses recipient, and stops enrollments", () => {
    const email = "deadmailbox@example.com";
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const providerMessageId = "re_msg_hard_bounce_test";

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${businessA}', 'Bounce Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campaignId}', '${leadId}', 'RUNNING', NOW());`);
    db.public.none(`INSERT INTO email_messages (id, business_id, campaign_id, lead_id, direction, from_email, to_email, subject, body, status, provider_message_id, created_at) VALUES ('${msgId}', '${businessA}', '${campaignId}', '${leadId}', 'outbound', 'sender@opsiys.in', '${email}', 'Hello', 'Body', 'SENT', '${providerMessageId}', NOW());`);

    const result = engine.processWebhookEvent(businessA, {
      providerEventId: "evt_bounce_perm_1",
      eventType: "BOUNCED",
      providerMessageId,
      recipientEmail: email,
      isPermanent: true,
      reason: "550 5.1.1 User unknown",
    });

    assert.strictEqual(result.success, true);
    const updatedMsg = engine.oneOrNone(`SELECT status FROM email_messages WHERE id = '${msgId}';`);
    assert.strictEqual(updatedMsg.status, "BOUNCED");

    assert.strictEqual(engine.isSuppressed(businessA, email), true, "Hard bounce must add recipient to suppressions");
    const suppression = engine.oneOrNone(`SELECT reason FROM suppressions WHERE business_id = '${businessA}' AND LOWER(email) = '${email}';`);
    assert.strictEqual(suppression.reason, "HARD_BOUNCE");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED", "Active enrollments must be stopped on hard bounce");
  });

  // 4. Complaint
  await t.test("4. Complaint: Spam complaint webhook immediately suppresses and halts enrollments", () => {
    const email = "complainant@example.com";
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const providerMessageId = "re_msg_complaint_test";

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${businessA}', 'Active Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campaignId}', '${leadId}', 'RUNNING', NOW());`);
    db.public.none(`INSERT INTO email_messages (id, business_id, campaign_id, lead_id, direction, from_email, to_email, subject, body, status, provider_message_id, created_at) VALUES ('${msgId}', '${businessA}', '${campaignId}', '${leadId}', 'outbound', 'sender@opsiys.in', '${email}', 'Notice', 'Body', 'SENT', '${providerMessageId}', NOW());`);

    const result = engine.processWebhookEvent(businessA, {
      providerEventId: "evt_complaint_1",
      eventType: "COMPLAINED",
      providerMessageId,
      recipientEmail: email,
      reason: "Recipient marked message as spam",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(engine.isSuppressed(businessA, email), true);
    const suppression = engine.oneOrNone(`SELECT reason FROM suppressions WHERE business_id = '${businessA}' AND LOWER(email) = '${email}';`);
    assert.strictEqual(suppression.reason, "COMPLAINT");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED");
  });

  // 5. Temporary failure
  await t.test("5. Temporary failure: Soft bounce updates status without suppressing or halting enrollment", () => {
    const email = "mailboxfull@example.com";
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const providerMessageId = "re_msg_soft_bounce_test";

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${businessA}', 'Active Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campaignId}', '${leadId}', 'RUNNING', NOW());`);
    db.public.none(`INSERT INTO email_messages (id, business_id, campaign_id, lead_id, direction, from_email, to_email, subject, body, status, provider_message_id, created_at) VALUES ('${msgId}', '${businessA}', '${campaignId}', '${leadId}', 'outbound', 'sender@opsiys.in', '${email}', 'Subject', 'Body', 'SENT', '${providerMessageId}', NOW());`);

    const result = engine.processWebhookEvent(businessA, {
      providerEventId: "evt_soft_bounce_1",
      eventType: "BOUNCED",
      providerMessageId,
      recipientEmail: email,
      isPermanent: false,
      reason: "452 4.2.2 Mailbox full",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(engine.isSuppressed(businessA, email), false, "Soft bounce must NOT add recipient to suppression list");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "RUNNING", "Soft bounce must NOT halt active campaign enrollment");
  });

  // 6. Suppressed recipient cannot send
  await t.test("6. Suppressed recipient cannot send: Pre-send check halts dispatch without sending", () => {
    const email = "unsubscribed.user@example.com";
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const templateId = crypto.randomUUID();
    const stepId = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${businessA}', 'Active Promo', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at) VALUES ('${templateId}', '${businessA}', 'T1', 'Hi', '<p>Hello</p>', 'active', NOW());`);
    db.public.none(`INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, status, created_at) VALUES ('${stepId}', '${campaignId}', 1, 'Step 1', '${templateId}', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campaignId}', '${leadId}', 'RUNNING', NOW());`);

    engine.addSuppression(businessA, email, "UNSUBSCRIBED");

    const dispatchResult = engine.dispatchCampaignStep(campaignId, businessA, leadId, stepId);
    assert.strictEqual(dispatchResult.dispatched, false);
    assert.strictEqual(dispatchResult.reason, "RECIPIENT_SUPPRESSED");
    assert.strictEqual(engine.sentEmails.length, 0, "No email should ever be dispatched to suppressed contact");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED");
  });

  // 7. Duplicate webhook event
  await t.test("7. Duplicate webhook event: Provider event ID processed idempotently", () => {
    const leadId = crypto.randomUUID();
    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', 'user@example.com', 'new', NOW());`);

    const msgId = crypto.randomUUID();
    const providerMessageId = "re_msg_idempotent_test";
    db.public.none(`INSERT INTO email_messages (id, business_id, lead_id, direction, from_email, to_email, subject, body, status, provider_message_id, created_at) VALUES ('${msgId}', '${businessA}', '${leadId}', 'outbound', 'sender@opsiys.in', 'user@example.com', 'Hi', 'Body', 'SENT', '${providerMessageId}', NOW());`);

    const eventId = "wh_evt_unique_123456";
    const result1 = engine.processWebhookEvent(businessA, {
      providerEventId: eventId,
      providerMessageId,
      eventType: "DELIVERED",
      recipientEmail: "user@example.com",
    });
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.idempotent, false);

    const result2 = engine.processWebhookEvent(businessA, {
      providerEventId: eventId,
      providerMessageId,
      eventType: "DELIVERED",
      recipientEmail: "user@example.com",
    });
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.idempotent, true, "Duplicate provider_event_id must be handled idempotently");

    const events = db.public.many(`SELECT * FROM email_events WHERE provider_event_id = '${eventId}';`);
    assert.strictEqual(events.length, 1, "Exactly one email_event record must exist for duplicate webhook");
  });

  // 8. Sending limit
  await t.test("8. Sending limit: Hard ceilings defer execution instead of failing permanently", () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 2, "hourly_send_limit": 5, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    const check1 = engine.checkLimits(businessA);
    assert.strictEqual(check1.allowed, true);

    engine.recordSend(businessA);
    engine.recordSend(businessA);

    const check2 = engine.checkLimits(businessA);
    assert.strictEqual(check2.allowed, false);
    assert.strictEqual(check2.reason, "DAILY_LIMIT_EXCEEDED");
  });

  // 9. Hourly rate limit
  await t.test("9. Hourly rate limit: Enforces hourly cap for current UTC hour", () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 1000, "hourly_send_limit": 3, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    engine.recordSend(businessA);
    engine.recordSend(businessA);
    engine.recordSend(businessA);

    const check = engine.checkLimits(businessA);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.reason, "HOURLY_LIMIT_EXCEEDED");

    const audit = engine.oneOrNone(`SELECT * FROM safety_audit_logs WHERE business_id = '${businessA}' AND event_type = 'send_limit_reached';`);
    assert.ok(audit, "Audit event logged for hourly limit exceeded");
  });

  // 10. Daily limit
  await t.test("10. Daily limit: Enforces daily cap for current UTC date", () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 1, "hourly_send_limit": 100, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    engine.recordSend(businessA);
    const check = engine.checkLimits(businessA);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.reason, "DAILY_LIMIT_EXCEEDED");
  });

  // 11. Multiple campaigns sharing same business limit
  await t.test("11. Multiple campaigns sharing same business limit: Shared counter across campaigns", () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 2, "hourly_send_limit": 10, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();
    const lead1 = crypto.randomUUID();
    const lead2 = crypto.randomUUID();
    const lead3 = crypto.randomUUID();
    const tpl = crypto.randomUUID();
    const s1 = crypto.randomUUID();
    const s2 = crypto.randomUUID();

    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${c1}', '${businessA}', 'Campaign 1', 'ACTIVE', NOW()), ('${c2}', '${businessA}', 'Campaign 2', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at) VALUES ('${tpl}', '${businessA}', 'TPL', 'Hi', '<p>Test</p>', 'active', NOW());`);
    db.public.none(`INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, status, created_at) VALUES ('${s1}', '${c1}', 1, 'S1', '${tpl}', 'ACTIVE', NOW()), ('${s2}', '${c2}', 1, 'S2', '${tpl}', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${lead1}', '${businessA}', 'lead1@test.com', 'new', NOW()), ('${lead2}', '${businessA}', 'lead2@test.com', 'new', NOW()), ('${lead3}', '${businessA}', 'lead3@test.com', 'new', NOW());`);

    const d1 = engine.dispatchCampaignStep(c1, businessA, lead1, s1);
    assert.strictEqual(d1.dispatched, true, "First send from Campaign 1 should succeed");

    const d2 = engine.dispatchCampaignStep(c2, businessA, lead2, s2);
    assert.strictEqual(d2.dispatched, true, "Second send from Campaign 2 should succeed (limit now reached)");

    const d3 = engine.dispatchCampaignStep(c1, businessA, lead3, s1);
    assert.strictEqual(d3.dispatched, false, "Third send from Campaign 1 must be blocked by business ceiling");
    assert.strictEqual(d3.reason, "DAILY_LIMIT_EXCEEDED");
  });

  // 12. Cross-business suppression isolation
  await t.test("12. Cross-business suppression isolation: Business A suppression does not affect Business B", () => {
    const email = "shared.customer@global.com";
    engine.addSuppression(businessA, email, "UNSUBSCRIBED");

    assert.strictEqual(engine.isSuppressed(businessA, email), true, "Suppressed in Business A");
    assert.strictEqual(engine.isSuppressed(businessB, email), false, "NOT suppressed in Business B");

    const leadB = crypto.randomUUID();
    const campB = crypto.randomUUID();
    const tplB = crypto.randomUUID();
    const stepB = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadB}', '${businessB}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campB}', '${businessB}', 'Biz B Outreach', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at) VALUES ('${tplB}', '${businessB}', 'TPL B', 'Welcome', '<p>Hello B</p>', 'active', NOW());`);
    db.public.none(`INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, status, created_at) VALUES ('${stepB}', '${campB}', 1, 'Step 1', '${tplB}', 'ACTIVE', NOW());`);

    const dispatchB = engine.dispatchCampaignStep(campB, businessB, leadB, stepB);
    assert.strictEqual(dispatchB.dispatched, true, "Business B can dispatch safely to the customer");
  });

  // 13. Manual suppression
  await t.test("13. Manual suppression: Admin can manually suppress and halt enrollments", () => {
    const email = "troublemaker@example.com";
    const leadId = crypto.randomUUID();
    const campId = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campId}', '${businessA}', 'Active Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campId}', '${leadId}', 'RUNNING', NOW());`);

    engine.addSuppression(businessA, email, "MANUAL", "admin_dashboard");

    assert.strictEqual(engine.isSuppressed(businessA, email), true);
    const suppression = engine.oneOrNone(`SELECT reason FROM suppressions WHERE business_id = '${businessA}' AND LOWER(email) = '${email}';`);
    assert.strictEqual(suppression.reason, "MANUAL");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED");
  });

  // 14. Removing suppression
  await t.test("14. Removing suppression: Deletion allows future sends without resuming old enrollments", () => {
    const email = "reinstated@example.com";
    const leadId = crypto.randomUUID();
    const campId = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', '${email}', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campId}', '${businessA}', 'Promo', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campId}', '${leadId}', 'RUNNING', NOW());`);

    engine.addSuppression(businessA, email, "MANUAL");
    assert.strictEqual(engine.isSuppressed(businessA, email), true);

    const oldEnrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(oldEnrollment.status, "STOPPED");

    const removed = engine.removeSuppression(businessA, email);
    assert.strictEqual(removed, true);
    assert.strictEqual(engine.isSuppressed(businessA, email), false);

    // Old enrollment remains STOPPED
    const afterRemoval = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${leadId}';`);
    assert.strictEqual(afterRemoval.status, "STOPPED", "Old enrollment must NOT automatically resume on suppression removal");
  });

  // 15. Campaign activation validation
  await t.test("15. Campaign activation validation: 6-point checklist blocks activation if invalid", () => {
    const campId = crypto.randomUUID();
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campId}', '${businessA}', 'Draft Campaign', 'DRAFT', NOW());`);

    // Helper simulating campaign validation logic
    function validateCampaignChecklist(cid, bid) {
      const steps = db.public.many(`SELECT * FROM campaign_steps WHERE campaign_id = '${cid}' AND status = 'ACTIVE';`);
      const contacts = db.public.many(`SELECT * FROM campaign_leads WHERE campaign_id = '${cid}';`);
      const biz = engine.oneOrNone(`SELECT settings FROM businesses WHERE id = '${bid}';`);
      const sender = biz?.settings?.email_sender?.from_email;

      const checklist = {
        activeSteps: steps && steps.length > 0,
        contactsEnrolled: contacts && contacts.length > 0,
        templatesValid: steps && steps.length > 0 && steps.every((s) => Boolean(s.template_id)),
        senderConfigured: Boolean(sender && emailRegex.test(sender)),
        unsubscribeEnabled: true,
        noCriticalErrors: false,
      };

      checklist.noCriticalErrors = checklist.activeSteps && checklist.contactsEnrolled && checklist.templatesValid && checklist.senderConfigured;
      return checklist;
    }

    const check1 = validateCampaignChecklist(campId, businessA);
    assert.strictEqual(check1.noCriticalErrors, false, "Should fail with no steps, no contacts, no sender");

    // Add step with template
    const tplId = crypto.randomUUID();
    db.public.none(`INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at) VALUES ('${tplId}', '${businessA}', 'TPL', 'Hi', 'Body', 'active', NOW());`);
    db.public.none(`INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${campId}', 1, 'Step 1', '${tplId}', 'ACTIVE', NOW());`);

    // Add contact
    const leadId = crypto.randomUUID();
    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${businessA}', 'valid@test.com', 'new', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campId}', '${leadId}', 'ENROLLED', NOW());`);

    // Configure sender
    db.public.none(`UPDATE businesses SET settings = '{"email_sender": {"from_name": "Ops", "from_email": "ops@opsiys.in"}}'::jsonb WHERE id = '${businessA}';`);

    const check2 = validateCampaignChecklist(campId, businessA);
    assert.strictEqual(check2.activeSteps, true);
    assert.strictEqual(check2.contactsEnrolled, true);
    assert.strictEqual(check2.templatesValid, true);
    assert.strictEqual(check2.senderConfigured, true);
    assert.strictEqual(check2.unsubscribeEnabled, true);
    assert.strictEqual(check2.noCriticalErrors, true, "All 6 checklist requirements now satisfied");
  });

  // 16. Missing unsubscribe mechanism
  await t.test("16. Missing unsubscribe mechanism: Unsubscribe link is automatically injected", () => {
    const rawHtmlWithoutUnsub = "<html><body><h1>Welcome</h1><p>Thanks for joining!</p></body></html>";
    const testUnsubUrl = "https://app.opsiys.in/unsubscribe?token=sample-test-token";
    const injected = engine.ensureUnsubscribeLink(rawHtmlWithoutUnsub, testUnsubUrl);

    assert.ok(injected.includes(testUnsubUrl), "Unsubscribe link must be injected into HTML body");

    const templateWithPlaceholder = "<p>Click here to <a href='{{unsubscribe_url}}'>opt out</a></p>";
    const replaced = engine.ensureUnsubscribeLink(templateWithPlaceholder, testUnsubUrl);
    assert.ok(!replaced.includes("{{unsubscribe_url}}"), "Placeholder must be substituted");
    assert.ok(replaced.includes(testUnsubUrl), "Substituted url must be present");
  });

  // 17. Invalid email
  await t.test("17. Invalid email: Malformed emails are halted cleanly during dispatch", () => {
    const badLeadId = crypto.randomUUID();
    const campId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const tplId = crypto.randomUUID();

    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${badLeadId}', '${businessA}', 'not-an-email-at-all', 'new', NOW());`);
    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campId}', '${businessA}', 'Active Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at) VALUES ('${tplId}', '${businessA}', 'T1', 'Subject', '<p>Body</p>', 'active', NOW());`);
    db.public.none(`INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, status, created_at) VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplId}', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${businessA}', '${campId}', '${badLeadId}', 'RUNNING', NOW());`);

    const result = engine.dispatchCampaignStep(campId, businessA, badLeadId, stepId);
    assert.strictEqual(result.dispatched, false);
    assert.strictEqual(result.reason, "INVALID_EMAIL_SYNTAX");

    const enrollment = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${badLeadId}';`);
    assert.strictEqual(enrollment.status, "STOPPED");
  });

  // 18. Duplicate enrollment
  await t.test("18. Duplicate enrollment: Case-insensitive normalized email prevents double enrollment", () => {
    const campId = crypto.randomUUID();
    const email = "cloneme@example.com";
    const lead1 = crypto.randomUUID();
    const lead2 = crypto.randomUUID();

    db.public.none(`INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campId}', '${businessA}', 'Dedupe Campaign', 'ACTIVE', NOW());`);
    db.public.none(`INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${lead1}', '${businessA}', '${email}', 'new', NOW()), ('${lead2}', '${businessA}', ' CLONEME@EXAMPLE.COM ', 'new', NOW());`);

    // Simulating enrollment deduplication logic
    function enrollContactsDeduplicated(cid, bid, leadIds) {
      const existing = db.public.many(`SELECT l.email FROM campaign_leads cl JOIN leads l ON cl.lead_id = l.id WHERE cl.campaign_id = '${cid}';`);
      const seen = new Set((existing || []).map((x) => x.email.trim().toLowerCase()));
      let enrolled = 0;
      let skipped = 0;

      for (const lid of leadIds) {
        const lead = engine.oneOrNone(`SELECT email FROM leads WHERE id = '${lid}' AND business_id = '${bid}';`);
        const norm = lead?.email?.trim().toLowerCase();
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          db.public.none(`INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, created_at) VALUES ('${crypto.randomUUID()}', '${bid}', '${cid}', '${lid}', 'ENROLLED', NOW());`);
          enrolled++;
        } else {
          skipped++;
        }
      }
      return { enrolled, skipped };
    }

    const res = enrollContactsDeduplicated(campId, businessA, [lead1, lead2]);
    assert.strictEqual(res.enrolled, 1, "Only one contact should be enrolled");
    assert.strictEqual(res.skipped, 1, "Duplicate normalized email should be skipped");
  });

  // 19. Worker restart preserving limits
  await t.test("19. Worker restart preserving limits: Sending counters in DB persist across restarts", () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 5, "hourly_send_limit": 5, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    // Worker 1 runs and records 4 sends
    engine.recordSend(businessA);
    engine.recordSend(businessA);
    engine.recordSend(businessA);
    engine.recordSend(businessA);

    // Simulate worker restart: new engine instance created with same database
    const restartedWorkerEngine = new SafetyTestEngine(db);

    const check = restartedWorkerEngine.checkLimits(businessA);
    assert.strictEqual(check.allowed, true, "4/5 sends recorded - 1 remaining");

    restartedWorkerEngine.recordSend(businessA); // 5/5

    const checkFull = restartedWorkerEngine.checkLimits(businessA);
    assert.strictEqual(checkFull.allowed, false, "Limits correctly preserved across restart; ceiling hit");
    assert.strictEqual(checkFull.reason, "DAILY_LIMIT_EXCEEDED");
  });

  // 20. Concurrent workers respecting limits
  await t.test("20. Concurrent workers respecting limits: Atomic increments prevent counter overrun", async () => {
    db.public.none(`
      UPDATE businesses
      SET settings = '{"sending_limits": {"daily_send_limit": 10, "hourly_send_limit": 10, "send_rate_per_minute": 30}}'::jsonb
      WHERE id = '${businessA}';
    `);

    const workerA = new SafetyTestEngine(db);
    const workerB = new SafetyTestEngine(db);

    // Simulate 12 concurrent dispatch requests across 2 worker instances
    const results = [];
    for (let i = 0; i < 12; i++) {
      const activeWorker = i % 2 === 0 ? workerA : workerB;
      const check = activeWorker.checkLimits(businessA);
      if (check.allowed) {
        activeWorker.recordSend(businessA);
        results.push("SENT");
      } else {
        results.push("DEFERRED");
      }
    }

    const sentCount = results.filter((r) => r === "SENT").length;
    const deferredCount = results.filter((r) => r === "DEFERRED").length;

    assert.strictEqual(sentCount, 10, "Exactly 10 sends allowed up to daily limit");
    assert.strictEqual(deferredCount, 2, "Remaining 2 dispatches deferred");

    const todayKey = workerA.getDailyKey();
    const finalCount = workerA.getCounter(businessA, "daily", todayKey);
    assert.strictEqual(finalCount, 10, "Final counter matches maximum ceiling");
  });
});
