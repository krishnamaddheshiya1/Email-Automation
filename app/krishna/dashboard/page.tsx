"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/admin-header";
import type { PlatformOverviewStats } from "@/server/services/admin.service";

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<PlatformOverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStats() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/overview");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Access denied. Admin privileges required.");
        }
        throw new Error("Failed to load platform statistics.");
      }
      const data = await res.json();
      if (data.success && data.stats) {
        setStats(data.stats);
      } else {
        throw new Error(data.error || "Invalid response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const res = await fetch("/api/admin/overview");
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error("Access denied. Admin privileges required.");
          }
          throw new Error("Failed to load platform statistics.");
        }
        const data = await res.json();
        if (!ignore) {
          if (data.success && data.stats) {
            setStats(data.stats);
          } else {
            throw new Error(data.error || "Invalid response");
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error fetching stats");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="Developer Dashboard"
        subtitle="Live platform metrics aggregated across all multi-tenant workspaces"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Loading / Error States */}
        {loading && (
          <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="inline-block w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-slate-500">Aggregating live platform data...</p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={loadStats}
              className="px-3 py-1 bg-rose-600 text-white rounded-md text-xs font-semibold hover:bg-rose-700"
            >
              Retry
            </button>
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Top Level Metric Cards */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Core Platform Scale
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Users */}
                <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Total Users</span>
                    <span className="p-2 bg-purple-50 dark:bg-purple-950 text-purple-600 rounded-xl">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                      </svg>
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.users.total}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="text-emerald-600 font-semibold">{stats.users.active} Active</span>
                    <span>•</span>
                    <span>{stats.users.admins} Admins</span>
                  </div>
                </div>

                {/* Workspaces */}
                <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Workspaces</span>
                    <span className="p-2 bg-blue-50 dark:bg-blue-950 text-blue-600 rounded-xl">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 21h18M3 7v14M21 7v14M6 11h2M6 15h2M11 11h2M11 15h2M16 11h2M16 15h2M9 3h6v4H9z" />
                      </svg>
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.workspaces.total}
                  </div>
                  <div className="mt-2 text-[11px] text-emerald-600 font-semibold">
                    {stats.workspaces.active} Active Tenants
                  </div>
                </div>

                {/* Contacts */}
                <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Total Contacts</span>
                    <span className="p-2 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-xl">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.contacts.total}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Managed Across Workspaces
                  </div>
                </div>

                {/* Campaigns */}
                <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-300 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Total Campaigns</span>
                    <span className="p-2 bg-amber-50 dark:bg-amber-950 text-amber-600 rounded-xl">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m3 11 18-5v12L3 14v-3z" />
                        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                      </svg>
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.campaigns.total}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="text-emerald-600 font-semibold">{stats.campaigns.active} Active</span>
                    <span>•</span>
                    <span>{stats.campaigns.draft} Draft</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Email Throughput & Delivery Metrics */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Platform Email Delivery & Engagement
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 font-medium">Sent</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                    {stats.emails.sent}
                  </p>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-emerald-600 font-medium">Delivered</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">
                    {stats.emails.delivered}
                  </p>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-blue-600 font-medium">Opened</p>
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {stats.emails.opened}
                  </p>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-purple-600 font-medium">Replies</p>
                  <p className="text-xl font-bold text-purple-600 mt-1">
                    {stats.emails.replies}
                  </p>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-amber-600 font-medium">Bounced</p>
                  <p className="text-xl font-bold text-amber-600 mt-1">
                    {stats.emails.bounced}
                  </p>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className="text-[11px] text-rose-600 font-medium">Failed</p>
                  <p className="text-xl font-bold text-rose-600 mt-1">
                    {stats.emails.failed}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Action Navigation Panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link
                href="/krishna/users"
                className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-purple-400 group transition-all"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-purple-600 transition-colors">
                    Manage Platform Users →
                  </h3>
                  <span className="text-slate-400">👤</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Search across tenants, modify roles, enable or disable user accounts.
                </p>
              </Link>

              <Link
                href="/krishna/workspaces"
                className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-purple-400 group transition-all"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-purple-600 transition-colors">
                    Manage Workspaces →
                  </h3>
                  <span className="text-slate-400">🏢</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Inspect workspace status, tenant membership counts, and usage levels.
                </p>
              </Link>

              <Link
                href="/krishna/audit-logs"
                className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-purple-400 group transition-all"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-purple-600 transition-colors">
                    Security Audit Trail →
                  </h3>
                  <span className="text-slate-400">🛡️</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Review administrative mutations with timestamps, actor IDs, and metadata.
                </p>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
