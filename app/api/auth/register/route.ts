import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = await createClient();

    const result = await AuthService.register(body, supabase);

    return NextResponse.json({
      success: true,
      user: result.user,
      business: result.business,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to complete registration";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
