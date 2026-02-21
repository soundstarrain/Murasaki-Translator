import { describe, it, expect } from "vitest";
import {
  buildPipelineSummary,
  prunePipelineSummaryIndex,
  resolvePipelineTranslationMode,
  type PipelineChunkTypeIndex,
} from "../pipelineProfile";

describe("pipelineProfile helpers", () => {
  it("builds summary from snake_case fields", () => {
    const data = {
      id: "pipeline_alpha",
      name: "Pipeline Alpha",
      line_policy: "line_alpha",
      chunk_policy: "chunk_alpha",
    };
    expect(buildPipelineSummary(data)).toEqual({
      id: "pipeline_alpha",
      name: "Pipeline Alpha",
      provider: "",
      prompt: "",
      parser: "",
      linePolicy: "line_alpha",
      chunkPolicy: "chunk_alpha",
    });
  });

  it("builds summary from camelCase fields", () => {
    const data = {
      id: "pipeline_beta",
      name: "Pipeline Beta",
      provider: "api_beta",
      prompt: "prompt_beta",
      parser: "parser_beta",
      linePolicy: "line_beta",
      chunkPolicy: "chunk_beta",
    };
    const result = buildPipelineSummary(data);
    expect(result.provider).toBe("api_beta");
    expect(result.prompt).toBe("prompt_beta");
    expect(result.parser).toBe("parser_beta");
    expect(result.linePolicy).toBe("line_beta");
    expect(result.chunkPolicy).toBe("chunk_beta");
  });

  it("uses fallback values when data is empty", () => {
    const result = buildPipelineSummary(null, {
      id: "fallback_id",
      name: "Fallback Name",
    });
    expect(result.id).toBe("fallback_id");
    expect(result.name).toBe("Fallback Name");
    expect(result.provider).toBe("");
    expect(result.prompt).toBe("");
    expect(result.parser).toBe("");
    expect(result.linePolicy).toBe("");
  });

  it("prunes summary index when no pipelines are visible", () => {
    const prev = {
      pipeline_a: {
        id: "pipeline_a",
        name: "Pipeline A",
        provider: "",
        prompt: "",
        parser: "",
        linePolicy: "",
        chunkPolicy: "",
      },
    };
    expect(prunePipelineSummaryIndex(prev, [])).toEqual({});
  });

  it("keeps reference when all entries remain visible", () => {
    const prev = {
      pipeline_b: {
        id: "pipeline_b",
        name: "Pipeline B",
        provider: "",
        prompt: "",
        parser: "",
        linePolicy: "",
        chunkPolicy: "",
      },
    };
    const result = prunePipelineSummaryIndex(prev, ["pipeline_b"]);
    expect(result).toBe(prev);
  });

  it("keeps reference when index already empty", () => {
    const prev = {};
    const result = prunePipelineSummaryIndex(prev, []);
    expect(result).toBe(prev);
  });

  it("resolves translation mode from explicit value", () => {
    const chunkTypeIndex: PipelineChunkTypeIndex = { chunk_line: "line", chunk_block: "block" };
    expect(
      resolvePipelineTranslationMode(
        "block",
        "chunk_line",
        "line_policy",
        true,
        "line",
        chunkTypeIndex,
      ),
    ).toBe("block");
  });

  it("infers translation mode from chunk policy when mode is empty", () => {
    const chunkTypeIndex: PipelineChunkTypeIndex = { chunk_line: "line", chunk_block: "block" };
    expect(
      resolvePipelineTranslationMode(
        "",
        "chunk_line",
        "",
        false,
        "block",
        chunkTypeIndex,
      ),
    ).toBe("line");
    expect(
      resolvePipelineTranslationMode(
        undefined,
        "chunk_block",
        "",
        false,
        "line",
        chunkTypeIndex,
      ),
    ).toBe("block");
  });

  it("falls back to line when line policy applies and chunk type is unknown", () => {
    const chunkTypeIndex: PipelineChunkTypeIndex = {};
    expect(
      resolvePipelineTranslationMode(
        "",
        "unknown_chunk",
        "line_policy",
        true,
        "block",
        chunkTypeIndex,
      ),
    ).toBe("line");
  });

  it("uses fallback when no hints are available", () => {
    const chunkTypeIndex: PipelineChunkTypeIndex = {};
    expect(
      resolvePipelineTranslationMode(
        "",
        "",
        "",
        false,
        "block",
        chunkTypeIndex,
      ),
    ).toBe("block");
  });
});
