import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";

export interface SuppressionRecord {
  id: string;
  business_id: string;
  email: string;
  reason: string;
  source?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CreateSuppressionInput {
  business_id: string;
  email: string;
  reason: string;
  source?: string;
}

export function normalizeSuppressionReason(reason: string): string {
  const r = (reason || "").trim().toLowerCase();
  if (r.includes("unsub")) return "UNSUBSCRIBED";
  if (r.includes("bounce")) return "HARD_BOUNCE";
  if (r.includes("complaint") || r.includes("spam")) return "COMPLAINT";
  if (r.includes("invalid")) return "INVALID";
  return "MANUAL";
}

class LocalSuppressionStore {
  private static filePath = path.resolve(process.cwd(), ".data/suppressions.json");
  private static cache: SuppressionRecord[] | null = null;

  private static load(): SuppressionRecord[] {
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
      console.warn("Could not save to local suppression store:", err);
    }
  }

  static isSuppressed(businessId: string, email: string): boolean {
    const records = this.load();
    const normalized = email.trim().toLowerCase();
    return records.some(
      (r) => r.business_id === businessId && r.email.toLowerCase() === normalized
    );
  }

  static get(businessId: string, email: string): SuppressionRecord | null {
    const records = this.load();
    const normalized = email.trim().toLowerCase();
    const found = records.find(
      (r) => r.business_id === businessId && r.email.toLowerCase() === normalized
    );
    return found || null;
  }

  static add(input: CreateSuppressionInput): SuppressionRecord {
    const records = this.load();
    const normalized = input.email.trim().toLowerCase();
    const normReason = normalizeSuppressionReason(input.reason);
    const existing = records.find(
      (r) => r.business_id === input.business_id && r.email.toLowerCase() === normalized
    );
    if (existing) {
      existing.reason = normReason;
      if (input.source) existing.source = input.source;
      existing.updated_at = new Date().toISOString();
      this.save();
      return existing;
    }

    const now = new Date().toISOString();
    const item: SuppressionRecord = {
      id: crypto.randomUUID(),
      business_id: input.business_id,
      email: normalized,
      reason: normReason,
      source: input.source || "system",
      created_at: now,
      updated_at: now,
    };
    records.push(item);
    this.save();
    return item;
  }

  static remove(businessId: string, email: string): boolean {
    const records = this.load();
    const normalized = email.trim().toLowerCase();
    const idx = records.findIndex(
      (r) => r.business_id === businessId && r.email.toLowerCase() === normalized
    );
    if (idx === -1) return false;
    records.splice(idx, 1);
    this.save();
    return true;
  }

  static list(businessId: string): SuppressionRecord[] {
    const records = this.load();
    return records.filter((r) => r.business_id === businessId);
  }
}

export class SuppressionRepository {
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
   * Checks whether the recipient email is currently suppressed for the specified business.
   * Multi-tenant scoped and case-insensitive.
   */
  async isSuppressed(businessId: string, email: string): Promise<boolean> {
    if (!businessId || !email) return false;
    const normalized = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT 1 FROM suppressions WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1;`,
          [businessId, normalized]
        );
        return (res.rows.length ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("suppressions")
        .select("id")
        .eq("business_id", businessId)
        .ilike("email", normalized)
        .limit(1);
      if (!error && data && data.length > 0) return true;
    } catch {
      // Fallback
    }

    return LocalSuppressionStore.isSuppressed(businessId, normalized);
  }

  /**
   * Batch checks which of the provided emails are suppressed for a business.
   * Returns a Set of lowercase suppressed emails.
   */
  async findSuppressedEmails(businessId: string, emails: string[]): Promise<Set<string>> {
    if (!businessId || !emails.length) return new Set();
    const normalized = Array.from(new Set(emails.map((e) => e.trim().toLowerCase())));
    const result = new Set<string>();

    if (this.useDatabase()) {
      try {
        const placeholders = normalized.map((_, i) => `$${i + 2}`).join(", ");
        const res = await this.queryFn<QueryResultRow>(
          `SELECT email FROM suppressions WHERE business_id = $1 AND LOWER(email) IN (${placeholders});`,
          [businessId, ...normalized]
        );
        for (const row of res.rows) {
          result.add(String(row.email).toLowerCase());
        }
        return result;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("suppressions")
        .select("email")
        .eq("business_id", businessId)
        .in("email", normalized);
      if (!error && data) {
        for (const item of data) {
          result.add(String(item.email).toLowerCase());
        }
        return result;
      }
    } catch {
      // Fallback
    }

    const localRecords = LocalSuppressionStore.list(businessId);
    for (const r of localRecords) {
      if (normalized.includes(r.email.toLowerCase())) {
        result.add(r.email.toLowerCase());
      }
    }
    return result;
  }

  /**
   * Retrieves suppression details for a specific email if suppressed.
   */
  async getSuppression(businessId: string, email: string): Promise<SuppressionRecord | null> {
    if (!businessId || !email) return null;
    const normalized = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM suppressions WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1;`,
          [businessId, normalized]
        );
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
        .from("suppressions")
        .select("*")
        .eq("business_id", businessId)
        .ilike("email", normalized)
        .limit(1);
      if (!error && data && data.length > 0) return this.normalize(data[0]);
    } catch {
      // Fallback
    }

    return LocalSuppressionStore.get(businessId, normalized);
  }

  /**
   * Adds an email address to the suppression list.
   * Ensures idempotency through ON CONFLICT DO UPDATE.
   */
  async addSuppression(input: CreateSuppressionInput): Promise<SuppressionRecord> {
    const normalized = input.email.trim().toLowerCase();
    const normalizedReason = normalizeSuppressionReason(input.reason);
    const id = crypto.randomUUID();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `INSERT INTO suppressions (id, business_id, email, reason, source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (business_id, email)
           DO UPDATE SET reason = EXCLUDED.reason, source = COALESCE(EXCLUDED.source, suppressions.source), updated_at = NOW()
           RETURNING *;`,
          [id, input.business_id, normalized, normalizedReason, input.source || "system"]
        );
        const record = this.normalize(res.rows[0]);
        LocalSuppressionStore.add({ ...input, reason: normalizedReason });
        return record;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("suppressions")
        .upsert(
          {
            business_id: input.business_id,
            email: normalized,
            reason: normalizedReason,
          },
          { onConflict: "business_id,email" }
        )
        .select()
        .single();
      if (!error && data) {
        const record = this.normalize(data);
        LocalSuppressionStore.add(input);
        return record;
      }
    } catch {
      // Fallback
    }

    return LocalSuppressionStore.add(input);
  }

  /**
   * Removes an email from the suppression list.
   */
  async removeSuppression(businessId: string, email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn(
          `DELETE FROM suppressions WHERE business_id = $1 AND LOWER(email) = LOWER($2);`,
          [businessId, normalized]
        );
        LocalSuppressionStore.remove(businessId, normalized);
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("suppressions")
        .delete()
        .eq("business_id", businessId)
        .ilike("email", normalized);
      if (!error) {
        LocalSuppressionStore.remove(businessId, normalized);
        return true;
      }
    } catch {
      // Fallback
    }

    return LocalSuppressionStore.remove(businessId, normalized);
  }

  /**
   * Lists suppressions for a business.
   */
  async listSuppressions(businessId: string): Promise<SuppressionRecord[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM suppressions WHERE business_id = $1 ORDER BY created_at DESC;`,
          [businessId]
        );
        return res.rows.map((r) => this.normalize(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("suppressions")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (!error && data && data.length > 0) {
        return data.map((r) => this.normalize(r));
      }
    } catch {
      // Fallback
    }

    return LocalSuppressionStore.list(businessId);
  }

  private normalize(row: unknown): SuppressionRecord {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      business_id: String(r.business_id),
      email: String(r.email),
      reason: String(r.reason),
      source: r.source ? String(r.source) : null,
      created_at: String(r.created_at),
      updated_at: r.updated_at ? String(r.updated_at) : undefined,
    };
  }
}
