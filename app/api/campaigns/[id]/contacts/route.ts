import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { enrollContactsSchema } from "@/lib/validations/campaign";
import { validateUuid, validatePagination, sanitizeSearchQuery } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const { searchParams } = new URL(request.url);
    const rawSearch = searchParams.get("search") || undefined;
    const search = sanitizeSearchQuery(rawSearch);
    const status = searchParams.get("status") || "all";

    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    let page: number | undefined;
    let limit: number | undefined;

    if (pageParam !== null || limitParam !== null) {
      const pagResult = validatePagination(pageParam, limitParam, 100, 50);
      if (!pagResult.valid) {
        return NextResponse.json({ success: false, error: pagResult.error }, { status: 400 });
      }
      page = pagResult.page;
      limit = pagResult.limit;
    }

    const result = await campaignService.getEnrolledContacts(
      id,
      session.business.id,
      { search, status, page, limit }
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch enrolled contacts";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
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

    const body = await request.json();
    const validation = enrollContactsSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const {
      contact_ids,
      allow_override,
      range_type,
      rangeType,
      start_row,
      startRow,
      end_row,
      endRow,
      total_available,
    } = validation.data;

    const effectiveRangeType = rangeType || range_type || "all";
    if (effectiveRangeType === "range" || effectiveRangeType === "custom") {
      const availableRows =
        total_available !== null && total_available !== undefined && total_available > 0
          ? total_available
          : contact_ids.length;

      const { validateRowRange } = await import("@/lib/validations/contact");
      const rangeVal = validateRowRange(availableRows, {
        rangeType: "range",
        startRow: startRow ?? start_row,
        endRow: endRow ?? end_row,
      });

      if (!rangeVal.isValid) {
        return NextResponse.json(
          { success: false, error: rangeVal.error || "Invalid enrollment range." },
          { status: 400 }
        );
      }
    }

    const result = await campaignService.enrollContacts(
      id,
      session.business.id,
      contact_ids,
      { allowOverride: Boolean(allow_override) }
    );

    return NextResponse.json({
      success: true,
      ...result,
      message: `Enrolled ${result.enrolledCount} contact(s). ${result.skippedCount > 0 ? `(${result.skippedCount} skipped)` : ""}`,
    });
  } catch (err: unknown) {
    const isAlreadyContacted =
      (err as { code?: string })?.code === "ALREADY_CONTACTED" ||
      (err instanceof Error && err.message.includes("ALREADY_CONTACTED"));

    if (isAlreadyContacted) {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_CONTACTED",
          message: "This contact has already received an email from this campaign.",
        },
        { status: 409 }
      );
    }

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

    const message = err instanceof Error ? err.message : "Failed to enroll contacts";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
