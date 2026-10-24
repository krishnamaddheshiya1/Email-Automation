import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";
import { z } from "zod";

const updateUserSchema = z.object({
  status: z.enum(["active", "inactive", "invited", "pending", "blocked", "rejected"]).optional(),
  role: z.enum(["owner", "admin", "member", "viewer", "platform_admin", "developer", "superadmin"]).optional(),
  business_id: z.string().uuid("Invalid workspace ID").nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const authCheck = await adminService.requireAdmin(supabase);

    if (!authCheck.authorized || !authCheck.session) {
      return NextResponse.json(
        { success: false, error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const { id } = await params;
    const uuidCheck = validateUuid(id, "User ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const body = await request.json();
    const parseResult = updateUserSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Invalid payload";
      return NextResponse.json({ success: false, error: firstError }, { status: 400 });
    }

    const clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;

    const updatedUser = await adminService.updateUser(
      {
        id: authCheck.session.user.id,
        email: authCheck.session.user.email,
      },
      id,
      parseResult.data,
      clientIp
    );

    return NextResponse.json({
      success: true,
      user: updatedUser,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 400, "Failed to update user");
  }
}
