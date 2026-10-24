import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { createSafeErrorResponse } from "@/lib/security/error-handler";
import { z } from "zod";

const approveUserSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  workspace_id: z.string().uuid().optional(),
  newWorkspaceName: z.string().min(1).max(100).optional(),
  new_workspace_name: z.string().min(1).max(100).optional(),
  role: z.enum(["owner", "admin", "member", "viewer", "OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
});

export async function POST(
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

    let body = {};
    try {
      body = await request.json();
    } catch {}

    const parseResult = approveUserSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Invalid payload";
      return NextResponse.json({ success: false, error: firstError }, { status: 400 });
    }

    const workspaceId = parseResult.data.workspaceId || parseResult.data.workspace_id;
    const newWorkspaceName = parseResult.data.newWorkspaceName || parseResult.data.new_workspace_name;
    const role = (parseResult.data.role || "member").toLowerCase();

    const clientIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;

    const approvedUser = await adminService.approveUser(
      {
        id: authCheck.session.user.id,
        email: authCheck.session.user.email,
      },
      id,
      {
        workspaceId,
        newWorkspaceName,
        role,
      },
      clientIp
    );

    return NextResponse.json({
      success: true,
      user: approvedUser,
      message: `User ${approvedUser.email} has been approved successfully.`,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 400, "Failed to approve user");
  }
}
