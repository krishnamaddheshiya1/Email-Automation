import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function DELETE(
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
    const uuidCheck = validateUuid(id, "Authorized Email ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;

    await adminService.deleteAuthorizedEmail(
      {
        id: authCheck.session.user.id,
        email: authCheck.session.user.email,
      },
      id,
      clientIp
    );

    return NextResponse.json({
      success: true,
      message: "Authorized email deleted successfully.",
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 400, "Failed to delete authorized email");
  }
}
