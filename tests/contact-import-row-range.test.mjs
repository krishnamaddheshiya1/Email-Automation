import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  parseCsv,
  toCsv,
  DEFAULT_COLUMN_ALIASES,
} from "../lib/utils/csv.ts";
import {
  validateRowRange,
  csvImportSchema,
  csvPreviewSchema,
} from "../lib/validations/contact.ts";

/**
 * Direct Integration Test Engine for Selected Row-Range Contact Import
 * Runs on pg-mem database and asserts that ONLY the selected rows are imported into DB.
 */
class ContactRangeTestEngine {
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

  createBusiness(name) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO businesses (id, name, created_at, updated_at)
      VALUES ('${id}', '${name.replace(/'/g, "''")}', NOW(), NOW());
    `);
    return id;
  }

  getContacts(businessId) {
    return this.many(`
      SELECT id, email, first_name, last_name, company_name, status, lead_score
      FROM leads
      WHERE business_id = '${businessId}'
      ORDER BY email ASC;
    `);
  }

  previewCsv(csvContent, filename = "contacts.csv", rangeOptions = null) {
    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }
    const parsed = parseCsv(csvContent);
    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }
    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      throw new Error("CSV file has missing or empty header row.");
    }
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

    let rangePreview;
    if (dataRows.length > 0) {
      const v = validateRowRange(dataRows.length, rangeOptions);
      const effectiveStart = v.isValid && v.startRow ? v.startRow : 1;
      const effectiveEnd = v.isValid && v.endRow ? v.endRow : dataRows.length;
      const firstRowIdx = Math.max(0, effectiveStart - 1);
      const lastRowIdx = Math.min(dataRows.length - 1, effectiveEnd - 1);

      const firstRowObj = {};
      const lastRowObj = {};
      if (dataRows[firstRowIdx]) {
        for (let c = 0; c < rawHeaders.length; c++) {
          firstRowObj[rawHeaders[c]] = (dataRows[firstRowIdx][c] || "").trim();
        }
      }
      if (dataRows[lastRowIdx]) {
        for (let c = 0; c < rawHeaders.length; c++) {
          lastRowObj[rawHeaders[c]] = (dataRows[lastRowIdx][c] || "").trim();
        }
      }

      rangePreview = {
        startRow: effectiveStart,
        endRow: effectiveEnd,
        totalSelected: Math.max(0, effectiveEnd - effectiveStart + 1),
        totalAvailable: dataRows.length,
        firstContact: firstRowObj,
        lastContact: lastRowObj,
      };
    }

    return {
      filename,
      totalRows: dataRows.length,
      headers: rawHeaders,
      previewRows,
      detectedMapping,
      range: rangePreview,
    };
  }

  importCsv(
    businessId,
    {
      csvContent,
      filename = "contacts.csv",
      columnMapping = null,
      mode = "CREATE_ONLY",
      rangeType = "all",
      startRow = null,
      endRow = null,
      batchSize = 500,
    }
  ) {
    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }

    const parsed = parseCsv(csvContent);
    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      throw new Error("CSV file has missing or empty header row.");
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

    if (dataRows.length === 0) {
      throw new Error("CSV file contains no data rows.");
    }

    // Server-side Range Validation & Enforcement
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
    const startIndex = effectiveStartRow - 1; // 0-based index
    const endIndex = effectiveEndRow; // 0-based slice limit
    const selectedDataRows = dataRows.slice(startIndex, endIndex);

    if (selectedDataRows.length === 0) {
      throw new Error("Selected row range contains no data rows.");
    }

    // Determine effective column mapping
    const effectiveMapping = {};
    if (columnMapping && Object.keys(columnMapping).length > 0) {
      for (const [col, field] of Object.entries(columnMapping)) {
        if (field && field !== "ignore" && field !== "none") {
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
        const origDataRowIndex = startIndex + b + i;
        const rowNumber = origDataRowIndex + 2; // spreadsheet file line (row 1 is header)
        const rowObj = {};
        const mapped = {};

        for (let c = 0; c < rawHeaders.length; c++) {
          const h = rawHeaders[c];
          const val = (row[c] || "").trim();
          rowObj[h] = val;
          const targetField = effectiveMapping[h];
          if (targetField) mapped[targetField] = val;
        }

        if (!mapped.first_name && mapped.full_name) {
          const parts = mapped.full_name.trim().split(/\s+/);
          mapped.first_name = parts[0] || "";
          mapped.last_name = parts.slice(1).join(" ");
        }

        const rawEmail = mapped.email ? mapped.email.trim() : "";
        if (!rawEmail) {
          invalidCount++;
          rejectedRows.push({
            row: rowNumber,
            email: "",
            reason: "Email is missing or empty",
            data: rowObj,
          });
          continue;
        }

        const normEmail = rawEmail.toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normEmail)) {
          invalidCount++;
          rejectedRows.push({
            row: rowNumber,
            email: rawEmail,
            reason: `Invalid email format: "${rawEmail}"`,
            data: rowObj,
          });
          continue;
        }

        if (seenEmailsInBatch.has(normEmail)) {
          duplicateCount++;
          rejectedRows.push({
            row: rowNumber,
            email: normEmail,
            reason: `Duplicate email inside CSV batch: "${rawEmail}"`,
            data: rowObj,
          });
          continue;
        }
        seenEmailsInBatch.add(normEmail);

        // Check suppression
        const isSuppressed = this.oneOrNone(`
          SELECT 1 FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normEmail}';
        `);
        if (isSuppressed) {
          suppressedCount++;
          rejectedRows.push({
            row: rowNumber,
            email: normEmail,
            reason: `Recipient email "${rawEmail}" is suppressed`,
            data: rowObj,
          });
          continue;
        }

        // Check existing contact
        const existing = this.oneOrNone(`
          SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${normEmail}';
        `);

        if (existing) {
          if (mode === "CREATE_OR_UPDATE") {
            this.none(`
              UPDATE leads
              SET 
                first_name = COALESCE(${mapped.first_name ? `'${mapped.first_name.replace(/'/g, "''")}'` : "NULL"}, first_name),
                last_name = COALESCE(${mapped.last_name ? `'${mapped.last_name.replace(/'/g, "''")}'` : "NULL"}, last_name),
                company_name = COALESCE(${mapped.company_name ? `'${mapped.company_name.replace(/'/g, "''")}'` : "NULL"}, company_name),
                updated_at = NOW()
              WHERE id = '${existing.id}';
            `);
            importedCount++;
          } else {
            duplicateCount++;
            rejectedRows.push({
              row: rowNumber,
              email: normEmail,
              reason: `Contact with email "${rawEmail}" already exists in your business`,
              data: rowObj,
            });
          }
        } else {
          const leadId = crypto.randomUUID();
          this.none(`
            INSERT INTO leads (
              id, business_id, first_name, last_name, email, phone, company_name, job_title, source, status, lead_score, metadata, created_at, updated_at
            ) VALUES (
              '${leadId}', '${businessId}',
              ${mapped.first_name ? `'${mapped.first_name.replace(/'/g, "''")}'` : "NULL"},
              ${mapped.last_name ? `'${mapped.last_name.replace(/'/g, "''")}'` : "NULL"},
              '${normEmail}',
              ${mapped.phone ? `'${mapped.phone.replace(/'/g, "''")}'` : "NULL"},
              ${mapped.company_name ? `'${mapped.company_name.replace(/'/g, "''")}'` : "NULL"},
              ${mapped.job_title ? `'${mapped.job_title.replace(/'/g, "''")}'` : "NULL"},
              '${mapped.source || "csv_import"}',
              '${(mapped.status || "NEW").toUpperCase()}',
              ${parseInt(mapped.lead_score || "0", 10) || 0},
              '{}'::jsonb, NOW(), NOW()
            );
          `);
          importedCount++;
        }
      }
    }

    let finalStatus = "COMPLETED";
    if (failedCount > 0 && importedCount > 0) finalStatus = "PARTIAL";
    else if (failedCount > 0 && importedCount === 0 && selectedDataRows.length > 0) finalStatus = "FAILED";

    this.none(`
      UPDATE contact_imports
      SET 
        total_rows = ${selectedDataRows.length},
        imported_count = ${importedCount},
        duplicate_count = ${duplicateCount},
        invalid_count = ${invalidCount},
        suppressed_count = ${suppressedCount},
        failed_count = ${failedCount},
        status = '${finalStatus}',
        completed_at = NOW()
      WHERE id = '${importId}';
    `);

    return {
      totalRows: selectedDataRows.length,
      validRows: importedCount,
      importedCount,
      skippedCount: duplicateCount + invalidCount + suppressedCount + failedCount,
      duplicateCount,
      invalidCount,
      suppressedCount,
      failedCount,
      status: finalStatus,
      rejectedRows,
      range: {
        type: rangeType === "range" ? "range" : "all",
        startRow: effectiveStartRow,
        endRow: effectiveEndRow,
        totalAvailable: dataRows.length,
      },
    };
  }
}

// Generate CSV helper
function generateTestCsv(count) {
  const rows = [["first_name", "last_name", "email", "company"]];
  for (let i = 1; i <= count; i++) {
    rows.push([
      `First${i}`,
      `Last${i}`,
      `contact${i}@example.com`,
      `Company${i}`,
    ]);
  }
  return toCsv(rows[0], rows.slice(1));
}

test("FEATURE: IMPORT CONTACTS BY SELECTED ROW RANGE (ALL 10 SCENARIOS)", async (t) => {
  const { db } = createTestDb();
  const engine = new ContactRangeTestEngine(db);

  // SCENARIO 1: Import entire file
  await t.test("Scenario 1: Import entire file - All contacts imported to DB", () => {
    const bizId = engine.createBusiness("Biz Scenario 1");
    const csv = generateTestCsv(30);

    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "entire_file.csv",
      rangeType: "all",
    });

    assert.equal(res.totalRows, 30);
    assert.equal(res.importedCount, 30);
    assert.equal(res.skippedCount, 0);
    assert.equal(res.status, "COMPLETED");

    // Direct DB verification
    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 30, "Database must contain all 30 contacts");
    for (let i = 1; i <= 30; i++) {
      assert.ok(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        `contact${i}@example.com must exist in DB`
      );
    }
  });

  // SCENARIO 2: Import 1–10
  await t.test("Scenario 2: Import 1–10 - ONLY contacts 1 through 10 are imported into DB", () => {
    const bizId = engine.createBusiness("Biz Scenario 2");
    const csv = generateTestCsv(30);

    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "range_1_10.csv",
      rangeType: "range",
      startRow: 1,
      endRow: 10,
    });

    assert.equal(res.totalRows, 10, "Summary totalRows must equal 10");
    assert.equal(res.importedCount, 10, "Summary importedCount must equal 10");
    assert.equal(res.status, "COMPLETED");
    assert.equal(res.range.startRow, 1);
    assert.equal(res.range.endRow, 10);
    assert.equal(res.range.totalAvailable, 30);

    // CRITICAL: Database must contain ONLY contacts 1 through 10!
    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 10, "Database must contain EXACTLY 10 contacts");

    // Verify contacts 1..10 exist
    for (let i = 1; i <= 10; i++) {
      assert.ok(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        `contact${i}@example.com must exist in DB`
      );
    }

    // Verify contacts 11..30 do NOT exist in DB
    for (let i = 11; i <= 30; i++) {
      assert.equal(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        false,
        `contact${i}@example.com must NOT exist in DB`
      );
    }
  });

  // SCENARIO 3: Import 10–30
  await t.test("Scenario 3: Import 10–30 - ONLY contacts 10 through 30 are imported into DB", () => {
    const bizId = engine.createBusiness("Biz Scenario 3");
    const csv = generateTestCsv(50);

    // Range 10-30 inclusive = 21 contacts (10, 11, ..., 30)
    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "range_10_30.csv",
      rangeType: "range",
      startRow: 10,
      endRow: 30,
    });

    assert.equal(res.totalRows, 21, "Range 10–30 has 21 contact data rows");
    assert.equal(res.importedCount, 21);
    assert.equal(res.status, "COMPLETED");

    // CRITICAL: Database must contain ONLY contacts 10 through 30!
    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 21, "Database must contain EXACTLY 21 contacts");

    // Contacts 1..9 must NOT exist
    for (let i = 1; i <= 9; i++) {
      assert.equal(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        false,
        `contact${i}@example.com (before range) must NOT be in DB`
      );
    }

    // Contacts 10..30 MUST exist
    for (let i = 10; i <= 30; i++) {
      assert.ok(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        `contact${i}@example.com (in range) must exist in DB`
      );
    }

    // Contacts 31..50 must NOT exist
    for (let i = 31; i <= 50; i++) {
      assert.equal(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        false,
        `contact${i}@example.com (after range) must NOT be in DB`
      );
    }
  });

  // SCENARIO 4: Import last 10 rows
  await t.test("Scenario 4: Import last 10 rows - ONLY the final 10 contacts exist in DB", () => {
    const bizId = engine.createBusiness("Biz Scenario 4");
    const csv = generateTestCsv(25);

    // 25 contacts: last 10 rows is 16..25 (10 contacts)
    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "last_10.csv",
      rangeType: "range",
      startRow: 16,
      endRow: 25,
    });

    assert.equal(res.totalRows, 10);
    assert.equal(res.importedCount, 10);

    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 10, "Database must contain EXACTLY 10 contacts");

    for (let i = 1; i <= 15; i++) {
      assert.equal(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        false,
        `contact${i} must NOT exist`
      );
    }
    for (let i = 16; i <= 25; i++) {
      assert.ok(
        inDb.some((c) => c.email === `contact${i}@example.com`),
        `contact${i} must exist`
      );
    }
  });

  // SCENARIO 5: Start > End validation rejection
  await t.test("Scenario 5: Start > End rejected safely without database insertion", () => {
    const bizId = engine.createBusiness("Biz Scenario 5");
    const csv = generateTestCsv(25);

    assert.throws(
      () =>
        engine.importCsv(bizId, {
          csvContent: csv,
          rangeType: "range",
          startRow: 15,
          endRow: 10,
        }),
      /End row \(10\) must be greater than or equal to Start row \(15\)/
    );

    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 0, "No contacts should be inserted into DB");
  });

  // SCENARIO 6: End > available rows validation rejection
  await t.test("Scenario 6: End > available rows rejected safely", () => {
    const bizId = engine.createBusiness("Biz Scenario 6");
    const csv = generateTestCsv(20);

    assert.throws(
      () =>
        engine.importCsv(bizId, {
          csvContent: csv,
          rangeType: "range",
          startRow: 1,
          endRow: 25,
        }),
      /End row \(25\) cannot exceed available data rows \(20\)/
    );

    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 0, "No contacts should be inserted into DB");
  });

  // SCENARIO 7: Empty file rejection
  await t.test("Scenario 7: Empty file rejected cleanly", () => {
    const bizId = engine.createBusiness("Biz Scenario 7");

    assert.throws(
      () => engine.importCsv(bizId, { csvContent: "" }),
      /CSV file is empty/
    );
    assert.throws(
      () => engine.importCsv(bizId, { csvContent: "   \n\n  " }),
      /CSV file is empty/
    );

    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 0, "No contacts in DB for empty file");
  });

  // SCENARIO 8: Header-only file rejection
  await t.test("Scenario 8: Header-only file (0 data rows) rejected cleanly", () => {
    const bizId = engine.createBusiness("Biz Scenario 8");
    const headerOnly = "first_name,last_name,email,company\n";

    assert.throws(
      () => engine.importCsv(bizId, { csvContent: headerOnly }),
      /CSV file contains no data rows/
    );

    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 0, "No contacts in DB for header-only file");
  });

  // SCENARIO 9: Invalid rows within selected range
  await t.test("Scenario 9: Invalid rows - valid rows imported, invalid rows clearly reported", () => {
    const bizId = engine.createBusiness("Biz Scenario 9");

    // 12 data rows:
    // Row 1: valid
    // Row 2: valid
    // Row 3: missing email (invalid)
    // Row 4: valid
    // Row 5: valid
    // Row 6: valid
    // Row 7: malformed email (invalid)
    // Row 8: valid
    // Row 9: valid
    // Row 10: valid
    // Row 11: valid (outside range)
    // Row 12: valid (outside range)
    const rawLines = [
      "first_name,last_name,email,company",
      "Alice,One,alice1@example.com,Co1",
      "Bob,Two,bob2@example.com,Co2",
      "Charlie,Three,,Co3", // Missing email
      "David,Four,david4@example.com,Co4",
      "Eva,Five,eva5@example.com,Co5",
      "Frank,Six,frank6@example.com,Co6",
      "Grace,Seven,not-an-email,Co7", // Invalid email format
      "Hank,Eight,hank8@example.com,Co8",
      "Ivy,Nine,ivy9@example.com,Co9",
      "Jack,Ten,jack10@example.com,Co10",
      "Kevin,Eleven,kevin11@example.com,Co11",
      "Laura,Twelve,laura12@example.com,Co12",
    ];
    const csv = rawLines.join("\n");

    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "invalid_rows_test.csv",
      rangeType: "range",
      startRow: 1,
      endRow: 10,
    });

    // 10 data rows selected: 8 valid, 2 invalid
    assert.equal(res.totalRows, 10);
    assert.equal(res.importedCount, 8);
    assert.equal(res.invalidCount, 2);
    assert.equal(res.rejectedRows.length, 2);

    // Verify rejected row details
    const r1 = res.rejectedRows.find((r) => r.row === 4); // Line 4 in file (Data Row 3)
    assert.ok(r1, "Row with missing email must be reported at spreadsheet line 4");
    assert.match(r1.reason, /Email is missing or empty/);

    const r2 = res.rejectedRows.find((r) => r.row === 8); // Line 8 in file (Data Row 7)
    assert.ok(r2, "Row with malformed email must be reported at spreadsheet line 8");
    assert.match(r2.reason, /Invalid email format/);

    // CRITICAL DB ASSERTION:
    // Only the 8 valid contacts from rows 1..10 exist in DB!
    const inDb = engine.getContacts(bizId);
    assert.equal(inDb.length, 8, "DB must contain ONLY the 8 valid selected contacts");
    assert.ok(inDb.some((c) => c.email === "alice1@example.com"));
    assert.ok(inDb.some((c) => c.email === "jack10@example.com"));
    assert.equal(inDb.some((c) => c.email === "kevin11@example.com"), false);
  });

  // SCENARIO 10: Duplicate contacts within selected range and DB
  await t.test("Scenario 10: Duplicate contacts - duplicates skipped and existing DB records preserved", () => {
    const bizId = engine.createBusiness("Biz Scenario 10");

    // Pre-seed an existing contact in DB
    engine.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, source, status, lead_score, metadata, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${bizId}', 'Existing', 'User', 'existing@example.com', 'Original Co', 'manual', 'NEW', 0, '{}'::jsonb, NOW(), NOW());
    `);

    // CSV has 10 data rows:
    // Row 1: new1@example.com
    // Row 2: dup@example.com (first time)
    // Row 3: new2@example.com
    // Row 4: existing@example.com (duplicate of DB contact)
    // Row 5: dup@example.com (duplicate within CSV)
    // Row 6: new3@example.com
    // Row 7: new4@example.com
    // Row 8: new5@example.com
    // Row 9: new6@example.com
    // Row 10: new7@example.com
    const rawLines = [
      "first_name,last_name,email,company",
      "New,One,new1@example.com,Co1",
      "Dup,First,dup@example.com,Co2",
      "New,Two,new2@example.com,Co3",
      "Existing,CSV,existing@example.com,Updated Co",
      "Dup,Second,dup@example.com,Co5", // Intra-batch duplicate
      "New,Three,new3@example.com,Co6",
      "New,Four,new4@example.com,Co7",
      "New,Five,new5@example.com,Co8",
      "New,Six,new6@example.com,Co9",
      "New,Seven,new7@example.com,Co10",
    ];
    const csv = rawLines.join("\n");

    const res = engine.importCsv(bizId, {
      csvContent: csv,
      filename: "dup_test.csv",
      rangeType: "range",
      startRow: 1,
      endRow: 10,
      mode: "CREATE_ONLY",
    });

    assert.equal(res.totalRows, 10);
    assert.equal(res.duplicateCount, 2, "2 duplicates detected (1 intra-batch + 1 existing DB)");
    assert.equal(res.importedCount, 8, "8 new unique contacts imported");

    // Check DB:
    const inDb = engine.getContacts(bizId);
    // 1 pre-existing + 8 new = 9 total contacts
    assert.equal(inDb.length, 9);

    // Exactly 1 record for dup@example.com
    const dups = inDb.filter((c) => c.email === "dup@example.com");
    assert.equal(dups.length, 1, "dup@example.com must only appear once in DB");

    // Existing contact was preserved
    const existLead = inDb.find((c) => c.email === "existing@example.com");
    assert.ok(existLead);
    assert.equal(existLead.company_name, "Original Co", "CREATE_ONLY mode preserves existing data");
  });

  // Additional test: Live Preview validation helper and edge cases
  await t.test("Range Preview & Schema Validation Verification", () => {
    const csv = generateTestCsv(50);
    const engine2 = new ContactRangeTestEngine(db);

    // Preview range 10–30
    const preview = engine2.previewCsv(csv, "contacts.csv", {
      rangeType: "range",
      startRow: 10,
      endRow: 30,
    });

    assert.equal(preview.totalRows, 50);
    assert.ok(preview.range);
    assert.equal(preview.range.startRow, 10);
    assert.equal(preview.range.endRow, 30);
    assert.equal(preview.range.totalSelected, 21);
    assert.equal(preview.range.totalAvailable, 50);
    assert.equal(preview.range.firstContact.email, "contact10@example.com");
    assert.equal(preview.range.lastContact.email, "contact30@example.com");

    // validateRowRange unit cases
    assert.equal(validateRowRange(100, { rangeType: "all" }).isValid, true);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 1, endRow: 10 }).totalSelected, 10);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 10, endRow: 30 }).totalSelected, 21);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 31, endRow: 50 }).totalSelected, 20);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 101, endRow: 200 }).isValid, false);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 0, endRow: 10 }).isValid, false);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 10, endRow: 5 }).isValid, false);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: "abc", endRow: 10 }).isValid, false);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: "", endRow: "" }).isValid, false);
    assert.equal(validateRowRange(100, { rangeType: "range", startRow: 1.5, endRow: 10 }).isValid, false);

    // Zod schema validation
    const parsedImportSchema = csvImportSchema.safeParse({
      csv: "email\ntest@example.com",
      range_type: "range",
      start_row: 1,
      end_row: 10,
    });
    assert.equal(parsedImportSchema.success, true);

    const parsedPreviewSchema = csvPreviewSchema.safeParse({
      csv: "email\ntest@example.com",
      range_type: "range",
      start_row: 1,
      end_row: 10,
    });
    assert.equal(parsedPreviewSchema.success, true);
  });
});
