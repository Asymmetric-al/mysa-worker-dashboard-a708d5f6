/**
 * `/work/agenda` — the Work family's dated agenda (AAP 0.9.1, 0.10.1 unit 3): the open dated work of this
 * context, grouped by the day each task is due, in the one display zone the page states.
 *
 * **What this file is.** Composition, nothing else. It reads `reads.work.readAgenda` once and the roster labels
 * a row names its partner with, then hands both to the family's own agenda surface, which owns the grouping, the
 * day headings and every word on a row.
 *
 * **Why it is a separate destination.** The sidebar links this surface beside the lists, so a worker can read the
 * plan as a calendar rather than as five lists. That makes the address a destination of its own rather than an
 * anchor: a task is completed, reopened, edited or cancelled on the lists, and undated work is never grouped by a
 * day, so the agenda states where that work is read instead of leaving a gap.
 *
 * **Why the display zone is stated rather than inferred.** The same reason the lists state it: a date is judged
 * against "today", today depends on a zone, and the browser's chosen display zone is held in the browser, where a
 * server render cannot read it. This route therefore reads in the service's own default display zone and says so.
 */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import WorkAgenda from "@/features/work/components/work-agenda";
import { partnerLabelsOf } from "@/features/work/copy/partner-labels";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
import { REPORT_DEFAULT_TIME_ZONE } from "@/modules/support/report";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What the agenda read answers: the envelope, a denial, an outage behind the records, or a refused request. */
type AgendaResult = Awaited<ReturnType<typeof reads.work.readAgenda>>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The agenda is derived from this session's context and the scenario instant on every request, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Agenda";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** This surface's own address, which a retry re-requests, and the lists one level beside it. */
const AGENDA_HREF = "/work/agenda";

const WORK_HREF = "/work";

/** The zone every date on this page is judged in, stated on the page rather than assumed silently. */
const DISPLAY_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;

/** The page window the agenda is read at, and the page of partners a row may name: both are the documented cap. */
const AGENDA_PAGE_SIZE = 200;

const PARTNER_LABEL_PAGE_SIZE = 200;

const FIRST_PAGE = 0;

/** This page's own wording. */
const PAGE_COPY = {
  lede: "The open dated work of this context, grouped by the day each task is due, with the plan a meeting states and the records a task is linked to. Undated work is read on the lists, never here, and a task is completed, reopened, edited or cancelled there.",
  zone: `Every day on this page is judged in ${DISPLAY_TIME_ZONE}, because a server render cannot know the display time zone this browser chose in Settings, and a day is never stated in a zone nobody chose.`,
  listsLink: "Read the five task lists",
  denied: {
    title: "The dated agenda is not available in this context",
    body: "This session may not read the tasks of the context it is working in, so no day, row or count is stated here — a refusal is not an empty agenda. Another context, if this session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "The dated agenda could not be read", retry: "Try this read again" },
  refused: { title: "This view's request was refused", body: "This route states only the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
} as const;

// ---------------------------------------------------------------------------------------------
// The refusal the page states in its own words
// ---------------------------------------------------------------------------------------------

/** The notice a page-level refusal is stated with: one heading below the page's own, and a retry of this same read where one is possible. */
function AgendaNotice({ result }: { readonly result: Exclude<AgendaResult, { readonly kind: "envelope" }> }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: AGENDA_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled agenda read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** The dated agenda: one read, one snapshot, and the family's own agenda rendering it. */
export default async function WorkAgendaPage(): Promise<ReactElement> {
  // The two reads describe the same request and neither depends on the other, so they are read together.
  const [agenda, partners] = await Promise.all([reads.work.readAgenda({ displayTimeZone: DISPLAY_TIME_ZONE, pageSize: AGENDA_PAGE_SIZE }), reads.partners.findPartners({ page: { index: FIRST_PAGE, size: PARTNER_LABEL_PAGE_SIZE } })]);
  const partnerLabels = partnerLabelsOf(partners.kind === "envelope" ? partners.envelope.data.rows : []);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this page: every day below opens at level two. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.zone}</p>
        <p className="text-sm">
          <Link href={WORK_HREF}>{PAGE_COPY.listsLink}</Link>
        </p>
      </div>
      {agenda.kind === "envelope" ? <WorkAgenda envelope={agenda.envelope} partnerLabels={partnerLabels} /> : <AgendaNotice result={agenda} />}
    </div>
  );
}
