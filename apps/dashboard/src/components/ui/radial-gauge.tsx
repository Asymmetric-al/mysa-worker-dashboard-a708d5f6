"use client";
import * as React from "react";
import { CheckIcon } from "lucide-react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";

export type RadialGaugeProps = {
  /** Clamped visual fill 0..100; optional center label renders an exact stated figure when shown standalone. */
  readonly percentage: number;
  readonly displayLabel?: string;
  readonly ariaLabel: string;
  readonly className?: string;
};

/**
 * ReUI `radial-chart` compact progress ring for stated goal percentages.
 * Only render when the domain has explicitly stated a valid percentage (never for paused/ended/unavailable/incompatible goals).
 */
export function RadialGauge({ percentage, displayLabel, ariaLabel, className }: RadialGaugeProps) {
  const reducedMotion = usePrefersReducedMotion();
  const safePercent = Number.isFinite(percentage) ? percentage : 0;
  const clamped = Math.min(100, Math.max(0, safePercent));
  const met = safePercent >= 100;
  const fillToken = met ? "var(--positive)" : "var(--primary)";
  const data = React.useMemo(() => [{ name: ariaLabel, value: clamped, fill: fillToken }], [ariaLabel, clamped, fillToken]);

  return (
    <figure data-slot="radial-gauge" aria-label={ariaLabel} className={cn("relative m-0 flex size-20 shrink-0 items-center justify-center", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={data} cx="50%" cy="50%" innerRadius="72%" outerRadius="100%" barSize={7} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" background={{ fill: "var(--muted)" }} cornerRadius={8} isAnimationActive={!reducedMotion} />
        </RadialBarChart>
      </ResponsiveContainer>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {displayLabel !== undefined ? (
          <span className="text-sm font-semibold tabular-figures text-foreground">
            <bdi>{displayLabel}</bdi>
          </span>
        ) : met ? (
          <CheckIcon className="size-4 text-positive" strokeWidth={2.25} />
        ) : (
          <span className="size-2 rounded-full bg-primary/65" />
        )}
      </span>
    </figure>
  );
}

export default RadialGauge;
