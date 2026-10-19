import { NextResponse } from "next/server";
import { isSupabaseConfigured, isSupabaseAdminConfigured } from "@/lib/supabase/config";

export async function GET() {
  const isConfigured = isSupabaseConfigured();
  const isAdminConfigured = isSupabaseAdminConfigured();

  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !process.env.SUPABASE_ANON_KEY &&
    !process.env.SUPABASE_PUBLISHABLE_KEY
  ) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  return NextResponse.json({
    configured: isConfigured && isAdminConfigured,
    missing,
  });
}
