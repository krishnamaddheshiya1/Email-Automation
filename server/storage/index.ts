import type { StorageProvider } from "./storage.interface";
import { LocalStorageProvider } from "./local-storage.provider";
import { InMemoryStorageProvider } from "./in-memory-storage.provider";

export type * from "./storage.interface";
export * from "./local-storage.provider";
export * from "./in-memory-storage.provider";

let defaultStorageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!defaultStorageProvider) {
    if (process.env.STORAGE_PROVIDER === "in-memory") {
      defaultStorageProvider = new InMemoryStorageProvider();
    } else {
      defaultStorageProvider = new LocalStorageProvider();
    }
  }
  return defaultStorageProvider;
}

export function setStorageProvider(provider: StorageProvider): void {
  defaultStorageProvider = provider;
}
