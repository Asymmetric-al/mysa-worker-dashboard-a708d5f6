import * as React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { IconTile, type IconTileProps } from "@/components/ui/icon-tile";
import { cn } from "@/lib/cn";

/** Responsive KPI grid adapted from Shadcn Space `statistics-01` and Shadcn Studio `statistics-component-12`/`13`. */
function KpiGrid({ className, columns = 3, ...props }: React.ComponentProps<"div"> & { readonly columns?: 2 | 3 | 4 }) {
  const colsClass = columns === 2 ? "@xl/main:grid-cols-2" : columns === 4 ? "@xl/main:grid-cols-2 @4xl/main:grid-cols-4" : "@xl/main:grid-cols-2 @3xl/main:grid-cols-3";
  return <div data-slot="kpi-grid" className={cn("grid min-w-0 grid-cols-1 items-stretch gap-4", colsClass, className)} {...props} />;
}

export type KpiCardProps = {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly detail?: React.ReactNode;
  readonly badge?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly iconVariant?: IconTileProps["variant"];
  readonly footer?: React.ReactNode;
  readonly href?: string;
  readonly actionLabel?: string;
  readonly className?: string;
};

/** Metric card combining Shadcn Space `statistics-01` hierarchy with Shadcn Studio `statistics-component-12` status accents and `statistics-component-13` action footer. */
function KpiCard({ label, value, detail, badge, icon, iconVariant = "soft", footer, href, actionLabel, className }: KpiCardProps) {
  return (
    <Card data-slot="kpi-card" size="sm" className={cn("h-full justify-between gap-0 p-0", className)}>
      <CardContent className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon === undefined ? null : (
              <IconTile variant={iconVariant} size="sm">
                {icon}
              </IconTile>
            )}
            <span className="min-w-0 text-sm font-medium text-muted-foreground text-pretty">{label}</span>
          </div>
          {badge === undefined ? null : <div className="shrink-0">{badge}</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="tabular-figures font-heading text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {detail === undefined ? null : <div className="text-xs text-muted-foreground text-pretty">{detail}</div>}
        </div>
      </CardContent>
      {footer !== undefined ? (
        <div className="border-t border-border/80 bg-surface-subtle px-4 py-2.5 text-xs text-muted-foreground">{footer}</div>
      ) : href !== undefined && actionLabel !== undefined ? (
        <Link
          href={href}
          className="group/kpi-link flex min-h-9 items-center justify-between gap-2 border-t border-border/80 bg-surface-subtle px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ring)]"
        >
          <span className="truncate">{actionLabel}</span>
          <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/kpi-link:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover/kpi-link:-translate-x-0.5" />
        </Link>
      ) : null}
    </Card>
  );
}

export { KpiCard, KpiGrid };
