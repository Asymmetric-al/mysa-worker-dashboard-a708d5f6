import type { Metadata } from "next";
import type { ReactElement } from "react";
import { SupportOverview } from "@/features/support/components/support-overview";
import { reads } from "@/modules/data-service";
import { readPageOf, wireFormOf, type ReadNoticeCopy } from "../page-frame";
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Support";
export const metadata: Metadata = { title: PAGE_TITLE };
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: "Support is not available in this context", body: "This session may not read received support in the context it is working in, so no amount, count, period or coverage is stated here — a refusal is not an empty overview. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The support overview could not be read", action: { label: "Try this read again", href: "/support" } },
  refused: { title: "This overview's request was refused", body: "The overview states no filter of its own, so the request this page makes is the read's own default one; a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
};
/** The Support overview: one read, one snapshot, and an honest notice in place of the figures when the read does not answer with an envelope. */
export default async function SupportOverviewPage(): Promise<ReactElement> {
  return readPageOf(
    () => reads.support.readSupportOverview(),
    { notice: NOTICE_COPY, heading: { title: PAGE_TITLE } },
    (answered) => <SupportOverview scope={answered.envelope.scope} locale="en-GB" initialEnvelope={wireFormOf(answered.envelope)} />,
  );
}
