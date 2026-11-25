"use client";
import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { clampSplitRatio } from "@/lib/ui-motion";

export { clampSplitRatio };

export type ResizableSplitPaneProps = {
  /** Primary (start) pane content. */
  readonly start: React.ReactNode;
  /** Secondary (end) pane content. */
  readonly end: React.ReactNode;
  /** Initial percentage width of the start pane on desktop (`lg+`). Default 50. */
  readonly defaultRatio?: number;
  /** Minimum percentage width for the start pane. Default 25. */
  readonly minRatio?: number;
  /** Maximum percentage width for the start pane. Default 75. */
  readonly maxRatio?: number;
  /** Accessible label for the resize separator. */
  readonly handleLabel?: string;
  readonly className?: string;
};

const KEYBOARD_STEP = 5;

/**
 * Shadcn Space `resizable-01` / ReUI `resizable` accessible split pane.
 * Uses pointer capture + keyboard Left/Right/Home/End (zero HTML5 `draggable="true"`),
 * mirrors direction automatically in RTL, and stacks vertically below `lg`.
 */
export function ResizableSplitPane({
  start,
  end,
  defaultRatio = 50,
  minRatio = 25,
  maxRatio = 75,
  handleLabel = "Resize panes",
  className,
}: ResizableSplitPaneProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = React.useState<number>(() => clampSplitRatio(defaultRatio, minRatio, maxRatio));
  const [dragging, setDragging] = React.useState(false);

  const updateFromClientX = React.useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const isRtl = window.getComputedStyle(container).direction === "rtl";
      const offset = isRtl ? rect.right - clientX : clientX - rect.left;
      const pct = (offset / rect.width) * 100;
      setRatio(clampSplitRatio(pct, minRatio, maxRatio));
    },
    [maxRatio, minRatio],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const container = containerRef.current;
    const isRtl = container !== null && window.getComputedStyle(container).direction === "rtl";
    const stepRight = isRtl ? -KEYBOARD_STEP : KEYBOARD_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setRatio((current) => clampSplitRatio(current - stepRight, minRatio, maxRatio));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setRatio((current) => clampSplitRatio(current + stepRight, minRatio, maxRatio));
    } else if (event.key === "Home") {
      event.preventDefault();
      setRatio(minRatio);
    } else if (event.key === "End") {
      event.preventDefault();
      setRatio(maxRatio);
    }
  };

  return (
    <div
      ref={containerRef}
      data-slot="resizable-split-pane"
      data-ratio={ratio}
      className={cn("flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-0", className)}
    >
      <div
        data-slot="resizable-pane-start"
        className="min-w-0 w-full lg:w-[var(--split-start-width)] lg:shrink-0 lg:pe-2"
        style={{ ["--split-start-width" as string]: `calc(${String(ratio)}% - 0.75rem)` }}
      >
        {start}
      </div>

      {/* WAI-ARIA Window Splitter requires a focusable vertical separator holding a visual grip indicator; `<hr>` is a void element and cannot contain the grip child. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="separator"
        aria-orientation="vertical"
        aria-label={handleLabel}
        aria-valuemin={minRatio}
        aria-valuemax={maxRatio}
        aria-valuenow={ratio}
        tabIndex={0}
        data-slot="resizable-handle"
        data-dragging={dragging ? "true" : "false"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        className={cn(
          "hidden lg:flex lg:min-h-24 lg:w-6 lg:shrink-0 lg:cursor-col-resize lg:touch-none lg:select-none lg:items-center lg:justify-center lg:self-stretch",
          "rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
          dragging ? "bg-secondary/80" : "hover:bg-muted/60",
        )}
      >
        <span aria-hidden="true" className={cn("flex h-10 w-4 items-center justify-center rounded-full border border-border/80 bg-card text-muted-foreground shadow-2xs transition-colors", dragging && "border-foreground text-foreground")}>
          <GripVerticalIcon className="size-3" />
        </span>
      </div>

      <div data-slot="resizable-pane-end" className="min-w-0 w-full lg:min-w-0 lg:flex-1 lg:ps-2">
        {end}
      </div>
    </div>
  );
}

export default ResizableSplitPane;
