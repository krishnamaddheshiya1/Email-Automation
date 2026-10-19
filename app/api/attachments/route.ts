import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, attachmentService } from "@/server/services";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";
import { validateUuid } from "@/lib/security/input-validation";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaign_id") || undefined;
    const templateId = searchParams.get("template_id") || undefined;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    if (campaignId) {
      const campValidation = validateUuid(campaignId, "Campaign ID");
      if (!campValidation.valid) {
        return NextResponse.json({ success: false, error: campValidation.error }, { status: 400 });
      }
    }

    if (templateId) {
      const templValidation = validateUuid(templateId, "Template ID");
      if (!templValidation.valid) {
        return NextResponse.json({ success: false, error: templValidation.error }, { status: 400 });
      }
    }

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

    const attachments = await attachmentService.listAttachments(session.business.id, {
      campaignId,
      templateId,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      attachments,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch attachments";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Rate limiting for attachment upload
    const rl = rateLimiter.consumeProfile(
      `attachment_upload:${session.business.id}`,
      RATE_LIMIT_PROFILES.ATTACHMENT_UPLOAD
    );
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, error: "A valid file is required in 'file' form-data field." },
        { status: 400 }
      );
    }

    const campaignId = (formData.get("campaign_id") as string) || undefined;
    const templateId = (formData.get("template_id") as string) || undefined;
    const stepId = (formData.get("step_id") as string) || undefined;

    if (campaignId) {
      const campValidation = validateUuid(campaignId, "Campaign ID");
      if (!campValidation.valid) {
        return NextResponse.json({ success: false, error: campValidation.error }, { status: 400 });
      }
    }

    if (templateId) {
      const templValidation = validateUuid(templateId, "Template ID");
      if (!templValidation.valid) {
        return NextResponse.json({ success: false, error: templValidation.error }, { status: 400 });
      }
    }

    if (stepId) {
      const stepValidation = validateUuid(stepId, "Step ID");
      if (!stepValidation.valid) {
        return NextResponse.json({ success: false, error: stepValidation.error }, { status: 400 });
      }
    }

    const filename = (file as File).name || "unnamed_attachment";
    const mimeType = file.type || "application/octet-stream";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const attachment = await attachmentService.uploadAttachment(
      session.business.id,
      session.user.id,
      {
        filename,
        mimeType,
        buffer,
        campaignId,
        templateId,
        campaignStepId: stepId,
      }
    );

    return NextResponse.json(
      {
        success: true,
        attachment,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to upload attachment";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
