import type { QueueItem } from "../types/common";

export const LIBRARY_QUEUE_KEY = "library_queue";

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeQueueItems = (value: unknown): QueueItem[] | null => {
  if (!Array.isArray(value)) return null;
  const validItems = value.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { path?: unknown }).path === "string",
  );
  if (validItems.length === 0 && value.length > 0) return null;
  return validItems as QueueItem[];
};

export const loadLibraryQueueFromStorage = (
  storage: StorageLike,
  _buildFromLegacyPath: (path: string) => QueueItem,
): QueueItem[] => {
  const libraryPayload = parseJson(storage.getItem(LIBRARY_QUEUE_KEY));
  const queue = normalizeQueueItems(libraryPayload);
  return queue ?? [];
};

export const loadLibraryQueueWithLegacyMigration = (
  buildFromLegacyPath: (path: string) => QueueItem,
): QueueItem[] => {
  if (typeof window === "undefined" || !window.localStorage) return [];
  return loadLibraryQueueFromStorage(window.localStorage, buildFromLegacyPath);
};

export const persistLibraryQueueToStorage = (
  storage: StorageLike,
  queue: QueueItem[],
): void => {
  try {
    storage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore storage write failures
  }
};

export const persistLibraryQueue = (queue: QueueItem[]): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  persistLibraryQueueToStorage(window.localStorage, queue);
};
