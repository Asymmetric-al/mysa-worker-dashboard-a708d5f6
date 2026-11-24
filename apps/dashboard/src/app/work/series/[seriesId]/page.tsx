import type { Metadata } from "next";
import type { ReactElement } from "react";
import { reads } from "@/modules/data-service";
import { PageColumn, ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
import SeriesPlanView from "./series-plan-view";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Repeating plan" };
const WORK_HREF = "/work";
const PAGE_COPY = {
  denied: { title: "This repeating plan is not available", body: "This session may not read that plan, so no rule, date, occurrence or count is stated here — a refusal discloses nothing about whether the plan exists. Another plan, or another context, can be read from the Work lists." },
  unavailable: { title: "This repeating plan could not be read", retry: "Try this read again" },
  refused: { title: "This plan's request was refused", body: "The identifier in this address is not one the series read admits, or the request stated something it does not accept, so the refusal is answered here rather than thrown." },
  backToLists: "Read the Work lists",
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
