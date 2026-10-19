/**
 * Utility functions to inspect Supabase configuration status.
 */

export function isSupabaseConfigured(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  return Boolean(
    url &&
    !url.includes("placeholder-auth.supabase.co") &&
    key &&
    !key.includes("placeholder")
  );
}

export function isSupabaseAdminConfigured(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    "";

  return Boolean(
    url &&
    !url.includes("placeholder-auth.supabase.co") &&
    secretKey &&
    !secretKey.includes("placeholder")
  );
}
