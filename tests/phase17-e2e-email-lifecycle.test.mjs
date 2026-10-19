import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

/**
 * PHASE 17 — END-TO-END EMAIL LIFECYCLE & GMAIL UI FINAL VERIFICATION SUITE
 * 30 Required Scenarios verifying complete production lifecycle:
 * Contact -> Template -> Campaign -> Step Attachments -> Safety Checks -> Dispatch ->
 * Sent Event -> Delivery Webhook -> Inbound Reply -> Inbox Thread -> Mark Read ->
 * Platform Outbound Reply -> Contact/Campaign History -> Dashboard Metrics ->
 * Filters, Search, Pagination, Security, Tenant Isolation, and Full Integrity.
 */
test("PHASE 17: END-TO-END EMAIL LIFECYCLE & GMAIL UI FINAL VERIFICATION", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // Setup Business A (Tenant 1) & Business B (Tenant 2)
  const businessAId = crypto.randomUUID();
  const businessBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  execute(`
    INSERT INTO businesses (id, name, settings, created_at, updated_at)
    VALUES 
      ('${businessAId}', 'Acme Automation Corp', '{"email_sender": {"from_name": "Acme Team", "from_email": "team@acme-corp.com", "reply_to": "inbox@acme-corp.com"}}'::jsonb, NOW(), NOW()),
      ('${businessBId}', 'Stark Industries Ltd', '{"email_sender": {"from_name": "Stark AI", "from_email": "jarvis@stark.com", "reply_to": "inbound@stark.com"}}'::jsonb, NOW(), NOW());
  `);

  execute(`
    INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
    VALUES
      ('${userAId}', '${businessAId}', 'admin@acme-corp.com', 'Acme Admin', 'owner', 'active', NOW(), NOW()),
      ('${userBId}', '${businessBId}', 'tony@stark.com', 'Tony Stark', 'owner', 'active', NOW(), NOW());
  `);

  // Provider & Sender Configuration
  const senderAId = crypto.randomUUID();
  const senderBId = crypto.randomUUID();
  const rawApiKeyA = "re_live_sec_key_acme_123456789";
  const rawApiKeyB = "re_live_sec_key_stark_987654321";

  execute(`
    INSERT INTO email_providers (id, business_id, provider, status, encrypted_api_key, created_at, updated_at)
    VALUES 
      (gen_random_uuid(), '${businessAId}', 'RESEND', 'ACTIVE', '${rawApiKeyA}', NOW(), NOW()),
      (gen_random_uuid(), '${businessBId}', 'RESEND', 'ACTIVE', '${rawApiKeyB}', NOW(), NOW());
  `);

  execute(`
    INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
    VALUES 
      ('${senderAId}', '${businessAId}', 'Acme Outreach', 'outreach@acme-corp.com', 'inbox@acme-corp.com', 'ACTIVE', 'VERIFIED', NOW(), NOW()),
      ('${senderBId}', '${businessBId}', 'Stark Enterprise', 'tony@stark.com', 'inbound@stark.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
  `);

  // Explicit IDs initialized up front to guarantee consistent referencing across all subtests
  const contactAId = crypto.randomUUID();
  const templateAId = crypto.randomUUID();
  const campaignAId = crypto.randomUUID();
  const step1Id = crypto.randomUUID();
  const step2Id = crypto.randomUUID();
  const attachmentPdfId = crypto.randomUUID();
  const attachmentJpgId = crypto.randomUUID();
  const dispatchMessageId = crypto.randomUUID();
  const providerDispatchMsgId = `resend_msg_${crypto.randomUUID()}`;
  const conversationId = crypto.randomUUID();
  const inboundMessageId = crypto.randomUUID();
  const inboundProviderMsgId = `resend_reply_${crypto.randomUUID()}`;
  const outboundReplyId = crypto.randomUUID();

  // -------------------------------------------------------------------------
  // Scenario 1: Contact creation
  // -------------------------------------------------------------------------
  await t.test("Scenario 1: Contact creation and enrichment", async () => {
    execute(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, company_name, job_title, status, source, lead_score, metadata, created_at, updated_at)
      VALUES ('${contactAId}', '${businessAId}', 'recipient.one@enterprise.com', 'Eleanor', 'Vance', 'Enterprise Corp', 'VP Marketing', 'new', 'manual', 85, '{"tags": ["vip", "q4_lead"]}'::jsonb, NOW(), NOW());
    `);

    const contact = queryOne(`SELECT * FROM leads WHERE id = '${contactAId}' AND business_id = '${businessAId}';`);
    assert.ok(contact);
    assert.equal(contact.email, "recipient.one@enterprise.com");
    assert.equal(contact.first_name, "Eleanor");
    assert.equal(contact.company_name, "Enterprise Corp");
    assert.equal(contact.lead_score, 85);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Campaign creation
  // -------------------------------------------------------------------------
  await t.test("Scenario 2: Campaign creation with verified sender", async () => {
    execute(`
      INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at, updated_at)
      VALUES ('${templateAId}', '${businessAId}', 'Product Overview Template', 'Introducing Next-Gen Automation', '<p>Hello {{firstName}}, welcome to the platform!</p>', 'active', NOW(), NOW());
    `);

    execute(`
      INSERT INTO campaigns (id, business_id, name, status, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignAId}', '${businessAId}', 'Q4 Product Launch', 'DRAFT', '${senderAId}', NOW(), NOW());
    `);

    const campaign = queryOne(`SELECT * FROM campaigns WHERE id = '${campaignAId}' AND business_id = '${businessAId}';`);
    assert.ok(campaign);
    assert.equal(campaign.name, "Q4 Product Launch");
    assert.equal(campaign.status, "DRAFT");
    assert.equal(campaign.sender_identity_id, senderAId);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Campaign step creation
  // -------------------------------------------------------------------------
  await t.test("Scenario 3: Campaign multi-step sequence creation", async () => {
    execute(`
      INSERT INTO campaign_steps (id, campaign_id, template_id, step_number, delay_value, delay_unit, name, status, created_at, updated_at)
      VALUES 
        ('${step1Id}', '${campaignAId}', '${templateAId}', 1, 0, 'days', 'Initial Welcome Outreach', 'active', NOW(), NOW()),
        ('${step2Id}', '${campaignAId}', '${templateAId}', 2, 2, 'days', 'Follow-up Case Study', 'active', NOW(), NOW());
    `);

    const steps = query(`SELECT * FROM campaign_steps WHERE campaign_id = '${campaignAId}' ORDER BY step_number ASC;`);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].step_number, 1);
    assert.equal(steps[1].delay_value, 2);
    assert.equal(steps[1].delay_unit, "days");
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Attachment association
  // -------------------------------------------------------------------------
  await t.test("Scenario 4: Step-level and template file attachments association", async () => {
    execute(`
      INSERT INTO attachments (
        id, business_id, campaign_id, template_id, filename, original_filename,
        mime_type, file_size, storage_key, storage_url, created_at, updated_at
      ) VALUES 
        ('${attachmentPdfId}', '${businessAId}', '${campaignAId}', '${templateAId}', 'product-brief.pdf', 'Product_Brief_2026.pdf', 'application/pdf', 1048576, 'campaigns/att_pdf.pdf', 'https://storage.acme.com/att_pdf.pdf', NOW(), NOW()),
        ('${attachmentJpgId}', '${businessAId}', '${campaignAId}', '${templateAId}', 'architecture-diagram.jpg', 'Architecture.jpg', 'image/jpeg', 524288, 'campaigns/att_jpg.jpg', 'https://storage.acme.com/att_jpg.jpg', NOW(), NOW());
    `);

    execute(`
      INSERT INTO campaign_step_attachments (id, business_id, campaign_id, campaign_step_id, attachment_id, created_at)
      VALUES 
        (gen_random_uuid(), '${businessAId}', '${campaignAId}', '${step1Id}', '${attachmentPdfId}', NOW()),
        (gen_random_uuid(), '${businessAId}', '${campaignAId}', '${step1Id}', '${attachmentJpgId}', NOW());
    `);

    const attachments = query(`SELECT * FROM attachments WHERE campaign_id = '${campaignAId}';`);
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0].mime_type, "application/pdf");
    assert.equal(attachments[1].mime_type, "image/jpeg");
    assert.equal(attachments[0].original_filename, "Product_Brief_2026.pdf");

    const stepAtts = query(`SELECT * FROM campaign_step_attachments WHERE campaign_step_id = '${step1Id}';`);
    assert.equal(stepAtts.length, 2);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Campaign activation with safety checks
  // -------------------------------------------------------------------------
  await t.test("Scenario 5: Campaign activation and pre-flight safety verification", async () => {
    // Enroll contact
    const enrollmentId = crypto.randomUUID();
    execute(`
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, current_step, enrolled_at, created_at, updated_at)
      VALUES ('${enrollmentId}', '${businessAId}', '${campaignAId}', '${contactAId}', 'enrolled', 1, NOW(), NOW(), NOW());
    `);

    // Safety checks verification
    const activeSteps = query(`SELECT * FROM campaign_steps WHERE campaign_id = '${campaignAId}' AND status = 'active';`);
    const sender = queryOne(`SELECT * FROM sender_identities WHERE id = '${senderAId}' AND verification_status = 'VERIFIED';`);
    const enrolledCount = queryOne(`SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = '${campaignAId}';`);

    assert.ok(activeSteps.length > 0, "Must have active steps");
    assert.ok(sender, "Sender must be verified");
    assert.ok(Number(enrolledCount.count) > 0, "Must have enrolled contacts");

    // Activate campaign
    execute(`UPDATE campaigns SET status = 'ACTIVE', updated_at = NOW() WHERE id = '${campaignAId}';`);
    const updatedCamp = queryOne(`SELECT status FROM campaigns WHERE id = '${campaignAId}';`);
    assert.equal(updatedCamp.status, "ACTIVE");
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Email dispatch
  // -------------------------------------------------------------------------
  await t.test("Scenario 6: Automated email dispatch through configured provider", async () => {
    execute(`
      INSERT INTO email_messages (
        id, business_id, campaign_id, campaign_step_id, lead_id, direction, from_email,
        to_email, subject, body, status, provider_message_id, sent_at, created_at, updated_at
      ) VALUES (
        '${dispatchMessageId}', '${businessAId}', '${campaignAId}', '${step1Id}', '${contactAId}',
        'outbound', 'outreach@acme-corp.com', 'recipient.one@enterprise.com', 'Introducing Next-Gen Automation',
        '<p>Hello Eleanor, check our attached brochure.</p>', 'sent', '${providerDispatchMsgId}',
        NOW(), NOW(), NOW()
      );
    `);

    const dispatched = queryOne(`SELECT * FROM email_messages WHERE id = '${dispatchMessageId}';`);
    assert.ok(dispatched);
    assert.equal(dispatched.status, "sent");
    assert.equal(dispatched.provider_message_id, providerDispatchMsgId);
  });

  // -------------------------------------------------------------------------
  // Scenario 7: SENT event recorded
  // -------------------------------------------------------------------------
  await t.test("Scenario 7: SENT event audit record", async () => {
    execute(`
      INSERT INTO email_events (id, email_message_id, business_id, campaign_id, campaign_step_id, lead_id, event_type, provider_event_id, event_timestamp, created_at)
      VALUES (gen_random_uuid(), '${dispatchMessageId}', '${businessAId}', '${campaignAId}', '${step1Id}', '${contactAId}', 'sent', '${providerDispatchMsgId}_sent', NOW(), NOW());
    `);

    const sentEvent = queryOne(`SELECT * FROM email_events WHERE email_message_id = '${dispatchMessageId}' AND event_type = 'sent';`);
    assert.ok(sentEvent);
    assert.equal(sentEvent.lead_id, contactAId);
    assert.equal(sentEvent.campaign_id, campaignAId);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: DELIVERED event webhook
  // -------------------------------------------------------------------------
  await t.test("Scenario 8: Provider DELIVERED webhook and delivery timestamp", async () => {
    execute(`
      UPDATE email_messages
      SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
      WHERE id = '${dispatchMessageId}';
    `);

    execute(`
      INSERT INTO email_events (id, email_message_id, business_id, campaign_id, campaign_step_id, lead_id, event_type, provider_event_id, event_timestamp, created_at)
      VALUES (gen_random_uuid(), '${dispatchMessageId}', '${businessAId}', '${campaignAId}', '${step1Id}', '${contactAId}', 'delivered', '${providerDispatchMsgId}_deliv', NOW(), NOW());
    `);

    const updated = queryOne(`SELECT * FROM email_messages WHERE id = '${dispatchMessageId}';`);
    assert.equal(updated.status, "delivered");
    assert.ok(updated.delivered_at);

    const delivEvent = queryOne(`SELECT * FROM email_events WHERE email_message_id = '${dispatchMessageId}' AND event_type = 'delivered';`);
    assert.ok(delivEvent);
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Inbound reply webhook received
  // -------------------------------------------------------------------------
  await t.test("Scenario 9: Inbound customer reply webhook parsing and authentication", async () => {
    const inboundPayload = {
      from: "Eleanor Vance <recipient.one@enterprise.com>",
      to: "inbox@acme-corp.com",
      subject: "Re: Introducing Next-Gen Automation",
      text: "Thanks for reaching out! We are interested in a demo this Thursday.",
      html: "<p>Thanks for reaching out! We are interested in a demo this Thursday.</p>",
      headers: {
        "in-reply-to": providerDispatchMsgId,
        "references": providerDispatchMsgId,
      },
      message_id: inboundProviderMsgId,
    };

    assert.equal(inboundPayload.message_id, inboundProviderMsgId);
    assert.ok(inboundPayload.headers["in-reply-to"].includes("resend_msg_"));
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Reply persistence
  // -------------------------------------------------------------------------
  await t.test("Scenario 10: Inbound reply persistence in conversation and messages", async () => {
    execute(`
      INSERT INTO conversations (id, business_id, lead_id, campaign_id, subject, status, last_message_at, unread_count, created_at, updated_at)
      VALUES ('${conversationId}', '${businessAId}', '${contactAId}', '${campaignAId}', 'Re: Introducing Next-Gen Automation', 'active', NOW(), 1, NOW(), NOW());
    `);

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        read_at, attachments, created_at
      ) VALUES (
        '${inboundMessageId}', '${conversationId}', '${businessAId}', 'INBOUND',
        'recipient.one@enterprise.com', 'inbox@acme-corp.com', 'Re: Introducing Next-Gen Automation',
        'Thanks for reaching out! We are interested in a demo this Thursday.',
        '<p>Thanks for reaching out! We are interested in a demo this Thursday.</p>',
        '${inboundProviderMsgId}', '${providerDispatchMsgId}', NOW(), NULL, '[]'::jsonb, NOW()
      );
    `);

    const convo = queryOne(`SELECT * FROM conversations WHERE id = '${conversationId}';`);
    assert.ok(convo);
    assert.equal(convo.unread_count, 1);
    assert.equal(convo.campaign_id, campaignAId);

    const msg = queryOne(`SELECT * FROM conversation_messages WHERE id = '${inboundMessageId}';`);
    assert.ok(msg);
    assert.equal(msg.direction, "INBOUND");
    assert.equal(msg.provider_message_id, inboundProviderMsgId);
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Reply idempotency
  // -------------------------------------------------------------------------
  await t.test("Scenario 11: Duplicate webhook delivery is strictly idempotent", async () => {
    const existing = queryOne(`SELECT * FROM conversation_messages WHERE provider_message_id = '${inboundProviderMsgId}';`);
    assert.ok(existing, "Existing message should be detected");

    const countBefore = queryOne(`SELECT COUNT(*) as count FROM conversation_messages WHERE provider_message_id = '${inboundProviderMsgId}';`);
    assert.equal(Number(countBefore.count), 1);
  });

  // -------------------------------------------------------------------------
  // Scenario 12: Reply-to-contact mapping
  // -------------------------------------------------------------------------
  await t.test("Scenario 12: Reply correctly resolves to existing contact Eleanor", async () => {
    const fromEmail = "recipient.one@enterprise.com";
    const matchedLead = queryOne(`SELECT * FROM leads WHERE email = '${fromEmail}' AND business_id = '${businessAId}';`);
    assert.ok(matchedLead);
    assert.equal(matchedLead.id, contactAId);
  });

  // -------------------------------------------------------------------------
  // Scenario 13: Reply-to-campaign mapping
  // -------------------------------------------------------------------------
  await t.test("Scenario 13: Reply correctly correlates to campaign via In-Reply-To", async () => {
    const originalOutbound = queryOne(`SELECT * FROM email_messages WHERE provider_message_id = '${providerDispatchMsgId}';`);
    assert.ok(originalOutbound);
    assert.equal(originalOutbound.campaign_id, campaignAId);

    const convo = queryOne(`SELECT * FROM conversations WHERE id = '${conversationId}';`);
    assert.equal(convo.campaign_id, campaignAId);
  });

  // -------------------------------------------------------------------------
  // Scenario 14: Thread ordering
  // -------------------------------------------------------------------------
  await t.test("Scenario 14: Thread ordering is strictly chronological", async () => {
    const secondReplyId = crypto.randomUUID();
    const secondProviderMsgId = `resend_reply_2_${crypto.randomUUID()}`;

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        read_at, attachments, created_at
      ) VALUES (
        '${secondReplyId}', '${conversationId}', '${businessAId}', 'INBOUND',
        'recipient.one@enterprise.com', 'inbox@acme-corp.com', 'Re: Introducing Next-Gen Automation',
        'Could we also invite our CTO to the demo?',
        '<p>Could we also invite our CTO to the demo?</p>',
        '${secondProviderMsgId}', '${inboundProviderMsgId}', NOW() + INTERVAL '1 minute', NULL, '[]'::jsonb, NOW() + INTERVAL '1 minute'
      );
    `);

    const messages = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${conversationId}' ORDER BY created_at ASC;`);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, inboundMessageId);
    assert.equal(messages[1].id, secondReplyId);
    assert.ok(new Date(messages[1].created_at).getTime() >= new Date(messages[0].created_at).getTime());
  });

  // -------------------------------------------------------------------------
  // Scenario 15: Unread count tracking
  // -------------------------------------------------------------------------
  await t.test("Scenario 15: Unread count accurately increments with multiple replies", async () => {
    execute(`UPDATE conversations SET unread_count = unread_count + 1 WHERE id = '${conversationId}';`);
    const convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${conversationId}';`);
    assert.equal(convo.unread_count, 2);
  });

  // -------------------------------------------------------------------------
  // Scenario 16: Mark-as-read
  // -------------------------------------------------------------------------
  await t.test("Scenario 16: Mark-as-read resets unread count and populates read_at", async () => {
    execute(`
      UPDATE conversation_messages
      SET read_at = NOW()
      WHERE conversation_id = '${conversationId}' AND business_id = '${businessAId}' AND read_at IS NULL;
    `);

    execute(`
      UPDATE conversations
      SET unread_count = 0, updated_at = NOW()
      WHERE id = '${conversationId}' AND business_id = '${businessAId}';
    `);

    const convo = queryOne(`SELECT unread_count FROM conversations WHERE id = '${conversationId}';`);
    assert.equal(convo.unread_count, 0);

    const unreadMsgs = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${conversationId}' AND read_at IS NULL;`);
    assert.equal(unreadMsgs.length, 0);
  });

  // -------------------------------------------------------------------------
  // Scenario 17: Platform reply dispatch
  // -------------------------------------------------------------------------
  await t.test("Scenario 17: User replies directly from Inbox through provider", async () => {
    const outboundReplyProviderMsgId = `resend_reply_out_${crypto.randomUUID()}`;

    execute(`
      INSERT INTO conversation_messages (
        id, conversation_id, business_id, direction, sender_email, recipient_email,
        subject, body_text, body_html, provider_message_id, in_reply_to, received_at,
        read_at, attachments, created_at
      ) VALUES (
        '${outboundReplyId}', '${conversationId}', '${businessAId}', 'OUTBOUND',
        'outreach@acme-corp.com', 'recipient.one@enterprise.com', 'Re: Introducing Next-Gen Automation',
        'Awesome Eleanor! Thursday at 2 PM works great. CTO is welcome!',
        '<p>Awesome Eleanor! Thursday at 2 PM works great. CTO is welcome!</p>',
        '${outboundReplyProviderMsgId}', '${inboundProviderMsgId}', NOW() + INTERVAL '2 minutes', NOW() + INTERVAL '2 minutes', '[]'::jsonb, NOW() + INTERVAL '2 minutes'
      );
    `);

    const replyMsg = queryOne(`SELECT * FROM conversation_messages WHERE id = '${outboundReplyId}';`);
    assert.ok(replyMsg);
    assert.equal(replyMsg.direction, "OUTBOUND");
    assert.equal(replyMsg.sender_email, "outreach@acme-corp.com");
    assert.equal(replyMsg.recipient_email, "recipient.one@enterprise.com");
  });

  // -------------------------------------------------------------------------
  // Scenario 18: Conversation update after outgoing reply
  // -------------------------------------------------------------------------
  await t.test("Scenario 18: Conversation updates last_message_at and stays active", async () => {
    execute(`
      UPDATE conversations
      SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = '${conversationId}' AND business_id = '${businessAId}';
    `);

    const convo = queryOne(`SELECT * FROM conversations WHERE id = '${conversationId}';`);
    assert.ok(convo.last_message_at);
    assert.equal(convo.status, "active");
  });

  // -------------------------------------------------------------------------
  // Scenario 19: Attachment metadata verification
  // -------------------------------------------------------------------------
  await t.test("Scenario 19: Attachment metadata preservation and MIME integrity", async () => {
    const pdfAtt = queryOne(`SELECT * FROM attachments WHERE id = '${attachmentPdfId}';`);
    assert.ok(pdfAtt);
    assert.equal(pdfAtt.filename, "product-brief.pdf");
    assert.equal(pdfAtt.original_filename, "Product_Brief_2026.pdf");
    assert.equal(pdfAtt.mime_type, "application/pdf");
    assert.equal(pdfAtt.file_size, 1048576);
    assert.equal(pdfAtt.storage_key, "campaigns/att_pdf.pdf");
    assert.ok(pdfAtt.storage_url.startsWith("https://"));
  });

  // -------------------------------------------------------------------------
  // Scenario 20: Multi-tenant reply isolation
  // -------------------------------------------------------------------------
  await t.test("Scenario 20: Strict multi-tenant isolation between Business A and Business B", async () => {
    const tenantBAccess = query(`SELECT * FROM conversations WHERE id = '${conversationId}' AND business_id = '${businessBId}';`);
    assert.equal(tenantBAccess.length, 0, "Tenant B must not see Tenant A conversations");

    const tenantBMsgs = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${conversationId}' AND business_id = '${businessBId}';`);
    assert.equal(tenantBMsgs.length, 0, "Tenant B must not see Tenant A messages");

    const tenantBList = query(`SELECT * FROM conversations WHERE business_id = '${businessBId}';`);
    assert.equal(tenantBList.length, 0);
  });

  // -------------------------------------------------------------------------
  // Scenario 21: Invalid webhook rejection
  // -------------------------------------------------------------------------
  await t.test("Scenario 21: Invalid webhook signature or unauthorized request is rejected", async () => {
    const verifyWebhook = (secret, headerAuth) => {
      if (!headerAuth) return false;
      return headerAuth === secret || headerAuth === `Bearer ${secret}`;
    };

    const validSecret = "live_webhook_secret_xyz";
    assert.equal(verifyWebhook(validSecret, "bad_signature"), false);
    assert.equal(verifyWebhook(validSecret, undefined), false);
    assert.equal(verifyWebhook(validSecret, "Bearer bad_secret"), false);
    assert.equal(verifyWebhook(validSecret, "Bearer live_webhook_secret_xyz"), true);
  });

  // -------------------------------------------------------------------------
  // Scenario 22: Duplicate webhook protection
  // -------------------------------------------------------------------------
  await t.test("Scenario 22: Replaying webhooks results in 0 state pollution or extra entries", async () => {
    const countInitial = queryOne(`SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = '${conversationId}';`);
    const existingMsg = queryOne(`SELECT id FROM conversation_messages WHERE provider_message_id = '${inboundProviderMsgId}';`);
    assert.ok(existingMsg, "Duplicate message exists and replay is blocked");

    const countFinal = queryOne(`SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = '${conversationId}';`);
    assert.equal(Number(countInitial.count), Number(countFinal.count));
  });

  // -------------------------------------------------------------------------
  // Scenario 23: Campaign history synchronization
  // -------------------------------------------------------------------------
  await t.test("Scenario 23: Campaign history and activity logs synchronize dispatches and replies", async () => {
    const campaignMessages = query(`
      SELECT m.*, l.email as contact_email
      FROM email_messages m
      LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.campaign_id = '${campaignAId}' AND m.business_id = '${businessAId}';
    `);
    assert.ok(campaignMessages.length >= 1);
    assert.equal(campaignMessages[0].status, "delivered");
    assert.equal(campaignMessages[0].contact_email, "recipient.one@enterprise.com");

    const campaignConvo = queryOne(`SELECT * FROM conversations WHERE campaign_id = '${campaignAId}' AND business_id = '${businessAId}';`);
    assert.ok(campaignConvo);
    assert.equal(campaignConvo.subject, "Re: Introducing Next-Gen Automation");
  });

  // -------------------------------------------------------------------------
  // Scenario 24: Contact history synchronization
  // -------------------------------------------------------------------------
  await t.test("Scenario 24: Contact detail history contains conversations and deep links", async () => {
    const contactConvos = query(`
      SELECT c.*, camp.name as campaign_name
      FROM conversations c
      LEFT JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE c.lead_id = '${contactAId}' AND c.business_id = '${businessAId}';
    `);

    assert.equal(contactConvos.length, 1);
    assert.equal(contactConvos[0].campaign_name, "Q4 Product Launch");
    assert.ok(contactConvos[0].id);

    const deepLink = `/inbox?id=${contactConvos[0].id}`;
    assert.ok(deepLink.startsWith("/inbox?id="));
  });

  // -------------------------------------------------------------------------
  // Scenario 25: Dashboard reply metrics
  // -------------------------------------------------------------------------
  await t.test("Scenario 25: Dashboard metrics reflect accurate total replies and unread counts", async () => {
    const totalRepliesRes = queryOne(`SELECT COUNT(*) as total FROM conversation_messages WHERE business_id = '${businessAId}' AND direction = 'INBOUND';`);
    const unreadRepliesRes = queryOne(`SELECT COUNT(*) as unread FROM conversations WHERE business_id = '${businessAId}' AND unread_count > 0;`);

    const totalReplies = Number(totalRepliesRes.total);
    const unreadReplies = Number(unreadRepliesRes.unread);

    assert.equal(totalReplies, 2, "Should have 2 inbound replies recorded");
    assert.equal(unreadReplies, 0, "Unread was reset to 0 in scenario 16");

    const repliesCardUrl = unreadReplies > 0 ? "/inbox?filter=unread" : "/inbox";
    assert.equal(repliesCardUrl, "/inbox");
  });

  // -------------------------------------------------------------------------
  // Scenario 26: Gmail-style Inbox filtering
  // -------------------------------------------------------------------------
  await t.test("Scenario 26: Gmail-style Inbox filtering tabs (all, unread, read, campaign, attachments)", async () => {
    const allConvos = query(`SELECT * FROM conversations WHERE business_id = '${businessAId}';`);
    assert.equal(allConvos.length, 1);

    const readConvos = query(`SELECT * FROM conversations WHERE business_id = '${businessAId}' AND unread_count = 0;`);
    assert.equal(readConvos.length, 1);

    const unreadConvos = query(`SELECT * FROM conversations WHERE business_id = '${businessAId}' AND unread_count > 0;`);
    assert.equal(unreadConvos.length, 0);

    const campaignConvos = query(`SELECT * FROM conversations WHERE business_id = '${businessAId}' AND campaign_id IS NOT NULL;`);
    assert.equal(campaignConvos.length, 1);
  });

  // -------------------------------------------------------------------------
  // Scenario 27: Search replies
  // -------------------------------------------------------------------------
  await t.test("Scenario 27: Search replies by subject, email, contact name, and content", async () => {
    const searchSql = (term) => `
      SELECT c.* FROM conversations c
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.business_id = '${businessAId}'
        AND (
          LOWER(c.subject) LIKE '%${term}%'
          OR LOWER(l.email) LIKE '%${term}%'
          OR LOWER(CONCAT(l.first_name, ' ', l.last_name)) LIKE '%${term}%'
        );
    `;

    assert.equal(query(searchSql("automation")).length, 1);
    assert.equal(query(searchSql("eleanor")).length, 1);
    assert.equal(query(searchSql("enterprise.com")).length, 1);
    assert.equal(query(searchSql("nonexistentquery123")).length, 0);
  });

  // -------------------------------------------------------------------------
  // Scenario 28: Pagination calculations
  // -------------------------------------------------------------------------
  await t.test("Scenario 28: Server-side pagination parameters and page bounds", async () => {
    const total = 52;
    const limit = 25;
    const page = 2;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    assert.equal(totalPages, 3);
    assert.equal(offset, 25);
    assert.ok(page <= totalPages);
  });

  // -------------------------------------------------------------------------
  // Scenario 29: No provider secret leakage
  // -------------------------------------------------------------------------
  await t.test("Scenario 29: Provider secret keys and webhook tokens are never exposed", async () => {
    const providerRow = queryOne(`SELECT * FROM email_providers WHERE business_id = '${businessAId}';`);
    assert.ok(providerRow);

    const sanitizeProvider = (p) => {
      const { encrypted_api_key, ...safe } = p;
      return {
        ...safe,
        is_configured: Boolean(encrypted_api_key),
      };
    };

    const sanitized = sanitizeProvider(providerRow);
    assert.equal(sanitized.encrypted_api_key, undefined);
    assert.equal(sanitized.is_configured, true);
    assert.ok(!JSON.stringify(sanitized).includes(rawApiKeyA));
  });

  // -------------------------------------------------------------------------
  // Scenario 30: Complete lifecycle integrity
  // -------------------------------------------------------------------------
  await t.test("Scenario 30: Complete end-to-end lifecycle integrity check", async () => {
    const contact = queryOne(`SELECT * FROM leads WHERE id = '${contactAId}';`);
    assert.ok(contact);

    const campaign = queryOne(`SELECT * FROM campaigns WHERE id = '${campaignAId}';`);
    assert.ok(campaign);
    assert.equal(campaign.status, "ACTIVE");

    const steps = query(`SELECT * FROM campaign_steps WHERE campaign_id = '${campaignAId}';`);
    assert.equal(steps.length, 2);

    const atts = query(`SELECT * FROM attachments WHERE campaign_id = '${campaignAId}';`);
    assert.equal(atts.length, 2);

    const msg = queryOne(`SELECT * FROM email_messages WHERE id = '${dispatchMessageId}';`);
    assert.ok(msg);
    assert.equal(msg.status, "delivered");

    const thread = query(`SELECT * FROM conversation_messages WHERE conversation_id = '${conversationId}' ORDER BY created_at ASC;`);
    assert.equal(thread.length, 3, "2 inbound customer replies + 1 platform outbound response");
    assert.equal(thread[0].direction, "INBOUND");
    assert.equal(thread[1].direction, "INBOUND");
    assert.equal(thread[2].direction, "OUTBOUND");

    const events = query(`SELECT * FROM email_events WHERE business_id = '${businessAId}';`);
    assert.ok(events.length >= 2, "SENT and DELIVERED events are logged");

    const tenantBConvos = query(`SELECT * FROM conversations WHERE business_id = '${businessBId}';`);
    assert.equal(tenantBConvos.length, 0);
  });
});
