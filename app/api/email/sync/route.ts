import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, emailService } from "@/server/services";

/**
 * GET/POST /api/email/sync
 *
 * Synchronizes email delivery status (Delivered, Opened, Bounced, Complained)
 * from Resend with the local database and platform store.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    const businessId = session?.business?.id || undefined;
    const result = await emailService.syncProviderStatuses(businessId);

    return NextResponse.json({
      success: true,
      data: result,
      message: `Synced ${result.synced} email status updates (${result.delivered} delivered, ${result.opened} opened, ${result.bounced} bounced).`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.warn("[Email Sync Route] Error:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
