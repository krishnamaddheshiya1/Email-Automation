import { z } from "zod";

// ==========================================
// 1. Business Schema
// ==========================================
export const businessStatusSchema = z.enum(["active", "suspended", "archived"]);

export const businessSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Business name is required").max(255),
  industry: z.string().max(100).nullable().optional(),
  website: z.string().url().max(255).nullable().optional(),
  timezone: z.string().default("UTC"),
  status: businessStatusSchema.default("active"),
  settings: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createBusinessSchema = businessSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 2. User Schema
// ==========================================
export const userRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const userStatusSchema = z.enum(["active", "inactive", "invited"]);

export const userSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  email: z.string().email().max(255),
  full_name: z.string().min(1).max(255),
  role: userRoleSchema.default("member"),
  status: userStatusSchema.default("active"),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createUserSchema = userSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 3. Lead Schema
// ==========================================
export const leadStatusSchema = z.enum([
  "new",
  "contacted",
  "replied",
  "interested",
  "not_interested",
  "qualified",
  "unqualified",
  "converted",
  "bounced",
  "unsubscribed",
  "archived",
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "NOT_INTERESTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "ARCHIVED",
]);

export const leadSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  email: z.string().email().max(255),
  phone: z.string().max(50).nullable().optional(),
  company_name: z.string().max(255).nullable().optional(),
  job_title: z.string().max(100).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  website: z.string().url().max(255).nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  status: leadStatusSchema.default("new"),
  lead_score: z.number().int().default(0),
  owner_user_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createLeadSchema = leadSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 4. Campaign Schema
// ==========================================
export const campaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "active",
  "paused",
  "completed",
  "archived",
]);

export const campaignSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  status: campaignStatusSchema.default("draft"),
  timezone: z.string().default("UTC"),
  settings: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createCampaignSchema = campaignSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 5. Campaign Step Schema
// ==========================================
export const delayUnitSchema = z.enum(["minutes", "hours", "days"]);
export const campaignStepStatusSchema = z.enum(["active", "paused", "archived"]);

export const campaignStepSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  step_number: z.number().int().min(1),
  name: z.string().min(1).max(255),
  delay_value: z.number().int().min(0).default(0),
  delay_unit: delayUnitSchema.default("hours"),
  status: campaignStepStatusSchema.default("active"),
  template_id: z.string().uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createCampaignStepSchema = campaignStepSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 6. Email Template Schema
// ==========================================
export const templateStatusSchema = z.enum(["active", "draft", "archived"]);

export const emailTemplateSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  subject: z.string().min(1),
  body: z.string().min(1),
  variables: z.array(z.string()).default([]),
  status: templateStatusSchema.default("active"),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createEmailTemplateSchema = emailTemplateSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 7. Email Message Schema
// ==========================================
export const messageDirectionSchema = z.enum(["outbound", "inbound"]);
export const messageStatusSchema = z.enum([
  "draft",
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "cancelled",
]);

export const emailMessageSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  campaign_id: z.string().uuid().nullable().optional(),
  campaign_step_id: z.string().uuid().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  direction: messageDirectionSchema.default("outbound"),
  provider_message_id: z.string().max(255).nullable().optional(),
  from_email: z.string().email().max(255),
  to_email: z.string().email().max(255),
  subject: z.string().min(1),
  body: z.string().min(1),
  status: messageStatusSchema.default("queued"),
  scheduled_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createEmailMessageSchema = emailMessageSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ==========================================
// 8. Email Event Schema
// ==========================================
export const emailEventTypeSchema = z.enum([
  "sent",
  "delivered",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "replied",
]);

export const emailEventSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  email_message_id: z.string().uuid(),
  event_type: emailEventTypeSchema,
  provider_event_id: z.string().max(255).nullable().optional(),
  event_timestamp: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
});

// ==========================================
// 9. Suppression Schema
// ==========================================
export const suppressionReasonSchema = z.enum([
  "unsubscribe",
  "bounce",
  "spam_complaint",
  "manual",
]);

export const suppressionSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  email: z.string().email().max(255),
  reason: suppressionReasonSchema.default("unsubscribe"),
  source: z.string().max(100).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createSuppressionSchema = suppressionSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
