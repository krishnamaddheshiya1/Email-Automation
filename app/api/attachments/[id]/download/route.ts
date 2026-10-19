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

    const { attachment, buffer } = await attachmentService.downloadAttachment(
      id,
      session.business.id
    );

    const safeFilename = encodeURIComponent(attachment.original_filename);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": attachment.mime_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${attachment.original_filename}"; filename*=UTF-8''${safeFilename}`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to download attachment";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
