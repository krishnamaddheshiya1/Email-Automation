import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { Sidebar } from "@/components/layout/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { EmailProviderSettings } from "@/components/settings/email-provider-settings";
import { SystemHealthCard } from "@/components/settings/system-health-card";

async function SettingsContent() {
  await connection();
  const supabase = await createClient();
  const session = await AuthService.getCurrentSession(supabase);

  if (!session) {
    redirect("/login");
  }

  const { user, business } = session;

  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />

      <main className="flex-1 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Platform Settings
              </h1>
              <Badge variant="success">Tenant Scoped</Badge>
              <Badge variant="default" className="uppercase text-[10px]">
                {user.role}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Configuration shell for workspace identity, user permissions, and multi-tenant parameters.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Save Changes
            </Button>
            <LogoutButton variant="secondary" size="sm" />
          </div>
        </div>

        {/* Section Quick Jump Navigation (Section 16) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-100 dark:border-slate-800 text-xs font-medium">
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider shrink-0 mr-1">
            Sections:
          </span>
          <a
            href="#business"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            Business Settings
          </a>
          <a
            href="#provider"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            Email Provider
          </a>
          <a
            href="#senders"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            Sender Identities
          </a>
          <a
            href="#webhook"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            Webhook
          </a>
          <a
            href="#account"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            Account
          </a>
          <a
            href="#health"
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition shrink-0"
          >
            System Health
          </a>
        </div>

        {/* Section 18: System Health Indicator Card */}
        <SystemHealthCard />

        {/* Business Workspace Profile (Phase 3 Requirement) */}
        <Card id="business">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Business Workspace Identity</CardTitle>
                <CardDescription>
                  Multi-tenant organizational scope associated with this account.
                </CardDescription>
              </div>
              <Badge variant="success">Active Workspace</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Business Name
                </label>
                <input
                  type="text"
                  value={business.name}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Workspace Time Zone
                </label>
                <input
                  type="text"
                  value={business.timezone || "UTC"}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
            Tenant ID: <code className="font-mono ml-1 text-slate-700 dark:text-slate-300">{business.id}</code>
          </CardFooter>
        </Card>

        {/* User Profile & Role Card (Phase 3 Requirement) */}
        <Card id="account">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Authenticated Profile & Role</CardTitle>
                <CardDescription>
                  Your individual credentials, administrative privilege level, and tenant membership.
                </CardDescription>
              </div>
              <Badge
                variant={user.role === "admin" || user.role === "owner" ? "default" : "neutral"}
                className="uppercase"
              >
                Role: {user.role}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Full Name
                </label>
                <input
                  type="text"
                  value={user.full_name}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  User Email (Account Login)
                </label>
                <input
                  type="email"
                  value={user.email}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Assigned User Role
                </label>
                <div className="flex items-center h-[38px] px-3 rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                    {user.role}
                  </span>
                  <span className="ml-2 text-[11px] text-slate-500">
                    ({user.role === "admin" ? "Full administrative authority" : "Workspace member"})
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
            User ID: <code className="font-mono ml-1 text-slate-700 dark:text-slate-300">{user.id}</code>
          </CardFooter>
        </Card>

        {/* Multi-Tenancy Security Guardrail Notice */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-start gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">
              ✓
            </span>
            <div>
              <p className="font-semibold">Row Level Security Guardrail Active</p>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                Tenant records are isolated by PostgreSQL RLS policies (<code className="font-mono text-[11px]">business_id = get_auth_business_id()</code>). Manual or arbitrary client overrides are automatically rejected by the database.
              </p>
            </div>
          </div>
        </div>

        {/* Email Delivery Infrastructure, Senders, & Webhook Configuration (Sections 16, 17) */}
        <EmailProviderSettings />
      </main>
    </div>
  );
}

function SettingsFallback() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
      <Sidebar />
      <main className="flex-1 space-y-6 animate-pulse">
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsContent />
    </Suspense>
  );
}
