import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/contacts/[id]/campaigns
 * Returns active and past campaign enrollments for a contact.
 * Multi-tenant scoped.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Contact ID");
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

    const campaigns = await contactService.getContactCampaigns(
      session.business.id,
      id
    );

    return NextResponse.json({
      success: true,
      campaigns,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load contact campaign enrollments";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
