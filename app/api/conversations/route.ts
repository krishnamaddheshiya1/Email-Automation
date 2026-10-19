import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { validatePagination, sanitizeSearchQuery } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";
import { ConversationFilterType } from "@/types/database";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rawSearch = searchParams.get("search") || searchParams.get("q") || undefined;
    const search = sanitizeSearchQuery(rawSearch);
    const filter = (searchParams.get("filter") || "all") as ConversationFilterType;
    const leadId = searchParams.get("contact_id") || searchParams.get("lead_id") || undefined;
    const campaignId = searchParams.get("campaign_id") || undefined;

    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    let validatedPage = 1;
    let validatedLimit = 25;

    if (pageParam !== null || limitParam !== null) {
      const pagResult = validatePagination(pageParam, limitParam, 100, 25);
      if (!pagResult.valid) {
        return NextResponse.json({ success: false, error: pagResult.error }, { status: 400 });
      }
      validatedPage = pagResult.page;
      validatedLimit = pagResult.limit;
    }

    const result = await replyService.listConversations({
      businessId: session.business.id,
      leadId,
      campaignId,
      filter,
      search,
      page: validatedPage,
      limit: validatedLimit,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to retrieve conversations.");
  }
}
