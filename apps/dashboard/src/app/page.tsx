import type { Metadata } from "next";
import type { ReactElement } from "react";
import HomeSections from "@/features/home/components/home-sections";
import { HOME_COPY } from "@/features/home/copy";
import { reads } from "@/modules/data-service";
import { readPageOf, type ReadNoticeCopy } from "./page-frame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: HOME_COPY.title };
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: HOME_COPY.title, body: "Home could not be read for this session, so no item, count or reason is stated here — a refusal is not a quiet day. " + "If this session admits another context, the shell is where that context is chosen." },
  unavailable: { title: HOME_COPY.title },
  refused: { title: HOME_COPY.title },
};
/** The Home screen: the worker's day in three sections, or the reason it could not be read. */
export default async function HomePage(): Promise<ReactElement> {
  return readPageOf(
    () => reads.context.readHome(),
    { notice: NOTICE_COPY, heading: { title: HOME_COPY.title, paragraphs: [HOME_COPY.lead] } },
    (answered) => <HomeSections initial={answered} scope={answered.envelope.scope} />,
  );
}
