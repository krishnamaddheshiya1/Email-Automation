"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import type { AdminWorkspaceListItem } from "@/server/services/admin.service";

export default function AdminWorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal edit state
  const [selectedWs, setSelectedWs] = useState<AdminWorkspaceListItem | null>(null);
  const [editStatus, setEditStatus] = useState<string>("active");
  const [editName, setEditName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function loadWorkspaces() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: String(page),
          limit: "15",
        });
        if (search.trim()) params.set("search", search.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);

        const res = await fetch(`/api/admin/workspaces?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Failed to load workspaces.");
        }
        const data = await res.json();
        if (!ignore) {
          if (data.success) {
            setWorkspaces(data.workspaces || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 1);
          } else {
            throw new Error(data.error || "Failed to load workspaces");
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error loading workspaces");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadWorkspaces();
    return () => {
      ignore = true;
    };
  }, [page, search, statusFilter, refreshKey]);

  function openEditModal(ws: AdminWorkspaceListItem) {
    setSelectedWs(ws);
    setEditStatus(ws.status || "active");
    setEditName(ws.name || "");
    setSaveSuccess(null);
    setSaveError(null);
  }

  async function handleSaveWorkspace() {
    if (!selectedWs) return;
    try {
      setSaving(true);
      setSaveError(null);
      const res = await fetch(`/api/admin/workspaces/${selectedWs.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatus,
          name: editName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update workspace.");
      }

      setSaveSuccess("Workspace updated successfully!");
      setRefreshKey((k) => k + 1);
      setTimeout(() => {
        setSelectedWs(null);
      }, 900);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="Workspace Management"
        subtitle="Tenant boundaries, usage statistics, and customer workspace provisioning"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <input
                type="text"
                placeholder="Search workspaces by name..."
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
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Total Workspaces: <strong className="text-slate-900 dark:text-white">{total}</strong>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Workspaces Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Workspace Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Owner / Contact</th>
                  <th className="px-4 py-3 text-center">Daily Quota</th>
                  <th className="px-4 py-3 text-center">Monthly Quota</th>
                  <th className="px-4 py-3 text-center">Sending Status</th>
                  <th className="px-4 py-3 text-center">Members</th>
                  <th className="px-4 py-3 text-center">Contacts</th>
                  <th className="px-4 py-3 text-center">Campaigns</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-8 text-center text-slate-500">
                      <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                      <p>Loading workspaces...</p>
                    </td>
                  </tr>
                ) : workspaces.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-8 text-center text-slate-500">
                      No workspaces match the current criteria.
                    </td>
                  </tr>
                ) : (
                  workspaces.map((ws) => {
                    const isActive = ws.status.toLowerCase() === "active";
                    const isLimitExceeded = ws.sending_status === "LIMIT_EXCEEDED";
                    return (
                      <tr key={ws.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {ws.name}
                          </div>
                          <div className="text-slate-400 text-[10px] font-mono">
                            ID: {ws.id}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isActive
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {ws.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-800 dark:text-slate-200">
                            {ws.owner_name || "—"}
                          </div>
                          <div className="text-slate-500 text-[11px]">
                            {ws.owner_email || "No owner attached"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {(ws.daily_usage ?? 0).toLocaleString()} / {(ws.daily_limit ?? 1500).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {Math.max(0, (ws.daily_limit ?? 1500) - (ws.daily_usage ?? 0)).toLocaleString()} remaining
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {(ws.monthly_usage ?? 0).toLocaleString()} / {(ws.monthly_limit ?? 50000).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {Math.max(0, (ws.monthly_limit ?? 50000) - (ws.monthly_usage ?? 0)).toLocaleString()} remaining
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isLimitExceeded
                                ? "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isLimitExceeded ? "bg-rose-500" : "bg-emerald-500"}`} />
                            {ws.sending_status || "ACTIVE"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {ws.members_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {ws.contacts_count}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {ws.campaigns_count}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {new Date(ws.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEditModal(ws)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950 dark:hover:text-purple-300 transition-colors"
                          >
                            Configure
                          </button>
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

      {/* Edit Workspace Modal */}
      {selectedWs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Workspace Administration
              </h3>
              <button
                onClick={() => setSelectedWs(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <p><strong>Workspace ID:</strong> <span className="font-mono text-[10px]">{selectedWs.id}</span></p>
              <p><strong>Owner:</strong> {selectedWs.owner_email || "None"}</p>
              <p><strong>Entities:</strong> {selectedWs.members_count} members, {selectedWs.contacts_count} contacts, {selectedWs.campaigns_count} campaigns</p>
              <p><strong>Daily Usage:</strong> {(selectedWs.daily_usage ?? 0).toLocaleString()} / {(selectedWs.daily_limit ?? 1500).toLocaleString()} emails</p>
              <p><strong>Monthly Usage:</strong> {(selectedWs.monthly_usage ?? 0).toLocaleString()} / {(selectedWs.monthly_limit ?? 50000).toLocaleString()} emails</p>
              <p><strong>Sending Status:</strong> <span className={selectedWs.sending_status === "LIMIT_EXCEEDED" ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>{selectedWs.sending_status || "ACTIVE"}</span></p>
            </div>

            {saveSuccess && (
              <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
                {saveSuccess}
              </div>
            )}

            {saveError && (
              <div className="p-2.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold">
                {saveError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Workspace Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tenant Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedWs(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveWorkspace}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {saving ? "Saving..." : "Update Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
