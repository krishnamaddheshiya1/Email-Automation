import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, emailService } from "@/server/services";
import { DashboardService } from "@/server/services/dashboard.service";

/**
 * GET /api/dashboard/overview
 * Returns real, tenant-isolated dashboard metrics, recent campaigns, recent activity, and system health.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Synchronize latest delivery, open, and bounce statuses from Resend
    try {
      await emailService.syncProviderStatuses(session.business.id);
    } catch (syncErr) {
      console.warn("[Dashboard Overview] Background provider sync warning:", syncErr);
    }

    const dashboardService = new DashboardService();
    const data = await dashboardService.getDashboardData(session.business.id);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard overview";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
