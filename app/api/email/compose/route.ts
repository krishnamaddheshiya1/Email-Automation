import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, emailService } from "@/server/services";
import { emailRegex } from "@/lib/validations/email";

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
    const to = String(body.to || "").trim().toLowerCase();
    const subject = String(body.subject || "").trim();
    const messageBody = String(body.body || "").trim();
    const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];

    if (!to || !emailRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: "A valid recipient email address is required." },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        { success: false, error: "Email subject is required." },
        { status: 400 }
      );
    }

    if (!messageBody) {
      return NextResponse.json(
        { success: false, error: "Email body content is required." },
        { status: 400 }
      );
    }

    const businessId = session.business.id;

    const result = await emailService.sendEmail(businessId, session.user.id, {
      to,
      subject,
      body: messageBody,
      attachmentIds,
      metadata: {
        source: "compose_modal",
        sent_by_user_id: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      messageId: result.message.id,
      providerMessageId: result.providerResult.providerMessageId,
      status: result.message.status,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
