import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Info,
  X,
  RefreshCw,
  Server,
  Sparkles,
} from "lucide-react";
import { Button, Card, CardContent, Switch } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { LogViewerModal } from "./LogViewerModal";
import type { UseRemoteRuntimeResult } from "../hooks/useRemoteRuntime";

interface ServiceViewProps {
  lang: Language;
  remoteRuntime: UseRemoteRuntimeResult;
}

const DEFAULT_LOCAL_API_PORT = 8000;
const LOCAL_API_PORT_SCAN_RANGE = 20;
const REMOTE_PANEL_EXPANDED_STORAGE_KEY = "config_remote_panel_expanded";
const LOCAL_DAEMON_AUTO_REMOTE_STORAGE_KEY = "config_local_daemon_auto_remote";
const LOCAL_DAEMON_API_KEY_STORAGE_KEY = "config_local_api_key";
const REMOTE_API_URL_STORAGE_KEY = "config_remote_url";
const REMOTE_API_KEY_STORAGE_KEY = "config_api_key";
const SERVICE_GUIDE_EXPANDED_STORAGE_KEY = "config_service_guide_expanded";

const parseBooleanStorage = (key: string, fallback: boolean): boolean => {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value !== "false";
};

const parseIntegerStorage = (
  key: string,
  fallback: number,
  options?: { min?: number; max?: number },
): number => {
  const value = localStorage.getItem(key);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (options?.min !== undefined && parsed < options.min) return fallback;
  if (options?.max !== undefined && parsed > options.max) return fallback;
  return parsed;
};

const parseOptionalIntegerStorage = (key: string): number | undefined => {
  const value = localStorage.getItem(key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const maskApiKey = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return "****";
  if (normalized.length <= 8) return "********";
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
};

export function ServiceView({
  lang,
  remoteRuntime: remoteState,
}: ServiceViewProps) {
  const t = translations[lang];
  const s = t.serviceView;
  const { alertProps, showAlert, showConfirm } = useAlertModal();

  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem(REMOTE_API_URL_STORAGE_KEY) || "",
  );
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(REMOTE_API_KEY_STORAGE_KEY) || "",
  );
  const [localDaemonApiKey, setLocalDaemonApiKey] = useState(
    () =>
      localStorage.getItem(LOCAL_DAEMON_API_KEY_STORAGE_KEY) ||
      localStorage.getItem(REMOTE_API_KEY_STORAGE_KEY) ||
      "",
  );
  const [daemonMode, setDaemonMode] = useState(
    () => localStorage.getItem("config_daemon_mode") === "true",
  );
  const [localPort, setLocalPort] = useState(
    () =>
      localStorage.getItem("config_local_port") ||
      String(DEFAULT_LOCAL_API_PORT),
  );
  const [localHost, setLocalHost] = useState(
    () => localStorage.getItem("config_local_host") || "127.0.0.1",
  );
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isWarming, setIsWarming] = useState(false);
  const [isTestingRemote, setIsTestingRemote] = useState(false);
  const [remotePanelExpanded, setRemotePanelExpanded] = useState(() =>
    parseBooleanStorage(REMOTE_PANEL_EXPANDED_STORAGE_KEY, true),
  );
  const [
    autoConnectRemoteAfterDaemonStart,
    setAutoConnectRemoteAfterDaemonStart,
  ] = useState(() =>
    parseBooleanStorage(LOCAL_DAEMON_AUTO_REMOTE_STORAGE_KEY, true),
  );
  const [serviceGuideExpanded, setServiceGuideExpanded] = useState(
    () => localStorage.getItem(SERVICE_GUIDE_EXPANDED_STORAGE_KEY) === "true",
  );
  const [warmupTime, setWarmupTime] = useState<number | null>(null);
  const [showLocalApiKey, setShowLocalApiKey] = useState(false);
  const [showRemoteApiKey, setShowRemoteApiKey] = useState(false);
  const [localApiKeyCopied, setLocalApiKeyCopied] = useState(false);
  const [remoteApiKeyCopied, setRemoteApiKeyCopied] = useState(false);
  const [remoteNoticeExpanded, setRemoteNoticeExpanded] = useState(false);
  const [logViewer, setLogViewer] = useState<{
    mode: "server" | "terminal" | "file";
    filePath?: string;
    title?: string;
    subtitle?: string;
  } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<{
    type: "info" | "warning" | "error" | "success";
    message: string;
  } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusErrorRef = useRef(0);

  const {
    runtime,
    diagnostics,
    network,
    loading: remoteLoading,
    refreshing: remoteRefreshing,
    lastError: remoteLastError,
    connect: connectRemote,
    disconnect: disconnectRemote,
    refresh: refreshRemoteRuntime,
    mapApiError,
    notice: remoteNotice,
  } = remoteState;
  const isRemoteConnected = runtime.connected;
  const remoteRuntimeLoading = remoteLoading || remoteRefreshing;
  const isLocalServerRunning = Boolean(serverStatus?.running);
  const effectiveLocalApiKey = localDaemonApiKey.trim();
  const remoteApiKeyValue = apiKey.trim();
  const canCopyLocalApiKey = Boolean(effectiveLocalApiKey);
  const canCopyRemoteApiKey = Boolean(remoteApiKeyValue);
  const remoteNetworkLogPath =
    runtime?.networkEventLogPath || network?.networkEventLogPath || "";
  const remoteMirrorLogPath =
    runtime?.syncMirrorPath || network?.syncMirrorPath || "";
  const inlineNoticeConfig = inlineNotice
    ? {
        success: {
          className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600",
          icon: Check,
        },
        warning: {
          className: "bg-amber-500/10 border-amber-500/30 text-amber-600",
          icon: Info,
        },
        error: {
          className: "bg-red-500/10 border-red-500/30 text-red-600",
          icon: Info,
        },
        info: {
          className: "bg-blue-500/10 border-blue-500/30 text-blue-600",
          icon: Info,
        },
      }[inlineNotice.type]
    : null;

  useEffect(() => {
    void refreshRemoteRuntime();
  }, [refreshRemoteRuntime]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const checkStatus = async () => {
      if (daemonMode && (window as any).api?.serverStatus) {
        try {
          const status = await (window as any).api.serverStatus();
          setServerStatus(status);
        } catch (error) {
          console.error("Server status check failed", error);
          const now = Date.now();
          if (now - lastStatusErrorRef.current > 10000) {
            lastStatusErrorRef.current = now;
            pushNotice({
              type: "warning",
              message: s.statusFetchFailed,
            });
          }
        }
      }
    };
    if (daemonMode) {
      void checkStatus();
      timer = setInterval(checkStatus, 2000);
    } else {
      setServerStatus(null);
    }
    return () => clearInterval(timer);
  }, [daemonMode]);

  useEffect(() => {
    if (runtime.session?.url) {
      setServerUrl(runtime.session.url);
      localStorage.setItem(REMOTE_API_URL_STORAGE_KEY, runtime.session.url);
    }
  }, [runtime.session?.url]);

  const pushNotice = useCallback(
    (next: {
      type: "info" | "warning" | "error" | "success";
      message: string;
    }) => {
      setInlineNotice(next);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setInlineNotice(null), 5200);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      REMOTE_PANEL_EXPANDED_STORAGE_KEY,
      String(remotePanelExpanded),
    );
  }, [remotePanelExpanded]);

  useEffect(() => {
    localStorage.setItem(
      LOCAL_DAEMON_AUTO_REMOTE_STORAGE_KEY,
      String(autoConnectRemoteAfterDaemonStart),
    );
  }, [autoConnectRemoteAfterDaemonStart]);

  useEffect(() => {
    localStorage.setItem(
      SERVICE_GUIDE_EXPANDED_STORAGE_KEY,
      String(serviceGuideExpanded),
    );
  }, [serviceGuideExpanded]);

  const toggleDaemonMode = async (nextValue: boolean) => {
    if (daemonMode && !nextValue && serverStatus?.running) {
      showConfirm({
        title: s.switchToAutoTitle,
        description: s.switchToAutoDesc,
        variant: "warning",
        confirmText: s.switchToAutoConfirm,
        cancelText: t.common.cancel,
        onConfirm: async () => {
          await (window as any).api?.serverStop();
          setServerStatus(null);
          setDaemonMode(false);
          localStorage.setItem("config_daemon_mode", "false");
          await refreshRemoteRuntime();
        },
      });
      return;
    }

    setDaemonMode(nextValue);
    localStorage.setItem("config_daemon_mode", String(nextValue));
    if (!nextValue && serverStatus?.running) {
      await (window as any).api?.serverStop();
      setServerStatus(null);
      await refreshRemoteRuntime();
    }
  };

  const buildServerStartConfig = (
    model: string,
    preferredPort: number,
  ): Record<string, unknown> => ({
    model,
    port: preferredPort,
    host: localHost,
    apiKey: localDaemonApiKey.trim() || undefined,
    gpuLayers: localStorage.getItem("config_gpu") || "-1",
    ctxSize: localStorage.getItem("config_ctx") || "4096",
    concurrency: parseIntegerStorage("config_concurrency", 1, { min: 1 }),
    flashAttn: parseBooleanStorage("config_flash_attn", true),
    kvCacheType: localStorage.getItem("config_kv_cache_type") || "f16",
    autoKvSwitch: parseBooleanStorage("config_auto_kv_switch", true),
    useLargeBatch: parseBooleanStorage("config_use_large_batch", true),
    physicalBatchSize: parseIntegerStorage("config_physical_batch_size", 1024, {
      min: 1,
    }),
    seed: parseOptionalIntegerStorage("config_seed"),
    deviceMode:
      (localStorage.getItem("config_device_mode") as "auto" | "cpu") || "auto",
    gpuDeviceId: localStorage.getItem("config_gpu_device_id") || "",
    autoConnectRemote: autoConnectRemoteAfterDaemonStart,
  });

  const handleStartServer = async () => {
    const activeModel = localStorage.getItem("config_model") || "";
    if (!activeModel) {
      showAlert({
        title: s.noModelTitle,
        description: s.noModelDesc,
        variant: "destructive",
      });
      return;
    }

    setIsStartingServer(true);
    try {
      const parsedLocalPort = Number.parseInt(localPort, 10);
      const preferredPort =
        Number.isFinite(parsedLocalPort) &&
        parsedLocalPort >= 1 &&
        parsedLocalPort <= 65535
          ? parsedLocalPort
          : DEFAULT_LOCAL_API_PORT;
      if (String(preferredPort) !== localPort) {
        setLocalPort(String(preferredPort));
      }
      localStorage.setItem("config_local_port", String(preferredPort));

      const config = buildServerStartConfig(activeModel, preferredPort);
      const startResult = await (window as any).api?.serverStart(config);
      if (!startResult?.success) {
        let errorDetail = startResult?.error || s.startFailed;
        try {
          const logs = await (window as any).api?.serverLogs?.();
          if (Array.isArray(logs) && logs.length > 0) {
            const compactTail = logs
              .slice(-8)
              .map((line: unknown) =>
                String(line || "")
                  .replace(/\s+/g, " ")
                  .trim(),
              )
              .filter(Boolean)
              .join(" || ");
            if (compactTail && !errorDetail.includes("| Tail:")) {
              errorDetail = `${errorDetail} | Tail: ${compactTail}`;
            }
          }
        } catch {
          // ignore log fetch failure
        }
        showAlert({
          title: s.startFailTitle,
          description: errorDetail,
          variant: "destructive",
        });
        return;
      }

      if (startResult?.host) {
        setLocalHost(startResult.host);
        localStorage.setItem("config_local_host", startResult.host);
      }
      if (startResult?.apiKey) {
        setLocalDaemonApiKey(startResult.apiKey);
        localStorage.setItem(
          LOCAL_DAEMON_API_KEY_STORAGE_KEY,
          startResult.apiKey,
        );
      }
      // 自动接入远程统一链路
      let autoConnected = false;
      if (
        autoConnectRemoteAfterDaemonStart &&
        startResult?.endpoint &&
        !isRemoteConnected
      ) {
        const endpoint = startResult.endpoint;
        const key = startResult.apiKey || "";
        // 同步表单字段
        setServerUrl(endpoint);
        localStorage.setItem(REMOTE_API_URL_STORAGE_KEY, endpoint);
        localStorage.removeItem("config_server");
        if (key) {
          setApiKey(key);
          localStorage.setItem(REMOTE_API_KEY_STORAGE_KEY, key);
        }
        // 实际连接
        try {
          const connectResult = await connectRemote(endpoint, key || undefined);
          if (connectResult?.ok) {
            autoConnected = true;
            setRemotePanelExpanded(true);
          } else {
            const ui = mapApiError(connectResult, s.autoConnectFail);
            pushNotice({
              type: "warning",
              message: `${ui.title}：${ui.description}${ui.hint ? ` ${ui.hint}` : ""}`,
            });
          }
        } catch (error) {
          pushNotice({
            type: "warning",
            message: s.autoConnectFailDetail.replace("{error}", String(error)),
          });
        }
      } else if (
        autoConnectRemoteAfterDaemonStart &&
        startResult?.endpoint &&
        isRemoteConnected
      ) {
        // 已有远程连接时不覆盖，仅同步表单
        if (startResult.endpoint) {
          setServerUrl(startResult.endpoint);
          localStorage.setItem(
            REMOTE_API_URL_STORAGE_KEY,
            startResult.endpoint,
          );
          localStorage.removeItem("config_server");
        }
        if (startResult.apiKey) {
          setApiKey(startResult.apiKey);
          localStorage.setItem(REMOTE_API_KEY_STORAGE_KEY, startResult.apiKey);
        }
      }

      const detailParts: string[] = [];
      if (startResult?.portChanged && startResult?.selectedPort) {
        setLocalPort(String(startResult.selectedPort));
        localStorage.setItem(
          "config_local_port",
          String(startResult.selectedPort),
        );
        detailParts.push(
          s.portChangedNotice
            .replace(
              "{requested}",
              String(startResult.requestedPort || preferredPort),
            )
            .replace("{selected}", String(startResult.selectedPort))
            .replace("{from}", String(preferredPort))
            .replace("{to}", String(preferredPort + LOCAL_API_PORT_SCAN_RANGE)),
        );
      } else if (startResult?.selectedPort) {
        setLocalPort(String(startResult.selectedPort));
        localStorage.setItem(
          "config_local_port",
          String(startResult.selectedPort),
        );
      }
      if (startResult?.endpoint) {
        detailParts.push(
          s.localEndpoint.replace("{value}", startResult.endpoint),
        );
      }
      if (
        Array.isArray(startResult?.lanEndpoints) &&
        startResult.lanEndpoints.length > 0
      ) {
        detailParts.push(
          s.lanEndpoint.replace("{value}", startResult.lanEndpoints[0]),
        );
      }
      if (autoConnected) {
        detailParts.push(s.autoConnected);
      } else if (!autoConnectRemoteAfterDaemonStart) {
        detailParts.push(s.autoConnectHint);
      } else if (isRemoteConnected) {
        detailParts.push(s.keepRemote);
      }

      showAlert({
        title: startResult?.portChanged
          ? s.localStartedPortChanged
          : s.localStarted,
        description: detailParts.join(" | ") || s.localReady,
        variant: "success",
      });

      if ((window as any).api?.serverStatus) {
        const status = await (window as any).api.serverStatus();
        setServerStatus(status);
      }
      await refreshRemoteRuntime();
    } catch (error) {
      showAlert({
        title: s.startExceptionTitle,
        description: s.startExceptionDesc.replace("{error}", String(error)),
        variant: "destructive",
      });
    } finally {
      setIsStartingServer(false);
    }
  };

  const handleStopServer = async () => {
    // 如果远程连接指向本机 daemon，先断开
    if (isRemoteConnected && runtime.session?.source === "local-daemon") {
      await disconnectRemote();
    }
    await (window as any).api?.serverStop();
    setServerStatus(null);
    await refreshRemoteRuntime();
  };

  const handleWarmup = async () => {
    setIsWarming(true);
    setWarmupTime(null);
    try {
      const result = await (window as any).api?.serverWarmup();
      if (result?.success) {
        setWarmupTime(result.durationMs ?? null);
      } else {
        pushNotice({
          type: "warning",
          message: result?.error || s.warmupFailHint,
        });
      }
    } catch (error) {
      console.error("Warmup failed", error);
      pushNotice({
        type: "warning",
        message: s.warmupFailDetail.replace("{error}", String(error)),
      });
    } finally {
      setIsWarming(false);
    }
  };

  const handleCopyLocalApiKey = async () => {
    if (!canCopyLocalApiKey) {
      showAlert({
        title: s.copyMissingTitle,
        description: s.copyMissingLocalDesc,
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(effectiveLocalApiKey);
      setLocalApiKeyCopied(true);
      window.setTimeout(() => setLocalApiKeyCopied(false), 1800);
    } catch (error) {
      showAlert({
        title: s.copyFailTitle,
        description: s.copyLocalFailDesc.replace("{error}", String(error)),
        variant: "destructive",
      });
    }
  };

  const handleCopyRemoteApiKey = async () => {
    if (!canCopyRemoteApiKey) {
      showAlert({
        title: s.copyMissingTitle,
        description: s.copyMissingRemoteDesc,
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(remoteApiKeyValue);
      setRemoteApiKeyCopied(true);
      window.setTimeout(() => setRemoteApiKeyCopied(false), 1800);
    } catch (error) {
      showAlert({
        title: s.copyFailTitle,
        description: s.copyRemoteFailDesc.replace("{error}", String(error)),
        variant: "destructive",
      });
    }
  };

  const handleToggleRemote = async () => {
    setIsTestingRemote(true);
    try {
      if (isRemoteConnected) {
        const disconnectResult = await disconnectRemote();
        if (disconnectResult?.ok) {
          setRemotePanelExpanded(false);
          showAlert({
            title: s.disconnectedTitle,
            description: s.disconnectedDesc,
            variant: "success",
          });
        } else {
          const ui = mapApiError(disconnectResult, s.disconnectFail);
          showAlert({
            title: ui.title,
            description: ui.hint
              ? `${ui.description} ${ui.hint}`
              : ui.description,
            variant: "destructive",
          });
        }
        return;
      }

      const url = serverUrl.trim();
      if (!url) {
        showAlert({
          title: s.missingUrlTitle,
          description: s.missingUrlDesc,
          variant: "destructive",
        });
        return;
      }
      const result = await connectRemote(url, apiKey.trim() || undefined);
      if (result?.ok) {
        setRemotePanelExpanded(true);
        localStorage.setItem(REMOTE_API_URL_STORAGE_KEY, url);
        localStorage.removeItem("config_server");
        localStorage.setItem(REMOTE_API_KEY_STORAGE_KEY, apiKey.trim());
        const sourceHint = result?.message ? `${result.message} ` : "";
        showAlert({
          title: s.connectSuccessTitle,
          description: s.connectSuccessDesc
            .replace("{source}", sourceHint)
            .replace(
              "{version}",
              result?.data?.version
                ? `（服务版本 v${result.data.version}）`
                : "",
            ),
          variant: "success",
        });
      } else {
        const ui = mapApiError(result, s.connectFail);
        showAlert({
          title: ui.title,
          description: ui.hint
            ? `${ui.description} ${ui.hint}`
            : ui.description,
          variant: "destructive",
        });
      }
    } catch (error) {
      showAlert({
        title: s.connectErrorTitle,
        description: s.connectErrorDesc.replace("{error}", String(error)),
        variant: "destructive",
      });
    } finally {
      setIsTestingRemote(false);
      await refreshRemoteRuntime();
    }
  };

  const resolveLocalLogPath = async (fileName: string) => {
    try {
      // @ts-ignore
      const modelsPath = await (window as any).api?.getModelsPath?.();
      if (!modelsPath) return fileName;
      const sep = modelsPath.includes("\\") ? "\\" : "/";
      const suffix = `${sep}models`;
      const lower = modelsPath.toLowerCase();
      const base = lower.endsWith(suffix.toLowerCase())
        ? modelsPath.slice(0, -suffix.length)
        : modelsPath;
      return `${base}${sep}${fileName}`;
    } catch {
      return fileName;
    }
  };

  const openFileLog = (filePathValue: string, title: string) => {
    if (!filePathValue) return;
    setLogViewer({
      mode: "file",
      filePath: filePathValue,
      title,
      subtitle: filePathValue,
    });
  };

  const handleOpenLocalLlamaLog = async () => {
    const logPath = await resolveLocalLogPath("llama-daemon.log");
    openFileLog(logPath, s.localLlamaLog);
  };

  const handleOpenRemoteNetworkLog = () => {
    openFileLog(remoteNetworkLogPath, s.remoteNetworkLog);
  };

  const handleOpenRemoteMirrorLog = () => {
    openFileLog(remoteMirrorLogPath, s.remoteMirrorLog);
  };

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Server className="w-6 h-6 text-primary" />
          {s.title}
          {(isStartingServer || remoteRuntimeLoading) && (
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-2">{s.subtitle}</p>
      </div>
      {inlineNotice &&
        inlineNoticeConfig &&
        (() => {
          const NoticeIcon = inlineNoticeConfig.icon;
          return (
            <div className="px-8 -mt-2 pb-4">
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${inlineNoticeConfig.className}`}
              >
                <NoticeIcon className="w-3.5 h-3.5 mt-0.5" />
                <span className="flex-1 leading-relaxed">
                  {inlineNotice.message}
                </span>
                <button
                  type="button"
                  onClick={() => setInlineNotice(null)}
                  className="ml-auto text-current/70 hover:text-current"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })()}
      <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
        <div className="grid gap-6">
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Info className="w-3.5 h-3.5 text-blue-500" />
              <span className="font-medium">{s.guideTitle}</span>
              <span className="text-muted-foreground">{s.guideSubtitle}</span>
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                onClick={() => setServiceGuideExpanded((value) => !value)}
              >
                {serviceGuideExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    {s.guideCollapse}
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    {s.guideExpand}
                  </>
                )}
              </button>
            </div>

            {serviceGuideExpanded && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2">
                    <div className="font-semibold">{s.guideLinuxTitle}</div>
                    <div className="text-muted-foreground leading-relaxed">
                      {s.guideLinuxDesc1}
                    </div>
                    <div className="text-muted-foreground leading-relaxed">
                      {s.guideLinuxDesc2}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2">
                    <div className="font-semibold">{s.guideLocalTitle}</div>
                    <div className="text-muted-foreground leading-relaxed">
                      {s.guideLocalDesc1}
                    </div>
                    <div className="text-muted-foreground leading-relaxed">
                      {s.guideLocalDesc2Prefix}{" "}
                      <span className="font-mono">0.0.0.0</span>{" "}
                      {s.guideLocalDesc2Suffix}
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2 text-[11px]">
                  <div className="font-semibold text-foreground">
                    {s.guidePassThroughTitle}
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    {s.guidePassThroughModel}
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    {s.guidePassThroughQuality}
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    {s.guidePassThroughProcessing}
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    {s.guidePassThroughTasksPrefix}
                    <span className="font-mono">resume</span>
                    {s.guidePassThroughTasksMid}
                    <span className="font-mono">cacheDir</span>
                    {s.guidePassThroughTasksSuffix}
                  </div>
                </div>
              </div>
            )}
          </div>

          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold">
                      {s.localTitle}
                    </span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {s.localDesc}
                    </p>
                  </div>
                  <div className="flex bg-secondary rounded-lg p-0.5 border">
                    <button
                      onClick={() => void toggleDaemonMode(false)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        !daemonMode
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.modeAuto}
                    </button>
                    <button
                      onClick={() => void toggleDaemonMode(true)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        daemonMode
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.modeFixed}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {daemonMode ? s.modeFixedDesc : s.modeAutoDesc}
                </p>

                {daemonMode && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          {s.portLabel}
                        </label>
                        <input
                          type="number"
                          className="w-full border p-2 rounded text-sm bg-secondary font-mono"
                          min={1}
                          max={65535}
                          step={1}
                          value={localPort}
                          onChange={(event) => {
                            const nextValue = event.target.value
                              .replace(/[^\d]/g, "")
                              .slice(0, 5);
                            setLocalPort(nextValue);
                            localStorage.setItem(
                              "config_local_port",
                              nextValue,
                            );
                          }}
                        />
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          {s.portHintPrefix}{" "}
                          <span className="font-mono">8000</span>
                          {s.portHintMid}
                          <span className="font-mono"> 8001 ~ 8020</span>
                          {s.portHintSuffix}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          {s.hostLabel}
                        </label>
                        <select
                          className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                          value={localHost}
                          onChange={(event) => {
                            setLocalHost(event.target.value);
                            localStorage.setItem(
                              "config_local_host",
                              event.target.value,
                            );
                          }}
                        >
                          <option value="127.0.0.1">{s.hostLocal}</option>
                          <option value="0.0.0.0">{s.hostLan}</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          {s.localApiKeyLabel}
                        </label>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() =>
                              setShowLocalApiKey((value) => !value)
                            }
                          >
                            {showLocalApiKey ? (
                              <>
                                <EyeOff className="w-3 h-3" />
                                {s.hide}
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3" />
                                {s.show}
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() => void handleCopyLocalApiKey()}
                            disabled={!canCopyLocalApiKey}
                          >
                            {localApiKeyCopied ? (
                              <>
                                <Check className="w-3 h-3" />
                                {s.copied}
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                {s.copy}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      <input
                        type={showLocalApiKey ? "text" : "password"}
                        className="w-full border p-2 rounded text-sm bg-secondary disabled:opacity-70"
                        placeholder={s.localApiKeyPlaceholder}
                        value={localDaemonApiKey}
                        disabled={isLocalServerRunning}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setLocalDaemonApiKey(nextValue);
                          setLocalApiKeyCopied(false);
                          localStorage.setItem(
                            LOCAL_DAEMON_API_KEY_STORAGE_KEY,
                            nextValue,
                          );
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground leading-5">
                        {isLocalServerRunning
                          ? s.localKeyLockedHint
                          : s.localKeyManualHint}
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-3 pt-0.5">
                      <div className="space-y-0.5 pr-2">
                        <div className="text-sm font-medium leading-none">
                          {s.autoConnectLabel}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {s.autoConnectDescPrefix}
                          <span className="font-mono"> localhost </span>
                          {s.autoConnectDescSuffix}
                        </p>
                      </div>
                      <div className="pt-0.5">
                        <Switch
                          checked={autoConnectRemoteAfterDaemonStart}
                          onCheckedChange={setAutoConnectRemoteAfterDaemonStart}
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${serverStatus?.running ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
                          />
                          <span className="text-xs font-bold">
                            {serverStatus?.running ? s.running : s.stopped}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {serverStatus?.running && (
                            <span className="text-[10px] bg-secondary px-1 rounded border font-mono text-muted-foreground">
                              {s.portInfo
                                .replace("{port}", String(serverStatus.port))
                                .replace("{pid}", String(serverStatus.pid))}
                            </span>
                          )}
                          {warmupTime && (
                            <span className="text-[10px] text-green-600">
                              {s.warmupTimeLabel.replace(
                                "{time}",
                                (warmupTime / 1000).toFixed(1),
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {serverStatus?.running && (
                        <div className="rounded border border-border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground space-y-1">
                          <div className="font-mono break-all">
                            {s.localApiLabel}{" "}
                            {serverStatus.localEndpoint ||
                              serverStatus.endpoint ||
                              `http://127.0.0.1:${serverStatus.port}`}
                          </div>
                          {Array.isArray(serverStatus.lanEndpoints) &&
                            serverStatus.lanEndpoints.length > 0 && (
                              <div className="space-y-0.5">
                                <div>{s.lanApiLabel}</div>
                                {serverStatus.lanEndpoints.map(
                                  (url: string) => (
                                    <div
                                      key={url}
                                      className="font-mono break-all"
                                    >
                                      {url}
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          <div className="space-y-0.5">
                            <div>
                              {s.authLabel}{" "}
                              {serverStatus.authEnabled
                                ? s.authEnabled
                                : s.authDisabledLocal}
                            </div>
                            {serverStatus.authEnabled && (
                              <div>
                                {s.localApiKeyShort}{" "}
                                <span className="font-mono">
                                  {serverStatus.apiKeyHint ||
                                    maskApiKey(effectiveLocalApiKey)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {serverStatus?.running ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleWarmup}
                              disabled={isWarming}
                              className="flex-1 h-8 text-xs gap-2"
                            >
                              <Sparkles className="w-3 h-3" />
                              {isWarming ? s.warming : s.warmup}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={handleStopServer}
                              className="flex-1 h-8 text-xs"
                            >
                              {s.stopServer}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={handleStartServer}
                            disabled={isStartingServer}
                            className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                          >
                            {isStartingServer ? s.starting : s.startServer}
                          </Button>
                        )}
                      </div>
                      <div className="pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleOpenLocalLlamaLog()}
                          className="w-full h-8 text-xs"
                        >
                          {s.viewLocalLog}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t pt-4">
                <div>
                  <span className="text-sm font-semibold">{s.remoteTitle}</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {s.remoteDesc}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {s.remoteUrlLabel}
                    </label>
                    <input
                      type="text"
                      placeholder={s.remoteUrlPlaceholder}
                      className="w-full border p-2 rounded text-sm bg-secondary disabled:opacity-80 disabled:bg-muted/50 disabled:text-muted-foreground disabled:cursor-not-allowed"
                      value={serverUrl}
                      disabled={isRemoteConnected}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setServerUrl(nextValue);
                        localStorage.setItem(
                          REMOTE_API_URL_STORAGE_KEY,
                          nextValue,
                        );
                        localStorage.removeItem("config_server");
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        {s.remoteKeyLabel}
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={() => setShowRemoteApiKey((value) => !value)}
                        >
                          {showRemoteApiKey ? (
                            <>
                              <EyeOff className="w-3 h-3" />
                              {s.hide}
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3" />
                              {s.show}
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={() => void handleCopyRemoteApiKey()}
                          disabled={!canCopyRemoteApiKey}
                        >
                          {remoteApiKeyCopied ? (
                            <>
                              <Check className="w-3 h-3" />
                              {s.copied}
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              {s.copy}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <input
                      type={showRemoteApiKey ? "text" : "password"}
                      className="w-full border p-2 rounded text-sm bg-secondary disabled:opacity-80 disabled:bg-muted/50 disabled:text-muted-foreground disabled:cursor-not-allowed"
                      placeholder="sk-..."
                      value={apiKey}
                      disabled={isRemoteConnected}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setApiKey(nextValue);
                        setRemoteApiKeyCopied(false);
                        localStorage.setItem(
                          REMOTE_API_KEY_STORAGE_KEY,
                          nextValue,
                        );
                      }}
                    />
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {s.remoteFormatHint}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {isRemoteConnected
                      ? s.remoteModeEnabledDesc
                      : s.remoteModeDisabledDesc}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs min-w-[156px] justify-center ml-auto"
                    disabled={isTestingRemote}
                    onClick={() => void handleToggleRemote()}
                  >
                    {isTestingRemote
                      ? s.testing
                      : isRemoteConnected
                        ? s.disconnectRemote
                        : s.connectRemote}
                  </Button>
                </div>

                {isRemoteConnected && (
                  <div className="mt-3 rounded-lg border border-border bg-secondary/30">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-secondary/50 transition-colors"
                      onClick={() => setRemotePanelExpanded((value) => !value)}
                    >
                      <span>{s.remoteDetailTitle}</span>
                      {remotePanelExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {remotePanelExpanded && (
                      <div className="px-3 pb-3 space-y-2 text-[11px]">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {s.remoteDetailDesc}
                        </p>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteStatusLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {remoteRuntimeLoading
                              ? s.refreshing
                              : runtime?.connected
                                ? s.connected
                                : s.disconnected}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteSourceLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.session?.source === "local-daemon"
                              ? s.remoteSourceLocal
                              : s.remoteSourceManual}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteBridgeLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {runtime?.session?.source === "local-daemon"
                              ? s.remoteBridgeLocal
                              : s.remoteBridgeRemote}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteCommLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {network.wsConnected
                              ? s.remoteCommWs
                              : s.remoteCommHttp}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteRetryErrorLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {network.retryCount} / {network.errorCount}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteFileScopeLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.fileScope === "shared-local"
                              ? s.remoteFileScopeLocal
                              : s.remoteFileScopeRemote}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteOutputLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.outputPolicy === "same-dir"
                              ? s.remoteOutputSame
                              : s.remoteOutputRemote}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteExecutionLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.executionMode ||
                              diagnostics?.executionMode ||
                              s.unknown}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteActiveTasksLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.activeTasks ??
                              diagnostics?.activeTaskId ??
                              0}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteModelLoadedLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.modelLoaded
                              ? s.remoteModelLoaded
                              : s.remoteModelNotLoaded}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteCurrentModelLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {runtime?.currentModel || s.none}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteAuthLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.authRequired === true
                              ? s.authRequired
                              : runtime?.authRequired === false
                                ? s.authDisabled
                                : s.unknown}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteCapabilitiesLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {Array.isArray(runtime?.capabilities) &&
                            runtime.capabilities.length > 0
                              ? runtime.capabilities.join(", ")
                              : s.none}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteHealthFailuresLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {diagnostics?.healthFailures ?? 0}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteLastSyncLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastSyncAt
                              ? new Date(
                                  network.lastSyncAt,
                                ).toLocaleTimeString()
                              : "--"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteLatencyLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastLatencyMs ?? "--"} ms /{" "}
                            {network.avgLatencyMs ?? "--"} ms
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">
                            {s.remoteStatusInFlightLabel}
                          </span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastStatusCode ?? "--"} /{" "}
                            {network.inFlightRequests ?? 0}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-relaxed">
                          <div className="flex items-center justify-between gap-3">
                            <span>
                              {runtime?.session?.source === "local-daemon"
                                ? s.remoteLinkLocal
                                : s.remoteLinkRemote}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary"
                              onClick={() =>
                                setRemoteNoticeExpanded((value) => !value)
                              }
                            >
                              {remoteNoticeExpanded
                                ? s.noticeCollapse
                                : s.noticeExpand}
                            </button>
                          </div>
                          {remoteNoticeExpanded && (
                            <p className="mt-1.5">
                              {remoteNotice}
                              {runtime?.session?.source === "local-daemon"
                                ? s.noticeLocalDesc
                                : s.noticeRemoteDesc}
                            </p>
                          )}
                        </div>
                        {remoteLastError && (
                          <div className="text-[10px] text-destructive">
                            {s.remoteLastErrorLabel}: {remoteLastError}
                          </div>
                        )}
                        <div className="pt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={!remoteNetworkLogPath}
                            onClick={() => handleOpenRemoteNetworkLog()}
                          >
                            {s.remoteNetworkLog}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={!remoteMirrorLogPath}
                            onClick={() => handleOpenRemoteMirrorLog()}
                          >
                            {s.remoteMirrorLog}
                          </Button>
                        </div>
                        <div className="pt-1 flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={remoteRuntimeLoading}
                            onClick={() => void refreshRemoteRuntime()}
                          >
                            <RefreshCw
                              className={`w-3 h-3 mr-1 ${remoteRuntimeLoading ? "animate-spin" : ""}`}
                            />
                            {s.refreshStatus}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {logViewer && (
        <LogViewerModal
          lang={lang}
          mode={logViewer.mode}
          filePath={logViewer.filePath}
          title={logViewer.title}
          subtitle={logViewer.subtitle}
          onClose={() => setLogViewer(null)}
        />
      )}
      <AlertModal {...alertProps} />
    </div>
  );
}
