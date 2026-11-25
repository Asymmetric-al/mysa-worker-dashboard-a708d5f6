"use client";
import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
export type DevBannerProps = { scenarioId?: string; className?: string };
/** The persistent **Development data** label: the single statement that this application shows synthetic development data and simulated external effects, present on every surface — signed in. */ export function DevBanner({ scenarioId, className }: DevBannerProps) {
  const scenario = scenarioId?.trim() ?? "";
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-border/70 bg-surface-subtle px-2.5 py-1 text-xs", className)}>
      <Badge variant="warning-light" className="gap-1.5">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
        <FlaskConicalIcon aria-hidden="true" data-icon="inline-start" />
        Development data
      </Badge>
      <span className="min-w-0 text-muted-foreground break-words">{"Every record is synthetic and every external effect is simulated; nothing here is a production claim."}</span>
      {scenario === "" ? null : (
        <span className="ms-auto flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span>scenario:</span>
          {/* A scenario identifier is not prose: `<bdi>` isolates it from the surrounding direction and the monospace utility keeps a mixed-direction name or number from reordering the words around it. `break-all` keeps an unusually long identifier inside the line instead of overflowing the viewport. */}
          <Badge variant="outline" className="h-5 px-2">
            <bdi className="mono-identifier break-all">{scenario}</bdi>
          </Badge>
        </span>
      )}
    </div>
  );
}
export default DevBanner;
