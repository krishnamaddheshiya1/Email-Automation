import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import { TemplateListClient } from "@/components/templates/template-list-client";

async function TemplatesContent() {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  const { user, business } = session;

  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />

      <main className="flex-1 space-y-6 min-w-0">
        {/* Top User/Tenant Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Tenant:</span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {business.name}
            </span>
            <span className="text-xs text-slate-400">({user.full_name})</span>
            <Badge variant="success" className="text-[10px]">
              Active Scope
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/settings">
              <Button variant="outline" size="sm">
                Settings
              </Button>
            </Link>
            <LogoutButton variant="secondary" size="sm" />
          </div>
        </div>

        {/* Template List Interactive Client */}
        <TemplateListClient />
      </main>
    </div>
  );
}

function TemplatesFallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <div className="w-64 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      <div className="flex-1 space-y-4">
        <div className="h-10 w-48 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-850" />
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<TemplatesFallback />}>
      <TemplatesContent />
    </Suspense>
  );
}
