import { NextRequest, NextResponse } from "next/server";
import { emailService } from "@/server/services/email.service";
import { replyService } from "@/server/services/reply.service";
import {
  rateLimiter,
  RATE_LIMIT_PROFILES,
  extractClientIp,
  createRateLimitResponse,
} from "@/server/security/rate-limiter";

/**
 * Unified Resend Webhook Endpoint (/api/webhooks/resend)
 *
 * Handles both outbound delivery lifecycle events (sent, delivered, delivery_delayed,
 * bounced, complained, opened, clicked) and inbound customer replies (email.received)
 * with cryptographic Svix/HMAC signature verification and idempotency guarantees.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = extractClientIp(request.headers);
    const rl = rateLimiter.consumeProfile(`resend_webhook:${ip}`, RATE_LIMIT_PROFILES.WEBHOOK);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const rawBody = await request.text();

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Check payload structure to route appropriately
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed webhook JSON payload." },
        { status: 400 }
      );
    }

    const eventType = String(parsed?.type || "").toLowerCase();

    // If inbound email event (email.received or direct inbound payload structure)
    if (eventType === "email.received" || (parsed && "from" in parsed && !("type" in parsed))) {
      const inboundRes = await replyService.processInboundWebhook(rawBody, headers);
      if (!inboundRes.success) {
        const isAuthError =
          inboundRes.error?.includes("signature") || inboundRes.error?.includes("unauthenticated");
        return NextResponse.json(
          { success: false, error: inboundRes.error },
          { status: isAuthError ? 401 : 400 }
        );
      }
      return NextResponse.json(
        {
          success: true,
          message: inboundRes.idempotent
            ? "Inbound reply already processed (idempotent)."
            : "Inbound reply processed successfully.",
          idempotent: Boolean(inboundRes.idempotent),
          conversation_id: inboundRes.conversation?.id,
          message_id: inboundRes.message?.id,
        },
        { status: 200 }
      );
    }

    // Otherwise, dispatch delivery events to emailService.processWebhook
    const result = await emailService.processWebhook(rawBody, headers);

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
          ? "Event already processed (idempotent)."
          : "Webhook processed successfully.",
        idempotent: Boolean(result.idempotent),
        event_id: result.event?.id,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal webhook processing error";
    console.error("[Resend Webhook Handler] Unhandled error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
