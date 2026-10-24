import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { rateLimiter, RATE_LIMIT_PROFILES, extractClientIp, createRateLimitResponse } from "@/server/security/rate-limiter";

export async function POST(request: Request) {
  try {
    const ip = extractClientIp(request.headers);
    const rl = rateLimiter.consumeProfile(`auth:login:${ip}`, RATE_LIMIT_PROFILES.AUTH);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const body = await request.json();
    const supabase = await createClient();

    const result = await AuthService.login(body, supabase);

    return NextResponse.json({
      success: true,
      user: result.user,
      business: result.business,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Invalid email or password";
    const isForbidden =
      message.includes("awaiting administrator approval") ||
      message.includes("disabled") ||
      message.includes("rejected") ||
      message.includes("not active");
    return NextResponse.json(
      { success: false, error: message },
      { status: isForbidden ? 403 : 401 }
    );
  }
}
