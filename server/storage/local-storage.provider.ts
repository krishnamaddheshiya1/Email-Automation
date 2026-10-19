import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import type {
  StorageProvider,
  StorageObjectMetadata,
  StorageUploadResult,
} from "./storage.interface";

export interface LocalStorageOptions {
  baseDir?: string;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private baseDir: string;

  constructor(options: LocalStorageOptions = {}) {
    this.baseDir = path.resolve(
      /*turbopackIgnore: true*/
      options.baseDir ||
        process.env.STORAGE_LOCAL_DIR ||
        path.join(process.cwd(), ".storage", "attachments")
    );
    this.ensureBaseDirSync();
  }

  private ensureBaseDirSync(): void {
    try {
      if (!fsSync.existsSync(this.baseDir)) {
        fsSync.mkdirSync(this.baseDir, { recursive: true });
      }
    } catch {
      // Ignored if created concurrently
    }
  }

  /**
   * Resolves and strictly bounds file path within baseDir to prevent directory traversal.
   */
  private resolveSafePath(key: string): string {
    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const targetPath = path.resolve(this.baseDir, cleanKey);

    if (!targetPath.startsWith(this.baseDir)) {
      throw new Error(`Security Violation: Path traversal attempted with storage key "${key}".`);
    }

    return targetPath;
  }

  async upload(
    key: string,
    content: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult> {
    const filePath = this.resolveSafePath(key);
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content);

    // Save sidecar metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
      try {
        await fs.writeFile(
          `${filePath}.meta.json`,
          JSON.stringify({ mimeType, ...metadata }, null, 2),
          "utf-8"
        );
      } catch {
        // Non-blocking sidecar write
      }
    }

    return {
      key,
      size: content.length,
      mimeType,
    };
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(key);
    try {
      return await fs.readFile(filePath);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") {
        throw new Error(`Storage object not found: "${key}".`);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.unlink(filePath);
      // Clean up sidecar if exists
      try {
        await fs.unlink(`${filePath}.meta.json`);
      } catch {
        // Ignored
      }
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const filePath = this.resolveSafePath(key);
    try {
      const stat = await fs.stat(filePath);
      let mimeType = "application/octet-stream";

      try {
        const metaPath = `${filePath}.meta.json`;
        if (fsSync.existsSync(metaPath)) {
          const raw = await fs.readFile(metaPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed.mimeType) {
            mimeType = parsed.mimeType;
          }
        }
      } catch {
        // Fallback
      }

      return {
        key,
        size: stat.size,
        mimeType,
        lastModified: stat.mtime,
      };
    } catch {
      return null;
    }
  }
}
