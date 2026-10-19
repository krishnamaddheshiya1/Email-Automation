import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services/auth.service";
import { senderProviderService } from "@/server/services/sender-provider.service";
import { updateSenderIdentitySchema } from "@/lib/validations/email";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/senders/[id]
 * Retrieves a single sender identity scoped to the business.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Sender ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const sender = await senderProviderService.getSenderIdentity(session.business.id, id);
    if (!sender) {
      return NextResponse.json(
        { success: false, error: "Sender identity not found or access denied." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      sender,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get sender identity";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/senders/[id]
 * Updates a sender identity scoped to the business.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Sender ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    // Role check: Only admin or owner can update sender identities
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to update sender identities." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = updateSenderIdentitySchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await senderProviderService.updateSenderIdentity(
      session.business.id,
      id,
      validation.data,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      sender: updated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update sender identity";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * DELETE /api/senders/[id]
 * Deletes a sender identity scoped to the business.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Sender ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    // Role check: Only admin or owner can delete sender identities
    if (session.user.role !== "admin" && session.user.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Administrative privilege required to delete sender identities." },
        { status: 403 }
      );
    }

    await senderProviderService.deleteSenderIdentity(
      session.business.id,
      id,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      message: "Sender identity deleted successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete sender identity";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
