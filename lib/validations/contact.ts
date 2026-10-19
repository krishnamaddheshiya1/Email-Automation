import { z } from "zod";

export const contactStatusEnum = z.enum([
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "NOT_INTERESTED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "ARCHIVED",
  "new",
  "contacted",
  "replied",
  "interested",
  "not_interested",
  "bounced",
  "unsubscribed",
  "archived",
  "qualified",
  "unqualified",
  "converted",
]);

export const VALID_LEAD_STATUS_SET = new Set([
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
]);

export function normalizeLeadStatus(raw?: string | null): import("@/types/database").LeadStatus {
  if (!raw || typeof raw !== "string") return "NEW";
  const clean = raw.trim().toLowerCase();
  if (VALID_LEAD_STATUS_SET.has(clean)) {
    return clean.toUpperCase() as import("@/types/database").LeadStatus;
  }
  // Standard mappings for common CSV status values
  if (
    clean === "active" ||
    clean === "open" ||
    clean === "pending" ||
    clean === "lead" ||
    clean === "test" ||
    clean === "prospect" ||
    clean === "subscribed"
  ) {
    return "NEW";
  }
  if (clean === "closed" || clean === "inactive") {
    return "ARCHIVED";
  }
  return "NEW";
}

export const createContactSchema = z.object({
  first_name: z
    .string()
    .max(100, "First name cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  last_name: z
    .string()
    .max(100, "Last name cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please provide a valid email address")
    .max(255, "Email cannot exceed 255 characters")
    .transform((val) => val.trim().toLowerCase()),
  phone: z
    .string()
    .max(50, "Phone cannot exceed 50 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  company_name: z
    .string()
    .max(255, "Company name cannot exceed 255 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  job_title: z
    .string()
    .max(100, "Job title cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  industry: z
    .string()
    .max(100, "Industry cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  website: z
    .string()
    .max(255, "Website cannot exceed 255 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  source: z
    .string()
    .max(100, "Source cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : "manual")),
  status: contactStatusEnum.default("NEW").transform((val) => val.toUpperCase()),
  lead_score: z
    .coerce
    .number()
    .int("Lead score must be an integer")
    .min(0, "Lead score must be between 0 and 100")
    .max(100, "Lead score must be between 0 and 100")
    .default(0),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateContactSchema = z.object({
  first_name: z
    .string()
    .max(100, "First name cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  last_name: z
    .string()
    .max(100, "Last name cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  email: z
    .string()
    .trim()
    .min(1, "Email cannot be empty")
    .email("Please provide a valid email address")
    .max(255, "Email cannot exceed 255 characters")
    .transform((val) => val.trim().toLowerCase())
    .optional(),
  phone: z
    .string()
    .max(50, "Phone cannot exceed 50 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  company_name: z
    .string()
    .max(255, "Company name cannot exceed 255 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  job_title: z
    .string()
    .max(100, "Job title cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  industry: z
    .string()
    .max(100, "Industry cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  website: z
    .string()
    .max(255, "Website cannot exceed 255 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  source: z
    .string()
    .max(100, "Source cannot exceed 100 characters")
    .optional()
    .nullable()
    .transform((val) => (val ? val.trim() : null)),
  status: contactStatusEnum.optional().transform((val) => (val ? val.toUpperCase() : undefined)),
  lead_score: z
    .coerce
    .number()
    .int("Lead score must be an integer")
    .min(0, "Lead score must be between 0 and 100")
    .max(100, "Lead score must be between 0 and 100")
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const contactQuerySchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
  source: z.string().optional().default(""),
  sortBy: z.enum(["created_at", "name", "lead_score"]).optional().default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const bulkStatusUpdateSchema = z.object({
  ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
  status: contactStatusEnum.transform((val) => val.toUpperCase()),
});

export const bulkArchiveSchema = z.object({
  ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
});

export const bulkEnrollSchema = z.object({
  campaign_id: z.string().uuid("Invalid campaign ID format"),
  contact_ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
});

export const contactImportModeEnum = z.enum(["CREATE_ONLY", "CREATE_OR_UPDATE"]);

export const csvPreviewSchema = z.object({
  csv: z.string().min(1, "CSV data cannot be empty"),
  filename: z.string().optional().default("contacts.csv"),
});

export const csvImportSchema = z.object({
  csv: z.string().min(1, "CSV data cannot be empty"),
  filename: z.string().optional().default("contacts.csv"),
  column_mapping: z.record(z.string(), z.string()).optional(),
  mode: contactImportModeEnum.default("CREATE_ONLY"),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactQueryParams = z.infer<typeof contactQuerySchema>;
export type BulkStatusUpdateInput = z.infer<typeof bulkStatusUpdateSchema>;
export type BulkArchiveInput = z.infer<typeof bulkArchiveSchema>;
export type BulkEnrollInput = z.infer<typeof bulkEnrollSchema>;
export type CsvPreviewInput = z.infer<typeof csvPreviewSchema>;
export type CsvImportInput = z.infer<typeof csvImportSchema>;

