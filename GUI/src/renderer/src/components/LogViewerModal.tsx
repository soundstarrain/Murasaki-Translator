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

interface LogViewerModalProps {
  mode: "server" | "terminal" | "file";
  onClose: () => void;
  filePath?: string;
  title?: string;
  subtitle?: string;
}

export function LogViewerModal({
  mode,
  onClose,
  filePath,
  title: customTitle,
  subtitle: customSubtitle,
}: LogViewerModalProps) {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const title =
    customTitle ||
    (mode === "server"
      ? "服务器日志"
      : mode === "terminal"
        ? "主进程日志"
        : "日志文件");
  const subtitle =
    customSubtitle ||
    (mode === "server"
      ? "llama-server 输出日志"
      : mode === "terminal"
        ? "Electron 主进程输出"
        : filePath || "未指定文件");
  const Icon = mode === "server" ? Activity : mode === "terminal" ? Terminal : FileText;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (mode === "server") {
        // @ts-ignore
        const result = await window.api?.readServerLog?.();
        if (result?.exists) {
          setLogs(result.content || "日志为空");
        } else {
          setLogs(result?.error || "未找到日志文件");
        }
      } else if (mode === "terminal") {
        // @ts-ignore
        const result = await window.api?.getMainProcessLogs?.();
        setLogs(result?.length ? result.join("\n") : "暂无主进程日志");
      } else {
        if (!filePath) {
          setLogs("未指定日志文件");
        } else {
          // @ts-ignore
          const result = await window.api?.readTextTail?.(filePath, { lineCount: 500 });
          if (result?.exists) {
            setLogs(result.content || "日志为空");
          } else {
            setLogs(result?.error || "未找到日志文件");
          }
        }
      }
    } catch (e) {
      setLogs(`读取日志失败: ${e}`);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
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
              <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
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
              复制
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-8 px-3 text-xs gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空
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
              刷新
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
                加载中...
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
            {autoScroll ? "自动滚动" : "手动滚动"}
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border/50 bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>按 ESC 关闭 · 每 3 秒自动刷新</span>
          <span>{logs.split("\n").length} 行</span>
        </div>
      </Card>
    </div>
  );
}
