"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import dynamic from "next/dynamic";
import { AddContactModal } from "@/components/contacts/add-contact-modal";
import type { DashboardOverviewResponse } from "@/server/services/dashboard.service";

const CsvImportModal = dynamic(
  () => import("@/components/contacts/csv-import-modal").then((m) => m.CsvImportModal),
  { ssr: false }
);

export function DashboardClient() {
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick Action Modal states
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load(isSilent = false) {
      if (!isSilent) setLoading(true);
      try {
        const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const json = await res.json();
        if (!ignore) {
          if (res.ok && json.success) {
            setData(json.data);
            setError(null);
          } else if (!isSilent) {
            setError(json.error || "Failed to load dashboard metrics.");
          }
        }
      } catch {
        if (!ignore && !isSilent) {
          setError("Network error fetching dashboard data. Please check your connection and retry.");
        }
      } finally {
        if (!ignore && !isSilent) {
          setLoading(false);
        }
      }
    }
    load(false);

    // Live auto-refresh metrics every 30 seconds when visible
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load(true);
    }, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      // Trigger live provider status synchronization from Resend first
      await fetch("/api/email/sync", { method: "POST" });
      const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Failed to load dashboard metrics.");
      }
    } catch {
      setError("Network error fetching dashboard data. Please check your connection and retry.");
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    switch (s) {
      case "ACTIVE":
        return <Badge variant="success">✓ Active</Badge>;
      case "PAUSED":
        return <Badge variant="warning">⏸ Paused</Badge>;
      case "COMPLETED":
        return <Badge variant="default">✓ Completed</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline">Archived</Badge>;
      case "DRAFT":
      default:
        return <Badge variant="neutral">Draft</Badge>;
    }
  };

  const getEventBadge = (eventType: string) => {
    const e = (eventType || "").toUpperCase();
    switch (e) {
      case "DELIVERED":
        return <Badge variant="success">✓ Delivered</Badge>;
      case "OPENED":
        return <Badge variant="default" className="border-indigo-300 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300">👁 Opened</Badge>;
      case "SENT":
        return <Badge variant="default">Sent</Badge>;
      case "BOUNCED":
        return <Badge variant="warning">⤬ Bounced</Badge>;
      case "COMPLAINT":
      case "COMPLAINED":
        return <Badge variant="warning">⚠ Complaint</Badge>;
      case "UNSUBSCRIBED":
        return <Badge variant="outline">Unsubscribed</Badge>;
      case "FAILED":
      default:
        return <Badge variant="warning">✕ Failed</Badge>;
    }
  };

  const getHealthBadge = (status: "Healthy" | "Warning" | "Error") => {
    switch (status) {
      case "Healthy":
        return <Badge variant="success">✓ Healthy</Badge>;
      case "Warning":
        return <Badge variant="warning">⚠ Warning</Badge>;
      case "Error":
      default:
        return <Badge variant="warning" className="border-red-300 text-red-700 bg-red-50">✕ Error</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-64 rounded-lg bg-slate-200 animate-pulse dark:bg-slate-800" />
          <div className="h-4 w-96 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-850" />
        </div>

        {/* Metric Cards Skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
          ))}
        </div>

        {/* Quick Actions Skeleton */}
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />

        {/* Table Skeleton */}
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/30">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="mt-3 text-base font-semibold text-rose-900 dark:text-rose-200">
          Something went wrong while loading the dashboard
        </h3>
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-300 max-w-md mx-auto">
          {error || "An unexpected error occurred. Please try again."}
        </p>
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            Retry Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. TOP SECTION: Welcome & Business Name */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {data.greeting}, {data.businessName}
            </h1>
            <Badge variant="success" className="text-xs">
              ✓ Active Workspace
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time deliverability metrics, active campaign progression, and recipient activity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Auto-Update</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isSyncing}
            className="text-xs gap-1.5"
            title="Synchronize live Resend statuses and refresh metrics"
          >
            <span className={isSyncing ? "animate-spin inline-block" : ""}>↻</span>
            <span>{isSyncing ? "Syncing..." : "Sync & Refresh"}</span>
          </Button>
          <Link href="/campaigns/new">
            <Button variant="primary" size="sm" className="text-xs">
              + Create Campaign
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. METRIC CARDS (Contacts, Active Campaigns, Emails Sent, Delivered, Opened, Replies, Bounce Rate) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {/* Contacts */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Contacts
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {data.metrics.totalContacts.toLocaleString()}
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1">
            Verified audience
          </span>
        </Card>

        {/* Active Campaigns */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Campaigns
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {data.metrics.activeCampaigns.toLocaleString()}
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1">
            Automated sequences
          </span>
        </Card>

        {/* Emails Sent */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Emails Sent
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {data.metrics.emailsSent.toLocaleString()}
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1">
            Total dispatches
          </span>
        </Card>

        {/* Delivered */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Delivered
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {data.metrics.emailsDelivered.toLocaleString()}
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1">
            {data.metrics.deliveryRate !== undefined ? `${data.metrics.deliveryRate}% rate` : "Confirmed inboxes"}
          </span>
        </Card>

        {/* Opened */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Opened
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
            {(data.metrics.emailsOpened ?? 0).toLocaleString()}
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1" title={`${data.metrics.totalOpens ?? 0} total opens, ${data.metrics.uniqueOpens ?? 0} unique`}>
            {data.metrics.openRate ?? 0}% rate • {data.metrics.totalOpens ?? 0} total
          </span>
        </Card>

        {/* Replies */}
        <Link
          href={Boolean(data.metrics.unreadReplies && data.metrics.unreadReplies > 0) ? "/inbox?filter=unread" : "/inbox"}
          className="block"
        >
          <Card className="p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Replies
              </CardDescription>
              {Boolean(data.metrics.unreadReplies && data.metrics.unreadReplies > 0) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-blue-600 text-white">
                  {data.metrics.unreadReplies} NEW
                </span>
              )}
            </div>
            <CardTitle className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {(data.metrics.totalReplies ?? 0).toLocaleString()}
            </CardTitle>
            <span className="text-[11px] text-slate-400 block mt-1">
              Inbox threads
            </span>
          </Card>
        </Link>

        {/* Bounce Rate */}
        <Card className="p-4 shadow-sm">
          <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Bounce Rate
          </CardDescription>
          <CardTitle className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {data.metrics.bounceRate}%
          </CardTitle>
          <span className="text-[11px] text-slate-400 block mt-1">
            {data.metrics.emailsBounced ?? 0} bounced • Suppressed
          </span>
        </Card>
      </div>

      {/* EMAIL SENDING QUOTA SECTION */}
      {data.quota && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base">⚡</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                  Email Sending Quota
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Authoritative dispatch limits enforced strictly across all active sequences and background triggers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Hard system limit: 1,500/day, 50,000/month
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {/* Daily Card */}
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-850/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Today
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {data.quota.dailySent.toLocaleString()} / {data.quota.dailyLimit.toLocaleString()} sent
                </span>
              </div>

              {/* Visual Progress Bar */}
              <div className="mt-2.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.quota.dailyRemaining === 0
                      ? "bg-rose-500"
                      : data.quota.dailyRemaining < 300
                      ? "bg-amber-500"
                      : "bg-blue-600 dark:bg-blue-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, (data.quota.dailySent / data.quota.dailyLimit) * 100))}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {data.quota.dailyRemaining.toLocaleString()} remaining
                </span>
                <span className="text-[11px] text-slate-400">
                  Resets at 00:00 UTC
                </span>
              </div>
            </div>

            {/* Monthly Card */}
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-850/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  This month
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {data.quota.monthlySent.toLocaleString()} / {data.quota.monthlyLimit.toLocaleString()} sent
                </span>
              </div>

              {/* Visual Progress Bar */}
              <div className="mt-2.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.quota.monthlyRemaining === 0
                      ? "bg-rose-500"
                      : data.quota.monthlyRemaining < 5000
                      ? "bg-amber-500"
                      : "bg-indigo-600 dark:bg-indigo-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, (data.quota.monthlySent / data.quota.monthlyLimit) * 100))}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {data.quota.monthlyRemaining.toLocaleString()} remaining
                </span>
                <span className="text-[11px] text-slate-400">
                  Calendar month reset
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. QUICK ACTIONS ROW */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-3">
          Quick Actions
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={Boolean(data.metrics.unreadReplies && data.metrics.unreadReplies > 0) ? "/inbox?filter=unread" : "/inbox"}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100 dark:border-blue-900 dark:text-blue-300 dark:bg-blue-950/40">
              <span>📬</span>
              <span>Reply Inbox</span>
              {Boolean(data.metrics.unreadReplies && data.metrics.unreadReplies > 0) && (
                <Badge variant="default" className="text-[10px] py-0 px-1 bg-blue-600 text-white">
                  {data.metrics.unreadReplies}
                </Badge>
              )}
            </Button>
          </Link>
          <Link href="/campaigns/new">
            <Button variant="primary" size="sm" className="text-xs">
              + Create Campaign
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setIsAddContactOpen(true)}
          >
            + Add Contact
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setIsImportModalOpen(true)}
          >
            ⬆ Import Contacts (CSV)
          </Button>
          <Link href="/templates/new">
            <Button variant="outline" size="sm" className="text-xs">
              + Create Template
            </Button>
          </Link>
          <Link href="/analytics">
            <Button variant="secondary" size="sm" className="text-xs ml-auto">
              View All Analytics →
            </Button>
          </Link>
        </div>
      </div>

      {/* 4. MAIN CONTENT SPLIT: Recent Campaigns & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Campaigns (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Recent Campaigns
            </h2>
            <Link
              href="/campaigns"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              View all campaigns →
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            {data.recentCampaigns.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto h-10 w-10 rounded-full bg-blue-50 text-blue-600 dark:bg-slate-800 dark:text-blue-400 flex items-center justify-center mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  No campaigns yet
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                  Build and activate your first automated email campaign sequence to start reaching contacts.
                </p>
                <div className="mt-4">
                  <Link href="/campaigns/new">
                    <Button size="sm">Create Campaign</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold dark:bg-slate-800/60 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Campaign</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Contacts</th>
                      <th className="py-3 px-4">Sent</th>
                      <th className="py-3 px-4">Delivered</th>
                      <th className="py-3 px-4">Opened</th>
                      <th className="py-3 px-4">Bounce Rate</th>
                      <th className="py-3 px-4">Created</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.recentCampaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          <Link href={`/campaigns/${c.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                            {c.name}
                          </Link>
                        </td>
                        <td className="py-3 px-4">{getStatusBadge(c.status)}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">
                          {c.contactCount}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">
                          {c.sentCount}
                        </td>
                        <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 font-medium">
                          {c.deliveredCount}
                        </td>
                        <td className="py-3 px-4 text-indigo-600 dark:text-indigo-400 font-medium">
                          {c.openedCount ?? 0} {c.openRate !== undefined ? `(${c.openRate}%)` : ""}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                          {c.bounceRate}%
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link href={`/campaigns/${c.id}`}>
                              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2">
                                View
                              </Button>
                            </Link>
                            <Link href={`/campaigns/${c.id}`}>
                              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2">
                                Edit
                              </Button>
                            </Link>
                            <Link href={`/campaigns/${c.id}?tab=analytics`}>
                              <Button variant="secondary" size="sm" className="h-6 text-[10px] px-2">
                                Analytics
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Recent Email Activity & System Health (1 col) */}
        <div className="space-y-6">
          {/* Recent Activity */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Recent Email Activity
            </h2>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {data.recentActivity.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No email activity recorded yet. Activate a campaign to start seeing dispatches.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.recentActivity.map((act) => (
                    <div
                      key={act.id}
                      className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-none last:pb-0 dark:border-slate-800 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {act.contactName}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {act.campaignName} • {act.contactEmail}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {getEventBadge(act.eventType)}
                        <span className="block text-[10px] text-slate-400 mt-1">
                          {new Date(act.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System Health Indicator (Section 18) */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              System Health
            </h2>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Application
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {data.health.application.message}
                  </span>
                </div>
                {getHealthBadge(data.health.application.status)}
              </div>

              <div className="flex items-center justify-between text-xs border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Database
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {data.health.database.message}
                  </span>
                </div>
                {getHealthBadge(data.health.database.status)}
              </div>

              <div className="flex items-center justify-between text-xs border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Email Provider
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {data.health.emailProvider.message}
                  </span>
                </div>
                {getHealthBadge(data.health.emailProvider.status)}
              </div>

              <div className="flex items-center justify-between text-xs border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Webhook
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {data.health.webhook.message}
                  </span>
                </div>
                {getHealthBadge(data.health.webhook.status)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Action Modals */}
      <AddContactModal
        isOpen={isAddContactOpen}
        onClose={() => setIsAddContactOpen(false)}
        onSuccess={() => {
          setIsAddContactOpen(false);
          handleRefresh();
        }}
      />

      <CsvImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => {
          setIsImportModalOpen(false);
          handleRefresh();
        }}
      />
    </div>
  );
}
