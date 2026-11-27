"use client";
import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
export type DevBannerProps = { scenarioId?: string; className?: string };
/** The persistent **Development data** label: the single statement that this application shows synthetic development data and simulated external effects, present on every surface — signed in. */ export function DevBanner({ scenarioId, className }: DevBannerProps) {
  const scenario = scenarioId?.trim() ?? "";
  return (
    <div className={cn("flex min-w-0 flex-nowrap items-center gap-2 rounded-xl border border-border/70 bg-surface-subtle px-2.5 py-1 text-xs", className)}>
      <Badge variant="warning-light" className="shrink-0 gap-1.5">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
        <FlaskConicalIcon aria-hidden="true" data-icon="inline-start" />
        Development data
      </Badge>
      <span className="hidden min-w-0 flex-1 truncate text-muted-foreground md:inline">{"Sample data only — emails, payments, and publishing are simulated locally."}</span>
      {scenario === "" ? null : (
        <span className="ms-auto flex min-w-0 shrink-0 items-center gap-1.5 text-muted-foreground">
          <span className="hidden sm:inline">Scenario:</span>
          {/* A scenario identifier is not prose: `<bdi>` isolates it from the surrounding direction and the monospace utility keeps a mixed-direction name or number from reordering the words around it. `truncate` keeps an unusually long identifier on one compact sticky line. */}
          <Badge variant="outline" className="h-5 max-w-36 shrink-0 px-2 sm:max-w-56">
            <bdi className="mono-identifier truncate">{scenario}</bdi>
          </Badge>
        </span>
      )}
    </div>
  );
}
export default DevBanner;
