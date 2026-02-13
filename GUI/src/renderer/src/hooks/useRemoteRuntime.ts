import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RemoteApiResponse,
  RemoteDiagnostics,
  RemoteNetworkEvent,
  RemoteNetworkStatus,
  RemoteRuntimeStatus,
} from "../types/api";

const CACHE_KEY = "remote_runtime_cache_v1";
const POLL_INTERVAL_CONNECTED_MS = 3000;
const POLL_INTERVAL_IDLE_MS = 9000;
const DEFAULT_NOTICE =
  "远程模式已启用：所有交互都会直接发送到服务器，并同步镜像保存到本地。";

const createDefaultRuntime = (): RemoteRuntimeStatus => ({
  connected: false,
  executionMode: "local",
  session: null,
  fileScope: "isolated-remote",
  outputPolicy: "scoped-remote-dir",
  notice: DEFAULT_NOTICE,
  syncMirrorPath: "",
  networkEventLogPath: "",
});

const createDefaultNetwork = (): RemoteNetworkStatus => ({
  connected: false,
  executionMode: "local",
  session: null,
  fileScope: "isolated-remote",
  outputPolicy: "scoped-remote-dir",
  wsConnected: false,
  inFlightRequests: 0,
  totalEvents: 0,
  successCount: 0,
  errorCount: 0,
  retryCount: 0,
  uploadCount: 0,
  downloadCount: 0,
  notice: DEFAULT_NOTICE,
  syncMirrorPath: "",
  networkEventLogPath: "",
});

const createDefaultDiagnostics = (): RemoteDiagnostics => ({
  executionMode: "local",
  connected: false,
  session: null,
  healthFailures: 0,
  activeTaskId: null,
  syncMirrorPath: "",
  networkEventLogPath: "",
  notice: DEFAULT_NOTICE,
  network: createDefaultNetwork(),
});

export interface RemoteErrorUi {
  title: string;
  description: string;
  hint?: string;
}

export interface UseRemoteRuntimeResult {
  runtime: RemoteRuntimeStatus;
  network: RemoteNetworkStatus;
  diagnostics: RemoteDiagnostics;
  networkEvents: RemoteNetworkEvent[];
  loading: boolean;
  refreshing: boolean;
  lastError: string | null;
  lastUpdatedAt: number | null;
  isRemoteMode: boolean;
  notice: string;
  refresh: (withEvents?: boolean) => Promise<void>;
  connect: (url: string, apiKey?: string) => Promise<RemoteApiResponse>;
  disconnect: () => Promise<RemoteApiResponse>;
  mapApiError: (
    response?: RemoteApiResponse | null,
    fallbackMessage?: string,
  ) => RemoteErrorUi;
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sanitizeSession = (session: RemoteRuntimeStatus["session"]) => {
  if (!session) return null;
  const { apiKey: _apiKey, ...rest } = session as any;
  return rest;
};

const toRuntime = (
  payload: RemoteRuntimeStatus | undefined,
): RemoteRuntimeStatus => ({
  ...createDefaultRuntime(),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice: payload?.notice || DEFAULT_NOTICE,
});

const toNetwork = (
  payload: RemoteNetworkStatus | undefined,
): RemoteNetworkStatus => ({
  ...createDefaultNetwork(),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice: payload?.notice || DEFAULT_NOTICE,
});

const toDiagnostics = (
  payload: RemoteDiagnostics | undefined,
): RemoteDiagnostics => ({
  ...createDefaultDiagnostics(),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice: payload?.notice || DEFAULT_NOTICE,
  network: toNetwork(payload?.network),
});

export const mapRemoteApiError = (
  response?: RemoteApiResponse | null,
  fallbackMessage?: string,
): RemoteErrorUi => {
  const fallback = fallbackMessage || "远程请求失败。";
  if (!response) {
    return {
      title: "远程请求失败",
      description: fallback,
      hint: "请检查网络连通性与远程服务状态。",
    };
  }

  const code = response.code || "REMOTE_UNKNOWN";
  const description = response.message || fallback;
  const hint = response.actionHint || undefined;
  switch (code) {
    case "REMOTE_UNAUTHORIZED":
      return { title: "鉴权失败", description, hint };
    case "REMOTE_TIMEOUT":
      return { title: "请求超时", description, hint };
    case "REMOTE_NETWORK":
      return { title: "网络不可达", description, hint };
    case "REMOTE_PROTOCOL":
      return { title: "连接未就绪", description, hint };
    case "REMOTE_NOT_FOUND":
      return { title: "远程接口不存在", description, hint };
    default:
      return { title: "远程请求失败", description, hint };
  }
};

const loadCachedSnapshot = (): {
  runtime: RemoteRuntimeStatus;
  network: RemoteNetworkStatus;
  diagnostics: RemoteDiagnostics;
  events: RemoteNetworkEvent[];
  lastUpdatedAt: number | null;
} => {
  const fallback = {
    runtime: createDefaultRuntime(),
    network: createDefaultNetwork(),
    diagnostics: createDefaultDiagnostics(),
    events: [] as RemoteNetworkEvent[],
    lastUpdatedAt: null as number | null,
  };

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      runtime?: RemoteRuntimeStatus;
      network?: RemoteNetworkStatus;
      diagnostics?: RemoteDiagnostics;
      events?: RemoteNetworkEvent[];
      updatedAt?: number;
    };
    return {
      runtime: toRuntime(parsed.runtime),
      network: toNetwork(parsed.network),
      diagnostics: toDiagnostics(parsed.diagnostics),
      events: Array.isArray(parsed.events) ? parsed.events : [],
      lastUpdatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
    };
  } catch {
    return fallback;
  }
};

export function useRemoteRuntime(): UseRemoteRuntimeResult {
  const cached = useMemo(loadCachedSnapshot, []);
  const [runtime, setRuntime] = useState<RemoteRuntimeStatus>(cached.runtime);
  const [network, setNetwork] = useState<RemoteNetworkStatus>(cached.network);
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnostics>(
    cached.diagnostics,
  );
  const [networkEvents, setNetworkEvents] = useState<RemoteNetworkEvent[]>(
    cached.events,
  );
  const networkEventsRef = useRef<RemoteNetworkEvent[]>(cached.events);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    cached.lastUpdatedAt,
  );

  const persistCache = useCallback(
    (
      nextRuntime: RemoteRuntimeStatus,
      nextNetwork: RemoteNetworkStatus,
      nextDiagnostics: RemoteDiagnostics,
      nextEvents: RemoteNetworkEvent[],
      updatedAt: number,
    ) => {
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            runtime: nextRuntime,
            network: nextNetwork,
            diagnostics: nextDiagnostics,
            events: nextEvents,
            updatedAt,
          }),
        );
      } catch {
        // Ignore cache write failures
      }
    },
    [],
  );

  const refresh = useCallback(
    async (withEvents: boolean = true) => {
      const api = window.api;
      if (!api) {
        setLoading(false);
        return;
      }

      setRefreshing(true);
      try {
        const [statusResult, networkResult, diagnosticsResult] =
          await Promise.all([
            api.remoteStatus(),
            api.remoteNetworkStatus(),
            api.remoteDiagnostics(),
          ]);

        const nextRuntime = toRuntime(statusResult?.data);
        const nextNetwork = toNetwork(networkResult?.data);
        const nextDiagnostics = toDiagnostics(diagnosticsResult?.data);

        let nextEvents = networkEventsRef.current;
        if (withEvents) {
          const limit = nextRuntime.connected ? 80 : 20;
          const eventsResult = await api.remoteNetworkEvents(limit);
          if (eventsResult?.ok && Array.isArray(eventsResult.data)) {
            nextEvents = eventsResult.data;
            networkEventsRef.current = nextEvents;
            setNetworkEvents(nextEvents);
          }
        }

        if (!statusResult?.ok) {
          setLastError(statusResult?.message || "获取远程状态失败。");
        } else {
          setLastError(null);
        }

        setRuntime(nextRuntime);
        setNetwork(nextNetwork);
        setDiagnostics(nextDiagnostics);

        const updatedAt = Date.now();
        setLastUpdatedAt(updatedAt);
        persistCache(
          nextRuntime,
          nextNetwork,
          nextDiagnostics,
          nextEvents,
          updatedAt,
        );
      } catch (error) {
        setLastError(toErrorMessage(error));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [persistCache],
  );

  const connect = useCallback(
    async (url: string, apiKey?: string): Promise<RemoteApiResponse> => {
      const api = window.api;
      if (!api) {
        return { ok: false, message: "渲染进程 API 不可用。" };
      }
      const response = await api.remoteConnect({
        url: url.trim(),
        apiKey: apiKey?.trim() || undefined,
      });
      await refresh(true);
      return response;
    },
    [refresh],
  );

  const disconnect = useCallback(async (): Promise<RemoteApiResponse> => {
    const api = window.api;
    if (!api) {
      return { ok: false, message: "渲染进程 API 不可用。" };
    }
    const response = await api.remoteDisconnect();
    await refresh(true);
    return response;
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      await refresh(true);
      if (cancelled) return;
      timer = setTimeout(
        loop,
        runtime.connected ? POLL_INTERVAL_CONNECTED_MS : POLL_INTERVAL_IDLE_MS,
      );
    };

    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, runtime.connected]);

  return {
    runtime,
    network,
    diagnostics,
    networkEvents,
    loading,
    refreshing,
    lastError,
    lastUpdatedAt,
    isRemoteMode: runtime.executionMode === "remote" && runtime.connected,
    notice: runtime.notice || network.notice || DEFAULT_NOTICE,
    refresh,
    connect,
    disconnect,
    mapApiError: mapRemoteApiError,
  };
}
