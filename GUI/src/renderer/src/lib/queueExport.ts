import type { QueueItem, FileConfig } from "../types/common";

export const QUEUE_EXPORT_VERSION = 1;

export interface QueueExportItem {
  path: string;
  fileName?: string;
  fileType?: QueueItem["fileType"];
  addedAt?: string;
  config?: FileConfig;
}

export interface QueueExport {
  version: number;
  exportedAt: string;
  appVersion?: string;
  queue: QueueExportItem[];
}

export const buildQueueExport = (
  queue: QueueItem[],
  appVersion: string,
): QueueExport => ({
  version: QUEUE_EXPORT_VERSION,
  exportedAt: new Date().toISOString(),
  appVersion,
  queue: queue.map((item) => ({
    path: item.path,
    fileName: item.fileName,
    fileType: item.fileType,
    addedAt: item.addedAt,
    config: item.config,
  })),
});

export const parseQueueExport = (raw: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "Invalid queue export" };
  }

  const data = parsed as Partial<QueueExport> & {
    queue?: unknown;
  };

  if (typeof data.version !== "number") {
    return { error: "Missing version" };
  }
  if (data.version !== QUEUE_EXPORT_VERSION) {
    return { error: `Unsupported version: ${data.version}` };
  }
  if (!Array.isArray(data.queue)) {
    return { error: "Missing queue" };
  }

  const cleaned: QueueExportItem[] = [];
  data.queue.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const value = item as QueueExportItem;
    if (!value.path || typeof value.path !== "string") return;
    cleaned.push({
      path: value.path,
      fileName: value.fileName,
      fileType: value.fileType,
      addedAt: value.addedAt,
      config: value.config,
    });
  });

  if (cleaned.length === 0) {
    return { error: "Empty queue" };
  }

  return {
    exportData: {
      version: data.version,
      exportedAt: data.exportedAt || new Date().toISOString(),
      appVersion: data.appVersion,
      queue: cleaned,
    } as QueueExport,
  };
};
