import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, attachmentService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const validation = validateUuid(id, "Attachment ID");
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const attachment = await attachmentService.getAttachment(id, session.business.id);

    return NextResponse.json({
      success: true,
      attachment,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch attachment";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const validation = validateUuid(id, "Attachment ID");
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    await attachmentService.deleteAttachment(id, session.business.id, session.user.id);

    return NextResponse.json({
      success: true,
      message: "Attachment deleted successfully",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete attachment";
    const status =
      message.includes("not found") || message.includes("access denied")
        ? 404
        : message.includes("active campaign")
        ? 409
        : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
