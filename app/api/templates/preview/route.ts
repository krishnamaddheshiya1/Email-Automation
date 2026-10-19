import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, templateService } from "@/server/services";
import { renderPreviewSchema } from "@/lib/validations/template";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = renderPreviewSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 400 }
      );
    }

    const { subject, body: content, contact, sender } = validation.data;

    // Use current authenticated business and user as fallback sender context if not specified
    const senderContext = {
      sender_name: session.user.full_name || "Demo Sender",
      business_name: session.business.name || "Demo Business",
      ...sender,
    };

    const rendered = templateService.renderPreview({
      subject,
      body: content,
      contact,
      sender: senderContext,
    });

    return NextResponse.json({
      success: true,
      preview: rendered,
      isSampleData: !contact,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate preview";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
