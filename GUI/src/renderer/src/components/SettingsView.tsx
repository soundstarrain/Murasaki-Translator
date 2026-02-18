import { useState, useEffect } from "react";
import {
  Save,
  Settings,
  Trash2,
  AlertTriangle,
  Download,
  FolderOpen,
  XCircle,
  Github,
  Globe,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle as XCircleIcon,
  Activity,
  Layout,
  Zap,
  Terminal,
  Box,
  Layers,
  Link,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  AlertCircle,
  Info,
  Server,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Tooltip } from "./ui/core";
import { Button } from "./ui/core";
import { AlertModal } from "./ui/AlertModal";
import { translations, Language } from "../lib/i18n";
import { APP_CONFIG, DEFAULT_POST_RULES } from "../lib/config";
import { cn } from "../lib/utils";
import {
  buildConfigSnapshot,
  parseConfigSnapshot,
} from "../lib/configSnapshot";
import { LogViewerModal } from "./LogViewerModal";
import { EnvFixerModal } from "./EnvFixerModal";

export function SettingsView({ lang }: { lang: Language }) {
  const t = translations[lang];
  const settingsText = t.settingsView;
  const diagText = t.settingsView.diagnostics;
  const envFixerText = t.envFixer;

  // Output Config
  const [outputDir, setOutputDir] = useState("");
  const [autoTxt, setAutoTxt] = useState(false);
  const [autoEpub, setAutoEpub] = useState(false);

  // Storage Config
  const [cacheDir, setCacheDir] = useState("");

  const [saved, setSaved] = useState(false);

  // System Diagnostics
  const [diagnostics, setDiagnostics] = useState<{
    os: {
      platform: string;
      release: string;
      arch: string;
      cpuCores: number;
      totalMem: string;
    };
    gpu: { name: string; driver?: string; vram?: string } | null;
    python: { version: string; path: string } | null;
    cuda: { version: string; available: boolean } | null;
    vulkan: { available: boolean; version?: string; devices?: string[] } | null;
    llamaServer: {
      status: "online" | "offline" | "unknown";
      port?: number;
      model?: string;
    };
  } | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Environment Fixer State
  const [envCheckResults, setEnvCheckResults] = useState<{
    Python: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
    CUDA: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
    Vulkan: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
    LlamaBackend: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
    Middleware: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
    Permissions: {
      status: "ok" | "warning" | "error";
      issues: string[];
      fixes: string[];
      canAutoFix: boolean;
    } | null;
  } | null>(null);
  const [envFixing, setEnvFixing] = useState<{ [key: string]: boolean }>({});
  const [envCheckLoading, setEnvCheckLoading] = useState(false);

  // Cache key and expiry (5 minutes)
  const DIAG_CACHE_KEY = "system_diagnostics_cache";
  const DIAG_CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

  const loadDiagnostics = async (forceRefresh = false) => {
    // Try to load from cache first
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(DIAG_CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          const age = Date.now() - timestamp;
          // Validate cache: must have new fields (cpuCores, totalMem)
          const isValidCache =
            data?.os?.cpuCores !== undefined &&
            data?.os?.totalMem !== undefined;
          if (age < DIAG_CACHE_EXPIRY && data && isValidCache) {
            setDiagnostics(data);
            setDiagError(null);
            return;
          }
        }
      } catch (e) {
        console.warn("Failed to parse diagnostics cache:", e);
      }
    }

    setDiagLoading(true);
    setDiagError(null);
    try {
      // @ts-ignore
      const result = await window.api.getSystemDiagnostics();
      if (result) {
        setDiagnostics(result);
        // Save to cache
        localStorage.setItem(
          DIAG_CACHE_KEY,
          JSON.stringify({
            data: result,
            timestamp: Date.now(),
          }),
        );
      } else {
        setDiagError(diagText.errors.empty);
      }
    } catch (e) {
      console.error("Failed to load diagnostics:", e);
      const errorMsg = String(e);
      if (errorMsg.includes("EACCES") || errorMsg.includes("permission")) {
        setDiagError(diagText.errors.permission);
      } else if (
        errorMsg.includes("timeout") ||
        errorMsg.includes("ETIMEDOUT")
      ) {
        setDiagError(diagText.errors.timeout);
      } else if (
        errorMsg.includes("ENOENT") ||
        errorMsg.includes("not found")
      ) {
        setDiagError(diagText.errors.missing);
      } else {
        setDiagError(diagText.errors.failed.replace("{error}", errorMsg));
      }
    }
    setDiagLoading(false);
  };

  const checkEnvironmentComponent = async (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => {
    try {
      // @ts-ignore
      const result = await window.api.checkEnvComponent(component);
      if (result.success && result.component) {
        setEnvCheckResults((prev) => {
          const newResults = prev || {
            Python: null,
            CUDA: null,
            Vulkan: null,
            LlamaBackend: null,
            Middleware: null,
            Permissions: null,
          };
          return {
            ...newResults,
            [component]: {
              status: result.component!.status,
              issues: result.component!.issues,
              fixes: result.component!.fixes,
              canAutoFix: result.component!.canAutoFix,
            },
          };
        });
      }
    } catch (e) {
      console.error(`Failed to check ${component}:`, e);
      setEnvCheckResults((prev) => {
        const newResults = prev || {
          Python: null,
          CUDA: null,
          Vulkan: null,
          LlamaBackend: null,
          Middleware: null,
          Permissions: null,
        };
        return {
          ...newResults,
          [component]: {
            status: "error",
            issues: [String(e)],
            fixes: [],
            canAutoFix: false,
          },
        };
      });
    }
  };

  const checkAllEnvironmentComponents = async () => {
    setEnvCheckLoading(true);
    setAlertConfig((prev) => ({ ...prev, confirmLoading: true }));
    const components: Array<
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions"
    > = [
      "Python",
      "CUDA",
      "Vulkan",
      "LlamaBackend",
      "Middleware",
      "Permissions",
    ];

    const promises = components.map((comp) => checkEnvironmentComponent(comp));
    await Promise.all(promises);

    setEnvCheckLoading(false);
    setAlertConfig((prev) => ({ ...prev, confirmLoading: false }));
  };

  const fixEnvironmentComponent = async (
    component:
      | "Python"
      | "CUDA"
      | "Vulkan"
      | "LlamaBackend"
      | "Middleware"
      | "Permissions",
  ) => {
    setEnvFixing((prev) => ({ ...prev, [component]: true }));

    try {
      // @ts-ignore
      const result = await window.api.fixEnvComponent(component);

      setAlertConfig({
        open: true,
        title: result.success
          ? diagText.fixSuccessTitle
          : diagText.fixFailTitle,
        description: result.message || diagText.fixNoDetails,
        variant: result.success ? "success" : "destructive",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: async () => {
          await checkEnvironmentComponent(component);
          setAlertConfig({
            open: true,
            title: diagText.envFixerTitle,
            description: renderEnvFixerContent(),
            variant: "info",
            showCancel: true,
            showIcon: false,
            cancelText: diagText.close,
            confirmText: diagText.refreshCheck,
            closeOnConfirm: false,
            onConfirm: async () => {
              await checkAllEnvironmentComponents();
              setAlertConfig((prev) => ({
                ...prev,
                description: renderEnvFixerContent(),
              }));
            },
          });
        },
      });
    } catch (e) {
      setAlertConfig({
        open: true,
        title: diagText.fixFailTitle,
        description: String(e),
        variant: "destructive",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    }

    setEnvFixing((prev) => ({ ...prev, [component]: false }));
  };

  // Update States
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "found" | "none" | "error"
  >("idle");
  const [updateInfo, setUpdateInfo] = useState<{
    latestVersion: string;
    releaseNotes: string;
    url: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setOutputDir(localStorage.getItem("config_output_dir") || "");
    setAutoTxt(localStorage.getItem("config_auto_txt") === "true");
    setAutoEpub(localStorage.getItem("config_auto_epub") === "true");

    setCacheDir(localStorage.getItem("config_cache_dir") || "");

    // Auto-load diagnostics on mount
    loadDiagnostics();
  }, []);

  const checkUpdates = async () => {
    setUpdateStatus("checking");
    try {
      // @ts-ignore
      const res = await window.api.checkUpdate();
      if (res.success) {
        // Robust version comparison helper
        const parseVersion = (v: string) =>
          v
            .replace(/^v/, "")
            .split(".")
            .map((n) => parseInt(n) || 0);
        const current = parseVersion(APP_CONFIG.version);
        const latest = parseVersion(res.latestVersion);

        let isNewer = false;
        for (let i = 0; i < Math.max(current.length, latest.length); i++) {
          const l = latest[i] || 0;
          const c = current[i] || 0;
          if (l > c) {
            isNewer = true;
            break;
          }
          if (l < c) {
            isNewer = false;
            break;
          }
        }

        if (isNewer) {
          setUpdateStatus("found");
          setUpdateInfo(res);
        } else {
          setUpdateStatus("none");
        }
      } else {
        setUpdateStatus("error");
        const errorMsg =
          res.error?.includes("timeout") || res.error?.includes("ECONN")
            ? `${res.error} (${t.config.proofread.openProxy})`
            : res.error;
        setUpdateInfo({
          latestVersion: "",
          releaseNotes: "",
          url: "",
          error: errorMsg,
        });
      }
    } catch (e) {
      setUpdateStatus("error");
      setUpdateInfo({
        latestVersion: "",
        releaseNotes: "",
        url: "",
        error: String(e),
      });
    }
  };

  const handleSelectDir = async () => {
    // @ts-ignore
    const path = await window.api.selectDirectory();
    if (path) {
      setOutputDir(path);
    }
  };

  const handleSave = () => {
    localStorage.setItem("config_output_dir", outputDir);
    localStorage.setItem("config_auto_txt", String(autoTxt));
    localStorage.setItem("config_auto_epub", String(autoEpub));

    localStorage.setItem("config_cache_dir", cacheDir);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const buildSnapshotFileName = () => {
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    return `${APP_CONFIG.name}_config_${stamp}.json`;
  };

  const resolveDefaultSavePath = async (fileName: string) => {
    const candidates = [
      localStorage.getItem("config_output_dir"),
      localStorage.getItem("last_output_dir"),
      localStorage.getItem("config_cache_dir"),
      localStorage.getItem("last_input_path"),
    ].filter(Boolean) as string[];
    const resolveFolderFromPath = (value: string) => {
      if (!value) return "";
      const hasSlash = value.includes("/") || value.includes("\\");
      const looksLikeFile = /\.[^\\/]+$/.test(value);
      if (hasSlash && looksLikeFile) {
        return value.replace(/[\\/][^\\/]+$/, "");
      }
      return value;
    };
    const folder = candidates
      .map((item) => resolveFolderFromPath(item))
      .find((item) => item && item.length > 0);
    if (!folder) {
      const modelsPath = await window.api?.getModelsPath?.();
      if (modelsPath) {
        const sep = modelsPath.includes("\\") ? "\\" : "/";
        return `${modelsPath}${sep}${fileName}`;
      }
      return "";
    }
    const sep = folder.includes("\\") ? "\\" : "/";
    const normalized =
      folder.endsWith("\\") || folder.endsWith("/")
        ? folder.slice(0, -1)
        : folder;
    return `${normalized}${sep}${fileName}`;
  };

  const handleExportSnapshot = async () => {
    try {
      const snapshot = buildConfigSnapshot(APP_CONFIG.version);
      const defaultPath = await resolveDefaultSavePath(buildSnapshotFileName());
      const filePath = await window.api?.saveFile?.({
        title: settingsText.snapshotExportTitle,
        defaultPath: defaultPath || undefined,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      let ok = false;
      let writeError = "";
      if (window.api?.writeFileVerbose) {
        const result = await window.api.writeFileVerbose(
          filePath,
          JSON.stringify(snapshot, null, 2),
        );
        ok = result?.ok === true;
        writeError = result?.error || "";
      } else {
        ok = Boolean(
          await window.api?.writeFile?.(
            filePath,
            JSON.stringify(snapshot, null, 2),
          ),
        );
      }
      if (!ok) {
        throw new Error(writeError || settingsText.snapshotExportFailDesc);
      }
      setAlertConfig({
        open: true,
        title: settingsText.snapshotExportSuccessTitle,
        description: settingsText.snapshotExportSuccessDesc,
        variant: "success",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAlertConfig({
        open: true,
        title: settingsText.snapshotExportFailTitle,
        description:
          message === settingsText.snapshotExportFailDesc
            ? settingsText.snapshotExportFailDesc
            : `${settingsText.snapshotExportFailDesc}\n${message}`,
        variant: "destructive",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    }
  };

  const handleImportSnapshot = async () => {
    try {
      const filePath = await window.api?.selectFile?.({
        title: settingsText.snapshotImportTitle,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const raw = await window.api?.readFile?.(filePath);
      if (!raw) throw new Error(settingsText.snapshotImportFailDesc);
      const parsed = parseConfigSnapshot(raw);
      if (parsed.error || !parsed.snapshot) {
        throw new Error(parsed.error || settingsText.snapshotImportFailDesc);
      }
      const snapshot = parsed.snapshot;
      const count = Object.keys(snapshot.data).length;
      setAlertConfig({
        open: true,
        title: settingsText.snapshotImportConfirmTitle,
        description: settingsText.snapshotImportConfirmDesc
          .replace("{count}", String(count))
          .replace("{version}", String(snapshot.version)),
        variant: "warning",
        confirmText: settingsText.snapshotImportConfirm,
        showCancel: true,
        onConfirm: () => {
          Object.entries(snapshot.data).forEach(([key, value]) => {
            localStorage.setItem(key, value);
          });
          window.location.reload();
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAlertConfig({
        open: true,
        title: settingsText.snapshotImportFailTitle,
        description:
          message === settingsText.snapshotImportFailDesc
            ? settingsText.snapshotImportFailDesc
            : `${settingsText.snapshotImportFailDesc}\n${message}`,
        variant: "destructive",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    }
  };

  // Alert State
  const [alertConfig, setAlertConfig] = useState<{
    open: boolean;
    title: string;
    description: string | React.ReactNode;
    variant?: "default" | "destructive" | "info" | "success" | "warning";
    showCancel?: boolean;
    showIcon?: boolean;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
    closeOnConfirm?: boolean;
    confirmLoading?: boolean;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  // Modal States for new log/env viewers
  const [showServerLogModal, setShowServerLogModal] = useState(false);
  const [showTerminalLogModal, setShowTerminalLogModal] = useState(false);
  const [showEnvFixerModal, setShowEnvFixerModal] = useState(false);

  const handleResetSystem = () => {
    setAlertConfig({
      open: true,
      title: t.dangerZone,
      description: t.resetConfirm,
      onConfirm: () => {
        // Determine keys to keep or specifically clear
        const keysToClear = [
          "selected_model",
          "last_input_path",
          "last_output_dir",
          "translation_history",
          "library_queue",
          "file_queue",
          "last_preview_blocks",
          "config_rules_pre",
          "config_rules_post",
        ];

        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("config_") || keysToClear.includes(key)) {
            localStorage.removeItem(key);
          }
        });

        // Write default post-processing rules so translation works immediately
        // Use localized labels to avoid hard-coded language in UI
        const localizedPostRules = DEFAULT_POST_RULES.map((rule) => {
          const label =
            rule.pattern === "ensure_double_newline"
              ? t.ruleEditor.presetRuleLabels.doubleNewlineNovel
              : rule.pattern === "smart_quotes"
                ? t.ruleEditor.presetRuleLabels.smartQuotes
                : rule.label;
          return { ...rule, label };
        });
        localStorage.setItem(
          "config_rules_post",
          JSON.stringify(localizedPostRules),
        );

        // Reload to apply defaults across all components
        window.location.reload();
      },
    });
  };

  /**
   * Export all config and history for debugging/bug reports
   */
  const handleExportDebug = async () => {
    // Collect all config keys with values
    // Collect all config keys dynamically
    const configData: Record<string, string | null> = {};
    // Iterate over all localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("config_") ||
          key === "selected_model" ||
          key === "last_input_path")
      ) {
        configData[key] = localStorage.getItem(key);
      }
    }

    // Parse history
    let historyData: unknown = [];
    let historyCount = 0;
    try {
      const historyStr = localStorage.getItem("translation_history");
      if (historyStr) {
        historyData = JSON.parse(historyStr);
        historyCount = Array.isArray(historyData) ? historyData.length : 0;
      }
    } catch {
      historyData = "parse_error";
    }

    // Read server.log (llama-server logs)
    let serverLogData: unknown = null;
    try {
      // @ts-ignore
      serverLogData = await window.api.readServerLog();
    } catch (e) {
      serverLogData = { error: String(e) };
    }

    // Get system diagnostics (GPU, CUDA, Vulkan, Python, etc.)
    let systemDiagnostics: unknown = null;
    try {
      // @ts-ignore
      systemDiagnostics = await window.api.getSystemDiagnostics();
    } catch (e) {
      systemDiagnostics = { error: String(e) };
    }

    // Get main process logs
    let mainProcessLogs: unknown = null;
    try {
      // @ts-ignore
      mainProcessLogs = await window.api.getMainProcessLogs();
    } catch (e) {
      mainProcessLogs = { error: String(e) };
    }

    const debugData = {
      // Export metadata
      exportTime: new Date().toISOString(),
      exportVersion: "1.2",

      // App info
      app: {
        name: "Murasaki Translator",
        version: `v${APP_CONFIG.version}`,
        build: "electron",
      },

      // System info
      system: {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory:
          (navigator as unknown as { deviceMemory?: number }).deviceMemory ||
          "unknown",
        maxTouchPoints: navigator.maxTouchPoints,
      },

      // Screen info
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        colorDepth: window.screen.colorDepth,
        pixelRatio: window.devicePixelRatio,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      },

      // All configuration
      config: configData,

      // History summary
      historySummary: {
        recordCount: historyCount,
        lastRecords: Array.isArray(historyData)
          ? historyData
              .slice(-5)
              .map(
                (r: {
                  fileName?: string;
                  status?: string;
                  startTime?: string;
                  triggers?: unknown[];
                }) => ({
                  fileName: r.fileName,
                  status: r.status,
                  startTime: r.startTime,
                  triggerCount: r.triggers?.length || 0,
                }),
              )
          : [],
      },

      // Full history (for detailed debug)
      history: historyData,

      // Server logs (llama-server.log)
      serverLog: serverLogData,

      // System diagnostics (GPU, CUDA, Vulkan, Python, llama-server status)
      diagnostics: systemDiagnostics,

      // Main process console logs
      mainProcessLogs: mainProcessLogs,
    };

    try {
      const content = JSON.stringify(debugData, null, 2);
      const fileName = `murasaki_debug_${new Date()
        .toISOString()
        .slice(0, 10)}_${Date.now()}.json`;
      const defaultPath = await resolveDefaultSavePath(fileName);
      const filePath = await window.api?.saveFile?.({
        title: settingsText.exportDebug,
        defaultPath: defaultPath || undefined,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      let ok = false;
      let writeError = "";
      if (window.api?.writeFileVerbose) {
        const result = await window.api.writeFileVerbose(filePath, content);
        ok = result?.ok === true;
        writeError = result?.error || "";
      } else {
        ok = Boolean(await window.api?.writeFile?.(filePath, content));
      }
      if (!ok) throw new Error(writeError || settingsText.exportDebugFailDesc);
      setAlertConfig({
        open: true,
        title: settingsText.exportDebugSuccessTitle,
        description: settingsText.exportDebugSuccessDesc,
        variant: "success",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAlertConfig({
        open: true,
        title: settingsText.exportDebugFailTitle,
        description:
          message === settingsText.exportDebugFailDesc
            ? settingsText.exportDebugFailDesc
            : `${settingsText.exportDebugFailDesc}\n${message}`,
        variant: "destructive",
        showCancel: false,
        confirmText: t.common.confirm,
        onConfirm: () => setAlertConfig((prev) => ({ ...prev, open: false })),
      });
    }
  };

  const renderEnvFixerContent = () => {
    const components: Array<{
      name:
        | "Python"
        | "CUDA"
        | "Vulkan"
        | "LlamaBackend"
        | "Middleware"
        | "Permissions";
      label: string;
      icon: any;
      description: string;
    }> = [
      {
        name: "Python",
        label: envFixerText.components.python.label,
        icon: Terminal,
        description: envFixerText.components.python.desc,
      },
      {
        name: "CUDA",
        label: envFixerText.components.cuda.label,
        icon: Zap,
        description: envFixerText.components.cuda.desc,
      },
      {
        name: "Vulkan",
        label: envFixerText.components.vulkan.label,
        icon: Box,
        description: envFixerText.components.vulkan.desc,
      },
      {
        name: "LlamaBackend",
        label: envFixerText.components.llama.label,
        icon: Server,
        description: envFixerText.components.llama.desc,
      },
      {
        name: "Middleware",
        label: envFixerText.components.middleware.label,
        icon: Layers,
        description: envFixerText.components.middleware.desc,
      },
      {
        name: "Permissions",
        label: envFixerText.components.permissions.label,
        icon: ShieldCheck,
        description: envFixerText.components.permissions.desc,
      },
    ];

    const statusColors = {
      ok: "text-green-500 bg-green-500/10",
      warning: "text-yellow-600 bg-yellow-500/10",
      error: "text-red-500 bg-red-500/10",
    };

    const statusIcons = {
      ok: CheckCircle2,
      warning: AlertCircle,
      error: XCircleIcon,
    };

    return (
      <div className="space-y-4">
        {envCheckLoading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-primary/40" />
            <span className="text-sm text-muted-foreground">
              {diagText.envChecking}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {components.map((comp) => {
              const result = envCheckResults?.[comp.name];
              const StatusIcon = result ? statusIcons[result.status] : Info;
              const CompIcon = comp.icon;
              const isFixing = envFixing[comp.name];

              return (
                <div
                  key={comp.name}
                  className="border rounded-lg p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          result ? statusColors[result.status] : "bg-muted"
                        }`}
                      >
                        <CompIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{comp.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {comp.description}
                        </p>
                      </div>
                    </div>
                    {result && (
                      <div
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${statusColors[result.status]}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {result.status === "ok"
                          ? envFixerText.status.ok
                          : result.status === "warning"
                            ? envFixerText.status.warning
                            : envFixerText.status.error}
                      </div>
                    )}
                  </div>

                  {result && result.issues.length > 0 && (
                    <div className="pl-10 space-y-1">
                      {result.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <XCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                          <span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {result && result.fixes.length > 0 && (
                    <div className="pl-10 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {diagText.fixSuggestion}
                      </p>
                      {result.fixes.map((fix, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <Info className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" />
                          <span>{fix}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {result && result.status !== "ok" && (
                    <div className="pl-10 pt-2">
                      {result.canAutoFix ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => fixEnvironmentComponent(comp.name)}
                          disabled={isFixing}
                        >
                          {isFixing ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              {diagText.fixing}
                            </>
                          ) : (
                            <>
                              <Wrench className="w-3 h-3" />
                              {diagText.autoFix}
                            </>
                          )}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <AlertCircle className="w-3 h-3 text-yellow-600" />
                          {diagText.manualFixHint}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-3 border-t">
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded">
            <Info className="w-3 h-3 mt-0.5 shrink-0 text-blue-500" />
            <div className="space-y-1">
              <p>{diagText.fixHint}</p>
              <p>{diagText.refreshHint}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      {/* Header - Fixed Top */}
      <div className="px-8 pt-4 pb-3 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Settings className="w-6 h-6 text-primary" />
          {t.settingsTitle}
        </h2>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
        {/* System Diagnostics Card */}
        {/* System Diagnostics Card */}
        <Card className="mb-3 overflow-hidden border-primary/10 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 py-2 bg-secondary/10 border-b">
            <CardTitle className="text-base flex items-center gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-primary" />
              {diagText.title}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadDiagnostics(true)}
              disabled={diagLoading}
              className="gap-1.5 h-7 text-xs hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <RefreshCw
                className={cn("w-3 h-3", diagLoading && "animate-spin")}
              />
              {diagLoading ? diagText.refreshing : diagText.refresh}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {diagError ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircleIcon className="w-6 h-6 text-destructive" />
                </div>
                <span className="text-sm text-destructive font-medium text-center px-4">
                  {diagError}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadDiagnostics(true)}
                  className="mt-2"
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  {diagText.retry}
                </Button>
              </div>
            ) : diagLoading && !diagnostics ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Activity className="w-8 h-8 animate-pulse text-primary/40" />
                <span className="text-sm text-muted-foreground font-medium">
                  {diagText.scanLoading}
                </span>
              </div>
            ) : diagnostics ? (
              <div className="divide-y divide-border">
                <div className="grid grid-cols-1 md:grid-cols-3 divide-x divide-border">
                  {/* OS Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Layout className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.osLabel}
                      </p>
                      <p className="text-sm font-semibold truncate">
                        {diagnostics.os.platform === "win32"
                          ? `Windows ${diagnostics.os.release}`
                          : diagnostics.os.platform === "darwin"
                            ? "macOS"
                            : "Linux"}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {diagnostics.os.arch} / {diagnostics.os.cpuCores} Cores
                        / {diagnostics.os.totalMem} RAM
                      </p>
                    </div>
                  </div>

                  {/* GPU Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                      <Zap className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.gpuLabel}
                      </p>
                      {diagnostics.gpu ? (
                        <>
                          <p
                            className="text-[13px] font-semibold truncate leading-tight"
                            title={diagnostics.gpu.name}
                          >
                            {diagnostics.gpu.name}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground">
                            {diagnostics.gpu.vram} VRAM /{" "}
                            {diagnostics.gpu.driver}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-muted-foreground">
                          {diagText.gpuNotFound}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Python Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                      <Terminal className="w-4 h-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.pythonLabel}
                      </p>
                      {diagnostics.python ? (
                        <>
                          <p className="text-sm font-semibold flex items-center gap-1.5">
                            {diagnostics.python.version}
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          </p>
                          <p
                            className="text-[10px] font-mono text-muted-foreground truncate"
                            title={diagnostics.python.path}
                          >
                            {diagnostics.python.path}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-red-500 flex items-center gap-1">
                          <XCircleIcon className="w-3 h-3" />
                          {diagText.notInstalled}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 divide-x divide-border">
                  {/* CUDA Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                      <Box className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.cudaLabel}
                      </p>
                      {diagnostics.cuda?.available ? (
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          {diagText.versionLabel.replace(
                            "{version}",
                            String(diagnostics.cuda.version),
                          )}
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        </p>
                      ) : (
                        <p className="text-sm font-semibold text-muted-foreground">
                          {diagText.cudaNotFound}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Vulkan Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Layers className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.vulkanLabel}
                      </p>
                      {diagnostics.vulkan?.available ? (
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          {diagnostics.vulkan.version
                            ? diagText.versionLabel.replace(
                                "{version}",
                                String(diagnostics.vulkan.version),
                              )
                            : diagText.vulkanAvailable}
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        </p>
                      ) : (
                        <p className="text-sm font-semibold text-muted-foreground">
                          {diagText.unavailable}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* llama-server Section */}
                  <div className="py-2 px-4 flex gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-zinc-500/10 flex items-center justify-center shrink-0">
                      <Link className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {diagText.llamaLabel}
                      </p>
                      {diagnostics.llamaServer.status === "online" ? (
                        <>
                          <p className="text-sm font-semibold flex items-center gap-1.5 text-primary">
                            {diagText.llamaOnline}
                            <Activity className="w-3 h-3 animate-pulse" />
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
                            localhost:{diagnostics.llamaServer.port}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                          {diagText.llamaOffline}
                          <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-secondary/5 border-y">
                <p className="text-sm text-muted-foreground font-medium italic">
                  {diagText.noData}
                </p>
              </div>
            )}

            {/* Debug Actions Section */}
            <div className="py-2 px-4 bg-muted/30 border-t flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TerminalSquare className="w-4 h-4 text-muted-foreground/60" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  {settingsText.toolbox.title}
                </span>
              </div>
              <div className="flex gap-2">
                <Tooltip content={settingsText.toolbox.openPythonDirTip}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5 bg-background shadow-xs hover:bg-secondary transition-all"
                    onClick={() => {
                      const pythonPath = diagnostics?.python?.path || "";
                      const parentDir = pythonPath.replace(/[\\/][^\\/]+$/, "");
                      window.api?.openPath(parentDir || pythonPath);
                    }}
                    disabled={!diagnostics?.python}
                  >
                    <FolderOpen className="w-3 h-3" />
                    {settingsText.toolbox.openPythonDir}
                  </Button>
                </Tooltip>
                <Tooltip content={settingsText.toolbox.viewServerLogTip}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5 bg-background shadow-xs hover:bg-secondary transition-all"
                    onClick={() => setShowServerLogModal(true)}
                  >
                    <Activity className="w-3 h-3" />
                    {settingsText.toolbox.viewServerLog}
                  </Button>
                </Tooltip>
                <Tooltip content={settingsText.toolbox.viewTerminalLogTip}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5 bg-background shadow-xs hover:bg-secondary transition-all"
                    onClick={() => setShowTerminalLogModal(true)}
                  >
                    <TerminalSquare className="w-3 h-3" />
                    {settingsText.toolbox.viewTerminalLog}
                  </Button>
                </Tooltip>
                <Tooltip content={settingsText.toolbox.envFixerTip}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1.5 bg-background shadow-xs hover:bg-secondary transition-all"
                    onClick={() => setShowEnvFixerModal(true)}
                  >
                    <Wrench className="w-3 h-3" />
                    {settingsText.toolbox.envFixer}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.settingsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Output Directory */}
            <div className="space-y-3">
              <label className="text-sm font-medium block">
                {t.config.outputDir}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  className="flex-1 border border-border p-2 rounded bg-secondary text-muted-foreground text-sm"
                  placeholder={t.settingsView.outputDirPlaceholder}
                  value={outputDir}
                />
                <Button variant="outline" size="sm" onClick={handleSelectDir}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  {t.settingsView.selectDir}
                </Button>
                {outputDir && (
                  <Tooltip content={settingsText.resetDefault}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOutputDir("")}
                    >
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </Tooltip>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {outputDir
                  ? t.settingsView.outputDirDesc
                  : t.settingsView.outputDirDefaultDesc}
              </p>
            </div>

            <div className="h-px bg-border" />

            {/* Storage - Cache Directory */}
            <div className="space-y-3">
              <label className="text-sm font-medium block">
                {t.config.storage.cacheDir}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  className="flex-1 border border-border p-2 rounded bg-secondary text-muted-foreground text-sm"
                  placeholder={t.settingsView.cacheDirPlaceholder}
                  value={cacheDir}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    // @ts-ignore
                    const path = (await window.api.selectFolder()) as
                      | string
                      | null;
                    if (path) setCacheDir(path);
                  }}
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  {t.settingsView.selectDir}
                </Button>
                {cacheDir && (
                  <Tooltip content={settingsText.resetDefault}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCacheDir("")}
                    >
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </Tooltip>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {cacheDir
                  ? t.settingsView.cacheDirDesc
                  : t.settingsView.cacheDirDefaultDesc}
              </p>
            </div>

            <div className="h-px bg-border" />

            {/* Config Snapshot */}
            <div className="space-y-3">
              <label className="text-sm font-medium block">
                {settingsText.snapshotTitle}
              </label>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {settingsText.snapshotDesc}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {APP_CONFIG.name} v{APP_CONFIG.version}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleExportSnapshot}
                  >
                    <Download className="w-4 h-4" />
                    {settingsText.snapshotExport}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleImportSnapshot}
                  >
                    <FolderOpen className="w-4 h-4" />
                    {settingsText.snapshotImport}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Update Settings */}
        <div className="pt-6">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3 px-1">
            <RefreshCw className="w-4 h-4 text-primary" />
            {t.settingsView.checkUpdate}
          </h3>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">
                {t.settingsView.versionStatus}
              </CardTitle>
              <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] font-mono border">
                v{APP_CONFIG.version}
              </span>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between group p-3 rounded-lg border border-transparent hover:border-border hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-all">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        updateStatus === "checking"
                          ? "bg-blue-500 animate-pulse"
                          : updateStatus === "found"
                            ? "bg-green-500"
                            : updateStatus === "none"
                              ? "bg-green-500"
                              : updateStatus === "idle"
                                ? "bg-zinc-300 dark:bg-zinc-700"
                                : "bg-red-500",
                      )}
                    />
                    <p className="text-sm font-medium">
                      {updateStatus === "idle" && t.settingsView.checkHint}
                      {updateStatus === "checking" && t.settingsView.checking}
                      {updateStatus === "found" && (
                        <span className="text-primary font-bold">
                          {t.settingsView.foundNew.replace(
                            "{version}",
                            updateInfo?.latestVersion || "",
                          )}
                        </span>
                      )}
                      {updateStatus === "none" && t.settingsView.upToDate}
                      {updateStatus === "error" && (
                        <span className="text-red-500">
                          {t.settingsView.connFail}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {updateStatus === "error"
                      ? updateInfo?.error
                      : t.settingsView.updateDesc}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => checkUpdates()}
                  disabled={updateStatus === "checking"}
                  className="gap-2 h-8"
                >
                  <RefreshCw
                    className={cn(
                      "w-3.5 h-3.5",
                      updateStatus === "checking" && "animate-spin",
                    )}
                  />
                  {updateStatus === "found"
                    ? t.settingsView.reCheck
                    : t.settingsView.checkNow}
                </Button>
              </div>

              {updateStatus === "found" && updateInfo && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-primary/70">
                      {t.settingsView.newFeatures}
                    </span>
                    <div className="text-xs text-foreground/80 max-h-32 overflow-y-auto font-sans whitespace-pre-wrap leading-relaxed italic border-l-2 border-primary/20 pl-2">
                      {updateInfo.releaseNotes || t.settingsView.noNotes}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full gap-2 shadow-sm"
                    onClick={() => window.api?.openExternal(updateInfo.url)}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {t.settingsView.goGithub}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Danger Zone */}
        <div className="pt-6">
          <h3 className="text-sm font-bold text-red-500 dark:text-red-400 flex items-center gap-2 mb-3 px-1">
            <AlertTriangle className="w-4 h-4" />
            {t.dangerZone}
          </h3>
          <Card className="border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/30">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-900 dark:text-red-300">
                  {t.resetSystem}
                </p>
                <p className="text-xs text-red-700/70 dark:text-red-400/70">
                  {t.config.resetDesc}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {t.config.resetHelp}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleResetSystem}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {t.resetSystem}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Debug & Support Section */}
        <div className="pt-6">
          <h3 className="text-sm font-bold text-blue-500 dark:text-blue-400 flex items-center gap-2 mb-3 px-1">
            <Download className="w-4 h-4" />
            {t.settingsView.debug}
          </h3>

          {/* Official Resources */}
          <Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/30">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-300">
                  {t.settingsView.exportDebug}
                </p>
                <p className="text-xs text-blue-700/70 dark:text-blue-400/70">
                  {t.settingsView.exportDebugDesc}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportDebug}
                className="gap-2 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
              >
                <Download className="w-4 h-4" />
                {t.settingsView.export}
              </Button>
            </CardContent>
          </Card>

          {/* About & Resources - Compact Cards */}
          <div className="pt-8 pb-4">
            <div className="grid grid-cols-2 gap-4">
              {/* GitHub Card */}
              <div
                className="flex flex-col gap-1 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-all cursor-pointer group"
                onClick={() =>
                  window.api?.openExternal(APP_CONFIG.officialRepo)
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <Github className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="font-semibold text-sm">
                  {t.settingsView.sourceCode}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Project {APP_CONFIG.name}
                </span>
              </div>

              {/* HuggingFace Card */}
              <div
                className="flex flex-col gap-1 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background hover:bg-yellow-50/50 dark:hover:bg-yellow-900/10 transition-all cursor-pointer group"
                onClick={() =>
                  window.api?.openExternal(APP_CONFIG.modelDownload.huggingface)
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg">🤗</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="font-semibold text-sm">
                  {t.settingsView.modelHub}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Download Updates
                </span>
              </div>
            </div>

            {/* Copyright / Version Minimal */}
            <div className="text-center mt-8 text-[10px] text-muted-foreground/30 font-mono">
              {APP_CONFIG.name} v{APP_CONFIG.version}
            </div>
          </div>
        </div>

        <div className="h-8" />
      </div>

      {/* Floating Footer - Fixed Bottom */}
      <div className="p-8 pt-4 pb-8 border-t bg-background shrink-0 z-10 flex justify-end">
        <Button onClick={handleSave} className="gap-2 shadow-sm px-6">
          <Save className="w-4 h-4" />
          {saved ? t.saved : t.save}
        </Button>
      </div>

      <AlertModal
        open={alertConfig.open}
        onOpenChange={(open) => setAlertConfig((prev) => ({ ...prev, open }))}
        title={alertConfig.title}
        description={alertConfig.description}
        variant={alertConfig.variant || "destructive"}
        onConfirm={alertConfig.onConfirm}
        showCancel={alertConfig.showCancel ?? true}
        showIcon={alertConfig.showIcon ?? true}
        closeOnConfirm={alertConfig.closeOnConfirm ?? true}
        confirmLoading={alertConfig.confirmLoading ?? false}
        cancelText={t.glossaryView.cancel}
        confirmText={alertConfig.confirmText || t.config.storage.reset}
      />

      {/* New Modal Components */}
      {showServerLogModal && (
        <LogViewerModal
          lang={lang}
          mode="server"
          onClose={() => setShowServerLogModal(false)}
        />
      )}
      {showTerminalLogModal && (
        <LogViewerModal
          lang={lang}
          mode="terminal"
          onClose={() => setShowTerminalLogModal(false)}
        />
      )}
      {showEnvFixerModal && (
        <EnvFixerModal onClose={() => setShowEnvFixerModal(false)} />
      )}
    </div>
  );
}
