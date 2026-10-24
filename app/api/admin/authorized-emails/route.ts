import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { sanitizeSearchQuery, validatePagination } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";
import { z } from "zod";

const addAuthorizedEmailSchema = z.object({
  email: z.string().email("Valid email required"),
  businessId: z.string().uuid().nullable().optional(),
  business_id: z.string().uuid().nullable().optional(),
  role: z.enum(["owner", "admin", "member", "viewer", "OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
  autoApprove: z.boolean().optional(),
  auto_approve: z.boolean().optional(),
});

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

    const result = await adminService.listAuthorizedEmails({
      search,
      page: validatedPage,
      limit: validatedLimit,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to fetch authorized emails");
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authCheck = await adminService.requireAdmin(supabase);

    if (!authCheck.authorized || !authCheck.session) {
      return NextResponse.json(
        { success: false, error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const body = await request.json();
    const parseResult = addAuthorizedEmailSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Invalid payload";
      return NextResponse.json({ success: false, error: firstError }, { status: 400 });
    }

    const email = parseResult.data.email;
    const businessId = parseResult.data.businessId || parseResult.data.business_id || null;
    const role = (parseResult.data.role || "member").toLowerCase();
    const autoApprove = parseResult.data.autoApprove ?? parseResult.data.auto_approve ?? true;

    const clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;

    const item = await adminService.addAuthorizedEmail(
      {
        id: authCheck.session.user.id,
        email: authCheck.session.user.email,
      },
      {
        email,
        businessId,
        role,
        autoApprove,
      },
      clientIp
    );

    return NextResponse.json({
      success: true,
      item,
      message: `Email ${email} has been added to authorized emails allowlist.`,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 400, "Failed to add authorized email");
  }
}
