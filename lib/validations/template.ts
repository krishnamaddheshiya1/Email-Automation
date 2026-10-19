import { z } from "zod";

export const templateStatusEnum = z.enum(["active", "draft", "archived"]);

export const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name is required")
    .max(255, "Template name cannot exceed 255 characters"),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(500, "Subject cannot exceed 500 characters"),
  body: z
    .string()
    .trim()
    .min(1, "Email body is required")
    .max(100000, "Email body cannot exceed 100,000 characters"),
  status: templateStatusEnum.default("active"),
  variables: z.array(z.string()).optional(),
});

export const updateTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name cannot be empty")
    .max(255, "Template name cannot exceed 255 characters")
    .optional(),
  subject: z
    .string()
    .trim()
    .min(1, "Subject cannot be empty")
    .max(500, "Subject cannot exceed 500 characters")
    .optional(),
  body: z
    .string()
    .trim()
    .min(1, "Email body cannot be empty")
    .max(100000, "Email body cannot exceed 100,000 characters")
    .optional(),
  status: templateStatusEnum.optional(),
  variables: z.array(z.string()).optional(),
});

export const duplicateTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name cannot be empty")
    .max(255, "Template name cannot exceed 255 characters")
    .optional(),
});

export const templateListQuerySchema = z.object({
  search: z.string().optional().default(""),
  status: z.enum(["active", "draft", "archived", "all"]).optional().default("active"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(["updated_at", "created_at", "name", "status"]).default("updated_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const renderPreviewSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
  contact: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  sender: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type DuplicateTemplateInput = z.infer<typeof duplicateTemplateSchema>;
export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;
export type RenderPreviewInput = z.infer<typeof renderPreviewSchema>;
