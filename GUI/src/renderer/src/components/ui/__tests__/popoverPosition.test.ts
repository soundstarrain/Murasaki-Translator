import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "../popoverPosition";

const makeRect = (values: Partial<DOMRect>): DOMRect =>
  ({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    ...values,
  }) as DOMRect;

describe("computePopoverPosition", () => {
  it("places popover below when space is sufficient", () => {
    const result = computePopoverPosition({
      anchorRect: makeRect({ top: 100, bottom: 120, left: 200 }),
      popoverSize: { width: 220, height: 160 },
      viewport: { width: 800, height: 600 },
    });

    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(128);
    expect(result.left).toBe(200);
  });

  it("flips to top when space below is limited", () => {
    const result = computePopoverPosition({
      anchorRect: makeRect({ top: 520, bottom: 540, left: 200 }),
      popoverSize: { width: 220, height: 180 },
      viewport: { width: 800, height: 600 },
    });

    expect(result.placement).toBe("top");
    expect(result.top).toBe(332);
  });

  it("clamps left within viewport edge padding", () => {
    const result = computePopoverPosition({
      anchorRect: makeRect({ top: 100, bottom: 120, left: 260 }),
      popoverSize: { width: 220, height: 160 },
      viewport: { width: 320, height: 600 },
    });

    expect(result.left).toBe(92);
  });
});
