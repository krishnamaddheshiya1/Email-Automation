import type {
  StorageProvider,
  StorageObjectMetadata,
  StorageUploadResult,
} from "./storage.interface";

export class InMemoryStorageProvider implements StorageProvider {
  readonly name = "in-memory";
  private files = new Map<string, { content: Buffer; mimeType: string; modified: Date }>();

  async upload(
    key: string,
    content: Buffer,
    mimeType: string
  ): Promise<StorageUploadResult> {
    this.files.set(key, { content, mimeType, modified: new Date() });
    return {
      key,
      size: content.length,
      mimeType,
    };
  }

  async download(key: string): Promise<Buffer> {
    const item = this.files.get(key);
    if (!item) {
      throw new Error(`Storage object not found: "${key}".`);
    }
    return item.content;
  }

  async delete(key: string): Promise<boolean> {
    return this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const item = this.files.get(key);
    if (!item) return null;
    return {
      key,
      size: item.content.length,
      mimeType: item.mimeType,
      lastModified: item.modified,
    };
  }

  clear(): void {
    this.files.clear();
  }
}
