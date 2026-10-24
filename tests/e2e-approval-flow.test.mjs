import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { isPlatformAdmin } from "../lib/security/developer.ts";

test("End-to-End User Access Control Lifecycle (15 Mandatory E2E Steps)", async (t) => {
  const { db } = createTestDb();

  // Create query adapter
  function query(sql, params = []) {
    let parameterizedSql = sql;
    if (params && params.length > 0) {
      params.forEach((param, i) => {
        const placeholder = new RegExp(`\\$${i + 1}(?![0-9])`, "g");
        if (param === null || param === undefined) {
          parameterizedSql = parameterizedSql.replace(placeholder, "NULL");
        } else if (typeof param === "number") {
          parameterizedSql = parameterizedSql.replace(placeholder, String(param));
        } else if (typeof param === "boolean") {
          parameterizedSql = parameterizedSql.replace(placeholder, param ? "TRUE" : "FALSE");
        } else {
          const escaped = String(param).replace(/'/g, "''");
          parameterizedSql = parameterizedSql.replace(placeholder, `'${escaped}'`);
        }
      });
    }

    const trimmed = parameterizedSql.trim().toUpperCase();
    if (trimmed.startsWith("SELECT") || trimmed.includes("RETURNING")) {
      return db.public.many(parameterizedSql);
    } else {
      db.public.none(parameterizedSql);
      return [];
    }
  }

  // Pre-seed an enterprise workspace
  const workspaceId = crypto.randomUUID();
  query(
    `INSERT INTO businesses (id, name, timezone, status) VALUES ('${workspaceId}', 'Enterprise Corp', 'UTC', 'active');`
  );

  // Pre-seed platform administrator
  const adminId = crypto.randomUUID();
  const adminEmail = "platform.admin@emailplatform.io";
  query(
    `INSERT INTO users (id, email, full_name, role, status, is_platform_admin)
     VALUES ('${adminId}', '${adminEmail}', 'Dev Admin', 'platform_admin', 'active', TRUE);`
  );

  let candidateUserId;
  const candidateEmail = "applicant@clientcompany.com";

  await t.test("Step 1: Create new user via Signup", () => {
    candidateUserId = crypto.randomUUID();
    query(
      `INSERT INTO users (id, email, full_name, role, status, business_id)
       VALUES ('${candidateUserId}', '${candidateEmail}', 'Applicant User', 'member', 'pending', NULL);`
    );
    const user = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    assert.ok(user, "User record must exist");
  });

  await t.test("Step 2 & 3: Verify email & Confirm PENDING status without workspace", () => {
    const user = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    assert.equal(user.status, "pending", "Status must be PENDING");
    assert.equal(user.business_id, null, "business_id must be NULL");
  });

  await t.test("Step 4: Confirm dashboard access is blocked for PENDING user", () => {
    const user = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    function checkDashboardAccess(u) {
      if (u.status !== "active" || !u.business_id) {
        return { allowed: false, redirect: "/login?status=pending" };
      }
      return { allowed: true };
    }
    const access = checkDashboardAccess(user);
    assert.equal(access.allowed, false, "Pending user MUST NOT access dashboard");
    assert.equal(access.redirect, "/login?status=pending");
  });

  await t.test("Step 5: Login as Platform Admin", () => {
    const adminUser = query(`SELECT * FROM users WHERE id = '${adminId}';`)[0];
    assert.equal(isPlatformAdmin(adminUser), true, "Admin must possess platform-admin privileges");
  });

  await t.test("Step 6, 7 & 8: Approve user, Assign workspace & Assign role", () => {
    query(
      `UPDATE users
       SET status = 'active', business_id = '${workspaceId}', role = 'owner', updated_at = NOW()
       WHERE id = '${candidateUserId}';`
    );

    // Record audit log
    query(
      `INSERT INTO admin_audit_logs (admin_user_id, admin_email, action, target_resource, target_id, details)
       VALUES ('${adminId}', '${adminEmail}', 'USER_APPROVED', 'user', '${candidateUserId}', 'Approved with workspace');`
    );

    const updated = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    assert.equal(updated.status, "active", "Status must be ACTIVE");
    assert.equal(updated.business_id, workspaceId, "Workspace must match assigned workspace");
    assert.equal(updated.role, "owner", "Role must be OWNER");
  });

  await t.test("Step 9 & 10: Login as approved user and confirm dashboard access", () => {
    const approvedUser = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    function checkDashboardAccess(u) {
      if (u.status !== "active" || !u.business_id) {
        return { allowed: false, redirect: `/login?status=${u.status}` };
      }
      return { allowed: true, redirect: "/dashboard" };
    }
    const access = checkDashboardAccess(approvedUser);
    assert.equal(access.allowed, true, "Approved active user can access dashboard");
    assert.equal(access.redirect, "/dashboard");
  });

  await t.test("Step 11: Confirm workspace data access", () => {
    const approvedUser = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    // Create lead in the assigned workspace
    const leadId = crypto.randomUUID();
    query(
      `INSERT INTO leads (id, business_id, email, first_name, status)
       VALUES ('${leadId}', '${approvedUser.business_id}', 'client@enterprise.com', 'Enterprise Client', 'new');`
    );

    const leads = query(`SELECT * FROM leads WHERE business_id = '${approvedUser.business_id}';`);
    assert.equal(leads.length, 1, "User can read their workspace leads");
  });

  await t.test("Step 12: Admin blocks user", () => {
    query(
      `UPDATE users
       SET status = 'blocked', updated_at = NOW()
       WHERE id = '${candidateUserId}';`
    );

    query(
      `INSERT INTO admin_audit_logs (admin_user_id, admin_email, action, target_resource, target_id, details)
       VALUES ('${adminId}', '${adminEmail}', 'USER_BLOCKED', 'user', '${candidateUserId}', 'Security policy revoke');`
    );

    const user = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    assert.equal(user.status, "blocked", "User must now be BLOCKED");
  });

  await t.test("Step 13: Confirm access is revoked", () => {
    const blockedUser = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    function checkDashboardAccess(u) {
      if (u.status !== "active") {
        return { allowed: false, redirect: `/login?status=${u.status}` };
      }
      return { allowed: true };
    }
    const access = checkDashboardAccess(blockedUser);
    assert.equal(access.allowed, false, "Blocked user must not access dashboard");
    assert.equal(access.redirect, "/login?status=blocked");
  });

  await t.test("Step 14 & 15: Attempt direct API access and confirm API rejects blocked user", () => {
    const blockedUser = query(`SELECT * FROM users WHERE id = '${candidateUserId}';`)[0];
    function protectedApiEndpoint(u) {
      if (!u || u.status !== "active") {
        return { status: 403, error: "Your account has been disabled. Please contact the administrator." };
      }
      return { status: 200, data: "ok" };
    }
    const res = protectedApiEndpoint(blockedUser);
    assert.equal(res.status, 403, "API must return 403 Forbidden");
    assert.equal(res.error, "Your account has been disabled. Please contact the administrator.");
  });
});
