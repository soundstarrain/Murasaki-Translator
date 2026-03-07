import { describe, it, expect } from "vitest";
import { normalizeChunkType } from "../chunkProfile";

describe("chunkProfile helpers", () => {
  it("normalizes current block/line types", () => {
    expect(normalizeChunkType("block")).toBe("block");
    expect(normalizeChunkType("line")).toBe("line");
    expect(normalizeChunkType(" LINE ")).toBe("line");
  });

  it("returns empty for invalid input", () => {
    expect(normalizeChunkType("")).toBe("");
    expect(normalizeChunkType(null)).toBe("");
    expect(normalizeChunkType(undefined)).toBe("");
    expect(normalizeChunkType("legacy")).toBe("");
    expect(normalizeChunkType("doc")).toBe("");
  });
});
