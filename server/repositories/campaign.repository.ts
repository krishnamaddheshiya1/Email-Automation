import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BaseRepository } from "./base.repository";
import {
  Campaign,
  CampaignStep,
  CampaignLead,
  CampaignStatus,
  CampaignStepStatus,
  CampaignLeadStatus,
  DelayUnit,
  Lead,
} from "@/types/database";
import { query, isDbConfigured } from "../db/client";
import { LocalLeadStore } from "./lead.repository";
import { LocalEmailStore } from "./email-message.repository";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResult, QueryResultRow } from "pg";

export interface CampaignListParams {
  businessId: string;
  search?: string;
  status?: string;
  sortBy?: "created_at" | "updated_at" | "name" | "status";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface CampaignSummary extends Campaign {
  step_count: number;
  contact_count: number;
  sent_count?: number;
  delivered_count?: number;
  bounced_count?: number;
  bounce_rate?: number;
}

export interface CampaignListResult {
  data: CampaignSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CreateCampaignRepositoryInput = Omit<
  Campaign,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CreateStepRepositoryInput = Omit<
  CampaignStep,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

interface LocalCampaignStoreData {
  campaigns: Campaign[];
  steps: CampaignStep[];
  enrollments: CampaignLead[];
}

/**
 * Resilient local file-backed persistence store for campaigns, steps, and enrollments.
 */
export class LocalCampaignStore {
  private static filePath = path.resolve(process.cwd(), ".data/campaigns.json");
  private static memoryCache: LocalCampaignStoreData | null = null;
  private static lastMtime = 0;

  private static load(): LocalCampaignStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (this.memoryCache !== null && stats.mtimeMs === this.lastMtime) {
          return this.memoryCache;
        }
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.memoryCache = JSON.parse(raw);
        this.lastMtime = stats.mtimeMs;
        if (this.memoryCache) {
          this.memoryCache.campaigns = this.memoryCache.campaigns || [];
          this.memoryCache.steps = this.memoryCache.steps || [];
          this.memoryCache.enrollments = this.memoryCache.enrollments || [];
          return this.memoryCache;
        }
      }
    } catch {
      // Ignore read errors
    }
    this.memoryCache = { campaigns: [], steps: [], enrollments: [] };
    return this.memoryCache;
  }

  private static save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.memoryCache || { campaigns: [], steps: [], enrollments: [] }, null, 2),
        "utf-8"
      );
      if (fs.existsSync(this.filePath)) {
        this.lastMtime = fs.statSync(this.filePath).mtimeMs;
      }
    } catch (err) {
      console.warn("Could not save to local campaign store:", err);
    }
  }

  // --- Campaign Methods ---
  static findCampaignById(id: string): Campaign | null {
    const data = this.load();
    return data.campaigns.find((c) => c.id === id) || null;
  }

  static findCampaignByIdAndBusinessId(id: string, businessId: string): Campaign | null {
    const data = this.load();
    return data.campaigns.find((c) => c.id === id && c.business_id === businessId) || null;
  }

  static listCampaigns(params: CampaignListParams): CampaignListResult {
    const {
      businessId,
      search = "",
      status = "all",
      sortBy = "created_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    const store = this.load();
    const filtered = store.campaigns.filter((c) => {
      if (c.business_id !== businessId) return false;
      if (status && status !== "all" && c.status.toLowerCase() !== status.toLowerCase()) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesDesc = (c.description || "").toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const direction = sortOrder.toLowerCase() === "asc" ? 1 : -1;
      if (sortBy === "name") {
        return a.name.localeCompare(b.name) * direction;
      } else if (sortBy === "updated_at") {
        return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * direction;
      } else {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction;
      }
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const paged = filtered.slice(offset, offset + limit);

    const summaries: CampaignSummary[] = paged.map((c) => {
      const step_count = store.steps.filter((s) => s.campaign_id === c.id).length;
      const contact_count = store.enrollments.filter(
        (e) => e.campaign_id === c.id && String(e.status).toLowerCase() !== "removed"
      ).length;
      let sent_count = 0;
      let delivered_count = 0;
      let bounced_count = 0;
      try {
        const p = path.resolve(process.cwd(), ".data/email_messages.json");
        if (fs.existsSync(p)) {
          const emailStore = JSON.parse(fs.readFileSync(p, "utf-8")) || { messages: [] };
          const cMsgs = (emailStore.messages || []).filter((m: { campaign_id?: string; status?: string; sent_at?: string }) => m.campaign_id === c.id);
          sent_count = cMsgs.filter((m: { status?: string; sent_at?: string }) => ["sent", "delivered", "bounced", "complained"].includes(String(m.status).toLowerCase()) || m.sent_at).length;
          delivered_count = cMsgs.filter((m: { status?: string }) => String(m.status).toLowerCase() === "delivered").length;
          bounced_count = cMsgs.filter((m: { status?: string }) => String(m.status).toLowerCase() === "bounced").length;
        }
      } catch {
        // Fallback
      }
      const bounce_rate = sent_count > 0 ? Number(((bounced_count / sent_count) * 100).toFixed(2)) : 0;
      return {
        ...c,
        step_count,
        contact_count,
        sent_count,
        delivered_count,
        bounced_count,
        bounce_rate,
      };
    });

    return {
      data: summaries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  static createCampaign(input: CreateCampaignRepositoryInput): Campaign {
    const store = this.load();
    const now = new Date().toISOString();
    const campaignId = input.id || crypto.randomUUID();
    const campaign: Campaign = {
      id: campaignId,
      business_id: input.business_id,
      name: input.name,
      description: input.description || null,
      status: (input.status?.toUpperCase() as CampaignStatus) || "DRAFT",
      timezone: input.timezone || "UTC",
      sender_identity_id: input.sender_identity_id || null,
      settings: input.settings || {},
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    const existingIdx = store.campaigns.findIndex((c) => c.id === campaignId);
    if (existingIdx !== -1) {
      store.campaigns[existingIdx] = campaign;
    } else {
      store.campaigns.unshift(campaign);
    }
    this.save();
    return campaign;
  }

  static updateCampaign(
    id: string,
    businessId: string | undefined,
    patch: Partial<Campaign>
  ): Campaign | null {
    const store = this.load();
    const idx = store.campaigns.findIndex(
      (c) => c.id === id && (!businessId || c.business_id === businessId)
    );
    if (idx === -1) return null;

    const existing = store.campaigns[idx];
    const updated: Campaign = {
      ...existing,
      ...patch,
      id: existing.id,
      business_id: existing.business_id,
      status: (patch.status ? patch.status.toUpperCase() : existing.status) as CampaignStatus,
      sender_identity_id:
        patch.sender_identity_id !== undefined
          ? patch.sender_identity_id || null
          : existing.sender_identity_id || null,
      updated_at: new Date().toISOString(),
    };
    store.campaigns[idx] = updated;
    this.save();
    return updated;
  }

  static deleteCampaign(id: string, businessId?: string): boolean {
    const store = this.load();
    const idx = store.campaigns.findIndex(
      (c) => c.id === id && (!businessId || c.business_id === businessId)
    );
    if (idx === -1) return false;
    store.campaigns.splice(idx, 1);
    store.steps = store.steps.filter((s) => s.campaign_id !== id);
    store.enrollments = store.enrollments.filter((e) => e.campaign_id !== id);
    this.save();
    return true;
  }

  // --- Step Methods ---
  static findStepsByCampaignId(campaignId: string): CampaignStep[] {
    const store = this.load();
    return store.steps
      .filter((s) => s.campaign_id === campaignId)
      .sort((a, b) => a.step_number - b.step_number);
  }

  static findStepById(stepId: string): CampaignStep | null {
    const store = this.load();
    return store.steps.find((s) => s.id === stepId) || null;
  }

  static createStep(input: CreateStepRepositoryInput): CampaignStep {
    const store = this.load();
    const now = new Date().toISOString();
    const stepId = input.id || crypto.randomUUID();

    // Auto-calculate step_number if not provided or duplicate
    let stepNumber = input.step_number;
    const existingSteps = this.findStepsByCampaignId(input.campaign_id);
    if (!stepNumber || existingSteps.some((s) => s.step_number === stepNumber && s.id !== stepId)) {
      stepNumber = existingSteps.length > 0 ? Math.max(...existingSteps.map((s) => s.step_number)) + 1 : 1;
    }

    const step: CampaignStep = {
      id: stepId,
      campaign_id: input.campaign_id,
      step_number: stepNumber,
      name: input.name,
      delay_value: input.delay_value ?? 0,
      delay_unit: (input.delay_unit || "days") as DelayUnit,
      status: (input.status?.toUpperCase() as CampaignStepStatus) || "ACTIVE",
      template_id: input.template_id || null,
      settings: input.settings || {},
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    };
    const existingIdx = store.steps.findIndex((s) => s.id === stepId);
    if (existingIdx !== -1) {
      store.steps[existingIdx] = step;
    } else {
      store.steps.push(step);
    }
    this.save();
    return step;
  }

  static updateStep(
    stepId: string,
    campaignId: string,
    patch: Partial<CampaignStep>
  ): CampaignStep | null {
    const store = this.load();
    const idx = store.steps.findIndex(
      (s) => s.id === stepId && s.campaign_id === campaignId
    );
    if (idx === -1) return null;

    const existing = store.steps[idx];
    const updated: CampaignStep = {
      ...existing,
      ...patch,
      id: existing.id,
      campaign_id: existing.campaign_id,
      status: (patch.status ? patch.status.toUpperCase() : existing.status) as CampaignStepStatus,
      updated_at: new Date().toISOString(),
    };
    store.steps[idx] = updated;
    this.save();
    return updated;
  }

  static deleteStep(stepId: string, campaignId: string): boolean {
    const store = this.load();
    const idx = store.steps.findIndex(
      (s) => s.id === stepId && s.campaign_id === campaignId
    );
    if (idx === -1) return false;
    store.steps.splice(idx, 1);
    this.save();
    return true;
  }

  // --- Enrollment Methods ---
  static findEnrollments(
    campaignId: string,
    status?: string
  ): (CampaignLead & { lead?: Lead })[] {
    const store = this.load();
    const filtered = store.enrollments.filter((e) => {
      if (e.campaign_id !== campaignId) return false;
      if (status && status !== "all" && e.status.toUpperCase() !== status.toUpperCase()) {
        return false;
      }
      return true;
    });

    const emailStore = LocalEmailStore.load();
    const campSteps = store.steps.filter(
      (s) => s.campaign_id === campaignId && (s.status || "ACTIVE").toUpperCase() !== "ARCHIVED"
    );
    const totalSteps = campSteps.length;

    return filtered.map((item) => {
      let leadObj: Lead | undefined;
      try {
        const lead = LocalLeadStore.findById(item.lead_id);
        if (lead) {
          leadObj = lead;
        }
      } catch {
        // Fallback
      }

      const meta = (item.metadata || {}) as Record<string, string>;
      const email = leadObj?.email || item.email || meta.email || "";
      const firstName = leadObj?.first_name || meta.first_name || "";
      const lastName = leadObj?.last_name || meta.last_name || "";

      const msgs = emailStore.messages.filter(
        (m) => m.campaign_id === campaignId && m.lead_id === item.lead_id
      );
      const sentCount = msgs.filter(
        (m) =>
          ["sent", "delivered", "opened", "bounced", "complained"].includes((m.status || "").toLowerCase()) ||
          m.sent_at
      ).length;
      const deliveredCount = msgs.filter(
        (m) =>
          ["delivered", "opened"].includes((m.status || "").toLowerCase()) ||
          Boolean((m as unknown as Record<string, unknown>).delivered_at)
      ).length;
      const openedCount = msgs.filter(
        (m) =>
          (m.status || "").toLowerCase() === "opened" ||
          Boolean((m as unknown as Record<string, unknown>).opened_at) ||
          (typeof (m as unknown as Record<string, unknown>).open_count === "number" &&
            Number((m as unknown as Record<string, unknown>).open_count) > 0)
      ).length;
      const bouncedCount = msgs.filter(
        (m) =>
          (m.status || "").toLowerCase() === "bounced" ||
          Boolean((m as unknown as Record<string, unknown>).bounce_type)
      ).length;
      const isReplied = item.status.toUpperCase() === "REPLIED" || Boolean(meta.replied);
      const lastMsg = msgs[msgs.length - 1];
      const lastEmailStatus = lastMsg?.status?.toUpperCase() || null;
      const itemEvents = emailStore.events.filter(
        (ev) => ev.campaign_id === campaignId && ev.lead_id === item.lead_id
      );
      const lastEvent = itemEvents[itemEvents.length - 1];
      const lastEventType = lastEvent?.event_type?.toUpperCase() || lastEmailStatus || null;

      return {
        ...item,
        email: email || item.email || null,
        total_steps: totalSteps,
        emails_sent_count: sentCount,
        delivered_count: deliveredCount,
        opened_count: openedCount,
        bounced_count: bouncedCount,
        replied: isReplied,
        last_email_status: lastEmailStatus,
        last_event_type: lastEventType,
        lead: leadObj || ({
          id: item.lead_id,
          business_id: item.business_id,
          email: email,
          first_name: firstName,
          last_name: lastName,
          company_name: meta.company_name || "",
          job_title: meta.job_title || "",
          status: "new",
          source: "manual",
          lead_score: 0,
          created_at: item.created_at || item.enrolled_at,
          updated_at: item.updated_at || item.enrolled_at,
        } as Lead),
      };
    });
  }

  static findEnrollment(campaignId: string, leadId: string): CampaignLead | null {
    const store = this.load();
    return (
      store.enrollments.find(
        (e) => e.campaign_id === campaignId && e.lead_id === leadId
      ) || null
    );
  }

  static findEnrollmentById(id: string): CampaignLead | null {
    const store = this.load();
    return store.enrollments.find((e) => e.id === id) || null;
  }

  static enrollLeads(
    campaignId: string,
    businessId: string,
    leadIds: string[],
    options?: {
      firstStepId?: string | null;
      nextRunAt?: string | null;
      contacts?: Array<{ id: string; email: string; metadata?: Record<string, unknown> }>;
      isManualOverride?: boolean;
    }
  ): { enrolled: CampaignLead[]; skippedCount: number } {
    const store = this.load();
    const now = new Date().toISOString();
    const enrolled: CampaignLead[] = [];
    let skippedCount = 0;

    // Resolve step 1 if not passed in options
    let resolvedStepId = options?.firstStepId;
    let resolvedNextRun = options?.nextRunAt;
    if (resolvedStepId === undefined) {
      const campSteps = store.steps
        .filter((s) => s.campaign_id === campaignId && (s.status || "ACTIVE").toUpperCase() === "ACTIVE")
        .sort((a, b) => a.step_number - b.step_number);
      if (campSteps.length > 0) {
        resolvedStepId = campSteps[0].id;
        if (resolvedNextRun === undefined) {
          const delayVal = campSteps[0].delay_value ?? 0;
          if (delayVal <= 0) {
            resolvedNextRun = new Date(Date.now() - 1000).toISOString();
          } else {
            const ms = campSteps[0].delay_unit === "minutes"
              ? delayVal * 60 * 1000
              : campSteps[0].delay_unit === "hours"
              ? delayVal * 60 * 60 * 1000
              : delayVal * 24 * 60 * 60 * 1000;
            resolvedNextRun = new Date(Date.now() + ms).toISOString();
          }
        }
      }
    }

    for (const leadId of leadIds) {
      let leadEmail = options?.contacts?.find((c) => c.id === leadId)?.email;
      let leadMeta = options?.contacts?.find((c) => c.id === leadId)?.metadata;
      if (!leadEmail) {
        try {
          const l = LocalLeadStore.findById(leadId);
          if (l?.email) {
            leadEmail = l.email;
            leadMeta = {
              email: l.email,
              first_name: l.first_name || "",
              last_name: l.last_name || "",
              company_name: l.company_name || "",
            };
          }
        } catch {
          // Fallback
        }
      }

      const existing = this.findEnrollment(campaignId, leadId);
      if (existing) {
        if (existing.status.toUpperCase() === "REMOVED" || options?.isManualOverride) {
          existing.status = "ENROLLED";
          existing.enrolled_at = now;
          existing.updated_at = now;
          existing.current_step = 0;
          existing.started_at = null;
          existing.completed_at = null;
          existing.stopped_at = null;
          existing.retry_count = 0;
          existing.last_error = null;
          existing.is_manual_override = Boolean(options?.isManualOverride);
          if (leadEmail) existing.email = leadEmail;
          if (resolvedStepId) {
            existing.next_step_id = resolvedStepId;
            existing.current_step_id = resolvedStepId;
          }
          if (resolvedNextRun) existing.next_run_at = resolvedNextRun;
          if (leadMeta) existing.metadata = { ...(existing.metadata || {}), ...leadMeta };
          enrolled.push(existing);
        } else {
          // Idempotent update of unpopulated fields
          if (!existing.email && leadEmail) existing.email = leadEmail;
          if (!existing.next_step_id && resolvedStepId) {
            existing.next_step_id = resolvedStepId;
            existing.current_step_id = resolvedStepId;
          }
          if (!existing.next_run_at && resolvedNextRun) existing.next_run_at = resolvedNextRun;
          if (leadMeta) existing.metadata = { ...(existing.metadata || {}), ...leadMeta };
          skippedCount++;
        }
      } else {
        const item: CampaignLead = {
          id: crypto.randomUUID(),
          campaign_id: campaignId,
          lead_id: leadId,
          business_id: businessId,
          status: "ENROLLED",
          email: leadEmail || null,
          current_step: 0,
          current_step_id: resolvedStepId || null,
          next_step_id: resolvedStepId || null,
          next_run_at: resolvedNextRun || null,
          is_manual_override: Boolean(options?.isManualOverride),
          enrolled_at: now,
          metadata: leadMeta || (leadEmail ? { email: leadEmail } : {}),
          created_at: now,
          updated_at: now,
        };
        store.enrollments.push(item);
        enrolled.push(item);
      }
    }

    this.save();
    return { enrolled, skippedCount };
  }

  static initializeEnrollmentsForCampaign(
    campaignId: string,
    businessId: string,
    firstStepId: string,
    nextRunAtIso: string
  ): number {
    const store = this.load();
    let count = 0;
    const now = new Date().toISOString();

    for (const item of store.enrollments) {
      if (
        item.campaign_id === campaignId &&
        item.business_id === businessId &&
        item.status.toUpperCase() === "ENROLLED" &&
        !item.next_step_id &&
        (!item.current_step || item.current_step === 0)
      ) {
        item.next_step_id = firstStepId;
        item.current_step_id = firstStepId;
        item.next_run_at = nextRunAtIso;
        item.status = "ENROLLED";
        item.updated_at = now;
        count++;
      }
    }

    if (count > 0) this.save();
    return count;
  }

  static updateEnrollment(
    id: string,
    updates: Partial<CampaignLead>
  ): CampaignLead | null {
    const store = this.load();
    const idx = store.enrollments.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const updated: CampaignLead = {
      ...store.enrollments[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    store.enrollments[idx] = updated;
    this.save();
    return updated;
  }

  static claimDueEnrollments(
    limit: number,
    businessId?: string,
    campaignId?: string
  ): Array<{ enrollment: CampaignLead; campaign: Campaign }> {
    const store = this.load();
    const now = new Date();
    const eligible: Array<{ enrollment: CampaignLead; campaign: Campaign }> = [];

    for (const enr of store.enrollments) {
      if (businessId && enr.business_id !== businessId) continue;
      if (campaignId && enr.campaign_id !== campaignId) continue;
      if (!["ENROLLED", "RUNNING", "WAITING"].includes(enr.status.toUpperCase())) continue;
      if (!enr.next_run_at || new Date(enr.next_run_at) > now) continue;

      const camp = store.campaigns.find((c) => c.id === enr.campaign_id);
      if (!camp || camp.status.toUpperCase() !== "ACTIVE") continue;

      // Atomic lock
      enr.status = "RUNNING";
      enr.started_at = enr.started_at || now.toISOString();
      enr.updated_at = now.toISOString();
      eligible.push({ enrollment: { ...enr }, campaign: { ...camp } });
      if (eligible.length >= limit) break;
    }

    if (eligible.length > 0) this.save();
    return eligible;
  }

  static removeEnrollment(campaignId: string, leadId: string): boolean {
    const store = this.load();
    const item = store.enrollments.find(
      (e) => e.campaign_id === campaignId && e.lead_id === leadId
    );
    if (!item) return false;
    item.status = "REMOVED";
    item.updated_at = new Date().toISOString();
    this.save();
    return true;
  }

  static stopEnrollmentsOnReply(
    businessId: string,
    leadId: string,
    stoppedAt?: string,
    campaignId?: string | null
  ): number {
    const store = this.load();
    let count = 0;
    const nowIso = stoppedAt || new Date().toISOString();

    for (const item of store.enrollments) {
      if (
        (!businessId || item.business_id === businessId) &&
        item.lead_id === leadId &&
        ["ENROLLED", "RUNNING", "WAITING"].includes(item.status.toUpperCase()) &&
        (!campaignId || item.campaign_id === campaignId)
      ) {
        item.status = "REPLIED";
        item.next_run_at = null;
        item.stopped_at = item.stopped_at || nowIso;
        item.updated_at = new Date().toISOString();
        item.last_error = "STOPPED_ON_REPLY";
        count++;
      }
    }

    if (count > 0) this.save();
    return count;
  }

  static findEnrollmentsByLead(
    leadId: string,
    businessId?: string
  ): CampaignLead[] {
    const store = this.load();
    return store.enrollments.filter(
      (e) => e.lead_id === leadId && (!businessId || e.business_id === businessId)
    );
  }

  static countRepliedLeads(businessId?: string): number {
    const store = this.load();
    return store.enrollments.filter(
      (e) => (!businessId || e.business_id === businessId) && String(e.status).toUpperCase() === "REPLIED"
    ).length;
  }
}

export class CampaignRepository
  implements BaseRepository<Campaign, string, CreateCampaignRepositoryInput>
{
  private queryFn: <
    R extends QueryResultRow = QueryResultRow,
    I extends unknown[] = unknown[]
  >(
    text: string,
    params?: I
  ) => Promise<QueryResult<R>>;

  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  // --- Campaign Methods ---

  async findById(id: string): Promise<Campaign | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Campaign>(
          "SELECT * FROM campaigns WHERE id = $1;",
          [id]
        );
        if (res.rows[0]) return this.normalizeCampaign(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaigns")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!error && data) return this.normalizeCampaign(data);
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findCampaignById(id);
  }

  async findByIdAndBusinessId(id: string, businessId: string): Promise<Campaign | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Campaign>(
          "SELECT * FROM campaigns WHERE id = $1 AND business_id = $2;",
          [id, businessId]
        );
        if (res.rows[0]) return this.normalizeCampaign(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaigns")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) return this.normalizeCampaign(data);
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findCampaignByIdAndBusinessId(id, businessId);
  }

  async findByBusinessId(businessId: string): Promise<Campaign[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Campaign>(
          "SELECT * FROM campaigns WHERE business_id = $1 ORDER BY created_at DESC;",
          [businessId]
        );
        return res.rows.map((r) => this.normalizeCampaign(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaigns")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (!error && data) return data.map((r) => this.normalizeCampaign(r));
    } catch {
      // Fallback
    }

    return LocalCampaignStore.listCampaigns({ businessId, status: "all", limit: 1000 }).data;
  }

  async findAll(): Promise<Campaign[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Campaign>(
          "SELECT * FROM campaigns ORDER BY created_at DESC;"
        );
        return res.rows.map((r) => this.normalizeCampaign(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) return data.map((r) => this.normalizeCampaign(r));
    } catch {
      // Fallback
    }

    return LocalCampaignStore.listCampaigns({ businessId: "", status: "all", limit: 1000 }).data;
  }

  async list(params: CampaignListParams): Promise<CampaignListResult> {
    const {
      businessId,
      search = "",
      status = "all",
      sortBy = "created_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    if (this.useDatabase()) {
      try {
        const conditions: string[] = ["c.business_id = $1"];
        const queryParams: unknown[] = [businessId];
        let pIdx = 2;

        if (status && status !== "all") {
          conditions.push(`LOWER(c.status) = LOWER($${pIdx++})`);
          queryParams.push(status);
        }

        if (search.trim()) {
          conditions.push(`(c.name ILIKE $${pIdx} OR c.description ILIKE $${pIdx})`);
          queryParams.push(`%${search.trim()}%`);
          pIdx++;
        }

        const whereClause = conditions.join(" AND ");
        const sortColumn =
          sortBy === "name"
            ? "c.name"
            : sortBy === "updated_at"
            ? "c.updated_at"
            : "c.created_at";
        const orderDir = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

        const countRes = await this.queryFn<{ count: string }>(
          `SELECT COUNT(*) as count FROM campaigns c WHERE ${whereClause};`,
          queryParams
        );
        const total = parseInt(countRes.rows[0]?.count || "0", 10);

        const offset = (page - 1) * limit;
        queryParams.push(limit, offset);

        const sql = `
          SELECT c.*,
            (SELECT COUNT(*) FROM campaign_steps cs WHERE cs.campaign_id = c.id) as step_count,
            (SELECT COUNT(DISTINCT cl.id) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id WHERE cl.campaign_id = c.id AND LOWER(cl.status) != 'removed' AND l.email IS NOT NULL AND TRIM(l.email) != '') as contact_count,
            (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) IN ('sent', 'delivered', 'bounced', 'complained', 'opened') OR em.sent_at IS NOT NULL)) as sent_count,
            (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) IN ('delivered', 'opened') OR em.delivered_at IS NOT NULL)) as delivered_count,
            (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND (LOWER(em.status) = 'opened' OR em.opened_at IS NOT NULL OR em.open_count > 0)) as opened_count,
            (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND LOWER(em.status) = 'bounced') as bounced_count
          FROM campaigns c
          WHERE ${whereClause}
          ORDER BY ${sortColumn} ${orderDir}
          LIMIT $${pIdx++} OFFSET $${pIdx};
        `;

        const dataRes = await this.queryFn<Campaign & { step_count: string; contact_count: string; sent_count: string; delivered_count: string; opened_count: string; bounced_count: string }>(
          sql,
          queryParams
        );

        const summaries: CampaignSummary[] = dataRes.rows.map((r) => {
          const sent = parseInt(r.sent_count || "0", 10);
          const delivered = parseInt(r.delivered_count || "0", 10);
          const opened = parseInt(r.opened_count || "0", 10);
          const bounced = parseInt(r.bounced_count || "0", 10);
          const bounce_rate = sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0;
          return {
            ...this.normalizeCampaign(r),
            step_count: parseInt(r.step_count || "0", 10),
            contact_count: parseInt(r.contact_count || "0", 10),
            sent_count: sent,
            delivered_count: delivered,
            opened_count: opened,
            bounced_count: bounced,
            bounce_rate,
          };
        });

        return {
          data: summaries,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error(`[DB ERROR] Table: campaigns, Operation: SELECT (list), Code: ${dbErr?.code}, Message: ${dbErr?.message}`);
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let req = admin.from("campaigns").select("*, campaign_steps(count)", { count: "exact" }).eq("business_id", businessId);
      if (status && status !== "all") {
        req = req.ilike("status", status);
      }
      if (search.trim()) {
        req = req.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
      }
      const ascending = sortOrder.toLowerCase() === "asc";
      const sortColumn = sortBy === "name" ? "name" : sortBy === "updated_at" ? "updated_at" : "created_at";
      req = req.order(sortColumn, { ascending });
      const offset = (page - 1) * limit;
      req = req.range(offset, offset + limit - 1);

      const { data, count, error } = await req;
      if (!error && data) {
        const summaries: CampaignSummary[] = await Promise.all(
          data.map(async (c) => {
            const stepCount = (c.campaign_steps as unknown as Array<{ count: number }>)?.[0]?.count ?? 0;
            let contactCount = 0;
            try {
              const { count: clCount } = await admin.from("campaign_leads").select("*", { count: "exact", head: true }).eq("campaign_id", c.id);
              contactCount = clCount || 0;
            } catch {}

            let sentCount = 0;
            let deliveredCount = 0;
            let openedCount = 0;
            let bouncedCount = 0;
            try {
              const { data: msgs } = await admin.from("email_messages").select("status, sent_at, open_count, opened_at, delivered_at, metadata").eq("campaign_id", c.id);
              if (msgs) {
                for (const m of msgs) {
                  const s = String(m.status || "").toLowerCase();
                  const meta = (m.metadata as Record<string, unknown>) || {};
                  const isOpened = s === "opened" || meta.is_opened === true || m.opened_at != null || (m.open_count || 0) > 0;
                  const isDelivered = s === "delivered" || meta.delivered_at != null || isOpened;
                  const isBounced = s === "bounced" || meta.bounced_at != null;
                  const isSent = s === "sent" || isDelivered || isOpened || isBounced || m.sent_at != null;
                  if (isSent) sentCount++;
                  if (isDelivered) deliveredCount++;
                  if (isOpened) openedCount++;
                  if (isBounced) bouncedCount++;
                }
              }
            } catch {}

            const bounce_rate = sentCount > 0 ? Number(((bouncedCount / sentCount) * 100).toFixed(2)) : 0;
            return {
              ...this.normalizeCampaign(c),
              step_count: stepCount,
              contact_count: contactCount,
              sent_count: sentCount,
              delivered_count: deliveredCount,
              opened_count: openedCount,
              bounced_count: bouncedCount,
              bounce_rate,
            };
          })
        );
        return {
          data: summaries,
          total: count || 0,
          page,
          limit,
          totalPages: Math.ceil((count || 0) / limit) || 1,
        };
      }
      if (error) {
        console.error(`[DB ERROR] Table: campaigns, Operation: SELECT (PostgREST list), Code: ${error.code}, Message: ${error.message}`);
        throw new Error(`Failed to list campaigns from database: ${error.message}`);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    return LocalCampaignStore.listCampaigns(params);
  }

  async create(data: CreateCampaignRepositoryInput): Promise<Campaign> {
    const campaignId = data.id || crypto.randomUUID();
    const statusVal = (data.status || "draft").toLowerCase();
    const mergedSettings = {
      ...(data.settings || {}),
      sender_identity_id: data.sender_identity_id || null,
    };

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Campaign>(
          `INSERT INTO campaigns (id, business_id, name, description, status, timezone, settings, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
           RETURNING *;`,
          [
            campaignId,
            data.business_id,
            data.name,
            data.description || null,
            statusVal,
            data.timezone || "UTC",
            JSON.stringify(mergedSettings),
          ]
        );
        return this.normalizeCampaign(res.rows[0]);
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error(`[DB ERROR] Table: campaigns, Operation: INSERT (SQL), Code: ${dbErr?.code}, Message: ${dbErr?.message}, Record: ${campaignId}`);
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from("campaigns")
        .insert({
          id: campaignId,
          business_id: data.business_id,
          name: data.name,
          description: data.description || null,
          status: statusVal,
          timezone: data.timezone || "UTC",
          settings: mergedSettings,
        })
        .select()
        .single();

      if (!error && inserted) {
        return this.normalizeCampaign(inserted);
      }
      if (error) {
        console.error(`[DB ERROR] Table: campaigns, Operation: INSERT (PostgREST), Code: ${error.code}, Message: ${error.message}, Record: ${campaignId}`);
        throw new Error(`Failed to create campaign in Supabase: ${error.message}`);
      }
    } catch (err) {
      console.error(`[DB ERROR] Table: campaigns, Operation: INSERT, Record: ${campaignId}, Error:`, err);
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    if (!isDbConfigured() && process.env.NODE_ENV !== "production") {
      return LocalCampaignStore.createCampaign(data);
    }
    throw new Error("Failed to insert campaign into authoritative database.");
  }

  async update(
    id: string,
    data: Partial<Campaign>,
    businessId?: string
  ): Promise<Campaign>;
  async update(
    id: string,
    businessId: string,
    data: Partial<Campaign>
  ): Promise<Campaign>;
  async update(
    id: string,
    arg2: Partial<Campaign> | string,
    arg3?: Partial<Campaign> | string
  ): Promise<Campaign> {
    const businessId =
      typeof arg2 === "string" ? arg2 : typeof arg3 === "string" ? arg3 : undefined;
    const data =
      typeof arg2 === "object" ? arg2 : typeof arg3 === "object" ? (arg3 as Partial<Campaign>) : {};

    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.name !== undefined) {
          fields.push(`name = $${idx++}`);
          values.push(data.name);
        }
        if (data.description !== undefined) {
          fields.push(`description = $${idx++}`);
          values.push(data.description);
        }
        if (data.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(data.status.toLowerCase());
        }
        if (data.timezone !== undefined) {
          fields.push(`timezone = $${idx++}`);
          values.push(data.timezone);
        }
        if (data.sender_identity_id !== undefined) {
          fields.push(`sender_identity_id = $${idx++}`);
          values.push(data.sender_identity_id || null);
        }
        if (data.settings !== undefined) {
          fields.push(`settings = $${idx++}::jsonb`);
          values.push(JSON.stringify(data.settings));
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        let sql = `UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${idx++}`;
        if (businessId) {
          values.push(businessId);
          sql += ` AND business_id = $${idx++}`;
        }
        sql += ` RETURNING *;`;

        const res = await this.queryFn<Campaign>(sql, values);
        if (res.rows[0]) {
          const updated = this.normalizeCampaign(res.rows[0]);
          LocalCampaignStore.updateCampaign(id, businessId, data);
          return updated;
        }
        throw new Error("Campaign not found or access denied.");
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.name !== undefined) patch.name = data.name;
      if (data.description !== undefined) patch.description = data.description;
      if (data.status !== undefined) patch.status = data.status.toLowerCase();
      if (data.timezone !== undefined) patch.timezone = data.timezone;
      if (data.sender_identity_id !== undefined) patch.sender_identity_id = data.sender_identity_id || null;
      if (data.settings !== undefined) patch.settings = data.settings;

      let q = admin.from("campaigns").update(patch).eq("id", id);
      if (businessId) q = q.eq("business_id", businessId);

      const { data: updated, error } = await q.select().single();
      if (!error && updated) {
        const norm = this.normalizeCampaign(updated);
        LocalCampaignStore.updateCampaign(id, businessId, data);
        return norm;
      }
    } catch {
      // Fallback
    }

    const localUpdated = LocalCampaignStore.updateCampaign(id, businessId, data);
    if (!localUpdated) throw new Error("Campaign not found or access denied.");
    return localUpdated;
  }

  async duplicate(
    id: string,
    businessId: string,
    newName?: string
  ): Promise<{ campaign: Campaign; steps: CampaignStep[] }> {
    const orig = await this.findByIdAndBusinessId(id, businessId);
    if (!orig) throw new Error("Campaign not found or access denied.");

    const copyName = newName?.trim() || `${orig.name} Copy`;
    const newCampaign = await this.create({
      business_id: businessId,
      name: copyName,
      description: orig.description,
      status: "DRAFT",
      timezone: orig.timezone,
      sender_identity_id: orig.sender_identity_id,
      settings: { ...orig.settings },
    });

    // Copy steps
    const origSteps = await this.findStepsByCampaignId(id);
    const newSteps: CampaignStep[] = [];
    for (const step of origSteps) {
      const copiedStep = await this.createStep({
        campaign_id: newCampaign.id,
        step_number: step.step_number,
        name: step.name,
        delay_value: step.delay_value,
        delay_unit: step.delay_unit,
        status: step.status,
        template_id: step.template_id,
        settings: { ...step.settings },
      });
      newSteps.push(copiedStep);
    }

    return { campaign: newCampaign, steps: newSteps };
  }

  async archive(id: string, businessId: string): Promise<Campaign> {
    return this.update(id, { status: "ARCHIVED" }, businessId);
  }

  async delete(id: string, businessId?: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        await this.queryFn("DELETE FROM email_messages WHERE campaign_id = $1;", [id]);
        await this.queryFn("DELETE FROM campaign_steps WHERE campaign_id = $1;", [id]);
        try {
          await this.queryFn("DELETE FROM campaign_leads WHERE campaign_id = $1;", [id]);
        } catch {}
        const queryText = businessId
          ? "DELETE FROM campaigns WHERE id = $1 AND business_id = $2;"
          : "DELETE FROM campaigns WHERE id = $1;";
        const params = businessId ? [id, businessId] : [id];
        const res = await this.queryFn(queryText, params);
        LocalCampaignStore.deleteCampaign(id, businessId);
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("email_messages").delete().eq("campaign_id", id);
      await admin.from("campaign_steps").delete().eq("campaign_id", id);
      try {
        await admin.from("campaign_leads").delete().eq("campaign_id", id);
      } catch {}
      let q = admin.from("campaigns").delete().eq("id", id);
      if (businessId) q = q.eq("business_id", businessId);
      const { error } = await q;
      if (!error) {
        LocalCampaignStore.deleteCampaign(id, businessId);
        return true;
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.deleteCampaign(id, businessId);
  }

  // --- Campaign Step Methods ---

  async findStepsByCampaignId(campaignId: string): Promise<CampaignStep[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignStep>(
          "SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_number ASC;",
          [campaignId]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r) => this.normalizeStep(r));
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_steps")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("step_number", { ascending: true });
      if (!error && data && data.length > 0) {
        return data.map((r) => this.normalizeStep(r));
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findStepsByCampaignId(campaignId);
  }

  async findStepById(stepId: string): Promise<CampaignStep | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignStep>(
          "SELECT * FROM campaign_steps WHERE id = $1;",
          [stepId]
        );
        if (res.rows[0]) return this.normalizeStep(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_steps")
        .select("*")
        .eq("id", stepId)
        .maybeSingle();
      if (!error && data) return this.normalizeStep(data);
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findStepById(stepId);
  }

  async createStep(input: CreateStepRepositoryInput): Promise<CampaignStep> {
    const stepId = input.id || crypto.randomUUID();
    let stepNumber = input.step_number;

    if (!stepNumber) {
      const existing = await this.findStepsByCampaignId(input.campaign_id);
      stepNumber = existing.length > 0 ? Math.max(...existing.map((s) => s.step_number)) + 1 : 1;
    }

    let statusVal = (input.status || "active").toLowerCase();
    if (statusVal !== "active" && statusVal !== "paused" && statusVal !== "disabled") {
      statusVal = "active";
    }
    const delayUnitVal = (input.delay_unit || "days").toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignStep>(
          `INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id, settings, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
           RETURNING *;`,
          [
            stepId,
            input.campaign_id,
            stepNumber,
            input.name,
            input.delay_value ?? 0,
            delayUnitVal,
            statusVal,
            input.template_id || null,
            JSON.stringify(input.settings || {}),
          ]
        );
        const step = this.normalizeStep(res.rows[0]);
        LocalCampaignStore.createStep({ ...input, id: step.id, step_number: stepNumber, status: step.status });
        return step;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from("campaign_steps")
        .insert({
          id: stepId,
          campaign_id: input.campaign_id,
          step_number: stepNumber,
          name: input.name,
          delay_value: input.delay_value ?? 0,
          delay_unit: delayUnitVal,
          status: statusVal,
          template_id: input.template_id || null,
          settings: input.settings || {},
        })
        .select()
        .single();
      if (!error && inserted) {
        const step = this.normalizeStep(inserted);
        LocalCampaignStore.createStep({ ...input, id: step.id, step_number: stepNumber, status: step.status });
        return step;
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.createStep({ ...input, id: stepId, step_number: stepNumber });
  }

  async updateStep(
    stepId: string,
    campaignId: string,
    patch: Partial<CampaignStep>
  ): Promise<CampaignStep> {
    let statusVal: string | undefined;
    if (patch.status !== undefined) {
      statusVal = patch.status.toLowerCase();
      if (statusVal !== "active" && statusVal !== "paused" && statusVal !== "disabled") {
        statusVal = "active";
      }
    }

    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (patch.name !== undefined) {
          fields.push(`name = $${idx++}`);
          values.push(patch.name);
        }
        if (patch.step_number !== undefined) {
          fields.push(`step_number = $${idx++}`);
          values.push(patch.step_number);
        }
        if (patch.delay_value !== undefined) {
          fields.push(`delay_value = $${idx++}`);
          values.push(patch.delay_value);
        }
        if (patch.delay_unit !== undefined) {
          fields.push(`delay_unit = $${idx++}`);
          values.push(patch.delay_unit.toLowerCase());
        }
        if (statusVal !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(statusVal);
        }
        if (patch.template_id !== undefined) {
          fields.push(`template_id = $${idx++}`);
          values.push(patch.template_id);
        }
        if (patch.settings !== undefined) {
          fields.push(`settings = $${idx++}::jsonb`);
          values.push(JSON.stringify(patch.settings));
        }

        fields.push(`updated_at = NOW()`);
        values.push(stepId, campaignId);

        const sql = `UPDATE campaign_steps SET ${fields.join(", ")} WHERE id = $${idx++} AND campaign_id = $${idx} RETURNING *;`;
        const res = await this.queryFn<CampaignStep>(sql, values);
        if (res.rows[0]) {
          const updated = this.normalizeStep(res.rows[0]);
          LocalCampaignStore.updateStep(stepId, campaignId, patch);
          return updated;
        }
        throw new Error("Step not found or access denied.");
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.name !== undefined) updateData.name = patch.name;
      if (patch.step_number !== undefined) updateData.step_number = patch.step_number;
      if (patch.delay_value !== undefined) updateData.delay_value = patch.delay_value;
      if (patch.delay_unit !== undefined) updateData.delay_unit = patch.delay_unit.toLowerCase();
      if (statusVal !== undefined) updateData.status = statusVal;
      if (patch.template_id !== undefined) updateData.template_id = patch.template_id;
      if (patch.settings !== undefined) updateData.settings = patch.settings;

      const { data: updated, error } = await admin
        .from("campaign_steps")
        .update(updateData)
        .eq("id", stepId)
        .eq("campaign_id", campaignId)
        .select()
        .single();
      if (!error && updated) {
        const norm = this.normalizeStep(updated);
        LocalCampaignStore.updateStep(stepId, campaignId, patch);
        return norm;
      }
    } catch {
      // Fallback
    }

    const localUpdated = LocalCampaignStore.updateStep(stepId, campaignId, patch);
    if (!localUpdated) throw new Error("Step not found or access denied.");
    return localUpdated;
  }

  async deleteStep(stepId: string, campaignId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn(
          "DELETE FROM campaign_steps WHERE id = $1 AND campaign_id = $2;",
          [stepId, campaignId]
        );
        LocalCampaignStore.deleteStep(stepId, campaignId);
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("campaign_steps")
        .delete()
        .eq("id", stepId)
        .eq("campaign_id", campaignId);
      if (!error) {
        LocalCampaignStore.deleteStep(stepId, campaignId);
        return true;
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.deleteStep(stepId, campaignId);
  }

  // --- Campaign Enrollment Methods (`campaign_leads`) ---

  async findEnrollments(
    campaignId: string,
    businessId: string,
    params: { status?: string; search?: string; page?: number; limit?: number } = {}
  ): Promise<{ data: (CampaignLead & { lead?: Lead })[]; total: number }> {
    const { status = "all", search = "", page = 1, limit = 50 } = params;

    if (this.useDatabase()) {
      try {
        const conditions: string[] = ["cl.campaign_id = $1", "cl.business_id = $2"];
        const queryParams: unknown[] = [campaignId, businessId];
        let pIdx = 3;

        if (status && status !== "all") {
          conditions.push(`LOWER(cl.status) = LOWER($${pIdx++})`);
          queryParams.push(status);
        }

        if (search.trim()) {
          conditions.push(
            `(l.first_name ILIKE $${pIdx} OR l.last_name ILIKE $${pIdx} OR l.email ILIKE $${pIdx} OR l.company_name ILIKE $${pIdx})`
          );
          queryParams.push(`%${search.trim()}%`);
          pIdx++;
        }

        const whereClause = conditions.join(" AND ");

        const countRes = await this.queryFn<{ count: string }>(
          `SELECT COUNT(*) as count FROM campaign_leads cl LEFT JOIN leads l ON l.id = cl.lead_id WHERE ${whereClause};`,
          queryParams
        );
        const total = parseInt(countRes.rows[0]?.count || "0", 10);

        const offset = (page - 1) * limit;
        queryParams.push(limit, offset);

        const sql = `
          SELECT cl.*,
                 l.first_name, l.last_name, l.email as lead_email, l.company_name, l.job_title, l.status as lead_status,
                 (SELECT COUNT(*) FROM campaign_steps cs WHERE cs.campaign_id = cl.campaign_id AND UPPER(cs.status) != 'ARCHIVED') as total_steps,
                 (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = cl.campaign_id AND em.lead_id = cl.lead_id AND (LOWER(em.status) IN ('sent', 'delivered', 'opened', 'bounced', 'complained') OR em.sent_at IS NOT NULL)) as emails_sent_count,
                 (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = cl.campaign_id AND em.lead_id = cl.lead_id AND (LOWER(em.status) IN ('delivered', 'opened') OR em.delivered_at IS NOT NULL)) as delivered_count,
                 (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = cl.campaign_id AND em.lead_id = cl.lead_id AND (LOWER(em.status) = 'opened' OR em.opened_at IS NOT NULL OR em.open_count > 0)) as opened_count,
                 (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = cl.campaign_id AND em.lead_id = cl.lead_id AND LOWER(em.status) = 'bounced') as bounced_count,
                 (SELECT event_type FROM email_events ev WHERE ev.campaign_id = cl.campaign_id AND ev.lead_id = cl.lead_id ORDER BY ev.event_timestamp DESC LIMIT 1) as last_event_type,
                 (SELECT status FROM email_messages em WHERE em.campaign_id = cl.campaign_id AND em.lead_id = cl.lead_id ORDER BY em.created_at DESC LIMIT 1) as last_email_status
          FROM campaign_leads cl
          LEFT JOIN leads l ON l.id = cl.lead_id
          WHERE ${whereClause}
          ORDER BY cl.enrolled_at DESC
          LIMIT $${pIdx++} OFFSET $${pIdx};
        `;

        const dataRes = await this.queryFn<QueryResultRow>(sql, queryParams);
        const rows = dataRes.rows.map((r: QueryResultRow) => {
          const meta = (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {}) as Record<string, unknown>;
          const email = (r.lead_email || r.email || meta.email || "") as string;
          const firstName = (r.first_name || meta.first_name || "") as string;
          const lastName = (r.last_name || meta.last_name || "") as string;
          const companyName = (r.company_name || meta.company_name || "") as string;

          const emailsSentCount = Number(r.emails_sent_count || 0);
          const totalSteps = Number(r.total_steps || 0);
          let currentStatus = String(r.status) as CampaignLeadStatus;
          let currentLastError = r.last_error ? String(r.last_error) : null;
          let currentCompletedAt = r.completed_at ? String(r.completed_at) : null;
          let currentStoppedAt = r.stopped_at ? String(r.stopped_at) : null;

          // Auto-heal: If an enrollment is marked FAILED or RUNNING, but all sequence steps have been sent
          // and completed (emails_sent_count >= total_steps > 0), its true state is COMPLETED.
          if (
            (currentStatus === "FAILED" || currentStatus === "RUNNING") &&
            totalSteps > 0 &&
            emailsSentCount >= totalSteps
          ) {
            currentStatus = "COMPLETED" as CampaignLeadStatus;
            currentLastError = null;
            currentStoppedAt = null;
            if (!currentCompletedAt) currentCompletedAt = new Date().toISOString();
            if (this.useDatabase()) {
              this.queryFn(
                `UPDATE campaign_leads SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), last_error = NULL, stopped_at = NULL, updated_at = NOW() WHERE id = $1;`,
                [r.id]
              ).catch(() => {});
            }
          }

          return {
            id: String(r.id),
            campaign_id: String(r.campaign_id),
            lead_id: String(r.lead_id),
            business_id: String(r.business_id),
            status: currentStatus,
            email: email || null,
            enrolled_at: String(r.enrolled_at),
            current_step: r.current_step !== undefined && r.current_step !== null ? Number(r.current_step) : null,
            current_step_id: r.current_step_id ? String(r.current_step_id) : (r.next_step_id ? String(r.next_step_id) : null),
            next_step_id: r.next_step_id ? String(r.next_step_id) : null,
            next_run_at: r.next_run_at ? String(r.next_run_at) : null,
            started_at: r.started_at ? String(r.started_at) : null,
            completed_at: currentCompletedAt,
            stopped_at: currentStoppedAt,
            last_error: currentLastError,
            retry_count: Number(r.retry_count || 0),
            metadata: meta,
            total_steps: totalSteps,
            emails_sent_count: emailsSentCount,
            delivered_count: Number(r.delivered_count || 0),
            opened_count: Number(r.opened_count || 0),
            bounced_count: Number(r.bounced_count || 0),
            replied: String(currentStatus).toUpperCase() === "REPLIED" || Boolean(meta.replied),
            last_email_status: r.last_email_status ? String(r.last_email_status).toUpperCase() : null,
            last_event_type: r.last_event_type
              ? String(r.last_event_type).toUpperCase()
              : (r.last_email_status ? String(r.last_email_status).toUpperCase() : null),
            lead: {
              id: String(r.lead_id),
              business_id: String(r.business_id),
              first_name: firstName,
              last_name: lastName,
              email: email,
              company_name: companyName,
              job_title: r.job_title ? String(r.job_title) : "",
              status: (r.lead_status ? String(r.lead_status) : "new") as Lead["status"],
            } as Lead,
          };
        });

        return { data: rows, total };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    const localItems = LocalCampaignStore.findEnrollments(campaignId, status);

    // Hydrate contacts from Supabase if not found locally
    const missingLeadIds = localItems
      .filter((i) => !i.lead?.email || !i.email)
      .map((i) => i.lead_id);

    if (missingLeadIds.length > 0) {
      try {
        const admin = createAdminClient();
        const { data: supaLeads } = await admin
          .from("leads")
          .select("*")
          .in("id", missingLeadIds);
        if (supaLeads && supaLeads.length > 0) {
          const leadMap = new Map(supaLeads.map((l) => [l.id, l as Lead]));
          for (const item of localItems) {
            const found = leadMap.get(item.lead_id);
            if (found) {
              item.lead = found;
              item.email = found.email;
              LocalCampaignStore.updateEnrollment(item.id, {
                email: found.email,
                metadata: {
                  ...(item.metadata || {}),
                  email: found.email,
                  first_name: found.first_name || "",
                  last_name: found.last_name || "",
                  company_name: found.company_name || "",
                },
              });
            }
          }
        }
      } catch {
        // Fallback
      }
    }

    // Auto-heal any active campaign enrollments that lack step 1 or next_run_at
    const activeCamp = LocalCampaignStore.findCampaignById(campaignId);
    if (activeCamp && (activeCamp.status || "").toUpperCase() === "ACTIVE") {
      const campSteps = LocalCampaignStore.findStepsByCampaignId(campaignId);
      const firstActiveStep = campSteps
        .filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE")
        .sort((a, b) => a.step_number - b.step_number)[0];
      if (firstActiveStep) {
        for (const item of localItems) {
          if (
            ["ENROLLED", "RUNNING"].includes(item.status.toUpperCase()) &&
            (!item.next_step_id || !item.next_run_at)
          ) {
            const initialNextRunAt =
              (firstActiveStep.delay_value ?? 0) <= 0
                ? new Date(Date.now() - 1000).toISOString()
                : new Date(
                    Date.now() + (firstActiveStep.delay_value * 24 * 60 * 60 * 1000)
                  ).toISOString();
            item.next_step_id = firstActiveStep.id;
            item.current_step_id = firstActiveStep.id;
            item.next_run_at = initialNextRunAt;
            LocalCampaignStore.updateEnrollment(item.id, {
              next_step_id: firstActiveStep.id,
              current_step_id: firstActiveStep.id,
              next_run_at: initialNextRunAt,
            });
          }
        }
      }
    }

    return { data: localItems, total: localItems.length };
  }

  async findEnrollment(campaignId: string, leadId: string): Promise<CampaignLead | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignLead>(
          "SELECT * FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2;",
          [campaignId, leadId]
        );
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_leads")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (!error && data) return data as CampaignLead;
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findEnrollment(campaignId, leadId);
  }

  async enrollLeads(
    campaignId: string,
    businessId: string,
    leadIds: string[],
    options?: {
      firstStepId?: string | null;
      nextRunAt?: string | null;
      contacts?: Array<{ id: string; email: string; metadata?: Record<string, unknown> }>;
      isManualOverride?: boolean;
    }
  ): Promise<{ enrolled: CampaignLead[]; skippedCount: number }> {
    if (this.useDatabase()) {
      try {
        const enrolled: CampaignLead[] = [];
        let skippedCount = 0;

        // Resolve step 1 if not passed in options
        let resolvedStepId = options?.firstStepId;
        let resolvedNextRun = options?.nextRunAt;
        if (resolvedStepId === undefined) {
          try {
            const stepRes = await this.queryFn<{ id: string; delay_value: number; delay_unit: string }>(
              "SELECT id, delay_value, delay_unit FROM campaign_steps WHERE campaign_id = $1 AND UPPER(status) = 'ACTIVE' ORDER BY step_number ASC LIMIT 1;",
              [campaignId]
            );
            if (stepRes.rows[0]) {
              resolvedStepId = stepRes.rows[0].id;
              if (resolvedNextRun === undefined) {
                const delayVal = Number(stepRes.rows[0].delay_value || 0);
                if (delayVal <= 0) {
                  resolvedNextRun = new Date(Date.now() - 1000).toISOString();
                } else {
                  const unit = String(stepRes.rows[0].delay_unit || "days").toLowerCase();
                  const ms = unit === "minutes"
                    ? delayVal * 60 * 1000
                    : unit === "hours"
                    ? delayVal * 60 * 60 * 1000
                    : delayVal * 24 * 60 * 60 * 1000;
                  resolvedNextRun = new Date(Date.now() + ms).toISOString();
                }
              }
            }
          } catch {
            // Step resolution fallback
          }
        }

        const isOverride = Boolean(options?.isManualOverride);

        for (const leadId of leadIds) {
          let leadEmail = options?.contacts?.find((c) => c.id === leadId)?.email;
          let leadMeta = options?.contacts?.find((c) => c.id === leadId)?.metadata;
          if (!leadEmail) {
            try {
              const leadRes = await this.queryFn<{ email: string; first_name: string; last_name: string; company_name: string }>(
                "SELECT email, first_name, last_name, company_name FROM leads WHERE id = $1 AND business_id = $2;",
                [leadId, businessId]
              );
              if (leadRes.rows[0]) {
                leadEmail = leadRes.rows[0].email;
                leadMeta = {
                  email: leadRes.rows[0].email,
                  first_name: leadRes.rows[0].first_name || "",
                  last_name: leadRes.rows[0].last_name || "",
                  company_name: leadRes.rows[0].company_name || "",
                };
              }
            } catch {
              // Lead resolution fallback
            }
          }

          const metaToStore = JSON.stringify(leadMeta || (leadEmail ? { email: leadEmail } : {}));

          let res: QueryResult<CampaignLead> | null = null;
          try {
            res = await this.queryFn<CampaignLead>(
              `INSERT INTO campaign_leads (
                campaign_id, lead_id, business_id, status, current_step, current_step_id, next_step_id, next_run_at, is_manual_override, email, enrolled_at, metadata, created_at, updated_at
              ) VALUES ($1, $2, $3, 'ENROLLED', 0, $4, $4, $5, $8, $6, NOW(), $7::jsonb, NOW(), NOW())
              ON CONFLICT (campaign_id, lead_id)
              DO UPDATE SET
                status = 'ENROLLED',
                current_step = CASE WHEN $8 = true THEN 0 ELSE campaign_leads.current_step END,
                current_step_id = CASE WHEN $8 = true THEN EXCLUDED.current_step_id ELSE COALESCE(campaign_leads.current_step_id, EXCLUDED.current_step_id) END,
                next_step_id = CASE WHEN $8 = true THEN EXCLUDED.next_step_id ELSE COALESCE(campaign_leads.next_step_id, EXCLUDED.next_step_id) END,
                next_run_at = CASE WHEN $8 = true THEN EXCLUDED.next_run_at ELSE COALESCE(campaign_leads.next_run_at, EXCLUDED.next_run_at) END,
                is_manual_override = EXCLUDED.is_manual_override,
                completed_at = CASE WHEN $8 = true THEN NULL ELSE campaign_leads.completed_at END,
                stopped_at = CASE WHEN $8 = true THEN NULL ELSE campaign_leads.stopped_at END,
                last_error = CASE WHEN $8 = true THEN NULL ELSE campaign_leads.last_error END,
                email = COALESCE(EXCLUDED.email, campaign_leads.email),
                metadata = campaign_leads.metadata || EXCLUDED.metadata,
                enrolled_at = NOW(),
                updated_at = NOW()
              RETURNING *;`,
              [campaignId, leadId, businessId, resolvedStepId || null, resolvedNextRun || null, leadEmail || null, metaToStore, isOverride]
            );
          } catch {
            // Fallback if column email or current_step_id does not exist
            res = await this.queryFn<CampaignLead>(
              `INSERT INTO campaign_leads (
                campaign_id, lead_id, business_id, status, current_step, next_step_id, next_run_at, enrolled_at, metadata, created_at, updated_at
              ) VALUES ($1, $2, $3, 'ENROLLED', 0, $4, $5, NOW(), $6::jsonb, NOW(), NOW())
              ON CONFLICT (campaign_id, lead_id)
              DO UPDATE SET
                status = 'ENROLLED',
                next_step_id = COALESCE(campaign_leads.next_step_id, EXCLUDED.next_step_id),
                next_run_at = COALESCE(campaign_leads.next_run_at, EXCLUDED.next_run_at),
                metadata = campaign_leads.metadata || EXCLUDED.metadata,
                enrolled_at = NOW(),
                updated_at = NOW()
              RETURNING *;`,
              [campaignId, leadId, businessId, resolvedStepId || null, resolvedNextRun || null, metaToStore]
            );
          }

          if (res?.rows[0]) {
            enrolled.push(res.rows[0]);
          } else {
            skippedCount++;
          }
        }

        return { enrolled, skippedCount };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const records = leadIds.map((lid) => {
        const contactInfo = options?.contacts?.find((c) => c.id === lid);
        return {
          campaign_id: campaignId,
          lead_id: lid,
          business_id: businessId,
          status: "ENROLLED",
          current_step: 0,
          current_step_id: options?.firstStepId || null,
          next_step_id: options?.firstStepId || null,
          next_run_at: options?.nextRunAt || null,
          is_manual_override: Boolean(options?.isManualOverride),
          email: contactInfo?.email || null,
          metadata: contactInfo?.metadata || {},
        };
      });
      const { data, error } = await admin
        .from("campaign_leads")
        .upsert(records, { onConflict: "campaign_id,lead_id" })
        .select();
      if (!error && data) {
        LocalCampaignStore.enrollLeads(campaignId, businessId, leadIds, options);
        return { enrolled: data as CampaignLead[], skippedCount: 0 };
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.enrollLeads(campaignId, businessId, leadIds, options);
  }

  async removeLead(
    campaignId: string,
    leadId: string,
    businessId: string
  ): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn(
          `UPDATE campaign_leads SET status = 'REMOVED', updated_at = NOW()
           WHERE campaign_id = $1 AND lead_id = $2 AND business_id = $3;`,
          [campaignId, leadId, businessId]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("campaign_leads")
        .update({ status: "REMOVED", updated_at: new Date().toISOString() })
        .eq("campaign_id", campaignId)
        .eq("lead_id", leadId)
        .eq("business_id", businessId);
      if (!error) return true;
    } catch {
      // Fallback
    }

    return LocalCampaignStore.removeEnrollment(campaignId, leadId);
  }

  async stopEnrollmentsOnReply(
    businessId: string,
    leadId: string,
    stoppedAt?: string,
    campaignId?: string | null
  ): Promise<number> {
    const nowIso = stoppedAt || new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const queryParams: unknown[] = [businessId, leadId, nowIso];
        let sql = `
          UPDATE campaign_leads
          SET status = 'REPLIED',
              next_run_at = NULL,
              stopped_at = COALESCE(stopped_at, $3),
              updated_at = NOW(),
              last_error = 'STOPPED_ON_REPLY'
          WHERE business_id = $1
            AND lead_id = $2
            AND UPPER(status) IN ('ENROLLED', 'RUNNING', 'WAITING')
        `;
        if (campaignId) {
          queryParams.push(campaignId);
          sql += ` AND campaign_id = $4`;
        }
        sql += ` RETURNING id;`;

        const res = await this.queryFn(sql, queryParams);
        LocalCampaignStore.stopEnrollmentsOnReply(businessId, leadId, stoppedAt, campaignId);
        return res.rowCount || 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let q = admin
        .from("campaign_leads")
        .update({
          status: "REPLIED",
          next_run_at: null,
          stopped_at: nowIso,
          updated_at: new Date().toISOString(),
          last_error: "STOPPED_ON_REPLY",
        })
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .in("status", ["ENROLLED", "RUNNING", "WAITING", "enrolled", "running", "waiting"]);

      if (campaignId) {
        q = q.eq("campaign_id", campaignId);
      }

      const { data, error } = await q.select("id");
      if (!error && data) {
        LocalCampaignStore.stopEnrollmentsOnReply(businessId, leadId, stoppedAt, campaignId);
        return data.length;
      }
    } catch {
      // Fallback
    }

    return LocalCampaignStore.stopEnrollmentsOnReply(businessId, leadId, stoppedAt, campaignId);
  }

  async findEnrollmentsByLead(
    leadId: string,
    businessId?: string
  ): Promise<CampaignLead[]> {
    if (this.useDatabase()) {
      try {
        const whereClauses = ["lead_id = $1"];
        const params: unknown[] = [leadId];
        if (businessId) {
          whereClauses.push("business_id = $2");
          params.push(businessId);
        }
        const res = await this.queryFn<CampaignLead>(
          `SELECT * FROM campaign_leads WHERE ${whereClauses.join(" AND ")};`,
          params
        );
        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let q = admin.from("campaign_leads").select("*").eq("lead_id", leadId);
      if (businessId) q = q.eq("business_id", businessId);
      const { data, error } = await q;
      if (!error && data) return data as CampaignLead[];
    } catch {
      // Fallback
    }

    return LocalCampaignStore.findEnrollmentsByLead(leadId, businessId);
  }

  async countEnrolledLeads(campaignId: string): Promise<number> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<{ count: string }>(
          `SELECT COUNT(DISTINCT cl.id) as count
           FROM campaign_leads cl
           JOIN leads l ON l.id = cl.lead_id
           WHERE cl.campaign_id = $1
             AND LOWER(cl.status) != 'removed'
             AND l.email IS NOT NULL
             AND TRIM(l.email) != '';`,
          [campaignId]
        );
        return parseInt(res.rows[0]?.count || "0", 10);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_leads")
        .select("id, status, leads!inner(id, email)")
        .eq("campaign_id", campaignId)
        .neq("status", "removed")
        .neq("status", "REMOVED");
      if (!error && data) {
        const valid = data.filter((row) => {
          const leadItem = Array.isArray(row.leads) ? row.leads[0] : row.leads;
          const email = leadItem?.email;
          return Boolean(email && String(email).trim().length > 0);
        });
        return valid.length;
      }
    } catch {
      // Fallback
    }

    const enrollments = LocalCampaignStore.findEnrollments(campaignId);
    return enrollments.filter((e) => {
      const isNotRemoved = (e.status || "").toLowerCase() !== "removed";
      const hasEmail = Boolean(e.lead?.email || e.email);
      return isNotRemoved && hasEmail;
    }).length;
  }

  async countRepliedLeads(businessId: string): Promise<number> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<{ count: string }>(
          `SELECT COUNT(*) as count FROM campaign_leads WHERE business_id = $1 AND UPPER(status) = 'REPLIED'`,
          [businessId]
        );
        return Number(res.rows[0]?.count || 0);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { count } = await admin
        .from("campaign_leads")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "REPLIED");
      if (typeof count === "number") return count;
    } catch {}

    return LocalCampaignStore.countRepliedLeads(businessId);
  }

  // --- Normalization Helpers ---

  private normalizeCampaign(row: unknown): Campaign {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      business_id: String(r.business_id),
      name: String(r.name),
      description: r.description ? String(r.description) : null,
      status: (String(r.status || "DRAFT").toUpperCase() as CampaignStatus),
      timezone: String(r.timezone || "UTC"),
      sender_identity_id: r.sender_identity_id ? String(r.sender_identity_id) : null,
      settings: typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings || {},
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private normalizeStep(row: unknown): CampaignStep {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      campaign_id: String(r.campaign_id),
      step_number: Number(r.step_number),
      name: String(r.name),
      delay_value: Number(r.delay_value || 0),
      delay_unit: (r.delay_unit || "days") as DelayUnit,
      status: (String(r.status || "ACTIVE").toUpperCase() as CampaignStepStatus),
      template_id: r.template_id ? String(r.template_id) : null,
      settings: typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings || {},
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }
}
