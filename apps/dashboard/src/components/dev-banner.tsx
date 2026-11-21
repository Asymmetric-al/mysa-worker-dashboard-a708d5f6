"use client";

import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * The one statement the label always shows.
 *
 * It names the two facts a reader must not have to infer — every record is synthetic and every
 * external effect is simulated — and says plainly that nothing on the surface is a production
 * claim. It paraphrases none of the five per-effect sentences `SimulationLabel` owns, because
 * those label one effect at the point the worker triggers it; this sentence describes the whole
 * development dataset and stays true whether or not an effect is in progress.
 */
const DEVELOPMENT_DATA_NOTICE =
  "Every record is synthetic and every external effect is simulated; nothing here is a production claim.";

/** Props of {@link DevBanner}. */
export interface DevBannerProps {
  /**
   * Identifier of the scenario this session is running, named after the notice so a tester can
   * tell which seeded state is on screen. Omitted or blank, no scenario is named.
   */
  scenarioId?: string;
  /**
   * Merged onto the label's own classes. It exists for placement inside the shell chrome — it
   * is never a way to hide or clip the label, which persists on every surface.
   */
  className?: string;
}

/**
 * The persistent **Development data** label: the single statement that this application shows
 * synthetic development data and simulated external effects, present on every surface —
 * signed in, denied, expired, unavailable and every error route alike, on a desktop shell and
 * on the phone shell.
 *
 * The application shell renders it once in its chrome, ahead of the main landmark, so no route
 * can forget it and no surface can be mistaken for production. It holds no state, fetches
 * nothing and carries no control: there is deliberately no open state, no close button, no
 * auto-hide timer and no remembered "seen" flag, because a label a reader can remove is not a
 * label, and an icon-only or tooltip-only form would hide the one sentence that matters.
 *
 * It is not a live region either — `role="status"` or `aria-live` here would re-announce the
 * same words on every navigation — so it is plain text in the reading order.
 *
 * The scenario, clock and failure-plan controls belong to `dev-panel`; the per-effect
 * simulated sentences belong to `simulation-label`. Neither grows into this file.
 */
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
      <span className="min-w-0 text-muted-foreground break-words">
        {DEVELOPMENT_DATA_NOTICE}
      </span>
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
