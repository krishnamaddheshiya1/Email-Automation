import React, { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, templateService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { TemplateDetailClient } from "@/components/templates/template-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function TemplateDetailContent({ params }: PageProps) {
  await connection();
  const { id } = await params;
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  let template;
  try {
    template = await templateService.getTemplate(id, session.business.id);
  } catch {
    notFound();
  }

  if (!template) {
    notFound();
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />

      <main className="flex-1 space-y-6 min-w-0">
        <TemplateDetailClient initialTemplate={template} />
      </main>
    </div>
  );
}

function TemplateDetailFallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <div className="w-64 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      <div className="flex-1 h-96 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
    </div>
  );
}

export default function TemplateDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<TemplateDetailFallback />}>
      <TemplateDetailContent params={params} />
    </Suspense>
  );
}
