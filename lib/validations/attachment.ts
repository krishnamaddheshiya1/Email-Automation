import crypto from "crypto";
import path from "path";
export type AttachmentCategory =
  | "image"
  | "document"
  | "spreadsheet"
  | "video"
  | "archive"
  | "other";

export interface AllowedFileTypeConfig {
  extension: string;
  category: AttachmentCategory;
  mimeTypes: string[];
}

export const ALLOWED_ATTACHMENT_TYPES: Record<string, AllowedFileTypeConfig> = {
  // Images
  jpg: { extension: "jpg", category: "image", mimeTypes: ["image/jpeg", "image/pjpeg"] },
  jpeg: { extension: "jpeg", category: "image", mimeTypes: ["image/jpeg", "image/pjpeg"] },
  png: { extension: "png", category: "image", mimeTypes: ["image/png"] },
  webp: { extension: "webp", category: "image", mimeTypes: ["image/webp"] },
  gif: { extension: "gif", category: "image", mimeTypes: ["image/gif"] },

  // Documents
  pdf: { extension: "pdf", category: "document", mimeTypes: ["application/pdf"] },
  doc: { extension: "doc", category: "document", mimeTypes: ["application/msword"] },
  docx: {
    extension: "docx",
    category: "document",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  },
  txt: { extension: "txt", category: "document", mimeTypes: ["text/plain"] },

  // Spreadsheets
  xls: { extension: "xls", category: "spreadsheet", mimeTypes: ["application/vnd.ms-excel"] },
  xlsx: {
    extension: "xlsx",
    category: "spreadsheet",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
  },
  csv: { extension: "csv", category: "spreadsheet", mimeTypes: ["text/csv", "text/plain", "application/csv"] },

  // Videos
  mp4: { extension: "mp4", category: "video", mimeTypes: ["video/mp4"] },
  mov: { extension: "mov", category: "video", mimeTypes: ["video/quicktime"] },
  webm: { extension: "webm", category: "video", mimeTypes: ["video/webm"] },

  // Archives
  zip: { extension: "zip", category: "archive", mimeTypes: ["application/zip", "application/x-zip-compressed"] },
};

export const PROHIBITED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "sh", "vbs", "ps1", "jar",
  "js", "mjs", "py", "php", "dll", "so", "pif", "application", "gadget",
  "hta", "cpl", "msc", "reg", "vb", "ws", "wsf", "wsc", "wsh"
]);

export function getMaxAttachmentSize(): number {
  const envVal = process.env.MAX_ATTACHMENT_SIZE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Default: 10 MB per attachment
  return 10 * 1024 * 1024;
}

export function getMaxTotalAttachmentSize(): number {
  const envVal = process.env.MAX_TOTAL_ATTACHMENT_SIZE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Default: 25 MB total attachments per email (Resend / SMTP limit)
  return 25 * 1024 * 1024;
}

/**
 * Checks for path traversal and illegal characters in filenames.
 */
export function validateFilenameSecurity(rawFilename: string): { valid: boolean; error?: string } {
  if (!rawFilename || typeof rawFilename !== "string") {
    return { valid: false, error: "Filename is required." };
  }

  // Null byte injection check
  if (rawFilename.includes("\0")) {
    return { valid: false, error: "Filename contains null byte injection." };
  }

  // Path traversal check
  if (
    rawFilename.includes("../") ||
    rawFilename.includes("..\\") ||
    rawFilename.includes("/") ||
    rawFilename.includes("\\") ||
    path.isAbsolute(rawFilename)
  ) {
    return { valid: false, error: "Filename contains path traversal characters." };
  }

  // Control characters check (0x00 - 0x1F, 0x7F)
  if (/[\x00-\x1F\x7F]/.test(rawFilename)) {
    return { valid: false, error: "Filename contains illegal control characters." };
  }

  return { valid: true };
}

/**
 * Sanitizes original filename into a clean, safe basename.
 */
export function sanitizeFilename(originalName: string): string {
  // Strip any path segments
  let name = path.basename(originalName);

  // Remove null bytes and control chars
  name = name.replace(/[\x00-\x1F\x7F]/g, "");

  // Replace spaces and special characters with safe characters
  name = name.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Prevent dotfile attacks or empty filenames
  if (name.startsWith(".")) {
    name = `file${name}`;
  }
  if (!name || name === "_") {
    name = "attachment";
  }

  // Truncate to reasonable length (keep extension)
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const truncatedBase = base.slice(0, 100);

  return `${truncatedBase}${ext}`.toLowerCase();
}

/**
 * Extracts and normalizes the extension from a filename.
 */
export function getFileExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  return ext;
}

/**
 * Validates magic bytes / header signatures of binary buffers.
 */
export function validateMagicBytes(buffer: Buffer, extension: string): boolean {
  if (!buffer || buffer.length === 0) return false;

  switch (extension) {
    case "jpg":
    case "jpeg":
      // JPEG starts with FF D8 FF
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );

    case "png":
      // PNG starts with 89 50 4E 47 0D 0A 1A 0A
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );

    case "gif":
      // GIF starts with GIF87a or GIF89a
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38
      );

    case "webp":
      // RIFF....WEBP
      if (buffer.length < 12) return false;
      const riff = buffer.toString("ascii", 0, 4);
      const webp = buffer.toString("ascii", 8, 12);
      return riff === "RIFF" && webp === "WEBP";

    case "pdf":
      // PDF starts with %PDF (25 50 44 46)
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
      );

    case "zip":
    case "docx":
    case "xlsx":
      // PK (50 4B 03 04, 50 4B 05 06, or 50 4B 07 08)
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
      );

    case "doc":
    case "xls":
      // OLE2 Compound File Header (D0 CF 11 E0)
      return (
        buffer.length >= 4 &&
        buffer[0] === 0xd0 &&
        buffer[1] === 0xcf &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xe0
      );

    case "mp4":
    case "mov":
      // ISO Base Media file / QuickTime (ftyp or moov in first 16 bytes)
      if (buffer.length >= 12) {
        const subtype = buffer.toString("ascii", 4, 8);
        return subtype === "ftyp" || subtype === "moov" || subtype === "wide";
      }
      return false;

    case "webm":
      // EBML header: 1A 45 DF A3
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );

    case "csv":
    case "txt":
      // Check for zero null bytes in first 1KB
      const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
      return !sample.includes(0x00);

    default:
      return true;
  }
}

export interface AttachmentValidationOptions {
  filename: string;
  mimeType: string;
  size: number;
  buffer?: Buffer;
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
  sanitizedFilename: string;
  extension: string;
  mimeType: string;
  category: AttachmentCategory;
}

/**
 * Complete Server-Side File Attachment Validator
 */
export function validateAttachment(
  options: AttachmentValidationOptions
): AttachmentValidationResult {
  const { filename, mimeType, size, buffer } = options;

  // 1. Filename security (traversal, null bytes)
  const secCheck = validateFilenameSecurity(filename);
  if (!secCheck.valid) {
    return {
      valid: false,
      error: secCheck.error,
      sanitizedFilename: "",
      extension: "",
      mimeType,
      category: "document",
    };
  }

  const sanitized = sanitizeFilename(filename);
  const ext = getFileExtension(sanitized);

  // 2. Prohibited executable extensions check
  if (PROHIBITED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Executable and dangerous file types (.${ext}) are strictly prohibited.`,
      sanitizedFilename: sanitized,
      extension: ext,
      mimeType,
      category: "document",
    };
  }

  // 3. Allowed type check
  const allowedConfig = ALLOWED_ATTACHMENT_TYPES[ext];
  if (!allowedConfig) {
    return {
      valid: false,
      error: `File type ".${ext}" is not supported. Supported categories: Images, Documents, Spreadsheets, Videos, Archives.`,
      sanitizedFilename: sanitized,
      extension: ext,
      mimeType,
      category: "document",
    };
  }

  // 4. File size check
  const maxSize = getMaxAttachmentSize();
  if (size <= 0) {
    return {
      valid: false,
      error: "Attachment file cannot be empty.",
      sanitizedFilename: sanitized,
      extension: ext,
      mimeType,
      category: allowedConfig.category,
    };
  }
  if (size > maxSize) {
    return {
      valid: false,
      error: "Attachment exceeds the maximum allowed file size.",
      sanitizedFilename: sanitized,
      extension: ext,
      mimeType,
      category: allowedConfig.category,
    };
  }

  // 5. MIME Type check
  const normalizedMime = (mimeType || "").trim().toLowerCase();
  const isMimeAllowed =
    allowedConfig.mimeTypes.includes(normalizedMime) ||
    (ext === "csv" && (normalizedMime === "text/plain" || normalizedMime === "application/vnd.ms-excel")) ||
    normalizedMime === "application/octet-stream"; // Allow octet-stream only if magic bytes pass

  if (!isMimeAllowed) {
    return {
      valid: false,
      error: `Invalid MIME type "${mimeType}" for file extension .${ext}.`,
      sanitizedFilename: sanitized,
      extension: ext,
      mimeType,
      category: allowedConfig.category,
    };
  }

  // 6. Magic bytes signature verification if buffer provided
  if (buffer) {
    const magicOk = validateMagicBytes(buffer, ext);
    if (!magicOk) {
      return {
        valid: false,
        error: `File signature mismatch for .${ext}. The file contents do not match the declared extension.`,
        sanitizedFilename: sanitized,
        extension: ext,
        mimeType,
        category: allowedConfig.category,
      };
    }
  }

  return {
    valid: true,
    sanitizedFilename: sanitized,
    extension: ext,
    mimeType: allowedConfig.mimeTypes[0] || mimeType,
    category: allowedConfig.category,
  };
}

/**
 * Generates safe, tenant-isolated unique storage key:
 * ${business_id}/${campaign_id || 'general'}/${uuid}.${ext}
 */
export function generateAttachmentStorageKey(
  businessId: string,
  campaignId: string | null | undefined,
  filename: string
): string {
  const ext = getFileExtension(filename);
  const uuid = crypto.randomUUID();
  const folder = campaignId || "general";
  return `${businessId}/${folder}/${uuid}.${ext}`;
}
