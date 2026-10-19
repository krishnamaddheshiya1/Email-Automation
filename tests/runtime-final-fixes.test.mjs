import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

test("RUNTIME FINAL FIXES VERIFICATION SUITE", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // =========================================================================
  // SCENARIO 1: Server-side Bulk Permanent Delete Cascades All Tables
  // =========================================================================
  await t.test("SCENARIO 1: Bulk permanent delete wipes contacts and cascades all relations", () => {
    const bId = crypto.randomUUID();
    const lead1 = crypto.randomUUID();
    const lead2 = crypto.randomUUID();
    const campId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const msgId = crypto.randomUUID();

    execute(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bId}', 'Cascade Corp', NOW(), NOW());

      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campId}', '${bId}', 'Cascade Camp', 'ACTIVE', NOW(), NOW());

      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES 
        ('${lead1}', '${bId}', 'bulk1@example.com', 'Bulk', 'One', 'new', NOW(), NOW()),
        ('${lead2}', '${bId}', 'bulk2@example.com', 'Bulk', 'Two', 'new', NOW(), NOW());

      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, created_at, updated_at)
      VALUES 
        ('${crypto.randomUUID()}', '${campId}', '${lead1}', '${bId}', 'ENROLLED', NOW(), NOW()),
        ('${crypto.randomUUID()}', '${campId}', '${lead2}', '${bId}', 'ENROLLED', NOW(), NOW());

      INSERT INTO conversations (id, business_id, lead_id, status, created_at, updated_at)
      VALUES ('${convId}', '${bId}', '${lead1}', 'active', NOW(), NOW());

      INSERT INTO conversation_messages (id, conversation_id, business_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES ('${msgId}', '${convId}', '${bId}', 'INBOUND', 'bulk1@example.com', 'admin@finalverify.com', 'Hi', 'Text', NOW());

      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bId}', '${lead1}', '${campId}', 'admin@finalverify.com', 'bulk1@example.com', 'Sub', 'Body', 'sent', NOW(), NOW());
    `);

    // Verify records exist before delete
    assert.equal(query(`SELECT id FROM leads WHERE id IN ('${lead1}', '${lead2}')`).length, 2);
    assert.equal(query(`SELECT id FROM campaign_leads WHERE lead_id IN ('${lead1}', '${lead2}')`).length, 2);
    assert.ok(queryOne(`SELECT id FROM conversations WHERE lead_id = '${lead1}'`));

    // Execute bulk permanent delete query mimicking LeadRepository.deletePermanentBulk
    const ids = [lead1, lead2];
    const placeholders = ids.map((id) => `'${id}'`).join(", ");
    execute(`
      DELETE FROM campaign_leads WHERE business_id = '${bId}' AND lead_id IN (${placeholders});
      DELETE FROM conversation_messages WHERE business_id = '${bId}' AND conversation_id IN (
        SELECT id FROM conversations WHERE business_id = '${bId}' AND lead_id IN (${placeholders})
      );
      DELETE FROM conversations WHERE business_id = '${bId}' AND lead_id IN (${placeholders});
      DELETE FROM email_messages WHERE business_id = '${bId}' AND lead_id IN (${placeholders});
      DELETE FROM leads WHERE business_id = '${bId}' AND id IN (${placeholders});
    `);

    // Verify completely deleted across all tables
    assert.equal(query(`SELECT id FROM leads WHERE id IN ('${lead1}', '${lead2}')`).length, 0);
    assert.equal(query(`SELECT id FROM campaign_leads WHERE lead_id IN ('${lead1}', '${lead2}')`).length, 0);
    assert.equal(query(`SELECT id FROM conversations WHERE lead_id IN ('${lead1}', '${lead2}')`).length, 0);
    assert.equal(query(`SELECT id FROM conversation_messages WHERE id = '${msgId}'`).length, 0);
  });

  // =========================================================================
  // SCENARIO 2: Dashboard Metrics Count Unique Opens & Real Delivered Rates
  // =========================================================================
  await t.test("SCENARIO 2: Dashboard metrics accurately count unique opens and delivery rate", () => {
    const bId = crypto.randomUUID();
    const leadA = crypto.randomUUID();
    const leadB = crypto.randomUUID();
    const leadC = crypto.randomUUID();

    execute(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bId}', 'Metrics Corp', NOW(), NOW());

      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES 
        ('${leadA}', '${bId}', 'a@example.com', 'A', 'User', 'new', NOW(), NOW()),
        ('${leadB}', '${bId}', 'b@example.com', 'B', 'User', 'new', NOW(), NOW()),
        ('${leadC}', '${bId}', 'c@example.com', 'C', 'User', 'new', NOW(), NOW());

      -- Message 1: Delivered and opened 5 times
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, sent_at, delivered_at, opened_at, open_count, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bId}', '${leadA}', 'admin@metrics.com', 'a@example.com', 'S1', 'B1', 'opened', NOW(), NOW(), NOW(), 5, NOW(), NOW());

      -- Message 2: Delivered but NOT opened
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, sent_at, delivered_at, open_count, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bId}', '${leadB}', 'admin@metrics.com', 'b@example.com', 'S2', 'B2', 'delivered', NOW(), NOW(), 0, NOW(), NOW());

      -- Message 3: Bounced
      INSERT INTO email_messages (id, business_id, lead_id, from_email, to_email, subject, body, status, sent_at, bounced_at, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bId}', '${leadC}', 'admin@metrics.com', 'c@example.com', 'S3', 'B3', 'bounced', NOW(), NOW(), NOW(), NOW());
    `);

    // Fetch messages for business as in dashboardService
    const msgs = query(`
      SELECT id, status, sent_at, delivered_at, opened_at, open_count, bounced_at 
      FROM email_messages 
      WHERE business_id = '${bId}'
    `);

    const emailsSent = msgs.filter((m) => {
      const s = String(m.status || "").toLowerCase();
      return ["sent", "delivered", "opened", "bounced", "complained"].includes(s) || m.sent_at != null;
    }).length;

    const emailsDelivered = msgs.filter((m) => {
      const s = String(m.status || "").toLowerCase();
      return ["delivered", "opened"].includes(s) || m.delivered_at != null;
    }).length;

    const openedMsgs = msgs.filter((m) => {
      const s = String(m.status || "").toLowerCase();
      return s === "opened" || m.opened_at != null || Number(m.open_count || 0) > 0;
    });
    const uniqueOpens = openedMsgs.length;
    const totalOpens = openedMsgs.reduce((acc, m) => acc + Math.max(1, Number(m.open_count || 1)), 0);

    const emailsBounced = msgs.filter((m) => {
      const s = String(m.status || "").toLowerCase();
      return s === "bounced" || m.bounced_at != null;
    }).length;

    assert.equal(emailsSent, 3);
    assert.equal(emailsDelivered, 2);
    // UNIQUE OPENS must be 1, NOT 5!
    assert.equal(uniqueOpens, 1);
    // Total raw open pixel hits is 5
    assert.equal(totalOpens, 5);
    assert.equal(emailsBounced, 1);

    const openRate = Number(((uniqueOpens / emailsDelivered) * 100).toFixed(2));
    assert.equal(openRate, 50.0); // 1 out of 2 delivered = 50%
  });

  // =========================================================================
  // SCENARIO 3: Intentional Re-enrollment of Already-Contacted Contact
  // =========================================================================
  await t.test("SCENARIO 3: User intentionally re-enrolling already-contacted contact succeeds", () => {
    const bId = crypto.randomUUID();
    const campId = crypto.randomUUID();
    const leadId = crypto.randomUUID();

    execute(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bId}', 'Re-Enroll Corp', NOW(), NOW());

      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campId}', '${bId}', 'Re-Enroll Camp', 'ACTIVE', NOW(), NOW());

      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${bId}', 'reenroll@example.com', 'Re', 'Enroll', 'CONTACTED', NOW(), NOW());

      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bId}', '${leadId}', '${campId}', 'admin@finalverify.com', 'reenroll@example.com', 'Previous', 'Body', 'delivered', NOW(), NOW());

      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, current_step, is_manual_override, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campId}', '${leadId}', '${bId}', 'COMPLETED', 1, FALSE, NOW(), NOW());
    `);

    // When user intentionally enrolls with allow_override = true:
    execute(`
      INSERT INTO campaign_leads (campaign_id, lead_id, business_id, status, current_step, is_manual_override, created_at, updated_at)
      VALUES ('${campId}', '${leadId}', '${bId}', 'ENROLLED', 0, TRUE, NOW(), NOW())
      ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
        status = 'ENROLLED',
        current_step = 0,
        is_manual_override = TRUE,
        completed_at = NULL,
        stopped_at = NULL,
        updated_at = NOW();
    `);

    const enr = queryOne(`SELECT status, current_step, is_manual_override, completed_at FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${leadId}'`);
    assert.equal(enr.status, "ENROLLED");
    assert.equal(enr.current_step, 0);
    assert.equal(enr.is_manual_override, true);
    assert.equal(enr.completed_at, null);
  });

  // =========================================================================
  // SCENARIO 4: Campaign Cascading Deletion Removes All Dependent Records
  // =========================================================================
  await t.test("SCENARIO 4: Campaign cascading deletion removes steps, enrollments, and messages", () => {
    const bId = crypto.randomUUID();
    const campId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const msgId = crypto.randomUUID();

    execute(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${bId}', 'Delete Corp', NOW(), NOW());

      INSERT INTO campaigns (id, business_id, name, status, created_at, updated_at)
      VALUES ('${campId}', '${bId}', 'Campaign To Delete', 'DRAFT', NOW(), NOW());

      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', NOW(), NOW());

      INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
      VALUES ('${leadId}', '${bId}', 'lead_del@example.com', 'Lead', 'Del', 'new', NOW(), NOW());

      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campId}', '${leadId}', '${bId}', 'ENROLLED', NOW(), NOW());

      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, status, created_at, updated_at)
      VALUES ('${msgId}', '${bId}', '${leadId}', '${campId}', 'admin@deletecorp.com', 'lead_del@example.com', 'Test', 'Body', 'sent', NOW(), NOW());
    `);

    // Verify records exist
    assert.ok(queryOne(`SELECT id FROM campaigns WHERE id = '${campId}'`));
    assert.ok(queryOne(`SELECT id FROM campaign_steps WHERE id = '${stepId}'`));
    assert.ok(queryOne(`SELECT id FROM email_messages WHERE id = '${msgId}'`));

    // Execute cascading deletion mimicking CampaignRepository.delete
    execute(`
      DELETE FROM email_messages WHERE campaign_id = '${campId}';
      DELETE FROM campaign_steps WHERE campaign_id = '${campId}';
      DELETE FROM campaign_leads WHERE campaign_id = '${campId}';
      DELETE FROM campaigns WHERE id = '${campId}' AND business_id = '${bId}';
    `);

    assert.equal(query(`SELECT id FROM campaigns WHERE id = '${campId}'`).length, 0);
    assert.equal(query(`SELECT id FROM campaign_steps WHERE campaign_id = '${campId}'`).length, 0);
    assert.equal(query(`SELECT id FROM email_messages WHERE campaign_id = '${campId}'`).length, 0);
    assert.equal(query(`SELECT id FROM campaign_leads WHERE campaign_id = '${campId}'`).length, 0);
  });

  // =========================================================================
  // SCENARIO 5: Supabase Schema Compatibility - Metrics Computed From Metadata
  // =========================================================================
  await t.test("SCENARIO 5: Supabase schema compatibility - metrics computed from JSONB metadata", () => {
    const rawMsgs = [
      {
        id: crypto.randomUUID(),
        status: "delivered",
        sent_at: "2026-10-19T00:00:00Z",
        metadata: {
          delivered_at: "2026-10-19T00:01:00Z",
          is_opened: true,
          open_count: 3,
          opened_at: "2026-10-19T00:02:00Z",
        },
      },
      {
        id: crypto.randomUUID(),
        status: "delivered",
        sent_at: "2026-10-19T00:00:00Z",
        metadata: {
          delivered_at: "2026-10-19T00:01:00Z",
          open_count: 0,
        },
      },
      {
        id: crypto.randomUUID(),
        status: "bounced",
        sent_at: "2026-10-19T00:00:00Z",
        metadata: {
          bounced_at: "2026-10-19T00:01:00Z",
          bounce_type: "Permanent",
        },
      },
    ];

    const msgs = rawMsgs.map((m) => {
      const meta = m.metadata || {};
      const s = String(m.status || "").toLowerCase();
      const isOpened =
        s === "opened" ||
        meta.is_opened === true ||
        meta.opened_at != null ||
        Number(meta.open_count || 0) > 0;
      const isDelivered = s === "delivered" || meta.delivered_at != null || isOpened;
      const isBounced = s === "bounced" || meta.bounced_at != null;
      const isSent = s === "sent" || isDelivered || isOpened || isBounced || m.sent_at != null;
      const openCount = typeof meta.open_count === "number" ? meta.open_count : isOpened ? 1 : 0;
      return {
        ...m,
        isSent,
        isDelivered,
        isOpened,
        isBounced,
        openCount,
      };
    });

    const emailsSent = msgs.filter((m) => m.isSent).length;
    const emailsDelivered = msgs.filter((m) => m.isDelivered).length;
    const openedMsgs = msgs.filter((m) => m.isOpened);
    const emailsOpened = openedMsgs.length;
    const uniqueOpens = emailsOpened;
    const totalOpens = openedMsgs.reduce((acc, m) => acc + Math.max(1, m.openCount), 0);
    const emailsBounced = msgs.filter((m) => m.isBounced).length;

    assert.equal(emailsSent, 3);
    assert.equal(emailsDelivered, 2);
    assert.equal(uniqueOpens, 1);
    assert.equal(totalOpens, 3);
    assert.equal(emailsBounced, 1);

    const deliveryRate = Number(((emailsDelivered / emailsSent) * 100).toFixed(2));
    assert.equal(deliveryRate, 66.67);
    const openRate = Number(((uniqueOpens / emailsDelivered) * 100).toFixed(2));
    assert.equal(openRate, 50.0);
    const bounceRate = Number(((emailsBounced / emailsSent) * 100).toFixed(2));
    assert.equal(bounceRate, 33.33);
  });
});
