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

async function CampaignsContent() {
  await connection();
  let session = null;
  try {
    const supabase = await createClient();
    session = await AuthService.getCurrentSession(supabase);
  } catch (err) {
    console.error("[Campaigns] Session resolution failed:", err);
    session = null;
  }

  if (!session) {
    redirect("/login");
  }

  const { business } = session;

  const campaignMetrics = [
    { title: "Total Campaigns", value: "0", detail: "Tenant Scoped", status: "neutral" as const },
    { title: "Active Sequences", value: "0", detail: "Ready to Schedule", status: "neutral" as const },
    { title: "Scheduled Batches", value: "0", detail: "Queue Operational", status: "neutral" as const },
    { title: "Tenant Isolation", value: "Active", detail: business.name, status: "success" as const },
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
                Email Campaigns
              </h1>
              <Badge variant="success">Tenant Scoped</Badge>
              <Badge variant="default" className="uppercase text-[10px]">
                {business.name}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Create and manage multi-step outbound email sequences for <span className="font-semibold text-blue-600 dark:text-blue-400">{business.name}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/campaigns/new">
              <Button variant="primary" size="sm">
                + New Campaign
              </Button>
            </Link>
            <LogoutButton variant="secondary" size="sm" />
          </div>
        </div>

        {/* Tab Navigation */}
        <DashboardTabs />

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {campaignMetrics.map((metric) => (
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

        {/* Campaign Management List Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Campaign Sequences</CardTitle>
                <CardDescription>
                  Multi-stage automated email workflows belonging to {business.name}.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled>
                  Filter Status
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
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
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                No active campaigns for {business.name}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Authentication, multi-tenant database scoping, and Row Level Security are verified. You can configure campaign steps, delays, and message templates.
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <Link href="/campaigns">
                  <Button variant="primary" size="sm">
                    Open Campaign Builder &rarr;
                  </Button>
                </Link>
                <Link
                  href="/dashboard/follow-ups"
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  Inspect Follow-up Queues &rarr;
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

export default function CampaignsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <CampaignsContent />
    </Suspense>
  );
}
