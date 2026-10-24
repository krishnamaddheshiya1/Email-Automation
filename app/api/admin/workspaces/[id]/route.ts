import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";
import { z } from "zod";

const updateWorkspaceSchema = z.object({
  status: z.enum(["active", "suspended", "archived"]).optional(),
  name: z.string().min(1).max(100).optional(),
  allowed_email_domain: z.string().max(255).nullable().optional(),
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
    const uuidCheck = validateUuid(id, "Workspace ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const body = await request.json();
    const parseResult = updateWorkspaceSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Invalid payload";
      return NextResponse.json({ success: false, error: firstError }, { status: 400 });
    }

    const clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;

    await adminService.updateWorkspace(
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
      message: "Workspace updated successfully",
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 400, "Failed to update workspace");
  }
}
