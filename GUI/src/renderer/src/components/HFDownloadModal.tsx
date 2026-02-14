import { useState, useEffect, useRef } from "react";
import {
  Download,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  ChevronLeft,
  Package,
  Wifi,
  WifiOff,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/core";
import { cn } from "../lib/utils";
import { translations } from "../lib/i18n";

interface HFRepo {
  id: string;
  name: string;
  downloads: number;
}

interface HFFile {
  name: string;
  size: number;
  sizeFormatted: string;
}

interface DownloadProgress {
  percent: number;
  speed: string;
  downloaded: string;
  total: string;
  status: string;
}

interface HFDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgName: string; // Organization name instead of repo ID
  onDownloadComplete: () => void;
  lang: "zh" | "en" | "jp";
  mode?: "local" | "remote";
}

// Mirror sources
const MIRRORS = {
  direct: { label: "HuggingFace", url: "https://huggingface.co" },
  hf_mirror: { label: "hf-mirror.com", url: "https://hf-mirror.com" },
};

export function HFDownloadModal({
  isOpen,
  onClose,
  orgName,
  onDownloadComplete,
  lang,
  mode = "local",
}: HFDownloadModalProps) {
  const text = translations[lang].hfDownloadModal;
  const isRemote = mode === "remote";

  // Step management: 'repos' -> 'files' -> 'downloading' -> 'complete'
  const [step, setStep] = useState<
    "repos" | "files" | "downloading" | "complete"
  >("repos");

  const [repos, setRepos] = useState<HFRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<HFRepo | null>(null);

  const [files, setFiles] = useState<HFFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);
  const inlineNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [remoteDownloadId, setRemoteDownloadId] = useState<string | null>(null);

  // Network check state
  const [networkStatus, setNetworkStatus] = useState<
    "idle" | "checking" | "ok" | "error"
  >("idle");
  const [networkMessage, setNetworkMessage] = useState("");

  // Mirror source state
  const [mirrorSource, setMirrorSource] = useState<"direct" | "hf_mirror">(
    "direct",
  );

  // Auto check network every 1 second when modal is open
  useEffect(() => {
    if (!isOpen) {
      setNetworkStatus("idle");
      setNetworkMessage("");
      return;
    }

    const checkNetworkInternal = async () => {
      const startTime = Date.now();
      try {
        if (isRemote) {
          // @ts-ignore
          const result = await window.api?.remoteHfCheckNetwork?.();
          const latency = Date.now() - startTime;
          if (result?.ok && result.data?.status === "ok") {
            setNetworkStatus("ok");
            setNetworkMessage(`${latency}ms`);
          } else {
            setNetworkStatus("error");
            setNetworkMessage(result?.message || result?.data?.message || text.networkFailed);
          }
        } else {
          // @ts-ignore
          const result = await window.api?.hfCheckNetwork?.();
          const latency = Date.now() - startTime;
          if (result?.status === "ok") {
            setNetworkStatus("ok");
            setNetworkMessage(`${latency}ms`);
          } else {
            setNetworkStatus("error");
            setNetworkMessage(result?.message || text.networkFailed);
          }
        }
      } catch (e) {
        setNetworkStatus("error");
        setNetworkMessage(String(e));
      }
    };

    checkNetworkInternal();
    const intervalId = setInterval(checkNetworkInternal, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, mirrorSource, isRemote]);

  // Fetch repos when modal opens
  useEffect(() => {
    if (isOpen && repos.length === 0) {
      fetchRepos();
    }
  }, [isOpen, isRemote]);

  // Reset state when switching mode while open
  useEffect(() => {
    if (!isOpen) return;
    setRepos([]);
    setSelectedRepo(null);
    setFiles([]);
    setSelectedFile(null);
    setStep("repos");
    setProgress(null);
    setError(null);
    setRemoteDownloadId(null);
  }, [isOpen, isRemote]);

  // Listen for download progress
  useEffect(() => {
    if (step !== "downloading") return;
    if (isRemote) return;

    const handleProgress = (data: DownloadProgress) => {
      if (!data) return; // Guard against undefined
      setProgress(data);
      if (data.status === "complete") {
        setStep("complete");
        onDownloadComplete();
      }
    };

    const handleError = (data: { message: string }) => {
      if (!data) return;
      setError(data.message);
      setStep("files");
    };

    // @ts-ignore
    const unsubscribeProgress =
      window.api?.onHfDownloadProgress?.(handleProgress);
    // @ts-ignore
    const unsubscribeError = window.api?.onHfDownloadError?.(handleError);

    return () => {
      unsubscribeProgress?.();
      unsubscribeError?.();
    };
  }, [step, onDownloadComplete, isRemote]);

  // Poll remote download status
  useEffect(() => {
    if (!isRemote || step !== "downloading" || !remoteDownloadId) return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        // @ts-ignore
        const result = await window.api?.remoteHfDownloadStatus?.(remoteDownloadId);
        if (!result?.ok) {
          setError(result?.message || text.error);
          setStep("files");
          return;
        }
        const status = result.data;
        if (!status) return;
        setProgress({
          percent: status.percent ?? 0,
          speed: status.speed || "",
          downloaded: status.downloaded || "",
          total: status.total || "",
          status: status.status || "downloading",
        });
        if (status.status === "complete") {
          setStep("complete");
          onDownloadComplete();
        } else if (status.status === "error") {
          setError(status.error || text.error);
          setStep("files");
        } else if (status.status === "cancelled") {
          setStep("files");
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStep("files");
        }
      }
    };

    pollStatus();
    const intervalId = setInterval(pollStatus, 1000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isRemote, step, remoteDownloadId, onDownloadComplete, text.error]);

  const fetchRepos = async () => {
    setLoading(true);
    setError(null);
    try {
      let payload: any = null;
      if (isRemote) {
        // @ts-ignore
        const result = await window.api?.remoteHfListRepos?.(orgName);
        if (!result?.ok) {
          setError(result?.message || text.networkError);
          setLoading(false);
          return;
        }
        payload = result?.data;
      } else {
        // @ts-ignore
        payload = await window.api?.hfListRepos?.(orgName);
      }
      if (payload?.repos) {
        setRepos(payload.repos);
      } else if (payload?.error) {
        setError(payload.error);
      }
    } catch (e) {
      setError(text.networkError);
    }
    setLoading(false);
  };

  const fetchFiles = async (repoId: string) => {
    setLoading(true);
    setError(null);
    try {
      let payload: any = null;
      if (isRemote) {
        // @ts-ignore
        const result = await window.api?.remoteHfListFiles?.(repoId);
        if (!result?.ok) {
          setError(result?.message || text.networkError);
          setLoading(false);
          return;
        }
        payload = result?.data;
      } else {
        // @ts-ignore
        payload = await window.api?.hfListFiles?.(repoId);
      }
      if (payload?.files) {
        setFiles(payload.files);
        setStep("files");
      } else if (payload?.error) {
        setError(payload.error);
      }
    } catch (e) {
      setError(text.networkError);
    }
    setLoading(false);
  };

  const selectRepo = (repo: HFRepo) => {
    setSelectedRepo(repo);
    setSelectedFile(null);
    fetchFiles(repo.id);
  };

  const goBack = () => {
    setStep("repos");
    setSelectedRepo(null);
    setFiles([]);
    setSelectedFile(null);
    setError(null);
  };

  const startDownload = async () => {
    if (!selectedRepo || !selectedFile) return;

    setStep("downloading");
    setProgress({
      percent: 0,
      speed: "",
      downloaded: "",
      total: "",
      status: "starting",
    });
    setError(null);
    setRemoteDownloadId(null);

    try {
      if (isRemote) {
        // @ts-ignore
        const result = await window.api?.remoteHfDownloadStart?.(
          selectedRepo.id,
          selectedFile,
          mirrorSource,
        );
        if (!result?.ok || !result?.data?.downloadId) {
          setError(result?.message || text.error);
          setStep("files");
          return;
        }
        setRemoteDownloadId(result.data.downloadId);
      } else {
        // @ts-ignore
        await window.api?.hfDownloadStart?.(
          selectedRepo.id,
          selectedFile,
          mirrorSource,
        );
      }
    } catch (e) {
      setError(String(e));
      setStep("files");
    }
  };

  const cancelDownload = async () => {
    try {
      if (isRemote) {
        if (remoteDownloadId) {
          // @ts-ignore
          await window.api?.remoteHfDownloadCancel?.(remoteDownloadId);
        }
      } else {
        // @ts-ignore
        await window.api?.hfDownloadCancel?.();
      }
    } catch (e) {
      console.error("Failed to cancel download:", e);
      setInlineNotice(text.cancelFail);
      if (inlineNoticeTimerRef.current) {
        clearTimeout(inlineNoticeTimerRef.current);
      }
      inlineNoticeTimerRef.current = setTimeout(
        () => setInlineNotice(null),
        4200,
      );
    }
    setStep("files");
    setProgress(null);
    setRemoteDownloadId(null);
  };

  const handleClose = () => {
    if (step === "downloading") {
      cancelDownload();
    }
    // Reset state
    setStep("repos");
    setRepos([]);
    setSelectedRepo(null);
    setFiles([]);
    setSelectedFile(null);
    setProgress(null);
    setError(null);
    setNetworkStatus("idle");
    setNetworkMessage("");
    setRemoteDownloadId(null);
    onClose();
  };

  useEffect(() => {
    return () => {
      if (inlineNoticeTimerRef.current) {
        clearTimeout(inlineNoticeTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal - Much larger size like GlossaryView */}
      <div className="relative w-full max-w-5xl mx-4 bg-background rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b bg-secondary/30">
          <div className="flex items-center gap-3">
            {step === "files" && (
              <button
                onClick={goBack}
                className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-2xl border border-yellow-500/20">
              🤗
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">
                {text.title}
              </h3>
              <p className="text-xs text-muted-foreground font-mono">
                {selectedRepo ? selectedRepo.name : orgName}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar - Network Status & Mirror Switch */}
        <div className="flex items-center justify-between px-5 py-3 bg-secondary/10 border-b border-border/50">
          {/* Mirror Source Switch */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {text.sourceLabel}
            </span>
            <div className="flex items-center bg-secondary/50 rounded-lg p-0.5">
              <button
                onClick={() => setMirrorSource("direct")}
                className={cn(
                  "px-3 py-1 text-xs rounded-md transition-all",
                  mirrorSource === "direct"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {MIRRORS.direct.label}
              </button>
              <button
                onClick={() => setMirrorSource("hf_mirror")}
                className={cn(
                  "px-3 py-1 text-xs rounded-md transition-all",
                  mirrorSource === "hf_mirror"
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {MIRRORS.hf_mirror.label}
              </button>
            </div>
          </div>

          {/* Network Status Indicator (Auto-updated every 1s) */}
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              networkStatus === "checking" && "opacity-50 bg-secondary",
              networkStatus === "ok" &&
                "bg-green-500/10 text-green-600 border border-green-500/20",
              networkStatus === "error" &&
                "bg-red-500/10 text-red-600 border border-red-500/20",
              networkStatus === "idle" && "bg-secondary border border-border",
            )}
          >
            {networkStatus === "checking" ? (
              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
            ) : networkStatus === "ok" ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : networkStatus === "error" ? (
              <WifiOff className="w-3.5 h-3.5" />
            ) : (
              <Wifi className="w-3.5 h-3.5" />
            )}
            <span>
              {networkStatus === "idle"
                ? text.networkIdle
                : networkStatus === "checking"
                  ? text.loading
                  : networkStatus === "ok"
                    ? `${text.networkOk} (${networkMessage})`
                    : text.networkFailed}
            </span>
          </div>
        </div>

        {inlineNotice && (
          <div className="px-5 py-2 border-b border-border/40 bg-amber-500/10 text-amber-700 text-xs">
            {inlineNotice}
          </div>
        )}

        {/* Info Bar - Simplified Minimalist Layout */}
        <div className="px-6 py-3 bg-background border-b border-border/40">
          <div className="space-y-2">
            {/* Tips Line */}
            <div className="flex items-center gap-3 text-[11px] sm:text-xs">
              <span className="bg-yellow-500/10 text-yellow-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                {text.tipTitle}
              </span>
              <span className="text-muted-foreground truncate">
                {text.downloadTip}
              </span>
            </div>
            {/* VRAM Line */}
            <div className="flex items-center gap-3 text-[11px] sm:text-xs">
              <span className="bg-indigo-500/10 text-indigo-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                {text.vramTitle}
              </span>
              <div className="flex items-center gap-4 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  Murasaki-8B:{" "}
                  <span className="text-foreground font-semibold">
                    {text.vram8b}
                  </span>
                </span>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1.5">
                  Murasaki-14B:{" "}
                  <span className="text-foreground font-semibold">
                    {text.vram14b}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                {text.loading}
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <span className="text-sm text-destructive text-center">
                {error}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={
                  step === "repos"
                    ? fetchRepos
                    : () => fetchFiles(selectedRepo!.id)
                }
              >
                {text.retry}
              </Button>
            </div>
          ) : step === "complete" ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <span className="text-lg font-bold text-green-600">
                {text.complete}
              </span>
              <p className="text-sm text-muted-foreground">{selectedFile}</p>
            </div>
          ) : step === "downloading" && progress ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-primary animate-pulse" />
                <span className="text-sm font-medium">{text.downloading}</span>
              </div>

              <div className="space-y-2">
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {progress.downloaded} / {progress.total}
                  </span>
                  <span>{progress.speed}</span>
                </div>
                <div className="text-center text-2xl font-bold text-foreground">
                  {progress.percent.toFixed(1)}%
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center truncate">
                {selectedFile}
              </p>
            </div>
          ) : step === "repos" ? (
            // Step 1: Select Repository
            repos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <span className="text-sm text-muted-foreground">
                  {text.noRepos}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground mb-3">
                  {text.selectRepo}
                </p>
                {repos.map((repo) => (
                  <div
                    key={repo.id}
                    onClick={() => selectRepo(repo)}
                    className="flex items-center justify-between p-3 rounded-lg border border-border cursor-pointer transition-all hover:border-primary/50 hover:bg-secondary/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Package className="w-5 h-5 text-primary shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {repo.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {repo.downloads.toLocaleString()} {text.downloadsLabel}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : // Step 2: Select File
          files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-sm text-muted-foreground">
                {text.noFiles}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground mb-3">
                {text.selectFile}
              </p>
              {files.map((file) => (
                <div
                  key={file.name}
                  onClick={() => setSelectedFile(file.name)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all",
                    selectedFile === file.name
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:bg-secondary/30",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                        selectedFile === file.name
                          ? "border-primary"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selectedFile === file.name && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="text-sm font-mono truncate">
                      {file.name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {file.sizeFormatted}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && step === "files" && files.length > 0 && (
          <div className="flex gap-3 p-4 border-t bg-secondary/20">
            <Button variant="outline" className="flex-1" onClick={goBack}>
              {text.back}
            </Button>
            <Button
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              disabled={!selectedFile}
              onClick={startDownload}
            >
              <Download className="w-4 h-4 mr-2" />
              {text.download}
            </Button>
          </div>
        )}

        {step === "downloading" && (
          <div className="flex gap-3 p-4 border-t bg-secondary/20">
            <Button
              variant="outline"
              className="w-full"
              onClick={cancelDownload}
            >
              {text.cancel}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <div className="flex gap-3 p-4 border-t bg-secondary/20">
            <Button className="w-full" onClick={handleClose}>
              {text.done}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

