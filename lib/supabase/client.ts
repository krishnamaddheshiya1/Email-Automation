import { createBrowserClient } from "@supabase/ssr";

const FALLBACK_URL = "https://placeholder-auth.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

/**
 * Creates a Supabase client for Client Components.
 * Automatically synchronizes auth state with browser cookies.
 */
export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    FALLBACK_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_KEY;

  return createBrowserClient(url, key);
}
