import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { renderTemplate } from "../lib/utils/template.ts";

/**
 * Mock Email Provider for testing campaign step dispatch
 */
class MockEmailProvider {
  constructor(options = {}) {
    this.name = "mock";
    this.shouldFail = options.shouldFail || false;
    this.errorCode = options.errorCode || "MOCK_ERROR";
    this.errorMessage = options.errorMessage || "Mock provider failure";
    this.sentEmails = [];
  }

  isConfigured() {
    return true;
  }

  clear() {
    this.sentEmails = [];
    this.shouldFail = false;
    this.errorCode = "MOCK_ERROR";
    this.errorMessage = "Mock provider failure";
  }

  async sendEmail(payload) {
    if (this.shouldFail) {
      return {
        success: false,
        status: "FAILED",
        error: {
          code: this.errorCode,
          message: this.errorMessage,
        },
      };
    }

    const providerMessageId = `mock_prov_${crypto.randomUUID()}`;
    this.sentEmails.push({
      ...payload,
      providerMessageId,
      dispatchedAt: new Date().toISOString(),
    });

    return {
      success: true,
      providerMessageId,
      status: "SENT",
    };
  }
}

/**
 * Campaign Lifecycle Engine for pg-mem testing
 */
class TestCampaignLifecycleEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.provider = options.provider || new MockEmailProvider();
    this.maxRetries = options.maxRetries ?? 3;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  calculateNextRunAt(delayValue, delayUnit, fromDate = new Date()) {
    if (!delayValue || delayValue <= 0) {
      return new Date(fromDate.getTime() - 1000).toISOString();
    }
    const msMultiplier = {
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
    }[delayUnit] || 24 * 60 * 60 * 1000;

    return new Date(fromDate.getTime() + delayValue * msMultiplier).toISOString();
  }

  /**
   * Enrolls contacts into a campaign with full initialization:
   * contact_id, email, first step, next_run_at, status
   */
  enrollContacts(campaignId, businessId, contactIds) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    // Resolve first active step
    const firstStep = this.oneOrNone(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' AND status = 'ACTIVE' ORDER BY step_number ASC LIMIT 1;`
    );

    let nextStepId = null;
    let nextRunAt = null;
    if (firstStep) {
      nextStepId = firstStep.id;
      nextRunAt = this.calculateNextRunAt(firstStep.delay_value, firstStep.delay_unit);
    }

    let enrolledCount = 0;
    let skippedCount = 0;

    for (const cid of contactIds) {
      const contact = this.oneOrNone(
        `SELECT * FROM leads WHERE id = '${cid}' AND business_id = '${businessId}';`
      );
      if (!contact || !contact.email) {
        skippedCount++;
        continue;
      }

      // Check duplicate
      const existing = this.oneOrNone(
        `SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${cid}';`
      );

      const metadataJson = JSON.stringify({
        email: contact.email,
        first_name: contact.first_name || "",
        last_name: contact.last_name || "",
        company_name: contact.company_name || "",
      });

      if (existing) {
        if (existing.status.toUpperCase() === "REMOVED") {
          this.db.public.none(`
            UPDATE campaign_leads
            SET status = 'ENROLLED',
                email = '${contact.email}',
                next_step_id = ${nextStepId ? `'${nextStepId}'` : "NULL"},
                next_run_at = ${nextRunAt ? `'${nextRunAt}'` : "NULL"},
                metadata = '${metadataJson}'::jsonb,
                updated_at = NOW()
            WHERE id = '${existing.id}';
          `);
          enrolledCount++;
        } else {
          // Idempotent re-enrollment preserves row
          skippedCount++;
        }
      } else {
        const enrollmentId = crypto.randomUUID();
        this.db.public.none(`
          INSERT INTO campaign_leads (
            id, campaign_id, lead_id, business_id, status, email,
            current_step, current_step_id, next_step_id, next_run_at,
            metadata, enrolled_at, created_at, updated_at
          ) VALUES (
            '${enrollmentId}', '${campaignId}', '${cid}', '${businessId}', 'ENROLLED', '${contact.email}',
            0, ${nextStepId ? `'${nextStepId}'` : "NULL"}, ${nextStepId ? `'${nextStepId}'` : "NULL"},
            ${nextRunAt ? `'${nextRunAt}'` : "NULL"}, '${metadataJson}'::jsonb, NOW(), NOW(), NOW()
          );
        `);
        enrolledCount++;
      }
    }

    return { enrolledCount, skippedCount };
  }

  /**
   * Initializes or heals enrollments for a campaign when activated
   */
  initializeCampaignEnrollments(campaignId, businessId) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign || campaign.status.toUpperCase() !== "ACTIVE") {
      return 0;
    }

    const firstStep = this.oneOrNone(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' AND status = 'ACTIVE' ORDER BY step_number ASC LIMIT 1;`
    );
    if (!firstStep) return 0;

    const nextRun = this.calculateNextRunAt(firstStep.delay_value, firstStep.delay_unit);

    this.db.public.none(`
      UPDATE campaign_leads
      SET current_step_id = '${firstStep.id}',
          next_step_id = '${firstStep.id}',
          next_run_at = '${nextRun}',
          status = 'ENROLLED',
          updated_at = NOW()
      WHERE campaign_id = '${campaignId}'
        AND business_id = '${businessId}'
        AND status IN ('ENROLLED', 'running')
        AND (current_step = 0 OR next_step_id IS NULL);
    `);

    return 1;
  }

  /**
   * Lists enrolled contacts with joined lead details
   */
  getEnrolledContacts(campaignId, businessId) {
    const rows = this.db.public.many(`
      SELECT cl.*,
             l.first_name, l.last_name, l.email as lead_email, l.company_name
      FROM campaign_leads cl
      LEFT JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = '${campaignId}' AND cl.business_id = '${businessId}'
      ORDER BY cl.enrolled_at DESC;
    `);

    return rows.map((r) => {
      const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {};
      const email = r.lead_email || r.email || meta.email || "";
      const firstName = r.first_name || meta.first_name || "";
      const lastName = r.last_name || meta.last_name || "";
      return {
        ...r,
        email,
        lead: {
          id: r.lead_id,
          first_name: firstName,
          last_name: lastName,
          email,
          company_name: r.company_name || meta.company_name || "",
        },
      };
    });
  }

  /**
   * Simulates POST /api/campaigns/[id]/run-due
   */
  async runDueJobs(campaignId, businessId) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    if (campaign.status.toUpperCase() === "PAUSED") {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        diagnostic: "Campaign is currently paused. Please resume the campaign to run due jobs.",
      };
    }

    if (campaign.status.toUpperCase() === "DRAFT") {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        diagnostic: "Campaign is in DRAFT status. Please activate the campaign to execute sequence steps.",
      };
    }

    // Auto-heal uninitialized enrollments for active campaign
    this.initializeCampaignEnrollments(campaignId, businessId);

    // Query due enrollments
    const claimedRows = this.db.public.many(`
      SELECT cl.*, c.status as c_status
      FROM campaign_leads cl
      JOIN campaigns c ON c.id = cl.campaign_id
      WHERE cl.campaign_id = '${campaignId}'
        AND cl.business_id = '${businessId}'
        AND c.status = 'ACTIVE'
        AND cl.status IN ('ENROLLED', 'RUNNING')
        AND cl.next_run_at IS NOT NULL
        AND cl.next_run_at <= NOW()
      ORDER BY cl.next_run_at ASC;
    `);

    if (!claimedRows || claimedRows.length === 0) {
      // Diagnostic analysis
      const allEnrollments = this.db.public.many(
        `SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}';`
      );

      if (!allEnrollments || allEnrollments.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, diagnostic: "No contacts are enrolled in this campaign." };
      }

      const activeEnrollments = allEnrollments.filter((e) =>
        ["ENROLLED", "RUNNING"].includes(e.status.toUpperCase())
      );
      if (activeEnrollments.length === 0) {
        const allCompleted = allEnrollments.every((e) => e.status.toUpperCase() === "COMPLETED");
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          diagnostic: allCompleted
            ? "All enrolled contacts have already completed the campaign sequence."
            : "No active enrollments available.",
        };
      }

      const futureDates = activeEnrollments
        .map((e) => (e.next_run_at ? new Date(e.next_run_at).getTime() : null))
        .filter((t) => t !== null && t > Date.now());

      if (futureDates.length > 0) {
        const earliest = new Date(Math.min(...futureDates));
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          diagnostic: `Next step execution is scheduled for ${earliest.toISOString()} (step delay not yet reached).`,
        };
      }

      return { processed: 0, succeeded: 0, failed: 0, diagnostic: "No due enrollments are currently ready for execution." };
    }

    let succeeded = 0;
    let failed = 0;

    for (const enr of claimedRows) {
      // Lock to RUNNING
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'RUNNING', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = '${enr.id}';
      `);

      const steps = this.db.public.many(`
        SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' AND status = 'ACTIVE' ORDER BY step_number ASC;
      `);
      if (!steps || steps.length === 0) continue;

      const currentStepNum = enr.current_step || 0;
      const stepToRun = steps.find((s) => s.step_number > currentStepNum) || steps[0];

      // Contact lookup
      const contact = this.oneOrNone(`
        SELECT * FROM leads WHERE id = '${enr.lead_id}' AND business_id = '${businessId}';
      `);
      if (!contact) {
        failed++;
        this.db.public.none(`
          UPDATE campaign_leads SET status = 'FAILED', last_error = 'CONTACT_NOT_FOUND' WHERE id = '${enr.id}';
        `);
        continue;
      }

      // Template lookup
      const template = this.oneOrNone(`
        SELECT * FROM email_templates WHERE id = '${stepToRun.template_id}' AND business_id = '${businessId}';
      `);
      if (!template) {
        failed++;
        this.db.public.none(`
          UPDATE campaign_leads SET status = 'FAILED', last_error = 'TEMPLATE_NOT_FOUND' WHERE id = '${enr.id}';
        `);
        continue;
      }

      // Render template
      const rendered = renderTemplate(
        { subject: template.subject, body: template.body },
        { first_name: contact.first_name, last_name: contact.last_name, email: contact.email }
      );

      // Dispatch via provider
      const sendRes = await this.provider.sendEmail({
        to: contact.email,
        subject: rendered.subject,
        body: rendered.body,
        campaignId,
        stepId: stepToRun.id,
      });

      if (sendRes.success) {
        succeeded++;

        // Record SENT event in email_events
        this.db.public.none(`
          INSERT INTO email_events (id, business_id, event_type, campaign_id, campaign_step_id, lead_id, enrollment_id, metadata, created_at)
          VALUES ('${crypto.randomUUID()}', '${businessId}', 'sent', '${campaignId}', '${stepToRun.id}', '${contact.id}', '${enr.id}', '{"recipient_email":"${contact.email}"}'::jsonb, NOW());
        `);

        // Find next step
        const nextStep = steps.find((s) => s.step_number > stepToRun.step_number);
        if (nextStep) {
          const nextRun = this.calculateNextRunAt(nextStep.delay_value, nextStep.delay_unit);
          this.db.public.none(`
            UPDATE campaign_leads
            SET current_step = ${stepToRun.step_number},
                current_step_id = '${nextStep.id}',
                next_step_id = '${nextStep.id}',
                next_run_at = '${nextRun}',
                status = 'RUNNING',
                last_error = NULL,
                retry_count = 0,
                updated_at = NOW()
            WHERE id = '${enr.id}';
          `);
        } else {
          this.db.public.none(`
            UPDATE campaign_leads
            SET current_step = ${stepToRun.step_number},
                next_step_id = NULL,
                next_run_at = NULL,
                status = 'COMPLETED',
                completed_at = NOW(),
                last_error = NULL,
                retry_count = 0,
                updated_at = NOW()
            WHERE id = '${enr.id}';
          `);
        }
      } else {
        failed++;
        const nextRetry = (enr.retry_count || 0) + 1;
        const willFail = nextRetry >= this.maxRetries;
        this.db.public.none(`
          UPDATE campaign_leads
          SET status = '${willFail ? "FAILED" : "RUNNING"}',
              retry_count = ${nextRetry},
              last_error = '${sendRes.error?.message || "Provider send failed"}',
              updated_at = NOW()
          WHERE id = '${enr.id}';
        `);
      }
    }

    return {
      processed: claimedRows.length,
      succeeded,
      failed,
      diagnostic: null,
    };
  }
}

test("Campaign Enrollment & Execution Lifecycle Test Suite", async (t) => {
  const { db } = createTestDb();

  // 1. Setup isolated businesses
  const bizA = crypto.randomUUID();
  const bizB = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizA}', 'Alpha Business', 'UTC', 'active'),
           ('${bizB}', 'Beta Business', 'UTC', 'active');
  `);

  // 2. Setup contacts
  const contactA1 = crypto.randomUUID();
  const contactA2 = crypto.randomUUID();
  const contactB1 = crypto.randomUUID();

  db.public.none(`
    INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
    VALUES ('${contactA1}', '${bizA}', 'Alice', 'Smith', 'alice@alpha.com', 'Alpha Corp', 'new'),
           ('${contactA2}', '${bizA}', 'Bob', 'Jones', 'bob@alpha.com', 'Alpha Media', 'new'),
           ('${contactB1}', '${bizB}', 'Charlie', 'Brown', 'charlie@beta.com', 'Beta LLC', 'new');
  `);

  // 3. Setup templates
  const tplA1 = crypto.randomUUID();
  const tplA2 = crypto.randomUUID();
  const tplB1 = crypto.randomUUID();

  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status)
    VALUES ('${tplA1}', '${bizA}', 'Step 1 Welcome', 'Welcome {{first_name}} to Alpha', '<p>Hello {{first_name}}</p>', 'active'),
           ('${tplA2}', '${bizA}', 'Step 2 Followup', 'Checking in {{company_name}}', '<p>Follow-up</p>', 'active'),
           ('${tplB1}', '${bizB}', 'Beta Intro', 'Welcome from Beta', '<p>Hi</p>', 'active');
  `);

  const mockProvider = new MockEmailProvider();
  const engine = new TestCampaignLifecycleEngine(db, { provider: mockProvider });

  await t.test("A. New enrollment gets contact_id and email correctly", async () => {
    // Create an active campaign with step 1
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Onboarding Flow', 'ACTIVE', 'UTC');
    `);

    const step1Id = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${step1Id}', '${campId}', 1, 'Welcome Step', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    // Enroll contact A1
    const res = engine.enrollContacts(campId, bizA, [contactA1]);
    assert.equal(res.enrolledCount, 1);
    assert.equal(res.skippedCount, 0);

    const enrollment = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);

    assert.ok(enrollment, "Enrollment record should exist");
    assert.equal(enrollment.business_id, bizA, "business_id must match tenant");
    assert.equal(enrollment.lead_id, contactA1, "lead_id must match contact_id");
    assert.equal(enrollment.email, "alice@alpha.com", "email must be persisted on enrollment");
    assert.equal(enrollment.status.toUpperCase(), "ENROLLED", "Status must be ENROLLED");
  });

  await t.test("B. New enrollment gets first active step initialized", async () => {
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Sequence Campaign', 'ACTIVE', 'UTC');
    `);

    const step1Id = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${step1Id}', '${campId}', 1, 'Initial Step', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campId, bizA, [contactA2]);

    const enrollment = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA2}';
    `);

    assert.equal(enrollment.next_step_id, step1Id, "next_step_id must point to first active step");
    assert.equal(enrollment.current_step_id, step1Id, "current_step_id must point to first active step");
    assert.equal(enrollment.current_step, 0, "current_step must be 0 prior to execution");
  });

  await t.test("C. New enrollment gets next_run_at initialized correctly", async () => {
    // Immediate step (delay = 0)
    const campImm = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campImm}', '${bizA}', 'Immediate Campaign', 'ACTIVE', 'UTC');
    `);
    const stepImm = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepImm}', '${campImm}', 1, 'Immediate Step', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campImm, bizA, [contactA1]);
    const enrImm = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campImm}' AND lead_id = '${contactA1}';
    `);

    assert.ok(enrImm.next_run_at, "next_run_at must not be null");
    assert.ok(
      new Date(enrImm.next_run_at) <= new Date(),
      "Immediately executable step next_run_at must be <= NOW()"
    );

    // Delayed step (delay = 2 hours)
    const campDelay = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campDelay}', '${bizA}', 'Delayed Campaign', 'ACTIVE', 'UTC');
    `);
    const stepDelay = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepDelay}', '${campDelay}', 1, 'Delayed Step', '${tplA1}', 2, 'hours', 'ACTIVE');
    `);

    engine.enrollContacts(campDelay, bizA, [contactA2]);
    const enrDelay = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campDelay}' AND lead_id = '${contactA2}';
    `);

    assert.ok(enrDelay.next_run_at, "Delayed next_run_at must not be null");
    assert.ok(
      new Date(enrDelay.next_run_at) > new Date(),
      "Delayed step next_run_at must be in the future"
    );
  });

  await t.test("D. Immediately runnable first step is picked up by Run Due Jobs", async () => {
    mockProvider.clear();
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Due Run Campaign', 'ACTIVE', 'UTC');
    `);
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campId, bizA, [contactA1]);

    const runResult = await engine.runDueJobs(campId, bizA);
    assert.equal(runResult.processed, 1, "Should pick up exactly 1 due enrollment");
    assert.equal(runResult.succeeded, 1, "Should succeed for valid enrollment");
    assert.equal(runResult.failed, 0, "0 failures expected");
  });

  await t.test("E. Run Due Jobs sends the email with template variable replacement", async () => {
    mockProvider.clear();
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Dispatch Campaign', 'ACTIVE', 'UTC');
    `);
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campId, bizA, [contactA1]);
    await engine.runDueJobs(campId, bizA);

    assert.equal(mockProvider.sentEmails.length, 1, "Exactly 1 email sent");
    const sent = mockProvider.sentEmails[0];
    assert.equal(sent.to, "alice@alpha.com", "Sent to contact email");
    assert.equal(sent.subject, "Welcome Alice to Alpha", "Variables replaced in subject");
    assert.ok(sent.body.includes("Hello Alice"), "Variables replaced in body");
  });

  await t.test("F. SENT event is recorded in email_events", async () => {
    mockProvider.clear();
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Event Log Campaign', 'ACTIVE', 'UTC');
    `);
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campId, bizA, [contactA1]);
    await engine.runDueJobs(campId, bizA);

    const events = db.public.many(`
      SELECT * FROM email_events WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}' AND event_type = 'sent';
    `);

    assert.equal(events[0].business_id, bizA, "Event business_id must match");
    const eventMeta = typeof events[0].metadata === "string" ? JSON.parse(events[0].metadata) : events[0].metadata;
    assert.equal(eventMeta.recipient_email, "alice@alpha.com", "Recipient email matches");
  });

  await t.test("G. Provider failure is recorded correctly on enrollment", async () => {
    mockProvider.clear();
    mockProvider.shouldFail = true;
    mockProvider.errorMessage = "Provider rate limit exceeded";

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Failure Campaign', 'ACTIVE', 'UTC');
    `);
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    engine.enrollContacts(campId, bizA, [contactA1]);
    const runResult = await engine.runDueJobs(campId, bizA);

    assert.equal(runResult.processed, 1);
    assert.equal(runResult.failed, 1);
    assert.equal(runResult.succeeded, 0);

    const enrollment = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);

    assert.equal(enrollment.retry_count, 1, "retry_count must increment to 1");
    assert.ok(enrollment.last_error.includes("rate limit exceeded"), "last_error must be recorded");

    mockProvider.clear();
  });

  await t.test("H. Multi-tenant isolation remains intact", async () => {
    const campAId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campAId}', '${bizA}', 'Biz A Campaign', 'ACTIVE', 'UTC');
    `);
    const stepAId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepAId}', '${campAId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    // Attempting to enroll Business B contact into Business A campaign is rejected / skipped
    const res = engine.enrollContacts(campAId, bizA, [contactB1]);
    assert.equal(res.enrolledCount, 0, "Cross-tenant contact must NOT be enrolled");
    assert.equal(res.skippedCount, 1, "Cross-tenant contact must be skipped");

    // Attempting to run Business A campaign under Business B credentials throws
    await assert.rejects(
      async () => {
        await engine.runDueJobs(campAId, bizB);
      },
      /access denied|not found/i,
      "Cross-tenant execution attempt must be denied"
    );
  });

  await t.test("I. Existing campaigns and multi-step progression are not broken", async () => {
    mockProvider.clear();
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Multi Step Campaign', 'ACTIVE', 'UTC');
    `);

    const step1Id = crypto.randomUUID();
    const step2Id = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${step1Id}', '${campId}', 1, 'Step 1 Outreach', '${tplA1}', 0, 'days', 'ACTIVE'),
             ('${step2Id}', '${campId}', 2, 'Step 2 Followup', '${tplA2}', 1, 'days', 'ACTIVE');
    `);

    // Enroll contact A1
    engine.enrollContacts(campId, bizA, [contactA1]);

    // Run due jobs (Step 1 executes)
    const run1 = await engine.runDueJobs(campId, bizA);
    assert.equal(run1.succeeded, 1);

    const enrollmentAfterStep1 = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);

    assert.equal(enrollmentAfterStep1.current_step, 1, "current_step should now be 1");
    assert.equal(enrollmentAfterStep1.next_step_id, step2Id, "next_step_id should point to step 2");
    assert.equal(enrollmentAfterStep1.status.toUpperCase(), "RUNNING", "Status should be RUNNING");
    assert.ok(
      new Date(enrollmentAfterStep1.next_run_at) > new Date(),
      "Step 2 next_run_at should be scheduled in the future"
    );

    // Fast-forward next_run_at to NOW() for step 2
    db.public.none(`
      UPDATE campaign_leads SET next_run_at = NOW() - interval '1 second' WHERE id = '${enrollmentAfterStep1.id}';
    `);

    // Run due jobs again (Step 2 executes)
    const run2 = await engine.runDueJobs(campId, bizA);
    assert.equal(run2.succeeded, 1);

    const enrollmentAfterStep2 = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);

    assert.equal(enrollmentAfterStep2.current_step, 2, "current_step should now be 2");
    assert.equal(enrollmentAfterStep2.next_step_id, null, "next_step_id should be null on completion");
    assert.equal(enrollmentAfterStep2.status.toUpperCase(), "COMPLETED", "Status must be COMPLETED");
  });

  await t.test("J. Duplicate enrollment remains idempotent", async () => {
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Idempotent Campaign', 'ACTIVE', 'UTC');
    `);
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    // First enrollment
    const firstEnroll = engine.enrollContacts(campId, bizA, [contactA1]);
    assert.equal(firstEnroll.enrolledCount, 1);

    // Re-enrollment of the same contact
    const secondEnroll = engine.enrollContacts(campId, bizA, [contactA1]);
    assert.equal(secondEnroll.enrolledCount, 0, "Duplicate contact must not be re-enrolled");
    assert.equal(secondEnroll.skippedCount, 1, "Duplicate contact must be reported as skipped");

    const totalEnrollments = db.public.many(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);
    assert.equal(totalEnrollments.length, 1, "Exactly 1 record must exist in database");
  });

  await t.test("K. Full integration test: Contact -> Active Campaign -> Step 1 -> Enroll -> Verify non-null fields -> Run due -> Exactly 1 email sent -> SENT event -> Enrollment updated", async () => {
    mockProvider.clear();

    // 1. Create campaign
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Full Integration Campaign', 'ACTIVE', 'UTC');
    `);

    // 2. Create step 1
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepId}', '${campId}', 1, 'First Touch', '${tplA1}', 0, 'days', 'ACTIVE');
    `);

    // 3. Enroll contact
    const enrollRes = engine.enrollContacts(campId, bizA, [contactA1]);
    assert.equal(enrollRes.enrolledCount, 1);

    // 4. Verify non-null fields in database
    const enr = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);
    assert.ok(enr, "Enrollment must exist");
    assert.ok(enr.lead_id, "lead_id must be non-null");
    assert.ok(enr.email, "email must be non-null");
    assert.equal(enr.email, "alice@alpha.com");
    assert.ok(enr.next_step_id, "next_step_id must be non-null");
    assert.equal(enr.next_step_id, stepId);
    assert.ok(enr.next_run_at, "next_run_at must be non-null");
    assert.equal(enr.status.toUpperCase(), "ENROLLED");

    // 5. Verify Enrolled Contacts UI representation
    const contactsList = engine.getEnrolledContacts(campId, bizA);
    assert.equal(contactsList.length, 1);
    const uiRow = contactsList[0];
    assert.equal(uiRow.lead.first_name, "Alice");
    assert.equal(uiRow.lead.last_name, "Smith");
    assert.equal(uiRow.lead.email, "alice@alpha.com");
    assert.equal(uiRow.email, "alice@alpha.com");

    // 6. Run Due Jobs
    const runResult = await engine.runDueJobs(campId, bizA);
    assert.equal(runResult.processed, 1);
    assert.equal(runResult.succeeded, 1);
    assert.equal(runResult.failed, 0);

    // 7. Exactly 1 email sent via provider
    assert.equal(mockProvider.sentEmails.length, 1);
    assert.equal(mockProvider.sentEmails[0].to, "alice@alpha.com");

    // 8. SENT event recorded
    const event = engine.oneOrNone(`
      SELECT * FROM email_events WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);
    assert.ok(event, "SENT event must be logged");
    assert.equal(event.event_type, "sent");

    // 9. Enrollment updated to completed
    const enrUpdated = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND lead_id = '${contactA1}';
    `);
    assert.equal(enrUpdated.current_step, 1);
    assert.equal(enrUpdated.status.toUpperCase(), "COMPLETED");
  });

  await t.test("L. Diagnostic reporting explains exact reason when 0 jobs run", async () => {
    // 1. DRAFT campaign
    const campDraft = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campDraft}', '${bizA}', 'Draft Camp', 'DRAFT', 'UTC');
    `);
    const diagDraft = await engine.runDueJobs(campDraft, bizA);
    assert.equal(diagDraft.processed, 0);
    assert.ok(diagDraft.diagnostic.includes("DRAFT status"));

    // 2. PAUSED campaign
    const campPaused = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campPaused}', '${bizA}', 'Paused Camp', 'PAUSED', 'UTC');
    `);
    const diagPaused = await engine.runDueJobs(campPaused, bizA);
    assert.equal(diagPaused.processed, 0);
    assert.ok(diagPaused.diagnostic.includes("paused"));

    // 3. Active campaign with step delay not elapsed
    const campFuture = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campFuture}', '${bizA}', 'Future Camp', 'ACTIVE', 'UTC');
    `);
    const stepFut = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status)
      VALUES ('${stepFut}', '${campFuture}', 1, 'Future Step', '${tplA1}', 3, 'days', 'ACTIVE');
    `);
    engine.enrollContacts(campFuture, bizA, [contactA1]);
    const diagFuture = await engine.runDueJobs(campFuture, bizA);
    assert.equal(diagFuture.processed, 0);
    assert.ok(diagFuture.diagnostic.includes("step delay not yet reached"));
  });
});
