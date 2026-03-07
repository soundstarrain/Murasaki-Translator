import { describe, expect, it } from "vitest";

import type { QueueItem } from "../../types/common";
import {
  LIBRARY_QUEUE_KEY,
  loadLibraryQueueFromStorage,
  persistLibraryQueueToStorage,
  type StorageLike,
} from "../libraryQueueStorage";

const createMemoryStorage = (
  initial: Record<string, string> = {},
): StorageLike & { snapshot: () => Record<string, string> } => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store.entries()),
  };
};

const buildQueueItem = (path: string): QueueItem => ({
  id: `id-${path}`,
  path,
  fileName: path.split(/[/\\]/).pop() || path,
  fileType: "txt",
  addedAt: "2026-02-23T00:00:00.000Z",
  status: "pending",
  config: { useGlobalDefaults: true },
});

describe("libraryQueueStorage", () => {
  it("loads current library_queue payload", () => {
    const existingQueue: QueueItem[] = [buildQueueItem("D:/new.txt")];
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: JSON.stringify(existingQueue),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue).toEqual(existingQueue);
  });

  it("returns empty array for unsupported payload shapes", () => {
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: JSON.stringify(["E:/legacy.txt"]),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue).toEqual([]);
  });

  it("returns empty array for malformed payload", () => {
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: "{",
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue).toEqual([]);
  });

  it("persists queue to library_queue only", () => {
    const storage = createMemoryStorage();
    const queue = [buildQueueItem("G:/new.txt")];

    persistLibraryQueueToStorage(storage, queue);

    expect(JSON.parse(storage.getItem(LIBRARY_QUEUE_KEY) || "[]")).toEqual(
      queue,
    );
    expect(storage.snapshot()).toHaveProperty(LIBRARY_QUEUE_KEY);
  });
});
