import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, attachmentService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string; stepId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const attachments = await attachmentService.getStepAttachments(stepId, session.business.id);

    return NextResponse.json({
      success: true,
      attachments,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch step attachments";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const attachmentId = body?.attachment_id;
    if (!attachmentId) {
      return NextResponse.json(
        { success: false, error: "attachment_id is required." },
        { status: 400 }
      );
    }

    const attValidation = validateUuid(attachmentId, "Attachment ID");
    if (!attValidation.valid) {
      return NextResponse.json({ success: false, error: attValidation.error }, { status: 400 });
    }

    const association = await attachmentService.attachToStep(
      stepId,
      attachmentId,
      id,
      session.business.id
    );

    return NextResponse.json({
      success: true,
      association,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to attach file to step";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
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

    const { searchParams } = new URL(request.url);
    let attachmentId = searchParams.get("attachment_id");
    if (!attachmentId) {
      try {
        const body = await request.json();
        attachmentId = body?.attachment_id;
      } catch {
        // body might be empty in DELETE
      }
    }

    if (!attachmentId) {
      return NextResponse.json(
        { success: false, error: "attachment_id query param or body is required." },
        { status: 400 }
      );
    }

    const attValidation = validateUuid(attachmentId, "Attachment ID");
    if (!attValidation.valid) {
      return NextResponse.json({ success: false, error: attValidation.error }, { status: 400 });
    }

    const success = await attachmentService.detachFromStep(
      stepId,
      attachmentId,
      session.business.id
    );

    return NextResponse.json({
      success,
      message: "Attachment detached from step",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to detach file from step";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
