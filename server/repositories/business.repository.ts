import fs from "fs";
import path from "path";
import { BaseRepository } from "./base.repository";
import { Business } from "@/types/database";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResult, QueryResultRow } from "pg";

/**
 * Resilient local file-backed persistence store for businesses
 * Used when direct PostgreSQL or Supabase PostgREST tables are unavailable.
 */
class LocalBusinessStore {
  private static filePath = path.resolve(process.cwd(), ".data/businesses.json");
  private static memoryCache: Business[] | null = null;

  private static load(): Business[] {
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
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.memoryCache || [], null, 2), "utf-8");
    } catch {
      // Ignore write errors
    }
  }

  static getById(id: string): Business | null {
    const list = this.load();
    return list.find((b) => b.id === id) || null;
  }

  static upsert(biz: Business): Business {
    const list = this.load();
    const idx = list.findIndex((b) => b.id === biz.id);
    if (idx !== -1) {
      list[idx] = biz;
    } else {
      list.push(biz);
    }
    this.save();
    return biz;
  }

  static update(id: string, updates: Partial<Business>): Business | null {
    const list = this.load();
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    const updated = {
      ...list[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    list[idx] = updated;
    this.save();
    return updated;
  }
}

export class BusinessRepository implements BaseRepository<Business, string> {
  private queryFn: <
    R extends QueryResultRow = QueryResultRow,
    I extends unknown[] = unknown[]
  >(
    text: string,
    params?: I
  ) => Promise<QueryResult<R>>;

  constructor(
    customQuery?: <
      R extends QueryResultRow = QueryResultRow,
      I extends unknown[] = unknown[]
    >(
      text: string,
      params?: I
    ) => Promise<QueryResult<R>>
  ) {
    this.queryFn = customQuery || query;
  }

  async findById(id: string): Promise<Business | null> {
    // 1. Direct PostgreSQL query if configured
    if (isDbConfigured()) {
      try {
        const res = await this.queryFn<Business>(
          "SELECT * FROM businesses WHERE id = $1;",
          [id]
        );
        if (res.rows[0]) return res.rows[0];
      } catch (err) {
        console.warn("[BusinessRepository] Direct DB query failed, falling back to Supabase client:", err instanceof Error ? err.message : err);
      }
    }

    // 2. Supabase PostgREST client fallback
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("businesses")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (!error && data) {
        return data as Business;
      }
    } catch {
      // Supabase admin query fallback failure
    }

    // 3. Local fallback store
    return LocalBusinessStore.getById(id);
  }

  async findAll(): Promise<Business[]> {
    if (isDbConfigured()) {
      try {
        const res = await this.queryFn<Business>(
          "SELECT * FROM businesses ORDER BY created_at DESC;"
        );
        return res.rows;
      } catch {
        // Fall through
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("businesses")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        return data as Business[];
      }
    } catch {
      // Fall through
    }

    return [];
  }

  async create(data: Omit<Business, "id">): Promise<Business> {
    if (isDbConfigured()) {
      try {
        const res = await this.queryFn<Business>(
          `INSERT INTO businesses (name, industry, website, timezone, status, settings)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *;`,
          [
            data.name,
            data.industry || null,
            data.website || null,
            data.timezone || "UTC",
            data.status || "active",
            JSON.stringify(data.settings || {}),
          ]
        );
        return res.rows[0];
      } catch {
        // Fall through
      }
    }

    try {
      const admin = createAdminClient();
      const { data: created, error } = await admin
        .from("businesses")
        .insert({
          name: data.name,
          industry: data.industry || null,
          website: data.website || null,
          timezone: data.timezone || "UTC",
          status: data.status || "active",
          settings: data.settings || {},
        })
        .select("*")
        .single();

      if (!error && created) {
        return created as Business;
      }
    } catch {
      // Fall through
    }

    const fallback: Business = {
      id: crypto.randomUUID(),
      name: data.name,
      industry: data.industry || null,
      website: data.website || null,
      timezone: data.timezone || "UTC",
      status: data.status || "active",
      settings: data.settings || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return LocalBusinessStore.upsert(fallback);
  }

  async update(id: string, data: Partial<Business>): Promise<Business> {
    if (isDbConfigured()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.name !== undefined) {
          fields.push(`name = $${idx++}`);
          values.push(data.name);
        }
        if (data.industry !== undefined) {
          fields.push(`industry = $${idx++}`);
          values.push(data.industry);
        }
        if (data.website !== undefined) {
          fields.push(`website = $${idx++}`);
          values.push(data.website);
        }
        if (data.timezone !== undefined) {
          fields.push(`timezone = $${idx++}`);
          values.push(data.timezone);
        }
        if (data.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(data.status);
        }
        if (data.settings !== undefined) {
          fields.push(`settings = $${idx++}`);
          values.push(JSON.stringify(data.settings));
        }

        if (fields.length > 0) {
          values.push(id);
          const sql = `UPDATE businesses SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
          const res = await this.queryFn<Business>(sql, values);
          if (res.rows[0]) return res.rows[0];
        }
      } catch (err) {
        console.warn("[BusinessRepository] Direct DB update failed, falling back to Supabase client:", err instanceof Error ? err.message : err);
      }
    }

    // Supabase PostgREST client fallback
    try {
      const admin = createAdminClient();
      const updatePayload: Record<string, unknown> = {};
      if (data.name !== undefined) updatePayload.name = data.name;
      if (data.industry !== undefined) updatePayload.industry = data.industry;
      if (data.website !== undefined) updatePayload.website = data.website;
      if (data.timezone !== undefined) updatePayload.timezone = data.timezone;
      if (data.status !== undefined) updatePayload.status = data.status;
      if (data.settings !== undefined) updatePayload.settings = data.settings;

      const { data: updated, error } = await admin
        .from("businesses")
        .update(updatePayload)
        .eq("id", id)
        .select("*")
        .single();

      if (!error && updated) {
        return updated as Business;
      }
    } catch {
      // Fall through
    }

    // Local fallback store
    const local = LocalBusinessStore.update(id, data);
    if (local) return local;

    const existing = await this.findById(id);
    if (!existing) throw new Error(`Business ${id} not found`);
    return { ...existing, ...data };
  }

  async delete(id: string): Promise<boolean> {
    if (isDbConfigured()) {
      try {
        const res = await this.queryFn("DELETE FROM businesses WHERE id = $1;", [id]);
        return (res.rowCount ?? 0) > 0;
      } catch {
        // Fall through
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin.from("businesses").delete().eq("id", id);
      return !error;
    } catch {
      return false;
    }
  }
}
