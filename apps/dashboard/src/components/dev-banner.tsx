"use client";
import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
const DEVELOPMENT_DATA_NOTICE = "Every record is synthetic and every external effect is simulated; nothing here is a production claim.";
/** Props of {@link DevBanner}. */
export interface DevBannerProps {
  scenarioId?: string;
  className?: string;
}
/** The persistent **Development data** label: the single statement that this application shows synthetic development data and simulated external effects, present on every surface — signed in. */
export function DevBanner({ scenarioId, className }: DevBannerProps) {
  // A blank identifier names no scenario, so it renders nothing at all rather than an empty
  // "scenario:" prefix that looks like a value failed to load.
  const scenario = scenarioId?.trim() ?? "";
  return (
    <div
      className={cn(
        // `flex-wrap` with a column gap is what keeps the label explicit at 320 CSS px: the
        // notice and the scenario move onto their own lines instead of being clipped, and no
        // width here can push the page sideways.
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs",
        className,
      )}
    >
      <Badge variant="secondary">
        {/* Decorative: the words beside it carry the meaning, so the icon is hidden from
            assistive technology and only marks the label for a sighted reader. */}
        <FlaskConicalIcon aria-hidden="true" data-icon="inline-start" />
        Development data
      </Badge>
      <span className="min-w-0 text-muted-foreground break-words">{DEVELOPMENT_DATA_NOTICE}</span>
      {scenario === "" ? null : (
        <span className="min-w-0 text-muted-foreground">
          scenario:{" "}
          {/* A scenario identifier is not prose: `<bdi>` isolates it from the surrounding
              direction and the monospace utility keeps a mixed-direction name or number from
              reordering the words around it. `break-all` keeps an unusually long identifier
              inside the line instead of overflowing the viewport. */}
          <bdi className="mono-identifier break-all">{scenario}</bdi>
        </span>
      )}
    </div>
  );
}
export default DevBanner;
