import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { z } from "zod";

const simulateReplySchema = z.object({
  from_email: z.string().email("A valid sender email address is required"),
  from_name: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
  campaign_id: z.string().optional(),
  in_reply_to: z.string().optional(),
});

/**
 * POST /api/conversations/simulate-reply
 *
 * Simulates receiving an inbound customer reply from a lead/contact.
 * Links to existing conversation thread or creates a new one,
 * updates lead status to 'replied', halts any active campaign sequence for that contact,
 * records the email event, and updates the inbox and dashboard reply counts.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const json = await request.json();
    const validation = simulateReplySchema.safeParse(json);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0]?.message || "Validation failed" },
        { status: 400 }
      );
    }

    const { from_email, from_name, subject, body, campaign_id, in_reply_to } = validation.data;

    const result = await replyService.recordCustomerReply(session.business.id, {
      fromEmail: from_email,
      fromName: from_name,
      subject,
      body,
      campaignId: campaign_id,
      inReplyTo: in_reply_to,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to record customer reply." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        conversation: result.conversation,
        message: result.message,
      },
      message: `Customer reply from ${from_email} recorded successfully.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to process customer reply simulation.";
    console.error("[Simulate Reply Route] Error:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
