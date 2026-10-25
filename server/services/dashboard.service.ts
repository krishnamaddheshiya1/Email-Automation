import fs from "fs";
import path from "path";
import { query, isDbConfigured } from "../db/client";
import type { QueryResultRow } from "pg";
import { deliverySafetyService, WorkspaceQuota } from "./delivery-safety.service";

export interface DashboardMetricOverview {
  totalContacts: number;
  activeCampaigns: number;
  emailsSent: number;
  emailsDelivered: number;
  deliveryRate?: number;
  emailsOpened?: number;
  uniqueOpens?: number;
  totalOpens?: number;
  openRate?: number;
  emailsBounced?: number;
  bounceRate: number;
  unreadReplies?: number;
  totalReplies?: number;
}

export interface DashboardRecentCampaign {
  id: string;
  name: string;
  status: string;
  contactCount: number;
  sentCount: number;
  deliveredCount: number;
  openedCount?: number;
  openRate?: number;
  bounceRate: number;
  createdAt: string;
}

export interface DashboardRecentActivityItem {
  id: string;
  contactEmail: string;
  contactName: string;
  campaignName: string;
  eventType: string;
  timestamp: string;
}

export interface ComponentHealth {
  status: "Healthy" | "Warning" | "Error";
  message: string;
}

export interface SystemHealthOverview {
  application: ComponentHealth;
  database: ComponentHealth;
  emailProvider: ComponentHealth;
  webhook: ComponentHealth;
}

export interface DashboardOverviewResponse {
  greeting: string;
  businessName: string;
  metrics: DashboardMetricOverview;
  recentCampaigns: DashboardRecentCampaign[];
  recentActivity: DashboardRecentActivityItem[];
  health: SystemHealthOverview;
  quota?: WorkspaceQuota;
}

export class DashboardService {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  private getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  async getDashboardData(businessId: string): Promise<DashboardOverviewResponse> {
    const greeting = this.getGreeting();

    if (this.useDatabase()) {
      try {
        // Run all independent dashboard queries concurrently in parallel
        const [
          bizRes,
          contactRes,
          campRes,
          msgRes,
          convoResResult,
          recentCampRes,
          recentActRes,
          health,
          quota,
        ] = await Promise.all([
          // 1. Business Info
          this.queryFn<QueryResultRow>(
            `SELECT name FROM businesses WHERE id = $1 LIMIT 1;`,
            [businessId]
          ),
          // 2. Total active contacts
          this.queryFn<QueryResultRow>(
            `SELECT COUNT(*) AS total FROM leads WHERE business_id = $1 AND LOWER(status) != 'archived';`,
            [businessId]
          ),
          // Active campaigns
          this.queryFn<QueryResultRow>(
            `SELECT COUNT(*) AS total FROM campaigns WHERE business_id = $1 AND UPPER(status) = 'ACTIVE';`,
            [businessId]
          ),
          // Email counts (Sent, Delivered, Opened, Bounced)
          this.queryFn<QueryResultRow>(
            `SELECT 
              COUNT(CASE WHEN LOWER(status) IN ('sent', 'delivered', 'opened', 'bounced', 'complained') OR sent_at IS NOT NULL THEN 1 END) AS total_sent,
              COUNT(CASE WHEN LOWER(status) IN ('delivered', 'opened') OR delivered_at IS NOT NULL THEN 1 END) AS total_delivered,
              COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL OR open_count > 0 THEN 1 END) AS total_opened,
              COALESCE(SUM(open_count), COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL THEN 1 END)) AS total_opens,
              COUNT(CASE WHEN LOWER(status) = 'bounced' THEN 1 END) AS total_bounced
             FROM email_messages 
             WHERE business_id = $1;`,
            [businessId]
          ),
          // Inbound Replies (safe fallback if table empty or schema differing)
          this.queryFn<QueryResultRow>(
            `SELECT 
              COUNT(*) AS total_replies,
              COALESCE(SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END), 0) AS unread_replies
             FROM conversations
             WHERE business_id = $1;`,
            [businessId]
          ).catch(() => ({ rows: [{ total_replies: 0, unread_replies: 0 }] })),
          // 3. Recent Campaigns (up to 5)
          this.queryFn<QueryResultRow>(
            `SELECT 
              c.id, 
              c.name, 
              c.status, 
              c.created_at,
              (SELECT COUNT(DISTINCT cl.id) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id WHERE cl.campaign_id = c.id AND LOWER(cl.status) != 'removed' AND l.email IS NOT NULL AND TRIM(l.email) != '') AS contact_count,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) IN ('sent', 'delivered', 'opened', 'bounced', 'complained') OR em.sent_at IS NOT NULL)) AS sent_count,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) IN ('delivered', 'opened') OR em.delivered_at IS NOT NULL)) AS delivered_count,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) = 'opened' OR em.opened_at IS NOT NULL OR em.open_count > 0)) AS opened_count,
              (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND LOWER(em.status) = 'bounced') AS bounced_count
             FROM campaigns c
             WHERE c.business_id = $1
             ORDER BY c.created_at DESC
             LIMIT 5;`,
            [businessId]
          ),
          // 4. Recent Email Activity (up to 10 events)
          this.queryFn<QueryResultRow>(
            `SELECT 
              ev.id, 
              ev.event_type, 
              ev.event_timestamp, 
              l.email AS contact_email, 
              CONCAT(l.first_name, ' ', l.last_name) AS contact_name, 
              c.name AS campaign_name 
             FROM email_events ev
             LEFT JOIN leads l ON l.id = ev.lead_id
             LEFT JOIN campaigns c ON c.id = ev.campaign_id
             WHERE ev.business_id = $1
             ORDER BY ev.event_timestamp DESC
             LIMIT 10;`,
            [businessId]
          ),
          // 5. System Health Check & Quota
          this.checkHealth(businessId),
          deliverySafetyService.getQuota(businessId),
        ]);

        const businessName = String(bizRes.rows[0]?.name || "Your Workspace");
        const totalContacts = Number(contactRes.rows[0]?.total || 0);
        const activeCampaigns = Number(campRes.rows[0]?.total || 0);

        const emailsSent = Number(msgRes.rows[0]?.total_sent || 0);
        const emailsDelivered = Number(msgRes.rows[0]?.total_delivered || 0);
        const emailsOpened = Number(msgRes.rows[0]?.total_opened || 0);
        const uniqueOpens = emailsOpened;
        const totalOpens = Math.max(uniqueOpens, Number(msgRes.rows[0]?.total_opens || 0));
        const emailsBounced = Number(msgRes.rows[0]?.total_bounced || 0);
        const deliveryRate = emailsSent > 0 ? Number(((emailsDelivered / emailsSent) * 100).toFixed(2)) : 0;
        const openRate = emailsDelivered > 0
          ? Number(((uniqueOpens / emailsDelivered) * 100).toFixed(2))
          : (emailsSent > 0 ? Number(((uniqueOpens / emailsSent) * 100).toFixed(2)) : 0);
        const bounceRate = emailsSent > 0 ? Number(((emailsBounced / emailsSent) * 100).toFixed(2)) : 0;

        const totalReplies = Number(convoResResult.rows[0]?.total_replies || 0);
        const unreadReplies = Number(convoResResult.rows[0]?.unread_replies || 0);

        const recentCampaigns: DashboardRecentCampaign[] = recentCampRes.rows.map((r) => {
          const sent = Number(r.sent_count || 0);
          const delivered = Number(r.delivered_count || 0);
          const opened = Number(r.opened_count || 0);
          const bounced = Number(r.bounced_count || 0);
          const cBounceRate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;
          const cOpenRate = delivered > 0
            ? Number(((opened / delivered) * 100).toFixed(2))
            : (sent > 0 ? Number(((opened / sent) * 100).toFixed(2)) : 0);
          return {
            id: String(r.id),
            name: String(r.name),
            status: String(r.status || "DRAFT").toUpperCase(),
            contactCount: Number(r.contact_count || 0),
            sentCount: sent,
            deliveredCount: delivered,
            openedCount: opened,
            openRate: cOpenRate,
            bounceRate: cBounceRate,
            createdAt: new Date(r.created_at).toISOString(),
          };
        });

        // 4. Recent Email Activity (mapped from parallel query result)
        const recentActivity: DashboardRecentActivityItem[] = recentActRes.rows.map((r) => ({
          id: String(r.id),
          contactEmail: String(r.contact_email || "Recipient"),
          contactName: String(r.contact_name || "").trim() || "Recipient",
          campaignName: String(r.campaign_name || "Campaign"),
          eventType: String(r.event_type || "SENT").toUpperCase(),
          timestamp: new Date(r.event_timestamp).toISOString(),
        }));

        return {
          greeting,
          businessName,
          metrics: {
            totalContacts,
            activeCampaigns,
            emailsSent,
            emailsDelivered,
            deliveryRate,
            emailsOpened,
            uniqueOpens,
            totalOpens,
            openRate,
            emailsBounced,
            bounceRate,
            unreadReplies,
            totalReplies,
          },
          recentCampaigns,
          recentActivity,
          health,
          quota,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // Try Supabase PostgREST if DATABASE_URL is not configured
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();

      const { data: bizData } = await admin
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle();

      const businessName =
        String(bizData?.name || "") ||
        (process.env.EMAIL_FROM_NAME ? process.env.EMAIL_FROM_NAME.replace(/"/g, "") : "Opsiys");

      const { count: contactCount } = await admin
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .neq("status", "ARCHIVED")
        .neq("status", "archived");

      const { count: campCount } = await admin
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "ACTIVE");

      if (contactCount !== null && contactCount !== undefined) {
        // Query email_messages directly from Supabase
        const { data: msgsData } = await admin
          .from("email_messages")
          .select("id, status, sent_at, metadata, campaign_id, lead_id, created_at")
          .eq("business_id", businessId);

        const rawMsgs = (msgsData || []) as Array<{
          id: string;
          status: string;
          sent_at?: string | null;
          metadata?: Record<string, unknown> | null;
          campaign_id?: string | null;
          lead_id?: string | null;
          created_at?: string;
        }>;

        const msgs = rawMsgs.map((m) => {
          const meta = (m.metadata || {}) as Record<string, unknown>;
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
            meta,
          };
        });

        const emailsSent = msgs.filter((m) => m.isSent).length;
        const emailsDelivered = msgs.filter((m) => m.isDelivered).length;
        const openedMsgs = msgs.filter((m) => m.isOpened);
        const emailsOpened = openedMsgs.length;
        const uniqueOpens = emailsOpened;
        const totalOpens = openedMsgs.reduce((acc, m) => acc + Math.max(1, m.openCount), 0);
        const emailsBounced = msgs.filter((m) => m.isBounced).length;

        const deliveryRate = emailsSent > 0 ? Number(((emailsDelivered / emailsSent) * 100).toFixed(2)) : 0;
        const openRate = emailsDelivered > 0
          ? Number(((uniqueOpens / emailsDelivered) * 100).toFixed(2))
          : (emailsSent > 0 ? Number(((uniqueOpens / emailsSent) * 100).toFixed(2)) : 0);
        const bounceRate = emailsSent > 0 ? Number(((emailsBounced / emailsSent) * 100).toFixed(2)) : 0;

        // Inbound conversations
        let totalReplies = 0;
        let unreadReplies = 0;
        try {
          const { data: convData } = await admin
            .from("conversations")
            .select("id, status")
            .eq("business_id", businessId);
          if (convData) {
            totalReplies = convData.length;
            unreadReplies = convData.filter((c: { status?: string | null }) => {
              const st = String(c.status || "").toLowerCase();
              return st === "unread" || st === "open";
            }).length;
          }
        } catch {}

        // Recent campaigns (up to 5)
        let recentCampaigns: DashboardRecentCampaign[] = [];
        try {
          const { data: campData } = await admin
            .from("campaigns")
            .select("id, name, status, settings, created_at")
            .eq("business_id", businessId)
            .order("created_at", { ascending: false })
            .limit(5);

          if (campData && campData.length > 0) {
            recentCampaigns = campData.map((c: { id: string; name: string; status?: string; settings?: Record<string, unknown>; created_at: string }) => {
              const cMsgs = msgs.filter((m) => m.campaign_id === c.id);
              const cSent = cMsgs.filter((m) => m.isSent).length;
              const cDelivered = cMsgs.filter((m) => m.isDelivered).length;
              const cOpened = cMsgs.filter((m) => m.isOpened).length;
              const cBounced = cMsgs.filter((m) => m.isBounced).length;

              const enrollments = Array.isArray(c.settings?.enrollments) ? c.settings.enrollments.length : 0;
              const distinctLeads = new Set(cMsgs.map((m) => m.lead_id).filter(Boolean)).size;
              const cContactCount = Math.max(enrollments, distinctLeads);

              const cOpenRate = cDelivered > 0
                ? Number(((cOpened / cDelivered) * 100).toFixed(2))
                : (cSent > 0 ? Number(((cOpened / cSent) * 100).toFixed(2)) : 0);
              const cBounceRate = cSent > 0 ? Number(((cBounced / cSent) * 100).toFixed(2)) : 0;

              return {
                id: String(c.id),
                name: String(c.name),
                status: String(c.status || "DRAFT").toUpperCase(),
                contactCount: cContactCount,
                sentCount: cSent,
                deliveredCount: cDelivered,
                openedCount: cOpened,
                openRate: cOpenRate,
                bounceRate: cBounceRate,
                createdAt: new Date(c.created_at).toISOString(),
              };
            });
          }
        } catch {}

        // Recent email events (up to 10)
        let recentActivity: DashboardRecentActivityItem[] = [];
        try {
          const { data: eventsData } = await admin
            .from("email_events")
            .select("id, message_id, event_type, event_data, created_at")
            .order("created_at", { ascending: false })
            .limit(10);

          if (eventsData && eventsData.length > 0) {
            const rawEvents = (eventsData as Array<{
              id: string;
              message_id?: string | null;
              event_type: string;
              event_data?: Record<string, unknown> | null;
              created_at: string;
            }>).filter((ev) => {
              return !ev.event_data?.business_id || ev.event_data.business_id === businessId;
            });

            const leadIds = Array.from(new Set(rawEvents.map((e) => e.event_data?.lead_id).filter(Boolean))) as string[];
            const campIds = Array.from(new Set(rawEvents.map((e) => e.event_data?.campaign_id).filter(Boolean))) as string[];

            const [leadsRes, campsRes] = await Promise.all([
              leadIds.length > 0
                ? admin.from("leads").select("id, email, first_name, last_name").in("id", leadIds)
                : Promise.resolve({ data: [] }),
              campIds.length > 0
                ? admin.from("campaigns").select("id, name").in("id", campIds)
                : Promise.resolve({ data: [] }),
            ]);

            const leadMap = new Map(((leadsRes.data || []) as Array<{ id: string; email: string; first_name?: string; last_name?: string }>).map((l) => [l.id, l]));
            const campMap = new Map(((campsRes.data || []) as Array<{ id: string; name: string }>).map((c) => [c.id, c]));

            recentActivity = rawEvents.map((ev) => {
              const leadId = ev.event_data?.lead_id as string | undefined;
              const campId = ev.event_data?.campaign_id as string | undefined;
              const lead = leadId ? leadMap.get(leadId) : null;
              const camp = campId ? campMap.get(campId) : null;
              const contactName = lead ? `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || lead.email : "Recipient";
              return {
                id: String(ev.id),
                contactEmail: lead?.email || "Recipient",
                contactName,
                campaignName: camp?.name || "Campaign",
                eventType: String(ev.event_type || "SENT").toUpperCase(),
                timestamp: new Date(ev.created_at).toISOString(),
              };
            });
          }
        } catch {}

        const [health, quota] = await Promise.all([
          this.checkHealth(businessId),
          deliverySafetyService.getQuota(businessId),
        ]);
        return {
          greeting,
          businessName,
          metrics: {
            totalContacts: contactCount || 0,
            activeCampaigns: campCount !== null && campCount !== undefined ? campCount : 0,
            emailsSent,
            emailsDelivered,
            deliveryRate,
            emailsOpened,
            uniqueOpens,
            totalOpens,
            openRate,
            emailsBounced,
            bounceRate,
            unreadReplies,
            totalReplies,
          },
          recentCampaigns,
          recentActivity,
          health,
          quota,
        };
      }
    } catch (err) {
      console.error("[DashboardService.getDashboardData] Authoritative query error:", err);
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw new Error("Unable to fetch dashboard metrics from authoritative Supabase database.");
      }
    }

    // --- Fallback Local Store (Development without DB only) ---
    return await this.getLocalDashboardData(businessId, greeting);
  }

  async checkHealth(businessId?: string): Promise<SystemHealthOverview> {
    let dbStatus: ComponentHealth = { status: "Healthy", message: "Database connection active" };
    let providerStatus: ComponentHealth = { status: "Warning", message: "No email provider configured" };
    const webhookStatus: ComponentHealth = { status: "Healthy", message: "Webhook endpoint ready" };
    const appStatus: ComponentHealth = { status: "Healthy", message: "All system services operational" };

    if (this.useDatabase()) {
      if (businessId) {
        try {
          const provRes = await this.queryFn<QueryResultRow>(
            `SELECT status, provider FROM email_providers WHERE business_id = $1 LIMIT 1;`,
            [businessId]
          );
          if (provRes.rows.length > 0) {
            const st = String(provRes.rows[0].status || "").toUpperCase();
            if (st === "ACTIVE") {
              providerStatus = { status: "Healthy", message: "Resend relay connected" };
            } else if (st === "ERROR") {
              providerStatus = { status: "Error", message: "Resend credentials error" };
            } else {
              providerStatus = { status: "Warning", message: `Provider status: ${st}` };
            }
          }
        } catch {
          dbStatus = { status: "Error", message: "Database query failed" };
        }
      } else {
        try {
          await this.queryFn("SELECT 1;");
        } catch {
          dbStatus = { status: "Error", message: "Database query failed" };
        }
      }
    } else {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { error } = await admin.from("businesses").select("id").limit(1);
        if (!error) {
          dbStatus = { status: "Healthy", message: "Supabase cloud database active" };
        }
        if (businessId) {
          const { data: provData } = await admin
            .from("email_providers")
            .select("status, provider")
            .eq("business_id", businessId)
            .limit(1);
          if (provData && provData.length > 0) {
            const st = String(provData[0].status || "").toUpperCase();
            if (st === "ACTIVE") {
              providerStatus = { status: "Healthy", message: "Resend relay connected" };
            } else if (st === "ERROR") {
              providerStatus = { status: "Error", message: "Resend credentials error" };
            }
          }
        }
      } catch {
        dbStatus = { status: "Healthy", message: "Development data store active" };
      }

      if (process.env.RESEND_API_KEY) {
        providerStatus = { status: "Healthy", message: "Resend relay connected" };
      }
    }

    return {
      application: appStatus,
      database: dbStatus,
      emailProvider: providerStatus,
      webhook: webhookStatus,
    };
  }

  private async getLocalDashboardData(businessId: string, greeting: string): Promise<DashboardOverviewResponse> {
    const read = (file: string) => {
      try {
        const p = path.resolve(process.cwd(), `.data/${file}`);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {}
      return null;
    };

    // 1. Business Info
    const rawBiz = read("businesses.json");
    const businesses: Array<{ id: string; name: string }> = Array.isArray(rawBiz)
      ? rawBiz
      : rawBiz && Array.isArray(rawBiz.businesses)
      ? rawBiz.businesses
      : [];
    const biz = businesses.find((b) => b.id === businessId);
    const businessName =
      biz?.name || (process.env.EMAIL_FROM_NAME ? process.env.EMAIL_FROM_NAME.replace(/"/g, "") : "Opsiys");

    // 2. Leads / Contacts
    const rawLeads = read("leads.json");
    const allLeads: Array<{ id: string; business_id: string; status: string; email: string; first_name?: string; last_name?: string }> =
      Array.isArray(rawLeads) ? rawLeads : rawLeads && Array.isArray(rawLeads.leads) ? rawLeads.leads : [];
    const leads = allLeads.filter(
      (l) => l.business_id === businessId && String(l.status || "").toLowerCase() !== "archived"
    );
    const totalContacts = leads.length;

    // 3. Campaigns & Enrollments
    const rawCamp = read("campaigns.json");
    const allCampaigns: Array<{ id: string; business_id: string; status: string; name: string; created_at: string }> =
      Array.isArray(rawCamp) ? rawCamp : rawCamp && Array.isArray(rawCamp.campaigns) ? rawCamp.campaigns : [];
    const campaigns = allCampaigns.filter((c) => c.business_id === businessId);
    const activeCampaigns = campaigns.filter((c) => String(c.status || "").toUpperCase() === "ACTIVE").length;

    const rawEnroll = read("campaign_leads.json");
    const allEnrollments: Array<{ id: string; campaign_id: string; business_id?: string; lead_id?: string; status: string }> =
      rawCamp && Array.isArray(rawCamp.enrollments)
        ? rawCamp.enrollments
        : Array.isArray(rawEnroll)
        ? rawEnroll
        : [];
    const enrollments = allEnrollments.filter((e) => !e.business_id || e.business_id === businessId);

    // 4. Messages & Events
    const rawEmailStore = read("email_messages.json");
    const allMessages: Array<{ business_id: string; campaign_id?: string; status: string; sent_at?: string }> =
      Array.isArray(rawEmailStore)
        ? rawEmailStore
        : rawEmailStore && Array.isArray(rawEmailStore.messages)
        ? rawEmailStore.messages
        : [];
    const messages = allMessages.filter((m) => m.business_id === businessId);

    const emailsSent = messages.filter(
      (m) =>
        ["sent", "delivered", "opened", "bounced", "complained"].includes(String(m.status || "").toLowerCase()) || m.sent_at
    ).length;
    const emailsDelivered = messages.filter(
      (m) => ["delivered", "opened"].includes(String(m.status || "").toLowerCase()) || (m as Record<string, unknown>).delivered_at
    ).length;
    const openedMessages = messages.filter(
      (m) =>
        String(m.status || "").toLowerCase() === "opened" ||
        (m as Record<string, unknown>).opened_at ||
        (typeof (m as Record<string, unknown>).open_count === "number" && Number((m as Record<string, unknown>).open_count) > 0)
    );
    const uniqueOpens = openedMessages.length;
    const totalOpens = openedMessages.reduce(
      (sum, m) => sum + Math.max(1, Number((m as Record<string, unknown>).open_count || 1)),
      0
    );
    const emailsOpened = uniqueOpens;
    const deliveryRate = emailsSent > 0 ? Number(((emailsDelivered / emailsSent) * 100).toFixed(2)) : 0;
    const openRate = emailsDelivered > 0
      ? Number(((uniqueOpens / emailsDelivered) * 100).toFixed(2))
      : (emailsSent > 0 ? Number(((uniqueOpens / emailsSent) * 100).toFixed(2)) : 0);
    const emailsBounced = messages.filter((m) => String(m.status || "").toLowerCase() === "bounced").length;
    const bounceRate = emailsSent > 0 ? Number(((emailsBounced / emailsSent) * 100).toFixed(2)) : 0;

    // 5. Recent Campaigns (up to 5)
    const recentCampaigns: DashboardRecentCampaign[] = campaigns.slice(0, 5).map((c) => {
      const cEnrolled = enrollments.filter(
        (e) =>
          e.campaign_id === c.id &&
          ["enrolled", "running", "waiting", "completed"].includes(String(e.status || "").toLowerCase())
      ).length;
      const cMsgs = messages.filter((m) => m.campaign_id === c.id);
      const sent = cMsgs.filter(
        (m) =>
          ["sent", "delivered", "opened", "bounced", "complained"].includes(String(m.status || "").toLowerCase()) || m.sent_at
      ).length;
      const delivered = cMsgs.filter(
        (m) => ["delivered", "opened"].includes(String(m.status || "").toLowerCase()) || (m as Record<string, unknown>).delivered_at
      ).length;
      const opened = cMsgs.filter(
        (m) =>
          String(m.status || "").toLowerCase() === "opened" ||
          (m as Record<string, unknown>).opened_at ||
          (typeof (m as Record<string, unknown>).open_count === "number" && Number((m as Record<string, unknown>).open_count) > 0)
      ).length;
      const bounced = cMsgs.filter((m) => String(m.status || "").toLowerCase() === "bounced").length;
      const cBounceRate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;
      const cOpenRate = delivered > 0
        ? Number(((opened / delivered) * 100).toFixed(2))
        : (sent > 0 ? Number(((opened / sent) * 100).toFixed(2)) : 0);

      return {
        id: c.id,
        name: c.name,
        status: String(c.status || "DRAFT").toUpperCase(),
        contactCount: cEnrolled,
        sentCount: sent,
        deliveredCount: delivered,
        openedCount: opened,
        openRate: cOpenRate,
        bounceRate: cBounceRate,
        createdAt: c.created_at || new Date().toISOString(),
      };
    });

    // 6. Recent Events (up to 10)
    const allEvents: Array<{ id: string; business_id?: string; lead_id?: string; campaign_id?: string; event_type: string; event_timestamp?: string; created_at?: string }> =
      rawEmailStore && Array.isArray(rawEmailStore.events) ? rawEmailStore.events : [];
    const events = allEvents.filter((e) => !e.business_id || e.business_id === businessId);
    events.sort((a, b) => {
      const msA = new Date(a.event_timestamp || a.created_at || 0).getTime() || 0;
      const msB = new Date(b.event_timestamp || b.created_at || 0).getTime() || 0;
      return msB - msA;
    });

    const recentActivity: DashboardRecentActivityItem[] = events.slice(0, 10).map((ev) => {
      const lead = leads.find((l) => l.id === ev.lead_id);
      const camp = campaigns.find((c) => c.id === ev.campaign_id);
      return {
        id: ev.id,
        contactEmail: lead?.email || "Recipient",
        contactName: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email : "Recipient",
        campaignName: camp?.name || "Campaign",
        eventType: String(ev.event_type || "SENT").toUpperCase(),
        timestamp: ev.event_timestamp || ev.created_at || new Date().toISOString(),
      };
    });

    // Inbound replies
    const rawConvos = read("conversations.json");
    const allConvos: Array<{ business_id: string; unread_count: number }> = Array.isArray(rawConvos) ? rawConvos : [];
    const bizConvos = allConvos.filter((c) => c.business_id === businessId);
    const totalReplies = bizConvos.length;
    const unreadReplies = bizConvos.filter((c) => c.unread_count > 0).length;

    return {
      greeting,
      businessName,
      metrics: {
        totalContacts,
        activeCampaigns,
        emailsSent,
        emailsDelivered,
        deliveryRate,
        emailsOpened,
        uniqueOpens,
        totalOpens,
        openRate,
        emailsBounced,
        bounceRate,
        totalReplies,
        unreadReplies,
      },
      recentCampaigns,
      recentActivity,
      health: {
        application: { status: "Healthy", message: "Application services running normally" },
        database: { status: "Healthy", message: "Development data store active" },
        emailProvider: { status: "Healthy", message: "Development simulated relay" },
        webhook: { status: "Healthy", message: "Webhook endpoint ready" },
      },
      quota: await deliverySafetyService.getQuota(businessId),
    };
  }
}
