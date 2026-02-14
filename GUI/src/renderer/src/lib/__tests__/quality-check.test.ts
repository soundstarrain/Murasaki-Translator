import { describe, it, expect } from "vitest";
import {
  calculateSimilarity,
  findHighSimilarityLines,
  detectKanaResidue,
} from "../quality-check";

describe("quality-check", () => {
  it("calculates similarity", () => {
    expect(calculateSimilarity("abc", "abc")).toBeCloseTo(1);
    expect(calculateSimilarity("abc", "xyz")).toBeCloseTo(0);
    expect(calculateSimilarity("a b", "ab")).toBeCloseTo(1);
  });

  it("finds high similarity lines", () => {
    const src = "今日は天気が良いです\n次の行";
    const dst = "今日は天気が良いです\n別の行";
    expect(findHighSimilarityLines(src, dst)).toEqual([1]);
  });

  it("skips short lines for similarity", () => {
    const src = "猫\n今日は天気が良いです";
    const dst = "猫\n今日は天気が良いです";
    expect(findHighSimilarityLines(src, dst)).toEqual([2]);
  });

  it("ignores filename-only lines for similarity", () => {
    const src = "1.jpg\n今日は天気が良いです";
    const dst = "1.jpg\n今日は天気が良いです";
    expect(findHighSimilarityLines(src, dst)).toEqual([2]);
  });

  it("detects kana residue", () => {
    const text = "abc\u3042\u30ab";
    expect(detectKanaResidue(text)).toBe(2);
    expect(detectKanaResidue("english only")).toBe(0);
  });
});
