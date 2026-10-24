"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";

interface ProviderItem {
  id: string;
  business_id: string;
  workspace_name: string;
  provider: string;
  status: string;
  is_configured: boolean;
  masked_key: string;
  sender_identities_count: number;
  created_at: string;
}

export default function AdminEmailProvidersPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProviders() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/admin/email-providers");
        if (!res.ok) {
          throw new Error("Failed to load email providers.");
        }
        const data = await res.json();
        if (data.success) {
          setProviders(data.providers || []);
        } else {
          throw new Error(data.error || "Failed to load providers");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading email providers");
      } finally {
        setLoading(false);
      }
    }
    loadProviders();
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="Email Providers & Deliverability Config"
        subtitle="Cross-tenant email integration status and credential hygiene"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Security Alert Banner */}
        <div className="p-4 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl flex items-start gap-3">
          <svg className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div className="text-xs text-purple-900 dark:text-purple-200">
            <strong className="block mb-0.5 font-bold">Credential Protection Standard</strong>
            <span>
              All email provider API credentials are cryptographically protected at rest and masked in memory. Raw secrets are never transmitted to or displayed in the browser.
            </span>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Providers Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Workspace</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Configuration Status</th>
                  <th className="px-4 py-3">Masked Secret</th>
                  <th className="px-4 py-3 text-center">Verified Sender Identities</th>
                  <th className="px-4 py-3">Connected At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      <div className="inline-block w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
                      <p>Loading email provider status...</p>
                    </td>
                  </tr>
                ) : providers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      No custom email provider configurations discovered.
                    </td>
                  </tr>
                ) : (
                  providers.map((p) => {
                    const isConfigured = p.is_configured;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {p.workspace_name}
                          </div>
                          <div className="text-slate-400 text-[10px] font-mono">
                            Tenant: {p.business_id}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                          {p.provider}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isConfigured
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {isConfigured ? "Ready" : "Pending Key"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400 text-[11px]">
                          {p.masked_key}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700 dark:text-slate-300">
                          {p.sender_identities_count}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
