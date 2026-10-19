import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string; contactId: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, contactId } = await params;
    const campValidation = validateUuid(id, "Campaign ID");
    if (!campValidation.valid) {
      return NextResponse.json({ success: false, error: campValidation.error }, { status: 400 });
    }
    const contactValidation = validateUuid(contactId, "Contact ID");
    if (!contactValidation.valid) {
      return NextResponse.json({ success: false, error: contactValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const removed = await campaignService.removeContact(
      id,
      contactId,
      session.business.id
    );

    if (!removed) {
      return NextResponse.json(
        { success: false, error: "Contact enrollment not found or already removed" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Contact removed from campaign successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove contact from campaign";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
