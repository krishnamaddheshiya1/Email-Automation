/**
 * Email Template Variable System & Personalization Engine
 *
 * Supported Variables:
 * - Contact: {{first_name}}, {{last_name}}, {{email}}, {{company_name}}, {{job_title}}, {{industry}}, {{website}}
 * - Sender/Business: {{sender_name}}, {{business_name}}
 *
 * Security: Strict variable whitelist. Never evaluates arbitrary expressions or scripts.
 */

// Tags allowed in rich email templates
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "code",
  "pre",
]);

// Attributes allowed on specific tags
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel", "class"]),
  img: new Set(["src", "alt", "title", "width", "height", "class", "style"]),
  span: new Set(["class", "style"]),
  div: new Set(["class", "style"]),
  p: new Set(["class", "style"]),
  table: new Set(["class", "style", "border", "cellpadding", "cellspacing", "width"]),
  th: new Set(["class", "style", "align", "valign", "colspan", "rowspan", "width"]),
  td: new Set(["class", "style", "align", "valign", "colspan", "rowspan", "width"]),
};

// Safe protocols for URLs
const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|\/|#)/i;

/**
 * Escapes characters that have HTML entity significance.
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes an HTML string by removing dangerous tags, attributes, and URI schemes.
 */
export function sanitizeHtml(input: string): string {
  if (!input || typeof input !== "string") return "";

  // 1. Remove dangerous blocks and their contents completely
  let clean = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

  // 2. Remove all inline event handlers (on*="...")
  clean = clean.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 3. Process tags
  clean = clean.replace(/<\/?([a-zA-Z0-9]+)(\s+[^>]*)?>/gi, (match, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();

    // If tag is not allowed, strip the tag entirely
    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }

    // Closing tag
    if (match.startsWith("</")) {
      return `</${tag}>`;
    }

    if (!rawAttrs) {
      return `<${tag}>`;
    }

    const allowedAttrSet = ALLOWED_ATTRS[tag] || new Set(["class"]);
    const safeAttrs: string[] = [];

    // Parse attributes: attr="value" or attr='value' or attr=value
    const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

      // Reject all event handlers
      if (attrName.startsWith("on")) continue;

      // Only allow approved attributes for this tag
      if (!allowedAttrSet.has(attrName)) continue;

      // Validate URLs in href or src
      if (attrName === "href" || attrName === "src") {
        const trimmed = attrVal.trim();
        // Prevent javascript:, data:, vbscript:
        if (!SAFE_URL_PATTERN.test(trimmed)) {
          continue;
        }
        safeAttrs.push(`${attrName}="${escapeHtml(trimmed)}"`);
      } else if (attrName === "style") {
        const safeStyle = attrVal
          .replace(/expression\([^)]*\)/gi, "")
          .replace(/url\([^)]*\)/gi, "")
          .replace(/behavior/gi, "")
          .trim();
        if (safeStyle) {
          safeAttrs.push(`style="${escapeHtml(safeStyle)}"`);
        }
      } else {
        safeAttrs.push(`${attrName}="${escapeHtml(attrVal)}"`);
      }
    }

    // For <a> tags, enforce secure target & rel
    if (tag === "a") {
      const hasRel = safeAttrs.some((a) => a.startsWith("rel="));
      if (!hasRel) {
        safeAttrs.push('rel="noopener noreferrer"');
      }
      const hasTarget = safeAttrs.some((a) => a.startsWith("target="));
      if (!hasTarget) {
        safeAttrs.push('target="_blank"');
      }
    }

    const attrsString = safeAttrs.length > 0 ? " " + safeAttrs.join(" ") : "";
    return `<${tag}${attrsString}>`;
  });

  return clean;
}

export interface TemplateContactContext {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  industry?: string | null;
  website?: string | null;
  [key: string]: string | null | undefined;
}

export interface TemplateSenderContext {
  sender_name?: string | null;
  business_name?: string | null;
  [key: string]: string | null | undefined;
}

export interface RenderTemplateOptions {
  sanitize?: boolean;
  missingVariablePlaceholder?: (variableName: string) => string;
}

export interface RenderedTemplateResult {
  subject: string;
  body: string;
  variablesFound: string[];
  missingVariables: string[];
}

/**
 * Controlled whitelist of supported variable keys.
 */
export const SUPPORTED_VARIABLE_KEYS = [
  "first_name",
  "last_name",
  "email",
  "company_name",
  "job_title",
  "industry",
  "website",
  "sender_name",
  "business_name",
] as const;

export type SupportedVariableKey = (typeof SUPPORTED_VARIABLE_KEYS)[number];

export interface VariableDefinition {
  key: SupportedVariableKey;
  token: string;
  label: string;
  category: "contact" | "sender";
  example: string;
}

export const VARIABLE_DEFINITIONS: VariableDefinition[] = [
  {
    key: "first_name",
    token: "{{first_name}}",
    label: "First Name",
    category: "contact",
    example: "Rahul",
  },
  {
    key: "last_name",
    token: "{{last_name}}",
    label: "Last Name",
    category: "contact",
    example: "Sharma",
  },
  {
    key: "email",
    token: "{{email}}",
    label: "Contact Email",
    category: "contact",
    example: "rahul@example.test",
  },
  {
    key: "company_name",
    token: "{{company_name}}",
    label: "Company Name",
    category: "contact",
    example: "Demo Company",
  },
  {
    key: "job_title",
    token: "{{job_title}}",
    label: "Job Title",
    category: "contact",
    example: "Founder",
  },
  {
    key: "industry",
    token: "{{industry}}",
    label: "Industry",
    category: "contact",
    example: "Software",
  },
  {
    key: "website",
    token: "{{website}}",
    label: "Website",
    category: "contact",
    example: "https://example.test",
  },
  {
    key: "sender_name",
    token: "{{sender_name}}",
    label: "Sender Name",
    category: "sender",
    example: "Demo Sender",
  },
  {
    key: "business_name",
    token: "{{business_name}}",
    label: "Business Name",
    category: "sender",
    example: "Demo Business",
  },
];

const SUPPORTED_SET = new Set<string>(SUPPORTED_VARIABLE_KEYS);

/**
 * Standard fake preview contact and sender as specified in Phase 5 requirements.
 */
export const SAMPLE_PREVIEW_CONTACT: TemplateContactContext = {
  first_name: "Rahul",
  last_name: "Sharma",
  email: "rahul@example.test",
  company_name: "Demo Company",
  job_title: "Founder",
  industry: "Software",
  website: "https://example.test",
};

export const SAMPLE_PREVIEW_SENDER: TemplateSenderContext = {
  sender_name: "Demo Sender",
  business_name: "Demo Business",
};

/**
 * Regular expression matching {{variable_name}} tokens.
 */
export const VARIABLE_REGEX = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Extracts and returns unique supported variable names present in text.
 */
export function extractVariables(text: string): string[] {
  if (!text) return [];
  const matches = text.match(VARIABLE_REGEX);
  if (!matches) return [];

  const found = new Set<string>();
  for (const m of matches) {
    const rawKey = m.slice(2, -2).trim();
    if (SUPPORTED_SET.has(rawKey)) {
      found.add(rawKey);
    }
  }
  return Array.from(found).sort();
}

/**
 * Replaces variables in a single string based on contact and sender context.
 */
export function replaceVariablesInString(
  content: string,
  contact: TemplateContactContext = {},
  sender: TemplateSenderContext = {},
  options: RenderTemplateOptions = {}
): { text: string; missing: string[]; found: string[] } {
  if (!content) return { text: "", missing: [], found: [] };

  const missingSet = new Set<string>();
  const foundSet = new Set<string>();

  const defaultMissingFormatter = (key: string) => `[Missing ${key}]`;
  const formatMissing = options.missingVariablePlaceholder || defaultMissingFormatter;

  const rendered = content.replace(VARIABLE_REGEX, (match, rawKey: string) => {
    const key = rawKey.trim();

    if (!SUPPORTED_SET.has(key)) {
      return match;
    }

    foundSet.add(key);

    let val: string | null | undefined;

    if (key in contact) {
      val = contact[key];
    } else if (key in sender) {
      val = sender[key];
    }

    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }

    missingSet.add(key);
    return formatMissing(key);
  });

  return {
    text: rendered,
    missing: Array.from(missingSet),
    found: Array.from(foundSet),
  };
}

/**
 * Renders subject and body of an email template with variable substitution and sanitization.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  contact: TemplateContactContext = {},
  sender: TemplateSenderContext = {},
  options: RenderTemplateOptions = {}
): RenderedTemplateResult {
  const { text: renderedSubject, missing: subjMissing, found: subjFound } =
    replaceVariablesInString(template.subject || "", contact, sender, options);

  const { text: rawRenderedBody, missing: bodyMissing, found: bodyFound } =
    replaceVariablesInString(template.body || "", contact, sender, options);

  const finalBody =
    options.sanitize !== false ? sanitizeHtml(rawRenderedBody) : rawRenderedBody;

  const allFound = Array.from(new Set([...subjFound, ...bodyFound])).sort();
  const allMissing = Array.from(new Set([...subjMissing, ...bodyMissing])).sort();

  return {
    subject: renderedSubject,
    body: finalBody,
    variablesFound: allFound,
    missingVariables: allMissing,
  };
}
