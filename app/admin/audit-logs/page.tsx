"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import type { AdminAuditLogItem } from "@/server/services/admin.service";

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector modal
  const [inspectLog, setInspectLog] = useState<AdminAuditLogItem | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadLogs() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: String(page),
          limit: "15",
        });
        if (actionFilter !== "all") params.set("action", actionFilter);
        if (resourceFilter !== "all") params.set("targetResource", resourceFilter);

        const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Failed to load audit logs.");
        }
        const data = await res.json();
        if (!ignore) {
          if (data.success) {
            setLogs(data.logs || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 1);
          } else {
            throw new Error(data.error || "Failed to load audit logs");
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error loading logs");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadLogs();
    return () => {
      ignore = true;
    };
  }, [page, actionFilter, resourceFilter]);

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="Administrative Audit Logs"
        subtitle="Immutable audit trail of administrative modifications, role adjustments, and workspace status changes"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center flex-1">
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
            >
              <option value="all">All Actions</option>
              <option value="USER_UPDATE">USER_UPDATE</option>
              <option value="WORKSPACE_UPDATE">WORKSPACE_UPDATE</option>
              <option value="ROLE_CHANGE">ROLE_CHANGE</option>
              <option value="STATUS_TOGGLE">STATUS_TOGGLE</option>
            </select>

            <select
              value={resourceFilter}
              onChange={(e) => {
                setResourceFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
            >
              <option value="all">All Resources</option>
              <option value="user">User</option>
              <option value="workspace">Workspace</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Total Logged Events: <strong className="text-slate-900 dark:text-white">{total}</strong>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Audit Log Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-4 py-3">Admin Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target Resource</th>
                  <th className="px-4 py-3">Summary / Details</th>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                      <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                      <p>Loading audit trail...</p>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                      No administrative audit logs match current filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        {log.admin_email}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold capitalize text-slate-700 dark:text-slate-300">
                        {log.target_resource}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-xs truncate" title={log.details || ""}>
                        {log.details || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">
                        {log.ip_address || "Internal"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setInspectLog(log)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950 dark:hover:text-purple-300 transition-colors"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
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

      {/* Metadata Inspector Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Audit Log Entry</span>
                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold">
                  {inspectLog.action}
                </span>
              </h3>
              <button
                onClick={() => setInspectLog(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl">
                <div>
                  <span className="text-slate-400 block text-[10px]">Actor:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{inspectLog.admin_email}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Timestamp:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">{new Date(inspectLog.created_at).toISOString()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Target Resource:</span>
                  <span className="font-semibold capitalize text-slate-800 dark:text-slate-200">{inspectLog.target_resource}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Target ID:</span>
                  <span className="font-mono text-[10px] text-slate-800 dark:text-slate-200">{inspectLog.target_id || "N/A"}</span>
                </div>
              </div>

              <div>
                <span className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Description:</span>
                <p className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-slate-800 dark:text-slate-200">
                  {inspectLog.details || "No description provided."}
                </p>
              </div>

              <div>
                <span className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Audit Payload Metadata:</span>
                <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl text-[11px] font-mono overflow-x-auto max-h-56">
                  {JSON.stringify(inspectLog.metadata, null, 2)}
                </pre>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectLog(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
