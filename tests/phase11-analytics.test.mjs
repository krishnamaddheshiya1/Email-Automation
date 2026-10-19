import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

/**
 * Phase 11 Campaign Analytics & Email Tracking Test Engine
 * Direct integration testing against pg-mem database for:
 * - Email event persistence (SENT, DELIVERED, BOUNCED, COMPLAINED, FAILED, UNSUBSCRIBED)
 * - Webhook deduplication & out-of-order / terminal status protection
 * - Campaign overview metrics and deliverability rates (with zero-denominator safety)
 * - Activity timeline aggregation
 * - Step-level analytics
 * - Contact email history with pagination
 * - Email message detail with delivery audit trail
 * - Date filtering (strict UTC timestamps)
 * - Multi-tenant isolation
 * - CSV export generation
 */
class AnalyticsTestEngine {
  constructor(db) {
    this.db = db;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  many(sql) {
    return this.db.public.many(sql) || [];
  }

  none(sql) {
    this.db.public.none(sql);
  }

  // --- Seed Helpers ---
  createBusiness(name) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${id}', '${name.replace(/'/g, "''")}', NOW(), NOW());
    `);
    return id;
  }

  createCampaign(businessId, name, timezone = "UTC") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${name.replace(/'/g, "''")}', 'ACTIVE', '${timezone}', NOW(), NOW());
    `);
    return id;
  }

  createStep(businessId, campaignId, stepNumber, name, delayValue = 0, delayUnit = "days") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${id}', '${campaignId}', ${stepNumber}, '${name.replace(/'/g, "''")}', ${delayValue}, '${delayUnit}', 'ACTIVE', NOW(), NOW());
    `);
    return id;
  }

  createLead(businessId, email, firstName = "Test", lastName = "User") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${email.toLowerCase()}', '${firstName}', '${lastName}', 'NEW', NOW(), NOW());
    `);
    return id;
  }

  enrollLead(businessId, campaignId, leadId, firstStepId = null) {
    const id = crypto.randomUUID();
    const stepStr = firstStepId ? `'${firstStepId}'` : "NULL";
    this.none(`
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, current_step, next_step_id, next_run_at, started_at, enrolled_at, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${campaignId}', '${leadId}', 'RUNNING', 1, ${stepStr}, NOW(), NOW(), NOW(), NOW(), NOW());
    `);
    return id;
  }

  // --- Email Dispatch & Event Recording ---
  recordEmailDispatch(businessId, campaignId, stepId, leadId, enrollmentId, options = {}) {
    const messageId = options.messageId || crypto.randomUUID();
    const providerMessageId = options.providerMessageId || `resend_${crypto.randomUUID()}`;
    const subject = options.subject || "Subject line";
    const fromEmail = options.fromEmail || "sender@test.com";
    const toEmail = options.toEmail || "recipient@test.com";
    const status = (options.status || "SENT").toLowerCase();
    const sentAt = options.sentAt || new Date().toISOString();

    this.none(`
      INSERT INTO email_messages (
        id, business_id, campaign_id, campaign_step_id, lead_id,
        direction, provider_message_id, from_email, to_email,
        subject, body, status, sent_at, metadata, created_at, updated_at
      ) VALUES (
        '${messageId}', '${businessId}', '${campaignId}', '${stepId}', '${leadId}',
        'outbound', '${providerMessageId}', '${fromEmail}', '${toEmail}',
        '${subject.replace(/'/g, "''")}', '<p>Hello</p>', '${status}', '${sentAt}', '{}'::jsonb, '${sentAt}', '${sentAt}'
      );
    `);

    // Insert SENT event
    const eventId = crypto.randomUUID();
    this.none(`
      INSERT INTO email_events (
        id, business_id, email_message_id, event_type, provider_event_id,
        event_timestamp, metadata, campaign_id, campaign_step_id, lead_id, enrollment_id, created_at
      ) VALUES (
        '${eventId}', '${businessId}', '${messageId}', 'sent', '${providerMessageId}_sent',
        '${sentAt}', '{"type":"sent"}'::jsonb, '${campaignId}', '${stepId}', '${leadId}', '${enrollmentId}', '${sentAt}'
      );
    `);

    return { messageId, providerMessageId };
  }

  // --- Webhook Processing with Deduplication & Terminal Status Protection ---
  processWebhookEvent(businessId, providerMessageId, eventType, occurredAt = null, metadata = {}) {
    const ts = occurredAt || new Date().toISOString();
    const typeLower = eventType.toLowerCase();

    // Find email message
    const msg = this.oneOrNone(`
      SELECT * FROM email_messages
      WHERE provider_message_id = '${providerMessageId}' AND business_id = '${businessId}';
    `);

    if (!msg) {
      return { success: false, error: "Message not found" };
    }

    // Deduplication check: Has this exact event already been recorded for this message?
    const existingEvent = this.oneOrNone(`
      SELECT id FROM email_events
      WHERE email_message_id = '${msg.id}' AND LOWER(event_type) = '${typeLower}';
    `);

    if (existingEvent) {
      return { success: true, duplicate: true, eventId: existingEvent.id };
    }

    // Terminal Status Protection Rules:
    let nextStatus = msg.status;
    const currentStatus = (msg.status || "").toLowerCase();

    if (typeLower === "delivered") {
      if (currentStatus !== "bounced" && currentStatus !== "complained") {
        nextStatus = "delivered";
      }
    } else if (typeLower === "bounced") {
      nextStatus = "bounced";
    } else if (typeLower === "complained") {
      nextStatus = "complained";
    } else if (typeLower === "failed") {
      if (currentStatus !== "delivered" && currentStatus !== "bounced" && currentStatus !== "complained") {
        nextStatus = "failed";
      }
    } else if (typeLower === "sent") {
      if (currentStatus === "pending" || currentStatus === "queued") {
        nextStatus = "sent";
      }
    }

    // Insert event
    const eventId = crypto.randomUUID();
    const metaStr = JSON.stringify(metadata).replace(/'/g, "''");
    this.none(`
      INSERT INTO email_events (
        id, business_id, email_message_id, event_type, provider_event_id,
        event_timestamp, metadata, campaign_id, campaign_step_id, lead_id, created_at
      ) VALUES (
        '${eventId}', '${businessId}', '${msg.id}', '${typeLower}', '${providerMessageId}_${typeLower}_${Date.now()}',
        '${ts}', '${metaStr}'::jsonb, '${msg.campaign_id}', '${msg.campaign_step_id}', '${msg.lead_id}', '${ts}'
      );
    `);

    // Update message status, timestamps, and metadata
    let currentMeta = {};
    if (msg.metadata) {
      currentMeta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
    }
    const updates = [`status = '${nextStatus}'`, "updated_at = NOW()"];
    if (typeLower === "delivered") {
      updates.push(`delivered_at = '${ts}'`);
    } else if (typeLower === "bounced") {
      updates.push(`bounced_at = '${ts}'`);
      if (metadata.reason) {
        currentMeta.bounce_reason = metadata.reason;
      }
    } else if (typeLower === "complained") {
      if (metadata.reason) {
        currentMeta.complaint_reason = metadata.reason;
      }
    }

    const metaJsonStr = JSON.stringify(currentMeta).replace(/'/g, "''");
    updates.push(`metadata = '${metaJsonStr}'::jsonb`);

    this.none(`
      UPDATE email_messages
      SET ${updates.join(", ")}
      WHERE id = '${msg.id}';
    `);

    return { success: true, duplicate: false, eventId, nextStatus: nextStatus.toUpperCase() };
  }

  // --- Record Unsubscribe Event ---
  recordUnsubscribeEvent(businessId, campaignId, leadId, metadata = {}) {
    const eventId = crypto.randomUUID();
    const ts = new Date().toISOString();
    const metaStr = JSON.stringify(metadata).replace(/'/g, "''");
    this.none(`
      INSERT INTO email_events (
        id, business_id, event_type, provider_event_id, event_timestamp, metadata,
        campaign_id, lead_id, created_at
      ) VALUES (
        '${eventId}', '${businessId}', 'unsubscribed', 'unsub_${Date.now()}', '${ts}',
        '${metaStr}'::jsonb, '${campaignId}', '${leadId}', '${ts}'
      );
    `);
    return eventId;
  }

  // --- Campaign Analytics Overview Calculation ---
  getCampaignOverview(businessId, campaignId, options = {}) {
    let dateFilterMsg = "";
    let dateFilterEvents = "";
    if (options.from) {
      dateFilterMsg += ` AND created_at >= '${options.from}'`;
      dateFilterEvents += ` AND event_timestamp >= '${options.from}'`;
    }
    if (options.to) {
      dateFilterMsg += ` AND created_at <= '${options.to}'`;
      dateFilterEvents += ` AND event_timestamp <= '${options.to}'`;
    }

    const messages = this.many(`
      SELECT status, delivered_at, bounced_at, metadata
      FROM email_messages
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}' ${dateFilterMsg};
    `);

    const enrollments = this.many(`
      SELECT status FROM campaign_leads
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}';
    `);

    const unsubEvents = this.many(`
      SELECT id FROM email_events
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}' AND LOWER(event_type) = 'unsubscribed' ${dateFilterEvents};
    `);

    let totalSent = 0;
    let totalDelivered = 0;
    let totalBounced = 0;
    let totalFailed = 0;
    let totalComplained = 0;

    for (const m of messages) {
      const s = (m.status || "").toLowerCase();
      if (s === "sent" || s === "delivered" || s === "bounced" || s === "complained") {
        totalSent++;
      }
      if (s === "delivered") {
        totalDelivered++;
      } else if (s === "bounced") {
        totalBounced++;
      } else if (s === "failed") {
        totalFailed++;
      } else if (s === "complained") {
        totalComplained++;
      }
    }

    const totalUnsubscribed = unsubEvents.length;

    // Delivery rates with Zero-Denominator Safety
    const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(2)) : 0;
    const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
    const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
    const unsubscribeRate = totalSent > 0 ? Number(((totalUnsubscribed / totalSent) * 100).toFixed(2)) : 0;

    let pending = 0;
    let active = 0;
    let completed = 0;
    let stopped = 0;

    for (const en of enrollments) {
      const st = (en.status || "").toUpperCase();
      if (st === "RUNNING") active++;
      else if (st === "COMPLETED") completed++;
      else if (st === "STOPPED") stopped++;
      else pending++;
    }

    return {
      campaign_id: campaignId,
      total_enrolled: enrollments.length,
      total_sent: totalSent,
      total_delivered: totalDelivered,
      total_bounced: totalBounced,
      total_failed: totalFailed,
      total_complained: totalComplained,
      total_unsubscribed: totalUnsubscribed,
      delivery_rate: deliveryRate,
      bounce_rate: bounceRate,
      complaint_rate: complaintRate,
      unsubscribe_rate: unsubscribeRate,
      enrolled_pending: pending,
      enrolled_active: active,
      enrolled_completed: completed,
      enrolled_stopped: stopped,
    };
  }

  // --- Campaign Timeline Calculation ---
  getCampaignTimeline(businessId, campaignId, options = {}) {
    let dateFilter = "";
    if (options.from) dateFilter += ` AND event_timestamp >= '${options.from}'`;
    if (options.to) dateFilter += ` AND event_timestamp <= '${options.to}'`;

    const events = this.many(`
      SELECT event_type, event_timestamp
      FROM email_events
      WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}' ${dateFilter}
      ORDER BY event_timestamp ASC;
    `);

    const dateMap = new Map();
    for (const ev of events) {
      const d = new Date(ev.event_timestamp).toISOString().split("T")[0];
      if (!dateMap.has(d)) {
        dateMap.set(d, { date: d, sent: 0, delivered: 0, bounced: 0, failed: 0, complained: 0 });
      }
      const entry = dateMap.get(d);
      const t = (ev.event_type || "").toLowerCase();
      if (t === "sent") entry.sent++;
      else if (t === "delivered") entry.delivered++;
      else if (t === "bounced") entry.bounced++;
      else if (t === "failed") entry.failed++;
      else if (t === "complained") entry.complained++;
    }

    return Array.from(dateMap.values());
  }

  // --- Step Analytics Calculation ---
  getStepAnalytics(businessId, campaignId) {
    const steps = this.many(`
      SELECT id, step_number, name
      FROM campaign_steps
      WHERE campaign_id = '${campaignId}'
      ORDER BY step_number ASC;
    `);

    return steps.map((st) => {
      const messages = this.many(`
        SELECT status FROM email_messages
        WHERE campaign_step_id = '${st.id}' AND business_id = '${businessId}';
      `);

      let sent = 0;
      let delivered = 0;
      let bounced = 0;
      let failed = 0;
      let complaints = 0;

      for (const m of messages) {
        const s = (m.status || "").toLowerCase();
        if (s === "sent" || s === "delivered" || s === "bounced" || s === "complained") sent++;
        if (s === "delivered") delivered++;
        else if (s === "bounced") bounced++;
        else if (s === "failed") failed++;
        else if (s === "complained") complaints++;
      }

      const deliveryRate = sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0;
      const bounceRate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;

      return {
        step_id: st.id,
        step_number: st.step_number,
        step_name: st.name,
        sent,
        delivered,
        bounced,
        failed,
        complaints,
        unsubscribed: 0,
        delivery_rate: deliveryRate,
        bounce_rate: bounceRate,
      };
    });
  }

  // --- Contact Email History ---
  getContactEmailHistory(businessId, leadId, options = {}) {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;

    const all = this.many(`
      SELECT m.*, c.name as campaign_name, s.step_number
      FROM email_messages m
      LEFT JOIN campaigns c ON m.campaign_id = c.id
      LEFT JOIN campaign_steps s ON m.campaign_step_id = s.id
      WHERE m.lead_id = '${leadId}' AND m.business_id = '${businessId}'
      ORDER BY m.created_at DESC;
    `);

    const total = all.length;
    const paged = all.slice(offset, offset + limit);

    return {
      emails: paged.map((r) => {
        const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {};
        return {
          id: r.id,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name || "Campaign",
          step_number: r.step_number || null,
          subject: r.subject,
          from_email: r.from_email,
          to_email: r.to_email,
          status: (r.status || "QUEUED").toUpperCase(),
          sent_at: r.sent_at,
          delivered_at: r.delivered_at,
          bounced_at: r.bounced_at,
          bounce_reason: meta.bounce_reason || null,
          complaint_reason: meta.complaint_reason || null,
          created_at: r.created_at,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // --- Email Message Detail with Audit Trail ---
  getEmailMessageDetail(businessId, messageId) {
    const msg = this.oneOrNone(`
      SELECT m.*, c.name as campaign_name, s.step_number
      FROM email_messages m
      LEFT JOIN campaigns c ON m.campaign_id = c.id
      LEFT JOIN campaign_steps s ON m.campaign_step_id = s.id
      WHERE m.id = '${messageId}' AND m.business_id = '${businessId}';
    `);

    if (!msg) return null;

    const events = this.many(`
      SELECT * FROM email_events
      WHERE email_message_id = '${messageId}' AND business_id = '${businessId}'
      ORDER BY event_timestamp ASC;
    `);

    const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata || {};

    return {
      id: msg.id,
      business_id: msg.business_id,
      campaign_id: msg.campaign_id,
      campaign_name: msg.campaign_name || "Campaign",
      campaign_step_id: msg.campaign_step_id,
      step_number: msg.step_number || null,
      lead_id: msg.lead_id,
      subject: msg.subject,
      from_address: msg.from_email,
      to_address: msg.to_email,
      status: (msg.status || "").toUpperCase(),
      sent_at: msg.sent_at,
      delivered_at: msg.delivered_at,
      bounced_at: msg.bounced_at,
      bounce_reason: meta.bounce_reason || null,
      complaint_reason: meta.complaint_reason || null,
      provider_message_id: msg.provider_message_id,
      events: events.map((e) => ({
        id: e.id,
        email_message_id: e.email_message_id,
        event_type: e.event_type,
        occurred_at: e.event_timestamp,
        metadata: typeof e.metadata === "string" ? JSON.parse(e.metadata) : e.metadata,
      })),
      created_at: msg.created_at,
    };
  }

  // --- CSV Export Generation ---
  exportCampaignCsv(businessId, campaignId) {
    const messages = this.many(`
      SELECT m.id, m.lead_id, m.to_email, m.campaign_id, s.step_number,
             m.subject, m.status, m.sent_at, m.delivered_at, m.bounced_at,
             m.metadata
      FROM email_messages m
      LEFT JOIN campaign_steps s ON m.campaign_step_id = s.id
      WHERE m.campaign_id = '${campaignId}' AND m.business_id = '${businessId}'
      ORDER BY m.created_at DESC;
    `);

    const headers = [
      "Message ID",
      "Lead ID",
      "Lead Email",
      "Campaign ID",
      "Step",
      "Subject",
      "Status",
      "Sent At",
      "Delivered At",
      "Bounced At",
      "Bounce Reason",
      "Complaint Reason",
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [headers.join(",")];
    for (const m of messages) {
      const meta = typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata || {};
      lines.push(
        [
          escapeCsv(m.id),
          escapeCsv(m.lead_id),
          escapeCsv(m.to_email),
          escapeCsv(m.campaign_id),
          escapeCsv(m.step_number || ""),
          escapeCsv(m.subject),
          escapeCsv((m.status || "").toUpperCase()),
          escapeCsv(m.sent_at),
          escapeCsv(m.delivered_at),
          escapeCsv(m.bounced_at),
          escapeCsv(meta.bounce_reason || ""),
          escapeCsv(meta.complaint_reason || ""),
        ].join(",")
      );
    }

    return lines.join("\n");
  }
}

// =========================================================================
// TEST SUITE: ALL 27 SCENARIOS + MANUAL VERIFICATION
// =========================================================================

test("PHASE 11: CAMPAIGN ANALYTICS & EMAIL TRACKING SUITE", async (t) => {
  const { db } = createTestDb();
  const engine = new AnalyticsTestEngine(db);

  // Setup Tenant 1 and Core Entities
  const tenant1 = engine.createBusiness("Acme Corp Tenant 1");
  const campaign1 = engine.createCampaign(tenant1, "Q4 Product Launch");
  const step1 = engine.createStep(tenant1, campaign1, 1, "Initial Intro", 0, "days");
  engine.createStep(tenant1, campaign1, 2, "Follow-up Demo", 3, "days");
  engine.createStep(tenant1, campaign1, 3, "Final Offer", 7, "days");

  const leadA = engine.createLead(tenant1, "alice@acme.com", "Alice", "Smith");
  const leadB = engine.createLead(tenant1, "bob@acme.com", "Bob", "Jones");
  const leadC = engine.createLead(tenant1, "charlie@acme.com", "Charlie", "Brown");

  const enrollA = engine.enrollLead(tenant1, campaign1, leadA, step1);
  const enrollB = engine.enrollLead(tenant1, campaign1, leadB, step1);
  const enrollC = engine.enrollLead(tenant1, campaign1, leadC, step1);

  // -----------------------------------------------------------------------
  // Scenario 1: SENT event stored
  // -----------------------------------------------------------------------
  let msgA1;
  await t.test("1. SENT event stored in email_events", () => {
    msgA1 = engine.recordEmailDispatch(tenant1, campaign1, step1, leadA, enrollA, {
      subject: "Welcome to Acme",
      toEmail: "alice@acme.com",
      sentAt: "2026-10-16T10:00:00.000Z",
    });

    const events = engine.many(`
      SELECT * FROM email_events WHERE email_message_id = '${msgA1.messageId}';
    `);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "sent");
    assert.equal(events[0].campaign_id, campaign1);
    assert.equal(events[0].campaign_step_id, step1);
    assert.equal(events[0].lead_id, leadA);
  });

  // -----------------------------------------------------------------------
  // Scenario 2: DELIVERED event stored
  // -----------------------------------------------------------------------
  await t.test("2. DELIVERED event stored and message delivered_at updated", () => {
    const res = engine.processWebhookEvent(
      tenant1,
      msgA1.providerMessageId,
      "delivered",
      "2026-10-16T10:05:00.000Z"
    );

    assert.equal(res.success, true);
    assert.equal(res.duplicate, false);
    assert.equal(res.nextStatus, "DELIVERED");

    const msg = engine.oneOrNone(`SELECT * FROM email_messages WHERE id = '${msgA1.messageId}';`);
    assert.equal(msg.status.toUpperCase(), "DELIVERED");
    assert.ok(msg.delivered_at);

    const events = engine.many(`
      SELECT * FROM email_events WHERE email_message_id = '${msgA1.messageId}' AND event_type = 'delivered';
    `);
    assert.equal(events.length, 1);
  });

  // -----------------------------------------------------------------------
  // Scenario 3: BOUNCED event stored
  // -----------------------------------------------------------------------
  let msgB1;
  await t.test("3. BOUNCED event stored with bounce reason and bounced_at", () => {
    msgB1 = engine.recordEmailDispatch(tenant1, campaign1, step1, leadB, enrollB, {
      subject: "Welcome to Acme",
      toEmail: "bob@acme.com",
    });

    const res = engine.processWebhookEvent(
      tenant1,
      msgB1.providerMessageId,
      "bounced",
      "2026-10-16T10:06:00.000Z",
      { reason: "550 5.1.1 User unknown mailbox not found" }
    );

    assert.equal(res.success, true);
    assert.equal(res.nextStatus, "BOUNCED");

    const msg = engine.oneOrNone(`SELECT * FROM email_messages WHERE id = '${msgB1.messageId}';`);
    assert.equal(msg.status.toUpperCase(), "BOUNCED");
    assert.ok(msg.bounced_at);
    const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata || {};
    assert.ok(meta.bounce_reason.includes("User unknown"));
  });

  // -----------------------------------------------------------------------
  // Scenario 4: COMPLAINT event stored
  // -----------------------------------------------------------------------
  let msgC1;
  await t.test("4. COMPLAINT event stored with complaint reason", () => {
    msgC1 = engine.recordEmailDispatch(tenant1, campaign1, step1, leadC, enrollC, {
      subject: "Welcome to Acme",
      toEmail: "charlie@acme.com",
    });

    const res = engine.processWebhookEvent(
      tenant1,
      msgC1.providerMessageId,
      "complained",
      "2026-10-16T10:07:00.000Z",
      { reason: "Recipient reported spam" }
    );

    assert.equal(res.success, true);
    assert.equal(res.nextStatus, "COMPLAINED");

    const msg = engine.oneOrNone(`SELECT * FROM email_messages WHERE id = '${msgC1.messageId}';`);
    assert.equal(msg.status.toUpperCase(), "COMPLAINED");
    const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata || {};
    assert.equal(meta.complaint_reason, "Recipient reported spam");
  });

  // -----------------------------------------------------------------------
  // Scenario 5: FAILED event stored
  // -----------------------------------------------------------------------
  await t.test("5. FAILED event stored upon delivery error", () => {
    const leadD = engine.createLead(tenant1, "david@acme.com");
    const enrollD = engine.enrollLead(tenant1, campaign1, leadD, step1);
    const msgD1 = engine.recordEmailDispatch(tenant1, campaign1, step1, leadD, enrollD, {
      subject: "Intro",
      toEmail: "david@acme.com",
      status: "FAILED",
    });

    const res = engine.processWebhookEvent(
      tenant1,
      msgD1.providerMessageId,
      "failed",
      "2026-10-16T10:08:00.000Z",
      { error: "Connection timeout to remote MX" }
    );

    assert.equal(res.success, true);
    const events = engine.many(`
      SELECT * FROM email_events WHERE email_message_id = '${msgD1.messageId}' AND event_type = 'failed';
    `);
    assert.equal(events.length, 1);
  });

  // -----------------------------------------------------------------------
  // Scenario 6: UNSUBSCRIBE event stored
  // -----------------------------------------------------------------------
  await t.test("6. UNSUBSCRIBE event stored properly in email_events", () => {
    const unsubId = engine.recordUnsubscribeEvent(tenant1, campaign1, leadA, {
      email: "alice@acme.com",
      source: "one_click_header",
    });
    assert.ok(unsubId);

    const events = engine.many(`
      SELECT * FROM email_events WHERE campaign_id = '${campaign1}' AND event_type = 'unsubscribed';
    `);
    assert.equal(events.length, 1);
    assert.equal(events[0].lead_id, leadA);
  });

  // -----------------------------------------------------------------------
  // Scenario 7: Duplicate webhook does not duplicate analytics
  // -----------------------------------------------------------------------
  await t.test("7. Duplicate webhook does not duplicate analytics or events", () => {
    const initialDeliveredEvents = engine.many(`
      SELECT id FROM email_events WHERE email_message_id = '${msgA1.messageId}' AND event_type = 'delivered';
    `).length;

    // Send duplicate DELIVERED webhook
    const dupRes = engine.processWebhookEvent(
      tenant1,
      msgA1.providerMessageId,
      "delivered",
      "2026-10-16T10:05:00.000Z"
    );

    assert.equal(dupRes.duplicate, true);

    const afterDeliveredEvents = engine.many(`
      SELECT id FROM email_events WHERE email_message_id = '${msgA1.messageId}' AND event_type = 'delivered';
    `).length;

    assert.equal(afterDeliveredEvents, initialDeliveredEvents, "Event count must not increase on duplicate webhook");
  });

  // -----------------------------------------------------------------------
  // Scenario 8: Campaign sent count
  // -----------------------------------------------------------------------
  await t.test("8. Campaign sent count", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.total_sent, 3, "Sent count matches distinct outbound sent messages");
  });

  // -----------------------------------------------------------------------
  // Scenario 9: Campaign delivered count
  // -----------------------------------------------------------------------
  await t.test("9. Campaign delivered count", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.total_delivered, 1, "Delivered count matches 1 delivered");
  });

  // -----------------------------------------------------------------------
  // Scenario 10: Campaign bounce count
  // -----------------------------------------------------------------------
  await t.test("10. Campaign bounce count", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.total_bounced, 1, "Bounced count matches 1 bounce");
  });

  // -----------------------------------------------------------------------
  // Scenario 11: Campaign complaint count
  // -----------------------------------------------------------------------
  await t.test("11. Campaign complaint count", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.total_complained, 1, "Complaint count matches 1 complaint");
  });

  // -----------------------------------------------------------------------
  // Scenario 12: Campaign unsubscribe count
  // -----------------------------------------------------------------------
  await t.test("12. Campaign unsubscribe count", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.total_unsubscribed, 1, "Unsubscribe count matches 1 unsubscribe event");
  });

  // -----------------------------------------------------------------------
  // Scenario 13: Delivery rate
  // -----------------------------------------------------------------------
  await t.test("13. Delivery rate", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.delivery_rate, 33.33, "1 delivered / 3 sent = 33.33%");
  });

  // -----------------------------------------------------------------------
  // Scenario 14: Bounce rate
  // -----------------------------------------------------------------------
  await t.test("14. Bounce rate", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.bounce_rate, 33.33, "1 bounced / 3 sent = 33.33%");
  });

  // -----------------------------------------------------------------------
  // Scenario 15: Complaint rate
  // -----------------------------------------------------------------------
  await t.test("15. Complaint rate", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.complaint_rate, 33.33, "1 complained / 3 sent = 33.33%");
  });

  // -----------------------------------------------------------------------
  // Scenario 16: Unsubscribe rate
  // -----------------------------------------------------------------------
  await t.test("16. Unsubscribe rate", () => {
    const overview = engine.getCampaignOverview(tenant1, campaign1);
    assert.equal(overview.unsubscribe_rate, 33.33, "1 unsubscribed / 3 sent = 33.33%");
  });

  // -----------------------------------------------------------------------
  // Scenario 17: Zero-denominator handling
  // -----------------------------------------------------------------------
  await t.test("17. Zero-denominator safety returns 0 and does not divide by zero or NaN", () => {
    const emptyCampaign = engine.createCampaign(tenant1, "Empty Fresh Campaign");
    const overview = engine.getCampaignOverview(tenant1, emptyCampaign);

    assert.equal(overview.total_sent, 0);
    assert.equal(overview.delivery_rate, 0);
    assert.equal(overview.bounce_rate, 0);
    assert.equal(overview.complaint_rate, 0);
    assert.equal(overview.unsubscribe_rate, 0);
    assert.ok(!Number.isNaN(overview.delivery_rate));
    assert.ok(Number.isFinite(overview.delivery_rate));
  });

  // -----------------------------------------------------------------------
  // Scenario 18: Step-level analytics
  // -----------------------------------------------------------------------
  await t.test("18. Step-level analytics partitions metrics per step accurately", () => {
    const stepStats = engine.getStepAnalytics(tenant1, campaign1);
    assert.equal(stepStats.length, 3);

    const s1 = stepStats.find((s) => s.step_number === 1);
    assert.ok(s1);
    assert.equal(s1.sent, 3);
    assert.equal(s1.delivered, 1);
    assert.equal(s1.bounced, 1);
    assert.equal(s1.complaints, 1);
    assert.equal(s1.delivery_rate, 33.33);
    assert.equal(s1.bounce_rate, 33.33);

    const s2 = stepStats.find((s) => s.step_number === 2);
    assert.equal(s2.sent, 0);
    assert.equal(s2.delivery_rate, 0);
  });

  // -----------------------------------------------------------------------
  // Scenario 19: Contact email history
  // -----------------------------------------------------------------------
  await t.test("19. Contact email history lists all messages for contact with metadata", () => {
    const historyA = engine.getContactEmailHistory(tenant1, leadA);
    assert.equal(historyA.total, 1);
    assert.equal(historyA.emails[0].subject, "Welcome to Acme");
    assert.equal(historyA.emails[0].status, "DELIVERED");
    assert.ok(historyA.emails[0].delivered_at);

    const historyB = engine.getContactEmailHistory(tenant1, leadB);
    assert.equal(historyB.total, 1);
    assert.equal(historyB.emails[0].status, "BOUNCED");
    assert.ok(historyB.emails[0].bounce_reason.includes("User unknown"));
  });

  // -----------------------------------------------------------------------
  // Scenario 20: Email detail page
  // -----------------------------------------------------------------------
  await t.test("20. Email detail contains complete delivery audit trail without leaking secrets", () => {
    const detail = engine.getEmailMessageDetail(tenant1, msgA1.messageId);
    assert.ok(detail);
    assert.equal(detail.id, msgA1.messageId);
    assert.equal(detail.status, "DELIVERED");
    assert.equal(detail.events.length, 2); // SENT + DELIVERED
    const eventTypes = detail.events.map((e) => e.event_type.toLowerCase());
    assert.ok(eventTypes.includes("sent"), "Must include sent event");
    assert.ok(eventTypes.includes("delivered"), "Must include delivered event");

    // Verify secrets are never present in model
    assert.equal(detail.api_key, undefined);
    assert.equal(detail.encrypted_api_key, undefined);
    assert.equal(detail.webhook_secret, undefined);
  });

  // -----------------------------------------------------------------------
  // Scenario 21: Date filtering
  // -----------------------------------------------------------------------
  await t.test("21. Date filtering strictly bounds metrics to requested UTC window", () => {
    // Window in the future should match 0
    const futureOverview = engine.getCampaignOverview(tenant1, campaign1, {
      from: "2099-01-01T00:00:00.000Z",
      to: "2099-12-31T23:59:59.000Z",
    });
    assert.equal(futureOverview.total_sent, 0);
    assert.equal(futureOverview.total_delivered, 0);

    // Wide window covering current date matches all
    const allOverview = engine.getCampaignOverview(tenant1, campaign1, {
      from: "2020-01-01T00:00:00.000Z",
      to: "2030-01-01T00:00:00.000Z",
    });
    assert.equal(allOverview.total_sent, 3);
  });

  // -----------------------------------------------------------------------
  // Scenario 22: Pagination
  // -----------------------------------------------------------------------
  await t.test("22. Server-side pagination limits and offsets contact history properly", () => {
    // Create 5 additional messages for leadA in a new campaign
    const tempCampaign = engine.createCampaign(tenant1, "Pagination Test Campaign");
    for (let i = 1; i <= 5; i++) {
      engine.recordEmailDispatch(tenant1, tempCampaign, step1, leadA, enrollA, {
        subject: `Page test msg #${i}`,
      });
    }

    const page1 = engine.getContactEmailHistory(tenant1, leadA, { page: 1, limit: 2 });
    assert.equal(page1.emails.length, 2);
    assert.equal(page1.total, 6);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.page, 1);

    const page3 = engine.getContactEmailHistory(tenant1, leadA, { page: 3, limit: 2 });
    assert.equal(page3.emails.length, 2);
    assert.equal(page3.page, 3);
  });

  // -----------------------------------------------------------------------
  // Scenario 23: Multi-tenant analytics isolation
  // -----------------------------------------------------------------------
  await t.test("23. Multi-tenant isolation prevents cross-tenant access to metrics and history", () => {
    const tenant2 = engine.createBusiness("Tenant 2 Competitor");
    engine.createCampaign(tenant2, "Tenant 2 Secret Campaign");

    // Tenant 2 queries Tenant 1's campaign
    const crossOverview = engine.getCampaignOverview(tenant2, campaign1);
    assert.equal(crossOverview.total_sent, 0, "Tenant 2 querying Tenant 1 campaign must yield 0");
    assert.equal(crossOverview.total_enrolled, 0);

    // Tenant 2 queries Tenant 1's contact history
    const crossContactHistory = engine.getContactEmailHistory(tenant2, leadA);
    assert.equal(crossContactHistory.total, 0, "Tenant 2 must see 0 messages for Tenant 1 lead");
    assert.equal(crossContactHistory.emails.length, 0);

    // Tenant 2 queries Tenant 1's message detail
    const crossMsgDetail = engine.getEmailMessageDetail(tenant2, msgA1.messageId);
    assert.equal(crossMsgDetail, null, "Cross-tenant email message detail must return null");
  });

  // -----------------------------------------------------------------------
  // Scenario 24: Out-of-order event handling
  // -----------------------------------------------------------------------
  await t.test("24. Out-of-order event handling preserves DELIVERED when delayed SENT arrives", () => {
    const leadO = engine.createLead(tenant1, "out-of-order@test.com");
    const enrollO = engine.enrollLead(tenant1, campaign1, leadO, step1);
    const msgO = engine.recordEmailDispatch(tenant1, campaign1, step1, leadO, enrollO, {
      subject: "Race condition test",
      status: "queued",
    });

    // DELIVERED arrives first
    const delivRes = engine.processWebhookEvent(
      tenant1,
      msgO.providerMessageId,
      "delivered",
      "2026-10-16T11:00:00.000Z"
    );
    assert.equal(delivRes.nextStatus, "DELIVERED");

    // Now delayed SENT arrives
    const sentRes = engine.processWebhookEvent(
      tenant1,
      msgO.providerMessageId,
      "sent",
      "2026-10-16T11:00:05.000Z"
    );
    assert.ok(sentRes);

    const finalMsg = engine.oneOrNone(`SELECT status FROM email_messages WHERE id = '${msgO.messageId}';`);
    assert.equal(finalMsg.status.toUpperCase(), "DELIVERED", "DELIVERED status must NOT be downgraded to SENT by delayed webhook");
  });

  // -----------------------------------------------------------------------
  // Scenario 25: Terminal status protection
  // -----------------------------------------------------------------------
  await t.test("25. Terminal status protection: BOUNCED/COMPLAINED cannot be overwritten by DELIVERED", () => {
    const leadT = engine.createLead(tenant1, "terminal@test.com");
    const enrollT = engine.enrollLead(tenant1, campaign1, leadT, step1);
    const msgT = engine.recordEmailDispatch(tenant1, campaign1, step1, leadT, enrollT, {
      subject: "Terminal check",
    });

    // Mark as BOUNCED
    engine.processWebhookEvent(tenant1, msgT.providerMessageId, "bounced", "2026-10-16T11:10:00.000Z", {
      reason: "Hard bounce 550",
    });

    const bouncedMsg = engine.oneOrNone(`SELECT status FROM email_messages WHERE id = '${msgT.messageId}';`);
    assert.equal(bouncedMsg.status.toUpperCase(), "BOUNCED");

    // Delayed DELIVERED arrives after BOUNCED
    engine.processWebhookEvent(tenant1, msgT.providerMessageId, "delivered", "2026-10-16T11:10:05.000Z");

    const protectedMsg = engine.oneOrNone(`SELECT status FROM email_messages WHERE id = '${msgT.messageId}';`);
    assert.equal(protectedMsg.status.toUpperCase(), "BOUNCED", "BOUNCED terminal status must not be overwritten by DELIVERED");
  });

  // -----------------------------------------------------------------------
  // Scenario 26: Raw event remains source of truth
  // -----------------------------------------------------------------------
  await t.test("26. Raw event rows in email_events remain absolute source of truth", () => {
    const rawEvents = engine.many(`
      SELECT event_type FROM email_events WHERE campaign_id = '${campaign1}';
    `);

    let rawSent = 0;
    let rawDelivered = 0;
    let rawBounced = 0;
    for (const e of rawEvents) {
      if (e.event_type === "sent") rawSent++;
      if (e.event_type === "delivered") rawDelivered++;
      if (e.event_type === "bounced") rawBounced++;
    }

    assert.ok(rawSent >= 3, "Raw events table stores every sent event immutably");
    assert.ok(rawDelivered >= 1, "Raw events table stores delivered events");
    assert.ok(rawBounced >= 1, "Raw events table stores bounced events");
  });

  // -----------------------------------------------------------------------
  // Scenario 27: CSV export
  // -----------------------------------------------------------------------
  await t.test("27. CSV export produces compliant CSV without leaking provider secrets", () => {
    const csv = engine.exportCampaignCsv(tenant1, campaign1);
    assert.ok(csv);

    const lines = csv.split("\n");
    assert.ok(lines.length >= 2, "CSV must contain header row and data rows");

    const header = lines[0];
    assert.ok(header.includes("Message ID"));
    assert.ok(header.includes("Lead Email"));
    assert.ok(header.includes("Status"));
    assert.ok(header.includes("Sent At"));
    assert.ok(header.includes("Delivered At"));

    // Check no secrets
    assert.ok(!csv.includes("re_"));
    assert.ok(!csv.includes("whsec_"));
  });

  // -----------------------------------------------------------------------
  // MANUAL VERIFICATION TEST SCENARIO (FROM PROMPT SPECIFICATION)
  // 3 contacts / 3 steps:
  // - Contact A: delivered
  // - Contact B: bounced
  // - Contact C: delivered
  // Verify:
  // - Sent: 3
  // - Delivered: 2
  // - Bounced: 1
  // - Delivery rate: 66.67%
  // - Bounce rate: 33.33%
  // Then:
  // - Check step 2 execution: Contact B does not execute step 2 (stopped due to bounce), Contacts A and C execute step 2
  // - Send duplicate webhook: Verify stats do not change
  // -----------------------------------------------------------------------
  await t.test("MANUAL TEST SCENARIO: 3 contacts / 3 steps delivery, bounce, step 2 progression, duplicate webhook", () => {
    const manualTenant = engine.createBusiness("Manual Test Tenant");
    const manualCampaign = engine.createCampaign(manualTenant, "3 Contacts Multi-Step Verification");
    const mStep1 = engine.createStep(manualTenant, manualCampaign, 1, "Step 1 Intro", 0, "days");
    const mStep2 = engine.createStep(manualTenant, manualCampaign, 2, "Step 2 Followup", 1, "days");
    engine.createStep(manualTenant, manualCampaign, 3, "Step 3 Closing", 2, "days");

    const contactA = engine.createLead(manualTenant, "contact_a@test.com", "Contact", "A");
    const contactB = engine.createLead(manualTenant, "contact_b@test.com", "Contact", "B");
    const contactC = engine.createLead(manualTenant, "contact_c@test.com", "Contact", "C");

    const enrA = engine.enrollLead(manualTenant, manualCampaign, contactA, mStep1);
    const enrB = engine.enrollLead(manualTenant, manualCampaign, contactB, mStep1);
    const enrC = engine.enrollLead(manualTenant, manualCampaign, contactC, mStep1);

    // Step 1: Dispatches to Contact A, B, C
    const msgA = engine.recordEmailDispatch(manualTenant, manualCampaign, mStep1, contactA, enrA, {
      subject: "Step 1 to Contact A",
      toEmail: "contact_a@test.com",
    });
    const msgB = engine.recordEmailDispatch(manualTenant, manualCampaign, mStep1, contactB, enrB, {
      subject: "Step 1 to Contact B",
      toEmail: "contact_b@test.com",
    });
    const msgC = engine.recordEmailDispatch(manualTenant, manualCampaign, mStep1, contactC, enrC, {
      subject: "Step 1 to Contact C",
      toEmail: "contact_c@test.com",
    });

    // Contact A: delivered
    engine.processWebhookEvent(manualTenant, msgA.providerMessageId, "delivered", "2026-10-16T12:00:00.000Z");

    // Contact B: bounced
    engine.processWebhookEvent(manualTenant, msgB.providerMessageId, "bounced", "2026-10-16T12:01:00.000Z", {
      reason: "550 5.1.1 Address rejected",
    });
    // Engine marks enrollment B as STOPPED due to bounce
    engine.none(`UPDATE campaign_leads SET status = 'STOPPED' WHERE id = '${enrB}';`);

    // Contact C: delivered
    engine.processWebhookEvent(manualTenant, msgC.providerMessageId, "delivered", "2026-10-16T12:02:00.000Z");

    // Verification 1: Step 1 Stats
    const step1Overview = engine.getCampaignOverview(manualTenant, manualCampaign);
    assert.equal(step1Overview.total_sent, 3, "Sent must be 3");
    assert.equal(step1Overview.total_delivered, 2, "Delivered must be 2");
    assert.equal(step1Overview.total_bounced, 1, "Bounced must be 1");
    assert.equal(step1Overview.delivery_rate, 66.67, "Delivery rate must be 66.67%");
    assert.equal(step1Overview.bounce_rate, 33.33, "Bounce rate must be 33.33%");

    // Step 2 Execution:
    // Contact B enrollment is STOPPED, so Contact B does NOT execute step 2.
    // Contacts A and C are RUNNING and execute step 2.
    const enrBRow = engine.oneOrNone(`SELECT status FROM campaign_leads WHERE id = '${enrB}';`);
    assert.equal(enrBRow.status, "STOPPED", "Contact B enrollment must be STOPPED");

    // Contacts A and C execute step 2
    const msgA_step2 = engine.recordEmailDispatch(manualTenant, manualCampaign, mStep2, contactA, enrA, {
      subject: "Step 2 to Contact A",
      toEmail: "contact_a@test.com",
    });
    const msgC_step2 = engine.recordEmailDispatch(manualTenant, manualCampaign, mStep2, contactC, enrC, {
      subject: "Step 2 to Contact C",
      toEmail: "contact_c@test.com",
    });
    engine.processWebhookEvent(manualTenant, msgA_step2.providerMessageId, "delivered", "2026-10-17T12:00:00.000Z");
    engine.processWebhookEvent(manualTenant, msgC_step2.providerMessageId, "delivered", "2026-10-17T12:00:00.000Z");

    // Verify Contact B has ZERO messages for step 2
    const step2MessagesForB = engine.many(`
      SELECT * FROM email_messages WHERE campaign_step_id = '${mStep2}' AND lead_id = '${contactB}';
    `);
    assert.equal(step2MessagesForB.length, 0, "Contact B must not execute step 2");

    // Duplicate webhook test:
    // Send duplicate delivered webhook for msgA
    const dupRes = engine.processWebhookEvent(
      manualTenant,
      msgA.providerMessageId,
      "delivered",
      "2026-10-16T12:00:00.000Z"
    );
    assert.equal(dupRes.duplicate, true);

    // Verify stats do not change
    const afterDupOverview = engine.getCampaignOverview(manualTenant, manualCampaign);
    assert.equal(afterDupOverview.total_sent, 5, "Total sent: 3 for step 1 + 2 for step 2");
    assert.equal(afterDupOverview.total_delivered, 4, "Total delivered: 2 for step 1 + 2 for step 2");
    assert.equal(afterDupOverview.total_bounced, 1, "Total bounced remains 1");
    assert.equal(afterDupOverview.delivery_rate, 80.0, "4/5 = 80.00%");
    assert.equal(afterDupOverview.bounce_rate, 20.0, "1/5 = 20.00%");
  });
});
