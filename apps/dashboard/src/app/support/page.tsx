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
  denied: { title: "Support isn’t available in this ministry context", body: "Your current session doesn’t have permission to view support figures here. Switch ministry context from the sidebar if you have access to another one." },
  unavailable: { title: "Couldn’t load Support", action: { label: "Try again", href: "/support" } },
  refused: { title: "Couldn’t process this request", body: "The support service couldn’t accept this request. Your underlying giving records weren’t affected." },
};
/** The Support overview: one read, one snapshot, and an honest notice in place of the figures when the read does not answer with an envelope. */ export default async function SupportOverviewPage(): Promise<ReactElement> {
  return readPageOf(
    () => reads.support.readSupportOverview(),
    { notice: NOTICE_COPY, heading: { title: PAGE_TITLE } },
    (answered) => <SupportOverview scope={answered.envelope.scope} locale="en-GB" initialEnvelope={wireFormOf(answered.envelope)} />,
  );
}
