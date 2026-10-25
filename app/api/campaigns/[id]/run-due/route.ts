import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignExecutionService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/campaigns/[id]/run-due
 * Manual trigger for executing due campaign steps for this campaign.
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

    const summary = await campaignExecutionService.processDueEnrollments({
      campaignId: id,
      businessId: session.business.id,
      retryFailed: true,
    });

    let message: string;
    if (summary.processed > 0) {
      if (summary.failed > 0 && summary.succeeded === 0) {
        const firstError = summary.results.find((r) => !r.success)?.error || "Delivery failed";
        message = `Processed ${summary.processed} due enrollment(s) (0 sent, ${summary.failed} failed: ${firstError}).`;
      } else {
        message = `Processed ${summary.processed} due enrollment(s) (${summary.succeeded} sent, ${summary.failed} failed).`;
      }
    } else {
      message = summary.diagnostic || "0 due enrollments processed.";
    }

    return NextResponse.json({
      success: true,
      processedCount: summary.processed,
      successful: summary.succeeded,
      failed: summary.failed,
      stopped: summary.stopped,
      completed: summary.completed,
      results: summary.results,
      diagnostic: summary.diagnostic || null,
      message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run due campaign jobs";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
