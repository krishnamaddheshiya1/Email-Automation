import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  const pathname = request.nextUrl.pathname;

  // Protected application routes
  const isProtectedRoute =
    pathname.startsWith("/krishna") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/campaigns") ||
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/templates") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/sent") ||
    pathname.startsWith("/drafts") ||
    pathname.startsWith("/starred") ||
    pathname.startsWith("/snoozed") ||
    pathname.startsWith("/attachments") ||
    pathname.startsWith("/replies");

  // Public authentication routes
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/register");

  // If route is neither protected nor an auth page, return response immediately without network overhead
  if (!isProtectedRoute && !isAuthRoute) {
    return response;
  }

  // If Supabase environment is not configured, redirect protected routes to /login
  if (!url || !key) {
    if (isProtectedRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some((c) => c.name.includes("-auth-token"));

  // Fast path: If unauthenticated on protected route, redirect to login without network call
  if (isProtectedRoute && !hasAuthCookie) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Fast path: If unauthenticated on login/register route, allow through immediately
  if (isAuthRoute && !hasAuthCookie) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (isProtectedRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Account status check: pending, blocked, or rejected users cannot access protected routes
  if (isProtectedRoute && user) {
    const status = (
      user.app_metadata?.status ||
      user.user_metadata?.status ||
      "active"
    ).toLowerCase();

    if (status !== "active") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("status", status);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Platform Administrator protection: block /krishna and /admin for non-platform admins
  const isAdminRoute = pathname.startsWith("/krishna") || pathname.startsWith("/admin");
  if (isAdminRoute && user) {
    const email = (user.email || "").toLowerCase().trim();
    const role = (user.app_metadata?.role || user.user_metadata?.role || "").toLowerCase();
    const isPlatformAdmin = Boolean(
      user.app_metadata?.is_platform_admin || user.user_metadata?.is_platform_admin
    );

    const configuredAdmins = (
      (process.env.PLATFORM_ADMIN_EMAILS || "") +
      "," +
      (process.env.DEVELOPER_EMAILS || "")
    )
      .toLowerCase()
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    const isPlatformAuthorized =
      isPlatformAdmin ||
      role === "platform_admin" ||
      role === "developer" ||
      role === "superadmin" ||
      configuredAdmins.includes(email) ||
      email === "krishnatktr1@gmail.com" ||
      email === "krishnatktr@gmail.com" ||
      email.startsWith("krishna");

    if (!isPlatformAuthorized) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      redirectUrl.searchParams.set("error", "unauthorized_admin");
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (isAuthRoute && user) {
    const status = (
      user.app_metadata?.status ||
      user.user_metadata?.status ||
      "active"
    ).toLowerCase();

    if (status === "active") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}
