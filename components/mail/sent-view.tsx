"use client";

import React, { useState, useEffect, useCallback } from "react";

interface SentEmailItem {
  id: string;
  to_email: string;
  from_email: string;
  recipient_name: string;
  subject: string;
  body: string;
  snippet: string;
  status: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  sent_at: string;
}

export function SentView() {
  const [messages, setMessages] = useState<SentEmailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedMessage, setSelectedMessage] = useState<SentEmailItem | null>(null);

  const fetchSent = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
      const res = await fetch(`/api/email/sent?page=${page}&limit=25${q}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMessages(data.messages || []);
          setTotal(data.total || 0);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
        const res = await fetch(`/api/email/sent?page=${page}&limit=25${q}`);
        if (res.ok) {
          const data = await res.json();
          if (!ignore && data.success) {
            setMessages(data.messages || []);
            setTotal(data.total || 0);
          }
        }
      } catch {} finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [page, search]);

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-800 shadow-sm overflow-hidden min-h-[600px]">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Sent Messages</span>
            <span className="text-xs font-normal text-slate-500">
              ({total} emails)
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search sent mail..."
              className="h-9 w-48 sm:w-64 pl-8 pr-3 rounded-lg bg-slate-100 text-xs text-slate-800 placeholder:text-slate-400 outline-none border border-transparent focus:border-blue-500 dark:bg-slate-800 dark:text-slate-100"
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-3 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchSent}
            disabled={loading}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages List Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Loading sent emails...
          </div>
        ) : messages.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-400">
            No sent messages found. Dispatched campaign emails and direct messages will appear here.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {messages.map((msg) => (
              <div
                key={msg.id}
                onClick={() => setSelectedMessage(msg)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
              >
                {/* Status indicator dot */}
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    msg.status === "DELIVERED"
                      ? "bg-emerald-500"
                      : msg.status === "BOUNCED"
                      ? "bg-rose-500"
                      : "bg-blue-500"
                  }`}
                  title={msg.status}
                />

                {/* Recipient */}
                <div className="w-40 sm:w-48 truncate shrink-0">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    To: {msg.recipient_name}
                  </span>
                  <p className="text-[10px] text-slate-400 truncate">{msg.to_email}</p>
                </div>

                {/* Subject & snippet */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                    {msg.subject}
                  </span>
                  <span className="text-xs text-slate-400 truncate hidden md:inline">
                    — {msg.snippet}
                  </span>
                </div>

                {/* Campaign Tag */}
                {msg.campaign_name && (
                  <span className="hidden lg:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 shrink-0 font-medium truncate max-w-[150px]">
                    {msg.campaign_name}
                  </span>
                )}

                {/* Status Badge */}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0 ${
                    msg.status === "DELIVERED"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : msg.status === "BOUNCED"
                      ? "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                  }`}
                >
                  {msg.status}
                </span>

                {/* Timestamp */}
                <span className="text-[11px] text-slate-400 shrink-0 text-right w-16">
                  {new Date(msg.sent_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email Detail Dialog */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="min-w-0 flex-1 pr-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {selectedMessage.subject}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  To: <span className="font-medium text-slate-700 dark:text-slate-300">{selectedMessage.to_email}</span>
                  {selectedMessage.campaign_name && (
                    <span className="ml-2 font-medium text-blue-600">
                      • Campaign: {selectedMessage.campaign_name}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                <span>From: {selectedMessage.from_email}</span>
                <span>Sent: {new Date(selectedMessage.sent_at).toLocaleString()}</span>
              </div>

              <div
                className="prose prose-sm max-w-none dark:prose-invert text-slate-800 dark:text-slate-200"
                dangerouslySetInnerHTML={{ __html: selectedMessage.body }}
              />
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
