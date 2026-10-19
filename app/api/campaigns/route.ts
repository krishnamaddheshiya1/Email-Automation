import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { createCampaignSchema } from "@/lib/validations/campaign";
import { validatePagination, sanitizeSearchQuery } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function GET(request: NextRequest) {
  try {
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
    const sortBy =
      (searchParams.get("sortBy") as "created_at" | "updated_at" | "name" | "status") ||
      undefined;
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || undefined;

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

    const result = await campaignService.listCampaigns(session.business.id, {
      search,
      status,
      sortBy,
      sortOrder,
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
    const validation = createCampaignSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await campaignService.createCampaign(
      session.business.id,
      validation.data
    );

    return NextResponse.json(
      { success: true, campaign },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create campaign";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
