import { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  FileJson,
  FileText,
  FolderOpen,
  RefreshCw,
  Pen,
  Trash2,
  Save,
  Plus,
  X,
  Sparkles,
  FileUp,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { GlossaryConverter } from "./GlossaryConverter";
import { TermExtractModal } from "./TermExtractModal";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";

export function GlossaryView({ lang }: { lang: Language }) {
  const t = translations[lang];
  const [glossaries, setGlossaries] = useState<string[]>([]);
  const [selectedGlossary, setSelectedGlossary] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [showConverter, setShowConverter] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "raw">("table");
  const [editableEntries, setEditableEntries] = useState<
    Array<{ src: string; dst: string }>
  >([]);
  const [originalFormat, setOriginalFormat] = useState<"dict" | "list">("dict");
  const [converterInitialFile, setConverterInitialFile] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [showExtractor, setShowExtractor] = useState(false);
  const { alertProps, showAlert, showConfirm } = useAlertModal();
  const [notice, setNotice] = useState<{
    type: "info" | "warning" | "error";
    message: string;
  } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushNotice = (type: "info" | "warning" | "error", message: string) => {
    setNotice({ type, message });
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5200);
  };

  const fetchGlossaries = async () => {
    setLoading(true);
    try {
      // @ts-ignore
      const files = await window.api.getGlossaries();
      setGlossaries(files || []);
    } catch (e) {
      console.error(e);
      pushNotice(
        "error",
        `${t.glossaryView.loadFail}${e ? `：${String(e)}` : ""}`,
      );
    }
    setLoading(false);
  };

  const openFolder = async () => {
    // @ts-ignore
    try {
      await window.api.openGlossaryFolder();
    } catch (e) {
      console.error(e);
      pushNotice(
        "error",
        `${t.glossaryView.openFolderFail}${e ? `：${String(e)}` : ""}`,
      );
    }
  };

  const handleSelect = async (file: string) => {
    if (isEditing && !confirm(t.glossaryView.unsaved)) return;

    setSelectedGlossary(file);
    setIsEditing(false);
    setLoadingContent(true);
    try {
      // @ts-ignore
      // We need full path logic in renderer or main.
      // Currently getGlossaries returns filenames.
      // Let's assume we need to join path in main or pass basic identifier.
      // Actually, read-file takes absolute path.
      // Wait, getGlossaries returns filenames, how do I get full path?
      // Main process 'get-glossaries' returns filenames.
      // I should update 'read-file' to accept just filename relative to glossary dir?
      // OR simpler: just fetch content via a new specific IPC 'read-glossary-content'.
      // Let's stick to what we have.
      // Wait, I can't construct path in renderer easily without knowing middleware path.
      // Workaround: Use 'selectFile' for arbitrary, but for these managed files,
      // we really need a 'read-glossary' IPC.
      // Let's assume for now I will add 'read-glossary-file' to main in next step
      // or just use the fact that I can't easily read it without full path.
      // Actually, let's just make get-glossaries return full paths?
      // No, UI looks better with names.

      // Let's rely on a new IPC I'll add quickly: 'read-glossary'
      // For now, I'll mock it or just wait.
      // Actually, I can use the existing 'read-file' IF I knew the path.
      // Pass.

      // Re-plan: update main to return objects { name, path }
      // OR add 'read-glossary(filename)'.
      // I'll assume 'read-glossary' exists for this file.

      // @ts-ignore
      const txt = await window.api.readGlossaryFile(file);
      setContent(txt || "");
    } catch (e) {
      console.error(e);
      setContent("");
      pushNotice(
        "error",
        (t.glossaryView.readFail || "").replace("{name}", file),
      );
    }
    setLoadingContent(false);
  };

  useEffect(() => {
    fetchGlossaries();
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!selectedGlossary) return;

    let finalContent = content;
    if (selectedGlossary.endsWith(".json") && viewMode === "table") {
      try {
        if (originalFormat === "dict") {
          const dict: Record<string, string> = {};
          editableEntries.forEach((e) => {
            if (e.src) dict[e.src] = e.dst;
          });
          finalContent = JSON.stringify(dict, null, 2);
        } else {
          const list = editableEntries.map((e) => ({ src: e.src, dst: e.dst }));
          finalContent = JSON.stringify(list, null, 2);
        }
        setContent(finalContent); // Sync back to content
      } catch (e) {
        showAlert({
          title: t.glossaryView.convertFailTitle,
          description: t.glossaryView.convertFailDesc,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      // @ts-ignore
      await window.api.saveGlossaryFile({
        filename: selectedGlossary,
        content: finalContent,
      });
      setIsEditing(false);
      window.api?.showNotification(
        "Murasaki Translator",
        t.glossaryView.saveSuccess,
      );
    } catch (e) {
      console.error(e);
      showAlert({
        title: t.glossaryView.saveFailTitle,
        description: t.glossaryView.saveFail,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedGlossary) return;

    showConfirm({
      title: t.glossaryView.deleteConfirmTitle,
      description: t.glossaryView.deleteConfirm.replace(
        "{name}",
        selectedGlossary,
      ),
      variant: "destructive",
      onConfirm: async () => {
        try {
          // @ts-ignore
          await window.api.deleteGlossaryFile(selectedGlossary);
          setSelectedGlossary("");
          setContent("");
          fetchGlossaries();
        } catch (e) {
          console.error(e);
          showAlert({
            title: t.glossaryView.deleteFailTitle,
            description: t.glossaryView.deleteFail,
            variant: "destructive",
          });
        }
      },
    });
  };

  const handleCreate = async () => {
    if (!newFileName) return;

    let finalName = newFileName;
    if (!finalName.endsWith(".json")) {
      finalName += ".json";
    }

    try {
      // @ts-ignore
      await window.api.createGlossaryFile({
        filename: finalName,
        content: finalName.endsWith(".json") ? "{}" : "",
      });
      setCreatingNew(false);
      setNewFileName("");
      fetchGlossaries();
      // Select new file
      // setTimeout(() => handleSelect(finalName), 500)
    } catch (e: any) {
      showAlert({
        title: t.glossaryView.createFailTitle,
        description: e.message || t.glossaryView.createFail,
        variant: "destructive",
      });
    }
  };

  // Rename Logic
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameNewName, setRenameNewName] = useState("");

  const startRename = () => {
    if (!selectedGlossary) return;
    setRenamingFile(selectedGlossary);
    setRenameNewName(selectedGlossary);
  };

  const startEditing = () => {
    if (selectedGlossary.endsWith(".json") && viewMode === "table") {
      try {
        const data = JSON.parse(content);
        const entries: Array<{ src: string; dst: string }> = [];
        if (Array.isArray(data)) {
          setOriginalFormat("list");
          data.forEach((item) => {
            const src =
              item.src || item.jp || item.original || item.source || "";
            const dst =
              item.dst ||
              item.zh ||
              item.translation ||
              item.target ||
              item.dest ||
              "";
            entries.push({ src: String(src), dst: String(dst) });
          });
        } else if (typeof data === "object" && data !== null) {
          setOriginalFormat("dict");
          Object.entries(data).forEach(([k, v]) => {
            entries.push({ src: k, dst: String(v) });
          });
        }
        setEditableEntries(entries);
      } catch (e) {
        console.error("JSON Parse Error when entering edit mode", e);
        // Fallback to empty entries if corrupted, or maybe just let raw mode handle it
        setEditableEntries([]);
        setViewMode("raw");
        showAlert({
          title: t.glossaryView.jsonCorrupted,
          description: t.glossaryView.jsonCorruptedDesc,
          variant: "warning",
        });
      }
    }
    setIsEditing(true);
  };

  const handleAddRow = () => {
    setEditableEntries((prev) => [...prev, { src: "", dst: "" }]);
  };

  const handleRemoveRow = (index: number) => {
    setEditableEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateRow = (
    index: number,
    field: "src" | "dst",
    value: string,
  ) => {
    setEditableEntries((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const handleRename = async () => {
    if (!renamingFile || !renameNewName || renamingFile === renameNewName) {
      setRenamingFile(null);
      return;
    }

    try {
      // @ts-ignore
      const res = await window.api.renameGlossaryFile(
        renamingFile,
        renameNewName,
      );
      if (res.success) {
        setRenamingFile(null);
        setSelectedGlossary(
          renameNewName.endsWith(".json")
            ? renameNewName
            : renameNewName + ".json",
        );
        fetchGlossaries();
      } else {
        showAlert({
          title: t.glossaryView.renameFailTitle,
          description: (t.glossaryView.renameFailDesc || "").replace(
            "{error}",
            res.error || "",
          ),
          variant: "destructive",
        });
      }
    } catch (e: any) {
      showAlert({
        title: t.glossaryView.renameFailTitle,
        description: (t.glossaryView.renameFailDesc || "").replace(
          "{error}",
          e.message || "",
        ),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-background overflow-hidden p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          {t.glossary}
          <span className="text-sm font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
            {glossaries.length}
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchGlossaries}
            disabled={loading}
            className="w-8 h-8 text-muted-foreground hover:text-primary"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openFolder}
            className="w-8 h-8 text-muted-foreground hover:text-primary"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                // @ts-ignore
                const result = await window.api.selectFile({
                  title: t.glossaryView.importTitle,
                  filters: [
                    { name: t.glossaryView.importFilter, extensions: ["json"] },
                  ],
                });
                if (result) {
                  // @ts-ignore
                  const content = await window.api.readFile(result);
                  if (!content) return;
                  // Robustness check: Stricter heuristic for glossary shapes
                  let isValid = false;
                  try {
                    const data = JSON.parse(content);
                    if (Array.isArray(data)) {
                      if (data.length === 0) isValid = true;
                      else {
                        const slice = data.slice(0, 5); // Check first few items
                        isValid = slice.every(
                          (item) =>
                            typeof item === "object" &&
                            item !== null &&
                            Object.keys(item).some((k) =>
                              ["src", "jp", "original", "source"].includes(
                                k.toLowerCase(),
                              ),
                            ) &&
                            Object.keys(item).some((k) =>
                              [
                                "dst",
                                "zh",
                                "translation",
                                "target",
                                "dest",
                              ].includes(k.toLowerCase()),
                            ),
                        );
                      }
                    } else if (typeof data === "object" && data !== null) {
                      const values = Object.values(data);
                      if (values.length === 0) isValid = true;
                      else {
                        // Ensure it's a flat dict of strings/numbers (typical glossary)
                        isValid = values
                          .slice(0, 20)
                          .every(
                            (v) =>
                              typeof v === "string" || typeof v === "number",
                          );
                      }
                    }
                  } catch (e) {
                    isValid = false;
                  }

                  if (!isValid) {
                    showConfirm({
                      title: t.glossaryView.formatIncompatible,
                      description: t.glossaryView.formatIncompatibleDesc,
                      onConfirm: () => {
                        const name =
                          result.split(/[\\/]/).pop() || "import.json";
                        setConverterInitialFile({ name, content });
                        setShowConverter(true);
                      },
                    });
                    return;
                  }
                  // @ts-ignore
                  const importRes = await window.api.importGlossary(result);
                  if (importRes.success) {
                    showAlert({
                      title: t.glossaryView.importSuccessTitle,
                      description: (t.glossaryView.importSuccess || "").replace(
                        "{path}",
                        importRes.path || "",
                      ),
                      variant: "success",
                    });
                    fetchGlossaries();
                  } else {
                    showAlert({
                      title: t.glossaryView.importFailTitle,
                      description: (t.glossaryView.importFail || "").replace(
                        "{error}",
                        importRes.error || "",
                      ),
                      variant: "destructive",
                    });
                  }
                }
              } catch (e: any) {
                showAlert({
                  title: t.glossaryView.importErrorTitle,
                  description: (t.glossaryView.importError || "").replace(
                    "{message}",
                    e.message || "",
                  ),
                  variant: "destructive",
                });
              }
            }}
            className="gap-2 h-9"
          >
            <FileUp className="w-4 h-4 text-muted-foreground" />
            {t.glossaryView.import}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConverter(true)}
            className="gap-2 h-9"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            {t.glossaryView.formatConvert}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExtractor(true)}
            className="gap-2 h-9"
          >
            <Wand2 className="w-4 h-4 text-muted-foreground" />
            {t.glossaryView.smartExtract}
          </Button>
          <Button
            onClick={() => setCreatingNew(true)}
            className="gap-2 h-9 shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4" />
            {t.glossaryView.new}
          </Button>
        </div>
      </div>

      {notice &&
        (() => {
          const noticeConfig = {
            info: {
              className: "bg-blue-500/10 border-blue-500/30 text-blue-600",
              icon: Sparkles,
            },
            warning: {
              className: "bg-amber-500/10 border-amber-500/30 text-amber-600",
              icon: AlertTriangle,
            },
            error: {
              className: "bg-red-500/10 border-red-500/30 text-red-600",
              icon: AlertTriangle,
            },
          }[notice.type];
          const NoticeIcon = noticeConfig.icon;
          return (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${noticeConfig.className}`}
            >
              <NoticeIcon className="w-3.5 h-3.5 mt-0.5" />
              <span className="flex-1 leading-relaxed">{notice.message}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="ml-auto text-current/70 hover:text-current"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}

      {/* Format Description */}
      <div className="mb-4 p-4 bg-card border border-border/60 rounded-2xl shadow-sm text-xs overflow-hidden shrink-0">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-3 min-w-[220px]">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
                <BookOpen className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-sm font-bold tracking-tight">
                {t.glossaryView.standardFormat}
              </h3>
            </div>
            <div className="space-y-2">
              <p className="text-muted-foreground leading-relaxed">
                {t.glossaryView.standardFormatDesc}
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2 text-[10px] text-muted-foreground/80 bg-primary/5 p-2 rounded-lg border border-primary/10">
                  <Sparkles className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  <span>
                    <strong>{t.glossaryView.smartAdaptTitle}</strong>:{" "}
                    {t.glossaryView.smartAdaptDesc}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-[1.8] grid grid-cols-2 gap-3">
            <div className="space-y-1.5 flex flex-col min-w-0">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] uppercase font-bold text-muted-foreground/60 tracking-widest">
                  {t.glossaryView.dictMode}
                </span>
                <div className="w-1 h-1 rounded-full bg-primary/40" />
              </div>
              <pre className="flex-1 bg-secondary/30 p-2.5 rounded-xl border border-border/50 font-mono text-[9px] text-primary/80 overflow-y-auto max-h-[70px] scrollbar-none">
                {t.glossaryView.exampleDict}
              </pre>
            </div>
            <div className="space-y-1.5 flex flex-col min-w-0">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] uppercase font-bold text-muted-foreground/60 tracking-widest">
                  {t.glossaryView.listMode}
                </span>
                <div className="w-1 h-1 rounded-full bg-primary/40" />
              </div>
              <pre className="flex-1 bg-secondary/30 p-2.5 rounded-xl border border-border/50 font-mono text-[9px] text-primary/80 overflow-y-auto max-h-[70px] scrollbar-none">
                {t.glossaryView.exampleList}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Auto Match Rule (Stand-alone Important) */}
      <div className="mb-4 p-4 bg-green-500/5 border border-green-500/10 rounded-2xl flex items-center gap-4 group">
        <div className="p-2.5 bg-green-500/10 rounded-xl text-green-600 group-hover:bg-green-500/20 transition-colors">
          <RefreshCw className="w-5 h-5 shrink-0" />
        </div>
        <div className="flex-1">
          <h4 className="text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-2 mb-0.5">
            {t.glossaryView.autoMatchRule}
          </h4>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t.glossaryView.autoMatchRuleDesc}
          </p>
        </div>
      </div>

      {/* Create Modal (Simple inline) */}
      {creatingNew && (
        <div className="mb-6 p-4 bg-secondary rounded-lg border flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
          <span className="text-sm font-medium whitespace-nowrap">
            {t.glossaryView.filename}
          </span>
          <input
            className="bg-background border p-1 px-3 rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="my_terms.json"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate}>
              {t.glossaryView.create}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreatingNew(false);
                setNewFileName("");
              }}
            >
              {t.glossaryView.cancel}
            </Button>
          </div>
        </div>
      )}

      {/* Rename Modal (Simple inline) */}
      {renamingFile && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
          <span className="text-sm font-bold text-amber-600 flex items-center gap-2">
            <Pen className="w-4 h-4" /> {t.glossaryView.renameTitle}
          </span>
          <input
            className="bg-background border p-1 px-3 rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-amber-500"
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleRename}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {t.glossaryView.save}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenamingFile(null);
                setRenameNewName("");
              }}
            >
              {t.glossaryView.cancel}
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-6 h-full overflow-hidden pb-12">
        {/* List (Left side) */}
        <div className="w-1/3 overflow-y-auto space-y-2 p-1 pr-2 scrollbar-thin">
          {glossaries.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border-2 border-dashed border-border rounded-lg bg-card">
              <p>{t.glossaryView.noGlossaries}</p>
              <p className="text-xs mt-2 text-muted-foreground/70">
                {t.glossaryView.hint}
              </p>
            </div>
          ) : (
            glossaries.map((file) => (
              <div
                key={file}
                onClick={() => handleSelect(file)}
                className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center gap-3 ${
                  selectedGlossary === file
                    ? "bg-primary/10 border-primary/30 shadow-sm ring-1 ring-primary/50"
                    : "bg-card border-border hover:border-primary/50 hover:bg-secondary"
                }`}
              >
                {file.endsWith(".json") ? (
                  <FileJson
                    className={`w-8 h-8 ${selectedGlossary === file ? "text-primary" : "text-muted-foreground"}`}
                  />
                ) : (
                  <FileText
                    className={`w-8 h-8 ${selectedGlossary === file ? "text-blue-500" : "text-muted-foreground"}`}
                  />
                )}
                <div className="overflow-hidden">
                  <p
                    className={`font-medium truncate ${selectedGlossary === file ? "text-primary" : "text-foreground"}`}
                  >
                    {file}
                  </p>
                  <p className="text-[9px] uppercase font-bold text-muted-foreground/50 tracking-tight mt-0.5">
                    {file.endsWith(".json")
                      ? "Structured JSON"
                      : t.glossaryView.legacyFormat}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Preview (Right side) */}
        <Card className="flex-1 flex flex-col overflow-hidden shadow-xl border-border/40 bg-card/80 backdrop-blur-sm rounded-2xl relative">
          <CardHeader className="py-4 px-6 bg-secondary/20 border-b border-border/50 flex flex-row justify-between items-center shrink-0">
            <div className="flex flex-col gap-0.5 min-w-0 max-w-[50%]">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2 overflow-hidden">
                <BookOpen className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate" title={selectedGlossary}>
                  {selectedGlossary || t.glossaryView.preview}
                </span>
                {isEditing && (
                  <span className="text-[10px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ml-2 shrink-0">
                    {t.glossaryView.editing}
                  </span>
                )}
              </CardTitle>
              {selectedGlossary && (
                <p className="text-[10px] text-muted-foreground font-mono ml-6 opacity-60">
                  Relative to glossary directory
                </p>
              )}
            </div>

            {selectedGlossary && (
              <div className="flex items-center gap-4">
                {/* Table/RAW Toggle (Only when not editing and is JSON) */}
                {!isEditing && selectedGlossary.endsWith(".json") && (
                  <div className="flex bg-secondary/50 rounded-lg p-0.5 border border-border/50">
                    <button
                      onClick={() => setViewMode("table")}
                      className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${viewMode === "table" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {t.glossaryView.viewModeTable}
                    </button>
                    <button
                      onClick={() => setViewMode("raw")}
                      className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${viewMode === "raw" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      RAW
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditing(false)}
                        className="h-6 px-2 text-xs"
                      >
                        <X className="w-3 h-3 mr-1" /> {t.glossaryView.cancel}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        className="h-6 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <Save className="w-3 h-3 mr-1" /> {t.glossaryView.save}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDelete}
                        className="h-6 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />{" "}
                        {t.glossaryView.delete}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={startRename}
                        className="h-6 px-2 text-xs text-amber-600 hover:bg-amber-50"
                      >
                        <Pen className="w-3 h-3 mr-1" /> Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={startEditing}
                        className="h-6 px-2 text-xs border border-border"
                      >
                        <Pen className="w-3 h-3 mr-1" /> {t.glossaryView.edit}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden bg-secondary relative">
            {selectedGlossary ? (
              loadingContent ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {selectedGlossary.endsWith(".json") &&
                  viewMode === "table" ? (
                    isEditing ? (
                      <div className="w-full h-full flex flex-col bg-background overflow-hidden animate-in fade-in duration-300">
                        <div className="grid grid-cols-[1fr_1fr_40px] bg-muted/40 sticky top-0 z-10 py-3 px-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 border-b border-border/50">
                          <div>{t.glossaryView.sourceCol}</div>
                          <div>{t.glossaryView.targetCol}</div>
                          <div className="text-center">
                            {t.glossaryView.actionCol}
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-border/20 scrollbar-thin pb-20">
                          {editableEntries.map((entry, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-[1fr_1fr_40px] px-4 py-2 hover:bg-primary/5 items-center gap-3"
                            >
                              <input
                                className="bg-secondary/30 border border-transparent focus:border-primary/30 p-2 rounded-lg text-xs font-mono outline-none transition-all"
                                value={entry.src}
                                onChange={(e) =>
                                  handleUpdateRow(idx, "src", e.target.value)
                                }
                                placeholder={t.glossaryView.sourcePlaceholder}
                              />
                              <input
                                className="bg-secondary/30 border border-transparent focus:border-primary/30 p-2 rounded-lg text-xs font-mono outline-none transition-all text-primary font-bold"
                                value={entry.dst}
                                onChange={(e) =>
                                  handleUpdateRow(idx, "dst", e.target.value)
                                }
                                placeholder={t.glossaryView.targetPlaceholder}
                              />
                              <button
                                onClick={() => handleRemoveRow(idx)}
                                className="text-muted-foreground hover:text-red-500 transition-colors flex justify-center"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <div className="p-4 flex justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleAddRow}
                              className="gap-2 text-xs opacity-60 hover:opacity-100"
                            >
                              <Plus className="w-3 h-3" />{" "}
                              {t.glossaryView.addRow}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        try {
                          const data = JSON.parse(content);
                          // Standardize to dict
                          const entries: Record<string, string> = {};
                          if (Array.isArray(data)) {
                            data.forEach((item) => {
                              const src =
                                item.src ||
                                item.jp ||
                                item.original ||
                                item.source;
                              const dst =
                                item.dst ||
                                item.zh ||
                                item.translation ||
                                item.target ||
                                item.dest;
                              if (src && dst)
                                entries[String(src)] = String(dst);
                            });
                          } else if (
                            typeof data === "object" &&
                            data !== null
                          ) {
                            Object.entries(data).forEach(([k, v]) => {
                              entries[k] = String(v);
                            });
                          }

                          return (
                            <div className="w-full h-full flex flex-col bg-background/50 overflow-hidden animate-in fade-in duration-300">
                              <div className="grid grid-cols-2 bg-muted/40 sticky top-0 z-10 py-3 px-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 border-b border-border/50">
                                <div>{t.glossaryView.sourceCol}</div>
                                <div>{t.glossaryView.targetCol}</div>
                              </div>
                              <div className="flex-1 overflow-y-auto divide-y divide-border/20 scrollbar-thin">
                                {Object.entries(entries).map(([k, v], i) => (
                                  <div
                                    key={i}
                                    className="grid grid-cols-2 px-6 py-3.5 hover:bg-primary/5 transition-colors text-xs items-center group"
                                  >
                                    <div
                                      className="truncate pr-4 font-mono text-muted-foreground group-hover:text-foreground transition-colors"
                                      title={k}
                                    >
                                      {k}
                                    </div>
                                    <div
                                      className="truncate text-primary font-mono font-bold"
                                      title={v}
                                    >
                                      {v}
                                    </div>
                                  </div>
                                ))}
                                {Object.keys(entries).length === 0 && (
                                  <div className="h-full flex flex-col items-center justify-center p-12 text-muted-foreground opacity-30 italic">
                                    <RefreshCw className="w-12 h-12 mb-4 opacity-10" />
                                    <p>{t.glossaryView.noContent}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        } catch (e) {
                          return (
                            <div className="w-full h-full flex flex-col items-center justify-center p-12 text-red-500/70 bg-red-500/5">
                              <AlertTriangle className="w-12 h-12 mb-4" />
                              <p className="font-bold text-sm">
                                {t.glossaryView.jsonCorrupted}
                              </p>
                              <p className="text-[10px] mt-2 opacity-70">
                                {t.glossaryView.jsonCorruptedDesc}
                              </p>
                            </div>
                          );
                        }
                      })()
                    )
                  ) : (
                    <div className="flex flex-col h-full">
                      {!selectedGlossary.endsWith(".json") && (
                        <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-[10px] text-amber-700 font-bold flex items-center gap-2">
                          <AlertTriangle className="w-3 h-3" />
                          {t.glossaryView.legacyFormatDesc}
                        </div>
                      )}
                      {!loadingContent && content.trim().length === 0 && (
                        <div className="p-3 border-b border-border/30 text-[10px] text-muted-foreground flex items-center gap-2 bg-muted/10">
                          <AlertTriangle className="w-3 h-3 text-muted-foreground/70" />
                          {t.glossaryView.noContent}
                        </div>
                      )}
                      <textarea
                        className={`w-full h-full p-6 font-mono text-xs leading-relaxed bg-transparent text-foreground/90 resize-none focus:outline-none scrollbar-thin ${isEditing ? "bg-background/80" : "opacity-80"}`}
                        value={content}
                        spellCheck={false}
                        onChange={(e) =>
                          isEditing && setContent(e.target.value)
                        }
                        readOnly={!isEditing}
                      />
                    </div>
                  )}
                </>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <BookOpen className="w-12 h-12 mb-2 opacity-20" />
                <p>{t.glossaryView.placeholder}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {showConverter && (
        <GlossaryConverter
          initialFile={converterInitialFile || undefined}
          lang={lang}
          onClose={() => {
            setShowConverter(false);
            setConverterInitialFile(null);
          }}
          onSuccess={fetchGlossaries}
        />
      )}
      {showExtractor && (
        <TermExtractModal
          lang={lang}
          onClose={() => setShowExtractor(false)}
          onImport={async (terms, filename) => {
            // Create new glossary with extracted terms using provided filename
            const content = JSON.stringify(terms, null, 2);
            try {
              // @ts-ignore
              await window.api.createGlossaryFile({ filename, content });
              fetchGlossaries();
              showAlert({
                title: t.glossaryView.importSuccessTitle,
                description: t.glossaryView.importExtractedDesc
                  .replace("{count}", String(terms.length))
                  .replace("{name}", filename),
                variant: "success",
              });
            } catch (e: any) {
              showAlert({
                title: t.glossaryView.importFailTitle,
                description: e.message,
                variant: "destructive",
              });
            }
          }}
        />
      )}
      <AlertModal {...alertProps} />
    </div>
  );
}
