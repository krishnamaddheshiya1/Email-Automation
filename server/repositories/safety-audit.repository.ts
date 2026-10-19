import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";
import type { SafetyAuditLog, SafetyAuditEventType } from "@/types/database";

export interface CreateSafetyAuditLogInput {
  business_id: string;
  event_type: SafetyAuditEventType;
  recipient_email?: string | null;
  lead_id?: string | null;
  campaign_id?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

function scrubMetadataSecrets(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("password") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("apikey") ||
      lowerKey.includes("api_key") ||
      lowerKey.includes("token") ||
      lowerKey.includes("credential")
    ) {
      cleaned[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      cleaned[key] = value
        .replace(/re_[a-zA-Z0-9_\-]{16,}/gi, "[REDACTED_API_KEY]")
        .replace(/whsec_[a-zA-Z0-9_\-]{16,}/gi, "[REDACTED_SECRET]");
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = scrubMetadataSecrets(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

class LocalSafetyAuditStore {
  private static filePath = path.resolve(process.cwd(), ".data/safety_audit_logs.json");
  private static cache: SafetyAuditLog[] | null = null;

  private static load(): SafetyAuditLog[] {
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
      console.warn("Could not save to local safety audit store:", err);
    }
  }

  static add(input: CreateSafetyAuditLogInput): SafetyAuditLog {
    const records = this.load();
    const item: SafetyAuditLog = {
      id: crypto.randomUUID(),
      business_id: input.business_id,
      event_type: input.event_type,
      recipient_email: input.recipient_email ? input.recipient_email.trim().toLowerCase() : null,
      lead_id: input.lead_id || null,
      campaign_id: input.campaign_id || null,
      reason: input.reason || null,
      metadata: scrubMetadataSecrets(input.metadata || {}),
      created_at: new Date().toISOString(),
    };
    records.unshift(item);
    this.save();
    return item;
  }

  static list(businessId: string, limit = 50): SafetyAuditLog[] {
    const records = this.load();
    return records
      .filter((r) => r.business_id === businessId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }
}

export class SafetyAuditRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  async createLog(input: CreateSafetyAuditLogInput): Promise<SafetyAuditLog> {
    const id = crypto.randomUUID();
    const normalizedEmail = input.recipient_email ? input.recipient_email.trim().toLowerCase() : null;
    const meta = scrubMetadataSecrets(input.metadata || {});

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO safety_audit_logs (
            id, business_id, event_type, recipient_email, lead_id, campaign_id, reason, metadata, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NOW()
          ) RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.business_id,
          input.event_type,
          normalizedEmail,
          input.lead_id || null,
          input.campaign_id || null,
          input.reason || null,
          JSON.stringify(meta),
        ]);
        const record = this.normalize(res.rows[0]);
        LocalSafetyAuditStore.add(input);
        return record;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("safety_audit_logs")
        .insert({
          id,
          business_id: input.business_id,
          event_type: input.event_type,
          recipient_email: normalizedEmail,
          lead_id: input.lead_id || null,
          campaign_id: input.campaign_id || null,
          reason: input.reason || null,
          metadata: meta,
        })
        .select()
        .single();
      if (!error && data) {
        const record = this.normalize(data);
        LocalSafetyAuditStore.add(input);
        return record;
      }
    } catch {
      // Fallback
    }

    return LocalSafetyAuditStore.add(input);
  }

  async listByBusiness(businessId: string, limit = 50): Promise<SafetyAuditLog[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM safety_audit_logs
          WHERE business_id = $1
          ORDER BY created_at DESC
          LIMIT $2;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, limit]);
        return res.rows.map((r) => this.normalize(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("safety_audit_logs")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && data) {
        return data.map((r) => this.normalize(r));
      }
    } catch {
      // Fallback
    }

    return LocalSafetyAuditStore.list(businessId, limit);
  }

  private normalize(row: unknown): SafetyAuditLog {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      business_id: String(r.business_id),
      event_type: String(r.event_type) as SafetyAuditEventType,
      recipient_email: r.recipient_email ? String(r.recipient_email) : null,
      lead_id: r.lead_id ? String(r.lead_id) : null,
      campaign_id: r.campaign_id ? String(r.campaign_id) : null,
      reason: r.reason ? String(r.reason) : null,
      metadata: (r.metadata as Record<string, unknown>) || {},
      created_at: String(r.created_at),
    };
  }
}
