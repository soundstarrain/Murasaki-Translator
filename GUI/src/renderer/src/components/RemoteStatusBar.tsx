import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Cloud,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { UseRemoteRuntimeResult } from "../hooks/useRemoteRuntime";

interface RemoteStatusBarProps {
  remote: UseRemoteRuntimeResult;
}

interface FloatingPosition {
  x: number;
  y: number;
}

const FLOATING_STATUS_BAR_EDGE_PADDING = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const formatAgo = (timestamp?: number): string => {
  if (!timestamp) return "--";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 5) return "刚刚";
  if (deltaSeconds < 60) return `${deltaSeconds}秒前`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}分钟前`;
  return `${Math.floor(deltaSeconds / 3600)}小时前`;
};

export function RemoteStatusBar({ remote }: RemoteStatusBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasRemoteModeRef = useRef(false);
  const isRemoteMode = remote.runtime.executionMode === "remote";

  const clampPositionToViewport = useCallback(
    (next: FloatingPosition): FloatingPosition => {
      const panel = panelRef.current;
      const width = panel?.offsetWidth || 480;
      const height = panel?.offsetHeight || 220;
      const maxX = Math.max(
        FLOATING_STATUS_BAR_EDGE_PADDING,
        window.innerWidth - width - FLOATING_STATUS_BAR_EDGE_PADDING,
      );
      const maxY = Math.max(
        FLOATING_STATUS_BAR_EDGE_PADDING,
        window.innerHeight - height - FLOATING_STATUS_BAR_EDGE_PADDING,
      );
      return {
        x: clamp(next.x, FLOATING_STATUS_BAR_EDGE_PADDING, maxX),
        y: clamp(next.y, FLOATING_STATUS_BAR_EDGE_PADDING, maxY),
      };
    },
    [],
  );

  useEffect(() => {
    if (isRemoteMode && !wasRemoteModeRef.current) {
      setPosition(null);
    }
    wasRemoteModeRef.current = isRemoteMode;
  }, [isRemoteMode]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const clamped = clampPositionToViewport(prev);
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        return clamped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPositionToViewport]);

  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (event: MouseEvent) => {
      const next = clampPositionToViewport({
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      });
      setPosition(next);
    };

    const handlePointerUp = () => {
      setDragging(false);
    };

    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [dragging, clampPositionToViewport]);

  const handleStartDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setDragging(true);
    event.preventDefault();
  };

  const wrapperStyle = position
    ? { left: `${position.x}px`, top: `${position.y}px` }
    : { right: "0.75rem", bottom: "0.75rem" };

  if (!isRemoteMode) return null;

  const sessionSource = remote.runtime.session?.source || "manual";
  const sourceLabel =
    sessionSource === "local-daemon" ? "本机常驻服务" : "远程服务器";
  const endpoint = remote.runtime.session?.url || "--";
  const fileScopeLabel =
    remote.runtime.fileScope === "shared-local"
      ? "文件域：本地共享"
      : "文件域：远程隔离";
  const outputPolicyLabel =
    remote.runtime.outputPolicy === "same-dir"
      ? "输出：同目录"
      : "输出：远程分域目录";
  const isConnected = remote.runtime.connected;
  const hasError = remote.network.errorCount > 0 || Boolean(remote.lastError);
  const communicationText = remote.network.wsConnected
    ? "通信：WebSocket 实时"
    : "通信：HTTP 轮询";

  return (
    <div className="fixed z-[999] pointer-events-none" style={wrapperStyle}>
      <div
        ref={panelRef}
        className={`pointer-events-auto w-[min(480px,calc(100vw-1.5rem))] rounded-lg border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80 ${
          hasError ? "border-destructive/45" : "border-border"
        } ${dragging ? "opacity-95" : ""}`}
      >
        <div className="px-3 py-2 text-[11px] text-foreground space-y-2">
          <div
            className={`flex items-center gap-2 flex-wrap select-none ${
              dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            title="按住拖动可移动状态窗"
            onMouseDown={handleStartDrag}
          >
            <div className="flex items-center gap-1 font-semibold">
              <Cloud className="w-3.5 h-3.5" />
              <span>{sourceLabel}</span>
            </div>
            <div
              className={`flex items-center gap-1 ${isConnected ? "text-emerald-500" : "text-muted-foreground"}`}
            >
              {isConnected ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span>{isConnected ? "已连接" : "未连接"}</span>
            </div>
            <span className="text-muted-foreground">{communicationText}</span>
            <span className="text-muted-foreground">延迟: {remote.network.lastLatencyMs ?? "--"} ms</span>
            <span className="text-muted-foreground">在途: {remote.network.inFlightRequests}</span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:bg-secondary"
              onClick={() => void remote.refresh(true)}
              title="立即刷新远程状态"
            >
              <RefreshCw className={`w-3 h-3 ${remote.refreshing ? "animate-spin" : ""}`} />
              <span>刷新</span>
            </button>
          </div>

          <div className="flex items-start justify-between gap-2 text-[10px] text-muted-foreground">
            <span>连接地址:</span>
            <span className="font-mono break-all text-right">{endpoint}</span>
          </div>

          <div className="text-[10px] text-muted-foreground">
            最近同步: {formatAgo(remote.network.lastSyncAt)} · 最近检测:{" "}
            {formatAgo(remote.runtime.lastCheckedAt)} · 活动任务:{" "}
            {remote.diagnostics.activeTaskId ? "1" : "0"} · 事件:{" "}
            {remote.network.totalEvents} · 健康失败:{" "}
            {remote.diagnostics.healthFailures}
          </div>
          <div className="text-[10px] text-muted-foreground">
            成功/错误/重试: {remote.network.successCount}/{remote.network.errorCount}/
            {remote.network.retryCount} · 上传/下载: {remote.network.uploadCount}/
            {remote.network.downloadCount}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {fileScopeLabel} · {outputPolicyLabel}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border px-3 py-2 text-[10px] bg-secondary/20 space-y-1.5">
            <div className="text-muted-foreground">
              运行来源:{" "}
              <span className="font-mono">{sourceLabel}</span>
            </div>
            <div className="text-muted-foreground">
              运行模式:{" "}
              <span className="font-mono">
                {remote.runtime.executionMode === "remote" ? "远程" : "本地"}
              </span>
            </div>
            <div className="text-muted-foreground">
              镜像文件:{" "}
              <span className="font-mono">{remote.runtime.syncMirrorPath || "--"}</span>
            </div>
            <div className="text-muted-foreground">
              网络日志:{" "}
              <span className="font-mono">
                {remote.runtime.networkEventLogPath || "--"}
              </span>
            </div>
            <div className="text-muted-foreground">
              最近同步:{" "}
              <span className="font-mono">
                {remote.network.lastSyncAt
                  ? new Date(remote.network.lastSyncAt).toLocaleTimeString()
                  : "--"}
              </span>
            </div>
            <div className="text-muted-foreground">
              延迟(当前/平均):{" "}
              <span className="font-mono">
                {remote.network.lastLatencyMs ?? "--"} ms /{" "}
                {remote.network.avgLatencyMs ?? "--"} ms
              </span>
            </div>
            <div className="text-muted-foreground">
              状态码 / 在途:{" "}
              <span className="font-mono">
                {remote.network.lastStatusCode ?? "--"} /{" "}
                {remote.network.inFlightRequests ?? 0}
              </span>
            </div>
            {remote.network.lastError && (
              <div className="text-destructive">
                最近错误: {remote.network.lastError.message}
                {remote.network.lastError.path
                  ? ` @ ${remote.network.lastError.path}`
                  : ""}
              </div>
            )}
            {remote.lastError && (
              <div className="text-destructive">状态错误: {remote.lastError}</div>
            )}
          </div>
        )}

        <div className="border-t border-border/60 px-3 py-1.5 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-secondary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronUp className="w-3 h-3" />
            )}
            <span>{expanded ? "收起详情" : "展开详情"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
