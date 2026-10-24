"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface LimitExceededModalData {
  limitType: "daily" | "monthly";
  dailySent?: number;
  dailyRemaining?: number;
  monthlySent?: number;
  monthlyRemaining?: number;
  attemptedCount?: number;
}

export interface SendingLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  data?: LimitExceededModalData | null;
  limitType?: "daily" | "monthly";
  dailySent?: number;
  dailyRemaining?: number;
  monthlySent?: number;
  monthlyRemaining?: number;
  attemptedCount?: number;
}

export function SendingLimitModal({
  isOpen,
  onClose,
  data,
  limitType: propLimitType,
  dailySent: propDailySent,
  dailyRemaining: propDailyRemaining,
  monthlySent: propMonthlySent,
  monthlyRemaining: propMonthlyRemaining,
  attemptedCount: propAttemptedCount,
}: SendingLimitModalProps) {
  const limitType = data?.limitType ?? propLimitType ?? "daily";
  const dailySent = data?.dailySent ?? propDailySent ?? 0;
  const dailyRemaining = data?.dailyRemaining ?? propDailyRemaining ?? 0;
  const monthlySent = data?.monthlySent ?? propMonthlySent ?? 0;
  const monthlyRemaining = data?.monthlyRemaining ?? propMonthlyRemaining ?? 0;
  const attemptedCount = data?.attemptedCount ?? propAttemptedCount ?? 0;
  const isDaily = limitType === "daily";
  const title = isDaily ? "Daily Sending Limit Reached" : "Monthly Sending Limit Reached";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="max-w-md border-amber-200 dark:border-amber-900/50"
    >
      <div className="space-y-4">
        {/* Warning Icon and Header */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0 font-bold text-base text-amber-700 dark:text-amber-300">
            ⚠
          </div>
          <div className="text-xs leading-relaxed">
            <p className="font-semibold text-sm mb-1 text-amber-900 dark:text-amber-100">
              {isDaily
                ? "You can send a maximum of 1,500 emails per day."
                : "You can send a maximum of 50,000 emails per month."}
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              This is a hard platform sending limit enforced across all campaigns in your workspace.
            </p>
          </div>
        </div>

        {/* Quota Breakdown Table */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3.5 space-y-2 text-xs">
          {isDaily ? (
            <>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Emails sent today:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {dailySent.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Remaining today:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {dailyRemaining.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500">You attempted to send:</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  {attemptedCount.toLocaleString()}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Emails sent this month:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {monthlySent.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Remaining this month:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {monthlyRemaining.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500">You attempted to send:</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  {attemptedCount.toLocaleString()}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Resolution instruction */}
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {isDaily ? (
            <>
              Please reduce the number of contacts to{" "}
              <strong className="text-slate-800 dark:text-slate-200 font-semibold">
                {dailyRemaining.toLocaleString()}
              </strong>{" "}
              or try again after the daily limit resets.
            </>
          ) : (
            <>
              Your monthly sending limit has been reached. Please wait until your monthly limit
              resets on the 1st of next month.
            </>
          )}
        </p>

        {/* Action Button: Cancel */}
        <div className="pt-2 flex justify-end border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="px-5 text-xs font-semibold"
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
