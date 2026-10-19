import { NextRequest, NextResponse } from "next/server";
import { replyService } from "@/server/services/reply.service";
import {
  rateLimiter,
  RATE_LIMIT_PROFILES,
  extractClientIp,
  createRateLimitResponse,
} from "@/server/security/rate-limiter";

/**
 * Dedicated Inbound Email Webhook Endpoint
 *
 * Receives incoming customer replies from external email providers (Resend, SendGrid, etc.).
 * Verifies authenticity, parses normalized email payloads, enforces idempotency,
 * matches tenants and contacts, and appends to the conversation thread.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = extractClientIp(request.headers);
    const rl = rateLimiter.consumeProfile(`inbound_webhook:${ip}`, RATE_LIMIT_PROFILES.WEBHOOK);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const rawBody = await request.text();

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const result = await replyService.processInboundWebhook(rawBody, headers);

    if (!result.success) {
      const isAuthError =
        result.error?.includes("signature") || result.error?.includes("unauthenticated");
      return NextResponse.json(
        { success: false, error: result.error },
        { status: isAuthError ? 401 : 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: result.idempotent
          ? "Inbound reply already processed (idempotent)."
          : "Inbound reply processed successfully.",
        idempotent: Boolean(result.idempotent),
        conversation_id: result.conversation?.id,
        message_id: result.message?.id,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal inbound webhook error";
    console.error("[Inbound Webhook Handler] Unhandled error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
