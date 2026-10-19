"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmailMessageDetailModal } from "./email-message-detail-modal";
import type {
  CampaignAnalyticsOverview,
  CampaignTimelinePoint,
  StepAnalyticsItem,
  ContactEmailHistoryItem,
} from "@/types/database";

interface CampaignAnalyticsTabProps {
  campaignId: string;
}

export function CampaignAnalyticsTab({ campaignId }: CampaignAnalyticsTabProps) {
  // Filter state
  const [datePreset, setDatePreset] = useState<"today" | "7d" | "30d" | "all" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Data state
  const [overview, setOverview] = useState<CampaignAnalyticsOverview | null>(null);
  const [timeline, setTimeline] = useState<CampaignTimelinePoint[]>([]);
  const [steps, setSteps] = useState<StepAnalyticsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Paginated messages state
  const [messages, setMessages] = useState<ContactEmailHistoryItem[]>([]);
  const [msgPage, setMsgPage] = useState(1);
  const [msgLimit, setMsgLimit] = useState(50);
  const [msgTotalPages, setMsgTotalPages] = useState(1);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgStatusFilter, setMsgStatusFilter] = useState<string>("");
  const [msgLoading, setMsgLoading] = useState(false);

  // Inspect message modal
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  // Refresh trigger
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function loadAnalytics() {
      try {
        let url = `/api/campaigns/${campaignId}/analytics?range=${datePreset}`;
        if (datePreset === "custom" && customFrom) {
          url += `&from=${encodeURIComponent(new Date(customFrom).toISOString())}`;
          if (customTo) url += `&to=${encodeURIComponent(new Date(customTo).toISOString())}`;
        }

        const res = await fetch(url);
        const data = await res.json();
        if (!ignore) {
          if (res.ok && data.success) {
            setOverview(data.data.overview);
            setTimeline(data.data.timeline || []);
            setSteps(data.data.steps || []);
            setError(null);
          } else {
            setError(data.error || "Failed to load campaign analytics.");
          }
          setLoading(false);
        }
      } catch {
        if (!ignore) {
          setError("Network error fetching analytics data.");
          setLoading(false);
        }
      }
    }

    loadAnalytics();
    return () => {
      ignore = true;
    };
  }, [campaignId, datePreset, customFrom, customTo, refreshKey]);

  useEffect(() => {
    let ignore = false;
    async function loadMessages() {
      try {
        let url = `/api/campaigns/${campaignId}/messages?page=${msgPage}&limit=${msgLimit}`;
        if (msgStatusFilter) url += `&status=${encodeURIComponent(msgStatusFilter)}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!ignore && res.ok && data.success) {
          setMessages(data.data || []);
          setMsgTotal(data.total || 0);
          setMsgTotalPages(data.totalPages || 1);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) {
          setMsgLoading(false);
        }
      }
    }

    loadMessages();
    return () => {
      ignore = true;
    };
  }, [campaignId, msgPage, msgLimit, msgStatusFilter, refreshKey]);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const link = document.createElement("a");
      link.href = `/api/campaigns/${campaignId}/analytics/export`;
      link.setAttribute("download", `campaign-${campaignId}-analytics.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert("Failed to initiate CSV export.");
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    switch (s) {
      case "DELIVERED":
        return <Badge variant="success">DELIVERED</Badge>;
      case "SENT":
        return <Badge variant="default">SENT</Badge>;
      case "BOUNCED":
        return <Badge variant="warning">BOUNCED</Badge>;
      case "COMPLAINED":
        return <Badge variant="warning">COMPLAINED</Badge>;
      case "FAILED":
        return <Badge variant="warning">FAILED</Badge>;
      case "ACTIVE":
        return <Badge variant="success">ACTIVE</Badge>;
      case "PAUSED":
        return <Badge variant="warning">PAUSED</Badge>;
      default:
        return <Badge variant="neutral">{s || "QUEUED"}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Control Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Date Filter:
          </span>
          {(["today", "7d", "30d", "all", "custom"] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setDatePreset(preset);
                setMsgPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                datePreset === preset
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {preset === "today"
                ? "Today"
                : preset === "7d"
                ? "Last 7 Days"
                : preset === "30d"
                ? "Last 30 Days"
                : preset === "all"
                ? "All Time"
                : "Custom Range"}
            </button>
          ))}

          {datePreset === "custom" && (
            <div className="flex items-center gap-2 mt-2 sm:mt-0">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              setMsgLoading(true);
              setRefreshKey((k) => k + 1);
            }}
            disabled={loading}
            className="text-xs"
          >
            {loading ? "Refreshing..." : "↻ Refresh"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="text-xs font-medium"
          >
            {isExporting ? "Exporting..." : "⬇ Export CSV"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {/* 1. Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Enrolled
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-slate-900 dark:text-white">
            {overview?.total_enrolled.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">
            {overview?.total_active ?? 0} active • {overview?.total_completed ?? 0} done
          </span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Total Sent
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">
            {overview?.total_sent.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Provider dispatches</span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Delivered
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {overview?.total_delivered.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Confirmed inbox</span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Bounced
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
            {overview?.total_bounced.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Suppressed safely</span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Failed
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">
            {overview?.total_failed.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Pre-flight/network</span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Complaints
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-purple-600 dark:text-purple-400">
            {overview?.total_complained.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Spam reports</span>
        </Card>

        <Card className="p-4">
          <CardDescription className="text-[11px] font-medium uppercase text-slate-500">
            Unsubscribed
          </CardDescription>
          <CardTitle className="text-2xl font-bold mt-1 text-slate-700 dark:text-slate-300">
            {overview?.total_unsubscribed.toLocaleString() ?? "0"}
          </CardTitle>
          <span className="text-[10px] text-slate-400 block mt-1">Opt-out links</span>
        </Card>
      </div>

      {/* 2. Performance Rates Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Delivery Rate */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Delivery Rate
            </span>
            <Badge variant="success" className="text-[10px]">
              Target: &gt;95%
            </Badge>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {overview?.delivery_rate ?? 0}%
            </span>
            <span className="text-xs text-slate-400">
              ({overview?.total_delivered ?? 0}/{overview?.total_sent ?? 0})
            </span>
          </div>
          <div className="mt-3 h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, overview?.delivery_rate || 0)}%` }}
            />
          </div>
        </Card>

        {/* Bounce Rate */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Bounce Rate
            </span>
            <Badge variant={overview && overview.bounce_rate > 5 ? "warning" : "neutral"} className="text-[10px]">
              Ceiling: &lt;5%
            </Badge>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {overview?.bounce_rate ?? 0}%
            </span>
            <span className="text-xs text-slate-400">
              ({overview?.total_bounced ?? 0}/{overview?.total_sent ?? 0})
            </span>
          </div>
          <div className="mt-3 h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, overview?.bounce_rate || 0)}%` }}
            />
          </div>
        </Card>

        {/* Complaint Rate */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Complaint Rate
            </span>
            <Badge variant={overview && overview.complaint_rate > 0.1 ? "warning" : "neutral"} className="text-[10px]">
              Ceiling: &lt;0.1%
            </Badge>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {overview?.complaint_rate ?? 0}%
            </span>
            <span className="text-xs text-slate-400">
              ({overview?.total_complained ?? 0}/{overview?.total_sent ?? 0})
            </span>
          </div>
          <div className="mt-3 h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (overview?.complaint_rate || 0) * 10)}%` }}
            />
          </div>
        </Card>

        {/* Unsubscribe Rate */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Unsubscribe Rate
            </span>
            <Badge variant="neutral" className="text-[10px]">
              Benchmark: &lt;1%
            </Badge>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {overview?.unsubscribe_rate ?? 0}%
            </span>
            <span className="text-xs text-slate-400">
              ({overview?.total_unsubscribed ?? 0}/{overview?.total_sent ?? 0})
            </span>
          </div>
          <div className="mt-3 h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, overview?.unsubscribe_rate || 0)}%` }}
            />
          </div>
        </Card>
      </div>

      {/* 3. Campaign Timeline Activity (Over Time) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Campaign Activity Timeline</CardTitle>
              <CardDescription className="text-xs">
                Actual event volume over time from verified provider timestamps.
              </CardDescription>
            </div>
            <span className="text-xs font-medium text-slate-400">
              {timeline.length} active day(s) recorded
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <div className="space-y-3">
              {timeline.map((point) => (
                <div
                  key={point.date}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 text-xs"
                >
                  <div className="font-semibold text-slate-900 dark:text-white sm:w-28 font-mono">
                    {point.date}
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-blue-600 font-medium">
                      <strong>{point.sent}</strong> sent
                    </span>
                    <span className="text-emerald-600 font-medium">
                      <strong>{point.delivered}</strong> delivered
                    </span>
                    {point.bounced > 0 && (
                      <span className="text-amber-600 font-medium">
                        <strong>{point.bounced}</strong> bounced
                      </span>
                    )}
                    {point.failed > 0 && (
                      <span className="text-red-600 font-medium">
                        <strong>{point.failed}</strong> failed
                      </span>
                    )}
                    {point.unsubscribed > 0 && (
                      <span className="text-slate-500 font-medium">
                        <strong>{point.unsubscribed}</strong> unsubs
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs italic">
              No delivery events recorded yet in the selected date range.
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Step-Level Analytics Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sequence Step Performance</CardTitle>
          <CardDescription className="text-xs">
            Per-step delivery throughput and bounce breakdown across all sequence stages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {steps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Step</th>
                    <th className="p-3">Step Name</th>
                    <th className="p-3 text-right">Sent</th>
                    <th className="p-3 text-right">Delivered</th>
                    <th className="p-3 text-right">Bounced</th>
                    <th className="p-3 text-right">Failed</th>
                    <th className="p-3 text-right">Unsubs</th>
                    <th className="p-3 text-right">Delivery Rate</th>
                    <th className="p-3 text-right">Bounce Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {steps.map((st) => (
                    <tr key={st.step_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        #{st.step_number}
                      </td>
                      <td className="p-3 font-medium text-slate-700 dark:text-slate-300">
                        {st.step_name}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-blue-600">
                        {st.sent}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-600">
                        {st.delivered}
                      </td>
                      <td className="p-3 text-right font-mono text-amber-600">
                        {st.bounced}
                      </td>
                      <td className="p-3 text-right font-mono text-red-600">
                        {st.failed}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-500">
                        {st.unsubscribed}
                      </td>
                      <td className="p-3 text-right font-semibold text-emerald-600">
                        {st.delivery_rate}%
                      </td>
                      <td className="p-3 text-right font-semibold text-amber-600">
                        {st.bounce_rate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs italic">
              No active steps found for this campaign sequence.
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Campaign Dispatches Table (Paginated) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Message Execution History</CardTitle>
              <CardDescription className="text-xs">
                Individual email dispatch records with delivery timestamps and error details.
              </CardDescription>
            </div>

            {/* Filter by status */}
            <div className="flex items-center gap-2">
              <select
                value={msgStatusFilter}
                onChange={(e) => {
                  setMsgStatusFilter(e.target.value);
                  setMsgPage(1);
                }}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <option value="">All Statuses</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="bounced">Bounced</option>
                <option value="failed">Failed</option>
                <option value="complained">Complained</option>
              </select>

              <select
                value={msgLimit}
                onChange={(e) => {
                  setMsgLimit(parseInt(e.target.value, 10));
                  setMsgPage(1);
                }}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {msgLoading ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              Loading dispatches...
            </div>
          ) : messages.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Recipient</th>
                    <th className="p-3">Step</th>
                    <th className="p-3">Subject</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Sent At</th>
                    <th className="p-3">Delivered At</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {messages.map((m) => (
                    <tr
                      key={m.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer"
                      onClick={() => setSelectedMessageId(m.id)}
                    >
                      <td className="p-3 font-medium text-slate-900 dark:text-white font-mono">
                        {m.to_email}
                      </td>
                      <td className="p-3 text-slate-500">
                        {m.step_number ? `Step ${m.step_number}` : "—"}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300 max-w-xs truncate">
                        {m.subject}
                      </td>
                      <td className="p-3">{getStatusBadge(m.status)}</td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {m.sent_at ? new Date(m.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {m.delivered_at ? new Date(m.delivered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[10px] py-1 px-2 h-auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMessageId(m.id);
                          }}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination controls */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500">
                  Showing {(msgPage - 1) * msgLimit + 1} to{" "}
                  {Math.min(msgPage * msgLimit, msgTotal)} of {msgTotal} records
                </span>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={msgPage <= 1}
                    onClick={() => setMsgPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-slate-600 font-medium">
                    Page {msgPage} of {msgTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={msgPage >= msgTotalPages}
                    onClick={() => setMsgPage((p) => Math.min(msgTotalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs italic">
              No matching messages found for this campaign.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Message Detail Modal */}
      <EmailMessageDetailModal
        messageId={selectedMessageId}
        isOpen={Boolean(selectedMessageId)}
        onClose={() => setSelectedMessageId(null)}
      />
    </div>
  );
}
