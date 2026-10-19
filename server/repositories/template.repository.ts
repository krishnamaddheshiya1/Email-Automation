import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BaseRepository } from "./base.repository";
import { EmailTemplate, TemplateStatus } from "@/types/database";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResult, QueryResultRow } from "pg";

export interface TemplateListParams {
  businessId: string;
  search?: string;
  status?: string; // 'active', 'draft', 'archived', or 'all'
  sortBy?: "updated_at" | "created_at" | "name" | "status";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface TemplateListResult {
  data: EmailTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CreateTemplateRepositoryInput = Omit<
  EmailTemplate,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Resilient local file-backed persistence store for templates.
 * Used when direct PostgreSQL or Supabase PostgREST tables are unavailable.
 */
export class LocalTemplateStore {
  private static filePath = path.resolve(process.cwd(), ".data/templates.json");
  private static memoryCache: EmailTemplate[] | null = null;

  private static load(): EmailTemplate[] {
    if (this.memoryCache !== null) return this.memoryCache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.memoryCache = JSON.parse(raw);
        return this.memoryCache || [];
      }
    } catch {
      // Ignore read errors
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
    } catch (err) {
      console.warn("Could not save to local template store:", err);
    }
  }

  static findById(id: string): EmailTemplate | null {
    const list = this.load();
    return list.find((t) => t.id === id) || null;
  }

  static findByIdAndBusinessId(id: string, businessId: string): EmailTemplate | null {
    const list = this.load();
    return list.find((t) => t.id === id && t.business_id === businessId) || null;
  }

  static findByBusinessId(businessId: string): EmailTemplate[] {
    const list = this.load();
    return list
      .filter((t) => t.business_id === businessId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  static list(params: TemplateListParams): TemplateListResult {
    const {
      businessId,
      search = "",
      status = "active",
      sortBy = "updated_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    const list = this.load();
    const filtered = list.filter((t) => {
      if (t.business_id !== businessId) return false;

      // Status filter
      if (status && status !== "all") {
        if (t.status.toLowerCase() !== status.toLowerCase()) return false;
      }

      // Search filter (name or subject)
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesSubject = t.subject.toLowerCase().includes(q);
        if (!matchesName && !matchesSubject) return false;
      }

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      const direction = sortOrder.toLowerCase() === "asc" ? 1 : -1;
      if (sortBy === "name") {
        return a.name.localeCompare(b.name) * direction;
      } else if (sortBy === "created_at") {
        return (
          (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction
        );
      } else {
        return (
          (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * direction
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

  static create(data: CreateTemplateRepositoryInput): EmailTemplate {
    const list = this.load();
    const now = new Date().toISOString();
    const template: EmailTemplate = {
      id: data.id || crypto.randomUUID(),
      business_id: data.business_id,
      name: data.name,
      subject: data.subject,
      body: data.body,
      variables: data.variables || [],
      status: (data.status as TemplateStatus) || "active",
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    };

    list.unshift(template);
    this.save();
    return template;
  }

  static update(
    id: string,
    businessId: string | undefined,
    data: Partial<EmailTemplate>
  ): EmailTemplate | null {
    const list = this.load();
    const idx = list.findIndex(
      (t) => t.id === id && (!businessId || t.business_id === businessId)
    );
    if (idx === -1) return null;

    const existing = list[idx];
    const updated: EmailTemplate = {
      ...existing,
      ...data,
      id: existing.id,
      business_id: existing.business_id,
      updated_at: new Date().toISOString(),
    };

    list[idx] = updated;
    this.save();
    return updated;
  }

  static duplicate(
    id: string,
    businessId: string,
    newName?: string
  ): EmailTemplate | null {
    const orig = this.findByIdAndBusinessId(id, businessId);
    if (!orig) return null;

    const copyName = newName?.trim() || `${orig.name} Copy`;
    return this.create({
      business_id: businessId,
      name: copyName,
      subject: orig.subject,
      body: orig.body,
      variables: [...orig.variables],
      status: orig.status === "archived" ? "draft" : orig.status,
    });
  }

  static archive(id: string, businessId: string): EmailTemplate | null {
    return this.update(id, businessId, { status: "archived" });
  }

  static delete(id: string, businessId: string): boolean {
    const list = this.load();
    const idx = list.findIndex((t) => t.id === id && t.business_id === businessId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.save();
    return true;
  }
}

export class TemplateRepository
  implements BaseRepository<EmailTemplate, string, CreateTemplateRepositoryInput>
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

  async findById(id: string): Promise<EmailTemplate | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<EmailTemplate>(
          "SELECT * FROM email_templates WHERE id = $1;",
          [id]
        );
        if (res.rows[0]) {
          return this.normalizeRow(res.rows[0]);
        }
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!error && data) return this.normalizeRow(data);
    } catch {
      // Fallback
    }

    return LocalTemplateStore.findById(id);
  }

  async findByIdAndBusinessId(
    id: string,
    businessId: string
  ): Promise<EmailTemplate | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<EmailTemplate>(
          "SELECT * FROM email_templates WHERE id = $1 AND business_id = $2;",
          [id, businessId]
        );
        if (res.rows[0]) {
          return this.normalizeRow(res.rows[0]);
        }
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_templates")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) return this.normalizeRow(data);
    } catch {
      // Fallback
    }

    return LocalTemplateStore.findByIdAndBusinessId(id, businessId);
  }

  async findByBusinessId(businessId: string): Promise<EmailTemplate[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<EmailTemplate>(
          "SELECT * FROM email_templates WHERE business_id = $1 ORDER BY updated_at DESC;",
          [businessId]
        );
        return res.rows.map((r) => this.normalizeRow(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_templates")
        .select("*")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false });
      if (!error && data) return data.map((r) => this.normalizeRow(r));
    } catch {
      // Fallback
    }

    return LocalTemplateStore.findByBusinessId(businessId);
  }

  async findAll(): Promise<EmailTemplate[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<EmailTemplate>(
          "SELECT * FROM email_templates ORDER BY updated_at DESC;"
        );
        return res.rows.map((r) => this.normalizeRow(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_templates")
        .select("*")
        .order("updated_at", { ascending: false });
      if (!error && data) return data.map((r) => this.normalizeRow(r));
    } catch {
      // Fallback
    }

    return LocalTemplateStore.list({ businessId: "", status: "all", limit: 1000 }).data;
  }

  async list(params: TemplateListParams): Promise<TemplateListResult> {
    const {
      businessId,
      search = "",
      status = "active",
      sortBy = "updated_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    if (this.useDatabase()) {
      try {
        const conditions: string[] = ["business_id = $1"];
        const queryParams: unknown[] = [businessId];
        let pIdx = 2;

        if (status && status !== "all") {
          conditions.push(`status = $${pIdx++}`);
          queryParams.push(status.toLowerCase());
        }

        if (search.trim()) {
          conditions.push(`(name ILIKE $${pIdx} OR subject ILIKE $${pIdx})`);
          queryParams.push(`%${search.trim()}%`);
          pIdx++;
        }

        const whereClause = conditions.join(" AND ");
        const sortColumn =
          sortBy === "name"
            ? "name"
            : sortBy === "created_at"
            ? "created_at"
            : "updated_at";
        const orderDir = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

        const countRes = await this.queryFn<{ count: string }>(
          `SELECT COUNT(*) as count FROM email_templates WHERE ${whereClause};`,
          queryParams
        );
        const total = parseInt(countRes.rows[0]?.count || "0", 10);

        const offset = (page - 1) * limit;
        queryParams.push(limit, offset);
        const dataRes = await this.queryFn<EmailTemplate>(
          `SELECT * FROM email_templates WHERE ${whereClause} ORDER BY ${sortColumn} ${orderDir} LIMIT $${pIdx++} OFFSET $${pIdx};`,
          queryParams
        );

        return {
          data: dataRes.rows.map((r) => this.normalizeRow(r)),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // Try Supabase PostgREST
    try {
      const admin = createAdminClient();
      let queryBuilder = admin
        .from("email_templates")
        .select("*", { count: "exact" })
        .eq("business_id", businessId);

      if (status && status !== "all") {
        queryBuilder = queryBuilder.eq("status", status.toLowerCase());
      }

      if (search.trim()) {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${search.trim()}%,subject.ilike.%${search.trim()}%`
        );
      }

      const sortColumn =
        sortBy === "name" ? "name" : sortBy === "created_at" ? "created_at" : "updated_at";
      queryBuilder = queryBuilder.order(sortColumn, {
        ascending: sortOrder.toLowerCase() === "asc",
      });

      const offset = (page - 1) * limit;
      queryBuilder = queryBuilder.range(offset, offset + limit - 1);

      const { data, count, error } = await queryBuilder;
      if (!error && data !== null) {
        const total = count || 0;
        return {
          data: data.map((r) => this.normalizeRow(r)),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      }
    } catch {
      // Fallback
    }

    return LocalTemplateStore.list(params);
  }

  async create(data: CreateTemplateRepositoryInput): Promise<EmailTemplate> {
    const templateId = data.id || crypto.randomUUID();
    const variablesJson = JSON.stringify(data.variables || []);

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<EmailTemplate>(
          `INSERT INTO email_templates (id, business_id, name, subject, body, variables, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())
           RETURNING *;`,
          [
            templateId,
            data.business_id,
            data.name,
            data.subject,
            data.body,
            variablesJson,
            data.status || "active",
          ]
        );
        return this.normalizeRow(res.rows[0]);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from("email_templates")
        .insert({
          id: templateId,
          business_id: data.business_id,
          name: data.name,
          subject: data.subject,
          body: data.body,
          variables: data.variables || [],
          status: data.status || "active",
        })
        .select()
        .single();
      if (!error && inserted) {
        return this.normalizeRow(inserted);
      }
    } catch {
      // Fallback
    }

    return LocalTemplateStore.create(data);
  }

  async update(
    id: string,
    data: Partial<EmailTemplate>,
    businessId?: string
  ): Promise<EmailTemplate>;
  async update(
    id: string,
    businessId: string,
    data: Partial<EmailTemplate>
  ): Promise<EmailTemplate>;
  async update(
    id: string,
    arg2: Partial<EmailTemplate> | string,
    arg3?: Partial<EmailTemplate> | string
  ): Promise<EmailTemplate> {
    const businessId =
      typeof arg2 === "string"
        ? arg2
        : typeof arg3 === "string"
        ? arg3
        : undefined;
    const data =
      typeof arg2 === "object"
        ? arg2
        : typeof arg3 === "object"
        ? (arg3 as Partial<EmailTemplate>)
        : {};

    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.name !== undefined) {
          fields.push(`name = $${idx++}`);
          values.push(data.name);
        }
        if (data.subject !== undefined) {
          fields.push(`subject = $${idx++}`);
          values.push(data.subject);
        }
        if (data.body !== undefined) {
          fields.push(`body = $${idx++}`);
          values.push(data.body);
        }
        if (data.variables !== undefined) {
          fields.push(`variables = $${idx++}::jsonb`);
          values.push(JSON.stringify(data.variables));
        }
        if (data.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(data.status);
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        let queryText = `UPDATE email_templates SET ${fields.join(", ")} WHERE id = $${idx++}`;
        if (businessId) {
          values.push(businessId);
          queryText += ` AND business_id = $${idx++}`;
        }
        queryText += ` RETURNING *;`;

        const res = await this.queryFn<EmailTemplate>(queryText, values);
        if (res.rows[0]) {
          return this.normalizeRow(res.rows[0]);
        }
        throw new Error("Template not found or access denied.");
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (data.name !== undefined) updatePayload.name = data.name;
      if (data.subject !== undefined) updatePayload.subject = data.subject;
      if (data.body !== undefined) updatePayload.body = data.body;
      if (data.variables !== undefined) updatePayload.variables = data.variables;
      if (data.status !== undefined) updatePayload.status = data.status;

      let q = admin.from("email_templates").update(updatePayload).eq("id", id);
      if (businessId) {
        q = q.eq("business_id", businessId);
      }
      const { data: updated, error } = await q.select().single();

      if (!error && updated) {
        return this.normalizeRow(updated);
      }
    } catch {
      // Fallback
    }

    const localUpdated = LocalTemplateStore.update(id, businessId, data);
    if (!localUpdated) {
      throw new Error("Template not found or access denied.");
    }
    return localUpdated;
  }

  async duplicate(
    id: string,
    businessId: string,
    newName?: string
  ): Promise<EmailTemplate> {
    const orig = await this.findByIdAndBusinessId(id, businessId);
    if (!orig) {
      throw new Error("Template not found or access denied.");
    }

    const copyName = newName?.trim() || `${orig.name} Copy`;
    return this.create({
      business_id: businessId,
      name: copyName,
      subject: orig.subject,
      body: orig.body,
      variables: [...orig.variables],
      status: orig.status === "archived" ? "draft" : orig.status,
    });
  }

  async archive(id: string, businessId: string): Promise<EmailTemplate> {
    return this.update(id, businessId, { status: "archived" });
  }

  async delete(id: string, businessId?: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const queryText = businessId
          ? "DELETE FROM email_templates WHERE id = $1 AND business_id = $2;"
          : "DELETE FROM email_templates WHERE id = $1;";
        const params = businessId ? [id, businessId] : [id];
        const res = await this.queryFn(queryText, params);
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let q = admin.from("email_templates").delete().eq("id", id);
      if (businessId) q = q.eq("business_id", businessId);
      const { error } = await q;
      if (!error) return true;
    } catch {
      // Fallback
    }

    return LocalTemplateStore.delete(id, businessId || "");
  }

  /**
   * Normalizes DB rows where variables might be a string or JSONB array.
   */
  private normalizeRow(row: unknown): EmailTemplate {
    const r = row as Record<string, unknown>;
    let vars: string[] = [];
    if (Array.isArray(r.variables)) {
      vars = r.variables as string[];
    } else if (typeof r.variables === "string") {
      try {
        vars = JSON.parse(r.variables);
      } catch {
        vars = [];
      }
    }

    return {
      id: String(r.id),
      business_id: String(r.business_id),
      name: String(r.name),
      subject: String(r.subject),
      body: String(r.body),
      variables: vars,
      status: (r.status as TemplateStatus) || "active",
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }
}
