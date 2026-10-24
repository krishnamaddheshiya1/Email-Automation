"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import type { AdminCampaignListItem } from "@/server/services/admin.service";

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AdminCampaignListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadCampaigns() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: String(page),
          limit: "15",
        });
        if (search.trim()) params.set("search", search.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);

        const res = await fetch(`/api/admin/campaigns?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Failed to load campaigns.");
        }
        const data = await res.json();
        if (!ignore) {
          if (data.success) {
            setCampaigns(data.campaigns || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 1);
          } else {
            throw new Error(data.error || "Failed to load campaigns");
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error loading campaigns");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadCampaigns();
    return () => {
      ignore = true;
    };
  }, [page, search, statusFilter]);

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="Campaign & Email Monitoring"
        subtitle="Global cross-tenant visibility into campaign statuses and message delivery metrics"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <input
                type="text"
                placeholder="Search by campaign name or workspace..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 pl-9 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
            >
              <option value="all">All Campaign Statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Total Campaigns: <strong className="text-slate-900 dark:text-white">{total}</strong>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Campaigns Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Campaign</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Sent</th>
                  <th className="px-4 py-3 text-center">Delivered</th>
                  <th className="px-4 py-3 text-center">Opened</th>
                  <th className="px-4 py-3 text-center">Replies</th>
                  <th className="px-4 py-3 text-center">Bounced</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-8 text-center text-slate-500">
                      <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                      <p>Loading campaign monitoring data...</p>
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-8 text-center text-slate-500">
                      No campaigns match the selected filters.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => {
                    const isActive = c.status.toLowerCase() === "active";
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {c.name}
                          </div>
                          <div className="text-slate-400 text-[10px] font-mono">
                            ID: {c.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {c.workspace_name}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isActive
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {c.sent_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-emerald-600">
                          {c.delivered_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-blue-600">
                          {c.opened_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-purple-600">
                          {c.replies_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-amber-600">
                          {c.bounced_count}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {new Date(c.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <div>
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
