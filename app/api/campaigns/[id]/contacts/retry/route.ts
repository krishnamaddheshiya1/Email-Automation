import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignExecutionService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/[id]/contacts/retry
 * Resets and immediately re-executes one or all failed contacts in a campaign.
 */
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

    let enrollmentId: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.enrollmentId === "string") {
        enrollmentId = body.enrollmentId.trim();
      }
    } catch {
      // Empty body is acceptable (means retry all failed)
    }

    if (enrollmentId) {
      const validEnrollId = validateUuid(enrollmentId, "Enrollment ID");
      if (!validEnrollId.valid) {
        return NextResponse.json({ success: false, error: validEnrollId.error }, { status: 400 });
      }

      await campaignExecutionService.retryFailedEnrollment(enrollmentId, session.business.id);
      const execResult = await campaignExecutionService.executeCampaignEnrollment(
        enrollmentId,
        session.business.id
      );

      return NextResponse.json({
        success: true,
        message: execResult.success
          ? "Contact sequence step executed successfully."
          : `Retry attempted: ${execResult.error || "Failed to dispatch"}`,
        result: execResult,
      });
    }

    // Bulk retry all failed contacts in this campaign
    const resetCount = await campaignExecutionService.retryFailedEnrollments(id, session.business.id);
    const summary = await campaignExecutionService.processDueEnrollments({
      campaignId: id,
      businessId: session.business.id,
      retryFailed: true,
    });

    return NextResponse.json({
      success: true,
      message: `Reset ${resetCount} failed contact(s). Dispatched ${summary.succeeded} email(s) (${summary.failed} failed).`,
      resetCount,
      summary,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retry campaign contacts";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
