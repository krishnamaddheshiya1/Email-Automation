import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { bulkEnrollSchema } from "@/lib/validations/contact";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = bulkEnrollSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const result = await contactService.bulkEnroll(
      session.business.id,
      validation.data.campaign_id,
      validation.data.contact_ids
    );

    return NextResponse.json({
      success: true,
      ...result,
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

    const message = err instanceof Error ? err.message : "Failed to bulk enroll contacts";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
