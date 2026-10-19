import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  createCampaignSchema,
  updateCampaignSchema,
  createCampaignStepSchema,
  updateCampaignStepSchema,
  enrollContactsSchema,
  campaignListQuerySchema,
} from "../lib/validations/campaign.ts";

test("Phase 6: Campaign Builder & Configuration Test Suite", async (t) => {
  const { db } = createTestDb();

  // Provision two isolated businesses
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status)
    VALUES ('${bizAId}', 'Acme Corporation A', 'America/New_York', 'active'),
           ('${bizBId}', 'Stark Industries B', 'Europe/London', 'active');
  `);

  // Provision contacts (leads) for Business A and Business B
  const leadA1Id = crypto.randomUUID();
  const leadA2Id = crypto.randomUUID();
  const leadB1Id = crypto.randomUUID();

  db.public.none(`
    INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, status)
    VALUES ('${leadA1Id}', '${bizAId}', 'Alice', 'Smith', 'alice@example.com', 'Acme Corp', 'new'),
           ('${leadA2Id}', '${bizAId}', 'Bob', 'Jones', 'bob@example.com', 'Jones Media', 'contacted'),
           ('${leadB1Id}', '${bizBId}', 'Tony', 'Stark', 'tony@stark.com', 'Stark Industries', 'new');
  `);

  // Provision email templates for Business A and Business B
  const tplA1Id = crypto.randomUUID();
  const tplA2Id = crypto.randomUUID();
  const tplB1Id = crypto.randomUUID();
  const tplArchivedId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status)
    VALUES ('${tplA1Id}', '${bizAId}', 'Intro Outreach', 'Hello {{first_name}}', '<p>Hi</p>', 'active'),
           ('${tplA2Id}', '${bizAId}', 'Follow-up 1', 'Checking in {{company_name}}', '<p>Follow-up</p>', 'active'),
           ('${tplB1Id}', '${bizBId}', 'Stark Intro', 'Greetings from Stark', '<p>Stark</p>', 'active'),
           ('${tplArchivedId}', '${bizAId}', 'Old Archived Template', 'Archived', '<p>Archived</p>', 'archived');
  `);

  // ==========================================
  // Helper Functions Simulating Service Layer
  // ==========================================

  function createCampaign(businessId, data) {
    const validated = createCampaignSchema.parse(data);
    const id = crypto.randomUUID();
    const statusVal = (validated.status || "DRAFT").toUpperCase();

    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, description, timezone, status, settings, created_at, updated_at)
      VALUES (
        '${id}', '${businessId}', '${validated.name.replace(/'/g, "''")}',
        ${validated.description ? `'${validated.description.replace(/'/g, "''")}'` : "NULL"},
        '${validated.timezone || "UTC"}', '${statusVal}',
        '${JSON.stringify(validated.settings || {})}'::jsonb,
        NOW(), NOW()
      );
    `);

    return db.public.one(`SELECT * FROM campaigns WHERE id = '${id}';`);
  }

  function getCampaign(businessId, id) {
    const rows = db.public.many(
      `SELECT * FROM campaigns WHERE id = '${id}' AND business_id = '${businessId}';`
    );
    if (!rows || rows.length === 0) {
      throw new Error("Campaign not found or access denied.");
    }
    const campaign = rows[0];
    const steps = db.public.many(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${id}' ORDER BY step_number ASC;`
    );
    const contactCount = db.public.many(
      `SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = '${id}' AND UPPER(status) = 'ENROLLED';`
    );

    return {
      ...campaign,
      steps: steps || [],
      contact_count: parseInt(contactCount[0]?.count || "0", 10),
    };
  }

  function listCampaigns(businessId, query = {}) {
    const validated = campaignListQuerySchema.parse(query);
    const rows = db.public.many(
      `SELECT * FROM campaigns WHERE business_id = '${businessId}' ORDER BY created_at DESC;`
    );

    const summaries = rows.map((c) => {
      const stepCount = db.public.many(
        `SELECT COUNT(*) as count FROM campaign_steps WHERE campaign_id = '${c.id}';`
      );
      const contactCount = db.public.many(
        `SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = '${c.id}' AND UPPER(status) = 'ENROLLED';`
      );
      return {
        ...c,
        step_count: parseInt(stepCount[0]?.count || "0", 10),
        contact_count: parseInt(contactCount[0]?.count || "0", 10),
      };
    });

    return {
      data: summaries,
      total: summaries.length,
      page: validated.page,
      limit: validated.limit,
    };
  }

  function updateCampaign(businessId, id, data) {
    const validated = updateCampaignSchema.parse(data);
    getCampaign(businessId, id); // Verify ownership

    const updates = [];
    if (validated.name !== undefined) updates.push(`name = '${validated.name.replace(/'/g, "''")}'`);
    if (validated.description !== undefined) {
      updates.push(
        `description = ${validated.description ? `'${validated.description.replace(/'/g, "''")}'` : "NULL"}`
      );
    }
    if (validated.timezone !== undefined) updates.push(`timezone = '${validated.timezone}'`);
    if (validated.status !== undefined) updates.push(`status = '${validated.status.toUpperCase()}'`);
    updates.push("updated_at = NOW()");

    db.public.none(
      `UPDATE campaigns SET ${updates.join(", ")} WHERE id = '${id}' AND business_id = '${businessId}';`
    );

    return getCampaign(businessId, id);
  }

  function archiveCampaign(businessId, id) {
    return updateCampaign(businessId, id, { status: "ARCHIVED" });
  }

  function duplicateCampaign(businessId, id, newName) {
    const orig = getCampaign(businessId, id);
    const name = newName || `${orig.name} Copy`;
    const copy = createCampaign(businessId, {
      name,
      description: orig.description,
      timezone: orig.timezone,
      status: "DRAFT",
    });

    const steps = orig.steps || [];
    const copiedSteps = [];
    for (const step of steps) {
      const s = addStep(businessId, copy.id, {
        name: step.name,
        step_number: step.step_number,
        template_id: step.template_id,
        delay_value: step.delay_value,
        delay_unit: step.delay_unit,
        status: step.status,
      });
      copiedSteps.push(s);
    }

    return { campaign: copy, steps: copiedSteps };
  }

  function addStep(businessId, campaignId, data) {
    getCampaign(businessId, campaignId); // Verify ownership
    const validated = createCampaignStepSchema.parse(data);

    // Verify template belongs to business if provided
    if (validated.template_id) {
      const tpls = db.public.many(
        `SELECT * FROM email_templates WHERE id = '${validated.template_id}' AND business_id = '${businessId}';`
      );
      if (!tpls || tpls.length === 0) {
        throw new Error("Selected template does not exist or access denied.");
      }
    }

    let stepNum = validated.step_number;
    if (!stepNum) {
      const existing = db.public.many(
        `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}';`
      );
      stepNum = existing.length > 0 ? Math.max(...existing.map((s) => s.step_number)) + 1 : 1;
    }

    const stepId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaign_steps (
        id, campaign_id, step_number, name, delay_value, delay_unit, status, template_id, settings, created_at, updated_at
      )
      VALUES (
        '${stepId}', '${campaignId}', ${stepNum}, '${validated.name.replace(/'/g, "''")}',
        ${validated.delay_value ?? 0}, '${validated.delay_unit || "days"}',
        '${(validated.status || "ACTIVE").toUpperCase()}',
        ${validated.template_id ? `'${validated.template_id}'` : "NULL"},
        '${JSON.stringify(validated.settings || {})}'::jsonb,
        NOW(), NOW()
      );
    `);

    return db.public.one(`SELECT * FROM campaign_steps WHERE id = '${stepId}';`);
  }

  function getSteps(businessId, campaignId) {
    getCampaign(businessId, campaignId); // Verify ownership
    return db.public.many(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' ORDER BY step_number ASC;`
    );
  }

  function updateStep(businessId, campaignId, stepId, data) {
    getCampaign(businessId, campaignId);
    const validated = updateCampaignStepSchema.parse(data);

    if (validated.template_id) {
      const tpls = db.public.many(
        `SELECT * FROM email_templates WHERE id = '${validated.template_id}' AND business_id = '${businessId}';`
      );
      if (!tpls || tpls.length === 0) {
        throw new Error("Selected template does not exist or access denied.");
      }
    }

    const updates = [];
    if (validated.name !== undefined) updates.push(`name = '${validated.name.replace(/'/g, "''")}'`);
    if (validated.step_number !== undefined) updates.push(`step_number = ${validated.step_number}`);
    if (validated.delay_value !== undefined) updates.push(`delay_value = ${validated.delay_value}`);
    if (validated.delay_unit !== undefined) updates.push(`delay_unit = '${validated.delay_unit}'`);
    if (validated.status !== undefined) updates.push(`status = '${validated.status.toUpperCase()}'`);
    if (validated.template_id !== undefined) {
      updates.push(`template_id = ${validated.template_id ? `'${validated.template_id}'` : "NULL"}`);
    }
    updates.push("updated_at = NOW()");

    db.public.none(
      `UPDATE campaign_steps SET ${updates.join(", ")} WHERE id = '${stepId}' AND campaign_id = '${campaignId}';`
    );

    return db.public.one(`SELECT * FROM campaign_steps WHERE id = '${stepId}';`);
  }

  function deleteStep(businessId, campaignId, stepId) {
    getCampaign(businessId, campaignId);
    db.public.none(
      `DELETE FROM campaign_steps WHERE id = '${stepId}' AND campaign_id = '${campaignId}';`
    );

    // Resequence remaining steps
    const remaining = db.public.many(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' ORDER BY step_number ASC;`
    );
    for (let i = 0; i < remaining.length; i++) {
      const expected = i + 1;
      if (remaining[i].step_number !== expected) {
        db.public.none(
          `UPDATE campaign_steps SET step_number = ${expected} WHERE id = '${remaining[i].id}';`
        );
      }
    }
    return true;
  }

  function reorderSteps(businessId, campaignId, stepIds) {
    getCampaign(businessId, campaignId);
    // Phase 1: Set temporary numbers to avoid unique constraint collision
    for (let i = 0; i < stepIds.length; i++) {
      db.public.none(
        `UPDATE campaign_steps SET step_number = ${10000 + i + 1} WHERE id = '${stepIds[i]}' AND campaign_id = '${campaignId}';`
      );
    }
    // Phase 2: Set final sequential 1-indexed numbers
    for (let i = 0; i < stepIds.length; i++) {
      db.public.none(
        `UPDATE campaign_steps SET step_number = ${i + 1} WHERE id = '${stepIds[i]}' AND campaign_id = '${campaignId}';`
      );
    }
    return getSteps(businessId, campaignId);
  }

  function enrollContacts(businessId, campaignId, leadIds) {
    getCampaign(businessId, campaignId);
    const validated = enrollContactsSchema.parse({ contact_ids: leadIds });

    let enrolledCount = 0;
    let skippedCount = 0;

    for (const lid of validated.contact_ids) {
      // Must belong to this business
      const leads = db.public.many(
        `SELECT * FROM leads WHERE id = '${lid}' AND business_id = '${businessId}';`
      );
      if (!leads || leads.length === 0) {
        skippedCount++;
        continue;
      }

      // Check existing enrollment
      const existing = db.public.many(
        `SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND lead_id = '${lid}';`
      );
      if (existing.length > 0) {
        db.public.none(
          `UPDATE campaign_leads SET status = 'ENROLLED', updated_at = NOW() WHERE campaign_id = '${campaignId}' AND lead_id = '${lid}';`
        );
        enrolledCount++;
      } else {
        const clId = crypto.randomUUID();
        db.public.none(`
          INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, enrolled_at, metadata, created_at, updated_at)
          VALUES ('${clId}', '${campaignId}', '${lid}', '${businessId}', 'ENROLLED', NOW(), '{}'::jsonb, NOW(), NOW());
        `);
        enrolledCount++;
      }
    }

    return { enrolledCount, skippedCount };
  }

  function getEnrolledContacts(businessId, campaignId, options = {}) {
    getCampaign(businessId, campaignId);
    let sql = `SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND business_id = '${businessId}'`;
    if (options.status) {
      sql += ` AND LOWER(status) = '${options.status.toLowerCase()}'`;
    }
    const rows = db.public.many(sql);
    return { data: rows || [], total: (rows || []).length };
  }

  function removeContact(businessId, campaignId, leadId) {
    getCampaign(businessId, campaignId);
    db.public.none(
      `UPDATE campaign_leads SET status = 'REMOVED', updated_at = NOW() WHERE campaign_id = '${campaignId}' AND lead_id = '${leadId}' AND business_id = '${businessId}';`
    );
    return true;
  }

  function validateCampaign(businessId, campaignId) {
    const errors = [];
    const campaign = getCampaign(businessId, campaignId);

    // Rule 1: Non-empty name
    if (!campaign.name || !campaign.name.trim()) {
      errors.push("Campaign name is required.");
    }

    // Rule 2: Timezone
    if (!campaign.timezone || !campaign.timezone.trim()) {
      errors.push("Campaign timezone is required.");
    }

    // Rule 3: Has at least 1 active step
    const steps = getSteps(businessId, campaignId);
    const activeSteps = steps.filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE");
    if (activeSteps.length === 0) {
      errors.push("Campaign must have at least 1 active step.");
    } else {
      activeSteps.sort((a, b) => a.step_number - b.step_number);

      // Rule 4: Steps ordered sequentially without gaps
      for (let i = 0; i < activeSteps.length; i++) {
        if (activeSteps[i].step_number !== i + 1) {
          errors.push(`Steps must be ordered sequentially without gaps.`);
          break;
        }
      }

      // Rule 5: Delays valid (>= 0)
      for (const step of activeSteps) {
        if (step.delay_value < 0) {
          errors.push(`Step ${step.step_number} delay cannot be negative.`);
        }
      }

      // Rule 6: Templates selected and exist in business
      for (const step of activeSteps) {
        if (!step.template_id) {
          errors.push(`Step ${step.step_number} does not have an email template selected.`);
        } else {
          const tpls = db.public.many(
            `SELECT * FROM email_templates WHERE id = '${step.template_id}' AND business_id = '${businessId}';`
          );
          if (!tpls || tpls.length === 0) {
            errors.push(`Step ${step.step_number} references non-existent or cross-tenant template.`);
          } else if (tpls[0].status?.toLowerCase() === "archived") {
            errors.push(`Step ${step.step_number} references an archived template.`);
          }
        }
      }
    }

    // Rule 7: Has at least 1 contact enrolled
    const enrolled = getEnrolledContacts(businessId, campaignId, { status: "ENROLLED" });
    if (enrolled.total === 0) {
      errors.push("Campaign must have at least 1 enrolled contact.");
    }

    return { valid: errors.length === 0, errors };
  }

  function activateCampaign(businessId, campaignId) {
    const validation = validateCampaign(businessId, campaignId);
    if (!validation.valid) {
      throw new Error(`Cannot activate campaign: ${validation.errors.join("; ")}`);
    }
    return updateCampaign(businessId, campaignId, { status: "ACTIVE" });
  }

  function pauseCampaign(businessId, campaignId) {
    const existing = getCampaign(businessId, campaignId);
    if (existing.status.toUpperCase() !== "ACTIVE") {
      throw new Error(`Cannot pause campaign in "${existing.status}" status.`);
    }
    return updateCampaign(businessId, campaignId, { status: "PAUSED" });
  }

  function resumeCampaign(businessId, campaignId) {
    const existing = getCampaign(businessId, campaignId);
    if (existing.status.toUpperCase() !== "PAUSED") {
      throw new Error(`Cannot resume campaign in "${existing.status}" status.`);
    }
    const validation = validateCampaign(businessId, campaignId);
    if (!validation.valid) {
      throw new Error(`Cannot resume campaign: ${validation.errors.join("; ")}`);
    }
    return updateCampaign(businessId, campaignId, { status: "ACTIVE" });
  }

  // ==========================================
  // Test Cases Execution
  // ==========================================

  let testCampaignA;

  await t.test("1. Create campaign", () => {
    const campaign = createCampaign(bizAId, {
      name: "Q4 Enterprise Sequence",
      description: "Targeting enterprise accounts",
      timezone: "America/New_York",
      status: "DRAFT",
    });

    assert.ok(campaign.id, "Campaign should have generated UUID");
    assert.equal(campaign.business_id, bizAId);
    assert.equal(campaign.name, "Q4 Enterprise Sequence");
    assert.equal(campaign.status, "DRAFT");
    assert.equal(campaign.timezone, "America/New_York");

    testCampaignA = campaign;
  });

  await t.test("2. List campaigns with scoping and pagination", () => {
    const listResult = listCampaigns(bizAId, { page: 1, limit: 10 });
    assert.ok(Array.isArray(listResult.data));
    assert.ok(listResult.total >= 1);
    const found = listResult.data.find((c) => c.id === testCampaignA.id);
    assert.ok(found, "Created campaign should be found in business list");
    assert.equal(found.business_id, bizAId);
  });

  await t.test("3. Update campaign details", () => {
    const updated = updateCampaign(bizAId, testCampaignA.id, {
      name: "Q4 Enterprise Sequence Updated",
      description: "Updated description",
    });

    assert.equal(updated.name, "Q4 Enterprise Sequence Updated");
    assert.equal(updated.description, "Updated description");
  });

  await t.test("4. Duplicate campaign copies campaign and steps in DRAFT status", () => {
    // Add step 1
    addStep(bizAId, testCampaignA.id, {
      name: "Initial Outreach",
      template_id: tplA1Id,
      delay_value: 0,
      delay_unit: "days",
    });

    const duplicated = duplicateCampaign(bizAId, testCampaignA.id, "Q4 Copy");
    assert.ok(duplicated.campaign.id);
    assert.notEqual(duplicated.campaign.id, testCampaignA.id);
    assert.equal(duplicated.campaign.name, "Q4 Copy");
    assert.equal(duplicated.campaign.status, "DRAFT");
    assert.equal(duplicated.campaign.business_id, bizAId);
    assert.equal(duplicated.steps.length, 1);
    assert.equal(duplicated.steps[0].template_id, tplA1Id);
  });

  await t.test("5. Archive campaign soft-deletes and sets status to ARCHIVED", () => {
    const tempCampaign = createCampaign(bizAId, {
      name: "Temporary Campaign To Archive",
      timezone: "UTC",
    });

    const archived = archiveCampaign(bizAId, tempCampaign.id);
    assert.equal(archived.status, "ARCHIVED");

    const fetched = getCampaign(bizAId, tempCampaign.id);
    assert.equal(fetched.status, "ARCHIVED");
  });

  await t.test("6. Prevent cross-tenant campaign access", () => {
    // Business B cannot view Business A's campaign
    assert.throws(
      () => getCampaign(bizBId, testCampaignA.id),
      /access denied|not found/i
    );

    // Business B cannot update Business A's campaign
    assert.throws(
      () => updateCampaign(bizBId, testCampaignA.id, { name: "Hacked" }),
      /access denied|not found/i
    );

    // Business B cannot archive Business A's campaign
    assert.throws(
      () => archiveCampaign(bizBId, testCampaignA.id),
      /access denied|not found/i
    );
  });

  await t.test("7. Add step to campaign with delay value and template", () => {
    const step2 = addStep(bizAId, testCampaignA.id, {
      name: "Follow-up Step 2",
      template_id: tplA2Id,
      delay_value: 3,
      delay_unit: "days",
      status: "ACTIVE",
    });

    assert.ok(step2.id);
    assert.equal(step2.campaign_id, testCampaignA.id);
    assert.equal(step2.step_number, 2);
    assert.equal(step2.delay_value, 3);
    assert.equal(step2.delay_unit, "days");
  });

  await t.test("8. Update step configuration", () => {
    const steps = getSteps(bizAId, testCampaignA.id);
    const step2 = steps.find((s) => s.step_number === 2);
    assert.ok(step2);

    const updated = updateStep(bizAId, testCampaignA.id, step2.id, {
      name: "Follow-up Step 2 Updated",
      delay_value: 4,
      delay_unit: "days",
    });

    assert.equal(updated.name, "Follow-up Step 2 Updated");
    assert.equal(updated.delay_value, 4);
  });

  await t.test("9. Remove step and verify automatic re-sequencing", () => {
    // Add step 3
    addStep(bizAId, testCampaignA.id, {
      name: "Final Step 3",
      template_id: tplA2Id,
      delay_value: 5,
      delay_unit: "days",
    });

    const stepsBefore = getSteps(bizAId, testCampaignA.id);
    const step2 = stepsBefore.find((s) => s.step_number === 2);
    assert.ok(step2);

    deleteStep(bizAId, testCampaignA.id, step2.id);

    const stepsAfter = getSteps(bizAId, testCampaignA.id);
    assert.equal(stepsAfter.length, 2);
    stepsAfter.sort((a, b) => a.step_number - b.step_number);
    assert.equal(stepsAfter[0].step_number, 1);
    assert.equal(stepsAfter[1].step_number, 2);
  });

  await t.test("10. Reorder steps deterministically", () => {
    const steps = getSteps(bizAId, testCampaignA.id);
    assert.equal(steps.length, 2);

    const invertedIds = [steps[1].id, steps[0].id];
    const reordered = reorderSteps(bizAId, testCampaignA.id, invertedIds);

    assert.equal(reordered[0].id, steps[1].id);
    assert.equal(reordered[0].step_number, 1);
    assert.equal(reordered[1].id, steps[0].id);
    assert.equal(reordered[1].step_number, 2);
  });

  await t.test("11. Step numbers must be unique within campaign", () => {
    const steps = getSteps(bizAId, testCampaignA.id);
    const stepNumbers = steps.map((s) => s.step_number);
    const unique = new Set(stepNumbers);
    assert.equal(unique.size, stepNumbers.length, "No duplicate step numbers allowed");
  });

  await t.test("12. Step numbers must be sequential starting at 1", () => {
    const steps = getSteps(bizAId, testCampaignA.id);
    steps.sort((a, b) => a.step_number - b.step_number);
    steps.forEach((s, idx) => {
      assert.equal(s.step_number, idx + 1);
    });
  });

  await t.test("13. Campaign step belongs to campaign", () => {
    const steps = getSteps(bizAId, testCampaignA.id);
    for (const step of steps) {
      assert.equal(step.campaign_id, testCampaignA.id);
    }
  });

  await t.test("14. Step template belongs to same business (rejection of cross-tenant template)", () => {
    assert.throws(
      () => {
        addStep(bizAId, testCampaignA.id, {
          name: "Cross Tenant Step",
          template_id: tplB1Id,
          delay_value: 1,
          delay_unit: "days",
        });
      },
      /access denied|does not exist/i
    );
  });

  await t.test("15. Enroll contacts into campaign", () => {
    const result = enrollContacts(bizAId, testCampaignA.id, [leadA1Id, leadA2Id]);
    assert.equal(result.enrolledCount, 2);

    const enrolled = getEnrolledContacts(bizAId, testCampaignA.id);
    assert.equal(enrolled.total, 2);
    assert.ok(enrolled.data.some((e) => e.lead_id === leadA1Id));
    assert.ok(enrolled.data.some((e) => e.lead_id === leadA2Id));
  });

  await t.test("16. Prevent duplicate contact enrollment", () => {
    const result = enrollContacts(bizAId, testCampaignA.id, [leadA1Id]);
    assert.equal(result.enrolledCount, 1);

    const enrolled = getEnrolledContacts(bizAId, testCampaignA.id);
    assert.equal(enrolled.total, 2, "Duplicate row must not be added");
  });

  await t.test("17. Remove contact from campaign", () => {
    const removed = removeContact(bizAId, testCampaignA.id, leadA2Id);
    assert.equal(removed, true);

    const enrolled = getEnrolledContacts(bizAId, testCampaignA.id, { status: "ENROLLED" });
    assert.equal(enrolled.total, 1);
    assert.equal(enrolled.data[0].lead_id, leadA1Id);
  });

  await t.test("18. Validate campaign with missing template fails", () => {
    const noTplCampaign = createCampaign(bizAId, {
      name: "Campaign Missing Template",
      timezone: "UTC",
    });

    addStep(bizAId, noTplCampaign.id, {
      name: "Step Without Template",
      template_id: null,
      delay_value: 0,
      delay_unit: "days",
    });

    enrollContacts(bizAId, noTplCampaign.id, [leadA1Id]);

    const valResult = validateCampaign(bizAId, noTplCampaign.id);
    assert.equal(valResult.valid, false);
    assert.ok(valResult.errors.some((e) => e.includes("does not have an email template selected")));

    assert.throws(
      () => activateCampaign(bizAId, noTplCampaign.id),
      /cannot activate/i
    );
  });

  await t.test("19. Validate campaign with no steps fails", () => {
    const emptyCampaign = createCampaign(bizAId, {
      name: "Empty Campaign",
      timezone: "UTC",
    });

    enrollContacts(bizAId, emptyCampaign.id, [leadA1Id]);

    const valResult = validateCampaign(bizAId, emptyCampaign.id);
    assert.equal(valResult.valid, false);
    assert.ok(valResult.errors.some((e) => e.includes("must have at least 1 active step")));
  });

  await t.test("20. Validate campaign with no contacts fails", () => {
    const noContactCampaign = createCampaign(bizAId, {
      name: "Campaign With No Contacts",
      timezone: "UTC",
    });

    addStep(bizAId, noContactCampaign.id, {
      name: "Step 1",
      template_id: tplA1Id,
      delay_value: 0,
      delay_unit: "days",
    });

    const valResult = validateCampaign(bizAId, noContactCampaign.id);
    assert.equal(valResult.valid, false);
    assert.ok(valResult.errors.some((e) => e.includes("must have at least 1 enrolled contact")));
  });

  await t.test("21. Validate campaign with archived template fails", () => {
    const archivedTplCampaign = createCampaign(bizAId, {
      name: "Campaign With Archived Template",
      timezone: "UTC",
    });

    addStep(bizAId, archivedTplCampaign.id, {
      name: "Step 1",
      template_id: tplArchivedId,
      delay_value: 0,
      delay_unit: "days",
    });

    enrollContacts(bizAId, archivedTplCampaign.id, [leadA1Id]);

    const valResult = validateCampaign(bizAId, archivedTplCampaign.id);
    assert.equal(valResult.valid, false);
    assert.ok(valResult.errors.some((e) => e.includes("references an archived template")));
  });

  await t.test("22. Activate valid campaign succeeds", () => {
    const validCampaign = createCampaign(bizAId, {
      name: "Ready Campaign",
      timezone: "UTC",
    });

    addStep(bizAId, validCampaign.id, {
      name: "Step 1 Initial",
      template_id: tplA1Id,
      delay_value: 0,
      delay_unit: "days",
    });

    enrollContacts(bizAId, validCampaign.id, [leadA1Id]);

    const activated = activateCampaign(bizAId, validCampaign.id);
    assert.equal(activated.status, "ACTIVE");

    const fetched = getCampaign(bizAId, validCampaign.id);
    assert.equal(fetched.status, "ACTIVE");
  });

  await t.test("23. Pause active campaign succeeds", () => {
    // Activate testCampaignA first
    // In test 10, step 1 was inverted. Let's ensure all active steps have templates:
    const steps = getSteps(bizAId, testCampaignA.id);
    for (const s of steps) {
      if (!s.template_id) {
        updateStep(bizAId, testCampaignA.id, s.id, { template_id: tplA1Id });
      }
    }
    const activated = activateCampaign(bizAId, testCampaignA.id);
    assert.equal(activated.status, "ACTIVE");

    const paused = pauseCampaign(bizAId, testCampaignA.id);
    assert.equal(paused.status, "PAUSED");

    const fetched = getCampaign(bizAId, testCampaignA.id);
    assert.equal(fetched.status, "PAUSED");
  });

  await t.test("24. Resume paused campaign succeeds", () => {
    const resumed = resumeCampaign(bizAId, testCampaignA.id);
    assert.equal(resumed.status, "ACTIVE");

    const fetched = getCampaign(bizAId, testCampaignA.id);
    assert.equal(fetched.status, "ACTIVE");
  });

  await t.test("25. MANDATORY Cross-Tenant Multi-Tenancy Security Isolation Test", () => {
    // 1. Business B cannot see Business A's campaigns
    const bizBList = listCampaigns(bizBId, {});
    assert.ok(
      !bizBList.data.some((c) => c.id === testCampaignA.id),
      "Business B list must NOT contain Business A campaigns"
    );

    // 2. Business B cannot enroll Business A's contacts
    const bizBCampaign = createCampaign(bizBId, {
      name: "Stark Sequence",
      timezone: "Europe/London",
    });

    const enrollRes = enrollContacts(bizBId, bizBCampaign.id, [leadA1Id]);
    assert.equal(enrollRes.enrolledCount, 0, "Cross-tenant contact enrollment must be rejected");
    assert.equal(enrollRes.skippedCount, 1);

    // 3. Business B cannot add a step referencing Business A's template
    assert.throws(
      () => {
        addStep(bizBId, bizBCampaign.id, {
          name: "Step with Biz A template",
          template_id: tplA1Id,
          delay_value: 0,
          delay_unit: "days",
        });
      },
      /access denied|does not exist/i
    );

    // 4. Business B cannot activate, pause, or resume Business A's campaign
    assert.throws(
      () => activateCampaign(bizBId, testCampaignA.id),
      /access denied|not found/i
    );

    assert.throws(
      () => pauseCampaign(bizBId, testCampaignA.id),
      /access denied|not found/i
    );

    assert.throws(
      () => resumeCampaign(bizBId, testCampaignA.id),
      /access denied|not found/i
    );
  });
});
