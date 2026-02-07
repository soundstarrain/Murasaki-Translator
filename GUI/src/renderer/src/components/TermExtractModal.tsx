import { useState, useEffect } from "react";
import {
  X,
  FileUp,
  FileText,
  Sparkles,
  Download,
  Plus,
  Search,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "./ui/core";
import { AlertModal } from "./ui/AlertModal";
import { Language } from "../lib/i18n";

interface TermItem {
  src: string;
  dst: string;
  category?: string;
  score?: number;
  freq?: number;
}

interface TermExtractModalProps {
  lang: Language;
  onClose: () => void;
  onImport: (terms: TermItem[], filename: string) => void;
  queueFiles?: string[];
}

export function TermExtractModal({
  lang,
  onClose,
  onImport,
  queueFiles = [],
}: TermExtractModalProps) {
  // State
  const [sourceType, setSourceType] = useState<"upload" | "queue">("upload");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<TermItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Queue files from localStorage (or props as fallback)
  const [libraryQueue, setLibraryQueue] = useState<string[]>(queueFiles);

  // Load queue from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("library_queue");
      if (saved) {
        const items = JSON.parse(saved) as Array<{ path: string }>;
        const paths = items.map((item) => item.path).filter(Boolean);
        if (paths.length > 0) {
          setLibraryQueue(paths);
        }
      }
    } catch (e) {
      console.error("Failed to load queue from localStorage:", e);
    }
  }, []);

  // Editing state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editSrc, setEditSrc] = useState("");
  const [editDst, setEditDst] = useState("");

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "txt" || ext === "epub" || ext === "ass" || ext === "srt") {
        // @ts-ignore - Electron provides path property
        const filePath = file.path;
        if (filePath) {
          setSelectedFile(filePath);
          setSourceType("upload");
        }
      } else {
        setError(
          lang === "zh"
            ? "只支持 TXT, EPUB, ASS 或 SRT 文件"
            : "Only TXT, EPUB, ASS or SRT files are supported",
        );
      }
    }
  };

  // Listen for progress updates
  useEffect(() => {
    // @ts-ignore
    window.api?.onTermExtractProgress?.((p: number) => {
      setProgress(p);
    });

    return () => {
      // @ts-ignore
      window.api?.removeTermExtractProgressListener?.();
    };
  }, []);

  const handleFileSelect = async () => {
    try {
      // @ts-ignore
      const result = await window.api.selectFile({
        title: lang === "zh" ? "选择要分析的文件" : "Select file to analyze",
        filters: [
          {
            name: "Text/Subtitle Files",
            extensions: ["txt", "epub", "ass", "srt"],
          },
        ],
      });
      if (result) {
        setSelectedFile(result);
        setSourceType("upload");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExtract = async () => {
    if (!selectedFile) return;

    setIsExtracting(true);
    setProgress(0);
    setError(null);
    setResults([]);

    try {
      // @ts-ignore
      const result = await window.api.extractTerms({
        filePath: selectedFile,
        topK: 500,
      });

      if (result.success) {
        setResults(result.terms || []);
        setHasExtracted(true);
      } else {
        setError(result.error || "Unknown error");
        setShowAlert(true);
      }
    } catch (e: any) {
      setError(e.message);
      setShowAlert(true);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExport = () => {
    if (results.length === 0) return;

    // Get original filename and change extension to .json
    const originalName =
      selectedFile
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || "glossary";

    // Export only src/dst - preserve space placeholder
    const exportData = results.map((r) => ({ src: r.src, dst: r.dst }));
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${originalName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportToGlossary = () => {
    // Get filename from original file
    const filename =
      (selectedFile
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || "glossary") + ".json";

    // Only import src/dst - preserve space placeholder
    const importData = results.map((r) => ({ src: r.src, dst: r.dst }));
    onImport(importData, filename);
    onClose();
  };

  // Delete a term
  const handleDelete = (idx: number) => {
    setResults((prev) => prev.filter((_, i) => i !== idx));
  };

  // Start editing a term
  const startEdit = (idx: number) => {
    const item = results[idx];
    setEditingIdx(idx);
    setEditSrc(item.src);
    setEditDst(item.dst);
  };

  // Save edit
  const saveEdit = () => {
    if (editingIdx === null) return;
    setResults((prev) =>
      prev.map((item, i) =>
        i === editingIdx ? { ...item, src: editSrc, dst: editDst } : item,
      ),
    );
    setEditingIdx(null);
    setEditSrc("");
    setEditDst("");
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingIdx(null);
    setEditSrc("");
    setEditDst("");
  };

  // Reset to initial state
  const handleReset = () => {
    setResults([]);
    setSelectedFile("");
    setError(null);
    setHasExtracted(false);
    setProgress(0);
  };

  // Filter results by search
  const filteredResults = results.filter(
    (r) =>
      r.src.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.dst.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <Card className="w-[900px] max-h-[85vh] flex flex-col bg-card border-border/50 shadow-2xl rounded-2xl overflow-hidden">
        {/* Header */}
        <CardHeader className="py-4 px-6 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold">
                {lang === "zh" ? "术语表智能提取" : "Smart Term Extraction"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === "zh"
                  ? "基于 PMI + 信息熵算法自动识别专有名词"
                  : "PMI + Entropy based proper noun recognition"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-8 h-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 p-6 overflow-hidden flex flex-col gap-4">
          {/* Source Selection */}
          {!isExtracting && results.length === 0 && !hasExtracted && (
            <div className="space-y-4">
              {/* Source Type Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSourceType("upload")}
                  className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                    sourceType === "upload"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <FileUp
                    className={`w-6 h-6 mx-auto mb-2 ${sourceType === "upload" ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <p
                    className={`text-sm font-bold ${sourceType === "upload" ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {lang === "zh" ? "上传文件" : "Upload File"}
                  </p>
                </button>
                <button
                  onClick={() => setSourceType("queue")}
                  disabled={libraryQueue.length === 0}
                  className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                    sourceType === "queue"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  } ${libraryQueue.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <FileText
                    className={`w-6 h-6 mx-auto mb-2 ${sourceType === "queue" ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <p
                    className={`text-sm font-bold ${sourceType === "queue" ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {lang === "zh" ? "从队列选择" : "From Queue"}
                  </p>
                  {libraryQueue.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      ({libraryQueue.length}{" "}
                      {lang === "zh" ? "个文件" : "files"})
                    </span>
                  )}
                </button>
              </div>

              {/* File Selection */}
              {sourceType === "upload" && (
                <div
                  onClick={handleFileSelect}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/30 hover:bg-primary/5"
                  }`}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText className="w-8 h-8 text-primary" />
                      <div className="text-left flex-1">
                        <p className="font-bold text-foreground truncate max-w-[400px]">
                          {selectedFile.split(/[\\/]/).pop()}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[400px]">
                          {selectedFile}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile("");
                        }}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title={lang === "zh" ? "移除文件" : "Remove file"}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <FileUp
                        className={`w-10 h-10 mx-auto mb-3 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <p className="text-sm text-muted-foreground">
                        {isDragging
                          ? lang === "zh"
                            ? "松开以上传文件"
                            : "Drop to upload"
                          : lang === "zh"
                            ? "点击选择或拖拽上传文件"
                            : "Click or drag TXT/EPUB/ASS/SRT file"}
                      </p>
                    </>
                  )}
                </div>
              )}

              {sourceType === "queue" && libraryQueue.length > 0 && (
                <div className="border border-border rounded-xl max-h-[200px] overflow-y-auto">
                  {libraryQueue.map((file: string, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedFile(file)}
                      className={`p-3 flex items-center gap-3 cursor-pointer transition-all ${
                        selectedFile === file
                          ? "bg-accent"
                          : "hover:bg-secondary"
                      } ${idx > 0 ? "border-t border-border/50" : ""}`}
                    >
                      <FileText
                        className={`w-4 h-4 ${selectedFile === file ? "text-foreground" : "text-muted-foreground"}`}
                      />
                      <span
                        className={`text-sm truncate ${selectedFile === file ? "font-bold" : "text-foreground"}`}
                      >
                        {file.split(/[\\/]/).pop()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Algorithm Info */}
              <div className="p-4 bg-secondary/30 rounded-xl border border-border/50 text-xs text-muted-foreground space-y-2">
                <p className="font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  {lang === "zh" ? "算法说明" : "Algorithm"}
                </p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li>
                    {lang === "zh"
                      ? "固有名詞: 识别人名/地名/组织名"
                      : "PoS: Detect proper nouns"}
                  </li>
                  <li>
                    {lang === "zh"
                      ? "片假名: 智能提取带中点的完整人名"
                      : "Katakana: Extract full names with dots"}
                  </li>
                  <li>
                    {lang === "zh"
                      ? "去重: 自动合并子串与碎片"
                      : "Dedup: Auto-merge substrings/fragments"}
                  </li>
                </ul>
                <p className="text-amber-500/80 mt-2 text-[11px]">
                  提示:{" "}
                  {lang === "zh"
                    ? "本功能为实验性功能，提取结果可能不准确，请手动检查并删除误判项"
                    : "Experimental feature. Results may be inaccurate. Please review and remove false positives."}
                </p>
              </div>

              {/* Error Display - Handled by AlertModal */}

              {/* Start Button */}
              <Button
                onClick={handleExtract}
                disabled={!selectedFile}
                className="w-full h-12 text-base gap-2"
              >
                <Sparkles className="w-5 h-5" />
                {lang === "zh" ? "开始提取" : "Start Extraction"}
              </Button>
            </div>
          )}

          {/* Progress */}
          {isExtracting && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-muted-foreground animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-foreground">
                    {Math.round(progress * 100)}%
                  </span>
                </div>
              </div>
              <div className="w-full max-w-md">
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-muted-foreground transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center mt-3">
                  {progress < 0.15
                    ? lang === "zh"
                      ? "正在提取片假名人名..."
                      : "Extracting katakana names..."
                    : progress < 0.85
                      ? lang === "zh"
                        ? "正在分析固有名詞..."
                        : "Analyzing proper nouns..."
                      : lang === "zh"
                        ? "正在生成结果..."
                        : "Generating results..."}
                </p>
              </div>
            </div>
          )}

          {/* No Results */}
          {!isExtracting && hasExtracted && results.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
              <div className="p-4 bg-secondary/50 rounded-full">
                <Search className="w-12 h-12 text-muted-foreground opacity-50" />
              </div>
              <div className="space-y-2">
                <p className="font-bold text-lg">
                  {lang === "zh" ? "未找到提取项" : "No Terms Found"}
                </p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  {lang === "zh"
                    ? "当前文本中似乎没有符合条件的术语。可以尝试更换文件或检查内容是否包含足够多的文本。"
                    : "We couldn't find any significant terms in the selected file. Try a different file or ensure there is enough text content."}
                </p>
              </div>
              <Button variant="outline" onClick={handleReset} className="mt-4">
                <RotateCcw className="w-4 h-4 mr-2" />
                {lang === "zh" ? "重新选择文件" : "Try Another File"}
              </Button>
            </div>
          )}

          {/* Results */}
          {!isExtracting && results.length > 0 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Results Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="font-bold">
                    {lang === "zh" ? "提取完成" : "Extraction Complete"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    ({results.length} {lang === "zh" ? "个术语" : "terms"})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="ml-2 h-7 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    {lang === "zh" ? "重新提取" : "Reset"}
                  </Button>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={lang === "zh" ? "搜索..." : "Search..."}
                    className="pl-9 pr-3 py-1.5 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              </div>

              {/* Results Table */}
              <div className="flex-1 overflow-hidden border border-border/50 rounded-xl bg-background">
                <div className="grid grid-cols-[1fr_1fr_80px] bg-muted/50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50">
                  <div>{lang === "zh" ? "日文原文" : "Japanese"}</div>
                  <div>{lang === "zh" ? "译文" : "Translation"}</div>
                  <div className="text-center">
                    {lang === "zh" ? "操作" : "Actions"}
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[300px] divide-y divide-border/30">
                  {filteredResults.slice(0, 200).map((item, idx) => {
                    const realIdx = results.findIndex(
                      (r) => r.src === item.src && r.dst === item.dst,
                    );
                    const isEditing = editingIdx === realIdx;

                    return (
                      <div
                        key={idx}
                        className={`grid grid-cols-[1fr_1fr_80px] px-4 py-2 hover:bg-violet-500/5 transition-colors ${isEditing ? "bg-violet-500/10" : ""}`}
                      >
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={editSrc}
                              onChange={(e) => setEditSrc(e.target.value)}
                              className="font-mono text-sm px-2 py-1 border border-violet-500 rounded bg-background focus:outline-none"
                              autoFocus
                            />
                            <input
                              type="text"
                              value={editDst}
                              onChange={(e) => setEditDst(e.target.value)}
                              placeholder={
                                lang === "zh"
                                  ? "输入译文..."
                                  : "Enter translation..."
                              }
                              className="text-sm px-2 py-1 border border-border rounded bg-background focus:outline-none focus:border-violet-500"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={saveEdit}
                                className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={cancelEdit}
                                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className="font-mono text-sm truncate pr-4 cursor-pointer hover:text-violet-600"
                              title={item.src}
                              onClick={() => startEdit(realIdx)}
                            >
                              {item.src}
                            </div>
                            <div
                              className={`text-sm truncate cursor-pointer hover:text-violet-600 ${item.dst ? "text-foreground" : "text-muted-foreground italic"}`}
                              onClick={() => startEdit(realIdx)}
                            >
                              {item.dst ||
                                (lang === "zh" ? "点击编辑" : "Click to edit")}
                            </div>
                            <div className="flex items-center justify-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(realIdx)}
                                className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Info Banner */}
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {lang === "zh"
                    ? "点击行可编辑术语和译文。导出后请手动填写剩余译文，或使用 LLM 补充。"
                    : "Click rows to edit. Please fill in remaining translations manually or use LLM."}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  variant="outline"
                  onClick={handleExport}
                  className="flex-1 gap-2"
                >
                  <Download className="w-4 h-4" />
                  {lang === "zh" ? "导出为 JSON" : "Export JSON"}
                </Button>
                <Button
                  onClick={handleImportToGlossary}
                  className="flex-1 gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {lang === "zh" ? "添加到术语表" : "Add to Glossary"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertModal
        open={showAlert}
        onOpenChange={setShowAlert}
        variant="destructive"
        title={lang === "zh" ? "术语提取失败" : "Extraction Failed"}
        description={error || ""}
        confirmText={lang === "zh" ? "知道了" : "Got it"}
      />
    </div>
  );
}
