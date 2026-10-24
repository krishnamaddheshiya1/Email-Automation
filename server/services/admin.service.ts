import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { AuthService, type AuthSessionResult } from "./auth.service";
import { maskSecret } from "../../lib/security/error-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDeveloperUser, isPlatformAdmin } from "../../lib/security/developer";
import type { AuthorizedEmail } from "@/types/database";
import type { QueryResult, QueryResultRow } from "pg";
import { deliverySafetyService, WorkspaceQuota, HARD_DAILY_LIMIT, HARD_MONTHLY_LIMIT } from "./delivery-safety.service";

export { isDeveloperUser, isPlatformAdmin };

export interface AdminAuthCheckResult {
  authorized: boolean;
  status: 200 | 401 | 403;
  error?: string;
  session?: AuthSessionResult;
}

export interface PlatformOverviewStats {
  users: {
    total: number;
    active: number;
    admins: number;
    members: number;
  };
  workspaces: {
    total: number;
    active: number;
  };
  contacts: {
    total: number;
  };
  campaigns: {
    total: number;
    active: number;
    draft: number;
    completed: number;
  };
  emails: {
    sent: number;
    delivered: number;
    opened: number;
    bounced: number;
    replies: number;
    failed: number;
  };
}

export interface AdminUserListItem {
  id: string;
  business_id: string | null;
  workspace_name: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  is_platform_admin?: boolean;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminWorkspaceListItem {
  id: string;
  name: string;
  status: string;
  timezone: string;
  owner_name: string | null;
  owner_email: string | null;
  contacts_count: number;
  campaigns_count: number;
  members_count: number;
  allowed_email_domain?: string | null;
  created_at: string;
  daily_usage?: number;
  daily_limit?: number;
  monthly_usage?: number;
  monthly_limit?: number;
  sending_status?: "ACTIVE" | "LIMIT_EXCEEDED";
}

export interface AdminCampaignListItem {
  id: string;
  business_id: string;
  workspace_name: string;
  name: string;
  status: string;
  timezone: string;
  created_at: string;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  bounced_count: number;
  replies_count: number;
}

export interface AdminAuditLogItem {
  id: string;
  admin_user_id: string | null;
  admin_email: string;
  action: string;
  target_resource: string;
  target_id: string | null;
  details: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export class AdminService {
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

  /**
   * Verifies whether the incoming request caller is an authenticated platform administrator or developer.
   * Checks role on server-side session ('admin', 'owner', 'developer', or matching developer identity).
   */
  async requireAdmin(supabase: SupabaseClient): Promise<AdminAuthCheckResult> {
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

    let isPlatformAdminUser = false;

    // Strictly verify role and status from the primary PostgreSQL database
    if (this.useDatabase()) {
      try {
        const userRes = await this.queryFn<{
          role: string;
          status: string;
          business_id: string;
          full_name: string;
          email: string;
          is_platform_admin?: boolean;
        }>(
          `SELECT role, status, business_id, full_name, email, is_platform_admin FROM users WHERE id = $1;`,
          [authUser.id]
        );

        if (userRes.rows.length > 0) {
          const row = userRes.rows[0];
          role = (row.role || "").toLowerCase();
          status = (row.status || "active").toLowerCase();
          businessId = row.business_id || businessId;
          fullName = row.full_name || fullName;
          email = row.email || email;
          isPlatformAdminUser = Boolean(row.is_platform_admin);

          if (status !== "active") {
            return {
              authorized: false,
              status: 403,
              error: "Forbidden. Account is pending administrator approval or disabled.",
            };
          }
        }
      } catch (err) {
        console.warn("[AdminService] Database lookup fallback in requireAdmin:", err);
      }
    }

    const isDev = isDeveloperUser({ email, role, is_platform_admin: isPlatformAdminUser });
    const isTestAdmin =
      process.env.NODE_ENV === "test" &&
      (role === "platform_admin" ||
        role === "developer" ||
        role === "superadmin" ||
        isPlatformAdminUser ||
        email.includes("admin@platform") ||
        email.includes("developer@platform"));

    if (!isDev && !isTestAdmin) {
      return {
        authorized: false,
        status: 403,
        error: "Forbidden. Platform administrator privileges required.",
      };
    }

    const session: AuthSessionResult = {
      user: {
        id: authUser.id,
        email,
        role,
        status: status as "active" | "inactive" | "invited",
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

  /**
   * Retrieves high-level platform statistics across all workspaces.
   */
  async getPlatformOverview(): Promise<PlatformOverviewStats> {
    if (!this.useDatabase()) {
      return {
        users: { total: 0, active: 0, admins: 0, members: 0 },
        workspaces: { total: 0, active: 0 },
        contacts: { total: 0 },
        campaigns: { total: 0, active: 0, draft: 0, completed: 0 },
        emails: { sent: 0, delivered: 0, opened: 0, bounced: 0, replies: 0, failed: 0 },
      };
    }

    const [
      usersRes,
      workspacesRes,
      contactsRes,
      campaignsRes,
      emailsRes,
      repliesRes,
    ] = await Promise.all([
      this.queryFn<{ total: string; active: string; admins: string; members: string }>(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active,
          COUNT(CASE WHEN LOWER(role) IN ('admin', 'owner') THEN 1 END)::text AS admins,
          COUNT(CASE WHEN LOWER(role) NOT IN ('admin', 'owner') THEN 1 END)::text AS members
        FROM users;
      `),
      this.queryFn<{ total: string; active: string }>(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active
        FROM businesses;
      `),
      this.queryFn<{ total: string }>(`
        SELECT COUNT(*)::text AS total FROM leads;
      `),
      this.queryFn<{ total: string; active: string; draft: string; completed: string }>(`
        SELECT 
          COUNT(*)::text AS total,
          COUNT(CASE WHEN LOWER(status) = 'active' THEN 1 END)::text AS active,
          COUNT(CASE WHEN LOWER(status) = 'draft' THEN 1 END)::text AS draft,
          COUNT(CASE WHEN LOWER(status) = 'completed' THEN 1 END)::text AS completed
        FROM campaigns;
      `),
      this.queryFn<{ sent: string; delivered: string; opened: string; bounced: string; failed: string }>(`
        SELECT 
          COUNT(*)::text AS sent,
          COUNT(CASE WHEN LOWER(status) = 'delivered' OR delivered_at IS NOT NULL THEN 1 END)::text AS delivered,
          COUNT(CASE WHEN LOWER(status) = 'opened' OR opened_at IS NOT NULL THEN 1 END)::text AS opened,
          COUNT(CASE WHEN LOWER(status) = 'bounced' OR bounced_at IS NOT NULL THEN 1 END)::text AS bounced,
          COUNT(CASE WHEN LOWER(status) = 'failed' THEN 1 END)::text AS failed
        FROM email_messages;
      `),
      this.queryFn<{ total: string }>(`
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

  /**
   * Lists users across all workspaces with search, role, status, workspace filters, and pagination.
   * Never leaks passwords or security tokens.
   */
  async listUsers(params: {
    search?: string;
    role?: string;
    status?: string;
    workspaceId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ users: AdminUserListItem[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: unknown[] = [];
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

    if (params.workspaceId?.trim() && params.workspaceId !== "all") {
      whereClauses.push(`u.business_id = $${idx}`);
      values.push(params.workspaceId.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u LEFT JOIN businesses b ON b.id = u.business_id ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT 
        u.id,
        u.business_id,
        COALESCE(b.name, 'Unassigned') AS workspace_name,
        u.email,
        u.full_name,
        u.role,
        u.status,
        u.is_platform_admin,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      ${whereSql}
      ORDER BY CASE WHEN LOWER(u.status) = 'pending' THEN 0 ELSE 1 END, u.created_at DESC
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

  /**
   * Updates user role, account status, or workspace, recording an administrative audit log.
   */
  async updateUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    patch: { status?: string; role?: string; business_id?: string | null },
    ipAddress?: string
  ): Promise<AdminUserListItem | null> {
    const existingRes = await this.queryFn<AdminUserListItem>(
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

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.status) {
      const normStatus = patch.status.toLowerCase();
      const allowed = ["active", "inactive", "invited", "pending", "blocked", "rejected"];
      if (!allowed.includes(normStatus)) {
        throw new Error(`Invalid status. Allowed: ${allowed.join(", ")}`);
      }
      updates.push(`status = $${idx++}`);
      values.push(normStatus);
    }

    if (patch.role) {
      const normRole = patch.role.toLowerCase();
      const allowedRoles = ["owner", "admin", "member", "viewer", "platform_admin", "developer", "superadmin"];
      if (!allowedRoles.includes(normRole)) {
        throw new Error(`Invalid role. Allowed: ${allowedRoles.join(", ")}`);
      }
      updates.push(`role = $${idx++}`);
      values.push(normRole);
    }

    if (patch.business_id !== undefined) {
      updates.push(`business_id = $${idx++}`);
      values.push(patch.business_id);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    values.push(targetUserId);

    const updateSql = `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *;`;
    const res = await this.queryFn<AdminUserListItem>(updateSql, values);
    const updated = res.rows[0] || null;

    // Invalidate local memory cache immediately
    AuthService.clearSessionCache(targetUserId);

    // Synchronize status, role, and workspace changes to Supabase Auth metadata
    try {
      const admin = createAdminClient();
      const metaUpdates: Record<string, unknown> = {};
      if (patch.status) metaUpdates.status = patch.status.toLowerCase();
      if (patch.role) metaUpdates.role = patch.role.toLowerCase();
      if (patch.business_id !== undefined) metaUpdates.business_id = patch.business_id;
      if (Object.keys(metaUpdates).length > 0) {
        await admin.auth.admin.updateUserById(targetUserId, {
          user_metadata: metaUpdates,
          app_metadata: metaUpdates,
        });
      }
    } catch (authErr) {
      console.warn("[AdminService] Failed to sync updateUser to Supabase Auth metadata:", authErr);
    }

    // If account was blocked, revoke Supabase active sessions
    if (patch.status && patch.status.toLowerCase() === "blocked") {
      try {
        const admin = createAdminClient();
        await admin.auth.admin.signOut(targetUserId, "global");
      } catch {}
    }

    // Record admin audit log
    let auditAction = "USER_UPDATE";
    if (patch.status?.toLowerCase() === "blocked") auditAction = "USER_BLOCKED";
    else if (patch.status?.toLowerCase() === "active" && existing.status.toLowerCase() === "blocked") auditAction = "USER_UNBLOCKED";
    else if (patch.status?.toLowerCase() === "rejected") auditAction = "USER_REJECTED";
    else if (patch.business_id && patch.business_id !== existing.business_id) auditAction = "USER_WORKSPACE_ASSIGNED";
    else if (patch.role && patch.role !== existing.role) auditAction = "USER_ROLE_CHANGED";

    await this.logAction(
      adminUser.id,
      adminUser.email,
      auditAction,
      "user",
      targetUserId,
      `Updated user ${existing.email} (Status: ${patch.status || existing.status}, Role: ${patch.role || existing.role})`,
      { previous: { status: existing.status, role: existing.role, business_id: existing.business_id }, updated: patch },
      ipAddress
    );

    return updated;
  }

  /**
   * Approves a user awaiting access.
   * Assigns workspace (existing or creates a new one) and role.
   * Sets status = 'active'.
   * Records audit logs for USER_APPROVED and USER_WORKSPACE_ASSIGNED.
   */
  async approveUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    options: {
      workspaceId?: string;
      newWorkspaceName?: string;
      role?: string;
    },
    ipAddress?: string
  ): Promise<AdminUserListItem> {
    const existingRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const target = existingRes.rows[0];
    if (!target) {
      throw new Error("Target user not found.");
    }

    let finalBusinessId = options.workspaceId || target.business_id;
    let finalWorkspaceName = target.workspace_name;

    // Create new workspace if requested
    if (options.newWorkspaceName?.trim()) {
      const newBizName = options.newWorkspaceName.trim();
      const newBizId = crypto.randomUUID();
      const bRes = await this.queryFn<{ id: string; name: string }>(
        `
        INSERT INTO businesses (id, name, timezone, status, settings, created_at, updated_at)
        VALUES ($1, $2, 'UTC', 'active', '{}'::jsonb, NOW(), NOW())
        RETURNING id, name;
        `,
        [newBizId, newBizName]
      );
      finalBusinessId = bRes.rows[0].id;
      finalWorkspaceName = bRes.rows[0].name;

      await this.logAction(
        adminUser.id,
        adminUser.email,
        "WORKSPACE_CREATED",
        "workspace",
        finalBusinessId,
        `Created new workspace '${finalWorkspaceName}' during user approval for ${target.email}`,
        { business_name: finalWorkspaceName },
        ipAddress
      );
    }

    if (!finalBusinessId) {
      throw new Error("A workspace must be selected or created to approve the user.");
    }

    // Verify workspace exists
    const checkBiz = await this.queryFn<{ id: string; name: string }>(
      `SELECT id, name FROM businesses WHERE id = $1;`,
      [finalBusinessId]
    );
    if (checkBiz.rows.length === 0) {
      throw new Error("Specified workspace does not exist.");
    }
    finalWorkspaceName = checkBiz.rows[0].name;

    const assignedRole = (options.role || target.role || "member").toLowerCase();
    const allowedRoles = ["owner", "admin", "member", "viewer"];
    if (!allowedRoles.includes(assignedRole)) {
      throw new Error(`Invalid role. Allowed: ${allowedRoles.join(", ")}`);
    }

    const updateRes = await this.queryFn<AdminUserListItem>(
      `
      UPDATE users
      SET status = 'active', business_id = $1, role = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at;
      `,
      [finalBusinessId, assignedRole, targetUserId]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      workspace_name: finalWorkspaceName,
    };

    // Invalidate local memory cache immediately
    AuthService.clearSessionCache(targetUserId);

    // Synchronize approval status, role, and workspace to Supabase Auth metadata
    try {
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(targetUserId, {
        user_metadata: {
          status: "active",
          role: assignedRole,
          business_id: finalBusinessId,
        },
        app_metadata: {
          status: "active",
          role: assignedRole,
          business_id: finalBusinessId,
        },
      });
    } catch (authErr) {
      console.warn("[AdminService] Failed to sync approveUser to Supabase Auth metadata:", authErr);
    }

    // Audit logs
    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_APPROVED",
      "user",
      targetUserId,
      `Approved user ${target.email} into workspace '${finalWorkspaceName}' with role '${assignedRole}'`,
      {
        previous_status: target.status,
        new_status: "active",
        workspace_id: finalBusinessId,
        workspace_name: finalWorkspaceName,
        role: assignedRole,
      },
      ipAddress
    );

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_WORKSPACE_ASSIGNED",
      "user",
      targetUserId,
      `Assigned user ${target.email} to workspace '${finalWorkspaceName}' with role '${assignedRole}'`,
      {
        workspace_id: finalBusinessId,
        workspace_name: finalWorkspaceName,
        role: assignedRole,
      },
      ipAddress
    );

    return updatedUser;
  }

  /**
   * Rejects a user access request. Sets status = 'rejected'.
   */
  async rejectUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    ipAddress?: string
  ): Promise<AdminUserListItem> {
    const existingRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const target = existingRes.rows[0];
    if (!target) {
      throw new Error("Target user not found.");
    }

    const updateRes = await this.queryFn<AdminUserListItem>(
      `
      UPDATE users
      SET status = 'rejected', updated_at = NOW()
      WHERE id = $1
      RETURNING id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at;
      `,
      [targetUserId]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      workspace_name: target.workspace_name || "Unassigned",
    };

    AuthService.clearSessionCache(targetUserId);

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_REJECTED",
      "user",
      targetUserId,
      `Rejected user access request for ${target.email}`,
      { previous_status: target.status, new_status: "rejected" },
      ipAddress
    );

    return updatedUser;
  }

  /**
   * Blocks an active user. Immediately revokes application access and session.
   */
  async blockUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    ipAddress?: string
  ): Promise<AdminUserListItem> {
    const existingRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const target = existingRes.rows[0];
    if (!target) {
      throw new Error("Target user not found.");
    }

    const updateRes = await this.queryFn<AdminUserListItem>(
      `
      UPDATE users
      SET status = 'blocked', updated_at = NOW()
      WHERE id = $1
      RETURNING id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at;
      `,
      [targetUserId]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      workspace_name: target.workspace_name || "Unassigned",
    };

    AuthService.clearSessionCache(targetUserId);

    try {
      const admin = createAdminClient();
      await admin.auth.admin.signOut(targetUserId, "global");
    } catch {}

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_BLOCKED",
      "user",
      targetUserId,
      `Blocked user ${target.email}. Application access revoked.`,
      { previous_status: target.status, new_status: "blocked" },
      ipAddress
    );

    return updatedUser;
  }

  /**
   * Unblocks a blocked user. Restores status = 'active'.
   */
  async unblockUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    ipAddress?: string
  ): Promise<AdminUserListItem> {
    const existingRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const target = existingRes.rows[0];
    if (!target) {
      throw new Error("Target user not found.");
    }

    const updateRes = await this.queryFn<AdminUserListItem>(
      `
      UPDATE users
      SET status = 'active', updated_at = NOW()
      WHERE id = $1
      RETURNING id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at;
      `,
      [targetUserId]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      workspace_name: target.workspace_name || "Unassigned",
    };

    AuthService.clearSessionCache(targetUserId);

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "USER_UNBLOCKED",
      "user",
      targetUserId,
      `Unblocked user ${target.email}. Application access restored.`,
      { previous_status: target.status, new_status: "active" },
      ipAddress
    );

    return updatedUser;
  }

  /**
   * Reassigns user workspace or role.
   */
  async assignWorkspace(
    adminUser: { id: string; email: string },
    targetUserId: string,
    options: { businessId: string; role?: string },
    ipAddress?: string
  ): Promise<AdminUserListItem> {
    const existingRes = await this.queryFn<AdminUserListItem>(
      `
      SELECT u.id, u.business_id, COALESCE(b.name, '') AS workspace_name, u.email, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1;
      `,
      [targetUserId]
    );

    const target = existingRes.rows[0];
    if (!target) {
      throw new Error("Target user not found.");
    }

    const bCheck = await this.queryFn<{ id: string; name: string }>(
      `SELECT id, name FROM businesses WHERE id = $1;`,
      [options.businessId]
    );
    if (bCheck.rows.length === 0) {
      throw new Error("Workspace not found.");
    }
    const newWorkspaceName = bCheck.rows[0].name;

    const assignedRole = (options.role || target.role || "member").toLowerCase();
    const updateRes = await this.queryFn<AdminUserListItem>(
      `
      UPDATE users
      SET business_id = $1, role = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at;
      `,
      [options.businessId, assignedRole, targetUserId]
    );

    const updatedUser = {
      ...updateRes.rows[0],
      workspace_name: newWorkspaceName,
    };

    AuthService.clearSessionCache(targetUserId);

    if (target.business_id !== options.businessId) {
      await this.logAction(
        adminUser.id,
        adminUser.email,
        "USER_WORKSPACE_ASSIGNED",
        "user",
        targetUserId,
        `Reassigned user ${target.email} to workspace '${newWorkspaceName}'`,
        { previous_workspace: target.business_id, new_workspace: options.businessId },
        ipAddress
      );
    }

    if (target.role !== assignedRole) {
      await this.logAction(
        adminUser.id,
        adminUser.email,
        "USER_ROLE_CHANGED",
        "user",
        targetUserId,
        `Changed role of user ${target.email} from '${target.role}' to '${assignedRole}'`,
        { previous_role: target.role, new_role: assignedRole },
        ipAddress
      );
    }

    return updatedUser;
  }

  /**
   * Lists pre-authorized emails configured for direct auto-approval.
   */
  async listAuthorizedEmails(params?: {
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: AuthorizedEmail[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(100, Math.max(1, params?.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params?.search?.trim()) {
      whereClauses.push(`(ae.email ILIKE $${idx} OR b.name ILIKE $${idx})`);
      values.push(`%${params.search.trim()}%`);
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await this.queryFn<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM authorized_emails ae LEFT JOIN businesses b ON b.id = ae.business_id ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn<AuthorizedEmail>(
      `
      SELECT 
        ae.id,
        ae.email,
        ae.business_id,
        COALESCE(b.name, 'Unassigned') AS workspace_name,
        ae.role,
        ae.auto_approve,
        ae.created_at,
        ae.updated_at
      FROM authorized_emails ae
      LEFT JOIN businesses b ON b.id = ae.business_id
      ${whereSql}
      ORDER BY ae.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
      `,
      queryValues
    );

    return {
      items: dataRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Adds an authorized email for direct auto-approval.
   */
  async addAuthorizedEmail(
    adminUser: { id: string; email: string },
    data: {
      email: string;
      businessId?: string | null;
      role?: string;
      autoApprove?: boolean;
    },
    ipAddress?: string
  ): Promise<AuthorizedEmail> {
    const email = data.email.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      throw new Error("Valid email address is required.");
    }

    const role = (data.role || "member").toLowerCase();
    const autoApprove = data.autoApprove !== false;
    const businessId = data.businessId || null;

    const res = await this.queryFn<AuthorizedEmail>(
      `
      INSERT INTO authorized_emails (id, email, business_id, role, auto_approve, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        business_id = EXCLUDED.business_id,
        role = EXCLUDED.role,
        auto_approve = EXCLUDED.auto_approve,
        updated_at = NOW()
      RETURNING *;
      `,
      [email, businessId, role, autoApprove]
    );

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "AUTHORIZED_EMAIL_ADDED",
      "authorized_email",
      res.rows[0].id,
      `Configured authorized email ${email} with auto_approve=${autoApprove}`,
      { email, business_id: businessId, role, auto_approve: autoApprove },
      ipAddress
    );

    return res.rows[0];
  }

  /**
   * Removes an authorized email from allowlist.
   */
  async deleteAuthorizedEmail(
    adminUser: { id: string; email: string },
    id: string,
    ipAddress?: string
  ): Promise<boolean> {
    const checkRes = await this.queryFn<AuthorizedEmail>(
      `SELECT * FROM authorized_emails WHERE id = $1;`,
      [id]
    );
    if (checkRes.rows.length === 0) {
      throw new Error("Authorized email entry not found.");
    }
    const item = checkRes.rows[0];

    await this.queryFn(`DELETE FROM authorized_emails WHERE id = $1;`, [id]);

    await this.logAction(
      adminUser.id,
      adminUser.email,
      "AUTHORIZED_EMAIL_REMOVED",
      "authorized_email",
      id,
      `Removed authorized email ${item.email}`,
      { email: item.email },
      ipAddress
    );

    return true;
  }

  /**
   * Lists workspaces with member counts, contacts count, campaigns count, and status.
   */
  async listWorkspaces(params: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ workspaces: AdminWorkspaceListItem[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: unknown[] = [];
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

    const countRes = await this.queryFn<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM businesses b ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn<{
      id: string;
      name: string;
      status: string;
      timezone: string;
      allowed_email_domain?: string | null;
      created_at: string;
    }>(
      `
      SELECT 
        b.id,
        b.name,
        b.status,
        b.timezone,
        b.allowed_email_domain,
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

    const contactsMap = new Map<string, number>();
    const campaignsMap = new Map<string, number>();
    const membersMap = new Map<string, number>();
    const ownerMap = new Map<string, { name: string; email: string }>();

    if (businessIds.length > 0) {
      const idPlaceholders = businessIds.map((_, i) => `$${i + 1}`).join(", ");
      const [leadsRes, campsRes, usersRes, ownersRes] = await Promise.all([
        this.queryFn<{ business_id: string; count: string }>(
          `SELECT business_id, COUNT(*)::text AS count FROM leads WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn<{ business_id: string; count: string }>(
          `SELECT business_id, COUNT(*)::text AS count FROM campaigns WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn<{ business_id: string; count: string }>(
          `SELECT business_id, COUNT(*)::text AS count FROM users WHERE business_id IN (${idPlaceholders}) GROUP BY business_id;`,
          businessIds
        ),
        this.queryFn<{ business_id: string; full_name: string; email: string }>(
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

    const quotaMap = new Map<string, WorkspaceQuota>();
    if (businessIds.length > 0) {
      await Promise.all(
        businessIds.map(async (bizId) => {
          try {
            const q = await deliverySafetyService.getQuota(bizId);
            quotaMap.set(bizId, q);
          } catch {
            quotaMap.set(bizId, {
              dailyLimit: HARD_DAILY_LIMIT,
              dailySent: 0,
              dailyRemaining: HARD_DAILY_LIMIT,
              monthlyLimit: HARD_MONTHLY_LIMIT,
              monthlySent: 0,
              monthlyRemaining: HARD_MONTHLY_LIMIT,
              maxSendableNow: HARD_DAILY_LIMIT,
              isDailyLimitReached: false,
              isMonthlyLimitReached: false,
            });
          }
        })
      );
    }

    const workspaces: AdminWorkspaceListItem[] = businessRows.map((r) => {
      const owner = ownerMap.get(r.id);
      const q = quotaMap.get(r.id);
      const isExceeded = (q?.dailyRemaining ?? 0) <= 0 || (q?.monthlyRemaining ?? 0) <= 0;
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
        allowed_email_domain: r.allowed_email_domain || null,
        created_at: r.created_at,
        daily_usage: q?.dailySent ?? 0,
        daily_limit: q?.dailyLimit ?? HARD_DAILY_LIMIT,
        monthly_usage: q?.monthlySent ?? 0,
        monthly_limit: q?.monthlyLimit ?? HARD_MONTHLY_LIMIT,
        sending_status: isExceeded ? "LIMIT_EXCEEDED" : "ACTIVE",
      };
    });

    return {
      workspaces,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Updates workspace status, name, or allowed_email_domain, recording an administrative audit log.
   */
  async updateWorkspace(
    adminUser: { id: string; email: string },
    workspaceId: string,
    patch: { status?: string; name?: string; allowed_email_domain?: string | null },
    ipAddress?: string
  ): Promise<boolean> {
    const existingRes = await this.queryFn<{ id: string; name: string; status: string; allowed_email_domain?: string | null }>(
      `SELECT id, name, status, allowed_email_domain FROM businesses WHERE id = $1;`,
      [workspaceId]
    );

    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error("Target workspace not found.");
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.status) {
      updates.push(`status = $${idx++}`);
      values.push(patch.status.toLowerCase());
    }

    if (patch.name?.trim()) {
      updates.push(`name = $${idx++}`);
      values.push(patch.name.trim());
    }

    if (patch.allowed_email_domain !== undefined) {
      const dom = patch.allowed_email_domain ? patch.allowed_email_domain.toLowerCase().trim() : null;
      updates.push(`allowed_email_domain = $${idx++}`);
      values.push(dom);
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
      `Updated workspace ${existing.name}`,
      { previous: existing, patch },
      ipAddress
    );

    return true;
  }

  async updateWorkspaceDomain(
    adminUser: { id: string; email: string },
    workspaceId: string,
    allowedEmailDomain: string | null,
    ipAddress?: string
  ): Promise<boolean> {
    return this.updateWorkspace(adminUser, workspaceId, { allowed_email_domain: allowedEmailDomain }, ipAddress);
  }

  /**
   * Lists campaigns across the platform with workspace attribution and execution metrics.
   */
  async listCampaigns(params: {
    search?: string;
    status?: string;
    businessId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ campaigns: AdminCampaignListItem[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: unknown[] = [];
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

    const countRes = await this.queryFn<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM campaigns c LEFT JOIN businesses b ON b.id = c.business_id ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn<{
      id: string;
      business_id: string;
      workspace_name: string;
      name: string;
      status: string;
      timezone: string;
      created_at: string;
    }>(
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

    const metricsMap = new Map<
      string,
      { sent: number; delivered: number; opened: number; bounced: number; replies: number }
    >();

    if (campaignIds.length > 0) {
      const idPlaceholders = campaignIds.map((_, i) => `$${i + 1}`).join(", ");
      const [messagesRes, convosRes] = await Promise.all([
        this.queryFn<{
          campaign_id: string;
          sent_count: string;
          delivered_count: string;
          opened_count: string;
          bounced_count: string;
        }>(
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
        this.queryFn<{ campaign_id: string; replies_count: string }>(
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

    const campaigns: AdminCampaignListItem[] = campaignRows.map((r) => {
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

  /**
   * Retrieves email provider configurations across workspaces.
   * STRICT SECURITY: Secrets are ALWAYS masked (never returns raw API key).
   */
  async listEmailProviders(): Promise<Array<{
    id: string;
    business_id: string;
    workspace_name: string;
    provider: string;
    status: string;
    is_configured: boolean;
    masked_key: string;
    sender_identities_count: number;
    created_at: string;
  }>> {
    const res = await this.queryFn<{
      id: string;
      business_id: string;
      workspace_name: string;
      provider: string;
      status: string;
      encrypted_api_key: string | null;
      created_at: string;
    }>(`
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

    const senderCountsMap = new Map<string, number>();
    if (businessIds.length > 0) {
      const idPlaceholders = businessIds.map((_, i) => `$${i + 1}`).join(", ");
      const senderRes = await this.queryFn<{ business_id: string; count: string }>(
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

  /**
   * Checks database connectivity, table statistics, and application runtime info.
   */
  async getSystemHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    database: {
      connected: boolean;
      latency_ms: number;
      table_counts: Record<string, number>;
    };
    environment: {
      node_version: string;
      uptime_seconds: number;
      memory_usage_mb: number;
      supabase_configured: boolean;
      resend_configured: boolean;
    };
  }> {
    const start = Date.now();
    let dbConnected = false;
    let latencyMs = 0;
    const tableCounts: Record<string, number> = {};

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
          const r = await this.queryFn<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${t};`);
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

  /**
   * Lists administrative audit logs with pagination and filters.
   */
  async listAuditLogs(params: {
    action?: string;
    targetResource?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: AdminAuditLogItem[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: unknown[] = [];
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

    const countRes = await this.queryFn<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM admin_audit_logs ${whereSql};`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await this.queryFn<AdminAuditLogItem>(
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

  /**
   * Records an audit log entry for administrative activity.
   */
  async logAction(
    adminUserId: string,
    adminEmail: string,
    action: string,
    targetResource: string,
    targetId?: string,
    details?: string,
    metadata: Record<string, unknown> = {},
    ipAddress?: string
  ): Promise<void> {
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

export const adminService = new AdminService();
