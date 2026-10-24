import crypto from "crypto";

/**
 * Server-Side Cryptographic Secret Encryption Utility (AES-256-GCM)
 *
 * Secures provider credentials and sensitive API tokens at rest.
 * Never logs, exposes, or transmits plaintext secrets.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

function getEncryptionKey(): Buffer {
  const secret =
    process.env.EMAIL_SECRET_ENCRYPTION_KEY ||
    process.env.APP_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
      return crypto.createHash("sha256").update("email-automation-default-dev-encryption-key-32b").digest();
    }
    throw new Error(
      "EMAIL_SECRET_ENCRYPTION_KEY or APP_SECRET environment variable is required for encryption operations."
    );
  }

  // Derive a deterministic 256-bit (32-byte) key using SHA-256
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a sensitive string (such as an API key) using AES-256-GCM.
 * Returns a serialized string format: `iv:authTag:ciphertext` in hex.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext secret is required for encryption.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM serialized payload: `iv:authTag:ciphertext` in hex.
 * Fails safely if tampered or invalid.
 */
export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== "string" || !payload.includes(":")) {
    throw new Error("Malformed encrypted secret payload.");
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format (expected iv:authTag:ciphertext).");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf-8");
  decrypted += decipher.final("utf-8");

  return decrypted;
}

/**
 * Masks an API key for safe display in UI/API responses without exposing the secret.
 * Example: 're_1234567890abcdef' -> 're_••••••••••••cdef'
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || typeof apiKey !== "string") return "";
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  const prefix = trimmed.startsWith("re_") ? "re_" : trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}
