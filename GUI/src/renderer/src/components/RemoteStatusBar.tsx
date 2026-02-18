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
import { translations, Language } from "../lib/i18n";

interface RemoteStatusBarProps {
  remote: UseRemoteRuntimeResult;
  lang: Language;
}

interface FloatingPosition {
  x: number;
  y: number;
}

const FLOATING_STATUS_BAR_EDGE_PADDING = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

type RemoteStatusText = (typeof translations)["zh"]["remoteStatusBar"];

const formatAgo = (t: RemoteStatusText, timestamp?: number): string => {
  if (!timestamp) return "--";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 5) return t.agoJustNow;
  if (deltaSeconds < 60)
    return t.agoSeconds.replace("{count}", String(deltaSeconds));
  if (deltaSeconds < 3600)
    return t.agoMinutes.replace(
      "{count}",
      String(Math.floor(deltaSeconds / 60)),
    );
  return t.agoHours.replace("{count}", String(Math.floor(deltaSeconds / 3600)));
};

export function RemoteStatusBar({ remote, lang }: RemoteStatusBarProps) {
  const t = translations[lang].remoteStatusBar;
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
    sessionSource === "local-daemon"
      ? t.sourceLocalDaemon
      : t.sourceRemoteServer;
  const endpoint = remote.runtime.session?.url || "--";
  const fileScopeLabel =
    remote.runtime.fileScope === "shared-local"
      ? t.fileScopeLocal
      : t.fileScopeRemote;
  const outputPolicyLabel =
    remote.runtime.outputPolicy === "same-dir"
      ? t.outputSameDir
      : t.outputRemoteDir;
  const isConnected = remote.runtime.connected;
  const hasError = remote.network.errorCount > 0 || Boolean(remote.lastError);
  const communicationText = remote.network.wsConnected
    ? t.communicationWs
    : t.communicationHttp;

  return (
    <div
      className="fixed z-[var(--z-floating)] pointer-events-none"
      style={wrapperStyle}
    >
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
            title={t.dragHint}
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
              <span>{isConnected ? t.connected : t.disconnected}</span>
            </div>
            <span className="text-muted-foreground">{communicationText}</span>
            <span className="text-muted-foreground">
              {t.latency.replace(
                "{ms}",
                String(remote.network.lastLatencyMs ?? "--"),
              )}{" "}
              ms
            </span>
            <span className="text-muted-foreground">
              {t.inFlight.replace(
                "{count}",
                String(remote.network.inFlightRequests),
              )}
            </span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:bg-secondary"
              onClick={() => void remote.refresh(true)}
              title={t.refreshTitle}
            >
              <RefreshCw
                className={`w-3 h-3 ${remote.refreshing ? "animate-spin" : ""}`}
              />
              <span>{t.refresh}</span>
            </button>
          </div>

          <div className="flex items-start justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{t.endpoint}</span>
            <span className="font-mono break-all text-right">{endpoint}</span>
          </div>

          <div className="text-[10px] text-muted-foreground">
            {t.lastSync.replace(
              "{value}",
              formatAgo(t, remote.network.lastSyncAt),
            )}{" "}
            {t.separator}{" "}
            {t.lastCheck.replace(
              "{value}",
              formatAgo(t, remote.runtime.lastCheckedAt),
            )}{" "}
            {t.separator}{" "}
            {t.activeTasks.replace(
              "{count}",
              remote.diagnostics.activeTaskId ? "1" : "0",
            )}{" "}
            {t.separator}{" "}
            {t.events.replace("{count}", String(remote.network.totalEvents))}{" "}
            {t.separator}{" "}
            {t.healthFailures.replace(
              "{count}",
              String(remote.diagnostics.healthFailures),
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t.successErrorRetry.replace(
              "{value}",
              `${remote.network.successCount}/${remote.network.errorCount}/${remote.network.retryCount}`,
            )}{" "}
            {t.separator}{" "}
            {t.uploadDownload.replace(
              "{value}",
              `${remote.network.uploadCount}/${remote.network.downloadCount}`,
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {fileScopeLabel} {t.separator} {outputPolicyLabel}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border px-3 py-2 text-[10px] bg-secondary/20 space-y-1.5">
            <div className="text-muted-foreground">
              {t.runtimeSource} <span className="font-mono">{sourceLabel}</span>
            </div>
            <div className="text-muted-foreground">
              {t.runtimeMode}{" "}
              <span className="font-mono">
                {remote.runtime.executionMode === "remote"
                  ? t.modeRemote
                  : t.modeLocal}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t.mirrorPath}{" "}
              <span className="font-mono">
                {remote.runtime.syncMirrorPath || "--"}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t.networkLog}{" "}
              <span className="font-mono">
                {remote.runtime.networkEventLogPath || "--"}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t.lastSyncLabel}{" "}
              <span className="font-mono">
                {remote.network.lastSyncAt
                  ? new Date(remote.network.lastSyncAt).toLocaleTimeString()
                  : "--"}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t.latencyDetail}{" "}
              <span className="font-mono">
                {remote.network.lastLatencyMs ?? "--"} ms /{" "}
                {remote.network.avgLatencyMs ?? "--"} ms
              </span>
            </div>
            <div className="text-muted-foreground">
              {t.statusInFlight}{" "}
              <span className="font-mono">
                {remote.network.lastStatusCode ?? "--"} /{" "}
                {remote.network.inFlightRequests ?? 0}
              </span>
            </div>
            {remote.network.lastError && (
              <div className="text-destructive">
                {t.lastError}: {remote.network.lastError.message}
                {remote.network.lastError.path
                  ? ` @ ${remote.network.lastError.path}`
                  : ""}
              </div>
            )}
            {remote.lastError && (
              <div className="text-destructive">
                {t.statusError}: {remote.lastError}
              </div>
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
            <span>{expanded ? t.collapse : t.expand}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
