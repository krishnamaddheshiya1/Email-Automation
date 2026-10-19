import {
  AnalyticsRepository,
  DateFilterRange,
  PaginatedResult,
} from "../repositories/analytics.repository";
import { CampaignRepository } from "../repositories/campaign.repository";
import type {
  CampaignAnalyticsOverview,
  CampaignTimelinePoint,
  StepAnalyticsItem,
  ContactEmailHistoryItem,
  EmailMessageDetail,
} from "@/types/database";

export interface AnalyticsQueryOptions {
  range?: "today" | "7d" | "30d" | "all" | "custom";
  from?: string;
  to?: string;
}

export interface CampaignAnalyticsFullResult {
  overview: CampaignAnalyticsOverview;
  timeline: CampaignTimelinePoint[];
  steps: StepAnalyticsItem[];
  dateRange: {
    appliedPreset: string;
    from: string | null;
    to: string | null;
  };
}

export class AnalyticsService {
  private analyticsRepo: AnalyticsRepository;
  private campaignRepo: CampaignRepository;

  constructor(
    analyticsRepo?: AnalyticsRepository,
    campaignRepo?: CampaignRepository
  ) {
    this.analyticsRepo = analyticsRepo || new AnalyticsRepository();
    this.campaignRepo = campaignRepo || new CampaignRepository();
  }

  /**
   * Resolves date filter presets into strict UTC ISO strings.
   */
  resolveDateRange(options?: AnalyticsQueryOptions): {
    filter?: DateFilterRange;
    appliedPreset: string;
    from: string | null;
    to: string | null;
  } {
    const rangePreset = (options?.range || "all").toLowerCase();
    const now = new Date();

    if (rangePreset === "today") {
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      return {
        filter: { from: startOfDay.toISOString(), to: endOfDay.toISOString() },
        appliedPreset: "today",
        from: startOfDay.toISOString(),
        to: endOfDay.toISOString(),
      };
    }

    if (rangePreset === "7d") {
      const fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        filter: { from: fromDate.toISOString(), to: now.toISOString() },
        appliedPreset: "7d",
        from: fromDate.toISOString(),
        to: now.toISOString(),
      };
    }

    if (rangePreset === "30d") {
      const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        filter: { from: fromDate.toISOString(), to: now.toISOString() },
        appliedPreset: "30d",
        from: fromDate.toISOString(),
        to: now.toISOString(),
      };
    }

    if (rangePreset === "custom" && options?.from) {
      const fromDate = new Date(options.from);
      const toDate = options.to ? new Date(options.to) : now;
      if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
        return {
          filter: { from: fromDate.toISOString(), to: toDate.toISOString() },
          appliedPreset: "custom",
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
        };
      }
    }

    return {
      filter: undefined,
      appliedPreset: "all",
      from: null,
      to: null,
    };
  }

  /**
   * Retrieves comprehensive campaign analytics:
   * - Overview metrics & rates (zero-denominator safe)
   * - Activity timeline over time (using actual event timestamps)
   * - Step-level analytics
   */
  async getCampaignAnalytics(
    businessId: string,
    campaignId: string,
    options?: AnalyticsQueryOptions
  ): Promise<CampaignAnalyticsFullResult> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    if (!campaignId) {
      throw new Error("Campaign ID is required.");
    }

    // Verify campaign existence and tenant ownership
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const { filter, appliedPreset, from, to } = this.resolveDateRange(options);

    const [overview, timeline, steps] = await Promise.all([
      this.analyticsRepo.getCampaignOverview(businessId, campaignId, filter),
      this.analyticsRepo.getCampaignTimeline(businessId, campaignId, filter),
      this.analyticsRepo.getStepAnalytics(businessId, campaignId, filter),
    ]);

    if (!overview) {
      throw new Error("Could not compute campaign overview.");
    }

    return {
      overview,
      timeline,
      steps,
      dateRange: {
        appliedPreset,
        from,
        to,
      },
    };
  }

  /**
   * Retrieves paginated list of email messages sent by a campaign.
   */
  async getCampaignMessages(
    businessId: string,
    campaignId: string,
    options?: { page?: number; limit?: number; status?: string }
  ): Promise<PaginatedResult<ContactEmailHistoryItem>> {
    if (!businessId) throw new Error("Business ID is required.");
    if (!campaignId) throw new Error("Campaign ID is required.");

    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const page = Number(options?.page) || 1;
    const limit = Number(options?.limit) || 50;

    return this.analyticsRepo.getCampaignMessages(
      businessId,
      campaignId,
      page,
      limit,
      options?.status
    );
  }

  /**
   * Retrieves paginated contact email history across campaigns and steps.
   */
  async getContactEmailHistory(
    businessId: string,
    leadId: string,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResult<ContactEmailHistoryItem>> {
    if (!businessId) throw new Error("Business ID is required.");
    if (!leadId) throw new Error("Contact ID is required.");

    const page = Number(options?.page) || 1;
    const limit = Number(options?.limit) || 50;

    return this.analyticsRepo.getContactEmailHistory(businessId, leadId, page, limit);
  }

  /**
   * Retrieves full message details with event audit trail (zero secret exposure).
   */
  async getEmailMessageDetail(
    businessId: string,
    messageId: string
  ): Promise<EmailMessageDetail> {
    if (!businessId) throw new Error("Business ID is required.");
    if (!messageId) throw new Error("Message ID is required.");

    const detail = await this.analyticsRepo.getEmailMessageDetail(businessId, messageId);
    if (!detail) {
      throw new Error("Email message not found or access denied.");
    }

    return detail;
  }

  /**
   * Generates a CSV export of campaign email activity.
   */
  async exportCampaignCsv(
    businessId: string,
    campaignId: string
  ): Promise<{ filename: string; csv: string }> {
    if (!businessId) throw new Error("Business ID is required.");
    if (!campaignId) throw new Error("Campaign ID is required.");

    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const rows = await this.analyticsRepo.getCampaignExportData(businessId, campaignId);

    const headers = [
      "Contact",
      "Email",
      "Campaign",
      "Step",
      "Subject",
      "Status",
      "Sent At",
      "Delivered At",
      "Bounce Reason",
      "Complaint Reason",
      "Unsubscribed",
    ];

    const escapeCsv = (val: string | null | undefined): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const lines: string[] = [];
    lines.push(headers.join(","));

    for (const r of rows) {
      lines.push(
        [
          escapeCsv(r.contact_name),
          escapeCsv(r.email),
          escapeCsv(r.campaign_name),
          escapeCsv(r.step_name),
          escapeCsv(r.subject),
          escapeCsv(r.status),
          escapeCsv(r.sent_at),
          escapeCsv(r.delivered_at),
          escapeCsv(r.bounce_reason),
          escapeCsv(r.complaint_reason),
          escapeCsv(r.unsubscribed),
        ].join(",")
      );
    }

    const cleanName = campaign.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const filename = `campaign_${cleanName}_analytics_${Date.now()}.csv`;

    return {
      filename,
      csv: lines.join("\r\n"),
    };
  }

  /**
   * Retrieves tenant-wide analytics overview and campaign performance breakdown.
   */
  async getBusinessAnalytics(
    businessId: string,
    options?: AnalyticsQueryOptions
  ): Promise<{
    overview: {
      totalSent: number;
      totalDelivered: number;
      totalBounced: number;
      totalFailed: number;
      totalComplained: number;
      totalUnsubscribed: number;
      deliveryRate: number;
      bounceRate: number;
      complaintRate: number;
      unsubscribeRate: number;
    };
    campaigns: Array<{
      id: string;
      name: string;
      status: string;
      totalEnrolled: number;
      totalSent: number;
      totalDelivered: number;
      deliveryRate: number;
      bounceRate: number;
      createdAt: string;
    }>;
    dateRange: {
      appliedPreset: string;
      from: string | null;
      to: string | null;
    };
  }> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    const { filter, appliedPreset, from, to } = this.resolveDateRange(options);

    const [bizOverview, campList] = await Promise.all([
      this.analyticsRepo.getBusinessOverview(businessId, filter),
      this.campaignRepo.list({ businessId, status: "all", limit: 100 }),
    ]);

    const campaignOverviews = await Promise.all(
      campList.data.map(async (c) => {
        try {
          const ov = await this.analyticsRepo.getCampaignOverview(businessId, c.id, filter);
          return {
            id: c.id,
            name: c.name,
            status: (c.status || "DRAFT").toUpperCase(),
            totalEnrolled: ov?.total_enrolled ?? c.contact_count ?? 0,
            totalSent: ov?.total_sent ?? 0,
            totalDelivered: ov?.total_delivered ?? 0,
            deliveryRate: ov?.delivery_rate ?? 0,
            bounceRate: ov?.bounce_rate ?? 0,
            createdAt: c.created_at,
          };
        } catch {
          return {
            id: c.id,
            name: c.name,
            status: (c.status || "DRAFT").toUpperCase(),
            totalEnrolled: c.contact_count ?? 0,
            totalSent: 0,
            totalDelivered: 0,
            deliveryRate: 0,
            bounceRate: 0,
            createdAt: c.created_at,
          };
        }
      })
    );

    return {
      overview: {
        totalSent: bizOverview.total_sent,
        totalDelivered: bizOverview.total_delivered,
        totalBounced: bizOverview.total_bounced,
        totalFailed: bizOverview.total_failed,
        totalComplained: bizOverview.total_complained,
        totalUnsubscribed: bizOverview.total_unsubscribed,
        deliveryRate: bizOverview.delivery_rate,
        bounceRate: bizOverview.bounce_rate,
        complaintRate: bizOverview.complaint_rate,
        unsubscribeRate: bizOverview.unsubscribe_rate,
      },
      campaigns: campaignOverviews,
      dateRange: {
        appliedPreset,
        from,
        to,
      },
    };
  }
}

export const analyticsService = new AnalyticsService();

