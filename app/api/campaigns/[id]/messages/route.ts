import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, analyticsService } from "@/server/services";
import { validateUuid, validatePagination } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/[id]/messages
 * Returns paginated email message execution history for this campaign.
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
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    let page = 1;
    let limit = 50;

    if (pageParam !== null || limitParam !== null) {
      const pagResult = validatePagination(pageParam, limitParam, 100, 50);
      if (!pagResult.valid) {
        return NextResponse.json({ success: false, error: pagResult.error }, { status: 400 });
      }
      page = pagResult.page;
      limit = pagResult.limit;
    }

    const status = searchParams.get("status") || undefined;

    const result = await analyticsService.getCampaignMessages(
      session.business.id,
      id,
      { page, limit, status }
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load campaign messages";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
