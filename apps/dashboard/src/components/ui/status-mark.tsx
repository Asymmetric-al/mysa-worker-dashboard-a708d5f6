"use client";
import * as React from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";

export type StatusMarkState = "idle" | "saving" | "saved" | "error" | "conflict";

export type StatusMarkProps = {
  readonly state: StatusMarkState;
  readonly className?: string;
};

const STATE_COLOR: Readonly<Record<StatusMarkState, string>> = {
  idle: "text-muted-foreground",
  saving: "text-info",
  saved: "text-positive",
  error: "text-destructive",
  conflict: "text-warning",
};

/**
 * Morphing SVG autosave status glyph (`motion/react`).
 * Respects `prefers-reduced-motion` (`duration: 0` when reduced) and uses semantic tokens only.
 */
export function StatusMark({ state, className }: StatusMarkProps) {
  const reducedMotion = usePrefersReducedMotion();
  const transition = reducedMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" as const };

  return (
    <span data-slot="status-mark" data-state={state} aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center", STATE_COLOR[state], className)}>
      <svg viewBox="0 0 16 16" fill="none" className="size-4">
        {state === "saving" ? (
          reducedMotion ? (
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.75" strokeDasharray="24 12" strokeLinecap="round" />
          ) : (
            <motion.circle
              cx="8"
              cy="8"
              r="5.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeDasharray="24 12"
              strokeLinecap="round"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
              style={{ transformOrigin: "8px 8px" }}
            />
          )
        ) : state === "saved" ? (
          <>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity={0.35} />
            {reducedMotion ? (
              <path d="M5.2 8.2L7.2 10.2L11 6.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <motion.path
                d="M5.2 8.2L7.2 10.2L11 6.2"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={transition}
              />
            )}
          </>
        ) : state === "error" || state === "conflict" ? (
          <>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity={0.35} />
            {reducedMotion ? (
              <path d="M8 4.8V8.6M8 11.1H8.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            ) : (
              <motion.path
                d="M8 4.8V8.6M8 11.1H8.01"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transition}
              />
            )}
          </>
        ) : (
          <circle cx="8" cy="8" r="3" fill="currentColor" opacity={0.55} />
        )}
      </svg>
    </span>
  );
}

export default StatusMark;
