import { NextRequest, NextResponse } from "next/server";
import { emailService } from "@/server/services/email.service";
import { rateLimiter, RATE_LIMIT_PROFILES, extractClientIp, createRateLimitResponse } from "@/server/security/rate-limiter";

/**
 * Public Webhook Endpoint for Email Provider Delivery Events
 *
 * Receives delivery, bounce, complaint, and open events from external providers.
 * Cryptographically verifies request authenticity and enforces idempotent event processing.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = extractClientIp(request.headers);
    const rl = rateLimiter.consumeProfile(`webhook:${ip}`, RATE_LIMIT_PROFILES.WEBHOOK);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const rawBody = await request.text();

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

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
        message: result.idempotent ? "Event already processed (idempotent)." : "Webhook processed successfully.",
        idempotent: Boolean(result.idempotent),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal webhook processing error";
    console.error("[Webhook Handler] Unhandled error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
