import type { NavItem, SidebarSection } from "@/types";

export const siteConfig = {
  name: "Email Automation Platform",
  description:
    "Production-oriented platform to automate email campaigns, follow-ups, reply handling, and email workflow management.",
  version: "1.0.0 (SaaS Release)",
  mainNav: [
    { title: "Inbox", href: "/inbox" },
    { title: "Replies", href: "/inbox" },
    { title: "Sent", href: "/sent" },
    { title: "Campaigns", href: "/campaigns" },
    { title: "Contacts", href: "/contacts" },
    { title: "Templates", href: "/templates" },
    { title: "Attachments", href: "/attachments" },
    { title: "Analytics", href: "/analytics" },
    { title: "Dashboard", href: "/dashboard" },
    { title: "Settings", href: "/settings" },
  ] as NavItem[],
  dashboardNav: [
    {
      title: "Mail",
      items: [
        { title: "Inbox", href: "/inbox" },
        { title: "Replies", href: "/inbox?filter=all" },
        { title: "Starred", href: "/starred" },
        { title: "Snoozed", href: "/snoozed" },
        { title: "Sent", href: "/sent" },
        { title: "Drafts", href: "/drafts" },
      ],
    },
    {
      title: "Automation",
      items: [
        { title: "Campaigns", href: "/campaigns" },
        { title: "Contacts", href: "/contacts" },
        { title: "Templates", href: "/templates" },
        { title: "Attachments", href: "/attachments" },
        { title: "Analytics", href: "/analytics" },
      ],
    },
    {
      title: "Platform",
      items: [
        { title: "Dashboard", href: "/dashboard" },
        { title: "Settings", href: "/settings" },
        { title: "API Health", href: "/api/health", external: true },
      ],
    },
  ] as SidebarSection[],
};

/**
 * Resolves the canonical public base URL of the application.
 * Honors VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL, APP_URL, and NEXT_PUBLIC_APP_URL.
 */
export function getAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.APP_URL && !process.env.APP_URL.includes("localhost")) {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
