import React from "react";
import { SidebarSkeleton } from "@/components/layout/sidebar";

export default function CampaignDetailLoading() {
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
          </div>
        </div>

        {/* Campaign Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse" />
              <div className="h-5 w-16 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
            </div>
            <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Tabs Skeleton */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 pb-2">
          {["Sequence Steps", "Enrolled Contacts", "Analytics & Events", "Safety Checklist", "Settings"].map((tab) => (
            <div key={tab} className="h-5 w-28 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          ))}
        </div>

        {/* Campaign Sequence Steps & Checklist Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[1, 2, 3].map((step) => (
              <div key={step} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="h-5 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
                <div className="h-10 bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
                <div className="h-20 bg-slate-100 dark:bg-slate-800/60 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="h-5 w-36 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-8 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
