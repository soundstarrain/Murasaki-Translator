import { describe, expect, it } from "vitest";

import {
  normalizeChunkType,
  normalizeProfileCompatibility,
  parseBooleanFlag,
} from "../pipelineV2Shared";

describe("pipelineV2Shared normalization", () => {
  it("normalizes strict_concurrency to boolean", () => {
    const payload: Record<string, any> = {
      id: "api_current",
      strict_concurrency: "true",
    };

    const changed = normalizeProfileCompatibility("api", payload);

    expect(changed).toBe(true);
    expect(payload.strict_concurrency).toBe(true);
  });

  it("does not change payload without current compatibility fields", () => {
    const payload: Record<string, any> = {
      id: "chunk_current",
      chunk_type: "block",
    };

    const changed = normalizeProfileCompatibility("chunk", payload);

    expect(changed).toBe(false);
    expect(payload.chunk_type).toBe("block");
  });

  it("normalizes current chunk types only", () => {
    expect(normalizeChunkType("block")).toBe("block");
    expect(normalizeChunkType("line")).toBe("line");
    expect(normalizeChunkType(" legacy ")).toBe("");
  });

  it("parseBooleanFlag handles common boolean values", () => {
    expect(parseBooleanFlag("true")).toBe(true);
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag("false")).toBe(false);
    expect(parseBooleanFlag("0")).toBe(false);
  });
});
