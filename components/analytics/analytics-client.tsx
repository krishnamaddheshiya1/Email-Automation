"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";

interface BusinessAnalyticsData {
  overview: {
    totalSent: number;
    totalDelivered: number;
    totalBounced: number;
    totalFailed: number;
    totalComplained: number;
    totalUnsubscribed: number;
    deliveryRate: number;
    bounceRate: number;
    complaintRate: number;
    unsubscribeRate: number;
  };
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    totalEnrolled: number;
    totalSent: number;
    totalDelivered: number;
    deliveryRate: number;
    bounceRate: number;
    createdAt: string;
  }>;
  dateRange: {
    appliedPreset: string;
    from: string | null;
    to: string | null;
  };
}

export function AnalyticsClient() {
  const [data, setData] = useState<BusinessAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<"today" | "7d" | "30d" | "all">("all");

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`/api/analytics/overview?range=${datePreset}`);
        const json = await res.json();
        if (!ignore) {
          if (res.ok && json.success) {
            setData(json.data);
          } else {
            setError(json.error || "Failed to load analytics.");
          }
        }
      } catch {
        if (!ignore) {
          setError("Network error loading deliverability analytics.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [datePreset]);

  const handleSelectPreset = (preset: "today" | "7d" | "30d" | "all") => {
    setLoading(true);
    setError(null);
    setDatePreset(preset);
  };

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/overview?range=${datePreset}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Failed to load analytics.");
      }
    } catch {
      setError("Network error loading deliverability analytics.");
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded-lg bg-slate-200 animate-pulse dark:bg-slate-800" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse dark:bg-slate-850" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/30">
        <h3 className="text-base font-semibold text-rose-900 dark:text-rose-200">
          Failed to load analytics
        </h3>
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
          {error || "An error occurred while loading delivery data."}
        </p>
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { overview, campaigns } = data;
  const hasActivity = overview.totalSent > 0 || campaigns.length > 0;

  return (
    <div className="space-y-6">
      {/* 1. Header with Date Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Campaign Analytics & Deliverability
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Aggregated delivery rates, recipient engagements, and spam safety across all sequences.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Preset Buttons */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {(["today", "7d", "30d", "all"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  datePreset === preset
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {preset === "today" ? "Today" : preset === "7d" ? "7 Days" : preset === "30d" ? "30 Days" : "All Time"}
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={handleRetry} className="text-xs">
            ↻ Refresh
          </Button>
        </div>
      </div>

      {!hasActivity ? (
        /* Empty State (Section 14) */
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No email activity yet.
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            Send your first campaign to start seeing delivery rates, bounce protection, and recipient progression.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/campaigns/new">
              <Button size="sm">Create Campaign</Button>
            </Link>
            <Link href="/campaigns">
              <Button variant="outline" size="sm">View Campaigns</Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 2. Primary Metrics Cards (Section 13) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Total Sent
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {overview.totalSent.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-slate-400 block mt-1">
                Dispatches
              </span>
            </Card>

            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Delivered
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {overview.totalDelivered.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-emerald-600 font-semibold block mt-1">
                {overview.deliveryRate}% rate
              </span>
            </Card>

            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Bounced
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {overview.totalBounced.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-amber-600 font-semibold block mt-1">
                {overview.bounceRate}% bounce rate
              </span>
            </Card>

            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Failed
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                {overview.totalFailed.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-slate-400 block mt-1">
                Relay errors
              </span>
            </Card>

            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Complaints
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {overview.totalComplained.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-slate-400 block mt-1">
                {overview.complaintRate}% spam rate
              </span>
            </Card>

            <Card className="p-4 shadow-2xs">
              <CardDescription className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Unsubscribed
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {overview.totalUnsubscribed.toLocaleString()}
              </CardTitle>
              <span className="text-[11px] text-slate-400 block mt-1">
                {overview.unsubscribeRate}% unsub rate
              </span>
            </Card>
          </div>

          {/* 3. Campaign Performance Comparison Table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Campaign Deliverability Breakdown
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Performance across individual campaign sequences in this workspace.
                </p>
              </div>
              <Link href="/campaigns/new">
                <Button size="sm" variant="outline" className="text-xs">
                  + New Campaign
                </Button>
              </Link>
            </div>

            {campaigns.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No campaigns found for this workspace.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold dark:bg-slate-800/60 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Campaign Name</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Audience</th>
                      <th className="py-3 px-4">Sent</th>
                      <th className="py-3 px-4">Delivered</th>
                      <th className="py-3 px-4">Delivery Rate</th>
                      <th className="py-3 px-4">Bounce Rate</th>
                      <th className="py-3 px-4">Created</th>
                      <th className="py-3 px-4 text-right">Detailed Metrics</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          <Link href={`/campaigns/${c.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                            {c.name}
                          </Link>
                        </td>
                        <td className="py-3 px-4">{getStatusBadge(c.status)}</td>
                        <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                          {c.totalEnrolled}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                          {c.totalSent}
                        </td>
                        <td className="py-3 px-4 font-medium text-emerald-600 dark:text-emerald-400">
                          {c.totalDelivered}
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                          {c.deliveryRate}%
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">
                          {c.bounceRate}%
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link href={`/campaigns/${c.id}?tab=analytics`}>
                            <Button variant="secondary" size="sm" className="h-6 text-[10px] px-2.5">
                              Inspect Sequence →
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
