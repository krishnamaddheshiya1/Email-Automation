import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BaseRepository } from "./base.repository";
import { Lead } from "@/types/database";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeLeadStatus } from "@/lib/validations/contact";
import type { QueryResult, QueryResultRow } from "pg";

export interface ContactListParams {
  businessId: string;
  search?: string;
  status?: string;
  source?: string;
  sortBy?: "created_at" | "name" | "lead_score";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface ContactListResult {
  data: Lead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CreateLeadInput = Omit<Lead, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Resilient local file-backed persistence store used when remote database
 * is not yet initialized or DATABASE_URL is not configured.
 */
export class LocalLeadStore {
  private static filePath = path.resolve(process.cwd(), ".data/leads.json");
  private static memoryCache: Lead[] | null = null;
  private static lastMtime = 0;

  private static load(): Lead[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (this.memoryCache !== null && stats.mtimeMs === this.lastMtime) {
          return this.memoryCache;
        }
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.memoryCache = JSON.parse(raw);
        this.lastMtime = stats.mtimeMs;
        return this.memoryCache || [];
      }
    } catch {
      // Ignore read errors and start with empty store
    }
    this.memoryCache = [];
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
        JSON.stringify(this.memoryCache || [], null, 2),
        "utf-8"
      );
      if (fs.existsSync(this.filePath)) {
        this.lastMtime = fs.statSync(this.filePath).mtimeMs;
      }
    } catch (err) {
      console.warn("Could not save to local leads store:", err);
    }
  }

  static findById(id: string): Lead | null {
    const list = this.load();
    return list.find((c) => c.id === id) || null;
  }

  static findByIdAndBusinessId(id: string, businessId: string): Lead | null {
    const list = this.load();
    return list.find((c) => c.id === id && c.business_id === businessId) || null;
  }

  static findByBusinessId(businessId: string): Lead[] {
    const list = this.load();
    return list
      .filter((c) => c.business_id === businessId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  static findByEmail(businessId: string, email: string): Lead | null {
    const list = this.load();
    const normalized = email.trim().toLowerCase();
    return (
      list.find(
        (c) => c.business_id === businessId && c.email.trim().toLowerCase() === normalized
      ) || null
    );
  }

  static findAll(): Lead[] {
    const list = this.load();
    return [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  static create(data: CreateLeadInput): Lead {
    const list = this.load();
    const now = new Date().toISOString();
    const newLead: Lead = {
      id: data.id || crypto.randomUUID(),
      business_id: data.business_id,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      email: data.email.trim().toLowerCase(),
      phone: data.phone || null,
      company_name: data.company_name || null,
      job_title: data.job_title || null,
      industry: data.industry || null,
      website: data.website || null,
      source: data.source || "manual",
      status: data.status || "NEW",
      lead_score: data.lead_score ?? 0,
      owner_user_id: data.owner_user_id || null,
      metadata: data.metadata || {},
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    };

    list.unshift(newLead);
    this.save();
    return newLead;
  }

  static update(id: string, data: Partial<Lead>): Lead {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) {
      throw new Error(`Contact ${id} not found`);
    }

    const updated = {
      ...list[idx],
      ...data,
      email: data.email ? data.email.trim().toLowerCase() : list[idx].email,
      updated_at: new Date().toISOString(),
    };
    list[idx] = updated;
    this.save();
    return updated;
  }

  static updateScoped(id: string, businessId: string, data: Partial<Lead>): Lead | null {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === id && c.business_id === businessId);
    if (idx === -1) return null;

    const updated = {
      ...list[idx],
      ...data,
      email: data.email ? data.email.trim().toLowerCase() : list[idx].email,
      updated_at: new Date().toISOString(),
    };
    list[idx] = updated;
    this.save();
    return updated;
  }

  static archive(id: string, businessId: string): boolean {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === id && c.business_id === businessId);
    if (idx === -1) return false;

    list[idx].status = "ARCHIVED";
    list[idx].updated_at = new Date().toISOString();
    this.save();
    return true;
  }

  static bulkUpdateStatus(businessId: string, ids: string[], status: string): number {
    const list = this.load();
    const idSet = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();

    for (const lead of list) {
      if (lead.business_id === businessId && idSet.has(lead.id)) {
        lead.status = status as Lead["status"];
        lead.updated_at = now;
        count++;
      }
    }

    if (count > 0) this.save();
    return count;
  }

  static bulkArchive(businessId: string, ids: string[]): number {
    const list = this.load();
    const idSet = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();

    for (const lead of list) {
      if (lead.business_id === businessId && idSet.has(lead.id)) {
        lead.status = "ARCHIVED";
        lead.updated_at = now;
        count++;
      }
    }

    if (count > 0) this.save();
    return count;
  }

  static list(params: ContactListParams): ContactListResult {
    const {
      businessId,
      search = "",
      status = "",
      source = "",
      sortBy = "created_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    const list = this.load().filter((c) => c.business_id === businessId);

    const filtered = list.filter((c) => {
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const fullName = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
        const matchesName = fullName.includes(s);
        const matchesEmail = c.email.toLowerCase().includes(s);
        const matchesCompany = (c.company_name || "").toLowerCase().includes(s);
        if (!matchesName && !matchesEmail && !matchesCompany) return false;
      }

      if (status.trim() && c.status.toLowerCase() !== status.trim().toLowerCase()) {
        return false;
      }

      if (source.trim() && (c.source || "").toLowerCase() !== source.trim().toLowerCase()) {
        return false;
      }

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      const direction = sortOrder.toLowerCase() === "asc" ? 1 : -1;
      if (sortBy === "name") {
        const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        return nameA.localeCompare(nameB) * direction;
      } else if (sortBy === "lead_score") {
        return (a.lead_score - b.lead_score) * direction;
      } else {
        return (
          (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction
        );
      }
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  static exportAll(params: Omit<ContactListParams, "page" | "limit">): Lead[] {
    const res = this.list({ ...params, page: 1, limit: 1000000 });
    return res.data;
  }

  static delete(id: string): boolean {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.save();
    return true;
  }

  static deletePermanent(id: string, businessId: string): boolean {
    const list = this.load();
    const idx = list.findIndex((c) => c.id === id && c.business_id === businessId);
    if (idx !== -1) {
      list.splice(idx, 1);
      this.save();
    }

    // Clean up local campaign enrollments
    try {
      const pEnroll = path.resolve(process.cwd(), ".data/campaign_leads.json");
      if (fs.existsSync(pEnroll)) {
        const raw = JSON.parse(fs.readFileSync(pEnroll, "utf-8"));
        if (Array.isArray(raw)) {
          const filtered = raw.filter((e) => !(e.lead_id === id && (!e.business_id || e.business_id === businessId)));
          fs.writeFileSync(pEnroll, JSON.stringify(filtered, null, 2), "utf-8");
        }
      }
    } catch {}

    // Clean up local conversations
    try {
      const pConv = path.resolve(process.cwd(), ".data/conversations.json");
      if (fs.existsSync(pConv)) {
        const raw = JSON.parse(fs.readFileSync(pConv, "utf-8"));
        if (Array.isArray(raw)) {
          const filtered = raw.filter((c) => !(c.lead_id === id && c.business_id === businessId));
          fs.writeFileSync(pConv, JSON.stringify(filtered, null, 2), "utf-8");
        }
      }
    } catch {}

    // Clean up local email messages
    try {
      const pMsg = path.resolve(process.cwd(), ".data/email_messages.json");
      if (fs.existsSync(pMsg)) {
        const raw = JSON.parse(fs.readFileSync(pMsg, "utf-8"));
        if (raw && Array.isArray(raw.messages)) {
          raw.messages = raw.messages.filter((m: { lead_id: string; business_id: string }) => !(m.lead_id === id && m.business_id === businessId));
          fs.writeFileSync(pMsg, JSON.stringify(raw, null, 2), "utf-8");
        }
      }
    } catch {}

    return true;
  }

  static deletePermanentBulk(ids: string[], businessId: string): number {
    if (ids.length === 0) return 0;
    const idSet = new Set(ids);
    const list = this.load();
    let deletedCount = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (idSet.has(list[i].id) && list[i].business_id === businessId) {
        list.splice(i, 1);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      this.save();
    }

    try {
      const pEnroll = path.resolve(process.cwd(), ".data/campaign_leads.json");
      if (fs.existsSync(pEnroll)) {
        const raw = JSON.parse(fs.readFileSync(pEnroll, "utf-8"));
        if (Array.isArray(raw)) {
          const filtered = raw.filter((e) => !(idSet.has(e.lead_id) && (!e.business_id || e.business_id === businessId)));
          fs.writeFileSync(pEnroll, JSON.stringify(filtered, null, 2), "utf-8");
        }
      }
    } catch {}

    try {
      const pConv = path.resolve(process.cwd(), ".data/conversations.json");
      if (fs.existsSync(pConv)) {
        const raw = JSON.parse(fs.readFileSync(pConv, "utf-8"));
        if (Array.isArray(raw)) {
          const filtered = raw.filter((c) => !(idSet.has(c.lead_id) && c.business_id === businessId));
          fs.writeFileSync(pConv, JSON.stringify(filtered, null, 2), "utf-8");
        }
      }
    } catch {}

    try {
      const pMsg = path.resolve(process.cwd(), ".data/email_messages.json");
      if (fs.existsSync(pMsg)) {
        const raw = JSON.parse(fs.readFileSync(pMsg, "utf-8"));
        if (raw && Array.isArray(raw.messages)) {
          raw.messages = raw.messages.filter((m: { lead_id: string; business_id: string }) => !(idSet.has(m.lead_id) && m.business_id === businessId));
          fs.writeFileSync(pMsg, JSON.stringify(raw, null, 2), "utf-8");
        }
      }
    } catch {}

    return deletedCount;
  }
}

export class LeadRepository implements BaseRepository<Lead, string, CreateLeadInput> {
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

  async findById(id: string): Promise<Lead | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>("SELECT * FROM leads WHERE id = $1;", [id]);
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // Try Supabase PostgREST
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.from("leads").select("*").eq("id", id).maybeSingle();
      if (!error && data) return data as Lead;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.findById(id);
  }

  async findByIdAndBusinessId(id: string, businessId: string): Promise<Lead | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>(
          "SELECT * FROM leads WHERE id = $1 AND business_id = $2;",
          [id, businessId]
        );
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) return data as Lead;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.findByIdAndBusinessId(id, businessId);
  }

  async findByBusinessId(businessId: string): Promise<Lead[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>(
          "SELECT * FROM leads WHERE business_id = $1 ORDER BY created_at DESC;",
          [businessId]
        );
        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (!error && data) return data as Lead[];
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.findByBusinessId(businessId);
  }

  async findByEmail(businessId: string, email: string): Promise<Lead | null> {
    const normalized = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>(
          "SELECT * FROM leads WHERE business_id = $1 AND LOWER(email) = LOWER($2);",
          [businessId, normalized]
        );
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .eq("business_id", businessId)
        .ilike("email", normalized)
        .maybeSingle();
      if (!error && data) return data as Lead;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.findByEmail(businessId, normalized);
  }

  async findByEmailGlobal(email: string): Promise<Lead | null> {
    const normalized = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>(
          "SELECT * FROM leads WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1;",
          [normalized]
        );
        return res.rows[0] || null;
      } catch (err: any) {
        console.error("Database error in LeadRepository.findByEmailGlobal:", err);
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .ilike("email", normalized)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) return data as Lead;
    } catch {}

    return LocalLeadStore.findAll().find((l) => l.email.toLowerCase() === normalized) || null;
  }

  async findByEmails(businessId: string, emails: string[]): Promise<Lead[]> {
    if (emails.length === 0) return [];
    const normalized = Array.from(new Set(emails.map((e) => e.trim().toLowerCase())));

    if (this.useDatabase()) {
      try {
        const placeholders = normalized.map((_, i) => `$${i + 2}`).join(", ");
        const res = await this.queryFn<Lead>(
          `SELECT * FROM leads WHERE business_id = $1 AND LOWER(email) IN (${placeholders});`,
          [businessId, ...normalized]
        );
        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .eq("business_id", businessId)
        .in("email", normalized);
      if (!error && data) return data as Lead[];
    } catch {
      // Fallback to local store
    }

    const localList = LocalLeadStore.findByBusinessId(businessId);
    return localList.filter((l) => normalized.includes(l.email.trim().toLowerCase()));
  }

  async findAll(): Promise<Lead[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<Lead>(
          "SELECT * FROM leads ORDER BY created_at DESC;"
        );
        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) return data as Lead[];
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.findAll();
  }

  async create(data: CreateLeadInput): Promise<Lead> {
    const normalizedEmail = data.email.trim().toLowerCase();
    const isValidUuid = (val?: string | null) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
    const ownerUserId = isValidUuid(data.owner_user_id) ? data.owner_user_id : null;
    const normStatus = normalizeLeadStatus(data.status);
    const leadId = data.id || crypto.randomUUID();
    const now = new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO leads (
            id, business_id, first_name, last_name, email, phone, company_name,
            job_title, industry, website, source, status, lead_score,
            owner_user_id, metadata, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (business_id, email)
          DO UPDATE SET
            first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
            last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
            phone = COALESCE(EXCLUDED.phone, leads.phone),
            company_name = COALESCE(EXCLUDED.company_name, leads.company_name),
            job_title = COALESCE(EXCLUDED.job_title, leads.job_title),
            industry = COALESCE(EXCLUDED.industry, leads.industry),
            website = COALESCE(EXCLUDED.website, leads.website),
            status = CASE WHEN leads.status IS NULL OR leads.status = 'NEW' THEN EXCLUDED.status ELSE leads.status END,
            metadata = leads.metadata || EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING *;
        `;
        const res = await this.queryFn<Lead>(sql, [
          leadId,
          data.business_id,
          data.first_name || null,
          data.last_name || null,
          normalizedEmail,
          data.phone || null,
          data.company_name || null,
          data.job_title || null,
          data.industry || null,
          data.website || null,
          data.source || "manual",
          normStatus,
          data.lead_score ?? 0,
          ownerUserId,
          JSON.stringify(data.metadata || {}),
          data.created_at || now,
          data.updated_at || now,
        ]);
        return res.rows[0];
      } catch (err: any) {
        console.error("Database error in LeadRepository.create:", {
          operation: "INSERT/UPSERT",
          table: "leads",
          code: err?.code,
          message: err?.message,
          recordId: leadId,
          email: normalizedEmail,
        });
        if (this.useDatabase()) {
          throw err;
        }
      }
    }

    try {
      const admin = createAdminClient();
      const payload = {
        id: leadId,
        business_id: data.business_id,
        first_name: data.first_name || null,
        last_name: data.last_name || null,
        email: normalizedEmail,
        phone: data.phone || null,
        company_name: data.company_name || null,
        job_title: data.job_title || null,
        industry: data.industry || null,
        website: data.website || null,
        source: data.source || "manual",
        status: normStatus,
        lead_score: data.lead_score ?? 0,
        owner_user_id: ownerUserId,
        metadata: data.metadata || {},
      };
      const { data: inserted, error } = await admin
        .from("leads")
        .upsert(payload, { onConflict: "business_id,email" })
        .select()
        .single();

      if (!error && inserted) {
        return inserted as Lead;
      }
      if (error) {
        console.error("PostgREST error in LeadRepository.create:", error);
        if (this.useDatabase()) throw error;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalLeadStore.create({
      ...data,
      status: normalizeLeadStatus(data.status),
    });
  }

  async bulkCreate(businessId: string, inputs: CreateLeadInput[]): Promise<Lead[]> {
    if (inputs.length === 0) return [];

    const isValidUuid = (val?: string | null) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
    const now = new Date().toISOString();
    const prepared = inputs.map((data) => ({
      id: data.id || crypto.randomUUID(),
      business_id: businessId,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      email: data.email.trim().toLowerCase(),
      phone: data.phone || null,
      company_name: data.company_name || null,
      job_title: data.job_title || null,
      industry: data.industry || null,
      website: data.website || null,
      source: data.source || "csv_import",
      status: normalizeLeadStatus(data.status),
      lead_score: data.lead_score ?? 0,
      owner_user_id: isValidUuid(data.owner_user_id) ? data.owner_user_id : null,
      metadata: data.metadata || {},
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    }));

    if (this.useDatabase()) {
      try {
        const valuePlaceholders: string[] = [];
        const flatValues: unknown[] = [];
        let pIdx = 1;

        for (const item of prepared) {
          valuePlaceholders.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
          );
          flatValues.push(
            item.id,
            item.business_id,
            item.first_name,
            item.last_name,
            item.email,
            item.phone,
            item.company_name,
            item.job_title,
            item.industry,
            item.website,
            item.source,
            item.status,
            item.lead_score,
            item.owner_user_id,
            JSON.stringify(item.metadata),
            item.created_at,
            item.updated_at
          );
        }

        const sql = `INSERT INTO leads (
          id, business_id, first_name, last_name, email, phone, company_name,
          job_title, industry, website, source, status, lead_score, owner_user_id, metadata, created_at, updated_at
        ) VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (business_id, email)
        DO UPDATE SET
          first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
          last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
          phone = COALESCE(EXCLUDED.phone, leads.phone),
          company_name = COALESCE(EXCLUDED.company_name, leads.company_name),
          job_title = COALESCE(EXCLUDED.job_title, leads.job_title),
          industry = COALESCE(EXCLUDED.industry, leads.industry),
          website = COALESCE(EXCLUDED.website, leads.website),
          status = CASE WHEN leads.status IS NULL OR leads.status = 'NEW' THEN EXCLUDED.status ELSE leads.status END,
          metadata = leads.metadata || EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING *;`;

        const res = await this.queryFn<Lead>(sql, flatValues);
        return res.rows;
      } catch (err: any) {
        console.error("Database error in LeadRepository.bulkCreate:", {
          operation: "BULK_INSERT/UPSERT",
          table: "leads",
          code: err?.code,
          message: err?.message,
          count: prepared.length,
        });
        if (this.useDatabase()) {
          throw err;
        }
      }
    }

    try {
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from("leads")
        .upsert(prepared, { onConflict: "business_id,email" })
        .select();

      if (!error && inserted && inserted.length > 0) {
        return inserted as Lead[];
      }
      if (error) {
        console.error("PostgREST error in LeadRepository.bulkCreate:", error);
        if (this.useDatabase()) throw error;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return prepared.map((item) => LocalLeadStore.create(item));
  }

  async update(id: string, data: Partial<Lead>): Promise<Lead> {
    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.first_name !== undefined) {
          fields.push(`first_name = $${idx++}`);
          values.push(data.first_name);
        }
        if (data.last_name !== undefined) {
          fields.push(`last_name = $${idx++}`);
          values.push(data.last_name);
        }
        if (data.email !== undefined) {
          fields.push(`email = $${idx++}`);
          values.push(data.email.trim().toLowerCase());
        }
        if (data.phone !== undefined) {
          fields.push(`phone = $${idx++}`);
          values.push(data.phone);
        }
        if (data.company_name !== undefined) {
          fields.push(`company_name = $${idx++}`);
          values.push(data.company_name);
        }
        if (data.job_title !== undefined) {
          fields.push(`job_title = $${idx++}`);
          values.push(data.job_title);
        }
        if (data.industry !== undefined) {
          fields.push(`industry = $${idx++}`);
          values.push(data.industry);
        }
        if (data.website !== undefined) {
          fields.push(`website = $${idx++}`);
          values.push(data.website);
        }
        if (data.source !== undefined) {
          fields.push(`source = $${idx++}`);
          values.push(data.source);
        }
        if (data.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(data.status);
        }
        if (data.lead_score !== undefined) {
          fields.push(`lead_score = $${idx++}`);
          values.push(data.lead_score);
        }
        if (data.metadata !== undefined) {
          fields.push(`metadata = $${idx++}`);
          values.push(JSON.stringify(data.metadata));
        }

        fields.push(`updated_at = NOW()`);

        if (fields.length === 1) {
          const existing = await this.findById(id);
          if (!existing) throw new Error(`Contact ${id} not found`);
          return existing;
        }

        values.push(id);
        const sql = `UPDATE leads SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
        const res = await this.queryFn<Lead>(sql, values);
        return res.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: updated, error } = await admin
        .from("leads")
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (!error && updated) return updated as Lead;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.update(id, data);
  }

  async updateScoped(
    id: string,
    businessId: string,
    data: Partial<Lead>
  ): Promise<Lead | null> {
    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.first_name !== undefined) {
          fields.push(`first_name = $${idx++}`);
          values.push(data.first_name);
        }
        if (data.last_name !== undefined) {
          fields.push(`last_name = $${idx++}`);
          values.push(data.last_name);
        }
        if (data.email !== undefined) {
          fields.push(`email = $${idx++}`);
          values.push(data.email.trim().toLowerCase());
        }
        if (data.phone !== undefined) {
          fields.push(`phone = $${idx++}`);
          values.push(data.phone);
        }
        if (data.company_name !== undefined) {
          fields.push(`company_name = $${idx++}`);
          values.push(data.company_name);
        }
        if (data.job_title !== undefined) {
          fields.push(`job_title = $${idx++}`);
          values.push(data.job_title);
        }
        if (data.industry !== undefined) {
          fields.push(`industry = $${idx++}`);
          values.push(data.industry);
        }
        if (data.website !== undefined) {
          fields.push(`website = $${idx++}`);
          values.push(data.website);
        }
        if (data.source !== undefined) {
          fields.push(`source = $${idx++}`);
          values.push(data.source);
        }
        if (data.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(data.status);
        }
        if (data.lead_score !== undefined) {
          fields.push(`lead_score = $${idx++}`);
          values.push(data.lead_score);
        }
        if (data.metadata !== undefined) {
          fields.push(`metadata = $${idx++}`);
          values.push(JSON.stringify(data.metadata));
        }

        fields.push(`updated_at = NOW()`);

        values.push(id);
        values.push(businessId);
        const sql = `UPDATE leads SET ${fields.join(", ")} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *;`;
        const res = await this.queryFn<Lead>(sql, values);
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: updated, error } = await admin
        .from("leads")
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("business_id", businessId)
        .select()
        .single();
      if (!error && updated) return updated as Lead;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.updateScoped(id, businessId, data);
  }

  async archive(id: string, businessId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn(
          "UPDATE leads SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2;",
          [id, businessId]
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("leads")
        .update({
          status: "ARCHIVED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("business_id", businessId);
      if (!error) return true;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.archive(id, businessId);
  }

  async bulkUpdateStatus(businessId: string, ids: string[], status: string): Promise<number> {
    if (ids.length === 0) return 0;

    if (this.useDatabase()) {
      try {
        const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
        const res = await this.queryFn(
          `UPDATE leads SET status = $1, updated_at = NOW() WHERE business_id = $2 AND id IN (${placeholders});`,
          [status, businessId, ...ids]
        );
        return res.rowCount ?? 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("business_id", businessId)
        .in("id", ids)
        .select("id");
      if (!error && data) return data.length;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.bulkUpdateStatus(businessId, ids, status);
  }

  async bulkArchive(businessId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    if (this.useDatabase()) {
      try {
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
        const res = await this.queryFn(
          `UPDATE leads SET status = 'archived', updated_at = NOW() WHERE business_id = $1 AND id IN (${placeholders});`,
          [businessId, ...ids]
        );
        return res.rowCount ?? 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("leads")
        .update({
          status: "ARCHIVED",
          updated_at: new Date().toISOString(),
        })
        .eq("business_id", businessId)
        .in("id", ids)
        .select("id");
      if (!error && data) return data.length;
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.bulkArchive(businessId, ids);
  }

  async list(params: ContactListParams): Promise<ContactListResult> {
    const {
      businessId,
      search = "",
      status = "",
      source = "",
      sortBy = "created_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    if (this.useDatabase()) {
      try {
        const whereClauses: string[] = ["business_id = $1"];
        const queryParams: unknown[] = [businessId];
        let paramIndex = 2;

        if (search.trim()) {
          whereClauses.push(
            `(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR company_name ILIKE $${paramIndex})`
          );
          queryParams.push(`%${search.trim()}%`);
          paramIndex++;
        }

        if (status.trim()) {
          whereClauses.push(`LOWER(status) = LOWER($${paramIndex})`);
          queryParams.push(status.trim());
          paramIndex++;
        }

        if (source.trim()) {
          whereClauses.push(`LOWER(source) = LOWER($${paramIndex})`);
          queryParams.push(source.trim());
          paramIndex++;
        }

        const whereSql = whereClauses.join(" AND ");

        const countRes = await this.queryFn<{ count: string | number }>(
          `SELECT COUNT(*)::int as count FROM leads WHERE ${whereSql};`,
          queryParams
        );
        const total = Number(countRes.rows[0]?.count || 0);

        let orderBySql = "created_at DESC";
        const direction = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

        if (sortBy === "name") {
          orderBySql = `COALESCE(first_name, '') ${direction}, COALESCE(last_name, '') ${direction}`;
        } else if (sortBy === "lead_score") {
          orderBySql = `lead_score ${direction}, created_at DESC`;
        } else {
          orderBySql = `created_at ${direction}`;
        }

        const offset = (page - 1) * limit;
        const dataQueryParams = [...queryParams, limit, offset];
        const dataSql = `SELECT * FROM leads WHERE ${whereSql} ORDER BY ${orderBySql} LIMIT $${paramIndex++} OFFSET $${paramIndex};`;

        const dataRes = await this.queryFn<Lead>(dataSql, dataQueryParams);

        return {
          data: dataRes.rows,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      } catch (err: any) {
        console.error("Database error in LeadRepository.list:", {
          operation: "SELECT",
          table: "leads",
          code: err?.code,
          message: err?.message,
          businessId,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let req = admin.from("leads").select("*", { count: "exact" }).eq("business_id", businessId);

      if (status.trim()) {
        req = req.ilike("status", status.trim());
      }
      if (source.trim()) {
        req = req.ilike("source", source.trim());
      }
      if (search.trim()) {
        req = req.or(
          `first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,company_name.ilike.%${search.trim()}%`
        );
      }

      const ascending = sortOrder.toLowerCase() === "asc";
      if (sortBy === "name") {
        req = req.order("first_name", { ascending });
      } else if (sortBy === "lead_score") {
        req = req.order("lead_score", { ascending });
      } else {
        req = req.order("created_at", { ascending });
      }

      const offset = (page - 1) * limit;
      req = req.range(offset, offset + limit - 1);

      const { data, count, error } = await req;
      if (error) {
        console.error("PostgREST error in LeadRepository.list:", error);
        if (this.useDatabase()) throw error;
      }
      if (data !== null) {
        const total = count || 0;
        return {
          data: data as Lead[],
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalLeadStore.list(params);
  }

  async exportAll(params: Omit<ContactListParams, "page" | "limit">): Promise<Lead[]> {
    const {
      businessId,
      search = "",
      status = "",
      source = "",
      sortBy = "created_at",
      sortOrder = "desc",
    } = params;

    if (this.useDatabase()) {
      try {
        const whereClauses: string[] = ["business_id = $1"];
        const queryParams: unknown[] = [businessId];
        let paramIndex = 2;

        if (search.trim()) {
          whereClauses.push(
            `(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR company_name ILIKE $${paramIndex})`
          );
          queryParams.push(`%${search.trim()}%`);
          paramIndex++;
        }

        if (status.trim()) {
          whereClauses.push(`LOWER(status) = LOWER($${paramIndex})`);
          queryParams.push(status.trim());
          paramIndex++;
        }

        if (source.trim()) {
          whereClauses.push(`LOWER(source) = LOWER($${paramIndex})`);
          queryParams.push(source.trim());
          paramIndex++;
        }

        const whereSql = whereClauses.join(" AND ");

        let orderBySql = "created_at DESC";
        const direction = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

        if (sortBy === "name") {
          orderBySql = `COALESCE(first_name, '') ${direction}, COALESCE(last_name, '') ${direction}`;
        } else if (sortBy === "lead_score") {
          orderBySql = `lead_score ${direction}, created_at DESC`;
        } else {
          orderBySql = `created_at ${direction}`;
        }

        const res = await this.queryFn<Lead>(
          `SELECT * FROM leads WHERE ${whereSql} ORDER BY ${orderBySql};`,
          queryParams
        );

        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let req = admin.from("leads").select("*").eq("business_id", businessId);

      if (status.trim()) {
        req = req.ilike("status", status.trim());
      }
      if (source.trim()) {
        req = req.ilike("source", source.trim());
      }
      if (search.trim()) {
        req = req.or(
          `first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,company_name.ilike.%${search.trim()}%`
        );
      }

      const ascending = sortOrder.toLowerCase() === "asc";
      if (sortBy === "name") {
        req = req.order("first_name", { ascending });
      } else if (sortBy === "lead_score") {
        req = req.order("lead_score", { ascending });
      } else {
        req = req.order("created_at", { ascending });
      }

      const { data, error } = await req;
      if (!error && data !== null) {
        return data as Lead[];
      }
    } catch {
      // Fallback to local store
    }

    return LocalLeadStore.exportAll(params);
  }

  async delete(id: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn("DELETE FROM leads WHERE id = $1;", [id]);
        LocalLeadStore.delete(id);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        console.error("Database error in LeadRepository.delete:", {
          operation: "DELETE",
          table: "leads",
          code: err?.code,
          message: err?.message,
          recordId: id,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin.from("leads").delete().eq("id", id);
      LocalLeadStore.delete(id);
      if (!error) return true;
      if (error) {
        console.error("PostgREST error in LeadRepository.delete:", error);
        if (this.useDatabase()) throw error;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalLeadStore.delete(id);
  }

  async deletePermanent(id: string, businessId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        await this.queryFn("DELETE FROM campaign_leads WHERE lead_id = $1 AND business_id = $2;", [id, businessId]);
        await this.queryFn(
          "DELETE FROM conversation_messages WHERE business_id = $2 AND conversation_id IN (SELECT id FROM conversations WHERE lead_id = $1 AND business_id = $2);",
          [id, businessId]
        );
        await this.queryFn("DELETE FROM conversations WHERE lead_id = $1 AND business_id = $2;", [id, businessId]);
        await this.queryFn("DELETE FROM email_messages WHERE lead_id = $1 AND business_id = $2;", [id, businessId]);
        await this.queryFn("DELETE FROM automation_runs WHERE lead_id = $1 AND business_id = $2;", [id, businessId]);
        const res = await this.queryFn("DELETE FROM leads WHERE id = $1 AND business_id = $2;", [id, businessId]);
        LocalLeadStore.deletePermanent(id, businessId);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        console.error("Database error in LeadRepository.deletePermanent:", {
          operation: "DELETE_PERMANENT",
          table: "leads",
          code: err?.code,
          message: err?.message,
          recordId: id,
          businessId,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("campaign_leads").delete().eq("lead_id", id).eq("business_id", businessId);
      await admin.from("conversations").delete().eq("lead_id", id).eq("business_id", businessId);
      await admin.from("email_messages").delete().eq("lead_id", id).eq("business_id", businessId);
      await admin.from("automation_runs").delete().eq("lead_id", id).eq("business_id", businessId);
      const { error } = await admin.from("leads").delete().eq("id", id).eq("business_id", businessId);
      LocalLeadStore.deletePermanent(id, businessId);
      if (!error) return true;
      if (error) {
        console.error("PostgREST error in LeadRepository.deletePermanent:", error);
        if (this.useDatabase()) throw error;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalLeadStore.deletePermanent(id, businessId);
  }

  async deletePermanentBulk(ids: string[], businessId: string): Promise<number> {
    if (ids.length === 0) return 0;

    if (this.useDatabase()) {
      try {
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
        await this.queryFn(
          `DELETE FROM campaign_leads WHERE business_id = $1 AND lead_id IN (${placeholders});`,
          [businessId, ...ids]
        );
        await this.queryFn(
          `DELETE FROM conversation_messages WHERE business_id = $1 AND conversation_id IN (
            SELECT id FROM conversations WHERE business_id = $1 AND lead_id IN (${placeholders})
          );`,
          [businessId, ...ids]
        );
        await this.queryFn(
          `DELETE FROM conversations WHERE business_id = $1 AND lead_id IN (${placeholders});`,
          [businessId, ...ids]
        );
        await this.queryFn(
          `DELETE FROM email_messages WHERE business_id = $1 AND lead_id IN (${placeholders});`,
          [businessId, ...ids]
        );
        await this.queryFn(
          `DELETE FROM automation_runs WHERE business_id = $1 AND lead_id IN (${placeholders});`,
          [businessId, ...ids]
        );
        const res = await this.queryFn(
          `DELETE FROM leads WHERE business_id = $1 AND id IN (${placeholders});`,
          [businessId, ...ids]
        );
        LocalLeadStore.deletePermanentBulk(ids, businessId);
        return res.rowCount ?? 0;
      } catch (err: any) {
        console.error("Database error in LeadRepository.deletePermanentBulk:", {
          operation: "DELETE_PERMANENT_BULK",
          table: "leads",
          code: err?.code,
          message: err?.message,
          count: ids.length,
          businessId,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("campaign_leads").delete().eq("business_id", businessId).in("lead_id", ids);
      await admin.from("conversations").delete().eq("business_id", businessId).in("lead_id", ids);
      await admin.from("email_messages").delete().eq("business_id", businessId).in("lead_id", ids);
      await admin.from("automation_runs").delete().eq("business_id", businessId).in("lead_id", ids);
      const { data, error } = await admin
        .from("leads")
        .delete()
        .eq("business_id", businessId)
        .in("id", ids)
        .select("id");
      LocalLeadStore.deletePermanentBulk(ids, businessId);
      if (!error && data) return data.length;
      if (error) {
        console.error("PostgREST error in LeadRepository.deletePermanentBulk:", error);
        if (this.useDatabase()) throw error;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalLeadStore.deletePermanentBulk(ids, businessId);
  }
}
