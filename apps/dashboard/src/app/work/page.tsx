/**
 * `/work` — the Work family's surface (AAP 0.9.1, 0.10.1 unit 3): the five task lists over the one task model,
 * the composer that creates and edits a task, and the three bulk actions over the rows a worker selected.
 *
 * **What this file is.** Composition, nothing else. It reads `reads.work.listTasks` once per list, reads the two
 * records a new task may link to, and hands those answers to the family's own surface, which owns every row,
 * action, form and word. No task is filtered, counted, sorted or authorised here.
 *
 * **Why a repeating plan is created here.** A plan that repeats is created from this list surface rather than
 * from an address of its own: AAP 0.9.1 fixes the Work routes, and a `/work/series/new` address would be read as
 * a plan whose identifier is "new". The create section is composed beside the lists, under the same envelope, so
 * the plan's rule is stated once by the family's editor and the plan it creates opens on its own page.
 *
 * **Why the display zone is stated rather than inferred.** A date in these lists is judged against "today", and
 * today depends on a zone. The browser's chosen display zone lives in the browser (`ViewerPreferencesProvider`),
 * so a server render cannot know it, and naming one it guessed would judge dates in a zone nobody chose — the
 * fault the task reads themselves refuse. This route therefore reads in the service's own default display zone,
 * states it on the page, and the browser re-reads in that same zone, so the first paint and every later read
 * agree about which day it is.
 *
 * **Why the widest list decides the page's arm.** A denial or an outage behind these records is a fact about the
 * session and the source, not about one list, so the `all` read answers for the page: when it is refused the page
 * states that refusal once rather than five times, and when it answers the surface renders each list's own arm.
 */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

import { StateNotice } from "@/components/state-notice";
import SeriesComposer from "@/features/work/components/series-composer";
import type { TaskComposerInitialValues, TaskLinkChoice, TaskLinkChoices } from "@/features/work/components/task-composer";
import TaskLists from "@/features/work/components/task-lists";
import { partnerLabelsOf } from "@/features/work/copy/partner-labels";
import { PLANNING_TIME_ZONE_CHOICES } from "@/features/work/copy/planning-zones";
import { initiativeLinkValue, partnerLinkValue } from "@/features/work/copy/task-links";
import type { TaskListKey } from "@/features/work/copy/task-status";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
import { PAGE_SIZE_DEFAULT, REPORT_DEFAULT_TIME_ZONE } from "@/modules/support/report";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What one task list read answers, what the roster read answers and what the initiative read answers. */
type TaskListsResult = Awaited<ReturnType<typeof reads.work.listTasks>>;

type PartnersResult = Awaited<ReturnType<typeof reads.partners.findPartners>>;

type InitiativesResult = Awaited<ReturnType<typeof reads.outreach.readInitiatives>>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** Admission, the selected context, the scenario instant and the source's coverage are resolved per request, so nothing on this route may be cached across a context switch. */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Work";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** This surface's own address, which a retry re-requests, and the dated agenda one level beside it. */
const WORK_HREF = "/work";

const AGENDA_HREF = "/work/agenda";

/**
 * The agenda link's treatment: the same shape a task row gives its own link, so one link style serves this surface —
 * at least 24 CSS px tall (WCAG 2.5.8) and underlined, so the affordance is never carried by colour alone.
 */
const AGENDA_LINK_CLASS = "inline-flex min-h-6 max-w-full items-center break-words underline underline-offset-3 hover:decoration-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The zone every date on this page is judged in, stated on the page rather than assumed silently. */
const DISPLAY_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;

/**
 * The page window each list is read at: the documented default, which is the page the surface opens on, so the
 * first paint states exactly the window the worker sees rather than a page they cannot see past. The pager offers
 * the documented cap of 200 beside it, and the service refuses anything larger.
 */
const TASK_PAGE_SIZE = PAGE_SIZE_DEFAULT;

const LINK_CHOICE_PAGE_SIZE = 200;

/** The first page of each paged read, in each read's own indexing. */
const FIRST_PAGE = 0;

const FIRST_INITIATIVE_PAGE = 1;

/** The one search parameter this route reads: the partner a new task opens linked to. */
const PARTNER_PARAM = "partnerId";

/** This page's own wording. */
const PAGE_COPY = {
  lede: "The five task lists over the one task model this workspace keeps: today, upcoming, overdue, all and undated. Each row states its own status, the day it stands at and the records it is linked to, and completing a task records that the work was closed and says nothing about contact, payment or a message.",
  zone: `Every date on this page is judged in ${DISPLAY_TIME_ZONE}, because a server render cannot know the display time zone this browser chose in Settings; the lists re-read in that same zone, so no date here is judged in two.`,
  agendaLink: "Read the dated agenda",
  denied: { title: "The Work lists are not available in this context", body: "This session may not read the tasks of the context it is working in, so no row, count or list is stated here — a refusal is not an empty workspace. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The Work lists could not be read", retry: "Try this read again" },
  refused: { title: "This view's request was refused", body: "This route states only the list, the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
} as const;

// ---------------------------------------------------------------------------------------------
// The read's own answers, translated into the surface's inputs
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no list is treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  const trimmed = first.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The five lists, read together: they describe the same context at the same instant and none depends on another. */
async function readLists(): Promise<Readonly<Record<TaskListKey, TaskListsResult>>> {
  const [today, upcoming, overdue, all, undated] = await Promise.all([
    reads.work.listTasks({ list: "today", displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE }),
    reads.work.listTasks({ list: "upcoming", displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE }),
    reads.work.listTasks({ list: "overdue", displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE }),
    reads.work.listTasks({ list: "all", displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE }),
    reads.work.listTasks({ list: "undated", displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE }),
  ]);
  return { today, upcoming, overdue, all, undated };
}

/**
 * The records a new task may link to, or the outage that stopped those reads admitting any.
 *
 * A read that failed is never presented as a read that admitted nothing — an empty list of choices would say no
 * partner or initiative exists — and a refusal this page cannot describe in the composer's terms (a denial, a
 * refused request) offers no link at all rather than one the service would refuse.
 */
function linkChoicesOf(partners: PartnersResult, initiatives: InitiativesResult): TaskLinkChoices | undefined {
  if (partners.kind === "unavailable") return { status: "unavailable", source: partners.unavailable.source, guidance: partners.unavailable.guidance };
  if (initiatives.kind === "unavailable") return { status: "unavailable", source: initiatives.unavailable.source, guidance: initiatives.unavailable.guidance };
  if (partners.kind !== "envelope" || initiatives.kind !== "envelope") return undefined;
  const partnerChoices: readonly TaskLinkChoice[] = partners.envelope.data.rows.map((row) => ({ value: partnerLinkValue(row.partner.partnerId), label: row.partner.displayName }));
  const initiativeChoices: readonly TaskLinkChoice[] = initiatives.envelope.data.items.map((initiative) => ({ value: initiativeLinkValue(initiative.initiativeId), label: initiative.name }));
  return { status: "admitted", partners: partnerChoices, initiatives: initiativeChoices };
}

/** What a new task opens linked to: the partner this route named, but only when the read admitted that record as a link choice. */
function initialValuesOf(stated: string | undefined, linkChoices: TaskLinkChoices | undefined): TaskComposerInitialValues | undefined {
  if (stated === undefined || linkChoices === undefined || linkChoices.status !== "admitted") return undefined;
  const link = partnerLinkValue(stated);
  return linkChoices.partners.some((choice) => choice.value === link) ? { link } : undefined;
}

// ---------------------------------------------------------------------------------------------
// The refusal the page states in its own words
// ---------------------------------------------------------------------------------------------

/** The notice a page-level refusal is stated with: one heading below the page's own, and a retry of this same read where one is possible. */
function ListNotice({ result }: { readonly result: Exclude<TaskListsResult, { readonly kind: "envelope" }> }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: WORK_HREF }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled task list read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

export interface WorkPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/** The Work surface: one read per list, one snapshot, and the family's own surface rendering it. */
export default async function WorkPage({ searchParams }: WorkPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  // None of these four reads depends on another, and they describe the same request, so they are read together.
  const [lists, partners, initiatives] = await Promise.all([readLists(), reads.partners.findPartners({ page: { index: FIRST_PAGE, size: LINK_CHOICE_PAGE_SIZE } }), reads.outreach.readInitiatives({ page: FIRST_INITIATIVE_PAGE, pageSize: LINK_CHOICE_PAGE_SIZE })]);
  const linkChoices = linkChoicesOf(partners, initiatives);
  // A partner is named from the roster read that admitted it; a refusal or an outage there leaves the rows
  // stating the opaque reference each task actually carries rather than a name derived from it.
  const partnerLabels = partnerLabelsOf(partners.kind === "envelope" ? partners.envelope.data.rows : []);
  const primary = lists.all;
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this page: every list and every notice below opens at level two. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.zone}</p>
        <p className="text-sm">
          <Link href={AGENDA_HREF} className={AGENDA_LINK_CLASS}>
            {PAGE_COPY.agendaLink}
          </Link>
        </p>
      </div>
      {primary.kind === "envelope" ? (
        <>
          <TaskLists
            scope={primary.envelope.scope}
            expectedRevision={primary.envelope.revision}
            lists={lists}
            displayTimeZone={DISPLAY_TIME_ZONE}
            partnerLabels={partnerLabels}
            linkChoices={linkChoices}
            timeZoneChoices={PLANNING_TIME_ZONE_CHOICES}
            initialValues={initialValuesOf(paramOf(stated, PARTNER_PARAM), linkChoices)}
          />
          {/* The plan's create section is handed the same envelope the lists were read from, so a creation acts in
              the context this page states and presents the revision it read rather than one it derived. */}
          <SeriesComposer scope={primary.envelope.scope} expectedRevision={primary.envelope.revision} planningTimeZoneChoices={PLANNING_TIME_ZONE_CHOICES} />
        </>
      ) : (
        <ListNotice result={primary} />
      )}
    </div>
  );
}
