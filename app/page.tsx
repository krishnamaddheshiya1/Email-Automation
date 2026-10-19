import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export default function HomePage() {
  const capabilities = [
    {
      title: "Email Campaign Automation",
      description:
        "Orchestrate multi-step targeted outbound campaigns, schedule delivery windows, and manage audience segments.",
      phase: "Phase 2 Target",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-blue-600"
        >
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      ),
    },
    {
      title: "Automated Follow-Ups",
      description:
        "Define intelligent conditional follow-up sequences triggered by recipient inactivity, opens, or link clicks.",
      phase: "Phase 2 Target",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-blue-600"
        >
          <path d="M12 20v-6M6 20V10M18 20V4" />
        </svg>
      ),
    },
    {
      title: "Reply Handling",
      description:
        "Centralize incoming replies with automated status categorization, routing, and conversation thread tracking.",
      phase: "Phase 3 Target",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-blue-600"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      title: "Email Workflow Management",
      description:
        "Build reliable event-driven delivery pipelines with provider failover, delivery throttling, and audit logs.",
      phase: "Phase 3 Target",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-blue-600"
        >
          <rect width="8" height="8" x="2" y="2" rx="2" />
          <path d="M14 2c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2" />
          <path d="M20 2c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2" />
          <rect width="8" height="8" x="2" y="14" rx="2" />
          <path d="M6 10v4" />
          <path d="M14 14h6" />
          <path d="M17 11v6" />
        </svg>
      ),
    },
  ];

  return (
    <main className="flex-1 py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-16">
        {/* Hero Section */}
        <div className="mx-auto max-w-3xl text-center space-y-6">
          <Badge variant="default" className="px-3 py-1 text-xs">
            Phase 1 Foundation Ready
          </Badge>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Email Automation Platform
          </h1>

          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 leading-relaxed">
            A production-oriented foundation designed to automate email campaigns,
            follow-ups, reply handling, and email workflow management.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white shadow transition-colors hover:bg-blue-700 active:bg-blue-800"
            >
              Explore Dashboard Shell
            </Link>

            <Link
              href="/settings"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Platform Settings
            </Link>

            <Link
              href="/api/health"
              target="_blank"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
            >
              Check /api/health
            </Link>
          </div>
        </div>

        {/* Core Capabilities Grid */}
        <section className="space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Target Capabilities
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The architecture is structured specifically to support these modular domains in future phases.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {capabilities.map((item) => (
              <Card key={item.title} className="flex flex-col justify-between">
                <CardHeader>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60">
                    {item.icon}
                  </div>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <CardDescription className="pt-1">{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Badge variant="neutral" className="text-[11px]">
                    {item.phase}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Phase 1 Foundation Scope Note */}
        <section className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <Badge variant="success">Phase 1 Scope</Badge>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Clean Scalable Foundation
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                This release establishes the strict TypeScript configuration, Tailwind CSS design system,
                decoupled service layer, placeholder routes (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">/</code>, <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">/dashboard</code>, <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">/settings</code>), and the <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">/api/health</code> endpoint.
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
