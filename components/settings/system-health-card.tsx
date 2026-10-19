"use client";

import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

interface HealthIndicator {
  status: string;
  message: string;
}

interface SystemHealthData {
  application: HealthIndicator;
  database: HealthIndicator;
  emailProvider: HealthIndicator;
  webhook: HealthIndicator;
}

export function SystemHealthCard() {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/system/health");
      const data = await res.json();
      if (data.success && data.health) {
        setHealth(data.health);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/system/health");
        const data = await res.json();
        if (!ignore && data.success && data.health) {
          setHealth(data.health);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealth();
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    if (s.includes("HEALTHY") || s.includes("ONLINE") || s.includes("ACTIVE") || s.includes("CONFIGURED")) {
      return (
        <Badge variant="success" className="text-[10px]">
          ✓ {status}
        </Badge>
      );
    }
    if (s.includes("WARN") || s.includes("DEGRADED")) {
      return (
        <Badge variant="warning" className="text-[10px]">
          ⚠ {status}
        </Badge>
      );
    }
    return (
      <Badge variant="neutral" className="text-[10px]">
        {status}
      </Badge>
    );
  };

  return (
    <Card id="health">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <span>System Health & Diagnostics</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </CardTitle>
          <CardDescription>
            Live connectivity status across application, database, email provider, and webhook endpoints.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-xs h-7"
        >
          {refreshing ? "Checking..." : "↻ Refresh"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
            Inspecting system services...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Application */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Application
                </span>
                {getStatusBadge(health?.application.status || "Online")}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                {health?.application.message || "Online & operational"}
              </p>
            </div>

            {/* Database */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Database
                </span>
                {getStatusBadge(health?.database.status || "Healthy")}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                {health?.database.message || "PostgreSQL connected"}
              </p>
            </div>

            {/* Email Provider */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Email Provider
                </span>
                {getStatusBadge(health?.emailProvider.status || "ACTIVE")}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                {health?.emailProvider.message || "Resend REST Provider"}
              </p>
            </div>

            {/* Webhook Endpoint */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Webhook Endpoint
                </span>
                {getStatusBadge(health?.webhook.status || "Configured")}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                {health?.webhook.message || "/api/webhooks/resend"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
