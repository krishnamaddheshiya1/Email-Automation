"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { ConversationFilterType } from "@/types/database";

interface InboxSidebarProps {
  currentFilter: ConversationFilterType;
  onSelectFilter: (filter: ConversationFilterType) => void;
  unreadCount: number;
  totalCount: number;
}

export function InboxSidebar({
  currentFilter,
  onSelectFilter,
  unreadCount,
  totalCount,
}: InboxSidebarProps) {
  const folders: Array<{
    id: ConversationFilterType;
    label: string;
    icon: React.ReactNode;
    count?: number;
    badgeVariant?: "blue" | "gray";
  }> = [
    {
      id: "all",
      label: "All Replies",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      ),
      count: totalCount,
    },
    {
      id: "unread",
      label: "Unread",
      icon: (
        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="6" />
        </svg>
      ),
      count: unreadCount,
      badgeVariant: "blue",
    },
    {
      id: "read",
      label: "Read",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      id: "campaign",
      label: "Campaign Replies",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      ),
    },
    {
      id: "attachments",
      label: "With Attachments",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      ),
    },
    {
      id: "unknown",
      label: "Unknown Senders",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="w-full lg:w-56 shrink-0 space-y-1">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Mailbox Folders
      </div>
      <nav className="space-y-0.5">
        {folders.map((f) => {
          const isActive = currentFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onSelectFilter(f.id)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-r-full transition-colors",
                isActive
                  ? "bg-blue-100 text-blue-900 font-semibold dark:bg-blue-950/70 dark:text-blue-200"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
              )}
            >
              <div className="flex items-center gap-2.5 truncate">
                <span className={cn("shrink-0", isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400")}>
                  {f.icon}
                </span>
                <span className="truncate">{f.label}</span>
              </div>
              {f.count !== undefined && f.count > 0 && (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                    f.badgeVariant === "blue" || isActive
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  )}
                >
                  {f.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
