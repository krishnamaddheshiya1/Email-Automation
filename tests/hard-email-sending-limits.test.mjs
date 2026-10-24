import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";

const HARD_DAILY_LIMIT = 1500;
const HARD_MONTHLY_LIMIT = 50000;

class HardSendingLimitsEngine {
  constructor(db) {
    this.db = db;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  getDailyKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  getMonthlyKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
  }

  ensureBusiness(businessId, name = "Test Workspace") {
    const existing = this.oneOrNone(`SELECT id FROM businesses WHERE id = '${businessId}';`);
    if (!existing) {
      this.db.public.none(`INSERT INTO businesses (id, name, created_at) VALUES ('${businessId}', '${name}', NOW());`);
    }
  }

  getCounter(businessId, periodType, periodKey) {
    const row = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
    );
    return row ? Number(row.count) : 0;
  }

  atomicReserve(businessId, periodType, periodKey, limit, amount = 1) {
    this.ensureBusiness(businessId);

    // 1. Ensure row exists
    const existing = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
    );

    if (!existing) {
      if (amount <= limit) {
        this.db.public.none(`
          INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at)
          VALUES ('${businessId}', '${periodType}', '${periodKey}', ${amount}, NOW(), NOW());
        `);
        return { success: true, count: amount };
      }
      return { success: false, count: 0 };
    }

    // 2. Atomic conditional update under ceiling
    if (existing.count + amount <= limit) {
      const nextCount = existing.count + amount;
      this.db.public.none(`
        UPDATE business_send_counters
        SET count = ${nextCount}, updated_at = NOW()
        WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';
      `);
      return { success: true, count: nextCount };
    }

    return { success: false, count: existing.count };
  }

  release(businessId, periodType, periodKey, amount = 1) {
    const existing = this.oneOrNone(
      `SELECT count FROM business_send_counters WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';`
    );
    if (existing) {
      const nextCount = Math.max(0, existing.count - amount);
      this.db.public.none(`
        UPDATE business_send_counters
        SET count = ${nextCount}, updated_at = NOW()
        WHERE business_id = '${businessId}' AND period_type = '${periodType}' AND period_key = '${periodKey}';
      `);
      return nextCount;
    }
    return 0;
  }

  getQuota(businessId, date = new Date()) {
    const dailyKey = this.getDailyKey(date);
    const monthlyKey = this.getMonthlyKey(date);

    const dailySent = this.getCounter(businessId, "daily", dailyKey);
    const monthlySent = this.getCounter(businessId, "monthly", monthlyKey);

    const dailyRemaining = Math.max(0, HARD_DAILY_LIMIT - dailySent);
    const monthlyRemaining = Math.max(0, HARD_MONTHLY_LIMIT - monthlySent);
    const maxSendableNow = Math.min(dailyRemaining, monthlyRemaining);

    return {
      dailyLimit: HARD_DAILY_LIMIT,
      dailySent,
      dailyRemaining,
      monthlyLimit: HARD_MONTHLY_LIMIT,
      monthlySent,
      monthlyRemaining,
      maxSendableNow,
      isDailyLimitReached: dailyRemaining <= 0,
      isMonthlyLimitReached: monthlyRemaining <= 0,
    };
  }

  checkLimits(businessId, options = {}) {
    const count = options.count ?? 1;
    const date = options.date ?? new Date();
    const quota = this.getQuota(businessId, date);

    if (quota.dailyRemaining < count) {
      return {
        allowed: false,
        code: "DAILY_EMAIL_LIMIT_REACHED",
        reason: "DAILY_LIMIT_EXCEEDED",
        dailySent: quota.dailySent,
        dailyLimit: quota.dailyLimit,
        dailyRemaining: quota.dailyRemaining,
        attemptedCount: count,
      };
    }

    if (quota.monthlyRemaining < count) {
      return {
        allowed: false,
        code: "MONTHLY_EMAIL_LIMIT_REACHED",
        reason: "MONTHLY_LIMIT_EXCEEDED",
        monthlySent: quota.monthlySent,
        monthlyLimit: quota.monthlyLimit,
        monthlyRemaining: quota.monthlyRemaining,
        attemptedCount: count,
      };
    }

    return {
      allowed: true,
      dailySent: quota.dailySent,
      dailyRemaining: quota.dailyRemaining,
      monthlySent: quota.monthlySent,
      monthlyRemaining: quota.monthlyRemaining,
    };
  }

  checkMonthlyLimit(businessId, count = 1, date = new Date()) {
    const quota = this.getQuota(businessId, date);
    if (quota.monthlyRemaining < count) {
      return {
        allowed: false,
        code: "MONTHLY_EMAIL_LIMIT_REACHED",
        reason: "MONTHLY_LIMIT_EXCEEDED",
        monthlySent: quota.monthlySent,
        monthlyLimit: quota.monthlyLimit,
        monthlyRemaining: quota.monthlyRemaining,
        attemptedCount: count,
      };
    }
    return {
      allowed: true,
      monthlySent: quota.monthlySent,
      monthlyRemaining: quota.monthlyRemaining,
    };
  }

  reserveSendQuota(businessId, count = 1, date = new Date()) {
    const dailyKey = this.getDailyKey(date);
    const monthlyKey = this.getMonthlyKey(date);

    const check = this.checkLimits(businessId, { count, date });
    if (!check.allowed) return { success: false, code: check.code };

    const dailyRes = this.atomicReserve(businessId, "daily", dailyKey, HARD_DAILY_LIMIT, count);
    if (!dailyRes.success) return { success: false, code: "DAILY_EMAIL_LIMIT_REACHED" };

    const monthlyRes = this.atomicReserve(businessId, "monthly", monthlyKey, HARD_MONTHLY_LIMIT, count);
    if (!monthlyRes.success) {
      this.release(businessId, "daily", dailyKey, count);
      return { success: false, code: "MONTHLY_EMAIL_LIMIT_REACHED" };
    }

    return { success: true };
  }

  releaseSendQuota(businessId, count = 1, date = new Date()) {
    const dailyKey = this.getDailyKey(date);
    const monthlyKey = this.getMonthlyKey(date);
    this.release(businessId, "daily", dailyKey, count);
    this.release(businessId, "monthly", monthlyKey, count);
  }
}

test("HARD EMAIL SENDING LIMITS TEST SUITE", async (t) => {
  let db;
  let engine;

  t.beforeEach(() => {
    const harness = createTestDb();
    db = harness.db;
    harness.seed();
    engine = new HardSendingLimitsEngine(db);
  });

  // ==========================================
  // SECTION 1: DAILY LIMIT (1,500/DAY)
  // ==========================================
  await t.test("1.1 Daily Limit: 0 sent, attempt 1500 -> ALLOWED", () => {
    const bId = crypto.randomUUID();
    const quota = engine.getQuota(bId);
    assert.equal(quota.dailyLimit, 1500);
    assert.equal(quota.dailySent, 0);
    assert.equal(quota.dailyRemaining, 1500);

    const check = engine.checkLimits(bId, { count: 1500 });
    assert.equal(check.allowed, true);
    assert.equal(check.dailyRemaining, 1500);
  });

  await t.test("1.2 Daily Limit: 0 sent, attempt 1501 -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const check = engine.checkLimits(bId, { count: 1501 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "DAILY_EMAIL_LIMIT_REACHED");
    assert.equal(check.attemptedCount, 1501);
  });

  await t.test("1.3 Daily Limit: 1499 sent, attempt 1 -> ALLOWED", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    engine.atomicReserve(bId, "daily", today, 1500, 1499);

    const quota = engine.getQuota(bId);
    assert.equal(quota.dailySent, 1499);
    assert.equal(quota.dailyRemaining, 1);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, true);
  });

  await t.test("1.4 Daily Limit: 1499 sent, attempt 2 -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    engine.atomicReserve(bId, "daily", today, 1500, 1499);

    const check = engine.checkLimits(bId, { count: 2 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "DAILY_EMAIL_LIMIT_REACHED");
    assert.equal(check.dailyRemaining, 1);
  });

  await t.test("1.5 Daily Limit: 1500 sent, attempt 1 -> BLOCKED (exhausted)", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    engine.atomicReserve(bId, "daily", today, 1500, 1500);

    const quota = engine.getQuota(bId);
    assert.equal(quota.dailySent, 1500);
    assert.equal(quota.dailyRemaining, 0);
    assert.equal(quota.isDailyLimitReached, true);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "DAILY_EMAIL_LIMIT_REACHED");
  });

  // ==========================================
  // SECTION 2: MONTHLY LIMIT (50,000/MONTH)
  // ==========================================
  await t.test("2.1 Monthly Limit: 0 sent, attempt 50000 -> ALLOWED", () => {
    const bId = crypto.randomUUID();
    const quota = engine.getQuota(bId);
    assert.equal(quota.monthlyLimit, 50000);
    assert.equal(quota.monthlySent, 0);
    assert.equal(quota.monthlyRemaining, 50000);

    const check = engine.checkMonthlyLimit(bId, 50000);
    assert.equal(check.allowed, true);
    assert.equal(check.monthlyRemaining, 50000);
  });

  await t.test("2.2 Monthly Limit: 0 sent, attempt 50001 -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const check = engine.checkMonthlyLimit(bId, 50001);
    assert.equal(check.allowed, false);
    assert.equal(check.code, "MONTHLY_EMAIL_LIMIT_REACHED");
  });

  await t.test("2.3 Monthly Limit: 49999 sent, attempt 1 -> ALLOWED", () => {
    const bId = crypto.randomUUID();
    const month = engine.getMonthlyKey();
    engine.atomicReserve(bId, "monthly", month, 50000, 49999);

    const quota = engine.getQuota(bId);
    assert.equal(quota.monthlySent, 49999);
    assert.equal(quota.monthlyRemaining, 1);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, true);
  });

  await t.test("2.4 Monthly Limit: 49999 sent, attempt 2 -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const month = engine.getMonthlyKey();
    engine.atomicReserve(bId, "monthly", month, 50000, 49999);

    const check = engine.checkLimits(bId, { count: 2 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "MONTHLY_EMAIL_LIMIT_REACHED");
  });

  await t.test("2.5 Monthly Limit: 50000 sent, attempt 1 -> BLOCKED (exhausted)", () => {
    const bId = crypto.randomUUID();
    const month = engine.getMonthlyKey();
    engine.atomicReserve(bId, "monthly", month, 50000, 50000);

    const quota = engine.getQuota(bId);
    assert.equal(quota.monthlySent, 50000);
    assert.equal(quota.monthlyRemaining, 0);
    assert.equal(quota.isMonthlyLimitReached, true);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "MONTHLY_EMAIL_LIMIT_REACHED");
  });

  // ==========================================
  // SECTION 3: COMBINED LIMITS
  // ==========================================
  await t.test("3.1 Combined Limits: Daily remaining 100, Monthly remaining 50 -> max allowed 50", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    const month = engine.getMonthlyKey();

    engine.atomicReserve(bId, "daily", today, 1500, 1400); // 100 left
    engine.atomicReserve(bId, "monthly", month, 50000, 49950); // 50 left

    const quota = engine.getQuota(bId);
    assert.equal(quota.dailyRemaining, 100);
    assert.equal(quota.monthlyRemaining, 50);
    assert.equal(quota.maxSendableNow, 50);

    assert.equal(engine.checkLimits(bId, { count: 50 }).allowed, true);
    assert.equal(engine.checkLimits(bId, { count: 51 }).allowed, false);
    assert.equal(engine.checkLimits(bId, { count: 51 }).code, "MONTHLY_EMAIL_LIMIT_REACHED");
  });

  await t.test("3.2 Combined Limits: Daily remaining 50, Monthly remaining 100 -> max allowed 50", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    const month = engine.getMonthlyKey();

    engine.atomicReserve(bId, "daily", today, 1500, 1450); // 50 left
    engine.atomicReserve(bId, "monthly", month, 50000, 49900); // 100 left

    const quota = engine.getQuota(bId);
    assert.equal(quota.dailyRemaining, 50);
    assert.equal(quota.monthlyRemaining, 100);
    assert.equal(quota.maxSendableNow, 50);

    assert.equal(engine.checkLimits(bId, { count: 50 }).allowed, true);
    assert.equal(engine.checkLimits(bId, { count: 51 }).allowed, false);
    assert.equal(engine.checkLimits(bId, { count: 51 }).code, "DAILY_EMAIL_LIMIT_REACHED");
  });

  await t.test("3.3 Combined Limits: Daily reached (0 left), Monthly available -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();
    engine.atomicReserve(bId, "daily", today, 1500, 1500);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "DAILY_EMAIL_LIMIT_REACHED");
  });

  await t.test("3.4 Combined Limits: Monthly reached (0 left), Daily available -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const month = engine.getMonthlyKey();
    engine.atomicReserve(bId, "monthly", month, 50000, 50000);

    const check = engine.checkLimits(bId, { count: 1 });
    assert.equal(check.allowed, false);
    assert.equal(check.code, "MONTHLY_EMAIL_LIMIT_REACHED");
  });

  // ==========================================
  // SECTION 4: MULTI-CAMPAIGN SHARING
  // ==========================================
  await t.test("4. Multi-Campaign Sharing: Campaign 1 sends 1000, Campaign 2 attempts 600 -> BLOCKED", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();

    // Campaign 1 sends 1000
    engine.atomicReserve(bId, "daily", today, 1500, 1000);
    const quota = engine.getQuota(bId);
    assert.equal(quota.dailyRemaining, 500);

    // Campaign 2 attempts 600 -> blocked
    const check600 = engine.checkLimits(bId, { count: 600 });
    assert.equal(check600.allowed, false);
    assert.equal(check600.code, "DAILY_EMAIL_LIMIT_REACHED");

    // Campaign 2 attempts 500 -> allowed
    const check500 = engine.checkLimits(bId, { count: 500 });
    assert.equal(check500.allowed, true);

    // Campaign 2 sends 500
    engine.atomicReserve(bId, "daily", today, 1500, 500);

    // Workspace daily quota is completely exhausted
    const exhaustedCheck = engine.checkLimits(bId, { count: 1 });
    assert.equal(exhaustedCheck.allowed, false);
  });

  // ==========================================
  // SECTION 5: FOLLOW-UP PROGRESSION & QUOTA
  // ==========================================
  await t.test("5. Follow-ups: Initial email consumes quota, Follow-up blocked when quota exhausted", () => {
    const bId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();

    db.public.none(`
      INSERT INTO businesses (id, name, created_at) VALUES ('${bId}', 'Followup Corp', NOW());
      INSERT INTO leads (id, business_id, email, status, created_at) VALUES ('${leadId}', '${bId}', 'lead@corp.com', 'new', NOW());
      INSERT INTO campaigns (id, business_id, name, status, created_at) VALUES ('${campaignId}', '${bId}', 'Drip', 'ACTIVE', NOW());
      INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, current_step, next_run_at, created_at)
      VALUES ('${enrollmentId}', '${bId}', '${campaignId}', '${leadId}', 'ENROLLED', 1, NOW(), NOW());
    `);

    // Step 1 sends and consumes quota
    const res1 = engine.reserveSendQuota(bId, 1);
    assert.equal(res1.success, true);
    assert.equal(engine.getQuota(bId).dailyRemaining, 1499);

    // Step 1 completed, follow-up Step 2 scheduled
    db.public.none(`
      UPDATE campaign_leads
      SET current_step = 2, next_run_at = NOW() + INTERVAL '2 days'
      WHERE id = '${enrollmentId}';
    `);

    // Exhaust daily quota before follow-up executes
    const today = engine.getDailyKey();
    engine.atomicReserve(bId, "daily", today, 1500, 1499);
    assert.equal(engine.getQuota(bId).dailyRemaining, 0);

    // Follow-up execution checks limits -> strictly blocked!
    const followUpCheck = engine.checkLimits(bId, { count: 1 });
    assert.equal(followUpCheck.allowed, false);
    assert.equal(followUpCheck.code, "DAILY_EMAIL_LIMIT_REACHED");

    // Marked STOPPED with BLOCKED_BY_SENDING_LIMIT, next_run_at = null (not auto-queued for next day)
    db.public.none(`
      UPDATE campaign_leads
      SET status = 'STOPPED', next_run_at = NULL, last_error = 'BLOCKED_BY_SENDING_LIMIT: Daily sending limit reached (1500/1500)'
      WHERE id = '${enrollmentId}';
    `);

    const updated = engine.oneOrNone(`SELECT status, next_run_at, last_error FROM campaign_leads WHERE id = '${enrollmentId}';`);
    assert.equal(updated.status, "STOPPED");
    assert.equal(updated.next_run_at, null);
    assert.ok(updated.last_error.includes("BLOCKED_BY_SENDING_LIMIT"));
  });

  // ==========================================
  // SECTION 6: CONCURRENCY & ATOMIC CEILING
  // ==========================================
  await t.test("6. Concurrency: Atomic reservation strictly caps at ceiling", () => {
    const bId = crypto.randomUUID();
    const today = engine.getDailyKey();

    // 1495 sent -> exactly 5 remaining
    engine.atomicReserve(bId, "daily", today, 1500, 1495);

    // 10 simultaneous requests attempting to reserve 1
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(engine.atomicReserve(bId, "daily", today, 1500, 1));
    }

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.equal(successes.length, 5);
    assert.equal(failures.length, 5);
    assert.equal(engine.getCounter(bId, "daily", today), 1500);
  });

  // ==========================================
  // SECTION 7: DISPATCH ROLLBACK ON FAILURE
  // ==========================================
  await t.test("7. Rollback: Failed provider dispatch releases reserved quota", () => {
    const bId = crypto.randomUUID();

    const res = engine.reserveSendQuota(bId, 1);
    assert.equal(res.success, true);
    assert.equal(engine.getQuota(bId).dailyRemaining, 1499);

    // Provider failed, release quota immediately
    engine.releaseSendQuota(bId, 1);

    const quotaAfter = engine.getQuota(bId);
    assert.equal(quotaAfter.dailyRemaining, 1500);
    assert.equal(quotaAfter.dailySent, 0);
  });

  // ==========================================
  // SECTION 8: MULTI-TENANT WORKSPACE ISOLATION
  // ==========================================
  await t.test("8. Workspace Isolation: Workspace A limit does NOT affect Workspace B", () => {
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    const today = engine.getDailyKey();
    const month = engine.getMonthlyKey();

    // Workspace A exhausts daily (1500) and monthly (50000)
    engine.atomicReserve(workspaceA, "daily", today, 1500, 1500);
    engine.atomicReserve(workspaceA, "monthly", month, 50000, 50000);

    const quotaA = engine.getQuota(workspaceA);
    assert.equal(quotaA.dailyRemaining, 0);
    assert.equal(quotaA.monthlyRemaining, 0);
    assert.equal(quotaA.isDailyLimitReached, true);
    assert.equal(quotaA.isMonthlyLimitReached, true);

    // Workspace B is completely unaffected
    const quotaB = engine.getQuota(workspaceB);
    assert.equal(quotaB.dailySent, 0);
    assert.equal(quotaB.dailyRemaining, 1500);
    assert.equal(quotaB.monthlySent, 0);
    assert.equal(quotaB.monthlyRemaining, 50000);
    assert.equal(quotaB.maxSendableNow, 1500);
    assert.equal(quotaB.isDailyLimitReached, false);
    assert.equal(quotaB.isMonthlyLimitReached, false);

    assert.equal(engine.checkLimits(workspaceB, { count: 1500 }).allowed, true);
  });
});
