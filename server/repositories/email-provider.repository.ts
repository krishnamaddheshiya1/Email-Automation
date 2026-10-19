import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";
import type { EmailProviderConfig, EmailProviderStatus, EmailProviderType } from "@/types/database";

export interface UpsertEmailProviderInput {
  business_id: string;
  provider: EmailProviderType;
  encrypted_api_key: string;
  status: EmailProviderStatus;
  last_checked_at?: string | null;
  last_error?: string | null;
  settings?: Record<string, unknown>;
}

class LocalEmailProviderStore {
  private static filePath = path.resolve(process.cwd(), ".data/email_providers.json");
  private static cache: EmailProviderConfig[] | null = null;

  private static load(): EmailProviderConfig[] {
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
      console.warn("Could not save to local email provider store:", err);
    }
  }

  static findByBusinessId(businessId: string, provider: string): EmailProviderConfig | null {
    const list = this.load();
    return list.find((p) => p.business_id === businessId && p.provider.toUpperCase() === provider.toUpperCase()) || null;
  }

  static findById(id: string): EmailProviderConfig | null {
    const list = this.load();
    return list.find((p) => p.id === id) || null;
  }

  static upsert(input: UpsertEmailProviderInput): EmailProviderConfig {
    const list = this.load();
    const existingIndex = list.findIndex(
      (p) => p.business_id === input.business_id && p.provider.toUpperCase() === input.provider.toUpperCase()
    );

    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      const updated: EmailProviderConfig = {
        ...list[existingIndex],
        encrypted_api_key: input.encrypted_api_key,
        status: input.status,
        last_checked_at: input.last_checked_at !== undefined ? input.last_checked_at : list[existingIndex].last_checked_at,
        last_error: input.last_error !== undefined ? input.last_error : null,
        settings: input.settings || list[existingIndex].settings || {},
        updated_at: now,
      };
      list[existingIndex] = updated;
      this.save();
      return updated;
    }

    const created: EmailProviderConfig = {
      id: crypto.randomUUID(),
      business_id: input.business_id,
      provider: input.provider,
      status: input.status,
      encrypted_api_key: input.encrypted_api_key,
      last_checked_at: input.last_checked_at || null,
      last_error: input.last_error || null,
      settings: input.settings || {},
      created_at: now,
      updated_at: now,
    };
    list.push(created);
    this.save();
    return created;
  }

  static updateStatus(
    id: string,
    businessId: string,
    status: EmailProviderStatus,
    lastError?: string | null,
    lastCheckedAt?: string | null
  ): EmailProviderConfig | null {
    const list = this.load();
    const idx = list.findIndex((p) => p.id === id && p.business_id === businessId);
    if (idx < 0) return null;
    list[idx].status = status;
    if (lastError !== undefined) list[idx].last_error = lastError;
    if (lastCheckedAt !== undefined) list[idx].last_checked_at = lastCheckedAt;
    list[idx].updated_at = new Date().toISOString();
    this.save();
    return list[idx];
  }
}

export class EmailProviderRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  private normalize(row: QueryResultRow): EmailProviderConfig {
    return {
      id: row.id,
      business_id: row.business_id,
      provider: row.provider as EmailProviderType,
      status: row.status as EmailProviderStatus,
      encrypted_api_key: row.encrypted_api_key,
      last_checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
      last_error: row.last_error || null,
      settings: typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings || {},
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async findByBusinessId(
    businessId: string,
    provider: EmailProviderType = "RESEND"
  ): Promise<EmailProviderConfig | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM email_providers 
          WHERE business_id = $1 AND UPPER(provider) = UPPER($2) 
          LIMIT 1;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, provider]);
        if (res.rows.length > 0) return this.normalize(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_providers")
        .select("*")
        .eq("business_id", businessId)
        .eq("provider", provider)
        .maybeSingle();

      if (!error && data) return data as EmailProviderConfig;
    } catch {
      // Fallback to local
    }

    return LocalEmailProviderStore.findByBusinessId(businessId, provider);
  }

  async findActiveByBusinessId(
    businessId: string,
    provider: EmailProviderType = "RESEND"
  ): Promise<EmailProviderConfig | null> {
    const config = await this.findByBusinessId(businessId, provider);
    if (config && config.status === "ACTIVE") {
      return config;
    }
    return null;
  }

  async findById(id: string): Promise<EmailProviderConfig | null> {
    if (this.useDatabase()) {
      try {
        const sql = `SELECT * FROM email_providers WHERE id = $1 LIMIT 1;`;
        const res = await this.queryFn<QueryResultRow>(sql, [id]);
        if (res.rows.length > 0) return this.normalize(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_providers")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (!error && data) return data as EmailProviderConfig;
    } catch {
      // Fallback
    }

    return LocalEmailProviderStore.findById(id);
  }

  async upsertProvider(input: UpsertEmailProviderInput): Promise<EmailProviderConfig> {
    const id = crypto.randomUUID();
    const settingsJson = JSON.stringify(input.settings || {});

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO email_providers (
            id, business_id, provider, status, encrypted_api_key, last_checked_at, last_error, settings, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW()
          )
          ON CONFLICT (business_id, provider) DO UPDATE SET
            status = EXCLUDED.status,
            encrypted_api_key = EXCLUDED.encrypted_api_key,
            last_checked_at = COALESCE(EXCLUDED.last_checked_at, email_providers.last_checked_at),
            last_error = EXCLUDED.last_error,
            settings = EXCLUDED.settings,
            updated_at = NOW()
          RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.business_id,
          input.provider.toUpperCase(),
          input.status,
          input.encrypted_api_key,
          input.last_checked_at || null,
          input.last_error || null,
          settingsJson,
        ]);
        const record = this.normalize(res.rows[0]);
        LocalEmailProviderStore.upsert(input);
        return record;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_providers")
        .upsert(
          {
            business_id: input.business_id,
            provider: input.provider.toUpperCase(),
            status: input.status,
            encrypted_api_key: input.encrypted_api_key,
            last_checked_at: input.last_checked_at || null,
            last_error: input.last_error || null,
            settings: input.settings || {},
          },
          { onConflict: "business_id,provider" }
        )
        .select()
        .single();

      if (!error && data) return data as EmailProviderConfig;
    } catch {
      // Fallback
    }

    return LocalEmailProviderStore.upsert(input);
  }

  async updateStatus(
    id: string,
    businessId: string,
    status: EmailProviderStatus,
    lastError?: string | null,
    lastCheckedAt?: string | null
  ): Promise<EmailProviderConfig> {
    const checkedAt = lastCheckedAt !== undefined ? lastCheckedAt : new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const sql = `
          UPDATE email_providers
          SET status = $1,
              last_error = $2,
              last_checked_at = $3,
              updated_at = NOW()
          WHERE id = $4 AND business_id = $5
          RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          status,
          lastError !== undefined ? lastError : null,
          checkedAt,
          id,
          businessId,
        ]);
        if (res.rows.length > 0) {
          const record = this.normalize(res.rows[0]);
          LocalEmailProviderStore.updateStatus(id, businessId, status, lastError, checkedAt);
          return record;
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_providers")
        .update({
          status,
          last_error: lastError !== undefined ? lastError : null,
          last_checked_at: checkedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("business_id", businessId)
        .select()
        .single();

      if (!error && data) return data as EmailProviderConfig;
    } catch {
      // Fallback
    }

    const local = LocalEmailProviderStore.updateStatus(id, businessId, status, lastError, checkedAt);
    if (!local) {
      throw new Error("Email provider configuration not found or access denied.");
    }
    return local;
  }
}
