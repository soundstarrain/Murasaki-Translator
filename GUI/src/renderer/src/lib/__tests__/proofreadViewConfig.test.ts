import { describe, expect, it } from "vitest";
import {
  buildProofreadAlignedLinePairs,
  buildProofreadLineLayoutMetrics,
  isProofreadV2LineCache,
  normalizeProofreadEngineMode,
  normalizeProofreadChunkType,
  resolveAvailableProofreadPipelineId,
  resolveProofreadRetranslateOptions,
} from "../proofreadViewConfig";

describe("normalizeProofreadEngineMode", () => {
  it("returns v2 only when explicit v2 is provided", () => {
    expect(normalizeProofreadEngineMode("v2")).toBe("v2");
    expect(normalizeProofreadEngineMode(" v2 ")).toBe("v2");
    expect(normalizeProofreadEngineMode("v1")).toBe("v1");
    expect(normalizeProofreadEngineMode(undefined)).toBe("v1");
  });
});

describe("resolveProofreadRetranslateOptions", () => {
  it("returns v1 options when engine is v1", () => {
    expect(
      resolveProofreadRetranslateOptions({
        engineMode: "v1",
        pipelineId: "pipeline_1",
      }),
    ).toEqual({ useV2: false, pipelineId: "" });
  });

  it("returns trimmed pipeline id for v2 mode", () => {
    expect(
      resolveProofreadRetranslateOptions({
        engineMode: "v2",
        pipelineId: " pipeline_current ",
      }),
    ).toEqual({ useV2: true, pipelineId: "pipeline_current" });
  });
});

describe("resolveAvailableProofreadPipelineId", () => {
  it("prefers the first valid candidate", () => {
    expect(
      resolveAvailableProofreadPipelineId({
        availablePipelineIds: ["ds", "claude"],
        candidates: ["deepseek", " ds ", "claude"],
      }),
    ).toBe("ds");
  });

  it("returns empty string when no candidate is valid", () => {
    expect(
      resolveAvailableProofreadPipelineId({
        availablePipelineIds: ["ds"],
        candidates: ["deepseek", ""],
      }),
    ).toBe("");
  });
});

describe("buildProofreadLineLayoutMetrics", () => {
  it("returns compact metrics for single-line blocks", () => {
    const metrics = buildProofreadLineLayoutMetrics(1);
    expect(metrics.isSingleLineBlock).toBe(true);
    expect(metrics.rowMinHeight).toBe(28);
    expect(metrics.lineHeight).toBe(24);
  });

  it("returns default metrics for multi-line blocks", () => {
    const metrics = buildProofreadLineLayoutMetrics(3);
    expect(metrics.isSingleLineBlock).toBe(false);
    expect(metrics.rowMinHeight).toBe(20);
    expect(metrics.lineHeight).toBe(20);
  });
});

describe("buildProofreadAlignedLinePairs", () => {
  it("keeps all aligned rows by default", () => {
    expect(
      buildProofreadAlignedLinePairs({
        srcLines: ["", "Alpha"],
        dstLines: ["", ""],
      }),
    ).toEqual([
      { rawIndex: 0, lineNumber: 1, srcLine: "", dstLine: "" },
      { rawIndex: 1, lineNumber: 2, srcLine: "Alpha", dstLine: "" },
    ]);
  });

  it("drops rows only when both sides are empty", () => {
    expect(
      buildProofreadAlignedLinePairs({
        srcLines: ["", "  ", "Alpha", ""],
        dstLines: ["", "", "", "Beta"],
        hideBothEmpty: true,
      }),
    ).toEqual([
      { rawIndex: 2, lineNumber: 3, srcLine: "Alpha", dstLine: "" },
      { rawIndex: 3, lineNumber: 4, srcLine: "", dstLine: "Beta" },
    ]);
  });
});

describe("normalizeProofreadChunkType", () => {
  it("normalizes supported chunk types", () => {
    expect(normalizeProofreadChunkType("line")).toBe("line");
    expect(normalizeProofreadChunkType(" chunk ")).toBe("chunk");
    expect(normalizeProofreadChunkType("block")).toBe("block");
  });

  it("returns empty string for unsupported values", () => {
    expect(normalizeProofreadChunkType("")).toBe("");
    expect(normalizeProofreadChunkType("foo")).toBe("");
    expect(normalizeProofreadChunkType("legacy")).toBe("");
    expect(normalizeProofreadChunkType(undefined)).toBe("");
  });
});

describe("isProofreadV2LineCache", () => {
  it("returns true only for v2 line cache metadata", () => {
    expect(isProofreadV2LineCache({ engineMode: "v2", chunkType: "line" })).toBe(
      true,
    );
    expect(
      isProofreadV2LineCache({ engineMode: "v2", chunkType: "legacy" }),
    ).toBe(false);
    expect(
      isProofreadV2LineCache({ engineMode: "v1", chunkType: "line" }),
    ).toBe(false);
    expect(isProofreadV2LineCache({})).toBe(false);
  });
});
