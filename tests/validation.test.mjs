import test from "node:test";
import assert from "node:assert/strict";
import {
  businessSchema,
  createBusinessSchema,
  createLeadSchema,
  createCampaignSchema,
  createCampaignStepSchema,
  createEmailTemplateSchema,
  createEmailMessageSchema,
  createSuppressionSchema,
} from "../lib/validations/schemas.ts";

test("Validation Schemas Suite", async (t) => {
  await t.test("Validates business creation and full schema", () => {
    const validCreate = createBusinessSchema.safeParse({
      name: "Acme Logistics",
      industry: "Freight",
      timezone: "America/Chicago",
      status: "active",
      settings: { max_daily_emails: 1000 },
    });
    assert.ok(validCreate.success);

    const validFull = businessSchema.safeParse({
      id: "b0000000-0000-4000-8000-000000000001",
      name: "Acme Logistics",
      industry: "Freight",
      website: "https://acme-logistics.test",
      timezone: "America/Chicago",
      status: "active",
      settings: { max_daily_emails: 1000 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    assert.ok(validFull.success);

    const invalid = createBusinessSchema.safeParse({
      name: "", // Required min 1
      status: "unknown_status", // Invalid enum
    });
    assert.equal(invalid.success, false);
  });

  await t.test("Validates lead creation schema", () => {
    const valid = createLeadSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      email: "prospect@target-domain.test",
      first_name: "John",
      last_name: "Doe",
      status: "new",
      lead_score: 50,
    });
    assert.ok(valid.success);

    const invalidEmail = createLeadSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      email: "invalid-email-format",
    });
    assert.equal(invalidEmail.success, false);
  });

  await t.test("Validates campaign & step schemas", () => {
    const validCampaign = createCampaignSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      name: "Outreach 2026",
      status: "draft",
    });
    assert.ok(validCampaign.success);

    const validStep = createCampaignStepSchema.safeParse({
      campaign_id: "c0000000-0000-4000-8000-000000000001",
      step_number: 1,
      name: "Welcome Email",
      delay_value: 24,
      delay_unit: "hours",
    });
    assert.ok(validStep.success);

    const invalidDelay = createCampaignStepSchema.safeParse({
      campaign_id: "c0000000-0000-4000-8000-000000000001",
      step_number: 0, // Min 1
      name: "Bad Step",
      delay_value: -5, // Min 0
      delay_unit: "centuries", // Invalid enum
    });
    assert.equal(invalidDelay.success, false);
  });

  await t.test("Validates email message, template & suppression schemas", () => {
    const validMessage = createEmailMessageSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      lead_id: "d0000000-0000-4000-8000-000000000001",
      direction: "outbound",
      from_email: "sender@domain.test",
      to_email: "lead@target.test",
      subject: "Hello from automation",
      body: "Email message body",
      status: "queued",
    });
    assert.ok(validMessage.success);

    const validTemplate = createEmailTemplateSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      name: "Cold Intro",
      subject: "Quick introduction",
      body: "Hello {{first_name}}",
      variables: ["first_name"],
      status: "active",
    });
    assert.ok(validTemplate.success);

    const validSuppression = createSuppressionSchema.safeParse({
      business_id: "b0000000-0000-4000-8000-000000000001",
      email: "unsubscribe@domain.test",
      reason: "unsubscribe",
    });
    assert.ok(validSuppression.success);
  });
});
