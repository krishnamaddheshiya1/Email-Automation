/**
 * Provider-Agnostic File & Object Storage Abstraction
 *
 * Decouples attachment persistence from physical storage mechanisms
 * (local filesystem, Supabase Storage, AWS S3, Cloudflare R2, Google Cloud Storage).
 */

export interface StorageObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  lastModified?: Date;
  etag?: string;
}

export interface StorageUploadResult {
  key: string;
  size: number;
  mimeType: string;
  url?: string;
}

export interface StorageProvider {
  readonly name: string;

  /**
   * Uploads binary content to the storage provider under a tenant-isolated key.
   */
  upload(
    key: string,
    content: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<StorageUploadResult>;

  /**
   * Downloads binary content from storage.
   * Throws if the object does not exist.
   */
  download(key: string): Promise<Buffer>;

  /**
   * Removes an object from storage. Returns true if removed, false if not found.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks whether an object exists in storage without loading its contents.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Retrieves object metadata without downloading full binary content.
   */
  getMetadata(key: string): Promise<StorageObjectMetadata | null>;
}
