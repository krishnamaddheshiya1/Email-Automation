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
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

async function RepliesContent() {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  const { business } = session;

  const replyMetrics = [
    { title: "Inbound Replies", value: "0", detail: "Tenant Scoped", status: "neutral" as const },
    { title: "Active Threads", value: "0", detail: "Inbox Empty", status: "neutral" as const },
    { title: "Sequence Auto-Halted", value: "0", detail: "Guardrail Active", status: "success" as const },
    { title: "Avg. Detection Latency", value: "< 1s", detail: "Webhook Event Stream", status: "success" as const },
  ];

  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />

      <main className="flex-1 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Inbound Reply Handling
              </h1>
              <Badge variant="success">Tenant Scoped</Badge>
              <Badge variant="default" className="uppercase text-[10px]">
                {business.name}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Conversation threads and inbound message event processing for <span className="font-semibold text-blue-600 dark:text-blue-400">{business.name}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Mark All Read
            </Button>
            <LogoutButton variant="secondary" size="sm" />
          </div>
        </div>

        {/* Tab Navigation */}
        <DashboardTabs />

        {/* Notice Banner */}
        <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <div className="flex items-start gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
              i
            </span>
            <div>
              <p className="font-semibold">Conversation Scoping & RLS</p>
              <p className="text-xs text-blue-800/80 dark:text-blue-300/80 mt-0.5">
                Each reply event is linked to its matching lead and campaign sequence. Inbound responses are strictly isolated to {business.name}.
              </p>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {replyMetrics.map((metric) => (
            <Card key={metric.title}>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-medium">
                  {metric.title}
                </CardDescription>
                <CardTitle className="text-2xl font-bold">
                  {metric.value}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={metric.status} className="text-[10px]">
                  {metric.detail}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Conversations Inbox Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Inbound Threads</CardTitle>
                <CardDescription>
                  Replies detected from active lead campaigns.
                </CardDescription>
              </div>
              <Badge variant="neutral">Inbox Telemetry Ready</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                No replies received yet for {business.name}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                When prospects respond to automated campaigns, their messages will populate this conversation feed in real-time.
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <Link
                  href="/dashboard/campaigns"
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  &larr; View Campaigns
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  Main Overview &rarr;
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Fallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />
      <main className="flex-1 space-y-6 animate-pulse">
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      </main>
    </div>
  );
}

export default function RepliesPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <RepliesContent />
    </Suspense>
  );
}
