import { describe, it, expect } from "vitest";
import { formatGlobalValue } from "../formatting";

describe("formatGlobalValue", () => {
  it("returns fallback for empty values", () => {
    expect(formatGlobalValue(undefined, "N/A")).toBe("N/A");
    expect(formatGlobalValue(null, "N/A")).toBe("N/A");
    expect(formatGlobalValue("", "N/A")).toBe("N/A");
  });

  it("returns value for short inputs", () => {
    expect(formatGlobalValue("abc", "N/A")).toBe("abc");
    expect(formatGlobalValue(42, "N/A")).toBe("42");
  });

  it("truncates long inputs from the left", () => {
    const input = "1234567890abcdefghijXYZ";
    expect(formatGlobalValue(input, "N/A")).toBe("...4567890abcdefghijXYZ");
  });
});
