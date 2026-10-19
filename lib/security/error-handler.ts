// Universal Web API Response compatible with Node.js and Next.js

const SECRET_PATTERNS = [
  /re_[a-zA-Z0-9_\-]{20,}/gi,
  /whsec_[a-zA-Z0-9_\-]{20,}/gi,
  /sb_secret_[a-zA-Z0-9_\-]{20,}/gi,
  /sb_publishable_[a-zA-Z0-9_\-]{20,}/gi,
  /postgresql:\/\/[^:]+:[^@]+@[^\s"']+/gi,
  /bearer\s+[a-zA-Z0-9._\-]{20,}/gi,
];

const DB_INTERNAL_PATTERNS = [
  /syntax error at or near/i,
  /relation "[^"]+" does not exist/i,
  /column "[^"]+" does not exist/i,
  /duplicate key value violates unique constraint/i,
  /null value in column/i,
  /violates check constraint/i,
  /violates foreign key constraint/i,
  /pg_mem/i,
  /pg_/i,
];

/**
 * Redacts any detected API keys, credentials, connection strings, or tokens from text.
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") return "";
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

/**
 * Returns a masked representation of an API key or secret token.
 * E.g., "re_1234567890abcdef" -> "re_••••••••••••cdef"
 */
export function maskSecret(secret?: string | null): string {
  if (!secret) return "••••••••";
  const str = String(secret).trim();
  if (str.length <= 8) return "••••••••";
  const prefix = str.slice(0, 3);
  const suffix = str.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}

/**
 * Determines whether an error message leaks database internals.
 */
export function containsDbInternals(message: string): boolean {
  return DB_INTERNAL_PATTERNS.some((p) => p.test(message));
}

/**
 * Sanitizes an error message for safe customer-facing display.
 * In production, strips stack traces, database internals, and secrets.
 */
export function sanitizeErrorMessage(err: unknown, defaultMessage = "An unexpected error occurred."): string {
  if (!err) return defaultMessage;

  const rawMessage = err instanceof Error ? err.message : String(err);
  const cleaned = redactSecrets(rawMessage);

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (containsDbInternals(cleaned)) {
      return "A database operation failed. Please check your parameters and try again.";
    }
    // Never expose stack trace patterns or code paths
    if (cleaned.includes(" at ") || cleaned.includes("node:") || cleaned.includes(".ts:") || cleaned.includes(".js:")) {
      return defaultMessage;
    }
  }

  return cleaned || defaultMessage;
}

/**
 * Creates a standardized safe API error response.
 */
export function createSafeErrorResponse(
  err: unknown,
  status = 500,
  defaultMessage = "An unexpected error occurred."
): Response {
  const safeMessage = sanitizeErrorMessage(err, defaultMessage);
  return Response.json(
    {
      success: false,
      error: safeMessage,
    },
    { status }
  );
}
