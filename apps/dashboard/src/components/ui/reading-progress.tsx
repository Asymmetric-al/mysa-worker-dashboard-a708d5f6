"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
import { computeReadingProgress } from "@/lib/editorial-metrics";

export type ReadingProgressBarProps = {
  readonly className?: string;
};

/**
 * React Bits Pro-inspired editorial reading progress hairline.
 * Uses passive scroll + `requestAnimationFrame` + GPU-composited `scaleX` with logical RTL origin.
 * Purely decorative (`aria-hidden="true"`), zero layout shift, zero raw colors.
 */
export function ReadingProgressBar({ className }: ReadingProgressBarProps) {
  const [ratio, setRatio] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      setRatio(computeReadingProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight));
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      data-slot="reading-progress"
      className={cn("pointer-events-none sticky top-[var(--app-shell-sticky-offset,4rem)] z-15 h-0.5 w-full overflow-hidden rounded-full bg-border/60 print:hidden", className)}
    >
      <div
        className="reading-progress-fill h-full w-full bg-primary"
        style={{ transform: `scaleX(${ratio.toFixed(4)})` }}
      />
    </div>
  );
}

export default ReadingProgressBar;
