import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { handleCors, applySecurityHeaders } from "@/lib/security/cors";

export async function middleware(request: NextRequest) {
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  const response = await updateSession(request);
  const origin = request.headers.get("origin");
  return applySecurityHeaders(response, origin);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
