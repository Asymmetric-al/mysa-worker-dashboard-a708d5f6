import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { partnerLabelsOf } from "@/features/work/copy/partner-labels";
import { reads } from "@/modules/data-service";
import { REPORT_DEFAULT_TIME_ZONE } from "@/modules/support/report";
import { AgendaSurface } from "../display-zone-surfaces";
import { PageColumn, PageHeading, ReadNotices, type ReadNoticeCopy } from "../../page-frame";
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Agenda";
export const metadata: Metadata = { title: PAGE_TITLE };
/** The zone this page's own server read is judged in. A server render cannot know the display time zone this browser chose in Settings, so this is the pre-hydration zone: the agenda re-reads in the zone the browser hands it, and the surface states the zone its read judged it in. */
const DISPLAY_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;
const AGENDA_PAGE_SIZE = 200;
const PARTNER_LABEL_PAGE_SIZE = 200;
const FIRST_PAGE = 0;
const PAGE_COPY = { lede: "The open dated work of this context, grouped by the day each task is due, with the plan a meeting states and the records a task is linked to. Undated work is read on the lists, never here, and a task is completed, reopened, edited or cancelled there." } as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "The dated agenda is not available in this context", body: "This session may not read the tasks of the context it is working in, so no day, row or count is stated here — a refusal is not an empty agenda. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The dated agenda could not be read", action: { label: "Try this read again", href: "/work/agenda" } },
  refused: { title: "This view's request was refused", body: "This route states only the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
};
/** The dated agenda: one read, one snapshot, and the family's own agenda rendering it. */ export default async function WorkAgendaPage(): Promise<ReactElement> {
  const [agenda, partners] = await Promise.all([reads.work.readAgenda({ displayTimeZone: DISPLAY_TIME_ZONE, pageSize: AGENDA_PAGE_SIZE }), reads.partners.findPartners({ page: { index: FIRST_PAGE, size: PARTNER_LABEL_PAGE_SIZE } })]);
  const partnerLabels = partnerLabelsOf(partners.kind === "envelope" ? partners.envelope.data.rows : []);
  return (
    <PageColumn>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink className="inline-link" render={<Link href="/work" />}>
              {"Work"}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{PAGE_TITLE}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <PageHeading title={PAGE_TITLE} paragraphs={[PAGE_COPY.lede]} />
      {/* The agenda is read again in the display time zone the browser chose in Settings, handed down by the route's own client surface above the feature, so the read this page made is the seed for the pre-hydration zone and never the zone a day on screen is grouped under. */}
      {agenda.kind === "envelope" ? <AgendaSurface scope={agenda.envelope.scope} envelope={agenda.envelope} partnerLabels={partnerLabels} /> : <ReadNotices failure={agenda} copy={NOTICE_COPY} />}
    </PageColumn>
  );
}
