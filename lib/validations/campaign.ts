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

export const enrollContactsSchema = z
  .object({
    contact_ids: z
      .array(z.string().uuid("Invalid contact ID"))
      .min(1, "At least one contact ID must be provided"),
    allow_override: z.boolean().optional().default(false),
    range_type: z.enum(["all", "range", "entire", "custom"]).optional().default("all"),
    rangeType: z.enum(["all", "range", "entire", "custom"]).optional(),
    start_row: z.union([z.number(), z.string()]).optional().nullable(),
    startRow: z.union([z.number(), z.string()]).optional().nullable(),
    end_row: z.union([z.number(), z.string()]).optional().nullable(),
    endRow: z.union([z.number(), z.string()]).optional().nullable(),
    total_available: z.number().int().optional().nullable(),
    search: z.string().optional(),
    filter_tab: z.string().optional(),
  })
  .refine(
    (data) => {
      const mode = data.rangeType || data.range_type;
      if (mode === "range" || mode === "custom") {
        const startRaw = data.startRow ?? data.start_row;
        const endRaw = data.endRow ?? data.end_row;
        if (
          startRaw === undefined ||
          startRaw === null ||
          (typeof startRaw === "string" && startRaw.trim() === "") ||
          endRaw === undefined ||
          endRaw === null ||
          (typeof endRaw === "string" && endRaw.trim() === "")
        ) {
          return false;
        }
        const s = Number(startRaw);
        const e = Number(endRaw);
        if (isNaN(s) || isNaN(e) || !Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) {
          return false;
        }
        if (data.total_available && data.total_available > 0 && e > data.total_available) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Invalid enrollment range: Start must be >= 1, End must be >= Start, and End cannot exceed available contacts.",
      path: ["start_row"],
    }
  );

export const campaignListQuerySchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(["created_at", "updated_at", "name", "status"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const campaignContactImportSchema = z
  .object({
    csv: z.string().optional(),
    filename: z.string().optional().default("contacts.csv"),
    column_mapping: z.record(z.string(), z.string()).optional(),
    columnMapping: z.record(z.string(), z.string()).optional(),
    range_type: z.enum(["all", "range", "entire", "custom"]).optional().default("all"),
    rangeType: z.enum(["all", "range", "entire", "custom"]).optional(),
    start_row: z.union([z.number(), z.string()]).optional().nullable(),
    startRow: z.union([z.number(), z.string()]).optional().nullable(),
    end_row: z.union([z.number(), z.string()]).optional().nullable(),
    endRow: z.union([z.number(), z.string()]).optional().nullable(),
    allow_override: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      const mode = data.rangeType || data.range_type;
      if (mode === "range" || mode === "custom") {
        const start = data.startRow ?? data.start_row;
        const end = data.endRow ?? data.end_row;
        if (start !== undefined && start !== null && end !== undefined && end !== null) {
          const s = Number(start);
          const e = Number(end);
          if (!isNaN(s) && !isNaN(e) && s > e) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message: "Start row cannot be greater than end row",
      path: ["startRow"],
    }
  )
  .refine(
    (data) => {
      const mode = data.rangeType || data.range_type;
      if (mode === "range" || mode === "custom") {
        const start = data.startRow ?? data.start_row;
        if (start !== undefined && start !== null) {
          const s = Number(start);
          if (!isNaN(s) && s < 1) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message: "Start row must be at least 1",
      path: ["startRow"],
    }
  );

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CreateCampaignStepInput = z.infer<typeof createCampaignStepSchema>;
export type UpdateCampaignStepInput = z.infer<typeof updateCampaignStepSchema>;
export type EnrollContactsInput = z.infer<typeof enrollContactsSchema>;
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
export type CampaignContactImportInput = z.infer<typeof campaignContactImportSchema>;

