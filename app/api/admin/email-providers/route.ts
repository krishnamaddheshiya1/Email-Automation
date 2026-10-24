import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminService } from "@/server/services";
import { createSafeErrorResponse } from "@/lib/security/error-handler";

export async function GET() {
  try {
    const supabase = await createClient();
    const authCheck = await adminService.requireAdmin(supabase);

    if (!authCheck.authorized) {
      return NextResponse.json(
        { success: false, error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const providers = await adminService.listEmailProviders();

    return NextResponse.json({
      success: true,
      providers,
    });
  } catch (err: unknown) {
    return createSafeErrorResponse(err, 500, "Failed to fetch email providers");
  }
}
