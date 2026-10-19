import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, emailService, deliverySafetyService } from "@/server/services";
import { BusinessRepository } from "@/server/repositories/business.repository";
import { senderSettingsSchema } from "@/lib/validations/email";

const businessRepo = new BusinessRepository();

export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const business = await businessRepo.findById(session.business.id);
    const settings = (business?.settings || {}) as Record<string, unknown>;
    const emailConfig = (settings.email_sender || {}) as Record<string, string>;

    const sender = await emailService.resolveSenderIdentity(session.business.id);
    const providerInfo = emailService.getProviderInfo();
    const limits = await deliverySafetyService.getLimits(session.business.id);

    return NextResponse.json({
      success: true,
      provider: providerInfo.name,
      isConfigured: providerInfo.isConfigured,
      fromName: sender.fromName,
      fromEmail: sender.fromEmail,
      replyTo: sender.replyTo || null,
      customConfig: {
        from_name: emailConfig.from_name || "",
        from_email: emailConfig.from_email || "",
        reply_to: emailConfig.reply_to || "",
      },
      sendingLimits: limits,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load email settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Role check: Only admin or owner can update delivery settings
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to update delivery settings." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = senderSettingsSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const business = await businessRepo.findById(session.business.id);
    if (!business) {
      return NextResponse.json({ success: false, error: "Business not found." }, { status: 404 });
    }

    const currentSettings = (business.settings || {}) as Record<string, unknown>;
    const currentSender = (currentSettings.email_sender || {}) as Record<string, string>;
    const currentLimits = (currentSettings.sending_limits || {}) as Record<string, unknown>;

    const updatedSender = {
      ...currentSender,
      ...(validation.data.from_name !== undefined ? { from_name: validation.data.from_name } : {}),
      ...(validation.data.from_email !== undefined ? { from_email: validation.data.from_email } : {}),
      ...(validation.data.reply_to !== undefined ? { reply_to: validation.data.reply_to } : {}),
    };

    const updatedLimits = {
      ...currentLimits,
      ...(validation.data.daily_send_limit !== undefined ? { daily_send_limit: validation.data.daily_send_limit } : {}),
      ...(validation.data.hourly_send_limit !== undefined ? { hourly_send_limit: validation.data.hourly_send_limit } : {}),
      ...(validation.data.send_rate_per_minute !== undefined ? { send_rate_per_minute: validation.data.send_rate_per_minute } : {}),
    };

    const updated = await businessRepo.update(session.business.id, {
      settings: {
        ...currentSettings,
        email_sender: updatedSender,
        sending_limits: updatedLimits,
      },
    });

    const activeLimits = await deliverySafetyService.getLimits(session.business.id);

    return NextResponse.json({
      success: true,
      settings: updated.settings,
      sendingLimits: activeLimits,
      message: "Delivery and sending limit settings saved successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update email settings";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
