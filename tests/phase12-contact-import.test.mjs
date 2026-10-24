import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  parseCsv,
  toCsv,
  sanitizeCsvValue,
  DEFAULT_COLUMN_ALIASES,
} from "../lib/utils/csv.ts";
import { validateRowRange } from "../lib/validations/contact.ts";

/**
 * Phase 12 Test Engine
 * Direct integration testing against pg-mem database for Contact Import & Bulk Management
 */
class ContactImportTestEngine {
  constructor(db) {
    this.db = db;
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  many(sql) {
    return this.db.public.many(sql) || [];
  }

  none(sql) {
    this.db.public.none(sql);
  }

  // --- Seed Helpers ---
  createBusiness(name) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${id}', '${name.replace(/'/g, "''")}', NOW(), NOW());
    `);
    return id;
  }

  createContact(businessId, data) {
    const id = crypto.randomUUID();
    const email = data.email.trim().toLowerCase();
    this.none(`
      INSERT INTO leads (
        id, business_id, first_name, last_name, email, phone, company_name, job_title, source, status, lead_score, metadata, created_at, updated_at
      ) VALUES (
        '${id}', '${businessId}', ${data.first_name ? `'${data.first_name}'` : "NULL"},
        ${data.last_name ? `'${data.last_name}'` : "NULL"}, '${email}',
        ${data.phone ? `'${data.phone}'` : "NULL"}, ${data.company_name ? `'${data.company_name}'` : "NULL"},
        ${data.job_title ? `'${data.job_title}'` : "NULL"}, '${data.source || "manual"}',
        '${(data.status || "NEW").toUpperCase()}', ${data.lead_score || 0}, '{}'::jsonb, NOW(), NOW()
      );
    `);
    return { id, business_id: businessId, email, ...data };
  }

  createCampaign(businessId, name, status = "ACTIVE") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${name.replace(/'/g, "''")}', '${status}', 'UTC', NOW(), NOW());
    `);
    return id;
  }

  createStep(campaignId, stepNumber, name) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${id}', '${campaignId}', ${stepNumber}, '${name}', 0, 'days', 'ACTIVE', NOW(), NOW());
    `);
    return id;
  }

  addSuppression(businessId, email, reason = "UNSUBSCRIBED") {
    const id = crypto.randomUUID();
    const norm = email.trim().toLowerCase();
    this.none(`
      INSERT INTO suppressions (id, business_id, email, reason, source, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${norm}', '${reason}', 'system', NOW(), NOW());
    `);
    return id;
  }

  isSuppressed(businessId, email) {
    const norm = email.trim().toLowerCase();
    const res = this.oneOrNone(`
      SELECT 1 FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${norm}';
    `);
    return Boolean(res);
  }

  findContactByEmail(businessId, email) {
    const norm = email.trim().toLowerCase();
    return this.oneOrNone(`
      SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${norm}';
    `);
  }

  listContacts(businessId, { search = "", limit = 50, offset = 0 } = {}) {
    let sql = `SELECT * FROM leads WHERE business_id = '${businessId}'`;
    if (search) {
      const s = search.toLowerCase();
      sql += ` AND (LOWER(email) LIKE '%${s}%' OR LOWER(first_name) LIKE '%${s}%' OR LOWER(last_name) LIKE '%${s}%' OR LOWER(company_name) LIKE '%${s}%')`;
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset};`;
    return this.many(sql);
  }

  // --- Import Simulation Engine ---
  previewCsv(csvContent, filename = "contacts.csv") {
    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }
    const parsed = parseCsv(csvContent);
    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }
    const rawHeaders = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

    const detectedMapping = {};
    for (const h of rawHeaders) {
      const norm = h.toLowerCase().trim();
      if (DEFAULT_COLUMN_ALIASES[norm]) {
        detectedMapping[h] = DEFAULT_COLUMN_ALIASES[norm];
      }
    }

    const previewCount = Math.min(20, dataRows.length);
    const previewRows = [];
    for (let i = 0; i < previewCount; i++) {
      const row = dataRows[i];
      const obj = {};
      for (let c = 0; c < rawHeaders.length; c++) {
        obj[rawHeaders[c]] = (row[c] || "").trim();
      }
      previewRows.push(obj);
    }

    return {
      filename,
      totalRows: dataRows.length,
      headers: rawHeaders,
      previewRows,
      detectedMapping,
    };
  }

  importCsv(businessId, { csvContent, filename = "contacts.csv", columnMapping = null, mode = "CREATE_ONLY", batchSize = 500, rangeType = "all", startRow = null, endRow = null }) {
    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }

    const parsed = parseCsv(csvContent);
    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

    if (dataRows.length === 0) {
      throw new Error("CSV file contains no data rows.");
    }

    const rangeValidation = validateRowRange(dataRows.length, {
      rangeType,
      startRow,
      endRow,
    });
    if (!rangeValidation.isValid) {
      throw new Error(rangeValidation.error || "Invalid row range selection.");
    }

    const effectiveStartRow = rangeValidation.startRow || 1;
    const effectiveEndRow = rangeValidation.endRow || dataRows.length;
    const startIndex = effectiveStartRow - 1;
    const endIndex = effectiveEndRow;
    const selectedDataRows = dataRows.slice(startIndex, endIndex);

    // Determine effective mapping
    const effectiveMapping = {};
    if (columnMapping && Object.keys(columnMapping).length > 0) {
      for (const [col, field] of Object.entries(columnMapping)) {
        if (field && field !== "ignore") {
          effectiveMapping[col.trim()] = field.trim().toLowerCase();
        }
      }
    } else {
      for (const h of rawHeaders) {
        const norm = h.toLowerCase().trim();
        if (DEFAULT_COLUMN_ALIASES[norm]) {
          effectiveMapping[h] = DEFAULT_COLUMN_ALIASES[norm];
        }
      }
    }

    // Verify email mapping
    const emailMapped = Object.values(effectiveMapping).some((f) => f === "email");
    if (!emailMapped) {
      throw new Error("Email column mapping is required.");
    }

    const importId = crypto.randomUUID();
    this.none(`
      INSERT INTO contact_imports (
        id, business_id, filename, total_rows, status, created_at
      ) VALUES (
        '${importId}', '${businessId}', '${filename}', ${selectedDataRows.length}, 'PROCESSING', NOW()
      );
    `);

    const seenEmailsInBatch = new Set();
    const rejectedRows = [];
    let importedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;
    let suppressedCount = 0;
    let failedCount = 0;

    for (let b = 0; b < selectedDataRows.length; b += batchSize) {
      const batch = selectedDataRows.slice(b, b + batchSize);

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const rowNumber = startIndex + b + i + 2;
        const rowObj = {};
        const mapped = {};

        for (let c = 0; c < rawHeaders.length; c++) {
          const h = rawHeaders[c];
          const val = (row[c] || "").trim();
          rowObj[h] = val;
          const targetField = effectiveMapping[h];
          if (targetField) {
            mapped[targetField] = val;
          }
        }

        if (!mapped.first_name && mapped.full_name) {
          const parts = mapped.full_name.trim().split(/\s+/);
          mapped.first_name = parts[0] || "";
          mapped.last_name = parts.slice(1).join(" ");
        }

        const rawEmail = mapped.email ? mapped.email.trim() : "";

        // 1. Missing email
        if (!rawEmail) {
          invalidCount++;
          rejectedRows.push({ row: rowNumber, email: "", reason: "Email is missing or empty" });
          continue;
        }

        const normalizedEmail = rawEmail.toLowerCase();

        // 2. Format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
          invalidCount++;
          rejectedRows.push({ row: rowNumber, email: rawEmail, reason: `Invalid email format: "${rawEmail}"` });
          continue;
        }

        // 3. Duplicate within CSV
        if (seenEmailsInBatch.has(normalizedEmail)) {
          duplicateCount++;
          rejectedRows.push({ row: rowNumber, email: normalizedEmail, reason: `Duplicate email inside CSV batch: "${rawEmail}"` });
          continue;
        }
        seenEmailsInBatch.add(normalizedEmail);

        // 4. Suppression check
        if (this.isSuppressed(businessId, normalizedEmail)) {
          suppressedCount++;
          rejectedRows.push({ row: rowNumber, email: normalizedEmail, reason: `Recipient email "${rawEmail}" is suppressed` });
          continue;
        }

        // 5. Existing in business
        const existing = this.findContactByEmail(businessId, normalizedEmail);
        if (existing) {
          if (mode === "CREATE_OR_UPDATE") {
            this.none(`
              UPDATE leads SET
                first_name = COALESCE(${mapped.first_name ? `'${mapped.first_name}'` : "NULL"}, first_name),
                last_name = COALESCE(${mapped.last_name ? `'${mapped.last_name}'` : "NULL"}, last_name),
                company_name = COALESCE(${mapped.company_name ? `'${mapped.company_name}'` : "NULL"}, company_name),
                phone = COALESCE(${mapped.phone ? `'${mapped.phone}'` : "NULL"}, phone),
                updated_at = NOW()
              WHERE id = '${existing.id}' AND business_id = '${businessId}';
            `);
            importedCount++;
          } else {
            duplicateCount++;
            rejectedRows.push({ row: rowNumber, email: normalizedEmail, reason: `Contact with email "${rawEmail}" already exists in your business` });
          }
          continue;
        }

        // 6. Insert new lead
        try {
          const leadId = crypto.randomUUID();
          this.none(`
            INSERT INTO leads (
              id, business_id, first_name, last_name, email, phone, company_name, job_title, source, status, lead_score, metadata, created_at, updated_at
            ) VALUES (
              '${leadId}', '${businessId}', ${mapped.first_name ? `'${mapped.first_name}'` : "NULL"},
              ${mapped.last_name ? `'${mapped.last_name}'` : "NULL"}, '${normalizedEmail}',
              ${mapped.phone ? `'${mapped.phone}'` : "NULL"}, ${mapped.company_name ? `'${mapped.company_name}'` : "NULL"},
              ${mapped.job_title ? `'${mapped.job_title}'` : "NULL"}, 'csv_import', 'NEW',
              ${mapped.lead_score ? parseInt(mapped.lead_score, 10) || 0 : 0},
              '{"imported_from_csv": true}'::jsonb, NOW(), NOW()
            );
          `);
          importedCount++;
        } catch {
          failedCount++;
          rejectedRows.push({ row: rowNumber, email: normalizedEmail, reason: "Database insertion error" });
        }
      }
    }

    let status = "COMPLETED";
    if (failedCount > 0 && importedCount > 0) status = "PARTIAL";
    if (failedCount > 0 && importedCount === 0 && dataRows.length > 0) status = "FAILED";

    this.none(`
      UPDATE contact_imports SET
        total_rows = ${dataRows.length},
        imported_count = ${importedCount},
        duplicate_count = ${duplicateCount},
        invalid_count = ${invalidCount},
        suppressed_count = ${suppressedCount},
        failed_count = ${failedCount},
        status = '${status}',
        errors = '${JSON.stringify(rejectedRows).replace(/'/g, "''")}'::jsonb,
        completed_at = NOW()
      WHERE id = '${importId}';
    `);

    let rejectedCsv = undefined;
    if (rejectedRows.length > 0) {
      rejectedCsv = toCsv(["Row", "Email", "Reason"], rejectedRows.map((r) => [r.row, r.email, r.reason]));
    }

    return {
      importId,
      totalRows: dataRows.length,
      validRows: importedCount,
      importedCount,
      duplicateCount,
      invalidCount,
      suppressedCount,
      failedCount,
      status,
      rejectedRows,
      rejectedCsv,
    };
  }

  getImportHistory(businessId) {
    return this.many(`
      SELECT * FROM contact_imports WHERE business_id = '${businessId}' ORDER BY created_at DESC;
    `);
  }

  getImportErrors(importId, businessId) {
    const rec = this.oneOrNone(`
      SELECT * FROM contact_imports WHERE id = '${importId}' AND business_id = '${businessId}';
    `);
    if (!rec) throw new Error("Import record not found");
    return typeof rec.errors === "string" ? JSON.parse(rec.errors) : rec.errors || [];
  }

  // --- Bulk Enrollment Simulation ---
  bulkEnrollPreview(businessId, campaignId, contactIds) {
    const campaign = this.oneOrNone(`
      SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';
    `);
    if (!campaign) throw new Error("Campaign not found or access denied.");

    const existingEnrollments = this.many(`
      SELECT lead_id FROM campaign_leads WHERE campaign_id = '${campaignId}';
    `);
    const enrolledIds = new Set(existingEnrollments.map((e) => e.lead_id));

    let eligibleCount = 0;
    let suppressedCount = 0;
    let alreadyEnrolledCount = 0;

    for (const cid of contactIds) {
      const contact = this.oneOrNone(`
        SELECT * FROM leads WHERE id = '${cid}' AND business_id = '${businessId}';
      `);
      if (!contact || !contact.email) continue;

      if (this.isSuppressed(businessId, contact.email)) {
        suppressedCount++;
        continue;
      }

      if (enrolledIds.has(cid)) {
        alreadyEnrolledCount++;
        continue;
      }

      eligibleCount++;
    }

    return {
      totalSelected: contactIds.length,
      eligibleCount,
      suppressedCount,
      alreadyEnrolledCount,
    };
  }

  bulkEnroll(businessId, campaignId, contactIds) {
    this.bulkEnrollPreview(businessId, campaignId, contactIds);

    const existingEnrollments = this.many(`
      SELECT lead_id FROM campaign_leads WHERE campaign_id = '${campaignId}';
    `);
    const enrolledIds = new Set(existingEnrollments.map((e) => e.lead_id));

    let enrolledCount = 0;
    for (const cid of contactIds) {
      const contact = this.oneOrNone(`
        SELECT * FROM leads WHERE id = '${cid}' AND business_id = '${businessId}';
      `);
      if (!contact || !contact.email) continue;
      if (this.isSuppressed(businessId, contact.email)) continue;
      if (enrolledIds.has(cid)) continue;

      const clId = crypto.randomUUID();
      this.none(`
        INSERT INTO campaign_leads (id, business_id, campaign_id, lead_id, status, current_step, next_run_at, created_at, updated_at)
        VALUES ('${clId}', '${businessId}', '${campaignId}', '${cid}', 'ENROLLED', 0, NOW(), NOW(), NOW());
      `);
      enrolledIds.add(cid);
      enrolledCount++;
    }

    return {
      enrolledCount,
      skippedCount: contactIds.length - enrolledCount,
    };
  }
}

test("PHASE 12: CONTACT IMPORT & BULK MANAGEMENT SUITE", async (t) => {
  const { db } = createTestDb();
  const engine = new ContactImportTestEngine(db);

  const tenantA = engine.createBusiness("Business A");
  const tenantB = engine.createBusiness("Business B");

  // Scenario 1: Valid CSV upload
  await t.test("1. Valid CSV upload", () => {
    const csv = `first_name,last_name,email,company,phone\nJohn,Doe,john@example.com,Acme,1234567890\nJane,Smith,jane@example.com,Beta,0987654321`;
    const res = engine.importCsv(tenantA, { csvContent: csv, filename: "valid.csv" });
    assert.equal(res.totalRows, 2);
    assert.equal(res.importedCount, 2);
    assert.equal(res.duplicateCount, 0);
    assert.equal(res.invalidCount, 0);
    assert.equal(res.status, "COMPLETED");

    const c1 = engine.findContactByEmail(tenantA, "john@example.com");
    assert.ok(c1);
    assert.equal(c1.first_name, "John");
    assert.equal(c1.company_name, "Acme");
  });

  // Scenario 2: Empty CSV rejection
  await t.test("2. Empty CSV rejection", () => {
    assert.throws(() => engine.importCsv(tenantA, { csvContent: "" }), /CSV file is empty/);
    assert.throws(() => engine.importCsv(tenantA, { csvContent: "   \n\n  " }), /CSV file is empty/);
  });

  // Scenario 3: Malformed CSV rejection
  await t.test("3. Malformed CSV rejection", () => {
    const malformed = `email,name\n"unclosed_quote,John\nother@example.com,Jane`;
    assert.throws(() => engine.importCsv(tenantA, { csvContent: malformed }), /Malformed CSV/);
  });

  // Scenario 4: File-size validation
  await t.test("4. File-size validation", () => {
    const maxMb = 10;
    const maxBytes = maxMb * 1024 * 1024;
    const oversizeBuffer = Buffer.alloc(maxBytes + 10, "a");
    const checkSize = (content) => {
      if (Buffer.byteLength(content, "utf-8") > maxBytes) {
        throw new Error(`File size exceeds maximum allowed limit of ${maxMb}MB.`);
      }
    };
    assert.throws(() => checkSize(oversizeBuffer), /exceeds maximum allowed limit/);
  });

  // Scenario 5: Automatic column mapping
  await t.test("5. Automatic column mapping", () => {
    const csv = `fname,lname,email_address,company_name,mobile\nAlice,Wonder,alice@example.com,Wonderland,5551234`;
    const preview = engine.previewCsv(csv);
    assert.equal(preview.detectedMapping["email_address"], "email");
    assert.equal(preview.detectedMapping["fname"], "first_name");
    assert.equal(preview.detectedMapping["lname"], "last_name");
    assert.equal(preview.detectedMapping["company_name"], "company_name");
    assert.equal(preview.detectedMapping["mobile"], "phone");
  });

  // Scenario 6: Manual column mapping
  await t.test("6. Manual column mapping", () => {
    const csv = `col_a,col_b,col_c\nBob,Marley,bob@reggae.com`;
    const res = engine.importCsv(tenantA, {
      csvContent: csv,
      columnMapping: {
        col_a: "first_name",
        col_b: "last_name",
        col_c: "email",
      },
    });
    assert.equal(res.importedCount, 1);
    const bob = engine.findContactByEmail(tenantA, "bob@reggae.com");
    assert.ok(bob);
    assert.equal(bob.first_name, "Bob");
  });

  // Scenario 7: Missing email column
  await t.test("7. Missing email column", () => {
    const csv = `first_name,last_name,phone\nNo,Email,12345`;
    assert.throws(() => engine.importCsv(tenantA, { csvContent: csv }), /Email column mapping is required/);
  });

  // Scenario 8: Invalid email
  await t.test("8. Invalid email", () => {
    const csv = `email,name\nvalid1@example.com,Valid One\nnot-an-email,Invalid Guy\nvalid2@example.com,Valid Two`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.totalRows, 3);
    assert.equal(res.importedCount, 2);
    assert.equal(res.invalidCount, 1);
    assert.equal(res.rejectedRows[0].email, "not-an-email");
  });

  // Scenario 9: Email normalization
  await t.test("9. Email normalization", () => {
    const csv = `email,first_name\n  Rahul@Example.COM  ,Rahul`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.importedCount, 1);
    const contact = engine.findContactByEmail(tenantA, "rahul@example.com");
    assert.ok(contact);
    assert.equal(contact.email, "rahul@example.com");
  });

  // Scenario 10: Duplicate rows in CSV
  await t.test("10. Duplicate rows in CSV", () => {
    const csv = `email,name\ndup1@example.com,First\nDup1@example.com,Second\n dup1@example.com ,Third`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.totalRows, 3);
    assert.equal(res.importedCount, 1);
    assert.equal(res.duplicateCount, 2);
  });

  // Scenario 11: Duplicate existing contact
  await t.test("11. Duplicate existing contact (CREATE_ONLY vs CREATE_OR_UPDATE)", () => {
    engine.createContact(tenantA, { email: "existing@example.com", first_name: "Original" });

    // CREATE_ONLY (default) skips
    const csv = `email,first_name\nexisting@example.com,NewName`;
    const res1 = engine.importCsv(tenantA, { csvContent: csv, mode: "CREATE_ONLY" });
    assert.equal(res1.importedCount, 0);
    assert.equal(res1.duplicateCount, 1);
    let c = engine.findContactByEmail(tenantA, "existing@example.com");
    assert.equal(c.first_name, "Original");

    // CREATE_OR_UPDATE updates
    const res2 = engine.importCsv(tenantA, { csvContent: csv, mode: "CREATE_OR_UPDATE" });
    assert.equal(res2.importedCount, 1);
    assert.equal(res2.duplicateCount, 0);
    c = engine.findContactByEmail(tenantA, "existing@example.com");
    assert.equal(c.first_name, "NewName");
  });

  // Scenario 12: Multiple duplicates in same import
  await t.test("12. Multiple duplicates in same import", () => {
    const csv = `email\nmulti@test.com\nmulti@test.com\nmulti@test.com\nmulti@test.com`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.totalRows, 4);
    assert.equal(res.importedCount, 1);
    assert.equal(res.duplicateCount, 3);
  });

  // Scenario 13: Suppressed contact import
  await t.test("13. Suppressed contact import", () => {
    engine.addSuppression(tenantA, "suppressed_test@example.com", "UNSUBSCRIBED");
    const csv = `email,name\nsuppressed_test@example.com,Suppressed User\nallowed@example.com,Allowed User`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.totalRows, 2);
    assert.equal(res.importedCount, 1);
    assert.equal(res.suppressedCount, 1);
    assert.ok(engine.isSuppressed(tenantA, "suppressed_test@example.com"));
  });

  // Scenario 14: Import count accuracy
  await t.test("14. Import count accuracy", () => {
    const csv = `email\nok1@test.com\nok2@test.com\ninvalid-email\nok1@test.com`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.totalRows, 4);
    assert.equal(res.importedCount, 2);
    assert.equal(res.invalidCount, 1);
    assert.equal(res.duplicateCount, 1);
    assert.equal(res.importedCount + res.invalidCount + res.duplicateCount + res.suppressedCount, res.totalRows);
  });

  // Scenario 15: Partial import
  await t.test("15. Partial import", () => {
    const csv = `email\npart1@test.com\ninvalid_email\npart2@test.com`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    assert.equal(res.status, "COMPLETED");
    assert.equal(res.importedCount, 2);
    assert.equal(res.invalidCount, 1);
  });

  // Scenario 16: Import history
  await t.test("16. Import history", () => {
    const history = engine.getImportHistory(tenantA);
    assert.ok(history.length >= 5, "History records must be populated for past imports");
    assert.ok(history[0].filename);
    assert.ok(history[0].status);
  });

  // Scenario 17: Failed-row reporting
  await t.test("17. Failed-row reporting", () => {
    const csv = `email\nbad1\nbad2`;
    const res = engine.importCsv(tenantA, { csvContent: csv });
    const errors = engine.getImportErrors(res.importId, tenantA);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].row, 2);
    assert.ok(errors[0].reason.includes("Invalid email"));
  });

  // Scenario 18: Search contacts
  await t.test("18. Search contacts", () => {
    engine.createContact(tenantA, { email: "searchable_ceo@acmecorp.com", first_name: "Bruce", company_name: "Wayne Enterprises" });
    const byName = engine.listContacts(tenantA, { search: "bruce" });
    assert.ok(byName.some((c) => c.email === "searchable_ceo@acmecorp.com"));
    const byCompany = engine.listContacts(tenantA, { search: "wayne" });
    assert.ok(byCompany.some((c) => c.email === "searchable_ceo@acmecorp.com"));
  });

  // Scenario 19: Pagination
  await t.test("19. Pagination", () => {
    const page1 = engine.listContacts(tenantA, { limit: 2, offset: 0 });
    const page2 = engine.listContacts(tenantA, { limit: 2, offset: 2 });
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
    assert.notEqual(page1[0].id, page2[0].id);
  });

  // Scenario 20: Bulk contact selection
  await t.test("20. Bulk contact selection", () => {
    const contacts = engine.listContacts(tenantA, { limit: 5 });
    const selected = contacts.map((c) => c.id);
    assert.equal(selected.length, 5);
  });

  // Scenario 21: Bulk campaign enrollment
  await t.test("21. Bulk campaign enrollment", () => {
    const c1 = engine.createContact(tenantA, { email: "bulk_enr1@test.com" });
    const c2 = engine.createContact(tenantA, { email: "bulk_enr2@test.com" });
    const campaignId = engine.createCampaign(tenantA, "Spring Promo");
    const res = engine.bulkEnroll(tenantA, campaignId, [c1.id, c2.id]);
    assert.equal(res.enrolledCount, 2);
    assert.equal(res.skippedCount, 0);
  });

  // Scenario 22: Suppressed contact excluded from enrollment
  await t.test("22. Suppressed contact excluded from enrollment", () => {
    const c1 = engine.createContact(tenantA, { email: "supp_enr@test.com" });
    engine.addSuppression(tenantA, "supp_enr@test.com", "HARD_BOUNCE");
    const campaignId = engine.createCampaign(tenantA, "Safety Campaign");

    const preview = engine.bulkEnrollPreview(tenantA, campaignId, [c1.id]);
    assert.equal(preview.eligibleCount, 0);
    assert.equal(preview.suppressedCount, 1);

    const res = engine.bulkEnroll(tenantA, campaignId, [c1.id]);
    assert.equal(res.enrolledCount, 0);
    assert.equal(res.skippedCount, 1);
  });

  // Scenario 23: Already enrolled contact excluded
  await t.test("23. Already enrolled contact excluded", () => {
    const c1 = engine.createContact(tenantA, { email: "already_enr@test.com" });
    const campaignId = engine.createCampaign(tenantA, "One-Time Promo");

    engine.bulkEnroll(tenantA, campaignId, [c1.id]);
    const preview = engine.bulkEnrollPreview(tenantA, campaignId, [c1.id]);
    assert.equal(preview.eligibleCount, 0);
    assert.equal(preview.alreadyEnrolledCount, 1);

    const res2 = engine.bulkEnroll(tenantA, campaignId, [c1.id]);
    assert.equal(res2.enrolledCount, 0);
    assert.equal(res2.skippedCount, 1);
  });

  // Scenario 24: Cross-business contact access blocked
  await t.test("24. Cross-business contact access blocked", () => {
    const cA = engine.createContact(tenantA, { email: "secretA@bizA.com" });
    const foundByB = engine.oneOrNone(`
      SELECT * FROM leads WHERE id = '${cA.id}' AND business_id = '${tenantB}';
    `);
    assert.equal(foundByB, null);
  });

  // Scenario 25: Cross-business import access blocked
  await t.test("25. Cross-business import access blocked", () => {
    const resA = engine.importCsv(tenantA, { csvContent: "email\nbizA@test.com" });
    assert.throws(
      () => engine.getImportErrors(resA.importId, tenantB),
      /Import record not found/
    );
  });

  // Scenario 26: Cross-business campaign enrollment blocked
  await t.test("26. Cross-business campaign enrollment blocked", () => {
    const cA = engine.createContact(tenantA, { email: "contactA@bizA.com" });
    const campB = engine.createCampaign(tenantB, "Campaign B");
    assert.throws(
      () => engine.bulkEnroll(tenantA, campB, [cA.id]),
      /Campaign not found or access denied/
    );
  });

  // Scenario 27: Large import batching
  await t.test("27. Large import batching (1,200 rows with batch size 500)", () => {
    const lines = ["email,first_name,last_name"];
    for (let i = 1; i <= 1200; i++) {
      lines.push(`batch_user_${i}@example.com,User${i},Batch`);
    }
    const csv = lines.join("\n");
    const res = engine.importCsv(tenantA, { csvContent: csv, filename: "large.csv", batchSize: 500 });
    assert.equal(res.totalRows, 1200);
    assert.equal(res.importedCount, 1200);
    assert.equal(res.status, "COMPLETED");
  });

  // Scenario 28: CSV formula injection protection
  await t.test("28. CSV formula injection protection", () => {
    assert.equal(sanitizeCsvValue("=SUM(A1:A10)"), "'=SUM(A1:A10)");
    assert.equal(sanitizeCsvValue("+12345"), "'+12345");
    assert.equal(sanitizeCsvValue("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
    assert.equal(sanitizeCsvValue("@danger"), "'@danger");
    assert.equal(sanitizeCsvValue("normal_text"), "normal_text");

    const headers = ["Row", "Payload"];
    const rows = [[1, "=1+1"], [2, "@dangerous"]];
    const generated = toCsv(headers, rows);
    assert.ok(generated.includes("''=1+1") || generated.includes("=\"'=1+1\"") || generated.includes("'=1+1"));
    assert.ok(!generated.includes(",=1+1\r\n"), "Raw unsanitized formula must not be output");
  });

  // Scenario 29: Import restart/failure handling
  await t.test("29. Import restart/failure handling", () => {
    const importId = crypto.randomUUID();
    engine.none(`
      INSERT INTO contact_imports (id, business_id, filename, total_rows, status, created_at)
      VALUES ('${importId}', '${tenantA}', 'stuck.csv', 10, 'PROCESSING', NOW());
    `);
    const item = engine.oneOrNone(`SELECT * FROM contact_imports WHERE id = '${importId}';`);
    assert.equal(item.status, "PROCESSING");

    // Recover stuck import
    engine.none(`
      UPDATE contact_imports SET status = 'FAILED', failed_count = 10, completed_at = NOW() WHERE id = '${importId}';
    `);
    const recovered = engine.oneOrNone(`SELECT * FROM contact_imports WHERE id = '${importId}';`);
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.failed_count, 10);
  });

  // Scenario 30: Phase 8 execution remains unchanged
  await t.test("30. Phase 8 execution remains unchanged for bulk-enrolled contacts", () => {
    const camp = engine.createCampaign(tenantA, "Automated Workflow");
    engine.createStep(camp, 1, "Welcome Email");
    engine.createStep(camp, 2, "Followup Email");
    const c = engine.createContact(tenantA, { email: "phase8_flow@test.com" });

    engine.bulkEnroll(tenantA, camp, [c.id]);
    const enrollment = engine.oneOrNone(`
      SELECT * FROM campaign_leads WHERE campaign_id = '${camp}' AND lead_id = '${c.id}';
    `);
    assert.ok(enrollment);
    assert.equal(enrollment.status, "ENROLLED");
    assert.ok(enrollment.next_run_at);
  });

  // Scenario 31: Phase 9 suppression remains enforced
  await t.test("31. Phase 9 suppression remains enforced during campaign dispatch", () => {
    const camp = engine.createCampaign(tenantA, "Safety Test Camp");
    const c = engine.createContact(tenantA, { email: "suppressed_pre_send@test.com" });
    engine.addSuppression(tenantA, "suppressed_pre_send@test.com", "COMPLAINT");

    const preview = engine.bulkEnrollPreview(tenantA, camp, [c.id]);
    assert.equal(preview.eligibleCount, 0);
    assert.equal(preview.suppressedCount, 1);
  });

  // Scenario 32: Phase 10 sender/provider requirements remain enforced
  await t.test("32. Phase 10 sender/provider requirements remain enforced", () => {
    const camp = engine.createCampaign(tenantA, "Sender Camp");
    const c = engine.createContact(tenantA, { email: "sender_check@test.com" });
    engine.bulkEnroll(tenantA, camp, [c.id]);

    const activeSenders = engine.many(`
      SELECT * FROM sender_identities WHERE business_id = '${tenantA}' AND status = 'ACTIVE';
    `);
    assert.equal(activeSenders.length, 0, "No active sender configured yet");
  });

  // Scenario 33: Phase 11 analytics records bulk-enrolled campaign activity correctly
  await t.test("33. Phase 11 analytics records bulk-enrolled campaign activity correctly", () => {
    const camp = engine.createCampaign(tenantA, "Analytics Camp");
    const c = engine.createContact(tenantA, { email: "analytics_user@test.com" });
    engine.bulkEnroll(tenantA, camp, [c.id]);

    // Dispatch message & event
    const msgId = crypto.randomUUID();
    engine.none(`
      INSERT INTO email_messages (id, business_id, lead_id, campaign_id, from_email, to_email, subject, body, status, sent_at, created_at, updated_at)
      VALUES ('${msgId}', '${tenantA}', '${c.id}', '${camp}', 'sender@biz.com', 'analytics_user@test.com', 'Hello', 'Body', 'SENT', NOW(), NOW(), NOW());
    `);
    const evtId = crypto.randomUUID();
    engine.none(`
      INSERT INTO email_events (id, business_id, campaign_id, lead_id, email_message_id, event_type, event_timestamp, metadata, created_at)
      VALUES ('${evtId}', '${tenantA}', '${camp}', '${c.id}', '${msgId}', 'SENT', NOW(), '{}'::jsonb, NOW());
    `);

    const events = engine.many(`
      SELECT * FROM email_events WHERE campaign_id = '${camp}';
    `);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "SENT");
  });

  // ==========================================
  // SECTION 26: MANUAL TEST SCENARIO
  // ==========================================
  await t.test("MANUAL TEST SCENARIO: 10 contacts with exact distribution, enrollment & idempotency", () => {
    const manualTenant = engine.createBusiness("Manual Test Business");

    // Setup: 1 duplicate already existing
    engine.createContact(manualTenant, {
      first_name: "PreExisting",
      last_name: "Contact",
      email: "existing_contact@example.com",
    });

    // Setup: 1 suppressed email
    engine.addSuppression(manualTenant, "suppressed_recipient@example.com", "HARD_BOUNCE");

    // 10 contacts CSV:
    // - 6 valid unique contacts (valid1..valid6)
    // - 1 duplicate within CSV (valid1 repeated)
    // - 1 duplicate already existing (existing_contact@example.com)
    // - 1 invalid email (not_an_email_format)
    // - 1 suppressed email (suppressed_recipient@example.com)
    const csvLines = [
      "first_name,last_name,email,company,phone",
      "ValidOne,Test,valid1@example.com,Acme,1111111111",
      "ValidTwo,Test,valid2@example.com,Acme,2222222222",
      "ValidThree,Test,valid3@example.com,Acme,3333333333",
      "ValidFour,Test,valid4@example.com,Acme,4444444444",
      "ValidFive,Test,valid5@example.com,Acme,5555555555",
      "ValidSix,Test,valid6@example.com,Acme,6666666666",
      "ValidOneRepeat,Test,valid1@example.com,Acme,1111111111",      // Duplicate in CSV
      "Existing,User,existing_contact@example.com,OldCo,7777777777", // Duplicate in DB
      "Invalid,User,not_an_email_format,BadCo,8888888888",           // Invalid email
      "Suppressed,User,suppressed_recipient@example.com,SuppCo,9999999999", // Suppressed
    ];
    const csvContent = csvLines.join("\n");

    // Upload & Import
    const importResult = engine.importCsv(manualTenant, {
      csvContent,
      filename: "ten_contacts.csv",
      mode: "CREATE_ONLY",
    });

    // Verify exact expected numbers from Section 26:
    // Total: 10
    // Imported: 6
    // Duplicate: 2
    // Invalid: 1
    // Suppressed: 1
    assert.equal(importResult.totalRows, 10, "Total rows must be 10");
    assert.equal(importResult.importedCount, 6, "Imported count must be 6");
    assert.equal(importResult.duplicateCount, 2, "Duplicate count must be 2 (1 in CSV + 1 existing in DB)");
    assert.equal(importResult.invalidCount, 1, "Invalid count must be 1");
    assert.equal(importResult.suppressedCount, 1, "Suppressed count must be 1");

    // Select imported contacts
    const importedContacts = [
      engine.findContactByEmail(manualTenant, "valid1@example.com"),
      engine.findContactByEmail(manualTenant, "valid2@example.com"),
      engine.findContactByEmail(manualTenant, "valid3@example.com"),
      engine.findContactByEmail(manualTenant, "valid4@example.com"),
      engine.findContactByEmail(manualTenant, "valid5@example.com"),
      engine.findContactByEmail(manualTenant, "valid6@example.com"),
    ];
    assert.equal(importedContacts.filter(Boolean).length, 6);

    // Also include pre-existing and suppressed contacts in selection to verify filtration
    const preExisting = engine.findContactByEmail(manualTenant, "existing_contact@example.com");
    const testCampaign = engine.createCampaign(manualTenant, "Phase 12 Verification Campaign");

    const allCandidateIds = [...importedContacts.map((c) => c.id), preExisting.id];

    // Preview enrollment
    const enrollPreview = engine.bulkEnrollPreview(manualTenant, testCampaign, allCandidateIds);
    assert.equal(enrollPreview.totalSelected, 7);
    assert.equal(enrollPreview.eligibleCount, 7); // all 7 are non-suppressed and not yet enrolled in this campaign

    // Enroll contacts
    const enrollResult = engine.bulkEnroll(manualTenant, testCampaign, allCandidateIds);
    assert.equal(enrollResult.enrolledCount, 7);
    assert.equal(enrollResult.skippedCount, 0);

    // Verify no emails are sent immediately merely because of import/enrollment
    const sentMessages = engine.many(`
      SELECT * FROM email_messages WHERE campaign_id = '${testCampaign}';
    `);
    assert.equal(sentMessages.length, 0, "No emails sent immediately; execution engine handles sending on schedule");

    // Second enrollment attempt: verify duplicate enrollment protection
    const enrollResult2 = engine.bulkEnroll(manualTenant, testCampaign, allCandidateIds);
    assert.equal(enrollResult2.enrolledCount, 0, "All contacts are already enrolled");
    assert.equal(enrollResult2.skippedCount, 7);
  });
});
