import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { createTestDb } from "./test-harness.mjs";
import { convertSpreadsheetToCsv } from "../lib/utils/spreadsheet.ts";
import { enrollContactsSchema } from "../lib/validations/campaign.ts";
import { parseCsv } from "../lib/utils/csv.ts";
import { validateRowRange } from "../lib/validations/contact.ts";

/**
 * Helper to build an in-memory XLSX Buffer for testing
 */
function createMockXlsxBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Test Engine simulating Campaign Enrollment & Direct Import operations
 */
class CampaignEnrollmentTestEngine {
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

  createCampaign(businessId, name = "Outreach Sequence") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, settings, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${name.replace(/'/g, "''")}', 'ACTIVE', 'UTC', '{}'::jsonb, NOW(), NOW());
    `);
    return id;
  }

  createCampaignStep(campaignId, stepNumber = 1, name = "Step 1") {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${id}', '${campaignId}', ${stepNumber}, '${name}', 0, 'days', 'ACTIVE', NOW(), NOW());
    `);
    return id;
  }

  createContact(businessId, { email, firstName = "Test", lastName = "User", company = "OPSIYS", status = "new" }) {
    const id = crypto.randomUUID();
    this.none(`
      INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status, lead_score, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${firstName}', '${lastName}', '${email.toLowerCase()}', '${company}', '${status}', 0, NOW(), NOW());
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

  getEnrolledContacts(campaignId) {
    return this.many(`
      SELECT cl.id, cl.lead_id, cl.email, cl.status, l.first_name, l.last_name, l.company_name
      FROM campaign_leads cl
      LEFT JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = '${campaignId}'
      ORDER BY cl.created_at ASC;
    `);
  }

  /**
   * Enrolls existing contacts with range selection and server-side validation
   */
  async enrollExistingWithRange({ campaignId, businessId, contactIds, rangeType = "all", startRow, endRow, totalAvailable, allowOverride = false }) {
    // 1. Validate Schema
    const schemaValidation = enrollContactsSchema.safeParse({
      contact_ids: contactIds,
      allow_override: allowOverride,
      range_type: rangeType,
      start_row: startRow,
      end_row: endRow,
      total_available: totalAvailable,
    });

    if (!schemaValidation.success) {
      const err = new Error(schemaValidation.error.issues[0]?.message || "Validation failed");
      err.status = 400;
      throw err;
    }

    // 2. Validate Row Range Server-Side
    if (rangeType === "range") {
      const availableRows = totalAvailable !== undefined ? totalAvailable : contactIds.length;
      const rangeVal = validateRowRange(availableRows, {
        rangeType: "range",
        startRow,
        endRow,
      });

      if (!rangeVal.isValid) {
        const err = new Error(rangeVal.error || "Invalid range selection");
        err.status = 400;
        throw err;
      }
    }

    // 3. Check existing enrollments
    const existingEnrollments = this.many(`
      SELECT lead_id, email FROM campaign_leads WHERE campaign_id = '${campaignId}';
    `);
    const enrolledLeadIds = new Set(existingEnrollments.map((e) => e.lead_id));

    let enrolledCount = 0;
    let skippedCount = 0;
    let alreadyEnrolledCount = 0;

    for (const cid of contactIds) {
      if (enrolledLeadIds.has(cid)) {
        skippedCount++;
        alreadyEnrolledCount++;
        continue;
      }

      const lead = this.oneOrNone(`SELECT * FROM leads WHERE id = '${cid}' AND business_id = '${businessId}';`);
      if (!lead) {
        skippedCount++;
        continue;
      }

      const enrId = crypto.randomUUID();
      this.none(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, email, status, metadata, created_at, updated_at)
        VALUES ('${enrId}', '${campaignId}', '${lead.id}', '${businessId}', '${lead.email}', 'ENROLLED', '{}'::jsonb, NOW(), NOW());
      `);
      enrolledLeadIds.add(lead.id);
      enrolledCount++;
    }

    return {
      success: true,
      enrolledCount,
      skippedCount,
      alreadyEnrolledCount,
    };
  }

  /**
   * Direct Contact Import & Enrollment Engine
   */
  async importAndEnroll({ campaignId, businessId, content, filename = "contacts.csv", rangeType = "all", startRow, endRow }) {
    if (!content || (typeof content === "string" && !content.trim())) {
      const err = new Error("Spreadsheet file is empty.");
      err.status = 400;
      throw err;
    }

    // 1. Convert to CSV text
    const standardCsv = convertSpreadsheetToCsv(content, filename);
    const parsed = parseCsv(standardCsv);

    if (parsed.length === 0) {
      const err = new Error("Spreadsheet contains no rows.");
      err.status = 400;
      throw err;
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      const err = new Error("Spreadsheet has missing or empty header row.");
      err.status = 400;
      throw err;
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));
    if (dataRows.length === 0) {
      const err = new Error("Spreadsheet contains no data rows.");
      err.status = 400;
      throw err;
    }

    // 2. Server-side range validation
    const rangeVal = validateRowRange(dataRows.length, {
      rangeType,
      startRow,
      endRow,
    });

    if (!rangeVal.isValid) {
      const err = new Error(rangeVal.error || "Invalid row range selection.");
      err.status = 400;
      throw err;
    }

    const effectiveStart = rangeVal.startRow || 1;
    const effectiveEnd = rangeVal.endRow || dataRows.length;
    const selectedRows = dataRows.slice(effectiveStart - 1, effectiveEnd);

    // 3. Mapping
    const emailIndex = rawHeaders.findIndex((h) => h.toLowerCase().includes("email"));
    if (emailIndex === -1) {
      const err = new Error("Email column mapping is required.");
      err.status = 400;
      throw err;
    }
    const nameIndex = rawHeaders.findIndex((h) => h.toLowerCase().includes("name"));
    const companyIndex = rawHeaders.findIndex((h) => h.toLowerCase().includes("company"));

    // 4. Candidate processing
    const rejectedRows = [];
    const seenEmailsInSelection = new Set();
    const candidateLeads = [];
    const emailFormatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      const actualFileRow = effectiveStart + i + 1; // +1 for header
      const rawEmail = (row[emailIndex] || "").trim();

      if (!rawEmail) {
        rejectedRows.push({ row: actualFileRow, email: "", reason: "Email is missing or empty" });
        continue;
      }

      const normEmail = rawEmail.toLowerCase();
      if (!emailFormatRegex.test(normEmail)) {
        rejectedRows.push({ row: actualFileRow, email: rawEmail, reason: `Invalid email format: "${rawEmail}"` });
        continue;
      }

      if (seenEmailsInSelection.has(normEmail)) {
        rejectedRows.push({ row: actualFileRow, email: rawEmail, reason: `Duplicate email "${rawEmail}" in selected range` });
        continue;
      }
      seenEmailsInSelection.add(normEmail);

      // Suppression check
      const suppressed = this.oneOrNone(`
        SELECT 1 FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normEmail}';
      `);
      if (suppressed) {
        rejectedRows.push({ row: actualFileRow, email: rawEmail, reason: `Recipient email "${rawEmail}" is suppressed` });
        continue;
      }

      const fullName = nameIndex !== -1 ? (row[nameIndex] || "").trim() : "";
      const [firstName, ...rest] = fullName.split(/\s+/);
      const lastName = rest.join(" ");
      const company = companyIndex !== -1 ? (row[companyIndex] || "").trim() : "";

      candidateLeads.push({
        email: normEmail,
        firstName: firstName || "Imported",
        lastName: lastName || "Lead",
        companyName: company || "Direct Import",
      });
    }

    // 5. Database Resolution
    let newContactsCount = 0;
    let existingContactsCount = 0;
    const resolvedContactIds = [];

    for (const cand of candidateLeads) {
      let existing = this.oneOrNone(`
        SELECT * FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${cand.email}';
      `);

      if (existing) {
        existingContactsCount++;
        resolvedContactIds.push(existing.id);
      } else {
        const newId = crypto.randomUUID();
        this.none(`
          INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status, lead_score, created_at, updated_at)
          VALUES ('${newId}', '${businessId}', '${cand.firstName}', '${cand.lastName}', '${cand.email}', '${cand.companyName}', 'new', 0, NOW(), NOW());
        `);
        resolvedContactIds.push(newId);
        newContactsCount++;
      }
    }

    // 6. Campaign Enrollment
    const existingEnrollments = this.many(`
      SELECT lead_id FROM campaign_leads WHERE campaign_id = '${campaignId}';
    `);
    const enrolledSet = new Set(existingEnrollments.map((e) => e.lead_id));

    let enrolledCount = 0;
    let alreadyEnrolledCount = 0;

    for (const cid of resolvedContactIds) {
      if (enrolledSet.has(cid)) {
        alreadyEnrolledCount++;
        continue;
      }

      const enrId = crypto.randomUUID();
      const lead = this.oneOrNone(`SELECT * FROM leads WHERE id = '${cid}';`);
      this.none(`
        INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, email, status, metadata, created_at, updated_at)
        VALUES ('${enrId}', '${campaignId}', '${cid}', '${businessId}', '${lead.email}', 'ENROLLED', '{}'::jsonb, NOW(), NOW());
      `);
      enrolledSet.add(cid);
      enrolledCount++;
    }

    const importedCount = newContactsCount + existingContactsCount;
    const failedCount = rejectedRows.filter((r) => r.reason.includes("Invalid") || r.reason.includes("missing")).length;
    const skippedCount = rejectedRows.length - failedCount;

    return {
      success: true,
      campaignId,
      totalAvailable: dataRows.length,
      totalSelected: selectedRows.length,
      importedCount,
      newContactsCount,
      existingContactsCount,
      enrolledCount,
      alreadyEnrolledCount,
      skippedCount,
      failedCount,
      errors: rejectedRows,
      range: {
        type: rangeType,
        startRow: effectiveStart,
        endRow: effectiveEnd,
      },
    };
  }
}

test("Campaign Enrollment Range Selection & Direct Contact Import Comprehensive Suite", async (suite) => {
  const { db } = createTestDb();
  const engine = new CampaignEnrollmentTestEngine(db);

  const businessId = engine.createBusiness("Apex Cloud Systems");
  const campaignId = engine.createCampaign(businessId, "Q4 Enterprise Growth Sequence");
  engine.createCampaignStep(campaignId, 1, "Initial Sequence Email");

  // Populate 40 existing contacts for range enrollment tests
  const existingContactIds = [];
  for (let i = 1; i <= 40; i++) {
    const id = engine.createContact(businessId, {
      email: `lead_${i}@apexcloud.io`,
      firstName: `Lead${i}`,
      lastName: `Person`,
      company: i <= 20 ? "Google Maps Leads" : "LinkedIn Sourced",
      status: "new",
    });
    existingContactIds.push(id);
  }

  // SCENARIO 1: Enroll Entire Contact List
  await suite.test("1. Enroll entire contact list into campaign", async () => {
    const res = await engine.enrollExistingWithRange({
      campaignId,
      businessId,
      contactIds: existingContactIds.slice(0, 10),
      rangeType: "all",
      totalAvailable: 10,
    });

    assert.equal(res.success, true);
    assert.equal(res.enrolledCount, 10);
    assert.equal(res.skippedCount, 0);

    const enrolled = engine.getEnrolledContacts(campaignId);
    assert.equal(enrolled.length, 10);
  });

  // SCENARIO 2: Enroll 1–10 Range
  await suite.test("2. Enroll 1–10 range into campaign", async () => {
    // Create new campaign for clean count
    const camp2 = engine.createCampaign(businessId, "Range 1-10 Test");
    const subset10 = existingContactIds.slice(0, 10);

    const res = await engine.enrollExistingWithRange({
      campaignId: camp2,
      businessId,
      contactIds: subset10,
      rangeType: "range",
      startRow: 1,
      endRow: 10,
      totalAvailable: 40,
    });

    assert.equal(res.success, true);
    assert.equal(res.enrolledCount, 10);
    const enrolled = engine.getEnrolledContacts(camp2);
    assert.equal(enrolled.length, 10);
    assert.equal(enrolled[0].email, "lead_1@apexcloud.io");
    assert.equal(enrolled[9].email, "lead_10@apexcloud.io");
  });

  // SCENARIO 3: Enroll 20–30 Range
  await suite.test("3. Enroll 20–30 range into campaign", async () => {
    const camp3 = engine.createCampaign(businessId, "Range 20-30 Test");
    // contacts 20 through 30 (11 contacts: index 19 to 29)
    const subset20_30 = existingContactIds.slice(19, 30);

    const res = await engine.enrollExistingWithRange({
      campaignId: camp3,
      businessId,
      contactIds: subset20_30,
      rangeType: "range",
      startRow: 20,
      endRow: 30,
      totalAvailable: 40,
    });

    assert.equal(res.success, true);
    assert.equal(res.enrolledCount, 11);
    const enrolled = engine.getEnrolledContacts(camp3);
    assert.equal(enrolled.length, 11);
    assert.equal(enrolled[0].email, "lead_20@apexcloud.io");
    assert.equal(enrolled[10].email, "lead_30@apexcloud.io");
  });

  // SCENARIO 4: Filtered Contacts 1–10
  await suite.test("4. Filter contacts (e.g. Source = Google Maps) then enroll range 1–10", async () => {
    const camp4 = engine.createCampaign(businessId, "Filtered Range Test");
    // Filter contacts where company = "Google Maps Leads" (first 20 contacts)
    const filteredLeads = existingContactIds.slice(0, 20);
    assert.equal(filteredLeads.length, 20);

    // Range 1-10 of this filtered set
    const filtered1_10 = filteredLeads.slice(0, 10);

    const res = await engine.enrollExistingWithRange({
      campaignId: camp4,
      businessId,
      contactIds: filtered1_10,
      rangeType: "range",
      startRow: 1,
      endRow: 10,
      totalAvailable: 20,
    });

    assert.equal(res.success, true);
    assert.equal(res.enrolledCount, 10);
    const enrolled = engine.getEnrolledContacts(camp4);
    assert.equal(enrolled.length, 10);
    for (const enr of enrolled) {
      assert.equal(enr.company_name, "Google Maps Leads");
    }
  });

  // SCENARIO 5: Import & Enroll CSV
  await suite.test("5. Import & Enroll standard CSV into campaign", async () => {
    const camp5 = engine.createCampaign(businessId, "CSV Direct Import Campaign");
    const csv = [
      "Name,Email,Company",
      "Kavita Sharma,kavita@techinnovate.com,Tech Innovate",
      "Vikram Singh,vikram@singhlogistics.in,Singh Logistics",
      "Priya Nair,priya@nairconsulting.org,Nair Consulting",
    ].join("\n");

    const res = await engine.importAndEnroll({
      campaignId: camp5,
      businessId,
      content: csv,
      filename: "prospects.csv",
      rangeType: "all",
    });

    assert.equal(res.success, true);
    assert.equal(res.importedCount, 3);
    assert.equal(res.enrolledCount, 3);
    assert.equal(res.alreadyEnrolledCount, 0);

    const enrolled = engine.getEnrolledContacts(camp5);
    assert.equal(enrolled.length, 3);
    assert.equal(enrolled[0].email, "kavita@techinnovate.com");
  });

  // SCENARIO 6: Import & Enroll Excel (.xlsx)
  await suite.test("6. Import & Enroll Excel spreadsheet (.xlsx binary) into campaign", async () => {
    const camp6 = engine.createCampaign(businessId, "Excel Direct Import Campaign");
    const rows = [
      ["Full Name", "Contact Email", "Company Name"],
      ["Rohan Verma", "rohan.verma@apexcloud.org", "Verma Financial"],
      ["Anita Roy", "anita.roy@royarchitects.com", "Roy Architects"],
    ];
    const xlsxBuffer = createMockXlsxBuffer(rows);

    const res = await engine.importAndEnroll({
      campaignId: camp6,
      businessId,
      content: xlsxBuffer,
      filename: "partners.xlsx",
      rangeType: "all",
    });

    assert.equal(res.success, true);
    assert.equal(res.importedCount, 2);
    assert.equal(res.enrolledCount, 2);

    const enrolled = engine.getEnrolledContacts(camp6);
    assert.equal(enrolled.length, 2);
    assert.equal(enrolled[0].email, "rohan.verma@apexcloud.org");
    assert.equal(enrolled[1].email, "anita.roy@royarchitects.com");
  });

  // SCENARIO 7: Import 1–10 into Campaign from a 30-row file
  await suite.test("7. Import 1–10 into campaign from larger file", async () => {
    const camp7 = engine.createCampaign(businessId, "Import Range 1-10");
    const rows = [["Name", "Email", "Company"]];
    for (let i = 1; i <= 30; i++) {
      rows.push([`Prospect ${i}`, `prospect_${i}@domain.com`, `Company ${i}`]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");

    const res = await engine.importAndEnroll({
      campaignId: camp7,
      businessId,
      content: csv,
      filename: "leads_30.csv",
      rangeType: "range",
      startRow: 1,
      endRow: 10,
    });

    assert.equal(res.totalAvailable, 30);
    assert.equal(res.totalSelected, 10);
    assert.equal(res.enrolledCount, 10);

    const enrolled = engine.getEnrolledContacts(camp7);
    assert.equal(enrolled.length, 10);
    assert.equal(enrolled[0].email, "prospect_1@domain.com");
    assert.equal(enrolled[9].email, "prospect_10@domain.com");
  });

  // SCENARIO 8: Import 20–30 into Campaign
  await suite.test("8. Import 20–30 into campaign from larger file", async () => {
    const camp8 = engine.createCampaign(businessId, "Import Range 20-30");
    const rows = [["Name", "Email", "Company"]];
    for (let i = 1; i <= 30; i++) {
      rows.push([`Prospect ${i}`, `prospect_b_${i}@domain.com`, `Company ${i}`]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");

    const res = await engine.importAndEnroll({
      campaignId: camp8,
      businessId,
      content: csv,
      filename: "leads_30.csv",
      rangeType: "range",
      startRow: 20,
      endRow: 30,
    });

    assert.equal(res.totalAvailable, 30);
    assert.equal(res.totalSelected, 11);
    assert.equal(res.enrolledCount, 11);

    const enrolled = engine.getEnrolledContacts(camp8);
    assert.equal(enrolled.length, 11);
    assert.equal(enrolled[0].email, "prospect_b_20@domain.com");
    assert.equal(enrolled[10].email, "prospect_b_30@domain.com");
  });

  // SCENARIO 9: Duplicate Contact inside File
  await suite.test("9. Duplicate contact in import file is deduplicated cleanly", async () => {
    const camp9 = engine.createCampaign(businessId, "Duplicate Test");
    const csv = [
      "Name,Email,Company",
      "First Copy,duplicate@example.com,Dup 1",
      "Second Copy,duplicate@example.com,Dup 2",
      "Third Unique,unique@example.com,Unique 3",
    ].join("\n");

    const res = await engine.importAndEnroll({
      campaignId: camp9,
      businessId,
      content: csv,
      rangeType: "all",
    });

    assert.equal(res.importedCount, 2);
    assert.equal(res.enrolledCount, 2);
    assert.equal(res.errors.length, 1);
    assert.ok(res.errors[0].reason.includes("Duplicate email"));
  });

  // SCENARIO 10: Already Enrolled Contact
  await suite.test("10. Already enrolled contact is skipped and does NOT create duplicate enrollment", async () => {
    const camp10 = engine.createCampaign(businessId, "Already Enrolled Test");
    const csv = [
      "Name,Email,Company",
      "Existing Enroll,repeat@example.com,Repeat Inc",
    ].join("\n");

    // First import
    const firstRes = await engine.importAndEnroll({
      campaignId: camp10,
      businessId,
      content: csv,
      rangeType: "all",
    });
    assert.equal(firstRes.enrolledCount, 1);
    assert.equal(firstRes.alreadyEnrolledCount, 0);

    // Second import of same contact
    const secondRes = await engine.importAndEnroll({
      campaignId: camp10,
      businessId,
      content: csv,
      rangeType: "all",
    });
    assert.equal(secondRes.enrolledCount, 0);
    assert.equal(secondRes.alreadyEnrolledCount, 1);

    const enrolled = engine.getEnrolledContacts(camp10);
    assert.equal(enrolled.length, 1); // No duplicate enrollment record!
  });

  // SCENARIO 11: Invalid Contact
  await suite.test("11. Invalid email contact is rejected with clear reason", async () => {
    const camp11 = engine.createCampaign(businessId, "Invalid Contact Test");
    const csv = [
      "Name,Email,Company",
      "Valid Contact,valid@company.com,Valid Co",
      "Bad Email,not-an-email,Bad Co",
      "Missing Email,,Missing Co",
    ].join("\n");

    const res = await engine.importAndEnroll({
      campaignId: camp11,
      businessId,
      content: csv,
      rangeType: "all",
    });

    assert.equal(res.enrolledCount, 1);
    assert.equal(res.failedCount, 2);
    assert.ok(res.errors.some((e) => e.reason.includes("Invalid email format")));
    assert.ok(res.errors.some((e) => e.reason.includes("missing or empty")));
  });

  // SCENARIO 12: Empty File
  await suite.test("12. Empty file is rejected safely with error", async () => {
    const camp12 = engine.createCampaign(businessId, "Empty File Test");

    await assert.rejects(
      async () => {
        await engine.importAndEnroll({
          campaignId: camp12,
          businessId,
          content: "   ",
        });
      },
      (err) => err.message.includes("empty")
    );
  });

  // SCENARIO 13: Invalid Range
  await suite.test("13. Invalid range (start > end, start < 1, non-numeric) is rejected", async () => {
    const camp13 = engine.createCampaign(businessId, "Invalid Range Test");
    const csv = [
      "Name,Email",
      "One,one@test.com",
      "Two,two@test.com",
      "Three,three@test.com",
      "Four,four@test.com",
      "Five,five@test.com",
      "Six,six@test.com",
    ].join("\n");

    // start > end
    await assert.rejects(
      async () => {
        await engine.importAndEnroll({
          campaignId: camp13,
          businessId,
          content: csv,
          rangeType: "range",
          startRow: 5,
          endRow: 2,
        });
      },
      (err) => err.message.includes("must be greater than or equal to Start")
    );

    // start < 1
    await assert.rejects(
      async () => {
        await engine.importAndEnroll({
          campaignId: camp13,
          businessId,
          content: csv,
          rangeType: "range",
          startRow: 0,
          endRow: 2,
        });
      },
      (err) => err.message.includes("greater than or equal to 1")
    );

    // non-numeric
    await assert.rejects(
      async () => {
        await engine.importAndEnroll({
          campaignId: camp13,
          businessId,
          content: csv,
          rangeType: "range",
          startRow: "abc",
          endRow: 2,
        });
      },
      (err) => err.message.includes("positive integers")
    );
  });

  // SCENARIO 14: Range Larger Than Available Contacts
  await suite.test("14. Range larger than available contacts is rejected", async () => {
    const camp14 = engine.createCampaign(businessId, "Oversize Range Test");
    const csv = "Name,Email\nOne,one@test.com\nTwo,two@test.com\n";

    await assert.rejects(
      async () => {
        await engine.importAndEnroll({
          campaignId: camp14,
          businessId,
          content: csv,
          rangeType: "range",
          startRow: 1,
          endRow: 50,
        });
      },
      (err) => err.message.includes("cannot exceed available data rows")
    );
  });

  // SCENARIO 15: Large Import
  await suite.test("15. Large import (150 contacts) handles row range and enrollment smoothly", async () => {
    const camp15 = engine.createCampaign(businessId, "Large Import Campaign");
    const rows = [["Name", "Email", "Company"]];
    for (let i = 1; i <= 150; i++) {
      rows.push([`User ${i}`, `large_import_${i}@scaletest.io`, `Enterprise ${i}`]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");

    // Import range 51-100 (50 contacts)
    const res = await engine.importAndEnroll({
      campaignId: camp15,
      businessId,
      content: csv,
      filename: "large_roster.csv",
      rangeType: "range",
      startRow: 51,
      endRow: 100,
    });

    assert.equal(res.totalAvailable, 150);
    assert.equal(res.totalSelected, 50);
    assert.equal(res.enrolledCount, 50);

    const enrolled = engine.getEnrolledContacts(camp15);
    assert.equal(enrolled.length, 50);
    assert.equal(enrolled[0].email, "large_import_51@scaletest.io");
    assert.equal(enrolled[49].email, "large_import_100@scaletest.io");
  });
});
