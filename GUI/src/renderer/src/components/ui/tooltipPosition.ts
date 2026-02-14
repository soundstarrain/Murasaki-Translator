export type TooltipPlacement = "top" | "bottom";

export interface TooltipPositionInput {
  triggerRect: DOMRect;
  tooltipSize: { width: number; height: number };
  viewport: { width: number; height: number };
  spacing?: number;
  edgePadding?: number;
  arrowPadding?: number;
}

export interface TooltipPositionResult {
  top: number;
  left: number;
  placement: TooltipPlacement;
  arrowLeft: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const computeTooltipPosition = ({
  triggerRect,
  tooltipSize,
  viewport,
  spacing = 8,
  edgePadding = 8,
  arrowPadding = 10,
}: TooltipPositionInput): TooltipPositionResult => {
  const spaceAbove = triggerRect.top;
  const spaceBelow = viewport.height - triggerRect.bottom;
  const shouldFlip =
    spaceAbove < tooltipSize.height + spacing && spaceBelow > spaceAbove;
  const placement: TooltipPlacement = shouldFlip ? "bottom" : "top";

  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const unclampedLeft = triggerCenterX - tooltipSize.width / 2;
  const maxLeft = Math.max(
    edgePadding,
    viewport.width - tooltipSize.width - edgePadding,
  );
  const left = clamp(unclampedLeft, edgePadding, maxLeft);

  const top =
    placement === "top"
      ? triggerRect.top - spacing - tooltipSize.height
      : triggerRect.bottom + spacing;

  const arrowLeft = clamp(
    triggerCenterX - left,
    arrowPadding,
    Math.max(arrowPadding, tooltipSize.width - arrowPadding),
  );

  return {
    top,
    left,
    placement,
    arrowLeft,
  };
};
