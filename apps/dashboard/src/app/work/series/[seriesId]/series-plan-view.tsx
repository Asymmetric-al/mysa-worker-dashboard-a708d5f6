"use client";
/**
 * The locale-aware composition of one repeating plan, rendered by `/work/series/[seriesId]`.
 *
 * **Why the plan is read here as well.** The server render is the first paint: the envelope this route already
 * read seeds the browser read, so the first browser paint states exactly what the server painted and no second
 * request repeats that read on mount. Every settled change to the plan — answering the one date, revising this
 * plan and future ones, pausing, resuming or stopping — invalidates this family's `series` key, so the plan on
 * screen re-reads and the rule, the state and the dates a worker sees are the ones the plan holds now rather than
 * the ones it held when the page was requested.
 *
 * **Why the refusal arms are stated here too.** The route keeps its own arms for the first render; a re-read
 * answers with the same four, and one that is no longer the plan is stated in its place rather than thrown or
 * painted over with the answer that preceded it.
 *
 * The record body belongs to the work feature, and a feature may not reach another feature's provider, so the
 * route states the viewer's interface locale here and hands it to the body: the plan's next-dates preview
 * formats its dates in the locale this browser chose. Nothing else about the plan depends on it — the zone the
 * dates are planned in is the plan's own, and the locale never decides which date a rule produces. The boundary
 * a prospective revision takes effect from is handed down the same way, derived from this read rather than from
 * a clock here, so the form presents a boundary the plan's own rule engine accepts.
 */
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import { useViewerPreferences } from "@/features/shell/components/viewer-preferences-provider";
import OccurrenceActions, { type OccurrenceActionsProps } from "@/features/work/components/occurrence-actions";
import { SERIES_REREAD_BACK_LABEL, SERIES_REREAD_DENIED_BODY, SERIES_REREAD_DENIED_TITLE, SERIES_REREAD_FAILED_BODY, SERIES_REREAD_REFUSED_BODY, SERIES_REREAD_REFUSED_TITLE, SERIES_REREAD_UNAVAILABLE_RETRY, SERIES_REREAD_UNAVAILABLE_TITLE } from "@/features/work/copy/repeat-profiles";
import { useSeries, type SeriesResult } from "@/features/work/hooks/use-series";
import { prospectiveRevisionBoundary } from "@/features/work/series-revision-boundary";
import { assertNever } from "@/lib/result";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The list a refusal or a failed read returns to: every plan this surface shows is opened from the Work lists. */
const WORK_HREF = "/work";

// ---------------------------------------------------------------------------------------------
// The record body
// ---------------------------------------------------------------------------------------------

/** What the series route hands its body: the one series read's envelope and nothing re-derived. */
export interface SeriesPlanViewProps {
  readonly envelope: OccurrenceActionsProps["envelope"];
}

/** Renders one repeating plan's record body with the viewer's interface locale, from the plan as the browser last read it. */
export default function SeriesPlanView({ envelope }: SeriesPlanViewProps): ReactElement {
  const { interfaceLocale } = useViewerPreferences();
  // The envelope this route already read answers for the same scope and the same plan, so it seeds the read
  // rather than being fetched a second time on mount.
  const seed: SeriesResult = { kind: "envelope", envelope };
  const read = useSeries(envelope.scope, envelope.data.seriesId, seed);
  // A read that answered nothing is the case a settled change must not be painted over: the envelope beside it is
  // the plan as it stood before that change, so it is reported as unavailable and re-requested instead.
  if (read.isError || read.isRefetchError) {
    return (
      <StateNotice
        kind="unavailable"
        headingLevel={1}
        title={SERIES_REREAD_UNAVAILABLE_TITLE}
        description={SERIES_REREAD_FAILED_BODY}
        retry={{
          label: SERIES_REREAD_UNAVAILABLE_RETRY,
          onClick: () => {
            void read.refetch();
          },
        }}
      />
    );
  }
  const reading: SeriesResult = read.data ?? seed;
  switch (reading.kind) {
    case "envelope":
      // The boundary the plan's revision form presents is handed down from this read like the locale is: the plan's
      // own prospective boundary — the later of its today and the latest rule boundary it carries — so a plan whose
      // rule begins in the future presents that boundary rather than a date its engine would refuse.
      return <OccurrenceActions envelope={reading.envelope} displayLocale={interfaceLocale} effectiveFrom={prospectiveRevisionBoundary(reading.envelope.data)} />;
    case "denied":
      // The closed reason code is the whole answer: no title, count or date travels with it.
      return <StateNotice kind="denied" headingLevel={1} title={SERIES_REREAD_DENIED_TITLE} description={SERIES_REREAD_DENIED_BODY} reasonCode={reading.denied.reasonCode} action={{ label: SERIES_REREAD_BACK_LABEL, href: WORK_HREF }} />;
    case "unavailable":
      // The source did not answer, so the plan is reported as unavailable rather than as one that repeats nothing.
      return (
        <StateNotice
          kind="unavailable"
          headingLevel={1}
          title={SERIES_REREAD_UNAVAILABLE_TITLE}
          description={reading.unavailable.guidance}
          source={reading.unavailable.source}
          retry={{
            label: SERIES_REREAD_UNAVAILABLE_RETRY,
            onClick: () => {
              void read.refetch();
            },
          }}
        />
      );
    case "refused":
      return <StateNotice kind="refused" headingLevel={1} title={SERIES_REREAD_REFUSED_TITLE} description={SERIES_REREAD_REFUSED_BODY} action={{ label: SERIES_REREAD_BACK_LABEL, href: WORK_HREF }} />;
    default:
      return assertNever(reading, "Unhandled series read result");
  }
}
