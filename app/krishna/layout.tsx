import React from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, isDeveloperUser } from "@/server/services";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
export const instant = false;
export const metadata = {
  title: "Developer Console - Email Automation Platform",
  description: "Platform-level developer administration, audit logs, and system operations",
};

async function KrishnaLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  let session = null;
  try {
    const supabase = await createClient();
    session = await AuthService.getCurrentSession(supabase);
  } catch (err) {
    console.error("[KrishnaLayout] Session resolution failed:", err);
    session = null;
  }

  // Server-side authentication guard
  if (!session) {
    redirect("/login?redirect=/krishna");
  }

  // Server-side developer authorization guard: ONLY developer allowed!
  if (!isDeveloperUser(session.user)) {
    // Normal users must NOT be able to access /krishna
    redirect("/dashboard?error=unauthorized_developer");
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col md:flex-row antialiased">
      {/* Dedicated Developer / Admin Sidebar */}
      <AdminSidebar
        adminEmail={session.user.email}
        adminRole={session.user.role || "developer"}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto min-h-screen">
        {children}
      </div>
    </div>
  );
}

function KrishnaLayoutFallback() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function KrishnaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <React.Suspense fallback={<KrishnaLayoutFallback />}>
      <KrishnaLayoutContent>{children}</KrishnaLayoutContent>
    </React.Suspense>
  );
}
