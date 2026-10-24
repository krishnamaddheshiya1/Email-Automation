"use client";

import React from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

export function AdminHeader({
  title,
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className="h-16 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 z-30" suppressHydrationWarning>
      <div suppressHydrationWarning>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight" suppressHydrationWarning>
          {title || "Platform Administration"}
        </h1>
        {subtitle && (
          <p className="text-xs text-slate-500 dark:text-slate-400" suppressHydrationWarning>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Environment Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>PostgreSQL Active</span>
        </div>

        {/* Security Isolation Indicator */}
        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
          <svg className="w-3.5 h-3.5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Server Role Protected</span>
        </div>

        {/* Quick App Link */}
        <Link
          href="/dashboard"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          Normal Workspace →
        </Link>

        {/* Sign Out */}
        <LogoutButton
          variant="outline"
          size="sm"
          className="text-xs text-rose-600 hover:text-rose-700"
        />
      </div>
    </header>
  );
}
