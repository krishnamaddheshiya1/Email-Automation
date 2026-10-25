import type {
  StorageProvider,
  StorageObjectMetadata,
  StorageUploadResult,
} from "./storage.interface";
import { getSupabaseAdminClient } from "../db/supabase";
import { LocalStorageProvider } from "./local-storage.provider";

export interface SupabaseStorageOptions {
  bucket?: string;
  fallbackToLocal?: boolean;
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private bucket: string;
  private localFallback?: LocalStorageProvider;

  constructor(options: SupabaseStorageOptions = {}) {
    this.bucket = options.bucket || process.env.STORAGE_BUCKET || "attachments";
    if (options.fallbackToLocal !== false) {
      this.localFallback = new LocalStorageProvider();
    }
  }

  private cleanKey(key: string): string {
    return key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  }

  /**
   * Uploads binary content to the Supabase Storage bucket under a tenant-isolated key.
   */
  async upload(
    key: string,
    content: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    const { error } = await admin.storage
      .from(this.bucket)
      .upload(safeKey, content, {
        contentType: mimeType || "application/octet-stream",
        upsert: true,
        metadata: metadata ? metadata : undefined,
      });

    if (error) {
      // If Supabase upload fails, check if local fallback is available
      if (this.localFallback) {
        console.warn(`[SupabaseStorage] Upload failed (${error.message}), writing to local storage fallback.`);
        return await this.localFallback.upload(key, content, mimeType, metadata);
      }
      throw new Error(`Supabase Storage upload error for "${safeKey}": ${error.message}`);
    }

    // Also mirror to local fallback if running locally for quick access
    if (this.localFallback && !process.env.VERCEL && !process.env.NETLIFY) {
      try {
        await this.localFallback.upload(key, content, mimeType, metadata);
      } catch {
        // Non-blocking mirror
      }
    }

    return {
      key: safeKey,
      size: content.length,
      mimeType,
    };
  }

  /**
   * Downloads binary content from storage.
   * Checks Supabase Storage first, then falls back to local storage if present.
   */
  async download(key: string): Promise<Buffer> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    const { data, error } = await admin.storage
      .from(this.bucket)
      .download(safeKey);

    if (!error && data) {
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Fallback to local storage if available
    if (this.localFallback) {
      const localExists = await this.localFallback.exists(key);
      if (localExists) {
        const buffer = await this.localFallback.download(key);
        // Self-heal: Upload to Supabase so it's persisted for subsequent requests
        try {
          await admin.storage
            .from(this.bucket)
            .upload(safeKey, buffer, {
              upsert: true,
            });
        } catch {
          // Non-blocking self-heal
        }
        return buffer;
      }
    }

    throw new Error(`Storage object not found: "${safeKey}".`);
  }

  /**
   * Removes an object from storage.
   */
  async delete(key: string): Promise<boolean> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    const { data, error } = await admin.storage
      .from(this.bucket)
      .remove([safeKey]);

    let deleted = false;
    if (!error && data && data.length > 0) {
      deleted = true;
    }

    if (this.localFallback) {
      try {
        const localDeleted = await this.localFallback.delete(key);
        if (localDeleted) deleted = true;
      } catch {
        // Ignore
      }
    }

    return deleted;
  }

  /**
   * Checks whether an object exists in storage without loading its contents.
   */
  async exists(key: string): Promise<boolean> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    // Fast check via createSignedUrl
    try {
      const { data, error } = await admin.storage
        .from(this.bucket)
        .createSignedUrl(safeKey, 60);

      if (!error && data?.signedUrl) {
        return true;
      }
    } catch {
      // Ignore
    }

    // Check directory listing if single-sign fails
    try {
      const lastSlash = safeKey.lastIndexOf("/");
      const folder = lastSlash > -1 ? safeKey.substring(0, lastSlash) : "";
      const filename = lastSlash > -1 ? safeKey.substring(lastSlash + 1) : safeKey;

      const { data, error } = await admin.storage
        .from(this.bucket)
        .list(folder, { search: filename, limit: 1 });

      if (!error && data && data.some((item) => item.name === filename)) {
        return true;
      }
    } catch {
      // Ignore
    }

    // Fallback to local storage check
    if (this.localFallback) {
      return await this.localFallback.exists(key);
    }

    return false;
  }

  /**
   * Retrieves object metadata.
   */
  async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    try {
      const lastSlash = safeKey.lastIndexOf("/");
      const folder = lastSlash > -1 ? safeKey.substring(0, lastSlash) : "";
      const filename = lastSlash > -1 ? safeKey.substring(lastSlash + 1) : safeKey;

      const { data, error } = await admin.storage
        .from(this.bucket)
        .list(folder, { search: filename, limit: 1 });

      if (!error && data) {
        const item = data.find((i) => i.name === filename);
        if (item) {
          return {
            key: safeKey,
            size: Number(item.metadata?.size || 0),
            mimeType: String(item.metadata?.mimetype || "application/octet-stream"),
            lastModified: item.updated_at ? new Date(item.updated_at) : undefined,
          };
        }
      }
    } catch {
      // Ignore
    }

    if (this.localFallback) {
      return await this.localFallback.getMetadata(key);
    }

    return null;
  }

  /**
   * Generates a temporary signed URL at runtime.
   */
  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string | null> {
    const safeKey = this.cleanKey(key);
    const admin = getSupabaseAdminClient();

    try {
      const { data, error } = await admin.storage
        .from(this.bucket)
        .createSignedUrl(safeKey, expiresInSeconds);

      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    } catch {
      // Ignore
    }

    return null;
  }
}
