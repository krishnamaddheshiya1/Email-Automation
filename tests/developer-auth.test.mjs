import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDeveloperUser } from "../lib/security/developer.ts";

test("Developer Authentication & /krishna Route Isolation Suite", async (t) => {
  await t.test("1. Developer identification logic grants access to developer and blocks regular users", () => {
    // Developer identities
    assert.equal(isDeveloperUser({ email: "krishnatktr1@gmail.com", role: "admin" }), true);
    assert.equal(isDeveloperUser({ email: "krishnatktr@gmail.com", role: "admin" }), true);
    assert.equal(isDeveloperUser({ email: "krishna.dev@company.com", role: "admin" }), true);
    assert.equal(isDeveloperUser({ email: "anyuser@example.com", role: "developer" }), true);
    assert.equal(isDeveloperUser({ email: "anyuser@example.com", role: "superadmin" }), true);

    // Regular tenant users / customers (even with tenant admin/owner roles)
    assert.equal(isDeveloperUser({ email: "tenant_user@example.com", role: "admin" }), false);
    assert.equal(isDeveloperUser({ email: "customer@domain.com", role: "owner" }), false);
    assert.equal(isDeveloperUser({ email: "member@saas.com", role: "member" }), false);
    assert.equal(isDeveloperUser(null), false);
    assert.equal(isDeveloperUser(undefined), false);
  });

  await t.test("2. Main website sidebar does not show developer panel link (accessible directly via /krishna URL)", () => {
    const sidebarPath = path.resolve(process.cwd(), "components/layout/sidebar.tsx");
    const sidebarContent = fs.readFileSync(sidebarPath, "utf-8");

    // Must not show developer or admin links in website sidebar
    assert.ok(!sidebarContent.includes('href="/krishna"'), "Sidebar must not display /krishna link on website");
    assert.ok(!sidebarContent.includes('href="/admin"'), "Sidebar must not display /admin link");

    // Header profile dropdown must also not display admin/developer link
    const headerPath = path.resolve(process.cwd(), "components/layout/header.tsx");
    const headerContent = fs.readFileSync(headerPath, "utf-8");
    assert.ok(!headerContent.includes('href="/admin"'), "Header profile dropdown must not display /admin link");
    assert.ok(!headerContent.includes('href="/krishna"'), "Header profile dropdown must not display /krishna link");
  });

  await t.test("3. /api/auth/me computes isDeveloper on the server", () => {
    const meRoutePath = path.resolve(process.cwd(), "app/api/auth/me/route.ts");
    const meContent = fs.readFileSync(meRoutePath, "utf-8");

    assert.ok(meContent.includes("isDeveloperUser"), "API route must use isDeveloperUser helper");
    assert.ok(meContent.includes("isDeveloper,"), "API response must return isDeveloper boolean");
  });

  await t.test("4. /krishna layout strictly protects access server-side", () => {
    const krishnaLayoutPath = path.resolve(process.cwd(), "app/krishna/layout.tsx");
    const layoutContent = fs.readFileSync(krishnaLayoutPath, "utf-8");

    assert.ok(layoutContent.includes("isDeveloperUser(session.user)"), "Layout must guard using isDeveloperUser");
    assert.ok(layoutContent.includes('redirect("/dashboard?error=unauthorized_developer")'), "Unauthorized users must be redirected away");
  });

  await t.test("5. /admin routes redirect to /krishna", () => {
    const adminLayoutPath = path.resolve(process.cwd(), "app/admin/layout.tsx");
    const layoutContent = fs.readFileSync(adminLayoutPath, "utf-8");
    assert.ok(layoutContent.includes('redirect("/krishna")'), "Admin layout must redirect to /krishna");

    const adminPagePath = path.resolve(process.cwd(), "app/admin/page.tsx");
    const pageContent = fs.readFileSync(adminPagePath, "utf-8");
    assert.ok(pageContent.includes('redirect("/krishna")'), "Admin root page must redirect to /krishna");
  });

  await t.test("6. Developer console sidebar points to /krishna sub-routes", () => {
    const adminSidebarPath = path.resolve(process.cwd(), "components/admin/admin-sidebar.tsx");
    const adminSidebarContent = fs.readFileSync(adminSidebarPath, "utf-8");

    assert.ok(adminSidebarContent.includes('href: "/krishna/dashboard"'), "Overview points to /krishna/dashboard");
    assert.ok(adminSidebarContent.includes('href: "/krishna/users"'), "Users points to /krishna/users");
    assert.ok(adminSidebarContent.includes('href: "/krishna/workspaces"'), "Workspaces points to /krishna/workspaces");
    assert.ok(adminSidebarContent.includes('href: "/krishna/campaigns"'), "Campaigns points to /krishna/campaigns");
    assert.ok(adminSidebarContent.includes('href: "/krishna/email-providers"'), "Email Providers points to /krishna/email-providers");
    assert.ok(adminSidebarContent.includes('href: "/krishna/system"'), "System points to /krishna/system");
    assert.ok(adminSidebarContent.includes('href: "/krishna/audit-logs"'), "Audit logs points to /krishna/audit-logs");
  });
});
