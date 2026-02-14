import { describe, expect, it } from "vitest";
import { computeTooltipPosition } from "../tooltipPosition";

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe("computeTooltipPosition", () => {
  it("顶部空间不足时自动翻转到底部", () => {
    const result = computeTooltipPosition({
      triggerRect: rect(100, 4, 20, 20),
      tooltipSize: { width: 120, height: 60 },
      viewport: { width: 400, height: 300 },
      spacing: 8,
    });

    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(4 + 20 + 8);
  });

  it("空间充足时保持在上方", () => {
    const result = computeTooltipPosition({
      triggerRect: rect(120, 200, 20, 20),
      tooltipSize: { width: 160, height: 60 },
      viewport: { width: 400, height: 300 },
      spacing: 8,
    });

    expect(result.placement).toBe("top");
    expect(result.top).toBe(200 - 8 - 60);
  });

  it("左右边界夹取与箭头位置正常", () => {
    const result = computeTooltipPosition({
      triggerRect: rect(0, 100, 20, 20),
      tooltipSize: { width: 180, height: 40 },
      viewport: { width: 200, height: 300 },
      spacing: 8,
      edgePadding: 8,
      arrowPadding: 10,
    });

    expect(result.left).toBe(8);
    expect(result.arrowLeft).toBe(10);
  });
});
