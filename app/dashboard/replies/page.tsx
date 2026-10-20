import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
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
  let session = null;
  try {
    const supabase = await createClient();
    session = await AuthService.getCurrentSession(supabase);
  } catch (err) {
    console.error("[Replies] Session resolution failed:", err);
    session = null;
  }

  if (!session) {
    redirect("/login");
  }

  const { business } = session;

  let metrics = {
    inboundReplies: 0,
    activeThreads: 0,
    sequencesHalted: 0,
    unreadCount: 0,
  };

  let conversationData = {
    conversations: [] as Array<{
      id: string;
      contact_name: string;
      contact_email: string;
      campaign_name: string | null;
      subject: string;
      is_unread: boolean;
      has_attachments: boolean;
      snippet: string;
      last_message_at: string | null;
      unread_count: number;
    }>,
    total: 0,
  };

  try {
    const [fetchedMetrics, fetchedConversations] = await Promise.all([
      replyService.getReplyMetrics(business.id),
      replyService.listConversations({ businessId: business.id, limit: 25 }),
    ]);
    metrics = fetchedMetrics;
    conversationData = {
      conversations: fetchedConversations.conversations,
      total: fetchedConversations.total,
    };
  } catch (err) {
    console.warn("[Replies] Failed to fetch reply activity:", err);
  }

  const replyMetrics = [
    {
      title: "Inbound Replies",
      value: String(metrics.inboundReplies),
      detail: "Tenant Scoped",
      status: metrics.inboundReplies > 0 ? ("success" as const) : ("neutral" as const),
    },
    {
      title: "Active Threads",
      value: String(metrics.activeThreads),
      detail:
        metrics.unreadCount > 0
          ? `${metrics.unreadCount} unread`
          : metrics.activeThreads > 0
          ? "All caught up"
          : "Inbox Empty",
      status:
        metrics.unreadCount > 0
          ? ("warning" as const)
          : metrics.activeThreads > 0
          ? ("success" as const)
          : ("neutral" as const),
    },
    {
      title: "Sequence Auto-Halted",
      value: String(metrics.sequencesHalted),
      detail: "Guardrail Active",
      status: "success" as const,
    },
    {
      title: "Avg. Detection Latency",
      value: "< 1s",
      detail: "Webhook Event Stream",
      status: "success" as const,
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
                Inbound Reply Handling
              </h1>
              <Badge variant="success">Tenant Scoped</Badge>
              <Badge variant="default" className="uppercase text-[10px]">
                {business.name}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Conversation threads and inbound message event processing for{" "}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {business.name}
              </span>
              .
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/inbox">
              <Button variant="outline" size="sm">
                Open Full Inbox &rarr;
              </Button>
            </Link>
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
              <div className="flex items-center gap-2">
                <Badge
                  variant={conversationData.conversations.length > 0 ? "success" : "neutral"}
                >
                  {conversationData.conversations.length > 0
                    ? `${conversationData.total} ${conversationData.total === 1 ? "Thread" : "Threads"}`
                    : "Inbox Telemetry Ready"}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {conversationData.conversations.length === 0 ? (
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
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {conversationData.conversations.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/inbox?id=${thread.id}`}
                    className="block p-4 -mx-2 hover:bg-slate-50 dark:hover:bg-slate-850/50 rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm ${
                              thread.is_unread
                                ? "font-bold text-slate-900 dark:text-white"
                                : "font-medium text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {thread.contact_name || thread.contact_email}
                          </span>
                          {thread.contact_email && (
                            <span className="text-xs text-slate-500">
                              &lt;{thread.contact_email}&gt;
                            </span>
                          )}
                          {thread.is_unread && (
                            <Badge
                              variant="default"
                              className="text-[10px] bg-blue-600 text-white hover:bg-blue-600"
                            >
                              New Reply
                            </Badge>
                          )}
                          {thread.campaign_name && (
                            <Badge variant="outline" className="text-[10px]">
                              {thread.campaign_name}
                            </Badge>
                          )}
                          {thread.has_attachments && (
                            <span
                              className="text-xs text-slate-400"
                              title="Has attachments"
                            >
                              📎
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-sm mt-0.5 truncate ${
                            thread.is_unread
                              ? "font-semibold text-slate-800 dark:text-slate-100"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {thread.subject || "No Subject"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                          {thread.snippet || "No message preview available"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-slate-400">
                          {thread.last_message_at
                            ? new Date(thread.last_message_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                month: "short",
                                day: "numeric",
                              })
                            : ""}
                        </span>
                        <div className="mt-1">
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline">
                            View &amp; Reply &rarr;
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
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
