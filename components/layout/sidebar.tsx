"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useMailWorkspace } from "./mail-workspace-context";

interface NavItemDef {
  title: string;
  href: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: number | string;
}

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, openCompose, unreadInbox } = useMailWorkspace();

  const mailItems: NavItemDef[] = [
    {
      title: "Inbox",
      href: "/inbox",
      badge: unreadInbox > 0 ? unreadInbox : undefined,
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      ),
    },
    {
      title: "Replies",
      href: "/inbox?filter=all",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 17 4 12 9 7" />
          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
      ),
    },
    {
      title: "Starred",
      href: "/starred",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-amber-500 fill-amber-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      title: "Snoozed",
      href: "/snoozed",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      title: "Sent",
      href: "/sent",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      ),
    },
    {
      title: "Drafts",
      href: "/drafts",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      ),
    },
  ];

  const automationItems: NavItemDef[] = [
    {
      title: "Campaigns",
      href: "/campaigns",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m3 11 18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      ),
    },
    {
      title: "Contacts",
      href: "/contacts",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      title: "Templates",
      href: "/templates",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M7 7h10" />
          <path d="M7 12h10" />
          <path d="M7 17h6" />
        </svg>
      ),
    },
    {
      title: "Attachments",
      href: "/attachments",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      ),
    },
    {
      title: "Analytics",
      href: "/analytics",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" x2="18" y1="20" y2="10" />
          <line x1="12" x2="12" y1="20" y2="4" />
          <line x1="6" x2="6" y1="20" y2="14" />
        </svg>
      ),
    },
  ];

  const platformItems: NavItemDef[] = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      ),
    },
    {
      title: "Settings",
      href: "/settings",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
  ];

  return (
    <aside
      className={cn(
        "shrink-0 transition-all duration-200 select-none",
        sidebarCollapsed ? "w-16" : "w-60 lg:w-64",
        "flex flex-col py-3 px-2 gap-4"
      )}
    >
      {/* Compose Button */}
      <div className="px-1">
        <button
          type="button"
          onClick={() => openCompose()}
          className={cn(
            "flex items-center gap-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-md hover:shadow-lg transition-all text-slate-800 font-semibold dark:bg-slate-800 dark:border-slate-700 dark:text-white dark:hover:bg-slate-750",
            sidebarCollapsed
              ? "h-12 w-12 justify-center mx-auto p-0"
              : "h-12 px-5 w-full justify-start"
          )}
          title="Compose new email"
        >
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {!sidebarCollapsed && <span className="text-sm font-semibold tracking-wide">Compose</span>}
        </button>
      </div>

      {/* Navigation Groups */}
      <div className="space-y-4 flex-1">
        {/* Mail Section */}
        <div>
          {!sidebarCollapsed && (
            <h4 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Mail
            </h4>
          )}
          <nav className="space-y-0.5">
            {mailItems.map((item) => {
              const isActive =
                item.href === "/inbox"
                  ? pathname === "/inbox" && !pathname.includes("filter")
                  : pathname === item.href || (item.href.includes("filter") && pathname === "/inbox");
              return (
                <Link
                  key={item.title}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-r-full py-2 px-3 text-xs font-medium transition-colors gap-3 relative",
                    isActive
                      ? "bg-blue-100 text-blue-900 font-bold dark:bg-blue-950/70 dark:text-blue-200"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    sidebarCollapsed && "justify-center rounded-xl px-2"
                  )}
                  title={sidebarCollapsed ? item.title : undefined}
                >
                  <span className="shrink-0">{item.icon(isActive)}</span>
                  {!sidebarCollapsed && (
                    <span className="flex-1 truncate">{item.title}</span>
                  )}
                  {!sidebarCollapsed && item.badge !== undefined && (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Automation Section */}
        <div>
          {!sidebarCollapsed && (
            <h4 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Automation
            </h4>
          )}
          <nav className="space-y-0.5">
            {automationItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.title}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-r-full py-2 px-3 text-xs font-medium transition-colors gap-3 relative",
                    isActive
                      ? "bg-blue-100 text-blue-900 font-bold dark:bg-blue-950/70 dark:text-blue-200"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    sidebarCollapsed && "justify-center rounded-xl px-2"
                  )}
                  title={sidebarCollapsed ? item.title : undefined}
                >
                  <span className="shrink-0">{item.icon(isActive)}</span>
                  {!sidebarCollapsed && (
                    <span className="flex-1 truncate">{item.title}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Platform Section */}
        <div>
          {!sidebarCollapsed && (
            <h4 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Platform
            </h4>
          )}
          <nav className="space-y-0.5">
            {platformItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.title}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-r-full py-2 px-3 text-xs font-medium transition-colors gap-3 relative",
                    isActive
                      ? "bg-blue-100 text-blue-900 font-bold dark:bg-blue-950/70 dark:text-blue-200"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    sidebarCollapsed && "justify-center rounded-xl px-2"
                  )}
                  title={sidebarCollapsed ? item.title : undefined}
                >
                  <span className="shrink-0">{item.icon(isActive)}</span>
                  {!sidebarCollapsed && (
                    <span className="flex-1 truncate">{item.title}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Multi-tenant isolation badge at bottom of sidebar */}
      {!sidebarCollapsed && (
        <div className="px-3 py-2 mt-auto rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-[11px] text-slate-500">
          <p className="font-semibold text-slate-700 dark:text-slate-300">
            Secure Workspace
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Multi-Tenant Isolated Scope
          </p>
        </div>
      )}
    </aside>
  );
}
