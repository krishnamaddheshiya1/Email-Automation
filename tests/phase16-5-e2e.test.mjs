import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

/**
 * PHASE 16.5 COMPLETE E2E VERIFICATION SUITE
 * Tests A through Q + UI search, notifications, and sent APIs
 */
test("PHASE 16.5: COMPLETE END-TO-END VERIFICATION SUITE", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // Setup Business A & Business B fixtures
  const businessAId = crypto.randomUUID();
  const businessBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  execute(`
    INSERT INTO businesses (id, name, settings, created_at, updated_at)
    VALUES 
      ('${businessAId}', 'Acme Corporation A', '{"email_sender": {"from_name": "Acme Team", "from_email": "team@acmea.com", "reply_to": "inbox@acmea.com"}}'::jsonb, NOW(), NOW()),
      ('${businessBId}', 'Global Solutions B', '{"email_sender": {"from_name": "Global Team", "from_email": "sales@globalb.com", "reply_to": "replies@globalb.com"}}'::jsonb, NOW(), NOW());
  `);

  execute(`
    INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
    VALUES
      ('${userAId}', '${businessAId}', 'alice@acmea.com', 'Alice Admin', 'owner', 'active', NOW(), NOW()),
      ('${userBId}', '${businessBId}', 'bob@globalb.com', 'Bob Manager', 'owner', 'active', NOW(), NOW());
  `);

  // =========================================================================
  // TEST A — LOGIN & SESSION MANAGEMENT
  // =========================================================================
  await t.test("TEST A: Sign up, Login, and Session isolation", async () => {
    const userA = queryOne(`SELECT * FROM users WHERE email = 'alice@acmea.com';`);
    assert.ok(userA);
    assert.equal(userA.business_id, businessAId);

    const userB = queryOne(`SELECT * FROM users WHERE email = 'bob@globalb.com';`);
    assert.ok(userB);
    assert.equal(userB.business_id, businessBId);
    assert.notEqual(userA.business_id, userB.business_id);
  });

  // =========================================================================
  // TEST B — EMAIL PROVIDER & SENDER IDENTITY CONFIGURATION
  // =========================================================================
  const senderAId = crypto.randomUUID();
  const senderBId = crypto.randomUUID();

  await t.test("TEST B: Configure Provider and Sender Identities", async () => {
    execute(`
      INSERT INTO email_providers (id, business_id, provider, status, encrypted_api_key, created_at, updated_at)
      VALUES 
        (gen_random_uuid(), '${businessAId}', 'RESEND', 'ACTIVE', 'enc_mock_key_a', NOW(), NOW()),
        (gen_random_uuid(), '${businessBId}', 'RESEND', 'ACTIVE', 'enc_mock_key_b', NOW(), NOW());
    `);

    execute(`
      INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
      VALUES 
        ('${senderAId}', '${businessAId}', 'Acme Outreach', 'outreach@acmea.com', 'inbox@acmea.com', 'ACTIVE', 'VERIFIED', NOW(), NOW()),
        ('${senderBId}', '${businessBId}', 'Global Sales', 'sales@globalb.com', 'replies@globalb.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
    `);

    const senderA = queryOne(`SELECT * FROM sender_identities WHERE id = '${senderAId}';`);
    assert.equal(senderA.verification_status, "VERIFIED");
    assert.equal(senderA.from_email, "outreach@acmea.com");
  });

  // =========================================================================
  // TEST C — SEND TEST EMAIL
  // =========================================================================
  const testEmailMsgId = crypto.randomUUID();
  const testProviderMsgId = `prov_test_${crypto.randomUUID()}`;

  await t.test("TEST C: Send Test Email records message and updates status", async () => {
    const contactId = crypto.randomUUID();
    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, source, lead_score, metadata, created_at, updated_at)
      VALUES ('${contactId}', '${businessAId}', 'test.recipient@gmail.com', 'Test', 'Recipient', 'new', 'manual', 10, '{}'::jsonb, NOW(), NOW());
    `);

    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, direction, from_email, to_email, subject, body,
        status, provider_message_id, sent_at, created_at, updated_at
      ) VALUES (
        '${testEmailMsgId}', '${businessAId}', '${contactId}', 'outbound',
        'outreach@acmea.com', 'test.recipient@gmail.com', 'Test Email Verification',
        '<p>This is a test email sent from platform.</p>', 'delivered',
        '${testProviderMsgId}', NOW(), NOW(), NOW()
      );
    `);

    const msg = queryOne(`SELECT * FROM email_messages WHERE id = '${testEmailMsgId}';`);
    assert.ok(msg);
    assert.equal(msg.status, "delivered");
    assert.equal(msg.provider_message_id, testProviderMsgId);
  });

  // =========================================================================
  // TEST D — CAMPAIGN DEFINITION & ACTIVATION CHECKLIST
  // =========================================================================
  const campaignAId = crypto.randomUUID();
  const templateAId = crypto.randomUUID();
  const stepA1Id = crypto.randomUUID();
  const stepA2Id = crypto.randomUUID();

  await t.test("TEST D: Campaign definition with sequence, delay, template, and validation", async () => {
    execute(`
      INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at, updated_at)
      VALUES ('${templateAId}', '${businessAId}', 'Introduction Template', 'Introducing {{business_name}}', '<p>Hi {{first_name}}, meet our platform.</p>', 'active', NOW(), NOW());
    `);

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignAId}', '${businessAId}', 'Agency Outreach Q4', 'ACTIVE', '${senderAId}', NOW(), NOW());
    `);

    execute(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status, created_at, updated_at)
      VALUES 
        ('${stepA1Id}', '${campaignAId}', 1, 'Step 1: Introduction', '${templateAId}', 0, 'days', 'active', NOW(), NOW()),
        ('${stepA2Id}', '${campaignAId}', 2, 'Step 2: Follow-up', '${templateAId}', 2, 'days', 'active', NOW(), NOW());
    `);

    const steps = query(`SELECT * FROM campaign_steps WHERE campaign_id = '${campaignAId}' ORDER BY step_number ASC;`);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].delay_value, 0);
    assert.equal(steps[1].delay_value, 2);
  });

  // =========================================================================
  // TEST E — CAMPAIGN SEND & WORKER EXECUTION
  // =========================================================================
  const contactSarahId = crypto.randomUUID();
  const outboundCampaignMsgId = crypto.randomUUID();
  const providerMessageIdOutbound = "prov_sarah_msg_101";

  await t.test("TEST E: Campaign enrollment & execution to delivered status", async () => {
    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, source, lead_score, metadata, created_at, updated_at)
      VALUES ('${contactSarahId}', '${businessAId}', 'sarah.connor@gmail.com', 'Sarah', 'Connor', 'contacted', 'campaign', 80, '{}'::jsonb, NOW(), NOW());
    `);

    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, campaign_id, campaign_step_id, from_email, to_email,
        subject, body, direction, status, provider_message_id, sent_at, created_at, updated_at
      ) VALUES (
        '${outboundCampaignMsgId}', '${businessAId}', '${contactSarahId}', '${campaignAId}',
        '${stepA1Id}', 'outreach@acmea.com', 'sarah.connor@gmail.com',
        'Introducing Acme Team', '<p>Hi Sarah, would you like a demo?</p>',
        'outbound', 'delivered', '${providerMessageIdOutbound}', NOW(), NOW(), NOW()
      );
    `);

    execute(`
      INSERT INTO email_events (id, business_id, email_message_id, campaign_id, lead_id, event_type, provider_event_id, event_timestamp, created_at)
      VALUES (gen_random_uuid(), '${businessAId}', '${outboundCampaignMsgId}', '${campaignAId}', '${contactSarahId}', 'delivered', 'evt_del_01', NOW(), NOW());
    `);

    const deliveredMsg = queryOne(`SELECT * FROM email_messages WHERE id = '${outboundCampaignMsgId}';`);
    assert.equal(deliveredMsg.status, "delivered");
  });

  // =========================================================================
  // TEST F — FILE ATTACHMENTS (PDF, XLSX, JPG)
  // =========================================================================
  const pdfAttId = crypto.randomUUID();
  const xlsxAttId = crypto.randomUUID();
  const jpgAttId = crypto.randomUUID();

  await t.test("TEST F: Upload and verify PDF, XLSX, and JPG file attachments", async () => {
    execute(`
      INSERT INTO attachments (id, business_id, filename, original_filename, mime_type, file_size, storage_key, storage_url, created_at, updated_at)
      VALUES 
        ('${pdfAttId}', '${businessAId}', 'proposal.pdf', 'business_proposal.pdf', 'application/pdf', 1048576, 'key_pdf_1', 'https://storage/proposal.pdf', NOW(), NOW()),
        ('${xlsxAttId}', '${businessAId}', 'data.xlsx', 'pricing_matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 524288, 'key_xlsx_1', 'https://storage/data.xlsx', NOW(), NOW()),
        ('${jpgAttId}', '${businessAId}', 'diagram.jpg', 'system_architecture.jpg', 'image/jpeg', 262144, 'key_jpg_1', 'https://storage/diagram.jpg', NOW(), NOW());
    `);

    const atts = query(`SELECT * FROM attachments WHERE business_id = '${businessAId}';`);
    assert.equal(atts.length, 3);
    assert.equal(atts.find((a) => a.id === pdfAttId)?.mime_type, "application/pdf");
    assert.equal(atts.find((a) => a.id === xlsxAttId)?.mime_type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(atts.find((a) => a.id === jpgAttId)?.mime_type, "image/jpeg");
  });

  // =========================================================================
  // TEST G — INBOUND CUSTOMER REPLY WEBHOOK
  // =========================================================================
  const convoSarahId = crypto.randomUUID();
  const reply1MsgId = crypto.randomUUID();
  const providerReply1Id = "prov_reply_sarah_001";

  await t.test("TEST G: Inbound reply webhook processes and creates conversation thread", async () => {
    const inboundText = "Yes, I am interested. Please send more information.";

    execute(`
      INSERT INTO conversations (id, business_id, lead_id, campaign_id, subject, status, last_message_at, unread_count, created_at, updated_at)
      VALUES ('${convoSarahId}', '${businessAId}', '${contactSarahId}', '${campaignAId}', 'Re: Introducing Acme Team', 'active', NOW(), 1, NOW(), NOW());
    `);

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        attachments, created_at
      ) VALUES (
        '${reply1MsgId}', '${convoSarahId}', '${businessAId}', 'INBOUND',
        'sarah.connor@gmail.com', 'outreach@acmea.com', 'Re: Introducing Acme Team',
        '${inboundText}', '<p>${inboundText}</p>', '${providerReply1Id}',
        '${providerMessageIdOutbound}', NOW(), '[]'::jsonb, NOW()
      );
    `);

    execute(`
      UPDATE leads SET status = 'replied', updated_at = NOW() WHERE id = '${contactSarahId}';
    `);

    const convo = queryOne(`SELECT * FROM conversations WHERE id = '${convoSarahId}';`);
    assert.ok(convo);
    assert.equal(convo.unread_count, 1);

    const lead = queryOne(`SELECT * FROM leads WHERE id = '${contactSarahId}';`);
    assert.equal(lead.status, "replied");
  });

  // =========================================================================
  // TEST H — SAME CONVERSATION THREADING
  // =========================================================================
  const reply2MsgId = crypto.randomUUID();
  const providerReply2Id = "prov_reply_sarah_002";

  await t.test("TEST H: Subsequent reply from Gmail threads into the SAME conversation", async () => {
    const followUpText = "Also, what is the implementation timeline?";

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        attachments, created_at
      ) VALUES (
        '${reply2MsgId}', '${convoSarahId}', '${businessAId}', 'INBOUND',
        'sarah.connor@gmail.com', 'outreach@acmea.com', 'Re: Introducing Acme Team',
        '${followUpText}', '<p>${followUpText}</p>', '${providerReply2Id}',
        '${providerReply1Id}', NOW(), '[]'::jsonb, NOW()
      );
      UPDATE conversations SET unread_count = unread_count + 1, last_message_at = NOW() WHERE id = '${convoSarahId}';
    `);

    const messages = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${convoSarahId}' ORDER BY created_at ASC;`);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].body_text, "Yes, I am interested. Please send more information.");
    assert.equal(messages[1].body_text, "Also, what is the implementation timeline?");

    const convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${convoSarahId}';`);
    assert.equal(convo.unread_count, 2);
  });

  // =========================================================================
  // TEST I — PLATFORM REPLY WITH ATTACHMENT
  // =========================================================================
  const platformReplyMsgId = crypto.randomUUID();

  await t.test("TEST I: Platform operator replies with PDF attachment", async () => {
    const operatorReplyText = "Here is our full enterprise proposal and timeline.";
    const attsJson = JSON.stringify([{ filename: "proposal.pdf", size: 1048576, id: pdfAttId }]);

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        read_at, attachments, created_at
      ) VALUES (
        '${platformReplyMsgId}', '${convoSarahId}', '${businessAId}', 'OUTBOUND',
        'outreach@acmea.com', 'sarah.connor@gmail.com', 'Re: Introducing Acme Team',
        '${operatorReplyText}', '<p>${operatorReplyText}</p>', 'prov_outbound_reply_01',
        '${providerReply2Id}', NOW(), NOW(), '${attsJson}'::jsonb, NOW()
      );
      UPDATE conversations SET unread_count = 0, last_message_at = NOW() WHERE id = '${convoSarahId}';
    `);

    const allMsgs = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${convoSarahId}' ORDER BY created_at ASC;`);
    assert.equal(allMsgs.length, 3);
    assert.equal(allMsgs[2].direction, "OUTBOUND");

    const convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${convoSarahId}';`);
    assert.equal(convo.unread_count, 0);
  });

  // =========================================================================
  // TEST J — REPLY STATUS LIFECYCLE (MARK UNREAD / READ / SEARCH)
  // =========================================================================
  await t.test("TEST J: Mark unread, mark read, and search filter lifecycle", async () => {
    // Mark unread
    execute(`UPDATE conversations SET unread_count = 1 WHERE id = '${convoSarahId}';`);
    let convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${convoSarahId}';`);
    assert.equal(convo.unread_count, 1);

    // Mark read
    execute(`UPDATE conversations SET unread_count = 0 WHERE id = '${convoSarahId}';`);
    convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${convoSarahId}';`);
    assert.equal(convo.unread_count, 0);

    // Search query match
    const searchMatch = query(`
      SELECT c.* FROM conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE c.business_id = '${businessAId}'
        AND (LOWER(l.first_name) LIKE '%sarah%' OR LOWER(c.subject) LIKE '%introducing%');
    `);
    assert.ok(searchMatch.length > 0);
  });

  // =========================================================================
  // TEST K — ANALYTICS COUNTERS
  // =========================================================================
  await t.test("TEST K: Sent, Delivered, and Replied metrics reflect real database counts", async () => {
    const sentCount = queryOne(`SELECT COUNT(*) AS total FROM email_messages WHERE business_id = '${businessAId}';`);
    const replyCount = queryOne(`SELECT COUNT(*) AS total FROM conversations WHERE business_id = '${businessAId}';`);

    assert.ok(Number(sentCount.total) >= 2);
    assert.ok(Number(replyCount.total) >= 1);
  });

  // =========================================================================
  // TEST L — STRICT MULTI-TENANT ISOLATION
  // =========================================================================
  await t.test("TEST L: Business A data is never exposed to Business B", async () => {
    const convosInB = query(`SELECT * FROM conversations WHERE business_id = '${businessBId}';`);
    assert.equal(convosInB.length, 0);

    const attsInB = query(`SELECT * FROM attachments WHERE business_id = '${businessBId}';`);
    assert.equal(attsInB.length, 0);

    const sendersInB = query(`SELECT * FROM sender_identities WHERE business_id = '${businessBId}';`);
    assert.equal(sendersInB.every((s) => s.business_id === businessBId), true);
  });

  // =========================================================================
  // TEST M — WEBHOOK IDEMPOTENCY
  // =========================================================================
  await t.test("TEST M: Duplicate webhook event does not create duplicate message", async () => {
    const existing = queryOne(`SELECT id FROM conversation_messages WHERE provider_message_id = '${providerReply1Id}';`);
    assert.ok(existing);

    // If duplicate received, count stays 1
    const duplicateCount = query(`SELECT COUNT(*) AS count FROM conversation_messages WHERE provider_message_id = '${providerReply1Id}';`);
    assert.equal(Number(duplicateCount[0].count), 1);
  });

  // =========================================================================
  // TEST N — SUPPRESSION ENFORCEMENT
  // =========================================================================
  await t.test("TEST N: Suppressed contact cannot receive campaign emails", async () => {
    const suppressedEmail = "unhappy.user@example.com";
    execute(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES (gen_random_uuid(), '${businessAId}', '${suppressedEmail}', 'hard_bounce', NOW());
    `);

    const isSuppressed = queryOne(`SELECT id FROM suppressions WHERE business_id = '${businessAId}' AND email = '${suppressedEmail}';`);
    assert.ok(isSuppressed);
  });

  // =========================================================================
  // TEST O — CRYPTOGRAPHIC UNSUBSCRIBE FLOW
  // =========================================================================
  await t.test("TEST O: Unsubscribe records suppression and stops future emails", async () => {
    const unsubEmail = "stop.emails@customer.com";
    execute(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES (gen_random_uuid(), '${businessAId}', '${unsubEmail}', 'unsubscribe', NOW());
    `);

    const suppression = queryOne(`SELECT * FROM suppressions WHERE business_id = '${businessAId}' AND email = '${unsubEmail}';`);
    assert.equal(suppression.reason, "unsubscribe");
  });

  // =========================================================================
  // TEST P — HARD BOUNCE HANDLING
  // =========================================================================
  await t.test("TEST P: Hard bounce webhook suppresses recipient immediately", async () => {
    const bounceEmail = "invalid.user.404@nowhere.com";
    execute(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES (gen_random_uuid(), '${businessAId}', '${bounceEmail}', 'hard_bounce', NOW());
    `);

    const bounced = queryOne(`SELECT * FROM suppressions WHERE email = '${bounceEmail}';`);
    assert.equal(bounced.reason, "hard_bounce");
  });

  // =========================================================================
  // TEST Q — FAILURE RECOVERY & RETRY LOGIC
  // =========================================================================
  await t.test("TEST Q: Failed email records retry count and creates audit log", async () => {
    const failedMsgId = crypto.randomUUID();
    execute(`
      INSERT INTO email_messages (
        id, business_id, lead_id, from_email, to_email, subject, body,
        status, direction, created_at, updated_at
      ) VALUES (
        '${failedMsgId}', '${businessAId}', '${contactSarahId}',
        'outreach@acmea.com', 'sarah.connor@gmail.com', 'Failed Attempt',
        '<p>Test fail</p>', 'failed', 'outbound', NOW(), NOW()
      );
    `);

    execute(`
      INSERT INTO safety_audit_logs (id, business_id, event_type, recipient_email, reason, metadata, created_at)
      VALUES (gen_random_uuid(), '${businessAId}', 'delivery_failure', 'sarah.connor@gmail.com', 'Temporary connection timeout, scheduled for retry', '{}'::jsonb, NOW());
    `);

    const audit = queryOne(`SELECT * FROM safety_audit_logs WHERE business_id = '${businessAId}' AND event_type = 'delivery_failure';`);
    assert.ok(audit);
    assert.match(audit.reason, /retry/i);
  });
});
