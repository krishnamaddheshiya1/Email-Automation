"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { CampaignSummary } from "@/server/repositories/campaign.repository";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

export function CampaignListClient() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<{ id: string; name: string } | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    text: string;
    errors?: string[];
  } | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadCampaigns() {
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "10",
          status: statusFilter,
        });
        if (search.trim()) {
          params.set("search", search.trim());
        }

        const res = await fetch(`/api/campaigns?${params.toString()}`);
        const data = await res.json();
        if (ignore) return;
        if (data.success) {
          setCampaigns(data.data || []);
          setTotal(data.total || 0);
          setTotalPages(data.totalPages || 1);
        } else {
          setNotification({ type: "error", text: data.error || "Failed to load campaigns." });
        }
      } catch {
        if (!ignore) {
          setNotification({ type: "error", text: "Network error loading campaigns." });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadCampaigns();

    return () => {
      ignore = true;
    };
  }, [page, statusFilter, search, refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleDuplicate = async (id: string, name: string) => {
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Campaign "${name}" duplicated successfully.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to duplicate campaign.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error duplicating campaign." });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePause = async (id: string, name: string) => {
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/pause`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Campaign "${name}" has been paused.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to pause campaign.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error pausing campaign." });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleResume = async (id: string, name: string) => {
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/resume`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Campaign "${name}" resumed and is now ACTIVE.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to resume campaign.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error resuming campaign." });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to archive campaign "${name}"?`)) {
      return;
    }

    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Campaign "${name}" archived successfully.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to archive campaign.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error archiving campaign." });
    } finally {
      setActionLoadingId(null);
    }
  };

  const confirmDeleteCampaign = async () => {
    if (!campaignToDelete) return;
    const { id, name } = campaignToDelete;
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}?hard=true`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Campaign "${name}" permanently deleted.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to delete campaign.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error deleting campaign." });
    } finally {
      setActionLoadingId(null);
      setCampaignToDelete(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "DRAFT").toUpperCase();
    switch (s) {
      case "ACTIVE":
        return <Badge variant="success">✓ Active</Badge>;
      case "PAUSED":
        return <Badge variant="warning">⏸ Paused</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline">Archived</Badge>;
      case "COMPLETED":
        return <Badge variant="default">✓ Completed</Badge>;
      case "DRAFT":
      default:
        return <Badge variant="neutral">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div
          className={`p-4 rounded-lg flex flex-col gap-1 border text-sm transition-all ${
            notification.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{notification.text}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-xs opacity-70 hover:opacity-100 underline ml-4"
            >
              Dismiss
            </button>
          </div>
          {notification.errors && notification.errors.length > 0 && (
            <ul className="list-disc list-inside mt-2 text-xs space-y-1">
              {notification.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Header controls: Search & Status Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Input
              type="text"
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="ARCHIVED">Archived</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>

        <Link href="/campaigns/new">
          <Button variant="primary" size="sm">
            + New Campaign
          </Button>
        </Link>
      </div>

      {/* Campaigns Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-850 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Contacts</th>
                <th className="px-4 py-3">Steps</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right sticky right-0 bg-slate-50 dark:bg-slate-850 z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Loading campaigns...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <p className="text-slate-700 dark:text-slate-300 font-semibold text-base">
                      No campaigns yet
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Create your first email campaign to start automated sequence dispatch.
                    </p>
                    <Link href="/campaigns/new" className="mt-4 inline-block">
                      <Button variant="primary" size="sm">
                        Create Campaign
                      </Button>
                    </Link>
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => {
                  const statusUpper = (c.status || "DRAFT").toUpperCase();
                  const isActionLoading = actionLoadingId === c.id;

                  return (
                    <tr
                      key={c.id}
                      className="group hover:bg-slate-50/70 transition-colors dark:hover:bg-slate-850/50"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="hover:underline text-blue-600 dark:text-blue-400 font-semibold"
                        >
                          {c.name}
                        </Link>
                        {c.description && (
                          <p className="text-xs text-slate-400 line-clamp-1 max-w-xs mt-0.5">
                            {c.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(c.status)}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {c.contact_count ?? 0}
                        </span>{" "}
                        <span className="text-xs text-slate-400">contact(s)</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {c.step_count ?? 0}
                        </span>{" "}
                        <span className="text-xs text-slate-400">step(s)</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                        {c.sent_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-medium">
                        {c.delivered_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right sticky right-0 bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-850 z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Link href={`/campaigns/${c.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2">
                              View
                            </Button>
                          </Link>
                          <Link href={`/campaigns/${c.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2">
                              Edit
                            </Button>
                          </Link>
                          <Link href={`/campaigns/${c.id}?tab=analytics`}>
                            <Button variant="secondary" size="sm" className="h-7 text-xs px-2">
                              Analytics
                            </Button>
                          </Link>

                          {statusUpper === "ACTIVE" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2 text-amber-600 hover:text-amber-700 border-amber-200 hover:bg-amber-50"
                              disabled={isActionLoading}
                              onClick={() => handlePause(c.id, c.name)}
                              title="Pause active campaign"
                            >
                              Pause
                            </Button>
                          )}

                          {statusUpper === "PAUSED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2 text-emerald-600 hover:text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                              disabled={isActionLoading}
                              onClick={() => handleResume(c.id, c.name)}
                              title="Resume campaign"
                            >
                              Resume
                            </Button>
                          )}

                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs px-2"
                            disabled={isActionLoading}
                            onClick={() => handleDuplicate(c.id, c.name)}
                            title="Duplicate campaign and sequence steps"
                          >
                            Duplicate
                          </Button>

                          {statusUpper !== "ARCHIVED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2 text-slate-500 hover:text-amber-600"
                              disabled={isActionLoading}
                              onClick={() => handleArchive(c.id, c.name)}
                              title="Archive campaign"
                            >
                              Archive
                            </Button>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            disabled={isActionLoading}
                            onClick={() => setCampaignToDelete({ id: c.id, name: c.name })}
                            title="Permanently delete campaign"
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">
              Showing page <span className="font-semibold text-slate-800 dark:text-slate-200">{page}</span> of{" "}
              <span className="font-semibold text-slate-800 dark:text-slate-200">{totalPages}</span> ({total} campaigns)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Delete Campaign */}
      <ConfirmationModal
        isOpen={Boolean(campaignToDelete)}
        onClose={() => setCampaignToDelete(null)}
        onConfirm={confirmDeleteCampaign}
        title="Permanently Delete Campaign"
        message={`Are you sure you want to permanently delete campaign "${campaignToDelete?.name}"? This action will permanently remove all sequence steps, enrollments, and message records. This action cannot be undone.`}
        confirmText="Delete Campaign"
        cancelText="Cancel"
        variant="danger"
        loading={Boolean(actionLoadingId)}
      />
    </div>
  );
}
