export type PopoverPlacement = "top" | "bottom";

export interface PopoverPositionInput {
  anchorRect: DOMRect;
  popoverSize: { width: number; height: number };
  viewport: { width: number; height: number };
  spacing?: number;
  edgePadding?: number;
}

export interface PopoverPositionResult {
  top: number;
  left: number;
  placement: PopoverPlacement;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const computePopoverPosition = ({
  anchorRect,
  popoverSize,
  viewport,
  spacing = 8,
  edgePadding = 8,
}: PopoverPositionInput): PopoverPositionResult => {
  const spaceAbove = anchorRect.top;
  const spaceBelow = viewport.height - anchorRect.bottom;
  const shouldFlip =
    spaceBelow < popoverSize.height + spacing && spaceAbove > spaceBelow;
  const placement: PopoverPlacement = shouldFlip ? "top" : "bottom";

  const top =
    placement === "bottom"
      ? anchorRect.bottom + spacing
      : anchorRect.top - spacing - popoverSize.height;

  const unclampedLeft = anchorRect.left;
  const maxLeft = Math.max(
    edgePadding,
    viewport.width - popoverSize.width - edgePadding,
  );
  const left = clamp(unclampedLeft, edgePadding, maxLeft);

  return {
    top,
    left,
    placement,
  };
};
