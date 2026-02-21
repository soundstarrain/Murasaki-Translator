/**
 * LibraryView - 记忆库 / 队列管理中心
 * 提供: 队列管理、拖放导入、单文件自定义配置、直接跳转校对
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FolderOpen,
  FileText,
  Trash2,
  GripVertical,
  AlignLeft,
  Plus,
  FolderPlus,
  Eye,
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
  Layers,
  Search,
  Download,
  Upload,
} from "lucide-react";
import { Button, Card, Switch, Input, Tooltip as UITooltip } from "./ui/core";
import { FileIcon } from "./ui/FileIcon";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { Language } from "../lib/i18n";
import type { UseRemoteRuntimeResult } from "../hooks/useRemoteRuntime";
import {
  QueueItem,
  FileConfig,
  generateId,
  getFileType,
} from "../types/common";
import { buildQueueExport, parseQueueExport } from "../lib/queueExport";
import { formatGlobalValue } from "../lib/formatting";
import { APP_CONFIG } from "../lib/config";
import { emitToast } from "../lib/toast";
import {
  filterWatchFilesByTypes,
  isLikelyTranslatedOutput,
  normalizeWatchFolderConfig,
  type WatchFolderConfig,
} from "../lib/watchFolder";

// ============ Types ============

interface LibraryViewProps {
  lang: Language;
  onNavigate?: (view: string) => void;
  onProofreadFile?: (cachePath: string) => void;
  isRunning?: boolean;
  remoteRuntime?: UseRemoteRuntimeResult;
  globalEngineMode?: "v1" | "v2";
}

interface QueueImportPreview {
  items: QueueItem[];
  meta: {
    total: number;
    unsupported: number;
    duplicateInFile: number;
  };
}

// ============ Constants ============

const LIBRARY_QUEUE_KEY = "library_queue";
const FILE_QUEUE_KEY = "file_queue";
const WATCH_FOLDERS_KEY = "watch_folders";
const SUPPORTED_EXTENSIONS = [".txt", ".epub", ".srt", ".ass", ".ssa"];
const WATCH_FILE_TYPES = SUPPORTED_EXTENSIONS.map((ext) =>
  ext.replace(".", ""),
);

// ============ Helpers ============

const getModelNameFromPath = (modelPath?: string) => {
  const raw = String(modelPath || "").trim();
  if (!raw) return "";
  const name = raw.split(/[/\\]/).pop() || "";
  return name.replace(/\.gguf$/i, "");
};

function getCachePath(
  filePath: string,
  outputDir?: string,
  modelPath?: string,
  options?: { cacheDir?: string; engineMode?: "v1" | "v2" },
): string {
  // Handle both slash types correctly. lastIndexOf returns -1 if not found, checking both ensures we find the real separator.
  const lastSep = Math.max(
    filePath.lastIndexOf("\\"),
    filePath.lastIndexOf("/"),
  );
  const preferredDir = String(options?.cacheDir || "").trim();
  const dir = preferredDir
    ? preferredDir
    : outputDir
      ? outputDir
      : lastSep === -1
        ? "."
        : filePath.substring(0, lastSep);
  const baseName = filePath.substring(lastSep + 1).replace(/\.[^.]+$/, "");
  const extMatch = filePath.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0] : "";
  const modelName = getModelNameFromPath(modelPath);
  const mode = options?.engineMode === "v2" ? "v2" : "v1";
  const outputName =
    mode === "v2"
      ? `${baseName}_translated${ext}`
      : modelName
        ? `${baseName}_${modelName}${ext}`
        : `${baseName}${ext}`;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const joined =
    dir.endsWith("\\") || dir.endsWith("/")
      ? `${dir}${outputName}`
      : `${dir}${sep}${outputName}`;
  return `${joined}.cache.json`;
}

const resolveCachePathFromOutput = (
  outputPath: string,
  cacheDir?: string,
) => {
  if (!outputPath) return "";
  const dir = String(cacheDir || "").trim();
  if (!dir) return `${outputPath}.cache.json`;
  const fileName = outputPath.split(/[/\\]/).pop() || outputPath;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const prefix =
    dir.endsWith("\\") || dir.endsWith("/") ? dir : `${dir}${sep}`;
  return `${prefix}${fileName}.cache.json`;
};

// ============ Texts ============

const texts = {
  zh: {
    title: "翻译队列",
    subtitle: "批量处理队列，为每个文件指定独立参数",
    files: "个文件",
    dropHint: "拖放文件或文件夹到此处添加到队列",
    dropTitle: "拖放文件到这里",
    dropReleaseTitle: "释放以添加文件",
    emptyDragHint: "或点击任意处浏览文件",
    selectFiles: "选择文件",
    selectFolder: "选择文件夹",
    importQueue: "导入队列",
    exportQueue: "导出队列",
    watchFolder: "监控文件夹",
    watchFolderTitle: "监控文件夹",
    watchFolderDesc: "监控文件夹新增文件并自动加入队列",
    watchFolderBrowse: "选择文件夹",
    watchFolderAdd: "添加监控",
    watchFolderEmpty: "暂无监控文件夹",
    watchFolderIncludeSubdirs: "包含子目录",
    watchFolderEnabled: "启用",
    watchFolderTypes: "过滤格式",
    watchFolderTypesHint: "不选择则监控全部支持格式",
    watchFolderAllTypes: "全部",
    watchFolderPathRequired: "请选择要监控的文件夹",
    watchFolderDuplicate: "该文件夹已在监控列表中",
    watchFolderAddFail: "添加监控失败",
    watchFolderRemoveFail: "移除监控失败",
    watchFolderUpdateFail: "更新监控失败",
    watchFolderToggleFail: "启用或停用失败",
    watchNoticePrefix: "翻译监控: ",
    importQueueTitle: "导入队列",
    importQueueDesc: "请选择导入方式",
    importQueueMerge: "合并",
    importQueueReplace: "替换",
    importQueueSelectTitle: "选择队列文件",
    importQueueInvalid: "队列文件格式不正确",
    importQueueEmpty: "队列文件为空",
    importQueueSummary:
      "总计 {total} 项，新增 {added}，重复 {duplicate}，不支持 {unsupported}",
    importQueueApply: "应用",
    importQueueDone: "已导入 {count} 项",
    exportQueueDone: "队列已导出",
    exportQueueFail: "队列导出失败",
    scanSubdirs: "扫描子目录",
    confirmClear: "确定要清空翻译队列吗？",
    confirmRemoveTitle: "确认移除",
    confirmRemoveDesc: "确定要从队列中移除此文件吗？",
    confirmRemoveSelectedTitle: "确认移除已选",
    confirmRemoveSelectedDesc: "确定要移除选中的 {count} 个文件吗？",
    supportedTypes: "支持 .txt .epub .srt .ass .ssa",
    queueTitle: "翻译队列",
    emptyQueue: "队列为空",
    emptyHint: "拖放文件到上方区域，或点击按钮选择",
    readyToTranslate: "准备翻译",
    startAll: "开始翻译",
    clear: "清空全部",
    clearCompleted: "清除已完成",
    clearedCompletedNotice: "已清理 {count} 个已完成任务",
    selected: "已选",
    items: "项",
    remove: "移除",
    selectAll: "全选",
    deselectAll: "取消全选",
    invertSelection: "反选",
    default: "默认",
    custom: "自定义",
    proofread: "校对",
    config: "配置",
    configTitle: "文件翻译配置",
    batchConfig: "批量配置",
    batchConfigTitle: "批量配置 ({count} 个文件)",
    configDesc: "覆盖全局设置，为此文件指定独立参数",
    configWarning:
      "修改前请确保您了解正在修改的内容，错误的配置可能导致翻译过程异常或结果质量下降。",
    useGlobal: "使用全局默认配置",
    useGlobalDesc: "取消勾选以自定义此文件的翻译参数",
    followGlobal: "跟随全局",
    modelOverride: "模型选择",
    moveToTop: "置顶",
    dragToReorder: "拖拽调整顺序",
    addedNotice: "已添加 {count} 个文件",
    ignoredUnsupported: "已忽略 {count} 个不支持格式",
    ignoredDuplicate: "已跳过 {count} 个重复文件",
    ignoredTranslated: "已跳过 {count} 个已翻译文件",
    scanFailed: "扫描失败：{count} 个路径无法读取",
    noValidFiles: "未发现可导入的文件",
    busyHint: "翻译进行中，暂时无法修改队列",
    searchPlaceholder: "搜索文件名 / 路径",
    filterAll: "全部",
    filterPending: "待处理",
    filterCompleted: "已完成",
    filterFailed: "失败",
    noMatch: "没有匹配结果",

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
    anchorCheck: "核心锚点校验 (Anchor Check)",
    anchorCheckDesc:
      "在翻译 EPUB/SRT/ASS 以及辅助对齐模式的 TXT 文件的核心结构锚点缺失时自动重试。",
    anchorCheckRetries: "锚点重试次数 (Max)",
    sectionStrategy: "翻译策略",
    rulesProfileSection: "文本处理规则",
    sectionResources: "资源与输出",
    sectionCoreParams: "核心参数",
    sectionEngineTuning: "质量参数",
    sectionFeatureToggles: "功能开关",
    rulesPreProfile: "预处理配置组",
    rulesPostProfile: "后处理配置组",
    on: "开",
    off: "关",

    engineModeLocal: "本地翻译",
    engineModeApi: "API 翻译",
    apiPipeline: "翻译方案",
    apiPipelineHelp: "选择在 API 管理器中配置好的翻译方案",
    selectPipeline: "选择翻译方案...",
    noPipelines: "暂无方案，请先在 API 管理器中配置",

    save: "保存配置",
    cancel: "取消",
    browse: "浏览",
    reset: "重置",
    notSet: "未设置",
    masked: "已隐藏",
    unnamedProfile: "未命名配置",
    currentGlobal: "当前全局",
    seed: "随机种子 (Seed)",
    random: "随机",

    presetOptions: {
      novel: "轻小说模式 (默认)",
      script: "剧本模式",
      short: "单句模式",
    },
    shortModeWarning:
      "短句模式会导致翻译效率和质量下降，建议使用轻小说或剧本模式。",
    kvOptions: {
      f16: "F16 (原生质量)",
      q8_0: "Q8_0 (节约显存)",
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
      preset:
        "轻小说模式适合翻译轻小说和连贯性长文本；剧本模式适合 Galgame、动画字幕、漫画；单句模式适合对齐要求高的短句，但效率和效果会下降，不建议使用",
    },
  },
  en: {
    title: "Workbench",
    subtitle:
      "Batch process queue, specify independent parameters for each file",

    seed: "Seed",
    random: "Random",
    currentGlobal: "Global",
    files: "files",
    dropHint: "Drop files or folders here to add to queue",
    dropTitle: "Drag & Drop Files Here",
    dropReleaseTitle: "Release to add files",
    emptyDragHint: "Or click anywhere to browse",
    selectFiles: "Select Files",
    selectFolder: "Select Folder",
    importQueue: "Import Queue",
    exportQueue: "Export Queue",
    watchFolder: "Watch Folder",
    watchFolderTitle: "Watch Folders",
    watchFolderDesc: "Watch folders and auto-add new files to the queue",
    watchFolderBrowse: "Choose Folder",
    watchFolderAdd: "Add Watch",
    watchFolderEmpty: "No watched folders yet",
    watchFolderIncludeSubdirs: "Include Subfolders",
    watchFolderEnabled: "Enabled",
    watchFolderTypes: "File Types",
    watchFolderTypesHint: "Empty means all supported types",
    watchFolderAllTypes: "All",
    watchFolderPathRequired: "Please choose a folder to watch",
    watchFolderDuplicate: "This folder is already watched",
    watchFolderAddFail: "Failed to add watch",
    watchFolderRemoveFail: "Failed to remove watch",
    watchFolderUpdateFail: "Failed to update watch",
    watchFolderToggleFail: "Failed to toggle watch",
    watchNoticePrefix: "Watch: ",
    importQueueTitle: "Import Queue",
    importQueueDesc: "Choose how to import",
    importQueueMerge: "Merge",
    importQueueReplace: "Replace",
    importQueueSelectTitle: "Select queue file",
    importQueueInvalid: "Invalid queue file",
    importQueueEmpty: "Queue file is empty",
    importQueueSummary:
      "Total {total}, added {added}, duplicates {duplicate}, unsupported {unsupported}",
    importQueueApply: "Apply",
    importQueueDone: "Imported {count} items",
    exportQueueDone: "Queue exported",
    exportQueueFail: "Export failed",
    scanSubdirs: "Scan Subdirs",
    confirmClear: "Are you sure you want to clear the translation queue?",
    confirmRemoveTitle: "Confirm Remove",
    confirmRemoveDesc:
      "Are you sure you want to remove this file from the queue?",
    confirmRemoveSelectedTitle: "Confirm Remove Selected",
    confirmRemoveSelectedDesc:
      "Are you sure you want to remove the {count} selected files?",
    supportedTypes: "Supports .txt .epub .srt .ass .ssa",
    queueTitle: "Translation Queue",
    emptyQueue: "Queue is empty",
    emptyHint: "Drop files above, or click buttons to select",
    readyToTranslate: "Ready to Translate",
    startAll: "Start All",
    clear: "Clear",
    clearCompleted: "Clear Completed",
    clearedCompletedNotice: "Cleared {count} completed tasks",
    selected: "Selected",
    items: "items",
    remove: "Remove",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    invertSelection: "Invert",
    default: "Default",
    custom: "Custom",
    proofread: "Proofread",
    config: "Config",
    configTitle: "File Translation Config",
    batchConfig: "Batch Config",
    batchConfigTitle: "Batch Config ({count} files)",
    configDesc: "Override global settings with file-specific parameters",
    configWarning:
      "Please ensure you understand what you are modifying. Incorrect settings may cause translation errors or quality degradation.",
    useGlobal: "Use Global Defaults",
    useGlobalDesc: "Uncheck to customize parameters for this file",
    followGlobal: "Use Global",
    modelOverride: "Model Override",
    moveToTop: "Top",
    dragToReorder: "Drag to reorder",
    addedNotice: "Added {count} files",
    ignoredUnsupported: "Ignored {count} unsupported files",
    ignoredDuplicate: "Skipped {count} duplicate files",
    ignoredTranslated: "Skipped {count} translated outputs",
    scanFailed: "Scan failed: {count} paths could not be read",
    noValidFiles: "No importable files found",
    busyHint: "Translation is running. Queue is locked.",
    searchPlaceholder: "Search name / path",
    filterAll: "All",
    filterPending: "Pending",
    filterCompleted: "Completed",
    filterFailed: "Failed",
    noMatch: "No matches",

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
    anchorCheck: "Anchor Check",
    anchorCheckDesc:
      "Auto-retry when key anchors are missing in EPUB/SRT/ASS or alignment-mode TXT.",
    anchorCheckRetries: "Anchor Retry Limit",
    sectionStrategy: "Strategy & Model",
    rulesProfileSection: "Rule Profiles",
    sectionResources: "Resources & Output",
    sectionCoreParams: "Core Parameters",
    sectionEngineTuning: "Engine Tuning",
    sectionFeatureToggles: "Feature Toggles",
    rulesPreProfile: "Pre-process Profile",
    rulesPostProfile: "Post-process Profile",
    on: "On",
    off: "Off",

    engineModeLocal: "Local Translation",
    engineModeApi: "API Translation",
    apiPipeline: "Translation Plan",
    apiPipelineHelp: "Select a plan configured in API Manager",
    selectPipeline: "Select a plan...",
    noPipelines: "No plans yet. Configure one in API Manager first.",

    save: "Save Config",
    cancel: "Cancel",
    browse: "Browse",
    reset: "Reset",

    notSet: "Not set",
    masked: "Hidden",
    unnamedProfile: "Untitled profile",

    presetOptions: {
      novel: "Novel Mode (Default)",
      script: "Script Mode (Galgame)",
      short: "Short Mode",
    },
    shortModeWarning:
      "Short mode is only for isolated sentences. Use Novel or Script mode for documents.",
    kvOptions: {
      f16: "F16 (Native Quality)",
      q8_0: "Q8_0 (VRAM Saver)",
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
      preset:
        "Novel mode for all novels and coherent long texts; Script mode for Galgame, anime subtitles, manga; Short mode for sentences requiring strict alignment, but efficiency and quality will decrease (not recommended)",
    },
  },
  jp: {
    title: "ライブラリ",
    subtitle: "キューを一括処理し、ファイルごとに個別のパラメータを指定",

    seed: "シード (Seed)",
    random: "ランダム",
    currentGlobal: "現在のグローバル値",
    files: "ファイル",
    dropHint: "ファイルまたはフォルダをドロップして追加",
    dropTitle: "ファイルをここにドロップ",
    dropReleaseTitle: "ドロップして追加",
    emptyDragHint: "またはクリックして選択",
    selectFiles: "ファイル選択",
    selectFolder: "フォルダ選択",
    importQueue: "キューをインポート",
    exportQueue: "キューをエクスポート",
    watchFolder: "フォルダ監視",
    watchFolderTitle: "フォルダ監視",
    watchFolderDesc: "監視フォルダの新規ファイルを自動でキューに追加",
    watchFolderBrowse: "フォルダ選択",
    watchFolderAdd: "監視を追加",
    watchFolderEmpty: "監視フォルダはありません",
    watchFolderIncludeSubdirs: "サブフォルダを含む",
    watchFolderEnabled: "有効",
    watchFolderTypes: "ファイル種別",
    watchFolderTypesHint: "未選択は全ての対応形式",
    watchFolderAllTypes: "全て",
    watchFolderPathRequired: "監視するフォルダを選択してください",
    watchFolderDuplicate: "このフォルダは既に監視中です",
    watchFolderAddFail: "監視の追加に失敗しました",
    watchFolderRemoveFail: "監視の削除に失敗しました",
    watchFolderUpdateFail: "監視の更新に失敗しました",
    watchFolderToggleFail: "監視の切替に失敗しました",
    watchNoticePrefix: "翻訳監視: ",
    importQueueTitle: "キューをインポート",
    importQueueDesc: "取り込み方法を選択",
    importQueueMerge: "統合",
    importQueueReplace: "置き換え",
    importQueueSelectTitle: "キューファイルを選択",
    importQueueInvalid: "無効なキューファイル",
    importQueueEmpty: "キューが空です",
    importQueueSummary:
      "合計 {total} 件、追加 {added}、重複 {duplicate}、非対応 {unsupported}",
    importQueueApply: "適用",
    importQueueDone: "{count} 件をインポートしました",
    exportQueueDone: "キューをエクスポートしました",
    exportQueueFail: "エクスポートに失敗しました",
    scanSubdirs: "サブディレクトリをスキャン",
    confirmClear: "翻訳キューを空にしてもよろしいですか？",
    confirmRemoveTitle: "削除確認",
    confirmRemoveDesc: "このファイルをキューから削除しますか？",
    confirmRemoveSelectedTitle: "選択削除の確認",
    confirmRemoveSelectedDesc: "選択した {count} 件のファイルを削除しますか？",
    supportedTypes: ".txt .epub .srt .ass .ssa に対応",
    queueTitle: "翻訳キュー",
    emptyQueue: "キューが空です",
    emptyHint: "上にファイルをドロップ、またはボタンで選択",
    readyToTranslate: "翻訳準備完了",
    startAll: "翻訳開始",
    clear: "クリア",
    clearCompleted: "完了をクリア",
    clearedCompletedNotice: "完了タスク {count} 件をクリアしました",
    selected: "選択中",
    items: "件",
    remove: "削除",
    selectAll: "すべて選択",
    deselectAll: "選択解除",
    invertSelection: "反転",
    default: "デフォルト",
    custom: "カスタム",
    proofread: "校正",
    config: "設定",
    configTitle: "ファイル翻訳設定",
    batchConfig: "一括設定",
    batchConfigTitle: "一括設定 ({count} 件)",
    configDesc: "グローバル設定を上書きして個別パラメータを指定",
    configWarning:
      "変更前に内容を理解していることを確認してください。誤った設定は翻訳の異常や品質低下につながる可能性があります。",
    useGlobal: "グローバルデフォルトを使用",
    useGlobalDesc: "チェックを外すとこのファイルのパラメータをカスタマイズ",
    followGlobal: "グローバルに従う",
    modelOverride: "モデル上書き",
    moveToTop: "トップ",
    dragToReorder: "ドラッグして並べ替え",
    addedNotice: "{count} 件のファイルを追加しました",
    ignoredUnsupported: "対応外形式 {count} 件を無視しました",
    ignoredDuplicate: "重複 {count} 件をスキップしました",
    ignoredTranslated: "翻訳済み {count} 件をスキップしました",
    scanFailed: "スキャン失敗：{count} 件のパスを読み込めませんでした",
    noValidFiles: "追加可能なファイルが見つかりません",
    busyHint: "翻訳中のためキューを変更できません",
    searchPlaceholder: "ファイル名 / パスを検索",
    filterAll: "すべて",
    filterPending: "保留",
    filterCompleted: "完了",
    filterFailed: "失敗",
    noMatch: "一致する項目がありません",

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
    anchorCheck: "アンカーチェック",
    anchorCheckDesc: "EPUB/SRT/ASS/整列TXTの重要アンカー欠落時に自動再試行。",
    anchorCheckRetries: "アンカー再試行回数",
    sectionStrategy: "翻訳方針とモデル",
    rulesProfileSection: "ルール設定",
    sectionResources: "リソースと出力",
    sectionCoreParams: "コアパラメータ",
    sectionEngineTuning: "エンジン調整",
    sectionFeatureToggles: "機能スイッチ",
    rulesPreProfile: "前処理プロファイル",
    rulesPostProfile: "後処理プロファイル",
    on: "オン",
    off: "オフ",

    engineModeLocal: "ローカル翻訳",
    engineModeApi: "API翻訳",
    apiPipeline: "翻訳プラン",
    apiPipelineHelp: "APIマネージャーで設定したプランを選択",
    selectPipeline: "プランを選択...",
    noPipelines: "プランがありません。APIマネージャーで設定してください。",

    save: "設定を保存",
    cancel: "キャンセル",
    browse: "参照",
    reset: "リセット",

    notSet: "未設定",
    masked: "非表示",
    unnamedProfile: "名称未設定",

    presetOptions: {
      novel: "小説モード (デフォルト)",
      script: "スクリプトモード (ギャルゲー)",
      short: "短文モード",
    },
    shortModeWarning:
      "短文モードは単文向けです。ドキュメントには小説またはスクリプトモードを推奨します。",
    kvOptions: {
      f16: "F16 (ネイティブ品質)",
      q8_0: "Q8_0 (VRAM節約)",
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
      preset:
        "小説モードは全ての小説と長文向け、スクリプトモードはギャルゲー・アニメ字幕・漫画向け、短文モードはアライメント重視の短文向けですが効率と品質が低下するため非推奨",
    },
  },
};

// ============ FileConfigModal ============

interface FileConfigModalProps {
  item: QueueItem;
  lang: Language;
  onSave: (config: FileConfig) => void;
  onClose: () => void;
  remoteRuntime?: UseRemoteRuntimeResult;
  globalEngineMode?: "v1" | "v2";
  v2Profiles?: Array<{ id: string; name: string; providerName?: string }>;
}

interface RemoteModelInfo {
  name: string;
  path: string;
  sizeGb?: number;
}

interface RuleProfileSummary {
  id: string;
  name: string;
}

export function FileConfigModal({
  item,
  lang,
  onSave,
  onClose,
  remoteRuntime,
  globalEngineMode,
  v2Profiles = [],
}: FileConfigModalProps) {
  const t = texts[lang];
  const [config, setConfig] = useState<FileConfig>({ ...item.config });
  const fileEngineMode = config.engineMode || globalEngineMode || "v1";
  const isApiMode = fileEngineMode === "v2";
  const isRemoteMode = Boolean(remoteRuntime?.isRemoteMode);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableRemoteModels, setAvailableRemoteModels] = useState<
    RemoteModelInfo[]
  >([]);
  const [preProfiles, setPreProfiles] = useState<RuleProfileSummary[]>([]);
  const [postProfiles, setPostProfiles] = useState<RuleProfileSummary[]>([]);

  const loadRuleProfiles = (mode: "pre" | "post") => {
    try {
      const raw = localStorage.getItem(`config_rules_${mode}_profiles`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((profile) => ({
          id: String(profile?.id || ""),
          name: String(profile?.name || t.unnamedProfile),
        }))
        .filter((profile) => profile.id);
    } catch {
      return [];
    }
  };

  // Get global defaults for display
  const globalGlossary = localStorage.getItem("config_glossary_path") || "";
  const globalOutputDir = localStorage.getItem("config_output_dir") || "";
  const globalCtx = localStorage.getItem("config_ctx") || "4096";
  const globalConcurrency = localStorage.getItem("config_concurrency") || "1";
  const globalTemp = localStorage.getItem("config_temperature") || "0.7";
  const globalGpu = localStorage.getItem("config_gpu") || "-1";
  const globalPreset = localStorage.getItem("config_preset") || "novel";
  const globalModel = isRemoteMode
    ? localStorage.getItem("config_remote_model") || ""
    : localStorage.getItem("config_model") || "";
  const globalRepBase =
    localStorage.getItem("config_rep_penalty_base") || "1.0";
  const globalRepMax = localStorage.getItem("config_rep_penalty_max") || "1.5";
  const globalFlashAttn = localStorage.getItem("config_flash_attn") !== "false";
  const globalKvCache = localStorage.getItem("config_kv_cache_type") || "f16";
  const globalSeed = localStorage.getItem("config_seed") || "";
  const globalAlignmentMode =
    localStorage.getItem("config_alignment_mode") === "true";
  const globalSaveCot = localStorage.getItem("config_save_cot") === "true";
  const globalPreProfileId =
    localStorage.getItem("config_rules_pre_active_profile") || "";
  const globalPostProfileId =
    localStorage.getItem("config_rules_post_active_profile") || "";

  useEffect(() => {
    setPreProfiles(loadRuleProfiles("pre"));
    setPostProfiles(loadRuleProfiles("post"));
  }, []);

  const globalPreProfileName =
    preProfiles.find((profile) => profile.id === globalPreProfileId)?.name ||
    t.notSet;
  const globalPostProfileName =
    postProfiles.find((profile) => profile.id === globalPostProfileId)?.name ||
    t.notSet;

  useEffect(() => {
    let alive = true;
    const loadModels = async () => {
      if (isRemoteMode) {
        try {
          // @ts-ignore
          const result = await window.api?.remoteModels?.();
          if (!alive) return;
          if (result?.ok && Array.isArray(result.data)) {
            const mapped = result.data
              .map((item: any) => ({
                name: item?.name || item?.path?.split(/[/\\]/).pop() || "",
                path: item?.path || item?.name || "",
                sizeGb: item?.sizeGb ?? item?.size_gb ?? item?.size,
              }))
              .filter((item: RemoteModelInfo) => item.path);
            setAvailableRemoteModels(mapped);
          } else {
            setAvailableRemoteModels([]);
          }
        } catch {
          if (!alive) return;
          setAvailableRemoteModels([]);
        }
        setAvailableModels([]);
      } else {
        window.api
          ?.getModels?.()
          .then((models) => {
            if (!alive || !Array.isArray(models)) return;
            setAvailableModels(models);
          })
          .catch(() => {
            if (!alive) return;
            setAvailableModels([]);
          });
        setAvailableRemoteModels([]);
      }
    };
    loadModels();
    return () => {
      alive = false;
    };
  }, [isRemoteMode]);

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
    type?: "text" | "number" | "password";
    min?: number;
    max?: number;
    step?: number;
    globalValue?: string | number;
    helpText?: string;
    className?: string;
  }) => {
    const displayGlobalValue = formatGlobalValue(globalValue, t.notSet);
    const resolvedPlaceholder = config.useGlobalDefaults
      ? displayGlobalValue
      : (placeholder ?? t.notSet);

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
            placeholder={resolvedPlaceholder}
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
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-secondary/30 shrink-0">
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

            {/* Right: useGlobal toggle (local only) + Close */}
            <div className="flex items-center gap-3 shrink-0">
              {!isApiMode && (
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
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Engine Mode Switcher */}
          <div className="flex mt-3 bg-secondary/40 rounded-lg p-0.5 gap-0.5">
            {(["v1", "v2"] as const).map((mode) => {
              const active = fileEngineMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      engineMode: mode,
                      // API 模式下自动关闭 useGlobalDefaults
                      ...(mode === "v2" ? { useGlobalDefaults: false } : {}),
                    }))
                  }
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all ${active
                    ? "bg-background text-foreground shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {mode === "v1" ? t.engineModeLocal : t.engineModeApi}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* === API Mode: Pipeline Selector === */}
          {isApiMode && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t.apiPipeline}
              </h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-1.5 text-foreground">
                    <Zap className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.apiPipeline}
                    <UITooltip content={t.apiPipelineHelp}>
                      <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
                    </UITooltip>
                  </label>
                </div>
                {v2Profiles.length > 0 ? (
                  <select
                    value={config.v2PipelineId || ""}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        v2PipelineId: e.target.value || undefined,
                      }))
                    }
                    className="w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                  >
                    <option value="">{t.selectPipeline}</option>
                    {v2Profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.providerName ? ` (${p.providerName})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground/70 italic py-2">
                    {t.noPipelines}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Warning Banner (local mode only) */}
          {!isApiMode && !config.useGlobalDefaults && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {t.configWarning}
              </p>
            </div>
          )}

          {/* Strategy Section (local mode only) */}
          {!isApiMode && (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t.sectionStrategy}
              </h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <Settings className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.preset}
                    <UITooltip content={t.help?.preset}>
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
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <Cpu className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.modelOverride}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {t.currentGlobal}:{" "}
                    {globalModel ? globalModel.split(/[/\\]/).pop() : t.notSet}
                  </span>
                </div>
                <select
                  value={
                    config.useGlobalDefaults
                      ? ""
                      : (isRemoteMode ? config.remoteModel : config.model) || ""
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      ...(isRemoteMode
                        ? { remoteModel: e.target.value || undefined }
                        : { model: e.target.value || undefined }),
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
                  <option value="">
                    {config.useGlobalDefaults
                      ? globalModel
                        ? globalModel.split(/[/\\]/).pop()
                        : t.notSet
                      : t.followGlobal}
                  </option>
                  {isRemoteMode
                    ? availableRemoteModels.map((model) => (
                      <option key={model.path} value={model.path}>
                        {model.name || model.path}
                      </option>
                    ))
                    : availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model.replace(".gguf", "")}
                      </option>
                    ))}
                </select>
              </div>

              {!config.useGlobalDefaults && config.preset === "short" && (
                <div className="flex items-start gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                    {t.shortModeWarning}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 1.5 Rule Profile Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t.rulesProfileSection}
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.rulesPreProfile}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {t.currentGlobal}: {globalPreProfileName}
                  </span>
                </div>
                <select
                  value={
                    !config.useGlobalDefaults && config.rulesPreProfileId
                      ? config.rulesPreProfileId
                      : ""
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      rulesPreProfileId: e.target.value || undefined,
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
                  <option value="">
                    {config.useGlobalDefaults
                      ? globalPreProfileName
                      : t.followGlobal}
                  </option>
                  {preProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.rulesPostProfile}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {t.currentGlobal}: {globalPostProfileName}
                  </span>
                </div>
                <select
                  value={
                    !config.useGlobalDefaults && config.rulesPostProfileId
                      ? config.rulesPostProfileId
                      : ""
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      rulesPostProfileId: e.target.value || undefined,
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
                  <option value="">
                    {config.useGlobalDefaults
                      ? globalPostProfileName
                      : t.followGlobal}
                  </option>
                  {postProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Paths Section - 术语表和输出目录 */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t.sectionResources}
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
                globalValue={globalOutputDir}
                helpText={t.help?.outputDir}
              />
            </div>
          </div>

          {/* Core Params + Engine Tuning + Features (local mode only) */}
          {!isApiMode && (<>
            <div className="h-px bg-border/50" />

            {/* Core Params Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t.sectionCoreParams}
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
                {t.sectionEngineTuning}
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

                {/* Seed Input */}
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
                  placeholder={t.random}
                  globalValue={globalSeed || t.random}
                  helpText={t.help?.seed}
                />

                {/* Flash Attention */}
                <div
                  className={`
                  col-span-2 flex items-center justify-between p-3 rounded-lg border transition-colors
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
                      {t.currentGlobal}: {globalFlashAttn ? t.on : t.off}
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
                          flashAttn:
                            val === "default" ? undefined : val === "true",
                        }));
                      }}
                    >
                      <option value="default" disabled>
                        {t.notSet}
                      </option>
                      <option value="true">{t.on}</option>
                      <option value="false">{t.off}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-border/50" />

            {/* Features Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t.sectionFeatureToggles}
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
                      {t.currentGlobal}: {globalAlignmentMode ? t.on : t.off}
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
                      {t.currentGlobal}: {globalSaveCot ? t.on : t.off}
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
            </div>
          </>)}
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
    </div >
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
  remoteRuntime,
  globalEngineMode,
}: LibraryViewProps) {
  const t = texts[lang];
  const { alertProps, showConfirm } = useAlertModal();
  const [notice, setNotice] = useState<{
    type: "info" | "warning" | "error" | "success";
    message: string;
  } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "completed" | "failed"
  >("all");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<QueueImportPreview | null>(
    null,
  );
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [watchFolders, setWatchFolders] = useState<WatchFolderConfig[]>(() => {
    try {
      const saved = localStorage.getItem(WATCH_FOLDERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WatchFolderConfig[];
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => normalizeWatchFolderConfig(entry));
        }
      }
    } catch (e) {
      console.error("[LibraryView] Watch folders load failed:", e);
    }
    return [];
  });
  const createWatchDraft = (): WatchFolderConfig => ({
    id: generateId(),
    path: "",
    includeSubdirs: false,
    fileTypes: [],
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  const [watchDraft, setWatchDraft] =
    useState<WatchFolderConfig>(createWatchDraft);
  const [knownModelNames, setKnownModelNames] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const pushNotice = useCallback(
    (next: {
      type: "info" | "warning" | "error" | "success";
      message: string;
    }) => {
      setNotice(next);
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      noticeTimerRef.current = setTimeout(() => setNotice(null), 4200);
    },
    [],
  );
  const watchNoticePrefix = t.watchNoticePrefix;
  const pushWatchNotice = useCallback(
    (next: {
      type: "info" | "warning" | "error" | "success";
      message: string;
    }) =>
      pushNotice({
        ...next,
        message: `${watchNoticePrefix}${next.message}`,
      }),
    [pushNotice, watchNoticePrefix],
  );

  const filteredQueue = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    return queue.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        item.fileName.toLowerCase().includes(keyword) ||
        item.path.toLowerCase().includes(keyword)
      );
    });
  }, [queue, searchQuery, statusFilter]);

  const importSummary = useMemo(() => {
    if (!importPreview) return null;
    const existing = new Set(queue.map((item) => item.path));
    const duplicateExisting = importPreview.items.filter((item) =>
      existing.has(item.path),
    ).length;
    const added =
      importMode === "replace"
        ? importPreview.items.length
        : importPreview.items.length - duplicateExisting;
    const duplicate =
      importPreview.meta.duplicateInFile +
      (importMode === "merge" ? duplicateExisting : 0);
    return {
      total: importPreview.meta.total,
      added,
      duplicate,
      unsupported: importPreview.meta.unsupported,
    };
  }, [importMode, importPreview, queue]);

  const isFilterActive =
    statusFilter !== "all" || searchQuery.trim().length > 0;

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadModelNames = async () => {
      const names = new Set<string>();
      const addName = (value: string | null | undefined) => {
        const name = getModelNameFromPath(value || "");
        if (name) names.add(name);
      };
      addName(localStorage.getItem("config_model"));
      addName(localStorage.getItem("config_remote_model"));
      try {
        const models = await window.api?.getModels?.();
        if (Array.isArray(models)) {
          models.forEach((model) => addName(model));
        }
      } catch {
        // ignore
      }
      if (!alive) return;
      setKnownModelNames(Array.from(names));
    };
    void loadModelNames();
    return () => {
      alive = false;
    };
  }, []);

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

  useEffect(() => {
    try {
      localStorage.setItem(WATCH_FOLDERS_KEY, JSON.stringify(watchFolders));
    } catch (e) {
      console.error("[LibraryView] Watch folders save failed:", e);
    }
  }, [watchFolders]);

  useEffect(() => {
    if (!window.api?.watchFolderAdd) return;
    let cancelled = false;
    const bootstrapWatchFolders = async () => {
      watchFolders.forEach((entry) => {
        void window.api.watchFolderAdd(entry);
      });

      if (!window.api?.scanDirectory) return;
      const targets = watchFolders.filter(
        (entry) => entry.enabled && entry.path,
      );
      if (targets.length === 0) return;

      try {
        const results = await Promise.all(
          targets.map(async (entry) => {
            const files = await window.api!.scanDirectory(
              entry.path,
              entry.includeSubdirs,
            );
            return filterWatchFilesByTypes(
              files || [],
              entry.fileTypes,
              SUPPORTED_EXTENSIONS,
            );
          }),
        );
        if (cancelled) return;
        const merged = Array.from(new Set(results.flat()));
        addFiles(merged, { source: "watch" });
      } catch (e) {
        if (cancelled) return;
        console.error("[LibraryView] Watch folders initial scan failed:", e);
        pushWatchNotice({
          type: "error",
          message: t.scanFailed.replace("{count}", String(targets.length)),
        });
      }
    };
    void bootstrapWatchFolders();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildModelNamesForFilter = useCallback(() => {
    const names = new Set<string>();
    const addName = (value: string | null | undefined) => {
      const name = getModelNameFromPath(value || "");
      if (name) names.add(name);
    };
    addName(localStorage.getItem("config_model"));
    addName(localStorage.getItem("config_remote_model"));
    knownModelNames.forEach((name) => addName(name));
    return Array.from(names);
  }, [knownModelNames]);

  // Add files
  const addFiles = useCallback(
    (paths: string[], options?: { source?: "manual" | "watch" }) => {
      const existingPaths = new Set(queue.map((q) => q.path));
      const newItems: QueueItem[] = [];
      let skippedUnsupported = 0;
      let skippedDuplicate = 0;
      let skippedTranslated = 0;
      const modelNames = buildModelNamesForFilter();

      for (const path of paths) {
        const ext = "." + path.split(".").pop()?.toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          skippedUnsupported += 1;
          continue;
        }
        if (isLikelyTranslatedOutput(path, modelNames, SUPPORTED_EXTENSIONS)) {
          skippedTranslated += 1;
          continue;
        }
        if (existingPaths.has(path)) {
          skippedDuplicate += 1;
          continue;
        }

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

      if (newItems.length > 0) {
        setQueue((prev) => [...prev, ...newItems]);
      }

      const prefix = options?.source === "watch" ? watchNoticePrefix : "";
      const messages: string[] = [];
      if (newItems.length > 0) {
        messages.push(
          t.addedNotice.replace("{count}", String(newItems.length)),
        );
      }
      if (skippedTranslated > 0) {
        messages.push(
          t.ignoredTranslated.replace("{count}", String(skippedTranslated)),
        );
      }
      if (skippedUnsupported > 0) {
        messages.push(
          t.ignoredUnsupported.replace("{count}", String(skippedUnsupported)),
        );
      }
      if (skippedDuplicate > 0) {
        messages.push(
          t.ignoredDuplicate.replace("{count}", String(skippedDuplicate)),
        );
      }

      if (messages.length > 0) {
        const type =
          skippedUnsupported > 0 ||
            skippedDuplicate > 0 ||
            skippedTranslated > 0
            ? "warning"
            : "success";
        pushNotice({ type, message: `${prefix}${messages.join("，")}` });
      } else {
        pushNotice({
          type: "info",
          message: `${prefix}${t.noValidFiles}`,
        });
      }
    },
    [queue, pushNotice, t, watchNoticePrefix, buildModelNamesForFilter],
  );

  useEffect(() => {
    const unsubscribe = window.api?.onWatchFolderFileAdded?.((payload) => {
      if (!payload?.path) return;
      addFiles([payload.path], { source: "watch" });
    });
    return () => {
      unsubscribe?.();
    };
  }, [addFiles]);

  const handleAddFiles = async () => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
    const files = await window.api?.selectFiles();
    if (files?.length) {
      addFiles(files, { source: "manual" });
    } else {
      pushNotice({ type: "info", message: t.noValidFiles });
    }
  };

  const handleAddFolder = async () => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
    // Since window.api.selectFolderFiles assumes shallow or specific backend logic which we can't easily change from here without changing select-folder-files channel
    // Let's use selectDirectory to get path and then scanDirectory
    const path = await window.api?.selectFolder();
    if (path) {
      try {
        const files = await window.api?.scanDirectory(path, scanSubdirs);
        if (files && files.length > 0) {
          addFiles(files, { source: "manual" });
        } else {
          pushNotice({ type: "info", message: t.noValidFiles });
        }
      } catch (e) {
        console.error("Scan failed for", path, e);
        pushNotice({
          type: "error",
          message: t.scanFailed.replace("{count}", "1"),
        });
      }
    }
  };

  const handleSelectWatchFolder = async () => {
    const path = await window.api?.selectFolder?.({
      title: t.watchFolderTitle,
    });
    if (!path) return;
    setWatchDraft((prev) => ({ ...prev, path }));
  };

  const toggleWatchDraftType = (type: string) => {
    setWatchDraft((prev) => {
      const normalized = type.toLowerCase();
      const exists = prev.fileTypes.includes(normalized);
      const nextTypes = exists
        ? prev.fileTypes.filter((t) => t !== normalized)
        : [...prev.fileTypes, normalized];
      return { ...prev, fileTypes: nextTypes };
    });
  };

  const applyWatchFolderUpdate = async (
    id: string,
    update: Partial<WatchFolderConfig>,
  ) => {
    const current = watchFolders.find((entry) => entry.id === id);
    if (!current) return;
    const next = normalizeWatchFolderConfig({
      ...current,
      ...update,
      fileTypes: update.fileTypes ?? current.fileTypes,
    });
    const result = await window.api?.watchFolderAdd?.(next);
    if (!result?.ok) {
      pushWatchNotice({
        type: "error",
        message: result?.error || t.watchFolderUpdateFail,
      });
      return;
    }
    setWatchFolders((prev) =>
      prev.map((entry) => (entry.id === id ? next : entry)),
    );
  };

  const handleToggleWatchFolder = async (id: string, enabled: boolean) => {
    const result = await window.api?.watchFolderToggle?.(id, enabled);
    if (!result?.ok) {
      pushWatchNotice({
        type: "error",
        message: result?.error || t.watchFolderToggleFail,
      });
      return;
    }
    setWatchFolders((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)),
    );
  };

  const handleRemoveWatchFolder = async (id: string) => {
    const result = await window.api?.watchFolderRemove?.(id);
    if (!result?.ok) {
      pushWatchNotice({
        type: "error",
        message: result?.error || t.watchFolderRemoveFail,
      });
      return;
    }
    setWatchFolders((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleAddWatchFolder = async () => {
    const path = watchDraft.path.trim();
    if (!path) {
      pushWatchNotice({ type: "warning", message: t.watchFolderPathRequired });
      return;
    }
    if (watchFolders.some((entry) => entry.path === path)) {
      pushWatchNotice({ type: "warning", message: t.watchFolderDuplicate });
      return;
    }
    const entry = normalizeWatchFolderConfig({
      ...watchDraft,
      path,
      fileTypes: watchDraft.fileTypes,
    });
    const result = await window.api?.watchFolderAdd?.(entry);
    if (!result?.ok) {
      pushWatchNotice({
        type: "error",
        message: result?.error || t.watchFolderAddFail,
      });
      return;
    }
    setWatchFolders((prev) => [...prev, entry]);
    setWatchDraft(createWatchDraft());

    if (!entry.enabled || !window.api?.scanDirectory) return;
    try {
      const files = await window.api.scanDirectory(
        entry.path,
        entry.includeSubdirs,
      );
      const filtered = filterWatchFilesByTypes(
        files || [],
        entry.fileTypes,
        SUPPORTED_EXTENSIONS,
      );
      addFiles(filtered, { source: "watch" });
    } catch (e) {
      console.error("Scan failed for", entry.path, e);
      pushWatchNotice({
        type: "error",
        message: t.scanFailed.replace("{count}", "1"),
      });
    }
  };

  const buildQueueImportPreview = (exportQueue: {
    queue: Array<{
      path: string;
      fileName?: string;
      fileType?: QueueItem["fileType"];
      addedAt?: string;
      config?: FileConfig;
    }>;
  }): QueueImportPreview => {
    const seen = new Set<string>();
    let unsupported = 0;
    let duplicateInFile = 0;
    const items: QueueItem[] = [];

    exportQueue.queue.forEach((entry) => {
      const path = (entry.path || "").trim();
      if (!path) {
        duplicateInFile += 1;
        return;
      }
      const lower = path.toLowerCase();
      if (!SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        unsupported += 1;
        return;
      }
      if (seen.has(path)) {
        duplicateInFile += 1;
        return;
      }
      seen.add(path);
      const config =
        entry.config && typeof entry.config === "object"
          ? { ...entry.config }
          : { useGlobalDefaults: true };
      if (config.useGlobalDefaults === undefined) {
        config.useGlobalDefaults = true;
      }
      items.push({
        id: generateId(),
        path,
        fileName: entry.fileName || path.split(/[/\\]/).pop() || path,
        fileType: getFileType(path),
        addedAt: entry.addedAt || new Date().toISOString(),
        status: "pending",
        config,
      });
    });

    return {
      items,
      meta: {
        total: exportQueue.queue.length,
        unsupported,
        duplicateInFile,
      },
    };
  };

  const handleExportQueue = useCallback(async () => {
    if (queue.length === 0) {
      pushNotice({ type: "info", message: t.emptyQueue });
      return;
    }
    try {
      const exportData = buildQueueExport(queue, APP_CONFIG.version);
      const fileName = `queue_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19)}.json`;
      let defaultPath = "";
      const candidates = [
        localStorage.getItem("config_output_dir"),
        localStorage.getItem("last_output_dir"),
        localStorage.getItem("config_cache_dir"),
        localStorage.getItem("last_input_path"),
      ].filter(Boolean) as string[];
      const resolveFolderFromPath = (value: string) => {
        if (!value) return "";
        const hasSlash = value.includes("/") || value.includes("\\");
        const looksLikeFile = /\.[^\\/]+$/.test(value);
        if (hasSlash && looksLikeFile) {
          return value.replace(/[\\/][^\\/]+$/, "");
        }
        return value;
      };
      const folder = candidates
        .map((item) => resolveFolderFromPath(item))
        .find((item) => item && item.length > 0);
      if (folder) {
        const sep = folder.includes("\\") ? "\\" : "/";
        const normalized =
          folder.endsWith("\\") || folder.endsWith("/")
            ? folder.slice(0, -1)
            : folder;
        defaultPath = `${normalized}${sep}${fileName}`;
      }
      if (
        !defaultPath ||
        (!defaultPath.includes("\\") && !defaultPath.includes("/"))
      ) {
        const modelsPath = await window.api?.getModelsPath?.();
        if (modelsPath) {
          const sep = modelsPath.includes("\\") ? "\\" : "/";
          defaultPath = `${modelsPath}${sep}${fileName}`;
        }
      }
      const filePath = await window.api?.saveFile?.({
        title: t.exportQueue,
        defaultPath: defaultPath || undefined,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      let ok = false;
      let writeError = "";
      if (window.api?.writeFileVerbose) {
        const result = await window.api.writeFileVerbose(
          filePath,
          JSON.stringify(exportData, null, 2),
        );
        ok = result?.ok === true;
        writeError = result?.error || "";
      } else {
        ok = Boolean(
          await window.api?.writeFile?.(
            filePath,
            JSON.stringify(exportData, null, 2),
          ),
        );
      }
      if (!ok) throw new Error(writeError || t.exportQueueFail);
      pushNotice({ type: "success", message: t.exportQueueDone });
      emitToast({ variant: "success", message: t.exportQueueDone });
    } catch (e) {
      pushNotice({ type: "error", message: String(e) });
    }
  }, [queue, pushNotice, t]);

  const handleImportQueue = useCallback(async () => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
    try {
      const filePath = await window.api?.selectFile?.({
        title: t.importQueueSelectTitle,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const raw = await window.api?.readFile?.(filePath);
      if (!raw) throw new Error(t.importQueueInvalid);
      const parsed = parseQueueExport(raw);
      if (parsed.error || !parsed.exportData) {
        throw new Error(parsed.error || t.importQueueInvalid);
      }
      const preview = buildQueueImportPreview(parsed.exportData);
      if (preview.items.length === 0) {
        throw new Error(t.importQueueEmpty);
      }
      setImportPreview(preview);
      setImportMode("merge");
      setShowImportModal(true);
    } catch (e) {
      pushNotice({ type: "error", message: String(e) });
    }
  }, [isRunning, pushNotice, t]);

  const applyImportQueue = useCallback(() => {
    if (!importPreview) return;
    const existingPaths = new Set(queue.map((q) => q.path));
    const addedItems =
      importMode === "replace"
        ? importPreview.items
        : importPreview.items.filter((item) => !existingPaths.has(item.path));
    const nextQueue =
      importMode === "replace" ? addedItems : [...queue, ...addedItems];
    setQueue(nextQueue);
    setSelectedItems(new Set());
    pushNotice({
      type: "success",
      message: t.importQueueDone.replace("{count}", String(addedItems.length)),
    });
    emitToast({
      variant: "success",
      message: t.importQueueDone.replace("{count}", String(addedItems.length)),
    });
    setShowImportModal(false);
    setImportPreview(null);
  }, [importMode, importPreview, pushNotice, queue, t]);

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
        pushNotice({ type: "warning", message: t.busyHint });
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
        let scanErrors = 0;
        // Scan for folders using backend API to support recursion/filtering
        for (const p of paths) {
          try {
            const expanded = await window.api?.scanDirectory(p, scanSubdirs);
            if (expanded && expanded.length > 0) {
              finalPaths.push(...expanded);
            }
          } catch (e) {
            scanErrors += 1;
            console.error("Scan failed for", p, e);
          }
        }
        if (scanErrors > 0) {
          pushNotice({
            type: "error",
            message: t.scanFailed.replace("{count}", String(scanErrors)),
          });
        }
        if (finalPaths.length > 0) {
          addFiles(finalPaths, { source: "manual" });
        } else if (scanErrors === 0) {
          pushNotice({ type: "info", message: t.noValidFiles });
        }
      }
    },
    [addFiles, scanSubdirs, isRunning, pushNotice, t],
  );

  // Queue operations
  const handleRemove = useCallback(
    (id: string) => {
      if (isRunning) {
        pushNotice({ type: "warning", message: t.busyHint });
        return;
      }
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
        title: t.confirmRemoveTitle,
        description: t.confirmRemoveDesc,
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
    [lang, showConfirm, isRunning, queue, pushNotice, t],
  );

  const handleClearCompleted = useCallback(() => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
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
      t.clearedCompletedNotice.replace("{count}", String(completedCount)),
    );
    pushNotice({
      type: "success",
      message: t.clearedCompletedNotice.replace(
        "{count}",
        String(completedCount),
      ),
    });
  }, [queue, isRunning, lang, pushNotice, t]);

  const handleRemoveSelected = useCallback(() => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
    if (selectedItems.size === 0) return;
    showConfirm({
      title: t.confirmRemoveSelectedTitle,
      description: t.confirmRemoveSelectedDesc.replace(
        "{count}",
        String(selectedItems.size),
      ),
      variant: "destructive",
      onConfirm: () => {
        setQueue((prev) => prev.filter((q) => !selectedItems.has(q.id)));
        setSelectedItems(new Set());
      },
    });
  }, [selectedItems, lang, showConfirm, isRunning, pushNotice, t]);

  const handleMoveToTop = useCallback(
    (id: string) => {
      if (isRunning) {
        pushNotice({ type: "warning", message: t.busyHint });
        return;
      }
      setQueue((prev) => {
        const index = prev.findIndex((q) => q.id === id);
        if (index <= 0) return prev;
        const newQueue = [...prev];
        const [item] = newQueue.splice(index, 1);
        return [item, ...newQueue];
      });
    },
    [isRunning, pushNotice, t],
  );

  const handleClear = useCallback(() => {
    if (isRunning) {
      pushNotice({ type: "warning", message: t.busyHint });
      return;
    }
    showConfirm({
      title: t.clear,
      description: t.confirmClear,
      variant: "destructive",
      onConfirm: () => {
        setQueue([]);
        setSelectedItems(new Set());
      },
    });
  }, [t, showConfirm, isRunning, pushNotice]);

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
    if (filteredQueue.length === 0) return;
    const allVisibleSelected = filteredQueue.every((q) =>
      selectedItems.has(q.id),
    );
    if (allVisibleSelected) {
      const next = new Set(selectedItems);
      filteredQueue.forEach((q) => next.delete(q.id));
      setSelectedItems(next);
    } else {
      const next = new Set(selectedItems);
      filteredQueue.forEach((q) => next.add(q.id));
      setSelectedItems(next);
    }
  }, [filteredQueue, selectedItems]);

  const handleInvertSelection = useCallback(() => {
    setSelectedItems((prev) => {
      if (filteredQueue.length === 0) return prev;
      const next = new Set(prev);
      filteredQueue.forEach((item) => {
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
      });
      return next;
    });
  }, [filteredQueue]);

  // Drag reorder
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (isRunning || isFilterActive) {
        e.preventDefault();
        return;
      }
      setIsReordering(true);
      e.dataTransfer.setData("text/plain", index.toString());
      e.dataTransfer.effectAllowed = "move";
      // Create a custom drag image or hide it if needed, but default is usually fine
    },
    [isRunning, isFilterActive],
  );

  const handleDragEnd = useCallback(() => {
    setIsReordering(false);
    setIsDragOver(false);
  }, []);

  const handleReorderDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (isFilterActive) return;
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
    [isFilterActive],
  );

  const allVisibleSelected =
    filteredQueue.length > 0 &&
    filteredQueue.every((item) => selectedItems.has(item.id));

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
      fileName: t.batchConfigTitle.replace(
        "{count}",
        String(selectedItems.size),
      ),
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
          const normalizeComparePath = (rawPath: string) => {
            const unified = rawPath.replace(/[/\\]/g, "\\");
            const isWindows = navigator.platform.toLowerCase().includes("win");
            return isWindows ? unified.toLowerCase() : unified;
          };
          // Normalize item path for comparison (case-insensitive on Windows only)
          const normItemPath = normalizeComparePath(item.path);

          // Find most recent matching record
          const match = history.find((h: any) => {
            const hPath = normalizeComparePath(h.filePath || h.inputPath || "");
            return hPath === normItemPath;
          });

          if (match) {
            // Logic copied from ProofreadView: history record -> cache path
            if (match.cachePath) targetPath = match.cachePath;
            else if (match.outputPath)
              targetPath = resolveCachePathFromOutput(
                match.outputPath,
                match.config?.cacheDir,
              );
            else targetPath = match.filePath + ".cache.json";
          }
        }
      } catch (e) {
        console.error("History lookup failed", e);
      }

      // Strategy 2: Default Guess (Fallback if not in history)
      if (!targetPath) {
        const useGlobalDefaults = !item.config || item.config.useGlobalDefaults;
        let outputDir = item.config?.outputDir;
        if (!outputDir && useGlobalDefaults) {
          outputDir = localStorage.getItem("config_output_dir") || undefined;
        }
        let modelPath = item.config?.model;
        if (!modelPath && useGlobalDefaults) {
          modelPath = localStorage.getItem("config_model") || undefined;
        }
        let cacheDir = item.config?.cacheDir;
        if (!cacheDir && useGlobalDefaults) {
          cacheDir = localStorage.getItem("config_cache_dir") || undefined;
        }
        const storedEngineMode = localStorage.getItem("config_engine_mode");
        const engineMode =
          item.config?.engineMode ||
          globalEngineMode ||
          (storedEngineMode === "v2" ? "v2" : "v1");
        targetPath = getCachePath(item.path, outputDir, modelPath, {
          cacheDir,
          engineMode,
        });
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

  const noticeConfig = notice
    ? {
      success: {
        className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600",
        icon: Check,
      },
      warning: {
        className: "bg-amber-500/10 border-amber-500/30 text-amber-600",
        icon: AlertTriangle,
      },
      error: {
        className: "bg-red-500/10 border-red-500/30 text-red-600",
        icon: AlertTriangle,
      },
      info: {
        className: "bg-blue-500/10 border-blue-500/30 text-blue-600",
        icon: Info,
      },
    }[notice.type]
    : null;
  const NoticeIcon = noticeConfig?.icon;

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
                {t.dropReleaseTitle}
              </h3>
              <p className="text-base text-muted-foreground">{t.dropHint}</p>
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

            <Button
              variant="ghost"
              size="sm"
              onClick={handleImportQueue}
              disabled={isRunning}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              {t.importQueue}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportQueue}
              disabled={queue.length === 0}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${queue.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {t.exportQueue}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWatchModal(true)}
              className="h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none"
            >
              <Eye className="w-3.5 h-3.5 mr-1" />
              {t.watchFolder}
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
                {t.scanSubdirs}
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
                  {selectedItems.size} {t.selected}
                </span>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {allVisibleSelected ? t.deselectAll : t.selectAll}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleInvertSelection}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {t.invertSelection}
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
                      {t.clearCompleted}
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
            <div className="px-4 py-2 border-b border-border/40 flex items-center justify-between shrink-0 bg-secondary/5 gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-2">
                  {t.queueTitle}
                </span>
                <span className="text-[10px] text-muted-foreground/70">
                  {filteredQueue.length}/{queue.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground/60 absolute left-2 top-1/2 -translate-y-1/2" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="h-7 w-[200px] text-xs pl-7 pr-6 bg-background/80"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="h-7 text-xs rounded-md border border-border/40 bg-background/80 px-2 text-muted-foreground hover:text-foreground"
                >
                  <option value="all">{t.filterAll}</option>
                  <option value="pending">{t.filterPending}</option>
                  <option value="completed">{t.filterCompleted}</option>
                  <option value="failed">{t.filterFailed}</option>
                </select>
              </div>
            </div>
          )}

          {notice && noticeConfig && NoticeIcon && (
            <div className="px-4 pt-2 pb-1">
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${noticeConfig.className}`}
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
                      {t.dropTitle}
                    </h3>
                    <p className="text-sm text-muted-foreground/70">
                      {t.emptyDragHint}
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
                    {t.readyToTranslate}
                  </div>
                </div>
              </div>
            ) : filteredQueue.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <div className="text-center text-muted-foreground">
                  <p className="text-sm font-medium">{t.noMatch}</p>
                  <div className="mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("");
                        setStatusFilter("all");
                      }}
                      className="h-7 text-xs"
                    >
                      {t.reset}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {filteredQueue.map((item) => {
                  const queueIndex = queue.findIndex((q) => q.id === item.id);
                  if (queueIndex < 0) return null;
                  return (
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
                      onDrop={(e) => handleReorderDrop(e, queueIndex)}
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
                        className={`p-2 -m-1 rounded shrink-0 transition-colors ${isRunning || isFilterActive
                          ? "opacity-20 cursor-not-allowed"
                          : "hover:bg-secondary cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-foreground"
                          }`}
                        draggable={!isRunning && !isFilterActive}
                        onDragStart={(e) => handleDragStart(e, queueIndex)}
                        onDragEnd={handleDragEnd}
                        title={t.dragToReorder}
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
                              {t.custom}
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

                        <UITooltip content={t.remove}>
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
                  );
                })}
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
            remoteRuntime={remoteRuntime}
          />
        )}

        {showImportModal && importPreview && importSummary && (
          <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">
                    {t.importQueueTitle}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.importQueueDesc}
                  </p>
                </div>
                <button
                  className="p-1.5 hover:bg-muted rounded-md"
                  onClick={() => setShowImportModal(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode("merge")}
                    className={`flex-1 px-3 py-2 rounded-md border text-xs font-medium transition-all ${importMode === "merge"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {t.importQueueMerge}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode("replace")}
                    className={`flex-1 px-3 py-2 rounded-md border text-xs font-medium transition-all ${importMode === "replace"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {t.importQueueReplace}
                  </button>
                </div>

                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
                  {t.importQueueSummary
                    .replace("{total}", String(importSummary.total))
                    .replace("{added}", String(importSummary.added))
                    .replace("{duplicate}", String(importSummary.duplicate))
                    .replace(
                      "{unsupported}",
                      String(importSummary.unsupported),
                    )}
                </div>
              </div>
              <div className="px-5 py-3 border-t flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImportModal(false)}
                >
                  {t.cancel}
                </Button>
                <Button size="sm" onClick={applyImportQueue}>
                  {t.importQueueApply}
                </Button>
              </div>
            </div>
          </div>
        )}

        {showWatchModal && (
          <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-3xl rounded-xl border border-border bg-background shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">
                    {t.watchFolderTitle}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.watchFolderDesc}
                  </p>
                </div>
                <button
                  className="p-1.5 hover:bg-muted rounded-md"
                  onClick={() => setShowWatchModal(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-5">
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-4">
                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex-1 min-w-[220px]">
                      <Input
                        value={watchDraft.path}
                        onChange={(e) =>
                          setWatchDraft((prev) => ({
                            ...prev,
                            path: e.target.value,
                          }))
                        }
                        placeholder={t.watchFolderBrowse}
                        className="h-9 text-xs"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectWatchFolder}
                      className="h-9 text-xs"
                    >
                      <FolderOpen className="w-3.5 h-3.5 mr-1" />
                      {t.watchFolderBrowse}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddWatchFolder}
                      className="h-9 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {t.watchFolderAdd}
                    </Button>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t.watchFolderTypes}（{t.watchFolderTypesHint}）
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setWatchDraft((prev) => ({
                            ...prev,
                            fileTypes: [],
                          }))
                        }
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all ${watchDraft.fileTypes.length === 0
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                          }`}
                      >
                        {t.watchFolderAllTypes}
                      </button>
                      {WATCH_FILE_TYPES.map((type) => {
                        const active = watchDraft.fileTypes.includes(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => toggleWatchDraftType(type)}
                            className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all uppercase ${active
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/60 text-muted-foreground hover:text-foreground"
                              }`}
                          >
                            .{type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground/80 hover:text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={watchDraft.includeSubdirs}
                        onChange={(e) =>
                          setWatchDraft((prev) => ({
                            ...prev,
                            includeSubdirs: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 rounded border-border accent-primary"
                      />
                      {t.watchFolderIncludeSubdirs}
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground/80 hover:text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={watchDraft.enabled}
                        onChange={(e) =>
                          setWatchDraft((prev) => ({
                            ...prev,
                            enabled: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 rounded border-border accent-primary"
                      />
                      {t.watchFolderEnabled}
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  {watchFolders.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                      {t.watchFolderEmpty}
                    </div>
                  ) : (
                    watchFolders.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-border/50 bg-background p-4 shadow-sm"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {entry.path}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatchFolderUpdate(entry.id, {
                                    fileTypes: [],
                                  })
                                }
                                className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${entry.fileTypes.length === 0
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border/60 text-muted-foreground hover:text-foreground"
                                  }`}
                              >
                                {t.watchFolderAllTypes}
                              </button>
                              {WATCH_FILE_TYPES.map((type) => {
                                const active = entry.fileTypes.includes(type);
                                return (
                                  <button
                                    key={type}
                                    type="button"
                                    onClick={() => {
                                      const next = active
                                        ? entry.fileTypes.filter(
                                          (t) => t !== type,
                                        )
                                        : [...entry.fileTypes, type];
                                      applyWatchFolderUpdate(entry.id, {
                                        fileTypes: next,
                                      });
                                    }}
                                    className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all uppercase ${active
                                      ? "border-primary/40 bg-primary/10 text-primary"
                                      : "border-border/60 text-muted-foreground hover:text-foreground"
                                      }`}
                                  >
                                    .{type}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-4">
                            <label className="flex items-center gap-2 text-[11px] text-muted-foreground/80 hover:text-foreground cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={entry.includeSubdirs}
                                onChange={(e) =>
                                  applyWatchFolderUpdate(entry.id, {
                                    includeSubdirs: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 rounded border-border accent-primary"
                              />
                              {t.watchFolderIncludeSubdirs}
                            </label>
                            <label className="flex items-center gap-2 text-[11px] text-muted-foreground/80 hover:text-foreground cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                onChange={(e) =>
                                  handleToggleWatchFolder(
                                    entry.id,
                                    e.target.checked,
                                  )
                                }
                                className="w-4 h-4 rounded border-border accent-primary"
                              />
                              {t.watchFolderEnabled}
                            </label>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveWatchFolder(entry.id)}
                              className="w-7 h-7"
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <AlertModal {...alertProps} />
      </div>
    </div>
  );
}

export default LibraryView;
