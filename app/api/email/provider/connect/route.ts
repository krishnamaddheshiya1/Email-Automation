import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { senderProviderService } from "@/server/services/sender-provider.service";
import { connectProviderSchema } from "@/lib/validations/email";

/**
 * POST /api/email/provider/connect
 * Validates Resend credentials with provider API before persisting.
 * Encrypts key at rest with AES-256-GCM.
 * Never leaks raw credentials in responses.
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

    // Role check: Only admin or owner can connect email providers
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to configure email provider." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = connectProviderSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const result = await senderProviderService.connectProvider(
      session.business.id,
      validation.data.apiKey,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      provider: result,
      message: "Resend email provider connected and verified successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect email provider";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
