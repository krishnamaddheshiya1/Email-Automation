import React from "react";
import { SidebarSkeleton } from "@/components/layout/sidebar";

export default function AnalyticsLoading() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <SidebarSkeleton />
      <main className="flex-1 space-y-6 min-w-0">
        {/* Top tenant skeleton bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Analytics Header */}
        <div className="space-y-1">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse" />
          <div className="h-4 w-72 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 dark:bg-slate-850 p-4 border border-slate-200 dark:border-slate-800 space-y-2 animate-pulse">
              <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
            </div>
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 rounded-xl bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-pulse">
            <div className="h-5 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-52 bg-slate-200/50 dark:bg-slate-800/50 rounded-lg" />
          </div>
          <div className="h-72 rounded-xl bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-pulse">
            <div className="h-5 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-52 bg-slate-200/50 dark:bg-slate-800/50 rounded-lg" />
          </div>
        </div>
      </main>
    </div>
  );
}
