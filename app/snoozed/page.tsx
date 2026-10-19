import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import Link from "next/link";

async function SnoozedContent() {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  const { business } = session;

  return (
    <div className="flex-1 flex max-w-7xl w-full mx-auto px-2 sm:px-4 lg:px-6 py-4 gap-4 min-h-[calc(100vh-4rem)]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 space-y-4">
        <div className="flex items-center justify-between px-2 text-xs text-slate-500">
          <div>
            Workspace: <span className="font-semibold text-slate-800 dark:text-slate-200">{business.name}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold dark:bg-blue-950/60 dark:text-blue-300">
            Snoozed & Scheduled
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-800 shadow-sm p-12 text-center min-h-[500px]">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 dark:bg-blue-950/60">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            No Snoozed or Delayed Sequences
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Follow-ups with step delay intervals (e.g. 2 days, 4 days) waiting for dispatch will be monitored here.
          </p>
          <Link
            href="/campaigns"
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            Manage Campaign Sequences
          </Link>
        </div>
      </main>
    </div>
  );
}

function SnoozedFallback() {
  return (
    <div className="flex-1 flex max-w-7xl w-full mx-auto px-2 sm:px-4 lg:px-6 py-4 gap-4 min-h-[calc(100vh-4rem)]">
      <div className="w-60 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-800" />
      <div className="flex-1 rounded-2xl bg-slate-100 animate-pulse dark:bg-slate-800" />
    </div>
  );
}

export default function SnoozedPage() {
  return (
    <Suspense fallback={<SnoozedFallback />}>
      <SnoozedContent />
    </Suspense>
  );
}
