import type { Metadata } from "next";
import type { ReactElement } from "react";
import { reads } from "@/modules/data-service";
import { PageColumn, ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
import SeriesPlanView from "./series-plan-view";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Repeating plan" };
const WORK_HREF = "/work";
const PAGE_COPY = {
  denied: { title: "This repeating plan isn’t available", body: "Your current session doesn’t have access to this repeating plan. Return to Tasks to view plans in your current ministry." },
  unavailable: { title: "Couldn’t load this repeating plan", retry: "Try again" },
  refused: { title: "Couldn’t load repeating plan", body: "This address isn’t valid for a repeating plan." },
  backToLists: "Back to Tasks",
} as const;
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: 1,
  denied: { title: PAGE_COPY.denied.title, body: PAGE_COPY.denied.body, action: { label: PAGE_COPY.backToLists, href: WORK_HREF } },
  unavailable: { title: PAGE_COPY.unavailable.title },
  refused: { title: PAGE_COPY.refused.title, body: PAGE_COPY.refused.body, action: { label: PAGE_COPY.backToLists, href: WORK_HREF } },
};
/** One repeating plan: the record body, or the notice its refusal is stated with. */ export default async function WorkSeriesPage({ params }: { readonly params: Promise<{ readonly seriesId: string }> }): Promise<ReactElement> {
  const { seriesId } = await params;
  const result = await reads.series.readSeries({ seriesId });
  if (result.kind !== "envelope")
    return (
      <PageColumn>
        <ReadNotices failure={result} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: { label: PAGE_COPY.unavailable.retry, href: `${"/work/series"}/${encodeURIComponent(seriesId)}` } } }} />
      </PageColumn>
    );
  return <SeriesPlanView envelope={result.envelope} />;
}
