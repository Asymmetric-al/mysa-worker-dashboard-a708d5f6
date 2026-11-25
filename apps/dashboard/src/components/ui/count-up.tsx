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
 * Snaps instantly under `prefers-reduced-motion: reduce`, renders `tabular-figures`,
 * and is intended exclusively for non-financial operational queue counts.
 */
export function CountUp({ value, locale, durationSec = 0.45, className }: CountUpProps) {
  const reducedMotion = usePrefersReducedMotion();
  const safeTarget = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const formatter = React.useMemo(() => countFormatOf(locale), [locale]);
  const [displayed, setDisplayed] = React.useState<number>(() => safeTarget);
  const previousRef = React.useRef<number>(safeTarget);

  React.useEffect(() => {
    if (shouldSnapCountUp(safeTarget, reducedMotion)) {
      previousRef.current = safeTarget;
      setDisplayed(safeTarget);
      return;
    }
    const startFrom = previousRef.current === safeTarget ? 0 : previousRef.current;
    const controls = animate(startFrom, safeTarget, {
      duration: durationSec,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplayed(Math.round(latest)),
      onComplete: () => {
        previousRef.current = safeTarget;
        setDisplayed(safeTarget);
      },
    });
    return () => controls.stop();
  }, [durationSec, reducedMotion, safeTarget]);

  return (
    <span data-slot="count-up" className={cn("tabular-figures", className)}>
      {formatter.format(displayed)}
    </span>
  );
}

export default CountUp;
