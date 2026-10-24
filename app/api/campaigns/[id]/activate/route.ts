import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Campaign ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rl = rateLimiter.consumeProfile(`activate:${session.business.id}`, RATE_LIMIT_PROFILES.CAMPAIGN_ACTIVATION);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const { campaign, validation } = await campaignService.activateCampaign(
      id,
      session.business.id
    );

    return NextResponse.json({
      success: true,
      campaign,
      validation,
      message: "Campaign activated successfully.",
    });
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const isLimitReached =
      errObj?.code === "DAILY_EMAIL_LIMIT_REACHED" ||
      errObj?.code === "MONTHLY_EMAIL_LIMIT_REACHED" ||
      (err instanceof Error &&
        (err.message.includes("DAILY_EMAIL_LIMIT_REACHED") ||
          err.message.includes("MONTHLY_EMAIL_LIMIT_REACHED")));

    if (isLimitReached) {
      const code =
        (errObj?.code as string) ||
        (String(errObj?.message || "").includes("MONTHLY")
          ? "MONTHLY_EMAIL_LIMIT_REACHED"
          : "DAILY_EMAIL_LIMIT_REACHED");
      return NextResponse.json(
        {
          success: false,
          error: code,
          code,
          limitType: errObj?.limitType || (code === "MONTHLY_EMAIL_LIMIT_REACHED" ? "monthly" : "daily"),
          dailySent: errObj?.dailySent,
          dailyLimit: errObj?.dailyLimit || 1500,
          dailyRemaining: errObj?.dailyRemaining,
          monthlySent: errObj?.monthlySent,
          monthlyLimit: errObj?.monthlyLimit || 50000,
          monthlyRemaining: errObj?.monthlyRemaining,
          attemptedCount: errObj?.attemptedCount,
          message: err instanceof Error ? err.message : "Sending limit reached.",
        },
        { status: 429 }
      );
    }

    const message = err instanceof Error ? err.message : "Failed to activate campaign";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
