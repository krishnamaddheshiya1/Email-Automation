/**
 * Safe Structured Production Logger
 * Enforces redaction of sensitive credentials, keys, passwords, and tokens.
 */

const SECRET_PATTERNS = [
  /re_[a-zA-Z0-9_\-]{20,}/gi,
  /whsec_[a-zA-Z0-9_\-]{20,}/gi,
  /sb_secret_[a-zA-Z0-9_\-]{20,}/gi,
  /sb_publishable_[a-zA-Z0-9_\-]{20,}/gi,
  /postgresql:\/\/[^:]+:[^@]+@[^\s"']+/gi,
  /bearer\s+[a-zA-Z0-9._\-]{20,}/gi,
];

function redactSecretsInternal(text: string): string {
  if (!text || typeof text !== "string") return "";
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogContext {
  requestId?: string;
  eventId?: string;
  campaignId?: string;
  contactId?: string;
  leadId?: string;
  messageId?: string;
  webhookEventId?: string;
  errorCategory?: string;
  businessId?: string;
  userId?: string;
  action?: string;
  durationMs?: number;
  [key: string]: unknown;
}

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "password",
  "secret",
  "apiKey",
  "api_key",
  "resendApiKey",
  "resend_api_key",
  "webhookSecret",
  "webhook_secret",
  "token",
  "accessToken",
  "serviceRoleKey",
  "encryptedApiKey",
  "encrypted_api_key",
]);

function sanitizeContext(ctx?: StructuredLogContext): Record<string, unknown> {
  if (!ctx || typeof ctx !== "object") return {};
  const clean: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(ctx)) {
    if (FORBIDDEN_CONTEXT_KEYS.has(key) || FORBIDDEN_CONTEXT_KEYS.has(key.toLowerCase())) {
      clean[key] = "[REDACTED]";
      continue;
    }

    if (typeof val === "string") {
      clean[key] = redactSecretsInternal(val);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      clean[key] = sanitizeContext(val as StructuredLogContext);
    } else {
      clean[key] = val;
    }
  }

  return clean;
}

export class Logger {
  private format(level: LogLevel, message: string, context?: StructuredLogContext): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message: redactSecretsInternal(message),
      ...sanitizeContext(context),
    };
    return JSON.stringify(entry);
  }

  debug(message: string, context?: StructuredLogContext): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(this.format("debug", message, context));
    }
  }

  info(message: string, context?: StructuredLogContext): void {
    console.info(this.format("info", message, context));
  }

  warn(message: string, context?: StructuredLogContext): void {
    console.warn(this.format("warn", message, context));
  }

  error(message: string, err?: unknown, context?: StructuredLogContext): void {
    const errorDetails = err instanceof Error
      ? { errorMessage: redactSecretsInternal(err.message), errorName: err.name }
      : { errorMessage: redactSecretsInternal(String(err)) };

    console.error(
      this.format("error", message, {
        ...context,
        ...errorDetails,
      })
    );
  }
}

export const logger = new Logger();
