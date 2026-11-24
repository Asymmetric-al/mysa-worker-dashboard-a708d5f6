import type { Metadata } from "next";
import type { ReactElement } from "react";
import TargetsSurface from "@/features/coaching/components/targets-surface";
import { COACHING_COPY } from "@/features/coaching/copy";
import { reads } from "@/modules/data-service";
import { firstValueOf, readPageOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
const PAGE_TITLE = COACHING_COPY.targets.heading;
export const metadata: Metadata = { title: PAGE_TITLE };
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: PAGE_TITLE }, unavailable: { title: PAGE_TITLE, body: COACHING_COPY.targets.unavailable }, refused: { title: PAGE_TITLE } };
/** The worker's targets: the plan in force, the history it is read against and the counts its periods recorded. */
export default async function CoachingTargetsPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const params = await searchParams;
  return readPageOf(
    () => reads.coaching.readTargets(),
    { notice: NOTICE_COPY, heading: { title: PAGE_TITLE, paragraphs: [COACHING_COPY.targets.purpose] } },
    (answered) => <TargetsSurface envelope={answered.envelope} locale="en-GB" selectedTargetId={firstValueOf(params["target"])} />,
  );
}
