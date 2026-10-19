import React, { Suspense } from "react";
import { connection } from "next/server";
import { deliverySafetyService } from "@/server/services/delivery-safety.service";

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

async function UnsubscribeContent({ searchParams }: UnsubscribePageProps) {
  await connection();
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 dark:bg-slate-950">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/50 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600 text-xl font-bold">
              !
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Missing Unsubscribe Token
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Please use the unsubscribe link provided at the bottom of the email you received.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const result = await deliverySafetyService.handleUnsubscribe(token);

  if (!result.success) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 dark:bg-slate-950">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/50 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600 text-xl font-bold">
              ✕
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Invalid or Expired Link
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {result.error || "This unsubscribe link is invalid, expired, or has been tampered with."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 dark:bg-slate-950">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600 text-xl font-bold">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Unsubscribed Successfully
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            You have been unsubscribed successfully.
          </p>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
            Recipient: <strong className="text-slate-700 dark:text-slate-200">{result.email}</strong>
            <p className="mt-1">You will no longer receive automated email campaigns from this sender.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center dark:bg-slate-950">
          <div className="text-sm text-slate-500 animate-pulse">Processing unsubscribe request...</div>
        </div>
      }
    >
      <UnsubscribeContent searchParams={searchParams} />
    </Suspense>
  );
}
