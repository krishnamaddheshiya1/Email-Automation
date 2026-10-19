"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Lead } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddContactModal } from "./add-contact-modal";
import { EditContactModal } from "./edit-contact-modal";
import { CsvImportModal } from "./csv-import-modal";
import { SuppressionModal } from "./suppression-modal";
import { BulkEnrollModal } from "./bulk-enroll-modal";
import { ImportHistoryModal } from "./import-history-modal";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface ContactsResponse {
  success: boolean;
  data: Lead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  error?: string;
}

export function ContactsClient() {
  const [contacts, setContacts] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination State
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "name" | "lead_score">("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Selection State for Bulk Actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("CONTACTED");
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSuppressionModalOpen, setIsSuppressionModalOpen] = useState(false);
  const [isBulkEnrollModalOpen, setIsBulkEnrollModalOpen] = useState(false);
  const [isImportHistoryModalOpen, setIsImportHistoryModalOpen] = useState(false);
  const [suppressionMap, setSuppressionMap] = useState<Map<string, string>>(new Map());
  const [editingContact, setEditingContact] = useState<Lead | null>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on new search
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = () => setRefreshKey((k) => k + 1);

  // Fetch suppressions map
  useEffect(() => {
    let ignore = false;
    async function loadSuppressionList() {
      try {
        const res = await fetch("/api/suppressions");
        const data = await res.json();
        if (!ignore && res.ok && data.success && Array.isArray(data.data)) {
          const map = new Map<string, string>();
          for (const s of data.data) {
            map.set(s.email.toLowerCase(), s.reason);
          }
          setSuppressionMap(map);
        }
      } catch {
        // Fallback
      }
    }
    loadSuppressionList();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  // Fetch contacts
  useEffect(() => {
    let ignore = false;

    async function loadContacts() {
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (statusFilter) params.set("status", statusFilter);
        if (sourceFilter) params.set("source", sourceFilter);
        params.set("sortBy", sortBy);
        params.set("sortOrder", sortOrder);
        params.set("page", page.toString());
        params.set("limit", limit.toString());

        const res = await fetch(`/api/contacts?${params.toString()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const data: ContactsResponse = await res.json();

        if (ignore) return;

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to load contacts");
        }

        setContacts(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setError(null);
        // Clear selected ids that no longer exist
        setSelectedIds((prev) => prev.filter((id) => data.data.some((c) => c.id === id)));
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error fetching contacts");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadContacts();
    const interval = setInterval(loadContacts, 10000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [debouncedSearch, statusFilter, sourceFilter, sortBy, sortOrder, page, limit, refreshKey]);

  // Single Contact Permanent Delete State & Handlers
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const openDeleteModal = (contact: Lead) => {
    const fullName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
    setDeleteTarget({
      id: contact.id,
      name: fullName || contact.email,
      email: contact.email,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/contacts/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete contact");
      }
      setContacts((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Bulk Selection Handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(contacts.map((c) => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          ids: selectedIds,
          status: bulkStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update selected contacts");
      }
      setSelectedIds([]);
      refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to archive ${selectedIds.length} contact(s)?`)) {
      return;
    }
    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          ids: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to archive selected contacts");
      }
      setSelectedIds([]);
      refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Bulk archive failed");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDeletePermanent = async () => {
    if (selectedIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_permanent",
          ids: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to permanently delete selected contacts");
      }
      setSelectedIds([]);
      setIsBulkDeleteModalOpen(false);
      refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Bulk permanent delete failed");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleSelectAllMatchingAcrossPages = async () => {
    setSelectingAllMatching(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      params.set("page", "1");
      params.set("limit", "10000");

      const res = await fetch(`/api/contacts?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.data)) {
        setSelectedIds(data.data.map((c: Lead) => c.id));
      }
    } catch {
      // Fallback
    } finally {
      setSelectingAllMatching(false);
    }
  };

  // CSV Export Download
  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);

    window.open(`/api/contacts/export?${params.toString()}`, "_blank");
  };

  // Helper for Status Badge Color
  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    switch (s) {
      case "NEW":
        return <Badge variant="default">NEW</Badge>;
      case "CONTACTED":
        return <Badge variant="neutral" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200">CONTACTED</Badge>;
      case "REPLIED":
        return <Badge variant="neutral" className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300 border-cyan-200">REPLIED</Badge>;
      case "INTERESTED":
        return <Badge variant="success">INTERESTED</Badge>;
      case "NOT_INTERESTED":
        return <Badge variant="neutral">NOT INTERESTED</Badge>;
      case "BOUNCED":
        return <Badge variant="warning" className="bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200">BOUNCED</Badge>;
      case "UNSUBSCRIBED":
        return <Badge variant="warning">UNSUBSCRIBED</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline" className="text-slate-400 border-slate-300">ARCHIVED</Badge>;
      default:
        return <Badge variant="neutral">{s}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your audience, lead scores, and communication lifecycle.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || total === 0}
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSuppressionModalOpen(true)}
            className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <svg
              className="w-4 h-4 mr-1.5 text-rose-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
            Suppressions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsImportModalOpen(true)}
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsImportHistoryModalOpen(true)}
            title="View Import History"
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Import History
          </Button>
          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Contact
          </Button>
        </div>
      </div>

      {/* Quick Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {[
          { id: "", label: "All Contacts" },
          { id: "NEW", label: "Never Contacted" },
          { id: "CONTACTED", label: "Already Contacted" },
          { id: "REPLIED", label: "Replied" },
          { id: "INTERESTED", label: "Interested" },
          { id: "BOUNCED", label: "Bounced" },
          { id: "UNSUBSCRIBED", label: "Unsubscribed" },
        ].map((tab) => {
          const isActive = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setStatusFilter(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter and Search Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, company..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-full py-2 px-3 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="NEW">NEW</option>
            <option value="CONTACTED">CONTACTED</option>
            <option value="REPLIED">REPLIED</option>
            <option value="INTERESTED">INTERESTED</option>
            <option value="NOT_INTERESTED">NOT_INTERESTED</option>
            <option value="BOUNCED">BOUNCED</option>
            <option value="UNSUBSCRIBED">UNSUBSCRIBED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>

        {/* Source Filter */}
        <div>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            className="w-full py-2 px-3 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Sources</option>
            <option value="manual">Manual Entry</option>
            <option value="csv_import">CSV Import</option>
            <option value="website">Website</option>
          </select>
        </div>

        {/* Sort Controls */}
        <div className="flex gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "created_at" | "name" | "lead_score")}
            className="w-full py-2 px-3 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="created_at">Date Created</option>
            <option value="name">Name</option>
            <option value="lead_score">Lead Score</option>
          </select>
          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
            className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold"
            title={`Sort ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {/* Bulk Selection Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/40 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                {selectedIds.length} contact(s) selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Clear selection
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="text-xs py-1.5 px-2 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="NEW">Mark NEW</option>
                <option value="CONTACTED">Mark CONTACTED</option>
                <option value="REPLIED">Mark REPLIED</option>
                <option value="INTERESTED">Mark INTERESTED</option>
                <option value="NOT_INTERESTED">Mark NOT_INTERESTED</option>
                <option value="BOUNCED">Mark BOUNCED</option>
                <option value="UNSUBSCRIBED">Mark UNSUBSCRIBED</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsBulkEnrollModalOpen(true)}
                className="bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-300 font-medium"
              >
                Enroll in Campaign
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={handleBulkStatusUpdate}
                disabled={bulkActionLoading}
              >
                Apply Status
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkArchive}
                disabled={bulkActionLoading}
                className="text-slate-600 hover:bg-slate-100 border-slate-300 dark:border-slate-700 dark:text-slate-300"
              >
                Bulk Archive
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsBulkDeleteModalOpen(true)}
                disabled={bulkActionLoading}
                className="text-rose-600 hover:bg-rose-50 border-rose-200 dark:border-rose-900 dark:text-rose-400 font-medium"
              >
                Delete Permanently
              </Button>
            </div>
          </div>

          {selectedIds.length === contacts.length && total > contacts.length && (
            <div className="p-2.5 bg-blue-100/70 border border-blue-200 rounded-lg text-center text-xs text-blue-900 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-200">
              All <strong>{contacts.length}</strong> contacts on this page are selected.{" "}
              <button
                type="button"
                disabled={selectingAllMatching}
                onClick={handleSelectAllMatchingAcrossPages}
                className="font-bold underline hover:text-blue-700 ml-1 dark:hover:text-blue-300 cursor-pointer"
              >
                {selectingAllMatching ? "Selecting..." : `Select all ${total} contacts matching this filter`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Contact Table Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <div className="inline-block animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mb-3" />
            <p className="text-sm">Loading contacts...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600 dark:text-rose-400">
            <p className="text-sm font-semibold">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={refetch}>
              Retry
            </Button>
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              No contacts found
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              {search || statusFilter || sourceFilter
                ? "No contacts match the specified search or filter criteria. Try clearing filters."
                : "Get started by adding your first contact or importing a CSV spreadsheet."}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                Add Contact
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsImportModalOpen(true)}>
                Import CSV
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50/75 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all contacts"
                      checked={
                        contacts.length > 0 &&
                        contacts.every((c) => selectedIds.includes(c.id))
                      }
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-4">Job Title</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Lead Score</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {contacts.map((contact) => {
                  const isSelected = selectedIds.includes(contact.id);
                  const fullName =
                    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
                    "Untitled Contact";

                  return (
                    <tr
                      key={contact.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors ${
                        isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${contact.email}`}
                          checked={isSelected}
                          onChange={() => handleSelectOne(contact.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>

                      <td className="py-3 px-4">
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:underline"
                        >
                          {fullName}
                        </Link>
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-xs">
                        {contact.email}
                      </td>

                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        {contact.company_name || "-"}
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-xs">
                        {contact.job_title || "-"}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          {getStatusBadge(contact.status)}
                          {suppressionMap.has(contact.email.toLowerCase()) && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            >
                              Suppressed ({suppressionMap.get(contact.email.toLowerCase())})
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                            {contact.lead_score}
                          </span>
                          <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, contact.lead_score))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-500">
                        {contact.source || "manual"}
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-500">
                        {new Date(contact.created_at).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/contacts/${contact.id}`}
                            className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                            title="View Details"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Link>

                          <button
                            type="button"
                            onClick={() => setEditingContact(contact)}
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={() => openDeleteModal(contact)}
                            className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                            title="Delete contact permanently"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && contacts.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(page - 1) * limit + 1}</span> to{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(page * limit, total)}</span> of{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{total}</span> contacts
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                Previous
              </button>
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddContactModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          refetch();
        }}
      />

      <EditContactModal
        isOpen={Boolean(editingContact)}
        contact={editingContact}
        onClose={() => setEditingContact(null)}
        onSuccess={() => {
          setEditingContact(null);
          refetch();
        }}
      />

      <CsvImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => {
          setPage(1);
          refetch();
        }}
      />

      <SuppressionModal
        isOpen={isSuppressionModalOpen}
        onClose={() => setIsSuppressionModalOpen(false)}
        onSuppressionChanged={refetch}
      />

      <BulkEnrollModal
        isOpen={isBulkEnrollModalOpen}
        selectedIds={selectedIds}
        onClose={() => setIsBulkEnrollModalOpen(false)}
        onSuccess={() => {
          setSelectedIds([]);
          refetch();
        }}
      />

      <ImportHistoryModal
        isOpen={isImportHistoryModalOpen}
        onClose={() => setIsImportHistoryModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete this contact permanently?"
        message={
          deleteTarget
            ? `Are you sure you want to permanently delete "${deleteTarget.name}" (${deleteTarget.email})? This action cannot be undone and will permanently remove this contact from all campaigns and conversations.`
            : ""
        }
        confirmText="Delete Permanently"
        cancelText="Cancel"
        variant="danger"
        loading={deleteLoading}
      />

      <ConfirmationModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        onConfirm={handleBulkDeletePermanent}
        title="Permanently Delete Selected Contacts?"
        message={`Are you sure you want to permanently delete ${selectedIds.length} contact(s)? This will permanently remove their records, campaign enrollments, conversation history, and sent messages from the database. This action cannot be undone.`}
        confirmText="Delete Permanently"
        cancelText="Cancel"
        variant="danger"
        loading={bulkActionLoading}
      />
    </div>
  );
}
