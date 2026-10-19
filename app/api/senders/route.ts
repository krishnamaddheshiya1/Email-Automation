import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { senderProviderService } from "@/server/services/sender-provider.service";
import { createSenderIdentitySchema } from "@/lib/validations/email";

/**
 * GET /api/senders
 * Lists sender identities configured for the authenticated business.
 */
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

    const senders = await senderProviderService.listSenderIdentities(session.business.id);

    return NextResponse.json({
      success: true,
      senders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load sender identities";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/senders
 * Creates a new sender identity for the authenticated business.
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

    // Role check: Only admin or owner can create sender identities
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to manage sender identities." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = createSenderIdentitySchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const sender = await senderProviderService.createSenderIdentity(
      session.business.id,
      validation.data,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      sender,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create sender identity";
    const status = message.includes("already exists") ? 409 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
