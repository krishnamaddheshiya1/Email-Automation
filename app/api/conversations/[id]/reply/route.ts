import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import {
  rateLimiter,
  RATE_LIMIT_PROFILES,
  createRateLimitResponse,
} from "@/server/security/rate-limiter";
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
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Conversation ID is required." },
        { status: 400 }
      );
    }

    // Rate Limiting per business
    const rl = rateLimiter.consumeProfile(
      `reply_send:${session.business.id}`,
      RATE_LIMIT_PROFILES.TEST_EMAIL
    );
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const json = await request.json();
    const body = typeof json.body === "string" ? json.body.trim() : "";
    const subject = typeof json.subject === "string" ? json.subject.trim() : undefined;
    const attachmentIds = Array.isArray(json.attachmentIds)
      ? json.attachmentIds.filter((x: unknown): x is string => typeof x === "string")
      : undefined;

    if (!body) {
      return NextResponse.json(
        { success: false, error: "Reply body message cannot be empty." },
        { status: 400 }
      );
    }

    const result = await replyService.sendReply(
      id,
      session.business.id,
      session.user.id,
      {
        body,
        subject,
        attachmentIds,
      }
    );

    return NextResponse.json(
      {
        success: true,
        message: "Reply sent successfully.",
        data: result,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to send email reply.");
  }
}
