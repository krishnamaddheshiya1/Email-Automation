import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";
import type {
  SenderIdentity,
  SenderIdentityStatus,
  SenderVerificationStatus,
} from "@/types/database";

export interface CreateSenderIdentityData {
  business_id: string;
  provider_id?: string | null;
  from_name: string;
  from_email: string;
  reply_to_email?: string | null;
  status?: SenderIdentityStatus;
  verification_status?: SenderVerificationStatus;
}

export interface UpdateSenderIdentityInput {
  from_name?: string;
  reply_to_email?: string | null;
  status?: SenderIdentityStatus;
  verification_status?: SenderVerificationStatus;
}

class LocalSenderIdentityStore {
  private static filePath = path.resolve(process.cwd(), ".data/sender_identities.json");
  private static cache: SenderIdentity[] | null = null;

  private static load(): SenderIdentity[] {
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
      console.warn("Could not save to local sender identities store:", err);
    }
  }

  static listByBusinessId(businessId: string): SenderIdentity[] {
    const list = this.load();
    return list.filter((s) => s.business_id === businessId);
  }

  static findByIdAndBusinessId(id: string, businessId: string): SenderIdentity | null {
    const list = this.load();
    return list.find((s) => s.id === id && s.business_id === businessId) || null;
  }

  static findByEmailAndBusinessId(email: string, businessId: string): SenderIdentity | null {
    const list = this.load();
    const norm = email.trim().toLowerCase();
    return list.find((s) => s.business_id === businessId && s.from_email.toLowerCase() === norm) || null;
  }

  static create(input: CreateSenderIdentityData): SenderIdentity {
    const list = this.load();
    const now = new Date().toISOString();
    const created: SenderIdentity = {
      id: crypto.randomUUID(),
      business_id: input.business_id,
      provider_id: input.provider_id || null,
      from_name: input.from_name,
      from_email: input.from_email.trim().toLowerCase(),
      reply_to_email: input.reply_to_email ? input.reply_to_email.trim().toLowerCase() : null,
      status: input.status || "ACTIVE",
      verification_status: input.verification_status || "PENDING",
      created_at: now,
      updated_at: now,
    };
    list.push(created);
    this.save();
    return created;
  }

  static update(id: string, businessId: string, patch: Partial<SenderIdentity>): SenderIdentity | null {
    const list = this.load();
    const idx = list.findIndex((s) => s.id === id && s.business_id === businessId);
    if (idx < 0) return null;
    const updated: SenderIdentity = {
      ...list[idx],
      ...patch,
      updated_at: new Date().toISOString(),
    };
    list[idx] = updated;
    this.save();
    return updated;
  }

  static delete(id: string, businessId: string): boolean {
    const list = this.load();
    const initialLen = list.length;
    const remaining = list.filter((s) => !(s.id === id && s.business_id === businessId));
    if (remaining.length !== initialLen) {
      this.cache = remaining;
      this.save();
      return true;
    }
    return false;
  }
}

export class SenderIdentityRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  private normalize(row: QueryResultRow): SenderIdentity {
    return {
      id: row.id,
      business_id: row.business_id,
      provider_id: row.provider_id || null,
      from_name: row.from_name,
      from_email: row.from_email,
      reply_to_email: row.reply_to_email || row.reply_to || null,
      status: row.status as SenderIdentityStatus,
      verification_status: row.verification_status as SenderVerificationStatus,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async listByBusinessId(businessId: string): Promise<SenderIdentity[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM sender_identities 
          WHERE business_id = $1 
          ORDER BY created_at ASC;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId]);
        return res.rows.map((r) => this.normalize(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("sender_identities")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });

      if (!error && data) return data as SenderIdentity[];
    } catch {
      // Fallback
    }

    return LocalSenderIdentityStore.listByBusinessId(businessId);
  }

  async findByIdAndBusinessId(id: string, businessId: string): Promise<SenderIdentity | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM sender_identities 
          WHERE id = $1 AND business_id = $2 
          LIMIT 1;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [id, businessId]);
        if (res.rows.length > 0) return this.normalize(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("sender_identities")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();

      if (!error && data) return data as unknown as SenderIdentity;
    } catch {
      // Fallback
    }

    return LocalSenderIdentityStore.findByIdAndBusinessId(id, businessId);
  }

  async findByEmailAndBusinessId(email: string, businessId: string): Promise<SenderIdentity | null> {
    const norm = email.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM sender_identities 
          WHERE business_id = $1 AND LOWER(from_email) = $2 
          LIMIT 1;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, norm]);
        if (res.rows.length > 0) return this.normalize(res.rows[0]);
        return null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("sender_identities")
        .select("*")
        .eq("business_id", businessId)
        .ilike("from_email", norm)
        .maybeSingle();

      if (!error && data) return data as unknown as SenderIdentity;
    } catch {
      // Fallback
    }

    return LocalSenderIdentityStore.findByEmailAndBusinessId(norm, businessId);
  }

  async createSender(input: CreateSenderIdentityData): Promise<SenderIdentity> {
    const id = crypto.randomUUID();
    const fromEmail = input.from_email.trim().toLowerCase();
    const replyTo = input.reply_to_email ? input.reply_to_email.trim().toLowerCase() : null;
    const status = input.status || "ACTIVE";
    const verificationStatus = input.verification_status || "PENDING";

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO sender_identities (
            id, business_id, provider_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
          ) RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.business_id,
          input.provider_id || null,
          input.from_name.trim(),
          fromEmail,
          replyTo,
          status,
          verificationStatus,
        ]);
        const record = this.normalize(res.rows[0]);
        LocalSenderIdentityStore.create(input);
        return record;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("sender_identities")
        .insert({
          id,
          business_id: input.business_id,
          provider_id: input.provider_id || null,
          from_name: input.from_name.trim(),
          from_email: fromEmail,
          reply_to_email: replyTo,
          status,
          verification_status: verificationStatus,
        })
        .select()
        .single();

      if (!error && data) return data as unknown as SenderIdentity;
    } catch {
      // Fallback
    }

    return LocalSenderIdentityStore.create(input);
  }

  async updateSender(
    id: string,
    businessId: string,
    patch: Partial<SenderIdentity>
  ): Promise<SenderIdentity> {
    if (this.useDatabase()) {
      try {
        const updates: string[] = [];
        const params: unknown[] = [id, businessId];

        if (patch.from_name !== undefined) {
          params.push(patch.from_name.trim());
          updates.push(`from_name = $${params.length}`);
        }
        if (patch.reply_to_email !== undefined) {
          const r = patch.reply_to_email ? patch.reply_to_email.trim().toLowerCase() : null;
          params.push(r);
          updates.push(`reply_to_email = $${params.length}`);
        }
        if (patch.status !== undefined) {
          params.push(patch.status);
          updates.push(`status = $${params.length}`);
        }
        if (patch.verification_status !== undefined) {
          params.push(patch.verification_status);
          updates.push(`verification_status = $${params.length}`);
        }

        if (updates.length > 0) {
          updates.push("updated_at = NOW()");
          const sql = `
            UPDATE sender_identities
            SET ${updates.join(", ")}
            WHERE id = $1 AND business_id = $2
            RETURNING *;
          `;
          const res = await this.queryFn<QueryResultRow>(sql, params);
          if (res.rows.length > 0) {
            const record = this.normalize(res.rows[0]);
            LocalSenderIdentityStore.update(id, businessId, patch);
            return record;
          }
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("sender_identities")
        .update({
          ...(patch.from_name !== undefined ? { from_name: patch.from_name.trim() } : {}),
          ...(patch.reply_to_email !== undefined ? { reply_to_email: patch.reply_to_email ? patch.reply_to_email.trim().toLowerCase() : null } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.verification_status !== undefined ? { verification_status: patch.verification_status } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("business_id", businessId)
        .select()
        .single();

      if (!error && data) return data as unknown as SenderIdentity;
    } catch {
      // Fallback
    }

    const local = LocalSenderIdentityStore.update(id, businessId, patch);
    if (!local) {
      throw new Error("Sender identity not found or access denied.");
    }
    return local;
  }

  async deleteSender(id: string, businessId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const sql = `DELETE FROM sender_identities WHERE id = $1 AND business_id = $2;`;
        await this.queryFn(sql, [id, businessId]);
        LocalSenderIdentityStore.delete(id, businessId);
        return true;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("sender_identities").delete().eq("id", id).eq("business_id", businessId);
    } catch {
      // Fallback
    }

    return LocalSenderIdentityStore.delete(id, businessId);
  }
}
