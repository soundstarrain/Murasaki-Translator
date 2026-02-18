/**
 * ProofreadView - 校对界面 (Redesigned)
 * 采用双栏联动布局 (Split View) + 内联编辑 (In-Place Edit)
 */

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { Button, Tooltip, Switch } from "./ui/core";
import {
  FolderOpen,
  RefreshCw,
  Save,
  Download,
  Search,
  Filter,
  Check,
  Book,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Regex,
  Replace,
  AlignJustify,
  ReplaceAll,
  FileCheck,
  FileText,
  History,
  Terminal,
  Clock,
  ListChecks,
} from "lucide-react";
import { Language } from "../lib/i18n";

// 缓存 Block 类型
interface CacheBlock {
  index: number;
  src: string;
  dst: string;
  status: "none" | "processed" | "edited";
  warnings: string[];
  cot: string;
  srcLines: number;
  dstLines: number;
}

// 缓存文件类型
interface CacheData {
  version: string;
  outputPath: string;
  modelName: string;
  glossaryPath: string;
  stats: {
    blockCount: number;
    srcLines: number;
    dstLines: number;
    srcChars: number;
    dstChars: number;
  };
  blocks: CacheBlock[];
}

interface HistoryCacheFile {
  path: string;
  name: string;
  date: string;
  inputPath?: string;
  model?: string;
}

interface ConsistencyExample {
  file: string;
  cachePath: string;
  blockIndex: number;
  srcLine: string;
  dstLine: string;
}

interface ConsistencyVariant {
  text: string;
  count: number;
  examples: ConsistencyExample[];
}

interface ConsistencyIssue {
  term: string;
  expected: string;
  total: number;
  matched: number;
  variants: ConsistencyVariant[];
}

interface ProofreadViewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  lang: Language;
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
}

interface RetryConfig {
  modelPath: string;
  glossaryPath: string;
  preset: string;
  temperature: number;
  repPenaltyBase: number;
  repPenaltyMax: number;
  repPenaltyStep: number;
  strictMode: string;
  deviceMode: "auto" | "cpu";
  gpuLayers: string;
  ctxSize: string;
  gpuDeviceId: string;
  lineCheck: boolean;
  lineToleranceAbs: number;
  lineTolerancePct: number;
  anchorCheck: boolean;
  anchorCheckRetries: number;
  maxRetries: number;
  retryTempBoost: number;
  retryPromptFeedback: boolean;
  coverageCheck: boolean;
  outputHitThreshold: number;
  cotCoverageThreshold: number;
  coverageRetries: number;
}

import { ResultChecker } from "./ResultChecker";
import { findHighSimilarityLines } from "../lib/quality-check";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { stripSystemMarkersForDisplay } from "../lib/displayText";

// ...

const CONSISTENCY_TAG_RE =
  /(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g;
const CONSISTENCY_TOKEN_RE =
  /[\u4e00-\u9fff]{1,8}(?:[·•・][\u4e00-\u9fff]{1,8})*/g;
const CONSISTENCY_STOPWORDS = new Set([
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
  "自己",
  "这个",
  "那个",
  "这里",
  "那里",
  "因为",
  "所以",
  "但是",
  "然后",
  "只是",
  "已经",
  "不是",
  "不会",
  "可以",
  "什么",
  "这样",
  "那样",
  "一个",
  "一种",
  "时候",
  "现在",
]);

const parseGlossaryContent = (raw: string): Record<string, string> => {
  const content = raw.replace(/^\uFEFF/, "");
  let parsed: Record<string, string> = {};

  try {
    const jsonRaw = JSON.parse(content);
    if (Array.isArray(jsonRaw)) {
      jsonRaw.forEach((item) => {
        if (item?.src && item?.dst) parsed[item.src] = item.dst;
      });
    } else if (jsonRaw && typeof jsonRaw === "object") {
      parsed = jsonRaw as Record<string, string>;
    }
    return parsed;
  } catch (e) {
    console.warn("JSON parse failed, trying TXT format", e);
  }

  const lines = content.split("\n");
  lines.forEach((line) => {
    line = line.trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("//") ||
      line === "{" ||
      line === "}"
    )
      return;

    let k = "";
    let v = "";
    if (line.endsWith(",")) line = line.slice(0, -1);
    if (line.includes("=")) {
      [k, v] = line.split("=", 2);
    } else if (line.includes(":")) {
      [k, v] = line.split(":", 2);
    }

    if (k && v) {
      k = k.trim().replace(/^["']|["']$/g, "");
      v = v.trim().replace(/^["']|["']$/g, "");
      if (k && v) parsed[k] = v;
    }
  });

  return parsed;
};

const CONSISTENCY_HONORIFICS = [
  "先生",
  "小姐",
  "女士",
  "老师",
  "老師",
  "同学",
  "同學",
  "大人",
  "阁下",
  "閣下",
  "殿",
  "大哥",
  "大姐",
  "哥哥",
  "姐姐",
  "前辈",
  "前輩",
  "博士",
  "隊長",
  "队长",
  "様",
  "さん",
  "君",
  "くん",
  "ちゃん",
  "酱",
  "醬",
];

const stripHonorifics = (token: string) => {
  let current = token;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CONSISTENCY_HONORIFICS) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return current;
};

const normalizeVariantToken = (token: string) =>
  stripHonorifics(token.replace(/[·•・\s]/g, ""));

const isVariantTokenValid = (token: string) => {
  const normalized = normalizeVariantToken(token);
  if (normalized.length < 2) return false;
  if (CONSISTENCY_STOPWORDS.has(normalized)) return false;
  return true;
};

const extractVariantTokensWithPos = (
  text: string,
): { text: string; start: number; end: number }[] => {
  if (!text) return [];
  const results: { text: string; start: number; end: number }[] = [];
  const regex = new RegExp(CONSISTENCY_TOKEN_RE);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    if (!isVariantTokenValid(token)) continue;
    results.push({
      text: token,
      start: match.index,
      end: match.index + token.length,
    });
  }
  return results;
};

const cleanConsistencyLine = (text: string): string =>
  stripSystemMarkersForDisplay(text || "")
    .replace(CONSISTENCY_TAG_RE, "")
    .trim();

const buildGlossaryIndex = (glossary: Record<string, string>) => {
  const index = new Map<string, { term: string; expected: string }[]>();
  Object.keys(glossary).forEach((term) => {
    if (!term || term.trim().length < 2) return;
    const key = term[0];
    const list = index.get(key) || [];
    list.push({ term, expected: glossary[term] || "" });
    index.set(key, list);
  });
  return index;
};

const findTermsInLine = (
  line: string,
  index: Map<string, { term: string; expected: string }[]>,
): string[] => {
  if (!line) return [];
  const matched = new Set<string>();
  const chars = new Set(line);
  chars.forEach((ch) => {
    const bucket = index.get(ch);
    if (!bucket) return;
    for (const entry of bucket) {
      if (line.includes(entry.term)) matched.add(entry.term);
    }
  });
  return Array.from(matched);
};

const pickConsistencyVariant = ({
  srcLine,
  term,
  targetText,
  expected,
  unknownLabel,
  useLineAlign,
}: {
  srcLine: string;
  term: string;
  targetText: string;
  expected: string;
  unknownLabel: string;
  useLineAlign: boolean;
}): string => {
  if (!targetText) return unknownLabel;
  const tokens = extractVariantTokensWithPos(targetText);
  if (tokens.length === 0) return unknownLabel;

  const normalizedExpected = expected ? normalizeVariantToken(expected) : "";
  const selectByPosition = (
    candidates: { text: string; start: number; end: number }[],
  ) => {
    if (!useLineAlign) {
      candidates.sort(
        (a, b) =>
          normalizeVariantToken(b.text).length -
          normalizeVariantToken(a.text).length,
      );
      return candidates[0];
    }
    const termIndex = srcLine.indexOf(term);
    const termRatio =
      termIndex >= 0
        ? (termIndex + term.length / 2) / Math.max(srcLine.length, 1)
        : null;
    if (termRatio === null) {
      candidates.sort(
        (a, b) =>
          normalizeVariantToken(b.text).length -
          normalizeVariantToken(a.text).length,
      );
      return candidates[0];
    }
    let best = candidates[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const token of candidates) {
      const center = (token.start + token.end) / 2;
      const ratio = center / Math.max(targetText.length, 1);
      const distance = Math.abs(ratio - termRatio);
      if (
        distance < bestDistance ||
        (distance === bestDistance &&
          normalizeVariantToken(token.text).length >
            normalizeVariantToken(best.text).length)
      ) {
        best = token;
        bestDistance = distance;
      }
    }
    return best;
  };

  if (expected && targetText.includes(expected)) {
    const related = tokens.filter((t) => t.text.includes(expected));
    if (related.length > 0) {
      const chosen = selectByPosition(related);
      const normalizedChosen = normalizeVariantToken(chosen.text);
      if (normalizedExpected && normalizedChosen === normalizedExpected) {
        return expected;
      }
      return chosen.text;
    }
    return expected;
  }

  const chosen = selectByPosition(tokens);
  return chosen.text;
};

export default function ProofreadView({
  t,
  lang,
  onUnsavedChangesChange,
}: ProofreadViewProps) {
  const { alertProps, showAlert, showConfirm } = useAlertModal();
  const pv = t.proofreadView;
  const av = t.advancedView;

  // 状态
  const [cacheData, setCacheData] = useState<CacheData | null>(null);
  const [cachePath, setCachePath] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Log viewing state
  const [blockLogs, setBlockLogs] = useState<Record<number, string[]>>({});
  const [showLogModal, setShowLogModal] = useState<number | null>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Quality Check Panel
  const [showQualityCheck, setShowQualityCheck] = useState(false);
  const [glossary, setGlossary] = useState<Record<string, string>>({});
  const [glossaryLoadError, setGlossaryLoadError] = useState<string | null>(
    null,
  );

  // Global Consistency Scan
  const [showConsistencyModal, setShowConsistencyModal] = useState(false);
  const [consistencyFiles, setConsistencyFiles] = useState<HistoryCacheFile[]>(
    [],
  );
  const [consistencySelected, setConsistencySelected] = useState<Set<string>>(
    new Set(),
  );
  const [consistencyGlossaryPath, setConsistencyGlossaryPath] = useState("");
  const [consistencyMinOccurrences, setConsistencyMinOccurrences] = useState(2);
  const [consistencyResults, setConsistencyResults] = useState<
    ConsistencyIssue[]
  >([]);
  const [consistencyStats, setConsistencyStats] = useState({
    files: 0,
    terms: 0,
    issues: 0,
  });
  const [consistencyScanning, setConsistencyScanning] = useState(false);
  const [consistencyProgress, setConsistencyProgress] = useState(0);
  const [consistencyExpanded, setConsistencyExpanded] = useState<Set<string>>(
    new Set(),
  );

  // Retry Panel
  const [showRetryPanel, setShowRetryPanel] = useState(false);
  const [retryModelPath, setRetryModelPath] = useState("");
  const [retryGlossaryPath, setRetryGlossaryPath] = useState("");
  const [retryPreset, setRetryPreset] = useState("novel");
  const [retryTemperature, setRetryTemperature] = useState(0.7);
  const [retryRepPenaltyBase, setRetryRepPenaltyBase] = useState(1.0);
  const [retryRepPenaltyMax, setRetryRepPenaltyMax] = useState(1.5);
  const [retryRepPenaltyStep, setRetryRepPenaltyStep] = useState(0.1);
  const [retryStrictMode, setRetryStrictMode] = useState("off");
  const [retryDeviceMode, setRetryDeviceMode] = useState<"auto" | "cpu">(
    "auto",
  );
  const [retryGpuLayers, setRetryGpuLayers] = useState("-1");
  const [retryCtxSize, setRetryCtxSize] = useState("4096");
  const [retryGpuDeviceId, setRetryGpuDeviceId] = useState("");
  const [retryLineCheck, setRetryLineCheck] = useState(true);
  const [retryLineToleranceAbs, setRetryLineToleranceAbs] = useState(10);
  const [retryLineTolerancePct, setRetryLineTolerancePct] = useState(20);
  const [retryAnchorCheck, setRetryAnchorCheck] = useState(true);
  const [retryAnchorCheckRetries, setRetryAnchorCheckRetries] = useState(1);
  const [retryMaxRetries, setRetryMaxRetries] = useState(3);
  const [retryTempBoost, setRetryTempBoost] = useState(0.05);
  const [retryPromptFeedback, setRetryPromptFeedback] = useState(true);
  const [retryCoverageCheck, setRetryCoverageCheck] = useState(true);
  const [retryOutputHitThreshold, setRetryOutputHitThreshold] = useState(60);
  const [retryCotCoverageThreshold, setRetryCotCoverageThreshold] =
    useState(80);
  const [retryCoverageRetries, setRetryCoverageRetries] = useState(1);
  const [retryDraft, setRetryDraft] = useState<RetryConfig | null>(null);

  // 编辑状态
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [retranslatingBlocks, setRetranslatingBlocks] = useState<Set<number>>(
    new Set(),
  );

  // 搜索与过滤
  const [searchKeyword, setSearchKeyword] = useState("");
  const [filterWarnings, setFilterWarnings] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [matchList, setMatchList] = useState<
    { blockIndex: number; type: "src" | "dst"; lineIndex: number }[]
  >([]);

  // Advanced Search & Replace
  const [isRegex, setIsRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [replaceText, setReplaceText] = useState("");

  // History & Folder Browser
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Line Mode - strict line-by-line alignment with line numbers
  const [lineMode, setLineMode] = useState(true); // Default to line mode
  const [selectionLock, setSelectionLock] = useState<"src" | "dst" | null>(
    null,
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [, startRetryPanelTransition] = useTransition();

  useEffect(() => {
    const clearSelectionLock = () => setSelectionLock(null);
    window.addEventListener("mouseup", clearSelectionLock);
    return () => window.removeEventListener("mouseup", clearSelectionLock);
  }, []);

  useEffect(() => {
    setRetryModelPath(localStorage.getItem("config_model") || "");
    setRetryGlossaryPath(localStorage.getItem("config_glossary_path") || "");
    setRetryPreset(localStorage.getItem("config_preset") || "novel");
    const savedTemp = localStorage.getItem("config_temperature");
    if (savedTemp) {
      const val = parseFloat(savedTemp);
      if (Number.isFinite(val)) setRetryTemperature(val);
    }
    const savedRepBase = localStorage.getItem("config_rep_penalty_base");
    if (savedRepBase) {
      const val = parseFloat(savedRepBase);
      if (Number.isFinite(val)) setRetryRepPenaltyBase(val);
    }
    const savedRepMax = localStorage.getItem("config_rep_penalty_max");
    if (savedRepMax) {
      const val = parseFloat(savedRepMax);
      if (Number.isFinite(val)) setRetryRepPenaltyMax(val);
    }
    const savedRepStep = localStorage.getItem("config_rep_penalty_step");
    if (savedRepStep) {
      const val = parseFloat(savedRepStep);
      if (Number.isFinite(val)) setRetryRepPenaltyStep(val);
    }
    setRetryStrictMode(localStorage.getItem("config_strict_mode") || "off");
    setRetryDeviceMode(
      (localStorage.getItem("config_device_mode") as "auto" | "cpu") || "auto",
    );
    setRetryGpuLayers(localStorage.getItem("config_gpu") || "-1");
    setRetryCtxSize(localStorage.getItem("config_ctx") || "4096");
    setRetryGpuDeviceId(localStorage.getItem("config_gpu_device_id") || "");

    setRetryLineCheck(localStorage.getItem("config_line_check") !== "false");
    const savedLineAbs = localStorage.getItem("config_line_tolerance_abs");
    if (savedLineAbs) {
      const val = parseInt(savedLineAbs, 10);
      if (Number.isFinite(val)) setRetryLineToleranceAbs(val);
    }
    const savedLinePct = localStorage.getItem("config_line_tolerance_pct");
    if (savedLinePct) {
      const val = parseInt(savedLinePct, 10);
      if (Number.isFinite(val)) setRetryLineTolerancePct(val);
    }
    setRetryAnchorCheck(
      localStorage.getItem("config_anchor_check") !== "false",
    );
    const savedAnchorRetries = localStorage.getItem(
      "config_anchor_check_retries",
    );
    if (savedAnchorRetries) {
      const val = parseInt(savedAnchorRetries, 10);
      if (Number.isFinite(val) && val > 0) setRetryAnchorCheckRetries(val);
    }
    const savedMaxRetries = localStorage.getItem("config_max_retries");
    if (savedMaxRetries) {
      const val = parseInt(savedMaxRetries, 10);
      if (Number.isFinite(val)) setRetryMaxRetries(val);
    }
    const savedRetryTempBoost = localStorage.getItem("config_retry_temp_boost");
    if (savedRetryTempBoost) {
      const val = parseFloat(savedRetryTempBoost);
      if (Number.isFinite(val)) setRetryTempBoost(val);
    }
    setRetryPromptFeedback(
      localStorage.getItem("config_retry_prompt_feedback") !== "false",
    );
    setRetryCoverageCheck(
      localStorage.getItem("config_coverage_check") !== "false",
    );
    const savedOutputHitThreshold = localStorage.getItem(
      "config_output_hit_threshold",
    );
    if (savedOutputHitThreshold) {
      const val = parseInt(savedOutputHitThreshold, 10);
      if (Number.isFinite(val)) setRetryOutputHitThreshold(val);
    }
    const savedCotCoverageThreshold = localStorage.getItem(
      "config_cot_coverage_threshold",
    );
    if (savedCotCoverageThreshold) {
      const val = parseInt(savedCotCoverageThreshold, 10);
      if (Number.isFinite(val)) setRetryCotCoverageThreshold(val);
    }
    const savedCoverageRetries = localStorage.getItem(
      "config_coverage_retries",
    );
    if (savedCoverageRetries) {
      const val = parseInt(savedCoverageRetries, 10);
      if (Number.isFinite(val)) setRetryCoverageRetries(val);
    }
  }, []);

  // Sync with parent for navigation guard
  useEffect(() => {
    // Intercept navigation if active tasks (loading/retranslating) are running, or if there are unsaved changes
    const isBusy = hasUnsavedChanges || loading || retranslatingBlocks.size > 0;
    onUnsavedChangesChange?.(isBusy);
  }, [
    hasUnsavedChanges,
    loading,
    retranslatingBlocks.size,
    onUnsavedChangesChange,
  ]);

  // Initial Load - Setup Listeners
  useEffect(() => {
    const handler = (data: {
      index: number;
      text: string;
      isError?: boolean;
    }) => {
      setBlockLogs((prev) => ({
        ...prev,
        [data.index]: [...(prev[data.index] || []), data.text],
      }));
    };

    const unsubscribe = window.api?.onRetranslateLog(handler);
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Auto-scroll log modal
  useEffect(() => {
    if (showLogModal !== null && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [blockLogs, showLogModal]);

  useEffect(() => {
    if (cacheData?.glossaryPath && !retryGlossaryPath) {
      setRetryGlossaryPath(cacheData.glossaryPath);
    }
  }, [cacheData?.glossaryPath, retryGlossaryPath]);

  // Search Effect
  useEffect(() => {
    if (!searchKeyword || !cacheData) {
      setMatchList([]);
      setCurrentMatchIndex(-1);
      setRegexError(null);
      return;
    }
    const matches: {
      blockIndex: number;
      type: "src" | "dst";
      lineIndex: number;
    }[] = [];

    try {
      const flags = isRegex ? "gi" : "i";
      // Escape special chars if not regex mode
      const pattern = isRegex
        ? searchKeyword
        : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(pattern, flags);
      setRegexError(null);

      cacheData.blocks.forEach((block) => {
        const srcLines = stripSystemMarkersForDisplay(
          trimLeadingEmptyLines(block.src),
        ).split(/\r?\n/);
        srcLines.forEach((line, lineIndex) => {
          if (regex.test(line)) {
            matches.push({ blockIndex: block.index, type: "src", lineIndex });
            regex.lastIndex = 0;
          }
        });

        const dstLines = trimLeadingEmptyLines(block.dst).split(/\r?\n/);
        dstLines.forEach((line, lineIndex) => {
          if (regex.test(line)) {
            matches.push({ blockIndex: block.index, type: "dst", lineIndex });
            regex.lastIndex = 0;
          }
        });
      });
    } catch (e) {
      if (isRegex) {
        setRegexError(e instanceof Error ? e.message : String(e));
      } else {
        setRegexError(null);
      }
      setMatchList([]);
      setCurrentMatchIndex(-1);
      return;
    }

    setMatchList(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
      scrollToMatch(matches[0]);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [searchKeyword, cacheData, isRegex]);

  const scrollToBlock = (index: number) => {
    const el = document.getElementById(`block-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Ensure we are on the right page if specific pagination logic exists (currently assumed flat or auto-handled by scroll if elements exist)
      // But wait, we have pagination! We need to switch page.
      const page = Math.floor(index / pageSize) + 1;
      if (page !== currentPage) setCurrentPage(page);
      // Need to wait for render if page changed...
      setTimeout(() => {
        const elRetry = document.getElementById(`block-${index}`);
        elRetry?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    } else {
      // Probably on another page
      const page = Math.floor(index / pageSize) + 1;
      if (page !== currentPage) {
        setCurrentPage(page);
        setTimeout(() => {
          const elRetry = document.getElementById(`block-${index}`);
          elRetry?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  };

  const scrollToMatch = (match: {
    blockIndex: number;
    type: "src" | "dst";
    lineIndex: number;
  }) => {
    const page = Math.floor(match.blockIndex / pageSize) + 1;
    if (page !== currentPage) setCurrentPage(page);

    setTimeout(() => {
      const lineId = `block-${match.blockIndex}-${match.type}-line-${match.lineIndex}`;
      const lineEl = document.getElementById(lineId);
      if (lineEl) {
        lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      scrollToBlock(match.blockIndex);
    }, 100);
  };

  const nextMatch = () => {
    if (matchList.length === 0) return;
    const next = (currentMatchIndex + 1) % matchList.length;
    setCurrentMatchIndex(next);
    scrollToMatch(matchList[next]);
  };

  const prevMatch = () => {
    if (matchList.length === 0) return;
    const prev = (currentMatchIndex - 1 + matchList.length) % matchList.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(matchList[prev]);
  };

  const openRetryPanel = () => {
    startRetryPanelTransition(() => {
      setRetryDraft(buildRetryDraft());
      setShowRetryPanel(true);
      setShowQualityCheck(false);
    });
  };

  const closeRetryPanel = () => {
    setShowRetryPanel(false);
    setRetryDraft(null);
  };

  const saveRetryPanel = () => {
    if (retryDraft) {
      applyRetryConfig(retryDraft);
    }
    closeRetryPanel();
  };

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Shared logic to process loaded cache data and glossary
  const processLoadedData = async (data: any, path: string) => {
    // Clean tags and normalize indices to prevent duplicate key warnings
    if (data.blocks && Array.isArray(data.blocks)) {
      data.blocks = data.blocks.map((b: any, i: number) => {
        const dst = b.dst || "";
        const warnings = b.warnings || [];

        // Extract tags to warnings array if not present
        const tags = [
          "line_mismatch",
          "high_similarity",
          "kana_residue",
          "glossary_missed",
          "hangeul_residue",
        ];
        tags.forEach((tag) => {
          if (dst.includes(tag) && !warnings.includes(tag)) {
            warnings.push(tag);
          }
        });

        // Strip tags
        const cleanDst = dst.replace(
          /(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g,
          "",
        );

        // Force sequential unique index if duplicate detected or missing
        const index = typeof b.index === "number" ? b.index : i;

        return { ...b, index, dst: cleanDst, warnings };
      });

      // Additional safety: If we still have potential duplicates in the source, force them to be unique based on array position
      // This is the strongest protection against the "duplicate key 1" warning
      const seenIndices = new Set();
      data.blocks.forEach((b: any, i: number) => {
        if (seenIndices.has(b.index)) {
          console.warn(
            `[Proofread] Duplicate index detected: ${b.index}. Reassigning to ${i}`,
          );
          b.index = i;
        }
        seenIndices.add(b.index);
      });
    }

    setCacheData(data);
    setCachePath(path);
    setHasUnsavedChanges(false); // Reset on load
    setCurrentPage(1);
    setEditingBlockId(null);

    if (data.glossaryPath) {
      try {
        console.log("Loading glossary from:", data.glossaryPath);
        const glossaryContent = await window.api?.readFile(data.glossaryPath);
        if (glossaryContent) {
          const parsed = parseGlossaryContent(glossaryContent);
          const count = Object.keys(parsed).length;
          console.log(`Loaded ${count} glossary entries`);
          setGlossary(parsed);
          setGlossaryLoadError(null);
        }
      } catch (e) {
        console.warn("Failed to load glossary:", e);
        setGlossary({});
        setGlossaryLoadError(e instanceof Error ? e.message : String(e));
      }
    } else {
      console.log("No glossary path in cache data");
      setGlossary({});
      setGlossaryLoadError(null);
    }
  };

  // Load Cache (File Dialog)
  const loadCache = async () => {
    const executeLoad = async () => {
      try {
        const defaultPath =
          localStorage.getItem("config_cache_dir") || undefined;
        const result = await window.api?.selectFile({
          title: pv.selectCacheTitle,
          defaultPath: defaultPath,
          filters: [{ name: "Cache Files", extensions: ["cache.json"] }],
        } as any);
        if (result) {
          setLoading(true);
          const data = await window.api?.loadCache(result);
          if (data) {
            await processLoadedData(data, result);
          } else {
            showAlert({
              title: pv.loadFailTitle,
              description: pv.loadFailDesc,
              variant: "destructive",
            });
          }
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to load cache:", error);
        setLoading(false);
        showAlert({
          title: pv.loadFailTitle,
          description: String(error),
          variant: "destructive",
        });
      }
    };

    if (hasUnsavedChanges) {
      showConfirm({
        title: t.config.proofread.unsavedChanges.split("，")[0],
        description: t.config.proofread.unsavedChanges,
        onConfirm: executeLoad,
      });
    } else {
      executeLoad();
    }
  };

  // Save Cache
  const saveCache = async () => {
    if (!cacheData || !cachePath) return;
    try {
      setLoading(true);
      // Commit in-progress edit before save (avoid stale cacheData)
      let dataToSave = cacheData;
      if (editingBlockId !== null) {
        const newBlocks: CacheBlock[] = cacheData.blocks.map((b) =>
          b.index === editingBlockId
            ? { ...b, dst: editingText, status: "edited" as const }
            : b,
        );
        dataToSave = { ...cacheData, blocks: newBlocks };
        setCacheData(dataToSave);
        setEditingBlockId(null);
      }
      // 1. Save JSON Cache
      const cacheOk = await window.api?.saveCache(cachePath, dataToSave);
      if (!cacheOk) throw new Error("Failed to save cache JSON");

      // 2. Sync to Translated File (EPUB/TXT/SRT/ASS)
      const isWindows =
        typeof navigator !== "undefined" &&
        typeof navigator.platform === "string" &&
        navigator.platform.toLowerCase().includes("win");
      const looksLikeWindowsPath = (value: string) =>
        /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
      const derivedOutputPath = cachePath.replace(/\.cache\.json$/i, "");
      let resolvedOutputPath =
        derivedOutputPath !== cachePath ? derivedOutputPath : "";
      if (!resolvedOutputPath) {
        resolvedOutputPath =
          cacheData.outputPath && cacheData.outputPath.trim()
            ? cacheData.outputPath.trim()
            : "";
      }
      if (
        isWindows &&
        resolvedOutputPath &&
        !looksLikeWindowsPath(resolvedOutputPath)
      ) {
        resolvedOutputPath = "";
      }
      if (resolvedOutputPath) {
        const ext = resolvedOutputPath.split(".").pop()?.toLowerCase();

        // Use Python rebuild for formats that should strictly mirror cache
        if (["epub", "srt", "ass", "ssa", "txt"].includes(ext || "")) {
          const rebuildResult = await window.api?.rebuildDoc({
            cachePath,
            outputPath: resolvedOutputPath,
          });
          if (!rebuildResult?.success) {
            throw new Error(
              pv.rebuildFail.replace(
                "{error}",
                rebuildResult?.error || pv.rebuildNoResult,
              ),
            );
          }
        } else {
          // Direct write for other plain-text outputs
          const content =
            dataToSave.blocks
              .sort((a, b) => a.index - b.index)
              .map((b) => b.dst.trim())
              .join("\n\n") + "\n";
          const ok = await window.api?.writeFile(resolvedOutputPath, content);
          if (!ok) {
            throw new Error(
              pv.writeTextFail.replace("{path}", resolvedOutputPath),
            );
          }
        }
      }

      setHasUnsavedChanges(false); // Reset on save
      setLoading(false);
      showAlert({
        title: pv.saveSuccessTitle,
        description: pv.saveSuccessDesc,
        variant: "success",
      });
    } catch (error) {
      console.error("Failed to save cache:", error);
      setLoading(false);
      showAlert({
        title: pv.saveFailTitle,
        description: String(error),
        variant: "destructive",
      });
    }
  };

  // Helper: Normalize to Light Novel Spacing (Double Newline)
  const normalizeLN = (text: string) => {
    if (!text) return "";
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .join("\n\n");
  };

  // Export
  const exportTranslation = async () => {
    if (!cacheData) return;
    try {
      const result = await window.api?.saveFile({
        title: pv.exportTitle,
        defaultPath: cacheData.outputPath,
        filters: [{ name: "Text Files", extensions: ["txt"] }],
      });
      if (result) {
        const text = cacheData.blocks
          .sort((a, b) => a.index - b.index)
          .map((b) => normalizeLN(b.dst)) // Enforce formatting on export
          .join("\n\n");
        const ok = await window.api?.writeFile(result, text);
        if (!ok) {
          throw new Error(pv.writeFileFail);
        }
        showAlert({
          title: pv.exportSuccessTitle,
          description: pv.exportSuccessDesc,
          variant: "success",
        });
      }
    } catch (error) {
      console.error("Failed to export:", error);
      showAlert({
        title: pv.exportFailTitle,
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const selectRetryModel = async () => {
    try {
      const result = await window.api?.selectFile({
        title: pv.retrySelectModelTitle,
        filters: [
          {
            name: pv.retryModelFilterName,
            extensions: ["gguf", "bin"],
          },
        ],
      });
      if (result) {
        setRetryModelPath(result);
        localStorage.setItem("config_model", result);
        if (showRetryPanel) {
          updateRetryDraft({ modelPath: result });
        }
      }
    } catch (error) {
      console.error("Failed to select model:", error);
    }
  };

  const selectRetryGlossary = async () => {
    try {
      const result = await window.api?.selectFile({
        title: pv.retrySelectGlossaryTitle,
        filters: [
          {
            name: pv.retryGlossaryFilterName,
            extensions: ["json", "txt", "csv", "tsv"],
          },
        ],
      });
      if (result) {
        setRetryGlossaryPath(result);
        localStorage.setItem("config_glossary_path", result);
        if (showRetryPanel) {
          updateRetryDraft({ glossaryPath: result });
        }
      }
    } catch (error) {
      console.error("Failed to select glossary:", error);
    }
  };

  const buildRetryDraft = (): RetryConfig => ({
    modelPath: retryModelPath,
    glossaryPath: retryGlossaryPath,
    preset: retryPreset,
    temperature: retryTemperature,
    repPenaltyBase: retryRepPenaltyBase,
    repPenaltyMax: retryRepPenaltyMax,
    repPenaltyStep: retryRepPenaltyStep,
    strictMode: retryStrictMode,
    deviceMode: retryDeviceMode,
    gpuLayers: retryGpuLayers,
    ctxSize: retryCtxSize,
    gpuDeviceId: retryGpuDeviceId,
    lineCheck: retryLineCheck,
    lineToleranceAbs: retryLineToleranceAbs,
    lineTolerancePct: retryLineTolerancePct,
    anchorCheck: retryAnchorCheck,
    anchorCheckRetries: retryAnchorCheckRetries,
    maxRetries: retryMaxRetries,
    retryTempBoost: retryTempBoost,
    retryPromptFeedback: retryPromptFeedback,
    coverageCheck: retryCoverageCheck,
    outputHitThreshold: retryOutputHitThreshold,
    cotCoverageThreshold: retryCotCoverageThreshold,
    coverageRetries: retryCoverageRetries,
  });

  const applyRetryConfig = (next: RetryConfig) => {
    setRetryModelPath(next.modelPath);
    localStorage.setItem("config_model", next.modelPath);

    setRetryGlossaryPath(next.glossaryPath);
    localStorage.setItem("config_glossary_path", next.glossaryPath);

    setRetryPreset(next.preset);
    localStorage.setItem("config_preset", next.preset);

    setRetryTemperature(next.temperature);
    localStorage.setItem("config_temperature", String(next.temperature));

    setRetryRepPenaltyBase(next.repPenaltyBase);
    localStorage.setItem(
      "config_rep_penalty_base",
      String(next.repPenaltyBase),
    );

    setRetryRepPenaltyMax(next.repPenaltyMax);
    localStorage.setItem("config_rep_penalty_max", String(next.repPenaltyMax));

    setRetryRepPenaltyStep(next.repPenaltyStep);
    localStorage.setItem(
      "config_rep_penalty_step",
      String(next.repPenaltyStep),
    );

    setRetryStrictMode(next.strictMode);
    localStorage.setItem("config_strict_mode", next.strictMode);

    setRetryDeviceMode(next.deviceMode);
    localStorage.setItem("config_device_mode", next.deviceMode);

    setRetryGpuLayers(next.gpuLayers);
    localStorage.setItem("config_gpu", next.gpuLayers);

    setRetryCtxSize(next.ctxSize);
    localStorage.setItem("config_ctx", next.ctxSize);

    setRetryGpuDeviceId(next.gpuDeviceId);
    localStorage.setItem("config_gpu_device_id", next.gpuDeviceId);

    setRetryLineCheck(next.lineCheck);
    localStorage.setItem("config_line_check", String(next.lineCheck));

    setRetryLineToleranceAbs(next.lineToleranceAbs);
    localStorage.setItem(
      "config_line_tolerance_abs",
      String(next.lineToleranceAbs),
    );

    setRetryLineTolerancePct(next.lineTolerancePct);
    localStorage.setItem(
      "config_line_tolerance_pct",
      String(next.lineTolerancePct),
    );

    setRetryAnchorCheck(next.anchorCheck);
    localStorage.setItem("config_anchor_check", String(next.anchorCheck));

    setRetryAnchorCheckRetries(next.anchorCheckRetries);
    localStorage.setItem(
      "config_anchor_check_retries",
      String(next.anchorCheckRetries),
    );

    setRetryMaxRetries(next.maxRetries);
    localStorage.setItem("config_max_retries", String(next.maxRetries));

    setRetryTempBoost(next.retryTempBoost);
    localStorage.setItem(
      "config_retry_temp_boost",
      String(next.retryTempBoost),
    );

    setRetryPromptFeedback(next.retryPromptFeedback);
    localStorage.setItem(
      "config_retry_prompt_feedback",
      String(next.retryPromptFeedback),
    );

    setRetryCoverageCheck(next.coverageCheck);
    localStorage.setItem("config_coverage_check", String(next.coverageCheck));

    setRetryOutputHitThreshold(next.outputHitThreshold);
    localStorage.setItem(
      "config_output_hit_threshold",
      String(next.outputHitThreshold),
    );

    setRetryCotCoverageThreshold(next.cotCoverageThreshold);
    localStorage.setItem(
      "config_cot_coverage_threshold",
      String(next.cotCoverageThreshold),
    );

    setRetryCoverageRetries(next.coverageRetries);
    localStorage.setItem(
      "config_coverage_retries",
      String(next.coverageRetries),
    );
  };

  const updateRetryDraft = (patch: Partial<RetryConfig>) => {
    setRetryDraft((prev) => ({ ...(prev || buildRetryDraft()), ...patch }));
  };

  // Update Block
  const updateBlockDst = useCallback(
    (index: number, newDst: string) => {
      if (!cacheData) return;
      const newBlocks = [...cacheData.blocks];
      const blockIndex = newBlocks.findIndex((b) => b.index === index);
      if (blockIndex !== -1) {
        // Also strip tags if model re-inserted them
        const cleanDst = newDst.replace(
          /(\s*)[(\[]?\b(line_mismatch|high_similarity|kana_residue|glossary_missed|hangeul_residue)\b[)\]]?(\s*)/g,
          "",
        );

        newBlocks[blockIndex] = {
          ...newBlocks[blockIndex],
          dst: cleanDst,
          status: "edited",
        };
        const newData = { ...cacheData, blocks: newBlocks };
        setCacheData(newData);
        setHasUnsavedChanges(true);
        // onUnsavedChangesChange?.(true) // This line was not in the original context, so I'm not adding it.
      }
    },
    [cacheData],
  );

  // Retranslate
  const retranslateBlock = useCallback(
    async (index: number) => {
      if (!cacheData) return;
      const block = cacheData.blocks.find((b) => b.index === index);
      if (!block) return;

      // Global Lock: Enforce single-threading for manual re-translation
      if (retranslatingBlocks.size > 0 || loading) {
        showAlert({
          title: pv.waitTitle,
          description: pv.waitDesc,
          variant: "destructive",
        });
        return;
      }

      const resolvedModelPath = (
        retryModelPath ||
        localStorage.getItem("config_model") ||
        ""
      ).trim();
      if (!resolvedModelPath) {
        showAlert({
          title: t.advancedFeatures,
          description: pv.modelMissingDesc,
          variant: "destructive",
        });
        return;
      }

      try {
        setLoading(true);
        setRetranslatingBlocks((prev) => new Set(prev).add(index));
        // Clear previous logs for this block on start
        setBlockLogs((prev) => ({ ...prev, [index]: [] }));

        const resolvedGlossaryPath = (
          retryGlossaryPath ||
          localStorage.getItem("config_glossary_path") ||
          ""
        ).trim();
        const parsedGpuLayers = parseInt(retryGpuLayers || "-1", 10);
        const config = {
          gpuLayers: Number.isFinite(parsedGpuLayers) ? parsedGpuLayers : -1,
          ctxSize: retryCtxSize || "4096",
          preset: retryPreset || "novel",
          temperature: retryTemperature,
          repPenaltyBase: retryRepPenaltyBase,
          repPenaltyMax: retryRepPenaltyMax,
          repPenaltyStep: retryRepPenaltyStep,
          glossaryPath: resolvedGlossaryPath || undefined,
          deviceMode: retryDeviceMode || "auto",
          rulesPre: JSON.parse(
            localStorage.getItem("config_rules_pre") || "[]",
          ),
          rulesPost: JSON.parse(
            localStorage.getItem("config_rules_post") || "[]",
          ),
          strictMode: retryStrictMode || "off", // Default to off for manual retry unless set
          flashAttn: localStorage.getItem("config_flash_attn") !== "false", // Most models support it now
          kvCacheType: localStorage.getItem("config_kv_cache_type") || "f16",
          lineCheck: retryLineCheck,
          lineToleranceAbs: retryLineToleranceAbs,
          lineTolerancePct: retryLineTolerancePct,
          anchorCheck: retryAnchorCheck,
          anchorCheckRetries: retryAnchorCheckRetries,
          maxRetries: retryMaxRetries,
          retryTempBoost: retryTempBoost,
          retryPromptFeedback: retryPromptFeedback,
          coverageCheck: retryCoverageCheck,
          outputHitThreshold: retryOutputHitThreshold,
          cotCoverageThreshold: retryCotCoverageThreshold,
          coverageRetries: retryCoverageRetries,
          gpuDeviceId: retryGpuDeviceId,
        };

        const result = await window.api?.retranslateBlock({
          src: block.src,
          index: block.index,
          modelPath: resolvedModelPath,
          config: config,
        });

        if (result?.success) {
          updateBlockDst(index, result.dst);
          showAlert({
            title: t.config.proofread.retranslateSuccess,
            description: t.config.proofread.retranslateSuccessDesc.replace(
              "{index}",
              (index + 1).toString(),
            ),
            variant: "success",
          });
        } else {
          showAlert({
            title: pv.retranslateFailTitle,
            description: result?.error || pv.unknownError,
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Failed to retranslate:", error);
        showAlert({
          title: pv.retranslateErrorTitle,
          description: String(error),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
        setRetranslatingBlocks((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    },
    [
      cacheData,
      loading,
      pv,
      retryAnchorCheck,
      retryAnchorCheckRetries,
      retryCoverageCheck,
      retryCoverageRetries,
      retryCotCoverageThreshold,
      retryCtxSize,
      retryGpuDeviceId,
      retryGpuLayers,
      retryGlossaryPath,
      retryLineCheck,
      retryLineToleranceAbs,
      retryLineTolerancePct,
      retryMaxRetries,
      retryModelPath,
      retryPreset,
      retryPromptFeedback,
      retryRepPenaltyBase,
      retryRepPenaltyMax,
      retryRepPenaltyStep,
      retryStrictMode,
      retryTempBoost,
      retryTemperature,
      retryDeviceMode,
      retryOutputHitThreshold,
      retranslatingBlocks,
      showAlert,
      t.advancedFeatures,
      t.config.proofread.retranslateSuccess,
      t.config.proofread.retranslateSuccessDesc,
      updateBlockDst,
    ],
  );

  const requestRetranslateBlock = useCallback(
    (index: number) => {
      showConfirm({
        title: pv.retranslateConfirmTitle,
        description: pv.retranslateConfirmDesc.replace(
          "{index}",
          String(index + 1),
        ),
        onConfirm: () => retranslateBlock(index),
      });
    },
    [
      pv.retranslateConfirmDesc,
      pv.retranslateConfirmTitle,
      retranslateBlock,
      showConfirm,
    ],
  );

  // --- Replace Logic ---

  // Replace One: Replace the FIRST occurrence in the CURRENT focused match (if it is a DST match)
  const replaceOne = () => {
    if (
      !cacheData ||
      currentMatchIndex === -1 ||
      matchList.length === 0 ||
      !replaceText
    )
      return;

    const match = matchList[currentMatchIndex];
    if (match.type !== "dst") {
      // Skip if match is in source (read-only)
      nextMatch();
      return;
    }

    const block = cacheData.blocks.find((b) => b.index === match.blockIndex);
    if (!block) return;

    try {
      const flags = isRegex ? "gi" : "i";
      const pattern = isRegex
        ? searchKeyword
        : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // We need to replace only ONE instance in this block?
      // Or if the block has multiple matches, which one?
      // Simplifying: Replace ALL occurrences in THIS block first, or just the first one?
      // "Replace" button usually replaces the *currently highlighted* match.
      // Since our highlighting is visual and our search is regex global, locating the specific instance index is hard.
      // Compromise: Replace the First Match in the block string that matches.
      // Limitation: If multiple matches exist in one block, this strategy might replace the wrong one if not careful.
      // But for now, let's just use string.replace (which replaces first occurrence only if global flag not set,
      // but we usually use global for highlight).

      // Let's use a non-global regex to replace just the first occurrence
      const singleRegex = new RegExp(pattern, flags.replace("g", ""));
      const newDst = block.dst.replace(singleRegex, replaceText);

      if (newDst !== block.dst) {
        updateBlockDst(block.index, newDst);
        // Move to next match after replace
        // Note: The match list will update via useEffect, potentially resetting index.
        // We might lose position, but that's acceptable for v1.
      } else {
        nextMatch();
      }
    } catch (e) {
      console.error(e);
      showAlert({
        title: pv.replaceFailTitle,
        description: e instanceof Error ? e.message : String(e),
        variant: "warning",
      });
    }
  };

  // Replace All: Replace ALL occurrences in ALL DST blocks
  const replaceAll = () => {
    if (!cacheData || !searchKeyword) return;

    const executeReplace = () => {
      try {
        const flags = isRegex ? "gi" : "i";
        const pattern = isRegex
          ? searchKeyword
          : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(pattern, flags);

        let replaceCount = 0;
        const newBlocks = cacheData.blocks.map((block) => {
          if (!regex.test(block.dst)) return block;

          // Count matches for stats
          const matches = block.dst.match(regex);
          if (matches) replaceCount += matches.length;

          const newDst = block.dst.replace(regex, replaceText);
          return { ...block, dst: newDst, status: "edited" as const };
        });

        setCacheData({ ...cacheData, blocks: newBlocks });
        setHasUnsavedChanges(true);
        showAlert({
          title: t.config.proofread.replaceAll,
          description: t.config.proofread.replaced.replace(
            "{count}",
            replaceCount.toString(),
          ),
          variant: "success",
        });
      } catch (e) {
        console.error(e);
        showAlert({
          title: pv.replaceFailTitle,
          description: e instanceof Error ? e.message : String(e),
          variant: "warning",
        });
      }
    };

    showConfirm({
      title: t.config.proofread.replaceAll,
      description: `${t.config.proofread.replace} ${matchList.filter((m) => m.type === "dst").length}?`,
      onConfirm: executeReplace,
    });
  };

  // Auto-focus and resize textarea
  useEffect(() => {
    if (editingBlockId !== null && textareaRef.current) {
      textareaRef.current.focus();
      // Auto resize height
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [editingBlockId]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogModal !== null && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [blockLogs, showLogModal]);

  // --- Filtering & Pagination ---

  const filteredBlocks = useMemo(() => {
    if (!cacheData?.blocks) return [];
    return cacheData.blocks.filter((block) => {
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        if (
          !block.src.toLowerCase().includes(kw) &&
          !block.dst.toLowerCase().includes(kw)
        ) {
          return false;
        }
      }
      if (filterWarnings && block.warnings.length === 0) return false;
      return true;
    });
  }, [cacheData?.blocks, searchKeyword, filterWarnings]);

  const totalPages = Math.ceil(filteredBlocks.length / pageSize);
  const paginatedBlocks = useMemo(
    () =>
      filteredBlocks.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [filteredBlocks, currentPage, pageSize],
  );

  // Grid template for synchronized columns (fixed 50:50 layout)
  const gridTemplate = "50% 50%";

  const renderedBlocks = useMemo(() => {
    const highlightRegex = (() => {
      if (!searchKeyword || regexError) return null;
      const flags = isRegex ? "gi" : "i";
      const pattern = isRegex
        ? searchKeyword
        : searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        return new RegExp(`(${pattern})`, flags);
      } catch {
        return null;
      }
    })();

    const renderHighlightedLine = (line: string) => {
      if (!highlightRegex || !line) return line || "\u00A0";
      const parts = line.split(highlightRegex);
      return (
        <>
          {parts.map((part, i) =>
            i % 2 === 1 ? (
              <span key={i} className="bg-yellow-300 text-black rounded px-0.5">
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </>
      );
    };

    if (paginatedBlocks.length === 0) {
      return (
        <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
          <Search className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">{pv.emptyContent}</p>
          <p className="text-xs opacity-70 mt-1">{pv.emptyContentHint}</p>
        </div>
      );
    }

    return paginatedBlocks.map((block) => {
      // Calculate similarity lines for this block
      const simLines = findHighSimilarityLines(block.src, block.dst);
      const simSet = new Set(simLines);

      // In line mode, render line-by-line with synchronized heights
      const displaySrc = stripSystemMarkersForDisplay(
        trimLeadingEmptyLines(block.src),
      );
      const srcLinesRaw = displaySrc.split("\n");
      const dstText =
        editingBlockId === block.index
          ? editingText
          : trimLeadingEmptyLines(block.dst);
      const dstLinesRaw = dstText.split("\n");

      // Align both sides: pad shorter side with empty lines
      const maxLines = Math.max(srcLinesRaw.length, dstLinesRaw.length);
      const srcLines = [
        ...srcLinesRaw,
        ...Array(maxLines - srcLinesRaw.length).fill(""),
      ];
      const dstLines = [
        ...dstLinesRaw,
        ...Array(maxLines - dstLinesRaw.length).fill(""),
      ];

      return (
        <div
          key={block.index}
          id={`block-${block.index}`}
          className={`group hover:bg-muted/30 transition-colors ${editingBlockId === block.index ? "bg-muted/30" : ""}`}
        >
          {/* Block header with info and actions */}
          <div className="flex items-center gap-2 px-3 py-1 border-b border-border/10 bg-muted/20">
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              #{block.index + 1}
            </span>
            <StatusIndicator block={block} />
            <Tooltip content={pv.retranslateBlock}>
              <button
                onClick={() => requestRetranslateBlock(block.index)}
                className={`w-5 h-5 flex items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 ${loading ? "text-muted-foreground" : "text-primary/50 hover:text-primary hover:bg-primary/10"}`}
                disabled={loading}
              >
                <RefreshCw
                  className={`w-3 h-3 ${retranslatingBlocks.has(block.index) ? "animate-spin" : ""}`}
                />
              </button>
            </Tooltip>
            {/* Log button - show when block has logs */}
            {blockLogs[block.index]?.length > 0 && (
              <Tooltip content={pv.viewLogs}>
                <button
                  onClick={() => setShowLogModal(block.index)}
                  className="w-5 h-5 flex items-center justify-center rounded transition-all text-blue-500/70 hover:text-blue-500 hover:bg-blue-500/10"
                >
                  <Terminal className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
          </div>

          {/* Content area: 2-column grid */}
          {lineMode ? (
            // Line Mode: per-row grid for height sync, overlay textarea for editing
            <div className="relative">
              {selectionLock === "src" && (
                <div
                  className="absolute top-0 bottom-0 z-10"
                  style={{
                    left: "50%",
                    right: 0,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    pointerEvents: "auto",
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                />
              )}
              {selectionLock === "dst" && (
                <div
                  className="absolute top-0 bottom-0 z-10"
                  style={{
                    left: 0,
                    right: "50%",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    pointerEvents: "auto",
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                />
              )}
              {/* Display layer: two independent text flows to avoid cross-column copy linkage */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: gridTemplate,
                  gridAutoRows: "minmax(20px, auto)",
                  gridAutoFlow: "row",
                }}
              >
                {Array.from({ length: maxLines }).map((_, lineIdx) => {
                  const srcLine = srcLines[lineIdx] || "";
                  const isWarning = simSet.has(lineIdx + 1);
                  const baseCellStyle: React.CSSProperties = {
                    minHeight: "20px",
                    paddingLeft: "44px",
                    paddingRight: "12px",
                    lineHeight: "20px",
                    fontFamily:
                      '"Cascadia Mono", Consolas, "Meiryo", "MS Gothic", "SimSun", "Courier New", monospace',
                    fontSize: "13px",
                    wordBreak: "break-all",
                  };
                  const srcCellStyle: React.CSSProperties = {
                    ...baseCellStyle,
                    gridColumn: 1,
                    gridRow: lineIdx + 1,
                    userSelect: selectionLock === "dst" ? "none" : "text",
                  };
                  return (
                    <div
                      key={`src-${lineIdx}`}
                      id={`block-${block.index}-src-line-${lineIdx}`}
                      className={`relative border-r border-border/20 ${isWarning ? "bg-amber-500/20" : ""}`}
                      style={srcCellStyle}
                      onMouseDown={() =>
                        flushSync(() => setSelectionLock("src"))
                      }
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: "12px",
                          width: "24px",
                          textAlign: "right",
                          fontSize: "10px",
                          color: "hsl(var(--muted-foreground)/0.5)",
                          userSelect: "none",
                          lineHeight: "20px",
                        }}
                      >
                        {lineIdx + 1}
                      </span>
                      <span className="whitespace-pre-wrap text-foreground select-text">
                        {renderHighlightedLine(srcLine)}
                      </span>
                    </div>
                  );
                })}
                {Array.from({ length: maxLines }).map((_, lineIdx) => {
                  const dstLine = dstLines[lineIdx] || "";
                  const isWarning = simSet.has(lineIdx + 1);
                  const baseCellStyle: React.CSSProperties = {
                    minHeight: "20px",
                    paddingLeft: "44px",
                    paddingRight: "12px",
                    lineHeight: "20px",
                    fontFamily:
                      '"Cascadia Mono", Consolas, "Meiryo", "MS Gothic", "SimSun", "Courier New", monospace',
                    fontSize: "13px",
                    wordBreak: "break-all",
                  };
                  const dstCellStyle: React.CSSProperties = {
                    ...baseCellStyle,
                    gridColumn: 2,
                    gridRow: lineIdx + 1,
                    userSelect: selectionLock === "src" ? "none" : "text",
                  };
                  return (
                    <div
                      key={`dst-${lineIdx}`}
                      id={`block-${block.index}-dst-line-${lineIdx}`}
                      className={`relative cursor-text ${isWarning ? "bg-amber-500/20" : ""}`}
                      style={dstCellStyle}
                      onClick={() => {
                        if (editingBlockId !== block.index) {
                          setEditingBlockId(block.index);
                          setEditingText(dstText);
                        }
                      }}
                      onMouseDown={() =>
                        flushSync(() => setSelectionLock("dst"))
                      }
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: "12px",
                          width: "24px",
                          textAlign: "right",
                          fontSize: "10px",
                          color: "hsl(var(--muted-foreground)/0.5)",
                          userSelect: "none",
                          lineHeight: "20px",
                        }}
                      >
                        {lineIdx + 1}
                      </span>
                      <span
                        className={`whitespace-pre-wrap text-foreground select-text ${editingBlockId === block.index ? "opacity-0" : ""}`}
                      >
                        {renderHighlightedLine(dstLine)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Editing overlay: full-block textarea */}
              {editingBlockId === block.index && (
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {/* Left: transparent placeholder to maintain layout */}
                  <div className="border-r border-border/20" />
                  {/* Right: textarea */}
                  <div className="relative">
                    <textarea
                      autoFocus
                      className="w-full h-full outline-none resize-none border-none m-0 bg-transparent text-foreground"
                      style={{
                        paddingLeft: "44px",
                        paddingRight: "12px",
                        lineHeight: "20px",
                        fontFamily:
                          '"Cascadia Mono", Consolas, "Meiryo", "MS Gothic", "SimSun", "Courier New", monospace',
                        fontSize: "13px",
                        wordBreak: "break-all",
                        whiteSpace: "pre-wrap",
                      }}
                      value={editingText}
                      onChange={(e) => {
                        setEditingText(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      onBlur={(e) => {
                        const newValue = e.target.value;
                        setCacheData((prev) => {
                          if (!prev) return prev;
                          const newBlocks = [...prev.blocks];
                          const targetIdx = newBlocks.findIndex(
                            (b) => b.index === block.index,
                          );
                          if (targetIdx !== -1) {
                            newBlocks[targetIdx] = {
                              ...newBlocks[targetIdx],
                              dst: newValue,
                              status: "edited",
                            };
                          }
                          return { ...prev, blocks: newBlocks };
                        });
                        setHasUnsavedChanges(true);
                        setEditingBlockId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") e.currentTarget.blur();
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Block Mode: Original layout
            <div
              className="grid relative"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground select-text overflow-x-auto border-r border-border/20">
                <HighlightText
                  text={displaySrc}
                  keyword={searchKeyword}
                  warningLines={simSet}
                  showLineNumbers={false}
                  lineIdPrefix={`block-${block.index}-src`}
                />
              </div>
              <div className="relative px-3 py-2 text-sm leading-relaxed overflow-x-auto cursor-text">
                <HighlightText
                  text={dstText}
                  keyword={searchKeyword}
                  warningLines={simSet}
                  showLineNumbers={false}
                  lineIdPrefix={`block-${block.index}-dst`}
                />
                {/* Transparent textarea overlay for seamless editing */}
                <textarea
                  className="absolute inset-0 px-3 py-2 bg-transparent border-none outline-none resize-none"
                  style={{
                    lineHeight: "inherit",
                    color: "transparent",
                    caretColor: "hsl(var(--primary))",
                  }}
                  value={dstText}
                  onChange={(e) => {
                    if (editingBlockId === block.index) {
                      setEditingText(e.target.value);
                    }
                  }}
                  onFocus={() => {
                    setEditingBlockId(block.index);
                    setEditingText(trimLeadingEmptyLines(block.dst));
                  }}
                  onBlur={(e) => {
                    const newText = e.target.value;
                    if (newText !== trimLeadingEmptyLines(block.dst)) {
                      setCacheData((prev) => {
                        if (!prev) return prev;
                        const newBlocks = [...prev.blocks];
                        const targetIdx = newBlocks.findIndex(
                          (b) => b.index === block.index,
                        );
                        if (targetIdx !== -1) {
                          newBlocks[targetIdx] = {
                            ...newBlocks[targetIdx],
                            dst: newText,
                            status: "edited",
                          };
                        }
                        return { ...prev, blocks: newBlocks };
                      });
                      setHasUnsavedChanges(true);
                    }
                    setEditingBlockId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>
      );
    });
  }, [
    paginatedBlocks,
    pv.emptyContent,
    pv.emptyContentHint,
    pv.retranslateBlock,
    pv.viewLogs,
    searchKeyword,
    isRegex,
    regexError,
    editingBlockId,
    editingText,
    lineMode,
    selectionLock,
    loading,
    retranslatingBlocks,
    blockLogs,
    requestRetranslateBlock,
  ]);

  const retryForm = retryDraft || buildRetryDraft();

  const openConsistencyModal = () => {
    const files = getAllHistoryFiles();
    setConsistencyFiles(files);
    setConsistencySelected(new Set(files.map((file) => file.path)));
    setConsistencyGlossaryPath(
      cacheData?.glossaryPath ||
        localStorage.getItem("config_glossary_path") ||
        "",
    );
    setConsistencyResults([]);
    setConsistencyStats({ files: 0, terms: 0, issues: 0 });
    setConsistencyProgress(0);
    setConsistencyExpanded(new Set());
    setShowConsistencyModal(true);
  };

  const toggleConsistencySelection = (path: string) => {
    setConsistencySelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectConsistencyGlossary = async () => {
    try {
      const result = await window.api?.selectFile({
        title: pv.retrySelectGlossaryTitle,
        filters: [
          { name: pv.retryGlossaryFilterName, extensions: ["json", "txt"] },
        ],
      } as any);
      if (result) setConsistencyGlossaryPath(result);
    } catch (e) {
      showAlert({
        title: pv.loadFailTitle,
        description: pv.glossaryLoadFail.replace(
          "{error}",
          e instanceof Error ? e.message : String(e),
        ),
        variant: "destructive",
      });
    }
  };

  const scanConsistency = async () => {
    if (consistencyScanning) return;
    const selectedFiles = consistencyFiles.filter((file) =>
      consistencySelected.has(file.path),
    );
    if (selectedFiles.length === 0) {
      showAlert({
        title: pv.consistencyTitle,
        description: pv.consistencyNoFiles,
        variant: "destructive",
      });
      return;
    }
    if (!consistencyGlossaryPath) {
      showAlert({
        title: pv.consistencyTitle,
        description: pv.consistencyNeedGlossary,
        variant: "destructive",
      });
      return;
    }

    setConsistencyScanning(true);
    setConsistencyResults([]);
    setConsistencyStats({ files: 0, terms: 0, issues: 0 });
    setConsistencyProgress(0);

    try {
      const glossaryContent =
        (await window.api?.readFile(consistencyGlossaryPath)) || "";
      const glossaryMap = parseGlossaryContent(glossaryContent);
      const terms = Object.keys(glossaryMap).filter(
        (term) => term.trim().length > 1,
      );
      if (terms.length === 0) {
        throw new Error(pv.glossaryEmpty);
      }
      const termIndex = buildGlossaryIndex(glossaryMap);

      const termStats = new Map<
        string,
        {
          expected: string;
          total: number;
          matched: number;
          variants: Map<string, ConsistencyVariant>;
        }
      >();

      let processed = 0;
      for (const file of selectedFiles) {
        const data = await window.api?.loadCache(file.path);
        processed += 1;
        setConsistencyProgress(processed / selectedFiles.length);
        if (!data?.blocks) continue;
        const blocks = data.blocks as CacheBlock[];
        for (const block of blocks) {
          const srcLines = String(block.src || "").split(/\r?\n/);
          const dstLines = String(block.dst || "").split(/\r?\n/);
          const dstBlockText = cleanConsistencyLine(block.dst || "");
          const useLineAlign =
            srcLines.length === dstLines.length &&
            !(block.warnings || []).includes("line_mismatch");
          for (let i = 0; i < srcLines.length; i += 1) {
            const srcLine = cleanConsistencyLine(srcLines[i] || "");
            if (!srcLine) continue;
            const dstLine = cleanConsistencyLine(dstLines[i] || "");
            const targetText = useLineAlign ? dstLine : dstBlockText || dstLine;

            const matchedTerms = findTermsInLine(srcLine, termIndex);
            if (matchedTerms.length === 0) continue;

            for (const term of matchedTerms) {
              const expected = glossaryMap[term] || "";
              const variantText = pickConsistencyVariant({
                srcLine,
                term,
                targetText,
                expected,
                unknownLabel: pv.consistencyUnknown,
                useLineAlign,
              });
              let stat = termStats.get(term);
              if (!stat) {
                stat = {
                  expected,
                  total: 0,
                  matched: 0,
                  variants: new Map(),
                };
                termStats.set(term, stat);
              }
              stat.total += 1;
              const normalizedExpected = expected
                ? normalizeVariantToken(expected)
                : "";
              const normalizedVariant = normalizeVariantToken(variantText);
              if (
                normalizedExpected &&
                normalizedVariant === normalizedExpected
              ) {
                stat.matched += 1;
              }
              if (!normalizedVariant || variantText === pv.consistencyUnknown)
                continue;
              const displayVariant =
                normalizedExpected && normalizedVariant === normalizedExpected
                  ? expected
                  : variantText;
              let variant = stat.variants.get(normalizedVariant);
              if (!variant) {
                variant = { text: displayVariant, count: 0, examples: [] };
                stat.variants.set(normalizedVariant, variant);
              } else if (displayVariant.length < variant.text.length) {
                variant.text = displayVariant;
              }
              variant.count += 1;
              if (variant.examples.length < 3) {
                variant.examples.push({
                  file: file.name,
                  cachePath: file.path,
                  blockIndex: block.index,
                  srcLine,
                  dstLine: dstLine || targetText,
                });
              }
            }
          }
        }
      }

      const issues: ConsistencyIssue[] = [];
      termStats.forEach((stat, term) => {
        if (stat.total < consistencyMinOccurrences) return;
        const variants = Array.from(stat.variants.values()).sort(
          (a, b) => b.count - a.count,
        );
        if (variants.length <= 1) return;
        issues.push({
          term,
          expected: stat.expected,
          total: stat.total,
          matched: stat.matched,
          variants,
        });
      });
      issues.sort((a, b) => b.total - a.total);
      setConsistencyResults(issues);
      setConsistencyStats({
        files: selectedFiles.length,
        terms: terms.length,
        issues: issues.length,
      });
    } catch (e) {
      showAlert({
        title: pv.consistencyTitle,
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setConsistencyScanning(false);
    }
  };

  // --- Helper UI ---

  // Status Indicator
  function StatusIndicator({ block }: { block: CacheBlock }) {
    if (block.warnings.length > 0)
      return (
        <Tooltip content={block.warnings.join(", ")}>
          <div>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
        </Tooltip>
      );
    if (block.status === "edited")
      return (
        <Tooltip content={pv.tooltipEdited}>
          <div className="w-2 h-2 rounded-full bg-blue-500" />
        </Tooltip>
      );
    if (block.status === "processed")
      return (
        <Tooltip content={pv.tooltipProcessed}>
          <div>
            <Check className="w-3 h-3 text-green-500/50" />
          </div>
        </Tooltip>
      );
    return null;
  }

  // Container ref for scrolling
  const containerRef = useRef<HTMLDivElement>(null);

  // Helper: trim leading empty lines from block text
  function trimLeadingEmptyLines(text: string) {
    const lines = text.split("\n");
    let startIdx = 0;
    while (startIdx < lines.length && lines[startIdx].trim() === "") {
      startIdx++;
    }
    return lines.slice(startIdx).join("\n");
  }

  // Get ALL cache files from translation history
  const getAllHistoryFiles = (): HistoryCacheFile[] => {
    try {
      const historyStr = localStorage.getItem("translation_history");
      if (!historyStr) return [];
      const history = JSON.parse(historyStr) as any[];
      const seen = new Set<string>();
      return history
        .reverse() // Show newest first
        .map((h) => {
          // Try to derive cache path
          // Priority: Explicit cachePath > Output Path + .cache.json > Input Path + .cache.json
          let cachePath = h.cachePath;
          if (!cachePath && h.outputPath) {
            cachePath = h.outputPath + ".cache.json";
          }
          if (!cachePath && h.filePath) {
            cachePath = h.filePath + ".cache.json";
          }
          return { ...h, cachePath };
        })
        .filter(
          (h) =>
            h.cachePath &&
            !seen.has(h.cachePath) &&
            (seen.add(h.cachePath), true),
        )
        .map((h) => ({
          path: h.cachePath!,
          name: h.fileName || h.cachePath!.split(/[/\\]/).pop() || h.cachePath!,
          date: h.startTime
            ? new Date(h.startTime).toLocaleString()
            : h.timestamp
              ? new Date(h.timestamp).toLocaleString()
              : "",
          inputPath: h.filePath || h.inputPath,
          model: h.modelName || h.model,
        }));
    } catch {
      return [];
    }
  };

  // Get recent 5 for quick access
  const getRecentCacheFiles = () => getAllHistoryFiles().slice(0, 5);

  const recentFiles = getRecentCacheFiles();

  // Check for target file from LibraryView navigation (on mount)
  useEffect(() => {
    const targetFile = localStorage.getItem("proofread_target_file");
    if (targetFile) {
      localStorage.removeItem("proofread_target_file"); // Clear to prevent re-loading
      loadCacheFromPath(targetFile);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load specific cache file
  const loadCacheFromPath = async (path: string) => {
    if (!path) return;
    setLoading(true);
    try {
      console.log("[Proofread] Attempting to load cache:", path);
      // @ts-ignore
      const data = await window.api.loadCache(path);
      if (data && data.blocks) {
        await processLoadedData(data, path);
      } else {
        const msg = !data ? pv.fileMissing : pv.fileInvalid;
        console.error(`[Proofread] ${msg}:`, path);
        throw new Error(msg);
      }
    } catch (e) {
      console.error("Failed to load cache:", e);
      showAlert({
        title: pv.loadProofreadFailTitle,
        description: pv.loadProofreadFailDesc
          .replace("{path}", path)
          .replace("{error}", e instanceof Error ? e.message : String(e)),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // If no data
  if (!cacheData) {
    const allHistory = getAllHistoryFiles();

    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-muted-foreground select-none">
        <div className="p-8 rounded-full bg-muted/30">
          <FolderOpen className="w-12 h-12 opacity-50" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            {t.config.proofread.title}
          </h2>
          <p>{t.config.proofread.desc}</p>
        </div>

        {/* Main Actions */}
        <div className="flex items-center gap-3">
          <Button onClick={loadCache} size="lg" className="gap-2">
            <FolderOpen className="w-5 h-5" />
            {t.config.proofread.open}
          </Button>

          {allHistory.length > 0 && (
            <Button
              onClick={() => setShowHistoryModal(true)}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <History className="w-5 h-5" />
              {pv.historyTitleWithCount.replace(
                "{count}",
                String(allHistory.length),
              )}
            </Button>
          )}
        </div>

        {/* Recent Files (Quick Access) */}
        {recentFiles.length > 0 && (
          <div className="mt-4 w-full max-w-md">
            <p className="text-xs text-muted-foreground/70 mb-2 text-center">
              {t.config.proofread.recentFiles}
            </p>
            <div className="border rounded-lg divide-y bg-card/50">
              {recentFiles.map((file, i) => (
                <button
                  key={i}
                  onClick={() => loadCacheFromPath(file.path)}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                  disabled={loading}
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {file.path}
                    </p>
                  </div>
                  {file.date && (
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {file.date}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-1 mt-2 text-xs text-muted-foreground/60">
          <span>
            {t.config.proofread.defaultKey}:{" "}
            {localStorage.getItem("config_cache_dir") ||
              t.config.proofread.unset}
          </span>
        </div>

        {/* History Modal */}
        {showHistoryModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowHistoryModal(false)}
          >
            <div
              className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <History className="w-5 h-5 text-primary" />
                  {pv.historyTitle}
                </h3>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="p-1.5 hover:bg-muted rounded-md"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y">
                {allHistory.map((file, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      loadCacheFromPath(file.path);
                      setShowHistoryModal(false);
                    }}
                    className="w-full px-6 py-3 flex items-center gap-4 hover:bg-muted/50 transition-colors text-left"
                  >
                    <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {file.inputPath || file.path}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {file.date && (
                        <p className="text-xs text-muted-foreground">
                          {file.date}
                        </p>
                      )}
                      {file.model && (
                        <p className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                          {file.model}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Helper to highlight text with search and line warnings
  function HighlightText({
    text,
    keyword,
    warningLines,
    isDoubleSpace = true,
    showLineNumbers = false,
    lineIdPrefix,
  }: {
    text: string;
    keyword: string;
    warningLines?: Set<number>;
    isDoubleSpace?: boolean;
    showLineNumbers?: boolean;
    lineIdPrefix?: string;
  }) {
    if (!text) return null;

    const lines = text.split(/\r?\n/);
    // In line mode, show all lines including empty ones for strict alignment
    const effectiveDoubleSpace = showLineNumbers ? false : isDoubleSpace;

    return (
      <div
        className={`flex flex-col w-full ${showLineNumbers ? "font-mono text-[13px]" : ""}`}
      >
        {lines.map((line, idx) => {
          // Check if this line is in warnings (1-based index in set)
          const isWarning = warningLines?.has(idx + 1);
          const isEmpty = !line.trim();

          // Search highlight logic
          const renderContent = () => {
            if (!keyword || !line)
              return line || (showLineNumbers ? "\u00A0" : <br />);
            try {
              const flags = isRegex ? "gi" : "i";
              const pattern = isRegex
                ? keyword
                : keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const regex = new RegExp(`(${pattern})`, flags);
              const parts = line.split(regex);
              return (
                <>
                  {parts.map((part, i) =>
                    i % 2 === 1 ? (
                      <span
                        key={i}
                        className="bg-yellow-300 text-black rounded px-0.5"
                      >
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )}
                </>
              );
            } catch {
              return line;
            }
          };

          // In line mode, show all lines for strict alignment
          // In block mode, hide empty lines and add spacing
          if (effectiveDoubleSpace && isEmpty) {
            return (
              <div
                key={idx}
                id={lineIdPrefix ? `${lineIdPrefix}-line-${idx}` : undefined}
                className="hidden"
              />
            );
          }

          return (
            <div
              key={idx}
              id={lineIdPrefix ? `${lineIdPrefix}-line-${idx}` : undefined}
              className={`
                                flex items-start gap-2
                                ${isWarning ? "bg-amber-500/20 rounded" : ""}
                                ${effectiveDoubleSpace ? "mb-6" : "min-h-[1.5em]"}
                            `}
            >
              {showLineNumbers && (
                <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground/50 select-none pt-0.5">
                  {idx + 1}
                </span>
              )}
              <span
                className={`flex-1 break-words whitespace-pre-wrap text-foreground ${showLineNumbers ? "" : "w-full"}`}
              >
                {renderContent()}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 relative z-0">
        {/* --- Toolbar --- */}
        <div
          className={`px-4 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-2 bg-card shrink-0 min-w-0 ${
            showQualityCheck ? "overflow-hidden" : ""
          }`}
        >
          {/* File Info */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col">
              <span
                className="text-sm font-medium truncate max-w-[180px]"
                title={cachePath}
              >
                {cachePath.split(/[/\\]/).pop()}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-2">
                <span>
                  {pv.statsBlocks.replace(
                    "{count}",
                    String(cacheData.stats.blockCount),
                  )}
                </span>
                <span>
                  {pv.statsLines.replace(
                    "{count}",
                    String(cacheData.stats.srcLines),
                  )}
                </span>
                {Object.keys(glossary).length > 0 ? (
                  <Tooltip content={pv.glossaryLoaded}>
                    <span className="flex items-center gap-1 text-primary/80">
                      <Book className="w-3 h-3" />{" "}
                      {Object.keys(glossary).length}
                    </span>
                  </Tooltip>
                ) : (
                  cacheData.glossaryPath && (
                    <Tooltip
                      content={
                        glossaryLoadError
                          ? pv.glossaryLoadFail.replace(
                              "{error}",
                              glossaryLoadError,
                            )
                          : pv.glossaryEmpty
                      }
                    >
                      <span className="flex items-center gap-1 text-amber-500">
                        <AlertTriangle className="w-3 h-3" /> 0
                      </span>
                    </Tooltip>
                  )
                )}
              </span>
            </div>
          </div>

          <div className="w-px h-8 bg-border" />

          {/* Search Bar - Compact */}
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[360px] max-w-lg">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={pv.searchPlaceholder}
                className={`w-full h-8 pl-7 pr-3 py-1.5 text-sm bg-secondary/50 border rounded-md focus:bg-background transition-colors outline-none font-mono ${
                  regexError
                    ? "border-amber-500/60 bg-amber-500/5"
                    : "border-border"
                }`}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (e.shiftKey) prevMatch();
                    else nextMatch();
                  }
                }}
              />
            </div>
            {/* Search controls */}
            {searchKeyword && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <span className="tabular-nums">
                  {matchList.length > 0 ? currentMatchIndex + 1 : 0}/
                  {matchList.length}
                </span>
                {regexError && (
                  <Tooltip
                    content={pv.regexInvalid.replace("{error}", regexError)}
                  >
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="w-3 h-3" />
                      {pv.regexInvalidBadge}
                    </span>
                  </Tooltip>
                )}
                {!regexError && matchList.length === 0 && (
                  <Tooltip content={pv.noMatchTooltip}>
                    <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                      <AlertTriangle className="w-3 h-3" />
                      {pv.noMatchBadge}
                    </span>
                  </Tooltip>
                )}
                <Tooltip content={pv.prevMatch}>
                  <button
                    onClick={prevMatch}
                    className="p-0.5 hover:bg-secondary rounded"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content={pv.nextMatch}>
                  <button
                    onClick={nextMatch}
                    className="p-0.5 hover:bg-secondary rounded"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            )}
            {/* Toggles */}
            <Tooltip content={pv.regexMode}>
              <button
                onClick={() => setIsRegex(!isRegex)}
                className={`h-8 w-8 inline-flex items-center justify-center rounded text-xs ${isRegex ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Regex className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={pv.findReplace}>
              <button
                onClick={() => setShowReplace(!showReplace)}
                className={`h-8 w-8 inline-flex items-center justify-center rounded text-xs ${showReplace ? "bg-secondary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Replace className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={pv.onlyWarnings}>
              <button
                onClick={() => {
                  setFilterWarnings(!filterWarnings);
                  setCurrentPage(1);
                }}
                className={`h-8 w-8 inline-flex items-center justify-center rounded text-xs ${filterWarnings ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Filter className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={lineMode ? pv.lineModeHint : pv.blockModeHint}>
              <button
                onClick={() => setLineMode(!lineMode)}
                className={`h-8 w-8 inline-flex items-center justify-center rounded text-xs ${lineMode ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <AlignJustify className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3 ml-auto shrink-0 pl-1">
            <Button
              variant={showRetryPanel ? "secondary" : "ghost"}
              size="sm"
              onClick={openRetryPanel}
              className="h-8 text-xs px-3"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              {pv.retryPanelButton}
            </Button>

            {/* Quality Check - Text Button */}
            <Button
              variant={showQualityCheck ? "secondary" : "ghost"}
              size="sm"
              onClick={() =>
                setShowQualityCheck((prev) => {
                  const next = !prev;
                  if (next) setShowRetryPanel(false);
                  return next;
                })
              }
              className={`h-8 text-xs px-3 ${showQualityCheck ? "bg-primary/10 text-primary dark:bg-primary/20" : ""}`}
            >
              <FileCheck className="w-3.5 h-3.5 mr-1" />
              {t.config.proofread.qualityCheck}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={openConsistencyModal}
              className="h-8 text-xs px-3"
            >
              <ListChecks className="w-3.5 h-3.5 mr-1" />
              {t.config.proofread.consistencyCheck}
            </Button>

            <div className="w-px h-5 bg-border" />

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={loadCache}
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1" />{" "}
              {t.config.proofread.openBtn}
            </Button>
            <Button
              variant={hasUnsavedChanges ? "default" : "outline"}
              size="sm"
              className={`h-8 text-xs relative ${hasUnsavedChanges ? "ring-1 ring-amber-500" : ""}`}
              onClick={saveCache}
              disabled={loading}
            >
              <Save
                className={`w-3.5 h-3.5 mr-1 ${hasUnsavedChanges ? "animate-pulse" : ""}`}
              />
              {t.config.proofread.saveBtn}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-xs"
              onClick={exportTranslation}
              disabled={loading}
            >
              <Download className="w-3.5 h-3.5 mr-1" />{" "}
              {t.config.proofread.exportBtn}
            </Button>
          </div>
        </div>

        {/* --- Replace Bar (Optional) --- */}
        {showReplace && (
          <div className="px-6 py-2 border-b bg-muted/30 flex items-center justify-center gap-4 animate-in slide-in-from-top-1 fade-in duration-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t.config.proofread.replace}
              </span>
              <div className="relative">
                <input
                  type="text"
                  className="w-64 px-3 py-1.5 text-sm bg-background border rounded-md outline-none focus:ring-1 focus:ring-primary"
                  placeholder={t.config.proofread.replacePlaceholder}
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={replaceOne}
                disabled={
                  !searchKeyword ||
                  matchList.length === 0 ||
                  Boolean(regexError)
                }
              >
                <Replace className="w-3.5 h-3.5 mr-1" />
                {t.config.proofread.replace}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={replaceAll}
                disabled={
                  !searchKeyword ||
                  matchList.length === 0 ||
                  Boolean(regexError)
                }
              >
                <ReplaceAll className="w-3.5 h-3.5 mr-1" />
                {t.config.proofread.replaceAll}
              </Button>
            </div>
          </div>
        )}

        {/* --- Main Content: Grid Layout --- */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border"
        >
          {/* Header Row */}
          <div
            className="sticky top-0 z-20 grid bg-muted/80 backdrop-blur border-b text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="px-4 py-2 border-r border-border/50">
              {pv.sourceTitle}
            </div>
            <div className="px-4 py-2">{pv.targetTitle}</div>
          </div>

          {/* Blocks */}
          <div className="divide-y divide-border/30">{renderedBlocks}</div>

          {/* --- Pagination Footer --- */}
          {totalPages > 1 && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t p-2 flex items-center justify-center gap-4 z-20">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> {pv.pagePrev}
              </Button>
              <span className="text-sm font-medium text-muted-foreground">
                {pv.pageLabel
                  .replace("{current}", String(currentPage))
                  .replace("{total}", String(totalPages))}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                {pv.pageNext} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* --- Retry Settings Modal --- */}
      {showRetryPanel && retryDraft && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeRetryPanel}
          />
          <div className="relative w-full max-w-3xl max-h-[85vh] bg-background rounded-xl border border-border shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <RefreshCw className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-medium">{pv.retryPanelTitle}</h3>
                  <p className="text-xs text-muted-foreground">
                    {pv.retryPanelDesc}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={closeRetryPanel}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
              <div className="space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionModel}
                </div>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryModelPath}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="w-full border p-2 rounded text-sm bg-secondary"
                        value={retryForm.modelPath}
                        onChange={(e) =>
                          updateRetryDraft({ modelPath: e.target.value })
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 text-xs shrink-0"
                        onClick={selectRetryModel}
                      >
                        {pv.retrySelectModel}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryGlossaryPath}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="w-full border p-2 rounded text-sm bg-secondary"
                        value={retryForm.glossaryPath}
                        onChange={(e) =>
                          updateRetryDraft({ glossaryPath: e.target.value })
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 text-xs shrink-0"
                        onClick={selectRetryGlossary}
                      >
                        {pv.retrySelectGlossary}
                      </Button>
                    </div>
                    {cacheData?.glossaryPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() =>
                          updateRetryDraft({
                            glossaryPath: cacheData.glossaryPath!,
                          })
                        }
                      >
                        {pv.retryUseCacheGlossary}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionInference}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {t.config.promptPreset}
                    </label>
                    <select
                      className="w-full border border-border p-2 rounded bg-secondary text-foreground text-xs"
                      value={retryForm.preset}
                      onChange={(e) =>
                        updateRetryDraft({ preset: e.target.value })
                      }
                    >
                      <option value="novel">
                        {t.dashboard.promptPresetLabels.novel}
                      </option>
                      <option value="script">
                        {t.dashboard.promptPresetLabels.script}
                      </option>
                      <option value="short">
                        {t.dashboard.promptPresetLabels.short}
                      </option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {t.config.device.mode}
                    </label>
                    <select
                      className="w-full border border-border p-2 rounded bg-secondary text-foreground text-xs"
                      value={retryForm.deviceMode}
                      onChange={(e) =>
                        updateRetryDraft({
                          deviceMode: e.target.value as "auto" | "cpu",
                        })
                      }
                    >
                      <option value="auto">{t.config.device.modes.auto}</option>
                      <option value="cpu">{t.config.device.modes.cpu}</option>
                    </select>
                  </div>
                  {retryForm.deviceMode === "auto" && (
                    <div className="space-y-2 col-span-2">
                      <label className="text-xs text-muted-foreground">
                        {t.config.device.gpuId}
                      </label>
                      <input
                        type="text"
                        className="w-full border p-2 rounded text-sm bg-secondary"
                        value={retryForm.gpuDeviceId}
                        onChange={(e) =>
                          updateRetryDraft({ gpuDeviceId: e.target.value })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {t.config.device.gpuIdDesc}
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {t.config.gpuLayers}
                    </label>
                    <select
                      className="w-full border border-border p-2 rounded bg-secondary text-foreground text-xs"
                      value={retryForm.gpuLayers}
                      onChange={(e) =>
                        updateRetryDraft({ gpuLayers: e.target.value })
                      }
                      disabled={retryForm.deviceMode === "cpu"}
                    >
                      <option value="-1">-1</option>
                      <option value="0">0</option>
                      <option value="16">16</option>
                      <option value="24">24</option>
                      <option value="32">32</option>
                      <option value="48">48</option>
                      <option value="64">64</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {t.config.ctxSize}
                    </label>
                    <input
                      type="number"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.ctxSize}
                      onChange={(e) =>
                        updateRetryDraft({ ctxSize: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionSampling}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryTemperature}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.temperature}
                      onChange={(e) =>
                        updateRetryDraft({
                          temperature: parseFloat(e.target.value) || 0.7,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryStrictMode}
                    </label>
                    <select
                      className="w-full border border-border p-2 rounded bg-secondary text-foreground text-xs"
                      value={retryForm.strictMode}
                      onChange={(e) =>
                        updateRetryDraft({ strictMode: e.target.value })
                      }
                    >
                      <option value="off">{av.strictModeOff}</option>
                      <option value="subs">{av.strictModeSubs}</option>
                      <option value="all">{av.strictModeAll}</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryRepPenaltyBase}
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.repPenaltyBase}
                      onChange={(e) =>
                        updateRetryDraft({
                          repPenaltyBase: parseFloat(e.target.value) || 1.0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryRepPenaltyMax}
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.repPenaltyMax}
                      onChange={(e) =>
                        updateRetryDraft({
                          repPenaltyMax: parseFloat(e.target.value) || 1.5,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryRepPenaltyStep}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.repPenaltyStep}
                      onChange={(e) =>
                        updateRetryDraft({
                          repPenaltyStep: parseFloat(e.target.value) || 0.1,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionStructural}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{pv.retryLineCheck}</span>
                  <Switch
                    checked={retryForm.lineCheck}
                    onCheckedChange={(v) => updateRetryDraft({ lineCheck: v })}
                  />
                </div>
                {retryForm.lineCheck && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {pv.retryLineToleranceAbs}
                      </label>
                      <input
                        type="number"
                        className="w-full border p-2 rounded text-sm bg-secondary text-center"
                        value={retryForm.lineToleranceAbs}
                        onChange={(e) =>
                          updateRetryDraft({
                            lineToleranceAbs: parseInt(e.target.value, 10) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {pv.retryLineTolerancePct}
                      </label>
                      <input
                        type="number"
                        className="w-full border p-2 rounded text-sm bg-secondary text-center"
                        value={retryForm.lineTolerancePct}
                        onChange={(e) =>
                          updateRetryDraft({
                            lineTolerancePct: parseInt(e.target.value, 10) || 0,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm">{pv.retryAnchorCheck}</span>
                  <Switch
                    checked={retryForm.anchorCheck}
                    onCheckedChange={(v) =>
                      updateRetryDraft({ anchorCheck: v })
                    }
                  />
                </div>
                {retryForm.anchorCheck && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryAnchorRetries}
                    </label>
                    <input
                      type="number"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.anchorCheckRetries}
                      onChange={(e) =>
                        updateRetryDraft({
                          anchorCheckRetries: parseInt(e.target.value, 10) || 1,
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="space-y-4 border-t pt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionDynamic}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryMaxRetries}
                    </label>
                    <input
                      type="number"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.maxRetries}
                      onChange={(e) =>
                        updateRetryDraft({
                          maxRetries: parseInt(e.target.value, 10) || 1,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.retryTempBoost}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={retryForm.retryTempBoost}
                      onChange={(e) =>
                        updateRetryDraft({
                          retryTempBoost: parseFloat(e.target.value) || 0.0,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{pv.retryPromptFeedback}</span>
                  <Switch
                    checked={retryForm.retryPromptFeedback}
                    onCheckedChange={(v) =>
                      updateRetryDraft({ retryPromptFeedback: v })
                    }
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pv.retrySectionCoverage}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{pv.retryCoverageCheck}</span>
                  <Switch
                    checked={retryForm.coverageCheck}
                    onCheckedChange={(v) =>
                      updateRetryDraft({ coverageCheck: v })
                    }
                  />
                </div>
                {retryForm.coverageCheck && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {pv.retryOutputHitThreshold}
                        </label>
                        <input
                          type="number"
                          className="w-full border p-2 rounded text-sm bg-secondary text-center"
                          value={retryForm.outputHitThreshold}
                          onChange={(e) =>
                            updateRetryDraft({
                              outputHitThreshold:
                                parseInt(e.target.value, 10) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {pv.retryCotCoverageThreshold}
                        </label>
                        <input
                          type="number"
                          className="w-full border p-2 rounded text-sm bg-secondary text-center"
                          value={retryForm.cotCoverageThreshold}
                          onChange={(e) =>
                            updateRetryDraft({
                              cotCoverageThreshold:
                                parseInt(e.target.value, 10) || 0,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {pv.retryCoverageRetries}
                      </label>
                      <input
                        type="number"
                        className="w-full border p-2 rounded text-sm bg-secondary text-center"
                        value={retryForm.coverageRetries}
                        onChange={(e) =>
                          updateRetryDraft({
                            coverageRetries: parseInt(e.target.value, 10) || 1,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t bg-background/95 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeRetryPanel}>
                {t.cancel}
              </Button>
              <Button size="sm" onClick={saveRetryPanel}>
                {t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Quality Check Side Panel --- */}
      {showQualityCheck && cacheData && (
        <div className="w-[400px] shrink-0 border-l bg-background flex flex-col animate-in slide-in-from-right-2 duration-200 relative z-10">
          <div className="p-3 border-b flex items-center justify-between bg-muted/30">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-primary" />
              {t.config.proofread.qualityCheck}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowQualityCheck(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ResultChecker
              lang={lang}
              cacheData={cacheData}
              glossary={glossary}
              onNavigateToBlock={(blockIndex) => {
                // Navigate to block in main view
                const page = Math.floor(blockIndex / pageSize) + 1;
                if (page !== currentPage) setCurrentPage(page);
                setTimeout(() => {
                  const el = document.getElementById(`block-${blockIndex}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 100);
              }}
            />
          </div>
        </div>
      )}

      {/* --- Global Consistency Modal --- */}
      {showConsistencyModal && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowConsistencyModal(false)}
          />
          <div
            className="relative w-full max-w-5xl max-h-[80vh] bg-card border rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <ListChecks className="w-5 h-5 text-primary" />
                  {pv.consistencyTitle}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {pv.consistencyDesc}
                </p>
              </div>
              <button
                onClick={() => setShowConsistencyModal(false)}
                className="p-1.5 hover:bg-muted rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex">
              <div className="w-[320px] border-r p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium">
                    {pv.consistencyFiles}
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() =>
                        setConsistencySelected(
                          new Set(consistencyFiles.map((file) => file.path)),
                        )
                      }
                      className="text-primary hover:underline"
                    >
                      {pv.consistencySelectAll}
                    </button>
                    <button
                      onClick={() => setConsistencySelected(new Set())}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {pv.consistencyClear}
                    </button>
                  </div>
                </div>
                {consistencyFiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {pv.consistencyNoFiles}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {consistencyFiles.map((file) => (
                      <label
                        key={file.path}
                        className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={consistencySelected.has(file.path)}
                          onChange={() => toggleConsistencySelection(file.path)}
                          className="w-4 h-4 mt-0.5 rounded border-border shrink-0 accent-primary"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {file.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {file.path}
                          </p>
                          {file.date && (
                            <p className="text-[10px] text-muted-foreground/60">
                              {file.date}
                            </p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-medium">
                    {pv.consistencyGlossary}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={consistencyGlossaryPath}
                      onChange={(e) =>
                        setConsistencyGlossaryPath(e.target.value)
                      }
                      placeholder={pv.consistencyGlossaryPlaceholder}
                      className="flex-1 border rounded-md px-3 py-2 text-xs bg-background"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectConsistencyGlossary}
                    >
                      {pv.retrySelectGlossary}
                    </Button>
                  </div>
                  {!consistencyGlossaryPath && (
                    <p className="text-xs text-amber-600">
                      {pv.consistencyNeedGlossary}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {pv.consistencyMinOccurrences}
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="w-full border p-2 rounded text-sm bg-secondary text-center"
                      value={consistencyMinOccurrences}
                      onChange={(e) =>
                        setConsistencyMinOccurrences(
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1 flex items-end">
                    <span className="text-xs text-muted-foreground">
                      {consistencyScanning
                        ? `${pv.consistencyScanning} ${Math.round(consistencyProgress * 100)}%`
                        : " "}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {pv.consistencyResults}
                    </span>
                    {consistencyStats.files > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {pv.consistencySummary
                          .replace("{files}", String(consistencyStats.files))
                          .replace("{issues}", String(consistencyStats.issues))}
                      </span>
                    )}
                  </div>
                  {consistencyResults.length === 0 ? (
                    <div className="border border-dashed rounded-lg p-3 text-xs text-muted-foreground">
                      {pv.consistencyNoResults}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {consistencyResults.map((issue) => {
                        const expanded = consistencyExpanded.has(issue.term);
                        return (
                          <div
                            key={issue.term}
                            className="border rounded-lg p-3 bg-card/50"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {issue.term}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {pv.consistencyExpected}:{" "}
                                  {issue.expected || pv.consistencyUnknown}
                                </p>
                              </div>
                              <div className="text-[11px] text-muted-foreground text-right">
                                <div>
                                  {pv.consistencyOccurrences}: {issue.total}
                                </div>
                                <div>
                                  {pv.consistencyVariants}:{" "}
                                  {issue.variants.length}
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {issue.variants.map((variant) => (
                                <span
                                  key={`${issue.term}-${variant.text}`}
                                  className="text-[11px] px-2 py-1 rounded-full border border-border/60 bg-muted/40 text-foreground"
                                >
                                  {variant.text} · {variant.count}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2">
                              <button
                                onClick={() =>
                                  setConsistencyExpanded((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(issue.term))
                                      next.delete(issue.term);
                                    else next.add(issue.term);
                                    return next;
                                  })
                                }
                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              >
                                {expanded
                                  ? pv.consistencyHideExamples
                                  : pv.consistencyShowExamples}
                                {expanded ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                            {expanded && (
                              <div className="mt-3 space-y-2">
                                {issue.variants.map((variant) => (
                                  <div
                                    key={`${issue.term}-${variant.text}-examples`}
                                    className="border rounded-md p-2 bg-background/60"
                                  >
                                    <div className="text-[11px] font-medium text-foreground mb-1">
                                      {variant.text} · {variant.count}
                                    </div>
                                    {variant.examples.map((example, idx) => (
                                      <div
                                        key={`${issue.term}-${variant.text}-${idx}`}
                                        className="text-[10px] text-muted-foreground mb-1 last:mb-0"
                                      >
                                        <div className="truncate">
                                          {example.file} · #
                                          {example.blockIndex + 1}
                                        </div>
                                        <div className="font-mono text-[10px] truncate">
                                          {example.srcLine}
                                        </div>
                                        <div className="font-mono text-[10px] truncate">
                                          {example.dstLine}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-3 border-t flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {consistencySelected.size} / {consistencyFiles.length}{" "}
                {pv.consistencySelectedSuffix}
              </div>
              <Button
                size="sm"
                onClick={scanConsistency}
                disabled={consistencyScanning}
              >
                {consistencyScanning
                  ? pv.consistencyScanning
                  : pv.consistencyScan}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Log Modal (Terminal) --- */}
      {showLogModal !== null && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowLogModal(null)}
          />
          <div className="relative w-full max-w-3xl max-h-[80vh] bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Terminal className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-zinc-100">
                    {pv.inferenceDetailTitle.replace(
                      "{index}",
                      String(showLogModal + 1),
                    )}
                  </h3>
                  <p className="text-xs text-zinc-500">{pv.logSubtitle}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-zinc-400 hover:text-white"
                onClick={() => setShowLogModal(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div
              ref={logScrollRef}
              className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed text-zinc-300 scrollbar-thin scrollbar-thumb-zinc-700 bg-black/20"
            >
              {(blockLogs[showLogModal] || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
                  <Clock className="w-8 h-8 opacity-20" />
                  <p>{pv.logWaiting}</p>
                </div>
              ) : (
                (blockLogs[showLogModal] || []).map((line, i) => (
                  <div
                    key={i}
                    className="mb-1 last:mb-0 break-words whitespace-pre-wrap"
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-zinc-800 bg-zinc-900/80 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400"
                onClick={() => setShowLogModal(null)}
              >
                {pv.close}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertModal {...alertProps} />
    </div>
  );
}
