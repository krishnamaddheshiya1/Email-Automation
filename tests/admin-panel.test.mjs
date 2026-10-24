import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { maskSecret } from "../lib/security/error-handler.ts";

/**
 * AdminService implementation for in-memory ESM test harness
 */
class AdminService {
  constructor(queryFn) {
    this.queryFn = queryFn;
  }

  async requireAdmin(supabase) {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return {
        authorized: false,
        status: 401,
        error: "Unauthorized. Authentication required.",
      };
    }

    let role = (authUser.app_metadata?.role || authUser.user_metadata?.role || "").toLowerCase();
    let status = "active";
    let businessId = authUser.app_metadata?.business_id || authUser.user_metadata?.business_id || "";
    let fullName = authUser.user_metadata?.full_name || authUser.email || "Admin User";
    let email = authUser.email || "";

    if (this.queryFn) {
      try {
        const userRes = await this.queryFn(
          `SELECT role, status, business_id, full_name, email FROM users WHERE id = $1;`,
          [authUser.id]
        );

        if (userRes.rows.length > 0) {
          const row = userRes.rows[0];
          role = (row.role || "").toLowerCase();
          status = (row.status || "active").toLowerCase();
          businessId = row.business_id || businessId;
          fullName = row.full_name || fullName;
          email = row.email || email;

          if (status !== "active") {
            return {
              authorized: false,
              status: 403,
              error: "Forbidden. Account is inactive or suspended.",
            };
          }
        }
      } catch (err) {
        console.warn("[AdminService] Database lookup fallback in requireAdmin:", err);
      }
    }

    if (role !== "admin" && role !== "owner") {
      return {
        authorized: false,
        status: 403,
        error: "Forbidden. Administrator privileges required.",
      };
    }

    const session = {
      user: {
        id: authUser.id,
        email,
        role,
        status,
        business_id: businessId,
        full_name: fullName,
        created_at: authUser.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      business: {
        id: businessId,
        name: "Admin Workspace",
        timezone: "UTC",
        status: "active",
        settings: {},
        industry: null,
        website: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      authUser: {
        id: authUser.id,
        email: authUser.email,
      },
    };

    return {
      authorized: true,
      status: 200,
      session,
    };
  }

  async getPlatformOverview() {
    const [
      usersRes,
      workspacesRes,
      contactsRes,
      campaignsRes,
      emailsRes,
      repliesRes,
    ] = await Promise.all([
      this.queryFn(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active,
          COUNT(CASE WHEN LOWER(role) IN ('admin', 'owner') THEN 1 END)::text AS admins,
          COUNT(CASE WHEN LOWER(role) NOT IN ('admin', 'owner') THEN 1 END)::text AS members
        FROM users;
      `),
      this.queryFn(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active
        FROM businesses;
      `),
      this.queryFn(`
        SELECT COUNT(*)::text AS total FROM leads;
      `),
      this.queryFn(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active,
          COUNT(CASE WHEN LOWER(status) = 'draft' THEN 1 END)::text AS draft,
          COUNT(CASE WHEN LOWER(status) = 'completed' THEN 1 END)::text AS completed
        FROM campaigns;
      `),
      this.queryFn(`
        SELECT 
          COUNT(*)::text AS sent,
          COUNT(CASE WHEN LOWER(status) = 'delivered' OR delivered_at IS NOT NULL THEN 1 END)::text AS delivered,
          COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL THEN 1 END)::text AS opened,
          COUNT(CASE WHEN LOWER(status) = 'bounced' OR bounced_at IS NOT NULL THEN 1 END)::text AS bounced,
          COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END)::text AS failed
        FROM email_messages;
      `),
      this.queryFn(`
        SELECT COUNT(*)::text AS total FROM conversations;
      `),
    ]);

    const u = usersRes.rows[0] || { total: "0", active: "0", admins: "0", members: "0" };
    const w = workspacesRes.rows[0] || { total: "0", active: "0" };
    const ct = contactsRes.rows[0] || { total: "0" };
    const c = campaignsRes.rows[0] || { total: "0", active: "0", draft: "0", completed: "0" };
    const em = emailsRes.rows[0] || { sent: "0", delivered: "0", opened: "0", bounced: "0", failed: "0" };
    const r = repliesRes.rows[0] || { total: "0" };

    return {
      users: {
        total: parseInt(u.total, 10) || 0,
        active: parseInt(u.active, 10) || 0,
        admins: parseInt(u.admins, 10) || 0,
        members: parseInt(u.members, 10) || 0,
      },
      workspaces: {
        total: parseInt(w.total, 10) || 0,
        active: parseInt(w.active, 10) || 0,
      },
      contacts: {
        total: parseInt(ct.total, 10) || 0,
      },
      campaigns: {
        total: parseInt(c.total, 10) || 0,
        active: parseInt(c.active, 10) || 0,
        draft: parseInt(c.draft, 10) || 0,
        completed: parseInt(c.completed, 10) || 0,
      },
      emails: {
        sent: parseInt(em.sent, 10) || 0,
        delivered: parseInt(em.delivered, 10) || 0,
        opened: parseInt(em.opened, 10) || 0,
        bounced: parseInt(em.bounced, 10) || 0,
        replies: parseInt(r.total, 10) || 0,
        failed: parseInt(em.failed, 10) || 0,
      },
    };
  }

  async listUsers(params = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const values = [];
    let idx = 1;

    if (params.search?.trim()) {
      whereClauses.push(`(u.email ILIKE $${idx} OR u.full_name ILIKE $${idx} OR b.name ILIKE $${idx})`);
      values.push(`%${params.search.trim()}%`);
      idx++;
    }

    if (params.role?.trim() && params.role !== "all") {
      whereClauses.push(`LOWER(u.role) = LOWER($${idx})`);
      values.push(params.role.trim());
      idx++;
    }

    if (params.status?.trim() && params.status !== "all") {
      whereClauses.push(`LOWER(u.status) = LOWER($${idx})`);
      values.push(params.status.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn(
      `SELECT COUNT(*)::text AS count FROM users u LEFT JOIN businesses b ON b.id = u.business_id ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn(
      `
      SELECT 
        u.id,
        u.business_id,
        COALESCE(b.name, 'Unassigned') AS workspace_name,
        u.email,
        u.full_name,
        u.role,
        u.status,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
      `,
      queryValues
    );

    return {
      users: dataRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async updateUser(adminUser, targetUserId, patch, ipAddress) {
    const existingRes = await this.queryFn(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error("Target user not found.");
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (patch.status) {
      const normStatus = patch.status.toLowerCase();
      if (!["active", "inactive", "invited"].includes(normStatus)) {
        throw new Error("Invalid status. Allowed: active, inactive, invited");
      }
      updates.push(`status = $${idx++}`);
      values.push(normStatus);
    }

    if (patch.role) {
      const normRole = patch.role.toLowerCase();
      if (!["owner", "admin", "member", "viewer"].includes(normRole)) {
        throw new Error("Invalid role. Allowed: owner, admin, member, viewer");
      }
      updates.push(`role = $${idx++}`);
      values.push(normRole);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    values.push(targetUserId);

    const updateSql = `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *;`;
    const res = await this.queryFn(updateSql, values);
    const updated = res.rows[0] || null;

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_UPDATE",
      "user",
      targetUserId,
      `Updated user ${existing.email} (Status: ${patch.status || existing.status}, Role: ${patch.role || existing.role})`,
      { previous: { status: existing.status, role: existing.role }, updated: patch },
      ipAddress
    );

    return updated;
  }

  async listWorkspaces(params = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const values = [];
    let idx = 1;

    if (params.search?.trim()) {
      whereClauses.push(`b.name ILIKE $${idx}`);
      values.push(`%${params.search.trim()}%`);
      idx++;
    }

    if (params.status?.trim() && params.status !== "all") {
      whereClauses.push(`LOWER(b.status) = LOWER($${idx})`);
      values.push(params.status.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn(
      `SELECT COUNT(*)::text AS count FROM businesses b ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn(
      `
      SELECT 
        b.id,
        b.name,
        b.status,
        b.timezone,
        b.created_at
      FROM businesses b
      ${whereSql}
      ORDER BY b.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
      `,
      queryValues
    );

    const businessRows = dataRes.rows;
    const businessIds = businessRows.map((b) => b.id);

    const contactsMap = new Map();
    const campaignsMap = new Map();
    const membersMap = new Map();
    const ownerMap = new Map();

    if (businessIds.length > 0) {
      const idPlaceholders = businessIds.map((_, i) => `$${i + 1}`).join(", ");
      const [leadsRes, campsRes, usersRes, ownersRes] = await Promise.all([
        this.queryFn(
          `SELECT business_id, COUNT(*)::text AS count FROM leads WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn(
          `SELECT business_id, COUNT(*)::text AS count FROM campaigns WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn(
          `SELECT business_id, COUNT(*)::text AS count FROM users WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn(
          `SELECT business_id, full_name, email FROM users WHERE business_id IN (${idPlaceholders}) AND LOWER(role) IN ('owner', 'admin') ORDER BY created_at ASC;`,
          businessIds
        ),
      ]);

      leadsRes.rows.forEach((r) => contactsMap.set(r.business_id, parseInt(r.count, 10) || 0));
      campsRes.rows.forEach((r) => campaignsMap.set(r.business_id, parseInt(r.count, 10) || 0));
      usersRes.rows.forEach((r) => membersMap.set(r.business_id, parseInt(r.count, 10) || 0));
      ownersRes.rows.forEach((r) => {
        if (!ownerMap.has(r.business_id)) {
          ownerMap.set(r.business_id, { name: r.full_name, email: r.email });
        }
      });
    }

    const workspaces = businessRows.map((r) => {
      const owner = ownerMap.get(r.id);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        timezone: r.timezone,
        owner_name: owner?.name || null,
        owner_email: owner?.email || null,
        contacts_count: contactsMap.get(r.id) || 0,
        campaigns_count: campaignsMap.get(r.id) || 0,
        members_count: membersMap.get(r.id) || 0,
        created_at: r.created_at,
      };
    });

    return {
      workspaces,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async updateWorkspace(adminUser, workspaceId, patch, ipAddress) {
    const existingRes = await this.queryFn(
      `SELECT id, name, status FROM businesses WHERE id = $1;`,
      [workspaceId]
    );

    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error("Target workspace not found.");
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (patch.status) {
      updates.push(`status = $${idx++}`);
      values.push(patch.status.toLowerCase());
    }

    if (patch.name?.trim()) {
      updates.push(`name = $${idx++}`);
      values.push(patch.name.trim());
    }

    if (updates.length === 0) return true;

    updates.push(`updated_at = NOW()`);
    values.push(workspaceId);

    await this.queryFn(`UPDATE businesses SET ${updates.join(", ")} WHERE id = $${idx};`, values);

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "WORKSPACE_UPDATE",
      "workspace",
      workspaceId,
      `Updated workspace ${existing.name} (Status: ${patch.status || existing.status})`,
      { previous: existing, patch },
      ipAddress
    );

    return true;
  }

  async listCampaigns(params = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const values = [];
    let idx = 1;

    if (params.search?.trim()) {
      whereClauses.push(`(c.name ILIKE $${idx} OR b.name ILIKE $${idx})`);
      values.push(`%${params.search.trim()}%`);
      idx++;
    }

    if (params.status?.trim() && params.status !== "all") {
      whereClauses.push(`LOWER(c.status) = LOWER($${idx})`);
      values.push(params.status.trim());
      idx++;
    }

    if (params.businessId?.trim()) {
      whereClauses.push(`c.business_id = $${idx}`);
      values.push(params.businessId.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn(
      `SELECT COUNT(*)::text AS count FROM campaigns c LEFT JOIN businesses b ON b.id = c.business_id ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn(
      `
      SELECT 
        c.id,
        c.business_id,
        COALESCE(b.name, 'Unassigned') AS workspace_name,
        c.name,
        c.status,
        c.timezone,
        c.created_at
      FROM campaigns c
      LEFT JOIN businesses b ON b.id = c.business_id
      ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
      `,
      queryValues
    );

    const campaignRows = dataRes.rows;
    const campaignIds = campaignRows.map((c) => c.id);

    const metricsMap = new Map();

    if (campaignIds.length > 0) {
      const idPlaceholders = campaignIds.map((_, i) => `$${i + 1}`).join(", ");
      const [messagesRes, convosRes] = await Promise.all([
        this.queryFn(
          `
          SELECT 
            campaign_id,
            COUNT(*)::text AS sent_count,
            COUNT(CASE WHEN LOWER(status) = 'delivered' OR delivered_at IS NOT NULL THEN 1 END)::text AS delivered_count,
            COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL THEN 1 END)::text AS opened_count,
            COUNT(CASE WHEN LOWER(status) = 'bounced' OR bounced_at IS NOT NULL THEN 1 END)::text AS bounced_count
          FROM email_messages
          WHERE campaign_id IN (${idPlaceholders})
          GROUP BY campaign_id;
          `,
          campaignIds
        ),
        this.queryFn(
          `
          SELECT campaign_id, COUNT(*)::text AS replies_count
          FROM conversations
          WHERE campaign_id IN (${idPlaceholders})
          GROUP BY campaign_id;
          `,
          campaignIds
        ),
      ]);

      for (const r of messagesRes.rows) {
        metricsMap.set(r.campaign_id, {
          sent: parseInt(r.sent_count, 10) || 0,
          delivered: parseInt(r.delivered_count, 10) || 0,
          opened: parseInt(r.opened_count, 10) || 0,
          bounced: parseInt(r.bounced_count, 10) || 0,
          replies: 0,
        });
      }

      for (const r of convosRes.rows) {
        const existing = metricsMap.get(r.campaign_id) || {
          sent: 0,
          delivered: 0,
          opened: 0,
          bounced: 0,
          replies: 0,
        };
        existing.replies = parseInt(r.replies_count, 10) || 0;
        metricsMap.set(r.campaign_id, existing);
      }
    }

    const campaigns = campaignRows.map((r) => {
      const m = metricsMap.get(r.id) || { sent: 0, delivered: 0, opened: 0, bounced: 0, replies: 0 };
      return {
        id: r.id,
        business_id: r.business_id,
        workspace_name: r.workspace_name,
        name: r.name,
        status: r.status,
        timezone: r.timezone,
        created_at: r.created_at,
        sent_count: m.sent,
        delivered_count: m.delivered,
        opened_count: m.opened,
        bounced_count: m.bounced,
        replies_count: m.replies,
      };
    });

    return {
      campaigns,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async listEmailProviders() {
    const res = await this.queryFn(`
      SELECT 
        ep.id,
        ep.business_id,
        COALESCE(b.name, 'Unassigned') AS workspace_name,
        ep.provider,
        ep.status,
        ep.encrypted_api_key,
        ep.created_at
      FROM email_providers ep
      LEFT JOIN businesses b ON b.id = ep.business_id
      ORDER BY ep.created_at DESC;
    `);

    const providerRows = res.rows;
    const businessIds = Array.from(new Set(providerRows.map((p) => p.business_id)));

    const senderCountsMap = new Map();
    if (businessIds.length > 0) {
      const idPlaceholders = businessIds.map((_, i) => `$${i + 1}`).join(", ");
      const senderRes = await this.queryFn(
        `SELECT business_id, COUNT(*)::text AS count FROM sender_identities WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
        businessIds
      );
      senderRes.rows.forEach((r) => senderCountsMap.set(r.business_id, parseInt(r.count, 10) || 0));
    }

    return providerRows.map((r) => ({
      id: r.id,
      business_id: r.business_id,
      workspace_name: r.workspace_name,
      provider: r.provider,
      status: r.status,
      is_configured: Boolean(r.encrypted_api_key),
      masked_key: maskSecret(r.encrypted_api_key),
      sender_identities_count: senderCountsMap.get(r.business_id) || 0,
      created_at: r.created_at,
    }));
  }

  async getSystemHealth() {
    const start = Date.now();
    let dbConnected = false;
    let latencyMs = 0;
    const tableCounts = {};

    try {
      await this.queryFn("SELECT 1;");
      dbConnected = true;
      latencyMs = Date.now() - start;

      const tables = [
        "users",
        "businesses",
        "leads",
        "campaigns",
        "email_messages",
        "email_events",
        "conversations",
        "attachments",
        "admin_audit_logs",
      ];

      for (const t of tables) {
        try {
          const r = await this.queryFn(`SELECT COUNT(*)::text AS count FROM ${t};`);
          tableCounts[t] = parseInt(r.rows[0]?.count || "0", 10);
        } catch {
          tableCounts[t] = 0;
        }
      }
    } catch {
      dbConnected = false;
      latencyMs = Date.now() - start;
    }

    const mem = process.memoryUsage();

    return {
      status: dbConnected ? "healthy" : "unhealthy",
      database: {
        connected: dbConnected,
        latency_ms: latencyMs,
        table_counts: tableCounts,
      },
      environment: {
        node_version: process.version,
        uptime_seconds: Math.floor(process.uptime()),
        memory_usage_mb: Math.round(mem.rss / 1024 / 1024),
        supabase_configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        resend_configured: Boolean(process.env.RESEND_API_KEY),
      },
    };
  }

  async listAuditLogs(params = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const values = [];
    let idx = 1;

    if (params.action?.trim() && params.action !== "all") {
      whereClauses.push(`action = $${idx}`);
      values.push(params.action.trim());
      idx++;
    }

    if (params.targetResource?.trim() && params.targetResource !== "all") {
      whereClauses.push(`target_resource = $${idx}`);
      values.push(params.targetResource.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn(
      `SELECT COUNT(*)::text AS count FROM admin_audit_logs ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn(
      `
      SELECT 
        id,
        admin_user_id,
        admin_email,
        action,
        target_resource,
        target_id,
        details,
        metadata,
        ip_address,
        created_at
      FROM admin_audit_logs
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
      `,
      queryValues
    );

    return {
      logs: dataRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async logAction(
    adminUserId,
    adminEmail,
    action,
    targetResource,
    targetId,
    details,
    metadata = {},
    ipAddress
  ) {
    try {
      const id = crypto.randomUUID();
      await this.queryFn(
        `
        INSERT INTO admin_audit_logs (
          id, admin_user_id, admin_email, action, target_resource, target_id, details, metadata, ip_address, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW());
        `,
        [
          id,
          adminUserId,
          adminEmail,
          action,
          targetResource,
          targetId || null,
          details || null,
          JSON.stringify(metadata),
          ipAddress || null,
        ]
      );
    } catch (err) {
      console.error("[AdminService] Failed to record admin audit log:", err);
    }
  }
}

test("Admin Panel & Server-Side Authorization Test Suite", async (t) => {
  const { db } = createTestDb();

  // Create PostgreSQL query adapter for pg-mem in-memory testing
  const queryFn = async (text, params = []) => {
    let parameterized = text;
    if (params && params.length > 0) {
      params.forEach((param, i) => {
        let val;
        if (param === null || param === undefined) {
          val = "NULL";
        } else if (typeof param === "number" || typeof param === "boolean") {
          val = String(param);
        } else {
          val = `'${String(param).replace(/'/g, "''")}'`;
        }
        parameterized = parameterized.replace(new RegExp(`\\$${i + 1}\\b`, "g"), val);
      });
    }
    const cleanSql = parameterized.trim();
    if (cleanSql.toUpperCase().startsWith("SELECT") || cleanSql.toUpperCase().includes("RETURNING")) {
      const rows = db.public.many(cleanSql) || [];
      return { rows, rowCount: rows.length };
    } else {
      db.public.none(cleanSql);
      return { rows: [], rowCount: 1 };
    }
  };

  const adminService = new AdminService(queryFn);

  // Setup test fixtures: Workspace A and Workspace B
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();

  // Create Workspaces
  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status, settings)
    VALUES 
      ('${bizAId}', 'Acme Global Corp', 'America/New_York', 'active', '{}'),
      ('${bizBId}', 'Beta Logistics Ltd', 'UTC', 'active', '{}');
  `);

  // Create Users:
  // 1. Owner of Workspace A
  // 2. Admin of Workspace A
  // 3. Normal Member of Workspace A
  // 4. Normal Member of Workspace B
  const ownerAId = crypto.randomUUID();
  const adminAId = crypto.randomUUID();
  const memberAId = crypto.randomUUID();
  const memberBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO users (id, business_id, email, full_name, role, status)
    VALUES 
      ('${ownerAId}', '${bizAId}', 'owner@acme.com', 'Acme Owner', 'owner', 'active'),
      ('${adminAId}', '${bizAId}', 'admin@acme.com', 'Acme Admin', 'admin', 'active'),
      ('${memberAId}', '${bizAId}', 'member@acme.com', 'Acme Member', 'member', 'active'),
      ('${memberBId}', '${bizBId}', 'member@beta.com', 'Beta Member', 'member', 'active');
  `);

  // Mock Supabase clients simulating session authentication
  function createMockSupabase(userId, email, role, businessId) {
    return {
      auth: {
        getUser: async () => {
          if (!userId) {
            return { data: { user: null }, error: { message: "No active session" } };
          }
          return {
            data: {
              user: {
                id: userId,
                email: email,
                role: role,
                app_metadata: { role: role, business_id: businessId },
                user_metadata: { full_name: "Test User", role: role },
              },
            },
            error: null,
          };
        },
      },
    };
  }

  // -------------------------------------------------------------
  // 1. Server-Side Admin Authorization (requireAdmin)
  // -------------------------------------------------------------
  await t.test("1. Server-Side Admin Authorization: Rejects unauthenticated callers (401)", async () => {
    const unauthenticatedClient = createMockSupabase(null, null, null, null);
    const result = await adminService.requireAdmin(unauthenticatedClient);

    assert.equal(result.authorized, false, "Unauthenticated caller must NOT be authorized");
    assert.equal(result.status, 401, "Must return status 401 Unauthorized");
    assert.ok(result.error?.includes("Authentication required"));
  });

  await t.test("2. Server-Side Admin Authorization: Rejects normal members and non-admins (403)", async () => {
    const memberClient = createMockSupabase(memberAId, "member@acme.com", "member", bizAId);
    const result = await adminService.requireAdmin(memberClient);

    assert.equal(result.authorized, false, "Normal member MUST NOT be authorized for admin area");
    assert.equal(result.status, 403, "Must return status 403 Forbidden");
    assert.ok(result.error?.includes("Administrator privileges required"));
  });

  await t.test("3. Server-Side Admin Authorization: Rejects viewers (403)", async () => {
    const viewerClient = createMockSupabase(crypto.randomUUID(), "viewer@acme.com", "viewer", bizAId);
    const result = await adminService.requireAdmin(viewerClient);

    assert.equal(result.authorized, false, "Viewer role MUST NOT access admin area");
    assert.equal(result.status, 403, "Must return 403 Forbidden");
  });

  await t.test("4. Server-Side Admin Authorization: Grants access to admin role (200)", async () => {
    const adminClient = createMockSupabase(adminAId, "admin@acme.com", "admin", bizAId);
    const result = await adminService.requireAdmin(adminClient);

    assert.equal(result.authorized, true, "Admin user must be authorized");
    assert.equal(result.status, 200);
    assert.ok(result.session);
    assert.equal(result.session.user.id, adminAId);
  });

  await t.test("5. Server-Side Admin Authorization: Grants access to owner role (200)", async () => {
    const ownerClient = createMockSupabase(ownerAId, "owner@acme.com", "owner", bizAId);
    const result = await adminService.requireAdmin(ownerClient);

    assert.equal(result.authorized, true, "Owner user must be authorized");
    assert.equal(result.status, 200);
  });

  // -------------------------------------------------------------
  // 2. Platform Overview & Real Database Aggregation
  // -------------------------------------------------------------
  await t.test("6. Platform Overview returns real aggregated counts from database", async () => {
    const lead1Id = crypto.randomUUID();
    const lead2Id = crypto.randomUUID();
    const camp1Id = crypto.randomUUID();
    const camp2Id = crypto.randomUUID();
    const msg1Id = crypto.randomUUID();
    const msg2Id = crypto.randomUUID();
    const convoId = crypto.randomUUID();

    db.public.none(`
      INSERT INTO leads (id, business_id, email, first_name, status)
      VALUES 
        ('${lead1Id}', '${bizAId}', 'contact1@domain.com', 'Contact One', 'new'),
        ('${lead2Id}', '${bizBId}', 'contact2@domain.com', 'Contact Two', 'new');

      INSERT INTO campaigns (id, business_id, name, status, timezone)
      VALUES 
        ('${camp1Id}', '${bizAId}', 'Acme Campaign', 'active', 'America/New_York'),
        ('${camp2Id}', '${bizBId}', 'Beta Campaign', 'draft', 'UTC');

      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, direction, status, delivered_at, opened_at)
      VALUES 
        ('${msg1Id}', '${bizAId}', '${lead1Id}', '${camp1Id}', 'sender@acme.com', 'contact1@domain.com', 'Subject 1', 'Body 1', 'outbound', 'opened', NOW(), NOW()),
        ('${msg2Id}', '${bizBId}', '${lead2Id}', '${camp2Id}', 'sender@beta.com', 'contact2@domain.com', 'Subject 2', 'Body 2', 'outbound', 'delivered', NOW(), NULL);

      INSERT INTO conversations (id, business_id, lead_id, campaign_id, subject, status)
      VALUES 
        ('${convoId}', '${bizAId}', '${lead1Id}', '${camp1Id}', 'Re: Hello', 'active');
    `);

    const overview = await adminService.getPlatformOverview();

    assert.equal(overview.users.total, 4, "Total users across workspaces must be 4");
    assert.equal(overview.users.active, 4, "All 4 users are active");
    assert.equal(overview.users.admins, 2, "Owner and Admin count as platform admins");
    assert.equal(overview.users.members, 2, "2 normal members");

    assert.equal(overview.workspaces.total, 2, "2 total workspaces");
    assert.equal(overview.workspaces.active, 2, "2 active workspaces");

    assert.equal(overview.contacts.total, 2, "2 contacts across workspaces");
    assert.equal(overview.campaigns.total, 2, "2 campaigns");
    assert.equal(overview.campaigns.active, 1, "1 active campaign");
    assert.equal(overview.campaigns.draft, 1, "1 draft campaign");

    assert.equal(overview.emails.sent, 2, "2 outbound emails sent");
    assert.equal(overview.emails.delivered, 2, "2 delivered emails");
    assert.equal(overview.emails.opened, 1, "1 opened email");
    assert.equal(overview.emails.replies, 1, "1 reply conversation");
  });

  // -------------------------------------------------------------
  // 3. User Management, Role/Status Updates & Audit Trail
  // -------------------------------------------------------------
  await t.test("7. listUsers: Returns sanitized user list without secrets", async () => {
    const result = await adminService.listUsers({ page: 1, limit: 10 });

    assert.ok(result.total >= 4, "Total users should be at least 4");
    assert.ok(result.users.length >= 4);

    for (const u of result.users) {
      assert.ok(u.id);
      assert.ok(u.email);
      assert.ok(u.role);
      assert.ok(u.status);
      assert.ok(u.workspace_name);

      // Verify no sensitive credentials leaked
      assert.equal(u["password"], undefined, "Passwords must never be present");
      assert.equal(u["password_hash"], undefined, "Password hashes must never be present");
      assert.equal(u["encrypted_password"], undefined, "Encrypted passwords must never be present");
      assert.equal(u["token"], undefined, "Security tokens must never be present");
    }
  });

  await t.test("8. updateUser: Updates user role and status, recording admin audit log", async () => {
    const adminUser = { id: adminAId, email: "admin@acme.com" };

    // Update memberBId to inactive and change role to admin
    const updated = await adminService.updateUser(
      adminUser,
      memberBId,
      { status: "inactive", role: "admin" },
      "127.0.0.1"
    );

    assert.ok(updated);
    assert.equal(updated.status, "inactive");
    assert.equal(updated.role, "admin");

    // Verify DB update
    const dbUser = db.public.one(`SELECT * FROM users WHERE id = '${memberBId}';`);
    assert.equal(dbUser.status, "inactive");
    assert.equal(dbUser.role, "admin");

    // Verify Audit Log recorded in admin_audit_logs table
    const auditRes = await adminService.listAuditLogs({ action: "USER_UPDATE" });
    assert.ok(auditRes.total >= 1, "Must have recorded at least 1 USER_UPDATE audit log");

    const log = auditRes.logs.find((l) => l.target_id === memberBId);
    assert.ok(log, "Audit log must reference the target user");
    assert.equal(log.admin_user_id, adminAId);
    assert.equal(log.admin_email, "admin@acme.com");
    assert.equal(log.target_resource, "user");
    assert.equal(log.ip_address, "127.0.0.1");
    assert.ok(log.details?.includes("member@beta.com"));
  });

  await t.test("9. updateUser: Rejects invalid status and invalid roles", async () => {
    const adminUser = { id: adminAId, email: "admin@acme.com" };

    await assert.rejects(
      async () => {
        await adminService.updateUser(adminUser, memberBId, { status: "hacked_status" });
      },
      /Invalid status/
    );

    await assert.rejects(
      async () => {
        await adminService.updateUser(adminUser, memberBId, { role: "super_root_admin" });
      },
      /Invalid role/
    );
  });

  // -------------------------------------------------------------
  // 4. Workspace Management & Usage Metrics
  // -------------------------------------------------------------
  await t.test("10. listWorkspaces: Returns workspaces with aggregated member and contact counts", async () => {
    const result = await adminService.listWorkspaces({ page: 1, limit: 10 });

    assert.equal(result.total, 2);
    const wsA = result.workspaces.find((w) => w.id === bizAId);
    assert.ok(wsA);
    assert.equal(wsA.name, "Acme Global Corp");
    assert.equal(wsA.status, "active");
    assert.equal(wsA.members_count, 3, "Acme has 3 members");
    assert.equal(wsA.contacts_count, 1, "Acme has 1 contact");
    assert.equal(wsA.campaigns_count, 1, "Acme has 1 campaign");
  });

  await t.test("11. updateWorkspace: Updates workspace status and records audit log", async () => {
    const adminUser = { id: adminAId, email: "admin@acme.com" };

    const success = await adminService.updateWorkspace(
      adminUser,
      bizBId,
      { status: "suspended", name: "Beta Logistics (Suspended)" },
      "10.0.0.1"
    );

    assert.equal(success, true);

    const dbWs = db.public.one(`SELECT * FROM businesses WHERE id = '${bizBId}';`);
    assert.equal(dbWs.status, "suspended");
    assert.equal(dbWs.name, "Beta Logistics (Suspended)");

    // Verify audit log
    const auditRes = await adminService.listAuditLogs({ action: "WORKSPACE_UPDATE" });
    const log = auditRes.logs.find((l) => l.target_id === bizBId);
    assert.ok(log, "Must have recorded WORKSPACE_UPDATE audit log");
    assert.equal(log.admin_user_id, adminAId);
  });

  // -------------------------------------------------------------
  // 5. Campaign Monitoring & Email Delivery Visibility
  // -------------------------------------------------------------
  await t.test("12. listCampaigns: Returns campaigns with delivery metrics across workspaces", async () => {
    const result = await adminService.listCampaigns({ page: 1, limit: 10 });

    assert.equal(result.total, 2);
    const campA = result.campaigns.find((c) => c.business_id === bizAId);
    assert.ok(campA);
    assert.equal(campA.name, "Acme Campaign");
    assert.equal(campA.workspace_name, "Acme Global Corp");
    assert.equal(campA.sent_count, 1);
    assert.equal(campA.delivered_count, 1);
    assert.equal(campA.opened_count, 1);
    assert.equal(campA.replies_count, 1);
  });

  // -------------------------------------------------------------
  // 6. Email Provider Credential Protection
  // -------------------------------------------------------------
  await t.test("13. listEmailProviders: Masks API keys and NEVER exposes raw secrets", async () => {
    const provId = crypto.randomUUID();
    const rawApiKey = "re_live_sec_999888777666555444333222111";

    db.public.none(`
      INSERT INTO email_providers (id, business_id, provider, status, encrypted_api_key)
      VALUES ('${provId}', '${bizAId}', 'resend', 'ACTIVE', '${rawApiKey}');
    `);

    const providers = await adminService.listEmailProviders();
    assert.ok(providers.length >= 1);

    const prov = providers.find((p) => p.id === provId);
    assert.ok(prov);
    assert.equal(prov.is_configured, true);

    // CRITICAL SECURITY ASSERTION: Must NOT be the raw secret
    assert.notEqual(prov.masked_key, rawApiKey, "Raw API key MUST NOT be returned");
    assert.ok(prov.masked_key.includes("•"), "Key must be properly masked with bullets");
    assert.equal(prov["encrypted_api_key"], undefined, "Internal secret column must be stripped");
  });

  // -------------------------------------------------------------
  // 7. System Diagnostics & Table Counts
  // -------------------------------------------------------------
  await t.test("14. getSystemHealth: Checks database connectivity and table counts", async () => {
    const health = await adminService.getSystemHealth();

    assert.equal(health.status, "healthy");
    assert.equal(health.database.connected, true);
    assert.ok(typeof health.database.latency_ms === "number");
    assert.ok(health.database.table_counts.users >= 4);
    assert.ok(health.database.table_counts.businesses >= 2);
    assert.ok(health.database.table_counts.admin_audit_logs >= 2);
    assert.ok(health.environment.uptime_seconds >= 0);
  });

  // -------------------------------------------------------------
  // 8. Mask Secret Security Function
  // -------------------------------------------------------------
  await t.test("15. maskSecret: Safely masks sensitive credentials", () => {
    assert.equal(maskSecret(null), "••••••••");
    assert.equal(maskSecret(undefined), "••••••••");
    assert.equal(maskSecret(""), "••••••••");
    assert.equal(maskSecret("short"), "••••••••");
    
    const longSecret = "re_live_secret_1234567890abcdefg";
    const masked = maskSecret(longSecret);
    assert.ok(masked.startsWith("re_"));
    assert.ok(masked.includes("•"));
    assert.ok(masked.endsWith("defg"));
    assert.ok(!masked.includes("1234567890"));
  });
});
