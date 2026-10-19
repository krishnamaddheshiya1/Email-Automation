import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  createContactSchema,
  updateContactSchema,
  contactQuerySchema,
  bulkStatusUpdateSchema,
  bulkArchiveSchema,
} from "../lib/validations/contact.ts";
import { parseCsv, toCsv, parseCsvToObjects } from "../lib/utils/csv.ts";

test("Phase 4: Contact/Lead Management Test Suite", async (t) => {
  const { db } = createTestDb();

  // Setup sample businesses
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizAId}', 'Acme Corporation A', 'America/New_York', 'active'),
           ('${bizBId}', 'Beta Enterprises B', 'Europe/London', 'active');
  `);

  // Helper functions simulating server-side scoped repository logic
  function createScopedContact(businessId, data) {
    const validated = createContactSchema.parse(data);
    const id = crypto.randomUUID();
    const normalizedEmail = validated.email.trim().toLowerCase();

    // Check duplicate email in business
    const existing = db.public.many(
      `SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${normalizedEmail}';`
    );
    if (existing.length > 0) {
      throw new Error(`A contact with email "${normalizedEmail}" already exists.`);
    }

    db.public.none(`
      INSERT INTO leads (
        id, business_id, first_name, last_name, email, phone, company_name,
        job_title, industry, website, source, status, lead_score, metadata
      )
      VALUES (
        '${id}', '${businessId}', ${validated.first_name ? `'${validated.first_name}'` : "NULL"},
        ${validated.last_name ? `'${validated.last_name}'` : "NULL"}, '${normalizedEmail}',
        ${validated.phone ? `'${validated.phone}'` : "NULL"},
        ${validated.company_name ? `'${validated.company_name}'` : "NULL"},
        ${validated.job_title ? `'${validated.job_title}'` : "NULL"},
        ${validated.industry ? `'${validated.industry}'` : "NULL"},
        ${validated.website ? `'${validated.website}'` : "NULL"},
        '${validated.source || "manual"}', '${(validated.status || "NEW").toLowerCase()}',
        ${validated.lead_score ?? 0}, '${JSON.stringify(validated.metadata || {})}'
      );
    `);

    return db.public.one(`SELECT * FROM leads WHERE id = '${id}';`);
  }

  function getScopedContact(businessId, id) {
    const rows = db.public.many(
      `SELECT * FROM leads WHERE id = '${id}' AND business_id = '${businessId}';`
    );
    if (rows.length === 0) {
      throw new Error("Contact not found");
    }
    return rows[0];
  }

  function updateScopedContact(businessId, id, data) {
    const existing = getScopedContact(businessId, id);
    const validated = updateContactSchema.parse(data);

    if (validated.email && validated.email.toLowerCase() !== existing.email.toLowerCase()) {
      const conflict = db.public.many(
        `SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${validated.email.toLowerCase()}';`
      );
      if (conflict.length > 0) {
        throw new Error(`A contact with email "${validated.email}" already exists.`);
      }
    }

    const updates = [];
    if (validated.first_name !== undefined) updates.push(`first_name = ${validated.first_name ? `'${validated.first_name}'` : "NULL"}`);
    if (validated.last_name !== undefined) updates.push(`last_name = ${validated.last_name ? `'${validated.last_name}'` : "NULL"}`);
    if (validated.email !== undefined) updates.push(`email = '${validated.email.toLowerCase()}'`);
    if (validated.company_name !== undefined) updates.push(`company_name = ${validated.company_name ? `'${validated.company_name}'` : "NULL"}`);
    if (validated.job_title !== undefined) updates.push(`job_title = ${validated.job_title ? `'${validated.job_title}'` : "NULL"}`);
    if (validated.lead_score !== undefined) updates.push(`lead_score = ${validated.lead_score}`);
    if (validated.status !== undefined) updates.push(`status = '${validated.status.toLowerCase()}'`);
    updates.push("updated_at = NOW()");

    db.public.none(
      `UPDATE leads SET ${updates.join(", ")} WHERE id = '${id}' AND business_id = '${businessId}';`
    );

    return db.public.one(`SELECT * FROM leads WHERE id = '${id}';`);
  }

  function archiveScopedContact(businessId, id) {
    getScopedContact(businessId, id);
    db.public.none(
      `UPDATE leads SET status = 'archived', updated_at = NOW() WHERE id = '${id}' AND business_id = '${businessId}';`
    );
    return true;
  }

  function listScopedContacts(businessId, params = {}) {
    const { search = "", status = "", source = "", page = 1, limit = 10, sortBy = "created_at", sortOrder = "desc" } = params;
    let sql = `SELECT * FROM leads WHERE business_id = '${businessId}'`;

    if (search.trim()) {
      const s = search.toLowerCase();
      sql += ` AND (LOWER(COALESCE(first_name, '')) LIKE '%${s}%' OR LOWER(COALESCE(last_name, '')) LIKE '%${s}%' OR LOWER(email) LIKE '%${s}%' OR LOWER(COALESCE(company_name, '')) LIKE '%${s}%')`;
    }
    if (status.trim()) {
      sql += ` AND LOWER(status) = '${status.toLowerCase()}'`;
    }
    if (source.trim()) {
      sql += ` AND LOWER(source) = '${source.toLowerCase()}'`;
    }

    const allMatching = db.public.many(sql);
    const total = allMatching.length;
    const totalPages = Math.ceil(total / limit) || 1;

    // Sorting
    allMatching.sort((a, b) => {
      if (sortBy === "name") {
        const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        return sortOrder === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      } else if (sortBy === "lead_score") {
        return sortOrder === "asc" ? a.lead_score - b.lead_score : b.lead_score - a.lead_score;
      } else {
        return sortOrder === "asc"
          ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    const offset = (page - 1) * limit;
    const data = allMatching.slice(offset, offset + limit);

    return { data, total, page, limit, totalPages };
  }

  // 1. Contact Creation
  await t.test("1. Contact creation with valid data and schema defaults", () => {
    const contact = createScopedContact(bizAId, {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@acme.com",
      phone: "+1 555-0100",
      company_name: "Acme Partner",
      job_title: "VP Engineering",
      industry: "Technology",
      website: "https://partner.acme.com",
      source: "manual",
      status: "NEW",
      lead_score: 85,
    });

    assert.ok(contact.id, "Contact must have an auto-generated or assigned UUID");
    assert.equal(contact.business_id, bizAId);
    assert.equal(contact.first_name, "Jane");
    assert.equal(contact.last_name, "Doe");
    assert.equal(contact.email, "jane.doe@acme.com");
    assert.equal(contact.company_name, "Acme Partner");
    assert.equal(contact.lead_score, 85);
    assert.equal(contact.status, "new");
  });

  // 2. Contact Retrieval
  await t.test("2. Contact retrieval (single contact)", () => {
    const created = createScopedContact(bizAId, {
      first_name: "Alex",
      last_name: "Russo",
      email: "alex.russo@example.com",
      company_name: "Russo Corp",
      status: "CONTACTED",
      lead_score: 50,
    });

    const retrieved = getScopedContact(bizAId, created.id);
    assert.equal(retrieved.id, created.id);
    assert.equal(retrieved.email, "alex.russo@example.com");
    assert.equal(retrieved.company_name, "Russo Corp");
    assert.equal(retrieved.lead_score, 50);
  });

  // 3. Contact Update
  await t.test("3. Contact update (scoped to business)", () => {
    const created = createScopedContact(bizAId, {
      first_name: "Mark",
      last_name: "Spencer",
      email: "mark@spencer.test",
      company_name: "Old Org",
      lead_score: 20,
    });

    const updated = updateScopedContact(bizAId, created.id, {
      company_name: "New Org Global",
      job_title: "Head of Marketing",
      lead_score: 75,
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.company_name, "New Org Global");
    assert.equal(updated.job_title, "Head of Marketing");
    assert.equal(updated.lead_score, 75);
    assert.equal(updated.email, "mark@spencer.test");
  });

  // 4. Contact Archive
  await t.test("4. Contact archive (soft-delete retains record with ARCHIVED status)", () => {
    const created = createScopedContact(bizAId, {
      first_name: "Temporary",
      last_name: "Lead",
      email: "temp.lead@archive.test",
    });

    const archived = archiveScopedContact(bizAId, created.id);
    assert.ok(archived, "Archive operation must return success");

    const record = getScopedContact(bizAId, created.id);
    assert.equal(record.id, created.id);
    assert.equal(record.status, "archived", "Status must be set to archived");
  });

  // 5. Contact Search
  await t.test("5. Contact search (matches first_name, last_name, email, company)", () => {
    const searchBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${searchBiz}', 'Search Test Co', 'UTC', 'active');
    `);

    createScopedContact(searchBiz, {
      first_name: "Christopher",
      last_name: "Nolan",
      email: "director@interstellar.test",
      company_name: "Syncopy Inc",
    });

    createScopedContact(searchBiz, {
      first_name: "Hans",
      last_name: "Zimmer",
      email: "composer@music.test",
      company_name: "Remote Control Productions",
    });

    // Search by first name
    const res1 = listScopedContacts(searchBiz, { search: "Christopher" });
    assert.equal(res1.data.length, 1);
    assert.equal(res1.data[0].first_name, "Christopher");

    // Search by company
    const res2 = listScopedContacts(searchBiz, { search: "Syncopy" });
    assert.equal(res2.data.length, 1);
    assert.equal(res2.data[0].company_name, "Syncopy Inc");

    // Search by email substring
    const res3 = listScopedContacts(searchBiz, { search: "music.test" });
    assert.equal(res3.data.length, 1);
    assert.equal(res3.data[0].first_name, "Hans");
  });

  // 6. Status Filtering
  await t.test("6. Status filtering", () => {
    const statusBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${statusBiz}', 'Status Filter Co', 'UTC', 'active');
    `);

    createScopedContact(statusBiz, { email: "c1@test.com", status: "NEW" });
    createScopedContact(statusBiz, { email: "c2@test.com", status: "INTERESTED" });
    createScopedContact(statusBiz, { email: "c3@test.com", status: "INTERESTED" });

    const interested = listScopedContacts(statusBiz, { status: "INTERESTED" });
    assert.equal(interested.data.length, 2);
    for (const c of interested.data) {
      assert.equal(c.status, "interested");
    }
  });

  // 7. Source Filtering
  await t.test("7. Source filtering", () => {
    const sourceBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${sourceBiz}', 'Source Filter Co', 'UTC', 'active');
    `);

    createScopedContact(sourceBiz, { email: "manual@test.com", source: "manual" });
    createScopedContact(sourceBiz, { email: "csv@test.com", source: "csv_import" });

    const csvFiltered = listScopedContacts(sourceBiz, { source: "csv_import" });
    assert.equal(csvFiltered.data.length, 1);
    assert.equal(csvFiltered.data[0].email, "csv@test.com");
  });

  // 8. Pagination
  await t.test("8. Pagination (page, limit, total, totalPages)", () => {
    const pageBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${pageBiz}', 'Pagination Co', 'UTC', 'active');
    `);

    for (let i = 1; i <= 7; i++) {
      createScopedContact(pageBiz, {
        email: `page_lead_${i}@test.com`,
        first_name: `Lead`,
        last_name: `${i}`,
      });
    }

    // Validate query schema parsing
    const parsedQuery = contactQuerySchema.parse({ page: "1", limit: "3" });
    assert.equal(parsedQuery.page, 1);
    assert.equal(parsedQuery.limit, 3);

    // Page 1 with limit 3
    const p1 = listScopedContacts(pageBiz, { page: 1, limit: 3 });
    assert.equal(p1.total, 7);
    assert.equal(p1.totalPages, 3);
    assert.equal(p1.data.length, 3);
    assert.equal(p1.page, 1);

    // Page 3 with limit 3 (should have 1 item left)
    const p3 = listScopedContacts(pageBiz, { page: 3, limit: 3 });
    assert.equal(p3.data.length, 1);
  });

  // 9. CSV Import with Header Tolerance & Mapping
  await t.test("9. CSV import with header tolerance (company, job title, fname, etc.)", () => {
    const importBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${importBiz}', 'Import Biz', 'UTC', 'active');
    `);

    const csvData = [
      "first name,last name,email address,company,job title,lead score",
      "Bruce,Wayne,bruce@wayne-enterprises.test,Wayne Enterprises,CEO,98",
      "Diana,Prince,diana@themyscira.test,Themyscira Corp,Director,95",
    ].join("\r\n");

    const { rows } = parseCsvToObjects(csvData);
    assert.equal(rows.length, 2);

    for (const row of rows) {
      createScopedContact(importBiz, {
        first_name: row["first name"],
        last_name: row["last name"],
        email: row["email address"],
        company_name: row["company"],
        job_title: row["job title"],
        lead_score: Number(row["lead score"]),
        source: "csv_import",
      });
    }

    const contact1 = listScopedContacts(importBiz, { search: "bruce" });
    assert.equal(contact1.data.length, 1);
    assert.equal(contact1.data[0].company_name, "Wayne Enterprises");
    assert.equal(contact1.data[0].job_title, "CEO");
    assert.equal(contact1.data[0].lead_score, 98);
  });

  // 10. Duplicate Detection during Import (in-batch and existing DB)
  await t.test("10. Duplicate detection during CSV import", () => {
    const dupBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${dupBiz}', 'Duplicate Co', 'UTC', 'active');
    `);

    // Existing contact in DB
    createScopedContact(dupBiz, {
      email: "existing@dup.test",
      first_name: "Original",
    });

    const csvData = [
      "email,first_name,last_name",
      "existing@dup.test,Existing,Duplicate",
      "fresh1@dup.test,Fresh,One",
      "fresh1@dup.test,Fresh,OneDuplicate", // Duplicate inside batch
    ].join("\r\n");

    const { rows } = parseCsvToObjects(csvData);
    const seenBatch = new Set();
    const rejected = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r.email.toLowerCase();
      if (seenBatch.has(email)) {
        rejected.push({ row: i + 2, reason: "Duplicate email inside CSV batch" });
        continue;
      }
      seenBatch.add(email);

      try {
        createScopedContact(dupBiz, { email: r.email, first_name: r.first_name });
        imported++;
      } catch (err) {
        rejected.push({ row: i + 2, reason: err.message });
      }
    }

    assert.equal(imported, 1, "Only fresh1 should be successfully imported");
    assert.equal(rejected.length, 2, "Both existing DB and duplicate batch rows should be rejected");
  });

  // 11. Invalid Email Rejection
  await t.test("11. Invalid email rejection in CSV import and contact creation", () => {
    // Empty email
    assert.throws(() => {
      createContactSchema.parse({ email: "" });
    }, /email/i);

    // Malformed email
    assert.throws(() => {
      createContactSchema.parse({ email: "invalid-email-format" });
    }, /valid email/i);

    // Score out of range (> 100)
    assert.throws(() => {
      createContactSchema.parse({ email: "test@domain.com", lead_score: 150 });
    }, /lead score/i);
  });

  // 12. CSV Export with RFC-4180 Escaping
  await t.test("12. CSV export generates valid RFC-4180 CSV with quotes", () => {
    const exportBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${exportBiz}', 'Export Co', 'UTC', 'active');
    `);

    createScopedContact(exportBiz, {
      first_name: "John",
      last_name: "Smith, Jr.", // Has comma
      email: "john@smith.test",
      company_name: 'Smith & "Partners"', // Has double quotes
      job_title: "Manager",
      lead_score: 80,
    });

    const contacts = listScopedContacts(exportBiz).data;
    const headers = ["First Name", "Last Name", "Email", "Company", "Job Title", "Lead Score"];
    const rows = contacts.map((c) => [
      c.first_name,
      c.last_name,
      c.email,
      c.company_name,
      c.job_title,
      c.lead_score,
    ]);

    const csvContent = toCsv(headers, rows);
    assert.ok(csvContent.includes('"Smith, Jr."'), "Comma values must be wrapped in quotes");
    assert.ok(csvContent.includes('"Smith & ""Partners"""'), "Quotes must be escaped with double quotes");

    const parsed = parseCsv(csvContent);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1][1], "Smith, Jr.");
    assert.equal(parsed[1][3], 'Smith & "Partners"');
  });

  // 13. Multi-Tenant Business Isolation
  await t.test("13. MANDATORY Multi-Tenant Isolation between Business A and Business B", () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${tenantA}', 'Alpha Tenant', 'UTC', 'active'),
             ('${tenantB}', 'Beta Tenant', 'UTC', 'active');
    `);

    // Tenant A creates a contact
    const contactA = createScopedContact(tenantA, {
      first_name: "Secret",
      last_name: "Contact A",
      email: "shared.email@domain.test",
      company_name: "Alpha Exclusive",
    });

    // Tenant B can create the SAME email (business-scoped uniqueness)
    const contactB = createScopedContact(tenantB, {
      first_name: "Independent",
      last_name: "Contact B",
      email: "shared.email@domain.test",
      company_name: "Beta Independent",
    });

    assert.notEqual(contactA.id, contactB.id);
    assert.equal(contactA.business_id, tenantA);
    assert.equal(contactB.business_id, tenantB);

    // Tenant A queries contacts - must NOT see Tenant B contacts
    const listA = listScopedContacts(tenantA);
    assert.equal(listA.data.length, 1);
    assert.equal(listA.data[0].company_name, "Alpha Exclusive");

    // Tenant B queries contacts - must NOT see Tenant A contacts
    const listB = listScopedContacts(tenantB);
    assert.equal(listB.data.length, 1);
    assert.equal(listB.data[0].company_name, "Beta Independent");

    // Tenant B cannot access Tenant A's contact
    assert.throws(
      () => {
        getScopedContact(tenantB, contactA.id);
      },
      /Contact not found/,
      "Tenant B must NOT be able to retrieve Tenant A contact"
    );

    // Tenant B cannot update Tenant A's contact
    assert.throws(
      () => {
        updateScopedContact(tenantB, contactA.id, { first_name: "Hacked" });
      },
      /Contact not found/,
      "Tenant B must NOT be able to modify Tenant A contact"
    );

    // Tenant B cannot archive Tenant A's contact
    assert.throws(
      () => {
        archiveScopedContact(tenantB, contactA.id);
      },
      /Contact not found/,
      "Tenant B must NOT be able to archive Tenant A contact"
    );
  });

  // 14. Bulk Status Update and Bulk Archive
  await t.test("14. Bulk status update and bulk archive", () => {
    const bulkBiz = crypto.randomUUID();
    db.public.none(`
      INSERT INTO businesses (id, name, timezone, status)
      VALUES ('${bulkBiz}', 'Bulk Co', 'UTC', 'active');
    `);

    const c1 = createScopedContact(bulkBiz, { email: "b1@test.com", status: "NEW" });
    const c2 = createScopedContact(bulkBiz, { email: "b2@test.com", status: "NEW" });
    const c3 = createScopedContact(bulkBiz, { email: "b3@test.com", status: "NEW" });

    // Validate bulk status schema
    const bulkStatusVal = bulkStatusUpdateSchema.parse({
      ids: [c1.id, c2.id],
      status: "CONTACTED",
    });
    assert.equal(bulkStatusVal.status, "CONTACTED");

    // Perform bulk status update
    db.public.none(`
      UPDATE leads SET status = 'contacted', updated_at = NOW()
      WHERE business_id = '${bulkBiz}' AND id IN ('${c1.id}', '${c2.id}');
    `);

    const rec1 = getScopedContact(bulkBiz, c1.id);
    const rec2 = getScopedContact(bulkBiz, c2.id);
    const rec3 = getScopedContact(bulkBiz, c3.id);

    assert.equal(rec1.status, "contacted");
    assert.equal(rec2.status, "contacted");
    assert.equal(rec3.status, "new", "c3 was not in bulk list, should remain NEW");

    // Validate bulk archive schema
    const bulkArchiveVal = bulkArchiveSchema.parse({
      ids: [c2.id, c3.id],
    });
    assert.equal(bulkArchiveVal.ids.length, 2);

    // Perform bulk archive
    db.public.none(`
      UPDATE leads SET status = 'archived', updated_at = NOW()
      WHERE business_id = '${bulkBiz}' AND id IN ('${c2.id}', '${c3.id}');
    `);

    const rec2Archived = getScopedContact(bulkBiz, c2.id);
    const rec3Archived = getScopedContact(bulkBiz, c3.id);
    assert.equal(rec2Archived.status, "archived");
    assert.equal(rec3Archived.status, "archived");
  });
});
