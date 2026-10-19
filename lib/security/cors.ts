// Universal Web API CORS & Security Headers compatible with Node.js and Next.js

export function getAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim().toLowerCase())
    : [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ? process.env.NEXT_PUBLIC_APP_URL.trim().toLowerCase() : null;

  const defaults = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  const allowed = new Set<string>();
  defaults.forEach((o) => allowed.add(o));
  if (appUrl) allowed.add(appUrl.replace(/\/+$/, ""));
  configured.forEach((o) => allowed.add(o.replace(/\/+$/, "")));

  return Array.from(allowed);
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return true; // Same-origin or non-browser client
  const normalized = origin.trim().toLowerCase().replace(/\/+$/, "");

  // In non-production environments, allow local development ports
  if (process.env.NODE_ENV !== "production") {
    if (
      normalized.startsWith("http://localhost:") ||
      normalized.startsWith("http://127.0.0.1:")
    ) {
      return true;
    }
  }

  const allowedOrigins = getAllowedOrigins();
  return allowedOrigins.includes(normalized);
}

export function handleCors(request: Request | { method?: string; headers: Headers }): Response | null {
  const origin = request.headers.get("origin");

  // Handle preflight OPTIONS request
  if (request.method === "OPTIONS") {
    if (origin && !isOriginAllowed(origin)) {
      return Response.json(
        { success: false, error: "CORS unauthorized: Origin not permitted" },
        { status: 403 }
      );
    }

    const preflight = new Response(null, { status: 204 });
    if (origin && isOriginAllowed(origin)) {
      preflight.headers.set("Access-Control-Allow-Origin", origin);
      preflight.headers.set("Access-Control-Allow-Credentials", "true");
      preflight.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      preflight.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, Accept, Origin"
      );
      preflight.headers.set("Access-Control-Max-Age", "86400");
    }
    return applySecurityHeaders(preflight);
  }

  return null;
}

export function applySecurityHeaders<T extends Response>(response: T, origin?: string | null): T {
  // Standard HTTP Security Headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // CORS response headers for allowed origins
  if (origin && isOriginAllowed(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}
