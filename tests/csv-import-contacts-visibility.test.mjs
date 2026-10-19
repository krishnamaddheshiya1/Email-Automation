import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  createContactSchema,
  normalizeLeadStatus,
} from "../lib/validations/contact.ts";
import { parseCsv, DEFAULT_COLUMN_ALIASES } from "../lib/utils/csv.ts";

/**
 * REGRESSION TEST SUITE: CSV IMPORTED CONTACTS VISIBILITY & INTEGRITY
 * Verifies that:
 * 1. Manual contacts appear in /contacts
 * 2. CSV imported contacts appear in /contacts
 * 3. Status normalization handles non-standard CSV values ('TEST', 'Active', etc.)
 * 4. Tenant isolation is strictly preserved between Tenant A and Tenant B
 * 5. Dashboard totalContacts count equals active contacts in contacts list
 */
test("CSV IMPORT CONTACTS VISIBILITY & INTEGRITY SUITE", async (t) => {
  const { db } = createTestDb();

  const query = (sql) => db.public.many(sql) || [];
  const queryOne = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const execute = (sql) => db.public.none(sql);

  // Setup Tenants: Tenant A and Tenant B
  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  execute(`
    INSERT INTO businesses (id, name, created_at, updated_at)
    VALUES 
      ('${tenantAId}', 'Tenant A Workspace', NOW(), NOW()),
      ('${tenantBId}', 'Tenant B Workspace', NOW(), NOW());
  `);

  execute(`
    INSERT INTO users (id, business_id, email, full_name, role, status, created_at, updated_at)
    VALUES
      ('${userAId}', '${tenantAId}', 'admin@tenant-a.com', 'Admin A', 'admin', 'active', NOW(), NOW()),
      ('${userBId}', '${tenantBId}', 'admin@tenant-b.com', 'Admin B', 'admin', 'active', NOW(), NOW());
  `);

  // Service Simulation Helpers matching LeadRepository and ContactService
  function createManualContact(businessId, data, ownerId) {
    const validated = createContactSchema.parse(data);
    const normalizedStatus = normalizeLeadStatus(validated.status);
    const id = crypto.randomUUID();
    const normalizedEmail = validated.email.trim().toLowerCase();

    execute(`
      INSERT INTO leads (
        id, business_id, first_name, last_name, email, phone, company_name,
        job_title, industry, website, source, status, lead_score, owner_user_id, metadata, created_at, updated_at
      ) VALUES (
        '${id}', '${businessId}',
        ${validated.first_name ? `'${validated.first_name}'` : "NULL"},
        ${validated.last_name ? `'${validated.last_name}'` : "NULL"},
        '${normalizedEmail}',
        ${validated.phone ? `'${validated.phone}'` : "NULL"},
        ${validated.company_name ? `'${validated.company_name}'` : "NULL"},
        ${validated.job_title ? `'${validated.job_title}'` : "NULL"},
        NULL, NULL,
        '${data.source || "manual"}',
        '${normalizedStatus}',
        ${validated.lead_score || 0},
        ${ownerId ? `'${ownerId}'` : "NULL"},
        '{}'::jsonb,
        NOW(), NOW()
      );
    `);

    return queryOne(`SELECT * FROM leads WHERE id = '${id}';`);
  }

  function importCsvContacts(businessId, csvContent, ownerId) {
    const rows = parseCsv(csvContent);
    assert.ok(rows.length >= 2, "Must have header + data rows");

    const rawHeaders = rows[0];
    const dataRows = rows.slice(1);

    // Map column aliases
    const effectiveMapping = {};
    for (const h of rawHeaders) {
      const norm = h.toLowerCase().trim();
      if (DEFAULT_COLUMN_ALIASES[norm]) {
        effectiveMapping[h] = DEFAULT_COLUMN_ALIASES[norm];
      }
    }

    assert.ok(
      Object.values(effectiveMapping).includes("email"),
      "Email column must be mapped"
    );

    let importedCount = 0;
    const insertedLeads = [];

    for (const row of dataRows) {
      const mapped = {};
      for (let c = 0; c < rawHeaders.length; c++) {
        const header = rawHeaders[c];
        const val = (row[c] || "").trim();
        const target = effectiveMapping[header];
        if (target) {
          mapped[target] = val;
        }
      }

      if (!mapped.first_name && mapped.full_name) {
        const parts = mapped.full_name.trim().split(/\s+/);
        mapped.first_name = parts[0] || "";
        mapped.last_name = parts.slice(1).join(" ");
      }

      const rawEmail = (mapped.email || "").trim().toLowerCase();
      if (!rawEmail) continue;

      const normalizedStatus = normalizeLeadStatus(mapped.status);
      const id = crypto.randomUUID();

      execute(`
        INSERT INTO leads (
          id, business_id, first_name, last_name, email, phone, company_name,
          job_title, industry, website, source, status, lead_score, owner_user_id, metadata, created_at, updated_at
        ) VALUES (
          '${id}', '${businessId}',
          ${mapped.first_name ? `'${mapped.first_name}'` : "NULL"},
          ${mapped.last_name ? `'${mapped.last_name}'` : "NULL"},
          '${rawEmail}',
          ${mapped.phone ? `'${mapped.phone}'` : "NULL"},
          ${mapped.company_name ? `'${mapped.company_name}'` : "NULL"},
          ${mapped.job_title ? `'${mapped.job_title}'` : "NULL"},
          NULL, NULL,
          '${mapped.source || "csv_import"}',
          '${normalizedStatus}',
          0,
          ${ownerId ? `'${ownerId}'` : "NULL"},
          '{"imported_from_csv": true}'::jsonb,
          NOW(), NOW()
        );
      `);

      importedCount++;
      insertedLeads.push(queryOne(`SELECT * FROM leads WHERE id = '${id}';`));
    }

    return { totalRows: dataRows.length, importedCount, insertedLeads };
  }

  function listContacts(businessId, options = {}) {
    let whereSql = `business_id = '${businessId}'`;
    if (options.status) {
      whereSql += ` AND LOWER(status) = LOWER('${options.status}')`;
    }
    if (options.source) {
      whereSql += ` AND LOWER(source) = LOWER('${options.source}')`;
    }
    if (options.search) {
      const s = options.search.toLowerCase();
      whereSql += ` AND (LOWER(first_name) LIKE '%${s}%' OR LOWER(last_name) LIKE '%${s}%' OR LOWER(email) LIKE '%${s}%' OR LOWER(company_name) LIKE '%${s}%')`;
    }

    const countRow = queryOne(`SELECT COUNT(*)::int as count FROM leads WHERE ${whereSql};`);
    const total = Number(countRow.count);

    const page = options.page || 1;
    const limit = options.limit || 10;
    const offset = (page - 1) * limit;

    const data = query(
      `SELECT * FROM leads WHERE ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset};`
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  function getDashboardTotalContacts(businessId) {
    const res = queryOne(
      `SELECT COUNT(*) AS total FROM leads WHERE business_id = '${businessId}' AND LOWER(status) != 'archived';`
    );
    return Number(res.total || 0);
  }

  await t.test("Scenario 1: Status normalization utility sanitizes CSV status strings", () => {
    assert.equal(normalizeLeadStatus("NEW"), "NEW");
    assert.equal(normalizeLeadStatus("contacted"), "CONTACTED");
    assert.equal(normalizeLeadStatus("TEST"), "NEW"); // Non-standard status safely maps to NEW
    assert.equal(normalizeLeadStatus("active"), "NEW");
    assert.equal(normalizeLeadStatus("pending"), "NEW");
    assert.equal(normalizeLeadStatus("closed"), "ARCHIVED");
    assert.equal(normalizeLeadStatus(""), "NEW");
    assert.equal(normalizeLeadStatus(null), "NEW");
    assert.equal(normalizeLeadStatus(undefined), "NEW");
  });

  await t.test("Scenario 2: Create contact manually in Tenant A", () => {
    const manualContact = createManualContact(
      tenantAId,
      {
        first_name: "Manual",
        last_name: "Creator",
        email: "manual@email.com",
        company_name: "ManualCorp",
        job_title: "Founder",
        status: "NEW",
        source: "manual",
      },
      userAId
    );

    assert.ok(manualContact.id, "Manual contact must have ID");
    assert.equal(manualContact.email, "manual@email.com");
    assert.equal(manualContact.source, "manual");

    // Verify contact exists in listContacts for Tenant A
    const listA = listContacts(tenantAId);
    assert.equal(listA.total, 1);
    assert.equal(listA.data[0].email, "manual@email.com");
  });

  await t.test("Scenario 3: Import 2 contacts via CSV into Tenant A (with non-standard status 'TEST' & 'active')", () => {
    const csvContent = `First Name,Last Name,Email,Company,Job Title,Status,Source
Alex,Rivera,alex@email.com,AlexCorp,Engineer,TEST,Owner-controlled test
Elena,Rostova,elena@email.com,ElenaCorp,Director,active,csv_import`;

    const summary = importCsvContacts(tenantAId, csvContent, userAId);

    assert.equal(summary.totalRows, 2, "Must process 2 data rows");
    assert.equal(summary.importedCount, 2, "Must report 2 imported rows");
    assert.equal(summary.insertedLeads.length, 2, "2 leads inserted into DB");
  });

  await t.test("Scenario 4: Verify BOTH manual + CSV imported contacts are returned by listContacts", () => {
    const listA = listContacts(tenantAId, {
      page: 1,
      limit: 10,
    });

    assert.equal(listA.total, 3, "Total contacts must be exactly 3 (1 manual + 2 CSV)");
    assert.equal(listA.data.length, 3, "Returned rows must be exactly 3");

    const emails = listA.data.map((c) => c.email);
    assert.ok(emails.includes("manual@email.com"), "Must include manual contact");
    assert.ok(emails.includes("alex@email.com"), "Must include Alex (CSV)");
    assert.ok(emails.includes("elena@email.com"), "Must include Elena (CSV)");

    // Verify metadata and field mapping
    const alex = listA.data.find((c) => c.email === "alex@email.com");
    assert.equal(alex.first_name, "Alex");
    assert.equal(alex.last_name, "Rivera");
    assert.equal(alex.company_name, "AlexCorp");
    assert.equal(alex.job_title, "Engineer");
    assert.equal(alex.status.toUpperCase(), "NEW"); // 'TEST' was normalized to 'NEW'
    assert.equal(alex.source, "Owner-controlled test");

    const elena = listA.data.find((c) => c.email === "elena@email.com");
    assert.equal(elena.first_name, "Elena");
    assert.equal(elena.last_name, "Rostova");
    assert.equal(elena.company_name, "ElenaCorp");
    assert.equal(elena.status.toUpperCase(), "NEW"); // 'active' was normalized to 'NEW'
  });

  await t.test("Scenario 5: Multi-Tenant Isolation: Tenant B cannot see Tenant A's manual or imported contacts", () => {
    const listB = listContacts(tenantBId);
    assert.equal(listB.total, 0, "Tenant B must see 0 contacts");
    assert.equal(listB.data.length, 0, "Tenant B returned data must be empty");

    // Import a contact for Tenant B
    importCsvContacts(
      tenantBId,
      `name,email,company\nTenantB User,user@tenant-b.com,Stark`,
      userBId
    );

    const listBAfter = listContacts(tenantBId);
    assert.equal(listBAfter.total, 1, "Tenant B must see only its own 1 contact");
    assert.equal(listBAfter.data[0].email, "user@tenant-b.com");

    // Tenant A list remains unchanged at 3
    const listAAfter = listContacts(tenantAId);
    assert.equal(listAAfter.total, 3, "Tenant A contacts remain isolated at 3");
  });

  await t.test("Scenario 6: Dashboard totalContacts metric matches Contacts listing count", () => {
    const dashboardCount = getDashboardTotalContacts(tenantAId);
    const listA = listContacts(tenantAId);

    assert.equal(
      dashboardCount,
      listA.total,
      `Dashboard count (${dashboardCount}) must equal list count (${listA.total})`
    );
    assert.equal(dashboardCount, 3);
  });

  await t.test("Scenario 7: Search and filtering handles both manual and CSV imported contacts", () => {
    // Search by company
    const searchRes = listContacts(tenantAId, { search: "AlexCorp" });
    assert.equal(searchRes.total, 1);
    assert.equal(searchRes.data[0].email, "alex@email.com");

    // Search by name
    const searchManual = listContacts(tenantAId, { search: "Manual" });
    assert.equal(searchManual.total, 1);
    assert.equal(searchManual.data[0].email, "manual@email.com");

    // Filter by source
    const filterCsv = listContacts(tenantAId, { source: "Owner-controlled test" });
    assert.equal(filterCsv.total, 1);
    assert.equal(filterCsv.data[0].email, "alex@email.com");

    const filterManual = listContacts(tenantAId, { source: "manual" });
    assert.equal(filterManual.total, 1);
    assert.equal(filterManual.data[0].email, "manual@email.com");
  });

  await t.test("Scenario 8: Pagination calculations are consistent across manual and imported contacts", () => {
    const page1 = listContacts(tenantAId, { page: 1, limit: 2 });
    assert.equal(page1.total, 3);
    assert.equal(page1.data.length, 2);
    assert.equal(page1.totalPages, 2);

    const page2 = listContacts(tenantAId, { page: 2, limit: 2 });
    assert.equal(page2.total, 3);
    assert.equal(page2.data.length, 1);
    assert.equal(page2.totalPages, 2);

    // Verify all 3 unique IDs across pages
    const ids = new Set([...page1.data.map((c) => c.id), ...page2.data.map((c) => c.id)]);
    assert.equal(ids.size, 3, "Must have 3 unique contact IDs across page 1 and page 2");
  });
});
