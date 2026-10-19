import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./test-harness.mjs";

test("Database Foundation Test Suite", async (t) => {
  const { db, seed } = createTestDb();

  await t.test("1. Migration runs successfully", () => {
    // Schema & indexes executed without throwing during createTestDb
    assert.ok(db, "Test database instance initialized and migrations applied");
  });

  await t.test("2. All 12 core tables are created", () => {
    const expectedTables = [
      "businesses",
      "users",
      "leads",
      "campaigns",
      "campaign_steps",
      "email_templates",
      "email_messages",
      "email_events",
      "conversations",
      "automation_runs",
      "activities",
      "suppressions",
    ];

    const tables = db.public
      .many(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
      )
      .map((r) => r.table_name);

    for (const table of expectedTables) {
      assert.ok(
        tables.includes(table),
        `Table "${table}" must exist in the database schema`
      );
    }
  });

  await t.test("Seed data executes and populates core demo entities", () => {
    seed();

    const businesses = db.public.many("SELECT * FROM businesses;");
    assert.equal(businesses.length, 2, "Expected 2 seed businesses");

    const users = db.public.many("SELECT * FROM users;");
    assert.equal(users.length, 2, "Expected 2 seed users");

    const leads = db.public.many("SELECT * FROM leads;");
    assert.equal(leads.length, 3, "Expected 3 seed leads");

    const templates = db.public.many("SELECT * FROM email_templates;");
    assert.equal(templates.length, 2, "Expected 2 seed templates");

    const campaigns = db.public.many("SELECT * FROM campaigns;");
    assert.equal(campaigns.length, 2, "Expected 2 seed campaigns");

    const steps = db.public.many("SELECT * FROM campaign_steps;");
    assert.equal(steps.length, 2, "Expected 2 seed campaign steps");

    const messages = db.public.many("SELECT * FROM email_messages;");
    assert.equal(messages.length, 2, "Expected 2 seed messages");

    const events = db.public.many("SELECT * FROM email_events;");
    assert.equal(events.length, 3, "Expected 3 seed email events");
  });

  await t.test("3. Foreign keys enforce referential integrity", () => {
    // Attempting to insert a lead with non-existent business_id should throw FK violation
    assert.throws(
      () => {
        db.public.none(`
          INSERT INTO leads (business_id, email)
          VALUES ('ffffffff-ffff-4000-8000-ffffffffffff', 'bad-fk@example.test');
        `);
      },
      /foreign key/i,
      "Expected foreign key constraint violation on non-existent business_id"
    );

    // Attempting to insert campaign step with non-existent campaign_id should throw FK violation
    assert.throws(
      () => {
        db.public.none(`
          INSERT INTO campaign_steps (campaign_id, step_number, name)
          VALUES ('ffffffff-ffff-4000-8000-ffffffffffff', 1, 'Invalid Step');
        `);
      },
      /foreign key/i,
      "Expected foreign key constraint violation on non-existent campaign_id"
    );
  });

  await t.test("4. Unique constraints work", () => {
    // Duplicate lead email in SAME business must fail
    assert.throws(
      () => {
        db.public.none(`
          INSERT INTO leads (business_id, email)
          VALUES ('b0000000-0000-4000-8000-000000000001', 'jordan.lee@example-client.test');
        `);
      },
      /unique/i,
      "Expected unique constraint violation on duplicate (business_id, email) in leads"
    );

    // Duplicate step_number in SAME campaign must fail
    assert.throws(
      () => {
        db.public.none(`
          INSERT INTO campaign_steps (campaign_id, step_number, name)
          VALUES ('c0000000-0000-4000-8000-000000000001', 1, 'Duplicate Step Number');
        `);
      },
      /unique/i,
      "Expected unique constraint violation on duplicate (campaign_id, step_number)"
    );

    // Duplicate suppression email in SAME business must fail
    assert.throws(
      () => {
        db.public.none(`
          INSERT INTO suppressions (business_id, email, reason)
          VALUES ('b0000000-0000-4000-8000-000000000001', 'optout@example-suppressed.test', 'unsubscribe');
        `);
      },
      /unique/i,
      "Expected unique constraint violation on duplicate (business_id, email) in suppressions"
    );
  });

  await t.test("5. A business can have multiple leads", () => {
    const business1Leads = db.public.many(`
      SELECT id, email FROM leads WHERE business_id = 'b0000000-0000-4000-8000-000000000001';
    `);

    assert.ok(
      business1Leads.length >= 2,
      "Business 1 should have multiple leads associated"
    );

    // Insert another lead for business 1
    db.public.none(`
      INSERT INTO leads (business_id, email, first_name, last_name, status)
      VALUES ('b0000000-0000-4000-8000-000000000001', 'extra.lead@example.test', 'Extra', 'Lead', 'new');
    `);

    const updatedLeads = db.public.many(`
      SELECT id FROM leads WHERE business_id = 'b0000000-0000-4000-8000-000000000001';
    `);
    assert.equal(updatedLeads.length, business1Leads.length + 1);

    // Same email can exist in DIFFERENT business (multi-tenant isolation)
    db.public.none(`
      INSERT INTO leads (business_id, email, first_name)
      VALUES ('b0000000-0000-4000-8000-000000000002', 'extra.lead@example.test', 'Tenant2 Lead');
    `);

    const tenant2Lead = db.public.one(`
      SELECT * FROM leads WHERE business_id = 'b0000000-0000-4000-8000-000000000002' AND email = 'extra.lead@example.test';
    `);
    assert.equal(tenant2Lead.first_name, "Tenant2 Lead");
  });

  await t.test("6. A campaign belongs to one business", () => {
    const campaign = db.public.one(`
      SELECT c.id, c.name, b.name as business_name, c.business_id
      FROM campaigns c
      JOIN businesses b ON c.business_id = b.id
      WHERE c.id = 'c0000000-0000-4000-8000-000000000001';
    `);

    assert.equal(campaign.business_name, "Acme Corp Demo");
    assert.equal(campaign.business_id, "b0000000-0000-4000-8000-000000000001");
  });

  await t.test("7. A campaign step belongs to one campaign", () => {
    const steps = db.public.many(`
      SELECT cs.id, cs.step_number, cs.name, c.name as campaign_name, cs.campaign_id
      FROM campaign_steps cs
      JOIN campaigns c ON cs.campaign_id = c.id
      WHERE cs.campaign_id = 'c0000000-0000-4000-8000-000000000001'
      ORDER BY cs.step_number ASC;
    `);

    assert.equal(steps.length, 2);
    assert.equal(steps[0].step_number, 1);
    assert.equal(steps[1].step_number, 2);
    assert.equal(steps[0].campaign_name, "Q4 Outbound SaaS Expansion");
  });

  await t.test("8. Email messages can reference leads and campaigns", () => {
    const message = db.public.one(`
      SELECT
        m.id,
        m.subject,
        m.status,
        l.email as lead_email,
        c.name as campaign_name,
        cs.step_number,
        t.name as template_name
      FROM email_messages m
      JOIN leads l ON m.lead_id = l.id
      LEFT JOIN campaigns c ON m.campaign_id = c.id
      LEFT JOIN campaign_steps cs ON m.campaign_step_id = cs.id
      LEFT JOIN email_templates t ON m.template_id = t.id
      WHERE m.id = '10000000-0000-4000-8000-000000000001';
    `);

    assert.equal(message.lead_email, "jordan.lee@example-client.test");
    assert.equal(message.campaign_name, "Q4 Outbound SaaS Expansion");
    assert.equal(message.step_number, 1);
    assert.equal(message.template_name, "Demo Outreach Step 1");
    assert.equal(message.status, "sent");
  });

  await t.test("9. Email events can reference email messages", () => {
    const events = db.public.many(`
      SELECT e.id, e.event_type, m.subject, m.to_email
      FROM email_events e
      JOIN email_messages m ON e.email_message_id = m.id
      WHERE e.email_message_id = '10000000-0000-4000-8000-000000000001'
      ORDER BY e.created_at ASC;
    `);

    assert.equal(events.length, 3);
    const eventTypes = events.map((e) => e.event_type);
    assert.ok(eventTypes.includes("sent"));
    assert.ok(eventTypes.includes("delivered"));
    assert.ok(eventTypes.includes("opened"));
  });

  await t.test("10. Suppressions are associated with the correct business", () => {
    const business1Suppression = db.public.many(`
      SELECT * FROM suppressions
      WHERE business_id = 'b0000000-0000-4000-8000-000000000001'
        AND email = 'optout@example-suppressed.test';
    `);
    assert.equal(business1Suppression.length, 1);
    assert.equal(business1Suppression[0].reason, "unsubscribe");

    // Business 2 should NOT see business 1's suppression (multi-tenant boundary)
    const business2Suppression = db.public.many(`
      SELECT * FROM suppressions
      WHERE business_id = 'b0000000-0000-4000-8000-000000000002'
        AND email = 'optout@example-suppressed.test';
    `);
    assert.equal(
      business2Suppression.length,
      0,
      "Business 2 must not see Business 1 suppressions"
    );
  });
});
