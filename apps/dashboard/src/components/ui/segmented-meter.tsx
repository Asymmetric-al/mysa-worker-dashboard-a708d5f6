"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

export type MeterSegmentTone = "positive" | "info" | "warning" | "destructive" | "muted" | "primary";

const SEGMENT_TONE_CLASS: Readonly<Record<MeterSegmentTone, string>> = {
  positive: "bg-positive",
  info: "bg-info",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/45",
  primary: "bg-primary",
};

export type SegmentedMeterItem = {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly tone: MeterSegmentTone;
};

export type SegmentedMeterProps = {
  /** Distinct named outcome/category counts — rendered as proportional bars without ever stating a combined total across incompatible meanings. */
  readonly segments: readonly SegmentedMeterItem[];
  readonly label: string;
  readonly className?: string;
};

/**
 * ReUI `status-tracker` / Shadcn UI Kit `kpi-card3` segmented proportional bar.
 * Strictly visual proportion of distinct named states using semantic Zinc tokens (never prints a combined total).
 */
export function SegmentedMeter({ segments, label, className }: SegmentedMeterProps) {
  const nonZero = segments.filter((segment) => Number.isFinite(segment.count) && segment.count > 0);
  const scale = nonZero.reduce((sum, segment) => sum + segment.count, 0);
  if (scale <= 0) return null;

  const summaryText = nonZero.map((segment) => `${segment.label}: ${String(segment.count)}`).join(", ");

  return (
    <figure data-slot="segmented-meter" aria-label={`${label} (${summaryText})`} className={cn("m-0 flex h-2.5 w-full min-w-0 overflow-hidden rounded-4xl bg-muted ring-1 ring-border/60", className)}>
      {nonZero.map((segment) => (
        <span
          key={segment.key}
          title={`${segment.label}: ${String(segment.count)}`}
          className={cn("h-full transition-[width] duration-300 ease-out first:rounded-s-4xl last:rounded-e-4xl", SEGMENT_TONE_CLASS[segment.tone])}
          style={{ width: `${String((segment.count / scale) * 100)}%` }}
        />
      ))}
    </figure>
  );
}

export type TickMeterProps = {
  /** Progress ratio 0..1 (clamped visually). */
  readonly ratio: number;
  readonly ticks?: number;
  readonly label: string;
  readonly tone?: MeterSegmentTone;
  readonly className?: string;
};

/** Shadcn UI Kit `kpi-card2` vertical tick-bar meter for goal/target completion cadence. */
export function TickMeter({ ratio, ticks = 16, label, tone = "primary", className }: TickMeterProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * ticks);

  return (
    <figure data-slot="tick-meter" aria-label={label} className={cn("m-0 flex h-5 w-full min-w-0 items-end gap-1", className)}>
      {Array.from({ length: ticks }, (_, index) => {
        const active = index < filled;
        return (
          <span
            key={`tick-${String(index)}`}
            aria-hidden="true"
            className={cn("flex-1 rounded-sm transition-colors", active ? cn("h-full", SEGMENT_TONE_CLASS[tone]) : "h-3 bg-muted")}
          />
        );
      })}
    </figure>
  );
}
