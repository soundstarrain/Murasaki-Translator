import { describe, it, expect } from "vitest";
import { cn, getVariants } from "../utils";

describe("utils", () => {
  it("returns variants for known character", () => {
    const variants = getVariants("\u6c17");
    expect(variants?.has("\u6c14")).toBe(true);
  });

  it("returns undefined for unknown character", () => {
    expect(getVariants("Z")).toBeUndefined();
  });

  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("merges tailwind conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
