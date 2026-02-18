import { useState, useEffect, useRef } from "react";
import {
  X,
  Copy,
  Trash2,
  RefreshCw,
  Terminal,
  Activity,
  FileText,
  ChevronDown,
} from "lucide-react";
import { Button, Card, CardHeader, CardTitle } from "./ui/core";
import { translations, Language } from "../lib/i18n";

interface LogViewerModalProps {
  mode: "server" | "terminal" | "file";
  lang: Language;
  onClose: () => void;
  filePath?: string;
  title?: string;
  subtitle?: string;
}

export function LogViewerModal({
  lang,
  mode,
  onClose,
  filePath,
  title: customTitle,
  subtitle: customSubtitle,
}: LogViewerModalProps) {
  const t = translations[lang].logViewer;
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const title =
    customTitle ||
    (mode === "server"
      ? t.titleServer
      : mode === "terminal"
        ? t.titleTerminal
        : t.titleFile);
  const subtitle =
    customSubtitle ||
    (mode === "server"
      ? t.subtitleServer
      : mode === "terminal"
        ? t.subtitleTerminal
        : filePath || t.subtitleFileFallback);
  const Icon =
    mode === "server" ? Activity : mode === "terminal" ? Terminal : FileText;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (mode === "server") {
        // @ts-ignore
        const result = await window.api?.readServerLog?.();
        if (result?.exists) {
          setLogs(result.content || t.logEmpty);
        } else {
          setLogs(result?.error || t.logNotFound);
        }
      } else if (mode === "terminal") {
        // @ts-ignore
        const result = await window.api?.getMainProcessLogs?.();
        setLogs(result?.length ? result.join("\n") : t.noTerminalLogs);
      } else {
        if (!filePath) {
          setLogs(t.noFile);
        } else {
          // @ts-ignore
          const result = await window.api?.readTextTail?.(filePath, {
            lineCount: 500,
          });
          if (result?.exists) {
            setLogs(result.content || t.logEmpty);
          } else {
            setLogs(result?.error || t.logNotFound);
          }
        }
      }
    } catch (e) {
      setLogs(t.readFailed.replace("{error}", String(e)));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // 自动刷新日志
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [mode, filePath]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopy = () => {
    navigator.clipboard.writeText(logs);
  };

  const handleClear = () => {
    setLogs("");
  };

  // 关闭 ESC 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="w-[900px] max-h-[85vh] flex flex-col bg-card border-border/50 shadow-2xl rounded-2xl overflow-hidden">
        {/* Header */}
        <CardHeader className="py-3 px-5 border-b border-border/50 bg-muted/30 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Icon className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">{title}</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-3 text-xs gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              {t.copy}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-8 px-3 text-xs gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.clear}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchLogs}
              disabled={loading}
              className="h-8 px-3 text-xs gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              {t.refresh}
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="w-8 h-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        {/* Log Content */}
        <div className="flex-1 overflow-hidden bg-slate-950 relative">
          <pre
            ref={logContainerRef}
            className="h-full max-h-[65vh] overflow-auto p-4 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-all"
          >
            {loading && !logs ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                {t.loading}
              </div>
            ) : (
              logs
            )}
          </pre>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              autoScroll
                ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <ChevronDown
              className={`w-3 h-3 ${autoScroll ? "animate-bounce" : ""}`}
            />
            {autoScroll ? t.autoScroll : t.manualScroll}
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border/50 bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t.footerHint}</span>
          <span>
            {t.lines.replace("{count}", String(logs.split("\n").length))}
          </span>
        </div>
      </Card>
    </div>
  );
}
