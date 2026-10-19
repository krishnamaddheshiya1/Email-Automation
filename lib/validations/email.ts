import { z } from "zod";

export const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email address is required")
  .max(255, "Email address cannot exceed 255 characters")
  .regex(emailRegex, "Invalid email address format");

export const testSendEmailSchema = z.object({
  to: emailAddressSchema,
  template_id: z
    .preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid("Invalid template ID").nullable().optional()),
  sender_identity_id: z
    .preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid("Invalid sender identity ID").nullable().optional()),
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
    .max(50000, "Email body exceeds maximum allowed size")
    .optional(),
  from_name: z.string().trim().max(100).optional(),
  from_email: emailAddressSchema.optional(),
  reply_to: emailAddressSchema.optional(),
  attachment_ids: z.array(z.string().uuid("Invalid attachment ID")).optional(),
});

export type TestSendEmailInput = z.infer<typeof testSendEmailSchema>;

export const senderSettingsSchema = z.object({
  from_name: z.string().trim().max(100).optional(),
  from_email: emailAddressSchema.optional(),
  reply_to: emailAddressSchema.optional(),
  daily_send_limit: z.coerce.number().int().positive().max(100000).optional(),
  hourly_send_limit: z.coerce.number().int().positive().max(50000).optional(),
  send_rate_per_minute: z.coerce.number().int().positive().max(1000).optional(),
});

export type SenderSettingsInput = z.infer<typeof senderSettingsSchema>;

export const connectProviderSchema = z.object({
  provider: z.literal("RESEND").default("RESEND"),
  apiKey: z
    .string()
    .trim()
    .min(5, "API key is required")
    .regex(/^re_[A-Za-z0-9_]+$/, "Invalid Resend API key format (must start with 're_')"),
});

export type ConnectProviderInput = z.infer<typeof connectProviderSchema>;

export const createSenderIdentitySchema = z.object({
  from_name: z.string().trim().min(1, "Sender name is required").max(100),
  from_email: emailAddressSchema,
  reply_to: z
    .preprocess((v) => (v === "" || v === undefined ? null : v), emailAddressSchema.nullable().optional()),
});

export type CreateSenderIdentityInput = z.infer<typeof createSenderIdentitySchema>;

export const updateSenderIdentitySchema = z.object({
  from_name: z.string().trim().min(1).max(100).optional(),
  reply_to: z
    .preprocess((v) => (v === "" || v === undefined ? null : v), emailAddressSchema.nullable().optional()),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type UpdateSenderIdentityInput = z.infer<typeof updateSenderIdentitySchema>;

