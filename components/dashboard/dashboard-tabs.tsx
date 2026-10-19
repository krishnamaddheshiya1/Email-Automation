"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export function DashboardTabs() {
  const pathname = usePathname();

  const tabs = [
    { title: "Overview", href: "/dashboard" },
    { title: "Campaigns", href: "/dashboard/campaigns" },
    { title: "Follow-up Queues", href: "/dashboard/follow-ups" },
    { title: "Reply Handling", href: "/dashboard/replies" },
  ];

  return (
    <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-1 sm:space-x-4 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3.5 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              isActive
                ? "border-blue-600 text-blue-600 font-semibold dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {tab.title}
          </Link>
        );
      })}
    </div>
  );
}
