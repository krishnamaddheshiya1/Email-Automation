import type { StorageProvider } from "./storage.interface";
import { LocalStorageProvider } from "./local-storage.provider";
import { InMemoryStorageProvider } from "./in-memory-storage.provider";
import { SupabaseStorageProvider } from "./supabase-storage.provider";

export type * from "./storage.interface";
export * from "./local-storage.provider";
export * from "./in-memory-storage.provider";
export * from "./supabase-storage.provider";

let defaultStorageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!defaultStorageProvider) {
    if (process.env.STORAGE_PROVIDER === "in-memory") {
      defaultStorageProvider = new InMemoryStorageProvider();
    } else if (process.env.STORAGE_PROVIDER === "local") {
      defaultStorageProvider = new LocalStorageProvider();
    } else if (
      process.env.STORAGE_PROVIDER === "supabase" ||
      Boolean(
        process.env.SUPABASE_URL &&
          (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
      )
    ) {
      defaultStorageProvider = new SupabaseStorageProvider();
    } else {
      defaultStorageProvider = new LocalStorageProvider();
    }
  }
  return defaultStorageProvider;
}

export function setStorageProvider(provider: StorageProvider): void {
  defaultStorageProvider = provider;
}

