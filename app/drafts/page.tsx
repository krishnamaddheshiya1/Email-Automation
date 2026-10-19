import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { DraftsView } from "@/components/mail/drafts-view";

async function DraftsContent() {
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
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold dark:bg-amber-950/60 dark:text-amber-300">
            Draft Items
          </span>
        </div>

        <DraftsView />
      </main>
    </div>
  );
}

function DraftsFallback() {
  return (
    <div className="flex-1 flex max-w-7xl w-full mx-auto px-2 sm:px-4 lg:px-6 py-4 gap-4 min-h-[calc(100vh-4rem)]">
      <div className="w-60 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-800" />
      <div className="flex-1 rounded-2xl bg-slate-100 animate-pulse dark:bg-slate-800" />
    </div>
  );
}

export default function DraftsPage() {
  return (
    <Suspense fallback={<DraftsFallback />}>
      <DraftsContent />
    </Suspense>
  );
}
