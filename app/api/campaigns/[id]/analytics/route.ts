import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, analyticsService } from "@/server/services";
import { validateUuid, validateDateRange } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/[id]/analytics
 * Returns comprehensive campaign metrics, delivery rates, activity timeline, and step breakdown.
 * Enforces strict multi-tenant isolation.
 */
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
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rangeParam = searchParams.get("range") || "all";
    const range = (["today", "7d", "30d", "all", "custom"].includes(rangeParam)
      ? rangeParam
      : "all") as "today" | "7d" | "30d" | "all" | "custom";
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    if (from || to) {
      const dateVal = validateDateRange(from, to);
      if (!dateVal.valid) {
        return NextResponse.json({ success: false, error: dateVal.error }, { status: 400 });
      }
    }

    const analytics = await analyticsService.getCampaignAnalytics(
      session.business.id,
      id,
      { range, from, to }
    );

    return NextResponse.json({
      success: true,
      data: analytics,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load campaign analytics";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
