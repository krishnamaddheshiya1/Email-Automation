import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  createTemplateSchema,
  updateTemplateSchema,
  duplicateTemplateSchema,
  templateListQuerySchema,
} from "../lib/validations/template.ts";
import {
  extractVariables,
  renderTemplate,
  replaceVariablesInString,
  SAMPLE_PREVIEW_CONTACT,
  SAMPLE_PREVIEW_SENDER,
  sanitizeHtml,
  escapeHtml,
} from "../lib/utils/template.ts";

test("Phase 5: Email Templates and Personalization Test Suite", async (t) => {
  const { db } = createTestDb();

  // Provision two isolated businesses
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizAId}', 'Alpha Enterprise A', 'UTC', 'active'),
           ('${bizBId}', 'Beta Technologies B', 'America/New_York', 'active');
  `);

  // Helper functions simulating scoped repository operations against PostgreSQL schema
  function createScopedTemplate(businessId, data) {
    const validated = createTemplateSchema.parse(data);
    const id = crypto.randomUUID();
    const cleanBody = sanitizeHtml(validated.body);
    const detectedVars = extractVariables(`${validated.subject} ${cleanBody}`);

    db.public.none(`
      INSERT INTO email_templates (
        id, business_id, name, subject, body, variables, status, created_at, updated_at
      )
      VALUES (
        '${id}', '${businessId}', '${validated.name.replace(/'/g, "''")}',
        '${validated.subject.replace(/'/g, "''")}', '${cleanBody.replace(/'/g, "''")}',
        '${JSON.stringify(detectedVars)}'::jsonb, '${validated.status || "active"}',
        NOW(), NOW()
      );
    `);

    const row = db.public.one(`SELECT * FROM email_templates WHERE id = '${id}';`);
    return {
      ...row,
      variables: typeof row.variables === "string" ? JSON.parse(row.variables) : row.variables,
    };
  }

  function getScopedTemplate(businessId, id) {
    const rows = db.public.many(
      `SELECT * FROM email_templates WHERE id = '${id}' AND business_id = '${businessId}';`
    );
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row,
      variables: typeof row.variables === "string" ? JSON.parse(row.variables) : row.variables,
    };
  }

  function updateScopedTemplate(businessId, id, data) {
    const validated = updateTemplateSchema.parse(data);
    const existing = getScopedTemplate(businessId, id);
    if (!existing) {
      throw new Error("Template not found or access denied.");
    }

    const nextName = validated.name !== undefined ? validated.name : existing.name;
    const nextSubject = validated.subject !== undefined ? validated.subject : existing.subject;
    const nextBody =
      validated.body !== undefined ? sanitizeHtml(validated.body) : existing.body;
    const nextStatus = validated.status !== undefined ? validated.status : existing.status;
    const nextVars = extractVariables(`${nextSubject} ${nextBody}`);

    db.public.none(`
      UPDATE email_templates
      SET name = '${nextName.replace(/'/g, "''")}',
          subject = '${nextSubject.replace(/'/g, "''")}',
          body = '${nextBody.replace(/'/g, "''")}',
          variables = '${JSON.stringify(nextVars)}'::jsonb,
          status = '${nextStatus}',
          updated_at = NOW()
      WHERE id = '${id}' AND business_id = '${businessId}';
    `);

    return getScopedTemplate(businessId, id);
  }

  function duplicateScopedTemplate(businessId, id, newName) {
    const existing = getScopedTemplate(businessId, id);
    if (!existing) {
      throw new Error("Template not found or access denied.");
    }

    const copyName = newName || `${existing.name} Copy`;
    return createScopedTemplate(businessId, {
      name: copyName,
      subject: existing.subject,
      body: existing.body,
      status: existing.status === "archived" ? "draft" : existing.status,
    });
  }

  function archiveScopedTemplate(businessId, id) {
    return updateScopedTemplate(businessId, id, { status: "archived" });
  }

  function listScopedTemplates(businessId, query = {}) {
    const parsed = templateListQuerySchema.parse(query);
    let sql = `SELECT * FROM email_templates WHERE business_id = '${businessId}'`;

    if (parsed.status && parsed.status !== "all") {
      sql += ` AND status = '${parsed.status}'`;
    }

    if (parsed.search) {
      const s = parsed.search.toLowerCase();
      sql += ` AND (LOWER(name) LIKE '%${s}%' OR LOWER(subject) LIKE '%${s}%')`;
    }

    sql += ` ORDER BY updated_at DESC`;
    const rows = db.public.many(sql);
    return rows.map((r) => ({
      ...r,
      variables: typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables,
    }));
  }

  // -------------------------------------------------------------
  // Test 1: Create template with valid data & auto variable detection
  // -------------------------------------------------------------
  await t.test("1. Create template with valid data and auto variable detection", () => {
    const tpl = createScopedTemplate(bizAId, {
      name: "Initial Outreach",
      subject: "Quick question for {{company_name}}",
      body: "<p>Hi {{first_name}},</p><p>I noticed you are working at {{company_name}}.</p><p>Best,<br>{{sender_name}}</p>",
      status: "active",
    });

    assert.ok(tpl.id, "Template should have an assigned ID");
    assert.equal(tpl.business_id, bizAId);
    assert.equal(tpl.name, "Initial Outreach");
    assert.equal(tpl.subject, "Quick question for {{company_name}}");
    assert.equal(tpl.status, "active");
    // Verify auto-detected variables
    assert.deepEqual(
      tpl.variables.sort(),
      ["company_name", "first_name", "sender_name"].sort(),
      "Variables must be automatically extracted from subject and body"
    );
  });

  // -------------------------------------------------------------
  // Test 2: Get template by ID scoped to business
  // -------------------------------------------------------------
  await t.test("2. Get template by ID scoped to business", () => {
    const created = createScopedTemplate(bizAId, {
      name: "Follow-up Touch",
      subject: "Checking back with {{first_name}}",
      body: "<p>Hi {{first_name}}, any thoughts?</p>",
    });

    const retrieved = getScopedTemplate(bizAId, created.id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, created.id);
    assert.equal(retrieved.name, "Follow-up Touch");
  });

  // -------------------------------------------------------------
  // Test 3: Update template
  // -------------------------------------------------------------
  await t.test("3. Update template subject, body, and status", () => {
    const created = createScopedTemplate(bizAId, {
      name: "Draft Pitch",
      subject: "Hello {{first_name}}",
      body: "<p>Initial proposal for {{company_name}}</p>",
      status: "draft",
    });

    const updated = updateScopedTemplate(bizAId, created.id, {
      name: "Refined Pitch V2",
      subject: "Exciting ideas for {{company_name}} and {{job_title}}",
      body: "<p>Updated body mentioning {{business_name}}</p>",
      status: "active",
    });

    assert.equal(updated.name, "Refined Pitch V2");
    assert.equal(updated.status, "active");
    assert.ok(updated.variables.includes("job_title"));
    assert.ok(updated.variables.includes("business_name"));
  });

  // -------------------------------------------------------------
  // Test 4: Duplicate template
  // -------------------------------------------------------------
  await t.test("4. Duplicate template generates new ID, preserves variables, and stays in business", () => {
    const original = createScopedTemplate(bizAId, {
      name: "Master Outreach Sequence",
      subject: "Partnership with {{company_name}}",
      body: "<p>Hi {{first_name}}, let's connect.</p>",
      status: "active",
    });

    const copy = duplicateScopedTemplate(bizAId, original.id);

    assert.notEqual(copy.id, original.id, "Duplicated template must receive a new ID");
    assert.equal(copy.business_id, bizAId, "Duplicated template must retain same business_id");
    assert.equal(copy.name, "Master Outreach Sequence Copy", "Duplicated template name should have Copy appended");
    assert.equal(copy.subject, original.subject);
    assert.equal(copy.body, original.body);
    assert.deepEqual(copy.variables, original.variables);
  });

  // -------------------------------------------------------------
  // Test 5: Archive template (soft-delete)
  // -------------------------------------------------------------
  await t.test("5. Archive template soft-deletes record and retains historical data", () => {
    const created = createScopedTemplate(bizAId, {
      name: "Retired Sequence",
      subject: "Old Subject",
      body: "<p>Old body</p>",
      status: "active",
    });

    const archived = archiveScopedTemplate(bizAId, created.id);
    assert.equal(archived.status, "archived", "Archiving must set status to archived");

    // Verify it still exists in the database
    const fromDb = getScopedTemplate(bizAId, created.id);
    assert.ok(fromDb, "Archived template record must not be permanently deleted");
    assert.equal(fromDb.status, "archived");

    // Verify active filter excludes it
    const activeList = listScopedTemplates(bizAId, { status: "active" });
    assert.equal(
      activeList.some((t) => t.id === created.id),
      false,
      "Active template list must exclude archived templates"
    );

    // Verify archived filter includes it
    const archivedList = listScopedTemplates(bizAId, { status: "archived" });
    assert.equal(
      archivedList.some((t) => t.id === created.id),
      true,
      "Archived template list must include archived templates"
    );
  });

  // -------------------------------------------------------------
  // Test 6: Search templates by name and subject
  // -------------------------------------------------------------
  await t.test("6. Search templates by name and subject substring", () => {
    createScopedTemplate(bizAId, {
      name: "Enterprise Saas Demo",
      subject: "Scaling software infrastructure",
      body: "<p>Hello</p>",
    });

    createScopedTemplate(bizAId, {
      name: "Retail Partner Nurture",
      subject: "Exclusive catalog update",
      body: "<p>Catalog details</p>",
    });

    const matchName = listScopedTemplates(bizAId, { search: "Enterprise", status: "all" });
    assert.ok(matchName.length >= 1);
    assert.ok(matchName.some((t) => t.name.includes("Enterprise")));

    const matchSubject = listScopedTemplates(bizAId, { search: "infrastructure", status: "all" });
    assert.ok(matchSubject.length >= 1);
    assert.ok(matchSubject.some((t) => t.subject.includes("infrastructure")));

    const matchNone = listScopedTemplates(bizAId, { search: "NonExistentKeywordXYZ", status: "all" });
    assert.equal(matchNone.length, 0);
  });

  // -------------------------------------------------------------
  // Test 7: Template validation rules
  // -------------------------------------------------------------
  await t.test("7. Template validation rejects empty fields and oversize content", () => {
    // Missing/empty name
    assert.throws(
      () => createTemplateSchema.parse({ name: "", subject: "Subject", body: "Body" }),
      /Template name is required/
    );

    // Missing/empty subject
    assert.throws(
      () => createTemplateSchema.parse({ name: "Name", subject: "", body: "Body" }),
      /Subject is required/
    );

    // Missing/empty body
    assert.throws(
      () => createTemplateSchema.parse({ name: "Name", subject: "Subject", body: "" }),
      /Email body is required/
    );

    // Excessively long name (>255)
    assert.throws(
      () => createTemplateSchema.parse({ name: "A".repeat(256), subject: "Subject", body: "Body" }),
      /Template name cannot exceed 255 characters/
    );

    // Excessively long subject (>500)
    assert.throws(
      () => createTemplateSchema.parse({ name: "Name", subject: "S".repeat(501), body: "Body" }),
      /Subject cannot exceed 500 characters/
    );
  });

  // -------------------------------------------------------------
  // Test 8: Variable replacement with sample and custom data
  // -------------------------------------------------------------
  await t.test("8. Variable replacement handles all supported variables cleanly", () => {
    const rawTemplate = {
      subject: "Hi {{first_name}}, check {{company_name}}",
      body: "<p>Dear {{first_name}} {{last_name}},</p><p>We know you are {{job_title}} at {{company_name}} in the {{industry}} space. We visited {{website}} and emailed {{email}}.</p><p>From: {{sender_name}} at {{business_name}}</p>",
    };

    const rendered = renderTemplate(
      rawTemplate,
      SAMPLE_PREVIEW_CONTACT,
      SAMPLE_PREVIEW_SENDER
    );

    assert.equal(rendered.subject, "Hi Rahul, check Demo Company");
    assert.ok(rendered.body.includes("Dear Rahul Sharma,"));
    assert.ok(rendered.body.includes("Founder at Demo Company"));
    assert.ok(rendered.body.includes("in the Software space"));
    assert.ok(rendered.body.includes("visited https://example.test"));
    assert.ok(rendered.body.includes("emailed rahul@example.test"));
    assert.ok(rendered.body.includes("From: Demo Sender at Demo Business"));
    assert.equal(rendered.missingVariables.length, 0);
  });

  // -------------------------------------------------------------
  // Test 9: Missing variable handling
  // -------------------------------------------------------------
  await t.test("9. Missing variables are visibly identified with [Missing <name>]", () => {
    const rawTemplate = {
      subject: "Quick question for {{company_name}}",
      body: "<p>Hello {{first_name}}, what is your role at {{company_name}} as {{job_title}}?</p>",
    };

    // Partial contact with missing company_name and job_title
    const partialContact = {
      first_name: "Anita",
      email: "anita@example.test",
    };

    const rendered = renderTemplate(rawTemplate, partialContact, {});

    assert.equal(rendered.subject, "Quick question for [Missing company_name]");
    assert.ok(rendered.body.includes("Hello Anita"));
    assert.ok(rendered.body.includes("[Missing company_name]"));
    assert.ok(rendered.body.includes("[Missing job_title]"));
    assert.deepEqual(rendered.missingVariables.sort(), ["company_name", "job_title"].sort());
  });

  // -------------------------------------------------------------
  // Test 10: MANDATORY Multi-Tenant Business Isolation
  // -------------------------------------------------------------
  await t.test("10. MANDATORY: Multi-Tenant Isolation between Business A and Business B", () => {
    // Create Template A for Business A
    const tplA = createScopedTemplate(bizAId, {
      name: "Confidential Strategy Template A",
      subject: "Subject A for {{company_name}}",
      body: "<p>Body A private content</p>",
    });

    // Create Template B for Business B
    const tplB = createScopedTemplate(bizBId, {
      name: "Confidential Strategy Template B",
      subject: "Subject B for {{company_name}}",
      body: "<p>Body B private content</p>",
    });

    // Business A can access Template A
    assert.ok(getScopedTemplate(bizAId, tplA.id), "Business A must access Template A");

    // Business A CANNOT access Template B
    assert.equal(
      getScopedTemplate(bizAId, tplB.id),
      null,
      "Cross-tenant leak: Business A must NOT access Template B"
    );

    // Business B can access Template B
    assert.ok(getScopedTemplate(bizBId, tplB.id), "Business B must access Template B");

    // Business B CANNOT access Template A
    assert.equal(
      getScopedTemplate(bizBId, tplA.id),
      null,
      "Cross-tenant leak: Business B must NOT access Template A"
    );

    // Listing templates for Business A returns only Business A's templates
    const listA = listScopedTemplates(bizAId, { status: "all" });
    assert.ok(listA.every((t) => t.business_id === bizAId));
    assert.equal(listA.some((t) => t.id === tplB.id), false);

    // Listing templates for Business B returns only Business B's templates
    const listB = listScopedTemplates(bizBId, { status: "all" });
    assert.ok(listB.every((t) => t.business_id === bizBId));
    assert.equal(listB.some((t) => t.id === tplA.id), false);
  });

  // -------------------------------------------------------------
  // Test 11: Unauthorized template update and duplicate rejection
  // -------------------------------------------------------------
  await t.test("11. Unauthorized cross-tenant updates and duplication are rejected", () => {
    const tplA = createScopedTemplate(bizAId, {
      name: "Business A Original",
      subject: "Subject A",
      body: "<p>Body A</p>",
    });

    // Business B tries to update Business A's template
    assert.throws(
      () => updateScopedTemplate(bizBId, tplA.id, { name: "Hacked by B" }),
      /Template not found or access denied/
    );

    // Business B tries to duplicate Business A's template
    assert.throws(
      () => duplicateScopedTemplate(bizBId, tplA.id),
      /Template not found or access denied/
    );

    // Business B tries to archive Business A's template
    assert.throws(
      () => archiveScopedTemplate(bizBId, tplA.id),
      /Template not found or access denied/
    );
  });

  // -------------------------------------------------------------
  // Test 12: HTML & Script Sanitization (XSS defense)
  // -------------------------------------------------------------
  await t.test("12. HTML & Script Sanitization strips dangerous tags and javascript: links", () => {
    // 1. Script tag injection
    const maliciousScript = "<p>Hello</p><script>alert('XSS')</script><p>World</p>";
    const sanitizedScript = sanitizeHtml(maliciousScript);
    assert.equal(sanitizedScript.includes("<script>"), false);
    assert.equal(sanitizedScript.includes("alert"), false);
    assert.ok(sanitizedScript.includes("<p>Hello</p>"));
    assert.ok(sanitizedScript.includes("<p>World</p>"));

    // 2. Inline event handler (onerror, onload)
    const maliciousImg = '<img src="invalid.jpg" onerror="alert(1)" /><p>Picture</p>';
    const sanitizedImg = sanitizeHtml(maliciousImg);
    assert.equal(sanitizedImg.includes("onerror"), false);
    assert.equal(sanitizedImg.includes("alert"), false);

    // 3. javascript: link
    const maliciousLink = '<a href="javascript:void(document.cookie)">Click me</a>';
    const sanitizedLink = sanitizeHtml(maliciousLink);
    assert.equal(sanitizedLink.includes("javascript:"), false);

    // 4. iframe injection
    const maliciousIframe = '<iframe src="https://evil-site.test"></iframe>';
    const sanitizedIframe = sanitizeHtml(maliciousIframe);
    assert.equal(sanitizedIframe.includes("iframe"), false);

    // 5. Safe formatting preserved
    const safeHtml = '<p><b>Bold</b> and <i>Italic</i> with <a href="https://example.test">Safe Link</a></p>';
    const sanitizedSafe = sanitizeHtml(safeHtml);
    assert.ok(sanitizedSafe.includes("<b>Bold</b>"));
    assert.ok(sanitizedSafe.includes("<i>Italic</i>"));
    assert.ok(sanitizedSafe.includes('href="https://example.test"'));
    assert.ok(sanitizedSafe.includes('rel="noopener noreferrer"'));
  });

  // -------------------------------------------------------------
  // Test 13: Arbitrary expressions safety
  // -------------------------------------------------------------
  await t.test("13. Arbitrary expressions (scripting, eval, math) are not executed", () => {
    const rawTemplate = {
      subject: "Math test {{7 * 7}} and {{process.env.SECRET}}",
      body: "<p>Expression: {{<script>alert(1)</script>}} and safe {{first_name}}</p>",
    };

    const rendered = renderTemplate(rawTemplate, { first_name: "Priya" }, {});

    // Arbitrary expressions like {{7 * 7}} should NOT evaluate to 49
    assert.equal(rendered.subject.includes("49"), false);
    assert.ok(rendered.subject.includes("{{7 * 7}}"));
    // Safe variable is properly rendered
    assert.ok(rendered.body.includes("safe Priya"));
    // Scripts inside curly braces are sanitized
    assert.equal(rendered.body.includes("<script>"), false);

    // Verify duplicateTemplateSchema validation
    const validDup = duplicateTemplateSchema.parse({ name: "Custom Copy" });
    assert.equal(validDup.name, "Custom Copy");

    // Verify replaceVariablesInString helper
    const replaced = replaceVariablesInString("Hi {{first_name}}", { first_name: "Priya" }, {});
    assert.equal(replaced.text, "Hi Priya");

    // Verify escapeHtml utility
    assert.equal(escapeHtml("<script>&'\""), "&lt;script&gt;&amp;&#39;&quot;");
  });
});
