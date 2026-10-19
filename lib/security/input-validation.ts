/**
 * Production Security Input Validation Utilities
 * Hardens API routes against malformed parameters, IDOR injection, and parameter tampering.
 */

// RFC-4122 compliant UUID regex (v1-v5)
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Permissive 8-4-4-4-12 hex UUID regex (handles any standard hex UUID format)
export const GENERAL_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Standard RFC-5322 simplified email regex
export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates whether a value is a well-formed UUID string.
 */
export function isValidUuid(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  return GENERAL_UUID_REGEX.test(trimmed);
}

/**
 * Validates a UUID with structured error feedback.
 */
export function validateUuid(id: unknown, fieldName = "ID"): { valid: boolean; error?: string } {
  if (!id || typeof id !== "string" || !id.trim()) {
    return { valid: false, error: `${fieldName} is required.` };
  }
  if (!GENERAL_UUID_REGEX.test(id.trim())) {
    return { valid: false, error: `Invalid ${fieldName} format. Must be a valid UUID.` };
  }
  return { valid: true };
}

export interface PaginationValidationResult {
  valid: boolean;
  page: number;
  limit: number;
  offset: number;
  error?: string;
}

/**
 * Validates pagination query parameters.
 * Rejects non-numbers, negative values, and limits exceeding maximum.
 */
export function validatePagination(
  pageInput: unknown,
  limitInput: unknown,
  maxLimit = 100,
  defaultLimit = 50
): PaginationValidationResult {
  let page = 1;
  let limit = defaultLimit;

  if (pageInput !== undefined && pageInput !== null && pageInput !== "") {
    const parsedPage = Number(pageInput);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return {
        valid: false,
        page: 1,
        limit: defaultLimit,
        offset: 0,
        error: "Page parameter must be a positive integer greater than or equal to 1.",
      };
    }
    page = parsedPage;
  }

  if (limitInput !== undefined && limitInput !== null && limitInput !== "") {
    const parsedLimit = Number(limitInput);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      return {
        valid: false,
        page,
        limit: defaultLimit,
        offset: 0,
        error: "Limit parameter must be a positive integer greater than or equal to 1.",
      };
    }
    if (parsedLimit > maxLimit) {
      return {
        valid: false,
        page,
        limit: defaultLimit,
        offset: 0,
        error: `Limit parameter exceeds maximum allowed limit of ${maxLimit}.`,
      };
    }
    limit = parsedLimit;
  }

  const offset = (page - 1) * limit;

  return {
    valid: true,
    page,
    limit,
    offset,
  };
}

/**
 * Validates and normalizes an email address.
 */
export function validateEmailAddress(email: unknown): { valid: boolean; normalized?: string; error?: string } {
  if (!email || typeof email !== "string" || !email.trim()) {
    return { valid: false, error: "Email address is required." };
  }

  const trimmed = email.trim();
  if (trimmed.length > 254) {
    return { valid: false, error: "Email address exceeds maximum length of 254 characters." };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: "Invalid email address format." };
  }

  return { valid: true, normalized: trimmed.toLowerCase() };
}

/**
 * Validates date range parameters for analytics and reporting queries.
 */
export function validateDateRange(
  from?: unknown,
  to?: unknown
): { valid: boolean; fromDate?: string; toDate?: string; error?: string } {
  let fromDate: string | undefined;
  let toDate: string | undefined;

  if (from !== undefined && from !== null && from !== "") {
    if (typeof from !== "string") {
      return { valid: false, error: "Invalid 'from' date parameter format." };
    }
    const d = new Date(from);
    if (isNaN(d.getTime())) {
      return { valid: false, error: "Invalid 'from' date parameter. Must be a valid date or timestamp." };
    }
    fromDate = d.toISOString();
  }

  if (to !== undefined && to !== null && to !== "") {
    if (typeof to !== "string") {
      return { valid: false, error: "Invalid 'to' date parameter format." };
    }
    const d = new Date(to);
    if (isNaN(d.getTime())) {
      return { valid: false, error: "Invalid 'to' date parameter. Must be a valid date or timestamp." };
    }
    toDate = d.toISOString();
  }

  if (fromDate && toDate && new Date(fromDate).getTime() > new Date(toDate).getTime()) {
    return { valid: false, error: "The 'from' date cannot be after the 'to' date." };
  }

  return { valid: true, fromDate, toDate };
}

/**
 * Sanitizes search queries to prevent malicious formatting or excessive length.
 */
export function sanitizeSearchQuery(query?: unknown, maxLength = 100): string | undefined {
  if (typeof query !== "string") return undefined;
  const trimmed = query.trim().replace(/[\x00-\x1F\x7F]/g, ""); // Strip control characters
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}
