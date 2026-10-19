import { NextRequest, NextResponse } from "next/server";
import { campaignExecutionService } from "@/server/services";

export const maxDuration = 60; // Allow full 60 seconds on Vercel Pro/Hobby

async function handleCron(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && cronSecret.trim().length > 0) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
          { success: false, error: "Unauthorized cron invocation" },
          { status: 401 }
        );
      }
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const summary = await campaignExecutionService.processDueEnrollments({
      limit: isNaN(limit) ? 50 : limit,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processedCount: summary.processed,
      successful: summary.succeeded,
      failed: summary.failed,
      stopped: summary.stopped,
      completed: summary.completed,
      results: summary.results,
      diagnostic: summary.diagnostic || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Cron campaign execution failed";
    console.error("[CronCampaignsRoute] Execution failure:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
