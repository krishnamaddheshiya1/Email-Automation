import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { analyticsService } from "@/server/services/analytics.service";
import { validateDateRange } from "@/lib/security/input-validation";

/**
 * GET /api/analytics/overview
 * Returns tenant-wide deliverability overview and campaign performance comparison.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const range = (searchParams.get("range") || "all") as "today" | "7d" | "30d" | "all" | "custom";
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    if (from || to) {
      const dateVal = validateDateRange(from, to);
      if (!dateVal.valid) {
        return NextResponse.json({ success: false, error: dateVal.error }, { status: 400 });
      }
    }

    const data = await analyticsService.getBusinessAnalytics(session.business.id, {
      range,
      from,
      to,
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load business analytics.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
