import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { validatePagination, sanitizeSearchQuery } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authCheck = await adminService.requireAdmin(supabase);

    if (!authCheck.authorized) {
      return NextResponse.json(
        { success: false, error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = sanitizeSearchQuery(searchParams.get("search") || undefined);
    const status = searchParams.get("status") || undefined;
    const businessId = searchParams.get("businessId") || undefined;

    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    let validatedPage: number | undefined;
    let validatedLimit: number | undefined;

    if (pageParam !== null || limitParam !== null) {
      const pagResult = validatePagination(pageParam, limitParam, 100, 20);
      if (!pagResult.valid) {
        return NextResponse.json({ success: false, error: pagResult.error }, { status: 400 });
      }
      validatedPage = pagResult.page;
      validatedLimit = pagResult.limit;
    }

    const result = await adminService.listCampaigns({
      search,
      status,
      businessId,
      page: validatedPage,
      limit: validatedLimit,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to fetch campaigns");
  }
}
