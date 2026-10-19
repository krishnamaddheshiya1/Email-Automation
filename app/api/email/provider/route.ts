import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { senderProviderService } from "@/server/services/sender-provider.service";

/**
 * GET /api/email/provider
 * Retrieves safe email provider configuration for the authenticated business.
 * Never leaks raw API keys or secrets.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const providerStatus = await senderProviderService.getProviderStatus(session.business.id);

    return NextResponse.json({
      success: true,
      provider: providerStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load provider status";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/email/provider
 * Disables custom email provider credentials for the authenticated business.
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Role check: Only admin or owner can manage email providers
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to manage email provider." },
        { status: 403 }
      );
    }

    await senderProviderService.disableProvider(session.business.id, session.user.id);

    return NextResponse.json({
      success: true,
      message: "Email provider disabled successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to disable provider";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
