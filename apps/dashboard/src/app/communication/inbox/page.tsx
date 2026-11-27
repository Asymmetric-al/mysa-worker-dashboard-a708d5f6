import type { Metadata } from "next";
import type { ReactElement } from "react";
import { InboxList } from "@/features/audience/components/inbox-list";
import { reads } from "@/modules/data-service";
import { PageSurface, ReadNotices, paramOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
export const metadata: Metadata = { title: "Test inbox" };
const NOTICE_HEADING_LEVEL = 2;
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: NOTICE_HEADING_LEVEL, denied: { title: "Test inbox isn’t available in this session" }, unavailable: { title: "Couldn’t load Test inbox" }, refused: { title: "Couldn’t open Test inbox" } };
/** The two parameters this route forwards: the paging window the read declares, and nothing besides them. */ const PARAM = { page: "page", pageSize: "pageSize" } as const;
/** The query that read declares, read from the read itself so this route cannot drift from it. */ type InboxQueryInput = NonNullable<Parameters<typeof reads.audience.readInbox>[0]>;
/** The query the inbox read accepts, stated in the read's own vocabulary: only the paging window is forwarded, as the numbers the read declares, because the surface keeps its window in the address — so the page the address states is the page the surface opens on and the first paint is not replaced in the browser. Nothing is defaulted, clamped, validated or dropped here: the service derives the window and owns the whole-result counts, so a second opinion taken here could only disagree with the figures rendered beside it. */
const inboxQueryOf = (searchParams: SearchParams): InboxQueryInput => {
  const page = paramOf(searchParams, PARAM.page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  return { ...(page === undefined ? {} : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
};
/** The route's props: the address a reader followed, whose window is the one the surface opens on. */ export interface CommunicationInboxPageProps {
  readonly searchParams: Promise<SearchParams>;
}
/** The synthetic inbox of the receiving persona. */ export default async function CommunicationInboxPage({ searchParams }: CommunicationInboxPageProps): Promise<ReactElement> {
  const result = await reads.audience.readInbox(inboxQueryOf(await searchParams));
  return (
    <PageSurface headingId="communication-inbox-heading" title="Test inbox">
      {result.kind === "envelope" ? <InboxList scope={result.envelope.scope} locale={"en-GB"} initialEnvelope={result} /> : <ReadNotices failure={result} copy={NOTICE_COPY} />}
    </PageSurface>
  );
}
