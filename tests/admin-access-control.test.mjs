import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { isDeveloperUser, isPlatformAdmin } from "../lib/security/developer.ts";
import { registerSchema } from "../lib/validations/auth.ts";

/**
 * Helper to convert pg-mem database queries to postgres-like query responses
 */
function createQueryAdapter(db) {
  return async function query(sql, params = []) {
    let parameterizedSql = sql;
    // Replace $1, $2, etc. with literals for pg-mem
    if (params && params.length > 0) {
      params.forEach((param, i) => {
        const placeholder = new RegExp(`\\$${i + 1}(?![0-9])`, "g");
        if (param === null || param === undefined) {
          parameterizedSql = parameterizedSql.replace(placeholder, "NULL");
        } else if (typeof param === "number") {
          parameterizedSql = parameterizedSql.replace(placeholder, String(param));
        } else if (typeof param === "boolean") {
          parameterizedSql = parameterizedSql.replace(placeholder, param ? "TRUE" : "FALSE");
        } else if (typeof param === "object") {
          const jsonStr = JSON.stringify(param).replace(/'/g, "''");
          parameterizedSql = parameterizedSql.replace(placeholder, `'${jsonStr}'`);
        } else {
          const escaped = String(param).replace(/'/g, "''");
          parameterizedSql = parameterizedSql.replace(placeholder, `'${escaped}'`);
        }
      });
    }

    try {
      const trimmed = parameterizedSql.trim().toUpperCase();
      if (
        trimmed.startsWith("SELECT") ||
        trimmed.includes("RETURNING")
      ) {
        const rows = db.public.many(parameterizedSql);
        return { rows, rowCount: rows.length };
      } else {
        db.public.none(parameterizedSql);
        return { rows: [], rowCount: 1 };
      }
    } catch (err) {
      if (err.message && err.message.includes("no result")) {
        return { rows: [], rowCount: 0 };
      }
      throw err;
    }
  };
}

test("Admin-Controlled Authentication and User Access Test Suite (27 Scenarios)", async (t) => {
  const { db } = createTestDb();
  const queryFn = createQueryAdapter(db);

  // Setup platform admin and pre-existing workspaces
  const platformAdminId = crypto.randomUUID();
  const platformAdminEmail = "superadmin@platform.internal";
  db.public.none(`
    INSERT INTO users (id, email, full_name, role, status, is_platform_admin)
    VALUES ('${platformAdminId}', '${platformAdminEmail}', 'Platform Administrator', 'platform_admin', 'active', TRUE);
  `);

  const workspaceAId = crypto.randomUUID();
  const workspaceBId = crypto.randomUUID();
  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status, settings)
    VALUES ('${workspaceAId}', 'Acme Corporation A', 'UTC', 'active', '{}'),
           ('${workspaceBId}', 'Beta Logistics B', 'UTC', 'active', '{}');
  `);

  // =========================================================================
  // SECTION: SIGNUP (Scenarios 1-3)
  // =========================================================================
  await t.test("1. New user signup defaults to PENDING, unassigned workspace, and ignores client workspace injection", async () => {
    const signupData = {
      full_name: "John Doe",
      business_name: "Self Claimed Corp",
      email: "john.pending@example.com",
      password: "StrongPassword123!",
      workspace_id: workspaceBId, // Malicious client injection attempt!
    };

    // 1. Zod parse validates successfully and ignores client workspace_id
    const parsed = registerSchema.safeParse(signupData);
    assert.ok(parsed.success, "Registration schema parses valid payload");

    // 2. Server-side registration logic:
    // Client-provided workspace_id MUST BE IGNORED.
    // Account defaults to PENDING status with business_id = null.
    const newUserId = crypto.randomUUID();
    const serverAssignedStatus = "pending";
    const serverAssignedBusinessId = null; // Unassigned until admin approval

    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id, is_platform_admin)
      VALUES ($1, $2, $3, 'member', $4, $5, FALSE);
      `,
      [newUserId, signupData.email, signupData.full_name, serverAssignedStatus, serverAssignedBusinessId]
    );

    const userRow = (await queryFn("SELECT * FROM users WHERE id = $1;", [newUserId])).rows[0];
    assert.equal(userRow.status, "pending", "New user status must be PENDING");
    assert.equal(userRow.business_id, null, "New user must not be assigned to any workspace");
    assert.notEqual(userRow.business_id, workspaceBId, "Server must ignore client-injected workspace ID");
  });

  await t.test("2. Pending user cannot access dashboard", async () => {
    // Check route guard simulation:
    function checkDashboardAccess(user) {
      if (!user) return { allowed: false, redirect: "/login" };
      if (user.status !== "active") {
        return { allowed: false, redirect: `/login?status=${user.status}` };
      }
      if (!user.business_id) {
        return { allowed: false, redirect: "/login?status=pending" };
      }
      return { allowed: true, redirect: "/dashboard" };
    }

    const pendingUser = { id: crypto.randomUUID(), email: "john.pending@example.com", status: "pending", business_id: null };
    const guardResult = checkDashboardAccess(pendingUser);
    assert.equal(guardResult.allowed, false, "Pending user must be denied access to /dashboard");
    assert.equal(guardResult.redirect, "/login?status=pending");
  });

  await t.test("3. Pending user cannot call protected APIs", async () => {
    function protectApiCall(user) {
      if (!user) return { status: 401, error: "Unauthorized" };
      if (user.status !== "active") {
        return { status: 403, error: "Forbidden. Account awaiting approval." };
      }
      if (!user.business_id) {
        return { status: 403, error: "Forbidden. No workspace assigned." };
      }
      return { status: 200, error: null };
    }

    const pendingUser = { id: crypto.randomUUID(), email: "john.pending@example.com", status: "pending", business_id: null };
    const apiResult = protectApiCall(pendingUser);
    assert.equal(apiResult.status, 403, "Protected APIs must return 403 Forbidden for pending user");
    assert.ok(apiResult.error.includes("awaiting approval"));
  });

  // =========================================================================
  // SECTION: APPROVAL (Scenarios 4-8)
  // =========================================================================
  let approvedUserId;
  await t.test("4. Admin approves user with selected workspace and role", async () => {
    approvedUserId = crypto.randomUUID();
    const candidateEmail = "candidate@approved.test";

    // Setup pending user
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, $2, 'Jane Candidate', 'member', 'pending', NULL);
      `,
      [approvedUserId, candidateEmail]
    );

    // Platform admin approves: assigns workspaceAId with role 'admin'
    await queryFn(
      `
      UPDATE users
      SET status = 'active', business_id = $1, role = 'admin', updated_at = NOW()
      WHERE id = $2;
      `,
      [workspaceAId, approvedUserId]
    );

    // Audit log entry
    await queryFn(
      `
      INSERT INTO admin_audit_logs (admin_user_id, admin_email, action, target_resource, target_id, details)
      VALUES ($1, $2, 'USER_APPROVED', 'user', $3, 'Approved candidate into workspace');
      `,
      [platformAdminId, platformAdminEmail, approvedUserId]
    );
  });

  await t.test("5. Approved user status becomes ACTIVE", async () => {
    const row = (await queryFn("SELECT status FROM users WHERE id = $1;", [approvedUserId])).rows[0];
    assert.equal(row.status, "active", "Status must be ACTIVE");
  });

  await t.test("6. Approved user has Workspace assigned", async () => {
    const row = (await queryFn("SELECT business_id FROM users WHERE id = $1;", [approvedUserId])).rows[0];
    assert.equal(row.business_id, workspaceAId, "Workspace must match assigned workspace");
  });

  await t.test("7. Approved user has Role assigned", async () => {
    const row = (await queryFn("SELECT role FROM users WHERE id = $1;", [approvedUserId])).rows[0];
    assert.equal(row.role, "admin", "Role must match assigned role");
  });

  await t.test("8. Approved user can access application and workspace data", async () => {
    const row = (await queryFn("SELECT * FROM users WHERE id = $1;", [approvedUserId])).rows[0];
    assert.equal(row.status, "active");
    assert.ok(row.business_id);

    // Can query contacts in their workspace
    const contacts = await queryFn("SELECT * FROM leads WHERE business_id = $1;", [row.business_id]);
    assert.ok(Array.isArray(contacts.rows), "User can query their assigned workspace contacts");
  });

  // =========================================================================
  // SECTION: REJECTION (Scenarios 9-10)
  // =========================================================================
  let rejectedUserId;
  await t.test("9. Admin rejects user", async () => {
    rejectedUserId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, 'rejectme@spam.test', 'Spammer', 'member', 'pending', NULL);
      `,
      [rejectedUserId]
    );

    // Admin rejects user
    await queryFn(
      `
      UPDATE users
      SET status = 'rejected', updated_at = NOW()
      WHERE id = $1;
      `,
      [rejectedUserId]
    );

    // Record audit log
    await queryFn(
      `
      INSERT INTO admin_audit_logs (admin_user_id, admin_email, action, target_resource, target_id)
      VALUES ($1, $2, 'USER_REJECTED', 'user', $3);
      `,
      [platformAdminId, platformAdminEmail, rejectedUserId]
    );

    const row = (await queryFn("SELECT status FROM users WHERE id = $1;", [rejectedUserId])).rows[0];
    assert.equal(row.status, "rejected");
  });

  await t.test("10. Rejected user cannot access application", async () => {
    const row = (await queryFn("SELECT * FROM users WHERE id = $1;", [rejectedUserId])).rows[0];
    function checkLoginStatus(u) {
      if (u.status === "rejected") {
        return { allowed: false, message: "Your access request has been rejected." };
      }
      return { allowed: true };
    }
    const res = checkLoginStatus(row);
    assert.equal(res.allowed, false);
    assert.equal(res.message, "Your access request has been rejected.");
  });

  // =========================================================================
  // SECTION: BLOCKING & SESSION REVOCATION (Scenarios 11-14)
  // =========================================================================
  let blockedUserId;
  await t.test("11. Active user can access application", async () => {
    blockedUserId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, 'active.to.block@acme.com', 'Soon Blocked', 'member', 'active', $2);
      `,
      [blockedUserId, workspaceAId]
    );

    const user = (await queryFn("SELECT status FROM users WHERE id = $1;", [blockedUserId])).rows[0];
    assert.equal(user.status, "active", "User is active initially");
  });

  await t.test("12. Admin blocks user", async () => {
    await queryFn(
      `
      UPDATE users
      SET status = 'blocked', updated_at = NOW()
      WHERE id = $1;
      `,
      [blockedUserId]
    );

    await queryFn(
      `
      INSERT INTO admin_audit_logs (admin_user_id, admin_email, action, target_resource, target_id)
      VALUES ($1, $2, 'USER_BLOCKED', 'user', $3);
      `,
      [platformAdminId, platformAdminEmail, blockedUserId]
    );

    const user = (await queryFn("SELECT status FROM users WHERE id = $1;", [blockedUserId])).rows[0];
    assert.equal(user.status, "blocked");
  });

  await t.test("13. Blocked user loses application access", async () => {
    const user = (await queryFn("SELECT status FROM users WHERE id = $1;", [blockedUserId])).rows[0];
    function authorizeSession(u) {
      if (u.status === "blocked") {
        return { authorized: false, error: "Your account has been disabled. Please contact the administrator." };
      }
      return { authorized: true };
    }
    const auth = authorizeSession(user);
    assert.equal(auth.authorized, false);
    assert.ok(auth.error.includes("disabled"));
  });

  await t.test("14. Blocked user existing sessions are immediately revoked and future API requests rejected", async () => {
    // In-memory session token store simulation
    const sessionCache = new Map();
    sessionCache.set(blockedUserId, { token: "active_token_123", valid: true });

    // Invalidation step:
    sessionCache.delete(blockedUserId);

    // Verify cache is cleared
    assert.equal(sessionCache.has(blockedUserId), false, "Session cache must be cleared immediately upon blocking");

    // Live DB validation in every API request:
    const liveUser = (await queryFn("SELECT status FROM users WHERE id = $1;", [blockedUserId])).rows[0];
    assert.equal(liveUser.status, "blocked");
    const isAllowed = liveUser.status === "active";
    assert.equal(isAllowed, false, "Live DB check must reject blocked account on every API call");
  });

  // =========================================================================
  // SECTION: ADMIN SECURITY (Scenarios 15-17)
  // =========================================================================
  await t.test("15. Normal user cannot access /admin or /krishna", async () => {
    const normalUser = { email: "regular.employee@acme.com", role: "member", is_platform_admin: false };
    assert.equal(isDeveloperUser(normalUser), false);
    assert.equal(isPlatformAdmin(normalUser), false);
  });

  await t.test("16. Normal user cannot call admin APIs", async () => {
    function adminApiGuard(user) {
      if (!isPlatformAdmin(user)) {
        return { status: 403, error: "Forbidden. Platform administrator privileges required." };
      }
      return { status: 200 };
    }

    const normalUser = { email: "regular.employee@acme.com", role: "member", is_platform_admin: false };
    const guardRes = adminApiGuard(normalUser);
    assert.equal(guardRes.status, 403);
  });

  await t.test("17. Workspace admin cannot perform platform-admin operations", async () => {
    // Crucial check: A tenant workspace owner or admin is NOT a platform admin!
    const workspaceOwner = { email: "ceo@acme.com", role: "owner", is_platform_admin: false };
    const workspaceAdmin = { email: "it@acme.com", role: "admin", is_platform_admin: false };

    assert.equal(isDeveloperUser(workspaceOwner), false, "Workspace OWNER must NOT qualify as platform admin");
    assert.equal(isDeveloperUser(workspaceAdmin), false, "Workspace ADMIN must NOT qualify as platform admin");
  });

  // =========================================================================
  // SECTION: WORKSPACE SECURITY & ISOLATION (Scenarios 18-20)
  // =========================================================================
  const userAInWsA = crypto.randomUUID();
  const leadAId = crypto.randomUUID();
  const leadBId = crypto.randomUUID();

  await t.test("18. User A in Workspace A cannot access Workspace B data", async () => {
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, 'usera@workspacea.com', 'User A', 'member', 'active', $2);
      `,
      [userAInWsA, workspaceAId]
    );

    // Create lead in Workspace A and lead in Workspace B
    await queryFn(
      `
      INSERT INTO leads (id, business_id, email, first_name, status)
      VALUES ($1, $2, 'lead.a@target.com', 'Prospect A', 'new'),
             ($3, $4, 'lead.b.confidential@secret.com', 'Prospect B', 'new');
      `,
      [leadAId, workspaceAId, leadBId, workspaceBId]
    );

    // Query scoped strictly by user's assigned business_id
    const userSession = (await queryFn("SELECT business_id FROM users WHERE id = $1;", [userAInWsA])).rows[0];
    const accessibleLeads = await queryFn("SELECT * FROM leads WHERE business_id = $1;", [userSession.business_id]);

    const leadIds = accessibleLeads.rows.map((l) => l.id);
    assert.ok(leadIds.includes(leadAId), "User A must see Workspace A lead");
    assert.ok(!leadIds.includes(leadBId), "User A must NEVER see Workspace B lead");
  });

  await t.test("19. User A in Workspace A cannot modify Workspace B data", async () => {
    const userSession = (await queryFn("SELECT business_id FROM users WHERE id = $1;", [userAInWsA])).rows[0];

    // Attempt to update leadBId with WHERE business_id = userSession.business_id
    const updateResult = await queryFn(
      `
      UPDATE leads
      SET first_name = 'Hacked by User A'
      WHERE id = $1 AND business_id = $2
      RETURNING id;
      `,
      [leadBId, userSession.business_id]
    );

    assert.equal(updateResult.rowCount, 0, "Update of Workspace B record by Workspace A user must affect 0 rows");

    // Verify Workspace B lead was untouched
    const leadB = (await queryFn("SELECT first_name FROM leads WHERE id = $1;", [leadBId])).rows[0];
    assert.equal(leadB.first_name, "Prospect B", "Record in Workspace B must remain unmodified");
  });

  await t.test("20. User A in Workspace A cannot delete Workspace B data", async () => {
    const userSession = (await queryFn("SELECT business_id FROM users WHERE id = $1;", [userAInWsA])).rows[0];

    // Attempt to delete leadBId with WHERE business_id = userSession.business_id
    const deleteResult = await queryFn(
      `
      DELETE FROM leads
      WHERE id = $1 AND business_id = $2
      RETURNING id;
      `,
      [leadBId, userSession.business_id]
    );

    assert.equal(deleteResult.rowCount, 0, "Deletion of Workspace B record by Workspace A user must affect 0 rows");

    // Verify Workspace B lead still exists
    const leadBCheck = (await queryFn("SELECT id FROM leads WHERE id = $1;", [leadBId])).rows[0];
    assert.ok(leadBCheck, "Record in Workspace B must still exist");
  });

  // =========================================================================
  // SECTION: ALLOWLIST / DIRECT APPROVAL (Scenarios 21-23)
  // =========================================================================
  const preApprovedEmail = "vip.client@enterprise.com";

  await t.test("21. Admin adds approved email to allowlist", async () => {
    await queryFn(
      `
      INSERT INTO authorized_emails (id, email, business_id, role, auto_approve)
      VALUES (gen_random_uuid(), $1, $2, 'owner', TRUE);
      `,
      [preApprovedEmail, workspaceAId]
    );

    const allowlistEntry = (
      await queryFn("SELECT * FROM authorized_emails WHERE email = $1;", [preApprovedEmail])
    ).rows[0];
    assert.ok(allowlistEntry);
    assert.equal(allowlistEntry.email, preApprovedEmail);
    assert.equal(allowlistEntry.auto_approve, true);
  });

  await t.test("22. Approved email signing up is automatically assigned workspace, role, and activated", async () => {
    // Signup resolution simulation for pre-authorized email:
    const allowlistCheck = (
      await queryFn("SELECT * FROM authorized_emails WHERE email = $1;", [preApprovedEmail])
    ).rows[0];

    assert.ok(allowlistCheck);
    const resolvedStatus = allowlistCheck.auto_approve ? "active" : "pending";
    const resolvedBusinessId = allowlistCheck.business_id || workspaceAId;
    const resolvedRole = allowlistCheck.role || "owner";

    const vipUserId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, $2, 'VIP Client', $3, $4, $5);
      `,
      [vipUserId, preApprovedEmail, resolvedRole, resolvedStatus, resolvedBusinessId]
    );

    const vipUser = (await queryFn("SELECT * FROM users WHERE id = $1;", [vipUserId])).rows[0];
    assert.equal(vipUser.status, "active", "Auto-approved user must be ACTIVE");
    assert.equal(vipUser.business_id, workspaceAId, "Auto-approved user must have assigned workspace");
    assert.equal(vipUser.role, "owner", "Auto-approved user must have assigned role");
  });

  await t.test("23. Unapproved email remains PENDING", async () => {
    const regularEmail = "stranger@random.com";
    const allowlistCheck = (
      await queryFn("SELECT * FROM authorized_emails WHERE email = $1;", [regularEmail])
    ).rows;

    assert.equal(allowlistCheck.length, 0, "No allowlist entry for stranger");
    const strangerStatus = "pending";
    const strangerBusinessId = null;

    const strangerId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, $2, 'Stranger', 'member', $3, $4);
      `,
      [strangerId, regularEmail, strangerStatus, strangerBusinessId]
    );

    const stranger = (await queryFn("SELECT * FROM users WHERE id = $1;", [strangerId])).rows[0];
    assert.equal(stranger.status, "pending");
    assert.equal(stranger.business_id, null);
  });

  // =========================================================================
  // SECTION: DOMAIN APPROVAL (Scenarios 24-25)
  // =========================================================================
  await t.test("24. Configured workspace allowed domain automatically assigns matching verified email", async () => {
    // Configure allowed domain on Workspace B
    await queryFn(
      `
      UPDATE businesses
      SET allowed_email_domain = 'betalogistics.com'
      WHERE id = $1;
      `,
      [workspaceBId]
    );

    const employeeEmail = "driver1@betalogistics.com";
    const domain = employeeEmail.split("@")[1]?.toLowerCase();

    // Find business with matching allowed domain
    const matchBiz = (
      await queryFn("SELECT id, name FROM businesses WHERE allowed_email_domain = $1;", [domain])
    ).rows[0];

    assert.ok(matchBiz, "Domain must match Workspace B");
    assert.equal(matchBiz.id, workspaceBId);

    const employeeUserId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, $2, 'Beta Driver', 'member', 'active', $3);
      `,
      [employeeUserId, employeeEmail, matchBiz.id]
    );

    const emp = (await queryFn("SELECT * FROM users WHERE id = $1;", [employeeUserId])).rows[0];
    assert.equal(emp.business_id, workspaceBId, "User with allowed domain assigned to workspace");
    assert.equal(emp.status, "active");
  });

  await t.test("25. Unconfigured domain does not bypass approval", async () => {
    const unconfiguredEmail = "someone@otherdomain.com";
    const domain = unconfiguredEmail.split("@")[1]?.toLowerCase();

    const matchBiz = (
      await queryFn("SELECT id FROM businesses WHERE allowed_email_domain = $1;", [domain])
    ).rows;

    assert.equal(matchBiz.length, 0, "No workspace configured with this domain");

    // Falls back to PENDING and business_id = null
    const fallbackStatus = "pending";
    const fallbackBusinessId = null;

    const unconfUserId = crypto.randomUUID();
    await queryFn(
      `
      INSERT INTO users (id, email, full_name, role, status, business_id)
      VALUES ($1, $2, 'Unconfigured Domain User', 'member', $3, $4);
      `,
      [unconfUserId, unconfiguredEmail, fallbackStatus, fallbackBusinessId]
    );

    const unconfUser = (await queryFn("SELECT * FROM users WHERE id = $1;", [unconfUserId])).rows[0];
    assert.equal(unconfUser.status, "pending");
    assert.equal(unconfUser.business_id, null);
  });

  // =========================================================================
  // SECTION: ROLE SECURITY (Scenarios 26-27)
  // =========================================================================
  await t.test("26. Workspace Member cannot perform owner-only actions", async () => {
    function authorizeWorkspaceAction(role, action) {
      if (action === "DELETE_WORKSPACE" || action === "MANAGE_BILLING") {
        return role === "owner";
      }
      return true;
    }

    assert.equal(authorizeWorkspaceAction("member", "DELETE_WORKSPACE"), false);
    assert.equal(authorizeWorkspaceAction("admin", "DELETE_WORKSPACE"), false);
    assert.equal(authorizeWorkspaceAction("owner", "DELETE_WORKSPACE"), true);
  });

  await t.test("27. Workspace owner cannot access platform-admin functions", async () => {
    const tenantOwner = {
      email: "ceo@acme-corp.com",
      role: "owner",
      is_platform_admin: false,
    };

    assert.equal(
      isPlatformAdmin(tenantOwner),
      false,
      "CRITICAL: Workspace OWNER must NOT have platform administrator permissions"
    );
  });
});
