"use client";
import * as React from "react";
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@/lib/ui-sdk";
import { cn } from "@/lib/cn";

export type MeterBarTone = "primary" | "positive" | "warning" | "info";

const TONE_INDICATOR: Readonly<Record<MeterBarTone, string>> = { primary: "bg-primary", positive: "bg-positive", warning: "bg-warning", info: "bg-info" };

export type MeterBarProps = { readonly label: string; readonly value: number; readonly min?: number; readonly max?: number; readonly valueText?: string; readonly displayValue?: React.ReactNode; readonly tone?: MeterBarTone; readonly showHeader?: boolean; readonly className?: string };

/** Styled UI SDK Meter primitive with Maia Zinc pill track, semantic indicator fill, and accessible labelling. */
export function MeterBar({ label, value, min = 0, max = 100, valueText, displayValue, tone = "primary", showHeader = true, className }: MeterBarProps) {
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return (
    <Meter value={clamped} min={min} max={max} getValueLabel={valueText === undefined ? undefined : () => valueText} className={cn("flex w-full min-w-0 flex-col gap-2", className)}>
      {showHeader ? (
        <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
          <MeterLabel className="font-medium text-muted-foreground">{label}</MeterLabel>
          <MeterValue className="tabular-figures font-medium text-foreground">{displayValue}</MeterValue>
        </div>
      ) : (
        <MeterLabel className="sr-only">{label}</MeterLabel>
      )}
      <MeterTrack className="relative h-2.5 w-full overflow-hidden rounded-4xl bg-muted ring-1 ring-border/60">
        <MeterIndicator className={cn("h-full rounded-4xl transition-[width] duration-300 ease-out", TONE_INDICATOR[tone])} />
      </MeterTrack>
    </Meter>
  );
}

export default MeterBar;
