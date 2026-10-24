import { SupabaseClient } from "@supabase/supabase-js";
import { RegisterInput, LoginInput, registerSchema, loginSchema } from "@/lib/validations/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured, isSupabaseAdminConfigured } from "@/lib/supabase/config";
import { Business, User, UserRole, UserStatus } from "@/types/database";
import { isDeveloperUser } from "@/lib/security/developer";
import { query, isDbConfigured } from "../db/client";

export interface AuthSessionResult {
  user: User;
  business: Business;
  authUser: {
    id: string;
    email?: string;
  };
}

interface SessionCacheEntry {
  session: AuthSessionResult;
  expiresAt: number;
}

export class AuthService {
  private static sessionCache = new Map<string, SessionCacheEntry>();
  private static readonly CACHE_TTL_MS = 30_000; // 30 seconds

  public static clearSessionCache(userId?: string): void {
    if (userId) {
      AuthService.sessionCache.delete(userId);
    } else {
      AuthService.sessionCache.clear();
    }
  }

  /**
   * Registers a new user:
   * 1. Validates payload (ignores/rejects any client-provided workspace_id).
   * 2. Checks if email matches authorized_emails allowlist with auto_approve = true.
   * 3. Checks if email matches an active workspace's allowed_email_domain.
   * 4. If auto-approved, assigns workspace, role, and status = ACTIVE.
   * 5. Otherwise, sets status = PENDING with NO workspace access.
   * 6. Creates Supabase Auth user identity.
   * 7. Creates application user record.
   */
  public static async register(
    input: RegisterInput,
    supabase: SupabaseClient
  ): Promise<{
    user: User;
    business: Business | null;
    session: unknown;
    status: UserStatus;
    message?: string;
  }> {
    // 1. Validate payload
    const validation = registerSchema.safeParse(input);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
      throw new Error(
        "Supabase credentials are not configured in your deployment environment. Please add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to your environment variables (Netlify or Vercel), then redeploy."
      );
    }

    const { full_name, email, password } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();
    const admin = createAdminClient();

    // 2. Determine initial access status & workspace assignment (Allowlist or Domain rule)
    let assignedBusinessId: string | null = null;
    let assignedRole: UserRole = "member";
    let assignedStatus: UserStatus = "pending";
    let autoApprovalReason: string | null = null;
    let isPlatformAdmin = isDeveloperUser({ email: normalizedEmail });

    if (isPlatformAdmin) {
      assignedRole = "developer";
      assignedStatus = "active";
      autoApprovalReason = "platform_developer_identity";
    }

    if (isDbConfigured()) {
      try {
        // A. Check database authorized_emails allowlist
        const allowlistRes = await query<{
          business_id: string | null;
          role: string;
          auto_approve: boolean;
        }>(
          `SELECT business_id, role, auto_approve FROM authorized_emails WHERE LOWER(email) = $1 LIMIT 1;`,
          [normalizedEmail]
        );

        if (allowlistRes.rows.length > 0 && allowlistRes.rows[0].auto_approve) {
          assignedBusinessId = allowlistRes.rows[0].business_id || assignedBusinessId;
          const matchedRole = (allowlistRes.rows[0].role as UserRole) || "member";
          if (!isPlatformAdmin) {
            assignedRole = matchedRole;
          }
          if (matchedRole === "developer" || matchedRole === "platform_admin") {
            isPlatformAdmin = true;
          }
          assignedStatus = "active";
          autoApprovalReason = "authorized_email_allowlist";
        } else if (!isPlatformAdmin) {
          // B. Check company domain approval
          const domain = normalizedEmail.split("@")[1];
          if (domain) {
            const domainRes = await query<{ id: string }>(
              `SELECT id FROM businesses WHERE LOWER(allowed_email_domain) = $1 AND status = 'active' LIMIT 1;`,
              [domain]
            );
            if (domainRes.rows.length > 0) {
              assignedBusinessId = domainRes.rows[0].id;
              assignedRole = "member";
              assignedStatus = "active";
              autoApprovalReason = "company_domain_approval";
            }
          }
        }
      } catch (err) {
        console.warn("[AuthService] Allowlist/domain check error in register:", err);
      }
    }

    // 3. Create user via Supabase Auth Admin API
    let adminUserData;
    let adminUserError;
    try {
      const res = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
          business_id: assignedBusinessId,
          role: assignedRole,
          status: assignedStatus,
        },
      });
      adminUserData = res.data;
      adminUserError = res.error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch failed") || msg.includes("ENOTFOUND")) {
        throw new Error(
          "Unable to reach Supabase authentication server. Please verify NEXT_PUBLIC_SUPABASE_URL in Vercel."
        );
      }
      throw new Error(msg);
    }

    if (adminUserError) {
      if (
        adminUserError.message.toLowerCase().includes("already registered") ||
        adminUserError.message.toLowerCase().includes("already exists")
      ) {
        throw new Error("An account with this email address already exists.");
      }
      throw new Error(adminUserError.message || "Failed to create account.");
    }

    if (!adminUserData.user) {
      throw new Error("Failed to create authentication user.");
    }

    const authUserId = adminUserData.user.id;

    // 4. Create application user profile record
    let user: User;
    if (isDbConfigured()) {
      try {
        const insertRes = await query<User>(
          `
          INSERT INTO users (id, business_id, email, full_name, role, status, is_platform_admin, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            business_id = EXCLUDED.business_id,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            is_platform_admin = EXCLUDED.is_platform_admin,
            updated_at = NOW()
          RETURNING *;
          `,
          [authUserId, assignedBusinessId, normalizedEmail, full_name, assignedRole, assignedStatus, isPlatformAdmin]
        );
        user = insertRes.rows[0];
      } catch (err) {
        console.warn("[AuthService] DB insert user failed, falling back to admin client:", err);
        const { data: userData } = await admin
          .from("users")
          .upsert({
            id: authUserId,
            business_id: assignedBusinessId,
            email: normalizedEmail,
            full_name,
            role: assignedRole,
            status: assignedStatus,
            is_platform_admin: isPlatformAdmin,
          })
          .select("*")
          .single();
        user = userData as User;
      }
    } else {
      const { data: userData } = await admin
        .from("users")
        .upsert({
          id: authUserId,
          business_id: assignedBusinessId,
          email: normalizedEmail,
          full_name,
          role: assignedRole,
          status: assignedStatus,
        })
        .select("*")
        .single();
      user = userData as User;
    }

    // 5. Handle post-registration session & responses
    let business: Business | null = null;
    let session = null;

    if (assignedStatus === "active" && assignedBusinessId) {
      // Auto-approved user: retrieve workspace and establish session
      if (isDbConfigured()) {
        try {
          const bRes = await query<Business>(`SELECT * FROM businesses WHERE id = $1;`, [assignedBusinessId]);
          business = bRes.rows[0] || null;
        } catch {}
      }
      if (!business) {
        const { data: bData } = await admin.from("businesses").select("*").eq("id", assignedBusinessId).single();
        business = bData as Business;
      }

      const { data: signInData } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      session = signInData?.session || null;

      // Record audit log for auto-approval
      try {
        if (isDbConfigured()) {
          await query(
            `
            INSERT INTO admin_audit_logs (
              id, admin_email, action, target_resource, target_id, details, metadata, created_at
            ) VALUES (gen_random_uuid(), 'system@platform', 'USER_APPROVED', 'user', $1, $2, $3, NOW());
            `,
            [
              authUserId,
              `User ${normalizedEmail} automatically approved via ${autoApprovalReason}`,
              JSON.stringify({ workspace_id: assignedBusinessId, role: assignedRole, reason: autoApprovalReason }),
            ]
          );
        }
      } catch {}
    }

    return {
      user,
      business,
      session,
      status: assignedStatus,
      message:
        assignedStatus === "pending"
          ? "Your account has been created successfully. Your access is pending administrator approval."
          : undefined,
    };
  }

  /**
   * Authenticates an existing user and verifies their account status:
   * - ACTIVE: allows access and updates last_login_at.
   * - PENDING: rejects with "Your account is awaiting administrator approval."
   * - BLOCKED: rejects with "Your account has been disabled. Please contact the administrator."
   * - REJECTED: rejects with "Your access request has been rejected."
   */
  public static async login(
    input: LoginInput,
    supabase: SupabaseClient
  ): Promise<AuthSessionResult & { session: unknown }> {
    const validation = loginSchema.safeParse(input);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Invalid credentials";
      throw new Error(firstError);
    }

    const { email, password } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();

    if (!isSupabaseConfigured()) {
      throw new Error(
        "Supabase credentials are not configured in your deployment environment. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment variables (Netlify or Vercel), then redeploy."
      );
    }

    let authData;
    let authError;
    try {
      const res = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      authData = res.data;
      authError = res.error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch failed") || msg.includes("ENOTFOUND")) {
        throw new Error(
          "Unable to reach Supabase authentication server. Please verify NEXT_PUBLIC_SUPABASE_URL in Vercel."
        );
      }
      throw new Error(msg);
    }

    if (authError || !authData.user) {
      throw new Error("Invalid email or password.");
    }

    const authUserId = authData.user.id;
    const admin = createAdminClient();

    // 1. Retrieve application user profile from PostgreSQL
    let user: User | null = null;
    if (isDbConfigured()) {
      try {
        const uRes = await query<User>(
          `SELECT id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at FROM users WHERE id = $1;`,
          [authUserId]
        );
        if (uRes.rows.length > 0) {
          user = uRes.rows[0];
        }
      } catch (err) {
        console.warn("[AuthService] DB query failed in login, fallback to admin client:", err);
      }
    }

    if (!user) {
      const { data: userData } = await admin
        .from("users")
        .select("*")
        .eq("id", authUserId)
        .single();
      if (userData) {
        user = userData as User;
      }

      if (isDbConfigured()) {
        try {
          const insertRes = await query<User>(
            `
            INSERT INTO users (id, business_id, email, full_name, role, status, is_platform_admin, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
              email = EXCLUDED.email,
              updated_at = NOW()
            RETURNING *;
            `,
            [
              authUserId,
              authData.user.user_metadata?.business_id || null,
              normalizedEmail,
              authData.user.user_metadata?.full_name || normalizedEmail.split("@")[0] || "User",
              authData.user.user_metadata?.role || "member",
              authData.user.user_metadata?.status || "pending",
            ]
          );
          if (insertRes.rows.length > 0) {
            user = insertRes.rows[0];
          }
        } catch (healErr) {
          console.warn("[AuthService] Auto-heal user in login failed:", healErr);
        }
      }
    }

    // 2. Strict Access Control Check
    const status = (user?.status || authData.user.user_metadata?.status || "pending").toLowerCase();

    if (status === "pending") {
      AuthService.clearSessionCache(authUserId);
      await supabase.auth.signOut().catch(() => {});
      throw new Error("Your account is awaiting administrator approval.");
    }

    if (status === "rejected") {
      AuthService.clearSessionCache(authUserId);
      await supabase.auth.signOut().catch(() => {});
      throw new Error("Your access request has been rejected.");
    }

    if (status === "blocked") {
      AuthService.clearSessionCache(authUserId);
      await supabase.auth.signOut().catch(() => {});
      throw new Error("Your account has been disabled. Please contact the administrator.");
    }

    if (status !== "active") {
      AuthService.clearSessionCache(authUserId);
      await supabase.auth.signOut().catch(() => {});
      throw new Error("Your account is not active.");
    }

    // Ensure Supabase Auth metadata matches active status and workspace from database
    if (user && user.status === "active" && (authData.user.user_metadata?.status !== "active" || authData.user.user_metadata?.business_id !== user.business_id)) {
      try {
        await admin.auth.admin.updateUserById(authUserId, {
          user_metadata: {
            status: "active",
            role: user.role,
            business_id: user.business_id,
          },
          app_metadata: {
            status: "active",
            role: user.role,
            business_id: user.business_id,
          },
        });
      } catch (syncErr) {
        console.warn("[AuthService] Failed to sync active status to Supabase Auth:", syncErr);
      }
    }

    if (!user) {
      user = {
        id: authUserId,
        business_id: authData.user.user_metadata?.business_id || null,
        email: authData.user.email || normalizedEmail,
        full_name: authData.user.user_metadata?.full_name || normalizedEmail.split("@")[0],
        role: (authData.user.user_metadata?.role as UserRole) || "member",
        status: "active",
        created_at: authData.user.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // 3. Update last_login_at timestamp
    if (isDbConfigured()) {
      try {
        await query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1;`, [authUserId]);
      } catch {}
    } else {
      await admin.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", authUserId);
    }

    // 4. Retrieve workspace association
    let business: Business | null = null;
    if (user.business_id) {
      if (isDbConfigured()) {
        try {
          const bRes = await query<Business>(`SELECT * FROM businesses WHERE id = $1;`, [user.business_id]);
          if (bRes.rows.length > 0) {
            business = bRes.rows[0];
          }
        } catch {}
      }
      if (!business) {
        const { data: bData } = await admin.from("businesses").select("*").eq("id", user.business_id).single();
        if (bData) {
          business = bData as Business;
        }
      }
    }

    // Support platform administrator console access if not tied to tenant workspace
    if (!business) {
      const isDev = isDeveloperUser(user);
      if (isDev) {
        business = {
          id: "platform-admin-workspace",
          name: "Platform Administration",
          industry: null,
          website: null,
          timezone: "UTC",
          status: "active",
          settings: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        throw new Error("Your account has not been assigned to a workspace yet. Please contact the administrator.");
      }
    }

    const sessionResult: AuthSessionResult = {
      user,
      business,
      authUser: {
        id: authData.user.id,
        email: authData.user.email,
      },
    };

    AuthService.sessionCache.set(authUserId, {
      session: sessionResult,
      expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
    });

    return {
      ...sessionResult,
      session: authData.session,
    };
  }

  /**
   * Retrieves current authenticated user and verifies active access status.
   * Rejects PENDING, BLOCKED, or REJECTED accounts with null.
   */
  public static async getCurrentSession(
    supabase: SupabaseClient
  ): Promise<AuthSessionResult | null> {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return null;
    }

    const cached = AuthService.sessionCache.get(authUser.id);
    if (cached && Date.now() < cached.expiresAt) {
      if (cached.session.user.status.toLowerCase() !== "active") {
        AuthService.sessionCache.delete(authUser.id);
        return null;
      }
      return cached.session;
    }

    const admin = createAdminClient();

    let user: User | null = null;
    if (isDbConfigured()) {
      try {
        const uRes = await query<User>(
          `SELECT id, business_id, email, full_name, role, status, is_platform_admin, last_login_at, created_at, updated_at FROM users WHERE id = $1;`,
          [authUser.id]
        );
        if (uRes.rows.length > 0) {
          user = uRes.rows[0];
        }
      } catch (err) {
        console.warn("[AuthService] DB query failed in getCurrentSession:", err);
      }
    }

    if (!user) {
      const { data: userData } = await admin
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .single();
      if (userData) {
        user = userData as User;
      }
    }

    if (!user) {
      return null;
    }

    // STRICT STATUS CHECK: Only ACTIVE accounts can access the application
    const status = (user.status || "").toLowerCase();
    if (status !== "active") {
      AuthService.clearSessionCache(authUser.id);
      return null;
    }

    // Retrieve business
    let business: Business | null = null;
    if (user.business_id) {
      if (isDbConfigured()) {
        try {
          const bRes = await query<Business>(`SELECT * FROM businesses WHERE id = $1;`, [user.business_id]);
          if (bRes.rows.length > 0) {
            business = bRes.rows[0];
          }
        } catch {}
      }
      if (!business) {
        const { data: bData } = await admin.from("businesses").select("*").eq("id", user.business_id).single();
        if (bData) {
          business = bData as Business;
        }
      }
    }

    if (!business) {
      const isDev = isDeveloperUser(user);
      if (isDev) {
        business = {
          id: "platform-admin-workspace",
          name: "Platform Administration",
          industry: null,
          website: null,
          timezone: "UTC",
          status: "active",
          settings: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        AuthService.clearSessionCache(authUser.id);
        return null;
      }
    }

    if (business.status.toLowerCase() !== "active") {
      AuthService.clearSessionCache(authUser.id);
      return null;
    }

    const sessionResult: AuthSessionResult = {
      user,
      business,
      authUser: {
        id: authUser.id,
        email: authUser.email,
      },
    };

    AuthService.sessionCache.set(authUser.id, {
      session: sessionResult,
      expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
    });

    return sessionResult;
  }

  /**
   * Signs out current user session and purges local memory cache.
   */
  public static async logout(supabase: SupabaseClient): Promise<void> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        AuthService.sessionCache.delete(user.id);
      }
    } catch {
      // Ignore
    }
    await supabase.auth.signOut();
  }
}

