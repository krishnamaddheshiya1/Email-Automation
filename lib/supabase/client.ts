import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for Client Components.
 * Automatically synchronizes auth state with browser cookies.
 */
export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  return createBrowserClient(url, key);
}
