import React from "react";
import { SidebarSkeleton } from "@/components/layout/sidebar";

export default function DashboardLoading() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <SidebarSkeleton />
      <main className="flex-1 space-y-6 min-w-0">
        {/* Top tenant skeleton bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Dashboard greeting & metrics cards */}
        <div className="space-y-4">
          <div className="h-7 w-48 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-slate-100 dark:bg-slate-850 p-4 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                <div className="h-7 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions & Recent Campaigns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 rounded-xl bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex justify-between items-center">
              <div className="h-5 w-36 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-slate-200/60 dark:bg-slate-800/60 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>

          <div className="h-72 rounded-xl bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="h-5 w-28 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-slate-200/60 dark:bg-slate-800/60 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
