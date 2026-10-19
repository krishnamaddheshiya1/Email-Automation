import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const updated = await replyService.markAsUnread(id, session.business.id);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to mark conversation as unread.");
  }
}
