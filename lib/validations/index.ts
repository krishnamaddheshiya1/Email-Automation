/**
 * Input validation helpers and type-guard utilities.
 * Designed to provide a standardized validation interface for API routes and form submissions.
 */

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Record<string, string>;
}

export function validateRequiredFields<T extends Record<string, unknown>>(
  input: Record<string, unknown>,
  requiredFields: (keyof T)[]
): ValidationResult<T> {
  const errors: Record<string, string> = {};

  for (const field of requiredFields) {
    const key = String(field);
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      errors[key] = `${key} is required`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: input as unknown as T };
}

export * from "./schemas";
export * from "./auth";
export * from "./contact";
export * from "./template";
export {
  campaignStatusEnum,
  campaignStepStatusEnum,
  delayUnitEnum,
  campaignLeadStatusEnum,
  updateCampaignSchema,
  updateCampaignStepSchema,
  enrollContactsSchema,
  campaignListQuerySchema,
  type CreateCampaignInput,
  type UpdateCampaignInput,
  type CreateCampaignStepInput,
  type UpdateCampaignStepInput,
  type EnrollContactsInput,
  type CampaignListQuery,
} from "./campaign";
