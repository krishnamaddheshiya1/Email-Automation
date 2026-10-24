"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);

  const [statusDismissed, setStatusDismissed] = useState(false);

  const statusParam = (searchParams.get("status") || "").toLowerCase();
  const errorParam = searchParams.get("error");

  let statusMessage: { title: string; desc: string; type: "amber" | "rose" } | null = null;
  if (!statusDismissed) {
    if (statusParam === "pending") {
      statusMessage = {
        title: "Approval Pending",
        desc: "Your account was awaiting administrator approval. If your account was already approved by an administrator, please sign in below.",
        type: "amber",
      };
    } else if (statusParam === "rejected") {
      statusMessage = {
        title: "Access Rejected",
        desc: "Your access request has been rejected.",
        type: "rose",
      };
    } else if (statusParam === "blocked") {
      statusMessage = {
        title: "Account Disabled",
        desc: "Your account has been disabled. Please contact the administrator.",
        type: "rose",
      };
    } else if (errorParam === "unauthorized_admin" || errorParam === "unauthorized_developer") {
      statusMessage = {
        title: "Access Restricted",
        desc: "Platform administrator authorization is required to access the admin panel.",
        type: "rose",
      };
    }
  }

  useEffect(() => {
    // If a status or error query param is present, clean the address bar to prevent stale message on refresh
    if (typeof window !== "undefined" && (window.location.search.includes("status=") || window.location.search.includes("error="))) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("status");
        url.searchParams.delete("error");
        const newSearch = url.searchParams.toString();
        const newPath = url.pathname + (newSearch ? `?${newSearch}` : "");
        window.history.replaceState({}, "", newPath);
      } catch {}
    }

    async function checkConfig() {
      try {
        const res = await fetch("/api/auth/status");
        if (res.ok) {
          const data = await res.json();
          if (data && data.configured === false) {
            setConfigMissing(true);
          }
        }
      } catch {}
    }
    checkConfig();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Failed to sign in. Please verify your credentials.");
        return;
      }

      // Successful login - full window navigation ensures fresh cookies and clears query params
      const redirectTarget = searchParams.get("redirect") || "/dashboard";
      window.location.href = redirectTarget;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Sign In to Your Workspace
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Access your email sequences, leads, and multi-tenant telemetry.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Authentication</CardTitle>
            <CardDescription>
              Enter your work email and password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statusMessage && (
              <div
                role="alert"
                className={`mb-4 flex items-start justify-between gap-3 rounded-xl border p-4 text-xs font-medium ${
                  statusMessage.type === "amber"
                    ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                }`}
              >
                <div>
                  <p className="font-bold text-sm mb-1">{statusMessage.title}</p>
                  <p>{statusMessage.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStatusDismissed(true)}
                  aria-label="Dismiss message"
                  className="rounded p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}

            {configMissing && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <p className="font-semibold">⚠️ Supabase Configuration Required</p>
                <p className="mt-1">
                  Supabase environment variables are not yet configured on this deployment. Please add <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and <code>SUPABASE_SERVICE_ROLE_KEY</code> in your Netlify (or Vercel) Environment Variables, then redeploy.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                >
                  <p className="font-semibold">Sign in failed</p>
                  <p className="mt-0.5">{error}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Work Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@company.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={loading}
                className="w-full mt-2"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <span>Don&apos;t have an account? </span>
            <Link
              href="/register"
              className="ml-1 font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              Create workspace
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
