import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Info,
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

export function ServiceView({ lang, remoteRuntime: remoteState }: ServiceViewProps) {
  const t = translations[lang];
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
    () => localStorage.getItem("config_local_port") || String(DEFAULT_LOCAL_API_PORT),
  );
  const [localHost, setLocalHost] = useState(
    () => localStorage.getItem("config_local_host") || "127.0.0.1",
  );
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [isWarming, setIsWarming] = useState(false);
  const [isTestingRemote, setIsTestingRemote] = useState(false);
  const [remotePanelExpanded, setRemotePanelExpanded] = useState(
    () => parseBooleanStorage(REMOTE_PANEL_EXPANDED_STORAGE_KEY, true),
  );
  const [autoConnectRemoteAfterDaemonStart, setAutoConnectRemoteAfterDaemonStart] =
    useState(() =>
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
        title: "确认切换到自动模式？",
        description:
          "当前本机常驻服务正在运行。切换到自动模式后将立即停止本机常驻服务，并断开本机远程桥接链路。",
        variant: "warning",
        confirmText: "确认切换",
        cancelText: "取消",
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
    deviceMode: (localStorage.getItem("config_device_mode") as "auto" | "cpu") || "auto",
    gpuDeviceId: localStorage.getItem("config_gpu_device_id") || "",
    autoConnectRemote: autoConnectRemoteAfterDaemonStart,
  });

  const handleStartServer = async () => {
    const activeModel = localStorage.getItem("config_model") || "";
    if (!activeModel) {
      showAlert({
        title: "未选择模型",
        description: "请先在模型管理页面选择可用模型后再启动本机常驻服务。",
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
        let errorDetail = startResult?.error || "服务启动失败，请检查日志。";
        try {
          const logs = await (window as any).api?.serverLogs?.();
          if (Array.isArray(logs) && logs.length > 0) {
            const compactTail = logs
              .slice(-8)
              .map((line: unknown) => String(line || "").replace(/\s+/g, " ").trim())
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
          title: "启动失败",
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
        localStorage.setItem(LOCAL_DAEMON_API_KEY_STORAGE_KEY, startResult.apiKey);
      }
      // 自动接入远程统一链路
      let autoConnected = false;
      if (autoConnectRemoteAfterDaemonStart && startResult?.endpoint && !isRemoteConnected) {
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
          }
        } catch {
          // 连接失败不阻塞启动流程
        }
      } else if (autoConnectRemoteAfterDaemonStart && startResult?.endpoint && isRemoteConnected) {
        // 已有远程连接时不覆盖，仅同步表单
        if (startResult.endpoint) {
          setServerUrl(startResult.endpoint);
          localStorage.setItem(REMOTE_API_URL_STORAGE_KEY, startResult.endpoint);
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
        localStorage.setItem("config_local_port", String(startResult.selectedPort));
        detailParts.push(
          `端口 ${startResult.requestedPort || preferredPort} 被占用，已自动切换为 ${startResult.selectedPort}（自动探测范围 ${preferredPort}-${preferredPort + LOCAL_API_PORT_SCAN_RANGE}）`,
        );
      } else if (startResult?.selectedPort) {
        setLocalPort(String(startResult.selectedPort));
        localStorage.setItem("config_local_port", String(startResult.selectedPort));
      }
      if (startResult?.endpoint) {
        detailParts.push(`本机地址：${startResult.endpoint}`);
      }
      if (Array.isArray(startResult?.lanEndpoints) && startResult.lanEndpoints.length > 0) {
        detailParts.push(`局域网地址：${startResult.lanEndpoints[0]}`);
      }
      if (autoConnected) {
        detailParts.push("已自动接入本机远程统一链路");
      } else if (!autoConnectRemoteAfterDaemonStart) {
        detailParts.push(
          `已按你的设置仅启动本机服务；如需远程统一链路，请点击右侧\u201c连接并启用远程\u201d。`,
        );
      } else if (isRemoteConnected) {
        detailParts.push("本机服务已启动，当前继续保持你已有的远程连接。");
      }

      showAlert({
        title: startResult?.portChanged ? "本机推理服务已启动（端口已调整）" : "本机推理服务已启动",
        description: detailParts.join(" | ") || "本机推理服务已就绪。",
        variant: "success",
      });

      if ((window as any).api?.serverStatus) {
        const status = await (window as any).api.serverStatus();
        setServerStatus(status);
      }
      await refreshRemoteRuntime();
    } catch (error) {
      showAlert({
        title: "启动异常",
        description: `启动本机推理服务失败：${String(error)}`,
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
      }
    } catch (error) {
      console.error("Warmup failed", error);
    } finally {
      setIsWarming(false);
    }
  };

  const handleCopyLocalApiKey = async () => {
    if (!canCopyLocalApiKey) {
      showAlert({
        title: "无法复制",
        description: "当前没有可复制的本机 API 密钥，请先填写密钥或启动服务后重试。",
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
        title: "复制失败",
        description: `复制本机 API 密钥失败：${String(error)}`,
        variant: "destructive",
      });
    }
  };

  const handleCopyRemoteApiKey = async () => {
    if (!canCopyRemoteApiKey) {
      showAlert({
        title: "无法复制",
        description: "当前没有可复制的远程 API 密钥，请先填写后重试。",
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
        title: "复制失败",
        description: `复制远程 API 密钥失败：${String(error)}`,
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
            title: "已断开远程连接",
            description: "已切回本地执行模式。",
            variant: "success",
          });
        } else {
          const ui = mapApiError(disconnectResult, "断开远程连接失败。");
          showAlert({
            title: ui.title,
            description: ui.hint ? `${ui.description} ${ui.hint}` : ui.description,
            variant: "destructive",
          });
        }
        return;
      }

      const url = serverUrl.trim();
      if (!url) {
        showAlert({
          title: "缺少地址",
          description: "请先填写远程 API 地址后再连接。",
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
          title: "连接成功",
          description: `${sourceHint}已启用远程模式${result?.data?.version ? `（服务版本 v${result.data.version}）` : ""}`,
          variant: "success",
        });
      } else {
        const ui = mapApiError(result, "连接远程服务器失败。");
        showAlert({
          title: ui.title,
          description: ui.hint ? `${ui.description} ${ui.hint}` : ui.description,
          variant: "destructive",
        });
      }
    } catch (error) {
      showAlert({
        title: "连接异常",
        description: "连接远程服务器失败：" + String(error),
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
    openFileLog(logPath, "本地 llama 日志");
  };

  const handleOpenRemoteNetworkLog = () => {
    openFileLog(remoteNetworkLogPath, "远程网络日志");
  };

  const handleOpenRemoteMirrorLog = () => {
    openFileLog(remoteMirrorLogPath, "远程任务镜像日志");
  };

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Server className="w-6 h-6 text-primary" />
          {t.nav.service || "服务管理"}
          {(isStartingServer || remoteRuntimeLoading) && (
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-2">
          本页面用于管理本机常驻推理服务与远程连接链路。服务启动参数使用“高级功能”中已保存的模型与推理配置。
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
        <div className="grid gap-6">
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Info className="w-3.5 h-3.5 text-blue-500" />
              <span className="font-medium">链路说明</span>
              <span className="text-muted-foreground">
                Linux Server 与本机常驻差异、参数透传范围（点击可查看详情）
              </span>
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                onClick={() => setServiceGuideExpanded((value) => !value)}
              >
                {serviceGuideExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    收起说明
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    展开说明
                  </>
                )}
              </button>
            </div>

            {serviceGuideExpanded && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2">
                    <div className="font-semibold">Linux Server（远程服务器）</div>
                    <div className="text-muted-foreground leading-relaxed">
                      部署在独立 Linux 主机，通常用于多客户端共享算力。GUI 通过网络连接，服务端文件系统与本机隔离。
                    </div>
                    <div className="text-muted-foreground leading-relaxed">
                      默认建议手动连接；适合团队协作、集中部署、长时运行。
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2">
                    <div className="font-semibold">本机 GUI 常驻服务（Windows）</div>
                    <div className="text-muted-foreground leading-relaxed">
                      由当前 GUI 在本机启动 API 常驻进程，本地文件可直接共享；可选自动接入远程统一链路。
                    </div>
                    <div className="text-muted-foreground leading-relaxed">
                      绑定 <span className="font-mono">0.0.0.0</span> 后可给局域网设备提供同一套接口，逻辑与 Linux Server 一致。
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 space-y-2 text-[11px]">
                  <div className="font-semibold text-foreground">
                    通过服务链路可透传的参数与功能
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    模型与推理：模型名、预设、上下文、GPU 层、设备 ID、并发、Flash Attention、KV Cache、Batch、Seed。
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    质量策略：严格模式、行数校验与容差、重复惩罚、最大重试、术语覆盖率策略、重试温度提升、反馈注入。
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    文本处理：预/后处理规则（路径或内联规则）、文本保护、假名/注音/标点修复、繁中转换、CoT 与摘要保存。
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    任务能力：上传、创建任务、WS/轮询进度、日志、取消、下载结果。注意：外部远程会话默认不透传本地
                    <span className="font-mono">resume</span> 与
                    <span className="font-mono">cacheDir</span>，仅本机常驻会话支持本地路径语义。
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
                    <span className="text-sm font-semibold">本机推理服务</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      在本机启动 API 常驻进程，可供当前 GUI 或局域网客户端调用
                    </p>
                  </div>
                  <div className="flex bg-secondary rounded-lg p-0.5 border">
                    <button
                      onClick={() => void toggleDaemonMode(false)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!daemonMode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      自动模式
                    </button>
                    <button
                      onClick={() => void toggleDaemonMode(true)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${daemonMode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      常驻模式
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {daemonMode
                    ? "常驻模式下服务持续运行；适合频繁翻译或局域网共享。"
                    : "翻译时自动启动推理服务，闲置时自动关闭以释放显存。"}
                </p>

                {daemonMode && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          监听端口 (Port)
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
                            localStorage.setItem("config_local_port", nextValue);
                          }}
                        />
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          默认端口为 <span className="font-mono">8000</span>；若端口被占用，将自动尝试
                          <span className="font-mono"> 8001 ~ 8020</span> 并切换到可用端口。
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          绑定地址 (Host)
                        </label>
                        <select
                          className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                          value={localHost}
                          onChange={(event) => {
                            setLocalHost(event.target.value);
                            localStorage.setItem("config_local_host", event.target.value);
                          }}
                        >
                          <option value="127.0.0.1">127.0.0.1 (仅本机)</option>
                          <option value="0.0.0.0">0.0.0.0 (局域网可访问)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          本机 API 密钥（留空自动生成）
                        </label>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() => setShowLocalApiKey((value) => !value)}
                          >
                            {showLocalApiKey ? (
                              <>
                                <EyeOff className="w-3 h-3" />
                                隐藏
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3" />
                                显示
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
                                已复制
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                复制
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      <input
                        type={showLocalApiKey ? "text" : "password"}
                        className="w-full border p-2 rounded text-sm bg-secondary disabled:opacity-70"
                        placeholder="留空则启动服务时自动生成"
                        value={localDaemonApiKey}
                        disabled={isLocalServerRunning}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setLocalDaemonApiKey(nextValue);
                          setLocalApiKeyCopied(false);
                          localStorage.setItem(LOCAL_DAEMON_API_KEY_STORAGE_KEY, nextValue);
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground leading-5">
                        {isLocalServerRunning
                          ? "服务运行中，密钥已锁定；如需修改请先停止服务。"
                          : "可手动填写固定密钥；留空时会在启动服务后自动生成并保存。"}
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-3 pt-0.5">
                      <div className="space-y-0.5 pr-2">
                        <div className="text-sm font-medium leading-none">
                          启动后自动进入远程统一链路
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          开启后自动连接
                          <span className="font-mono"> localhost </span>
                          进入统一链路；关闭则仅启动本机服务，可手动连接远程。
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
                            {serverStatus?.running ? "运行中" : "已停止"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {serverStatus?.running && (
                            <span className="text-[10px] bg-secondary px-1 rounded border font-mono text-muted-foreground">
                              监听端口:{serverStatus.port} (PID: {serverStatus.pid})
                            </span>
                          )}
                          {warmupTime && (
                            <span className="text-[10px] text-green-600">
                              预热耗时: {(warmupTime / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      </div>

                      {serverStatus?.running && (
                        <div className="rounded border border-border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground space-y-1">
                          <div className="font-mono break-all">
                            本机 API：{" "}
                            {serverStatus.localEndpoint ||
                              serverStatus.endpoint ||
                              `http://127.0.0.1:${serverStatus.port}`}
                          </div>
                          {Array.isArray(serverStatus.lanEndpoints) &&
                            serverStatus.lanEndpoints.length > 0 && (
                              <div className="space-y-0.5">
                                <div>局域网 API：</div>
                                {serverStatus.lanEndpoints.map((url: string) => (
                                  <div key={url} className="font-mono break-all">
                                    {url}
                                  </div>
                                ))}
                              </div>
                            )}
                          <div className="space-y-0.5">
                            <div>鉴权: {serverStatus.authEnabled ? "已启用" : "未启用"}</div>
                            {serverStatus.authEnabled && (
                              <div>
                                本地 API 密钥:{" "}
                                <span className="font-mono">
                                  {serverStatus.apiKeyHint || maskApiKey(effectiveLocalApiKey)}
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
                              {isWarming ? "预热中..." : "预热模型"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={handleStopServer}
                              className="flex-1 h-8 text-xs"
                            >
                              停止服务
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={handleStartServer}
                            disabled={isStartingServer}
                            className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                          >
                            {isStartingServer ? "启动中..." : "启动服务"}
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
                          查看本地 llama 日志
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t pt-4">
                <div>
                  <span className="text-sm font-semibold">远程 API 服务器</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    连接远程部署的推理服务，或连接你本机常驻服务进入统一远程链路
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      API 地址
                    </label>
                    <input
                      type="text"
                      placeholder="示例：http://127.0.0.1:8000"
                      className="w-full border p-2 rounded text-sm bg-secondary disabled:opacity-80 disabled:bg-muted/50 disabled:text-muted-foreground disabled:cursor-not-allowed"
                      value={serverUrl}
                      disabled={isRemoteConnected}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setServerUrl(nextValue);
                        localStorage.setItem(REMOTE_API_URL_STORAGE_KEY, nextValue);
                        localStorage.removeItem("config_server");
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        API 密钥（可选）
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
                              隐藏
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3" />
                              显示
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
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              复制
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
                        localStorage.setItem(REMOTE_API_KEY_STORAGE_KEY, nextValue);
                      }}
                    />
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  格式：`http(s)://主机:端口`。SSH 隧道请填写 `http://127.0.0.1:本地端口`。
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {isRemoteConnected
                      ? "当前已启用远程模式：所有交互将直接发送到服务器并同步镜像到本地。"
                      : "填写 API 地址与密钥后，可手动连接并启用远程模式。"}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs min-w-[156px] justify-center ml-auto"
                    disabled={isTestingRemote}
                    onClick={() => void handleToggleRemote()}
                  >
                    {isTestingRemote
                      ? "测试中..."
                      : isRemoteConnected
                        ? "断开远程"
                        : "连接并启用远程"}
                  </Button>
                </div>

                {isRemoteConnected && (
                  <div className="mt-3 rounded-lg border border-border bg-secondary/30">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-secondary/50 transition-colors"
                      onClick={() => setRemotePanelExpanded((value) => !value)}
                    >
                      <span>远程运行详情（连接/模型/网络）</span>
                      {remotePanelExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {remotePanelExpanded && (
                      <div className="px-3 pb-3 space-y-2 text-[11px]">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          查看当前远程连接状态、桥接链路、模型加载与网络状态概览
                        </p>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">连接状态</span>
                          <span className="font-mono justify-self-end text-right">
                            {remoteRuntimeLoading
                              ? "刷新中..."
                              : runtime?.connected
                                ? "已连接"
                                : "未连接"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">连接来源</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.session?.source === "local-daemon"
                              ? "本机常驻服务"
                              : "手动远程"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">桥接链路</span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {runtime?.session?.source === "local-daemon"
                              ? "localhost /api/v1 统一链路"
                              : "远程服务器直连"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">通讯模式</span>
                          <span className="font-mono justify-self-end text-right">
                            {network.wsConnected ? "WebSocket 实时" : "HTTP 轮询"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">重试 / 错误</span>
                          <span className="font-mono justify-self-end text-right">
                            {network.retryCount} / {network.errorCount}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">文件域</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.fileScope === "shared-local"
                              ? "本地共享文件系统"
                              : "远程隔离文件系统"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">输出策略</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.outputPolicy === "same-dir" ? "原目录保存" : "远程分域目录"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">执行模式</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.executionMode || diagnostics?.executionMode || "未知"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">活跃任务</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.activeTasks ?? diagnostics?.activeTaskId ?? 0}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">模型加载</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.modelLoaded ? "已加载" : "未加载"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">当前模型</span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {runtime?.currentModel || "无"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">鉴权要求</span>
                          <span className="font-mono justify-self-end text-right">
                            {runtime?.authRequired === true
                              ? "必需"
                              : runtime?.authRequired === false
                                ? "已关闭"
                                : "未知"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">服务能力</span>
                          <span className="font-mono justify-self-end text-right break-all">
                            {Array.isArray(runtime?.capabilities) &&
                              runtime.capabilities.length > 0
                              ? runtime.capabilities.join(", ")
                              : "无"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">最近健康失败</span>
                          <span className="font-mono justify-self-end text-right">
                            {diagnostics?.healthFailures ?? 0}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">最近同步</span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastSyncAt
                              ? new Date(network.lastSyncAt).toLocaleTimeString()
                              : "--"}
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">延迟(当前/平均)</span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastLatencyMs ?? "--"} ms / {network.avgLatencyMs ?? "--"} ms
                          </span>
                        </div>
                        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                          <span className="text-muted-foreground">状态码 / 在途</span>
                          <span className="font-mono justify-self-end text-right">
                            {network.lastStatusCode ?? "--"} / {network.inFlightRequests ?? 0}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-relaxed">
                          <div className="flex items-center justify-between gap-3">
                            <span>
                              {runtime?.session?.source === "local-daemon"
                                ? "当前链路：本机常驻桥接（localhost /api/v1）"
                                : "当前链路：外部远程会话（结果回传并镜像到本地）"}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary"
                              onClick={() => setRemoteNoticeExpanded((value) => !value)}
                            >
                              {remoteNoticeExpanded ? "收起说明" : "展开说明"}
                            </button>
                          </div>
                          {remoteNoticeExpanded && (
                            <p className="mt-1.5">
                              {remoteNotice}
                              {runtime?.session?.source === "local-daemon"
                                ? " 当前为本机常驻桥接链路，文件域与输出策略沿用本地语义；网络状态、重试与事件会持续更新并写入本地镜像日志。"
                                : " 当前为外部远程会话，`resume` 与 `cacheDir` 不会下发到服务器；任务结果会回传并镜像保存到本地，避免跨机器路径语义混淆。"}
                            </p>
                          )}
                        </div>
                        {remoteLastError && (
                          <div className="text-[10px] text-destructive">
                            最近错误: {remoteLastError}
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
                            远程网络日志
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={!remoteMirrorLogPath}
                            onClick={() => handleOpenRemoteMirrorLog()}
                          >
                            远程任务镜像日志
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
                            刷新状态
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
