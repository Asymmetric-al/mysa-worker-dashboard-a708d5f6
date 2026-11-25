"use client";
import * as React from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";

export type AnimatedListItemProps = {
  readonly index?: number;
  readonly className?: string;
  readonly children: React.ReactNode;
};

const MAX_STAGGER_INDEX = 6;
const STAGGER_STEP_SEC = 0.03;

/**
 * React Bits `AnimatedList` / Shadcn Space `animated-list-01` restrained list-item wrapper.
 * Renders a plain `<div>` with zero animation runtime overhead under `prefers-reduced-motion: reduce`,
 * and a fast `180ms ease-out` 6px entrance under full motion.
 */
export function AnimatedListItem({ index = 0, className, children }: AnimatedListItemProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (reducedMotion) {
    return (
      <div data-slot="animated-list-item" className={cn("min-w-0", className)}>
        {children}
      </div>
    );
  }
  const delay = Math.min(Math.max(0, index), MAX_STAGGER_INDEX) * STAGGER_STEP_SEC;
  return (
    <motion.div
      data-slot="animated-list-item"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}

export default AnimatedListItem;
