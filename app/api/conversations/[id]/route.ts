import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function GET(
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
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Conversation ID is required." },
        { status: 400 }
      );
    }

    const conversation = await replyService.getConversationDetail(id, session.business.id);
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: "Conversation not found or access denied." },
        { status: 404 }
      );
    }

    // Auto-mark as read when opened
    await replyService.markAsRead(id, session.business.id);

    return NextResponse.json({
      success: true,
      data: conversation,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to retrieve conversation details.");
  }
}
