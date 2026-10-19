import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";

export async function POST() {
  try {
    const supabase = await createClient();
    await AuthService.logout(supabase);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to log out";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
