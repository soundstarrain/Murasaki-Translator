import { describe, it, expect } from "vitest";
import { normalizeChunkType } from "../chunkProfile";

describe("chunkProfile helpers", () => {
  it("normalizes legacy and line types", () => {
    expect(normalizeChunkType("legacy")).toBe("legacy");
    expect(normalizeChunkType("line")).toBe("line");
    expect(normalizeChunkType(" LINE ")).toBe("line");
  });

  it("falls back to legacy on invalid input", () => {
    expect(normalizeChunkType("")).toBe("legacy");
    expect(normalizeChunkType(null)).toBe("legacy");
    expect(normalizeChunkType(undefined)).toBe("legacy");
    expect(normalizeChunkType("doc")).toBe("legacy");
  });
});
