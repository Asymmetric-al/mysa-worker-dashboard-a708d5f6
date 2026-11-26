import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { isSharedRecord } from "@/features/partners/record-class";
import type { TaskComposerInitialValues, TaskLinkChoice, TaskLinkChoices } from "@/features/work/components/task-composer";
import SeriesComposer from "@/features/work/components/series-composer";
import { partnerLabelsOf } from "@/features/work/copy/partner-labels";
import { PLANNING_TIME_ZONE_CHOICES } from "@/features/work/copy/planning-zones";
import { initiativeLinkValue, partnerLinkValue } from "@/features/work/copy/task-links";
import type { TaskListKey } from "@/features/work/copy/task-status";
import { reads } from "@/modules/data-service";
import { PAGE_SIZE_DEFAULT, REPORT_DEFAULT_TIME_ZONE } from "@/modules/support/report";
import { PageColumn, PageHeading, ReadNotices, paramOf, type ReadNoticeCopy, type SearchParams } from "../page-frame";
import { WorkListsSurface } from "./display-zone-surfaces";
type TaskListsResult = Awaited<ReturnType<typeof reads.work.listTasks>>;
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Tasks";
export const metadata: Metadata = { title: PAGE_TITLE };
const TASK_LIST_KEYS = ["today", "upcoming", "overdue", "all", "undated"] as const satisfies readonly TaskListKey[];
/** This surface's agenda address, named once so the link and any other reference to it state one address. */
/** The agenda link's treatment: the same shape a task row gives its own link, so one link style serves this surface — at least 24 CSS px tall (WCAG 2.5.8) and carrying the one inline-link underline, so the affordance is never carried by colour alone. */
/** The zone this page's own server read is judged in. A server render cannot know the display time zone this browser chose in Settings, so this is the pre-hydration zone: the lists re-read in the zone the browser hands them, and the surface states the zone its read judged it in. */
const DISPLAY_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;
const TASK_PAGE_SIZE = PAGE_SIZE_DEFAULT;
const LINK_CHOICE_PAGE_SIZE = PAGE_SIZE_DEFAULT;
const FIRST_PAGE = 0;
const FIRST_INITIATIVE_PAGE = 1;
const PAGE_COPY = {
  lede: "Calls, emails, thank-yous, and follow-ups that keep you close to your partners.",
  agendaLink: "View dated agenda",
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "Tasks aren’t available in this ministry", body: "Your current session doesn’t have access to tasks here. If you belong to another ministry, switch to it from the header." },
  unavailable: { title: "Couldn’t load your tasks", action: { label: "Try again", href: "/work" } },
  refused: { title: "Couldn’t load tasks", body: "This view couldn’t run with the requested parameters. Reload to try again." },
};
async function readLists(): Promise<Readonly<Record<TaskListKey, TaskListsResult>>> {
  const answers = await Promise.all(TASK_LIST_KEYS.map((list) => reads.work.listTasks({ list, displayTimeZone: DISPLAY_TIME_ZONE, pageSize: TASK_PAGE_SIZE })));
  return Object.fromEntries(TASK_LIST_KEYS.map((list, index) => [list, answers[index]])) as Readonly<Record<TaskListKey, TaskListsResult>>;
}
function linkChoicesOf(partners: Awaited<ReturnType<typeof reads.partners.findPartners>>, initiatives: Awaited<ReturnType<typeof reads.outreach.readInitiatives>>): TaskLinkChoices | undefined {
  if (partners.kind === "unavailable") return { status: "unavailable", source: partners.unavailable.source, guidance: partners.unavailable.guidance };
  if (initiatives.kind === "unavailable") return { status: "unavailable", source: initiatives.unavailable.source, guidance: initiatives.unavailable.guidance };
  if (partners.kind !== "envelope" || initiatives.kind !== "envelope") return undefined;
  // A worker-private preparation record is a different record class from a shared operational fact, so it is never a link target for a task; the partners family states that line once in `isSharedRecord`, and this page applies it rather than keeping a second copy of it.
  const partnerChoices: readonly TaskLinkChoice[] = partners.envelope.data.rows.filter((row) => isSharedRecord(row.partner)).map((row) => ({ value: partnerLinkValue(row.partner.partnerId), label: row.partner.displayName }));
  return { status: "admitted", partners: partnerChoices, initiatives: initiatives.envelope.data.items.map((initiative) => ({ value: initiativeLinkValue(initiative.initiativeId), label: initiative.name })) };
}
function initialValuesOf(stated: string | undefined, linkChoices: TaskLinkChoices | undefined): TaskComposerInitialValues | undefined {
  if (stated === undefined || linkChoices === undefined || linkChoices.status !== "admitted") return undefined;
  const link = partnerLinkValue(stated);
  return linkChoices.partners.some((choice) => choice.value === link) ? { link } : undefined;
}
/** The Work surface: one read per list, one snapshot, and the family's own surface rendering it. A denial or an outage is a fact about the session and the source rather than about one list, so the widest list answers for the page and states the refusal once. */
export default async function WorkPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const [lists, partners, initiatives] = await Promise.all([readLists(), reads.partners.findPartners({ page: { index: FIRST_PAGE, size: LINK_CHOICE_PAGE_SIZE } }), reads.outreach.readInitiatives({ page: FIRST_INITIATIVE_PAGE, pageSize: LINK_CHOICE_PAGE_SIZE })]);
  const linkChoices = linkChoicesOf(partners, initiatives);
  const partnerLabels = partnerLabelsOf(partners.kind === "envelope" ? partners.envelope.data.rows : []);
  const primary = lists.all;
  const initialValues = initialValuesOf(paramOf(stated, "partnerId"), linkChoices);
  return (
    <PageColumn>
      <PageHeading title={PAGE_TITLE} paragraphs={[PAGE_COPY.lede]} />
      <p className="type-body">
        <Link href={"/work/agenda"} className={"inline-flex min-h-6 max-w-full items-center break-words inline-link hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"}>
          {PAGE_COPY.agendaLink}
        </Link>
      </p>
      {primary.kind === "envelope" ? (
        <>
          {/* The lists are read again in the display time zone the browser chose in Settings, handed down by the route's own client surface above the feature, so the five reads this page made are the seed for the pre-hydration zone and never the zone a list on screen is judged in. */}
          <WorkListsSurface scope={primary.envelope.scope} expectedRevision={primary.envelope.revision} lists={lists} partnerLabels={partnerLabels} linkChoices={linkChoices} timeZoneChoices={PLANNING_TIME_ZONE_CHOICES} initialValues={initialValues} />
          {/* The plan's create section is handed the same envelope the lists were read from, so a creation acts in the context this page states and presents the revision it read rather than one it derived. */}
          <SeriesComposer scope={primary.envelope.scope} expectedRevision={primary.envelope.revision} planningTimeZoneChoices={PLANNING_TIME_ZONE_CHOICES} />
        </>
      ) : (
        <ReadNotices failure={primary} copy={NOTICE_COPY} />
      )}
    </PageColumn>
  );
}
