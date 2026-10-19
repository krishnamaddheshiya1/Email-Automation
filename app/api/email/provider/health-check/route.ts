import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { senderProviderService } from "@/server/services/sender-provider.service";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";

/**
 * POST /api/email/provider/health-check
 * Tests connectivity and credentials against Resend API without dispatching emails.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const rl = rateLimiter.consumeProfile(`health_check:${session.business.id}`, RATE_LIMIT_PROFILES.PROVIDER_HEALTH);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const result = await senderProviderService.checkProviderHealth(
      session.business.id,
      session.user.id
    );

    return NextResponse.json({
      success: result.status === "healthy",
      health: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Health check failed";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
