import { z } from "zod";

export const registerSchema = z.object({
  full_name: z
    .string()
    .min(1, "Full name is required")
    .max(255, "Full name is too long"),
  business_name: z
    .string()
    .min(1, "Business name is required")
    .max(255, "Business name is too long"),
  email: z
    .string()
    .email("Please provide a valid email address")
    .max(255, "Email is too long"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Please provide a valid email address"),
  password: z
    .string()
    .min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
