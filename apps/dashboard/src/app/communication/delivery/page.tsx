import type { Metadata } from "next";
import type { ReactElement } from "react";
import { StateNotice } from "@/components/state-notice";
import DeliveryResults from "@/features/updates/components/delivery-results";
import { reads } from "@/modules/data-service";
import { PageColumn, PageHeading, pageRefusalOf, paramOf, wholeNumberOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
const PAGE_HEADING_LEVEL = 1;
const SECTION_HEADING_LEVEL = 2;
const PARAM = { intentId: "intentId", page: "page", pageSize: "pageSize" } as const;
const EMPTY_ACTION = { label: "Open the Updates list", href: "/communication" } as const;
const PAGE_COPY = {
  title: "Delivery",
  lede: "This screen reports the outcomes the application recorded for one submitted notice. Accepted means the simulated submission step took that copy for that recipient, which is neither an arrival nor a reading. Failed is definite and repeatable only inside the notice's usefulness window, and unknown means the effect may have happened while its acknowledgement was lost, so that row is recovered by reading this notice again rather than by submitting anything twice.",
  unnamed: { title: "No submitted notice is named", description: "This screen reports the recorded outcomes of one submitted notice, under that notice's own identity. " + "Nothing is counted and no notice is guessed until one is named, because a guess would report " + "whichever notice was submitted last." },
  denied: { title: "These results are not available in this session", description: "This session may not read the recorded outcomes for this notice, so no recipient, count, copy or " + "window is stated here: a refusal is not an empty result." },
  unavailable: { title: "The recorded outcomes could not be read" },
  refused: { title: "This screen's request was refused" },
  retry: "Try this read again",
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
