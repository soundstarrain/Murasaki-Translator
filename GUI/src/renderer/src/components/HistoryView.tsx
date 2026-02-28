import { useState, useEffect } from "react";
import {
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  CheckCircle,
  XCircle,
  Copy,
  RotateCw,
  Download,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Tooltip } from "./ui/core";
import { Button } from "./ui/core";
import { AlertModal } from "./ui/AlertModal";
import { translations, Language } from "../lib/i18n";
import { emitToast } from "../lib/toast";
import {
  FileConfig,
  QueueItem,
  generateId,
  getFileType,
} from "../types/common";
import { persistLibraryQueue } from "../lib/libraryQueueStorage";

// ============================================================================
// Types - Translation History Data Structures
// ============================================================================

/**
 * Trigger event recorded when quality control features activate during translation.
 * These events help diagnose translation quality issues.
 */
export interface TriggerEvent {
  /** ISO timestamp when the event occurred */
  time: string;
  /** Type of trigger event */
  type:
    | "empty_retry"
    | "rep_penalty_increase"
    | "line_mismatch"
    | "anchor_missing"
    | "provider_error"
    | "parse_fallback"
    | "kana_residue"
    | "hangeul_residue"
    | "high_similarity"
    | "glossary_missed"
    | "warning_line_mismatch"
    | "warning_kana_residue"
    | "warning_hangeul_residue"
    | "warning_high_similarity"
    | "warning_glossary_missed"
    | "warning_quality";
  /** Block number where the event occurred (0 if not applicable) */
  block: number;
  /** Source line number where the event occurred (if available) */
  line?: number;
  /** Human-readable message describing the event */
  message: string;
}

/**
 * Complete record of a translation task, including configuration, statistics, and logs.
 * Stored in localStorage and displayed in the History view.
 */
type HistoryConfig = Omit<FileConfig, "ctxSize" | "contextSize"> & {
  ctxSize?: number | string;
  contextSize?: number | string;
  chunkSize?: number | string;
  modelPath?: string;
  rulesPre?: any[];
  rulesPost?: any[];
  textProtect?: boolean;
  protectPatterns?: string;
};

export interface TranslationRecord {
  /** Unique identifier (timestamp-based) */
  id: string;
  /** Input file name (without path) */
  fileName: string;
  /** Full path to input file */
  filePath: string;
  /** Output file path (if available) */
  outputPath?: string;
  /** Cache file path for proofreading (if available) */
  cachePath?: string;
  /** Model name used for translation */
  modelName?: string;
  /** ISO timestamp when translation started */
  startTime: string;
  /** ISO timestamp when translation ended */
  endTime?: string;
  /** Duration in seconds */
  duration?: number;
  /** Translation status */
  status: "completed" | "failed" | "interrupted" | "running";
  /** Total number of blocks to translate */
  totalBlocks: number;
  /** Number of completed blocks */
  completedBlocks: number;
  /** Total lines translated */
  totalLines: number;
  /** Total characters processed */
  totalChars?: number;
  /** Source text line count */
  sourceLines?: number;
  /** Source text character count */
  sourceChars?: number;
  /** Average translation speed (output chars/sec) */
  avgSpeed?: number;
  /** 执行模式：local（本地直连）/ remote-api（远程链路） */
  executionMode?: "local" | "remote-api";
  /** 远程连接信息（仅远程模式） */
  remoteInfo?: {
    serverUrl: string;
    source: string; // "manual" | "local-daemon"
    taskId?: string;
    model?: string;
    serverVersion?: string;
  };
  /** Configuration used for this translation (may be partial for old records) */
  config?: HistoryConfig;
  /** Trigger events recorded during translation */
  triggers: TriggerEvent[];
  /** Log lines (last 100 kept) */
  logs: string[];
  /** llama 引擎日志（可选） */
  llamaLogs?: string[];

  // === V2 Pipeline 专有字段 ===
  /** 引擎版本：v1 本地推理 / v2 API Pipeline */
  engineVersion?: "v1" | "v2";
  /** V2 Pipeline 配置信息 */
  v2Config?: {
    pipelineId: string;
    pipelineName: string;
    providerName?: string;
    promptName?: string;
    parserName?: string;
    chunkType?: "line" | "block" | "legacy";
  };
  /** V2 API 统计（仅 V2 模式） */
  v2Stats?: {
    totalRequests: number;
    totalRetries: number;
    totalErrors: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    errorStatusCodes?: Record<string, number>;
  };
}

// ============================================================================
// Storage Functions - localStorage-based history management
// ============================================================================

const AUTO_START_QUEUE_KEY = "murasaki_auto_start_queue";
const CONFIG_SYNC_KEY = "murasaki_pending_config_sync";

interface HistoryViewProps {
  lang: Language;
  onNavigate?: (view: string) => void;
}

/** Maximum number of history records to keep */
const MAX_HISTORY_RECORDS = 50;
const HISTORY_STORAGE_KEY = "translation_history";
const HISTORY_BACKUP_STORAGE_KEY = "translation_history_backup";

/** Storage key prefix for record details */
const DETAIL_KEY_PREFIX = "history_detail_";

/** Record detail containing heavy data - stored separately for lazy loading */
export interface RecordDetail {
  logs: string[];
  triggers: TriggerEvent[];
  llamaLogs: string[];
}

const detailMemoryCache = new Map<string, RecordDetail>();
const detailLoadedIds = new Set<string>();
let detailPruneRequestSeq = 0;
let detailPruneQueue: Promise<void> = Promise.resolve();

const createEmptyRecordDetail = (): RecordDetail => ({
  logs: [],
  triggers: [],
  llamaLogs: [],
});

const hasDetailContent = (detail: RecordDetail): boolean =>
  detail.logs.length > 0 ||
  detail.triggers.length > 0 ||
  detail.llamaLogs.length > 0;

const normalizeRecordDetail = (raw: unknown): RecordDetail => {
  const detail =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const normalizeLines = (value: unknown) =>
    Array.isArray(value) ? value.map((line) => String(line ?? "")) : [];
  const normalizeTriggers = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((item) => item && typeof item === "object")
          .map((item) => item as TriggerEvent)
      : [];
  return {
    logs: normalizeLines(detail.logs),
    triggers: normalizeTriggers(detail.triggers),
    llamaLogs: normalizeLines(detail.llamaLogs),
  };
};

const getHistoryDetailApi = () => {
  if (typeof window === "undefined") return null;
  const api = window.api;
  if (
    !api ||
    typeof api.historyDetailLoad !== "function" ||
    typeof api.historyDetailSave !== "function" ||
    typeof api.historyDetailDelete !== "function" ||
    typeof api.historyDetailPrune !== "function" ||
    typeof api.historyDetailClearAll !== "function"
  ) {
    return null;
  }
  return api;
};

const collectDetailStorageKeys = (): string[] => {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DETAIL_KEY_PREFIX)) {
        keys.push(key);
      }
    }
  } catch {
    // Ignore storage iteration failures.
  }
  return keys;
};

const pruneLegacyDetailStorage = (allowedIds: Set<string>) => {
  const keys = collectDetailStorageKeys();
  for (const key of keys) {
    const id = key.slice(DETAIL_KEY_PREFIX.length);
    if (!allowedIds.has(id)) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
};

const toLightweightRecords = (
  records: TranslationRecord[],
): TranslationRecord[] =>
  records.map((r) => {
    const { logs, triggers, llamaLogs, ...basic } = r as TranslationRecord & {
      logs?: string[];
      triggers?: TriggerEvent[];
      llamaLogs?: string[];
    };
    return { ...basic, logs: [], triggers: [], llamaLogs: [] };
  });

const parseHistoryPayload = (raw: string): TranslationRecord[] | null => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return toLightweightRecords(parsed as TranslationRecord[]);
  } catch {
    return null;
  }
};

/**
 * Retrieves all translation history records from localStorage (lightweight, no logs/triggers).
 * @returns Array of TranslationRecord objects without logs/triggers for fast loading
 */
export const getHistory = (): TranslationRecord[] => {
  const data = localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!data) return [];

  const primary = parseHistoryPayload(data);
  if (primary) {
    return primary;
  }

  const backup = localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY);
  const fallback = backup ? parseHistoryPayload(backup) : null;
  if (fallback) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(fallback));
    } catch {
      // Ignore recovery write failures.
    }
    return fallback;
  }

  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
  return [];
};

/**
 * Lazily loads record detail (logs and triggers) by ID.
 * @param id - Record ID
 * @returns RecordDetail or null if not found
 */
const readLegacyRecordDetail = (id: string): RecordDetail => {
  try {
    const data = localStorage.getItem(`${DETAIL_KEY_PREFIX}${id}`);
    if (data) return normalizeRecordDetail(JSON.parse(data));
  } catch {
    // Ignore legacy detail parse failures.
  }
  try {
    const historyRaw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (historyRaw) {
      const records = JSON.parse(historyRaw) as (TranslationRecord & {
        logs?: string[];
        triggers?: TriggerEvent[];
        llamaLogs?: string[];
      })[];
      const record = records.find((r) => r.id === id);
      if (
        record &&
        (record.logs?.length ||
          record.triggers?.length ||
          record.llamaLogs?.length)
      ) {
        return normalizeRecordDetail({
          logs: record.logs || [],
          triggers: record.triggers || [],
          llamaLogs: record.llamaLogs || [],
        });
      }
    }
  } catch {
    // Ignore legacy migration payload failures.
  }
  return createEmptyRecordDetail();
};

/**
 * Lazily loads record detail (logs and triggers) by ID.
 * @param id - Record ID
 * @returns RecordDetail or null if not found
 */
export const getRecordDetail = (id: string): RecordDetail | null => {
  const cached = detailMemoryCache.get(id);
  if (cached) return cached;
  const legacy = readLegacyRecordDetail(id);
  if (hasDetailContent(legacy)) {
    detailMemoryCache.set(id, legacy);
    return legacy;
  }
  return createEmptyRecordDetail();
};

/**
 * Async detail loader: prefer disk cache (Electron IPC), fallback to legacy localStorage.
 */
export const loadRecordDetail = async (id: string): Promise<RecordDetail> => {
  const cached = detailMemoryCache.get(id);
  if (cached) return cached;
  if (detailLoadedIds.has(id)) return createEmptyRecordDetail();
  const api = getHistoryDetailApi();
  if (api) {
    try {
      const raw = await api.historyDetailLoad(id);
      if (raw) {
        const normalized = normalizeRecordDetail(raw);
        detailLoadedIds.add(id);
        if (hasDetailContent(normalized)) {
          detailMemoryCache.set(id, normalized);
        }
        return normalized;
      }
    } catch (e) {
      console.error("Failed to load record detail from disk cache:", e);
    }
  }
  const legacy = readLegacyRecordDetail(id);
  if (hasDetailContent(legacy)) {
    detailLoadedIds.add(id);
    detailMemoryCache.set(id, legacy);
    if (api) {
      void (async () => {
        try {
          await api.historyDetailSave(id, legacy);
          localStorage.removeItem(`${DETAIL_KEY_PREFIX}${id}`);
        } catch {
          // Best-effort migration.
        }
      })();
    }
  } else if (!api) {
    // Browser/unit-test path without disk cache API: avoid repeated legacy scans.
    detailLoadedIds.add(id);
  }
  return legacy;
};

const saveLegacyRecordDetail = (id: string, detail: RecordDetail) => {
  try {
    localStorage.setItem(`${DETAIL_KEY_PREFIX}${id}`, JSON.stringify(detail));
  } catch (e) {
    console.error("Failed to save record detail:", e);
  }
};

const deleteLegacyRecordDetail = (id: string) => {
  try {
    localStorage.removeItem(`${DETAIL_KEY_PREFIX}${id}`);
  } catch {
    // Ignore local cleanup failures.
  }
};

/**
 * Saves record detail separately from main history.
 */
const saveRecordDetail = async (id: string, detail: RecordDetail) => {
  const normalized = normalizeRecordDetail(detail);
  if (!hasDetailContent(normalized)) {
    detailMemoryCache.delete(id);
    detailLoadedIds.add(id);
    const api = getHistoryDetailApi();
    if (api) {
      try {
        await api.historyDetailDelete(id);
      } catch (e) {
        console.error("Failed to delete empty record detail from disk cache:", e);
      }
    }
    deleteLegacyRecordDetail(id);
    return;
  }

  detailMemoryCache.set(id, normalized);
  detailLoadedIds.add(id);
  const api = getHistoryDetailApi();
  if (api) {
    try {
      const ok = await api.historyDetailSave(id, normalized);
      if (ok) {
        deleteLegacyRecordDetail(id);
        return;
      }
    } catch (e) {
      console.error("Failed to save record detail to disk cache:", e);
    }
  }
  saveLegacyRecordDetail(id, normalized);
};

const pruneDetailStorage = async (
  allowedIds: Set<string>,
  isStale: () => boolean = () => false,
) => {
  for (const id of Array.from(detailMemoryCache.keys())) {
    if (isStale()) return;
    if (!allowedIds.has(id)) {
      detailMemoryCache.delete(id);
      detailLoadedIds.delete(id);
    }
  }
  if (isStale()) return;
  pruneLegacyDetailStorage(allowedIds);
  if (isStale()) return;
  const api = getHistoryDetailApi();
  if (api) {
    if (isStale()) return;
    try {
      await api.historyDetailPrune(Array.from(allowedIds));
    } catch (e) {
      console.error("Failed to prune disk cached record details:", e);
    }
  }
};

const schedulePruneDetailStorage = (allowedIds: Set<string>) => {
  const requestSeq = ++detailPruneRequestSeq;
  const snapshot = new Set(allowedIds);
  detailPruneQueue = detailPruneQueue
    .catch(() => {
      // Keep queue alive after failures.
    })
    .then(async () => {
      if (requestSeq !== detailPruneRequestSeq) return;
      await pruneDetailStorage(
        snapshot,
        () => requestSeq !== detailPruneRequestSeq,
      );
    });
  return detailPruneQueue;
};

const deleteRecordDetail = async (id: string) => {
  detailMemoryCache.delete(id);
  detailLoadedIds.add(id);
  const api = getHistoryDetailApi();
  if (api) {
    try {
      await api.historyDetailDelete(id);
    } catch (e) {
      console.error("Failed to delete disk cached record detail:", e);
    }
  }
  deleteLegacyRecordDetail(id);
};

const clearDetailStorage = async () => {
  detailMemoryCache.clear();
  detailLoadedIds.clear();
  const detailKeys = collectDetailStorageKeys();
  detailKeys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore local cleanup failures.
    }
  });
  const api = getHistoryDetailApi();
  if (api) {
    try {
      await api.historyDetailClearAll();
    } catch (e) {
      console.error("Failed to clear disk cached record details:", e);
    }
  }
};

/**
 * Saves translation history to localStorage (lightweight records only).
 * @param records - Array of records to save (will be trimmed to last MAX_HISTORY_RECORDS)
 */
export const saveHistory = (records: TranslationRecord[]) => {
  const trimmed = records.slice(-MAX_HISTORY_RECORDS);
  const lightweight = toLightweightRecords(trimmed);
  const serialized = JSON.stringify(lightweight);
  localStorage.setItem(HISTORY_STORAGE_KEY, serialized);
  localStorage.setItem(HISTORY_BACKUP_STORAGE_KEY, serialized);
  void schedulePruneDetailStorage(new Set(trimmed.map((record) => record.id)));
};

/**
 * Adds a new record to translation history.
 * @param record - The new translation record to add
 */
export const addRecord = (record: TranslationRecord) => {
  const history = getHistory();
  // Save detail separately
  if (
    record.logs?.length ||
    record.triggers?.length ||
    record.llamaLogs?.length
  ) {
    void saveRecordDetail(record.id, {
      logs: record.logs || [],
      triggers: record.triggers || [],
      llamaLogs: record.llamaLogs || [],
    });
  }
  // Add lightweight record
  history.push({ ...record, logs: [], triggers: [], llamaLogs: [] });
  saveHistory(history);
};

/**
 * Updates an existing record by ID with partial data.
 * @param id - Record ID to update
 * @param updates - Partial record data to merge
 */
export const updateRecord = (
  id: string,
  updates: Partial<TranslationRecord>,
) => {
  const history = getHistory();
  const index = history.findIndex((r) => r.id === id);
  if (index >= 0) {
    // Handle detail data separately
    if (
      "logs" in updates ||
      "triggers" in updates ||
      "llamaLogs" in updates
    ) {
      void (async () => {
        const existingDetail = await loadRecordDetail(id);
        await saveRecordDetail(id, {
          logs: updates.logs ?? existingDetail.logs,
          triggers: updates.triggers ?? existingDetail.triggers,
          llamaLogs: updates.llamaLogs ?? existingDetail.llamaLogs,
        });
      })();
    }
    // Update main record without heavy data
    const { logs, triggers, llamaLogs, ...lightUpdates } =
      updates as Partial<TranslationRecord> & {
        logs?: string[];
        triggers?: TriggerEvent[];
        llamaLogs?: string[];
      };
    history[index] = {
      ...history[index],
      ...lightUpdates,
      logs: [],
      triggers: [],
      llamaLogs: [],
    };
    saveHistory(history);
  }
};

/**
 * Deletes a record by ID (including its detail).
 * @param id - Record ID to delete
 */
export const deleteRecord = (id: string) => {
  const history = getHistory().filter((r) => r.id !== id);
  saveHistory(history);
  void deleteRecordDetail(id);
};

/**
 * Clears all translation history from localStorage.
 */
export const clearHistory = () => {
  void clearDetailStorage();
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  localStorage.removeItem(HISTORY_BACKUP_STORAGE_KEY);
};

// ============================================================================
// Sub-Component - Record Detail Content (avoid Hooks in IIFE)
// ============================================================================

interface RecordDetailContentProps {
  record: TranslationRecord;
  t: (typeof translations)["zh"];
  isLoading: boolean;
  detail: RecordDetail;
  getTriggerTypeLabel: (type: TriggerEvent["type"]) => string;
  onOpenPath: (path: string) => void;
  onOpenFolder: (path: string) => void;
}

function RecordDetailContent({
  record,
  t,
  isLoading,
  detail,
  getTriggerTypeLabel,
  onOpenPath,
  onOpenFolder,
}: RecordDetailContentProps) {
  // Get full record with details
  const fullRecord = {
    ...record,
    logs: detail.logs,
    triggers: detail.triggers,
    llamaLogs: detail.llamaLogs || [],
  };
  const config = fullRecord.config || {};
  const formatMaybe = (value: any, fallback = t.none) =>
    value === undefined || value === null || value === "" ? fallback : value;

  // Trigger events collapse state
  const COLLAPSE_THRESHOLD = 10;
  const shouldCollapse = fullRecord.triggers.length > COLLAPSE_THRESHOLD;
  const [triggersExpanded, setTriggersExpanded] = useState(!shouldCollapse);
  const displayTriggers = triggersExpanded
    ? fullRecord.triggers
    : fullRecord.triggers.slice(0, COLLAPSE_THRESHOLD);
  const v2t = t.historyView.v2;
  const speedUnit = v2t.charsPerSecondUnit;
  const avgSpeedDisplay = Number(fullRecord.avgSpeed || 0).toFixed(1);

  if (isLoading) {
    return (
      <CardContent className="pt-0 border-t">
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2" />
          {t.common.loading}
        </div>
      </CardContent>
    );
  }

  const isV2 = fullRecord.engineVersion === "v2";
  const v2s = fullRecord.v2Stats;
  const v2c = fullRecord.v2Config;

  return (
    <CardContent className="pt-0 border-t">
      <div className="space-y-4 pt-4">
        {/* ========== V2 API 统计面板 ========== */}
        {isV2 ? (
          <>
            {/* Pipeline 信息 */}
            {v2c && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm bg-muted/30 px-3 py-2 rounded-md">
                <span className="text-muted-foreground">
                  {v2t.pipeline}:{" "}
                  <span className="font-medium text-foreground ml-1">
                    {v2c.pipelineName || v2c.pipelineId}
                  </span>
                </span>
                {v2c.providerName && (
                  <span className="text-muted-foreground">
                    {v2t.provider}:{" "}
                    <span className="font-medium text-foreground ml-1">
                      {v2c.providerName}
                    </span>
                  </span>
                )}
                {v2c.chunkType && (
                  <span className="text-muted-foreground">
                    {v2t.mode}:{" "}
                    <span className="font-medium text-foreground ml-1">
                      {v2c.chunkType === "line"
                        ? v2t.modeLine
                        : v2t.modeBlock}
                    </span>
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 翻译统计 */}
              <div className="space-y-3 bg-muted/20 p-3 rounded-lg border border-border/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {v2t.translationProgress}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t.historyView.stats.blocks}
                    </p>
                    <p className="font-medium">
                      {fullRecord.completedBlocks}/{fullRecord.totalBlocks}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t.historyView.stats.lines}
                    </p>
                    <p className="font-medium">
                      {fullRecord.sourceLines || 0}/{fullRecord.totalLines || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t.historyView.stats.chars}
                    </p>
                    <p className="font-medium">
                      {(fullRecord.sourceChars || 0).toLocaleString()}/
                      {(fullRecord.totalChars || 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {t.historyView.stats.speed}
                    </p>
                    <p className="font-medium">
                      {avgSpeedDisplay} {speedUnit}
                    </p>
                  </div>
                </div>
              </div>

              {/* API 请求统计 */}
              {v2s && (
                <div className="space-y-3 bg-muted/20 p-3 rounded-lg border border-border/50">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {v2t.requestTelemetry}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {v2t.requests}
                      </p>
                      <p className="font-medium">
                        {v2s.totalRequests.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t.historyView.stats.retries}
                      </p>
                      <p className="font-medium">
                        {v2s.totalRetries.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {v2t.errors}
                      </p>
                      <p
                        className={`font-medium ${v2s.totalErrors > 0 ? "text-destructive" : ""}`}
                      >
                        {v2s.totalErrors}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {v2t.successRate}
                      </p>
                      <p className="font-medium">
                        {v2s.totalRequests > 0
                          ? (
                              (1 - v2s.totalErrors / v2s.totalRequests) *
                              100
                            ).toFixed(1)
                          : "0"}
                        %
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Token 用量 */}
              {v2s &&
                (v2s.totalInputTokens > 0 || v2s.totalOutputTokens > 0) && (
                  <div className="space-y-3 bg-muted/20 p-3 rounded-lg border border-border/50">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {v2t.tokenUsage}
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {v2t.inputTokens}
                        </p>
                        <p className="font-medium">
                          {v2s.totalInputTokens.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {v2t.outputTokens}
                        </p>
                        <p className="font-medium">
                          {v2s.totalOutputTokens.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
            </div>

            {/* 错误状态码分布 */}
            {v2s?.errorStatusCodes &&
              Object.keys(v2s.errorStatusCodes).length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {v2t.errorStatusCodes}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(v2s.errorStatusCodes)
                      .sort(([, a], [, b]) => b - a)
                      .map(([code, count]) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md px-2.5 py-1"
                        >
                          HTTP {code}:{" "}
                          <span className="font-semibold">
                            {count}
                            {v2t.countSuffix}
                          </span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
          </>
        ) : (
          /* ========== V1 原有统计面板 ========== */
          <>
            {/* Stats */}
            <div className="grid grid-cols-7 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.blocks}
                </p>
                <p className="font-medium">
                  {fullRecord.completedBlocks}/{fullRecord.totalBlocks}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.lines}
                </p>
                <p className="font-medium">
                  {fullRecord.sourceLines || 0}/{fullRecord.totalLines || 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.chars}
                </p>
                <p className="font-medium">
                  {(fullRecord.sourceChars || 0).toLocaleString()}/
                  {(fullRecord.totalChars || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.speed}
                </p>
                <p className="font-medium">
                  {avgSpeedDisplay} {speedUnit}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.concurrency}
                </p>
                <p className="font-medium">{config.concurrency ?? 1}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.temperature}
                </p>
                <p className="font-medium">
                  {formatMaybe(config.temperature, "-")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  {t.historyView.stats.retries}
                </p>
                <p className="font-medium">
                  {
                    fullRecord.triggers.filter(
                      (tr) =>
                        tr.type === "empty_retry" ||
                        tr.type === "line_mismatch" ||
                        tr.type === "anchor_missing" ||
                        tr.type === "rep_penalty_increase" ||
                        tr.type === "glossary_missed",
                    ).length
                  }
                </p>
              </div>
            </div>

            {/* Model Info */}
            {fullRecord.modelName && (
              <p className="text-xs text-muted-foreground">
                {t.historyView.labels.model}{" "}
                <span className="font-medium text-foreground">
                  {fullRecord.modelName}
                </span>
              </p>
            )}
          </>
        )}

        {/* Triggers - Collapsible */}
        {fullRecord.triggers.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t.advancedView.validationRules} ({fullRecord.triggers.length})
            </p>
            <div className="space-y-1">
              {displayTriggers.map((tr, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs bg-secondary/50 rounded px-2 py-1"
                >
                  <span className="text-muted-foreground">
                    {typeof tr.line === "number" && tr.line > 0
                      ? `[${t.historyView.stats.lines} ${tr.line}]`
                      : `[${t.historyView.stats.blocks} ${tr.block}]`}
                  </span>
                  <span className="font-medium">
                    {getTriggerTypeLabel(tr.type)}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {tr.message}
                  </span>
                </div>
              ))}
            </div>
            {shouldCollapse && (
              <button
                onClick={() => setTriggersExpanded(!triggersExpanded)}
                className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
              >
                {triggersExpanded ? (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    {t.common.collapse}
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3" />
                    {t.historyView.showAllTriggers.replace(
                      "{count}",
                      fullRecord.triggers.length.toString(),
                    )}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Logs */}
        {fullRecord.logs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t.historyView.logsCount.replace(
                "{count}",
                fullRecord.logs.length.toString(),
              )}
            </p>
            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3 max-h-80 overflow-y-auto font-mono text-xs text-slate-700 dark:text-slate-300 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 border border-slate-200 dark:border-slate-800">
              {fullRecord.logs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Llama Logs */}
        {fullRecord.llamaLogs && fullRecord.llamaLogs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t.historyView.llamaLogsCount.replace(
                "{count}",
                fullRecord.llamaLogs.length.toString(),
              )}
            </p>
            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3 max-h-80 overflow-y-auto font-mono text-xs text-slate-700 dark:text-slate-300 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 border border-slate-200 dark:border-slate-800">
              {fullRecord.llamaLogs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Paths */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="w-16 shrink-0">
              {t.historyView.labels.sourceFile}
            </span>
            <span className="truncate flex-1">{fullRecord.filePath}</span>
            <Tooltip content={t.historyView.labels.openFile}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => onOpenPath(fullRecord.filePath)}
              >
                <ExternalLink className="w-3 h-3" />
              </Button>
            </Tooltip>
            <Tooltip content={t.historyView.labels.openFolder}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => {
                  const folderPath = fullRecord.filePath.substring(
                    0,
                    Math.max(
                      fullRecord.filePath.lastIndexOf("\\"),
                      fullRecord.filePath.lastIndexOf("/"),
                    ),
                  );
                  onOpenFolder(folderPath);
                }}
              >
                <FolderOpen className="w-3 h-3" />
              </Button>
            </Tooltip>
          </div>
          {fullRecord.outputPath && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-16 shrink-0">
                {t.historyView.labels.outputFile}
              </span>
              <span className="truncate flex-1">{fullRecord.outputPath}</span>
              <Tooltip content={t.historyView.labels.openFile}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => onOpenPath(fullRecord.outputPath!)}
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </Tooltip>
              <Tooltip content={t.historyView.labels.openFolder}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => {
                    const folderPath = fullRecord.outputPath!.substring(
                      0,
                      Math.max(
                        fullRecord.outputPath!.lastIndexOf("\\"),
                        fullRecord.outputPath!.lastIndexOf("/"),
                      ),
                    );
                    onOpenFolder(folderPath);
                  }}
                >
                  <FolderOpen className="w-3 h-3" />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </CardContent>
  );
}

// ============================================================================
// Component - Translation History View
// ============================================================================

/**
 * History view component displaying all past translation records.
 * Features: expandable cards, detailed logs, trigger events, statistics.
 */
export function HistoryView({ lang, onNavigate }: HistoryViewProps) {
  const t = translations[lang];
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  // Lazy loading state for record details
  const [detailsCache, setDetailsCache] = useState<
    Record<string, RecordDetail>
  >({});
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);

  useEffect(() => {
    setRecords(getHistory().reverse()); // Show newest first
  }, []);

  const handleOpenPath = async (path: string) => {
    if (!path) {
      setPathError(t.historyView.openFailDesc);
      return;
    }
    try {
      const result = await window.api?.openPath?.(path);
      if (result) {
        setPathError(`${t.historyView.openFailDesc} ${result}`);
      }
    } catch (e) {
      setPathError(`${t.historyView.openFailDesc} ${String(e)}`);
    }
  };

  const handleOpenFolder = async (path: string) => {
    if (!path) {
      setPathError(t.historyView.openFailDesc);
      return;
    }
    try {
      const ok = await window.api?.openFolder?.(path);
      if (!ok) {
        setPathError(t.historyView.openFailDesc);
      }
    } catch (e) {
      setPathError(`${t.historyView.openFailDesc} ${String(e)}`);
    }
  };

  // Handle card expansion - load details lazily
  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    // Load details if not cached
    if (!detailsCache[id]) {
      setLoadingDetails(id);
      try {
        const detail = await loadRecordDetail(id);
        setDetailsCache((prev) => ({ ...prev, [id]: detail }));
      } catch (e) {
        console.error("Failed to load history detail:", e);
      } finally {
        setLoadingDetails(null);
      }
    }
  };

  const handleDelete = (id: string) => {
    deleteRecord(id);
    setRecords(records.filter((r) => r.id !== id));
    setDetailsCache((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expandedId === id) {
      setExpandedId(null);
    }
  };

  const handleClearAll = () => {
    setAlertOpen(true);
  };

  const handleConfirmClear = () => {
    clearHistory();
    setRecords([]);
    setDetailsCache({});
    setExpandedId(null);
  };

  const applyHistoryConfig = (
    record: TranslationRecord,
    options?: { silent?: boolean },
  ) => {
    const config = record.config;
    if (!config) {
      emitToast({
        variant: "warning",
        message: t.historyView.applyConfigEmpty,
      });
      return false;
    }

    const setString = (key: string, value?: string) => {
      if (value !== undefined) localStorage.setItem(key, String(value));
    };
    const setNumber = (key: string, value?: number) => {
      if (value !== undefined && Number.isFinite(value)) {
        localStorage.setItem(key, String(value));
      }
    };
    const setBool = (key: string, value?: boolean) => {
      if (value !== undefined) localStorage.setItem(key, String(value));
    };

    const modelPath =
      (config as any).modelPath || config.model || record.modelName;
    if (modelPath) localStorage.setItem("config_model", modelPath);
    if (config.remoteModel) {
      localStorage.setItem("config_remote_model", config.remoteModel);
    }

    setString("config_output_dir", config.outputDir);
    setString("config_glossary_path", config.glossaryPath);
    setString("config_preset", config.preset);

    setNumber("config_gpu", config.gpuLayers);
    if (config.ctxSize !== undefined) {
      localStorage.setItem("config_ctx", String(config.ctxSize));
    }
    setNumber("config_concurrency", config.concurrency);
    setBool("config_flash_attn", config.flashAttn);
    setString("config_kv_cache_type", config.kvCacheType);
    setBool("config_use_large_batch", config.useLargeBatch);
    setNumber("config_physical_batch_size", config.physicalBatchSize);
    if (config.seed !== undefined) {
      localStorage.setItem("config_seed", String(config.seed));
    }

    setString("config_device_mode", config.deviceMode);
    setString("config_gpu_device_id", config.gpuDeviceId);

    setNumber("config_temperature", config.temperature);
    setBool("config_line_check", config.lineCheck);
    setNumber("config_line_tolerance_abs", config.lineToleranceAbs);
    setNumber("config_line_tolerance_pct", config.lineTolerancePct);
    setBool("config_anchor_check", config.anchorCheck);
    setNumber("config_anchor_check_retries", config.anchorCheckRetries);
    setNumber("config_rep_penalty_base", config.repPenaltyBase);
    setNumber("config_rep_penalty_max", config.repPenaltyMax);
    setNumber("config_rep_penalty_step", config.repPenaltyStep);
    setNumber("config_max_retries", config.maxRetries);
    setString("config_strict_mode", config.strictMode);

    setBool("config_balance_enable", config.balanceEnable);
    setNumber("config_balance_threshold", config.balanceThreshold);
    setNumber("config_balance_count", config.balanceCount);

    setNumber("config_retry_temp_boost", config.retryTempBoost);
    setBool("config_retry_prompt_feedback", config.retryPromptFeedback);

    setBool("config_coverage_check", config.coverageCheck);
    setNumber("config_output_hit_threshold", config.outputHitThreshold);
    setNumber("config_cot_coverage_threshold", config.cotCoverageThreshold);
    setNumber("config_coverage_retries", config.coverageRetries);

    setBool("config_alignment_mode", config.alignmentMode);
    setBool("config_save_cot", config.saveCot);
    setBool("config_resume", config.resume);
    setBool("config_daemon_mode", config.daemonMode);

    setString("config_cache_dir", config.cacheDir);

    const rulesPre = (config as any).rulesPre;
    if (Array.isArray(rulesPre)) {
      localStorage.setItem("config_rules_pre", JSON.stringify(rulesPre));
    }
    const rulesPost = (config as any).rulesPost;
    if (Array.isArray(rulesPost)) {
      localStorage.setItem("config_rules_post", JSON.stringify(rulesPost));
    }

    localStorage.setItem(CONFIG_SYNC_KEY, Date.now().toString());

    if (!options?.silent) {
      emitToast({
        variant: "success",
        message: t.historyView.applyConfigDone,
      });
    }
    return true;
  };

  const handleRerun = (record: TranslationRecord) => {
    const ok = applyHistoryConfig(record, { silent: true });
    if (!ok) return;

    let queue: QueueItem[] = [];
    try {
      const saved = localStorage.getItem("library_queue");
      if (saved) queue = JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load queue:", e);
    }

    if (queue.some((q) => q.path === record.filePath)) {
      emitToast({
        variant: "warning",
        message: t.historyView.rerunAlreadyQueued,
      });
      return;
    }

    const item: QueueItem = {
      id: generateId(),
      path: record.filePath,
      fileName: record.fileName || record.filePath.split(/[/\\]/).pop() || "",
      fileType: getFileType(record.filePath),
      addedAt: new Date().toISOString(),
      status: "pending",
      config: { useGlobalDefaults: true },
    };
    const nextQueue = [...queue, item];
    persistLibraryQueue(nextQueue);
    localStorage.setItem(AUTO_START_QUEUE_KEY, "true");
    localStorage.setItem(CONFIG_SYNC_KEY, Date.now().toString());

    emitToast({
      variant: "success",
      message: t.historyView.rerunQueued,
    });
    onNavigate?.("dashboard");
  };

  /**
   * Export detailed log for a specific record as text file
   */
  const handleExportLog = async (record: TranslationRecord) => {
    // Lazy load details for export
    const detail =
      detailsCache[record.id] || (await loadRecordDetail(record.id));
    setDetailsCache((prev) => ({ ...prev, [record.id]: detail }));
    const fullRecord = {
      ...record,
      logs: detail.logs,
      triggers: detail.triggers,
      llamaLogs: detail.llamaLogs || [],
    };
    const config = fullRecord.config || {};
    const formatMaybe = (value: any, fallback = t.none) =>
      value === undefined || value === null || value === "" ? fallback : value;

    const e = t.historyView.export;
    const lines = [
      e.title,
      ``,
      e.basic,
      `${e.fileName} ${fullRecord.fileName}`,
      `${e.filePath} ${fullRecord.filePath}`,
      `${e.modelName} ${fullRecord.modelName || (lang === "en" ? "Not recorded" : t.none)}`,
      `${e.startTime} ${fullRecord.startTime}`,
      `${e.endTime} ${fullRecord.endTime || (lang === "en" ? "Incomplete" : t.none)}`,
      `${e.duration} ${formatDuration(fullRecord.duration)}`,
      `${e.status} ${fullRecord.status}`,
      ``,
      e.statsTitle,
      ``,
      e.sourceTitle,
      `${e.lines} ${fullRecord.sourceLines || (lang === "en" ? "Not recorded" : t.none)}`,
      `${e.chars} ${fullRecord.sourceChars || (lang === "en" ? "Not recorded" : t.none)}`,
      ``,
      e.outputTitle,
      `${e.blocks} ${fullRecord.completedBlocks}/${fullRecord.totalBlocks}`,
      `${e.lines} ${fullRecord.totalLines || 0}`,
      `${e.chars} ${fullRecord.totalChars || 0}`,
      `${e.avgSpeed} ${Number(fullRecord.avgSpeed || 0).toFixed(1)} ${lang === "en" ? "chars/s" : t.dashboard.charPerSec}`,
      ``,
      e.configTitle,
      `${e.temp} ${formatMaybe(config.temperature)}`,
      `${e.lineCheck} ${
        config.lineCheck === undefined
          ? t.none
          : config.lineCheck
            ? t.historyView.toggleOn
            : t.historyView.toggleOff
      }`,
      `${e.repPenalty} ${formatMaybe(config.repPenaltyBase)}`,
      `${e.maxRetries} ${formatMaybe(config.maxRetries)}`,
      `${e.concurrency} ${formatMaybe(config.concurrency ?? 1)}`,
      ``,
    ];

    if (fullRecord.executionMode === "remote-api" && fullRecord.remoteInfo) {
      const sourceLabel =
        fullRecord.remoteInfo.source === "local-daemon"
          ? t.historyView.remoteSourceLocal
          : t.historyView.remoteSourceRemote;

      lines.push(
        t.historyView.remoteTitle,
        `${t.historyView.remoteServerLabel} ${fullRecord.remoteInfo.serverUrl}`,
        `${t.historyView.remoteSourceLabel} ${sourceLabel}`,
      );
      if (fullRecord.remoteInfo.taskId) {
        lines.push(
          `${t.historyView.remoteTaskLabel} ${fullRecord.remoteInfo.taskId}`,
        );
      }
      if (fullRecord.remoteInfo.model) {
        lines.push(
          `${t.historyView.remoteModelLabel} ${fullRecord.remoteInfo.model}`,
        );
      }
      if (fullRecord.remoteInfo.serverVersion) {
        lines.push(
          `${t.historyView.remoteVersionLabel} ${fullRecord.remoteInfo.serverVersion}`,
        );
      }
      lines.push(``);
    }

    if (fullRecord.triggers.length > 0) {
      lines.push(
        e.triggersTitle.replace(
          "{count}",
          fullRecord.triggers.length.toString(),
        ),
      );
      fullRecord.triggers.forEach((tr, i) => {
        const location =
          typeof tr.line === "number" && tr.line > 0
            ? `${t.historyView.stats.lines} ${tr.line}`
            : `${t.historyView.stats.blocks} ${tr.block}`;
        lines.push(
          `${i + 1}. [${location}] ${getTriggerTypeLabel(tr.type)} - ${tr.message}`,
        );
      });
      lines.push(``);
    }

    if (fullRecord.logs.length > 0) {
      lines.push(
        e.logsTitle.replace("{count}", fullRecord.logs.length.toString()),
      );
      lines.push("```");
      fullRecord.logs.forEach((log) => lines.push(log));
      lines.push("```");
    }

    if (fullRecord.llamaLogs && fullRecord.llamaLogs.length > 0) {
      lines.push(
        e.llamaLogsTitle.replace(
          "{count}",
          fullRecord.llamaLogs.length.toString(),
        ),
      );
      lines.push("```");
      fullRecord.llamaLogs.forEach((log) => lines.push(log));
      lines.push("```");
    }

    const content = lines.join("\n");
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${record.fileName}_log_${record.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    emitToast({ variant: "success", message: t.historyView.exportLogDone });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const locale = lang === "en" ? "en-US" : lang === "jp" ? "ja-JP" : "zh-CN";
    return d.toLocaleString(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return "-";
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  };

  const getStatusIcon = (status: TranslationRecord["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "interrupted":
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case "running":
        return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />;
    }
  };

  const getTriggerTypeLabel = (type: TriggerEvent["type"]) => {
    const labels = t.historyView.triggerLabels;
    return labels[type] || type;
  };

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Clock className="w-6 h-6 text-primary" />
            {t.historyView.title}
          </h2>
          {records.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="text-red-500 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t.historyView.clearAll}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {t.historyView.subtitle}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8 scrollbar-thin scrollbar-thumb-border">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-muted-foreground animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 rounded-full bg-secondary/50 flex items-center justify-center mb-6 ring-8 ring-secondary/20">
              <FileText className="w-10 h-10 opacity-20" />
            </div>
            <p className="text-lg font-medium opacity-40 italic">
              {t.historyView.noHistory}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {records.map((record) => (
              <Card key={record.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(record.status)}
                      <div>
                        <CardTitle className="text-base font-medium flex items-center gap-2">
                          {record.fileName}
                          {record.executionMode === "remote-api" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-normal">
                              {record.remoteInfo?.source === "local-daemon"
                                ? t.historyView.remoteSourceLocal
                                : t.historyView.remoteSourceRemote}
                            </span>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(record.startTime)} ·{" "}
                          {formatDuration(record.duration)}
                          {record.remoteInfo?.serverUrl && (
                            <span className="ml-1 opacity-60">
                              ·{" "}
                              {record.remoteInfo.serverUrl.replace(
                                /^https?:\/\//,
                                "",
                              )}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {record.triggers.length > 0 && (
                        <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">
                          {t.historyView.triggerCount.replace(
                            "{count}",
                            record.triggers.length.toString(),
                          )}
                        </span>
                      )}
                      <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-transparent px-1 py-0.5">
                        <Tooltip content={t.historyView.applyConfig}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                            onClick={() => applyHistoryConfig(record)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t.historyView.rerun}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                            onClick={() => handleRerun(record)}
                          >
                            <RotateCw className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t.historyView.exportLog}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                            onClick={() => handleExportLog(record)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t.historyView.deleteRecord}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            onClick={() => handleDelete(record.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                      </div>
                      <div className="w-px h-4 bg-border" />
                      <Tooltip content={t.historyView.toggleExpand}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                          onClick={() => handleExpand(record.id)}
                        >
                          {expandedId === record.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>

                {expandedId === record.id && (
                  <RecordDetailContent
                    record={record}
                    t={t}
                    isLoading={loadingDetails === record.id}
                    detail={
                      detailsCache[record.id] ||
                      getRecordDetail(record.id) ||
                      createEmptyRecordDetail()
                    }
                    getTriggerTypeLabel={getTriggerTypeLabel}
                    onOpenPath={handleOpenPath}
                    onOpenFolder={handleOpenFolder}
                  />
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
      <AlertModal
        open={alertOpen}
        onOpenChange={setAlertOpen}
        title={t.historyView.clearConfirmTitle}
        description={t.historyView.clearConfirmDesc}
        variant="destructive"
        onConfirm={handleConfirmClear}
        showCancel={true}
      />
      <AlertModal
        open={Boolean(pathError)}
        onOpenChange={(open) => {
          if (!open) setPathError(null);
        }}
        title={t.historyView.openFailTitle}
        description={pathError || ""}
        variant="warning"
        showCancel={false}
      />
    </div>
  );
}
