/**
 * Exception-safe storage for disposable hints. When localStorage is blocked or
 * full, a small in-memory map preserves current-tab behavior; callers must never
 * treat either backend as durable board storage.
 */
const MAX_MEMORY_ENTRIES = 64;
const MAX_MEMORY_VALUE_LENGTH = 64 * 1024;

interface StorageBackend {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface BestEffortStorage {
  getItem(key: string): string | null;
  removeItem(key: string): boolean;
  setItem(key: string, value: string): boolean;
}

/**
 * Keeps non-authoritative browser preferences usable when localStorage is
 * blocked, full, or unavailable during module initialization. The bounded
 * memory overlay never claims durability and is retried when storage recovers.
 */
export function createBestEffortStorage(
  resolveStorage: () => StorageBackend,
): BestEffortStorage {
  const memoryOverlay = new Map<string, string | null>();

  const remember = (key: string, value: string | null) => {
    memoryOverlay.delete(key);
    memoryOverlay.set(
      key,
      value !== null && value.length > MAX_MEMORY_VALUE_LENGTH ? null : value,
    );
    while (memoryOverlay.size > MAX_MEMORY_ENTRIES) {
      const oldestKey = memoryOverlay.keys().next().value;
      if (oldestKey === undefined) break;
      memoryOverlay.delete(oldestKey);
    }
  };

  const flushOverlay = (key: string, value: string | null) => {
    try {
      const storage = resolveStorage();
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      memoryOverlay.delete(key);
    } catch {
      // Keep the bounded in-memory value until storage becomes available.
    }
  };

  return {
    getItem(key) {
      if (memoryOverlay.has(key)) {
        const value = memoryOverlay.get(key) ?? null;
        flushOverlay(key, value);
        return value;
      }
      try {
        return resolveStorage().getItem(key);
      } catch {
        return null;
      }
    },
    removeItem(key) {
      try {
        resolveStorage().removeItem(key);
        memoryOverlay.delete(key);
        return true;
      } catch {
        remember(key, null);
        return false;
      }
    },
    setItem(key, value) {
      try {
        resolveStorage().setItem(key, value);
        memoryOverlay.delete(key);
        return true;
      } catch {
        remember(key, value);
        return false;
      }
    },
  };
}

/** Local-storage facade that retains bounded writes in memory during failures. */
export const bestEffortLocalStorage = createBestEffortStorage(
  () => window.localStorage,
);
