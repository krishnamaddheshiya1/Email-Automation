import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { emailService } from "@/server/services/email.service";
import { testSendEmailSchema } from "@/lib/validations/email";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";

/**
 * Authenticated Endpoint for Development / Admin Test Email Dispatch
 *
 * Requires explicit user action from the platform settings interface.
 * Strictly scoped to the authenticated tenant.
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

    const rl = rateLimiter.consumeProfile(`test_send:${session.business.id}`, RATE_LIMIT_PROFILES.TEST_EMAIL);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const body = await request.json();
    const validation = testSendEmailSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const result = await emailService.sendTestEmail(
      session.business.id,
      session.user.id,
      {
        to: validation.data.to,
        subject: validation.data.subject,
        body: validation.data.body,
        templateId: validation.data.template_id || undefined,
        senderIdentityId: validation.data.sender_identity_id || undefined,
        attachmentIds: validation.data.attachment_ids,
      }
    );

    return NextResponse.json({
      success: result.success,
      messageId: result.message.id,
      providerMessageId: result.message.provider_message_id,
      status: result.message.status,
      provider_status: result.providerResult?.status,
      provider: result.providerResult?.provider || "resend",
      accepted_by_provider: result.success && Boolean(result.message.provider_message_id),
      sender: result.message.from_email,
      recipient: result.message.to_email,
      renderedSubject: result.renderedSubject,
      renderedBody: result.renderedBody,
      sentAt: result.message.sent_at,
      error_code: result.providerResult?.error?.code,
      error_message: result.providerResult?.error?.message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to dispatch test email";
    const status = message.includes("suppressed") ? 422 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
