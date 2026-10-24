import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Sidebar Navigation Reorganization Suite", async (t) => {
  const sidebarPath = path.resolve(process.cwd(), "components/layout/sidebar.tsx");
  const sidebarContent = fs.readFileSync(sidebarPath, "utf-8");

  await t.test("1. Dashboard navigation item exists and points to /dashboard", () => {
    assert.ok(sidebarContent.includes('title: "Dashboard"'), "Dashboard item title must exist");
    assert.ok(sidebarContent.includes('href: "/dashboard"'), "Dashboard item must route to /dashboard");
  });

  await t.test("2. Dashboard is not duplicated in the sidebar navigation", () => {
    const dashboardMatches = (sidebarContent.match(/href:\s*["']\/dashboard["']/g) || []).length;
    assert.equal(dashboardMatches, 1, `Dashboard href must appear exactly once, but appeared ${dashboardMatches} times`);
  });

  await t.test("3. Dashboard appears immediately below Compose in the JSX hierarchy", () => {
    const composeIdx = sidebarContent.indexOf("{/* Compose Button */}");
    const dashboardIdx = sidebarContent.indexOf("{/* Dashboard immediately below Compose */}");
    const firstDividerIdx = sidebarContent.indexOf("{/* Divider */}", dashboardIdx);
    const mailSectionIdx = sidebarContent.indexOf("{/* Mail Section */}", firstDividerIdx);

    assert.ok(composeIdx !== -1, "Compose button section must be present");
    assert.ok(dashboardIdx !== -1, "Dashboard section must be present immediately below Compose");
    assert.ok(firstDividerIdx !== -1, "Divider must follow Dashboard");
    assert.ok(mailSectionIdx !== -1, "Mail section must follow first divider");

    assert.ok(composeIdx < dashboardIdx, "Compose must precede Dashboard");
    assert.ok(dashboardIdx < firstDividerIdx, "Dashboard must precede first divider");
    assert.ok(firstDividerIdx < mailSectionIdx, "First divider must precede Mail section");
  });

  await t.test("4. Mail navigation group contains all previous mail items including Replies", () => {
    const mailArrayMatch = sidebarContent.match(/const mailItems:\s*NavItemDef\[\]\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(mailArrayMatch, "mailItems array must be defined");

    const arrayContent = mailArrayMatch[1];
    const titles = Array.from(arrayContent.matchAll(/title:\s*["']([^"']+)["']/g)).map(m => m[1]);

    const expectedTitles = [
      "Inbox",
      "Replies",
      "Starred",
      "Snoozed",
      "Sent",
      "Drafts",
    ];

    assert.deepEqual(titles, expectedTitles, "Mail navigation items must match all previous mail items including Replies");
    assert.ok(sidebarContent.includes('title: "Replies"'), "Replies item must exist");
    assert.ok(sidebarContent.includes('href: "/inbox?filter=all"'), "Replies item must point to filtered inbox");
  });

  await t.test("5. Automation navigation group contains all previous automation items", () => {
    const autoArrayMatch = sidebarContent.match(/const automationItems:\s*NavItemDef\[\]\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(autoArrayMatch, "automationItems array must be defined");

    const arrayContent = autoArrayMatch[1];
    const titles = Array.from(arrayContent.matchAll(/title:\s*["']([^"']+)["']/g)).map(m => m[1]);

    const expectedTitles = [
      "Campaigns",
      "Contacts",
      "Templates",
      "Attachments",
      "Analytics",
    ];

    assert.deepEqual(titles, expectedTitles, "Automation navigation items must match all previous items");
  });

  await t.test("6. Platform navigation contains Settings and no visible developer panel", () => {
    assert.ok(sidebarContent.includes('title: "Settings"'), "Settings must exist");
    assert.ok(sidebarContent.includes('href: "/settings"'), "Settings href must exist");
    assert.ok(!sidebarContent.includes('href="/krishna"'), "Sidebar must not display /krishna developer panel link");
    assert.ok(!sidebarContent.includes('href="/admin"'), "Sidebar must not display /admin link");
  });

  await t.test("7. Active-state and collapsed-state styling are preserved", () => {
    assert.ok(sidebarContent.includes("bg-blue-100 text-blue-900 font-bold dark:bg-blue-950/70 dark:text-blue-200"), "Active state class must be preserved");
    assert.ok(sidebarContent.includes("sidebarCollapsed"), "Responsive collapsed state handling must be preserved");
    assert.ok(sidebarContent.includes('title={sidebarCollapsed ? item.title : undefined}'), "Tooltip on collapsed must be preserved");
  });
});
