import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

/**
 * Returns a standard Supabase client authenticated with the anonymous / publishable key.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY in environment variables."
      );
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
}

/**
 * Returns an administrative Supabase client authenticated with the secret / service role key.
 * This client bypasses RLS and should only be used in secure server-side environments.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!supabaseAdminClient) {
    const url = process.env.SUPABASE_URL;
    const secretKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (!url || !secretKey) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables."
      );
    }

    supabaseAdminClient = createClient(url, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseAdminClient;
}
