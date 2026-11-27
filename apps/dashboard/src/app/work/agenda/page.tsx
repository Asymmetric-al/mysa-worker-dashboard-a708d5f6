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
const PAGE_COPY = { lede: "Your open dated tasks grouped by due date, plus any scheduled meeting times. Undated tasks stay on the main Tasks page." } as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 2,
  denied: { title: "Agenda isn’t available in this ministry", body: "Your current session doesn’t have access to tasks here. If you belong to another ministry, switch to it from the header." },
  unavailable: { title: "Couldn’t load your agenda", action: { label: "Try again", href: "/work/agenda" } },
  refused: { title: "Couldn’t load agenda", body: "This view couldn’t run with the requested parameters. Reload to try again." },
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
              {"Tasks"}
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
