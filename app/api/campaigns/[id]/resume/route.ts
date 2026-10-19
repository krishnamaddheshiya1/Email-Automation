import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Campaign ID");
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

    const campaign = await campaignService.resumeCampaign(id, session.business.id);

    return NextResponse.json({
      success: true,
      campaign,
      message: "Campaign resumed successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resume campaign";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
