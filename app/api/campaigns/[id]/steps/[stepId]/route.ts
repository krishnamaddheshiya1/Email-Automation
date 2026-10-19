import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { updateCampaignStepSchema } from "@/lib/validations/campaign";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string; stepId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, stepId } = await params;
    const campValidation = validateUuid(id, "Campaign ID");
    if (!campValidation.valid) {
      return NextResponse.json({ success: false, error: campValidation.error }, { status: 400 });
    }
    const stepValidation = validateUuid(stepId, "Step ID");
    if (!stepValidation.valid) {
      return NextResponse.json({ success: false, error: stepValidation.error }, { status: 400 });
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
    const validation = updateCampaignStepSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const updatedStep = await campaignService.updateStep(
      id,
      stepId,
      session.business.id,
      validation.data
    );

    return NextResponse.json({
      success: true,
      step: updatedStep,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update campaign step";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(request: NextRequest, props: RouteParams) {
  return PATCH(request, props);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, stepId } = await params;
    const campValidation = validateUuid(id, "Campaign ID");
    if (!campValidation.valid) {
      return NextResponse.json({ success: false, error: campValidation.error }, { status: 400 });
    }
    const stepValidation = validateUuid(stepId, "Step ID");
    if (!stepValidation.valid) {
      return NextResponse.json({ success: false, error: stepValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const deleted = await campaignService.deleteStep(
      id,
      stepId,
      session.business.id
    );

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Step not found or could not be deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Step deleted successfully and remaining steps re-sequenced.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete campaign step";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
