"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InboxSidebar } from "./inbox-sidebar";
import { ConversationView } from "./conversation-view";
import {
  ConversationListItem,
  ConversationFilterType,
} from "@/types/database";

const emptyStarredIds: string[] = [];
let cachedStarredRaw: string | null = null;
let cachedStarredArray: string[] = emptyStarredIds;
const starListeners = new Set<() => void>();

function subscribeStars(listener: () => void) {
  starListeners.add(listener);
  return () => {
    starListeners.delete(listener);
  };
}

function getStarredSnapshot(): string[] {
  try {
    const raw = localStorage.getItem("inbox_starred_ids");
    if (raw !== cachedStarredRaw) {
      cachedStarredRaw = raw;
      cachedStarredArray = raw ? JSON.parse(raw) : emptyStarredIds;
    }
    return cachedStarredArray;
  } catch {
    return emptyStarredIds;
  }
}

function getStarredServerSnapshot(): string[] {
  return emptyStarredIds;
}

function toggleStarItem(id: string) {
  const current = getStarredSnapshot();
  const next = current.includes(id) ? current.filter((i) => i !== id) : [...current, id];
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem("inbox_starred_ids", raw);
    cachedStarredRaw = raw;
    cachedStarredArray = next;
  } catch {}
  starListeners.forEach((l) => l());
}

export function InboxClient() {
  const searchParams = useSearchParams();
  const urlFilter = searchParams.get("filter") as ConversationFilterType;
  const initialFilter: ConversationFilterType =
    urlFilter && ["all", "unread", "read", "attachments", "campaign", "unknown"].includes(urlFilter)
      ? urlFilter
      : "all";
  const initialId = searchParams.get("id") || null;
  const initialSearch = searchParams.get("search") || searchParams.get("q") || "";

  const [filter, setFilter] = useState<ConversationFilterType>(initialFilter);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialId);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Bulk actions selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Simulate Customer Reply Modal State
  const [isSimulateModalOpen, setIsSimulateModalOpen] = useState(false);
  const [simFromEmail, setSimFromEmail] = useState("krishnatktrtktr@gmail.com");
  const [simFromName, setSimFromName] = useState("Krishna Maddheshiya");
  const [simSubject, setSimSubject] = useState("Re: demmo - Interested in your service");
  const [simBody, setSimBody] = useState("Hi! Thanks for the email. I am very interested and would like to learn more details.");
  const [simSending, setSimSending] = useState(false);
  const [simStatusMsg, setSimStatusMsg] = useState<string | null>(null);

  const handleSendSimulatedReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimSending(true);
    setSimStatusMsg(null);
    try {
      const res = await fetch("/api/conversations/simulate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: simFromEmail,
          from_name: simFromName,
          subject: simSubject,
          body: simBody,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSimStatusMsg("Reply received! Conversation updated.");
        setTimeout(() => {
          setIsSimulateModalOpen(false);
          setSimStatusMsg(null);
        }, 1200);
        loadConversations();
      } else {
        setSimStatusMsg(json.error || "Failed to simulate reply.");
      }
    } catch {
      setSimStatusMsg("Network error sending reply.");
    } finally {
      setSimSending(false);
    }
  };

  // Starred state (hydrated safely via useSyncExternalStore to avoid server/client attribute mismatch)
  const starredIds = useSyncExternalStore(
    subscribeStars,
    getStarredSnapshot,
    getStarredServerSnapshot
  );

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStarItem(id);
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync searchParams URL changes
  useEffect(() => {
    let ignore = false;
    async function syncUrl() {
      const f = searchParams.get("filter") as ConversationFilterType;
      const id = searchParams.get("id");
      const q = searchParams.get("search") || searchParams.get("q");
      if (!ignore) {
        if (f && ["all", "unread", "read", "attachments", "campaign", "unknown"].includes(f)) {
          setFilter(f);
        }
        if (id) {
          setSelectedConversationId(id);
        }
        if (q !== null && q !== undefined) {
          setSearchQuery(q);
        }
      }
    }
    syncUrl();
    return () => {
      ignore = true;
    };
  }, [searchParams]);

  useEffect(() => {
    let ignore = false;
    async function fetchConversations(isSilent = false) {
      if (!isSilent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter) params.set("filter", filter);
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

        const res = await fetch(`/api/conversations?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();

        if (!ignore) {
          if (res.ok && json.success) {
            setConversations(json.data.conversations || []);
            setTotal(json.data.total || 0);
            setUnreadTotal(json.data.unread_total || 0);
            setError(null);
          } else if (!isSilent) {
            setError(json.error || "Failed to load replies.");
          }
        }
      } catch {
        if (!ignore && !isSilent) {
          setError("Network error fetching conversations.");
        }
      } finally {
        if (!ignore && !isSilent) {
          setLoading(false);
        }
      }
    }

    fetchConversations(false);

    // Live auto-polling every 6 seconds so incoming customer replies appear live!
    const pollInterval = setInterval(() => {
      fetchConversations(true);
    }, 6000);

    return () => {
      ignore = true;
      clearInterval(pollInterval);
    };
  }, [filter, debouncedSearch, refreshTrigger]);

  const loadConversations = () => {
    setLoading(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(conversations.map((c) => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBulkMarkRead = async () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      try {
        await fetch(`/api/conversations/${id}/read`, { method: "POST" });
      } catch {}
    }
    setSelectedIds([]);
    loadConversations();
  };

  const handleBulkMarkUnread = async () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      try {
        await fetch(`/api/conversations/${id}/unread`, { method: "POST" });
      } catch {}
    }
    setSelectedIds([]);
    loadConversations();
  };

  const formatListDate = (dateStr?: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm dark:bg-slate-900 dark:border-slate-800 overflow-hidden">
      {/* Top Gmail-Style Search Bar */}
      <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-2xl">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in replies (contact name, email, subject, campaign)..."
              className="w-full pl-10 pr-10 py-2 bg-white rounded-full border border-slate-200 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-inner dark:bg-slate-850 dark:border-slate-700 dark:text-slate-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Auto-Update</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadConversations}
              disabled={loading}
              className="text-xs h-9 gap-1.5"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsSimulateModalOpen(true)}
              className="text-xs h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              title="Simulate receiving an inbound reply from a customer"
            >
              <span>⚡</span>
              <span>Test Customer Reply</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Mailbox Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-w-0">
        {/* Left Mailbox Folders Sidebar */}
        <div className="p-3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/20">
          <InboxSidebar
            currentFilter={filter}
            onSelectFilter={(f) => {
              setFilter(f);
              setSelectedConversationId(null);
            }}
            unreadCount={unreadTotal}
            totalCount={total}
          />
        </div>

        {/* Center / Right Content Pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedConversationId ? (
            <ConversationView
              conversationId={selectedConversationId}
              onBack={() => setSelectedConversationId(null)}
              onRefresh={loadConversations}
            />
          ) : (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Action Toolbar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
                <div className="flex items-center gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={conversations.length > 0 && selectedIds.length === conversations.length}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  {selectedIds.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkMarkRead}
                        className="text-[11px] h-7 px-2"
                      >
                        Mark Read
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkMarkUnread}
                        className="text-[11px] h-7 px-2"
                      >
                        Mark Unread
                      </Button>
                      <span className="text-[11px] text-slate-400">
                        ({selectedIds.length} selected)
                      </span>
                    </div>
                  )}
                </div>

                <div className="text-xs text-slate-400 font-medium">
                  {conversations.length} of {total} replies
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-50 text-red-700 text-xs border-b border-red-200 dark:bg-red-950/50 dark:border-red-900 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Conversations List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {loading && conversations.length === 0 ? (
                  <div className="p-6 space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="h-12 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800"
                      />
                    ))}
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="py-16 text-center space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      No replies found
                    </div>
                    <div className="text-xs text-slate-400 max-w-sm mx-auto">
                      {searchQuery
                        ? "No conversations matched your search query."
                        : filter !== "all"
                        ? `No conversations in folder "${filter}".`
                        : "When customers reply to your campaign emails, their replies will appear here in real-time."}
                    </div>
                  </div>
                ) : (
                  conversations.map((convo) => {
                    const isSelected = selectedIds.includes(convo.id);
                    const isUnread = convo.is_unread;

                    return (
                      <div
                        key={convo.id}
                        onClick={() => setSelectedConversationId(convo.id)}
                        className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                          isUnread
                            ? "bg-white font-bold text-slate-900 border-l-4 border-l-blue-600 shadow-xs dark:bg-slate-900 dark:text-white"
                            : "bg-slate-50/50 text-slate-600 hover:bg-slate-100/70 dark:bg-slate-950/30 dark:text-slate-400 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        {/* Checkbox */}
                        <div
                          onClick={(e) => toggleSelectOne(convo.id, e)}
                          className="shrink-0 flex items-center"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                          />
                        </div>

                        {/* Star Button */}
                        <button
                          type="button"
                          onClick={(e) => toggleStar(convo.id, e)}
                          className="shrink-0 p-1 text-slate-300 hover:text-amber-400 dark:text-slate-600 transition-colors"
                          title={starredIds.includes(convo.id) ? "Unstar" : "Star"}
                        >
                          <svg
                            className={`w-4 h-4 ${
                              starredIds.includes(convo.id)
                                ? "fill-amber-400 text-amber-500"
                                : "fill-none text-current"
                            }`}
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>

                        {/* Unread Visual Indicator */}
                        <div className="shrink-0 w-2.5 flex items-center justify-center">
                          {isUnread && (
                            <span
                              className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-sm"
                              title="Unread reply"
                            />
                          )}
                        </div>

                        {/* Contact Name & Email */}
                        <div className="w-36 sm:w-48 shrink-0 truncate">
                          <span
                            className={`text-xs sm:text-sm truncate block ${
                              isUnread ? "font-bold text-slate-900 dark:text-white" : "font-medium text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {convo.contact_name}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate block">
                            {convo.contact_email}
                          </span>
                        </div>

                        {/* Subject & Snippet Preview */}
                        <div className="flex-1 min-w-0 flex items-center gap-2 truncate">
                          <span
                            className={`text-xs sm:text-sm truncate ${
                              isUnread ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {convo.subject}
                          </span>
                          <span className="text-xs text-slate-400 dark:text-slate-500 truncate hidden md:inline">
                            - {convo.snippet}
                          </span>

                          {/* Campaign Tag */}
                          {convo.campaign_name && (
                            <span className="shrink-0 ml-auto hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/50 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                              Campaign: {convo.campaign_name}
                            </span>
                          )}
                        </div>

                        {/* Attachment indicator */}
                        <div className="shrink-0 text-slate-400 w-5 text-center">
                          {convo.has_attachments && (
                            <span title="Has attachments">📎</span>
                          )}
                        </div>

                        {/* Date/Time */}
                        <div
                          className={`shrink-0 text-right text-[11px] w-16 sm:w-20 ${
                            isUnread ? "font-bold text-blue-600 dark:text-blue-400" : "text-slate-400"
                          }`}
                        >
                          {formatListDate(convo.last_message_at || convo.created_at)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Test Inbound Customer Reply Modal */}
      {isSimulateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Test Inbound Customer Reply
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSimulateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Simulates a real customer sending an email reply to your inbox. This will link to the conversation thread, stop any active campaign sequence for this contact, increment the Replies metric on the Dashboard, and update contact status to <strong>replied</strong>.
            </p>

            <form onSubmit={handleSendSimulatedReply} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Customer Email Address
                </label>
                <input
                  type="email"
                  value={simFromEmail}
                  onChange={(e) => setSimFromEmail(e.target.value)}
                  required
                  placeholder="customer@example.com"
                  className="w-full text-xs px-3 py-2 border rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={simFromName}
                  onChange={(e) => setSimFromName(e.target.value)}
                  placeholder="Customer Full Name"
                  className="w-full text-xs px-3 py-2 border rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Subject
                </label>
                <input
                  type="text"
                  value={simSubject}
                  onChange={(e) => setSimSubject(e.target.value)}
                  required
                  placeholder="Re: Subject"
                  className="w-full text-xs px-3 py-2 border rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reply Message Body
                </label>
                <textarea
                  value={simBody}
                  onChange={(e) => setSimBody(e.target.value)}
                  required
                  rows={3}
                  placeholder="Write the customer's reply..."
                  className="w-full text-xs px-3 py-2 border rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {simStatusMsg && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-medium ${
                    simStatusMsg.includes("received")
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800"
                  }`}
                >
                  {simStatusMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSimulateModalOpen(false)}
                  disabled={simSending}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={simSending}
                  className="text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {simSending ? "Receiving Reply..." : "Send Test Reply"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
