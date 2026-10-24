import crypto from "crypto";
import type { QueryResultRow } from "pg";
import { query, isDbConfigured } from "../db/client";
import { SuppressionRepository, SuppressionRecord, normalizeSuppressionReason } from "../repositories/suppression.repository";
import { SafetyAuditRepository } from "../repositories/safety-audit.repository";
import { BusinessSendCounterRepository } from "../repositories/business-send-counter.repository";
import { BusinessRepository } from "../repositories/business.repository";
import { EmailMessageRepository } from "../repositories/email-message.repository";
import type { BusinessSendingLimits } from "@/types/database";

export interface UnsubscribeTokenPayload {
  businessId: string;
  leadId: string;
  email: string;
  campaignId?: string;
  stepId?: string;
  messageId?: string;
  ts?: number;
}

export const HARD_DAILY_LIMIT = 1500;
export const HARD_MONTHLY_LIMIT = 50000;

export interface WorkspaceQuota {
  dailySent: number;
  dailyLimit: number;
  dailyRemaining: number;
  monthlySent: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  maxSendableNow: number;
  isDailyLimitReached: boolean;
  isMonthlyLimitReached: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  code?: string;
  dailyCount: number;
  dailyLimit: number;
  dailyRemaining: number;
  monthlyCount: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  attemptedCount: number;
  hourlyCount: number;
  hourlyLimit: number;
  rateLimitPerMinute: number;
}

export class DeliverySafetyService {
  private suppressionRepo: SuppressionRepository;
  private safetyAuditRepo: SafetyAuditRepository;
  private counterRepo: BusinessSendCounterRepository;
  private businessRepo: BusinessRepository;
  private messageRepo: EmailMessageRepository;
  private queryFn: typeof query;

  constructor(
    suppressionRepo?: SuppressionRepository,
    safetyAuditRepo?: SafetyAuditRepository,
    counterRepo?: BusinessSendCounterRepository,
    businessRepo?: BusinessRepository,
    queryFn?: typeof query,
    messageRepo?: EmailMessageRepository
  ) {
    this.suppressionRepo = suppressionRepo || new SuppressionRepository();
    this.safetyAuditRepo = safetyAuditRepo || new SafetyAuditRepository();
    this.counterRepo = counterRepo || new BusinessSendCounterRepository();
    this.businessRepo = businessRepo || new BusinessRepository();
    this.messageRepo = messageRepo || new EmailMessageRepository();
    this.queryFn = queryFn || query;
  }

  private getAppSecret(): string {
    return (
      process.env.APP_SECRET ||
      process.env.RESEND_WEBHOOK_SECRET ||
      "email-automation-platform-safe-secret-key-32b"
    );
  }

  // ==========================================
  // 1. Unsubscribe Token Management
  // ==========================================

  /**
   * Generates a tamper-proof cryptographic unsubscribe token for a campaign recipient.
   */
  generateUnsubscribeToken(payload: {
    businessId: string;
    leadId: string;
    email: string;
    campaignId?: string;
  }): string {
    const secret = this.getAppSecret();
    const data: UnsubscribeTokenPayload = {
      businessId: payload.businessId,
      leadId: payload.leadId,
      email: payload.email.trim().toLowerCase(),
      campaignId: payload.campaignId,
      ts: Date.now(),
    };
    const jsonStr = JSON.stringify(data);
    const dataB64 = Buffer.from(jsonStr).toString("base64url");
    const signature = crypto
      .createHmac("sha256", secret)
      .update(dataB64)
      .digest("base64url");
    return `${dataB64}.${signature}`;
  }

  /**
   * Cryptographically verifies an unsubscribe token.
   * Returns payload if valid, null if invalid or tampered with.
   */
  verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
    if (!token || typeof token !== "string") return null;
    try {
      const parts = token.trim().split(".");
      if (parts.length !== 2) return null;
      const [dataB64, signature] = parts;
      if (!dataB64 || !signature) return null;

      const secret = this.getAppSecret();
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(dataB64)
        .digest("base64url");

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
      }

      const jsonStr = Buffer.from(dataB64, "base64url").toString("utf-8");
      const parsed = JSON.parse(jsonStr) as UnsubscribeTokenPayload;
      if (!parsed.businessId || !parsed.email) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Appends or injects the compliant unsubscribe URL and footer into email HTML.
   */
  ensureUnsubscribeLink(
    htmlBody: string,
    unsubscribeUrl: string,
    businessName = "Our Company"
  ): string {
    let result = htmlBody;

    // Replace template tokens if present
    result = result.replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubscribeUrl);
    result = result.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl);

    // If unsubscribe link is not already present, automatically append a professional footer
    if (
      !result.includes(unsubscribeUrl) &&
      !result.toLowerCase().includes("unsubscribe")
    ) {
      const safeBiz = businessName
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const footerHtml = `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <p style="margin: 0 0 8px 0;">You received this email from ${safeBiz}.</p>
  <p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #4b5563; text-decoration: underline;">Unsubscribe</a> from future emails.</p>
</div>`;

      if (result.includes("</body>")) {
        result = result.replace("</body>", `${footerHtml}</body>`);
      } else {
        result += footerHtml;
      }
    }

    return result;
  }

  /**
   * Plain text fallback footer injection.
   */
  ensureUnsubscribeText(textBody: string, unsubscribeUrl: string): string {
    let result = textBody;
    result = result.replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubscribeUrl);
    result = result.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl);
    if (!result.includes(unsubscribeUrl)) {
      result += `\n\n---\nUnsubscribe: ${unsubscribeUrl}`;
    }
    return result;
  }

  /**
   * Processes an unsubscribe request triggered by a recipient clicking the unsubscribe link.
   * 1. Validates token.
   * 2. Identifies business & recipient.
   * 3. Adds recipient to suppression list.
   * 4. Stops active campaign enrollment(s) for that recipient/business.
   * 5. Emits audit log.
   */
  async handleUnsubscribe(token: string): Promise<{
    success: boolean;
    error?: string;
    email?: string;
    businessId?: string;
  }> {
    const payload = this.verifyUnsubscribeToken(token);
    if (!payload) {
      return {
        success: false,
        error: "Invalid or expired unsubscribe link. Please check your link or contact support.",
      };
    }

    const { businessId, leadId, email, campaignId } = payload;
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Add to suppression
    await this.suppressionRepo.addSuppression({
      business_id: businessId,
      email: normalizedEmail,
      reason: "UNSUBSCRIBED",
      source: "unsubscribe_link",
    });

    // 2. Stop active campaign enrollments for that recipient/business
    await this.stopActiveEnrollmentsForRecipient(businessId, normalizedEmail, leadId, "UNSUBSCRIBED");

    // 3. Record audit log
    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "unsubscribe",
      recipient_email: normalizedEmail,
      lead_id: leadId,
      campaign_id: campaignId,
      reason: "Recipient clicked unsubscribe link",
    });

    // 4. Record email_events entry for campaign analytics
    try {
      await this.messageRepo.createEvent({
        business_id: businessId,
        email_message_id: payload.messageId || null,
        campaign_id: campaignId || null,
        campaign_step_id: payload.stepId || null,
        lead_id: leadId || null,
        event_type: "UNSUBSCRIBED",
        provider_event_id: `unsub_${businessId.slice(0, 8)}_${leadId.slice(0, 8)}_${Date.now()}`,
        event_timestamp: new Date().toISOString(),
        metadata: {
          source: "unsubscribe_link",
          recipient_email: normalizedEmail,
        },
      });
    } catch {
      // Non-blocking fallback
    }

    return {
      success: true,
      email: normalizedEmail,
      businessId,
    };
  }

  // ==========================================
  // 2. Webhook Hard Bounce & Complaint Handlers
  // ==========================================

  /**
   * Handles delivery bounce events from provider webhook.
   * Distinguishes hard bounce (permanent failure) vs transient failure (soft bounce).
   */
  async handleBounce(
    businessId: string,
    email: string,
    isPermanent: boolean,
    reason?: string,
    leadId?: string,
    campaignId?: string
  ): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!isPermanent) {
      // Temporary / transient failure: do not suppress immediately
      return;
    }

    // Hard bounce -> Immediately suppress and halt campaigns
    await this.suppressionRepo.addSuppression({
      business_id: businessId,
      email: normalized,
      reason: "HARD_BOUNCE",
      source: "webhook_bounce",
    });

    await this.stopActiveEnrollmentsForRecipient(businessId, normalized, leadId, "HARD_BOUNCE");

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "hard_bounce",
      recipient_email: normalized,
      lead_id: leadId,
      campaign_id: campaignId,
      reason: reason || "Permanent delivery failure (Hard Bounce)",
    });
  }

  /**
   * Handles spam complaint events from provider webhook.
   */
  async handleComplaint(
    businessId: string,
    email: string,
    reason?: string,
    leadId?: string,
    campaignId?: string
  ): Promise<void> {
    const normalized = email.trim().toLowerCase();

    // Spam complaint -> Immediately suppress and halt campaigns
    await this.suppressionRepo.addSuppression({
      business_id: businessId,
      email: normalized,
      reason: "COMPLAINT",
      source: "webhook_complaint",
    });

    await this.stopActiveEnrollmentsForRecipient(businessId, normalized, leadId, "COMPLAINT");

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "complaint",
      recipient_email: normalized,
      lead_id: leadId,
      campaign_id: campaignId,
      reason: reason || "Recipient reported spam complaint",
    });
  }

  /**
   * Checks whether an email is suppressed for a business.
   */
  async isSuppressed(businessId: string, email: string): Promise<boolean> {
    return this.suppressionRepo.isSuppressed(businessId, email);
  }

  // ==========================================
  // 3. Manual Suppression Actions
  // ==========================================

  /**
   * Manually adds an email to the business suppression list.
   */
  async addManualSuppression(
    businessId: string,
    email: string,
    reason = "MANUAL",
    leadId?: string
  ): Promise<SuppressionRecord> {
    const normalized = email.trim().toLowerCase();
    const normalizedReason = normalizeSuppressionReason(reason);

    const record = await this.suppressionRepo.addSuppression({
      business_id: businessId,
      email: normalized,
      reason: normalizedReason,
      source: "manual_ui",
    });

    await this.stopActiveEnrollmentsForRecipient(businessId, normalized, leadId, `MANUAL_SUPPRESSION: ${normalizedReason}`);

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "manual_suppression",
      recipient_email: normalized,
      lead_id: leadId,
      reason: normalizedReason,
    });

    return record;
  }

  /**
   * Manually removes an email from suppression.
   * NOTE: Removing suppression does NOT resume old campaign enrollments.
   */
  async removeManualSuppression(businessId: string, email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const removed = await this.suppressionRepo.removeSuppression(businessId, normalized);

    if (removed) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "suppression_removal",
        recipient_email: normalized,
        reason: "Suppression removed manually by administrator",
      });
    }

    return removed;
  }

  // ==========================================
  // 4. Sending Limits & Accounting
  // ==========================================

  /**
   * Gets sending limits for a business.
   * Hard limits of 1,500 daily and 50,000 monthly are system-level and cannot be exceeded.
   */
  async getLimits(businessId: string): Promise<BusinessSendingLimits & { monthly_send_limit: number }> {
    const defaultDaily = parseInt(
      process.env.CAMPAIGN_DAILY_SEND_LIMIT || String(HARD_DAILY_LIMIT),
      10
    );
    const defaultMonthly = parseInt(
      process.env.CAMPAIGN_MONTHLY_SEND_LIMIT || String(HARD_MONTHLY_LIMIT),
      10
    );
    const defaultHourly = parseInt(
      process.env.CAMPAIGN_HOURLY_SEND_LIMIT || (process.env.NODE_ENV === "production" ? "500" : "100"),
      10
    );
    const defaultRate = parseInt(process.env.EMAIL_SEND_RATE_PER_MINUTE || "30", 10);

    let configuredDaily = defaultDaily;
    let configuredMonthly = defaultMonthly;
    let configuredHourly = defaultHourly;
    let configuredRate = defaultRate;

    try {
      const business = await this.businessRepo.findById(businessId);
      if (business && business.settings && typeof business.settings === "object") {
        const s = business.settings as Record<string, unknown>;
        const limits = (s.sending_limits || {}) as Record<string, unknown>;
        if (limits.daily_send_limit !== undefined) {
          configuredDaily = Number(limits.daily_send_limit);
        }
        if (limits.monthly_send_limit !== undefined) {
          configuredMonthly = Number(limits.monthly_send_limit);
        }
        if (limits.hourly_send_limit !== undefined) {
          configuredHourly = Number(limits.hourly_send_limit);
        }
        if (limits.send_rate_per_minute !== undefined) {
          configuredRate = Number(limits.send_rate_per_minute);
        }
      }
    } catch {
      // Fallback
    }

    return {
      daily_send_limit: Math.min(configuredDaily, HARD_DAILY_LIMIT),
      monthly_send_limit: Math.min(configuredMonthly, HARD_MONTHLY_LIMIT),
      hourly_send_limit: configuredHourly,
      send_rate_per_minute: configuredRate,
    };
  }

  /**
   * Generates today's UTC date key (e.g. "2026-10-16").
   */
  getDailyKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Generates current UTC month key (e.g. "2026-10").
   */
  getMonthlyKey(date = new Date()): string {
    return date.toISOString().slice(0, 7);
  }

  /**
   * Generates current UTC hour key (e.g. "2026-10-16T11").
   */
  getHourlyKey(date = new Date()): string {
    return date.toISOString().slice(0, 13);
  }

  /**
   * Calculates actual authoritative outbound email dispatches for a business
   * across daily or monthly calendar periods from timestamped successful send records.
   */
  async getActualSentCount(
    businessId: string,
    periodType: "daily" | "monthly",
    periodKey: string
  ): Promise<number> {
    let dbCount = 0;
    if (isDbConfigured()) {
      try {
        if (periodType === "daily") {
          const sql = `
            SELECT COUNT(*) AS total
            FROM email_messages
            WHERE business_id = $1
              AND direction = 'outbound'
              AND (LOWER(status) IN ('sent', 'delivered', 'opened', 'bounced', 'complained') OR sent_at IS NOT NULL)
              AND sent_at >= ($2 || 'T00:00:00Z')::timestamptz
              AND sent_at < (($2 || 'T00:00:00Z')::timestamptz + INTERVAL '1 day');
          `;
          const res = await this.queryFn<QueryResultRow>(sql, [businessId, periodKey]);
          dbCount = Number(res.rows[0]?.total || 0);
        } else {
          const sql = `
            SELECT COUNT(*) AS total
            FROM email_messages
            WHERE business_id = $1
              AND direction = 'outbound'
              AND (LOWER(status) IN ('sent', 'delivered', 'opened', 'bounced', 'complained') OR sent_at IS NOT NULL)
              AND sent_at >= (($2 || '-01T00:00:00Z')::timestamptz)
              AND sent_at < (($2 || '-01T00:00:00Z')::timestamptz + INTERVAL '1 month');
          `;
          const res = await this.queryFn<QueryResultRow>(sql, [businessId, periodKey]);
          dbCount = Number(res.rows[0]?.total || 0);
        }
      } catch {
        // Fallback to counter repo if email_messages table query fails
      }
    } else {
      try {
        const { LocalEmailStore } = await import("../repositories/email-message.repository");
        const store = LocalEmailStore.load();
        const sentStatuses = new Set(["SENT", "DELIVERED", "OPENED", "BOUNCED", "COMPLAINED"]);
        dbCount = store.messages.filter((m) => {
          if (m.business_id !== businessId || (m.direction && m.direction !== "outbound")) return false;
          const statusOk = sentStatuses.has(String(m.status || "").toUpperCase()) || Boolean(m.sent_at);
          if (!statusOk) return false;
          const dateStr = (m.sent_at || m.created_at || "").slice(0, 10);
          if (periodType === "daily") {
            return dateStr === periodKey;
          } else {
            return dateStr.slice(0, 7) === periodKey;
          }
        }).length;
      } catch {
        // Fallback
      }
    }

    const counterCount = await this.counterRepo.getCount(businessId, periodType, periodKey);
    return Math.max(counterCount, dbCount);
  }

  /**
   * Retrieves workspace quota calculations for dashboard, campaign UI, and pre-send checks.
   */
  async getQuota(businessId: string, date = new Date()): Promise<WorkspaceQuota> {
    const limits = await this.getLimits(businessId);
    const dailyKey = this.getDailyKey(date);
    const monthlyKey = this.getMonthlyKey(date);

    const dailySent = await this.getActualSentCount(businessId, "daily", dailyKey);
    const monthlySent = await this.getActualSentCount(businessId, "monthly", monthlyKey);

    const dailyLimit = limits.daily_send_limit;
    const monthlyLimit = limits.monthly_send_limit;

    const dailyRemaining = Math.max(0, dailyLimit - dailySent);
    const monthlyRemaining = Math.max(0, monthlyLimit - monthlySent);
    const maxSendableNow = Math.min(dailyRemaining, monthlyRemaining);

    return {
      dailySent,
      dailyLimit,
      dailyRemaining,
      monthlySent,
      monthlyLimit,
      monthlyRemaining,
      maxSendableNow,
      isDailyLimitReached: dailyRemaining <= 0,
      isMonthlyLimitReached: monthlyRemaining <= 0,
    };
  }

  /**
   * Verifies if business is currently allowed to send.
   * Enforces hard limits:
   * - Daily: 1,500 maximum
   * - Monthly: 50,000 maximum
   * Database-backed accounting prevents race conditions and survives restarts.
   */
  async checkLimits(
    businessId: string,
    options?: { count?: number }
  ): Promise<LimitCheckResult> {
    const requestedCount = options?.count ?? 1;
    const limits = await this.getLimits(businessId);
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const monthlyKey = this.getMonthlyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = await this.getActualSentCount(businessId, "daily", dailyKey);
    const monthlyCount = await this.getActualSentCount(businessId, "monthly", monthlyKey);
    const hourlyCount = await this.counterRepo.getCount(businessId, "hourly", hourlyKey);

    const dailyLimit = limits.daily_send_limit;
    const monthlyLimit = limits.monthly_send_limit;
    const dailyRemaining = Math.max(0, dailyLimit - dailyCount);
    const monthlyRemaining = Math.max(0, monthlyLimit - monthlyCount);

    // 1. Daily limit check (Hard ceiling)
    if (dailyCount >= dailyLimit || requestedCount > dailyRemaining) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "send_limit_reached",
        reason: `Daily sending limit reached (${dailyCount}/${dailyLimit}, attempted: ${requestedCount})`,
        metadata: { dailyCount, limit: dailyLimit, periodKey: dailyKey, attempted: requestedCount },
      });

      return {
        allowed: false,
        code: "DAILY_EMAIL_LIMIT_REACHED",
        reason: "DAILY_LIMIT_EXCEEDED",
        dailyCount,
        dailyLimit,
        dailyRemaining,
        monthlyCount,
        monthlyLimit,
        monthlyRemaining,
        attemptedCount: requestedCount,
        hourlyCount,
        hourlyLimit: limits.hourly_send_limit,
        rateLimitPerMinute: limits.send_rate_per_minute,
      };
    }

    // 2. Monthly limit check (Hard ceiling)
    if (monthlyCount >= monthlyLimit || requestedCount > monthlyRemaining) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "send_limit_reached",
        reason: `Monthly sending limit reached (${monthlyCount}/${monthlyLimit}, attempted: ${requestedCount})`,
        metadata: { monthlyCount, limit: monthlyLimit, periodKey: monthlyKey, attempted: requestedCount },
      });

      return {
        allowed: false,
        code: "MONTHLY_EMAIL_LIMIT_REACHED",
        reason: "MONTHLY_LIMIT_EXCEEDED",
        dailyCount,
        dailyLimit,
        dailyRemaining,
        monthlyCount,
        monthlyLimit,
        monthlyRemaining,
        attemptedCount: requestedCount,
        hourlyCount,
        hourlyLimit: limits.hourly_send_limit,
        rateLimitPerMinute: limits.send_rate_per_minute,
      };
    }

    // 3. Hourly limit check
    if (hourlyCount >= limits.hourly_send_limit) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "send_limit_reached",
        reason: `Hourly limit exceeded (${hourlyCount}/${limits.hourly_send_limit})`,
        metadata: { hourlyCount, limit: limits.hourly_send_limit, periodKey: hourlyKey },
      });

      return {
        allowed: false,
        code: "HOURLY_SEND_LIMIT_EXCEEDED",
        reason: "HOURLY_LIMIT_EXCEEDED",
        dailyCount,
        dailyLimit,
        dailyRemaining,
        monthlyCount,
        monthlyLimit,
        monthlyRemaining,
        attemptedCount: requestedCount,
        hourlyCount,
        hourlyLimit: limits.hourly_send_limit,
        rateLimitPerMinute: limits.send_rate_per_minute,
      };
    }

    return {
      allowed: true,
      dailyCount,
      dailyLimit,
      dailyRemaining,
      monthlyCount,
      monthlyLimit,
      monthlyRemaining,
      attemptedCount: requestedCount,
      hourlyCount,
      hourlyLimit: limits.hourly_send_limit,
      rateLimitPerMinute: limits.send_rate_per_minute,
    };
  }

  /**
   * Concurrency-safe atomic reservation of 1 send quota unit across daily and monthly counters.
   * If either ceiling would be exceeded under concurrent load, rolls back and rejects.
   */
  async reserveSendQuota(businessId: string): Promise<{
    allowed: boolean;
    reason?: string;
    code?: string;
    dailyCount: number;
    monthlyCount: number;
  }> {
    const limits = await this.getLimits(businessId);
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const monthlyKey = this.getMonthlyKey(now);

    const actualDaily = await this.getActualSentCount(businessId, "daily", dailyKey);
    const actualMonthly = await this.getActualSentCount(businessId, "monthly", monthlyKey);
    if (actualDaily >= limits.daily_send_limit) {
      return {
        allowed: false,
        code: "DAILY_EMAIL_LIMIT_REACHED",
        reason: "DAILY_LIMIT_EXCEEDED",
        dailyCount: actualDaily,
        monthlyCount: actualMonthly,
      };
    }
    if (actualMonthly >= limits.monthly_send_limit) {
      return {
        allowed: false,
        code: "MONTHLY_EMAIL_LIMIT_REACHED",
        reason: "MONTHLY_LIMIT_EXCEEDED",
        dailyCount: actualDaily,
        monthlyCount: actualMonthly,
      };
    }

    // Atomic reservation on daily
    const dailyRes = await this.counterRepo.atomicReserve(
      businessId,
      "daily",
      dailyKey,
      limits.daily_send_limit,
      1
    );
    if (!dailyRes.success) {
      return {
        allowed: false,
        code: "DAILY_EMAIL_LIMIT_REACHED",
        reason: "DAILY_LIMIT_EXCEEDED",
        dailyCount: dailyRes.newCount,
        monthlyCount: actualMonthly,
      };
    }

    // Atomic reservation on monthly
    const monthlyRes = await this.counterRepo.atomicReserve(
      businessId,
      "monthly",
      monthlyKey,
      limits.monthly_send_limit,
      1
    );
    if (!monthlyRes.success) {
      // Roll back daily reservation
      await this.counterRepo.release(businessId, "daily", dailyKey, 1);
      return {
        allowed: false,
        code: "MONTHLY_EMAIL_LIMIT_REACHED",
        reason: "MONTHLY_LIMIT_EXCEEDED",
        dailyCount: dailyRes.newCount - 1,
        monthlyCount: monthlyRes.newCount,
      };
    }

    return {
      allowed: true,
      dailyCount: dailyRes.newCount,
      monthlyCount: monthlyRes.newCount,
    };
  }

  /**
   * Releases previously reserved quota if provider dispatch fails.
   */
  async releaseSendQuota(businessId: string): Promise<void> {
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const monthlyKey = this.getMonthlyKey(now);
    await this.counterRepo.release(businessId, "daily", dailyKey, 1);
    await this.counterRepo.release(businessId, "monthly", monthlyKey, 1);
  }

  /**
   * Atomically records an email send against business daily, monthly, and hourly counters.
   */
  async recordSend(
    businessId: string
  ): Promise<{ dailyCount: number; hourlyCount: number; monthlyCount: number }> {
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const monthlyKey = this.getMonthlyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = await this.counterRepo.increment(businessId, "daily", dailyKey, 1);
    const monthlyCount = await this.counterRepo.increment(businessId, "monthly", monthlyKey, 1);
    const hourlyCount = await this.counterRepo.increment(businessId, "hourly", hourlyKey, 1);

    return { dailyCount, hourlyCount, monthlyCount };
  }

  // ==========================================
  // 5. Stop Active Enrollments Helper
  // ==========================================

  async stopActiveEnrollmentsForRecipient(
    businessId: string,
    email: string,
    leadId?: string,
    reason = "SUPPRESSED"
  ): Promise<number> {
    let stoppedCount = 0;
    try {
      if (isDbConfigured()) {
        const sql = `
          UPDATE campaign_leads
          SET status = 'STOPPED',
              stopped_at = NOW(),
              next_run_at = NULL,
              last_error = $3,
              updated_at = NOW()
          WHERE business_id = $1
            AND (
              lead_id IN (SELECT id FROM leads WHERE business_id = $1 AND LOWER(email) = LOWER($2))
              ${leadId ? "OR lead_id = $4" : ""}
            )
            AND UPPER(status) IN ('ENROLLED', 'RUNNING', 'WAITING', 'PAUSED');
        `;
        const params: unknown[] = [businessId, email, reason];
        if (leadId) params.push(leadId);
        const res = await this.queryFn(sql, params);
        stoppedCount += res.rowCount ?? 0;
      }
    } catch {
      // Non-blocking in non-db fallback
    }

    try {
      const { LocalCampaignStore } = await import("../repositories/campaign.repository");
      const store = LocalCampaignStore["load"]();
      const normEmail = email.trim().toLowerCase();
      for (const item of store.enrollments) {
        if (
          item.business_id === businessId &&
          (item.lead_id === leadId || (item.email && item.email.toLowerCase() === normEmail)) &&
          ["ENROLLED", "RUNNING", "WAITING", "PAUSED"].includes(item.status.toUpperCase())
        ) {
          item.status = "STOPPED";
          item.next_run_at = null;
          item.stopped_at = new Date().toISOString();
          item.last_error = reason;
          item.updated_at = new Date().toISOString();
          stoppedCount++;
        }
      }
      LocalCampaignStore["save"]();
    } catch {}

    return stoppedCount;
  }
}

export const deliverySafetyService = new DeliverySafetyService();
