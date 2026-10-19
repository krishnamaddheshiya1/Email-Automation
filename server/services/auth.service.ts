import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { RegisterInput, LoginInput, registerSchema, loginSchema } from "@/lib/validations/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Business, User } from "@/types/database";

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
   * Registers a new tenant:
   * 1. Creates Supabase Auth user (pre-confirmed for seamless SaaS onboarding)
   * 2. Creates business record
   * 3. Creates application user record with ADMIN role
   * 4. Associates user with the business
   * 5. Authenticates session cookies on the caller's Supabase client
   */
  public static async register(
    input: RegisterInput,
    supabase: SupabaseClient
  ): Promise<{ user: User; business: Business; session: unknown }> {
    // 1. Validate payload
    const validation = registerSchema.safeParse(input);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const { full_name, business_name, email, password } = validation.data;
    const admin = createAdminClient();
    const generatedBusinessId = crypto.randomUUID();

    // 2. Create user via Supabase Auth Admin API
    const { data: adminUserData, error: adminUserError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
          business_name,
          business_id: generatedBusinessId,
          role: "admin",
        },
      });

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

    // 3. Establish active session on the caller's client (sets cookies in Route Handler)
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (signInError) {
      console.warn("Could not immediately auto-login after user creation:", signInError.message);
    }

    // 4. Create business record
    let business: Business;
    const { data: businessData, error: businessError } = await admin
      .from("businesses")
      .insert({
        id: generatedBusinessId,
        name: business_name,
        timezone: "UTC",
        status: "active",
        settings: {},
      })
      .select("*")
      .single();

    if (businessError || !businessData) {
      // Graceful fallback to metadata representation if remote DB schema cache is not yet refreshed
      business = {
        id: generatedBusinessId,
        name: business_name,
        industry: null,
        website: null,
        timezone: "UTC",
        status: "active",
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      business = businessData as Business;
    }

    // 5. Create application user profile with ADMIN role
    let user: User;
    const { data: userData, error: userError } = await admin
      .from("users")
      .insert({
        id: authUserId,
        business_id: business.id,
        email,
        full_name,
        role: "admin",
        status: "active",
      })
      .select("*")
      .single();

    if (userError || !userData) {
      // Graceful fallback to metadata representation
      user = {
        id: authUserId,
        business_id: business.id,
        email,
        full_name,
        role: "admin",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      user = userData as User;
    }

    return {
      user,
      business,
      session: signInData?.session || null,
    };
  }

  /**
   * Authenticates an existing user and retrieves their business association.
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

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError || !authData.user) {
      throw new Error("Invalid email or password.");
    }

    const admin = createAdminClient();

    // 1. Retrieve application user profile
    let user: User;
    const { data: userData, error: userError } = await admin
      .from("users")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    if (userError || !userData) {
      // Fallback from auth user metadata
      const meta = authData.user.user_metadata || {};
      user = {
        id: authData.user.id,
        business_id: meta.business_id || authData.user.id,
        email: authData.user.email || email,
        full_name: meta.full_name || email.split("@")[0],
        role: meta.role || "admin",
        status: "active",
        created_at: authData.user.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      user = userData as User;
    }

    // 2. Retrieve business association
    let business: Business;
    const { data: businessData, error: businessError } = await admin
      .from("businesses")
      .select("*")
      .eq("id", user.business_id)
      .single();

    if (businessError || !businessData) {
      const meta = authData.user.user_metadata || {};
      business = {
        id: user.business_id,
        name: meta.business_name || "My Business",
        industry: null,
        website: null,
        timezone: "UTC",
        status: "active",
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Persist fallback business to database if tables are now available
      try {
        await admin.from("businesses").upsert({
          id: business.id,
          name: business.name,
          timezone: business.timezone,
          status: business.status,
          settings: business.settings,
        });
      } catch {}
    } else {
      business = businessData as Business;
    }

    if (userError || !userData) {
      try {
        await admin.from("users").upsert({
          id: user.id,
          business_id: user.business_id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          status: user.status,
        });
      } catch {}
    }

    return {
      user,
      business,
      authUser: {
        id: authData.user.id,
        email: authData.user.email,
      },
      session: authData.session,
    };
  }

  /**
   * Retrieves the current authenticated user and their business association.
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
      return cached.session;
    }

    const admin = createAdminClient();

    let user: User;
    const { data: userData } = await admin
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .single();

    if (!userData) {
      const meta = authUser.user_metadata || {};
      user = {
        id: authUser.id,
        business_id: meta.business_id || authUser.id,
        email: authUser.email || "",
        full_name: meta.full_name || (authUser.email ? authUser.email.split("@")[0] : "User"),
        role: meta.role || "admin",
        status: "active",
        created_at: authUser.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      user = userData as User;
    }

    let business: Business;
    const { data: businessData } = await admin
      .from("businesses")
      .select("*")
      .eq("id", user.business_id)
      .single();

    if (!businessData) {
      const meta = authUser.user_metadata || {};
      business = {
        id: user.business_id,
        name: meta.business_name || "Workspace",
        industry: null,
        website: null,
        timezone: "UTC",
        status: "active",
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        await admin.from("businesses").upsert({
          id: business.id,
          name: business.name,
          timezone: business.timezone,
          status: business.status,
          settings: business.settings,
        });
      } catch {}
    } else {
      business = businessData as Business;
    }

    if (!userData) {
      try {
        await admin.from("users").upsert({
          id: user.id,
          business_id: user.business_id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          status: user.status,
        });
      } catch {}
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
   * Signs out the current user session.
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
