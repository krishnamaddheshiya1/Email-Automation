import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { renderTemplate } from "../lib/utils/template.ts";
import { emailRegex } from "../lib/validations/email.ts";

/**
 * Mock Email Provider for Phase 8 Execution Testing
 */
class MockEmailProvider {
  constructor(options = {}) {
    this.name = "mock";
    this.shouldFail = options.shouldFail || false;
    this.errorCode = options.errorCode || "MOCK_ERROR";
    this.errorMessage = options.errorMessage || "Mock provider failed";
    this.sentEmails = [];
  }

  isConfigured() {
    return true;
  }

  clear() {
    this.sentEmails = [];
    this.shouldFail = false;
    this.errorCode = "MOCK_ERROR";
    this.errorMessage = "Mock provider failed";
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

    const providerMessageId = `mock_exec_${crypto.randomUUID()}`;
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
 * Test Engine simulating CampaignExecutionService against pg-mem
 */
class TestExecutionEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.provider = options.provider || new MockEmailProvider();
    this.maxRetries = options.maxRetries ?? 3;
    this.devSendLimit = options.devSendLimit ?? 5;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  calculateNextRunAt(delayValue, delayUnit, fromDate = new Date()) {
    if (delayValue <= 0) {
      return new Date(fromDate.getTime()).toISOString();
    }
    const msMultiplier = {
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
    }[delayUnit] || 24 * 60 * 60 * 1000;

    return new Date(fromDate.getTime() + delayValue * msMultiplier).toISOString();
  }

  calculateRetryBackoff(retryCount) {
    const minutes = Math.pow(2, Math.min(retryCount, 6)) * 5;
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  initializeEnrollments(campaignId, businessId) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign || campaign.status.toUpperCase() !== "ACTIVE") {
      return 0;
    }

    const firstStep = this.oneOrNone(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' AND status = 'ACTIVE' ORDER BY step_number ASC LIMIT 1;`
    );

    if (!firstStep) {
      return 0;
    }

    const nextRun = this.calculateNextRunAt(firstStep.delay_value || 0, firstStep.delay_unit || "days");

    this.db.public.none(`
      UPDATE campaign_leads
      SET next_step_id = '${firstStep.id}',
          next_run_at = '${nextRun}',
          status = 'RUNNING',
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
      WHERE campaign_id = '${campaignId}'
        AND business_id = '${businessId}'
        AND status IN ('ENROLLED', 'running')
        AND next_run_at IS NULL;
    `);

    return 1;
  }

  claimDueEnrollments(options = {}) {
    const limit = options.limit || 20;
    let whereConditions = [
      "cl.status IN ('RUNNING', 'ENROLLED')",
      "c.status = 'ACTIVE'",
      "cl.next_run_at IS NOT NULL",
      "cl.next_run_at <= NOW()",
    ];

    if (options.campaignId) {
      whereConditions.push(`cl.campaign_id = '${options.campaignId}'`);
    }
    if (options.businessId) {
      whereConditions.push(`cl.business_id = '${options.businessId}'`);
    }

    const whereClause = whereConditions.join(" AND ");
    const rows = this.db.public.many(`
      SELECT cl.*, c.status as c_status, c.business_id as c_business_id
      FROM campaign_leads cl
      JOIN campaigns c ON c.id = cl.campaign_id
      WHERE ${whereClause}
      ORDER BY cl.next_run_at ASC
      LIMIT ${limit};
    `);

    return rows;
  }

  async processDueEnrollments(options = {}) {
    const batchLimit = options.limit || 20;
    const dueRows = this.claimDueEnrollments({
      campaignId: options.campaignId,
      businessId: options.businessId,
      limit: batchLimit,
    });

    const results = [];
    let sentCount = 0;

    for (const row of dueRows) {
      if (this.devSendLimit && sentCount >= this.devSendLimit) {
        break;
      }

      const result = await this.executeStepForEnrollment(row, options);
      results.push(result);
      if (result.status === "SUCCESS") {
        sentCount++;
      }
    }

    return results;
  }

  async executeStepForEnrollment(enrollment) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${enrollment.campaign_id}';`
    );
    if (!campaign || campaign.status.toUpperCase() !== "ACTIVE") {
      return { enrollmentId: enrollment.id, status: "SKIPPED", error: "Campaign not active" };
    }

    const lead = this.oneOrNone(
      `SELECT * FROM leads WHERE id = '${enrollment.lead_id}';`
    );
    if (!lead) {
      this.db.public.none(
        `UPDATE campaign_leads SET status = 'FAILED', last_error = 'Lead not found', updated_at = NOW() WHERE id = '${enrollment.id}';`
      );
      return { enrollmentId: enrollment.id, status: "FAILED", error: "Lead not found" };
    }

    // Tenant isolation verification: lead must belong to same business as campaign
    if (lead.business_id !== campaign.business_id) {
      this.db.public.none(
        `UPDATE campaign_leads SET status = 'FAILED', last_error = 'CROSS_TENANT_LEAD_ACCESS', updated_at = NOW() WHERE id = '${enrollment.id}';`
      );
      return { enrollmentId: enrollment.id, status: "FAILED", error: "CROSS_TENANT_LEAD_ACCESS" };
    }

    // Step 1: Suppression Check
    const suppression = this.oneOrNone(
      `SELECT * FROM suppressions WHERE business_id = '${campaign.business_id}' AND email = '${lead.email.toLowerCase()}';`
    );
    if (suppression) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'STOPPED',
            last_error = 'RECIPIENT_SUPPRESSED: Email address is on suppression list',
            stopped_at = NOW(),
            next_run_at = NULL,
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "STOPPED", error: "RECIPIENT_SUPPRESSED" };
    }

    // Step 2: Email Syntax Check
    if (!emailRegex.test(lead.email)) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'STOPPED',
            last_error = 'INVALID_EMAIL: Email address syntax is invalid',
            stopped_at = NOW(),
            next_run_at = NULL,
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "STOPPED", error: "INVALID_EMAIL" };
    }

    // Step 3: Find current step to execute
    let step = null;
    if (enrollment.next_step_id) {
      step = this.oneOrNone(
        `SELECT * FROM campaign_steps WHERE id = '${enrollment.next_step_id}' AND campaign_id = '${campaign.id}';`
      );
    }
    if (!step) {
      const currentStepNum = enrollment.current_step || 0;
      step = this.oneOrNone(`
        SELECT * FROM campaign_steps
        WHERE campaign_id = '${campaign.id}'
          AND status = 'ACTIVE'
          AND step_number > ${currentStepNum}
        ORDER BY step_number ASC
        LIMIT 1;
      `);
    }

    if (!step) {
      // No more active steps -> Complete campaign
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'COMPLETED',
            next_step_id = NULL,
            next_run_at = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "COMPLETED" };
    }

    // Step 4: Validate template
    if (!step.template_id) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'FAILED',
            last_error = 'TEMPLATE_NOT_FOUND',
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "FAILED", error: "TEMPLATE_NOT_FOUND" };
    }

    const template = this.oneOrNone(
      `SELECT * FROM email_templates WHERE id = '${step.template_id}';`
    );
    if (!template) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'FAILED',
            last_error = 'TEMPLATE_NOT_FOUND',
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "FAILED", error: "TEMPLATE_NOT_FOUND" };
    }

    // Cross-tenant template check
    if (template.business_id !== campaign.business_id) {
      this.db.public.none(`
        UPDATE campaign_leads
        SET status = 'FAILED',
            last_error = 'CROSS_TENANT_TEMPLATE_ACCESS',
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return { enrollmentId: enrollment.id, status: "FAILED", error: "CROSS_TENANT_TEMPLATE_ACCESS" };
    }

    // Step 5: Idempotency Check
    const idempotencyKey = `${campaign.business_id}:${campaign.id}:${enrollment.id}:step_${step.step_number}`;
    const existingLog = this.oneOrNone(
      `SELECT * FROM campaign_execution_logs WHERE idempotency_key = '${idempotencyKey}';`
    );

    if (existingLog && existingLog.status === "SUCCESS") {
      // Already sent! Skip email dispatch and advance to next step
      return this.advanceToNextStep(enrollment, step, new Date().toISOString(), true);
    }

    // Step 6: Render Template
    const rendered = renderTemplate(
      { subject: template.subject, body: template.body },
      lead,
      { sender_name: "Opsiys", business_name: "Test Biz" }
    );
    const renderedSubject = rendered.subject;
    const renderedBody = rendered.body;

    // Step 7: Dispatch via Provider
    const sendResult = await this.provider.sendEmail({
      to: lead.email,
      subject: renderedSubject,
      html: renderedBody,
      businessId: campaign.business_id,
      campaignId: campaign.id,
      stepId: step.id,
    });

    const executionTimestamp = new Date().toISOString();

    if (sendResult.success) {
      // Record execution log
      const logId = crypto.randomUUID();
      this.db.public.none(`
        INSERT INTO campaign_execution_logs (
          id, business_id, campaign_id, campaign_step_id, enrollment_id,
          lead_id, status, attempt_number, idempotency_key,
          created_at, completed_at
        ) VALUES (
          '${logId}', '${campaign.business_id}', '${campaign.id}', '${step.id}', '${enrollment.id}',
          '${lead.id}', 'SUCCESS', ${Number(enrollment.retry_count || 0) + 1},
          '${idempotencyKey}', NOW(), '${executionTimestamp}'
        );
      `);

      // Advance to next step
      return this.advanceToNextStep(enrollment, step, executionTimestamp, false);
    } else {
      // Handle failure
      const currentRetry = Number(enrollment.retry_count || 0) + 1;
      const logId = crypto.randomUUID();
      this.db.public.none(`
        INSERT INTO campaign_execution_logs (
          id, business_id, campaign_id, campaign_step_id, enrollment_id,
          lead_id, status, attempt_number, idempotency_key,
          error, created_at, completed_at
        ) VALUES (
          '${logId}', '${campaign.business_id}', '${campaign.id}', '${step.id}', '${enrollment.id}',
          '${lead.id}', 'FAILED', ${currentRetry},
          '${idempotencyKey}_att_${currentRetry}',
          '${(sendResult.error?.message || "Send failed").replace(/'/g, "''")}', NOW(), '${executionTimestamp}'
        );
      `);

      if (currentRetry >= this.maxRetries) {
        this.db.public.none(`
          UPDATE campaign_leads
          SET status = 'FAILED',
              retry_count = ${currentRetry},
              last_error = '${(sendResult.error?.message || "Exceeded max retries").replace(/'/g, "''")}',
              updated_at = NOW()
          WHERE id = '${enrollment.id}';
        `);
        return { enrollmentId: enrollment.id, status: "FAILED", error: sendResult.error?.message };
      } else {
        const retryRunAt = this.calculateRetryBackoff(currentRetry);
        this.db.public.none(`
          UPDATE campaign_leads
          SET retry_count = ${currentRetry},
              next_run_at = '${retryRunAt}',
              last_error = '${(sendResult.error?.message || "Transient send failure").replace(/'/g, "''")}',
              updated_at = NOW()
          WHERE id = '${enrollment.id}';
        `);
        return { enrollmentId: enrollment.id, status: "RETRY_SCHEDULED", nextRunAt: retryRunAt };
      }
    }
  }

  advanceToNextStep(enrollment, currentStep, executionTimestamp, isDuplicate = false) {
    const nextStep = this.oneOrNone(`
      SELECT * FROM campaign_steps
      WHERE campaign_id = '${currentStep.campaign_id}'
        AND status = 'ACTIVE'
        AND step_number > ${currentStep.step_number}
      ORDER BY step_number ASC
      LIMIT 1;
    `);

    if (!nextStep) {
      // Completed all steps
      this.db.public.none(`
        UPDATE campaign_leads
        SET current_step = ${currentStep.step_number},
            next_step_id = NULL,
            next_run_at = NULL,
            status = 'COMPLETED',
            completed_at = '${executionTimestamp}',
            retry_count = 0,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);
      return {
        enrollmentId: enrollment.id,
        status: isDuplicate ? "DUPLICATE_SKIPPED" : "SUCCESS",
        stepCompleted: currentStep.step_number,
        isCompleted: true,
      };
    } else {
      // Next step exists -> Calculate from executionTimestamp
      const nextRunAt = this.calculateNextRunAt(
        nextStep.delay_value || 0,
        nextStep.delay_unit || "days",
        new Date(executionTimestamp)
      );

      this.db.public.none(`
        UPDATE campaign_leads
        SET current_step = ${currentStep.step_number},
            next_step_id = '${nextStep.id}',
            next_run_at = '${nextRunAt}',
            status = 'RUNNING',
            retry_count = 0,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = '${enrollment.id}';
      `);

      return {
        enrollmentId: enrollment.id,
        status: isDuplicate ? "DUPLICATE_SKIPPED" : "SUCCESS",
        stepCompleted: currentStep.step_number,
        nextStepNumber: nextStep.step_number,
        nextRunAt,
      };
    }
  }
}

test("Phase 8: Campaign Execution Engine Test Suite", async (t) => {
  const { db } = createTestDb();

  // Setup Businesses
  const bizA = crypto.randomUUID();
  const bizB = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizA}', 'Alpha Corp', 'America/New_York', 'active'),
           ('${bizB}', 'Beta Corp', 'Europe/London', 'active');
  `);

  // Setup Leads for Biz A
  const leadA1 = crypto.randomUUID();
  const leadA2 = crypto.randomUUID();
  const leadA3 = crypto.randomUUID();
  const leadAInvalid = crypto.randomUUID();

  db.public.none(`
    INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
    VALUES ('${leadA1}', '${bizA}', 'John', 'Doe', 'john@alphacorp.com', 'Alpha Partner', 'new'),
           ('${leadA2}', '${bizA}', 'Jane', 'Smith', 'jane@alphacorp.com', 'Alpha Partner', 'new'),
           ('${leadA3}', '${bizA}', 'Bob', 'Suppressed', 'bob.suppressed@alphacorp.com', 'Alpha Partner', 'new'),
           ('${leadAInvalid}', '${bizA}', 'Bad', 'Email', 'not-a-valid-email', 'Alpha Partner', 'new');
  `);

  // Setup Leads for Biz B
  const leadB1 = crypto.randomUUID();
  db.public.none(`
    INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
    VALUES ('${leadB1}', '${bizB}', 'Bruce', 'Wayne', 'bruce@wayne.com', 'Wayne Enterprises', 'new');
  `);

  // Setup Templates for Biz A
  const tplA1 = crypto.randomUUID();
  const tplA2 = crypto.randomUUID();
  const tplA3 = crypto.randomUUID();

  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status)
    VALUES ('${tplA1}', '${bizA}', 'Intro Email', 'Hi {{first_name}} from {{company_name}}', '<p>Welcome {{first_name}}</p>', 'active'),
           ('${tplA2}', '${bizA}', 'Followup 1', 'Checking in {{first_name}}', '<p>Did you see my last email?</p>', 'active'),
           ('${tplA3}', '${bizA}', 'Followup 2', 'Final check {{first_name}}', '<p>Last call!</p>', 'active');
  `);

  // Setup Template for Biz B
  const tplB1 = crypto.randomUUID();
  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status)
    VALUES ('${tplB1}', '${bizB}', 'Wayne Intro', 'Hello {{first_name}}', '<p>Gotham needs you</p>', 'active');
  `);

  // Setup Suppression for leadA3
  db.public.none(`
    INSERT INTO suppressions (id, business_id, email, reason, created_at)
    VALUES ('${crypto.randomUUID()}', '${bizA}', 'bob.suppressed@alphacorp.com', 'unsubscribe', NOW());
  `);

  // ==========================================
  // Test Case 1: Immediate Step 1 execution
  // ==========================================
  await t.test("1. Immediate Step 1: Step 1 with delay 0 executes immediately on first cycle", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Campaign 1', 'ACTIVE', 'America/New_York');
    `);

    const step1Id = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${step1Id}', '${campId}', 1, 'Initial Contact', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'ENROLLED');
    `);

    engine.initializeEnrollments(campId, bizA);

    const enrollmentBefore = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentBefore.status, "RUNNING");
    assert.equal(enrollmentBefore.next_step_id, step1Id);
    assert.ok(enrollmentBefore.next_run_at);

    // Process due enrollments
    const results = await engine.processDueEnrollments({ campaignId: campId, businessId: bizA });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(mockProvider.sentEmails.length, 1);
    assert.equal(mockProvider.sentEmails[0].to, "john@alphacorp.com");
    assert.equal(mockProvider.sentEmails[0].subject, "Hi John from Alpha Partner");
  });

  // ==========================================
  // Test Case 2: Delayed Step 2 calculation
  // ==========================================
  await t.test("2. Delayed Step 2: Calculated from previous step actual execution time", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Campaign 2', 'ACTIVE', 'America/New_York');
    `);

    const step1Id = crypto.randomUUID();
    const step2Id = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${step1Id}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}'),
             ('${step2Id}', '${campId}', 2, 'Step 2 (1 min)', 1, 'minutes', 'ACTIVE', '${tplA2}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status)
      VALUES ('${enrollId}', '${campId}', '${leadA2}', '${bizA}', 'ENROLLED');
    `);

    engine.initializeEnrollments(campId, bizA);
    const results = await engine.processDueEnrollments({ campaignId: campId, businessId: bizA });
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(results[0].nextStepNumber, 2);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.current_step, 1);
    assert.equal(enrollmentAfter.next_step_id, step2Id);

    // Verify next_run_at is ~1 minute ahead of actual execution time
    const nextRun = new Date(enrollmentAfter.next_run_at).getTime();
    const now = Date.now();
    const diffSeconds = Math.round((nextRun - now) / 1000);
    assert.ok(diffSeconds >= 58 && diffSeconds <= 62, `Expected ~60s diff, got ${diffSeconds}s`);
  });

  // ==========================================
  // Test Case 3: Delayed Step 3 calculation
  // ==========================================
  await t.test("3. Delayed Step 3: Calculated from Step 2 execution time (2 minutes)", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Campaign 3', 'ACTIVE', 'America/New_York');
    `);

    const step1 = crypto.randomUUID();
    const step2 = crypto.randomUUID();
    const step3 = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${step1}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}'),
             ('${step2}', '${campId}', 2, 'Step 2', 1, 'minutes', 'ACTIVE', '${tplA2}'),
             ('${step3}', '${campId}', 3, 'Step 3', 2, 'minutes', 'ACTIVE', '${tplA3}');
    `);

    // Simulate contact that just finished Step 1 and now Step 2 is due
    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', 1, '${step2}', NOW() - INTERVAL '1 minute');
    `);

    // Execute Step 2
    const results = await engine.processDueEnrollments({ campaignId: campId, businessId: bizA });
    assert.equal(results.length, 1);
    assert.equal(results[0].stepCompleted, 2);
    assert.equal(results[0].nextStepNumber, 3);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.current_step, 2);
    assert.equal(enrollmentAfter.next_step_id, step3);

    const nextRun = new Date(enrollmentAfter.next_run_at).getTime();
    const now = Date.now();
    const diffSeconds = Math.round((nextRun - now) / 1000);
    assert.ok(diffSeconds >= 115 && diffSeconds <= 125, `Expected ~120s diff, got ${diffSeconds}s`);
  });

  // ==========================================
  // Test Case 4: Correct next_run_at calculation
  // ==========================================
  await t.test("4. Calculation: Correct next_run_at across minutes, hours, and days", () => {
    const engine = new TestExecutionEngine(db);
    const baseTime = new Date("2026-10-16T12:00:00Z");

    const tMinutes = new Date(engine.calculateNextRunAt(15, "minutes", baseTime));
    assert.equal(tMinutes.toISOString(), "2026-10-16T12:15:00.000Z");

    const tHours = new Date(engine.calculateNextRunAt(3, "hours", baseTime));
    assert.equal(tHours.toISOString(), "2026-10-16T15:00:00.000Z");

    const tDays = new Date(engine.calculateNextRunAt(2, "days", baseTime));
    assert.equal(tDays.toISOString(), "2026-10-18T12:00:00.000Z");

    const tZero = new Date(engine.calculateNextRunAt(0, "days", baseTime));
    assert.equal(tZero.toISOString(), "2026-10-16T12:00:00.000Z");
  });

  // ==========================================
  // Test Case 5: Timezone handling
  // ==========================================
  await t.test("5. Timezone handling: ISO UTC storage with campaign timezone preserved", () => {
    const camp = db.public.one(`SELECT timezone FROM campaigns WHERE id = (SELECT id FROM campaigns LIMIT 1);`);
    assert.equal(camp.timezone, "America/New_York");

    const engine = new TestExecutionEngine(db);
    const isoUtc = engine.calculateNextRunAt(1, "hours");
    assert.ok(isoUtc.endsWith("Z"));
  });

  // ==========================================
  // Test Case 6: Campaign pause
  // ==========================================
  await t.test("6. Campaign pause: Paused campaign skips step execution", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Paused Campaign', 'PAUSED', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW() - INTERVAL '5 minutes');
    `);

    const due = engine.claimDueEnrollments({ campaignId: campId });
    assert.equal(due.length, 0, "No enrollments should be claimed for a PAUSED campaign");

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 0);
    assert.equal(mockProvider.sentEmails.length, 0);
  });

  // ==========================================
  // Test Case 7: Campaign resume
  // ==========================================
  await t.test("7. Campaign resume: Resuming campaign executes pending due enrollments", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Resumed Campaign', 'PAUSED', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW() - INTERVAL '5 minutes');
    `);

    // While paused, 0 claimed
    assert.equal(engine.claimDueEnrollments({ campaignId: campId }).length, 0);

    // Resume campaign to ACTIVE
    db.public.none(`UPDATE campaigns SET status = 'ACTIVE' WHERE id = '${campId}';`);

    // Now due enrollment is claimed and processed
    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(mockProvider.sentEmails.length, 1);
  });

  // ==========================================
  // Test Case 8: Campaign archive
  // ==========================================
  await t.test("8. Campaign archive: Archived campaign does not execute", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Archived Camp', 'ARCHIVED', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW() - INTERVAL '5 minutes');
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 0);
    assert.equal(mockProvider.sentEmails.length, 0);
  });

  // ==========================================
  // Test Case 9: Campaign completion
  // ==========================================
  await t.test("9. Campaign completion: Transitions to COMPLETED after final step", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', '1-Step Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Only Step', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(results[0].isCompleted, true);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "COMPLETED");
    assert.equal(enrollmentAfter.next_step_id, null);
    assert.equal(enrollmentAfter.next_run_at, null);
    assert.ok(enrollmentAfter.completed_at);
  });

  // ==========================================
  // Test Case 10: No active steps
  // ==========================================
  await t.test("10. No active steps: Campaign with no active steps completes cleanly", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Empty Camp', 'ACTIVE', 'UTC');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "COMPLETED");
    assert.equal(mockProvider.sentEmails.length, 0);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "COMPLETED");
  });

  // ==========================================
  // Test Case 11: Suppressed contact
  // ==========================================
  await t.test("11. Suppressed contact: Automatically stopped without email dispatch", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Suppression Test', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Outreach', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA3}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "STOPPED");
    assert.equal(results[0].error, "RECIPIENT_SUPPRESSED");
    assert.equal(mockProvider.sentEmails.length, 0, "No email should be dispatched to suppressed contact");

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "STOPPED");
    assert.ok(enrollmentAfter.last_error.includes("RECIPIENT_SUPPRESSED"));
    assert.ok(enrollmentAfter.stopped_at);
  });

  // ==========================================
  // Test Case 12: Invalid email
  // ==========================================
  await t.test("12. Invalid email: Stopped immediately with INVALID_EMAIL", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Bad Email Test', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Outreach', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadAInvalid}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "STOPPED");
    assert.equal(results[0].error, "INVALID_EMAIL");
    assert.equal(mockProvider.sentEmails.length, 0);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "STOPPED");
    assert.ok(enrollmentAfter.last_error.includes("INVALID_EMAIL"));
  });

  // ==========================================
  // Test Case 13: Missing template
  // ==========================================
  await t.test("13. Missing template: Fails safely with TEMPLATE_NOT_FOUND", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Missing Tpl Test', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', NULL);
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "FAILED");
    assert.equal(results[0].error, "TEMPLATE_NOT_FOUND");
    assert.equal(mockProvider.sentEmails.length, 0);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "FAILED");
    assert.equal(enrollmentAfter.last_error, "TEMPLATE_NOT_FOUND");
  });

  // ==========================================
  // Test Case 14: Template from another business
  // ==========================================
  await t.test("14. Cross-tenant template: Prevented with CROSS_TENANT_TEMPLATE_ACCESS", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Cross Tpl Camp', 'ACTIVE', 'UTC');
    `);

    // Assign template belonging to Biz B (tplB1)
    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Illegal Step', 0, 'minutes', 'ACTIVE', '${tplB1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "FAILED");
    assert.equal(results[0].error, "CROSS_TENANT_TEMPLATE_ACCESS");
    assert.equal(mockProvider.sentEmails.length, 0);

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "FAILED");
    assert.equal(enrollmentAfter.last_error, "CROSS_TENANT_TEMPLATE_ACCESS");
  });

  // ==========================================
  // Test Case 15: Contact from another business
  // ==========================================
  await t.test("15. Cross-tenant contact: Prevented with CROSS_TENANT_LEAD_ACCESS", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Cross Lead Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    // Enroll Lead B1 (belongs to Biz B) into Campaign of Biz A
    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadB1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "FAILED");
    assert.equal(results[0].error, "CROSS_TENANT_LEAD_ACCESS");
    assert.equal(mockProvider.sentEmails.length, 0);
  });

  // ==========================================
  // Test Case 16: EmailService success
  // ==========================================
  await t.test("16. EmailService success: Logs SUCCESS in campaign_execution_logs", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Success Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    await engine.processDueEnrollments({ campaignId: campId });

    const log = db.public.one(`
      SELECT * FROM campaign_execution_logs
      WHERE enrollment_id = '${enrollId}' AND status = 'SUCCESS';
    `);
    assert.ok(log);
    assert.equal(log.status, "SUCCESS");
    assert.equal(log.attempt_number, 1);
  });

  // ==========================================
  // Test Case 17: EmailService failure
  // ==========================================
  await t.test("17. EmailService failure: Logs FAILED attempt and increments retry_count", async () => {
    const mockProvider = new MockEmailProvider({
      shouldFail: true,
      errorCode: "RATE_LIMITED",
      errorMessage: "Resend API rate limit exceeded",
    });
    const engine = new TestExecutionEngine(db, { provider: mockProvider, maxRetries: 3 });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Fail Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at, retry_count)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW(), 0);
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "RETRY_SCHEDULED");

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.retry_count, 1);
    assert.ok(enrollmentAfter.last_error.includes("rate limit"));
    assert.ok(new Date(enrollmentAfter.next_run_at).getTime() > Date.now());

    const log = db.public.one(`
      SELECT * FROM campaign_execution_logs
      WHERE enrollment_id = '${enrollId}' AND status = 'FAILED';
    `);
    assert.ok(log.error.includes("rate limit"));
  });

  // ==========================================
  // Test Case 18: Retry logic
  // ==========================================
  await t.test("18. Retry logic: Exponential backoff calculation", () => {
    const engine = new TestExecutionEngine(db);
    const r1 = new Date(engine.calculateRetryBackoff(1)).getTime();
    const r2 = new Date(engine.calculateRetryBackoff(2)).getTime();
    const r3 = new Date(engine.calculateRetryBackoff(3)).getTime();

    assert.ok(r2 > r1);
    assert.ok(r3 > r2);
  });

  // ==========================================
  // Test Case 19: Maximum retry limit
  // ==========================================
  await t.test("19. Maximum retry limit: Exceeding max retries marks enrollment FAILED", async () => {
    const mockProvider = new MockEmailProvider({ shouldFail: true });
    const engine = new TestExecutionEngine(db, { provider: mockProvider, maxRetries: 3 });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Max Retry Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    // Already failed twice
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at, retry_count)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW(), 2);
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "FAILED");

    const enrollmentAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollmentAfter.status, "FAILED");
    assert.equal(enrollmentAfter.retry_count, 3);
  });

  // ==========================================
  // Test Case 20: Concurrent workers / atomic claiming
  // ==========================================
  await t.test("20. Concurrent workers: Two workers query and claim distinct non-overlapping subsets", () => {
    const engine = new TestExecutionEngine(db);
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Concurrent Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const e1 = crypto.randomUUID();
    const e2 = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${e1}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW() - INTERVAL '2 minutes'),
             ('${e2}', '${campId}', '${leadA2}', '${bizA}', 'RUNNING', '${stepId}', NOW() - INTERVAL '1 minute');
    `);

    // Worker 1 claims batch of 1
    const w1Claims = engine.claimDueEnrollments({ campaignId: campId, limit: 1 });
    assert.equal(w1Claims.length, 1);
    assert.equal(w1Claims[0].id, e1);

    // Worker 1 processes and updates e1 next_run_at
    db.public.none(`UPDATE campaign_leads SET next_run_at = NOW() + INTERVAL '1 hour' WHERE id = '${e1}';`);

    // Worker 2 now claims batch of 1 -> must get e2
    const w2Claims = engine.claimDueEnrollments({ campaignId: campId, limit: 1 });
    assert.equal(w2Claims.length, 1);
    assert.equal(w2Claims[0].id, e2);
  });

  // ==========================================
  // Test Case 21: Duplicate execution prevention / Idempotency
  // ==========================================
  await t.test("21. Duplicate execution prevention: Existing SUCCESS log skips dispatch", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Idempotency Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    // Pre-insert a SUCCESS execution log with idempotency key
    const idempotencyKey = `${bizA}:${campId}:${enrollId}:step_1`;
    db.public.none(`
      INSERT INTO campaign_execution_logs (
        id, business_id, campaign_id, campaign_step_id, enrollment_id,
        lead_id, status, attempt_number, idempotency_key,
        created_at, completed_at
      ) VALUES (
        '${crypto.randomUUID()}', '${bizA}', '${campId}', '${stepId}', '${enrollId}',
        '${leadA1}', 'SUCCESS', 1, '${idempotencyKey}', NOW(), NOW()
      );
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results[0].status, "DUPLICATE_SKIPPED");
    assert.equal(mockProvider.sentEmails.length, 0, "Provider must NOT be called when idempotency key exists");
  });

  // ==========================================
  // Test Case 22: Worker restart recovery
  // ==========================================
  await t.test("22. Worker restart: New worker resumes execution seamlessly from DB state", async () => {
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Restart Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollId}', '${campId}', '${leadA1}', '${bizA}', 'RUNNING', '${stepId}', NOW());
    `);

    // Simulate "Old worker crashed before processing"
    // Create new worker instance
    const freshMock = new MockEmailProvider();
    const restartedWorkerEngine = new TestExecutionEngine(db, { provider: freshMock });

    const results = await restartedWorkerEngine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(freshMock.sentEmails.length, 1);
  });

  // ==========================================
  // Test Case 23: Development send limit
  // ==========================================
  await t.test("23. Development send limit: Capped at CAMPAIGN_DEV_SEND_LIMIT per cycle", async () => {
    const mockProvider = new MockEmailProvider();
    const devLimit = 2;
    const engine = new TestExecutionEngine(db, { provider: mockProvider, devSendLimit: devLimit });

    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Dev Limit Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    // Create 4 due enrollments
    for (let i = 0; i < 4; i++) {
      const lid = crypto.randomUUID();
      db.public.none(`
        INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
        VALUES ('${lid}', '${bizA}', 'User${i}', 'Test', 'u${i}@alphacorp.com', 'Co', 'new');
      `);
      db.public.none(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
        VALUES ('${crypto.randomUUID()}', '${campId}', '${lid}', '${bizA}', 'RUNNING', '${stepId}', NOW());
      `);
    }

    const results = await engine.processDueEnrollments({ campaignId: campId, limit: 10 });
    assert.equal(results.length, devLimit, `Expected dev limit of ${devLimit}`);
    assert.equal(mockProvider.sentEmails.length, devLimit);
  });

  // ==========================================
  // Test Case 24: Batch size
  // ==========================================
  await t.test("24. Batch size: Respects CAMPAIGN_WORKER_BATCH_SIZE limit parameter", () => {
    const engine = new TestExecutionEngine(db, { devSendLimit: 100 });
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizA}', 'Batch Camp', 'ACTIVE', 'UTC');
    `);

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepId}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tplA1}');
    `);

    for (let i = 0; i < 5; i++) {
      const lid = crypto.randomUUID();
      db.public.none(`
        INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
        VALUES ('${lid}', '${bizA}', 'LeadBatch${i}', 'Test', 'batch${i}@alphacorp.com', 'Co', 'new');
      `);
      db.public.none(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
        VALUES ('${crypto.randomUUID()}', '${campId}', '${lid}', '${bizA}', 'RUNNING', '${stepId}', NOW());
      `);
    }

    const batch = engine.claimDueEnrollments({ campaignId: campId, limit: 3 });
    assert.equal(batch.length, 3);
  });

  // ==========================================
  // Test Case 25: Multi-tenant isolation
  // ==========================================
  await t.test("25. Multi-tenant isolation: Processing Biz A never touches or leaks Biz B enrollments", async () => {
    const mockProvider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider: mockProvider, devSendLimit: 50 });

    // Campaign for Biz B
    const campBId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campBId}', '${bizB}', 'Beta Secret Campaign', 'ACTIVE', 'UTC');
    `);

    const stepBId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES ('${stepBId}', '${campBId}', 1, 'Gotham Alert', 0, 'minutes', 'ACTIVE', '${tplB1}');
    `);

    const enrollBId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, next_step_id, next_run_at)
      VALUES ('${enrollBId}', '${campBId}', '${leadB1}', '${bizB}', 'RUNNING', '${stepBId}', NOW());
    `);

    // Execute cycle strictly scoped to Biz A
    const resultsBizA = await engine.processDueEnrollments({ businessId: bizA });

    // Verify no Biz B contacts were processed
    const processedForB = resultsBizA.filter((r) => r.enrollmentId === enrollBId);
    assert.equal(processedForB.length, 0, "Biz A worker must never process Biz B enrollments");

    // Check Biz B enrollment remains untouched and due
    const enrollBAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollBId}';`);
    assert.equal(enrollBAfter.status, "RUNNING");
    assert.ok(enrollBAfter.current_step === 0 || enrollBAfter.current_step === null);

    // Now execute strictly for Biz B
    const resultsBizB = await engine.processDueEnrollments({ businessId: bizB });
    assert.equal(resultsBizB.length, 1);
    assert.equal(resultsBizB[0].enrollmentId, enrollBId);
    assert.equal(resultsBizB[0].status, "SUCCESS");

    // Verify email content sent was strictly Biz B
    const emailToBruce = mockProvider.sentEmails.find((e) => e.to === "bruce@wayne.com");
    assert.ok(emailToBruce);
    assert.equal(emailToBruce.businessId, bizB);
    assert.equal(emailToBruce.campaignId, campBId);
  });
});
