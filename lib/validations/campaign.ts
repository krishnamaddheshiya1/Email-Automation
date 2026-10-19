import { z } from "zod";

export const campaignStatusEnum = z.enum([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "COMPLETED",
  "draft",
  "active",
  "paused",
  "archived",
  "completed",
]);

export const campaignStepStatusEnum = z.enum([
  "ACTIVE",
  "DISABLED",
  "PAUSED",
  "active",
  "disabled",
  "paused",
]);

export const delayUnitEnum = z.enum(["minutes", "hours", "days"]);

export const campaignLeadStatusEnum = z.enum([
  "ENROLLED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "STOPPED",
  "FAILED",
  "REMOVED",
  "enrolled",
  "running",
  "paused",
  "completed",
  "stopped",
  "failed",
  "removed",
]);

export const campaignEnrollmentStatusEnum = campaignLeadStatusEnum;

export const createCampaignSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Campaign name is required")
    .max(255, "Campaign name cannot exceed 255 characters"),
  description: z.string().trim().max(1000).nullable().optional(),
  timezone: z.string().trim().min(1, "Timezone is required").default("UTC"),
  status: campaignStatusEnum.default("DRAFT"),
  settings: z.record(z.string(), z.unknown()).default({}),
  sender_identity_id: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().uuid("Invalid sender identity ID").nullable().optional()
  ),
});

export const updateCampaignSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Campaign name cannot be empty")
    .max(255, "Campaign name cannot exceed 255 characters")
    .optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  timezone: z.string().trim().min(1, "Timezone cannot be empty").optional(),
  status: campaignStatusEnum.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sender_identity_id: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().uuid("Invalid sender identity ID").nullable().optional()
  ),
});

export const createCampaignStepSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Step name is required")
    .max(255, "Step name cannot exceed 255 characters"),
  step_number: z.number().int().min(1, "Step number must be >= 1").optional(),
  template_id: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().uuid("Invalid template ID").nullable().optional()
  ),
  delay_value: z.number().int().min(0, "Delay value cannot be negative").default(0),
  delay_unit: delayUnitEnum.default("days"),
  status: campaignStepStatusEnum.default("ACTIVE"),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const updateCampaignStepSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Step name cannot be empty")
    .max(255, "Step name cannot exceed 255 characters")
    .optional(),
  step_number: z.number().int().min(1, "Step number must be >= 1").optional(),
  template_id: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().uuid("Invalid template ID").nullable().optional()
  ),
  delay_value: z.number().int().min(0, "Delay value cannot be negative").optional(),
  delay_unit: delayUnitEnum.optional(),
  status: campaignStepStatusEnum.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const enrollContactsSchema = z.object({
  contact_ids: z
    .array(z.string().uuid("Invalid contact ID"))
    .min(1, "At least one contact ID must be provided"),
  allow_override: z.boolean().optional().default(false),
});

export const campaignListQuerySchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(["created_at", "updated_at", "name", "status"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CreateCampaignStepInput = z.infer<typeof createCampaignStepSchema>;
export type UpdateCampaignStepInput = z.infer<typeof updateCampaignStepSchema>;
export type EnrollContactsInput = z.infer<typeof enrollContactsSchema>;
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
