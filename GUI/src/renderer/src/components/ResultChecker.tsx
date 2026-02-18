/**
 * ResultChecker - 翻译质量检查组件
 * 用于检测和展示翻译结果中的潜在问题
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/core";
import { Button } from "./ui/core";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { Language, translations } from "../lib/i18n";
import {
  calculateSimilarity,
  findHighSimilarityLines,
  detectKanaResidue,
  normalizeForSimilarity,
  countJapaneseChars,
  countMeaningfulChars,
  getEffectiveLineCount,
} from "../lib/quality-check";

// 问题类型定义
interface QualityIssue {
  blockIndex: number;
  type:
    | "kana_residue"
    | "glossary_miss"
    | "high_similarity"
    | "line_mismatch"
    | "empty_output";
  severity: "warning" | "error" | "info";
  message: string;
  srcPreview: string;
  dstPreview: string;
  suggestion?: string;
}

// 缓存数据类型
interface CacheBlock {
  index: number;
  src: string;
  dst: string;
  srcLines: number;
  dstLines: number;
  cot?: string;
}

interface CacheData {
  blocks: CacheBlock[];
  glossaryPath?: string;
}

interface ResultCheckerProps {
  lang: Language;
  cacheData?: CacheData;
  glossary?: Record<string, string>;
  onNavigateToBlock?: (index: number) => void;
}

// 检测术语表覆盖率
// 检测术语表未生效 (严格模式：列出所有在原文出现但在译文丢失的术语)
// 可选：检查 CoT 是否提及，作为辅助信息
function detectGlossaryMiss(
  src: string,
  dst: string,
  glossary: Record<string, string>,
  cot: string = "",
): { missed: string[]; cotFound: string[] } {
  const missed: string[] = [];
  const cotFound: string[] = [];

  // DEBUG: Only log first check to avoid spam
  const debug = (window as any)._glossary_debug_once !== true;
  if (debug) {
    console.log(
      `[ResultChecker] Checking glossary against src (len=${src.length})`,
    );
    console.log(`[ResultChecker] Glossary keys:`, Object.keys(glossary));
    (window as any)._glossary_debug_once = true;
  }

  for (const [jp, zh] of Object.entries(glossary)) {
    if (src.includes(jp)) {
      // 原文包含该术语
      if (!dst.includes(zh)) {
        // 译文未包含该术语 -> 缺失
        missed.push(`${jp} → ${zh}`);
        console.warn(`[ResultChecker] Missed: ${jp} -> ${zh}`);

        // 检查 CoT 是否提及 (辅助信息)
        if (cot && cot.includes(jp)) {
          cotFound.push(jp);
        }
      } else {
        if (debug) console.log(`[ResultChecker] Matched: ${jp} -> ${zh}`);
      }
    } else {
      // Debug why not matching src?
      // if (debug) console.log(`[ResultChecker] Src does not contain: ${jp}`)
    }
  }
  return { missed, cotFound };
}

export function ResultChecker({
  lang,
  cacheData,
  glossary,
  onNavigateToBlock,
}: ResultCheckerProps) {
  const t = translations[lang].resultChecker;
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIssues, setExpandedIssues] = useState<Set<number>>(new Set());
  const [localCacheData, setLocalCacheData] = useState<CacheData | null>(null);
  const [localCachePath, setLocalCachePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 优先使用传入的 cacheData，如果没有则使用本地加载的 localCacheData
  const displayData = cacheData || localCacheData;

  const handleLoadCache = async () => {
    try {
      setLoadError(null);
      const path = await window.api?.selectFile({
        title: t.openCacheTitle,
        filters: [{ name: "JSON Cache", extensions: ["json"] }],
      });
      if (path && window.api?.loadCache) {
        const data = await window.api.loadCache(path);
        if (data) {
          setLocalCacheData(data);
          setLocalCachePath(path);
          setLoadError(null);
        } else {
          setLoadError(t.cacheEmptyError);
        }
      }
    } catch (e) {
      console.error(e);
      setLoadError(t.cacheReadFailed.replace("{error}", String(e)));
    }
  };

  // 分析缓存数据，检测问题
  const issues = useMemo<QualityIssue[]>(() => {
    if (!displayData?.blocks) return [];

    const result: QualityIssue[] = [];

    for (const block of displayData.blocks) {
      const srcText = block.src || "";
      const dstText = block.dst || "";

      // 1. 检测空输出
      if (!dstText.trim() && srcText.trim()) {
        result.push({
          blockIndex: block.index,
          type: "empty_output",
          severity: "error",
          message: t.messages.emptyOutput,
          srcPreview: srcText.substring(0, 100),
          dstPreview: t.messages.emptyOutputPreview,
          suggestion: t.messages.emptyOutputSuggestion,
        });
        continue;
      }

      // 2. 检测假名残留 - 20个以上才警告
      const kanaCount = detectKanaResidue(dstText);
      if (kanaCount > 0) {
        const isMinor = kanaCount < 5;
        result.push({
          blockIndex: block.index,
          type: "kana_residue",
          severity: isMinor ? "info" : "warning",
          message: t.messages.kanaResidue
            .replace(
              "{level}",
              isMinor
                ? t.messages.kanaResidueMinor
                : t.messages.kanaResidueMajor,
            )
            .replace("{count}", String(kanaCount)),
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText.substring(0, 100),
          suggestion: t.messages.kanaResidueSuggestion,
        });
      }

      // 3. 检测术语表未生效 (严格模式)
      if (glossary && Object.keys(glossary).length > 0) {
        const { missed, cotFound } = detectGlossaryMiss(
          srcText,
          dstText,
          glossary,
          block.cot,
        );
        if (missed.length > 0) {
          const count = missed.length;
          result.push({
            blockIndex: block.index,
            type: "glossary_miss",
            severity: "warning",
            message: t.messages.glossaryMiss
              .replace("{count}", String(count))
              .replace(
                "{terms}",
                `${missed.slice(0, 3).join(", ")}${count > 3 ? "..." : ""}`,
              ),
            srcPreview: srcText.substring(0, 100),
            dstPreview: dstText.substring(0, 100),
            suggestion: `${t.messages.glossarySuggestion}${
              cotFound.length > 0
                ? ` ${t.messages.cotMention.replace(
                    "{count}",
                    String(cotFound.length),
                  )}`
                : ""
            }`,
          });
        }
      }

      // 4. 检测高相似度 (可能是漏翻) - 阈值提高到90%，且原文长度需大于10
      const similarity = calculateSimilarity(srcText, dstText);
      const similarLines = findHighSimilarityLines(srcText, dstText);
      const srcNormalized = normalizeForSimilarity(srcText);
      const dstNormalized = normalizeForSimilarity(dstText);
      const srcMeaningful = countMeaningfulChars(srcNormalized);
      const dstMeaningful = countMeaningfulChars(dstNormalized);
      const srcJa = countJapaneseChars(srcNormalized);
      const dstJa = countJapaneseChars(dstNormalized);

      if (similarLines.length > 0) {
        //Found specific lines
        result.push({
          blockIndex: block.index,
          type: "high_similarity",
          severity: "warning",
          message: t.messages.highSimilarityLines
            .replace("{count}", String(similarLines.length))
            .replace("{lines}", similarLines.join(", ")),
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText.substring(0, 100),
          suggestion: t.messages.highSimilaritySuggestion,
        });
      } else if (
        similarity > 0.9 &&
        srcMeaningful >= 20 &&
        dstMeaningful >= 20 &&
        srcJa >= 10 &&
        dstJa >= 6
      ) {
        // Fallback global check
        result.push({
          blockIndex: block.index,
          type: "high_similarity",
          severity: "warning",
          message: t.messages.highSimilarityOverall.replace(
            "{percent}",
            String(Math.round(similarity * 100)),
          ),
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText.substring(0, 100),
          suggestion: t.messages.highSimilarityOverallSuggestion,
        });
      }

      // 5. 检测行数不匹配 - 分级处理 (阈值 10%)
      const effectiveSrcLines = getEffectiveLineCount(srcText);
      const effectiveDstLines = getEffectiveLineCount(dstText);
      const srcLineCount =
        effectiveSrcLines > 0 ? effectiveSrcLines : block.srcLines;
      const dstLineCount =
        effectiveDstLines > 0 ? effectiveDstLines : block.dstLines;
      if (srcLineCount && dstLineCount) {
        const diff = Math.abs(srcLineCount - dstLineCount);
        const pct = diff / Math.max(srcLineCount, 1);

        if (diff > 0) {
          if (pct < 0.1 && diff <= 5) {
            result.push({
              blockIndex: block.index,
              type: "line_mismatch",
              severity: "info",
              message: t.messages.lineMismatchMinor
                .replace("{src}", String(srcLineCount))
                .replace("{dst}", String(dstLineCount)),
              srcPreview: srcText.substring(0, 100),
              dstPreview: dstText.substring(0, 100),
              suggestion: t.messages.lineMismatchMinorSuggestion,
            });
          } else if (diff > 10 || pct > 0.4) {
            result.push({
              blockIndex: block.index,
              type: "line_mismatch",
              severity: "warning",
              message: t.messages.lineMismatchMajor
                .replace("{src}", String(srcLineCount))
                .replace("{dst}", String(dstLineCount))
                .replace("{diff}", String(diff)),
              srcPreview: srcText.substring(0, 100),
              dstPreview: dstText.substring(0, 100),
              suggestion: t.messages.lineMismatchMajorSuggestion,
            });
          }
        }
      }

      // 6. 检测显式错误标签 (Explicit Error Tags from LLM/Backend)
      // 这些标签是后端检测到问题后插入到译文中的
      if (dstText.includes("<kana_residue>")) {
        result.push({
          blockIndex: block.index,
          type: "kana_residue",
          severity: "error",
          message: t.messages.tagKana,
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText,
          suggestion: t.messages.tagKanaSuggestion,
        });
      }
      if (dstText.includes("<line_mismatch>")) {
        result.push({
          blockIndex: block.index,
          type: "line_mismatch",
          severity: "error",
          message: t.messages.tagLineMismatch,
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText,
          suggestion: t.messages.tagLineMismatchSuggestion,
        });
      }
      if (dstText.includes("<glossary_miss>")) {
        result.push({
          blockIndex: block.index,
          type: "glossary_miss",
          severity: "warning",
          message: t.messages.tagGlossary,
          srcPreview: srcText.substring(0, 100),
          dstPreview: dstText,
          suggestion: t.messages.tagGlossarySuggestion,
        });
      }
      // Generic Error Tag Pattern: <error_...>
      const genericErrorMatch = dstText.match(/<error_([a-z_]+)>/);
      if (genericErrorMatch) {
        const errType = genericErrorMatch[1];
        if (
          !["kana_residue", "line_mismatch", "glossary_miss"].includes(errType)
        ) {
          result.push({
            blockIndex: block.index,
            type: "empty_output",
            severity: "error",
            message: t.messages.tagUnknown.replace("{type}", errType),
            srcPreview: srcText.substring(0, 100),
            dstPreview: dstText,
            suggestion: t.messages.tagUnknownSuggestion,
          });
        }
      }

      // 7. Include Warnings from Cache (Backend detected)
      if ((block as any).warnings && Array.isArray((block as any).warnings)) {
        (block as any).warnings.forEach((wType: string) => {
          const normalizedType = wType.replace("warning_", "");
          if (normalizedType.includes("hangeul") || wType.includes("hangeul")) {
            return;
          }
          // Check if we already have this type for this block from text scan
          const alreadyHas = result.some(
            (r) => r.blockIndex === block.index && r.type === wType,
          );
          if (!alreadyHas) {
            // Map backend type to issue
            let severity: "error" | "warning" | "info" = "error";

            // Handle both legacy and new warning_ prefixed types
            if (
              ["line_mismatch", "kana_residue", "hangeul_residue"].includes(
                normalizedType,
              ) ||
              wType.includes("line_mismatch")
            ) {
              severity = "info";
            } else if (
              ["high_similarity", "glossary_miss", "glossary_missed"].includes(
                normalizedType,
              ) ||
              wType.includes("glossary")
            ) {
              severity = "warning";
            } else {
              severity = "error";
            }

            result.push({
              blockIndex: block.index,
              type: wType as any,
              severity: severity,
              message: t.messages.backendWarning.replace("{type}", wType),
              srcPreview: srcText.substring(0, 100),
              dstPreview: dstText.substring(0, 100),
              suggestion: t.messages.backendWarningSuggestion,
            });
          }
        });
      }
    }

    return result;
  }, [displayData, glossary]);

  // 过滤后的问题列表
  const filteredIssues = useMemo(() => {
    let result = issues;

    if (filterType !== "all") {
      result = result.filter((i) => i.type === filterType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.message.toLowerCase().includes(query) ||
          i.srcPreview.toLowerCase().includes(query) ||
          i.dstPreview.toLowerCase().includes(query),
      );
    }

    return result;
  }, [issues, filterType, searchQuery]);

  // 统计信息
  const stats = useMemo(
    () => ({
      total: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
      byType: {
        kana_residue: issues.filter((i) => i.type.includes("kana_residue"))
          .length,
        glossary_miss: issues.filter((i) => i.type.includes("glossary_miss"))
          .length,
        high_similarity: issues.filter((i) =>
          i.type.includes("high_similarity"),
        ).length,
        line_mismatch: issues.filter((i) => i.type.includes("line_mismatch"))
          .length,
        empty_output: issues.filter((i) => i.type === "empty_output").length,
      },
    }),
    [issues],
  );

  const toggleExpand = (index: number) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const getSeverityIcon = (severity: string) => {
    if (severity === "error")
      return <XCircle className="w-5 h-5 text-red-500" />;
    if (severity === "info")
      return <AlertTriangle className="w-5 h-5 text-blue-500" />;
    return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  };

  const getTypeLabel = (type: string) => {
    const labels = t.typeLabels as Record<string, string>;
    return labels[type] || type;
  };

  if (!displayData) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-hidden h-full">
        <Card className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground flex flex-col items-center gap-4">
            <div>
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t.noCacheTitle}</p>
              <p className="text-sm mt-2 opacity-70">{t.noCacheDesc}</p>
            </div>
            {loadError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                {loadError}
              </div>
            )}
            <Button
              onClick={handleLoadCache}
              variant="outline"
              className="gap-2"
            >
              <FileText className="w-4 h-4" />
              {t.openCacheButton}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 overflow-hidden gap-3 h-full">
      {/* Header with Path if available */}
      {localCachePath && (
        <div className="text-xs text-muted-foreground break-all px-1">
          {t.currentFileLabel} {localCachePath}
        </div>
      )}

      {/* 统计卡片 - 响应式网格 */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${stats.total === 0 ? "bg-green-500/10" : "bg-yellow-500/10"}`}
            >
              {stats.total === 0 ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-500" />
              )}
            </div>
            <div>
              <p className="text-lg font-bold">{stats.total}</p>
              <p className="text-[10px] text-muted-foreground">
                {t.statsTotal}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-500/10">
              <XCircle className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <p className="text-lg font-bold">{stats.errors}</p>
              <p className="text-[10px] text-muted-foreground">
                {t.statsErrors}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-yellow-500/10">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
            </div>
            <div>
              <p className="text-lg font-bold">{stats.warnings}</p>
              <p className="text-[10px] text-muted-foreground">
                {t.statsWarnings}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <FileText className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="text-lg font-bold">
                {displayData?.blocks?.length || 0}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t.statsBlocks}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* 过滤器和搜索 */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.filterPlaceholder}
            className="w-full pl-10 pr-4 py-2 bg-muted rounded-lg text-sm"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 bg-muted rounded-lg text-sm"
        >
          <option value="all">{t.filterAll}</option>
          <option value="kana_residue">
            {getTypeLabel("kana_residue")} ({stats.byType.kana_residue})
          </option>
          <option value="glossary_miss">
            {getTypeLabel("glossary_miss")} ({stats.byType.glossary_miss})
          </option>
          <option value="high_similarity">
            {getTypeLabel("high_similarity")} ({stats.byType.high_similarity})
          </option>
          <option value="line_mismatch">
            {getTypeLabel("line_mismatch")} ({stats.byType.line_mismatch})
          </option>
          <option value="empty_output">
            {getTypeLabel("empty_output")} ({stats.byType.empty_output})
          </option>
        </select>
      </div>

      {/* 问题列表 */}
      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardHeader className="py-3 border-b border-border">
          <CardTitle className="text-sm font-medium">
            {t.resultsTitle.replace("{count}", String(filteredIssues.length))}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-y-auto">
          {filteredIssues.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {issues.length === 0 ? (
                <div className="text-center">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
                  <p>{t.noIssuesTitle}</p>
                  <p className="text-sm mt-2">{t.noIssuesDesc}</p>
                </div>
              ) : (
                <p>{t.noMatches}</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredIssues.map((issue, idx) => (
                <div key={idx} className="p-4 hover:bg-muted/50">
                  <div
                    className="flex items-start gap-3 cursor-pointer"
                    onClick={() => toggleExpand(idx)}
                  >
                    {getSeverityIcon(issue.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 bg-muted rounded">
                          {t.blockLabel.replace(
                            "{index}",
                            String(issue.blockIndex),
                          )}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-muted rounded">
                          {getTypeLabel(issue.type)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{issue.message}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {onNavigateToBlock && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToBlock(issue.blockIndex);
                          }}
                        >
                          {t.jump}
                        </Button>
                      )}
                      {expandedIssues.has(idx) ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </div>

                  {expandedIssues.has(idx) && (
                    <div className="mt-3 ml-8 space-y-2 text-sm">
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">
                          {t.srcPreview}
                        </p>
                        <p className="text-foreground">{issue.srcPreview}...</p>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">
                          {t.dstPreview}
                        </p>
                        <p className="text-foreground">{issue.dstPreview}...</p>
                      </div>
                      {issue.suggestion && (
                        <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                          <p className="text-xs text-blue-400 mb-1">
                            {t.suggestion}
                          </p>
                          <p className="text-blue-300">{issue.suggestion}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ResultChecker;
