import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://placeholder-auth.supabase.co";
const FALLBACK_SERVICE_KEY = "placeholder-service-role-key";

/**
 * Creates an administrative Supabase client using the Secret / Service Role Key.
 * NEVER expose this to the browser.
 */
export function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    FALLBACK_URL;
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    FALLBACK_SERVICE_KEY;

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
