import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { deliverySafetyService } from "@/server/services/delivery-safety.service";
import { SuppressionRepository } from "@/server/repositories/suppression.repository";
import { emailAddressSchema } from "@/lib/validations/email";
import { validateEmailAddress } from "@/lib/security/input-validation";
import { z } from "zod";

const suppressionRepo = new SuppressionRepository();

const addSuppressionSchema = z.object({
  email: emailAddressSchema,
  reason: z
    .enum([
      "UNSUBSCRIBED",
      "HARD_BOUNCE",
      "COMPLAINT",
      "MANUAL",
      "INVALID",
      "unsubscribe",
      "bounce",
      "spam_complaint",
      "manual",
      "invalid",
    ])
    .default("MANUAL"),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const emailCheck = searchParams.get("email");

    if (emailCheck) {
      const emailVal = validateEmailAddress(emailCheck);
      if (!emailVal.valid) {
        return NextResponse.json({ success: false, error: emailVal.error }, { status: 400 });
      }
      const record = await suppressionRepo.getSuppression(session.business.id, emailVal.normalized!);
      return NextResponse.json({
        success: true,
        isSuppressed: Boolean(record),
        suppression: record || null,
      });
    }

    const list = await suppressionRepo.listSuppressions(session.business.id);
    return NextResponse.json({
      success: true,
      data: list,
      total: list.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load suppressions";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = addSuppressionSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const record = await deliverySafetyService.addManualSuppression(
      session.business.id,
      validation.data.email,
      validation.data.reason
    );

    return NextResponse.json({
      success: true,
      message: `Email "${validation.data.email}" added to suppression list.`,
      suppression: record,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add suppression";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Missing required email parameter." },
        { status: 400 }
      );
    }

    const emailVal = validateEmailAddress(email);
    if (!emailVal.valid) {
      return NextResponse.json({ success: false, error: emailVal.error }, { status: 400 });
    }

    const removed = await deliverySafetyService.removeManualSuppression(
      session.business.id,
      emailVal.normalized!
    );

    return NextResponse.json({
      success: true,
      removed,
      message: removed
        ? `Suppression for "${email}" was removed. (Note: Contacts must be explicitly re-enrolled).`
        : `No active suppression found for "${email}".`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove suppression";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
