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
export const importRangeTypeEnum = z.enum(["all", "range"]);
export type ImportRangeType = z.infer<typeof importRangeTypeEnum>;

export interface RowRangeValidationResult {
  isValid: boolean;
  error?: string;
  startRow?: number;
  endRow?: number;
  totalSelected?: number;
}

/**
 * Validates 1-indexed contact data row range selection.
 * Start and End refer to data rows, excluding spreadsheet headers.
 */
export function validateRowRange(
  availableRows: number,
  options?: {
    rangeType?: ImportRangeType | string | null;
    startRow?: number | string | null;
    endRow?: number | string | null;
  }
): RowRangeValidationResult {
  const rangeType =
    options?.rangeType === "range" || options?.rangeType === "custom"
      ? "range"
      : "all";

  if (rangeType === "all") {
    return {
      isValid: true,
      startRow: availableRows > 0 ? 1 : 0,
      endRow: availableRows,
      totalSelected: availableRows,
    };
  }

  const startRaw = options?.startRow;
  const endRaw = options?.endRow;

  if (
    startRaw === undefined ||
    startRaw === null ||
    (typeof startRaw === "string" && startRaw.trim() === "") ||
    endRaw === undefined ||
    endRaw === null ||
    (typeof endRaw === "string" && endRaw.trim() === "")
  ) {
    return {
      isValid: false,
      error: "Start row and End row are required when selecting a row range.",
    };
  }

  const startStr = String(startRaw).trim();
  const endStr = String(endRaw).trim();

  if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
    return {
      isValid: false,
      error: "Start row and End row must be valid positive integers.",
    };
  }

  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  if (isNaN(start) || isNaN(end)) {
    return {
      isValid: false,
      error: "Start row and End row must be valid numbers.",
    };
  }

  if (start < 1) {
    return {
      isValid: false,
      error: "Start row must be greater than or equal to 1.",
    };
  }

  if (availableRows > 0 && start > availableRows) {
    return {
      isValid: false,
      error: `Start row (${start}) exceeds available data rows (${availableRows}).`,
    };
  }

  if (end < start) {
    return {
      isValid: false,
      error: `End row (${end}) must be greater than or equal to Start row (${start}).`,
    };
  }

  if (end > availableRows) {
    return {
      isValid: false,
      error: `End row (${end}) cannot exceed available data rows (${availableRows}).`,
    };
  }

  return {
    isValid: true,
    startRow: start,
    endRow: end,
    totalSelected: end - start + 1,
  };
}

export const csvPreviewSchema = z.object({
  csv: z.string().min(1, "CSV data cannot be empty"),
  filename: z.string().optional().default("contacts.csv"),
  range_type: importRangeTypeEnum.optional().default("all"),
  rangeType: importRangeTypeEnum.optional(),
  start_row: z.union([z.number(), z.string()]).optional().nullable(),
  startRow: z.union([z.number(), z.string()]).optional().nullable(),
  end_row: z.union([z.number(), z.string()]).optional().nullable(),
  endRow: z.union([z.number(), z.string()]).optional().nullable(),
});

export const csvImportSchema = z.object({
  csv: z.string().min(1, "CSV data cannot be empty"),
  filename: z.string().optional().default("contacts.csv"),
  column_mapping: z.record(z.string(), z.string()).optional(),
  columnMapping: z.record(z.string(), z.string()).optional(),
  mode: contactImportModeEnum.default("CREATE_ONLY"),
  range_type: importRangeTypeEnum.optional().default("all"),
  rangeType: importRangeTypeEnum.optional(),
  start_row: z.union([z.number(), z.string()]).optional().nullable(),
  startRow: z.union([z.number(), z.string()]).optional().nullable(),
  end_row: z.union([z.number(), z.string()]).optional().nullable(),
  endRow: z.union([z.number(), z.string()]).optional().nullable(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactQueryParams = z.infer<typeof contactQuerySchema>;
export type BulkStatusUpdateInput = z.infer<typeof bulkStatusUpdateSchema>;
export type BulkArchiveInput = z.infer<typeof bulkArchiveSchema>;
export type BulkEnrollInput = z.infer<typeof bulkEnrollSchema>;
export type CsvPreviewInput = z.infer<typeof csvPreviewSchema>;
export type CsvImportInput = z.infer<typeof csvImportSchema>;


