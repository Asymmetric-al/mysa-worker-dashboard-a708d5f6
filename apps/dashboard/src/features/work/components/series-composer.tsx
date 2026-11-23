"use client";
/**
 * The create surface for a repeating plan, mounted by `/work`.
 *
 * AAP 0.9.1 fixes the Work family's routes at `/work`, `/work/agenda` and `/work/series/[seriesId]`, so a plan is
 * created from the list surface: a `/work/series/new` address would be read as a plan whose identifier is "new".
 * The rule, the form, the attempt's identity and the receipt all belong to `SeriesEditor`; this file owns where the
 * editor is mounted, what it opens with and where an accepted creation goes.
 */
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Scope } from "@/modules/data-service/envelope";
import type { MutationOutcome } from "@/modules/data-service/outcome";
import { CREATE_PLAN_HEADING, CREATE_PLAN_NOTE, NEW_PLAN_LABEL } from "../copy/repeat-profiles";
import SeriesEditor from "./series-editor"; /** The two outcomes that report an applied creation, which is the only pair of answers that means a plan now exists. */
type AppliedOutcome = Extract<MutationOutcome, { readonly outcome: "accepted" | "alreadyAccepted" }>;
export interface SeriesComposerProps {
  /** The authority the Work lists were read under, handed on unchanged so a creation acts in the same context. */
  readonly scope: Scope;
  /** The revision those lists were read at, presented as the attempt's own `expectedRevision` the way every browser mutation presents the revision it read. */ readonly expectedRevision: string;
  /** The IANA zones this surface admits for planning; the editor keeps the page's list and adds a plan's own zone. */ readonly planningTimeZoneChoices: readonly string[];
  readonly className?: string;
}
/** The create surface of a repeating plan: the section's own words, the editor it opens, and the plan it lands on. */ export default function SeriesComposer({ scope, expectedRevision, planningTimeZoneChoices, className }: SeriesComposerProps): ReactElement {
  const router = useRouter();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const openEditor = useCallback((): void => setOpen(true), []);
  const closeEditor = useCallback((): void => setOpen(false), []);
  const openPlan = useCallback(
    (outcome: AppliedOutcome): void => {
      const created = outcome.created?.[0]; // `createSeries` reports the plan it created first and the date it anchored on that plan second, so the identifier the outcome carries is the plan's own; an answer that created nothing opens nothing and invents no address.
      if (created === undefined) return;
      router.push(`/work/series/${encodeURIComponent(created)}`);
    },
    [router],
  );
  return (
    <section data-slot="work-series-composer" aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-lg font-medium text-pretty">
          {CREATE_PLAN_HEADING}
        </h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{CREATE_PLAN_NOTE}</p>
      </div>
      {open ? (
        // The ongoing-personal-series policy is admitted on the basis the plan's own this-and-future form uses: no read
        // publishes a separate capability for the shape, so withholding it would refuse a choice the worker's own plan
        // grants, while an end date or a count stays required for every worker who has no such plan to compare with.
        <SeriesEditor mode="create" scope={scope} expectedRevision={expectedRevision} planningTimeZoneChoices={planningTimeZoneChoices} ongoingPolicyAdmitted headingLevel={3} onSaved={openPlan} onCancel={closeEditor} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="button" onClick={openEditor}>
            {NEW_PLAN_LABEL}
          </Button>
        </div>
      )}
    </section>
  );
}
