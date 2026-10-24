import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, deliverySafetyService } from "@/server/services";

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

    const quota = await deliverySafetyService.getQuota(session.business.id);

    return NextResponse.json({
      success: true,
      quota,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch email quota";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
