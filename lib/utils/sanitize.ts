/**
 * HTML Sanitization Utility for Email Templates
 *
 * Provides strict sanitization to prevent script injection (XSS),
 * malicious href schemes (javascript:), and dangerous iframe/object tags.
 * Works seamlessly in both Node.js (SSR / Unit Tests) and Browser environments.
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
 * - Strips <script> and its entire content
 * - Strips <style> and its content
 * - Strips <iframe>, <object>, <embed>, <form>, <input>, <meta>, <base>
 * - Strips any event attributes (e.g. onerror, onload, onclick)
 * - Strips javascript: and data: text/html in href / src attributes
 * - Enforces rel="noopener noreferrer" and target="_blank" on external <a> links
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
        // Simple style sanitization: prevent expression(), behavior, -moz-binding, url()
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
