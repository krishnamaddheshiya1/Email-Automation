"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import type { AdminUserListItem } from "@/server/services/admin.service";

interface WorkspaceItem {
  id: string;
  name: string;
  allowed_email_domain?: string | null;
  status: string;
}

interface AuthorizedEmailItem {
  id: string;
  email: string;
  workspace_id?: string | null;
  role: string;
  auto_approve: boolean;
  notes?: string | null;
  created_at: string;
}

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<"users" | "allowlist" | "domains">("users");

  // Users Tab State
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Available Workspaces Cache
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);

  // Modals & Action States
  const [approveUserTarget, setApproveUserTarget] = useState<AdminUserListItem | null>(null);
  const [approveMode, setApproveMode] = useState<"existing" | "new">("existing");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [approveRole, setApproveRole] = useState("member");
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Confirm Reject Modal
  const [rejectUserTarget, setRejectUserTarget] = useState<AdminUserListItem | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Confirm Block Modal
  const [blockUserTarget, setBlockUserTarget] = useState<AdminUserListItem | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  // Confirm Unblock Modal
  const [unblockUserTarget, setUnblockUserTarget] = useState<AdminUserListItem | null>(null);
  const [unblockSubmitting, setUnblockSubmitting] = useState(false);

  // Edit User Modal
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [editStatus, setEditStatus] = useState<string>("active");
  const [editRole, setEditRole] = useState<string>("member");
  const [editWorkspaceId, setEditWorkspaceId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Allowlist Tab State
  const [authorizedEmails, setAuthorizedEmails] = useState<AuthorizedEmailItem[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(false);
  const [showAddAllowlistModal, setShowAddAllowlistModal] = useState(false);
  const [newAllowEmail, setNewAllowEmail] = useState("");
  const [newAllowWorkspaceId, setNewAllowWorkspaceId] = useState("");
  const [newAllowRole, setNewAllowRole] = useState("member");
  const [newAllowAutoApprove, setNewAllowAutoApprove] = useState(true);
  const [newAllowNotes, setNewAllowNotes] = useState("");
  const [allowlistSubmitting, setAllowlistSubmitting] = useState(false);
  const [allowlistError, setAllowlistError] = useState<string | null>(null);

  // Domain Tab State
  const [domainModalWorkspace, setDomainModalWorkspace] = useState<WorkspaceItem | null>(null);
  const [editDomainValue, setEditDomainValue] = useState("");
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  // Load Workspaces for dropdowns
  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const res = await fetch("/api/admin/workspaces?limit=100");
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.workspaces)) {
            setWorkspaces(data.workspaces);
            if (data.workspaces.length > 0 && !selectedWorkspaceId) {
              setSelectedWorkspaceId(data.workspaces[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load workspaces:", err);
      }
    }
    loadWorkspaces();
  }, [selectedWorkspaceId]);

  // Load Users Effect
  useEffect(() => {
    let ignore = false;
    if (activeTab === "users") {
      async function fetchUsers() {
        try {
          const params = new URLSearchParams({
            page: String(page),
            limit: "15",
          });
          if (search.trim()) params.set("search", search.trim());
          if (roleFilter !== "all") params.set("role", roleFilter);
          if (statusFilter !== "all") params.set("status", statusFilter);
          if (workspaceFilter !== "all") params.set("workspaceId", workspaceFilter);

          const res = await fetch(`/api/admin/users?${params.toString()}`);
          if (!res.ok) {
            throw new Error("Failed to load users list.");
          }
          const data = await res.json();
          if (!ignore) {
            if (data.success) {
              setUsers(data.users || []);
              setTotal(data.total || 0);
              setTotalPages(data.totalPages || 1);
              setError(null);
            } else {
              setError(data.error || "Failed to load users");
            }
          }
        } catch (err) {
          if (!ignore) {
            setError(err instanceof Error ? err.message : "Error loading users");
          }
        } finally {
          if (!ignore) {
            setLoading(false);
          }
        }
      }
      fetchUsers();
    }
    return () => {
      ignore = true;
    };
  }, [page, search, roleFilter, statusFilter, workspaceFilter, activeTab, refreshKey]);

  // Load Authorized Emails Effect
  useEffect(() => {
    let ignore = false;
    if (activeTab === "allowlist") {
      async function fetchAllowlist() {
        try {
          const res = await fetch("/api/admin/authorized-emails");
          if (res.ok) {
            const data = await res.json();
            if (!ignore && data.success) {
              setAuthorizedEmails(data.authorized_emails || []);
            }
          }
        } catch (err) {
          console.error("Failed to load allowlist:", err);
        } finally {
          if (!ignore) {
            setAllowlistLoading(false);
          }
        }
      }
      fetchAllowlist();
    }
    return () => {
      ignore = true;
    };
  }, [activeTab, refreshKey]);

  // Approve User Action
  async function handleApproveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!approveUserTarget) return;

    setApproveSubmitting(true);
    setApproveError(null);

    try {
      const payload: {
        workspace_id?: string;
        new_workspace_name?: string;
        role: string;
      } = {
        role: approveRole,
      };

      if (approveMode === "new") {
        if (!newWorkspaceName.trim()) {
          setApproveError("Please enter a name for the new workspace.");
          setApproveSubmitting(false);
          return;
        }
        payload.new_workspace_name = newWorkspaceName.trim();
      } else {
        if (!selectedWorkspaceId) {
          setApproveError("Please select an existing workspace.");
          setApproveSubmitting(false);
          return;
        }
        payload.workspace_id = selectedWorkspaceId;
      }

      const res = await fetch(`/api/admin/users/${approveUserTarget.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Approval failed.");
      }

      setApproveUserTarget(null);
      setNewWorkspaceName("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproveSubmitting(false);
    }
  }

  // Reject User Action
  async function handleRejectSubmit() {
    if (!rejectUserTarget) return;
    setRejectSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${rejectUserTarget.id}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Rejection failed");
      }
      setRejectUserTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setRejectSubmitting(false);
    }
  }

  // Block User Action
  async function handleBlockSubmit() {
    if (!blockUserTarget) return;
    setBlockSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${blockUserTarget.id}/block`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Blocking user failed");
      }
      setBlockUserTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Blocking user failed");
    } finally {
      setBlockSubmitting(false);
    }
  }

  // Unblock User Action
  async function handleUnblockSubmit() {
    if (!unblockUserTarget) return;
    setUnblockSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${unblockUserTarget.id}/unblock`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Unblocking user failed");
      }
      setUnblockUserTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unblocking user failed");
    } finally {
      setUnblockSubmitting(false);
    }
  }

  // Edit User Save
  function openEditModal(u: AdminUserListItem) {
    setSelectedUser(u);
    setEditStatus(u.status || "active");
    setEditRole(u.role || "member");
    setEditWorkspaceId(u.business_id || "");
    setSaveSuccess(null);
    setSaveError(null);
  }

  async function handleSaveUser() {
    if (!selectedUser) return;
    try {
      setSaving(true);
      setSaveError(null);
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatus,
          role: editRole,
          business_id: editWorkspaceId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update user.");
      }

      setSaveSuccess("User updated and audit log recorded!");
      setRefreshKey((k) => k + 1);
      setTimeout(() => {
        setSelectedUser(null);
      }, 700);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Allowlist Submit
  async function handleAddAllowlist(e: React.FormEvent) {
    e.preventDefault();
    if (!newAllowEmail.trim()) return;

    setAllowlistSubmitting(true);
    setAllowlistError(null);
    try {
      const res = await fetch("/api/admin/authorized-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newAllowEmail.trim(),
          workspace_id: newAllowWorkspaceId || null,
          role: newAllowRole,
          auto_approve: newAllowAutoApprove,
          notes: newAllowNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to add authorized email");
      }
      setShowAddAllowlistModal(false);
      setNewAllowEmail("");
      setNewAllowNotes("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAllowlistError(err instanceof Error ? err.message : "Error saving");
    } finally {
      setAllowlistSubmitting(false);
    }
  }

  async function handleDeleteAllowlist(id: string) {
    if (!confirm("Are you sure you want to remove this authorized email?")) return;
    try {
      const res = await fetch(`/api/admin/authorized-emails/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  // Save Allowed Domain
  async function handleSaveDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!domainModalWorkspace) return;
    setDomainSubmitting(true);
    setDomainError(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${domainModalWorkspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowed_email_domain: editDomainValue.trim().toLowerCase() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update domain");
      }
      setDomainModalWorkspace(null);
      // Reload workspaces
      const wsRes = await fetch("/api/admin/workspaces?limit=100");
      if (wsRes.ok) {
        const wsData = await wsRes.json();
        if (wsData.success) setWorkspaces(wsData.workspaces);
      }
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : "Domain update failed");
    } finally {
      setDomainSubmitting(false);
    }
  }

  const pendingCount = users.filter((u) => (u.status || "").toLowerCase() === "pending").length;

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="User Access & Authorization"
        subtitle="Approve new accounts, assign tenant workspaces & roles, manage allowlists, and revoke sessions"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab("users")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "users"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>Users & Approvals</span>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-bold text-[10px] animate-pulse">
                {pendingCount} Pending
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("allowlist")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "allowlist"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>Authorized Emails (Allowlist)</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px]">
              {authorizedEmails.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("domains")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "domains"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>Workspace Allowed Domains</span>
          </button>
        </div>

        {/* TAB 1: USERS & APPROVALS */}
        {activeTab === "users" && (
          <div className="space-y-6">
            {/* Pending Notification Banner */}
            {pendingCount > 0 && statusFilter !== "pending" && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
                    ⚠️
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {pendingCount} Registration{pendingCount > 1 ? "s" : ""} Awaiting Platform Approval
                    </h4>
                    <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80">
                      New signups cannot access application dashboards or APIs until an admin approves them and assigns a workspace.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setStatusFilter("pending");
                    setPage(1);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-sm"
                >
                  Filter Pending Users
                </button>
              </div>
            )}

            {/* Filters and Search Bar */}
            <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between shadow-sm">
              <div className="flex flex-wrap gap-3 items-center flex-1">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <input
                    type="text"
                    placeholder="Search name, email, workspace..."
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

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending Approval</option>
                  <option value="active">Active</option>
                  <option value="blocked">Blocked</option>
                  <option value="rejected">Rejected</option>
                  <option value="inactive">Inactive</option>
                </select>

                {/* Role Filter */}
                <select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
                >
                  <option value="all">All Roles</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="platform_admin">Platform Admin</option>
                  <option value="viewer">Viewer</option>
                </select>

                {/* Workspace Filter */}
                <select
                  value={workspaceFilter}
                  onChange={(e) => {
                    setWorkspaceFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none max-w-[180px]"
                >
                  <option value="all">All Workspaces</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-slate-500">
                Total Users: <strong className="text-slate-900 dark:text-white">{total}</strong>
              </div>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {error}
              </div>
            )}

            {/* Users Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">User</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Workspace</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Last Login</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                          <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                          <p>Loading user directory...</p>
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                          No users match the active filters.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => {
                        const statusLower = (u.status || "active").toLowerCase();
                        const isPending = statusLower === "pending";
                        const isActive = statusLower === "active";
                        const isBlocked = statusLower === "blocked";
                        const isRejected = statusLower === "rejected";

                        return (
                          <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                            {/* Email & Name */}
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {u.full_name || "—"}
                                </span>
                                {u.is_platform_admin && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-500 text-[11px] font-mono">
                                {u.email}
                              </div>
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3">
                              {isPending && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                                  PENDING
                                </span>
                              )}
                              {isActive && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  ACTIVE
                                </span>
                              )}
                              {isBlocked && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                  BLOCKED
                                </span>
                              )}
                              {isRejected && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                                  REJECTED
                                </span>
                              )}
                              {!isPending && !isActive && !isBlocked && !isRejected && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 uppercase">
                                  {u.status}
                                </span>
                              )}
                            </td>

                            {/* Workspace */}
                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                              {u.workspace_name && u.workspace_name !== "No workspace assigned" ? (
                                u.workspace_name
                              ) : (
                                <span className="text-slate-400 italic">No workspace</span>
                              )}
                            </td>

                            {/* Role */}
                            <td className="px-4 py-3">
                              {u.role ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    ["owner", "admin", "platform_admin"].includes(u.role.toLowerCase())
                                      ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                  }`}
                                >
                                  {u.role}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">No role</span>
                              )}
                            </td>

                            {/* Created At */}
                            <td className="px-4 py-3 text-slate-500 text-[11px]">
                              {new Date(u.created_at).toLocaleDateString()}
                            </td>

                            {/* Last Login */}
                            <td className="px-4 py-3 text-slate-500 text-[11px]">
                              {u.last_login_at ? (
                                new Date(u.last_login_at).toLocaleDateString()
                              ) : (
                                <span className="text-slate-400 italic">Never</span>
                              )}
                            </td>

                            {/* Action Buttons */}
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {isPending ? (
                                  <>
                                    <button
                                      onClick={() => {
                                        setApproveUserTarget(u);
                                        setApproveRole("member");
                                        setApproveError(null);
                                      }}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => setRejectUserTarget(u)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 transition-colors"
                                    >
                                      Reject
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => openEditModal(u)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950 dark:hover:text-purple-300 transition-colors"
                                    >
                                      Edit
                                    </button>

                                    {isActive && (
                                      <button
                                        onClick={() => setBlockUserTarget(u)}
                                        className="px-2 py-1 text-xs font-semibold rounded-lg border border-rose-300 hover:bg-rose-50 text-rose-700 dark:border-rose-800 dark:hover:bg-rose-950/40 dark:text-rose-400 transition-colors"
                                      >
                                        Block
                                      </button>
                                    )}

                                    {isBlocked && (
                                      <button
                                        onClick={() => setUnblockUserTarget(u)}
                                        className="px-2 py-1 text-xs font-semibold rounded-lg border border-emerald-300 hover:bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:hover:bg-emerald-950/40 dark:text-emerald-400 transition-colors"
                                      >
                                        Unblock
                                      </button>
                                    )}

                                    {isRejected && (
                                      <button
                                        onClick={() => {
                                          setApproveUserTarget(u);
                                          setApproveRole("member");
                                          setApproveError(null);
                                        }}
                                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
                                      >
                                        Approve
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
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
        )}

        {/* TAB 2: AUTHORIZED EMAILS (ALLOWLIST) */}
        {activeTab === "allowlist" && (
          <div className="space-y-6">
            <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-sm">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Direct Email Pre-Approvals
                </h3>
                <p className="text-xs text-slate-500">
                  Pre-authorize trusted clients or team members. When they register with this email, their workspace and role will be automatically configured.
                </p>
              </div>
              <button
                onClick={() => {
                  setNewAllowEmail("");
                  setNewAllowNotes("");
                  setAllowlistError(null);
                  setShowAddAllowlistModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5"
              >
                <span>+ Add Authorized Email</span>
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Email Address</th>
                      <th className="px-4 py-3">Pre-Assigned Workspace</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Auto-Approve</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {allowlistLoading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                          <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                          <p>Loading authorized emails...</p>
                        </td>
                      </tr>
                    ) : authorizedEmails.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                          No authorized emails configured. Click &quot;Add Authorized Email&quot; to pre-authorize trusted users.
                        </td>
                      </tr>
                    ) : (
                      authorizedEmails.map((item) => {
                        const targetWs = workspaces.find((w) => w.id === item.workspace_id);
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="px-5 py-3 font-mono font-medium text-slate-900 dark:text-white">
                              {item.email}
                            </td>
                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                              {targetWs ? targetWs.name : item.workspace_id || "Auto-assign on signup"}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                {item.role}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {item.auto_approve ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  YES (Immediate Access)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                  NO (Pending Confirmation)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-500 text-[11px]">
                              {item.notes || "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-500 text-[11px]">
                              {new Date(item.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleDeleteAllowlist(item.id)}
                                className="px-2 py-1 text-xs font-semibold rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: WORKSPACE ALLOWED DOMAINS */}
        {activeTab === "domains" && (
          <div className="space-y-6">
            <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Workspace Domain-Based Auto-Assignment
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Configure corporate email domains (e.g. <code>acme.com</code>). Verified users signing up with matching corporate email addresses will automatically be assigned to the corresponding workspace with initial member access.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Workspace Name</th>
                    <th className="px-4 py-3">Allowed Email Domain</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {workspaces.map((ws) => (
                    <tr key={ws.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                        {ws.name}
                      </td>
                      <td className="px-4 py-3">
                        {ws.allowed_email_domain ? (
                          <span className="font-mono text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 font-semibold">
                            @{ws.allowed_email_domain}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No domain configured (manual approval only)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {ws.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setDomainModalWorkspace(ws);
                            setEditDomainValue(ws.allowed_email_domain || "");
                            setDomainError(null);
                          }}
                          className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-700"
                        >
                          Configure Domain
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: APPROVE USER DIALOG */}
      {approveUserTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Approve User & Assign Workspace
              </h3>
              <button
                onClick={() => setApproveUserTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <p><strong>Candidate Email:</strong> {approveUserTarget.email}</p>
              <p><strong>Full Name:</strong> {approveUserTarget.full_name || "—"}</p>
              <p><strong>Current Status:</strong> <span className="font-bold uppercase text-amber-600">{approveUserTarget.status}</span></p>
            </div>

            {approveError && (
              <div className="p-2.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold">
                {approveError}
              </div>
            )}

            <form onSubmit={handleApproveSubmit} className="space-y-4 text-xs">
              {/* Workspace Mode Selection */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Target Tenant Workspace
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setApproveMode("existing")}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      approveMode === "existing"
                        ? "border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Select Existing Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => setApproveMode("new")}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                      approveMode === "new"
                        ? "border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Create New Workspace
                  </button>
                </div>

                {approveMode === "existing" ? (
                  <div>
                    <select
                      value={selectedWorkspaceId}
                      onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                      required
                    >
                      <option value="">-- Choose a Workspace --</option>
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={ws.id}>
                          {ws.name} ({ws.id.slice(0, 8)}...)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="e.g. Acme Corporation"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Role Selection */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Workspace Membership Role
                </label>
                <select
                  value={approveRole}
                  onChange={(e) => setApproveRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="owner">OWNER (Full workspace administration)</option>
                  <option value="admin">ADMIN (Workspace management)</option>
                  <option value="member">MEMBER (Standard email campaign user)</option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 text-[11px] text-purple-900 dark:text-purple-300">
                Approving this account sets status to <strong>ACTIVE</strong>, assigns the selected workspace, and immediately enables the user to log in and access their dashboard.
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApproveUserTarget(null)}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approveSubmitting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {approveSubmitting ? "Approving..." : "Approve & Grant Access"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: REJECT CONFIRMATION */}
      {rejectUserTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Reject Access Request
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Are you sure you want to reject access for <strong>{rejectUserTarget.email}</strong>?
            </p>
            <p className="text-[11px] text-slate-500">
              Their status will be set to <strong>REJECTED</strong> and they will be barred from accessing the application.
            </p>
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectUserTarget(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectSubmitting}
                onClick={handleRejectSubmit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {rejectSubmitting ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: BLOCK USER CONFIRMATION */}
      {blockUserTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-rose-600">
              Revoke Access & Block User
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Are you sure you want to block <strong>{blockUserTarget.email}</strong>?
            </p>
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px] leading-relaxed">
              <strong>Session Revocation:</strong> All active sessions will be immediately invalidated and invalidated from the server session cache. Any further API requests will be rejected with 403 Forbidden.
            </div>
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBlockUserTarget(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={blockSubmitting}
                onClick={handleBlockSubmit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {blockSubmitting ? "Revoking..." : "Block User Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: UNBLOCK USER CONFIRMATION */}
      {unblockUserTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-emerald-600">
              Unblock User Account
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Restore application access for <strong>{unblockUserTarget.email}</strong>?
            </p>
            <p className="text-[11px] text-slate-500">
              Their status will return to <strong>ACTIVE</strong> and they will be able to log in to their assigned workspace again.
            </p>
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnblockUserTarget(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unblockSubmitting}
                onClick={handleUnblockSubmit}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {unblockSubmitting ? "Restoring..." : "Restore Access"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: EDIT USER MODAL */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Edit User Workspace & Role
              </h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <p><strong>Email:</strong> {selectedUser.email}</p>
              <p><strong>Current Workspace:</strong> {selectedUser.workspace_name}</p>
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
                  Account Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="active">Active (Access Allowed)</option>
                  <option value="pending">Pending (Awaiting Approval)</option>
                  <option value="blocked">Blocked (Revoked Session)</option>
                  <option value="rejected">Rejected</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Assigned Workspace
                </label>
                <select
                  value={editWorkspaceId}
                  onChange={(e) => setEditWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">-- No Workspace --</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Workspace Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveUser}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {saving ? "Updating..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: ADD AUTHORIZED EMAIL (ALLOWLIST) */}
      {showAddAllowlistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Add Authorized Email (Allowlist)
              </h3>
              <button
                onClick={() => setShowAddAllowlistModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {allowlistError && (
              <div className="p-2.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold">
                {allowlistError}
              </div>
            )}

            <form onSubmit={handleAddAllowlist} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="client@example.com"
                  value={newAllowEmail}
                  onChange={(e) => setNewAllowEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pre-Assigned Workspace (Optional)
                </label>
                <select
                  value={newAllowWorkspaceId}
                  onChange={(e) => setNewAllowWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">-- Auto-create / Select Later --</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Role
                </label>
                <select
                  value={newAllowRole}
                  onChange={(e) => setNewAllowRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="auto_approve_check"
                  type="checkbox"
                  checked={newAllowAutoApprove}
                  onChange={(e) => setNewAllowAutoApprove(e.target.checked)}
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="auto_approve_check" className="font-semibold text-slate-700 dark:text-slate-300">
                  Automatically approve and activate access upon registration
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Notes / Client Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Approved Enterprise Customer"
                  value={newAllowNotes}
                  onChange={(e) => setNewAllowNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddAllowlistModal(false)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={allowlistSubmitting}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {allowlistSubmitting ? "Adding..." : "Add to Allowlist"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: CONFIGURE WORKSPACE DOMAIN */}
      {domainModalWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Configure Allowed Email Domain
              </h3>
              <button
                onClick={() => setDomainModalWorkspace(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="text-xs bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <p><strong>Workspace:</strong> {domainModalWorkspace.name}</p>
            </div>

            {domainError && (
              <div className="p-2.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold">
                {domainError}
              </div>
            )}

            <form onSubmit={handleSaveDomain} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Allowed Email Domain (e.g. <code>company.com</code>)
                </label>
                <input
                  type="text"
                  placeholder="company.com (leave blank to disable)"
                  value={editDomainValue}
                  onChange={(e) => setEditDomainValue(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Only verified email addresses matching this domain will be auto-assigned to this workspace.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDomainModalWorkspace(null)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={domainSubmitting}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {domainSubmitting ? "Saving..." : "Save Domain"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
