/**
 * `/work/series/[seriesId]` — one recurring plan of the Work family (AAP 0.9.1, 0.10.1 unit 4): the rule it
 * repeats by, the one occurrence it admits, the plan review several missed dates open, and pause, resume or stop.
 *
 * **What this file is.** Composition, nothing else. It reads `reads.series.readSeries` once and hands the one
 * envelope to the family's own record body — composed on the client through this route's locale boundary, so the
 * preview's dates are formatted in the locale the browser chose — which owns the next-dates preview, the occurrence
 * group, the *Plan needs review* statement, the this-occurrence and this-and-future revisions and the state
 * controls. This route restates none of it: no
 * date, rule, count or review decision is derived here, because the read already computed each one and a second
 * answer on this page could only disagree with the envelope it was handed.
 *
 * **Why the record body is the one series block composed here.** The family's next-date preview, plan-review
 * panel and series editor each take resolved facts rather than an envelope — parsed civil dates, and the
 * occurrence a resolution applies to — and each decides from those facts whether it renders at all. Building
 * them from this route would mean parsing dates and branching on review state inside a page whose job is
 * composition, and would put a second this-and-future editor beside the record body's own.
 *
 * **Why the refusal arms are stated here.** A series the caller may not read answers `denied` with no record,
 * count or title, and an unreadable document answers `unavailable`; both are stated in this route's own words
 * rather than thrown, because a task list row links here and a broken destination would be a dead end.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
// The family's record body, composed on the client behind this route's locale boundary so its next-dates preview
// formats dates in the locale this browser chose.
import SeriesPlanView from "./series-plan-view";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The series, its plan review and the occurrence it admits are derived per request from this session and the scenario instant. */
export const dynamic = "force-dynamic";

/** The document title. A plan's own title is the record body's h1, so naming it here as well would state it twice. */
export const metadata: Metadata = { title: "Repeating plan" };

/** This surface's own address and the list a retry or a return goes to. */
const WORK_HREF = "/work";

const SERIES_HREF = "/work/series";

/** This page's own wording. */
const PAGE_COPY = {
  denied: {
    title: "This repeating plan is not available",
    body: "This session may not read that plan, so no rule, date, occurrence or count is stated here — a refusal discloses nothing about whether the plan exists. Another plan, or another context, can be read from the Work lists.",
  },
  unavailable: { title: "This repeating plan could not be read", retry: "Try this read again" },
  refused: { title: "This plan's request was refused", body: "The identifier in this address is not one the series read admits, or the request stated something it does not accept, so the refusal is answered here rather than thrown." },
  backToLists: "Read the Work lists",
} as const;

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

export interface WorkSeriesPageProps {
  readonly params: Promise<{ readonly seriesId: string }>;
}

/** One repeating plan: the record body, or the notice its refusal is stated with. */
export default async function WorkSeriesPage({ params }: WorkSeriesPageProps): Promise<ReactElement> {
  const { seriesId } = await params;
  const result = await reads.series.readSeries({ seriesId });
  switch (result.kind) {
    case "envelope":
      return <SeriesPlanView envelope={result.envelope} />;
    case "denied":
      // The closed reason code is the whole answer: no title, count or date travels with it.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} action={{ label: PAGE_COPY.backToLists, href: WORK_HREF }} />
        </div>
      );
    case "unavailable":
      // The source did not answer, so the plan is reported as unavailable rather than as one that repeats nothing.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: `${SERIES_HREF}/${encodeURIComponent(seriesId)}` }} />
        </div>
      );
    case "refused":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} action={{ label: PAGE_COPY.backToLists, href: WORK_HREF }} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled series read result");
  }
}
