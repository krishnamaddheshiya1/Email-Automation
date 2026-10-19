import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";

export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: session.user,
      business: session.business,
      authUser: session.authUser,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to retrieve session";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
