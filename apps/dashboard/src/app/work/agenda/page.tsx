import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import Agenda from "@/features/work/components/agenda";
import { partnerLabelsOf } from "@/features/work/copy/partner-labels";
import { reads } from "@/modules/data-service";
import { REPORT_DEFAULT_TIME_ZONE } from "@/modules/support/report";
import { PageColumn, PageHeading, ReadNotices, type ReadNoticeCopy } from "../../page-frame";
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Agenda";
export const metadata: Metadata = { title: PAGE_TITLE };
const DISPLAY_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;
const AGENDA_PAGE_SIZE = 200;
const PARTNER_LABEL_PAGE_SIZE = 200;
const FIRST_PAGE = 0;
const PAGE_COPY = {
  lede: "The open dated work of this context, grouped by the day each task is due, with the plan a meeting states and the records a task is linked to. Undated work is read on the lists, never here, and a task is completed, reopened, edited or cancelled there.",
  zone: `Every day on this page is judged in ${DISPLAY_TIME_ZONE}, because a server render cannot know the display time zone this browser chose in Settings, and a day is never stated in a zone nobody chose.`,
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "The dated agenda is not available in this context", body: "This session may not read the tasks of the context it is working in, so no day, row or count is stated here — a refusal is not an empty agenda. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The dated agenda could not be read", action: { label: "Try this read again", href: "/work/agenda" } },
  refused: { title: "This view's request was refused", body: "This route states only the display time zone and a page size the read admits, so a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
};
/** The dated agenda: one read, one snapshot, and the family's own agenda rendering it. */
export default async function WorkAgendaPage(): Promise<ReactElement> {
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
      <PageHeading title={PAGE_TITLE} paragraphs={[PAGE_COPY.lede, PAGE_COPY.zone]} />
      {agenda.kind === "envelope" ? <Agenda scope={agenda.envelope.scope} envelope={agenda.envelope} partnerLabels={partnerLabels} /> : <ReadNotices failure={agenda} copy={NOTICE_COPY} />}
    </PageColumn>
  );
}
