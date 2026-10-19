import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { updateCampaignSchema } from "@/lib/validations/campaign";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const uuidCheck = validateUuid(id, "Campaign ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const campaign = await campaignService.getCampaign(id, session.business.id);

    return NextResponse.json({
      success: true,
      campaign,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Campaign not found";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const uuidCheck = validateUuid(id, "Campaign ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = updateCampaignSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await campaignService.updateCampaign(
      id,
      session.business.id,
      validation.data
    );

    return NextResponse.json({
      success: true,
      campaign,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update campaign";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(request: NextRequest, props: RouteParams) {
  return PATCH(request, props);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const uuidCheck = validateUuid(id, "Campaign ID");
    if (!uuidCheck.valid) {
      return NextResponse.json({ success: false, error: uuidCheck.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const hardDelete = searchParams.get("hard") === "true";

    if (hardDelete) {
      const deleted = await campaignService.deleteCampaign(id, session.business.id);
      return NextResponse.json({
        success: deleted,
        message: "Campaign permanently deleted.",
      });
    }

    const campaign = await campaignService.archiveCampaign(id, session.business.id);

    return NextResponse.json({
      success: true,
      message: "Campaign archived successfully.",
      campaign,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to archive campaign";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
