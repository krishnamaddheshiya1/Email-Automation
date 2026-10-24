import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { createTestDb } from "./test-harness.mjs";
import { convertSpreadsheetToCsv } from "../lib/utils/spreadsheet.ts";
import { campaignContactImportSchema } from "../lib/validations/campaign.ts";
import { parseCsv, DEFAULT_COLUMN_ALIASES } from "../lib/utils/csv.ts";
import { validateRowRange } from "../lib/validations/contact.ts";

/**
 * Helper to build an in-memory XLSX Buffer for testing
 */
function createMockXlsxBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Direct Integration Test Engine for Campaign Direct Contact Import & Enrollment
 * Backed by pg-mem in-memory PostgreSQL instance.
 */
class CampaignImportTestEngine {
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

  createCampaign(businessId, name = "Test Outreach Campaign") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, settings, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${name.replace(/'/g, "''")}', 'DRAFT', 'UTC', '{}'::jsonb, NOW(), NOW());
    `);
    return id;
  }

  createCampaignStep(campaignId, stepNumber = 1, name = "Initial Outreach") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${id}', '${campaignId}', ${stepNumber}, '${name}', 0, 'days', 'ACTIVE', NOW(), NOW());
    `);
    return id;
  }

  createContact(businessId, { email, firstName = "Test", lastName = "User", company = "Test Co" }) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status, lead_score, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${firstName}', '${lastName}', '${email.toLowerCase()}', '${company}', 'new', 0, NOW(), NOW());
    `);
    return id;
  }

  enrollExistingContact(campaignId, businessId, leadId, email) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, email, status, metadata, created_at, updated_at)
      VALUES ('${id}', '${campaignId}', '${leadId}', '${businessId}', '${email.toLowerCase()}', 'ENROLLED', '{}'::jsonb, NOW(), NOW());
    `);
    return id;
  }

  addSuppression(businessId, email, reason = "Unsubscribed") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO suppressions (id, business_id, email, reason, created_at)
      VALUES ('${id}', '${businessId}', '${email.toLowerCase()}', '${reason}', NOW());
    `);
    return id;
  }

  getContacts(businessId) {
    return this.many(`
      SELECT id, email, first_name, last_name, company_name, status
      FROM leads
      WHERE business_id = '${businessId}'
      ORDER BY email ASC;
    `);
  }

  getEnrollments(campaignId) {
    return this.many(`
      SELECT cl.id, cl.campaign_id, cl.lead_id, cl.email, cl.status, cl.current_step_id
      FROM campaign_leads cl
      WHERE cl.campaign_id = '${campaignId}'
      ORDER BY cl.email ASC;
    `);
  }

  /**
   * Executes the Campaign Direct Contact Import & Enrollment Flow against pg-mem
   */
  async runImportAndEnroll({
    campaignId,
    businessId,
    csvContent,
    fileBuffer,
    filename = "contacts.csv",
    rangeType = "entire",
    startRow,
    endRow,
  }) {
    // 1. Multi-tenant Campaign verification
    const campaign = this.oneOrNone(`
      SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';
    `);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    // 2. Spreadsheet conversion
    const resolvedCsv = fileBuffer
      ? convertSpreadsheetToCsv(fileBuffer, filename)
      : (csvContent || "");

    if (!resolvedCsv.trim()) {
      throw new Error("Spreadsheet file is empty or contains no parseable text.");
    }

    // 3. RFC-4180 parsing
    const parsed = parseCsv(resolvedCsv);
    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      throw new Error("Spreadsheet has missing or empty header row.");
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));
    if (dataRows.length === 0) {
      throw new Error("Spreadsheet contains no contact data rows.");
    }

    // 4. Server-side range validation
    const rangeValidation = validateRowRange(dataRows.length, {
      rangeType,
      startRow,
      endRow,
    });

    if (!rangeValidation.isValid) {
      throw new Error(rangeValidation.error || "Invalid row range selection.");
    }

    const effectiveStart = rangeValidation.startRow || 1;
    const effectiveEnd = rangeValidation.endRow || dataRows.length;
    const startIndex = effectiveStart - 1;
    const endIndex = effectiveEnd;
    const selectedRows = dataRows.slice(startIndex, endIndex);

    if (selectedRows.length === 0) {
      throw new Error("Selected row range contains no data rows.");
    }

    // 5. Column mapping
    const mapping = {};
    for (const h of rawHeaders) {
      const norm = h.toLowerCase().trim();
      if (DEFAULT_COLUMN_ALIASES[norm]) {
        mapping[h] = DEFAULT_COLUMN_ALIASES[norm];
      }
    }

    if (!Object.values(mapping).some((f) => f === "email")) {
      throw new Error("Spreadsheet is missing a required email column.");
    }

    // Resolve first active step
    const firstStep = this.oneOrNone(`
      SELECT * FROM campaign_steps
      WHERE campaign_id = '${campaignId}' AND UPPER(status) = 'ACTIVE'
      ORDER BY step_number ASC LIMIT 1;
    `);

    let importedCount = 0;
    let newContactsCount = 0;
    let existingContactsCount = 0;
    let enrolledCount = 0;
    let alreadyEnrolledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const rejectedRows = [];
    const seenEmailsInBatch = new Set();

    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      const rowNumber = effectiveStart + i;
      const rowObj = {};
      const mapped = {};

      for (let c = 0; c < rawHeaders.length; c++) {
        const header = rawHeaders[c];
        const val = (row[c] || "").trim();
        rowObj[header] = val;
        const targetField = mapping[header];
        if (targetField) mapped[targetField] = val;
      }

      if (!mapped.first_name && mapped.full_name) {
        const parts = mapped.full_name.trim().split(/\s+/);
        mapped.first_name = parts[0] || "";
        mapped.last_name = parts.slice(1).join(" ");
      }

      const rawEmail = mapped.email ? mapped.email.trim() : "";
      if (!rawEmail) {
        skippedCount++;
        failedCount++;
        rejectedRows.push({
          row: rowNumber,
          email: "",
          reason: "Email is missing or empty",
        });
        continue;
      }

      const normEmail = rawEmail.toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normEmail)) {
        skippedCount++;
        failedCount++;
        rejectedRows.push({
          row: rowNumber,
          email: rawEmail,
          reason: `Invalid email format: "${rawEmail}"`,
        });
        continue;
      }

      if (seenEmailsInBatch.has(normEmail)) {
        skippedCount++;
        rejectedRows.push({
          row: rowNumber,
          email: normEmail,
          reason: `Duplicate email inside imported file batch: "${rawEmail}"`,
        });
        continue;
      }
      seenEmailsInBatch.add(normEmail);

      // Suppression check
      const isSuppressed = this.oneOrNone(`
        SELECT 1 FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normEmail}';
      `);
      if (isSuppressed) {
        skippedCount++;
        rejectedRows.push({
          row: rowNumber,
          email: normEmail,
          reason: `Recipient email "${rawEmail}" is in suppression list`,
        });
        continue;
      }

      // Check existing contact in DB
      let contact = this.oneOrNone(`
        SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${normEmail}';
      `);

      if (contact) {
        existingContactsCount++;
        importedCount++;
      } else {
        const newLeadId = crypto.randomUUID();
        this.none(`
          INSERT INTO leads (
            id, business_id, first_name, last_name, email, phone, company_name, job_title, source, status, lead_score, created_at, updated_at
          ) VALUES (
            '${newLeadId}', '${businessId}',
            ${mapped.first_name ? `'${mapped.first_name.replace(/'/g, "''")}'` : "NULL"},
            ${mapped.last_name ? `'${mapped.last_name.replace(/'/g, "''")}'` : "NULL"},
            '${normEmail}',
            ${mapped.phone ? `'${mapped.phone.replace(/'/g, "''")}'` : "NULL"},
            ${mapped.company_name ? `'${mapped.company_name.replace(/'/g, "''")}'` : "NULL"},
            ${mapped.job_title ? `'${mapped.job_title.replace(/'/g, "''")}'` : "NULL"},
            'CAMPAIGN_IMPORT', 'new', 0, NOW(), NOW()
          );
        `);
        contact = this.oneOrNone(`SELECT * FROM leads WHERE id = '${newLeadId}';`);
        newContactsCount++;
        importedCount++;
      }

      // Check if already enrolled in this campaign
      const existingEnrollment = this.oneOrNone(`
        SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${contact.id}';
      `);

      if (existingEnrollment) {
        alreadyEnrolledCount++;
      } else {
        const enrollmentId = crypto.randomUUID();
        this.none(`
          INSERT INTO campaign_leads (
            id, campaign_id, lead_id, business_id, email, status, current_step_id, metadata, created_at, updated_at
          ) VALUES (
            '${enrollmentId}', '${campaignId}', '${contact.id}', '${businessId}',
            '${normEmail}', 'ENROLLED',
            ${firstStep ? `'${firstStep.id}'` : "NULL"},
            '{}'::jsonb, NOW(), NOW()
          );
        `);
        enrolledCount++;
      }
    }

    return {
      campaignId,
      totalAvailable: dataRows.length,
      totalSelected: selectedRows.length,
      effectiveStartRow: effectiveStart,
      effectiveEndRow: effectiveEnd,
      importedCount,
      newContactsCount,
      existingContactsCount,
      enrolledCount,
      alreadyEnrolledCount,
      skippedCount,
      failedCount,
      rejectedRows,
    };
  }
}

test("Campaign Contact Import & Enrollment with Row-Range Selection Test Suite", async (suite) => {
  const { db } = createTestDb();
  const engine = new CampaignImportTestEngine(db);

  // Setup Businesses
  const bizAId = engine.createBusiness("Alpha Operations");
  const bizBId = engine.createBusiness("Beta Dynamics");

  // Setup Campaign for Business A with Step 1
  const campaignAId = engine.createCampaign(bizAId, "Q4 Enterprise Outreach");
  const stepA1Id = engine.createCampaignStep(campaignAId, 1, "Initial Sequence Email");

  // Setup Campaign for Business B (for cross-tenant tests)
  const campaignBId = engine.createCampaign(bizBId, "Beta Campaign");

  // 1. SPREADSHEET PARSING TESTS
  await suite.test("1. convertSpreadsheetToCsv correctly converts XLSX binary buffer and CSV strings", async () => {
    const rows = [
      ["First Name", "Last Name", "Email Address", "Company Name"],
      ["Elena", "Rostova", "elena@example.com", "Rostov Imports"],
      ["Dmitri", "Petrov", "dmitri@example.com", "Petrov Heavy Industries"],
    ];
    const xlsxBuffer = createMockXlsxBuffer(rows);
    const converted = convertSpreadsheetToCsv(xlsxBuffer, "leads.xlsx");

    assert.ok(converted.includes("elena@example.com"));
    assert.ok(converted.includes("dmitri@example.com"));
    assert.ok(converted.includes("Rostov Imports"));

    const csvDirect = "First Name,Email\nJohn,john@example.com\n";
    const convertedCsv = convertSpreadsheetToCsv(csvDirect, "leads.csv");
    assert.ok(convertedCsv.includes("john@example.com"));
  });

  // 2. SCHEMA VALIDATION TESTS
  await suite.test("2. campaignContactImportSchema validates row range bounds", async () => {
    // Valid entire
    const validEntire = campaignContactImportSchema.parse({
      rangeType: "entire",
    });
    assert.equal(validEntire.rangeType, "entire");

    // Valid custom range
    const validCustom = campaignContactImportSchema.parse({
      rangeType: "custom",
      startRow: 1,
      endRow: 10,
    });
    assert.equal(validCustom.startRow, 1);
    assert.equal(validCustom.endRow, 10);

    // Invalid: start > end
    assert.throws(
      () => {
        campaignContactImportSchema.parse({
          rangeType: "custom",
          startRow: 20,
          endRow: 10,
        });
      },
      (err) => (err.message || "").includes("Start row cannot be greater than end row")
    );

    // Invalid: start < 1
    assert.throws(
      () => {
        campaignContactImportSchema.parse({
          rangeType: "custom",
          startRow: 0,
          endRow: 10,
        });
      },
      (err) => (err.message || "").includes("Start row must be at least 1")
    );
  });

  // 3. IMPORT ENTIRE CSV INTO CAMPAIGN
  await suite.test("3. Import Entire CSV: creates contacts in DB and enrolls them into campaign", async () => {
    const csv = [
      "Name,Email,Company",
      "Alice Smith,alice.smith@alpha.com,Alpha Corp",
      "Bob Miller,bob.miller@alpha.com,Alpha Miller",
      "Charlie Davis,charlie.davis@alpha.com,Alpha Charlie",
    ].join("\n");

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "entire",
    });

    assert.equal(result.totalAvailable, 3);
    assert.equal(result.totalSelected, 3);
    assert.equal(result.importedCount, 3);
    assert.equal(result.newContactsCount, 3);
    assert.equal(result.existingContactsCount, 0);
    assert.equal(result.enrolledCount, 3);
    assert.equal(result.alreadyEnrolledCount, 0);
    assert.equal(result.failedCount, 0);

    // Verify contacts in DB
    const contacts = engine.getContacts(bizAId);
    assert.equal(contacts.length, 3);
    assert.equal(contacts[0].email, "alice.smith@alpha.com");
    assert.equal(contacts[1].email, "bob.miller@alpha.com");
    assert.equal(contacts[2].email, "charlie.davis@alpha.com");

    // Verify campaign_leads in DB
    const enrollments = engine.getEnrollments(campaignAId);
    assert.equal(enrollments.length, 3);
    assert.equal(enrollments[0].status, "ENROLLED");
    assert.equal(enrollments[0].current_step_id, stepA1Id);
  });

  // 4. IMPORT CSV ROWS 1-10 FROM A LARGER DATASET
  await suite.test("4. Import CSV rows 1-10: imports and enrolls ONLY rows 1 to 10", async () => {
    // Generate 30 rows
    const header = "Name,Email,Company";
    const dataRows = [];
    for (let i = 1; i <= 30; i++) {
      dataRows.push(`Prospect ${i},prospect_${i}@example.com,Company ${i}`);
    }
    const csv = [header, ...dataRows].join("\n");

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "custom",
      startRow: 1,
      endRow: 10,
    });

    assert.equal(result.totalAvailable, 30);
    assert.equal(result.totalSelected, 10);
    assert.equal(result.effectiveStartRow, 1);
    assert.equal(result.effectiveEndRow, 10);
    assert.equal(result.importedCount, 10);
    assert.equal(result.enrolledCount, 10);

    // Verify prospects 1 through 10 exist
    const enrollments = engine.getEnrollments(campaignAId);
    const prospect1Enrolled = enrollments.find((e) => e.email === "prospect_1@example.com");
    const prospect10Enrolled = enrollments.find((e) => e.email === "prospect_10@example.com");
    const prospect11Enrolled = enrollments.find((e) => e.email === "prospect_11@example.com");

    assert.ok(prospect1Enrolled, "Prospect 1 must be enrolled");
    assert.ok(prospect10Enrolled, "Prospect 10 must be enrolled");
    assert.equal(prospect11Enrolled, undefined, "Prospect 11 must NOT be enrolled");
  });

  // 5. IMPORT ROWS 10-30
  await suite.test("5. Import CSV rows 10-30: imports and enrolls exactly selected slice", async () => {
    const header = "Name,Email,Company";
    const dataRows = [];
    for (let i = 1; i <= 30; i++) {
      dataRows.push(`Prospect ${i},prospect_${i}@example.com,Company ${i}`);
    }
    const csv = [header, ...dataRows].join("\n");

    // Rows 10 to 30 = 21 rows (row 10 was already imported in test 4, so it should be detected as existing!)
    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "custom",
      startRow: 10,
      endRow: 30,
    });

    assert.equal(result.totalAvailable, 30);
    assert.equal(result.totalSelected, 21);
    assert.equal(result.effectiveStartRow, 10);
    assert.equal(result.effectiveEndRow, 30);

    // Prospect 10 was already enrolled in test 4!
    assert.equal(result.alreadyEnrolledCount, 1, "Prospect 10 must be counted as already enrolled");
    assert.equal(result.enrolledCount, 20, "20 new enrollments for prospects 11-30");

    // Total enrollments in campaignA should now be 3 (test 3) + 10 (test 4) + 20 (test 5) = 33
    const allEnrollments = engine.getEnrollments(campaignAId);
    assert.equal(allEnrollments.length, 33);
  });

  // 6. IMPORT EXCEL / XLSX ROWS 1-5
  await suite.test("6. Import Excel/XLSX: converts binary sheet and enrolls rows 1-5", async () => {
    const xlsxRows = [
      ["Full Name", "Email Address", "Organization"],
      ["XLSX Lead 1", "xlsx_lead_1@example.com", "Excel Org 1"],
      ["XLSX Lead 2", "xlsx_lead_2@example.com", "Excel Org 2"],
      ["XLSX Lead 3", "xlsx_lead_3@example.com", "Excel Org 3"],
      ["XLSX Lead 4", "xlsx_lead_4@example.com", "Excel Org 4"],
      ["XLSX Lead 5", "xlsx_lead_5@example.com", "Excel Org 5"],
      ["XLSX Lead 6", "xlsx_lead_6@example.com", "Excel Org 6"],
      ["XLSX Lead 7", "xlsx_lead_7@example.com", "Excel Org 7"],
    ];
    const xlsxBuffer = createMockXlsxBuffer(xlsxRows);

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      fileBuffer: xlsxBuffer,
      filename: "executive_contacts.xlsx",
      rangeType: "custom",
      startRow: 1,
      endRow: 5,
    });

    assert.equal(result.totalAvailable, 7);
    assert.equal(result.totalSelected, 5);
    assert.equal(result.enrolledCount, 5);
    assert.equal(result.importedCount, 5);

    // Verify DB records
    const enrollments = engine.getEnrollments(campaignAId);
    assert.ok(enrollments.some((e) => e.email === "xlsx_lead_1@example.com"));
    assert.ok(enrollments.some((e) => e.email === "xlsx_lead_5@example.com"));
    assert.ok(!enrollments.some((e) => e.email === "xlsx_lead_6@example.com"));
  });

  // 7. DUPLICATE CONTACT HANDLING
  await suite.test("7. Duplicate Contacts: reuses existing contact without creating duplicate in leads table", async () => {
    // Manually create existing contact in DB
    const existingContactId = engine.createContact(bizAId, {
      email: "existing_vip@example.com",
      firstName: "VIP",
      lastName: "Client",
      company: "VIP Global",
    });

    const csv = [
      "Name,Email,Company",
      "VIP Client,existing_vip@example.com,VIP Global",
      "Brand New,brand_new@example.com,New Corp",
    ].join("\n");

    const contactsBefore = engine.getContacts(bizAId);
    assert.ok(contactsBefore.length >= 1);

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "entire",
    });

    assert.equal(result.totalSelected, 2);
    assert.equal(result.existingContactsCount, 1, "Must detect 1 existing contact in DB");
    assert.equal(result.newContactsCount, 1, "Must create 1 new contact in DB");
    assert.equal(result.enrolledCount, 2, "Both must be enrolled into campaign");

    // Assert that 'existing_vip@example.com' was NOT duplicated in leads table
    const matchingContacts = engine.many(`
      SELECT * FROM leads WHERE business_id = '${bizAId}' AND LOWER(email) = 'existing_vip@example.com';
    `);
    assert.equal(matchingContacts.length, 1, "There must be exactly 1 contact record in leads table");
    assert.equal(matchingContacts[0].id, existingContactId, "Must reuse original contact ID");
  });

  // 8. DUPLICATE CAMPAIGN ENROLLMENT HANDLING
  await suite.test("8. Duplicate Enrollment: contact already enrolled in campaign is skipped without duplicate record", async () => {
    const csv = [
      "Name,Email,Company",
      "VIP Client,existing_vip@example.com,VIP Global", // Already enrolled in Test 7!
      "Alice Smith,alice.smith@alpha.com,Alpha Corp", // Already enrolled in Test 3!
    ].join("\n");

    const enrollmentsBefore = engine.getEnrollments(campaignAId);

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "entire",
    });

    assert.equal(result.totalSelected, 2);
    assert.equal(result.existingContactsCount, 2);
    assert.equal(result.enrolledCount, 0, "No new enrollments should be created");
    assert.equal(result.alreadyEnrolledCount, 2, "Both should be counted as already enrolled");

    const enrollmentsAfter = engine.getEnrollments(campaignAId);
    assert.equal(enrollmentsAfter.length, enrollmentsBefore.length, "Enrollment table count must remain identical");
  });

  // 9. INVALID RANGE: START > END (20 to 10)
  await suite.test("9. Invalid Range: Start 20, End 10 fails with clear validation error", async () => {
    const dataRows = Array.from({ length: 30 }, (_, i) => `User ${i},user_${i}@example.com`).join("\n");
    const csv = `Name,Email\n${dataRows}\n`;

    await assert.rejects(
      async () => {
        await engine.runImportAndEnroll({
          campaignId: campaignAId,
          businessId: bizAId,
          csvContent: csv,
          rangeType: "custom",
          startRow: 20,
          endRow: 10,
        });
      },
      (err) => {
        assert.ok(
          err.message.includes("must be greater than or equal to Start row") ||
          err.message.includes("Start row cannot be greater than end row")
        );
        return true;
      }
    );
  });

  // 10. OUT OF BOUNDS RANGE: START 1, END 999999
  await suite.test("10. Out of Bounds Range: Start 1, End 999999 when only 3 rows exist fails safely", async () => {
    const csv = "Name,Email\nOne,one@example.com\nTwo,two@example.com\nThree,three@example.com\n";

    await assert.rejects(
      async () => {
        await engine.runImportAndEnroll({
          campaignId: campaignAId,
          businessId: bizAId,
          csvContent: csv,
          rangeType: "custom",
          startRow: 1,
          endRow: 999999,
        });
      },
      (err) => {
        assert.ok(
          err.message.includes("cannot exceed available data rows") ||
          err.message.includes("exceeds total data rows")
        );
        return true;
      }
    );
  });

  // 11. MULTI-TENANT ACCESS CONTROL
  await suite.test("11. Zero-trust isolation: importing into another business's campaign is rejected", async () => {
    const csv = "Name,Email\nHacker,hacker@example.com\n";

    // Business A attempts to import into Business B's campaign
    await assert.rejects(
      async () => {
        await engine.runImportAndEnroll({
          campaignId: campaignBId, // Campaign belonging to Business B
          businessId: bizAId,      // Authenticated as Business A
          csvContent: csv,
          rangeType: "entire",
        });
      },
      (err) => {
        assert.ok(err.message.includes("Campaign not found or access denied"));
        return true;
      }
    );
  });

  // 12. SUPPRESSION LIST CHECK
  await suite.test("12. Suppression check: suppressed emails are safely skipped and not enrolled", async () => {
    const suppressedEmail = "do-not-contact@alpha.com";
    engine.addSuppression(bizAId, suppressedEmail, "unsubscribe");

    const csv = [
      "Name,Email,Company",
      `Blocked User,${suppressedEmail},Suppressed Co`,
      "Allowed User,allowed_user@alpha.com,Allowed Co",
    ].join("\n");

    const result = await engine.runImportAndEnroll({
      campaignId: campaignAId,
      businessId: bizAId,
      csvContent: csv,
      rangeType: "entire",
    });

    assert.equal(result.totalSelected, 2);
    assert.equal(result.enrolledCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.ok(result.rejectedRows.some((r) => r.email === suppressedEmail && r.reason.includes("suppression")));

    // Ensure suppressed email was NOT enrolled into campaign
    const enrollments = engine.getEnrollments(campaignAId);
    assert.ok(!enrollments.some((e) => e.email === suppressedEmail));
    assert.ok(enrollments.some((e) => e.email === "allowed_user@alpha.com"));
  });

  // 13. PREVIEW CALCULATION VERIFICATION
  await suite.test("13. Preview Calculation: correctly determines selected rows, first contact, and last contact", async () => {
    const rawRows = [
      ["First Name", "Last Name", "Email", "Company"],
      ["First Lead", "One", "first@example.com", "First Co"],
      ["Middle Lead 1", "Two", "middle1@example.com", "Mid 1 Co"],
      ["Middle Lead 2", "Three", "middle2@example.com", "Mid 2 Co"],
      ["Last Lead", "Four", "last@example.com", "Last Co"],
    ];
    const csv = rawRows.map((r) => r.join(",")).join("\n");
    const parsed = parseCsv(csv);
    const headers = parsed[0];
    assert.equal(headers.length, 4);
    const dataRows = parsed.slice(1);

    // Range: rows 2 to 4 (middle1 to last)
    const rangeVal = validateRowRange(dataRows.length, {
      rangeType: "custom",
      startRow: 2,
      endRow: 4,
    });
    assert.equal(rangeVal.isValid, true);
    assert.equal(rangeVal.startRow, 2);
    assert.equal(rangeVal.endRow, 4);

    const firstSelected = dataRows[rangeVal.startRow - 1];
    const lastSelected = dataRows[rangeVal.endRow - 1];

    assert.equal(firstSelected[2], "middle1@example.com");
    assert.equal(lastSelected[2], "last@example.com");
    assert.equal(rangeVal.endRow - rangeVal.startRow + 1, 3);
  });
});
