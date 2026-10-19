import fs from "fs";
import path from "path";
import { query, isDbConfigured } from "../db/client";
import type { QueryResultRow } from "pg";
import type {
  CampaignAnalyticsOverview,
  CampaignTimelinePoint,
  StepAnalyticsItem,
  ContactEmailHistoryItem,
  EmailMessageDetail,
  EmailMessage,
  EmailEvent,
  MessageStatus,
} from "@/types/database";

export interface DateFilterRange {
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class AnalyticsRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  /**
   * Helper to load local store JSON data for resilient development / fallback.
   */
  private loadLocalStore(): {
    messages: EmailMessage[];
    events: EmailEvent[];
    campaigns: Record<string, unknown>[];
    steps: Record<string, unknown>[];
    enrollments: Record<string, unknown>[];
    leads: Record<string, unknown>[];
  } {
    const read = (filename: string) => {
      try {
        const p = path.resolve(process.cwd(), `.data/${filename}`);
        if (fs.existsSync(p)) {
          return JSON.parse(fs.readFileSync(p, "utf-8"));
        }
      } catch {
        // Fallback
      }
      return null;
    };

    const emailData = read("email_messages.json") || { messages: [], events: [] };
    const rawCamp = read("campaigns.json");
    const campaigns = Array.isArray(rawCamp)
      ? rawCamp
      : rawCamp && Array.isArray(rawCamp.campaigns)
      ? rawCamp.campaigns
      : [];
    const steps =
      rawCamp && Array.isArray(rawCamp.steps)
        ? rawCamp.steps
        : Array.isArray(read("campaign_steps.json"))
        ? read("campaign_steps.json")
        : [];
    const enrollments =
      rawCamp && Array.isArray(rawCamp.enrollments)
        ? rawCamp.enrollments
        : Array.isArray(read("campaign_leads.json"))
        ? read("campaign_leads.json")
        : [];
    const rawLeads = read("leads.json");
    const leads = Array.isArray(rawLeads)
      ? rawLeads
      : rawLeads && Array.isArray(rawLeads.leads)
      ? rawLeads.leads
      : [];

    return {
      messages: Array.isArray(emailData) ? emailData : emailData.messages || [],
      events: emailData && Array.isArray(emailData.events) ? emailData.events : [],
      campaigns,
      steps,
      enrollments,
      leads,
    };
  }

  // ==========================================
  // 1. Campaign Metrics & Rates Overview
  // ==========================================
  async getCampaignOverview(
    businessId: string,
    campaignId: string,
    dateRange?: DateFilterRange
  ): Promise<CampaignAnalyticsOverview | null> {
    if (this.useDatabase()) {
      try {
        // 1. Validate campaign ownership
        const cRes = await this.queryFn<QueryResultRow>(
          `SELECT id, name, status, created_at FROM campaigns WHERE id = $1 AND business_id = $2;`,
          [campaignId, businessId]
        );
        if (cRes.rows.length === 0) return null;
        const campaign = cRes.rows[0];

        // 2. Aggregate Enrollments
        const enrollRes = await this.queryFn<QueryResultRow>(
          `SELECT 
            COUNT(*) AS total_enrolled,
            COUNT(CASE WHEN LOWER(status) IN ('enrolled', 'running') THEN 1 END) AS total_active,
            COUNT(CASE WHEN LOWER(status) IN ('enrolled', 'running') AND next_run_at IS NOT NULL THEN 1 END) AS total_pending,
            COUNT(CASE WHEN LOWER(status) = 'completed' THEN 1 END) AS total_completed,
            COUNT(CASE WHEN LOWER(status) = 'stopped' THEN 1 END) AS total_stopped
           FROM campaign_leads
           WHERE campaign_id = $1 AND business_id = $2;`,
          [campaignId, businessId]
        );
        const enroll = enrollRes.rows[0] || {};

        // 3. Aggregate Email Messages with Date Filtering
        const dateClauses: string[] = [];
        const params: unknown[] = [campaignId, businessId];

        if (dateRange?.from) {
          params.push(dateRange.from);
          dateClauses.push(`created_at >= $${params.length}`);
        }
        if (dateRange?.to) {
          params.push(dateRange.to);
          dateClauses.push(`created_at <= $${params.length}`);
        }
        const dateSql = dateClauses.length > 0 ? ` AND ${dateClauses.join(" AND ")}` : "";

        const msgSql = `
          SELECT 
            COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS total_sent,
            COUNT(CASE WHEN LOWER(status) = 'delivered' THEN 1 END) AS total_delivered,
            COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS total_bounced,
            COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END) AS total_failed,
            COUNT(CASE WHEN LOWER(status) = 'complained' THEN 1 END) AS total_complained
          FROM email_messages
          WHERE campaign_id = $1 AND business_id = $2 ${dateSql};
        `;
        const msgRes = await this.queryFn<QueryResultRow>(msgSql, params);
        const msg = msgRes.rows[0] || {};

        // 4. Count Unsubscribes for this campaign
        const unsubParams: unknown[] = [campaignId, businessId];
        const unsubDateClauses: string[] = [];
        if (dateRange?.from) {
          unsubParams.push(dateRange.from);
          unsubDateClauses.push(`event_timestamp >= $${unsubParams.length}`);
        }
        if (dateRange?.to) {
          unsubParams.push(dateRange.to);
          unsubDateClauses.push(`event_timestamp <= $${unsubParams.length}`);
        }
        const unsubDateSql = unsubDateClauses.length > 0 ? ` AND ${unsubDateClauses.join(" AND ")}` : "";

        const unsubRes = await this.queryFn<QueryResultRow>(
          `SELECT COUNT(DISTINCT lead_id) AS total_unsubscribed 
           FROM email_events 
           WHERE campaign_id = $1 AND business_id = $2 AND LOWER(event_type) = 'unsubscribed' ${unsubDateSql};`,
          unsubParams
        );
        const totalUnsubscribed = Number(unsubRes.rows[0]?.total_unsubscribed || 0);

        // 5. Count Replies for this campaign
        const replyRes = await this.queryFn<QueryResultRow>(
          `SELECT COUNT(DISTINCT lead_id) AS total_replied 
           FROM email_events 
           WHERE campaign_id = $1 AND business_id = $2 AND LOWER(event_type) = 'replied' ${unsubDateSql};`,
          unsubParams
        );
        const totalReplied = Number(replyRes.rows[0]?.total_replied || 0);

        const totalEnrolled = Number(enroll.total_enrolled || 0);
        const totalActive = Number(enroll.total_active || 0);
        const totalPending = Number(enroll.total_pending || 0);
        const totalCompleted = Number(enroll.total_completed || 0);
        const totalStopped = Number(enroll.total_stopped || 0);

        const totalSent = Number(msg.total_sent || 0);
        const totalDelivered = Number(msg.total_delivered || 0);
        const totalBounced = Number(msg.total_bounced || 0);
        const totalFailed = Number(msg.total_failed || 0);
        const totalComplained = Number(msg.total_complained || 0);

        // Safe Rate Calculations (Zero-Denominator Safe)
        const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(2)) : 0;
        const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
        const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
        const unsubscribeRate = totalSent > 0 ? Number(((totalUnsubscribed / totalSent) * 100).toFixed(2)) : 0;
        const replyRate = totalSent > 0 ? Number(((totalReplied / totalSent) * 100).toFixed(2)) : 0;

        return {
          campaign_id: campaignId,
          campaign_name: String(campaign.name),
          campaign_status: String(campaign.status) as CampaignAnalyticsOverview["campaign_status"],
          created_at: new Date(campaign.created_at).toISOString(),
          total_enrolled: totalEnrolled,
          total_active: totalActive,
          total_pending: totalPending,
          total_completed: totalCompleted,
          total_stopped: totalStopped,
          total_sent: totalSent,
          total_delivered: totalDelivered,
          total_bounced: totalBounced,
          total_failed: totalFailed,
          total_complained: totalComplained,
          total_unsubscribed: totalUnsubscribed,
          total_replied: totalReplied,
          delivery_rate: deliveryRate,
          bounce_rate: bounceRate,
          complaint_rate: complaintRate,
          unsubscribe_rate: unsubscribeRate,
          reply_rate: replyRate,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store ---
    const store = this.loadLocalStore();
    const campaign = store.campaigns.find(
      (c) => c.id === campaignId && c.business_id === businessId
    );
    if (!campaign) return null;

    const enrollments = store.enrollments.filter(
      (e) => e.campaign_id === campaignId && e.business_id === businessId
    );
    const totalEnrolled = enrollments.length;
    const totalActive = enrollments.filter((e) =>
      ["enrolled", "running"].includes(String(e.status || "").toLowerCase())
    ).length;
    const totalPending = enrollments.filter(
      (e) => ["enrolled", "running"].includes(String(e.status || "").toLowerCase()) && e.next_run_at
    ).length;
    const totalCompleted = enrollments.filter(
      (e) => String(e.status || "").toLowerCase() === "completed"
    ).length;
    const totalStopped = enrollments.filter(
      (e) => String(e.status || "").toLowerCase() === "stopped"
    ).length;

    let messages = store.messages.filter(
      (m) => m.campaign_id === campaignId && m.business_id === businessId
    );
    if (dateRange?.from) {
      const fromTime = new Date(dateRange.from).getTime();
      messages = messages.filter((m) => new Date(m.created_at).getTime() >= fromTime);
    }
    if (dateRange?.to) {
      const toTime = new Date(dateRange.to).getTime();
      messages = messages.filter((m) => new Date(m.created_at).getTime() <= toTime);
    }

    const totalSent = messages.filter(
      (m) => ["sent", "delivered", "bounced", "complained"].includes(m.status.toLowerCase()) || m.sent_at
    ).length;
    const totalDelivered = messages.filter((m) => m.status.toLowerCase() === "delivered").length;
    const totalBounced = messages.filter((m) => m.status.toLowerCase() === "bounced").length;
    const totalFailed = messages.filter((m) => m.status.toLowerCase() === "failed").length;
    const totalComplained = messages.filter((m) => m.status.toLowerCase() === "complained").length;

    let events = store.events.filter(
      (e) => e.campaign_id === campaignId && e.business_id === businessId && e.event_type.toLowerCase() === "unsubscribed"
    );
    if (dateRange?.from) {
      const fromTime = new Date(dateRange.from).getTime();
      events = events.filter((e) => new Date(e.event_timestamp).getTime() >= fromTime);
    }
    if (dateRange?.to) {
      const toTime = new Date(dateRange.to).getTime();
      events = events.filter((e) => new Date(e.event_timestamp).getTime() <= toTime);
    }
    const uniqueUnsubLeads = new Set(events.map((e) => e.lead_id).filter(Boolean));
    const totalUnsubscribed = uniqueUnsubLeads.size || events.length;

    let replyEvents = store.events.filter(
      (e) => e.campaign_id === campaignId && e.business_id === businessId && e.event_type.toLowerCase() === "replied"
    );
    if (dateRange?.from) {
      const fromTime = new Date(dateRange.from).getTime();
      replyEvents = replyEvents.filter((e) => new Date(e.event_timestamp).getTime() >= fromTime);
    }
    if (dateRange?.to) {
      const toTime = new Date(dateRange.to).getTime();
      replyEvents = replyEvents.filter((e) => new Date(e.event_timestamp).getTime() <= toTime);
    }
    const totalReplied = new Set(replyEvents.map((e) => e.lead_id).filter(Boolean)).size || replyEvents.length;

    const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(2)) : 0;
    const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
    const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
    const unsubscribeRate = totalSent > 0 ? Number(((totalUnsubscribed / totalSent) * 100).toFixed(2)) : 0;
    const replyRate = totalSent > 0 ? Number(((totalReplied / totalSent) * 100).toFixed(2)) : 0;

    return {
      campaign_id: campaignId,
      campaign_name: String(campaign.name || ""),
      campaign_status: String(campaign.status || "DRAFT") as CampaignAnalyticsOverview["campaign_status"],
      created_at: new Date(String(campaign.created_at || new Date())).toISOString(),
      total_enrolled: totalEnrolled,
      total_active: totalActive,
      total_pending: totalPending,
      total_completed: totalCompleted,
      total_stopped: totalStopped,
      total_sent: totalSent,
      total_delivered: totalDelivered,
      total_bounced: totalBounced,
      total_failed: totalFailed,
      total_complained: totalComplained,
      total_unsubscribed: totalUnsubscribed,
      total_replied: totalReplied,
      delivery_rate: deliveryRate,
      bounce_rate: bounceRate,
      complaint_rate: complaintRate,
      unsubscribe_rate: unsubscribeRate,
      reply_rate: replyRate,
    };
  }

  // ==========================================
  // 1b. Business-Wide Metrics & Rates Overview
  // ==========================================
  async getBusinessOverview(
    businessId: string,
    dateRange?: DateFilterRange
  ): Promise<{
    total_sent: number;
    total_delivered: number;
    total_bounced: number;
    total_failed: number;
    total_complained: number;
    total_unsubscribed: number;
    delivery_rate: number;
    bounce_rate: number;
    complaint_rate: number;
    unsubscribe_rate: number;
  }> {
    if (this.useDatabase()) {
      try {
        const dateClauses: string[] = [];
        const params: unknown[] = [businessId];

        if (dateRange?.from) {
          params.push(dateRange.from);
          dateClauses.push(`created_at >= $${params.length}`);
        }
        if (dateRange?.to) {
          params.push(dateRange.to);
          dateClauses.push(`created_at <= $${params.length}`);
        }
        const dateSql = dateClauses.length > 0 ? ` AND ${dateClauses.join(" AND ")}` : "";

        const msgSql = `
          SELECT 
            COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS total_sent,
            COUNT(CASE WHEN LOWER(status) = 'delivered' THEN 1 END) AS total_delivered,
            COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS total_bounced,
            COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END) AS total_failed,
            COUNT(CASE WHEN LOWER(status) = 'complained' THEN 1 END) AS total_complained
          FROM email_messages
          WHERE business_id = $1 ${dateSql};
        `;
        const msgRes = await this.queryFn<QueryResultRow>(msgSql, params);
        const msg = msgRes.rows[0] || {};

        const unsubParams: unknown[] = [businessId];
        const unsubDateClauses: string[] = [];
        if (dateRange?.from) {
          unsubParams.push(dateRange.from);
          unsubDateClauses.push(`event_timestamp >= $${unsubParams.length}`);
        }
        if (dateRange?.to) {
          unsubParams.push(dateRange.to);
          unsubDateClauses.push(`event_timestamp <= $${unsubParams.length}`);
        }
        const unsubDateSql = unsubDateClauses.length > 0 ? ` AND ${unsubDateClauses.join(" AND ")}` : "";

        const unsubRes = await this.queryFn<QueryResultRow>(
          `SELECT COUNT(DISTINCT lead_id) AS total_unsubscribed 
           FROM email_events 
           WHERE business_id = $1 AND LOWER(event_type) = 'unsubscribed' ${unsubDateSql};`,
          unsubParams
        );
        const totalUnsubscribed = Number(unsubRes.rows[0]?.total_unsubscribed || 0);

        const totalSent = Number(msg.total_sent || 0);
        const totalDelivered = Number(msg.total_delivered || 0);
        const totalBounced = Number(msg.total_bounced || 0);
        const totalFailed = Number(msg.total_failed || 0);
        const totalComplained = Number(msg.total_complained || 0);

        const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(2)) : 0;
        const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
        const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
        const unsubscribeRate = totalSent > 0 ? Number(((totalUnsubscribed / totalSent) * 100).toFixed(2)) : 0;

        return {
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
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    const store = this.loadLocalStore();
    let messages = store.messages.filter((m) => m.business_id === businessId);
    if (dateRange?.from) {
      const fromTime = new Date(dateRange.from).getTime();
      messages = messages.filter((m) => new Date(m.created_at).getTime() >= fromTime);
    }
    if (dateRange?.to) {
      const toTime = new Date(dateRange.to).getTime();
      messages = messages.filter((m) => new Date(m.created_at).getTime() <= toTime);
    }

    const totalSent = messages.filter(
      (m) => ["sent", "delivered", "bounced", "complained"].includes(m.status.toLowerCase()) || m.sent_at
    ).length;
    const totalDelivered = messages.filter((m) => m.status.toLowerCase() === "delivered").length;
    const totalBounced = messages.filter((m) => m.status.toLowerCase() === "bounced").length;
    const totalFailed = messages.filter((m) => m.status.toLowerCase() === "failed").length;
    const totalComplained = messages.filter((m) => m.status.toLowerCase() === "complained").length;

    let events = store.events.filter(
      (e) => e.business_id === businessId && e.event_type.toLowerCase() === "unsubscribed"
    );
    if (dateRange?.from) {
      const fromTime = new Date(dateRange.from).getTime();
      events = events.filter((e) => new Date(e.event_timestamp).getTime() >= fromTime);
    }
    if (dateRange?.to) {
      const toTime = new Date(dateRange.to).getTime();
      events = events.filter((e) => new Date(e.event_timestamp).getTime() <= toTime);
    }
    const totalUnsubscribed = new Set(events.map((e) => e.lead_id)).size;

    const deliveryRate = totalSent > 0 ? Number(((totalDelivered / totalSent) * 100).toFixed(2)) : 0;
    const bounceRate = totalSent > 0 ? Number(((totalBounced / totalSent) * 100).toFixed(2)) : 0;
    const complaintRate = totalSent > 0 ? Number(((totalComplained / totalSent) * 100).toFixed(2)) : 0;
    const unsubscribeRate = totalSent > 0 ? Number(((totalUnsubscribed / totalSent) * 100).toFixed(2)) : 0;

    return {
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
    };
  }

  // ==========================================
  // 2. Campaign Timeline Activity (Over Time)
  // ==========================================
  async getCampaignTimeline(
    businessId: string,
    campaignId: string,
    dateRange?: DateFilterRange
  ): Promise<CampaignTimelinePoint[]> {
    if (this.useDatabase()) {
      try {
        const dateClauses: string[] = [];
        const params: unknown[] = [campaignId, businessId];

        if (dateRange?.from) {
          params.push(dateRange.from);
          dateClauses.push(`event_timestamp >= $${params.length}`);
        }
        if (dateRange?.to) {
          params.push(dateRange.to);
          dateClauses.push(`event_timestamp <= $${params.length}`);
        }
        const dateSql = dateClauses.length > 0 ? ` AND ${dateClauses.join(" AND ")}` : "";

        const sql = `
          SELECT 
            TO_CHAR(event_timestamp, 'YYYY-MM-DD') AS day,
            COUNT(CASE WHEN LOWER(event_type) = 'sent' THEN 1 END) AS sent,
            COUNT(CASE WHEN LOWER(event_type) = 'delivered' THEN 1 END) AS delivered,
            COUNT(CASE WHEN LOWER(event_type) = 'bounced' THEN 1 END) AS bounced,
            COUNT(CASE WHEN LOWER(event_type) = 'failed' THEN 1 END) AS failed,
            COUNT(CASE WHEN LOWER(event_type) = 'complained' THEN 1 END) AS complained,
            COUNT(CASE WHEN LOWER(event_type) = 'unsubscribed' THEN 1 END) AS unsubscribed
          FROM email_events
          WHERE campaign_id = $1 AND business_id = $2 ${dateSql}
          GROUP BY TO_CHAR(event_timestamp, 'YYYY-MM-DD')
          ORDER BY day ASC;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, params);
        if (res.rows.length > 0) {
          return res.rows.map((r) => ({
            date: String(r.day),
            sent: Number(r.sent || 0),
            delivered: Number(r.delivered || 0),
            bounced: Number(r.bounced || 0),
            failed: Number(r.failed || 0),
            complained: Number(r.complained || 0),
            unsubscribed: Number(r.unsubscribed || 0),
          }));
        }

        // If no events rows yet, compute from email_messages created_at/sent_at
        const msgParams: unknown[] = [campaignId, businessId];
        const msgDateClauses: string[] = [];
        if (dateRange?.from) {
          msgParams.push(dateRange.from);
          msgDateClauses.push(`created_at >= $${msgParams.length}`);
        }
        if (dateRange?.to) {
          msgParams.push(dateRange.to);
          msgDateClauses.push(`created_at <= $${msgParams.length}`);
        }
        const msgDateSql = msgDateClauses.length > 0 ? ` AND ${msgDateClauses.join(" AND ")}` : "";

        const fallbackMsgSql = `
          SELECT 
            TO_CHAR(created_at, 'YYYY-MM-DD') AS day,
            COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS sent,
            COUNT(CASE WHEN LOWER(status) = 'delivered' THEN 1 END) AS delivered,
            COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS bounced,
            COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END) AS failed,
            COUNT(CASE WHEN LOWER(status) = 'complained' THEN 1 END) AS complained,
            0 AS unsubscribed
          FROM email_messages
          WHERE campaign_id = $1 AND business_id = $2 ${msgDateSql}
          GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
          ORDER BY day ASC;
        `;
        const fallbackRes = await this.queryFn<QueryResultRow>(fallbackMsgSql, msgParams);
        return fallbackRes.rows.map((r) => ({
          date: String(r.day),
          sent: Number(r.sent || 0),
          delivered: Number(r.delivered || 0),
          bounced: Number(r.bounced || 0),
          failed: Number(r.failed || 0),
          complained: Number(r.complained || 0),
          unsubscribed: Number(r.unsubscribed || 0),
        }));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store Timeline ---
    const store = this.loadLocalStore();
    const dateMap = new Map<string, CampaignTimelinePoint>();

    const events = store.events.filter(
      (e) => e.campaign_id === campaignId && e.business_id === businessId
    );

    for (const ev of events) {
      const d = ev.event_timestamp ? ev.event_timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
      if (dateRange?.from && d < dateRange.from.slice(0, 10)) continue;
      if (dateRange?.to && d > dateRange.to.slice(0, 10)) continue;

      if (!dateMap.has(d)) {
        dateMap.set(d, { date: d, sent: 0, delivered: 0, bounced: 0, failed: 0, complained: 0, unsubscribed: 0 });
      }
      const pt = dateMap.get(d)!;
      const type = ev.event_type.toLowerCase();
      if (type === "sent") pt.sent += 1;
      else if (type === "delivered") pt.delivered += 1;
      else if (type === "bounced") pt.bounced += 1;
      else if (type === "failed") pt.failed += 1;
      else if (type === "complained") pt.complained += 1;
      else if (type === "unsubscribed") pt.unsubscribed += 1;
    }

    // If no events recorded, aggregate from messages
    if (dateMap.size === 0) {
      const msgs = store.messages.filter(
        (m) => m.campaign_id === campaignId && m.business_id === businessId
      );
      for (const m of msgs) {
        const d = m.created_at.slice(0, 10);
        if (dateRange?.from && d < dateRange.from.slice(0, 10)) continue;
        if (dateRange?.to && d > dateRange.to.slice(0, 10)) continue;

        if (!dateMap.has(d)) {
          dateMap.set(d, { date: d, sent: 0, delivered: 0, bounced: 0, failed: 0, complained: 0, unsubscribed: 0 });
        }
        const pt = dateMap.get(d)!;
        const st = m.status.toLowerCase();
        if (["sent", "delivered", "bounced", "complained"].includes(st) || m.sent_at) pt.sent += 1;
        if (st === "delivered") pt.delivered += 1;
        if (st === "bounced") pt.bounced += 1;
        if (st === "failed") pt.failed += 1;
        if (st === "complained") pt.complained += 1;
      }
    }

    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // ==========================================
  // 3. Step-Level Analytics
  // ==========================================
  async getStepAnalytics(
    businessId: string,
    campaignId: string,
    dateRange?: DateFilterRange
  ): Promise<StepAnalyticsItem[]> {
    if (this.useDatabase()) {
      try {
        // 1. Fetch steps for campaign
        const stepsRes = await this.queryFn<QueryResultRow>(
          `SELECT id, step_number, name, status 
           FROM campaign_steps 
           WHERE campaign_id = $1 
           ORDER BY step_number ASC;`,
          [campaignId]
        );
        const steps = stepsRes.rows;
        if (steps.length === 0) return [];

        const dateClauses: string[] = [];
        const params: unknown[] = [campaignId, businessId];

        if (dateRange?.from) {
          params.push(dateRange.from);
          dateClauses.push(`created_at >= $${params.length}`);
        }
        if (dateRange?.to) {
          params.push(dateRange.to);
          dateClauses.push(`created_at <= $${params.length}`);
        }
        const dateSql = dateClauses.length > 0 ? ` AND ${dateClauses.join(" AND ")}` : "";

        // Aggregate messages by step
        const sql = `
          SELECT 
            campaign_step_id,
            COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS sent,
            COUNT(CASE WHEN LOWER(status) = 'delivered' THEN 1 END) AS delivered,
            COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS bounced,
            COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END) AS failed,
            COUNT(CASE WHEN LOWER(status) = 'complained' THEN 1 END) AS complained
          FROM email_messages
          WHERE campaign_id = $1 AND business_id = $2 AND campaign_step_id IS NOT NULL ${dateSql}
          GROUP BY campaign_step_id;
        `;
        const aggRes = await this.queryFn<QueryResultRow>(sql, params);
        const aggMap = new Map<string, QueryResultRow>();
        for (const row of aggRes.rows) {
          aggMap.set(String(row.campaign_step_id), row);
        }

        // Aggregate unsubscribes by step from email_events
        const unsubRes = await this.queryFn<QueryResultRow>(
          `SELECT campaign_step_id, COUNT(DISTINCT lead_id) AS unsubscribed
           FROM email_events
           WHERE campaign_id = $1 AND business_id = $2 AND campaign_step_id IS NOT NULL AND LOWER(event_type) = 'unsubscribed'
           GROUP BY campaign_step_id;`,
          [campaignId, businessId]
        );
        const unsubMap = new Map<string, number>();
        for (const u of unsubRes.rows) {
          unsubMap.set(String(u.campaign_step_id), Number(u.unsubscribed || 0));
        }

        return steps.map((s) => {
          const sid = String(s.id);
          const data = aggMap.get(sid);
          const sent = Number(data?.sent || 0);
          const delivered = Number(data?.delivered || 0);
          const bounced = Number(data?.bounced || 0);
          const failed = Number(data?.failed || 0);
          const complained = Number(data?.complained || 0);
          const unsubscribed = unsubMap.get(sid) || 0;

          const deliveryRate = sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0;
          const bounceRate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;

          return {
            step_id: sid,
            step_number: Number(s.step_number),
            step_name: String(s.name || `Step ${s.step_number}`),
            status: String(s.status || "ACTIVE"),
            sent,
            delivered,
            bounced,
            failed,
            complained,
            unsubscribed,
            delivery_rate: deliveryRate,
            bounce_rate: bounceRate,
          };
        });
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store ---
    const store = this.loadLocalStore();
    const steps = store.steps
      .filter((s) => s.campaign_id === campaignId)
      .sort((a, b) => Number(a.step_number) - Number(b.step_number));

    return steps.map((s) => {
      const sid = String(s.id);
      let msgs = store.messages.filter(
        (m) => m.campaign_id === campaignId && m.campaign_step_id === sid && m.business_id === businessId
      );
      if (dateRange?.from) {
        const fromTime = new Date(dateRange.from).getTime();
        msgs = msgs.filter((m) => new Date(m.created_at).getTime() >= fromTime);
      }
      if (dateRange?.to) {
        const toTime = new Date(dateRange.to).getTime();
        msgs = msgs.filter((m) => new Date(m.created_at).getTime() <= toTime);
      }

      const sent = msgs.filter(
        (m) => ["sent", "delivered", "bounced", "complained"].includes(m.status.toLowerCase()) || m.sent_at
      ).length;
      const delivered = msgs.filter((m) => m.status.toLowerCase() === "delivered").length;
      const bounced = msgs.filter((m) => m.status.toLowerCase() === "bounced").length;
      const failed = msgs.filter((m) => m.status.toLowerCase() === "failed").length;
      const complained = msgs.filter((m) => m.status.toLowerCase() === "complained").length;

      const unsubs = store.events.filter(
        (e) => e.campaign_id === campaignId && e.campaign_step_id === sid && e.event_type.toLowerCase() === "unsubscribed"
      ).length;

      const deliveryRate = sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0;
      const bounceRate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;

      return {
        step_id: sid,
        step_number: Number(s.step_number),
        step_name: String(s.name || `Step ${s.step_number}`),
        status: String(s.status || "ACTIVE"),
        sent,
        delivered,
        bounced,
        failed,
        complained,
        unsubscribed: unsubs,
        delivery_rate: deliveryRate,
        bounce_rate: bounceRate,
      };
    });
  }

  // ==========================================
  // 4. Contact Email History (Server-Side Paginated)
  // ==========================================
  async getContactEmailHistory(
    businessId: string,
    leadId: string,
    page = 1,
    limit = 50
  ): Promise<PaginatedResult<ContactEmailHistoryItem>> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    if (this.useDatabase()) {
      try {
        const countRes = await this.queryFn<QueryResultRow>(
          `SELECT COUNT(*) AS total FROM email_messages WHERE business_id = $1 AND lead_id = $2;`,
          [businessId, leadId]
        );
        const total = Number(countRes.rows[0]?.total || 0);

        const sql = `
          SELECT 
            m.id,
            m.campaign_id,
            c.name AS campaign_name,
            m.campaign_step_id,
            s.step_number,
            s.name AS step_name,
            m.from_email,
            m.to_email,
            m.subject,
            m.status,
            m.sent_at,
            m.delivered_at,
            m.bounced_at,
            m.metadata,
            m.created_at
          FROM email_messages m
          LEFT JOIN campaigns c ON c.id = m.campaign_id
          LEFT JOIN campaign_steps s ON s.id = m.campaign_step_id
          WHERE m.business_id = $1 AND m.lead_id = $2
          ORDER BY m.created_at DESC
          LIMIT $3 OFFSET $4;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, leadId, safeLimit, offset]);

        const items: ContactEmailHistoryItem[] = res.rows.map((r) => {
          const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>) || {};
          return {
            id: String(r.id),
            campaign_id: r.campaign_id ? String(r.campaign_id) : null,
            campaign_name: r.campaign_name ? String(r.campaign_name) : null,
            campaign_step_id: r.campaign_step_id ? String(r.campaign_step_id) : null,
            step_number: r.step_number ? Number(r.step_number) : null,
            step_name: r.step_name ? String(r.step_name) : null,
            from_email: String(r.from_email || ""),
            from_name: meta.from_name ? String(meta.from_name) : null,
            to_email: String(r.to_email || ""),
            subject: String(r.subject || ""),
            status: String(r.status || "QUEUED").toUpperCase() as MessageStatus,
            sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
            delivered_at: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
            bounced_at: r.bounced_at ? new Date(r.bounced_at).toISOString() : null,
            bounce_reason: meta.reason ? String(meta.reason) : null,
            complaint_reason: meta.complaint_reason ? String(meta.complaint_reason) : null,
            created_at: new Date(r.created_at).toISOString(),
          };
        });

        return {
          data: items,
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit) || 1,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store ---
    const store = this.loadLocalStore();
    const allMsgs = store.messages
      .filter((m) => m.business_id === businessId && m.lead_id === leadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = allMsgs.length;
    const pageMsgs = allMsgs.slice(offset, offset + safeLimit);

    const items: ContactEmailHistoryItem[] = pageMsgs.map((m) => {
      const camp = store.campaigns.find((c) => c.id === m.campaign_id);
      const step = store.steps.find((s) => s.id === m.campaign_step_id);
      const meta = m.metadata || {};

      return {
        id: m.id,
        campaign_id: m.campaign_id || null,
        campaign_name: camp?.name ? String(camp.name) : null,
        campaign_step_id: m.campaign_step_id || null,
        step_number: step?.step_number ? Number(step.step_number) : null,
        step_name: step?.name ? String(step.name) : null,
        from_email: m.from_email,
        from_name: meta.from_name ? String(meta.from_name) : null,
        to_email: m.to_email,
        subject: m.subject,
        status: m.status,
        sent_at: m.sent_at || null,
        delivered_at: m.delivered_at || null,
        bounced_at: m.bounced_at || null,
        bounce_reason: meta.reason ? String(meta.reason) : null,
        complaint_reason: meta.complaint_reason ? String(meta.complaint_reason) : null,
        created_at: m.created_at,
      };
    });

    return {
      data: items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  // ==========================================
  // 5. Email Message Detail View (No Secrets)
  // ==========================================
  async getEmailMessageDetail(
    businessId: string,
    messageId: string
  ): Promise<EmailMessageDetail | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT 
            m.*,
            c.name AS campaign_name,
            s.name AS step_name,
            s.step_number,
            CONCAT(l.first_name, ' ', l.last_name) AS lead_name
          FROM email_messages m
          LEFT JOIN campaigns c ON c.id = m.campaign_id
          LEFT JOIN campaign_steps s ON s.id = m.campaign_step_id
          LEFT JOIN leads l ON l.id = m.lead_id
          WHERE m.id = $1 AND m.business_id = $2
          LIMIT 1;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [messageId, businessId]);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];

        // Fetch audit events for message
        const evRes = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_events WHERE email_message_id = $1 AND business_id = $2 ORDER BY event_timestamp ASC;`,
          [messageId, businessId]
        );

        const events: EmailEvent[] = evRes.rows.map((e) => {
          const emeta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : (e.metadata as Record<string, unknown>) || {};
          return {
            id: String(e.id),
            business_id: String(e.business_id),
            email_message_id: String(e.email_message_id),
            campaign_id: e.campaign_id ? String(e.campaign_id) : null,
            campaign_step_id: e.campaign_step_id ? String(e.campaign_step_id) : null,
            lead_id: e.lead_id ? String(e.lead_id) : null,
            enrollment_id: e.enrollment_id ? String(e.enrollment_id) : null,
            event_type: String(e.event_type).toUpperCase() as EmailEvent["event_type"],
            provider_event_id: e.provider_event_id ? String(e.provider_event_id) : null,
            event_timestamp: new Date(e.event_timestamp).toISOString(),
            metadata: emeta,
            created_at: new Date(e.created_at).toISOString(),
          };
        });

        const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>) || {};
        // Strip any provider secrets or private keys if present in metadata
        delete meta.api_key;
        delete meta.secret;
        delete meta.auth;

        return {
          id: String(r.id),
          business_id: String(r.business_id),
          lead_id: String(r.lead_id),
          campaign_id: r.campaign_id ? String(r.campaign_id) : null,
          campaign_step_id: r.campaign_step_id ? String(r.campaign_step_id) : null,
          template_id: r.template_id ? String(r.template_id) : null,
          direction: (r.direction || "outbound") as "outbound" | "inbound",
          provider_message_id: r.provider_message_id ? String(r.provider_message_id) : null,
          from_email: String(r.from_email || ""),
          to_email: String(r.to_email || ""),
          reply_to: r.reply_to ? String(r.reply_to) : null,
          subject: String(r.subject || ""),
          body: String(r.body || ""),
          status: String(r.status || "QUEUED").toUpperCase() as MessageStatus,
          scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
          sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
          delivered_at: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
          bounced_at: r.bounced_at ? new Date(r.bounced_at).toISOString() : null,
          metadata: meta,
          created_at: new Date(r.created_at).toISOString(),
          updated_at: new Date(r.updated_at).toISOString(),
          lead_name: r.lead_name ? String(r.lead_name).trim() || null : null,
          campaign_name: r.campaign_name ? String(r.campaign_name) : null,
          step_name: r.step_name ? String(r.step_name) : null,
          step_number: r.step_number ? Number(r.step_number) : null,
          events,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store ---
    const store = this.loadLocalStore();
    const msg = store.messages.find((m) => m.id === messageId && m.business_id === businessId);
    if (!msg) return null;

    const camp = store.campaigns.find((c) => c.id === msg.campaign_id);
    const step = store.steps.find((s) => s.id === msg.campaign_step_id);
    const lead = store.leads.find((l) => l.id === msg.lead_id);
    const events = store.events.filter((e) => e.email_message_id === messageId);

    const meta = { ...(msg.metadata || {}) };
    delete meta.api_key;
    delete meta.secret;

    const leadName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || null
      : null;

    return {
      ...msg,
      metadata: meta,
      lead_name: leadName,
      campaign_name: camp?.name ? String(camp.name) : null,
      step_name: step?.name ? String(step.name) : null,
      step_number: step?.step_number ? Number(step.step_number) : null,
      events,
    };
  }

  // ==========================================
  // 6. Campaign Messages (Paginated)
  // ==========================================
  async getCampaignMessages(
    businessId: string,
    campaignId: string,
    page = 1,
    limit = 50,
    status?: string
  ): Promise<PaginatedResult<ContactEmailHistoryItem>> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    if (this.useDatabase()) {
      try {
        const filterClauses: string[] = ["m.campaign_id = $1", "m.business_id = $2"];
        const params: unknown[] = [campaignId, businessId];

        if (status) {
          params.push(status.toLowerCase());
          filterClauses.push(`LOWER(m.status) = $${params.length}`);
        }

        const countSql = `SELECT COUNT(*) AS total FROM email_messages m WHERE ${filterClauses.join(" AND ")};`;
        const countRes = await this.queryFn<QueryResultRow>(countSql, params);
        const total = Number(countRes.rows[0]?.total || 0);

        params.push(safeLimit, offset);
        const sql = `
          SELECT 
            m.id,
            m.campaign_id,
            c.name AS campaign_name,
            m.campaign_step_id,
            s.step_number,
            s.name AS step_name,
            m.from_email,
            m.to_email,
            m.subject,
            m.status,
            m.sent_at,
            m.delivered_at,
            m.bounced_at,
            m.metadata,
            m.created_at
          FROM email_messages m
          LEFT JOIN campaigns c ON c.id = m.campaign_id
          LEFT JOIN campaign_steps s ON s.id = m.campaign_step_id
          WHERE ${filterClauses.join(" AND ")}
          ORDER BY m.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length};
        `;
        const res = await this.queryFn<QueryResultRow>(sql, params);

        const items: ContactEmailHistoryItem[] = res.rows.map((r) => {
          const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>) || {};
          return {
            id: String(r.id),
            campaign_id: r.campaign_id ? String(r.campaign_id) : null,
            campaign_name: r.campaign_name ? String(r.campaign_name) : null,
            campaign_step_id: r.campaign_step_id ? String(r.campaign_step_id) : null,
            step_number: r.step_number ? Number(r.step_number) : null,
            step_name: r.step_name ? String(r.step_name) : null,
            from_email: String(r.from_email || ""),
            from_name: meta.from_name ? String(meta.from_name) : null,
            to_email: String(r.to_email || ""),
            subject: String(r.subject || ""),
            status: String(r.status || "QUEUED").toUpperCase() as MessageStatus,
            sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
            delivered_at: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
            bounced_at: r.bounced_at ? new Date(r.bounced_at).toISOString() : null,
            bounce_reason: meta.reason ? String(meta.reason) : null,
            complaint_reason: meta.complaint_reason ? String(meta.complaint_reason) : null,
            created_at: new Date(r.created_at).toISOString(),
          };
        });

        return {
          data: items,
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit) || 1,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // --- Fallback Local Store ---
    const store = this.loadLocalStore();
    let msgs = store.messages.filter(
      (m) => m.campaign_id === campaignId && m.business_id === businessId
    );
    if (status) {
      msgs = msgs.filter((m) => m.status.toLowerCase() === status.toLowerCase());
    }
    msgs.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = msgs.length;
    const pageMsgs = msgs.slice(offset, offset + safeLimit);

    const items: ContactEmailHistoryItem[] = pageMsgs.map((m) => {
      const camp = store.campaigns.find((c) => c.id === m.campaign_id);
      const step = store.steps.find((s) => s.id === m.campaign_step_id);
      const meta = m.metadata || {};

      return {
        id: m.id,
        campaign_id: m.campaign_id || null,
        campaign_name: camp?.name ? String(camp.name) : null,
        campaign_step_id: m.campaign_step_id || null,
        step_number: step?.step_number ? Number(step.step_number) : null,
        step_name: step?.name ? String(step.name) : null,
        from_email: m.from_email,
        from_name: meta.from_name ? String(meta.from_name) : null,
        to_email: m.to_email,
        subject: m.subject,
        status: m.status,
        sent_at: m.sent_at || null,
        delivered_at: m.delivered_at || null,
        bounced_at: m.bounced_at || null,
        bounce_reason: meta.reason ? String(meta.reason) : null,
        complaint_reason: meta.complaint_reason ? String(meta.complaint_reason) : null,
        created_at: m.created_at,
      };
    });

    return {
      data: items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  // ==========================================
  // 7. CSV Export Dataset
  // ==========================================
  async getCampaignExportData(
    businessId: string,
    campaignId: string
  ): Promise<
    Array<{
      contact_name: string;
      email: string;
      campaign_name: string;
      step_name: string;
      subject: string;
      status: string;
      sent_at: string;
      delivered_at: string;
      bounce_reason: string;
      complaint_reason: string;
      unsubscribed: string;
    }>
  > {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT 
            CONCAT(l.first_name, ' ', l.last_name) AS contact_name,
            m.to_email AS email,
            c.name AS campaign_name,
            COALESCE(s.name, CONCAT('Step ', s.step_number), '—') AS step_name,
            m.subject,
            m.status,
            COALESCE(TO_CHAR(m.sent_at, 'YYYY-MM-DD HH24:MI:SS'), '—') AS sent_at,
            COALESCE(TO_CHAR(m.delivered_at, 'YYYY-MM-DD HH24:MI:SS'), '—') AS delivered_at,
            COALESCE(m.metadata->>'reason', '—') AS bounce_reason,
            COALESCE(m.metadata->>'complaint_reason', '—') AS complaint_reason,
            CASE WHEN EXISTS (
              SELECT 1 FROM email_events ev 
              WHERE ev.campaign_id = m.campaign_id AND ev.lead_id = m.lead_id AND LOWER(ev.event_type) = 'unsubscribed'
            ) THEN 'YES' ELSE 'NO' END AS unsubscribed
          FROM email_messages m
          LEFT JOIN campaigns c ON c.id = m.campaign_id
          LEFT JOIN campaign_steps s ON s.id = m.campaign_step_id
          LEFT JOIN leads l ON l.id = m.lead_id
          WHERE m.campaign_id = $1 AND m.business_id = $2
          ORDER BY m.created_at DESC;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [campaignId, businessId]);
        return res.rows.map((r) => ({
          contact_name: String(r.contact_name || "").trim() || "—",
          email: String(r.email || ""),
          campaign_name: String(r.campaign_name || ""),
          step_name: String(r.step_name || "—"),
          subject: String(r.subject || ""),
          status: String(r.status || "").toUpperCase(),
          sent_at: String(r.sent_at || "—"),
          delivered_at: String(r.delivered_at || "—"),
          bounce_reason: String(r.bounce_reason || "—"),
          complaint_reason: String(r.complaint_reason || "—"),
          unsubscribed: String(r.unsubscribed || "NO"),
        }));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // Fallback local store
    const store = this.loadLocalStore();
    const camp = store.campaigns.find((c) => c.id === campaignId && c.business_id === businessId);
    const msgs = store.messages.filter((m) => m.campaign_id === campaignId && m.business_id === businessId);

    return msgs.map((m) => {
      const step = store.steps.find((s) => s.id === m.campaign_step_id);
      const lead = store.leads.find((l) => l.id === m.lead_id);
      const hasUnsub = store.events.some(
        (e) => e.campaign_id === campaignId && e.lead_id === m.lead_id && e.event_type.toLowerCase() === "unsubscribed"
      );

      const contactName = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "—" : "—";
      const meta = m.metadata || {};

      return {
        contact_name: contactName,
        email: m.to_email,
        campaign_name: camp?.name ? String(camp.name) : "",
        step_name: step?.name ? String(step.name) : "—",
        subject: m.subject,
        status: m.status.toUpperCase(),
        sent_at: m.sent_at || "—",
        delivered_at: m.delivered_at || "—",
        bounce_reason: String(meta.reason || "—"),
        complaint_reason: String(meta.complaint_reason || "—"),
        unsubscribed: hasUnsub ? "YES" : "NO",
      };
    });
  }
}
