"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface AdminNavItem {
  title: string;
  href: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: string;
}

export function AdminSidebar({
  adminEmail,
  adminRole,
}: {
  adminEmail: string;
  adminRole: string;
}) {
  const pathname = usePathname();

  const navItems: AdminNavItem[] = [
    {
      title: "Overview",
      href: "/krishna/dashboard",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      ),
    },
    {
      title: "Users",
      href: "/krishna/users",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      title: "Workspaces",
      href: "/krishna/workspaces",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 21h18M3 7v14M21 7v14M6 11h2M6 15h2M11 11h2M11 15h2M16 11h2M16 15h2M9 3h6v4H9z" />
        </svg>
      ),
    },
    {
      title: "Campaigns",
      href: "/krishna/campaigns",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m3 11 18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      ),
    },
    {
      title: "Email Providers",
      href: "/krishna/email-providers",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      ),
    },
    {
      title: "System Health",
      href: "/krishna/system",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
    {
      title: "Audit Logs",
      href: "/krishna/audit-logs",
      icon: (active) => (
        <svg className={cn("w-5 h-5", active ? "text-purple-600 dark:text-purple-400" : "text-slate-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="w-64 shrink-0 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col min-h-screen">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between" suppressHydrationWarning>
        <div className="flex items-center gap-3" suppressHydrationWarning>
          <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white shadow-md shadow-purple-600/30">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div suppressHydrationWarning>
            <h2
              className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5"
              suppressHydrationWarning
            >
              Developer Console
              <span
                className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded"
                suppressHydrationWarning
              >
                DEV
              </span>
            </h2>
            <p className="text-[11px] text-slate-400" suppressHydrationWarning>Platform Management</p>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <div className="p-3 space-y-1 flex-1">
        <div className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Navigation
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === "/krishna/dashboard" && (pathname === "/krishna" || pathname === "/krishna/dashboard"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
                isActive
                  ? "bg-purple-600 text-white shadow-sm shadow-purple-600/30"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <span>{item.icon(isActive)}</span>
              <span className="flex-1 truncate">{item.title}</span>
              {item.badge && (
                <span className="text-[10px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded-full font-bold">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Admin user info & exit button */}
      <div className="p-3 border-t border-slate-800 space-y-3" suppressHydrationWarning>
        <div className="px-3 py-2 bg-slate-800/60 rounded-xl text-xs" suppressHydrationWarning>
          <div className="flex items-center gap-2 mb-1" suppressHydrationWarning>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-white truncate" suppressHydrationWarning>{adminEmail}</span>
          </div>
          <p className="text-[11px] text-slate-400 capitalize" suppressHydrationWarning>Role: {adminRole}</p>
        </div>

        <Link
          href="/dashboard"
          className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Exit to Platform
        </Link>
      </div>
    </aside>
  );
}
