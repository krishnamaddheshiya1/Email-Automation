import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { createCampaignStepSchema } from "@/lib/validations/campaign";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const steps = await campaignService.getSteps(id, session.business.id);

    return NextResponse.json({
      success: true,
      steps,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch campaign steps";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
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

    const body = await request.json();

    // Check if this is a step reordering request
    if (Array.isArray(body.step_ids)) {
      const reordered = await campaignService.reorderSteps(
        id,
        session.business.id,
        body.step_ids
      );
      return NextResponse.json({
        success: true,
        steps: reordered,
        message: "Steps reordered successfully.",
      });
    }

    const validation = createCampaignStepSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const step = await campaignService.addStep(
      id,
      session.business.id,
      validation.data
    );

    return NextResponse.json(
      { success: true, step },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create campaign step";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    const body = await request.json();
    if (!Array.isArray(body.step_ids)) {
      return NextResponse.json(
        { success: false, error: "step_ids array is required for reordering" },
        { status: 400 }
      );
    }

    const reordered = await campaignService.reorderSteps(
      id,
      session.business.id,
      body.step_ids
    );

    return NextResponse.json({
      success: true,
      steps: reordered,
      message: "Steps reordered successfully.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reorder steps";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
