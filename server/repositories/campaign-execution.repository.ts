import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  CampaignEnrollment,
  CampaignExecutionLog,
  Campaign,
  CampaignStep,
  ExecutionLogStatus,
} from "@/types/database";
import { query, isDbConfigured } from "../db/client";
import { LocalCampaignStore } from "./campaign.repository";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResult, QueryResultRow } from "pg";

export interface DueEnrollmentItem {
  enrollment: CampaignEnrollment;
  campaign: Campaign;
}

export interface CampaignExecutionSummary {
  campaignId: string;
  campaignStatus: string;
  totalEnrolled: number;
  running: number;
  completed: number;
  paused: number;
  stopped: number;
  failed: number;
  nextScheduledAt: string | null;
}

/**
 * Local file-backed store for campaign execution logs fallback
 */
export class LocalExecutionLogStore {
  private static filePath = path.resolve(process.cwd(), ".data/execution_logs.json");
  private static memoryCache: CampaignExecutionLog[] | null = null;
  private static lastMtime = 0;

  private static load(): CampaignExecutionLog[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const stat = fs.statSync(this.filePath);
        if (this.memoryCache !== null && stat.mtimeMs === this.lastMtime) {
          return this.memoryCache;
        }
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.memoryCache = JSON.parse(raw);
        this.lastMtime = stat.mtimeMs;
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
      this.lastMtime = fs.statSync(this.filePath).mtimeMs;
    } catch {
      // Ignore write errors
    }
  }

  static deleteByEnrollmentId(enrollmentId: string): void {
    const list = this.load();
    this.memoryCache = list.filter((l) => l.enrollment_id !== enrollmentId);
    this.save();
  }

  static getByIdempotencyKey(key: string): CampaignExecutionLog | null {
    const list = this.load();
    return list.find((l) => l.idempotency_key === key) || null;
  }

  static insert(log: CampaignExecutionLog): CampaignExecutionLog {
    const list = this.load();
    const idx = list.findIndex((l) => l.id === log.id || l.idempotency_key === log.idempotency_key);
    if (idx !== -1) {
      list[idx] = log;
    } else {
      list.push(log);
    }
    this.save();
    return log;
  }

  static update(id: string, updates: Partial<CampaignExecutionLog>): CampaignExecutionLog | null {
    const list = this.load();
    const idx = list.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    const updated = {
      ...list[idx],
      ...updates,
    };
    list[idx] = updated;
    this.save();
    return updated;
  }

  static listByCampaign(campaignId: string, limit = 50): CampaignExecutionLog[] {
    const list = this.load();
    return list
      .filter((l) => l.campaign_id === campaignId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }
}

/**
 * Repository handling Campaign Enrollments, Scheduling State, and Execution Logs.
 */
export class CampaignExecutionRepository {
  private queryFn: <
    R extends QueryResultRow = QueryResultRow,
    I extends unknown[] = unknown[]
  >(
    text: string,
    params?: I
  ) => Promise<QueryResult<R>>;

  private isCustomQuery: boolean;

  constructor(
    customQuery?: <
      R extends QueryResultRow = QueryResultRow,
      I extends unknown[] = unknown[]
    >(
      text: string,
      params?: I
    ) => Promise<QueryResult<R>>
  ) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  /**
   * Atomically claims due enrollments to prevent concurrent duplicate execution.
   */
  async claimDueEnrollments(
    limit: number,
    businessId?: string,
    campaignId?: string,
    retryFailed?: boolean
  ): Promise<DueEnrollmentItem[]> {
    if (this.useDatabase()) {
      try {
        const statusCondition = retryFailed
          ? "(UPPER(cl.status) IN ('ENROLLED', 'WAITING', 'FAILED') OR (UPPER(cl.status) = 'RUNNING' AND (cl.updated_at IS NULL OR cl.updated_at < NOW() - INTERVAL '2 minutes')))"
          : "(UPPER(cl.status) IN ('ENROLLED', 'WAITING') OR (UPPER(cl.status) = 'RUNNING' AND (cl.updated_at IS NULL OR cl.updated_at < NOW() - INTERVAL '2 minutes')) OR (UPPER(cl.status) = 'FAILED' AND (cl.metadata->>'retry_eligible')::boolean IS TRUE AND COALESCE(cl.retry_count, 0) < 3))";

        const whereClauses: string[] = [
          "UPPER(c.status) = 'ACTIVE'",
          statusCondition,
          "cl.next_run_at IS NOT NULL",
          "cl.next_run_at <= NOW()",
        ];
        const params: unknown[] = [];
        let idx = 1;

        if (businessId) {
          whereClauses.push(`cl.business_id = $${idx++}`);
          params.push(businessId);
        }
        if (campaignId) {
          whereClauses.push(`cl.campaign_id = $${idx++}`);
          params.push(campaignId);
        }

        params.push(limit);
        const limitParam = `$${idx}`;

        // Atomically claim and lock eligible due enrollments in a single transaction with SKIP LOCKED
        const atomicClaimSql = `
          WITH due_candidates AS (
            SELECT cl.id
            FROM campaign_leads cl
            JOIN campaigns c ON c.id = cl.campaign_id
            WHERE ${whereClauses.join(" AND ")}
            ORDER BY cl.next_run_at ASC
            LIMIT ${limitParam}
            FOR UPDATE OF cl SKIP LOCKED
          ),
          claimed_rows AS (
            UPDATE campaign_leads cl
            SET status = 'RUNNING',
                started_at = COALESCE(cl.started_at, NOW()),
                updated_at = NOW()
            FROM due_candidates dc
            WHERE cl.id = dc.id
            RETURNING cl.*
          )
          SELECT 
            cl.id, cl.campaign_id, cl.lead_id, cl.business_id, cl.status,
            cl.current_step, cl.next_step_id, cl.next_run_at, cl.started_at,
            cl.completed_at, cl.stopped_at, cl.last_error, cl.retry_count,
            cl.is_manual_override, cl.enrolled_at, cl.metadata, cl.created_at, cl.updated_at,
            c.id as c_id, c.business_id as c_business_id, c.name as c_name,
            c.description as c_description, c.status as c_status, c.timezone as c_timezone,
            c.settings as c_settings, c.created_at as c_created_at, c.updated_at as c_updated_at
          FROM claimed_rows cl
          JOIN campaigns c ON c.id = cl.campaign_id;
        `;

        const res = await this.queryFn<Record<string, unknown>>(atomicClaimSql, params);
        const items: DueEnrollmentItem[] = [];

        for (const row of res.rows) {
          const enrollment: CampaignEnrollment = {
            id: String(row.id),
            campaign_id: String(row.campaign_id),
            lead_id: String(row.lead_id),
            business_id: String(row.business_id),
            status: "RUNNING",
            current_step: Number(row.current_step || 0),
            next_step_id: row.next_step_id ? String(row.next_step_id) : null,
            next_run_at: row.next_run_at ? new Date(String(row.next_run_at)).toISOString() : null,
            started_at: row.started_at ? new Date(String(row.started_at)).toISOString() : new Date().toISOString(),
            completed_at: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
            stopped_at: row.stopped_at ? new Date(String(row.stopped_at)).toISOString() : null,
            last_error: row.last_error ? String(row.last_error) : null,
            retry_count: Number(row.retry_count || 0),
            is_manual_override: Boolean(row.is_manual_override),
            enrolled_at: row.enrolled_at ? new Date(String(row.enrolled_at)).toISOString() : new Date().toISOString(),
            metadata: (row.metadata as Record<string, unknown>) || {},
            created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          const campaign: Campaign = {
            id: String(row.c_id),
            business_id: String(row.c_business_id),
            name: String(row.c_name),
            description: row.c_description ? String(row.c_description) : null,
            status: String(row.c_status) as Campaign["status"],
            timezone: String(row.c_timezone || "UTC"),
            settings: (row.c_settings as Record<string, unknown>) || {},
            created_at: row.c_created_at ? new Date(String(row.c_created_at)).toISOString() : new Date().toISOString(),
            updated_at: row.c_updated_at ? new Date(String(row.c_updated_at)).toISOString() : new Date().toISOString(),
          };

          items.push({ enrollment, campaign });
        }

        return items;
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error("Database error in CampaignExecutionRepository.claimDueEnrollments:", {
          operation: "SELECT/CLAIM",
          table: "campaign_leads",
          code: dbErr?.code,
          message: dbErr?.message,
          businessId,
          campaignId,
        });
        if (this.useDatabase()) throw err;
      }
    }

    // Supabase PostgREST client fallback
    try {
      const admin = createAdminClient();
      const nowIso = new Date().toISOString();

      let queryBuilder = admin
        .from("campaign_leads")
        .select("*, campaigns!inner(*)")
        .in("status", ["ENROLLED", "RUNNING", "WAITING", "enrolled", "running", "waiting"])
        .not("next_run_at", "is", null)
        .lte("next_run_at", nowIso)
        .eq("campaigns.status", "ACTIVE")
        .order("next_run_at", { ascending: true })
        .limit(limit);

      if (businessId) {
        queryBuilder = queryBuilder.eq("business_id", businessId);
      }
      if (campaignId) {
        queryBuilder = queryBuilder.eq("campaign_id", campaignId);
      }

      const { data, error } = await queryBuilder;
      if (error) {
        console.error("PostgREST error in CampaignExecutionRepository.claimDueEnrollments:", error);
        if (this.useDatabase()) throw error;
      }
      if (data) {
        const claimed: DueEnrollmentItem[] = [];
        for (const item of data) {
          const rawCamp = (item as unknown as { campaigns: Campaign }).campaigns;
          // Claim update
          const { data: updated } = await admin
            .from("campaign_leads")
            .update({ status: "RUNNING", updated_at: nowIso })
            .eq("id", item.id)
            .select()
            .single();

          if (updated) {
            claimed.push({
              enrollment: updated as CampaignEnrollment,
              campaign: rawCamp,
            });
          }
        }
        return claimed;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    if (this.useDatabase()) {
      return [];
    }

    const localClaimed = LocalCampaignStore.claimDueEnrollments(limit, businessId, campaignId);
    return localClaimed as unknown as DueEnrollmentItem[];
  }

  /**
   * Retrieves a single enrollment by ID and business ID.
   */
  async findEnrollmentById(
    id: string,
    businessId?: string
  ): Promise<CampaignEnrollment | null> {
    if (this.useDatabase()) {
      try {
        const whereClauses = ["id = $1"];
        const params: unknown[] = [id];
        if (businessId) {
          whereClauses.push("business_id = $2");
          params.push(businessId);
        }

        const res = await this.queryFn<CampaignEnrollment>(
          `SELECT * FROM campaign_leads WHERE ${whereClauses.join(" AND ")};`,
          params
        );
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      let q = admin.from("campaign_leads").select("*").eq("id", id);
      if (businessId) q = q.eq("business_id", businessId);
      const { data, error } = await q.maybeSingle();
      if (!error && data) return data as CampaignEnrollment;
    } catch {
      // Fallback
    }

    const local = LocalCampaignStore.findEnrollmentById(id);
    if (local && (!businessId || local.business_id === businessId)) {
      return local;
    }

    return null;
  }

  /**
   * Updates an enrollment's execution state.
   */
  async updateEnrollment(
    id: string,
    updates: Partial<CampaignEnrollment>
  ): Promise<CampaignEnrollment> {
    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(updates.status);
        }
        if (updates.current_step !== undefined) {
          fields.push(`current_step = $${idx++}`);
          values.push(updates.current_step);
        }
        if (updates.next_step_id !== undefined) {
          fields.push(`next_step_id = $${idx++}`);
          values.push(updates.next_step_id);
        }
        if (updates.next_run_at !== undefined) {
          fields.push(`next_run_at = $${idx++}`);
          values.push(updates.next_run_at ? new Date(updates.next_run_at).toISOString() : null);
        }
        if (updates.started_at !== undefined) {
          fields.push(`started_at = $${idx++}`);
          values.push(updates.started_at ? new Date(updates.started_at).toISOString() : null);
        }
        if (updates.completed_at !== undefined) {
          fields.push(`completed_at = $${idx++}`);
          values.push(updates.completed_at ? new Date(updates.completed_at).toISOString() : null);
        }
        if (updates.stopped_at !== undefined) {
          fields.push(`stopped_at = $${idx++}`);
          values.push(updates.stopped_at ? new Date(updates.stopped_at).toISOString() : null);
        }
        if (updates.last_error !== undefined) {
          fields.push(`last_error = $${idx++}`);
          values.push(updates.last_error);
        }
        if (updates.retry_count !== undefined) {
          fields.push(`retry_count = $${idx++}`);
          values.push(updates.retry_count);
        }
        if (updates.is_manual_override !== undefined) {
          fields.push(`is_manual_override = $${idx++}`);
          values.push(Boolean(updates.is_manual_override));
        }
        if (updates.metadata !== undefined) {
          fields.push(`metadata = $${idx++}`);
          values.push(JSON.stringify(updates.metadata));
        }

        fields.push("updated_at = NOW()");
        values.push(id);

        const sql = `UPDATE campaign_leads SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
        const res = await this.queryFn<CampaignEnrollment>(sql, values);
        if (res.rows[0]) {
          return res.rows[0];
        }
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error("Database error in CampaignExecutionRepository.updateEnrollment:", {
          operation: "UPDATE",
          table: "campaign_leads",
          code: dbErr?.code,
          message: dbErr?.message,
          recordId: id,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const payload: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin
        .from("campaign_leads")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        console.error("PostgREST error in CampaignExecutionRepository.updateEnrollment:", error);
        if (this.useDatabase()) throw error;
      }
      if (data) {
        return data as CampaignEnrollment;
      }
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    const localUpdated = LocalCampaignStore.updateEnrollment(id, updates);
    if (localUpdated) return localUpdated;

    const fallback = await this.findEnrollmentById(id);
    if (!fallback) throw new Error(`Enrollment ${id} not found`);
    return { ...fallback, ...updates, updated_at: new Date().toISOString() };
  }

  /**
   * Initializes enrollments for a campaign when activated or newly enrolled.
   */
  async initializeEnrollmentsForCampaign(
    campaignId: string,
    businessId: string,
    firstStep: CampaignStep,
    initialNextRunAt: Date
  ): Promise<number> {
    const nextRunIso = initialNextRunAt.toISOString();

    if (this.useDatabase()) {
      try {
        const sql = `
          UPDATE campaign_leads
          SET current_step_id = COALESCE(current_step_id, $1),
              next_step_id = $1,
              next_run_at = $2,
              status = 'ENROLLED',
              updated_at = NOW()
          WHERE campaign_id = $3
            AND business_id = $4
            AND UPPER(status) = 'ENROLLED'
            AND next_step_id IS NULL
            AND (current_step = 0 OR current_step IS NULL);
        `;
        const res = await this.queryFn(sql, [
          firstStep.id,
          nextRunIso,
          campaignId,
          businessId,
        ]);
        return res.rowCount || 0;
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error("Database error in CampaignExecutionRepository.initializeEnrollmentsForCampaign:", {
          operation: "UPDATE",
          table: "campaign_leads",
          code: dbErr?.code,
          message: dbErr?.message,
          campaignId,
          businessId,
        });
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_leads")
        .update({
          next_step_id: firstStep.id,
          next_run_at: nextRunIso,
          status: "ENROLLED",
          updated_at: new Date().toISOString(),
        })
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId)
        .eq("status", "ENROLLED")
        .is("next_step_id", null)
        .or("current_step.eq.0,current_step.is.null")
        .select("id");

      if (error) {
        console.error("PostgREST error in CampaignExecutionRepository.initializeEnrollmentsForCampaign:", error);
        if (this.useDatabase()) throw error;
      }
      if (data) return data.length;
    } catch (err) {
      if (this.useDatabase()) throw err;
    }

    return LocalCampaignStore.initializeEnrollmentsForCampaign(
      campaignId,
      businessId,
      firstStep.id,
      nextRunIso
    );
  }

  /**
   * Resets failed enrollments back to ENROLLED for recovery when issues are resolved.
   */
  async resetFailedEnrollments(
    campaignId: string,
    businessId: string
  ): Promise<number> {
    if (this.useDatabase()) {
      try {
        const sql = `
          UPDATE campaign_leads
          SET status = CASE WHEN current_step > 0 THEN 'WAITING' ELSE 'ENROLLED' END,
              next_run_at = NOW(),
              last_error = NULL,
              retry_count = 0,
              stopped_at = NULL,
              updated_at = NOW()
          WHERE campaign_id = $1
            AND business_id = $2
            AND UPPER(status) = 'FAILED';
        `;
        const res = await this.queryFn(sql, [campaignId, businessId]);
        return res.rowCount || 0;
      } catch (err: unknown) {
        if (this.useDatabase()) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_leads")
        .update({
          status: "ENROLLED",
          next_run_at: new Date().toISOString(),
          last_error: null,
          retry_count: 0,
          stopped_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId)
        .ilike("status", "failed")
        .select("id");
      if (!error && data) return data.length;
    } catch {
      // Fallback
    }

    const items = LocalCampaignStore.findEnrollments(campaignId, "FAILED");
    let count = 0;
    for (const item of items) {
      if (item.business_id === businessId) {
        LocalCampaignStore.updateEnrollment(item.id, {
          status: (item.current_step && item.current_step > 0) ? "WAITING" : "ENROLLED",
          next_run_at: new Date().toISOString(),
          last_error: null,
          retry_count: 0,
          stopped_at: null,
        });
        count++;
      }
    }
    return count;
  }

  /**
   * Resets a specific failed enrollment by its ID for immediate retry.
   */
  async resetFailedEnrollment(enrollmentId: string, businessId?: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const whereClauses = ["id = $1", "UPPER(status) = 'FAILED'"];
        const params: unknown[] = [enrollmentId];
        if (businessId) {
          whereClauses.push("business_id = $2");
          params.push(businessId);
        }

        const sql = `
          UPDATE campaign_leads
          SET status = CASE WHEN current_step > 0 THEN 'WAITING' ELSE 'ENROLLED' END,
              next_run_at = NOW(),
              last_error = NULL,
              retry_count = 0,
              stopped_at = NULL,
              updated_at = NOW()
          WHERE ${whereClauses.join(" AND ")};
        `;
        const res = await this.queryFn(sql, params);
        return (res.rowCount || 0) > 0;
      } catch (err: unknown) {
        if (this.useDatabase()) throw err;
      }
    }

    const item = LocalCampaignStore.findEnrollmentById(enrollmentId);
    if (item && (!businessId || item.business_id === businessId) && item.status.toUpperCase() === "FAILED") {
      LocalCampaignStore.updateEnrollment(item.id, {
        status: (item.current_step && item.current_step > 0) ? "WAITING" : "ENROLLED",
        next_run_at: new Date().toISOString(),
        last_error: null,
        retry_count: 0,
        stopped_at: null,
      });
      return true;
    }
    return false;
  }


  /**
   * Creates an execution log record for auditing and idempotency guarantees.
   */
  async createExecutionLog(
    data: Omit<CampaignExecutionLog, "id" | "created_at"> & { id?: string }
  ): Promise<CampaignExecutionLog> {
    const id = data.id || crypto.randomUUID();
    const nowIso = new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO campaign_execution_logs (
            id, business_id, campaign_id, campaign_step_id, enrollment_id,
            lead_id, email_message_id, attempt_number, status, idempotency_key,
            error, created_at, completed_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12
          ) RETURNING *;
        `;
        const params = [
          id,
          data.business_id,
          data.campaign_id,
          data.campaign_step_id,
          data.enrollment_id,
          data.lead_id,
          data.email_message_id || null,
          data.attempt_number || 1,
          data.status || "PENDING",
          data.idempotency_key,
          data.error || null,
          data.completed_at ? new Date(data.completed_at).toISOString() : null,
        ];
        const res = await this.queryFn<CampaignExecutionLog>(sql, params);
        if (res.rows[0]) return res.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: created, error } = await admin
        .from("campaign_execution_logs")
        .insert({
          id,
          business_id: data.business_id,
          campaign_id: data.campaign_id,
          campaign_step_id: data.campaign_step_id,
          enrollment_id: data.enrollment_id,
          lead_id: data.lead_id,
          email_message_id: data.email_message_id || null,
          attempt_number: data.attempt_number || 1,
          status: data.status || "PENDING",
          idempotency_key: data.idempotency_key,
          error: data.error || null,
          created_at: nowIso,
          completed_at: data.completed_at || null,
        })
        .select()
        .single();

      if (!error && created) return created as CampaignExecutionLog;
    } catch {
      // Fallback
    }

    const fallback: CampaignExecutionLog = {
      id,
      business_id: data.business_id,
      campaign_id: data.campaign_id,
      campaign_step_id: data.campaign_step_id,
      enrollment_id: data.enrollment_id,
      lead_id: data.lead_id,
      email_message_id: data.email_message_id || null,
      attempt_number: data.attempt_number || 1,
      status: (data.status as ExecutionLogStatus) || "PENDING",
      idempotency_key: data.idempotency_key,
      error: data.error || null,
      created_at: nowIso,
      completed_at: data.completed_at || null,
    };
    return LocalExecutionLogStore.insert(fallback);
  }

  /**
   * Finds an execution log by unique idempotency key.
   */
  async findExecutionLogByIdempotencyKey(
    key: string
  ): Promise<CampaignExecutionLog | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignExecutionLog>(
          "SELECT * FROM campaign_execution_logs WHERE idempotency_key = $1;",
          [key]
        );
        return res.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_execution_logs")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (!error && data) return data as CampaignExecutionLog;
    } catch {
      // Fallback
    }

    return LocalExecutionLogStore.getByIdempotencyKey(key);
  }

  /**
   * Updates an execution log record.
   */
  async updateExecutionLog(
    id: string,
    updates: Partial<CampaignExecutionLog>
  ): Promise<CampaignExecutionLog> {
    if (this.useDatabase()) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.status !== undefined) {
          fields.push(`status = $${idx++}`);
          values.push(updates.status);
        }
        if (updates.email_message_id !== undefined) {
          fields.push(`email_message_id = $${idx++}`);
          values.push(updates.email_message_id);
        }
        if (updates.error !== undefined) {
          fields.push(`error = $${idx++}`);
          values.push(updates.error);
        }
        if (updates.completed_at !== undefined) {
          fields.push(`completed_at = $${idx++}`);
          values.push(updates.completed_at ? new Date(updates.completed_at).toISOString() : null);
        }

        values.push(id);
        const sql = `UPDATE campaign_execution_logs SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
        const res = await this.queryFn<CampaignExecutionLog>(sql, values);
        if (res.rows[0]) return res.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_execution_logs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (!error && data) return data as CampaignExecutionLog;
    } catch {
      // Fallback
    }

    const local = LocalExecutionLogStore.update(id, updates);
    if (local) return local;

    return {
      id,
      business_id: "",
      campaign_id: "",
      campaign_step_id: "",
      enrollment_id: "",
      lead_id: "",
      email_message_id: updates.email_message_id || null,
      attempt_number: 1,
      status: (updates.status as ExecutionLogStatus) || "SUCCESS",
      idempotency_key: "",
      error: updates.error || null,
      created_at: new Date().toISOString(),
      completed_at: updates.completed_at ? new Date(updates.completed_at).toISOString() : null,
    };
  }

  /**
   * Computes execution statistics for a campaign.
   */
  async getExecutionSummary(
    campaignId: string,
    businessId: string
  ): Promise<CampaignExecutionSummary> {
    const statusCounts: Record<string, number> = {
      ENROLLED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      PAUSED: 0,
      STOPPED: 0,
      FAILED: 0,
    };
    let nextScheduledAt: string | null = null;
    let campaignStatus = "DRAFT";

    if (this.useDatabase()) {
      try {
        const campRes = await this.queryFn<{ status: string }>(
          "SELECT status FROM campaigns WHERE id = $1 AND business_id = $2;",
          [campaignId, businessId]
        );
        if (campRes.rows[0]) {
          campaignStatus = String(campRes.rows[0].status).toUpperCase();
        }

        const countsRes = await this.queryFn<{ status: string; count: string }>(
          `SELECT UPPER(status) as status, COUNT(*) as count 
           FROM campaign_leads 
           WHERE campaign_id = $1 AND business_id = $2 
           GROUP BY UPPER(status);`,
          [campaignId, businessId]
        );
        for (const row of countsRes.rows) {
          const st = row.status.toUpperCase();
          if (statusCounts[st] !== undefined) {
            statusCounts[st] = parseInt(row.count, 10);
          }
        }

        const nextRes = await this.queryFn<{ next_run_at: string }>(
          `SELECT next_run_at FROM campaign_leads 
           WHERE campaign_id = $1 AND business_id = $2 
             AND UPPER(status) IN ('ENROLLED', 'RUNNING') 
             AND next_run_at IS NOT NULL 
           ORDER BY next_run_at ASC LIMIT 1;`,
          [campaignId, businessId]
        );
        if (nextRes.rows[0]?.next_run_at) {
          nextScheduledAt = new Date(nextRes.rows[0].next_run_at).toISOString();
        }

        const totalEnrolled =
          statusCounts.ENROLLED +
          statusCounts.RUNNING +
          statusCounts.COMPLETED +
          statusCounts.PAUSED +
          statusCounts.STOPPED +
          statusCounts.FAILED;

        return {
          campaignId,
          campaignStatus,
          totalEnrolled,
          running: statusCounts.RUNNING + statusCounts.ENROLLED,
          completed: statusCounts.COMPLETED,
          paused: statusCounts.PAUSED,
          stopped: statusCounts.STOPPED,
          failed: statusCounts.FAILED,
          nextScheduledAt,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: camp } = await admin
        .from("campaigns")
        .select("status")
        .eq("id", campaignId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (camp) campaignStatus = String(camp.status).toUpperCase();

      const { data: enrollments } = await admin
        .from("campaign_leads")
        .select("status, next_run_at")
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId);

      if (enrollments) {
        for (const e of enrollments) {
          const st = String(e.status).toUpperCase();
          if (statusCounts[st] !== undefined) statusCounts[st]++;
          if (
            (st === "ENROLLED" || st === "RUNNING") &&
            e.next_run_at &&
            (!nextScheduledAt || new Date(e.next_run_at) < new Date(nextScheduledAt))
          ) {
            nextScheduledAt = new Date(e.next_run_at).toISOString();
          }
        }
      }
    } catch {
      // Fallback
    }

    const totalEnrolled =
      statusCounts.ENROLLED +
      statusCounts.RUNNING +
      statusCounts.COMPLETED +
      statusCounts.PAUSED +
      statusCounts.STOPPED +
      statusCounts.FAILED;

    return {
      campaignId,
      campaignStatus,
      totalEnrolled,
      running: statusCounts.RUNNING + statusCounts.ENROLLED,
      completed: statusCounts.COMPLETED,
      paused: statusCounts.PAUSED,
      stopped: statusCounts.STOPPED,
      failed: statusCounts.FAILED,
      nextScheduledAt,
    };
  }

  /**
   * Lists execution logs for a campaign.
   */
  async listExecutionLogs(
    campaignId: string,
    businessId: string,
    limit = 50
  ): Promise<CampaignExecutionLog[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<CampaignExecutionLog>(
          `SELECT * FROM campaign_execution_logs 
           WHERE campaign_id = $1 AND business_id = $2 
           ORDER BY created_at DESC LIMIT $3;`,
          [campaignId, businessId, limit]
        );
        return res.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_execution_logs")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!error && data) return data as CampaignExecutionLog[];
    } catch {
      // Fallback
    }

    return LocalExecutionLogStore.listByCampaign(campaignId, limit);
  }
}
