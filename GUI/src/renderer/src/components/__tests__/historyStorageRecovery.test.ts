import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationRecord } from "../HistoryView";
import {
  clearHistory,
  getHistory,
  loadRecordDetail,
  saveHistory,
} from "../HistoryView";

const HISTORY_STORAGE_KEY = "translation_history";
const HISTORY_BACKUP_STORAGE_KEY = "translation_history_backup";

const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const createRecord = (id: string): TranslationRecord => ({
  id,
  fileName: `${id}.txt`,
  filePath: `E:/input/${id}.txt`,
  startTime: "2026-02-23T00:00:00.000Z",
  status: "completed",
  totalBlocks: 1,
  completedBlocks: 1,
  totalLines: 1,
  triggers: [
    {
      time: "2026-02-23T00:00:01.000Z",
      type: "warning_quality",
      block: 1,
      message: "warn",
    },
  ],
  logs: ["log-line"],
});

const flushMicrotasks = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("history storage recovery", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage =
      createStorageMock() as unknown as Storage;
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = undefined;
  });

  it("persists lightweight history to both primary and backup keys", () => {
    const record = createRecord("r1");
    saveHistory([record]);

    const primaryRaw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const backupRaw = localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY);
    expect(primaryRaw).toBeTruthy();
    expect(backupRaw).toBe(primaryRaw);

    const parsed = JSON.parse(primaryRaw || "[]");
    expect(parsed[0].logs).toEqual([]);
    expect(parsed[0].triggers).toEqual([]);
  });

  it("recovers from backup when primary history payload is malformed", () => {
    const backup = [createRecord("r2")].map((record) => ({
      ...record,
      logs: [],
      triggers: [],
    }));
    localStorage.setItem(HISTORY_STORAGE_KEY, "{");
    localStorage.setItem(HISTORY_BACKUP_STORAGE_KEY, JSON.stringify(backup));

    const history = getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("r2");
    expect(history[0].logs).toEqual([]);
    expect(history[0].triggers).toEqual([]);
  });

  it("clears corrupted primary payload when no backup is available", () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, "{");
    localStorage.removeItem(HISTORY_BACKUP_STORAGE_KEY);

    const history = getHistory();
    expect(history).toEqual([]);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("clearHistory removes both primary and backup history keys", () => {
    saveHistory([createRecord("r3")]);
    clearHistory();

    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it("saveHistory prunes orphaned history_detail keys", async () => {
    localStorage.setItem("history_detail_orphan", "{\"logs\":[\"x\"]}");
    localStorage.setItem("history_detail_keep", "{\"logs\":[\"y\"]}");

    saveHistory([createRecord("keep")]);
    await flushMicrotasks();

    expect(localStorage.getItem("history_detail_orphan")).toBeNull();
    expect(localStorage.getItem("history_detail_keep")).toBeTruthy();
  });

  it("clearHistory removes all history_detail keys, including orphaned ones", () => {
    saveHistory([createRecord("r4")]);
    localStorage.setItem("history_detail_r4", "{\"logs\":[\"a\"]}");
    localStorage.setItem("history_detail_old", "{\"logs\":[\"b\"]}");

    clearHistory();

    expect(localStorage.getItem("history_detail_r4")).toBeNull();
    expect(localStorage.getItem("history_detail_old")).toBeNull();
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it("delegates detail prune to disk cache IPC when available", async () => {
    const pruneSpy = vi.fn().mockResolvedValue(true);
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = {
      historyDetailLoad: vi.fn().mockResolvedValue(null),
      historyDetailSave: vi.fn().mockResolvedValue(true),
      historyDetailDelete: vi.fn().mockResolvedValue(true),
      historyDetailPrune: pruneSpy,
      historyDetailClearAll: vi.fn().mockResolvedValue(true),
    };
    localStorage.setItem("history_detail_orphan", "{\"logs\":[\"x\"]}");

    saveHistory([createRecord("keep")]);
    await flushMicrotasks();

    expect(pruneSpy).toHaveBeenCalledWith(["keep"]);
    expect(localStorage.getItem("history_detail_orphan")).toBeNull();
  });

  it("delegates clear-all to disk cache IPC when clearing history", async () => {
    const clearSpy = vi.fn().mockResolvedValue(true);
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = {
      historyDetailLoad: vi.fn().mockResolvedValue(null),
      historyDetailSave: vi.fn().mockResolvedValue(true),
      historyDetailDelete: vi.fn().mockResolvedValue(true),
      historyDetailPrune: vi.fn().mockResolvedValue(true),
      historyDetailClearAll: clearSpy,
    };

    clearHistory();
    await flushMicrotasks();

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("loads detail from disk cache API when available", async () => {
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = {
      historyDetailLoad: vi.fn().mockResolvedValue({
        logs: ["api-log"],
        triggers: [{ type: "warning_quality", block: 1, message: "x" }],
        llamaLogs: ["llama"],
      }),
      historyDetailSave: vi.fn().mockResolvedValue(true),
      historyDetailDelete: vi.fn().mockResolvedValue(true),
      historyDetailPrune: vi.fn().mockResolvedValue(true),
      historyDetailClearAll: vi.fn().mockResolvedValue(true),
    };

    const detail = await loadRecordDetail("disk-1");

    expect(detail.logs).toEqual(["api-log"]);
    expect(detail.llamaLogs).toEqual(["llama"]);
    expect(detail.triggers).toHaveLength(1);
  });

  it("retries disk detail load after initial null response instead of negative-caching", async () => {
    const loadSpy = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        logs: ["recovered-log"],
        triggers: [],
        llamaLogs: [],
      });
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = {
      historyDetailLoad: loadSpy,
      historyDetailSave: vi.fn().mockResolvedValue(true),
      historyDetailDelete: vi.fn().mockResolvedValue(true),
      historyDetailPrune: vi.fn().mockResolvedValue(true),
      historyDetailClearAll: vi.fn().mockResolvedValue(true),
    };

    const first = await loadRecordDetail("retryable-detail-1");
    const second = await loadRecordDetail("retryable-detail-1");

    expect(first.logs).toEqual([]);
    expect(second.logs).toEqual(["recovered-log"]);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it("saveHistory coalesces prune requests and keeps only latest allowed id set", async () => {
    const pruneSpy = vi.fn().mockResolvedValue(true);
    const g = globalThis as { window?: any };
    g.window = g.window || (globalThis as any);
    g.window.api = {
      historyDetailLoad: vi.fn().mockResolvedValue(null),
      historyDetailSave: vi.fn().mockResolvedValue(true),
      historyDetailDelete: vi.fn().mockResolvedValue(true),
      historyDetailPrune: pruneSpy,
      historyDetailClearAll: vi.fn().mockResolvedValue(true),
    };

    saveHistory([createRecord("old-id")]);
    saveHistory([createRecord("new-id")]);
    await flushMicrotasks();

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["new-id"]);
  });
});
