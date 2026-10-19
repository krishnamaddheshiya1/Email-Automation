import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { TemplateEditor } from "@/components/templates/template-editor";

async function NewTemplateContent() {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />

      <main className="flex-1 space-y-6 min-w-0">
        <TemplateEditor />
      </main>
    </div>
  );
}

function NewTemplateFallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <div className="w-64 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      <div className="flex-1 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
    </div>
  );
}

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<NewTemplateFallback />}>
      <NewTemplateContent />
    </Suspense>
  );
}
