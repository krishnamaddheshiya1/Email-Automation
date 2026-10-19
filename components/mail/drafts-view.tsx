"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface DraftItem {
  id: string;
  type: "campaign" | "template";
  title: string;
  subject?: string;
  updated_at: string;
  href: string;
}

export function DraftsView() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDrafts(data.drafts || []);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/drafts");
        if (res.ok) {
          const data = await res.json();
          if (!ignore && data.success) {
            setDrafts(data.drafts || []);
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
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-800 shadow-sm overflow-hidden min-h-[500px]">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span>Drafts</span>
          <span className="text-xs font-normal text-slate-500">
            ({drafts.length} items)
          </span>
        </h2>
        <button
          type="button"
          onClick={fetchDrafts}
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

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Loading drafts...
          </div>
        ) : drafts.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-400">
            No drafts found. Incomplete campaigns or templates saved as drafts will appear here.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0 ${
                      d.type === "campaign"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    }`}
                  >
                    {d.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate block">
                      {d.title}
                    </span>
                    {d.subject && (
                      <span className="text-[11px] text-slate-500 truncate block">
                        Subject: {d.subject}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-slate-400">
                    Updated {new Date(d.updated_at).toLocaleDateString()}
                  </span>
                  <Link
                    href={d.href}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
                  >
                    Resume Editing
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
