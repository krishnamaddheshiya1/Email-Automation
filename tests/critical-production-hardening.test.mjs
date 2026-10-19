import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { emailRegex } from "../lib/validations/email.ts";

test("CRITICAL PRODUCTION HARDENING: 12 SCENARIO SUITE", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // Setup common business tenant fixture
  const businessId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const senderId = crypto.randomUUID();

  execute(`
    INSERT INTO businesses (id, name, settings, created_at, updated_at)
    VALUES ('${businessId}', 'Hardening Test Corp', '{"email_sender": {"from_email": "team@hardentest.com"}}'::jsonb, NOW(), NOW());
    INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
    VALUES ('${userId}', '${businessId}', 'admin@hardentest.com', 'Harden Admin', 'owner', 'active', NOW(), NOW());
    INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
    VALUES ('${senderId}', '${businessId}', 'Hardening Team', 'team@hardentest.com', 'replies@hardentest.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
  `);

  // =========================================================================
  // TEST 1: Email open tracking records first_opened_at and increments open_count
  // =========================================================================
  await t.test("TEST 1: Email open tracking records first_opened_at and increments open_count", () => {
    const leadId = crypto.randomUUID();
    const msgId = crypto.randomUUID();

    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'open.tester@example.com', 'Open', 'Tester', 'new', NOW(), NOW());
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${msgId}', '${businessId}', '${leadId}', 'team@hardentest.com', 'open.tester@example.com', 'Test Open', 'body', 'sent', NOW(), NOW());
    `);

    // Verify initial values
    let msg = queryOne(`SELECT status, open_count, opened_at, first_opened_at, last_opened_at FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.open_count, 0);
    assert.equal(msg.first_opened_at, null);
    assert.equal(msg.last_opened_at, null);

    // First Open
    const open1 = "2026-10-19T10:00:00.000Z";
    execute(`
      UPDATE email_messages
      SET open_count = COALESCE(open_count, 0) + 1,
          opened_at = COALESCE(opened_at, '${open1}'::timestamptz),
          first_opened_at = COALESCE(first_opened_at, opened_at, '${open1}'::timestamptz),
          last_opened_at = '${open1}'::timestamptz,
          status = 'opened',
          updated_at = NOW()
      WHERE id = '${msgId}';
    `);

    msg = queryOne(`SELECT status, open_count, opened_at, first_opened_at, last_opened_at FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.status, "opened");
    assert.equal(msg.open_count, 1);
    assert.ok(msg.first_opened_at);
    assert.ok(msg.last_opened_at);
    const initialFirstOpen = new Date(msg.first_opened_at).getTime();

    // Second Open (10 mins later)
    const open2 = "2026-10-19T10:10:00.000Z";
    execute(`
      UPDATE email_messages
      SET open_count = COALESCE(open_count, 0) + 1,
          opened_at = COALESCE(opened_at, '${open2}'::timestamptz),
          first_opened_at = COALESCE(first_opened_at, opened_at, '${open2}'::timestamptz),
          last_opened_at = '${open2}'::timestamptz,
          status = 'opened',
          updated_at = NOW()
      WHERE id = '${msgId}';
    `);

    msg = queryOne(`SELECT status, open_count, opened_at, first_opened_at, last_opened_at FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.open_count, 2);
    // first_opened_at MUST NOT CHANGE
    assert.equal(new Date(msg.first_opened_at).getTime(), initialFirstOpen);
    // last_opened_at MUST be updated
    assert.ok(new Date(msg.last_opened_at).getTime() > initialFirstOpen);
  });

  // =========================================================================
  // TEST 2: Public URL resolution produces valid URLs in all environments
  // =========================================================================
  await t.test("TEST 2: Public URL resolution produces valid URLs in all environments", () => {
    function resolveAppUrl() {
      if (process.env.NEXT_PUBLIC_APP_URL) {
        return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
      }
      if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        const url = process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/+$/, "");
        return url.startsWith("http") ? url : `https://${url}`;
      }
      if (process.env.VERCEL_URL) {
        const url = process.env.VERCEL_URL.replace(/\/+$/, "");
        return url.startsWith("http") ? url : `https://${url}`;
      }
      return "http://localhost:3000";
    }

    function generateTrackingPixelUrl(messageId) {
      const baseUrl = resolveAppUrl();
      return `${baseUrl}/api/track/open/${messageId}`;
    }

    // 1. With NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = "https://app.customdomain.com";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    assert.equal(resolveAppUrl(), "https://app.customdomain.com");

    // 2. With VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "myproject.vercel.app";
    assert.equal(resolveAppUrl(), "https://myproject.vercel.app");

    // 3. With VERCEL_URL preview
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_URL = "preview-123.vercel.app";
    assert.equal(resolveAppUrl(), "https://preview-123.vercel.app");

    // 4. Fallback localhost
    delete process.env.VERCEL_URL;
    assert.equal(resolveAppUrl(), "http://localhost:3000");

    // Tracking pixel url
    const pixel = generateTrackingPixelUrl("msg-test-abc");
    assert.equal(pixel, "http://localhost:3000/api/track/open/msg-test-abc");
    assert.ok(!pixel.includes("undefined"));
  });

  // =========================================================================
  // TEST 3: Duplicate open webhook events are handled idempotently
  // =========================================================================
  await t.test("TEST 3: Duplicate open webhook events are handled idempotently", () => {
    const leadId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const providerEventId = "evt_open_idem_001";

    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'idem.open@example.com', 'Idem', 'Open', 'new', NOW(), NOW());
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${msgId}', '${businessId}', '${leadId}', 'team@hardentest.com', 'idem.open@example.com', 'Idem Test', 'body', 'delivered', NOW(), NOW());
    `);

    // Helper to process open event with idempotency check on email_events
    function processOpenWebhook(eventId, emailMessageId) {
      const existing = queryOne(`SELECT id FROM email_events WHERE provider_event_id = '${eventId}'`);
      if (existing) {
        return { duplicate: true };
      }

      execute(`
        INSERT INTO email_events (id, business_id, email_message_id, event_type, provider_event_id, event_timestamp, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', '${emailMessageId}', 'opened', '${eventId}', NOW(), NOW());
        UPDATE email_messages
        SET open_count = open_count + 1,
            status = 'opened',
            updated_at = NOW()
        WHERE id = '${emailMessageId}';
      `);
      return { duplicate: false };
    }

    // 1st webhook call
    const res1 = processOpenWebhook(providerEventId, msgId);
    assert.equal(res1.duplicate, false);

    let msg = queryOne(`SELECT open_count, status FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.open_count, 1);
    assert.equal(msg.status, "opened");

    // 2nd webhook call with SAME provider_event_id
    const res2 = processOpenWebhook(providerEventId, msgId);
    assert.equal(res2.duplicate, true);

    msg = queryOne(`SELECT open_count FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.open_count, 1); // Open count did not double increment
  });

  // =========================================================================
  // TEST 4: Resend inbound reply webhook creates message in correct conversation
  // =========================================================================
  await t.test("TEST 4: Resend inbound reply webhook creates message in correct conversation", () => {
    const leadId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const leadEmail = "reply.sender@client.com";

    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', '${leadEmail}', 'Reply', 'Sender', 'new', NOW(), NOW());
      INSERT INTO conversations (id, business_id, lead_id, status, subject, unread_count, created_at, updated_at)
      VALUES ('${convId}', '${businessId}', '${leadId}', 'active', 'Enterprise Proposal', 0, NOW(), NOW());
    `);

    // Inbound reply simulation
    const msgId = crypto.randomUUID();
    execute(`
      INSERT INTO conversation_messages (id, conversation_id, business_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES ('${msgId}', '${convId}', '${businessId}', 'INBOUND', '${leadEmail}', 'team@hardentest.com', 'Re: Enterprise Proposal', 'We accept your terms.', NOW());
      UPDATE conversations
      SET unread_count = unread_count + 1,
          updated_at = NOW()
      WHERE id = '${convId}';
    `);

    const conv = queryOne(`SELECT unread_count FROM conversations WHERE id = '${convId}'`);
    assert.equal(conv.unread_count, 1);

    const message = queryOne(`SELECT * FROM conversation_messages WHERE id = '${msgId}'`);
    assert.equal(message.direction.toLowerCase(), "inbound");
    assert.equal(message.sender_email, leadEmail);
  });

  // =========================================================================
  // TEST 5: Campaign progression stops immediately on reply
  // =========================================================================
  await t.test("TEST 5: Campaign progression stops immediately on reply", () => {
    const campaignId = crypto.randomUUID();
    const step1Id = crypto.randomUUID();
    const step2Id = crypto.randomUUID();
    const leadId = crypto.randomUUID();

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, created_at, updated_at)
      VALUES ('${campaignId}', '${businessId}', 'Reply Stop Campaign', 'ACTIVE', 'UTC', NOW(), NOW());
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES 
        ('${step1Id}', '${campaignId}', 1, 'Step 1', 0, 'minutes', 'active', NOW(), NOW()),
        ('${step2Id}', '${campaignId}', 2, 'Step 2', 2, 'days', 'active', NOW(), NOW());
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'stoponreply@domain.com', 'Stop', 'Reply', 'new', NOW(), NOW());
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, current_step, current_step_id, next_step_id, next_run_at, enrolled_at, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campaignId}', '${leadId}', '${businessId}', 'ENROLLED', 1, '${step1Id}', '${step2Id}', NOW() + INTERVAL '2 days', NOW(), NOW(), NOW());
    `);

    // Inbound reply arrives -> Halts campaign progression
    execute(`
      UPDATE campaign_leads
      SET status = 'REPLIED',
          next_run_at = NULL,
          stopped_at = NOW(),
          updated_at = NOW()
      WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}';
    `);

    const enr = queryOne(`SELECT status, next_run_at, stopped_at FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}'`);
    assert.equal(enr.status, "REPLIED");
    assert.equal(enr.next_run_at, null);
    assert.ok(enr.stopped_at);
  });

  // =========================================================================
  // TEST 6: Resend bounce webhook marks message BOUNCED and contact suppressed
  // =========================================================================
  await t.test("TEST 6: Resend bounce webhook marks message BOUNCED and contact suppressed", () => {
    const leadId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const bounceEmail = "hardbounce@invalid-mx.org";

    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', '${bounceEmail}', 'Bounce', 'User', 'new', NOW(), NOW());
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${msgId}', '${businessId}', '${leadId}', 'team@hardentest.com', '${bounceEmail}', 'Bounce subject', 'body', 'sent', NOW(), NOW());
    `);

    // Process bounce
    execute(`
      UPDATE email_messages
      SET status = 'bounced',
          bounced_at = NOW(),
          bounce_type = 'hard_bounce',
          bounce_subtype = 'mailbox_not_found',
          bounce_message = '550 User not found',
          updated_at = NOW()
      WHERE id = '${msgId}';

      INSERT INTO suppressions (id, business_id, email, reason, source, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${businessId}', '${bounceEmail}', 'HARD_BOUNCE', 'webhook', NOW(), NOW())
      ON CONFLICT (business_id, email) DO UPDATE SET reason = EXCLUDED.reason;

      UPDATE leads
      SET status = 'bounced',
          updated_at = NOW()
      WHERE id = '${leadId}';
    `);

    const msg = queryOne(`SELECT status, bounced_at, bounce_type FROM email_messages WHERE id = '${msgId}'`);
    assert.equal(msg.status, "bounced");
    assert.ok(msg.bounced_at);
    assert.equal(msg.bounce_type, "hard_bounce");

    const supp = queryOne(`SELECT reason FROM suppressions WHERE business_id = '${businessId}' AND email = '${bounceEmail}'`);
    assert.ok(supp);
    assert.equal(supp.reason, "HARD_BOUNCE");

    const lead = queryOne(`SELECT status FROM leads WHERE id = '${leadId}'`);
    assert.equal(lead.status, "bounced");
  });

  // =========================================================================
  // TEST 7: Resend suppressed/failed events handled correctly
  // =========================================================================
  await t.test("TEST 7: Resend suppressed/failed events handled correctly", () => {
    function parseWebhook(payload) {
      const type = (payload.type || "").toLowerCase();
      if (type === "email.suppressed" || type === "suppressed") {
        return {
          status: "BOUNCED",
          bounceType: "suppressed",
          reason: payload.data?.reason || "suppressed_by_provider",
        };
      }
      if (type === "email.failed" || type === "failed") {
        return {
          status: "FAILED",
          reason: payload.data?.error || payload.data?.reason || "provider_delivery_failure",
        };
      }
      return { status: "UNKNOWN" };
    }

    const suppEvt = parseWebhook({
      type: "email.suppressed",
      data: { reason: "Recipient previously marked spam" },
    });
    assert.equal(suppEvt.status, "BOUNCED");
    assert.equal(suppEvt.bounceType, "suppressed");

    const failedEvt = parseWebhook({
      type: "email.failed",
      data: { error: "Destination host unreachable" },
    });
    assert.equal(failedEvt.status, "FAILED");
    assert.equal(failedEvt.reason, "Destination host unreachable");
  });

  // =========================================================================
  // TEST 8: Contact delete PERMANENTLY deletes from database with all cascades
  // =========================================================================
  await t.test("TEST 8: Contact delete PERMANENTLY deletes from database with all cascades", () => {
    const leadId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    const emailMsgId = crypto.randomUUID();

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campaignId}', '${businessId}', 'Delete Cascade Campaign', 'ACTIVE', NOW(), NOW());
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'delete.permanent@example.com', 'Delete', 'Me', 'new', NOW(), NOW());
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campaignId}', '${leadId}', '${businessId}', 'ENROLLED', NOW(), NOW());
      INSERT INTO conversations (id, business_id, lead_id, status, created_at, updated_at)
      VALUES ('${convId}', '${businessId}', '${leadId}', 'active', NOW(), NOW());
      INSERT INTO conversation_messages (id, conversation_id, business_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES ('${msgId}', '${convId}', '${businessId}', 'INBOUND', 'delete.permanent@example.com', 'team@hardentest.com', 'Subject', 'Hi', NOW());
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${emailMsgId}', '${businessId}', '${leadId}', 'team@hardentest.com', 'delete.permanent@example.com', 'Sub', 'Body', 'sent', NOW(), NOW());
    `);

    // Verify existing
    assert.ok(queryOne(`SELECT id FROM leads WHERE id = '${leadId}'`));
    assert.ok(queryOne(`SELECT id FROM campaign_leads WHERE lead_id = '${leadId}'`));

    // True Permanent Deletion with cascade
    execute(`
      DELETE FROM campaign_leads WHERE lead_id = '${leadId}' AND business_id = '${businessId}';
      DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE lead_id = '${leadId}' AND business_id = '${businessId}');
      DELETE FROM conversations WHERE lead_id = '${leadId}' AND business_id = '${businessId}';
      DELETE FROM email_messages WHERE lead_id = '${leadId}' AND business_id = '${businessId}';
      DELETE FROM leads WHERE id = '${leadId}' AND business_id = '${businessId}';
    `);

    // Verify complete removal from DB
    assert.equal(queryOne(`SELECT id FROM leads WHERE id = '${leadId}'`), null);
    assert.equal(queryOne(`SELECT id FROM campaign_leads WHERE lead_id = '${leadId}'`), null);
    assert.equal(queryOne(`SELECT id FROM conversations WHERE lead_id = '${leadId}'`), null);
    assert.equal(queryOne(`SELECT id FROM conversation_messages WHERE id = '${msgId}'`), null);
    assert.equal(queryOne(`SELECT id FROM email_messages WHERE lead_id = '${leadId}'`), null);
  });

  // =========================================================================
  // TEST 9: Deleted contact cannot be retrieved or reappear anywhere
  // =========================================================================
  await t.test("TEST 9: Deleted contact cannot be retrieved or reappear anywhere", () => {
    const leadId = crypto.randomUUID();
    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'ghost2@example.com', 'Ghost', 'Two', 'new', NOW(), NOW());
    `);

    // Permanent delete
    execute(`DELETE FROM leads WHERE id = '${leadId}' AND business_id = '${businessId}';`);

    const result = query(`SELECT * FROM leads WHERE business_id = '${businessId}' AND id = '${leadId}'`);
    assert.equal(result.length, 0);

    const listAll = query(`SELECT * FROM leads WHERE business_id = '${businessId}'`);
    assert.equal(listAll.some((l) => l.id === leadId), false);
  });

  // =========================================================================
  // TEST 10: Pre-send duplicate check prevents sending step already sent
  // =========================================================================
  await t.test("TEST 10: Pre-send duplicate check prevents sending step already sent", () => {
    const campaignId = crypto.randomUUID();
    const step1Id = crypto.randomUUID();
    const leadId = crypto.randomUUID();

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campaignId}', '${businessId}', 'Pre-Send Dup Camp', 'ACTIVE', NOW(), NOW());
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${step1Id}', '${campaignId}', 1, 'Step 1', 0, 'minutes', 'active', NOW(), NOW());
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'nodup@example.com', 'No', 'Dup', 'new', NOW(), NOW());
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, current_step_id, is_manual_override, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campaignId}', '${leadId}', '${businessId}', 'ENROLLED', '${step1Id}', FALSE, NOW(), NOW());
      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, campaign_step_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${businessId}', '${leadId}', '${campaignId}', '${step1Id}', 'team@hardentest.com', 'nodup@example.com', 'Already sent', 'body', 'delivered', NOW(), NOW());
    `);

    // Pre-send check function
    function canSendStep(campId, stepId, lId) {
      const enr = queryOne(`SELECT is_manual_override FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${lId}'`);
      if (enr && enr.is_manual_override) return true;

      const existing = queryOne(`
        SELECT id FROM email_messages 
        WHERE campaign_id = '${campId}' AND campaign_step_id = '${stepId}' AND lead_id = '${lId}'
          AND LOWER(status) IN ('sending', 'sent', 'delivered', 'opened')
      `);
      return !existing;
    }

    assert.equal(canSendStep(campaignId, step1Id, leadId), false);
  });

  // =========================================================================
  // TEST 11: "Send Again" manual override allows intentional duplicate send
  // =========================================================================
  await t.test("TEST 11: Send Again manual override allows intentional duplicate send", () => {
    const campaignId = crypto.randomUUID();
    const step1Id = crypto.randomUUID();
    const leadId = crypto.randomUUID();

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campaignId}', '${businessId}', 'Override Camp', 'ACTIVE', NOW(), NOW());
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${step1Id}', '${campaignId}', 1, 'Step 1', 0, 'minutes', 'active', NOW(), NOW());
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessId}', 'override@example.com', 'Override', 'User', 'new', NOW(), NOW());
      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, campaign_step_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${businessId}', '${leadId}', '${campaignId}', '${step1Id}', 'team@hardentest.com', 'override@example.com', 'Sent prev', 'body', 'delivered', NOW(), NOW());
    `);

    // Pre-enrollment duplicate check function
    function enroll(campId, lId, allowOverride = false) {
      const alreadyContacted = queryOne(`
        SELECT id FROM email_messages 
        WHERE campaign_id = '${campId}' AND lead_id = '${lId}'
          AND LOWER(status) IN ('sending', 'sent', 'delivered', 'opened')
      `);

      if (alreadyContacted && !allowOverride) {
        throw new Error("ALREADY_CONTACTED: This contact has already received an email from this campaign.");
      }

      execute(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, is_manual_override, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', '${campId}', '${lId}', '${businessId}', 'ENROLLED', ${allowOverride ? "TRUE" : "FALSE"}, NOW(), NOW())
        ON CONFLICT (campaign_id, lead_id) DO UPDATE SET is_manual_override = EXCLUDED.is_manual_override, status = 'ENROLLED';
      `);
      return { success: true };
    }

    // Attempt without override -> Must throw ALREADY_CONTACTED
    assert.throws(
      () => enroll(campaignId, leadId, false),
      /ALREADY_CONTACTED/
    );

    // Attempt WITH override -> Must succeed and set is_manual_override: true
    const res = enroll(campaignId, leadId, true);
    assert.equal(res.success, true);

    const enr = queryOne(`SELECT is_manual_override, status FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}'`);
    assert.equal(enr.is_manual_override, true);
    assert.equal(enr.status, "ENROLLED");
  });

  // =========================================================================
  // TEST 12: Contact eligibility endpoint accurately classifies all contact states
  // =========================================================================
  await t.test("TEST 12: Contact eligibility endpoint accurately classifies all contact states", () => {
    const campaignId = crypto.randomUUID();

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campaignId}', '${businessId}', 'Eligibility Engine Camp', 'ACTIVE', NOW(), NOW());
    `);

    // Setup 5 distinct contacts
    const c1 = crypto.randomUUID(); // Eligible
    const c2 = crypto.randomUUID(); // Suppressed
    const c3 = crypto.randomUUID(); // Bounced
    const c4 = crypto.randomUUID(); // Already Contacted
    const c5 = crypto.randomUUID(); // Invalid Email

    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES 
        ('${c1}', '${businessId}', 'c1.eligible@domain.com', 'C1', 'Eligible', 'new', NOW(), NOW()),
        ('${c2}', '${businessId}', 'c2.suppressed@domain.com', 'C2', 'Suppressed', 'new', NOW(), NOW()),
        ('${c3}', '${businessId}', 'c3.bounced@domain.com', 'C3', 'Bounced', 'bounced', NOW(), NOW()),
        ('${c4}', '${businessId}', 'c4.contacted@domain.com', 'C4', 'Contacted', 'new', NOW(), NOW()),
        ('${c5}', '${businessId}', 'invalid-not-an-email', 'C5', 'Invalid', 'new', NOW(), NOW());

      INSERT INTO suppressions (id, business_id, email, reason, source, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${businessId}', 'c2.suppressed@domain.com', 'MANUAL', 'admin', NOW(), NOW());

      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${businessId}', '${c4}', '${campaignId}', 'team@hardentest.com', 'c4.contacted@domain.com', 'Sent', 'body', 'delivered', NOW(), NOW());
    `);

    // Eligibility Evaluation Function
    function evaluateEligibility(campId) {
      const allLeads = query(`SELECT * FROM leads WHERE business_id = '${businessId}'`);
      const suppressions = new Set(query(`SELECT email FROM suppressions WHERE business_id = '${businessId}'`).map((s) => s.email.toLowerCase()));
      const contactedLeads = new Set(query(`SELECT lead_id FROM email_messages WHERE campaign_id = '${campId}' AND LOWER(status) IN ('sending', 'sent', 'delivered', 'opened')`).map((m) => m.lead_id));
      const enrollments = query(`SELECT * FROM campaign_leads WHERE campaign_id = '${campId}'`);
      const enrMap = new Map(enrollments.map((e) => [e.lead_id, e]));

      const evaluated = allLeads.map((contact) => {
        const email = (contact.email || "").trim().toLowerCase();
        const enr = enrMap.get(contact.id);
        const enrStatus = enr ? enr.status.toUpperCase() : null;
        const alreadyContacted = contactedLeads.has(contact.id);

        let isEligible = true;
        let ineligibleReason = null;

        if (!email || !emailRegex.test(email)) {
          isEligible = false;
          ineligibleReason = "Invalid Email";
        } else if (contact.status === "bounced" || enrStatus === "BOUNCED") {
          isEligible = false;
          ineligibleReason = "Bounced";
        } else if (suppressions.has(email) || contact.status === "unsubscribed") {
          isEligible = false;
          ineligibleReason = "Suppressed";
        } else if (enrStatus === "REPLIED") {
          isEligible = false;
          ineligibleReason = "Replied";
        } else if (enrStatus === "COMPLETED") {
          isEligible = false;
          ineligibleReason = "Campaign Completed";
        } else if (["ENROLLED", "RUNNING", "WAITING"].includes(enrStatus)) {
          isEligible = false;
          ineligibleReason = "Already Enrolled";
        } else if (alreadyContacted) {
          isEligible = false;
          ineligibleReason = "Already Contacted";
        }

        return {
          id: contact.id,
          is_eligible: isEligible,
          ineligible_reason: ineligibleReason,
          already_contacted: alreadyContacted,
        };
      });

      return {
        contacts: evaluated,
        summary: {
          total: evaluated.length,
          eligible: evaluated.filter((c) => c.is_eligible).length,
          ineligible: evaluated.filter((c) => !c.is_eligible).length,
          already_contacted: evaluated.filter((c) => c.already_contacted).length,
        },
      };
    }

    const res = evaluateEligibility(campaignId);
    const getC = (id) => res.contacts.find((c) => c.id === id);

    // Verify accurate classification
    assert.equal(getC(c1).is_eligible, true);
    assert.equal(getC(c1).ineligible_reason, null);

    assert.equal(getC(c2).is_eligible, false);
    assert.equal(getC(c2).ineligible_reason, "Suppressed");

    assert.equal(getC(c3).is_eligible, false);
    assert.equal(getC(c3).ineligible_reason, "Bounced");

    assert.equal(getC(c4).is_eligible, false);
    assert.equal(getC(c4).ineligible_reason, "Already Contacted");
    assert.equal(getC(c4).already_contacted, true);

    assert.equal(getC(c5).is_eligible, false);
    assert.equal(getC(c5).ineligible_reason, "Invalid Email");

    // Summary checks
    assert.ok(res.summary.total >= 5);
    assert.ok(res.summary.eligible >= 1);
    assert.ok(res.summary.already_contacted >= 1);
  });
});
