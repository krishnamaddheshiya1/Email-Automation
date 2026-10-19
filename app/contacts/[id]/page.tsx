import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import { ContactDetailClient } from "@/components/contacts/contact-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function ContactDetailContent({ params }: PageProps) {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const { business } = session;

  let contact;
  try {
    contact = await contactService.getContact(business.id, id);
  } catch {
    contact = null;
  }

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

        {contact ? (
          <ContactDetailClient initialContact={contact} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Contact Not Found
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              The requested contact does not exist or you do not have permission to view it.
            </p>
            <div className="mt-4">
              <Link href="/contacts">
                <Button size="sm">Back to Contacts</Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ContactDetailFallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <div className="w-full lg:w-64 h-96 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
      <div className="flex-1 space-y-4">
        <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded w-1/3 animate-pulse" />
        <div className="h-40 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}

export default function ContactDetailPage(props: PageProps) {
  return (
    <Suspense fallback={<ContactDetailFallback />}>
      <ContactDetailContent {...props} />
    </Suspense>
  );
}
