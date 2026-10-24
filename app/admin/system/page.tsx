"use client";

import React, { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/admin-header";

interface SystemHealthData {
  status: "healthy" | "degraded" | "unhealthy";
  database: {
    connected: boolean;
    latency_ms: number;
    table_counts: Record<string, number>;
  };
  environment: {
    node_version: string;
    uptime_seconds: number;
    memory_usage_mb: number;
    supabase_configured: boolean;
    resend_configured: boolean;
  };
}

export default function AdminSystemPage() {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function checkHealth() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/system");
      if (!res.ok) {
        throw new Error("Failed to check system health.");
      }
      const data = await res.json();
      if (data.success && data.health) {
        setHealth(data.health);
      } else {
        throw new Error(data.error || "System health check failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error checking system health");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const res = await fetch("/api/admin/system");
        if (!res.ok) {
          throw new Error("Failed to check system health.");
        }
        const data = await res.json();
        if (!ignore) {
          if (data.success && data.health) {
            setHealth(data.health);
          } else {
            throw new Error(data.error || "System health check failed");
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error checking system health");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <AdminHeader
        title="System Health & Infrastructure"
        subtitle="PostgreSQL database connectivity, schema metrics, and runtime diagnostic telemetry"
      />

      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`w-3.5 h-3.5 rounded-full ${
                health?.status === "healthy"
                  ? "bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse"
                  : "bg-rose-500 shadow-md shadow-rose-500/50"
              }`}
            />
            <span className="text-sm font-bold capitalize text-slate-900 dark:text-white">
              Status: {health?.status || "Checking..."}
            </span>
          </div>

          <button
            onClick={checkHealth}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Run Diagnostics Ping
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
            {error}
          </div>
        )}

        {health && (
          <>
            {/* Database & Latency Diagnostics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 font-semibold mb-1">PostgreSQL Connectivity</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${health.database.connected ? "bg-emerald-500" : "bg-rose-500"}`} />
                  <span className="text-lg font-bold text-slate-900 dark:text-white">
                    {health.database.connected ? "Connected" : "Disconnected"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Supabase Transaction Connection Pooler</p>
              </div>

              <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 font-semibold mb-1">Query Round-Trip Latency</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {health.database.latency_ms} <span className="text-sm font-normal text-slate-400">ms</span>
                </p>
                <p className="text-[11px] text-emerald-600 mt-2 font-medium">Healthy database response time</p>
              </div>

              <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 font-semibold mb-1">Node.js Runtime & Memory</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {health.environment.memory_usage_mb} <span className="text-sm font-normal text-slate-400">MB RSS</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-2">
                  Uptime: {Math.floor(health.environment.uptime_seconds / 60)} min ({health.environment.node_version})
                </p>
              </div>
            </div>

            {/* Live Database Schema Table Counts */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-4 flex items-center justify-between">
                <span>Database Table Volume</span>
                <span className="text-xs font-normal text-slate-400">Live PostgreSQL row counts</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {Object.entries(health.database.table_counts).map(([tableName, count]) => (
                  <div key={tableName} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <p className="text-[11px] font-mono text-slate-500 truncate" title={tableName}>
                      {tableName}
                    </p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                      {count.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Integration Environment Badges */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
                Core Integrations Verification
              </h3>
              <div className="flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                  <span className={`w-2 h-2 rounded-full ${health.environment.supabase_configured ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <span className="font-semibold">Supabase Auth & Storage:</span>
                  <span className="text-slate-500">{health.environment.supabase_configured ? "Configured" : "Missing URL"}</span>
                </div>

                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                  <span className={`w-2 h-2 rounded-full ${health.environment.resend_configured ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <span className="font-semibold">Resend Email Gateway:</span>
                  <span className="text-slate-500">{health.environment.resend_configured ? "Configured" : "Not Set"}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
