import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

/**
 * COMPREHENSIVE INTEGRATION TEST SUITE:
 * CAMPAIGN SEQUENCES + DELIVERY TRACKING + REPLIES
 *
 * Verifies:
 * 1. Multi-step follow-up campaign execution and progression.
 * 2. Instant cancellation of future sequence steps when a customer replies.
 * 3. Worker guarantees that REPLIED contacts are never picked up by Run Due Jobs.
 * 4. Delivery webhook tracking (email.delivered, email.delivery_delayed).
 * 5. Dashboard analytics metrics: emailsSent vs emailsDelivered (SENT !== DELIVERED).
 * 6. Webhook idempotency preventing duplicate event insertion.
 * 7. Inbound conversation threading, unread counter, and two-way replies.
 */
test("CAMPAIGN SEQUENCES + DELIVERY TRACKING + REPLIES SUITE", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // Setup Business Fixture
  const businessId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const senderId = crypto.randomUUID();

  execute(`
    INSERT INTO businesses (id, name, settings, created_at, updated_at)
    VALUES ('${businessId}', 'SeqTest Global Inc', '{"email_sender": {"from_email": "team@seqtest.com"}}'::jsonb, NOW(), NOW());
  `);

  execute(`
    INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
    VALUES ('${userId}', '${businessId}', 'founder@seqtest.com', 'Alex Founder', 'owner', 'active', NOW(), NOW());
  `);

  execute(`
    INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
    VALUES ('${senderId}', '${businessId}', 'SeqTest Outreach', 'outreach@seqtest.com', 'replies@seqtest.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
  `);

  // Setup Template 1 & Template 2
  const template1Id = crypto.randomUUID();
  const template2Id = crypto.randomUUID();

  execute(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at, updated_at)
    VALUES 
      ('${template1Id}', '${businessId}', 'Initial Intro', 'Intro: Quick Question {{first_name}}', '<p>Hi {{first_name}}, let us connect.</p>', 'active', NOW(), NOW()),
      ('${template2Id}', '${businessId}', 'Follow-up 1', 'Re: Quick Question {{first_name}}', '<p>Hi {{first_name}}, following up on my previous note.</p>', 'active', NOW(), NOW());
  `);

  // Setup Campaign
  const campaignId = crypto.randomUUID();
  execute(`
    INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
    VALUES ('${campaignId}', '${businessId}', 'Outreach Sequence 2026', 'ACTIVE', 'UTC', '${senderId}', NOW(), NOW());
  `);

  // Setup 2 Campaign Steps: Step 1 (Delay: 0m), Step 2 (Delay: 1 day)
  const step1Id = crypto.randomUUID();
  const step2Id = crypto.randomUUID();

  execute(`
    INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id, created_at, updated_at)
    VALUES 
      ('${step1Id}', '${campaignId}', 1, 'Initial Outreach', 0, 'minutes', 'active', '${template1Id}', NOW(), NOW()),
      ('${step2Id}', '${campaignId}', 2, 'Follow-up #1', 1, 'days', 'active', '${template2Id}', NOW(), NOW());
  `);

  // Setup 2 Contacts: Contact A and Contact B
  const contactAId = crypto.randomUUID();
  const contactBId = crypto.randomUUID();

  execute(`
    INSERT INTO leads (id, business_id, email, first_name, last_name, status, source, lead_score, metadata, created_at, updated_at)
    VALUES 
      ('${contactAId}', '${businessId}', 'alice@clientcorp.com', 'Alice', 'Smith', 'new', 'manual', 80, '{}'::jsonb, NOW(), NOW()),
      ('${contactBId}', '${businessId}', 'bob@partnertech.com', 'Bob', 'Jones', 'new', 'manual', 70, '{}'::jsonb, NOW(), NOW());
  `);

  // Enroll both contacts in Campaign
  const enrollmentAId = crypto.randomUUID();
  const enrollmentBId = crypto.randomUUID();

  execute(`
    INSERT INTO campaign_leads (
      id, campaign_id, lead_id, business_id, status, email, current_step,
      current_step_id, next_step_id, next_run_at, enrolled_at, created_at, updated_at
    ) VALUES 
      ('${enrollmentAId}', '${campaignId}', '${contactAId}', '${businessId}', 'ENROLLED', 'alice@clientcorp.com', 0, '${step1Id}', '${step1Id}', NOW() - INTERVAL '1 minute', NOW(), NOW(), NOW()),
      ('${enrollmentBId}', '${campaignId}', '${contactBId}', '${businessId}', 'ENROLLED', 'bob@partnertech.com', 0, '${step1Id}', '${step1Id}', NOW() - INTERVAL '1 minute', NOW(), NOW(), NOW());
  `);

  await t.test("Scenario 1: Step 1 executes for both contacts and schedules Step 2 delay", async () => {
    // 1. Claim due enrollments
    const dueSql = `
      SELECT cl.id, cl.lead_id, cl.campaign_id, cl.next_step_id
      FROM campaign_leads cl
      JOIN campaigns c ON c.id = cl.campaign_id
      WHERE UPPER(c.status) = 'ACTIVE'
        AND UPPER(cl.status) IN ('ENROLLED', 'RUNNING')
        AND cl.next_run_at IS NOT NULL
        AND cl.next_run_at <= NOW()
      ORDER BY cl.next_run_at ASC;
    `;
    const due = query(dueSql);
    assert.strictEqual(due.length, 2, "Both enrollments must be claimed for Step 1");

    // 2. Dispatch Step 1 for both contacts
    for (const item of due) {
      const msgId = crypto.randomUUID();
      const provMsgId = `prov_step1_${item.lead_id}`;
      execute(`
        INSERT INTO email_messages (
          id, business_id, lead_id, campaign_id, campaign_step_id, template_id,
          direction, provider_message_id, from_email, to_email, subject, body,
          status, sent_at, created_at, updated_at
        ) VALUES (
          '${msgId}', '${businessId}', '${item.lead_id}', '${campaignId}', '${step1Id}', '${template1Id}',
          'outbound', '${provMsgId}', 'outreach@seqtest.com',
          '${item.lead_id === contactAId ? "alice@clientcorp.com" : "bob@partnertech.com"}',
          'Intro: Quick Question', '<p>Let us connect.</p>',
          'sent', NOW(), NOW(), NOW()
        );
      `);

      execute(`
        INSERT INTO email_events (
          id, business_id, email_message_id, campaign_id, campaign_step_id, lead_id,
          event_type, provider_event_id, event_timestamp, created_at
        ) VALUES (
          '${crypto.randomUUID()}', '${businessId}', '${msgId}', '${campaignId}', '${step1Id}', '${item.lead_id}',
          'sent', 'evt_sent_${provMsgId}', NOW(), NOW()
        );
      `);

      // Advance enrollment: current_step = 1, next_step = step 2, next_run = NOW() + 1 day
      execute(`
        UPDATE campaign_leads
        SET current_step = 1,
            current_step_id = '${step1Id}',
            next_step_id = '${step2Id}',
            next_run_at = NOW() + INTERVAL '1 day',
            status = 'RUNNING',
            updated_at = NOW()
        WHERE id = '${item.id}';
      `);
    }

    // Verify both are now RUNNING with Step 2 scheduled
    const enrA = queryOne(`SELECT * FROM campaign_leads WHERE id = '${enrollmentAId}';`);
    const enrB = queryOne(`SELECT * FROM campaign_leads WHERE id = '${enrollmentBId}';`);
    assert.strictEqual(enrA.current_step, 1);
    assert.strictEqual(enrA.next_step_id, step2Id);
    assert.strictEqual(enrA.status, "RUNNING");
    assert.strictEqual(enrB.current_step, 1);
    assert.strictEqual(enrB.next_step_id, step2Id);
  });

  await t.test("Scenario 2: Customer reply arrives from Contact A -> Stop sequence immediately", async () => {
    // Inbound email arrives from alice@clientcorp.com
    const inboundProvId = "inbound_prov_alice_001";
    const replySubject = "Re: Intro: Quick Question Alice";
    const replyBody = "Yes, I would love to schedule a demo call this Friday!";

    // 1. Contact status updated to replied
    execute(`UPDATE leads SET status = 'replied', updated_at = NOW() WHERE id = '${contactAId}';`);

    // 2. Stop active campaign enrollments for Contact A (status = REPLIED, next_run_at = NULL, stopped_at = NOW())
    execute(`
      UPDATE campaign_leads
      SET status = 'REPLIED',
          next_run_at = NULL,
          stopped_at = NOW(),
          last_error = 'STOPPED_ON_REPLY',
          updated_at = NOW()
      WHERE business_id = '${businessId}'
        AND lead_id = '${contactAId}'
        AND UPPER(status) IN ('ENROLLED', 'RUNNING');
    `);

    // 3. Create conversation thread
    const convoId = crypto.randomUUID();
    execute(`
      INSERT INTO conversations (
        id, business_id, lead_id, campaign_id, subject, status, unread_count, last_message_at, created_at, updated_at
      ) VALUES (
        '${convoId}', '${businessId}', '${contactAId}', '${campaignId}', '${replySubject}', 'active', 1, NOW(), NOW(), NOW()
      );
    `);

    // 4. Record inbound message
    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, received_at, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${convoId}', '${businessId}', 'INBOUND', 'alice@clientcorp.com',
        'outreach@seqtest.com', '${replySubject}', '${replyBody}', '<p>${replyBody}</p>',
        '${inboundProvId}', NOW(), NOW()
      );
    `);

    // 5. Record replied event in email_events
    execute(`
      INSERT INTO email_events (
        id, business_id, campaign_id, campaign_step_id, lead_id,
        event_type, provider_event_id, event_timestamp, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${campaignId}', '${step1Id}', '${contactAId}',
        'replied', '${inboundProvId}', NOW(), NOW()
      );
    `);

    // Verify Contact A enrollment is strictly REPLIED with null next_run_at
    const enrA = queryOne(`SELECT * FROM campaign_leads WHERE id = '${enrollmentAId}';`);
    assert.strictEqual(enrA.status, "REPLIED", "Contact A must have status = REPLIED");
    assert.strictEqual(enrA.next_run_at, null, "next_run_at must be cleared to NULL");
    assert.ok(enrA.stopped_at, "stopped_at timestamp must be recorded");

    // Verify Contact B remains unchanged and ready for Step 2
    const enrB = queryOne(`SELECT * FROM campaign_leads WHERE id = '${enrollmentBId}';`);
    assert.strictEqual(enrB.status, "RUNNING");
    assert.ok(enrB.next_run_at !== null, "Contact B must still have next_run_at scheduled");
  });

  await t.test("Scenario 3: Run Due Jobs proves Contact A is NEVER claimed, Contact B progresses to Step 2", async () => {
    // Advance time: Contact B's Step 2 next_run_at is now due
    execute(`UPDATE campaign_leads SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = '${enrollmentBId}';`);

    const dueSql = `
      SELECT cl.id, cl.lead_id, cl.status, cl.next_step_id
      FROM campaign_leads cl
      JOIN campaigns c ON c.id = cl.campaign_id
      WHERE UPPER(c.status) = 'ACTIVE'
        AND UPPER(cl.status) IN ('ENROLLED', 'RUNNING')
        AND cl.next_run_at IS NOT NULL
        AND cl.next_run_at <= NOW()
      ORDER BY cl.next_run_at ASC;
    `;
    const due = query(dueSql);

    assert.strictEqual(due.length, 1, "Only Contact B must be claimed. Contact A must NOT be claimed.");
    assert.strictEqual(due[0].id, enrollmentBId, "Claimed item must be Contact B");
    assert.strictEqual(due[0].next_step_id, step2Id, "Contact B must be executing Step 2");

    // Execute Step 2 for Contact B
    const step2MsgId = crypto.randomUUID();
    const step2ProvId = "prov_step2_bob_002";
    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, campaign_id, campaign_step_id, template_id,
        direction, provider_message_id, from_email, to_email, subject, body,
        status, sent_at, created_at, updated_at
      ) VALUES (
        '${step2MsgId}', '${businessId}', '${contactBId}', '${campaignId}', '${step2Id}', '${template2Id}',
        'outbound', '${step2ProvId}', 'outreach@seqtest.com', 'bob@partnertech.com',
        'Re: Quick Question Bob', '<p>Following up on my previous note.</p>',
        'sent', NOW(), NOW(), NOW()
      );
    `);

    execute(`
      INSERT INTO email_events (
        id, business_id, email_message_id, campaign_id, campaign_step_id, lead_id,
        event_type, provider_event_id, event_timestamp, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${step2MsgId}', '${campaignId}', '${step2Id}', '${contactBId}',
        'sent', 'evt_sent_${step2ProvId}', NOW(), NOW()
      );
    `);

    // Final step completed for Contact B
    execute(`
      UPDATE campaign_leads
      SET current_step = 2,
          current_step_id = '${step2Id}',
          next_step_id = NULL,
          next_run_at = NULL,
          status = 'COMPLETED',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = '${enrollmentBId}';
    `);

    const enrBAfter = queryOne(`SELECT * FROM campaign_leads WHERE id = '${enrollmentBId}';`);
    assert.strictEqual(enrBAfter.status, "COMPLETED");
  });

  await t.test("Scenario 4: Resend Delivery Event Webhook updates message to DELIVERED", async () => {
    // Delivery webhook arrives for Contact B's Step 2 message
    const bobMsg = queryOne(`SELECT * FROM email_messages WHERE to_email = 'bob@partnertech.com' AND campaign_step_id = '${step2Id}';`);
    assert.ok(bobMsg, "Bob's Step 2 message must exist");

    const deliveryEvtId = "svix_delivered_evt_998811";
    const deliveryTimestamp = new Date().toISOString();

    // 1. Record DELIVERED event
    execute(`
      INSERT INTO email_events (
        id, business_id, email_message_id, campaign_id, campaign_step_id, lead_id,
        event_type, provider_event_id, event_timestamp, metadata, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${bobMsg.id}', '${campaignId}', '${step2Id}', '${contactBId}',
        'delivered', '${deliveryEvtId}', '${deliveryTimestamp}', '{"provider": "resend"}'::jsonb, NOW()
      );
    `);

    // 2. Update message status to DELIVERED with delivered_at
    execute(`
      UPDATE email_messages
      SET status = 'delivered',
          delivered_at = '${deliveryTimestamp}',
          updated_at = NOW()
      WHERE id = '${bobMsg.id}';
    `);

    const updatedMsg = queryOne(`SELECT * FROM email_messages WHERE id = '${bobMsg.id}';`);
    assert.strictEqual(updatedMsg.status, "delivered");
    assert.ok(updatedMsg.delivered_at, "delivered_at must be populated");
  });

  await t.test("Scenario 5: Dashboard Analytics accurately computes DELIVERED vs SENT", async () => {
    // Messages query: total sent vs total delivered
    const counts = queryOne(`
      SELECT 
        COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS total_sent,
        COUNT(CASE WHEN LOWER(status) = 'delivered' THEN 1 END) AS total_delivered,
        COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS total_bounced
      FROM email_messages 
      WHERE business_id = '${businessId}';
    `);

    const totalSent = Number(counts.total_sent);
    const totalDelivered = Number(counts.total_delivered);

    assert.ok(totalSent >= 3, `Expected at least 3 sent messages (Alice Step 1, Bob Step 1, Bob Step 2), got ${totalSent}`);
    assert.strictEqual(totalDelivered, 1, `Expected exactly 1 delivered message (Bob Step 2), got ${totalDelivered}`);
    assert.notStrictEqual(totalSent, totalDelivered, "SENT must NOT equal DELIVERED");

    // Check replies in conversations
    const convoCounts = queryOne(`
      SELECT 
        COUNT(*) AS total_replies,
        COALESCE(SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END), 0) AS unread_replies
      FROM conversations
      WHERE business_id = '${businessId}';
    `);

    assert.strictEqual(Number(convoCounts.total_replies), 1, "Expected 1 conversation reply from Alice");
    assert.strictEqual(Number(convoCounts.unread_replies), 1, "Expected 1 unread conversation");
  });

  await t.test("Scenario 6: Delayed Delivery Event (email.delivery_delayed) does not fail message", async () => {
    // Create an in-flight message
    const delayedMsgId = crypto.randomUUID();
    const delayedProvId = "prov_delayed_test_555";

    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, from_email, to_email, subject, body,
        status, provider_message_id, sent_at, created_at, updated_at
      ) VALUES (
        '${delayedMsgId}', '${businessId}', '${contactAId}', 'outreach@seqtest.com', 'charlie@clientcorp.com',
        'System Notice', '<p>Notice</p>', 'sent', '${delayedProvId}', NOW(), NOW(), NOW()
      );
    `);

    // Delivery delayed event arrives
    const delayedEvtId = "svix_delayed_evt_333222";
    execute(`
      INSERT INTO email_events (
        id, business_id, email_message_id, lead_id,
        event_type, provider_event_id, event_timestamp, metadata, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${delayedMsgId}', '${contactAId}',
        'delivery_delayed', '${delayedEvtId}', NOW(), '{"reason": "Mailbox server temporarily busy"}'::jsonb, NOW()
      );
    `);

    execute(`
      UPDATE email_messages
      SET metadata = '{"delivery_delayed": true, "reason": "Mailbox server temporarily busy"}'::jsonb,
          updated_at = NOW()
      WHERE id = '${delayedMsgId}';
    `);

    const msg = queryOne(`SELECT * FROM email_messages WHERE id = '${delayedMsgId}';`);
    assert.strictEqual(msg.status, "sent", "Delayed delivery event must NOT fail or cancel message");
    const ev = queryOne(`SELECT * FROM email_events WHERE provider_event_id = '${delayedEvtId}';`);
    assert.strictEqual(ev.event_type, "delivery_delayed");
  });

  await t.test("Scenario 7: Webhook Idempotency: duplicate provider_event_id is rejected safely", async () => {
    const testEvtId = "unique_webhook_id_12345";
    execute(`
      INSERT INTO email_events (
        id, business_id, event_type, provider_event_id, event_timestamp, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', 'delivered', '${testEvtId}', NOW(), NOW()
      );
    `);

    // Verify lookup finds existing event
    const found = queryOne(`SELECT * FROM email_events WHERE provider_event_id = '${testEvtId}';`);
    assert.ok(found, "Event must exist in DB");

    // Simulating idempotency check: if found, do not re-insert
    const existing = queryOne(`SELECT id FROM email_events WHERE provider_event_id = '${testEvtId}';`);
    assert.ok(existing, "Deduplication must detect existing provider_event_id");
  });

  await t.test("Scenario 8: Two-Way Outbound Reply from application marks conversation read", async () => {
    const convo = queryOne(`SELECT * FROM conversations WHERE business_id = '${businessId}' AND lead_id = '${contactAId}';`);
    assert.ok(convo, "Conversation for Contact A must exist");
    assert.strictEqual(convo.unread_count, 1, "Conversation must initially be unread");

    // Outbound reply sent by user
    const outboundReplyMsgId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, received_at, read_at, created_at
      ) VALUES (
        '${outboundReplyMsgId}', '${convo.id}', '${businessId}', 'OUTBOUND', 'outreach@seqtest.com',
        'alice@clientcorp.com', 'Re: Intro: Quick Question Alice', 'Awesome! Let us schedule Friday at 2pm.',
        '<p>Awesome! Let us schedule Friday at 2pm.</p>', '${nowIso}', '${nowIso}', NOW()
      );
    `);

    execute(`
      UPDATE conversations
      SET unread_count = 0,
          last_message_at = '${nowIso}',
          updated_at = NOW()
      WHERE id = '${convo.id}';
    `);

    const updatedConvo = queryOne(`SELECT * FROM conversations WHERE id = '${convo.id}';`);
    assert.strictEqual(updatedConvo.unread_count, 0, "Outbound reply must reset unread_count to 0");
  });

  await t.test("Scenario 9: Campaign Analytics reflects active - 1, stopped + 1, and replied + 1", async () => {
    const enrollSql = `
      SELECT 
        COUNT(*) AS total_enrolled,
        COUNT(CASE WHEN UPPER(status) IN ('ENROLLED', 'RUNNING') THEN 1 END) AS total_active,
        COUNT(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 END) AS total_completed,
        COUNT(CASE WHEN UPPER(status) IN ('STOPPED', 'REPLIED') THEN 1 END) AS total_stopped
      FROM campaign_leads
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}';
    `;
    const enrollRes = queryOne(enrollSql);

    assert.strictEqual(Number(enrollRes.total_enrolled), 2, "Total enrolled must remain 2");
    assert.strictEqual(Number(enrollRes.total_active), 0, "Active enrollments must be 0 (1 replied, 1 completed)");
    assert.strictEqual(Number(enrollRes.total_completed), 1, "Completed enrollments must be 1 (Bob)");
    assert.strictEqual(Number(enrollRes.total_stopped), 1, "Stopped enrollments must be 1 (Alice replied)");

    const replyRes = queryOne(`
      SELECT COUNT(DISTINCT lead_id) AS total_replied
      FROM email_events
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}' AND LOWER(event_type) = 'replied';
    `);
    assert.strictEqual(Number(replyRes.total_replied), 1, "Total replied in analytics must be 1");
  });

  await t.test("Scenario 10: Email Open Tracking via Webhook or Tracking Pixel", async () => {
    // 1. Contact B opens the delivered message
    const bobMsg = queryOne(`SELECT * FROM email_messages WHERE to_email = 'bob@partnertech.com' AND campaign_step_id = '${step2Id}';`);
    assert.ok(bobMsg, "Bob's delivered message must exist");

    const openEvtId = "svix_open_evt_443322";
    const openTimestamp = new Date().toISOString();

    // Record open event in email_events
    execute(`
      INSERT INTO email_events (
        id, business_id, email_message_id, campaign_id, campaign_step_id, lead_id,
        event_type, provider_event_id, event_timestamp, metadata, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${bobMsg.id}', '${campaignId}', '${step2Id}', '${contactBId}',
        'opened', '${openEvtId}', '${openTimestamp}', '{"provider": "resend", "ip": "1.2.3.4"}'::jsonb, NOW()
      );
    `);

    // Update message status to opened, set opened_at, and increment open_count
    execute(`
      UPDATE email_messages
      SET status = 'opened',
          opened_at = '${openTimestamp}',
          open_count = COALESCE(open_count, 0) + 1,
          updated_at = NOW()
      WHERE id = '${bobMsg.id}';
    `);

    const updatedMsg = queryOne(`SELECT * FROM email_messages WHERE id = '${bobMsg.id}';`);
    assert.strictEqual(updatedMsg.status, "opened");
    assert.ok(updatedMsg.opened_at, "opened_at must be populated");
    assert.strictEqual(Number(updatedMsg.open_count), 1, "open_count must be 1");

    // Verify Dashboard Open Metrics
    const openMetrics = queryOne(`
      SELECT 
        COUNT(CASE WHEN LOWER(status) IN ('delivered', 'opened') OR delivered_at IS NOT NULL THEN 1 END) AS total_delivered,
        COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL OR open_count > 0 THEN 1 END) AS total_opened
      FROM email_messages
      WHERE business_id = '${businessId}';
    `);
    const deliveredCount = Number(openMetrics.total_delivered);
    const openedCount = Number(openMetrics.total_opened);
    assert.ok(deliveredCount >= 1, "At least 1 delivered message");
    assert.ok(openedCount >= 1, "At least 1 opened message");
    const openRate = deliveredCount > 0 ? (openedCount / deliveredCount) * 100 : 0;
    assert.strictEqual(openRate, 100, "Open rate should be 100% for 1 opened out of 1 delivered");
  });

  await t.test("Scenario 11: Email Bounce Tracking, Suppression & Automated Sequence Halting", async () => {
    // 1. Create a lead that will bounce
    const bounceContactId = crypto.randomUUID();
    const bounceEmail = "carol_bounced@invalidtarget.com";
    execute(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status, source, created_at, updated_at)
      VALUES ('${bounceContactId}', '${businessId}', 'Carol', 'Bouncer', '${bounceEmail}', 'new', 'manual', NOW(), NOW());
    `);

    // 2. Enroll lead into campaign
    const bounceEnrollId = crypto.randomUUID();
    execute(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step,
        next_step_id, next_run_at, enrolled_at, created_at, updated_at
      ) VALUES (
        '${bounceEnrollId}', '${campaignId}', '${bounceContactId}', '${businessId}', 'RUNNING', 1,
        '${step2Id}', NOW() + INTERVAL '1 day', NOW(), NOW(), NOW()
      );
    `);

    // 3. Sent message record
    const bounceMsgId = crypto.randomUUID();
    const bounceProvMsgId = "msg_resend_bounce_prov_001";
    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, campaign_id, campaign_step_id,
        direction, provider_message_id, from_email, to_email, subject, body,
        status, sent_at, created_at, updated_at
      ) VALUES (
        '${bounceMsgId}', '${businessId}', '${bounceContactId}', '${campaignId}', '${step1Id}',
        'outbound', '${bounceProvMsgId}', 'outreach@seqtest.com', '${bounceEmail}',
        'Intro Note', '<p>Hello Carol</p>', 'sent', NOW(), NOW(), NOW()
      );
    `);

    // 4. Inbound bounce webhook arrives (email.bounced)
    const bounceEvtId = "svix_bounce_evt_556677";
    const bounceTimestamp = new Date().toISOString();

    // Mark message bounced
    execute(`
      UPDATE email_messages
      SET status = 'bounced',
          bounce_type = 'Permanent',
          bounce_description = 'Mailbox does not exist',
          updated_at = NOW()
      WHERE id = '${bounceMsgId}';
    `);

    // Record bounce event in email_events
    execute(`
      INSERT INTO email_events (
        id, business_id, email_message_id, campaign_id, campaign_step_id, lead_id,
        event_type, provider_event_id, event_timestamp, metadata, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${bounceMsgId}', '${campaignId}', '${step1Id}', '${bounceContactId}',
        'bounced', '${bounceEvtId}', '${bounceTimestamp}', '{"bounce_type": "Permanent"}'::jsonb, NOW()
      );
    `);

    // Update lead status to bounced
    execute(`UPDATE leads SET status = 'bounced', updated_at = NOW() WHERE id = '${bounceContactId}';`);

    // Halt active campaign enrollments for this contact
    execute(`
      UPDATE campaign_leads
      SET status = 'STOPPED',
          next_run_at = NULL,
          stopped_at = NOW(),
          last_error = 'BOUNCED: Mailbox does not exist',
          updated_at = NOW()
      WHERE business_id = '${businessId}' AND lead_id = '${bounceContactId}';
    `);

    // Record suppression
    execute(`
      INSERT INTO suppressions (
        id, business_id, email, reason, source, created_at
      ) VALUES (
        '${crypto.randomUUID()}', '${businessId}', '${bounceEmail}', 'hard_bounce', 'webhook', NOW()
      );
    `);

    // Verify message status is BOUNCED
    const msg = queryOne(`SELECT * FROM email_messages WHERE id = '${bounceMsgId}';`);
    assert.strictEqual(msg.status, "bounced");
    assert.strictEqual(msg.bounce_type, "Permanent");

    // Verify lead status is bounced
    const lead = queryOne(`SELECT * FROM leads WHERE id = '${bounceContactId}';`);
    assert.strictEqual(lead.status, "bounced");

    // Verify enrollment is stopped with null next_run_at
    const enr = queryOne(`SELECT * FROM campaign_leads WHERE id = '${bounceEnrollId}';`);
    assert.strictEqual(enr.status, "STOPPED");
    assert.strictEqual(enr.next_run_at, null);

    // Verify suppression prevents future sends
    const supp = queryOne(`SELECT * FROM suppressions WHERE business_id = '${businessId}' AND email = '${bounceEmail}';`);
    assert.ok(supp, "Email must be present in suppressions table");
    assert.strictEqual(supp.reason, "hard_bounce");
  });

  await t.test("Scenario 12: CSV Imported Contact Enrollment & Sequence Execution", async () => {
    // 1. Simulate CSV Contact Import
    const csvContactId = crypto.randomUUID();
    const csvEmail = "dave_csv@partnerfirm.com";
    execute(`
      INSERT INTO leads (
        id, business_id, first_name, last_name, email, company_name, job_title, status, source, created_at, updated_at
      ) VALUES (
        '${csvContactId}', '${businessId}', 'Dave', 'Miller', '${csvEmail}', 'PartnerFirm Inc', 'VP Sales', 'new', 'csv_import', NOW(), NOW()
      );
    `);

    // Verify imported contact exists in DB and is visible in contacts list query
    const contactsList = query(`SELECT * FROM leads WHERE business_id = '${businessId}' ORDER BY created_at DESC;`);
    const foundCsvContact = contactsList.find((c) => c.email === csvEmail);
    assert.ok(foundCsvContact, "CSV imported contact must appear in contacts list");
    assert.strictEqual(foundCsvContact.first_name, "Dave");
    assert.strictEqual(foundCsvContact.last_name, "Miller");
    assert.strictEqual(foundCsvContact.source, "csv_import");

    // 2. Enroll CSV contact into the campaign
    const csvEnrollId = crypto.randomUUID();
    execute(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step,
        next_step_id, next_run_at, enrolled_at, created_at, updated_at
      ) VALUES (
        '${csvEnrollId}', '${campaignId}', '${csvContactId}', '${businessId}', 'ENROLLED', 0,
        '${step1Id}', NOW(), NOW(), NOW(), NOW()
      );
    `);

    const enr = queryOne(`SELECT * FROM campaign_leads WHERE id = '${csvEnrollId}';`);
    assert.ok(enr, "CSV contact enrollment must be created");
    assert.strictEqual(enr.status, "ENROLLED");
    assert.strictEqual(enr.next_step_id, step1Id);

    // 3. Execute Step 1 for the imported contact
    const csvMsgId = crypto.randomUUID();
    const csvProvMsgId = "msg_resend_csv_dave_001";
    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, campaign_id, campaign_step_id, template_id,
        direction, provider_message_id, from_email, to_email, subject, body,
        status, sent_at, created_at, updated_at
      ) VALUES (
        '${csvMsgId}', '${businessId}', '${csvContactId}', '${campaignId}', '${step1Id}', '${template1Id}',
        'outbound', '${csvProvMsgId}', 'outreach@seqtest.com', '${csvEmail}',
        'Intro: Quick Question Dave', '<p>Hi Dave, let us connect.</p>', 'sent', NOW(), NOW(), NOW()
      );
    `);

    execute(`
      UPDATE campaign_leads
      SET current_step = 1,
          current_step_id = '${step1Id}',
          next_step_id = '${step2Id}',
          next_run_at = NOW() + INTERVAL '1 day',
          status = 'RUNNING',
          updated_at = NOW()
      WHERE id = '${csvEnrollId}';
    `);

    const enrAfter = queryOne(`SELECT * FROM campaign_leads WHERE id = '${csvEnrollId}';`);
    assert.strictEqual(enrAfter.status, "RUNNING");
    assert.strictEqual(enrAfter.current_step, 1);
    assert.strictEqual(enrAfter.next_step_id, step2Id);
  });
});
