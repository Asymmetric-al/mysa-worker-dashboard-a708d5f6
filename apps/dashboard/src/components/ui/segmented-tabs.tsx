"use client";
import * as React from "react";
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@/lib/ui-sdk";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { readonly value: T; readonly label: string; readonly count?: number };

export type SegmentedTabsProps<T extends string> = { readonly label: string; readonly value: T; readonly onValueChange: (value: T) => void; readonly options: readonly SegmentedOption<T>[]; readonly className?: string };

/** Sliding pill segmented control backed by UI SDK `SegmentedControl` + `SegmentedControlIndicator`, styled for Maia Zinc. */
export function SegmentedTabs<T extends string>({ label, value, onValueChange, options, className }: SegmentedTabsProps<T>) {
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      className={cn("relative inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-4xl border border-border/80 bg-muted/70 p-1 text-sm", className)}
    >
      <SegmentedControlIndicator className="pointer-events-none absolute top-[var(--segmented-control-indicator-top)] left-[var(--segmented-control-indicator-left)] h-[var(--segmented-control-indicator-height)] w-[var(--segmented-control-indicator-width)] rounded-4xl bg-card shadow-xs ring-1 ring-border/80 transition-[left,top,width,height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]" />
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          className="relative z-1 inline-flex min-h-7 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-4xl px-3 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[color,transform] hover:text-foreground active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] data-[checked]:text-foreground aria-checked:text-foreground"
        >
          <span>{option.label}</span>
          {option.count === undefined ? null : <span className="tabular-figures rounded-4xl bg-muted px-1.5 py-0.25 text-xs text-muted-foreground">{option.count}</span>}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

export default SegmentedTabs;
