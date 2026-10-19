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
    this.devSendLimit = options.devSendLimit ?? null;
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
    const minutes = Math.min(Math.pow(2, retryCount), 60);
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
    const limit = options.limit || 100;
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
    const batchLimit = options.limit || 100;
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

    if (lead.business_id !== campaign.business_id) {
      this.db.public.none(
        `UPDATE campaign_leads SET status = 'FAILED', last_error = 'CROSS_TENANT_LEAD_ACCESS', updated_at = NOW() WHERE id = '${enrollment.id}';`
      );
      return { enrollmentId: enrollment.id, status: "FAILED", error: "CROSS_TENANT_LEAD_ACCESS" };
    }

    // Suppression Check
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

    // Email Syntax Check
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

    // Determine step to execute
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

    // Idempotency Check
    const idempotencyKey = `${campaign.business_id}:${campaign.id}:${enrollment.id}:step_${step.step_number}`;
    const existingLog = this.oneOrNone(
      `SELECT * FROM campaign_execution_logs WHERE idempotency_key = '${idempotencyKey}';`
    );

    if (existingLog && existingLog.status === "SUCCESS") {
      return this.advanceToNextStep(enrollment, step, new Date().toISOString(), true);
    }

    // Render Template
    const rendered = renderTemplate(
      { subject: template.subject, body: template.body },
      lead,
      { sender_name: "Opsiys", business_name: "Test Biz" }
    );

    // Send email
    const sendResult = await this.provider.sendEmail({
      to: lead.email,
      subject: rendered.subject,
      html: rendered.body,
      businessId: campaign.business_id,
      campaignId: campaign.id,
      stepId: step.id,
    });

    const executionTimestamp = new Date().toISOString();

    if (sendResult.success) {
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

      return this.advanceToNextStep(enrollment, step, executionTimestamp, false);
    } else {
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

test("Phase 8 Specific Audit Test Scenarios", async (t) => {
  const { db } = createTestDb();

  const bizId = crypto.randomUUID();
  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizId}', 'Audit Corp', 'UTC', 'active');
  `);

  // Create 3 templates
  const tpl1 = crypto.randomUUID();
  const tpl2 = crypto.randomUUID();
  const tpl3 = crypto.randomUUID();
  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status)
    VALUES 
      ('${tpl1}', '${bizId}', 'Step 1 Intro', 'Intro: {{first_name}}', '<p>Hello {{first_name}}</p>', 'active'),
      ('${tpl2}', '${bizId}', 'Step 2 Followup', 'Followup: {{first_name}}', '<p>Checking in</p>', 'active'),
      ('${tpl3}', '${bizId}', 'Step 3 Final', 'Final: {{first_name}}', '<p>Final notice</p>', 'active');
  `);

  // Helper to create 3-step campaign
  function create3StepCampaign(name) {
    const campId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES ('${campId}', '${bizId}', '${name}', 'ACTIVE', 'UTC');
    `);

    const s1 = crypto.randomUUID();
    const s2 = crypto.randomUUID();
    const s3 = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id)
      VALUES 
        ('${s1}', '${campId}', 1, 'Step 1', 0, 'minutes', 'ACTIVE', '${tpl1}'),
        ('${s2}', '${campId}', 2, 'Step 2', 10, 'minutes', 'ACTIVE', '${tpl2}'),
        ('${s3}', '${campId}', 3, 'Step 3', 1, 'days', 'ACTIVE', '${tpl3}');
    `);

    return { campId, s1, s2, s3 };
  }

  // =========================================================================
  // SCENARIO 1: 1 contact / 3 steps
  // =========================================================================
  await t.test("Scenario 1: 1 contact / 3 steps progression to completion", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId } = create3StepCampaign("1 Contact 3 Steps Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'Alice', 'One', 'alice@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status)
      VALUES ('${enrollId}', '${campId}', '${leadId}', '${bizId}', 'ENROLLED');
    `);

    // 1. Initialize
    engine.initializeEnrollments(campId, bizId);

    // 2. Execute Step 1 (immediate)
    const res1 = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(res1.length, 1);
    assert.equal(res1[0].status, "SUCCESS");
    assert.equal(res1[0].stepCompleted, 1);
    assert.equal(res1[0].nextStepNumber, 2);
    assert.equal(provider.sentEmails.length, 1);
    assert.equal(provider.sentEmails[0].to, "alice@audit.com");

    let enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enroll.current_step, 1);
    assert.equal(enroll.status, "RUNNING");

    // 3. Fast-forward to Step 2
    db.public.none(`UPDATE campaign_leads SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = '${enrollId}';`);
    const res2 = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(res2.length, 1);
    assert.equal(res2[0].status, "SUCCESS");
    assert.equal(res2[0].stepCompleted, 2);
    assert.equal(res2[0].nextStepNumber, 3);
    assert.equal(provider.sentEmails.length, 2);

    enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enroll.current_step, 2);

    // 4. Fast-forward to Step 3
    db.public.none(`UPDATE campaign_leads SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = '${enrollId}';`);
    const res3 = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(res3.length, 1);
    assert.equal(res3[0].status, "SUCCESS");
    assert.equal(res3[0].stepCompleted, 3);
    assert.equal(res3[0].isCompleted, true);
    assert.equal(provider.sentEmails.length, 3);

    // Final verification
    enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enroll.status, "COMPLETED");
    assert.equal(enroll.current_step, 3);
    assert.equal(enroll.next_step_id, null);
    assert.equal(enroll.next_run_at, null);
    assert.ok(enroll.completed_at);
  });

  // =========================================================================
  // SCENARIO 2: 20 contacts / 3 steps
  // =========================================================================
  await t.test("Scenario 2: 20 contacts / 3 steps full lifecycle", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId } = create3StepCampaign("20 Contacts Campaign");

    // Create 20 leads & enrollments
    const enrollIds = [];
    for (let i = 1; i <= 20; i++) {
      const lid = crypto.randomUUID();
      db.public.none(`
        INSERT INTO leads (id, business_id, first_name, last_name, email, status)
        VALUES ('${lid}', '${bizId}', 'User${i}', 'Twenty', 'user${i}@audit20.com', 'new');
      `);
      const eid = crypto.randomUUID();
      enrollIds.push(eid);
      db.public.none(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status)
        VALUES ('${eid}', '${campId}', '${lid}', '${bizId}', 'ENROLLED');
      `);
    }

    // Initialize all 20
    engine.initializeEnrollments(campId, bizId);

    // Step 1: Process all 20
    const resStep1 = await engine.processDueEnrollments({ campaignId: campId, limit: 100 });
    assert.equal(resStep1.length, 20);
    assert.ok(resStep1.every((r) => r.status === "SUCCESS" && r.stepCompleted === 1));
    assert.equal(provider.sentEmails.length, 20);

    // Step 2: Fast-forward all 20 to due
    db.public.none(`UPDATE campaign_leads SET next_run_at = NOW() - INTERVAL '1 minute' WHERE campaign_id = '${campId}';`);
    const resStep2 = await engine.processDueEnrollments({ campaignId: campId, limit: 100 });
    assert.equal(resStep2.length, 20);
    assert.ok(resStep2.every((r) => r.status === "SUCCESS" && r.stepCompleted === 2));
    assert.equal(provider.sentEmails.length, 40);

    // Step 3: Fast-forward all 20 to due
    db.public.none(`UPDATE campaign_leads SET next_run_at = NOW() - INTERVAL '1 minute' WHERE campaign_id = '${campId}';`);
    const resStep3 = await engine.processDueEnrollments({ campaignId: campId, limit: 100 });
    assert.equal(resStep3.length, 20);
    assert.ok(resStep3.every((r) => r.status === "SUCCESS" && r.stepCompleted === 3 && r.isCompleted));
    assert.equal(provider.sentEmails.length, 60);

    // Verify all 20 enrollments are COMPLETED
    const completedRows = db.public.many(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${campId}' AND status = 'COMPLETED';
    `);
    assert.equal(completedRows.length, 20);
  });

  // =========================================================================
  // SCENARIO 3: worker restart
  // =========================================================================
  await t.test("Scenario 3: worker restart resumes execution from DB state", async () => {
    const { campId, s2 } = create3StepCampaign("Worker Restart Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'RestartUser', 'Test', 'restart@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    // Precondition: Step 1 completed before restart; next step is step 2 due now
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 1, '${s2}', NOW() - INTERVAL '10 seconds'
      );
    `);

    // Simulate Worker 1 died / new Worker 2 boots up with clean in-memory state
    const providerWorker2 = new MockEmailProvider();
    const engineWorker2 = new TestExecutionEngine(db, { provider: providerWorker2 });

    const results = await engineWorker2.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "SUCCESS");
    assert.equal(results[0].stepCompleted, 2);
    assert.equal(providerWorker2.sentEmails.length, 1);

    const enrollAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollAfter.current_step, 2);
  });

  // =========================================================================
  // SCENARIO 4: duplicate worker execution / idempotency
  // =========================================================================
  await t.test("Scenario 4: duplicate worker execution prevents double send", async () => {
    const { campId, s1 } = create3StepCampaign("Duplicate Exec Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'DupeUser', 'Test', 'dupe@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW()
      );
    `);

    // Worker 1 executes and finishes step 1
    const provider1 = new MockEmailProvider();
    const worker1 = new TestExecutionEngine(db, { provider: provider1 });
    const res1 = await worker1.processDueEnrollments({ campaignId: campId });
    assert.equal(res1[0].status, "SUCCESS");
    assert.equal(provider1.sentEmails.length, 1);

    // Simulate worker 2 erroneously attempting step 1 again on the same enrollment
    const provider2 = new MockEmailProvider();
    const worker2 = new TestExecutionEngine(db, { provider: provider2 });

    // Manually force enrollment back to step 1 next_step_id and due time to simulate edge race
    db.public.none(`
      UPDATE campaign_leads 
      SET next_step_id = '${s1}', next_run_at = NOW(), current_step = 0 
      WHERE id = '${enrollId}';
    `);

    const res2 = await worker2.processDueEnrollments({ campaignId: campId });
    assert.equal(res2.length, 1);
    assert.equal(res2[0].status, "DUPLICATE_SKIPPED");
    assert.equal(provider2.sentEmails.length, 0, "No duplicate email dispatched!");
  });

  // =========================================================================
  // SCENARIO 5: paused campaign
  // =========================================================================
  await t.test("Scenario 5: paused campaign skips execution", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId, s1 } = create3StepCampaign("Paused Campaign");

    // Pause campaign
    db.public.none(`UPDATE campaigns SET status = 'PAUSED' WHERE id = '${campId}';`);

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'PauseUser', 'Test', 'pause@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW() - INTERVAL '5 minutes'
      );
    `);

    // Run worker
    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 0, "Paused campaign must yield 0 claimed jobs");
    assert.equal(provider.sentEmails.length, 0);

    // Verify enrollment remains untouched with next_run_at intact
    const enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.ok(enroll.next_run_at);
  });

  // =========================================================================
  // SCENARIO 6: resumed campaign
  // =========================================================================
  await t.test("Scenario 6: resumed campaign executes pending enrollments", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId, s1 } = create3StepCampaign("Resume Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'ResumeUser', 'Test', 'resume@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW() - INTERVAL '5 minutes'
      );
    `);

    // Pause then Resume
    db.public.none(`UPDATE campaigns SET status = 'PAUSED' WHERE id = '${campId}';`);
    const pausedResults = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(pausedResults.length, 0);

    // Resume to ACTIVE
    db.public.none(`UPDATE campaigns SET status = 'ACTIVE' WHERE id = '${campId}';`);
    const resumedResults = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(resumedResults.length, 1);
    assert.equal(resumedResults[0].status, "SUCCESS");
    assert.equal(provider.sentEmails.length, 1);
  });

  // =========================================================================
  // SCENARIO 7: suppressed contact
  // =========================================================================
  await t.test("Scenario 7: suppressed contact is stopped without dispatch", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId, s1 } = create3StepCampaign("Suppression Campaign");

    const leadId = crypto.randomUUID();
    const suppressedEmail = "suppressed_target@audit.com";
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'Suppressed', 'User', '${suppressedEmail}', 'new');
    `);

    // Put on suppression list
    db.public.none(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES ('${crypto.randomUUID()}', '${bizId}', '${suppressedEmail}', 'unsubscribe', NOW());
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW()
      );
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "STOPPED");
    assert.equal(results[0].error, "RECIPIENT_SUPPRESSED");
    assert.equal(provider.sentEmails.length, 0, "No email sent to suppressed contact!");

    const enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enroll.status, "STOPPED");
    assert.ok(enroll.stopped_at);
    assert.ok(enroll.last_error.includes("RECIPIENT_SUPPRESSED"));
  });

  // =========================================================================
  // SCENARIO 8: failed email
  // =========================================================================
  await t.test("Scenario 8: failed email records failure and increments retry_count", async () => {
    const provider = new MockEmailProvider({ shouldFail: true, errorMessage: "Resend 500 error" });
    const engine = new TestExecutionEngine(db, { provider, maxRetries: 3 });
    const { campId, s1 } = create3StepCampaign("Failed Email Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'FailUser', 'Test', 'fail@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at, retry_count
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW(), 0
      );
    `);

    const results = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "RETRY_SCHEDULED");

    const enroll = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enroll.retry_count, 1);
    assert.ok(enroll.next_run_at);
    assert.ok(enroll.last_error.includes("Resend 500 error"));

    // Check execution log
    const log = db.public.one(`SELECT * FROM campaign_execution_logs WHERE enrollment_id = '${enrollId}';`);
    assert.equal(log.status, "FAILED");
    assert.equal(log.attempt_number, 1);
  });

  // =========================================================================
  // SCENARIO 9: retry logic & recovery
  // =========================================================================
  await t.test("Scenario 9: retry logic - recovery on retry and max retries failure", async () => {
    // 9a. Recovery on retry
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider, maxRetries: 3 });
    const { campId, s1 } = create3StepCampaign("Retry Recovery Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'RetryUser', 'Test', 'retry@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    // Simulate was on retry 1, now due
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at, retry_count
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 0, '${s1}', NOW() - INTERVAL '1 minute', 1
      );
    `);

    // Worker runs and provider succeeds
    const res = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(res[0].status, "SUCCESS");
    assert.equal(provider.sentEmails.length, 1);

    const enrollAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollAfter.current_step, 1);
    assert.equal(enrollAfter.retry_count, 0, "retry_count resets to 0 on success");

    // 9b. Max retries exceeded
    const failingProvider = new MockEmailProvider({ shouldFail: true, errorMessage: "Persistent DNS error" });
    const failingEngine = new TestExecutionEngine(db, { provider: failingProvider, maxRetries: 3 });

    const leadIdMax = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadIdMax}', '${bizId}', 'MaxRetryUser', 'Test', 'maxretry@audit.com', 'new');
    `);

    const enrollIdMax = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at, retry_count
      ) VALUES (
        '${enrollIdMax}', '${campId}', '${leadIdMax}', '${bizId}', 'RUNNING', 0, '${s1}', NOW(), 2
      );
    `);

    const resMax = await failingEngine.processDueEnrollments({ campaignId: campId });
    assert.equal(resMax[0].status, "FAILED");

    const enrollMaxAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollIdMax}';`);
    assert.equal(enrollMaxAfter.status, "FAILED");
    assert.equal(enrollMaxAfter.retry_count, 3);
    assert.ok(enrollMaxAfter.last_error.includes("Persistent DNS error"));
  });

  // =========================================================================
  // SCENARIO 10: completed campaign
  // =========================================================================
  await t.test("Scenario 10: completed campaign transitions and is not re-processed", async () => {
    const provider = new MockEmailProvider();
    const engine = new TestExecutionEngine(db, { provider });
    const { campId, s3 } = create3StepCampaign("Complete Campaign");

    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, status)
      VALUES ('${leadId}', '${bizId}', 'FinUser', 'Test', 'fin@audit.com', 'new');
    `);

    const enrollId = crypto.randomUUID();
    // At Step 3 (the final step)
    db.public.none(`
      INSERT INTO campaign_leads (
        id, campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at
      ) VALUES (
        '${enrollId}', '${campId}', '${leadId}', '${bizId}', 'RUNNING', 2, '${s3}', NOW()
      );
    `);

    // Process final step
    const res = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(res.length, 1);
    assert.equal(res[0].status, "SUCCESS");
    assert.equal(res[0].stepCompleted, 3);
    assert.equal(res[0].isCompleted, true);

    const enrollAfter = db.public.one(`SELECT * FROM campaign_leads WHERE id = '${enrollId}';`);
    assert.equal(enrollAfter.status, "COMPLETED");
    assert.equal(enrollAfter.current_step, 3);
    assert.equal(enrollAfter.next_step_id, null);
    assert.equal(enrollAfter.next_run_at, null);
    assert.ok(enrollAfter.completed_at);

    // Subsequent worker cycle must not pick it up
    const subsequentResults = await engine.processDueEnrollments({ campaignId: campId });
    assert.equal(subsequentResults.length, 0, "Completed enrollments must never be claimed or re-processed");
  });
});
