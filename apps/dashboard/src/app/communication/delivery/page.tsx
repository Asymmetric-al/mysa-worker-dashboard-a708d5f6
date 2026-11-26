import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import DeliveryResults from "@/features/updates/components/delivery-results";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, paramOf, wholeNumberOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
const PAGE_HEADING_LEVEL = 1;
const SECTION_HEADING_LEVEL = 2;
const PARAM = { intentId: "intentId", page: "page", pageSize: "pageSize" } as const;
const EMPTY_ACTION = { label: "Back to Updates", href: "/communication" } as const;
const PAGE_COPY = {
  title: "Send history",
  lede: "Per-recipient results for a notification send. Accepted means the simulated email was queued (not that it was read). Failed sends can be retried while the send window is open; Unknown results should be refreshed rather than sent twice.",
  unnamed: { title: "No send selected", description: "Open a published update and choose View send history to inspect results for a specific email send." },
  denied: { title: "Send history isn’t available in this session", description: "Your current session doesn’t have permission to view send results for this notification." },
  unavailable: { title: "Couldn’t load send results" },
  refused: { title: "Couldn’t open send results" },
  retry: "Try again",
} as const;
export const metadata: Metadata = { title: PAGE_COPY.title };
function queryOf(intentId: string, searchParams: SearchParams): NonNullable<Parameters<typeof reads.audience.readSendResult>[0]> {
  const page = wholeNumberOf(paramOf(searchParams, PARAM.page));
  const pageSize = wholeNumberOf(paramOf(searchParams, PARAM.pageSize));
  return { intentId, ...(page === undefined ? {} : { page }), ...(pageSize === undefined ? {} : { pageSize }) };
}
function addressOf(intentId: string, searchParams: SearchParams): string {
  const query = new URLSearchParams();
  query.set(PARAM.intentId, intentId);
  const page = paramOf(searchParams, PARAM.page);
  if (page !== undefined) query.set(PARAM.page, page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  if (pageSize !== undefined) query.set(PARAM.pageSize, pageSize);
  return `${"/communication/delivery"}?${query.toString()}`;
}
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: PAGE_HEADING_LEVEL, denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.description }, unavailable: { title: PAGE_COPY.unavailable.title }, refused: { title: PAGE_COPY.refused.title } };
/** The delivery results of one submitted notice: the outcomes the application recorded, per recipient. */ export default async function CommunicationDeliveryPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const stated = await searchParams;
  const intentId = paramOf(stated, PARAM.intentId);
  if (intentId === undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <h1 className="type-page-title text-pretty wrap-anywhere">{PAGE_COPY.title}</h1>
        <StateNotice kind="empty" headingLevel={SECTION_HEADING_LEVEL} title={PAGE_COPY.unnamed.title} description={PAGE_COPY.unnamed.description} action={EMPTY_ACTION} />
      </div>
    );
  }
  const result = await reads.audience.readSendResult(queryOf(intentId, stated));
  if (result.kind !== "envelope") return pageRefusalOf(result, { ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: PAGE_COPY.retry, href: addressOf(intentId, stated) } } }, 4, { title: PAGE_COPY.title });
  return (
    <PageColumn>
      <PageHeading title={PAGE_COPY.title} paragraphs={[PAGE_COPY.lede]} />
      <DeliveryResults scope={result.envelope.scope} locale={"en-GB"} intentId={intentId} initialData={result} headingLevel={SECTION_HEADING_LEVEL} />
    </PageColumn>
  );
}
