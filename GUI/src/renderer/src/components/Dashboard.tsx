import {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Play,
  X,
  FolderOpen,
  FileText,
  BookOpen,
  Clock,
  Zap,
  Layers,
  Terminal,
  ChevronDown,
  Plus,
  FolderPlus,
  Trash2,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  GripVertical,
  RefreshCw,
  AlignLeft,
  Settings,
  Bot,
} from "lucide-react";
import { Button, Card, Tooltip as UITooltip } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { getVariants } from "../lib/utils";
import { identifyModel } from "../lib/modelConfig";
import {
  addRecord,
  updateRecord,
  TranslationRecord,
  TriggerEvent,
} from "./HistoryView";

import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from "recharts";
import { HardwareMonitorBar, MonitorData } from "./HardwareMonitorBar";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { FileIcon } from "./ui/FileIcon";
import {
  QueueItem,
  FileConfig,
  generateId,
  getFileType,
} from "../types/common";
import type { ProcessExitPayload } from "../types/api";
import { FileConfigModal } from "./LibraryView";
import { stripSystemMarkersForDisplay } from "../lib/displayText";
import type { UseRemoteRuntimeResult } from "../hooks/useRemoteRuntime";

// Window.api type is defined in src/types/api.d.ts

interface DashboardProps {
  lang: Language;
  active?: boolean;
  onRunningChange?: (isRunning: boolean) => void;
  remoteRuntime?: UseRemoteRuntimeResult;
}

interface RemoteModelInfo {
  name: string;
  path: string;
  sizeGb?: number;
}

interface GlossaryOption {
  label: string;
  value: string;
  matchKey: string;
}

const AUTO_START_QUEUE_KEY = "murasaki_auto_start_queue";
const CONFIG_SYNC_KEY = "murasaki_pending_config_sync";

export const Dashboard = forwardRef<any, DashboardProps>(
  ({ lang, active, onRunningChange, remoteRuntime }, ref) => {
    const t = translations[lang];

    // Queue System (Synced with LibraryView)
    const [queue, setQueue] = useState<QueueItem[]>(() => {
      try {
        const saved = localStorage.getItem("library_queue");
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to load queue:", e);
      }

      // Legacy fallback
      try {
        const legacy = localStorage.getItem("file_queue");
        if (legacy) {
          const paths = JSON.parse(legacy) as string[];
          return paths.map((path) => ({
            id: generateId(),
            path,
            fileName: path.split(/[/\\]/).pop() || path,
            fileType: getFileType(path),
            addedAt: new Date().toISOString(),
            config: { useGlobalDefaults: true },
            status: "pending" as const,
          })) as QueueItem[];
        }
      } catch (e) { }
      return [];
    });

    // Sync verification on active
    useEffect(() => {
      if (active) {
        try {
          const saved = localStorage.getItem("library_queue");
          if (saved) {
            const loaded = JSON.parse(saved);
            setQueue(loaded);

            // Sync completed files set from queue status
            const completed = new Set<string>();
            loaded.forEach((item: QueueItem) => {
              if (item.status === "completed") completed.add(item.path);
            });
            setCompletedFiles(completed);
          }
        } catch (e) { }
      }
    }, [active]);

    // Persistence
    useEffect(() => {
      localStorage.setItem("library_queue", JSON.stringify(queue));
      localStorage.setItem(
        "file_queue",
        JSON.stringify(queue.map((q) => q.path)),
      );
    }, [queue]);

    const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
    const [completedFiles, setCompletedFiles] = useState<Set<string>>(
      new Set(),
    );
    const [queueNotice, setQueueNotice] = useState<{
      type: "info" | "warning" | "success";
      message: string;
    } | null>(null);
    const [errorDigest, setErrorDigest] = useState<{
      title: string;
      message: string;
    } | null>(null);
    const queueNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    const pushQueueNotice = useCallback(
      (next: { type: "info" | "warning" | "success"; message: string }) => {
        setQueueNotice(next);
        if (queueNoticeTimerRef.current) {
          clearTimeout(queueNoticeTimerRef.current);
        }
        queueNoticeTimerRef.current = setTimeout(
          () => setQueueNotice(null),
          4200,
        );
      },
      [],
    );

    useEffect(() => {
      return () => {
        if (queueNoticeTimerRef.current) {
          clearTimeout(queueNoticeTimerRef.current);
        }
      };
    }, []);


    // Monitors
    const [monitorData, setMonitorData] = useState<MonitorData | null>(null);

    // --- V1/V2 引擎模式 ---
    const [engineMode, setEngineMode] = useState<"v1" | "v2">(
      () => (localStorage.getItem("config_engine_mode") as "v1" | "v2") || "v1",
    );
    const [v2PipelineId, setV2PipelineId] = useState<string>(() => {
      // 优先读 Dashboard 自己的存储，再 fallback 到 ApiManager 的选择
      const dashboardVal = localStorage.getItem("config_v2_pipeline_id");
      if (dashboardVal) return dashboardVal;
      try {
        const apiMgrVal = localStorage.getItem("murasaki.v2.active_pipeline_id");
        if (apiMgrVal) return JSON.parse(apiMgrVal) as string;
      } catch { /* ignore */ }
      return "";
    });
    const [v2Profiles, setV2Profiles] = useState<Array<{ id: string; name: string; providerName?: string; chunkType?: "line" | "block" }>>([]);
    const engineModeRef = useRef(engineMode);
    useEffect(() => { engineModeRef.current = engineMode; }, [engineMode]);
    useEffect(() => { localStorage.setItem("config_engine_mode", engineMode); }, [engineMode]);
    useEffect(() => { localStorage.setItem("config_v2_pipeline_id", v2PipelineId); }, [v2PipelineId]);

    // V2 Pipeline profiles 加载
    useEffect(() => {
      if (!active || engineMode !== "v2") return;
      window.api?.pipelineV2ProfilesList?.("pipeline").then((profiles: any[]) => {
        if (Array.isArray(profiles)) {
          setV2Profiles(profiles.map((p: any) => ({
            id: p.id,
            name: p.name || p.id,
            providerName: p.providerName,
            chunkType: normalizeChunkType(p.chunk_type ?? p.chunkType),
          })));
          // 如果当前没选择但ApiManager有选择，自动同步
          if (!v2PipelineId && profiles.length > 0) {
            try {
              const apiMgrVal = localStorage.getItem("murasaki.v2.active_pipeline_id");
              if (apiMgrVal) {
                const parsed = JSON.parse(apiMgrVal) as string;
                if (profiles.some((p: any) => p.id === parsed)) {
                  setV2PipelineId(parsed);
                }
              }
            } catch { /* ignore */ }
          }
        }
      });
    }, [active, engineMode]);

    const [modelPath, setModelPath] = useState<string>("");
    const [promptPreset, setPromptPreset] = useState<string>(
      () => localStorage.getItem("config_preset") || "novel",
    );
    const [glossaryPath, setGlossaryPath] = useState<string>("");
    const [localGlossaries, setLocalGlossaries] = useState<GlossaryOption[]>([]);
    const [remoteGlossaries, setRemoteGlossaries] = useState<GlossaryOption[]>([]);
    const [models, setModels] = useState<string[]>([]);
    const [modelsInfoMap, setModelsInfoMap] = useState<
      Record<string, { paramsB?: number; sizeGB?: number }>
    >({});
    const [remoteModels, setRemoteModels] = useState<RemoteModelInfo[]>([]);
    const [remoteModelPath, setRemoteModelPath] = useState<string>("");
    const [, setRemoteLoading] = useState(false);

    const modelInfoRef = useRef<any>(null); // Added for modelInfoRef.current
    const modelInfo = modelInfoRef.current;
    const isRemoteMode = Boolean(remoteRuntime?.isRemoteMode);
    const isRemoteModeRef = useRef(isRemoteMode);
    const glossarySelectionEphemeralRef = useRef(false);
    const activeModelPath = isRemoteMode ? remoteModelPath : modelPath;
    const activeModelsCount = isRemoteMode ? remoteModels.length : models.length;
    const preferredGlossaries =
      isRemoteMode && localGlossaries.length === 0
        ? remoteGlossaries
        : localGlossaries;
    const selectedRemoteInfo = isRemoteMode
      ? remoteModels.find((model) => model.path === remoteModelPath)
      : null;
    const { alertProps, showAlert, showConfirm } = useAlertModal();


    useEffect(() => {
      if (!active) return;
      const syncToken = localStorage.getItem(CONFIG_SYNC_KEY);
      if (!syncToken) return;
      localStorage.removeItem(CONFIG_SYNC_KEY);

      setPromptPreset(localStorage.getItem("config_preset") || "novel");
      if (isRemoteMode) {
        const savedRemote = localStorage.getItem("config_remote_model");
        if (savedRemote) setRemoteModelPath(savedRemote);
        setGlossaryPath("");
      } else {
        const savedModel = localStorage.getItem("config_model");
        if (savedModel) setModelPath(savedModel);
        const savedGlossary =
          localStorage.getItem("config_glossary_path") || "";
        setGlossaryPath(savedGlossary);
      }
    }, [active, isRemoteMode]);

    const fetchData = async () => {
      const m = await window.api?.getModels();
      if (m) {
        setModels(m);
        const infoMap: Record<string, { paramsB?: number; sizeGB?: number }> =
          {};
        for (const model of m) {
          try {
            const info = await window.api?.getModelInfo(model);
            if (info)
              infoMap[model] = { paramsB: info.paramsB, sizeGB: info.sizeGB };
          } catch (e) { }
        }
        setModelsInfoMap(infoMap);
      }
      const g = await window.api?.getGlossaries();
      if (g) {
        const mapped = g.map((item) => {
          const fileName = String(item || "");
          const matchKey = fileName.replace(/\.json$/i, "");
          return {
            label: fileName,
            value: fileName,
            matchKey,
          };
        });
        setLocalGlossaries(mapped);
      }
    };

    const fetchRemoteModels = async () => {
      if (!isRemoteMode) {
        setRemoteModels([]);
        return;
      }
      setRemoteLoading(true);
      try {
        // @ts-ignore
        const result = await window.api?.remoteModels?.();
        if (result?.ok && Array.isArray(result.data)) {
          const mapped = result.data
            .map((item: any) => ({
              name: item?.name || item?.path?.split(/[/\\]/).pop() || "",
              path: item?.path || item?.name || "",
              sizeGb: item?.sizeGb ?? item?.size_gb ?? item?.size,
            }))
            .filter((item: RemoteModelInfo) => item.path);
          setRemoteModels(mapped);
        } else {
          setRemoteModels([]);
        }
      } catch (e) {
        setRemoteModels([]);
      }
      setRemoteLoading(false);
    };

    const fetchRemoteGlossaries = async () => {
      if (!isRemoteMode) {
        setRemoteGlossaries([]);
        return;
      }
      try {
        // @ts-ignore
        const result = await window.api?.remoteGlossaries?.();
        if (result?.ok && Array.isArray(result.data)) {
          const mapped = result.data
            .map((item: any) => {
              const rawPath = String(item?.path || "").trim();
              const baseFromPath =
                rawPath.split(/[/\\]/).pop() || "";
              const rawName = String(item?.name || baseFromPath || "").trim();
              if (!rawName) return null;
              const fileName = rawName.endsWith(".json")
                ? rawName
                : `${rawName}.json`;
              const matchKey = fileName.replace(/\.json$/i, "");
              const value = rawPath || fileName;
              return {
                label: fileName,
                value,
                matchKey,
              };
            })
            .filter((item: GlossaryOption | null) => item && item.value)
            .map((item: GlossaryOption | null) => item as GlossaryOption);
          setRemoteGlossaries(mapped);
        } else {
          setRemoteGlossaries([]);
        }
      } catch (e) {
        setRemoteGlossaries([]);
      }
    };

    // Sync Model on Active - 每次进入页面时主动获取模型信息
    useEffect(() => {
      if (!active) return;
      fetchData();
      if (isRemoteMode) {
        fetchRemoteModels();
        fetchRemoteGlossaries();
      }
      setPromptPreset(localStorage.getItem("config_preset") || "novel");
      if (isRemoteMode) {
        const savedRemote = localStorage.getItem("config_remote_model") || "";
        setRemoteModelPath(savedRemote);
        modelInfoRef.current = null;
        return;
      }
      const path = localStorage.getItem("config_model");
      if (path) {
        const name = path.split(/[/\\]/).pop() || path;
        setModelPath(path);
        // 读取模型信息用于展示
        window.api
          ?.getModelInfo(path)
          .then((info) => {
            if (info) {
              modelInfoRef.current = { ...info, name: name, path: path };
            } else {
              modelInfoRef.current = { name: name, path: path };
            }
          })
          .catch(() => {
            modelInfoRef.current = { name: name, path: path };
          });
      } else {
        modelInfoRef.current = null;
        setModelPath("");
      }
    }, [active, isRemoteMode]);

    // Save Options
    const [saveCot, setSaveCot] = useState(
      () => localStorage.getItem("config_save_cot") === "true",
    );
    const [alignmentMode, setAlignmentMode] = useState(
      () => localStorage.getItem("config_alignment_mode") === "true",
    );

    const [isRunning, setIsRunning] = useState(false);

    // Sync running state
    useEffect(() => {
      onRunningChange?.(isRunning);
    }, [isRunning, onRunningChange]);

    const [isReordering, setIsReordering] = useState(false);
    const [configItem, setConfigItem] = useState<QueueItem | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const MAX_HISTORY_LOG_LINES = 500;
    const MAX_HISTORY_LLAMA_LOG_LINES = 300;

    const presetOptionLabel = (value: "novel" | "script" | "short") => {
      const labels = t.dashboard.promptPresetLabels;
      if (value === "novel") return labels.novel;
      if (value === "script") return labels.script;
      return labels.short;
    };

    const normalizeChunkType = (
      raw: unknown,
    ): "line" | "block" | undefined => {
      if (typeof raw !== "string") return undefined;
      const normalized = raw.trim().toLowerCase();
      if (normalized === "line") return "line";
      if (normalized === "block" || normalized === "legacy") return "block";
      return undefined;
    };

    // Collapsible Panels
    const [queueCollapsed, setQueueCollapsed] = useState(false);
    const [logsCollapsed, setLogsCollapsed] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);
    const srcPreviewRef = useRef<HTMLDivElement>(null);
    const outPreviewRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isAutoScrolling = useRef(false);

    // Refs for stable IPC callbacks
    const currentQueueIndexRef = useRef(currentQueueIndex);
    const queueRef = useRef(queue);
    const currentRecordIdRef = useRef<string | null>(null);
    const logsBufferRef = useRef<string[]>([]);
    const llamaLogsBufferRef = useRef<string[]>([]);
    const triggersBufferRef = useRef<TriggerEvent[]>([]);
    // Buffer for assembling split log chunks (fixing JSON parse errors)
    const lineBufferRef = useRef("");
    const activeRunIdRef = useRef<string | null>(null);
    const remoteInfoRef = useRef<{
      executionMode?: string;
      source?: string;
      serverUrl?: string;
      taskId?: string;
      model?: string;
      serverVersion?: string;
    } | null>(null);
    const progressDataRef = useRef<{
      total: number;
      current: number;
      lines: number;
      chars: number;
      sourceLines: number;
      sourceChars: number;
      outputPath: string;
      cacheDir: string;
      cachePath: string;
      speeds: number[];
    }>({
      total: 0,
      current: 0,
      lines: 0,
      chars: 0,
      sourceLines: 0,
      sourceChars: 0,
      outputPath: "",
      cacheDir: "",
      cachePath: "",
      speeds: [],
    });
    const finalStatsRef = useRef<{
      totalTime?: number;
      avgSpeed?: number;
    } | null>(null);

    // Ref to hold the fresh checkAndStart function (avoids closure stale state in handleProcessExit)
    const checkAndStartRef = useRef<
      (inputPath: string, index: number) => Promise<void>
    >(() => Promise.resolve());

    // Auto-scroll ref
    const activeQueueItemRef = useRef<HTMLDivElement>(null);

    // ...

    // Progress & Preview
    const [progress, setProgress] = useState({
      current: 0,
      total: 0,
      percent: 0,
      elapsed: 0,
      remaining: 0,
      speedLines: 0,
      speedChars: 0,
      speedEval: 0,
      speedGen: 0,
      retries: 0,
    });
    const [lastOutputPath, setLastOutputPath] = useState<string>("");
    const [runNotice, setRunNotice] = useState<{
      type: "success" | "warning" | "error";
      message: string;
    } | null>(null);
    const runNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [displayElapsed, setDisplayElapsed] = useState(0); // 本地平滑计时(基于后端数据)
    const [displayRemaining, setDisplayRemaining] = useState(0); // 本地平滑倒计时
    const [chartData, setChartData] = useState<any[]>([]);
    const [chartMode, setChartMode] = useState<
      "chars" | "tokens" | "vram" | "gpu"
    >("chars");
    // Use Ref to access current chartMode inside onLogUpdate closure
    const chartModeRef = useRef(chartMode);
    useEffect(() => {
      chartModeRef.current = chartMode;
    }, [chartMode]);

    // Multi-metric chart histories
    const chartHistoriesRef = useRef<{
      chars: { time: number; value: number }[];
      tokens: { time: number; value: number }[];
      vram: { time: number; value: number }[];
      gpu: { time: number; value: number }[];
    }>({ chars: [], tokens: [], vram: [], gpu: [] });
    const chartRenderTimerRef = useRef<number | null>(null);
    const MAX_CHART_POINTS = 3000;
    const CHART_RENDER_INTERVAL_MS = 150;

    const refreshChartData = useCallback(
      (
        mode: "chars" | "tokens" | "vram" | "gpu" = chartModeRef.current,
      ): void => {
        const activeHistory = chartHistoriesRef.current[mode];
        const step = Math.ceil(activeHistory.length / 1000);
        const dataset =
          step > 1
            ? activeHistory.filter((_, index) => index % step === 0)
            : activeHistory;
        setChartData(dataset.map((h) => ({ time: h.time, speed: h.value })));
      },
      [],
    );

    const scheduleChartRefresh = useCallback(() => {
      if (chartRenderTimerRef.current !== null) return;
      chartRenderTimerRef.current = window.setTimeout(() => {
        chartRenderTimerRef.current = null;
        refreshChartData();
      }, CHART_RENDER_INTERVAL_MS);
    }, [refreshChartData]);

    const pushChartPoint = useCallback(
      (metric: "chars" | "tokens" | "vram" | "gpu", value: number): void => {
        const history = chartHistoriesRef.current[metric];
        history.push({ time: Date.now(), value });
        if (history.length > MAX_CHART_POINTS) {
          history.splice(0, history.length - MAX_CHART_POINTS);
        }
      },
      [],
    );

    useEffect(() => {
      return () => {
        if (chartRenderTimerRef.current !== null) {
          window.clearTimeout(chartRenderTimerRef.current);
        }
      };
    }, []);
    // New Block-Based Preview State
    const [previewBlocks, setPreviewBlocks] = useState<
      Record<number, { src: string; output: string }>
    >({});

    // Clear preview on mount (fresh start)
    useEffect(() => {
      localStorage.removeItem("last_preview");
    }, []);

    useEffect(() => {
      if (isRemoteMode) {
        const savedRemote = localStorage.getItem("config_remote_model");
        if (savedRemote) setRemoteModelPath(savedRemote);
        fetchRemoteModels();
        fetchRemoteGlossaries();
        setGlossaryPath("");
        glossarySelectionEphemeralRef.current = false;
      } else {
        const savedModel = localStorage.getItem("config_model");
        if (savedModel) setModelPath(savedModel);
        const savedGlossary = localStorage.getItem("config_glossary_path") || "";
        setGlossaryPath(savedGlossary);
        glossarySelectionEphemeralRef.current = false;
      }
      fetchData();
    }, [isRemoteMode]);

    useEffect(() => {
      isRemoteModeRef.current = isRemoteMode;
    }, [isRemoteMode]);

    useEffect(() => {
      if (isRemoteMode) return;
      if (modelPath) {
        window.api
          ?.getModelInfo(modelPath)
          .then((info) => (modelInfoRef.current = info));

        // 根据模型名称识别预设信息
        const config = identifyModel(modelPath);
        if (config) {
          console.log(`[Murasaki] 识别到模型: ${config.displayName}`);
        }
      }
    }, [modelPath, isRemoteMode]);

    // Confirm sync with file_queue for legacy
    useEffect(() => {
      // We might want to keep file_queue synced in case other parts use it,
      // but library_queue is the master.
      queueRef.current = queue;
    }, [queue]);

    useEffect(() => {
      return () => {
        if (runNoticeTimerRef.current) {
          clearTimeout(runNoticeTimerRef.current);
        }
      };
    }, []);

    // Sync queue index ref
    useEffect(() => {
      currentQueueIndexRef.current = currentQueueIndex;
      // Auto-scroll logic
      if (activeQueueItemRef.current) {
        // Short delay to ensure render
        setTimeout(() => {
          activeQueueItemRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }, 100);
      }
    }, [currentQueueIndex]);

    const handleProcessExit = useCallback((payload: ProcessExitPayload) => {
      const payloadRunId = payload?.runId;
      if (
        payloadRunId &&
        activeRunIdRef.current &&
        payloadRunId !== activeRunIdRef.current
      ) {
        console.warn(
          "[Dashboard] Ignoring stale process-exit event:",
          payloadRunId,
        );
        return;
      }
      activeRunIdRef.current = null;
      const code = payload?.code ?? null;
      const signal = payload?.signal ?? null;
      const stopRequested = payload?.stopRequested === true;
      setIsRunning(false);
      const success = code === 0;
      const finalStatus: TranslationRecord["status"] = success
        ? "completed"
        : stopRequested
          ? "interrupted"
          : "failed";
      const runNoticeMessage = success
        ? t.dashboard.runCompleted
        : stopRequested
          ? t.dashboard.runStopped
          : t.dashboard.runFailed;
      setRunNotice({
        type: success ? "success" : stopRequested ? "warning" : "error",
        message: runNoticeMessage,
      });
      if (runNoticeTimerRef.current) {
        clearTimeout(runNoticeTimerRef.current);
      }
      runNoticeTimerRef.current = setTimeout(() => {
        setRunNotice(null);
      }, 6000);
      const message = success
        ? "✅ Translation completed successfully!"
        : stopRequested
          ? "⏹️ Translation stopped by user."
          : code === null && signal
            ? `❌ Process terminated by signal ${signal}`
            : code === null
              ? "❌ Process terminated unexpectedly (no exit code)"
              : `❌ Process exited with code ${code}`;
      setLogs((prev) => [...prev, message]); // Keep English for logs for now or add keys later

      // Finalize history record
      if (currentRecordIdRef.current) {
        const startTime = new Date(parseInt(currentRecordIdRef.current));
        const duration = (Date.now() - startTime.getTime()) / 1000;
        const effectiveDuration = finalStatsRef.current?.totalTime ?? duration;
        const avgSpeed =
          finalStatsRef.current?.avgSpeed ??
          (effectiveDuration > 0
            ? Number(
              (progressDataRef.current.chars / effectiveDuration).toFixed(1),
            )
            : 0);
        const resolvedCachePath = progressDataRef.current.outputPath
          ? progressDataRef.current.cachePath ||
          resolveCachePath(
            progressDataRef.current.outputPath,
            progressDataRef.current.cacheDir,
          )
          : "";
        updateRecord(currentRecordIdRef.current, {
          endTime: new Date().toISOString(),
          duration: Math.round(effectiveDuration),
          status: finalStatus,
          executionMode: remoteInfoRef.current?.executionMode as any || "local",
          remoteInfo: remoteInfoRef.current ? {
            serverUrl: remoteInfoRef.current.serverUrl || "",
            source: remoteInfoRef.current.source || "",
            taskId: remoteInfoRef.current.taskId,
            model: remoteInfoRef.current.model,
            serverVersion: remoteInfoRef.current.serverVersion,
          } : undefined,
          totalBlocks: progressDataRef.current.total,
          completedBlocks: progressDataRef.current.current,
          totalLines: progressDataRef.current.lines,
          totalChars: progressDataRef.current.chars,
          sourceLines: progressDataRef.current.sourceLines,
          sourceChars: progressDataRef.current.sourceChars,
          outputPath: progressDataRef.current.outputPath,
          cachePath: resolvedCachePath || undefined,
          avgSpeed: avgSpeed,
          logs: logsBufferRef.current.slice(-MAX_HISTORY_LOG_LINES),
          llamaLogs: llamaLogsBufferRef.current.slice(-MAX_HISTORY_LLAMA_LOG_LINES),
          triggers: triggersBufferRef.current,
        });
        if (progressDataRef.current.outputPath) {
          setLastOutputPath(progressDataRef.current.outputPath);
        }
        currentRecordIdRef.current = null;
        progressDataRef.current = {
          total: 0,
          current: 0,
          lines: 0,
          chars: 0,
          sourceLines: 0,
          sourceChars: 0,
          outputPath: "",
          cacheDir: "",
          cachePath: "",
          speeds: [],
        };
        finalStatsRef.current = null;
        llamaLogsBufferRef.current = [];
      }

      // Don't clear preview - keep showing last translation result
      // setPreview(null) - REMOVED to preserve last result

      const notifyMessage = success
        ? t.dashboard.notifyCompleted
        : stopRequested
          ? t.dashboard.notifyStopped
          : t.dashboard.notifyFailed;
      window.api?.showNotification("Murasaki Translator", notifyMessage);

      const queueIndex = currentQueueIndexRef.current;
      const queue = queueRef.current;

      if (
        success &&
        Array.isArray(queue) &&
        queueIndex >= 0 &&
        queueIndex < queue.length
      ) {
        const currentItem = queue[queueIndex];
        if (currentItem && queueIndex < queue.length - 1) {
          // Continue to next file in queue
          const nextIndex = queueIndex + 1;
          setCompletedFiles((prev) => {
            const next = new Set(prev);
            if (currentItem.path) next.add(currentItem.path);
            return next;
          });
          setQueue((prev) =>
            prev.map((item, i) =>
              i === queueIndex ? { ...item, status: "completed" } : item,
            ),
          );

          setTimeout(() => {
            if (queue[nextIndex]) {
              checkAndStartRef.current(queue[nextIndex].path, nextIndex);
            }
          }, 1000);
        } else if (currentItem) {
          // Last file completed (or single file)
          setCompletedFiles((prev) => {
            const next = new Set(prev);
            if (currentItem.path) next.add(currentItem.path);
            return next;
          });
          setQueue((prev) =>
            prev.map((item, i) =>
              i === queueIndex ? { ...item, status: "completed" } : item,
            ),
          );
          setCurrentQueueIndex(-1);
          if (queue.length > 1) {
            window.api?.showNotification(
              "Murasaki Translator",
              t.dashboard.notifyAllCompleted.replace(
                "{count}",
                String(queue.length),
              ),
            );
          }
          setProgress((prev) => ({ ...prev, percent: 100 }));
        } else {
          setCurrentQueueIndex(-1);
        }
      } else {
        // Interrupted or failed
        if (
          Array.isArray(queue) &&
          queueIndex >= 0 &&
          queueIndex < queue.length
        ) {
          const errorMessage = stopRequested
            ? t.dashboard.runStopped
            : t.dashboard.runFailed;
          setQueue((prev) =>
            prev.map((item, i) =>
              i === queueIndex
                ? { ...item, status: "failed", error: errorMessage }
                : item,
            ),
          );
        }
        setCurrentQueueIndex(-1);
      }
      resetEphemeralGlossarySelection();
    }, []); // Empty deps - uses refs for values

    useEffect(() => {
      const unsubscribeLog = window.api?.onLogUpdate((chunk: string) => {
        // Handle potentially buffered input with multiple lines (Stream Buffering Fix)
        lineBufferRef.current += chunk;
        const lines = lineBufferRef.current.split("\n");
        // Keep the last segment (potential partial line) in buffer
        lineBufferRef.current = lines.pop() || "";

        lines.forEach((line) => {
          const rawLog = line.trim();
          if (!rawLog) return;

          let log = rawLog;
          if (rawLog.startsWith("{")) {
            try {
              const data = JSON.parse(rawLog);
              if (data && typeof data === "object" && "message" in data) {
                const message =
                  typeof (data as { message?: unknown }).message === "string"
                    ? String((data as { message?: unknown }).message)
                    : String((data as { message?: unknown }).message ?? "");
                if (message) {
                  log = message.trim();
                }
              }
            } catch {
              // ignore JSONL parse errors
            }
          }
          if (!log) return;

          if (log.startsWith("JSON_REMOTE_INFO:")) {
            try {
              const data = JSON.parse(log.substring("JSON_REMOTE_INFO:".length));
              remoteInfoRef.current = data;
            } catch (e) {
              console.error("JSON_REMOTE_INFO Parse Error:", e);
            }
            return;
          }

          if (log.startsWith("JSON_LLAMA_LOG:")) {
            try {
              const data = JSON.parse(log.substring("JSON_LLAMA_LOG:".length));
              const line =
                typeof data?.line === "string"
                  ? data.line.trim()
                  : String(data?.line || "").trim();
              if (line) {
                llamaLogsBufferRef.current.push(line);
                if (llamaLogsBufferRef.current.length > MAX_HISTORY_LLAMA_LOG_LINES) {
                  llamaLogsBufferRef.current = llamaLogsBufferRef.current.slice(
                    -MAX_HISTORY_LLAMA_LOG_LINES,
                  );
                }
              }
            } catch (e) {
              console.error("JSON_LLAMA_LOG Parse Error:", e);
            }
            return;
          }

          if (log.startsWith("JSON_MONITOR:")) {
            try {
              const monitorPayload = JSON.parse(
                log.substring("JSON_MONITOR:".length),
              );
              setMonitorData(monitorPayload);
              if (typeof monitorPayload.vram_percent === "number") {
                pushChartPoint("vram", monitorPayload.vram_percent);
              }
              if (typeof monitorPayload.gpu_util === "number") {
                pushChartPoint("gpu", monitorPayload.gpu_util);
              }
              // Use real-time speeds from monitor if available (0.5s update rate)
              if (typeof monitorPayload.realtime_speed_chars === "number") {
                pushChartPoint("chars", monitorPayload.realtime_speed_chars);
              }
              if (typeof monitorPayload.realtime_speed_tokens === "number") {
                pushChartPoint("tokens", monitorPayload.realtime_speed_tokens);
              }
              scheduleChartRefresh();
            } catch (e) {
              console.error("Monitor Parse Error:", e);
            }
            return;
          }

          if (log.startsWith("JSON_THINK_DELTA:")) {
            return;
          }

          if (log.startsWith("JSON_PROGRESS:")) {
            try {
              const data = JSON.parse(log.substring("JSON_PROGRESS:".length));
              // 直接使用后端数据，不保留旧值(避免上一次运行的残留)
              setProgress((prev) => ({
                current:
                  typeof data.current === "number" ? data.current : prev.current,
                total: typeof data.total === "number" ? data.total : prev.total,
                percent:
                  typeof data.percent === "number" ? data.percent : prev.percent,
                elapsed:
                  typeof data.elapsed === "number" ? data.elapsed : prev.elapsed,
                remaining:
                  typeof data.remaining === "number"
                    ? Math.max(0, data.remaining)
                    : prev.remaining,
                speedLines:
                  typeof data.speed_lines === "number"
                    ? data.speed_lines
                    : prev.speedLines,
                speedChars:
                  typeof data.speed_chars === "number"
                    ? data.speed_chars
                    : prev.speedChars,
                speedEval:
                  typeof data.speed_eval === "number"
                    ? data.speed_eval
                    : prev.speedEval,
                speedGen:
                  typeof data.speed_gen === "number"
                    ? data.speed_gen
                    : prev.speedGen,
                // If block changed, reset retries
                retries: data.current !== prev.current ? 0 : prev.retries,
              }));

              // Track for history record
              progressDataRef.current = {
                total: data.total ?? 0,
                current: data.current ?? 0,
                lines: data.total_lines ?? progressDataRef.current.lines,
                chars: data.total_chars ?? progressDataRef.current.chars,
                sourceLines:
                  data.source_lines ?? progressDataRef.current.sourceLines,
                sourceChars:
                  data.source_chars ?? progressDataRef.current.sourceChars,
                outputPath: progressDataRef.current.outputPath, // 保留已设置的输出路径
                cacheDir: progressDataRef.current.cacheDir,
                cachePath: progressDataRef.current.cachePath,
                speeds:
                  data.speed_chars > 0
                    ? [
                      ...progressDataRef.current.speeds,
                      data.speed_chars,
                    ].slice(-20)
                    : progressDataRef.current.speeds,
              };

              // Update legacy values only if chart history is empty (fallback)
              // The primary chart driver is now JSON_MONITOR
              if (
                chartHistoriesRef.current.chars.length === 0 &&
                data.speed_chars > 0
              ) {
                pushChartPoint("chars", data.speed_chars);
              }
              scheduleChartRefresh();
            } catch (e) {
              console.error(e);
            }
          } else if (log.startsWith("JSON_RETRY:")) {
            try {
              const data = JSON.parse(log.substring("JSON_RETRY:".length));
              console.log("[Dashboard] Received JSON_RETRY:", data);
              // Accumulate retries instead of just setting to attempt number
              setProgress((prev) => ({ ...prev, retries: prev.retries + 1 }));
              // 添加到触发事件以便记录到历史
              const retryType =
                data.type === "repetition"
                  ? "rep_penalty_increase"
                  : data.type === "glossary"
                    ? "glossary_missed"
                    : data.type === "empty"
                      ? "empty_retry"
                      : data.type === "anchor_missing"
                        ? "anchor_missing"
                        : data.type === "provider_error"
                          ? "provider_error"
                          : "line_mismatch";
              const retryMessages = t.dashboard.retryMessages;
              const coverageText =
                typeof data.coverage === "number"
                  ? data.coverage.toFixed(1)
                  : "--";
              triggersBufferRef.current.push({
                time: new Date().toISOString(),
                type: retryType,
                block: data.block || 0,
                message:
                  data.type === "repetition"
                    ? retryMessages.repPenalty.replace(
                      "{value}",
                      String(data.penalty),
                    )
                    : data.type === "glossary"
                      ? retryMessages.glossaryCoverage
                        .replace("{coverage}", coverageText)
                      : data.type === "empty"
                        ? retryMessages.emptyBlock
                          .replace("{block}", String(data.block))
                        : data.type === "anchor_missing"
                          ? retryMessages.anchorMissing
                            .replace("{block}", String(data.block))
                          : data.type === "provider_error"
                            ? retryMessages.providerError
                            : retryMessages.lineMismatch
                              .replace("{block}", String(data.block))
                              .replace(
                                "{diff}",
                                String(data.src_lines - data.dst_lines),
                              ),
              });
            } catch (e) {
              console.error("JSON_RETRY Parse Error:", e, log);
            }
          } else if (log.includes("JSON_PREVIEW_BLOCK:")) {
            try {
              const jsonStr = log.substring(
                log.indexOf("JSON_PREVIEW_BLOCK:") +
                "JSON_PREVIEW_BLOCK:".length,
              );
              const data = JSON.parse(jsonStr);
              // Update specific block
              setPreviewBlocks((prev) => {
                const next = {
                  ...prev,
                  [data.block]: { src: data.src, output: data.output },
                };
                // Persist light-weight version? Or maybe persistence is less critical for realtime stream
                // but if user reloads?
                // Let's persist full blocks map?
                try {
                  localStorage.setItem(
                    "last_preview_blocks",
                    JSON.stringify(next),
                  );
                } catch (e) { }
                return next;
              });
            } catch (e) {
              console.error(e);
            }
          } else if (log.startsWith("JSON_OUTPUT_PATH:")) {
            // 接收输出文件路径
            try {
              const data = JSON.parse(
                log.substring("JSON_OUTPUT_PATH:".length),
              );
              const outputPath = data.path || "";
              progressDataRef.current.outputPath = outputPath;
              progressDataRef.current.cachePath = outputPath
                ? resolveCachePath(
                  outputPath,
                  progressDataRef.current.cacheDir,
                )
                : "";
              if (outputPath) setLastOutputPath(outputPath);
            } catch (e) {
              console.error("Output Path Parse Error:", e);
            }
            return;
          } else if (log.startsWith("JSON_WARNING:")) {
            // Quality check warnings from backend
            try {
              const data = JSON.parse(log.substring("JSON_WARNING:".length));
              triggersBufferRef.current.push({
                time: new Date().toISOString(),
                type: (data.type
                  ? `warning_${data.type}`
                  : "warning_quality") as any,
                block: data.block || 0,
                message: data.message || "",
              });
            } catch (e) {
              console.error("Warning Parse Error:", e);
            }
            return;
          } else if (log.startsWith("JSON_ERROR:")) {
            // Critical error from backend - show internal alert
            try {
              const data = JSON.parse(log.substring("JSON_ERROR:".length));
              setErrorDigest({
                title: data.title || t.dashboard.errorTitle,
                message: data.message || t.dashboard.errorUnknown,
              });
              showAlert({
                title: data.title || t.dashboard.errorTitle,
                description: data.message || t.dashboard.errorUnknown,
                variant: "destructive",
              });
            } catch (e) {
              console.error("JSON_ERROR Parse Error:", e);
            }
            return;
          } else if (log.startsWith("JSON_FINAL:")) {
            // Final stats from backend
            try {
              const data = JSON.parse(log.substring("JSON_FINAL:".length));
              finalStatsRef.current = {
                totalTime: Number(data.totalTime ?? 0),
                avgSpeed: Number(data.avgSpeed ?? 0),
              };

              // Update progressDataRef so handleProcessExit uses these final values
              // instead of overwriting them with stale data
              progressDataRef.current = {
                ...progressDataRef.current,
                sourceLines: data.sourceLines,
                sourceChars: data.sourceChars,
                lines: data.outputLines,
                chars: data.outputChars,
              };

              // Update history record with final stats
              if (currentRecordIdRef.current) {
                const v2Stats =
                  data.totalRequests !== undefined
                    ? {
                      totalRequests: Number(data.totalRequests || 0),
                      totalRetries: Number(data.totalRetries || 0),
                      totalErrors: Number(data.totalErrors || 0),
                      totalInputTokens: Number(data.totalInputTokens || 0),
                      totalOutputTokens: Number(data.totalOutputTokens || 0),
                      errorStatusCodes:
                        data.errorStatusCodes &&
                          typeof data.errorStatusCodes === "object"
                          ? data.errorStatusCodes
                          : undefined,
                    }
                    : undefined;
                updateRecord(currentRecordIdRef.current, {
                  sourceLines: data.sourceLines,
                  sourceChars: data.sourceChars,
                  totalLines: data.outputLines,
                  totalChars: data.outputChars,
                  avgSpeed: data.avgSpeed,
                  duration: data.totalTime,
                  ...(v2Stats ? { v2Stats } : {}),
                });
              }
            } catch (e) {
              console.error("Stats Parse Error:", e);
            }
            return;
          } else {
            // Only add non-empty logs that aren't JSON events
            setLogs((prev) => [...prev.slice(-200), log]);

            // Buffer logs for history record
            logsBufferRef.current.push(log);
            if (logsBufferRef.current.length > MAX_HISTORY_LOG_LINES) {
              logsBufferRef.current = logsBufferRef.current.slice(
                -MAX_HISTORY_LOG_LINES,
              );
            }

            // Detect trigger events - REMOVED to avoid duplication with JSON events
            // Backend now sends JSON_RETRY and JSON_WARNING for all these events
          }
        });
      });
      const unsubscribeExit = window.api?.onProcessExit(handleProcessExit);
      return () => {
        unsubscribeLog?.();
        unsubscribeExit?.();
      };
    }, []);

    // 快捷键监听 (带有依赖数组，防止闭包陷阱)
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!active) return;

        if (e.ctrlKey && e.key === "Enter") {
          e.preventDefault();
          if (!isRunning && queue.length > 0) handleStartQueue();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (isRunning) handleStop();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isRunning, queue, active]);

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
      startTranslation: () => {
        if (!isRunning && queue.length > 0) handleStartQueue();
      },
      stopTranslation: () => {
        if (isRunning) requestStop();
      },
    }));

    // 日志自动滚动到底部
    useEffect(() => {
      logEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, [logs]);

    // 预览区域自动滚动到底部
    useEffect(() => {
      // 当预览内容更新时，强制滚动到底部
      if (srcPreviewRef.current) {
        isAutoScrolling.current = true;
        srcPreviewRef.current.scrollTop = srcPreviewRef.current.scrollHeight;
      }
      if (outPreviewRef.current) {
        isAutoScrolling.current = true;
        outPreviewRef.current.scrollTop = outPreviewRef.current.scrollHeight;
      }
      // 重置标志位(稍微延迟以防事件触发)
      setTimeout(() => {
        isAutoScrolling.current = false;
      }, 50);
    }, [previewBlocks]);

    // 本地平滑计时器 - 基于后端 elapsed 数据插值更新
    const lastBackendElapsedRef = useRef<number>(0);
    const lastBackendUpdateRef = useRef<number>(0);
    const hasReceivedProgressRef = useRef(false);
    const localStartTimeRef = useRef<number>(0);

    useEffect(() => {
      if (!isRunning) {
        // 翻译停止时不重置显示时间，保留最终结果
        // 但倒计时应清零，因为任务已结束
        lastBackendElapsedRef.current = 0;
        lastBackendUpdateRef.current = 0;
        hasReceivedProgressRef.current = false;
        setDisplayRemaining(0);
        return;
      }

      // 每 100ms 更新显示时间
      const timer = setInterval(() => {
        // 使用后端时间 + 本地插值
        if (
          lastBackendUpdateRef.current > 0 &&
          lastBackendElapsedRef.current > 0
        ) {
          const localDelta = (Date.now() - lastBackendUpdateRef.current) / 1000;
          const interpolatedElapsed =
            lastBackendElapsedRef.current + localDelta;
          setDisplayElapsed(Math.floor(interpolatedElapsed));

          // 倒计时插值 (Smoothing Remaining Time)
          if (progress.remaining > 0) {
            const smoothRemaining = Math.max(
              0,
              progress.remaining - localDelta,
            );
            setDisplayRemaining(Math.round(smoothRemaining));
          } else {
            setDisplayRemaining(0);
          }
        } else if (progress.elapsed > 0 && hasReceivedProgressRef.current) {
          // 首次收到后端数据前使用后端值 (仅当已收到新数据时)
          setDisplayElapsed(Math.floor(progress.elapsed));
          setDisplayRemaining(Math.floor(progress.remaining));
        } else if (localStartTimeRef.current > 0) {
          // 后端尚未给出 elapsed，先用本地计时避免一直为 0
          const localElapsed =
            (Date.now() - localStartTimeRef.current) / 1000;
          setDisplayElapsed(Math.floor(localElapsed));
          setDisplayRemaining(0);
        }
      }, 100);

      return () => clearInterval(timer);
    }, [isRunning, progress.elapsed]);

    // 更新后端时间参考点(每次收到 JSON_PROGRESS 时)
    // 更新后端时间参考点(每次收到 JSON_PROGRESS 时)
    useEffect(() => {
      if (progress.elapsed > 0) {
        lastBackendElapsedRef.current = progress.elapsed;
        lastBackendUpdateRef.current = Date.now();
        hasReceivedProgressRef.current = true;
      }
    }, [progress.elapsed]);

    // Refresh chart data when mode changes
    useEffect(() => {
      refreshChartData(chartMode);
    }, [chartMode, refreshChartData]);

    // File icon helper (Synced with LibraryView)

    const addQueueItems = useCallback(
      (paths: string[], scanFailures: number = 0) => {
        const existing = new Set(queue.map((q) => q.path));
        const newItems: QueueItem[] = [];
        let skippedUnsupported = 0;
        let skippedDuplicate = 0;
        const supportedExtensions = new Set([
          ".txt",
          ".epub",
          ".srt",
          ".ass",
          ".ssa",
        ]);

        for (const path of paths) {
          const ext = "." + path.split(".").pop()?.toLowerCase();
          if (!supportedExtensions.has(ext)) {
            skippedUnsupported += 1;
            continue;
          }
          if (existing.has(path)) {
            skippedDuplicate += 1;
            continue;
          }
          existing.add(path);
          newItems.push({
            id: generateId(),
            path,
            fileName: path.split(/[/\\]/).pop() || path,
            fileType: getFileType(path),
            addedAt: new Date().toISOString(),
            config: { useGlobalDefaults: true },
            status: "pending" as const,
          });
        }

        if (newItems.length) setQueue((prev) => [...prev, ...newItems]);

        const messages: string[] = [];
        if (newItems.length) {
          messages.push(
            t.dashboard.queueAdded.replace("{count}", String(newItems.length)),
          );
        }
        if (skippedUnsupported > 0) {
          messages.push(
            t.dashboard.queueIgnoredUnsupported.replace(
              "{count}",
              String(skippedUnsupported),
            ),
          );
        }
        if (skippedDuplicate > 0) {
          messages.push(
            t.dashboard.queueIgnoredDuplicate.replace(
              "{count}",
              String(skippedDuplicate),
            ),
          );
        }
        if (scanFailures > 0) {
          messages.push(
            t.dashboard.queueScanFailed.replace(
              "{count}",
              String(scanFailures),
            ),
          );
        }

        if (messages.length) {
          const type =
            skippedUnsupported > 0 || scanFailures > 0
              ? "warning"
              : newItems.length > 0
                ? "success"
                : "info";
          pushQueueNotice({ type, message: messages.join(" · ") });
        }
      },
      [queue, t, pushQueueNotice],
    );

    const handleAddFiles = async () => {
      const files = await window.api?.selectFiles();
      if (files?.length) {
        addQueueItems(files);
      }
    };

    const handleAddFolder = async () => {
      const files = await window.api?.selectFolderFiles();
      if (files?.length) {
        addQueueItems(files);
      }
    };

    const handleRemoveFile = (index: number) => {
      const item = queue[index];
      const isCompleted =
        completedFiles.has(item.path) || item.status === "completed";

      if (isCompleted) {
        const newQueue = [...queue];
        newQueue.splice(index, 1);
        setQueue(newQueue);
        if (index === currentQueueIndex) {
          setCurrentQueueIndex(-1);
        } else if (index < currentQueueIndex) {
          setCurrentQueueIndex(currentQueueIndex - 1);
        }
        return;
      }

      showConfirm({
        title: t.dashboard.confirmRemoveTitle,
        description: t.dashboard.confirmRemoveDesc.replace(
          "{name}",
          item.fileName,
        ),
        variant: "destructive",
        onConfirm: () => {
          const newQueue = [...queue];
          newQueue.splice(index, 1);
          setQueue(newQueue);
          if (index === currentQueueIndex) {
            setCurrentQueueIndex(-1);
          } else if (index < currentQueueIndex) {
            setCurrentQueueIndex(currentQueueIndex - 1);
          }
        },
      });
    };

    const handlePromptPresetChange = (value: string) => {
      setPromptPreset(value);
      localStorage.setItem("config_preset", value);
    };

    const handleSaveFileConfig = (itemId: string, config: FileConfig) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, config } : item)),
      );
      setConfigItem(null);
    };

    const handleClearQueue = useCallback(() => {
      showConfirm({
        title: t.dashboard.clear,
        description: t.dashboard.confirmClear,
        variant: "destructive",
        onConfirm: () => {
          setQueue([]);
          localStorage.setItem("library_queue", JSON.stringify([]));
        },
      });
    }, [t, showConfirm]);

    const handleRetryFailed = useCallback(() => {
      const failedCount = queue.filter((item) => item.status === "failed").length;
      if (failedCount === 0) {
        pushQueueNotice({ type: "info", message: t.dashboard.retryFailedNone });
        return;
      }
      const nextQueue = queue.map((item) =>
        item.status === "failed"
          ? { ...item, status: "pending" as const, error: undefined }
          : item,
      );
      setQueue(nextQueue);
      pushQueueNotice({
        type: "success",
        message: t.dashboard.retryFailedDone.replace(
          "{count}",
          String(failedCount),
        ),
      });
    }, [queue, pushQueueNotice, t]);

    const handleClearCompletedOnly = useCallback(() => {
      const completedCount = queue.filter(
        (item) => item.status === "completed",
      ).length;
      if (completedCount === 0) {
        pushQueueNotice({
          type: "info",
          message: t.dashboard.clearCompletedNone,
        });
        return;
      }
      const nextQueue = queue.filter((item) => item.status !== "completed");
      setQueue(nextQueue);
      setCompletedFiles(
        new Set(
          nextQueue
            .filter((item) => item.status === "completed")
            .map((item) => item.path),
        ),
      );
      pushQueueNotice({
        type: "success",
        message: t.dashboard.clearCompletedDone.replace(
          "{count}",
          String(completedCount),
        ),
      });
    }, [queue, pushQueueNotice, t]);

    // Drag handlers
    // Unified Drop Handler for Queue
    const handleDrop = useCallback(
      async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // 1. Check for Internal Reorder
        const sourceIndexStr = e.dataTransfer.getData("text/plain");
        if (sourceIndexStr && !isNaN(parseInt(sourceIndexStr))) {
          // It's a reorder event, handled by the specific item onDrop (bubbling prevented there)
          // But if dropped on container empty space, we might want to move to end?
          // Current item-based reorder handles exact position.
          // Let's just return if it looks like a reorder to avoid file processing
          return;
        }

        // 2. Handle File/Folder Drop
        const items = Array.from(e.dataTransfer.items);
        const paths: string[] = [];

        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file && (file as any).path) paths.push((file as any).path);
          }
        }

        if (paths.length > 0) {
          const finalPaths: string[] = [];
          let scanFailures = 0;

          // Scan for folders
          for (const p of paths) {
            try {
              const expanded = await window.api?.scanDirectory(p);
              if (expanded && expanded.length > 0) {
                finalPaths.push(...expanded);
              }
            } catch (e) {
              console.error("Scan failed for", p, e);
              scanFailures += 1;
            }
          }

          if (finalPaths.length > 0) {
            addQueueItems(finalPaths, scanFailures);
          } else if (scanFailures > 0) {
            addQueueItems([], scanFailures);
          }
        }
      },
      [addQueueItems],
    );

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only trigger container effects for file drops, not internal reordering
        if (e.dataTransfer.types.includes("Files") && !isReordering) {
          e.dataTransfer.dropEffect = "copy";
        } else if (e.dataTransfer.types.includes("text/plain")) {
          e.dataTransfer.dropEffect = "move";
        }
      },
      [isReordering],
    );

    const resetEphemeralGlossarySelection = () => {
      if (!glossarySelectionEphemeralRef.current) return;
      glossarySelectionEphemeralRef.current = false;
      const globalGlossary = isRemoteModeRef.current
        ? ""
        : localStorage.getItem("config_glossary_path") || "";
      setGlossaryPath(globalGlossary);
    };

    const startTranslation = (
      inputPath: string,
      forceResume?: boolean,
      glossaryOverride?: string,
    ) => {
      setIsRunning(true);
      setDisplayElapsed(0);
      setDisplayRemaining(0);
      const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      activeRunIdRef.current = runId;
      localStartTimeRef.current = Date.now();
      // 重置 Ref 防止旧数据干扰
      lastBackendElapsedRef.current = 0;
      lastBackendUpdateRef.current = 0;
      hasReceivedProgressRef.current = false;

      if (chartRenderTimerRef.current !== null) {
        window.clearTimeout(chartRenderTimerRef.current);
        chartRenderTimerRef.current = null;
      }
      setChartData([]);
      chartHistoriesRef.current = { chars: [], tokens: [], vram: [], gpu: [] };
      setProgress({
        current: 0,
        total: 0,
        percent: 0,
        elapsed: 0,
        remaining: 0,
        speedLines: 0,
        speedChars: 0,
        speedEval: 0,
        speedGen: 0,
        retries: 0,
      });
      setPreviewBlocks({});
      setLastOutputPath("");
      localStorage.removeItem("last_preview_blocks"); // Clear persisted preview

      // Prefer in-memory queue config so modal edits apply immediately
      let customConfig: FileConfig = {};
      const item = queueRef.current.find((q) => q.path === inputPath);
      if (item?.config && !item.config.useGlobalDefaults) {
        customConfig = item.config;
      }
      const pickCustom = <T,>(customValue: T | undefined, globalValue: T): T =>
        customValue !== undefined ? customValue : globalValue;

      const normalizedChunkMode: "chunk" | "line" = "chunk";

      const resolveRulesFromProfile = (
        mode: "pre" | "post",
        profileId?: string,
      ) => {
        if (!profileId) return undefined;
        try {
          const raw = localStorage.getItem(`config_rules_${mode}_profiles`);
          if (!raw) return undefined;
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return undefined;
          const match = parsed.find((profile: any) => profile?.id === profileId);
          if (match && Array.isArray(match.rules)) {
            return match.rules;
          }
        } catch (e) {
          console.error("Failed to resolve rule profile:", e);
        }
        return undefined;
      };

      const resolvedPreRules = resolveRulesFromProfile(
        "pre",
        customConfig.rulesPreProfileId,
      );
      const resolvedPostRules = resolveRulesFromProfile(
        "post",
        customConfig.rulesPostProfileId,
      );

      // 根据 ctx 自动计算 chunk-size
      const ctxValue =
        customConfig.contextSize ??
        customConfig.ctxSize ??
        parseInt(localStorage.getItem("config_ctx") || "4096");
      // 公式：(ctx * 0.9 - 500) / 3.5 * 1.3
      //   - 0.9: 10% 安全余量，防止边界情况截断
      //   - 其余与原公式相同，保持经验验证的参数
      const calculatedChunkSize = Math.max(
        200,
        Math.min(3072, Math.floor(((ctxValue * 0.9 - 500) / 3.5) * 1.3)),
      );

      const effectiveModelPath = (
        isRemoteMode
          ? customConfig.remoteModel ||
          localStorage.getItem("config_remote_model") ||
          remoteModelPath ||
          ""
          : customConfig.model ||
          localStorage.getItem("config_model") ||
          modelPath ||
          ""
      ).trim();
      if (!effectiveModelPath && !isRemoteMode) {
        // Use custom AlertModal
        showAlert({
          title: t.dashboard.selectModelTitle,
          description: t.dashboard.selectModelDesc,
          variant: "warning",
        });
        window.api?.showNotification(
          t.dashboard.selectModelTitle,
          t.dashboard.selectModelDesc,
        );
        setIsRunning(false);
        activeRunIdRef.current = null;
        return;
      }

      const config = {
        gpuLayers:
          customConfig.gpuLayers !== undefined
            ? customConfig.gpuLayers
            : parseInt(localStorage.getItem("config_gpu") || "-1", 10) || -1,
        ctxSize: ctxValue.toString(),
        chunkSize: calculatedChunkSize.toString(),
        chunkMode: normalizedChunkMode,
        outputDir:
          customConfig.outputDir !== undefined
            ? customConfig.outputDir
            : localStorage.getItem("config_output_dir"),
        glossaryPath:
          customConfig.glossaryPath !== undefined
            ? customConfig.glossaryPath
            : glossaryOverride !== undefined
              ? glossaryOverride
              : glossaryPath,
        preset: pickCustom(customConfig.preset, promptPreset || "novel"),
        rulesPre: Array.isArray(resolvedPreRules)
          ? resolvedPreRules
          : JSON.parse(localStorage.getItem("config_rules_pre") || "[]"),
        rulesPost: Array.isArray(resolvedPostRules)
          ? resolvedPostRules
          : JSON.parse(localStorage.getItem("config_rules_post") || "[]"),

        // Device Mode
        deviceMode: pickCustom(
          customConfig.deviceMode,
          (localStorage.getItem("config_device_mode") || "auto") as
          | "auto"
          | "cpu",
        ),

        // Just ensure no style overrides causing issues here, actual display is in the JSX
        gpuDeviceId: pickCustom(
          customConfig.gpuDeviceId,
          localStorage.getItem("config_gpu_device_id") || "",
        ),
        // Quality Control Settings
        temperature:
          customConfig.temperature ??
          parseFloat(localStorage.getItem("config_temperature") || "0.7"),

        // Storage
        cacheDir: pickCustom(
          customConfig.cacheDir,
          localStorage.getItem("config_cache_dir") || "",
        ),

        // Config from UI
        lineCheck: pickCustom(
          customConfig.lineCheck,
          localStorage.getItem("config_line_check") !== "false",
        ),
        lineToleranceAbs: pickCustom(
          customConfig.lineToleranceAbs,
          parseInt(localStorage.getItem("config_line_tolerance_abs") || "10"),
        ),
        lineTolerancePct: pickCustom(
          customConfig.lineTolerancePct,
          parseInt(localStorage.getItem("config_line_tolerance_pct") || "20"),
        ),
        anchorCheck: pickCustom(
          customConfig.anchorCheck,
          localStorage.getItem("config_anchor_check") !== "false",
        ),
        anchorCheckRetries: pickCustom(
          customConfig.anchorCheckRetries,
          parseInt(localStorage.getItem("config_anchor_check_retries") || "1"),
        ),
        strictMode:
          pickCustom(
            customConfig.lineCheck,
            localStorage.getItem("config_line_check") !== "false",
          )
            ? pickCustom(
              customConfig.strictMode,
              localStorage.getItem("config_strict_mode") || "off",
            )
            : "off",
        repPenaltyBase:
          customConfig.repPenaltyBase ??
          parseFloat(localStorage.getItem("config_rep_penalty_base") || "1.0"),
        repPenaltyMax:
          customConfig.repPenaltyMax ??
          parseFloat(localStorage.getItem("config_rep_penalty_max") || "1.5"),
        repPenaltyStep: pickCustom(
          customConfig.repPenaltyStep,
          parseFloat(localStorage.getItem("config_rep_penalty_step") || "0.1"),
        ),
        maxRetries: pickCustom(
          customConfig.maxRetries,
          parseInt(localStorage.getItem("config_max_retries") || "3"),
        ),

        // Glossary Coverage Check (术语表覆盖率检测)
        coverageCheck: pickCustom(
          customConfig.coverageCheck,
          localStorage.getItem("config_coverage_check") !== "false", // 默认开启
        ),
        outputHitThreshold: pickCustom(
          customConfig.outputHitThreshold,
          parseInt(localStorage.getItem("config_output_hit_threshold") || "60"),
        ),
        cotCoverageThreshold: pickCustom(
          customConfig.cotCoverageThreshold,
          parseInt(localStorage.getItem("config_cot_coverage_threshold") || "80"),
        ),
        coverageRetries: pickCustom(
          customConfig.coverageRetries,
          parseInt(localStorage.getItem("config_coverage_retries") || "1"),
        ),

        // Incremental Translation (增量翻译)
        resume:
          forceResume !== undefined
            ? forceResume
            : pickCustom(
              customConfig.resume,
              localStorage.getItem("config_resume") === "true",
            ),

        // Dynamic Retry Strategy (动态重试策略)
        retryTempBoost: pickCustom(
          customConfig.retryTempBoost,
          parseFloat(localStorage.getItem("config_retry_temp_boost") || "0.1"),
        ),
        retryPromptFeedback: pickCustom(
          customConfig.retryPromptFeedback,
          localStorage.getItem("config_retry_prompt_feedback") !== "false",
        ),

        // Daemon Mode
        daemonMode: pickCustom(
          customConfig.daemonMode,
          localStorage.getItem("config_daemon_mode") === "true",
        ),
        remoteUrl: pickCustom(
          (customConfig as any).remoteUrl,
          remoteRuntime?.runtime?.session?.url ||
          localStorage.getItem("config_remote_url") ||
          "",
        ),
        apiKey: pickCustom(
          (customConfig as any).apiKey,
          localStorage.getItem("config_api_key") || "",
        ),

        // Concurrency
        concurrency:
          customConfig.concurrency ??
          parseInt(localStorage.getItem("config_concurrency") || "1"),
        flashAttn:
          customConfig.flashAttn !== undefined
            ? customConfig.flashAttn
            : localStorage.getItem("config_flash_attn") === "true",
        kvCacheType:
          customConfig.kvCacheType ??
          localStorage.getItem("config_kv_cache_type") ??
          "f16",
        useLargeBatch:
          customConfig.useLargeBatch !== undefined
            ? customConfig.useLargeBatch
            : localStorage.getItem("config_use_large_batch") === "true",
        physicalBatchSize: pickCustom(
          customConfig.physicalBatchSize,
          parseInt(localStorage.getItem("config_physical_batch_size") || "1024"),
        ),
        seed:
          customConfig.seed !== undefined
            ? customConfig.seed
            : localStorage.getItem("config_seed")
              ? parseInt(localStorage.getItem("config_seed")!)
              : undefined,

        // Chunk Balancing
        balanceEnable: pickCustom(
          customConfig.balanceEnable,
          localStorage.getItem("config_balance_enable") !== "false",
        ),
        balanceThreshold: pickCustom(
          customConfig.balanceThreshold,
          parseFloat(localStorage.getItem("config_balance_threshold") || "0.6"),
        ),
        balanceCount: pickCustom(
          customConfig.balanceCount,
          parseInt(localStorage.getItem("config_balance_count") || "3"),
        ),

        // Feature Flags
        alignmentMode:
          customConfig.alignmentMode !== undefined
            ? customConfig.alignmentMode
            : localStorage.getItem("config_alignment_mode") === "true",
        saveCot:
          customConfig.saveCot !== undefined
            ? customConfig.saveCot
            : localStorage.getItem("config_save_cot") === "true",
        modelPath: effectiveModelPath,
        remoteModel: isRemoteMode ? effectiveModelPath : undefined,
        executionMode: (isRemoteMode ? "remote" : "local") as "local" | "remote",
      };

      // Create history record
      const recordId = Date.now().toString();
      currentRecordIdRef.current = recordId;
      logsBufferRef.current = [];
      triggersBufferRef.current = [];
      llamaLogsBufferRef.current = [];

      // 重置远程信息(新任务开始)
      remoteInfoRef.current = null;

      const finalConfig = { ...config, highFidelity: undefined, outputDir: config.outputDir ?? undefined };
      progressDataRef.current = {
        total: 0,
        current: 0,
        lines: 0,
        chars: 0,
        sourceLines: 0,
        sourceChars: 0,
        outputPath: "",
        cacheDir: String(finalConfig.cacheDir || ""),
        cachePath: "",
        speeds: [],
      };
      const recordModelLabel =
        effectiveModelPath.split(/[/\\]/).pop() || effectiveModelPath;

      const newRecord: TranslationRecord = {
        id: recordId,
        fileName: inputPath.split("\\").join("/").split("/").pop() || inputPath,
        filePath: inputPath,
        modelName: recordModelLabel,
        startTime: new Date().toISOString(),
        status: "running",
        totalBlocks: 0,
        completedBlocks: 0,
        totalLines: 0,
        config: finalConfig,
        triggers: [],
        logs: [],
      };
      addRecord(newRecord);

      // Update local session state to match effective config for UI feedback
      setAlignmentMode(finalConfig.alignmentMode);
      setSaveCot(finalConfig.saveCot);

      window.api?.startTranslation(
        inputPath,
        effectiveModelPath,
        finalConfig,
        runId,
      );
    };

    // --- V2 Pipeline 启动 ---
    const startV2Translation = async (
      inputPath: string,
      forceResume?: boolean,
      glossaryOverride?: string,
    ) => {
      let customConfig: FileConfig = {};
      const item = queueRef.current.find((q) => q.path === inputPath);
      if (item?.config && !item.config.useGlobalDefaults) {
        customConfig = item.config;
      }

      const effectivePipelineId = (
        customConfig.v2PipelineId || v2PipelineId || ""
      ).trim();
      if (!effectivePipelineId) {
        showAlert({
          title: t.dashboard.selectPipelineTitle,
          description: t.dashboard.selectPipelineDesc,
          variant: "warning",
        });
        return;
      }

      setIsRunning(true);
      setDisplayElapsed(0);
      setDisplayRemaining(0);
      const runId = `v2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      activeRunIdRef.current = runId;
      localStartTimeRef.current = Date.now();
      lastBackendElapsedRef.current = 0;
      lastBackendUpdateRef.current = 0;
      hasReceivedProgressRef.current = false;

      if (chartRenderTimerRef.current !== null) {
        window.clearTimeout(chartRenderTimerRef.current);
        chartRenderTimerRef.current = null;
      }
      setChartData([]);
      chartHistoriesRef.current = { chars: [], tokens: [], vram: [], gpu: [] };
      setProgress({
        current: 0,
        total: 0,
        percent: 0,
        elapsed: 0,
        remaining: 0,
        speedLines: 0,
        speedChars: 0,
        speedEval: 0,
        speedGen: 0,
        retries: 0,
      });
      setPreviewBlocks({});
      setLastOutputPath("");
      localStorage.removeItem("last_preview_blocks");
      remoteInfoRef.current = null;

      const resolvedGlossaryPath =
        customConfig.glossaryPath !== undefined
          ? customConfig.glossaryPath
          : glossaryOverride !== undefined
            ? glossaryOverride
            : glossaryPath;
      const resolvedOutputDir =
        customConfig.outputDir !== undefined
          ? customConfig.outputDir
          : localStorage.getItem("config_output_dir") || "";
      const resolvedResume =
        forceResume !== undefined
          ? forceResume
          : customConfig.resume ??
          localStorage.getItem("config_resume") === "true";
      const resolvedCacheDir =
        customConfig.cacheDir !== undefined
          ? customConfig.cacheDir
          : localStorage.getItem("config_cache_dir") || "";
      progressDataRef.current = {
        total: 0,
        current: 0,
        lines: 0,
        chars: 0,
        sourceLines: 0,
        sourceChars: 0,
        outputPath: "",
        cacheDir: String(resolvedCacheDir || ""),
        cachePath: "",
        speeds: [],
      };

      const selectedProfile = v2Profiles.find(
        (p) => p.id === effectivePipelineId,
      );
      let pipelineName = selectedProfile?.name || effectivePipelineId;
      let providerName = selectedProfile?.providerName;
      let chunkType = selectedProfile?.chunkType;

      try {
        const pipelineProfile =
          await window.api?.pipelineV2ProfilesLoad?.(
            "pipeline",
            effectivePipelineId,
          );
        const pipelineData = pipelineProfile?.data;
        if (pipelineProfile?.name) {
          pipelineName = pipelineProfile.name;
        } else if (pipelineData?.name) {
          pipelineName = pipelineData.name;
        }
        if (pipelineData?.provider) {
          const providerProfile =
            await window.api?.pipelineV2ProfilesLoad?.(
              "api",
              String(pipelineData.provider),
            );
          providerName = providerProfile?.name || String(pipelineData.provider);
        }
        if (pipelineData?.chunk_policy) {
          const chunkProfile =
            await window.api?.pipelineV2ProfilesLoad?.(
              "chunk",
              String(pipelineData.chunk_policy),
            );
          const rawChunkType =
            chunkProfile?.data?.chunk_type ?? chunkProfile?.data?.type;
          const normalizedChunkType = normalizeChunkType(rawChunkType);
          if (normalizedChunkType) chunkType = normalizedChunkType;
        }
      } catch (e) {
        console.error("[Dashboard] Failed to resolve pipeline meta:", e);
      }

      const recordId = Date.now().toString();
      currentRecordIdRef.current = recordId;
      logsBufferRef.current = [];
      triggersBufferRef.current = [];
      llamaLogsBufferRef.current = [];

      const newRecord: TranslationRecord = {
        id: recordId,
        fileName: inputPath.split(/[/\\]/).pop() || inputPath,
        filePath: inputPath,
        startTime: new Date().toISOString(),
        status: "running",
        totalBlocks: 0,
        completedBlocks: 0,
        totalLines: 0,
        triggers: [],
        logs: [],
        engineVersion: "v2",
        config: {
          engineMode: "v2",
          v2PipelineId: effectivePipelineId,
          outputDir: resolvedOutputDir || undefined,
          cacheDir: resolvedCacheDir || undefined,
          resume: Boolean(resolvedResume),
        },
        v2Config: {
          pipelineId: effectivePipelineId,
          pipelineName,
          providerName,
          chunkType,
        },
      };
      addRecord(newRecord);

      const profilesDir = (await window.api?.pipelineV2ProfilesPath?.()) || "";
      const outputDir = resolvedOutputDir.trim();
      const cacheDir = resolvedCacheDir.trim();

      window.api?.pipelineV2Run?.({
        filePath: inputPath,
        pipelineId: effectivePipelineId,
        profilesDir,
        outputDir: outputDir || undefined,
        glossaryPath: resolvedGlossaryPath || undefined,
        resume: Boolean(resolvedResume),
        cacheDir: cacheDir || undefined,
      });
    };

    // --- State for Confirmation Modal ---
    const [confirmModal, setConfirmModal] = useState<{
      isOpen: boolean;
      file: string;
      path: string;
      onResume: () => void;
      onOverwrite: () => void;
      onSkip?: () => void;
      onStopAll?: () => void;
      onCancel: () => void;
    } | null>(null);

    const handleStartQueue = async () => {
      if (queue.length === 0) return;

      if (engineMode === "v2") {
        // V2 模式直接启动，不需要模型检查
        const inputPath = queue[0].path;
        await checkAndStartV2(inputPath, 0);
        return;
      }

      // V1 原有逻辑
      const targetIndex = 0;
      const inputPath = queue[targetIndex].path;
      await checkAndStart(inputPath, targetIndex);
    };

    useEffect(() => {
      if (!active || isRunning || queue.length === 0) return;
      if (localStorage.getItem(AUTO_START_QUEUE_KEY) === "true") {
        localStorage.removeItem(AUTO_START_QUEUE_KEY);
        handleStartQueue();
      }
    }, [active, isRunning, queue, handleStartQueue]);

    const checkAndStartV2 = async (inputPath: string, index: number) => {
      const queueItem = queueRef.current[index];
      const customConfig =
        queueItem?.config && !queueItem.config.useGlobalDefaults
          ? queueItem.config
          : undefined;
      const effectivePipelineId = (
        customConfig?.v2PipelineId || v2PipelineId || ""
      ).trim();
      if (!effectivePipelineId) {
        showAlert({
          title: t.dashboard.selectPipelineTitle,
          description: t.dashboard.selectPipelineDesc,
          variant: "warning",
        });
        return;
      }

      const outputDir =
        customConfig?.outputDir !== undefined
          ? customConfig.outputDir
          : localStorage.getItem("config_output_dir") || "";
      const config = {
        engineMode: "v2",
        outputDir: outputDir || undefined,
      };

      const checkResult = await window.api?.checkOutputFileExists(
        inputPath,
        config,
      );

      if (checkResult?.exists && checkResult.path) {
        setConfirmModal({
          isOpen: true,
          file: inputPath.split(/[/\\]/).pop() || inputPath,
          path: checkResult.path,
          onResume: () => {
            setConfirmModal(null);
            setCurrentQueueIndex(index);
            startV2Translation(inputPath, true);
          },
          onOverwrite: () => {
            setConfirmModal(null);
            setCurrentQueueIndex(index);
            startV2Translation(inputPath, false);
          },
          onSkip:
            index < queue.length - 1
              ? () => {
                setConfirmModal(null);
                checkAndStartV2(queue[index + 1].path, index + 1);
              }
              : undefined,
          onStopAll: () => {
            setConfirmModal(null);
            handleStop();
          },
          onCancel: () => {
            setConfirmModal(null);
            setIsRunning(false);
            setCurrentQueueIndex(-1);
          },
        });
      } else {
        setCurrentQueueIndex(index);
        startV2Translation(inputPath);
      }
    };

    const checkAndStart = async (inputPath: string, index: number) => {
      // ... (Duplicate config logic? Or refactor?)
      // Refactoring is cleaner.
      // But to minimize changes, I will implement a lightweight check using the same config loading.
      const queueItem = queueRef.current[index];
      const customConfig =
        queueItem?.config && !queueItem.config.useGlobalDefaults
          ? queueItem.config
          : undefined;
      const effectiveModelPath = (
        isRemoteMode
          ? customConfig?.remoteModel ||
          localStorage.getItem("config_remote_model") ||
          remoteModelPath ||
          ""
          : customConfig?.model ||
          modelPath ||
          localStorage.getItem("config_model") ||
          ""
      ).trim();

      const config = {
        // Minimal config needed for checkOutputFileExists
        outputDir:
          customConfig?.outputDir || localStorage.getItem("config_output_dir"),
        modelPath: effectiveModelPath, // 传递模型路径用于生成输出文件名
        remoteModel: isRemoteMode ? effectiveModelPath : undefined,
      };

      // --- Auto-Match Glossary Logic (Refined) ---
      let matchedGlossary = "";
      const inputName = inputPath
        .split(/[/\\]/)
        .pop()
        ?.split(".")
        .slice(0, -1)
        .join(".");
      if (inputName && preferredGlossaries.length > 0) {
        const match = preferredGlossaries.find((g) => g.matchKey === inputName);
        if (match && match.value !== glossaryPath) {
          matchedGlossary = match.value;
          setGlossaryPath(match.value);
          glossarySelectionEphemeralRef.current = true;
          window.api?.showNotification(
            t.glossaryView.autoMatchTitle,
            (t.glossaryView.autoMatchMsg || "").replace("{name}", match.label),
          );
        }
      }

      const checkResult = await window.api?.checkOutputFileExists(
        inputPath,
        config,
      );
      console.log("[checkAndStart] inputPath:", inputPath);
      console.log("[checkAndStart] config:", config);
      console.log("[checkAndStart] checkResult:", checkResult);

      if (checkResult?.exists && checkResult.path) {
        setConfirmModal({
          isOpen: true,
          file: inputPath.split(/[/\\]/).pop() || inputPath,
          path: checkResult.path,
          onResume: () => {
            setConfirmModal(null);
            setCurrentQueueIndex(index);
            // Pass matchedGlossary to override stale state
            startTranslation(inputPath, true, matchedGlossary || undefined);
          },
          onOverwrite: () => {
            setConfirmModal(null);
            setCurrentQueueIndex(index);
            startTranslation(inputPath, false, matchedGlossary || undefined);
          },
          onSkip:
            index < queue.length - 1
              ? () => {
                setConfirmModal(null);
                resetEphemeralGlossarySelection();
                checkAndStart(queue[index + 1].path, index + 1);
              }
              : undefined,
          onStopAll: () => {
            setConfirmModal(null);
            resetEphemeralGlossarySelection();
            handleStop();
          },
          onCancel: () => {
            setConfirmModal(null);
            setIsRunning(false);
            setCurrentQueueIndex(-1);
            resetEphemeralGlossarySelection();
          },
        });
      } else {
        setCurrentQueueIndex(index);
        startTranslation(inputPath, undefined, matchedGlossary || undefined);
      }
    };

    // Keep checkAndStartRef in sync for use in stale-closure contexts
    useEffect(() => {
      checkAndStartRef.current = (inputPath: string, index: number) => {
        if (engineModeRef.current === "v2") {
          return checkAndStartV2(inputPath, index);
        }
        return checkAndStart(inputPath, index);
      };
    });

    const handleStop = () => {
      console.log(`[Dashboard] User requested stop (mode=${engineModeRef.current})`);
      if (engineModeRef.current === "v2") {
        window.api?.pipelineV2Stop?.();
      } else {
        window.api?.stopTranslation();
      }
      // 立即更新 UI 状态(后端也会发送 process-exit 事件)
      setIsRunning(false);
      setCurrentQueueIndex(-1);
    };

    const requestStop = () => {
      if (!isRunning) return;
      showConfirm({
        title: t.dashboard.stopTitle,
        description: t.dashboard.stopDesc,
        variant: "warning",
        confirmText: t.dashboard.stopConfirm,
        cancelText: t.dashboard.stopCancel,
        onConfirm: () => handleStop(),
      });
    };

    const getOutputFileName = (path: string) => {
      const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return lastSep >= 0 ? path.slice(lastSep + 1) : path;
    };

    const getOutputDir = (path: string) => {
      const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return lastSep >= 0 ? path.slice(0, lastSep) : "";
    };

    const resolveCachePath = (outputPath: string, cacheDir?: string) => {
      if (!outputPath) return "";
      const dir = (cacheDir || "").trim();
      if (!dir) return `${outputPath}.cache.json`;
      const fileName = outputPath.split(/[/\\]/).pop() || outputPath;
      const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
      const prefix =
        dir.endsWith("\\") || dir.endsWith("/") ? dir : `${dir}${sep}`;
      return `${prefix}${fileName}.cache.json`;
    };

    const handleOpenOutput = async (mode: "file" | "folder") => {
      if (!lastOutputPath) return;
      try {
        if (mode === "file") {
          const result = await window.api?.openPath?.(lastOutputPath);
          if (result) {
            showAlert({
              title: t.dashboard.outputOpenFailTitle,
              description: t.dashboard.outputOpenFailDesc,
              variant: "warning",
            });
          }
        } else {
          const folder = getOutputDir(lastOutputPath) || lastOutputPath;
          const ok = await window.api?.openFolder?.(folder);
          if (!ok) {
            showAlert({
              title: t.dashboard.outputOpenFailTitle,
              description: t.dashboard.outputOpenFailDesc,
              variant: "warning",
            });
          }
        }
      } catch (e) {
        showAlert({
          title: t.dashboard.outputOpenFailTitle,
          description: `${t.dashboard.outputOpenFailDesc} ${String(e)}`,
          variant: "warning",
        });
      }
    };

    const formatTime = (sec: number) => {
      if (sec < 60) return `${Math.round(sec)}s`;
      const m = Math.floor(sec / 60);
      const s = Math.round(sec % 60);
      return `${m}m ${s}s`;
    };

    // 高亮同一行中左右对应的共同汉字
    const highlightLineCommonCJK = (
      text: string,
      compareText: string,
      isSource: boolean,
    ) => {
      // Strip backend warning tags from display text
      // These tags might be inserted by backend for debugging/warning purposes
      // Tags to strip: line_mismatch, high_similarity, kana_residue, etc.
      // Assuming they appear as plain text or wrapped in < > or similar in the log but here they seem to be just the text.
      // Based on screenshot, they are rendered as badges. Wait, if they are rendered as badges, SOMETHING is rendering them as badges.
      // If `highlightLineCommonCJK` returns <span>...</span>, then it's just text.
      // The badges in the screenshot look like separate React components or styled spans.
      // I will strip the raw text strings: "line_mismatch", "high_similarity", "kana_residue"
      // Regex: /\b(line_mismatch|high_similarity|kana_residue|glossary_missed)\b/g

      text = text.replace(
        /(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g,
        "",
      );

      if (!compareText) return text;

      const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

      // 构建比较字符集(包含异体字)
      const compareChars = new Set<string>();
      const matches = compareText.match(cjkRegex);
      if (matches) {
        for (const char of matches) {
          // 添加原始字符和所有异体字
          compareChars.add(char);
          const variants = getVariants(char);
          if (variants) {
            variants.forEach((v: string) => compareChars.add(v));
          }
        }
      }

      if (compareChars.size === 0) return text;

      const parts: { text: string; highlight: boolean }[] = [];
      let current = "";
      let inHighlight = false;

      for (const char of text) {
        // 检查字符是否在比较集中(包含异体字)
        const isCJK = cjkRegex.test(char);
        cjkRegex.lastIndex = 0;

        let isCommonCJK = false;
        if (isCJK) {
          if (compareChars.has(char)) {
            isCommonCJK = true;
          } else {
            // 检查当前字符的异体字是否在比较集中
            const charVariants = getVariants(char);
            if (charVariants) {
              for (const v of charVariants) {
                if (compareChars.has(v)) {
                  isCommonCJK = true;
                  break;
                }
              }
            }
          }
        }

        if (isCommonCJK !== inHighlight) {
          if (current) parts.push({ text: current, highlight: inHighlight });
          current = char;
          inHighlight = isCommonCJK;
        } else {
          current += char;
        }
      }
      if (current) parts.push({ text: current, highlight: inHighlight });

      return (
        <>
          {parts.map((part, i) =>
            part.highlight ? (
              <span
                key={i}
                className={
                  isSource
                    ? "bg-blue-500/30 text-blue-400 font-semibold"
                    : "bg-purple-500/30 text-purple-400 font-semibold"
                }
              >
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </>
      );
    };

    // 块级对齐预览渲染 (Block-Aligned)
    const renderBlockAlignedPreview = () => {
      const blocks = Object.entries(previewBlocks).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      );

      // 恢复总统计信息
      let totalSrcLines = 0;
      let totalOutLines = 0;
      blocks.forEach(([_, data]) => {
        const srcDisplay = stripSystemMarkersForDisplay(data.src || "");
        const outDisplay = stripSystemMarkersForDisplay(data.output || "");
        totalSrcLines += srcDisplay
          .split(/\r?\n/)
          .filter((l) => l.trim()).length;
        totalOutLines += outDisplay
          .split(/\r?\n/)
          .filter((l) => l.trim()).length;
      });
      const lineCountMismatch =
        totalSrcLines !== totalOutLines && totalOutLines > 0;

      if (blocks.length === 0) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50 italic">
            {t.dashboard.waiting}
          </div>
        );
      }

      let globalLineCount = 0;

      return (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* 表头 (恢复统计信息) */}
          <div className="flex border-b border-border shrink-0">
            <div className="w-10 shrink-0 border-r border-border/20" />
            <div className="flex-1 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/10 border-r border-border/30 flex items-center gap-2">
              {t.dashboard.source}{" "}
              <span className="text-[9px] font-normal opacity-60">
                ({totalSrcLines} {t.dashboard.lines})
              </span>
            </div>
            <div className="flex-1 px-3 py-2 text-[10px] font-bold text-primary uppercase tracking-wider bg-primary/5 flex items-center gap-2">
              {t.dashboard.target}{" "}
              <span className="text-[9px] font-normal opacity-60">
                ({totalOutLines} {t.dashboard.lines})
              </span>
              {lineCountMismatch && (
                <span className="text-[8px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
                  {t.dashboard.lineMismatch}
                </span>
              )}
            </div>
          </div>

          {/* 内容区 */}
          <div ref={srcPreviewRef} className="flex-1 overflow-y-auto">
            {blocks.map(([blockId, data]) => {
              // 使用单换行分割，因为 raw text 这里的换行就是行分隔
              const srcDisplay = stripSystemMarkersForDisplay(data.src || "");
              const outDisplay = stripSystemMarkersForDisplay(
                data.output || "",
              );
              const sLines = srcDisplay.split(/\r?\n/).filter((l) => l.trim());
              const oLines = outDisplay.split(/\r?\n/).filter((l) => l.trim());
              const maxL = Math.max(sLines.length, oLines.length);

              return (
                <div
                  key={blockId}
                  className="border-b border-border/40 relative group/block"
                >
                  {/* 显式 Block 编号标记 */}
                  <div className="sticky top-0 left-0 z-20 pointer-events-none opacity-50 group-hover/block:opacity-100 transition-opacity">
                    <span className="inline-block bg-muted/80 backdrop-blur text-[9px] text-muted-foreground px-1.5 py-0.5 rounded-br border-r border-b border-border/30 font-mono">
                      # {blockId}
                    </span>
                  </div>
                  <div className="sticky top-0 left-0 right-0 h-px bg-primary/5 z-10" />
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/0 group-hover/block:bg-primary/20 transition-colors" />

                  {Array.from({ length: maxL }).map((_, i) => {
                    globalLineCount++;
                    const srcLine = sLines[i] || "";
                    const outLine = oLines[i] || "";

                    // 警告检查
                    let warning = null;
                    if (outLine.includes("line_mismatch"))
                      warning = {
                        msg: t.dashboard.lineMismatch || "Line Mismatch",
                      };
                    if (outLine.includes("high_similarity"))
                      warning = {
                        msg: t.dashboard.similarityWarn || "High Similarity",
                      };
                    if (outLine.includes("glossary_missed"))
                      warning = { msg: "Glossary Missed" };

                    return (
                      <div
                        key={i}
                        className={`flex border-b border-border/5 hover:bg-muted/5 transition-colors ${!srcLine ? "bg-blue-500/5" : ""}`}
                      >
                        {/* 行号 */}
                        <div className="w-10 shrink-0 text-[10px] text-right pr-2 py-3 select-none text-muted-foreground/30 font-mono relative">
                          {globalLineCount}
                          {warning && (
                            <div
                              className="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-help"
                              title={warning.msg}
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-500 animate-pulse" />
                            </div>
                          )}
                        </div>
                        {/* 原文 */}
                        <div className="flex-1 px-4 py-3 text-sm leading-[1.75] border-r border-border/20 text-muted-foreground/80 break-words whitespace-pre-wrap">
                          {srcLine ? (
                            highlightLineCommonCJK(srcLine, outLine, true)
                          ) : (
                            <span className="text-muted-foreground/20">—</span>
                          )}
                        </div>
                        {/* 译文 (恢复原背景色) */}
                        <div className="flex-1 px-4 py-3 text-sm leading-[1.75] font-medium text-foreground break-words whitespace-pre-wrap bg-primary/[0.03]">
                          {outLine ? (
                            highlightLineCommonCJK(outLine, srcLine, false)
                          ) : (
                            <span className="text-blue-500/30 italic text-xs">
                              ...
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div ref={outPreviewRef} />
          </div>
        </div>
      );
    };

    const needsModel = engineMode === "v1" && activeModelsCount === 0;
    const needsV2Pipeline = engineMode === "v2" && !v2PipelineId;
    const canStart = queue.length > 0 && !isRunning;
    const statusText = isRunning
      ? `${t.dashboard.processing} ${currentQueueIndex + 1}/${queue.length}`
      : needsModel
        ? t.dashboard.selectModelWarn
        : queue.length === 0
          ? t.dashboard.emptyQueueHint
          : t.dashboard.startHint;
    const outputFileName = lastOutputPath
      ? getOutputFileName(lastOutputPath)
      : "";
    const displayedLogs = logs.filter(
      (log) =>
        !log.includes("STDERR") &&
        !log.includes("ggml") &&
        !log.includes("llama_"),
    );
    const remoteErrorMessage = isRemoteMode
      ? remoteRuntime?.lastError ||
      remoteRuntime?.network?.lastError?.message ||
      (remoteRuntime?.network?.errorCount
        ? t.dashboard.remoteErrorFallback
        : "")
      : "";
    const hasRemoteError = Boolean(remoteErrorMessage);
    const runNoticeConfig = runNotice
      ? {
        success: {
          className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600",
          icon: CheckCircle2,
        },
        warning: {
          className: "bg-amber-500/10 border-amber-500/30 text-amber-600",
          icon: AlertTriangle,
        },
        error: {
          className: "bg-red-500/10 border-red-500/30 text-red-600",
          icon: AlertTriangle,
        },
      }[runNotice.type]
      : null;
    const queueNoticeConfig = queueNotice
      ? {
        success: {
          className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600",
          icon: CheckCircle2,
        },
        warning: {
          className: "bg-amber-500/10 border-amber-500/30 text-amber-600",
          icon: AlertTriangle,
        },
        info: {
          className: "bg-blue-500/10 border-blue-500/30 text-blue-600",
          icon: Info,
        },
      }[queueNotice.type]
      : null;
    const failedCount = queue.filter((item) => item.status === "failed").length;
    const completedCount = queue.filter((item) => item.status === "completed").length;
    const queueSummary = t.dashboard.queueSummary
      .replace("{failed}", String(failedCount))
      .replace("{completed}", String(completedCount));
    const activeConfirmModal = confirmModal;

    return (
      <div
        ref={containerRef}
        className="flex-1 h-full min-h-0 flex flex-col bg-background overflow-hidden relative"
      >
        <div className="flex-1 p-4 flex gap-4 overflow-hidden min-h-0">
          <div
            className={`${queueCollapsed ? "w-[50px]" : "w-[200px]"} shrink-0 flex flex-col bg-card rounded-2xl shadow-lg border border-border overflow-hidden transition-all duration-300`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div
              className="p-3 border-b border-border bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
              onClick={() => setQueueCollapsed(!queueCollapsed)}
            >
              <h3 className="font-bold text-foreground flex items-center gap-2 text-sm">
                <Layers className="w-4 h-4 text-primary" />
                {!queueCollapsed && (
                  <>
                    <span>{t.dashboard.queue}</span>
                    <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium">
                      {queue.length}
                    </span>
                  </>
                )}
              </h3>
            </div>
            {!queueCollapsed && (
              <>
                <div className="p-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddFiles}
                      className="flex-1 text-xs h-9"
                    >
                      <Plus className="w-3 h-3 mr-1" /> {t.dashboard.addFiles}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddFolder}
                      className="flex-1 text-xs h-9"
                    >
                      <FolderPlus className="w-3 h-3 mr-1" />{" "}
                      {t.dashboard.addFolder}
                    </Button>
                  </div>
                </div>
                {queueNotice && queueNoticeConfig && (() => {
                  const NoticeIcon = queueNoticeConfig.icon;
                  return (
                    <div className="px-3 pb-2">
                      <div
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${queueNoticeConfig.className}`}
                      >
                        <NoticeIcon className="w-3.5 h-3.5 mt-0.5" />
                        <span className="flex-1 leading-relaxed">
                          {queueNotice.message}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQueueNotice(null)}
                          className="ml-auto text-current/70 hover:text-current"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <div className="px-3 pb-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{queueSummary}</span>
                    <div className="flex items-center gap-1">
                      <UITooltip content={t.dashboard.retryFailed}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={handleRetryFailed}
                          disabled={failedCount === 0 || isRunning}
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      </UITooltip>
                      <UITooltip content={t.dashboard.clearCompleted}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={handleClearCompletedOnly}
                          disabled={completedCount === 0 || isRunning}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </UITooltip>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 relative">
                  {queue.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm px-4 text-center">
                      <FolderOpen className="w-12 h-12 mb-3 opacity-20" />
                      <p className="font-medium text-muted-foreground">
                        {t.dashboard.dragDrop}
                      </p>
                      <p className="text-xs mt-2 text-muted-foreground/70">
                        {t.dashboard.supportedTypes}
                      </p>
                    </div>
                  ) : (
                    queue.map((item, i) => (
                      <div
                        key={item.id}
                        ref={
                          i === currentQueueIndex ? activeQueueItemRef : null
                        }
                        className={`flex items-center gap-2 p-2.5 rounded-lg text-xs group transition-all 
                                                ${i === currentQueueIndex
                            ? "bg-primary/20 text-primary shadow-sm ring-1 ring-primary/20"
                            : completedFiles.has(
                              item.path,
                            )
                              ? "bg-secondary/30 text-muted-foreground opacity-60 hover:opacity-100"
                              : "hover:bg-secondary"
                          }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isRunning) return;

                          const sourceIndexStr =
                            e.dataTransfer.getData("text/plain");
                          if (sourceIndexStr === "") return;
                          const sourceIndex = parseInt(sourceIndexStr);
                          if (isNaN(sourceIndex) || sourceIndex === i) return;

                          const newQueue = [...queue];
                          const [movedItem] = newQueue.splice(sourceIndex, 1);
                          newQueue.splice(i, 0, movedItem);
                          setQueue(newQueue);

                          // Sync current selection if needed
                          if (sourceIndex === currentQueueIndex) {
                            setCurrentQueueIndex(i);
                          } else if (
                            sourceIndex < currentQueueIndex &&
                            i >= currentQueueIndex
                          ) {
                            setCurrentQueueIndex(currentQueueIndex - 1);
                          } else if (
                            sourceIndex > currentQueueIndex &&
                            i <= currentQueueIndex
                          ) {
                            setCurrentQueueIndex(currentQueueIndex + 1);
                          }
                        }}
                      >
                        <div
                          className={`p-1 shrink-0 transition-colors ${isRunning ? "opacity-10 cursor-not-allowed" : "cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-foreground"}`}
                          draggable={!isRunning}
                          onDragStart={(e) => {
                            if (isRunning) {
                              e.preventDefault();
                              return;
                            }
                            setIsReordering(true);
                            e.dataTransfer.setData("text/plain", i.toString());
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setIsReordering(false)}
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                        {i === currentQueueIndex && isRunning ? (
                          <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin shrink-0" />
                        ) : (
                          <div className="relative shrink-0">
                            <FileIcon type={item.fileType} />
                            {(completedFiles.has(item.path) ||
                              (currentQueueIndex > 0 &&
                                i < currentQueueIndex)) && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full ring-1 ring-background" />
                              )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="truncate font-medium">
                            {item.fileName}
                          </span>
                          <UITooltip
                            content={
                              <span className="font-mono text-xs">
                                {item.path}
                              </span>
                            }
                          >
                            <span className="truncate text-[10px] opacity-50 cursor-pointer hover:opacity-100 hover:text-foreground transition-opacity">
                              {item.path}
                            </span>
                          </UITooltip>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfigItem(item);
                          }}
                          disabled={isRunning}
                        >
                          <Settings
                            className={`w-3 h-3 ${isRunning ? "text-muted-foreground/50" : "text-muted-foreground hover:text-primary"}`}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-6 h-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(i);
                          }}
                          disabled={isRunning}
                        >
                          <X
                            className={`w-3 h-3 ${isRunning ? "text-muted-foreground/50" : "text-muted-foreground hover:text-red-500"}`}
                          />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                {queue.length > 0 && (
                  <div className="p-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearQueue}
                      disabled={isRunning}
                      className={`w-full text-[10px] font-bold text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-md h-7 border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Trash2 className="w-3 h-3 mr-1 opacity-50 group-hover:opacity-100" />{" "}
                      {t.dashboard.clear}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* CENTER: Stats & Progress */}
          <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0">
            {/* Hardware Monitor */}
            <HardwareMonitorBar data={monitorData} lang={lang} />

            {hasRemoteError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="text-xs text-red-600 leading-relaxed">
                  <div className="font-semibold">{t.dashboard.remoteErrorTitle}</div>
                  <div className="mt-1">{remoteErrorMessage}</div>
                  <div className="mt-1 text-red-500/80">{t.dashboard.remoteErrorHint}</div>
                </div>
              </div>
            )}


            {/* Model Warning (V1 only) */}
            {needsModel && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-500 text-sm">
                    {t.dashboard.modelMissing}
                  </p>
                  <p className="text-xs text-amber-400 mt-1">
                    {t.dashboard.modelMissingMsg}
                  </p>
                </div>
              </div>
            )}

            {/* API翻译方案 Warning */}
            {needsV2Pipeline && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-500 text-sm">
                    {lang === "en" ? "No API Plan Selected" : "未选择 API 翻译方案"}
                  </p>
                  <p className="text-xs text-amber-400 mt-1">
                    {lang === "en" ? "Please create and select an API translation plan in the API Manager." : "请先在「API 管理」中创建并选择一个翻译方案。"}
                  </p>
                </div>
              </div>
            )}

            {errorDigest && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-red-600">
                    {errorDigest.title}
                  </div>
                  <div className="text-red-500/80 mt-1 line-clamp-2">
                    {errorDigest.message}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorDigest(null)}
                  className="text-red-500/70 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {runNotice && runNoticeConfig && (() => {
              const NoticeIcon = runNoticeConfig.icon;
              return (
                <div
                  className={`rounded-xl border p-3 flex items-start gap-2 ${runNoticeConfig.className}`}
                >
                  <NoticeIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed flex-1">
                    <div className="font-semibold">{runNotice.message}</div>
                    {lastOutputPath && !isRunning && (
                      <div className="mt-1 text-[10px] text-current/70">
                        {t.dashboard.outputPathLabel}: {outputFileName}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRunNotice(null)}
                    className="ml-auto text-current/70 hover:text-current"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })()}

            {/* Config Row - Compact Property Bar Style */}
            <div className={`grid gap-2 shrink-0 ${engineMode === "v2" ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 xl:grid-cols-3"}`}>
              {/* Card 1: 本地模式=Model / API模式=翻译方案 */}
              {engineMode === "v2" ? (
                <div
                  className={`bg-card/80 hover:bg-card px-3 py-2 rounded-lg border flex items-center gap-3 transition-all cursor-pointer ${!v2PipelineId ? "border-amber-500/50 ring-1 ring-amber-500/20" : "border-border/50 hover:border-border"}`}
                >
                  <UITooltip content={lang === "en" ? "Switch to Local Mode" : "切换到本地翻译模式"}>
                    <div
                      onClick={() => setEngineMode("v1")}
                      className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white cursor-pointer hover:scale-110 transition-transform relative"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span className="absolute -top-1 -right-1 text-[7px] bg-violet-500 text-white px-0.5 rounded font-bold leading-tight">API</span>
                    </div>
                  </UITooltip>
                  <div className="flex-1 min-w-0">
                    <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">{lang === "en" ? "API Translation Plan" : "API 翻译方案"}</span>
                    <select
                      className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5"
                      value={v2PipelineId}
                      onChange={(e) => setV2PipelineId(e.target.value)}
                    >
                      <option value="">{lang === "en" ? "Select plan..." : "请选择方案..."}</option>
                      {v2Profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.providerName ? ` (${p.providerName})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
                </div>
              ) : (
                <div
                  className={`bg-card/80 hover:bg-card px-3 py-2 rounded-lg border flex items-center gap-3 transition-all cursor-pointer ${!activeModelPath && activeModelsCount > 0 ? "border-amber-500/50 ring-1 ring-amber-500/20" : "border-border/50 hover:border-border"}`}
                >
                  <UITooltip content={lang === "en" ? "Switch to API Mode" : "切换到 API 翻译模式"}>
                    <div
                      onClick={() => setEngineMode("v2")}
                      className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white cursor-pointer hover:scale-110 transition-transform relative"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span className="absolute -top-1 -right-1 text-[7px] bg-blue-500 text-white px-0.5 rounded font-bold leading-tight">{lang === "en" ? "Local" : "本地"}</span>
                    </div>
                  </UITooltip>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
                        {t.dashboard.modelLabel}
                      </span>
                      {!isRemoteMode && modelInfo && (
                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                          <span className="bg-secondary/50 px-1 py-0.5 rounded font-mono">
                            {modelInfo.paramsB || "--"}B
                          </span>
                          <span className="bg-secondary/50 px-1 py-0.5 rounded font-mono">
                            {modelInfo.quant || "--"}
                          </span>
                          <span
                            className={`px-1 py-0.5 rounded font-mono ${modelInfo.estimatedVramGB > 8 ? "text-amber-500 bg-amber-500/10" : "text-emerald-500 bg-emerald-500/10"}`}
                          >
                            {modelInfo.estimatedVramGB || "--"}G
                          </span>
                        </div>
                      )}
                      {isRemoteMode && selectedRemoteInfo?.sizeGb && (
                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                          <span className="bg-secondary/50 px-1 py-0.5 rounded font-mono">
                            {selectedRemoteInfo.sizeGb.toFixed(2)}GB
                          </span>
                        </div>
                      )}
                    </div>
                    <select
                      className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5"
                      value={activeModelPath}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        if (isRemoteMode) {
                          setRemoteModelPath(nextValue);
                          localStorage.setItem("config_remote_model", nextValue);
                        } else {
                          setModelPath(nextValue);
                          localStorage.setItem("config_model", nextValue);
                        }
                      }}
                    >
                      <option value="">
                        {activeModelsCount > 0
                          ? t.dashboard.selectModel
                          : t.dashboard.noModel}
                      </option>
                      {isRemoteMode
                        ? remoteModels.map((model) => (
                          <option key={model.path} value={model.path}>
                            {model.name}
                          </option>
                        ))
                        : [...models]
                          .sort((a, b) => {
                            const paramsA = modelsInfoMap[a]?.paramsB ?? Infinity;
                            const paramsB = modelsInfoMap[b]?.paramsB ?? Infinity;
                            if (paramsA !== paramsB) return paramsA - paramsB;
                            const sizeA = modelsInfoMap[a]?.sizeGB ?? Infinity;
                            const sizeB = modelsInfoMap[b]?.sizeGB ?? Infinity;
                            return sizeA - sizeB;
                          })
                          .map((m) => (
                            <option key={m} value={m}>
                              {m.replace(".gguf", "")}
                            </option>
                          ))}
                    </select>
                  </div>
                  <div
                    title={t.modelView.refresh || "Refresh"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isRemoteMode) {
                        fetchRemoteModels();
                      } else {
                        fetchData();
                      }
                    }}
                    className="p-1 hover:bg-muted rounded-full cursor-pointer transition-colors z-10 mr-1 group/refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground group-hover/refresh:text-primary transition-colors" />
                  </div>
                  <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
                </div>
              )}
              {/* Card 2: Prompt Preset (V1 only) */}
              {engineMode !== "v2" && (
                <div className="bg-card/80 hover:bg-card px-3 py-2 rounded-lg border border-border/50 hover:border-border flex items-center gap-3 transition-all cursor-pointer">
                  <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
                      Prompt Preset
                    </span>
                    <select
                      className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5"
                      value={promptPreset}
                      onChange={(e) => handlePromptPresetChange(e.target.value)}
                    >
                      <option value="novel">{presetOptionLabel("novel")}</option>
                      <option value="script">
                        {presetOptionLabel("script")}
                      </option>
                      <option value="short">{presetOptionLabel("short")}</option>
                    </select>
                  </div>
                  <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
                </div>
              )}
              {/* Card 3: Glossary (always visible) */}
              <div className="bg-card/80 hover:bg-card px-3 py-2 rounded-lg border border-border/50 hover:border-border flex items-center gap-3 transition-all cursor-pointer">
                <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white">
                  <BookOpen className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
                    {t.dashboard.glossaryLabel}
                  </span>
                  <select
                    className="w-full bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer truncate -ml-0.5"
                    value={glossaryPath}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setGlossaryPath(nextValue);
                      const globalGlossary = isRemoteMode
                        ? ""
                        : localStorage.getItem("config_glossary_path") || "";
                      glossarySelectionEphemeralRef.current = nextValue !== globalGlossary;
                    }}
                  >
                    <option value="">{t.none}</option>
                    {preferredGlossaries.map((g) => (
                      <option key={`${g.label}-${g.value}`} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-40" />
              </div>
            </div>

            {/* Monitor Dashboard - Professional LLM Style */}
            <div className="flex flex-col lg:flex-row gap-3 shrink-0 bg-secondary/20 rounded-xl p-3 border border-border/30">
              {/* Left: Stats Grid (35%) - 2x2 Layout */}
              <div className="lg:w-[35%] grid grid-cols-2 gap-2.5">
                {/* Time Module */}
                <div className="bg-card rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      {t.dashboard.time}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground font-semibold">
                        {t.dashboard.elapsed}
                      </span>
                      <span className="text-lg font-black text-foreground font-mono">
                        {formatTime(displayElapsed)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground/70">
                        {t.dashboard.remaining}
                      </span>
                      <span className="text-base font-bold text-muted-foreground font-mono">
                        {formatTime(displayRemaining)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Module */}
                <div className="bg-card rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide shrink-0">
                      {t.dashboard.progress}
                    </span>
                    {progress.retries > 0 && (
                      <span className="ml-auto text-[10px] font-bold text-amber-500 animate-pulse bg-amber-500/10 px-1 py-0.5 rounded whitespace-nowrap border border-amber-500/20">
                        {t.dashboard.retries}: {progress.retries}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-lg font-black text-foreground font-mono">
                      {progress.current}/{progress.total}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-primary">
                        {(progress.percent || 0).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-secondary/50 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                      style={{ width: `${progress.percent || 0}%` }}
                    />
                  </div>
                </div>

                {/* Speed Module */}
                <div className="bg-card rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-purple-500" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      {t.dashboard.speed}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground font-semibold">
                        {t.dashboard.chars}
                      </span>
                      <span className="text-lg font-black text-foreground font-mono">
                        {progress.speedChars || 0}
                        <span className="text-xs text-muted-foreground ml-0.5">
                          /s
                        </span>
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground/70">
                        {t.dashboard.lines}
                      </span>
                      <span className="text-base font-bold text-muted-foreground font-mono">
                        {progress.speedLines || 0}
                        <span className="text-xs text-muted-foreground/70 ml-0.5">
                          /s
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Token Module */}
                <div className="bg-card rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-4 h-4 text-sm font-black text-emerald-500 flex items-center justify-center">
                      T
                    </span>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      Token
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground font-semibold">
                        {t.dashboard.generate}
                      </span>
                      <span className="text-lg font-black text-foreground font-mono">
                        {progress.speedGen || 0}
                        <span className="text-xs text-muted-foreground ml-0.5">
                          t/s
                        </span>
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground/70">
                        {t.dashboard.evaluate}
                      </span>
                      <span className="text-base font-bold text-muted-foreground font-mono">
                        {(
                          (progress.speedGen || 0) + (progress.speedEval || 0)
                        ).toFixed(1)}
                        <span className="text-xs text-muted-foreground/70 ml-0.5">
                          t/s
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Enhanced Speed Chart (65%) */}
              <div className="lg:w-[65%] bg-card rounded-lg border border-border/50 overflow-hidden flex flex-col">
                <div className="py-1.5 px-3 border-b border-border/30 shrink-0 flex items-center justify-between">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                    {t.dashboard.speedChart}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select
                        value={chartMode}
                        onChange={(e) => setChartMode(e.target.value as any)}
                        className="appearance-none bg-accent/50 border border-border/50 rounded px-2 py-0.5 text-[9px] font-medium text-foreground pr-5 focus:outline-none hover:bg-accent cursor-pointer"
                      >
                        <option value="chars">{t.dashboard.charPerSec}</option>
                        <option value="tokens">Tokens/s</option>
                        <option value="vram">VRAM %</option>
                        <option value="gpu">GPU %</option>
                      </select>
                      <ChevronDown className="w-2.5 h-2.5 absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                {/* 固定高度容器，彻底解决 ResponsiveContainer 的 0 尺寸报错 */}
                <div
                  style={{
                    width: "100%",
                    flex: 1,
                    position: "relative",
                    minHeight: "180px",
                  }}
                >
                  {active && chartData.length > 0 ? (
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={100}
                      minHeight={100}
                    >
                      <AreaChart
                        data={chartData}
                        margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorSpeedGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={
                                chartMode === "vram" || chartMode === "gpu"
                                  ? "#f59e0b"
                                  : chartMode === "tokens"
                                    ? "#10b981"
                                    : "#8b5cf6"
                              }
                              stopOpacity={0.4}
                            />
                            <stop
                              offset="50%"
                              stopColor={
                                chartMode === "vram" || chartMode === "gpu"
                                  ? "#fbbf24"
                                  : chartMode === "tokens"
                                    ? "#34d399"
                                    : "#a78bfa"
                              }
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="100%"
                              stopColor={
                                chartMode === "vram" || chartMode === "gpu"
                                  ? "#fde68a"
                                  : chartMode === "tokens"
                                    ? "#6ee7b7"
                                    : "#c4b5fd"
                              }
                              stopOpacity={0.05}
                            />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" hide />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(37, 37, 53, 0.95)",
                            borderRadius: "10px",
                            border: `1px solid ${chartMode === "vram" || chartMode === "gpu" ? "rgba(245, 158, 11, 0.3)" : chartMode === "tokens" ? "rgba(16, 185, 129, 0.3)" : "rgba(139, 92, 246, 0.3)"}`,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                            color: "#cdd6f4",
                            fontSize: "11px",
                            padding: "8px 12px",
                          }}
                          formatter={(value: any) => [
                            `${value} ${chartMode === "vram" || chartMode === "gpu" ? "%" : chartMode === "tokens" ? "t/s" : t.dashboard.charPerSec}`,
                            chartMode === "vram"
                              ? "VRAM"
                              : chartMode === "gpu"
                                ? "GPU"
                                : chartMode === "tokens"
                                  ? "Token Speed"
                                  : t.dashboard.speed,
                          ]}
                          labelFormatter={() => ""}
                        />
                        <Area
                          type="monotone"
                          dataKey="speed"
                          stroke={
                            chartMode === "vram" || chartMode === "gpu"
                              ? "#f59e0b"
                              : chartMode === "tokens"
                                ? "#10b981"
                                : "#8b5cf6"
                          }
                          strokeWidth={2}
                          fill="url(#colorSpeedGradient)"
                          isAnimationActive={false}
                        />
                        <Brush
                          dataKey="time"
                          height={12}
                          stroke="rgba(120, 120, 120, 0.15)"
                          fill="transparent"
                          tickFormatter={() => ""}
                          travellerWidth={6}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 text-[10px] space-y-1">
                      <Zap className="w-5 h-5 opacity-20" />
                      <span>Ready for Speed Tracking</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Preview Area (Line-Aligned Mode) */}
            <div className="flex-1 bg-card rounded-2xl border border-border overflow-hidden flex flex-col shadow-sm min-h-[240px] 2xl:min-h-[300px]">
              <div className="p-3 px-5 border-b border-border flex justify-between items-center bg-muted/20">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-primary" />{" "}
                  {t.dashboard.previewTitle}
                </h3>
              </div>
              {renderBlockAlignedPreview()}
            </div>
          </div>
        </div>

        {/* BOTTOM: Control Bar + Logs Drawer */}
        <div
          className={`${logsCollapsed ? "h-[50px]" : "h-[180px]"} shrink-0 bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 flex flex-col`}
        >
          <div className="h-[50px] px-4 flex items-center justify-between shrink-0 border-b border-border/30">
            <div className="flex items-center gap-3">
              <UITooltip content={t.dashboard.startHint}>
                <Button
                  size="icon"
                  onClick={handleStartQueue}
                  disabled={!canStart || needsModel || needsV2Pipeline}
                  className={`rounded-full w-9 h-9 shadow-md transition-all ${!canStart || needsModel || needsV2Pipeline ? "bg-muted text-muted-foreground" : "bg-gradient-to-br from-purple-600 to-indigo-600 hover:scale-105"}`}
                >
                  <Play
                    className={`w-4 h-4 ${canStart && !needsModel && !needsV2Pipeline ? "fill-white" : ""} ml-0.5`}
                  />
                </Button>
              </UITooltip>
              <UITooltip content={t.dashboard.stopHint}>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={requestStop}
                  disabled={!isRunning}
                  className="rounded-full w-8 h-8 border-border hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </UITooltip>
              <span className="text-xs text-muted-foreground font-medium ml-2">
                {statusText}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!isRunning && lastOutputPath && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-secondary/40 text-[10px] text-muted-foreground">
                  <span className="max-w-[160px] truncate" title={lastOutputPath}>
                    {t.dashboard.outputPathLabel}: {outputFileName}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleOpenOutput("folder")}
                    title={t.dashboard.openOutputFolder}
                  >
                    <FolderOpen className="w-3 h-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleOpenOutput("file")}
                    title={t.dashboard.openOutputFile}
                  >
                    <FileText className="w-3 h-3" />
                  </Button>
                </div>
              )}
              {engineMode !== "v2" && (
                <UITooltip content={t.dashboard.alignmentTooltip}>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer text-[10px] font-medium shadow-sm active:scale-95 ${alignmentMode
                      ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-500 dark:text-indigo-400"
                      : "bg-secondary/50 border-border/60 text-muted-foreground hover:bg-secondary/80 hover:border-border hover:text-foreground"
                      }`}
                    onClick={() => {
                      const nextValue = !alignmentMode;
                      setAlignmentMode(nextValue);
                      localStorage.setItem(
                        "config_alignment_mode",
                        String(nextValue),
                      );
                    }}
                  >
                    <AlignLeft
                      className={`w-3 h-3 ${alignmentMode ? "text-indigo-500" : "text-muted-foreground/70"}`}
                    />
                    <span>{t.dashboard.alignmentLabel}</span>
                  </div>
                </UITooltip>
              )}
              {engineMode !== "v2" && (
                <UITooltip content={t.dashboard.cotTooltip}>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer text-[10px] font-medium shadow-sm active:scale-95 ${saveCot
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-500 dark:text-amber-400"
                      : "bg-secondary/50 border-border/60 text-muted-foreground hover:bg-secondary/80 hover:border-border hover:text-foreground"
                      }`}
                    onClick={() => {
                      setSaveCot(!saveCot);
                      localStorage.setItem("config_save_cot", String(!saveCot));
                    }}
                  >
                    <FileText
                      className={`w-3 h-3 ${saveCot ? "text-amber-500" : "text-muted-foreground/70"}`}
                    />
                    <span>{t.dashboard.cotLabel}</span>
                  </div>
                </UITooltip>
              )}
              <div
                className="flex items-center gap-2 cursor-pointer hover:bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors"
                onClick={() => setLogsCollapsed(!logsCollapsed)}
              >
                <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {t.dashboard.terminal}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${logsCollapsed ? "" : "rotate-180"}`}
                />
              </div>
            </div>
          </div>

          {!logsCollapsed && (
            <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[10px] text-muted-foreground bg-secondary/20">
              {displayedLogs.length === 0 ? (
                <span className="italic opacity-50">
                  {t.dashboard.waitingLog}
                </span>
              ) : (
                displayedLogs.slice(-100).map((log, i) => (
                  <div
                    key={i}
                    className="py-0.5 border-b border-border/5 last:border-0"
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

        {/* Confirmation Modal for Overwrite/Resume */}
        {
          activeConfirmModal && activeConfirmModal!.isOpen && (
            <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
              <Card className="w-[420px] max-w-[95vw] overflow-hidden border-border bg-background shadow-2xl animate-in zoom-in-95 duration-300 p-8">
                <div className="flex items-center gap-4 mb-6">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                  <h3 className="text-xl font-bold text-foreground">
                    {t.dashboard.fileExistTitle}
                  </h3>
                </div>

                <p className="text-sm text-muted-foreground mb-8">
                  {t.dashboard.fileExistMsg}
                  <span className="block mt-2 font-mono text-[11px] bg-secondary/50 text-foreground px-3 py-2 rounded border border-border break-all">
                    {activeConfirmModal!.file}
                  </span>
                </p>

                <div className="space-y-3">
                  <Button
                    onClick={activeConfirmModal!.onResume}
                    className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 dark:bg-primary dark:hover:bg-primary/90 text-white font-bold shadow-lg shadow-indigo-200 dark:shadow-primary/20"
                  >
                    {t.dashboard.resume}
                  </Button>

                  <div className="flex flex-col gap-3">
                    <div
                      className={
                        activeConfirmModal!.onSkip ? "grid grid-cols-2 gap-3" : "w-full"
                      }
                    >
                      <Button
                        onClick={activeConfirmModal!.onOverwrite}
                        variant="outline"
                        className="w-full h-11 border-border bg-background hover:bg-secondary text-foreground font-medium dark:bg-muted/10 dark:border-white/5 dark:hover:bg-muted/30"
                      >
                        {t.dashboard.retranslate}
                      </Button>

                      {activeConfirmModal!.onSkip && (
                        <Button
                          onClick={activeConfirmModal!.onSkip}
                          variant="outline"
                          className="w-full h-11 border-border bg-background hover:bg-secondary text-foreground font-medium dark:bg-muted/10 dark:border-white/5 dark:hover:bg-muted/30"
                        >
                          {t.dashboard.skipFile}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 mt-2 border-t border-border">
                    <Button
                      onClick={activeConfirmModal!.onStopAll}
                      variant="ghost"
                      className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-sm font-medium h-10"
                    >
                      {t.dashboard.stopAll}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )
        }

        {
          configItem && (
            <FileConfigModal
              item={configItem!}
              lang={lang}
              onSave={(config) => handleSaveFileConfig(configItem!.id, config)}
              onClose={() => setConfigItem(null)}
              remoteRuntime={remoteRuntime}
              globalEngineMode={engineMode}
              v2Profiles={v2Profiles}
            />
          )
        }

        <AlertModal {...alertProps} />
      </div>
    );
  },
);
