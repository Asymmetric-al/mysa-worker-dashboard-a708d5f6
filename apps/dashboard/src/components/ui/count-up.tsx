"use client";
import * as React from "react";
import { animate } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";
import { countFormatOf } from "@/lib/count-format";
import { shouldSnapCountUp } from "@/lib/ui-motion";

export type CountUpProps = {
  /** Non-financial whole integer count (NEVER use for money amounts). */
  readonly value: number;
  readonly locale?: string;
  readonly durationSec?: number;
  readonly className?: string;
};

export { shouldSnapCountUp };

/**
 * React Bits-inspired restrained `CountUp` (`motion/react`).
 * Snaps instantly under `prefers-reduced-motion: reduce`, mutates text via ref for zero React re-renders per frame,
 * renders `tabular-figures`, and is intended exclusively for non-financial operational queue counts.
 */
export function CountUp({ value, locale, durationSec = 0.28, className }: CountUpProps) {
  const reducedMotion = usePrefersReducedMotion();
  const safeTarget = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const formatter = React.useMemo(() => countFormatOf(locale), [locale]);
  const spanRef = React.useRef<HTMLSpanElement | null>(null);
  const previousRef = React.useRef<number>(safeTarget);

  React.useEffect(() => {
    const node = spanRef.current;
    if (shouldSnapCountUp(safeTarget, reducedMotion)) {
      previousRef.current = safeTarget;
      if (node !== null) node.textContent = formatter.format(safeTarget);
      return;
    }
    const startFrom = previousRef.current === safeTarget ? 0 : previousRef.current;
    let lastRendered = startFrom;
    if (node !== null) node.textContent = formatter.format(startFrom);
    const controls = animate(startFrom, safeTarget, {
      duration: durationSec,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        const rounded = Math.round(latest);
        if (rounded === lastRendered) return;
        lastRendered = rounded;
        if (node !== null) node.textContent = formatter.format(rounded);
      },
      onComplete: () => {
        previousRef.current = safeTarget;
        if (node !== null) node.textContent = formatter.format(safeTarget);
      },
    });
    return () => {
      controls.stop();
      previousRef.current = safeTarget;
      if (node !== null) node.textContent = formatter.format(safeTarget);
    };
  }, [durationSec, formatter, reducedMotion, safeTarget]);

  return (
    <span ref={spanRef} data-slot="count-up" className={cn("tabular-figures", className)}>
      {formatter.format(safeTarget)}
    </span>
  );
}

export default CountUp;
