import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button } from "./ui/core";
import {
  FileUp,
  ArrowRight,
  X,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { translations, Language } from "../lib/i18n";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";

interface GlossaryConverterProps {
  onClose: () => void;
  onSuccess: () => void;
  lang?: Language;
  initialFile?: File | { name: string; content: string };
}

export function GlossaryConverter({
  onClose,
  onSuccess,
  lang = "zh",
  initialFile,
}: GlossaryConverterProps) {
  const t = translations[lang];
  const [parsedEntries, setParsedEntries] = useState<Record<string, string>>(
    {},
  );
  const [status, setStatus] = useState<
    "idle" | "parsing" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fileName, setFileName] = useState("converted_glossary.json");
  const [viewMode, setViewMode] = useState<"table" | "raw">("table");
  const { alertProps, showAlert } = useAlertModal();

  useEffect(() => {
    if (!initialFile) return;

    if ("content" in initialFile) {
      setFileName(initialFile.name.replace(/\.[^/.]+$/, "") + ".json");
      if (initialFile.name.toLowerCase().endsWith(".txt")) {
        parseTxtContent(initialFile.content);
      } else {
        parseJsonContent(initialFile.content);
      }
    } else if (initialFile instanceof File) {
      const isTxt = initialFile.name.toLowerCase().endsWith(".txt");
      setFileName(initialFile.name.replace(/\.[^/.]+$/, "") + ".json");
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (isTxt) {
          parseTxtContent(content);
        } else {
          parseJsonContent(content);
        }
      };
      reader.readAsText(initialFile);
    }
  }, [initialFile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isTxt = file.name.toLowerCase().endsWith(".txt");
    setFileName(file.name.replace(/\.[^/.]+$/, "") + ".json");
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (isTxt) {
        parseTxtContent(content);
      } else {
        parseJsonContent(content);
      }
    };
    reader.readAsText(file);
  };

  const parseTxtContent = (content: string) => {
    setStatus("parsing");
    const glossary: Record<string, string> = {};
    let overwrites = 0;
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      line = line.trim();
      if (!line || line.startsWith("#")) return;

      let k = "",
        v = "";
      if (line.includes("=")) {
        const parts = line.split("=");
        k = parts[0];
        v = parts.slice(1).join("=");
      } else if (line.includes(":")) {
        const parts = line.split(":");
        k = parts[0];
        v = parts.slice(1).join(":");
      }

      if (k && v) {
        const key = k.trim();
        const val = v.trim();
        if (glossary[key]) {
          console.debug(
            `[Converter] Overwriting entry at line ${idx + 1}: ${key}`,
          );
          overwrites++;
        }
        glossary[key] = val;
      }
    });

    setParsedEntries(glossary);
    finalizeParse(glossary, overwrites);
  };

  const parseJsonContent = (content: string) => {
    setStatus("parsing");
    try {
      const data = JSON.parse(content);
      const glossary: Record<string, string> = {};
      let overwrites = 0;

      if (Array.isArray(data)) {
        data.forEach((entry, idx) => {
          if (typeof entry !== "object" || entry === null) return;
          const getVal = (keys: string[]) => {
            const foundKey = Object.keys(entry).find((k) =>
              keys.includes(k.toLowerCase()),
            );
            return foundKey ? entry[foundKey] : null;
          };
          const src = getVal(["src", "jp", "original", "source"]);
          const dst = getVal(["dst", "zh", "translation", "target", "dest"]);
          if (src && dst) {
            const s = String(src);
            if (glossary[s]) {
              console.debug(
                `[Converter] Overwriting entry at index ${idx}: ${s}`,
              );
              overwrites++;
            }
            glossary[s] = String(dst);
          }
        });
      } else if (typeof data === "object") {
        Object.entries(data).forEach(([k, v]) => {
          glossary[String(k)] = String(v);
        });
      }

      setParsedEntries(glossary);
      finalizeParse(glossary, overwrites);
    } catch (e) {
      setStatus("error");
      setErrorMsg(t.glossaryConverter.jsonError + (e as Error).message);
    }
  };

  const finalizeParse = (
    glossary: Record<string, string>,
    overwrites: number,
  ) => {
    const count = Object.keys(glossary).length;
    if (count > 0) {
      setStatus("success");
      if (overwrites > 0) {
        console.info(
          `[Converter] Parsed ${count} entries with ${overwrites} overwrites.`,
        );
      }
    } else {
      setStatus("error");
      setErrorMsg(t.glossaryConverter.noEntriesTitle);
    }
  };

  const handleSave = async () => {
    if (Object.keys(parsedEntries).length === 0) return;

    try {
      // @ts-ignore
      await window.api.createGlossaryFile({
        filename: fileName,
        content: JSON.stringify(parsedEntries, null, 2),
      });
      window.api?.showNotification(
        "Murasaki Translator",
        t.glossaryConverter.saveSuccess,
      );
      onSuccess();
      onClose();
    } catch (e) {
      showAlert({
        title: "保存失败",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <Card className="w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[0_0_50px_-12px_rgba(138,43,226,0.3)] border-primary/20 bg-background/95 backdrop-blur-xl animate-in zoom-in-95 duration-200">
        <CardHeader className="flex flex-row items-center justify-between border-b px-6 py-4 bg-secondary/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl text-primary">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold tracking-tight">
                {t.glossaryConverter.title}
              </CardTitle>
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5 opacity-70">
                Legacy Format ➔ Murasaki JSON
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full hover:bg-red-500/10 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden flex flex-col p-8 gap-8">
          {/* Stepper logic */}
          <div className="flex items-center justify-center gap-4 max-w-md mx-auto w-full">
            <div
              className={`flex items-center gap-2 ${status === "idle" ? "text-primary" : "text-muted-foreground"}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${status === "idle" ? "border-primary bg-primary/10" : "border-muted bg-transparent"}`}
              >
                1
              </div>
              <span className="text-xs font-bold">
                {t.glossaryConverter.stepRead}
              </span>
            </div>
            <div className="h-px flex-1 bg-border" />
            <div
              className={`flex items-center gap-2 ${status === "parsing" ? "text-primary" : "text-muted-foreground"}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${status === "parsing" ? "border-primary bg-primary/10" : "border-muted bg-transparent"}`}
              >
                2
              </div>
              <span className="text-xs font-bold">
                {t.glossaryConverter.stepParse}
              </span>
            </div>
            <div className="h-px flex-1 bg-border" />
            <div
              className={`flex items-center gap-2 ${status === "success" ? "text-primary" : "text-muted-foreground"}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${status === "success" ? "border-primary bg-primary/10" : "border-muted bg-transparent"}`}
              >
                3
              </div>
              <span className="text-xs font-bold">
                {t.glossaryConverter.stepExport}
              </span>
            </div>
          </div>

          {status === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="relative group cursor-pointer w-full max-w-lg">
                <input
                  type="file"
                  accept=".json,.txt"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-primary/20 rounded-3xl p-12 flex flex-col items-center justify-center gap-4 bg-primary/5 group-hover:bg-primary/10 group-hover:border-primary/40 transition-all duration-300">
                  <div className="w-16 h-16 bg-background rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <FileUp className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-foreground">
                      {t.glossaryConverter.dropzoneTitle}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.glossaryConverter.dropzoneDesc}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status === "parsing" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <RefreshCw className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm font-medium animate-pulse">
                {t.glossaryConverter.parsingStatus}
              </p>
            </div>
          )}

          {status === "success" && (
            <div className="flex-1 flex flex-col gap-8 min-h-0 overflow-hidden animate-in fade-in duration-500">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 flex-1 min-h-0">
                {/* Left Side: Preview (More space) */}
                <div className="lg:col-span-3 border border-border/60 rounded-2xl overflow-hidden flex flex-col bg-secondary/20 backdrop-blur-sm relative">
                  <div className="flex items-center justify-between bg-card border-b px-4 py-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      <Sparkles className="w-3 h-3 text-primary" />{" "}
                      {t.glossaryConverter.previewTitle}
                    </div>
                    <div className="flex bg-secondary rounded-lg p-0.5 border">
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
                        {t.glossaryView.viewModeRaw}
                      </button>
                    </div>
                  </div>

                  {viewMode === "table" ? (
                    <div className="flex-1 overflow-y-auto divide-y divide-border/40 scrollbar-thin">
                      <div className="grid grid-cols-2 bg-muted/30 sticky top-0 z-10 py-2 px-4 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 border-b">
                        <div>{t.glossaryView.sourceCol}</div>
                        <div>{t.glossaryView.targetCol}</div>
                      </div>
                      {Object.entries(parsedEntries)
                        .slice(0, 200)
                        .map(([k, v], i) => (
                          <div
                            key={i}
                            className="grid grid-cols-2 px-4 py-2.5 hover:bg-primary/5 transition-colors text-xs items-center border-border/20"
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
                      {Object.keys(parsedEntries).length > 200 && (
                        <div className="px-4 py-3 text-center text-[10px] text-muted-foreground italic bg-secondary/30">
                          {t.glossaryConverter.previewLimit}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-hidden p-4">
                      <pre className="w-full h-full bg-black/5 dark:bg-black/40 p-4 rounded-xl font-mono text-[10px] text-muted-foreground overflow-y-auto scrollbar-thin leading-relaxed">
                        {JSON.stringify(parsedEntries, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Right Side: Controls (Actions) */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                  <div className="p-4 bg-primary/5 rounded-xl border border-primary/10">
                    <p className="text-[10px] text-primary/70 leading-relaxed font-medium">
                      💡 <strong>{t.glossaryConverter.tipTitle}</strong>：
                      {t.glossaryConverter.tipDesc}
                    </p>
                  </div>

                  <div className="p-5 bg-card border border-border/80 rounded-2xl shadow-sm space-y-5">
                    <div className="flex items-center gap-3 pb-4 border-b">
                      <div className="p-2.5 bg-green-500/10 rounded-xl text-green-600">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1.5">
                          {t.glossaryConverter.parseSuccess}
                        </p>
                        <p className="text-lg font-black tracking-tight">
                          {t.glossaryConverter.itemsCount.replace(
                            "{count}",
                            Object.keys(parsedEntries).length.toString(),
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">
                          {t.glossaryConverter.saveFileName}
                        </label>
                        <div className="relative group">
                          <FileJson className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary opacity-50 group-focus-within:opacity-100 transition-opacity" />
                          <input
                            className="w-full bg-secondary/50 border border-border p-3 pl-10 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all font-bold"
                            value={fileName}
                            onChange={(e) => setFileName(e.target.value)}
                            placeholder="filename.json"
                          />
                        </div>
                      </div>
                    </div>

                    <Button
                      className="w-full gap-2 h-12 text-sm font-bold rounded-xl shadow-lg shadow-primary/20 group mt-4 relative overflow-hidden"
                      onClick={handleSave}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary to-purple-600 opacity-0 group-hover:opacity-10 transition-opacity" />
                      {t.glossaryConverter.confirmExport}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-in zoom-in-95">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="text-center max-w-sm">
                <p className="font-bold text-red-600 mb-1">
                  {t.glossaryConverter.parseError}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {errorMsg}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus("idle")}
                className="rounded-xl px-6"
              >
                {t.glossaryConverter.retry}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <AlertModal {...alertProps} />
    </div>
  );
}
