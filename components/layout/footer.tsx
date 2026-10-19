"use client";

import React from "react";
import Link from "next/link";
import { siteConfig } from "@/lib/config/site";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex flex-col items-center gap-1 md:items-start">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {siteConfig.name}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Production-oriented foundation for email campaign automation and workflow management.
            </p>
          </div>

          <div className="flex items-center gap-6 text-xs text-slate-500 dark:text-slate-400">
            <Link href="/" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/dashboard" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/settings" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Settings
            </Link>
            <Link
              href="/api/health"
              target="_blank"
              className="hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              /api/health
            </Link>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6 text-center text-xs text-slate-400 dark:border-slate-800/60 dark:text-slate-500">
          <p>© 2026 {siteConfig.name}. Phase 1 Project Foundation.</p>
        </div>
      </div>
    </footer>
  );
}
