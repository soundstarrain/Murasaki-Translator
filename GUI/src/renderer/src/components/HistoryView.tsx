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
  Download,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Tooltip } from "./ui/core";
import { Button } from "./ui/core";
import { AlertModal } from "./ui/AlertModal";
import { translations, Language } from "../lib/i18n";

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
  /** Human-readable message describing the event */
  message: string;
}

/**
 * Complete record of a translation task, including configuration, statistics, and logs.
 * Stored in localStorage and displayed in the History view.
 */
export interface TranslationRecord {
  /** Unique identifier (timestamp-based) */
  id: string;
  /** Input file name (without path) */
  fileName: string;
  /** Full path to input file */
  filePath: string;
  /** Output file path (if available) */
  outputPath?: string;
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
  /** Average translation speed (chars/sec) */
  avgSpeed?: number;
  /** Configuration used for this translation */
  config: {
    temperature: number;
    lineCheck: boolean;
    repPenaltyBase: number;
    maxRetries: number;
    concurrency?: number;
  };
  /** Trigger events recorded during translation */
  triggers: TriggerEvent[];
  /** Log lines (last 100 kept) */
  logs: string[];
}

// ============================================================================
// Storage Functions - localStorage-based history management
// ============================================================================

/** Maximum number of history records to keep */
const MAX_HISTORY_RECORDS = 50;

/** Storage key prefix for record details */
const DETAIL_KEY_PREFIX = 'history_detail_';

/** Record detail containing heavy data - stored separately for lazy loading */
export interface RecordDetail {
  logs: string[];
  triggers: TriggerEvent[];
}

/**
 * Retrieves all translation history records from localStorage (lightweight, no logs/triggers).
 * @returns Array of TranslationRecord objects without logs/triggers for fast loading
 */
export const getHistory = (): TranslationRecord[] => {
  try {
    const data = localStorage.getItem("translation_history");
    if (!data) return [];

    const records = JSON.parse(data) as TranslationRecord[];
    // Migration: if old format contains logs/triggers in main array, strip them
    return records.map(r => {
      // Keep basic fields only, remove heavy data if present
      const { logs, triggers, ...basic } = r as TranslationRecord & { logs?: string[], triggers?: TriggerEvent[] };
      return { ...basic, logs: [], triggers: [] } as TranslationRecord;
    });
  } catch {
    return [];
  }
};

/**
 * Lazily loads record detail (logs and triggers) by ID.
 * @param id - Record ID
 * @returns RecordDetail or null if not found
 */
export const getRecordDetail = (id: string): RecordDetail | null => {
  try {
    const data = localStorage.getItem(`${DETAIL_KEY_PREFIX}${id}`);
    if (data) return JSON.parse(data);

    // Fallback: try to get from old format (migration)
    const historyRaw = localStorage.getItem("translation_history");
    if (historyRaw) {
      const records = JSON.parse(historyRaw) as (TranslationRecord & { logs?: string[], triggers?: TriggerEvent[] })[];
      const record = records.find(r => r.id === id);
      if (record && (record.logs?.length || record.triggers?.length)) {
        const detail = { logs: record.logs || [], triggers: record.triggers || [] };
        // Migrate to new format
        saveRecordDetail(id, detail);
        return detail;
      }
    }
    return { logs: [], triggers: [] };
  } catch {
    return null;
  }
};

/**
 * Saves record detail separately from main history.
 */
const saveRecordDetail = (id: string, detail: RecordDetail) => {
  try {
    localStorage.setItem(`${DETAIL_KEY_PREFIX}${id}`, JSON.stringify(detail));
  } catch (e) {
    console.error('Failed to save record detail:', e);
  }
};

/**
 * Saves translation history to localStorage (lightweight records only).
 * @param records - Array of records to save (will be trimmed to last MAX_HISTORY_RECORDS)
 */
export const saveHistory = (records: TranslationRecord[]) => {
  const trimmed = records.slice(-MAX_HISTORY_RECORDS);
  // Strip heavy data from main history storage
  const lightweight = trimmed.map(r => {
    const { logs, triggers, ...basic } = r as TranslationRecord & { logs?: string[], triggers?: TriggerEvent[] };
    return { ...basic, logs: [], triggers: [] };
  });
  localStorage.setItem("translation_history", JSON.stringify(lightweight));
};

/**
 * Adds a new record to translation history.
 * @param record - The new translation record to add
 */
export const addRecord = (record: TranslationRecord) => {
  const history = getHistory();
  // Save detail separately
  if (record.logs?.length || record.triggers?.length) {
    saveRecordDetail(record.id, { logs: record.logs || [], triggers: record.triggers || [] });
  }
  // Add lightweight record
  history.push({ ...record, logs: [], triggers: [] });
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
    if (updates.logs?.length || updates.triggers?.length) {
      const existingDetail = getRecordDetail(id) || { logs: [], triggers: [] };
      saveRecordDetail(id, {
        logs: updates.logs || existingDetail.logs,
        triggers: updates.triggers || existingDetail.triggers
      });
    }
    // Update main record without heavy data
    const { logs, triggers, ...lightUpdates } = updates as Partial<TranslationRecord> & { logs?: string[], triggers?: TriggerEvent[] };
    history[index] = { ...history[index], ...lightUpdates, logs: [], triggers: [] };
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
  // Also remove detail
  try {
    localStorage.removeItem(`${DETAIL_KEY_PREFIX}${id}`);
  } catch { /* ignore */ }
};

/**
 * Clears all translation history from localStorage.
 */
export const clearHistory = () => {
  // Get all record IDs first to clean up details
  const history = getHistory();
  history.forEach(r => {
    try {
      localStorage.removeItem(`${DETAIL_KEY_PREFIX}${r.id}`);
    } catch { /* ignore */ }
  });
  localStorage.removeItem("translation_history");
};

// ============================================================================
// Sub-Component - Record Detail Content (avoid Hooks in IIFE)
// ============================================================================

interface RecordDetailContentProps {
  record: TranslationRecord;
  lang: Language;
  t: typeof translations["zh"];
  isLoading: boolean;
  getRecordDetail: (id: string) => RecordDetail | null;
  getTriggerTypeLabel: (type: TriggerEvent["type"]) => string;
}

function RecordDetailContent({
  record,
  lang,
  t,
  isLoading,
  getRecordDetail: getDetail,
  getTriggerTypeLabel
}: RecordDetailContentProps) {
  // Get full record with details
  const detail = getDetail(record.id) || { logs: [], triggers: [] };
  const fullRecord = { ...record, logs: detail.logs, triggers: detail.triggers };

  // Trigger events collapse state
  const COLLAPSE_THRESHOLD = 10;
  const shouldCollapse = fullRecord.triggers.length > COLLAPSE_THRESHOLD;
  const [triggersExpanded, setTriggersExpanded] = useState(!shouldCollapse);
  const displayTriggers = triggersExpanded ? fullRecord.triggers : fullRecord.triggers.slice(0, COLLAPSE_THRESHOLD);

  if (isLoading) {
    return (
      <CardContent className="pt-0 border-t">
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2" />
          {lang === "en" ? "Loading..." : "加载中..."}
        </div>
      </CardContent>
    );
  }

  return (
    <CardContent className="pt-0 border-t">
      <div className="space-y-4 pt-4">
        {/* Stats */}
        <div className="grid grid-cols-7 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.blocks}</p>
            <p className="font-medium">{fullRecord.completedBlocks}/{fullRecord.totalBlocks}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.lines}</p>
            <p className="font-medium">{fullRecord.totalLines || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.chars}</p>
            <p className="font-medium">{fullRecord.totalChars?.toLocaleString() || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.speed}</p>
            <p className="font-medium">{fullRecord.avgSpeed || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{lang === "en" ? "Concurrency" : "并发"}</p>
            <p className="font-medium">{fullRecord.config.concurrency || 1}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.temperature}</p>
            <p className="font-medium">{fullRecord.config.temperature}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t.historyView.stats.retries}</p>
            <p className="font-medium">
              {fullRecord.triggers.filter(
                (tr) =>
                  tr.type === "empty_retry" ||
                  tr.type === "line_mismatch" ||
                  tr.type === "rep_penalty_increase" ||
                  tr.type === "parse_fallback"
              ).length}
            </p>
          </div>
        </div>

        {/* Model Info */}
        {fullRecord.modelName && (
          <p className="text-xs text-muted-foreground">
            {t.historyView.labels.model}{" "}
            <span className="font-medium text-foreground">{fullRecord.modelName}</span>
          </p>
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
                  <span className="text-muted-foreground">[Block {tr.block}]</span>
                  <span className="font-medium">{getTriggerTypeLabel(tr.type)}</span>
                  <span className="text-muted-foreground truncate">{tr.message}</span>
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
                    {lang === "en" ? "Collapse" : "收起"}
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3" />
                    {lang === "en" ? `Show all ${fullRecord.triggers.length} triggers` : `展开全部 ${fullRecord.triggers.length} 条`}
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
              {t.dashboard.terminal} (共 {fullRecord.logs.length} 条)
            </p>
            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3 max-h-80 overflow-y-auto font-mono text-xs text-slate-700 dark:text-slate-300 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 border border-slate-200 dark:border-slate-800">
              {fullRecord.logs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* File Paths */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="w-16 shrink-0">{t.historyView.labels.sourceFile}</span>
            <span className="truncate flex-1">{fullRecord.filePath}</span>
            <Tooltip content={t.historyView.labels.openFile}>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => window.api?.openPath?.(fullRecord.filePath)}>
                <ExternalLink className="w-3 h-3" />
              </Button>
            </Tooltip>
            <Tooltip content={t.historyView.labels.openFolder}>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                const folderPath = fullRecord.filePath.substring(0, Math.max(fullRecord.filePath.lastIndexOf("\\"), fullRecord.filePath.lastIndexOf("/")));
                window.api?.openFolder?.(folderPath);
              }}>
                <FolderOpen className="w-3 h-3" />
              </Button>
            </Tooltip>
          </div>
          {fullRecord.outputPath && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-16 shrink-0">{t.historyView.labels.outputFile}</span>
              <span className="truncate flex-1">{fullRecord.outputPath}</span>
              <Tooltip content={t.historyView.labels.openFile}>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => window.api?.openPath?.(fullRecord.outputPath!)}>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </Tooltip>
              <Tooltip content={t.historyView.labels.openFolder}>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                  const folderPath = fullRecord.outputPath!.substring(0, Math.max(fullRecord.outputPath!.lastIndexOf("\\"), fullRecord.outputPath!.lastIndexOf("/")));
                  window.api?.openFolder?.(folderPath);
                }}>
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
export function HistoryView({ lang }: { lang: Language }) {
  const t = translations[lang];
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);

  // Lazy loading state for record details
  const [detailsCache, setDetailsCache] = useState<Record<string, RecordDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);



  useEffect(() => {
    setRecords(getHistory().reverse()); // Show newest first
  }, []);

  // Handle card expansion - load details lazily
  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    // Load details if not cached
    if (!detailsCache[id]) {
      setLoadingDetails(id);
      // Use setTimeout to avoid blocking UI
      setTimeout(() => {
        const detail = getRecordDetail(id);
        if (detail) {
          setDetailsCache(prev => ({ ...prev, [id]: detail }));
        }
        setLoadingDetails(null);
      }, 0);
    }
  };



  const handleDelete = (id: string) => {
    deleteRecord(id);
    setRecords(records.filter((r) => r.id !== id));
  };

  const handleClearAll = () => {
    setAlertOpen(true);
  };

  const handleConfirmClear = () => {
    clearHistory();
    setRecords([]);
  };

  /**
   * Export detailed log for a specific record as text file
   */
  const handleExportLog = (record: TranslationRecord) => {
    // Lazy load details for export
    const detail = getRecordDetail(record.id) || { logs: [], triggers: [] };
    const fullRecord = { ...record, logs: detail.logs, triggers: detail.triggers };

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
      `${e.avgSpeed} ${fullRecord.avgSpeed || 0} ${lang === "en" ? "chars/s" : t.dashboard.charPerSec}`,
      ``,
      e.configTitle,
      `${e.temp} ${fullRecord.config.temperature}`,
      `${e.lineCheck} ${fullRecord.config.lineCheck ? (lang === "en" ? "ON" : "开启") : lang === "en" ? "OFF" : "关闭"}`,
      `${e.repPenalty} ${fullRecord.config.repPenaltyBase}`,
      `${e.maxRetries} ${fullRecord.config.maxRetries}`,
      `Concurrency: ${fullRecord.config.concurrency || 1}`,
      ``,
    ];

    if (fullRecord.triggers.length > 0) {
      lines.push(
        e.triggersTitle.replace("{count}", fullRecord.triggers.length.toString()),
      );
      fullRecord.triggers.forEach((tr, i) => {
        lines.push(
          `${i + 1}. [Block ${tr.block}] ${getTriggerTypeLabel(tr.type)} - ${tr.message}`,
        );
      });
      lines.push(``);
    }

    if (fullRecord.logs.length > 0) {
      lines.push(e.logsTitle.replace("{count}", fullRecord.logs.length.toString()));
      lines.push("```");
      fullRecord.logs.forEach((log) => lines.push(log));
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
                        <CardTitle className="text-base font-medium">
                          {record.fileName}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(record.startTime)} ·{" "}
                          {formatDuration(record.duration)}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleExpand(record.id)}
                      >
                        {expandedId === record.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleExportLog(record)}
                        title={t.historyView.exportLog}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(record.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {expandedId === record.id && (
                  <RecordDetailContent
                    record={record}
                    lang={lang}
                    t={t}
                    isLoading={loadingDetails === record.id}
                    getRecordDetail={getRecordDetail}
                    getTriggerTypeLabel={getTriggerTypeLabel}
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
    </div>
  );
}
