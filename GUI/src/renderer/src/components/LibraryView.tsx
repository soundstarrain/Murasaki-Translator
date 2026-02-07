/**
 * LibraryView - 记忆库 / 队列管理中心
 * 提供: 队列管理、拖放导入、单文件自定义配置、直接跳转校对
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderOpen,
  FileText,
  Trash2,
  GripVertical,
  AlignLeft,
  Plus,
  FolderPlus,
  X,
  ClipboardCheck,
  Cpu,
  MemoryStick,
  Settings,
  BookMarked,
  FolderOutput,
  Gauge,
  Zap,
  Scale,
  RotateCcw,
  Check,
  Sparkles,
  AlertTriangle,
  Info,
  Settings2,
  LayoutGrid,
  ArrowUp,
} from "lucide-react";
import { Button, Card, Switch, Tooltip as UITooltip } from "./ui/core";
import { FileIcon } from "./ui/FileIcon";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { Language } from "../lib/i18n";
import {
  QueueItem,
  FileConfig,
  generateId,
  getFileType,
} from "../types/common";

// ============ Types ============

interface LibraryViewProps {
  lang: Language;
  onNavigate?: (view: string) => void;
  onProofreadFile?: (cachePath: string) => void;
  isRunning?: boolean;
}

// ============ Constants ============

const LIBRARY_QUEUE_KEY = "library_queue";
const FILE_QUEUE_KEY = "file_queue";
const SUPPORTED_EXTENSIONS = [".txt", ".epub", ".srt", ".ass", ".ssa"];

// ============ Helpers ============

function getCachePath(filePath: string, outputDir?: string): string {
  // Fix: Handle both slash types correctly. lastIndexOf returns -1 if not found, checking both ensures we find the real separator.
  const lastSep = Math.max(
    filePath.lastIndexOf("\\"),
    filePath.lastIndexOf("/"),
  );
  const dir = outputDir
    ? outputDir
    : lastSep === -1
      ? "."
      : filePath.substring(0, lastSep);
  const baseName = filePath.substring(lastSep + 1).replace(/\.[^.]+$/, "");
  return `${dir}\\${baseName}_zh.cache.json`;
}

// ============ Texts ============

const texts = {
  zh: {
    title: "翻译队列",
    subtitle: "批量处理队列，为每个文件指定独立参数",
    files: "个文件",
    dropHint: "拖放文件或文件夹到此处添加到队列",
    dropTitle: "拖放文件到这里",
    emptyDragHint: "或点击任意处浏览文件",
    selectFiles: "选择文件",
    selectFolder: "选择文件夹",
    scanSubdirs: "扫描子目录",
    confirmClear: "确定要清空翻译队列吗？",
    supportedTypes: "支持 .txt .epub .srt .ass",
    queueTitle: "翻译队列",
    emptyQueue: "队列为空",
    emptyHint: "拖放文件到上方区域，或点击按钮选择",
    startAll: "开始翻译",
    clear: "清空全部",
    selected: "已选",
    items: "项",
    remove: "移除",
    selectAll: "全选",
    deselectAll: "取消全选",
    default: "默认",
    proofread: "校对",
    config: "配置",
    configTitle: "文件翻译配置",
    batchConfig: "批量配置",
    configDesc: "覆盖全局设置，为此文件指定独立参数",
    useGlobal: "使用全局默认配置",
    useGlobalDesc: "取消勾选以自定义此文件的翻译参数",
    moveToTop: "置顶",

    // Params
    glossary: "术语表",
    outputDir: "输出目录",
    contextSize: "上下文长度",
    temperature: "温度",
    gpuLayers: "GPU层数",
    preset: "Prompt",
    concurrency: "并发数",
    repPenaltyBase: "重复惩罚 (Base)",
    repPenaltyMax: "重复惩罚 (Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache 量化",
    alignmentMode: "辅助对齐",
    saveCot: "CoT 导出",

    save: "保存配置",
    cancel: "取消",
    browse: "浏览",
    reset: "重置",
    notSet: "跟随全局设置",
    currentGlobal: "当前全局",
    seed: "随机种子 (Seed)",

    presetOptions: {
      novel: "轻小说模式 (默认)",
      script: "剧本模式 (Galgame)",
      short: "单句模式",
    },
    kvOptions: {
      f16: "F16 (标准)",
      q8_0: "Q8_0 (推荐)",
      q5_1: "Q5_1 (高效型)",
      q4_0: "Q4_0 (省显存)",
    },
    help: {
      glossary:
        "指定此文件使用的专属术语表。术语表帮助模型准确翻译人名、地名和专有名词。",
      outputDir: "设置翻译结果的保存目录。留空则与源文件保存在同一目录。",
      contextSize:
        "模型一次能处理的文本量。数值越高显存占用越高，建议 4096-8192。",
      concurrency: "并行翻译的任务数。增加并发可提升速度，但显存占用也会增加。",
      temperature:
        "控制输出随机性。较低值 (0.3-0.6) 更稳定，较高值 (0.7-1.0) 更有创意。",
      gpuLayers: "GPU 加速层数。-1 表示全部加载到显卡，0 表示仅 CPU。",
      repPenaltyBase: "重复惩罚初始值。用于抑制模型输出重复内容。",
      repPenaltyMax: "重复惩罚最大值。检测到死循环时惩罚值会递增至此。",
      seed: "固定随机种子可使输出结果可复现。留空表示随机。",
      preset: "轻小说模式适合翻译轻小说和连贯性长文本；剧本模式适合 Galgame、动画字幕、漫画；单句模式适合对齐要求高的短句，但效率和效果会下降，不建议使用",
    },
  },
  en: {
    title: "Workbench",
    subtitle:
      "Batch process queue, specify independent parameters for each file",

    seed: "Seed",
    currentGlobal: "Global",
    files: "files",
    dropHint: "Drop files or folders here to add to queue",
    dropTitle: "Drag & Drop Files Here",
    emptyDragHint: "Or click anywhere to browse",
    selectFiles: "Select Files",
    selectFolder: "Select Folder",
    scanSubdirs: "Scan Subdirs",
    confirmClear: "Are you sure you want to clear the translation queue?",
    supportedTypes: "Supports .txt .epub .srt .ass",
    queueTitle: "Translation Queue",
    emptyQueue: "Queue is empty",
    emptyHint: "Drop files above, or click buttons to select",
    startAll: "Start All",
    clear: "Clear",
    selected: "Selected",
    items: "items",
    remove: "Remove",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    default: "Default",
    custom: "Custom",
    proofread: "Proofread",
    config: "Config",
    configTitle: "File Translation Config",
    batchConfig: "Batch Config",
    configDesc: "Override global settings with file-specific parameters",
    useGlobal: "Use Global Defaults",
    useGlobalDesc: "Uncheck to customize parameters for this file",
    moveToTop: "Top",

    glossary: "Glossary",
    outputDir: "Output Directory",
    contextSize: "Context Size",
    temperature: "Temperature",
    gpuLayers: "GPU Layers",
    preset: "Preset Mode",
    concurrency: "Concurrency",
    repPenaltyBase: "Rep. Penalty (Base)",
    repPenaltyMax: "Rep. Penalty (Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache Quant",
    alignmentMode: "Auxiliary Alignment",
    saveCot: "CoT Export",

    save: "Save Config",
    cancel: "Cancel",
    browse: "Browse",
    reset: "Reset",

    notSet: "Follow global setting",

    presetOptions: {
      novel: "Novel Mode (Default)",
      script: "Script Mode (Galgame)",
      short: "Short Mode",
    },
    kvOptions: {
      f16: "F16 (Standard)",
      q8_0: "Q8_0 (Recommended)",
      q5_1: "Q5_1 (Efficient)",
      q4_0: "Q4_0 (Low VRAM)",
    },
    help: {
      glossary:
        "Specify glossary for this file. Helps accurate translation of names and terms.",
      outputDir:
        "Set output directory. Leave empty to save alongside source file.",
      contextSize:
        "Text processing capacity. Higher values need more VRAM. Recommended: 4096-8192.",
      concurrency:
        "Parallel translation tasks. More concurrency = faster but more VRAM.",
      temperature:
        "Output randomness. Lower (0.3-0.6) = stable, higher (0.7-1.0) = creative.",
      gpuLayers: "GPU acceleration layers. -1 = all GPU, 0 = CPU only.",
      repPenaltyBase: "Initial repetition penalty. Suppresses repeated output.",
      repPenaltyMax: "Max repetition penalty for retry loops.",
      seed: "Fixed seed for reproducible output. Leave empty for random.",
      preset: "Novel mode for all novels and coherent long texts; Script mode for Galgame, anime subtitles, manga; Short mode for sentences requiring strict alignment, but efficiency and quality will decrease (not recommended)",
    },
  },
  jp: {
    title: "ライブラリ",
    subtitle: "キューを一括処理し、ファイルごとに個別のパラメータを指定",

    seed: "シード (Seed)",
    currentGlobal: "現在のグローバル値",
    files: "ファイル",
    dropHint: "ファイルまたはフォルダをドロップして追加",
    dropTitle: "ファイルをここにドロップ",
    emptyDragHint: "またはクリックして選択",
    selectFiles: "ファイル選択",
    selectFolder: "フォルダ選択",
    scanSubdirs: "サブディレクトリをスキャン",
    confirmClear: "翻訳キューを空にしてもよろしいですか？",
    supportedTypes: ".txt .epub .srt .ass に対応",
    queueTitle: "翻訳キュー",
    emptyQueue: "キューが空です",
    emptyHint: "上にファイルをドロップ、またはボタンで選択",
    startAll: "翻訳開始",
    clear: "クリア",
    selected: "選択中",
    items: "件",
    remove: "削除",
    selectAll: "すべて選択",
    deselectAll: "選択解除",
    default: "デフォルト",
    custom: "カスタム",
    proofread: "校正",
    config: "設定",
    configTitle: "ファイル翻訳設定",
    batchConfig: "一括設定",
    configDesc: "グローバル設定を上書きして個別パラメータを指定",
    useGlobal: "グローバルデフォルトを使用",
    useGlobalDesc: "チェックを外すとこのファイルのパラメータをカスタマイズ",
    moveToTop: "トップ",

    glossary: "用語集",
    outputDir: "出力ディレクトリ",
    contextSize: "コンテキストサイズ",
    temperature: "温度",
    gpuLayers: "GPUレイヤー",
    preset: "プリセット",
    concurrency: "同時実行数",
    repPenaltyBase: "繰り返しペナルティ (Base)",
    repPenaltyMax: "繰り返しペナルティ (Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache 量子化",
    alignmentMode: "補助アラインメント",
    saveCot: "CoT エクスポート",

    save: "設定を保存",
    cancel: "キャンセル",
    browse: "参照",
    reset: "リセット",

    notSet: "グローバル設定に従う",

    presetOptions: {
      novel: "小説モード (デフォルト)",
      script: "スクリプトモード (ギャルゲー)",
      short: "短文モード",
    },
    kvOptions: {
      f16: "F16 (高品質)",
      q8_0: "Q8_0 (バランス)",
      q5_1: "Q5_1 (効率的)",
      q4_0: "Q4_0 (低VRAM)",
    },
    help: {
      glossary:
        "このファイル専用の用語集を指定。名前などの正確な翻訳に役立ちます。",
      outputDir: "出力ディレクトリを設定。空の場合はソースと同じ場所に保存。",
      contextSize:
        "テキスト処理容量。大きい値はより多くのVRAMを使用。推奨: 4096-8192。",
      concurrency: "並列タスク数。増やすと速くなるがVRAM使用量も増加。",
      temperature:
        "出力のランダム性。低い (0.3-0.6) = 安定、高い (0.7-1.0) = 創造的。",
      gpuLayers: "GPU加速レイヤー。-1 = 全GPU、0 = CPUのみ。",
      repPenaltyBase: "繰り返しペナルティの初期値。重複出力を抑制。",
      repPenaltyMax: "リトライループの最大ペナルティ値。",
      seed: "再現可能な出力のための固定シード。空の場合はランダム。",
      preset: "小説モードは全ての小説と長文向け、スクリプトモードはギャルゲー・アニメ字幕・漫画向け、短文モードはアライメント重視の短文向けですが効率と品質が低下するため非推奨",
    },
  },
};

// ============ FileConfigModal ============

interface FileConfigModalProps {
  item: QueueItem;
  lang: Language;
  onSave: (config: FileConfig) => void;
  onClose: () => void;
}

function FileConfigModal({
  item,
  lang,
  onSave,
  onClose,
}: FileConfigModalProps) {
  const t = texts[lang];
  const [config, setConfig] = useState<FileConfig>({ ...item.config });

  // Get global defaults for display
  const globalGlossary = localStorage.getItem("config_glossary_path") || "";
  const globalCtx = localStorage.getItem("config_ctx") || "4096";
  const globalConcurrency = localStorage.getItem("config_concurrency") || "1";
  const globalTemp = localStorage.getItem("config_temperature") || "0.7";
  const globalGpu = localStorage.getItem("config_gpu") || "-1";
  const globalPreset = localStorage.getItem("config_preset") || "novel";
  const globalRepBase =
    localStorage.getItem("config_rep_penalty_base") || "1.0";
  const globalRepMax = localStorage.getItem("config_rep_penalty_max") || "1.5";
  const globalFlashAttn = localStorage.getItem("config_flash_attn") !== "false";
  const globalKvCache = localStorage.getItem("config_kv_cache_type") || "q8_0";
  const globalSeed = localStorage.getItem("config_seed") || "";
  const globalAlignmentMode =
    localStorage.getItem("config_alignment_mode") === "true";
  const globalSaveCot = localStorage.getItem("config_save_cot") === "true";

  const handleSelectGlossary = async () => {
    if (config.useGlobalDefaults) return;
    const result = await window.api?.selectFile({
      title: t.glossary,
      filters: [{ name: "Glossary Files", extensions: ["json", "txt"] }],
    });
    if (result) {
      setConfig((prev) => ({ ...prev, glossaryPath: result }));
    }
  };

  const handleSelectOutputDir = async () => {
    if (config.useGlobalDefaults) return;
    const result = await window.api?.selectFolder();
    if (result) {
      setConfig((prev) => ({ ...prev, outputDir: result }));
    }
  };

  const handleReset = () => {
    setConfig({ useGlobalDefaults: true });
  };

  // Helper for Inputs
  const InputRow = ({
    icon: Icon,
    label,
    value,
    onChange,
    placeholder,
    onBrowse,
    type = "text",
    min,
    max,
    step,
    globalValue,
    helpText,
    className = "",
  }: {
    icon: React.ElementType;
    label: string;
    value: string | number | undefined;
    onChange: (val: string) => void;
    placeholder?: string;
    onBrowse?: () => void;
    type?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
    globalValue?: string;
    helpText?: string;
    className?: string;
  }) => {
    // Display logic for empty global values
    const displayGlobalValue =
      globalValue === "" || globalValue === undefined
        ? lang === "zh"
          ? "未设置"
          : "Not set"
        : globalValue.length > 20
          ? "..." + globalValue.slice(-20)
          : globalValue;

    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center justify-between">
          <label
            className={`text-xs font-medium flex items-center gap-1.5 truncate ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
            {label}
            {helpText && (
              <UITooltip content={helpText}>
                <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
              </UITooltip>
            )}
          </label>
          {/* Always show Global Value at the top right for reference */}
          <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-2 tabular-nums">
            {t.currentGlobal}: {displayGlobalValue}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type={type}
            value={config.useGlobalDefaults ? "" : (value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              config.useGlobalDefaults
                ? globalValue ||
                placeholder ||
                (lang === "zh" ? "未设置" : "Not set")
                : placeholder || t.notSet
            }
            disabled={config.useGlobalDefaults}
            min={min}
            max={max}
            step={step}
            className={`
                            flex-1 h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                            ${config.useGlobalDefaults
                ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed placeholder:text-muted-foreground/40"
                : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              }
                        `}
          />
          {onBrowse && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBrowse}
              disabled={config.useGlobalDefaults}
              className={`shrink-0 h-8 px-2.5 ${config.useGlobalDefaults ? "opacity-50" : ""}`}
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Optimized Layout */}
        <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-purple-500/5 to-transparent shrink-0">
          <div className="flex items-center gap-4">
            {/* Left: Icon and Title */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">
                  {t.configTitle}
                </h3>
                <p
                  className="text-xs text-muted-foreground truncate max-w-[280px]"
                  title={item.path}
                >
                  {item.fileName}
                </p>
              </div>
            </div>

            {/* Right: Toggle and Close */}
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span
                  className={`text-xs font-medium ${config.useGlobalDefaults ? "text-primary" : "text-muted-foreground"}`}
                >
                  {t.useGlobal}
                </span>
                <Switch
                  checked={config.useGlobalDefaults}
                  onCheckedChange={(c) =>
                    setConfig((prev) => ({ ...prev, useGlobalDefaults: c }))
                  }
                />
              </label>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content - Always Visible */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Warning Banner */}
          {!config.useGlobalDefaults && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {lang === "zh"
                  ? "修改前请确保您了解正在修改的内容，错误的配置可能导致翻译过程异常或结果质量下降。"
                  : "Please ensure you understand what you are modifying. Incorrect settings may cause translation errors or quality degradation."}
              </p>
            </div>
          )}

          {/* 1. Prompt Preset Section - 最重要，放第一 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
              >
                <Settings className="w-3.5 h-3.5 shrink-0 opacity-70" />
                {t.preset}
                <UITooltip content={t.help?.preset || "选择翻译模式：轻小说适合长文本，剧本适合对话，单句适合零散内容"}>
                  <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
                </UITooltip>
              </label>
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {t.currentGlobal}: {globalPreset}
              </span>
            </div>
            <select
              value={
                !config.useGlobalDefaults && config.preset
                  ? config.preset
                  : ""
              }
              disabled={config.useGlobalDefaults}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  preset: e.target.value || undefined,
                }))
              }
              className={`
                w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                ${config.useGlobalDefaults
                  ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed"
                  : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                }
              `}
            >
              <option
                value=""
                disabled={!config.useGlobalDefaults && !config.preset}
              >
                {config.useGlobalDefaults ? globalPreset : t.notSet}
              </option>
              <option value="novel">{t.presetOptions.novel}</option>
              <option value="script">{t.presetOptions.script}</option>
              <option value="short">{t.presetOptions.short}</option>
            </select>
            {/* 短句模式警告 */}
            {!config.useGlobalDefaults && config.preset === "short" && (
              <div className="flex items-start gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  {lang === "zh"
                    ? "单句模式仅适用于零散短句，长文本翻译请使用轻小说或剧本模式。"
                    : "Short mode is only for isolated sentences. Use Novel or Script mode for documents."}
                </p>
              </div>
            )}
          </div>

          {/* 2. Paths Section - 术语表和输出目录 */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Paths & Directories
            </h4>
            <div className="grid grid-cols-1 gap-4">
              <InputRow
                icon={BookMarked}
                label={t.glossary}
                value={config.glossaryPath}
                onChange={(val) =>
                  setConfig((prev) => ({ ...prev, glossaryPath: val }))
                }
                onBrowse={handleSelectGlossary}
                globalValue={globalGlossary.split(/[/\\]/).pop()}
                helpText={t.help?.glossary}
              />
              <InputRow
                icon={FolderOutput}
                label={t.outputDir}
                value={config.outputDir}
                onChange={(val) =>
                  setConfig((prev) => ({ ...prev, outputDir: val }))
                }
                onBrowse={handleSelectOutputDir}
                helpText={t.help?.outputDir}
              />
            </div>
          </div>


          {/* Core Params Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Core Parameters
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <InputRow
                icon={Gauge}
                label={t.contextSize}
                value={config.contextSize}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    contextSize: parseInt(val) || undefined,
                  }))
                }
                type="number"
                step={1024}
                globalValue={globalCtx}
                helpText={t.help?.contextSize}
              />
              <InputRow
                icon={LayoutGrid}
                label={t.concurrency}
                value={config.concurrency}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    concurrency: parseInt(val) || undefined,
                  }))
                }
                type="number"
                min={1}
                max={8}
                globalValue={globalConcurrency}
                helpText={t.help?.concurrency}
              />
              <InputRow
                icon={Zap}
                label={t.temperature}
                value={config.temperature}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    temperature: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.1}
                min={0}
                max={2}
                globalValue={globalTemp}
                helpText={t.help?.temperature}
              />
              <InputRow
                icon={Cpu}
                label={t.gpuLayers}
                value={config.gpuLayers}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    gpuLayers: val === "" ? -1 : parseInt(val) || -1,
                  }))
                }
                type="number"
                globalValue={globalGpu}
                helpText={t.help?.gpuLayers}
              />
            </div>
          </div>

          <div className="h-px bg-border/50" />

          {/* Advanced Params Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Advanced Engine Tuning
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <InputRow
                icon={Scale}
                label={t.repPenaltyBase}
                value={config.repPenaltyBase}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    repPenaltyBase: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.01}
                globalValue={globalRepBase}
                helpText={t.help?.repPenaltyBase}
              />
              <InputRow
                icon={Scale}
                label={t.repPenaltyMax}
                value={config.repPenaltyMax}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    repPenaltyMax: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.01}
                globalValue={globalRepMax}
                helpText={t.help?.repPenaltyMax}
              />

              {/* KV Cache */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <MemoryStick className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.kvCacheType}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {t.currentGlobal}: {globalKvCache}
                  </span>
                </div>
                <select
                  value={
                    !config.useGlobalDefaults && config.kvCacheType
                      ? config.kvCacheType
                      : ""
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      kvCacheType: e.target.value || undefined,
                    }))
                  }
                  className={`
                                        w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                                        ${config.useGlobalDefaults
                      ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed"
                      : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                    }
                                    `}
                >
                  <option
                    value=""
                    disabled={!config.useGlobalDefaults && !config.kvCacheType}
                  >
                    {config.useGlobalDefaults ? globalKvCache : t.notSet}
                  </option>
                  <option value="f16">{t.kvOptions.f16}</option>
                  <option value="q8_0">{t.kvOptions.q8_0}</option>
                  <option value="q5_1">{t.kvOptions.q5_1}</option>
                  <option value="q4_0">{t.kvOptions.q4_0}</option>
                </select>
              </div>
            </div>

            {/* Seed Input */}
            <div className="grid grid-cols-2 gap-4">
              <InputRow
                icon={Sparkles}
                label={t.seed}
                value={config.seed}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    seed: val ? parseInt(val) : undefined,
                  }))
                }
                type="number"
                placeholder={
                  config.useGlobalDefaults ? globalSeed || "Random" : "Random"
                }
                globalValue={globalSeed}
                helpText={t.help?.seed}
              />
            </div>
          </div>

          <div className="h-px bg-border/50" />

          {/* Features Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Feature Toggles
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div
                className={`
                                flex items-center justify-between p-3 rounded-lg border transition-colors
                                ${config.useGlobalDefaults ? "bg-secondary/20 border-transparent opacity-60" : "bg-background/30 border-border"}
                            `}
              >
                <div className="flex items-center gap-2">
                  <AlignLeft
                    className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-indigo-500"}`}
                  />
                  <span
                    className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {t.alignmentMode}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">
                    {t.currentGlobal}: {globalAlignmentMode ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={
                      config.useGlobalDefaults
                        ? globalAlignmentMode
                        : (config.alignmentMode ?? globalAlignmentMode)
                    }
                    disabled={config.useGlobalDefaults}
                    onCheckedChange={(c) =>
                      setConfig((prev) => ({ ...prev, alignmentMode: c }))
                    }
                    className="scale-75"
                  />
                </div>
              </div>

              <div
                className={`
                                flex items-center justify-between p-3 rounded-lg border transition-colors
                                ${config.useGlobalDefaults ? "bg-secondary/20 border-transparent opacity-60" : "bg-background/30 border-border"}
                            `}
              >
                <div className="flex items-center gap-2">
                  <FileText
                    className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-amber-500"}`}
                  />
                  <span
                    className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {t.saveCot}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">
                    {t.currentGlobal}: {globalSaveCot ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={
                      config.useGlobalDefaults
                        ? globalSaveCot
                        : (config.saveCot ?? false)
                    }
                    disabled={config.useGlobalDefaults}
                    onCheckedChange={(c) =>
                      setConfig((prev) => ({ ...prev, saveCot: c }))
                    }
                    className="scale-75"
                  />
                </div>
              </div>
            </div>

            {/* Flash Attention (Full Width or Grid) */}
            <div
              className={`
                            flex items-center justify-between p-3 rounded-lg border transition-colors
                            ${config.useGlobalDefaults
                  ? "bg-secondary/20 border-transparent opacity-60"
                  : "bg-background/30 border-border"
                }
                        `}
            >
              <div className="flex items-center gap-2">
                <Zap
                  className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-amber-500"}`}
                />
                <span
                  className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {t.flashAttn}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">
                  {t.currentGlobal}: {globalFlashAttn ? "On" : "Off"}
                </span>
                <select
                  className={`
                                        h-8 text-sm rounded-md border outline-none
                                        ${config.useGlobalDefaults
                      ? "bg-transparent border-transparent text-muted-foreground cursor-not-allowed"
                      : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20"
                    }
                                    `}
                  value={
                    config.useGlobalDefaults
                      ? globalFlashAttn
                        ? "true"
                        : "false"
                      : config.flashAttn === undefined
                        ? "default"
                        : config.flashAttn
                          ? "true"
                          : "false"
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig((prev) => ({
                      ...prev,
                      flashAttn: val === "default" ? undefined : val === "true",
                    }));
                  }}
                >
                  <option value="default" disabled>
                    {t.notSet}
                  </option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between bg-secondary/10 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            {t.reset}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button variant="default" size="sm" onClick={() => onSave(config)}>
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {t.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Main Component ============
// (Keeping existing LibraryView but need to re-export it to render)
// Just copy the whole Main Component again to ensure consistency and imports match

export function LibraryView({
  lang,
  onNavigate,
  onProofreadFile,
  isRunning = false,
}: LibraryViewProps) {
  const t = texts[lang];
  const { alertProps, showConfirm } = useAlertModal();
  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_QUEUE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("[LibraryView] Load failed:", e);
    }

    // Migrate from legacy
    try {
      const legacy = localStorage.getItem(FILE_QUEUE_KEY);
      if (legacy) {
        const paths = JSON.parse(legacy) as string[];
        return paths.map((path) => ({
          id: generateId(),
          path,
          fileName: path.split(/[/\\]/).pop() || path,
          fileType: getFileType(path),
          addedAt: new Date().toISOString(),
          config: { useGlobalDefaults: true },
          status: "pending" as const,
        }));
      }
    } catch (e) {
      console.error("[LibraryView] Migration failed:", e);
    }

    return [];
  });

  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [configItem, setConfigItem] = useState<QueueItem | null>(null);
  const [scanSubdirs, setScanSubdirs] = useState(() => {
    const saved = localStorage.getItem("murasaki_scan_subdirs");
    return saved === "true";
  }); // Toggle for recursive scan
  const [isReordering, setIsReordering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(queue));
      localStorage.setItem(
        FILE_QUEUE_KEY,
        JSON.stringify(queue.map((q) => q.path)),
      );
    } catch (e) {
      console.error("[LibraryView] Save failed:", e);
    }
  }, [queue]);

  // Add files
  const addFiles = useCallback(
    (paths: string[]) => {
      const existingPaths = new Set(queue.map((q) => q.path));
      const newItems: QueueItem[] = [];

      for (const path of paths) {
        const ext = "." + path.split(".").pop()?.toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
        if (existingPaths.has(path)) continue;

        existingPaths.add(path);
        newItems.push({
          id: generateId(),
          path,
          fileName: path.split(/[/\\]/).pop() || path,
          fileType: getFileType(path),
          addedAt: new Date().toISOString(),
          config: { useGlobalDefaults: true },
          status: "pending",
        });
      }

      if (newItems.length > 0) setQueue((prev) => [...prev, ...newItems]);
    },
    [queue],
  );

  const handleAddFiles = async () => {
    if (isRunning) return;
    const files = await window.api?.selectFiles();
    if (files?.length) addFiles(files);
  };

  const handleAddFolder = async () => {
    if (isRunning) return;
    // Since window.api.selectFolderFiles assumes shallow or specific backend logic which we can't easily change from here without changing select-folder-files channel
    // Let's use selectDirectory to get path and then scanDirectory
    const path = await window.api?.selectFolder();
    if (path) {
      const files = await window.api?.scanDirectory(path, scanSubdirs);
      if (files && files.length > 0) {
        addFiles(files);
      }
    }
  };

  // Drag handlers
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRunning) return;

      // Only show overlay if dragging Files (not internal reorder)
      if (e.dataTransfer.types.includes("Files") && !isReordering) {
        setIsDragOver(true);
      }
    },
    [isReordering, isRunning],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRunning) {
        setIsDragOver(false);
        return;
      }

      setIsDragOver(false);

      const items = Array.from(e.dataTransfer.items);
      const paths: string[] = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && (file as any).path) {
            paths.push((file as any).path);
          }
        }
      }

      if (paths.length > 0) {
        const finalPaths: string[] = [];
        // Scan for folders using backend API to support recursion/filtering
        for (const p of paths) {
          try {
            const expanded = await window.api?.scanDirectory(p, scanSubdirs);
            if (expanded && expanded.length > 0) {
              finalPaths.push(...expanded);
            }
          } catch (e) {
            console.error("Scan failed for", p, e);
          }
        }
        if (finalPaths.length > 0) addFiles(finalPaths);
      }
    },
    [addFiles, scanSubdirs],
  );

  // Queue operations
  const handleRemove = useCallback(
    (id: string) => {
      if (isRunning) return;
      const item = queue.find((q) => q.id === id);
      if (!item) return;

      if (item.status === "completed") {
        setQueue((prev) => prev.filter((q) => q.id !== id));
        setSelectedItems((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        return;
      }

      showConfirm({
        title: lang === "zh" ? "确认移除" : "Confirm Remove",
        description:
          lang === "zh"
            ? "确定要从队列中移除此文件吗？"
            : "Are you sure you want to remove this file from the queue?",
        variant: "destructive",
        onConfirm: () => {
          setQueue((prev) => prev.filter((q) => q.id !== id));
          setSelectedItems((prev) => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        },
      });
    },
    [lang, showConfirm, isRunning, queue],
  );

  const handleClearCompleted = useCallback(() => {
    if (isRunning) return;
    const completedCount = queue.filter((q) => q.status === "completed").length;
    if (completedCount === 0) return;

    setQueue((prev) => prev.filter((q) => q.status !== "completed"));

    // Sync selection
    setSelectedItems((prev) => {
      const next = new Set<string>();
      // Need to know which IDs are NOT completed.
      // Better to just filter based on new queue, but we don't have new queue here easily in callback without recalc.
      // Queue is in dep array, so we can use it.
      queue.forEach((q) => {
        if (q.status !== "completed" && prev.has(q.id)) next.add(q.id);
      });
      return next;
    });

    window.api?.showNotification(
      "Murasaki Translator",
      lang === "zh"
        ? `已清理 ${completedCount} 个已完成任务`
        : `Cleared ${completedCount} completed tasks`,
    );
  }, [queue, isRunning, lang]);

  const handleRemoveSelected = useCallback(() => {
    if (isRunning) return;
    if (selectedItems.size === 0) return;
    showConfirm({
      title: lang === "zh" ? "确认移除已选" : "Confirm Remove Selected",
      description:
        lang === "zh"
          ? `确定要移除选中的 ${selectedItems.size} 个文件吗？`
          : `Are you sure you want to remove the ${selectedItems.size} selected files?`,
      variant: "destructive",
      onConfirm: () => {
        setQueue((prev) => prev.filter((q) => !selectedItems.has(q.id)));
        setSelectedItems(new Set());
      },
    });
  }, [selectedItems, lang, showConfirm, isRunning]);

  const handleMoveToTop = useCallback(
    (id: string) => {
      if (isRunning) return;
      setQueue((prev) => {
        const index = prev.findIndex((q) => q.id === id);
        if (index <= 0) return prev;
        const newQueue = [...prev];
        const [item] = newQueue.splice(index, 1);
        return [item, ...newQueue];
      });
    },
    [isRunning],
  );

  const handleClear = useCallback(() => {
    if (isRunning) return;
    showConfirm({
      title: t.clear,
      description: (t as any).confirmClear || "Confirm Clear Queue?",
      variant: "destructive",
      onConfirm: () => {
        setQueue([]);
        setSelectedItems(new Set());
      },
    });
  }, [t, showConfirm]);

  useEffect(() => {
    localStorage.setItem("murasaki_scan_subdirs", scanSubdirs.toString());
  }, [scanSubdirs]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedItems.size === queue.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(queue.map((q) => q.id)));
  }, [queue, selectedItems]);

  const handleInvertSelection = useCallback(() => {
    setSelectedItems((prev) => {
      const next = new Set<string>();
      queue.forEach((item) => {
        if (!prev.has(item.id)) next.add(item.id);
      });
      return next;
    });
  }, [queue]);

  // Drag reorder
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (isRunning) {
        e.preventDefault();
        return;
      }
      setIsReordering(true);
      e.dataTransfer.setData("text/plain", index.toString());
      e.dataTransfer.effectAllowed = "move";
      // Create a custom drag image or hide it if needed, but default is usually fine
    },
    [isRunning],
  );

  const handleDragEnd = useCallback(() => {
    setIsReordering(false);
    setIsDragOver(false);
  }, []);

  const handleReorderDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      const sourceIndexStr = e.dataTransfer.getData("text/plain");
      if (!sourceIndexStr) return;

      const sourceIndex = parseInt(sourceIndexStr);
      if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

      setQueue((prev) => {
        const newQueue = [...prev];
        const [removed] = newQueue.splice(sourceIndex, 1);
        newQueue.splice(targetIndex, 0, removed);
        return newQueue;
      });
    },
    [],
  );

  // Config save
  const handleSaveConfig = useCallback((itemId: string, config: FileConfig) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === itemId ? { ...q, config } : q)),
    );
    setConfigItem(null);
  }, []);

  const handleOpenBatchConfig = useCallback(() => {
    if (selectedItems.size === 0) return;

    // Use the first selected item's config as base or global defaults
    const firstId = Array.from(selectedItems)[0];
    const baseItem = queue.find((q) => q.id === firstId);
    if (!baseItem) return;

    // Open config modal with a virtual item representing the batch
    setConfigItem({
      ...baseItem,
      id: "batch", // Special ID to indicate batch mode
      fileName:
        lang === "zh"
          ? `批量配置 (${selectedItems.size} 个文件)`
          : `Batch Config (${selectedItems.size} files)`,
    });
  }, [selectedItems, queue, lang]);

  const handleBatchSave = useCallback(
    (config: FileConfig) => {
      setQueue((prev) =>
        prev.map((q) => (selectedItems.has(q.id) ? { ...q, config } : q)),
      );
      setConfigItem(null);
    },
    [selectedItems],
  );

  // Navigation
  // Navigation
  // Navigation
  // Navigation
  const handleProofread = useCallback(
    (item: QueueItem) => {
      let targetPath = "";

      // Strategy 1: Look up in Translation History (Source of Truth)
      try {
        const historyStr = localStorage.getItem("translation_history");
        if (historyStr) {
          const history = JSON.parse(historyStr);
          // Normalize item path for comparison
          const normItemPath = item.path.toLowerCase().replace(/[/\\]/g, "\\");

          // Find most recent matching record
          const match = history.find((h: any) => {
            const hPath = (h.filePath || h.inputPath || "")
              .toLowerCase()
              .replace(/[/\\]/g, "\\");
            return hPath === normItemPath;
          });

          if (match) {
            // Logic copied from ProofreadView: history record -> cache path
            if (match.cachePath) targetPath = match.cachePath;
            else if (match.outputPath)
              targetPath = match.outputPath + ".cache.json";
            else targetPath = match.filePath + ".cache.json";
          }
        }
      } catch (e) {
        console.error("History lookup failed", e);
      }

      // Strategy 2: Default Guess (Fallback if not in history)
      if (!targetPath) {
        let outputDir = item.config?.outputDir;
        if (!outputDir && item.config?.useGlobalDefaults) {
          outputDir = localStorage.getItem("config_output_dir") || undefined;
        }
        targetPath = getCachePath(item.path, outputDir);
      }

      console.log("[Proofread] Resolved target:", targetPath);

      // Direct navigation
      if (onProofreadFile) onProofreadFile(targetPath);
      else {
        localStorage.setItem("proofread_target_file", targetPath);
        onNavigate?.("proofread");
      }
    },
    [onNavigate, onProofreadFile],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 h-screen flex flex-col bg-background overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-8 py-6 border-b border-border/40 bg-background/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {t.title}
            </h1>
            {queue.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global Drop Overlay - Only show when dragging FILES from OS, not internal reordering */}
      {isDragOver && !isReordering && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-card p-12 rounded-2xl shadow-2xl border-2 border-primary/50 flex flex-col items-center gap-6 animate-in zoom-in-95 duration-200 max-w-lg w-full">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center ring-8 ring-primary/5">
              <FolderPlus className="w-12 h-12 text-primary animate-bounce" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-foreground">
                {(t as any).dropTitle || "释放以添加文件"}
              </h3>
              <p className="text-base text-muted-foreground">
                {(t as any).dropHint || "支持 .txt .epub .srt .ass 格式"}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              {["txt", "epub", "srt", "ass"].map((ext) => (
                <span
                  key={ext}
                  className="px-2.5 py-1 rounded-md bg-muted text-xs font-mono text-muted-foreground uppercase opacity-70"
                >
                  {ext}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-secondary/20 rounded-lg border border-border/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddFiles}
              disabled={isRunning}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t.selectFiles}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddFolder}
              disabled={isRunning}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <FolderPlus className="w-3.5 h-3.5 mr-1" />
              {t.selectFolder}
            </Button>

            <div className="w-px h-4 bg-border/40 mx-1" />

            <div className="flex items-center gap-2 px-1.5">
              <Switch
                checked={scanSubdirs}
                onCheckedChange={setScanSubdirs}
                className="scale-75 origin-left"
                id="scan-subdirs"
              />
              <label
                htmlFor="scan-subdirs"
                className="text-xs text-muted-foreground/80 hover:text-foreground cursor-pointer select-none whitespace-nowrap -ml-1 transition-colors"
              >
                {(t as any).scanSubdirs || "Scan Subdirs"}
              </label>
            </div>
            <div className="w-px h-4 bg-border/40 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenBatchConfig}
              className="h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none"
              disabled={selectedItems.size === 0}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              {selectedItems.size > 0
                ? `${t.batchConfig} (${selectedItems.size})`
                : t.batchConfig}
            </Button>
          </div>

          <div className="flex-1" />

          {queue.length > 0 && (
            <div className="flex items-center gap-1.5 p-1 bg-secondary/5 rounded-lg border border-border/10">
              {selectedItems.size > 0 && (
                <span className="h-7 px-2.5 flex items-center justify-center text-[11px] text-primary font-bold rounded-md bg-primary/10 border border-primary/20 min-w-[60px] text-center shadow-sm animate-in fade-in zoom-in duration-200">
                  {selectedItems.size} {lang === "zh" ? "已选" : "Selected"}
                </span>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {selectedItems.size === queue.length
                  ? lang === "zh"
                    ? "取消全选"
                    : "Deselect All"
                  : lang === "zh"
                    ? "全选"
                    : "Select All"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleInvertSelection}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {lang === "zh" ? "反选" : "Invert"}
              </Button>
              {selectedItems.size > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveSelected}
                  disabled={isRunning}
                  className={`h-7 text-[11px] font-medium text-red-500/80 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-md px-3 border-border/50 hover:border-red-500/30 ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  {t.remove}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {queue.some((i) => i.status === "completed") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearCompleted}
                      disabled={isRunning}
                      className={`h-7 text-[10px] font-bold text-green-600/60 hover:text-green-600 hover:bg-green-500/10 transition-all rounded-md px-2 border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Check className="w-3 h-3 mr-1 opacity-50" />
                      {lang === "zh" ? "清除已完成" : "Clear Completed"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={isRunning}
                    className={`h-7 text-[10px] font-bold text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-md px-2 border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Trash2 className="w-3 h-3 mr-1 opacity-50" />
                    {t.clear}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Queue Card */}
        <Card className="flex-1 flex flex-col overflow-hidden border-border/50 shadow-sm bg-card/30">
          {/* Queue Header - More minimal */}
          {queue.length > 0 && (
            <div className="px-4 py-2 border-b border-border/40 flex items-center justify-between shrink-0 bg-secondary/5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-2">
                  File Queue
                </span>
              </div>
            </div>
          )}

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto w-full relative">
            {queue.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 bg-gradient-to-b from-transparent to-primary/[0.02]">
                <div
                  className={`w-full max-w-2xl h-80 border-2 border-dashed border-primary/20 bg-primary/[0.03] rounded-[2rem] flex flex-col items-center justify-center gap-6 transition-all duration-500 group relative overflow-hidden ${isRunning ? "opacity-50 cursor-not-allowed" : "hover:border-primary/40 hover:bg-primary/[0.06] hover:shadow-2xl hover:shadow-primary/5 cursor-pointer"}`}
                  onClick={handleAddFiles}
                >
                  {/* Subtle background decoration */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/5 rounded-full -ml-16 -mb-16 blur-3xl" />

                  <div className="w-24 h-24 rounded-3xl bg-background shadow-sm border border-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 group-hover:border-primary/30 transition-all duration-500 shadow-primary/5">
                    <Plus className="w-10 h-10 text-primary/40 group-hover:text-primary transition-colors" />
                  </div>

                  <div className="text-center space-y-2 relative z-10">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">
                      {(t as any).dropTitle || "拖放文件到这里"}
                    </h3>
                    <p className="text-sm text-muted-foreground/70">
                      {(t as any).emptyDragHint || "或点击任意处浏览文件"}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2 mt-2 px-12 relative z-10">
                    {[".txt", ".epub", ".srt", ".ass"].map((ext) => (
                      <span
                        key={ext}
                        className="text-[10px] font-bold px-2 py-1 rounded-full bg-background border border-primary/10 text-muted-foreground/60 shadow-sm group-hover:border-primary/30 group-hover:text-primary/70 transition-all duration-500"
                      >
                        {ext}
                      </span>
                    ))}
                  </div>

                  {/* Hover hint */}
                  <div className="absolute bottom-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest">
                    <Sparkles className="w-3 h-3" />
                    Ready to Translate
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {queue.map((item, index) => (
                  <div
                    key={item.id}
                    className={`
                                            flex items-center gap-3 px-4 py-3 transition-all group
                                            ${selectedItems.has(item.id)
                        ? "bg-primary/5"
                        : "hover:bg-secondary/30"
                      }
                                        `}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => handleReorderDrop(e, index)}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleSelection(item.id)}
                      className="w-4 h-4 rounded border-border shrink-0 accent-primary"
                    />

                    {/* Drag Handle - Larger Hit Area */}
                    <div
                      className={`p-2 -m-1 rounded shrink-0 transition-colors ${isRunning ? "opacity-20 cursor-not-allowed" : "hover:bg-secondary cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-foreground"}`}
                      draggable={!isRunning}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>

                    {/* File Icon */}
                    <FileIcon type={item.fileType} />

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.fileName}
                      </p>
                      <div className="flex items-center gap-2">
                        <p
                          className="text-[11px] text-muted-foreground/60 truncate max-w-[300px]"
                          title={item.path}
                        >
                          {item.path}
                        </p>
                        {/* Status Badges */}
                        {item.config?.useGlobalDefaults === false && (
                          <span className="text-[9px] px-1.5 py-px rounded bg-purple-500/10 text-purple-500 font-medium">
                            Custom
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <UITooltip content={t.config}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => setConfigItem(item)}
                        >
                          <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                      </UITooltip>

                      <UITooltip content={t.proofread}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => handleProofread(item)}
                        >
                          <ClipboardCheck
                            className={`w-4 h-4 ${item.status === "completed" ? "text-primary" : "text-muted-foreground"} hover:text-primary transition-colors`}
                          />
                        </Button>
                      </UITooltip>

                      <UITooltip content={t.moveToTop}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => handleMoveToTop(item.id)}
                        >
                          <ArrowUp className="w-4 h-4 text-muted-foreground hover:text-primary" />
                        </Button>
                      </UITooltip>

                      <UITooltip content={lang === "zh" ? "移除" : "Remove"}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`w-8 h-8 focus-visible:ring-0 ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                          onClick={() => handleRemove(item.id)}
                          disabled={isRunning}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                        </Button>
                      </UITooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {configItem && (
          <FileConfigModal
            item={configItem}
            lang={lang}
            onSave={(config) =>
              configItem.id === "batch"
                ? handleBatchSave(config)
                : handleSaveConfig(configItem.id, config)
            }
            onClose={() => setConfigItem(null)}
          />
        )}
        <AlertModal {...alertProps} />
      </div>
    </div>
  );
}

export default LibraryView;
