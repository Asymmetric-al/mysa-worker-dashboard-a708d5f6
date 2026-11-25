"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";

export type SparklinePoint = {
  readonly label: string;
  /** Numeric value or `null` for an unrecorded gap (never bridged with a straight line). */
  readonly value: number | null;
  readonly formatted?: string;
};

export type MiniSparklineProps = {
  readonly data: readonly SparklinePoint[];
  readonly label: string;
  readonly className?: string;
};

/**
 * ReUI-inspired single-series sparkline (`@reui/sparkline` / Shadcn Space `statistics-19`).
 * Strictly single-currency/single-unit, `connectNulls={false}` so missing periods remain visible gaps,
 * uses CSS variables only, and disables chart animation under `prefers-reduced-motion`.
 */
export function MiniSparkline({ data, label, className }: MiniSparklineProps) {
  const reducedMotion = usePrefersReducedMotion();
  const gradientId = React.useId().replace(/:/g, "");
  const mutableData = React.useMemo(() => data.map((point) => ({ ...point })), [data]);

  if (mutableData.length < 2) return null;

  return (
    <figure data-slot="mini-sparkline" aria-label={label} className={cn("m-0 h-12 w-full min-w-0", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={mutableData} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || payload === undefined || payload.length === 0) return null;
              const datum = payload[0]?.payload as SparklinePoint | undefined;
              if (datum === undefined) return null;
              return (
                <div className="rounded-xl border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <p className="font-medium text-muted-foreground">{datum.label}</p>
                  <p className="tabular-figures font-semibold text-foreground">{datum.formatted ?? (datum.value === null ? "Not stated" : String(datum.value))}</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-4)"
            strokeWidth={1.75}
            fill={`url(#spark-${gradientId})`}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 3, fill: "var(--foreground)", stroke: "var(--card)", strokeWidth: 1.5 }}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}

export default MiniSparkline;
