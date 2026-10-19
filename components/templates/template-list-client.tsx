"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { EmailTemplate } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TemplateListClient() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [refreshKey, setRefreshKey] = useState(0);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    let ignore = false;

    async function loadTemplates() {
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "10",
          status: statusFilter,
        });
        if (search.trim()) {
          params.set("search", search.trim());
        }

        const res = await fetch(`/api/templates?${params.toString()}`);
        const data = await res.json();
        if (ignore) return;
        if (data.success) {
          setTemplates(data.data || []);
          setTotal(data.total || 0);
          setTotalPages(data.totalPages || 1);
        } else {
          setNotification({ type: "error", text: data.error || "Failed to load templates." });
        }
      } catch {
        if (!ignore) {
          setNotification({ type: "error", text: "Network error loading templates." });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadTemplates();

    return () => {
      ignore = true;
    };
  }, [page, statusFilter, search, refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleDuplicate = async (id: string, name: string) => {
    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/templates/${id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Template "${name}" duplicated successfully.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to duplicate template.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error duplicating template." });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to archive template "${name}"?`)) {
      return;
    }

    setActionLoadingId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Template "${name}" archived successfully.`,
        });
        refetch();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to archive template.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error archiving template." });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div
          className={`flex items-center justify-between rounded-xl p-4 text-sm ${
            notification.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
          }`}
        >
          <span>{notification.text}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs font-semibold underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header & New Template Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Email Templates
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create, personalize, and organize reusable email messages for multi-step campaigns.
          </p>
        </div>

        <Link href="/templates/new">
          <Button className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Template</span>
          </Button>
        </Link>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1 max-w-md">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search templates by name or subject..."
            className="pl-9"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-850">
          {(["active", "archived", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                statusFilter === s
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-750 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {s === "all" ? "All Templates" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Table / Cards */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span>Loading templates...</span>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 mb-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              No templates yet
            </h3>
            <p className="mt-1 max-w-sm text-xs sm:text-sm text-slate-500">
              {search
                ? `No templates matching "${search}". Try adjusting your search query.`
                : "Create a reusable email template."}
            </p>
            <div className="mt-5">
              <Link href="/templates/new">
                <Button size="sm">Create Template</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-850 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Template Name</th>
                  <th className="px-5 py-3.5">Subject</th>
                  <th className="px-5 py-3.5">Created</th>
                  <th className="px-5 py-3.5">Updated</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {templates.map((tpl) => (
                  <tr
                    key={tpl.id}
                    className="hover:bg-slate-50/60 transition-colors dark:hover:bg-slate-850/50"
                  >
                    <td className="px-5 py-4 font-semibold text-slate-900 dark:text-white">
                      <Link
                        href={`/templates/${tpl.id}`}
                        className="hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                      >
                        {tpl.name}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                      {tpl.subject}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(tpl.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(tpl.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/templates/${tpl.id}`}>
                          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs">
                            View / Edit
                          </Button>
                        </Link>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2.5 text-xs text-slate-600 hover:text-slate-900"
                          onClick={() => handleDuplicate(tpl.id, tpl.name)}
                          disabled={actionLoadingId === tpl.id}
                        >
                          Duplicate
                        </Button>

                        {tpl.status !== "archived" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            onClick={() => handleArchive(tpl.id, tpl.name)}
                            disabled={actionLoadingId === tpl.id}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-850">
            <div>
              Showing page {page} of {totalPages} ({total} templates)
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
