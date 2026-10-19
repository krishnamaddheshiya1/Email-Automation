import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { validateUuid, validatePagination } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/contacts/[id]/conversations
 * Returns paginated conversation threads associated with this contact.
 * Multi-tenant scoped.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Contact ID");
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
    let limit = 20;

    if (pageParam !== null || limitParam !== null) {
      const pagResult = validatePagination(pageParam, limitParam, 100, 20);
      if (!pagResult.valid) {
        return NextResponse.json({ success: false, error: pagResult.error }, { status: 400 });
      }
      page = pagResult.page;
      limit = pagResult.limit;
    }

    const result = await replyService.listConversations({
      businessId: session.business.id,
      leadId: id,
      page,
      limit,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load contact conversations";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
