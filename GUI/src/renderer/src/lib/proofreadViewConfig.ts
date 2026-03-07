export type ProofreadEngineMode = "v1" | "v2";

export interface ProofreadRetranslateOptions {
  useV2: boolean;
  pipelineId: string;
}

export interface ProofreadLineLayoutMetrics {
  isSingleLineBlock: boolean;
  rowMinHeight: number;
  lineHeight: number;
  paddingLeft: number;
  paddingRight: number;
  lineNumberLeft: number;
  lineNumberWidth: number;
  lineNumberFontSize: number;
  textFontSize: number;
  textFontWeight: number;
  textVerticalPadding: number;
}

export interface ProofreadAlignedLinePair {
  rawIndex: number;
  lineNumber: number;
  srcLine: string;
  dstLine: string;
}

const trimString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const normalizeProofreadEngineMode = (
  value: unknown,
): ProofreadEngineMode => (trimString(value) === "v2" ? "v2" : "v1");

export const resolveProofreadRetranslateOptions = ({
  engineMode,
  pipelineId,
}: {
  engineMode: unknown;
  pipelineId: unknown;
}): ProofreadRetranslateOptions => {
  const mode = normalizeProofreadEngineMode(engineMode);
  if (mode !== "v2") {
    return { useV2: false, pipelineId: "" };
  }
  return {
    useV2: true,
    pipelineId: trimString(pipelineId),
  };
};

export const normalizeProofreadChunkType = (
  value: unknown,
): "line" | "chunk" | "block" | "" => {
  const normalized = trimString(value).toLowerCase();
  if (
    normalized === "line" ||
    normalized === "chunk" ||
    normalized === "block"
  ) {
    return normalized;
  }
  return "";
};

export const isProofreadV2LineCache = (cache: {
  engineMode?: unknown;
  chunkType?: unknown;
}): boolean =>
  trimString(cache?.engineMode).toLowerCase() === "v2" &&
  normalizeProofreadChunkType(cache?.chunkType) === "line";

export const buildProofreadAlignedLinePairs = ({
  srcLines,
  dstLines,
  hideBothEmpty = false,
}: {
  srcLines: string[];
  dstLines: string[];
  hideBothEmpty?: boolean;
}): ProofreadAlignedLinePair[] => {
  const normalizedSrc = Array.isArray(srcLines)
    ? srcLines.map((line) => (typeof line === "string" ? line : ""))
    : [];
  const normalizedDst = Array.isArray(dstLines)
    ? dstLines.map((line) => (typeof line === "string" ? line : ""))
    : [];
  const maxLines = Math.max(normalizedSrc.length, normalizedDst.length, 1);

  const alignedRows: ProofreadAlignedLinePair[] = [];
  for (let rawIndex = 0; rawIndex < maxLines; rawIndex += 1) {
    const srcLine = normalizedSrc[rawIndex] ?? "";
    const dstLine = normalizedDst[rawIndex] ?? "";
    if (hideBothEmpty && srcLine.trim() === "" && dstLine.trim() === "") {
      continue;
    }
    alignedRows.push({
      rawIndex,
      lineNumber: rawIndex + 1,
      srcLine,
      dstLine,
    });
  }

  return alignedRows;
};

export const buildProofreadLineLayoutMetrics = (
  maxLines: number,
): ProofreadLineLayoutMetrics => {
  const safeMaxLines = Number.isFinite(maxLines) ? Math.max(1, maxLines) : 1;
  const isSingleLineBlock = safeMaxLines === 1;
  if (isSingleLineBlock) {
    return {
      isSingleLineBlock: true,
      rowMinHeight: 28,
      lineHeight: 24,
      paddingLeft: 40,
      paddingRight: 14,
      lineNumberLeft: 10,
      lineNumberWidth: 22,
      lineNumberFontSize: 11,
      textFontSize: 13.5,
      textFontWeight: 500,
      textVerticalPadding: 2,
    };
  }
  return {
    isSingleLineBlock: false,
    rowMinHeight: 20,
    lineHeight: 20,
    paddingLeft: 44,
    paddingRight: 12,
    lineNumberLeft: 12,
    lineNumberWidth: 24,
    lineNumberFontSize: 10,
    textFontSize: 13,
    textFontWeight: 400,
    textVerticalPadding: 0,
  };
};
