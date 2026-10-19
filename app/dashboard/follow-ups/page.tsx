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

async function FollowUpsContent() {
  await connection();
  let session = null;
  try {
    const supabase = await createClient();
    session = await AuthService.getCurrentSession(supabase);
  } catch (err) {
    console.error("[FollowUps] Session resolution failed:", err);
    session = null;
  }

  if (!session) {
    redirect("/login");
  }

  const { business } = session;

  const followUpMetrics = [
    { title: "Queued Follow-Ups", value: "0", detail: "Tenant Scoped", status: "neutral" as const },
    { title: "Active Sequences", value: "0", detail: "Awaiting Campaigns", status: "neutral" as const },
    { title: "Auto-Stopped on Reply", value: "0", detail: "Guardrail Active", status: "success" as const },
    { title: "Queue Engine Health", value: "Ready", detail: "Phase 2/3 Ready", status: "success" as const },
  ];

  const defaultSequenceRules = [
    {
      step: "Step 1",
      name: "Initial Outreach",
      timing: "Immediate on trigger",
      condition: "Recipient not suppressed",
    },
    {
      step: "Step 2",
      name: "Value Hook Follow-Up",
      timing: "3 days after Step 1",
      condition: "No reply from recipient",
    },
    {
      step: "Step 3",
      name: "Final Check-In / Breakup",
      timing: "4 days after Step 2",
      condition: "No reply from recipient",
    },
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
                Follow-Up Queues
              </h1>
              <Badge variant="success">Tenant Scoped</Badge>
              <Badge variant="default" className="uppercase text-[10px]">
                {business.name}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Automated multi-step sequencing and delivery delay orchestration for <span className="font-semibold text-blue-600 dark:text-blue-400">{business.name}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Pause All Queues
            </Button>
            <LogoutButton variant="secondary" size="sm" />
          </div>
        </div>

        {/* Tab Navigation */}
        <DashboardTabs />

        {/* Notice Banner */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-start gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">
              ✓
            </span>
            <div>
              <p className="font-semibold">Automated Stop-on-Reply Protection</p>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                The platform monitors inbound reply telemetry in real-time. The instant a prospect replies, all queued follow-up steps for that lead are automatically halted.
              </p>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {followUpMetrics.map((metric) => (
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

        {/* Follow-up Sequence Rules & Queue */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Sequence Delay Pipeline</CardTitle>
                <CardDescription>
                  Timing intervals and conditional guardrails applied across scheduled follow-up steps.
                </CardDescription>
              </div>
              <Badge variant="neutral">Multi-Stage Ready</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {defaultSequenceRules.map((rule) => (
                <div
                  key={rule.step}
                  className="rounded-lg border border-slate-200 p-4 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                      {rule.step}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {rule.timing}
                    </Badge>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {rule.name}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Condition: <span className="text-slate-700 dark:text-slate-300 font-medium">{rule.condition}</span>
                  </p>
                </div>
              ))}
            </div>

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
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                Queue is currently empty for {business.name}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                No automated follow-ups are queued right now. Sequence triggers will register tasks here once campaigns are deployed.
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <Link
                  href="/dashboard/campaigns"
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  &larr; Return to Campaigns
                </Link>
                <Link
                  href="/dashboard/replies"
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  Check Inbound Replies &rarr;
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

export default function FollowUpsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <FollowUpsContent />
    </Suspense>
  );
}
