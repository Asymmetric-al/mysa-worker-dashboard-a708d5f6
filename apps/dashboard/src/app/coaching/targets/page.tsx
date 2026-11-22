/**
 * `/coaching/targets` — the worker's targets and the periods each one is measured over (AAP 0.9.1 "Targets and
 * periods"; family 13 of AAP 0.10.1: four canonical measures over a Weekly, a Monthly or a one-off Custom period).
 *
 * **What this file is.** Composition, nothing else. It calls one named read once and hands that read's own answer on:
 * the family's targets surface owns the composer, the version history and the progress chart, the shared state notice
 * owns every answer that is not an envelope, and the family's copy owns the title. No measure, quantity, period,
 * percentage, deadline or permission is derived here, and no state lives here.
 *
 * **Why it states no page window.** The family's browser read of this same job reads the read's own default window, so
 * a window taken from this address would be honoured by the server render and then replaced by the default on the next
 * browser read, leaving an address that describes figures beside it no longer matching them. The coaching lists cap at
 * 100 rows, so the default window holds every target a worker has.
 *
 * **What this address does state.** `?target=<id>` picks which of the worker's own targets the three surfaces read.
 * It narrows nothing the read computes — the envelope already holds every target — so it is a choice of what to look
 * at rather than a filter the server applies, and a value naming no target this read states opens the first one.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import TargetsSurface from "@/features/coaching/components/targets-surface";
import { COACHING_COPY } from "@/features/coaching/copy";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

/** The page's title, from the family copy's own heading for this surface: the route states no wording of its own. */
const PAGE_TITLE = COACHING_COPY.targets.heading;

/** The document title: the surface, and nothing that would duplicate the root layout's template suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** The interface locale the composed surface records beside its facts; it reformats no civil date and states no amount. */
const INTERFACE_LOCALE = "en-GB";

/** The one query key this address states: which of the worker's own targets the surfaces below read. */
const TARGET_PARAM = "target";

/** Props of {@link CoachingTargetsPage}: Next hands a Server Component the request's search parameters as a promise. */
export interface CoachingTargetsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** One value of a repeated query key, since the same key may arrive more than once. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The worker's targets: the plan in force, the history it is read against and the counts its periods recorded. */
export default async function CoachingTargetsPage({ searchParams }: CoachingTargetsPageProps): Promise<ReactElement> {
  const params = await searchParams;
  // One read of one named job. It resolves the development-session cookie and the scenario clock, so the answer
  // belongs to the request rather than to a cached render. The chosen target is passed on as the id it is: the read
  // states every target, and which one is in view is this address's choice, not a filter the read applies.
  const result = await reads.coaching.readTargets();
  const selectedTargetId = firstValue(params[TARGET_PARAM]);
  switch (result.kind) {
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <div className="flex min-w-0 flex-col gap-2">
            {/* The one h1 on this page. The composed surfaces below open their own sections at level two, so the
                outline starts here; the sentence under it is the family's own statement of what a target counts. */}
            <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">{COACHING_COPY.targets.purpose}</p>
          </div>
          <TargetsSurface envelope={result.envelope} locale={INTERFACE_LOCALE} selectedTargetId={selectedTargetId} />
        </div>
      );
    case "denied":
      // No count, no measure name, no quantity, no private label and no version: the answer is identical whether or
      // not a target exists in the scope this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={PAGE_TITLE} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The outage is stated as an outage: the source's own identity, the family's sentence that nothing recorded has
      // changed, and never an empty list or a count of zero in its place.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={PAGE_TITLE} description={COACHING_COPY.targets.unavailable} source={result.unavailable.source} />
        </div>
      );
    case "refused":
      // This route calls the read directly, so the request is its own and never one a handler refuses: the arm is
      // stated here rather than thrown, and the notice says the request was refused rather than the source failing.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="refused" headingLevel={1} title={PAGE_TITLE} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled coaching targets read result");
  }
}
