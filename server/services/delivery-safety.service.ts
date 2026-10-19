import crypto from "crypto";
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

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  dailyCount: number;
  dailyLimit: number;
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
   * Gets configurable sending limits for a business.
   */
  async getLimits(businessId: string): Promise<BusinessSendingLimits> {
    const defaultDaily = parseInt(
      process.env.CAMPAIGN_DAILY_SEND_LIMIT || (process.env.NODE_ENV === "production" ? "500" : "50"),
      10
    );
    const defaultHourly = parseInt(
      process.env.CAMPAIGN_HOURLY_SEND_LIMIT || (process.env.NODE_ENV === "production" ? "100" : "25"),
      10
    );
    const defaultRate = parseInt(process.env.EMAIL_SEND_RATE_PER_MINUTE || "30", 10);

    try {
      const business = await this.businessRepo.findById(businessId);
      if (business && business.settings && typeof business.settings === "object") {
        const s = business.settings as Record<string, unknown>;
        const limits = (s.sending_limits || {}) as Record<string, unknown>;
        if (limits.daily_send_limit || limits.hourly_send_limit) {
          return {
            daily_send_limit: Number(limits.daily_send_limit) || defaultDaily,
            hourly_send_limit: Number(limits.hourly_send_limit) || defaultHourly,
            send_rate_per_minute: Number(limits.send_rate_per_minute) || defaultRate,
          };
        }
      }
    } catch {
      // Fallback
    }

    return {
      daily_send_limit: defaultDaily,
      hourly_send_limit: defaultHourly,
      send_rate_per_minute: defaultRate,
    };
  }

  /**
   * Generates today's UTC date key (e.g. "2026-10-16").
   */
  getDailyKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Generates current UTC hour key (e.g. "2026-10-16T11").
   */
  getHourlyKey(date = new Date()): string {
    return date.toISOString().slice(0, 13);
  }

  /**
   * Verifies if business is currently allowed to send.
   * Database-backed accounting prevents race conditions and survives restarts.
   */
  async checkLimits(businessId: string): Promise<LimitCheckResult> {
    const limits = await this.getLimits(businessId);
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = await this.counterRepo.getCount(businessId, "daily", dailyKey);
    const hourlyCount = await this.counterRepo.getCount(businessId, "hourly", hourlyKey);

    // 1. Daily limit check
    if (dailyCount >= limits.daily_send_limit) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "send_limit_reached",
        reason: `Daily limit exceeded (${dailyCount}/${limits.daily_send_limit})`,
        metadata: { dailyCount, limit: limits.daily_send_limit, periodKey: dailyKey },
      });

      return {
        allowed: false,
        reason: "DAILY_SEND_LIMIT_EXCEEDED",
        dailyCount,
        dailyLimit: limits.daily_send_limit,
        hourlyCount,
        hourlyLimit: limits.hourly_send_limit,
        rateLimitPerMinute: limits.send_rate_per_minute,
      };
    }

    // 2. Hourly limit check
    if (hourlyCount >= limits.hourly_send_limit) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "send_limit_reached",
        reason: `Hourly limit exceeded (${hourlyCount}/${limits.hourly_send_limit})`,
        metadata: { hourlyCount, limit: limits.hourly_send_limit, periodKey: hourlyKey },
      });

      return {
        allowed: false,
        reason: "HOURLY_SEND_LIMIT_EXCEEDED",
        dailyCount,
        dailyLimit: limits.daily_send_limit,
        hourlyCount,
        hourlyLimit: limits.hourly_send_limit,
        rateLimitPerMinute: limits.send_rate_per_minute,
      };
    }

    return {
      allowed: true,
      dailyCount,
      dailyLimit: limits.daily_send_limit,
      hourlyCount,
      hourlyLimit: limits.hourly_send_limit,
      rateLimitPerMinute: limits.send_rate_per_minute,
    };
  }

  /**
   * Atomically records an email send against business daily and hourly counters.
   */
  async recordSend(
    businessId: string
  ): Promise<{ dailyCount: number; hourlyCount: number }> {
    const now = new Date();
    const dailyKey = this.getDailyKey(now);
    const hourlyKey = this.getHourlyKey(now);

    const dailyCount = await this.counterRepo.increment(businessId, "daily", dailyKey, 1);
    const hourlyCount = await this.counterRepo.increment(businessId, "hourly", hourlyKey, 1);

    return { dailyCount, hourlyCount };
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
