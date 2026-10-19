import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";
import type {
  ContactImport,
  NewContactImport,
  ContactImportStatus,
  ContactImportError,
} from "@/types/database";

class LocalContactImportStore {
  private static filePath = path.resolve(process.cwd(), ".data/contact_imports.json");
  private static cache: ContactImport[] | null = null;

  private static load(): ContactImport[] {
    if (this.cache !== null) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.cache = JSON.parse(raw) || [];
        return this.cache!;
      }
    } catch {
      // Ignore read error
    }
    this.cache = [];
    return this.cache;
  }

  private static save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache || [], null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save to local contact imports store:", err);
    }
  }

  static create(data: NewContactImport): ContactImport {
    const records = this.load();
    const now = new Date().toISOString();
    const item: ContactImport = {
      id: data.id || crypto.randomUUID(),
      business_id: data.business_id,
      filename: data.filename,
      total_rows: data.total_rows || 0,
      imported_count: data.imported_count || 0,
      duplicate_count: data.duplicate_count || 0,
      invalid_count: data.invalid_count || 0,
      suppressed_count: data.suppressed_count || 0,
      failed_count: data.failed_count || 0,
      status: (data.status || "PROCESSING") as ContactImportStatus,
      errors: data.errors || [],
      created_at: now,
      completed_at: data.completed_at || null,
    };
    records.unshift(item);
    this.save();
    return item;
  }

  static update(id: string, businessId: string, patch: Partial<ContactImport>): ContactImport | null {
    const records = this.load();
    const idx = records.findIndex((r) => r.id === id && r.business_id === businessId);
    if (idx === -1) return null;

    const updated: ContactImport = {
      ...records[idx],
      ...patch,
    };
    records[idx] = updated;
    this.save();
    return updated;
  }

  static findByIdAndBusinessId(id: string, businessId: string): ContactImport | null {
    const records = this.load();
    return records.find((r) => r.id === id && r.business_id === businessId) || null;
  }

  static listByBusinessId(
    businessId: string,
    limit = 50,
    offset = 0
  ): { data: ContactImport[]; total: number } {
    const records = this.load().filter((r) => r.business_id === businessId);
    return {
      data: records.slice(offset, offset + limit),
      total: records.length,
    };
  }
}

export class ContactImportRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  async create(input: NewContactImport): Promise<ContactImport> {
    const id = input.id || crypto.randomUUID();
    const status = input.status || "PROCESSING";
    const errors = input.errors || [];

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO contact_imports (
            id, business_id, filename, total_rows, imported_count,
            duplicate_count, invalid_count, suppressed_count, failed_count,
            status, errors, created_at, completed_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, NOW(), $12
          ) RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.business_id,
          input.filename,
          input.total_rows || 0,
          input.imported_count || 0,
          input.duplicate_count || 0,
          input.invalid_count || 0,
          input.suppressed_count || 0,
          input.failed_count || 0,
          status,
          JSON.stringify(errors),
          input.completed_at || null,
        ]);
        const record = this.normalize(res.rows[0]);
        LocalContactImportStore.create({ ...input, id });
        return record;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("contact_imports")
        .insert({
          id,
          business_id: input.business_id,
          filename: input.filename,
          total_rows: input.total_rows || 0,
          imported_count: input.imported_count || 0,
          duplicate_count: input.duplicate_count || 0,
          invalid_count: input.invalid_count || 0,
          suppressed_count: input.suppressed_count || 0,
          failed_count: input.failed_count || 0,
          status,
          errors,
        })
        .select()
        .single();
      if (!error && data) {
        const record = this.normalize(data);
        LocalContactImportStore.create({ ...input, id });
        return record;
      }
    } catch {
      // Fallback
    }

    return LocalContactImportStore.create({ ...input, id });
  }

  async update(
    id: string,
    businessId: string,
    patch: Partial<ContactImport>
  ): Promise<ContactImport> {
    if (this.useDatabase()) {
      try {
        const setClauses: string[] = [];
        const values: unknown[] = [id, businessId];
        let idx = 3;

        if (patch.total_rows !== undefined) {
          setClauses.push(`total_rows = $${idx++}`);
          values.push(patch.total_rows);
        }
        if (patch.imported_count !== undefined) {
          setClauses.push(`imported_count = $${idx++}`);
          values.push(patch.imported_count);
        }
        if (patch.duplicate_count !== undefined) {
          setClauses.push(`duplicate_count = $${idx++}`);
          values.push(patch.duplicate_count);
        }
        if (patch.invalid_count !== undefined) {
          setClauses.push(`invalid_count = $${idx++}`);
          values.push(patch.invalid_count);
        }
        if (patch.suppressed_count !== undefined) {
          setClauses.push(`suppressed_count = $${idx++}`);
          values.push(patch.suppressed_count);
        }
        if (patch.failed_count !== undefined) {
          setClauses.push(`failed_count = $${idx++}`);
          values.push(patch.failed_count);
        }
        if (patch.status !== undefined) {
          setClauses.push(`status = $${idx++}`);
          values.push(patch.status);
        }
        if (patch.errors !== undefined) {
          setClauses.push(`errors = $${idx++}`);
          values.push(JSON.stringify(patch.errors));
        }
        if (patch.completed_at !== undefined) {
          setClauses.push(`completed_at = $${idx++}`);
          values.push(patch.completed_at);
        }

        if (setClauses.length > 0) {
          const sql = `
            UPDATE contact_imports
            SET ${setClauses.join(", ")}
            WHERE id = $1 AND business_id = $2
            RETURNING *;
          `;
          const res = await this.queryFn<QueryResultRow>(sql, values);
          if (res.rows.length > 0) {
            LocalContactImportStore.update(id, businessId, patch);
            return this.normalize(res.rows[0]);
          }
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const updateData: Record<string, unknown> = {};
      if (patch.total_rows !== undefined) updateData.total_rows = patch.total_rows;
      if (patch.imported_count !== undefined) updateData.imported_count = patch.imported_count;
      if (patch.duplicate_count !== undefined) updateData.duplicate_count = patch.duplicate_count;
      if (patch.invalid_count !== undefined) updateData.invalid_count = patch.invalid_count;
      if (patch.suppressed_count !== undefined) updateData.suppressed_count = patch.suppressed_count;
      if (patch.failed_count !== undefined) updateData.failed_count = patch.failed_count;
      if (patch.status !== undefined) updateData.status = patch.status;
      if (patch.errors !== undefined) updateData.errors = patch.errors;
      if (patch.completed_at !== undefined) updateData.completed_at = patch.completed_at;

      const { data, error } = await admin
        .from("contact_imports")
        .update(updateData)
        .eq("id", id)
        .eq("business_id", businessId)
        .select()
        .single();
      if (!error && data) {
        LocalContactImportStore.update(id, businessId, patch);
        return this.normalize(data);
      }
    } catch {
      // Fallback
    }

    const updated = LocalContactImportStore.update(id, businessId, patch);
    if (!updated) {
      throw new Error(`Contact import ${id} not found or access denied.`);
    }
    return updated;
  }

  async findByIdAndBusinessId(
    id: string,
    businessId: string
  ): Promise<ContactImport | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM contact_imports
          WHERE id = $1 AND business_id = $2
          LIMIT 1;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [id, businessId]);
        if (res.rows.length > 0) {
          return this.normalize(res.rows[0]);
        }
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("contact_imports")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .single();
      if (!error && data) {
        return this.normalize(data);
      }
    } catch {
      // Fallback
    }

    return LocalContactImportStore.findByIdAndBusinessId(id, businessId);
  }

  async listByBusinessId(
    businessId: string,
    limit = 50,
    offset = 0
  ): Promise<{ data: ContactImport[]; total: number }> {
    if (this.useDatabase()) {
      try {
        const countSql = `SELECT COUNT(*) as total FROM contact_imports WHERE business_id = $1;`;
        const countRes = await this.queryFn<QueryResultRow>(countSql, [businessId]);
        const total = parseInt(String(countRes.rows[0]?.total || "0"), 10);

        const sql = `
          SELECT * FROM contact_imports
          WHERE business_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, limit, offset]);
        return {
          data: res.rows.map((r) => this.normalize(r)),
          total,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalContactImportStore.listByBusinessId(businessId, limit, offset);
  }

  private normalize(row: unknown): ContactImport {
    const r = row as Record<string, unknown>;
    let errors: ContactImportError[] = [];
    if (Array.isArray(r.errors)) {
      errors = r.errors as ContactImportError[];
    } else if (typeof r.errors === "string") {
      try {
        errors = JSON.parse(r.errors);
      } catch {
        errors = [];
      }
    }

    return {
      id: String(r.id),
      business_id: String(r.business_id),
      filename: String(r.filename),
      total_rows: Number(r.total_rows || 0),
      imported_count: Number(r.imported_count || 0),
      duplicate_count: Number(r.duplicate_count || 0),
      invalid_count: Number(r.invalid_count || 0),
      suppressed_count: Number(r.suppressed_count || 0),
      failed_count: Number(r.failed_count || 0),
      status: (String(r.status || "PROCESSING").toUpperCase()) as ContactImportStatus,
      errors,
      created_at: String(r.created_at),
      completed_at: r.completed_at ? String(r.completed_at) : null,
    };
  }
}
