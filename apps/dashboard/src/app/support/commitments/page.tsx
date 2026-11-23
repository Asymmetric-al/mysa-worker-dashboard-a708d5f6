import type { Metadata } from "next";
import type { ReactElement } from "react";
import { CommitmentList } from "@/features/support/components/commitment-list";
import { reads, type ReadAction } from "@/modules/data-service";
import { paramOf, readPageOf, wholeNumberOf, type ReadNoticeCopy, type SearchParams } from "../../page-frame";
type CommitmentsQuery = NonNullable<Parameters<typeof reads.support.readCommitments>[0]>;
type RefusedFilter = { readonly name: string; readonly reason: string };
export const dynamic = "force-dynamic";
const PAGE_TITLE = "Commitments";
export const metadata: Metadata = { title: PAGE_TITLE };
const PARAM_PAGE_INDEX = "page.index";
const PARAM_PAGE_SIZE = "page.size";
const NARROWING_HEADING_ID = "commitments-narrowing";
const COMMITMENTS_PAGE_COPY = {
  title: PAGE_TITLE,
  lead: "Every commitment the source reports, with the recurring outcome the current occurrence sits in. A commitment is not received money and a collection in progress is not cash: these rows state the source's own kind, cadence, currency and collection evidence, and none of them is counted in a received-support figure.",
  narrowing: { heading: "What this list can be narrowed by", body: "This list is read whole from the source, so it carries no period filter and no currency filter. The reasons the read gives for both are stated below." },
  denied: "This session may not read the commitments in this context, so nothing about them is stated here: no count, no amount, no empty list and no hint of whether any commitment exists.",
  unavailableTitle: `${PAGE_TITLE} could not be read`,
  refusedTitle: "This list's request was refused",
} as const;
const FILTER_ACTION_LABELS: Readonly<Record<string, string>> = { filterByPeriod: "Period", filterByCurrency: "Currency" };
function pageQueryOf(params: SearchParams): CommitmentsQuery {
  const index = wholeNumberOf(paramOf(params, PARAM_PAGE_INDEX));
  const size = wholeNumberOf(paramOf(params, PARAM_PAGE_SIZE));
  if (index === undefined && size === undefined) return {};
  return { page: { ...(index === undefined ? {} : { index }), ...(size === undefined ? {} : { size }) } };
}
function refusedFiltersOf(actions: readonly ReadAction[]): readonly RefusedFilter[] {
  const refused: RefusedFilter[] = [];
  for (const action of actions) {
    if (action.name === "showAdditionalTypes") continue;
    if (action.available || action.reason === undefined) continue;
    refused.push({ name: action.name, reason: action.reason });
  }
  return refused;
}
function NarrowingStatement({ actions }: { readonly actions: readonly ReadAction[] }): ReactElement | null {
  const refused = refusedFiltersOf(actions);
  if (refused.length === 0) return null;
  return (
    <section aria-labelledby={NARROWING_HEADING_ID} className="flex min-w-0 flex-col gap-2">
      <h2 id={NARROWING_HEADING_ID} className="type-section-title text-pretty">
        {COMMITMENTS_PAGE_COPY.narrowing.heading}
      </h2>
      <p className="type-supporting max-w-prose text-pretty">{COMMITMENTS_PAGE_COPY.narrowing.body}</p>
      <dl className="flex min-w-0 flex-col gap-2">
        {refused.map((filter) => (
          <div key={filter.name} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-sm font-medium">{FILTER_ACTION_LABELS[filter.name] ?? <bdi className="mono-identifier break-words">{filter.name}</bdi>}</dt>
            <dd className="max-w-prose text-sm text-pretty text-muted-foreground">{filter.reason}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
const NOTICE_COPY: ReadNoticeCopy = { headingLevel: 1, denied: { title: COMMITMENTS_PAGE_COPY.title, body: COMMITMENTS_PAGE_COPY.denied }, unavailable: { title: COMMITMENTS_PAGE_COPY.unavailableTitle }, refused: { title: COMMITMENTS_PAGE_COPY.refusedTitle } };
/** The commitments list: a refusal replaces the list before anything is composed, so no count, no commitment title and no empty list stands in for a read that never answered. */
export default function CommitmentsPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  return readPageOf(
    async () => reads.support.readCommitments(pageQueryOf(await searchParams)),
    { notice: NOTICE_COPY, heading: { title: COMMITMENTS_PAGE_COPY.title, paragraphs: [COMMITMENTS_PAGE_COPY.lead] } },
    (answered) => (
      <>
        <NarrowingStatement actions={answered.envelope.actions} />
        <CommitmentList scope={answered.envelope.scope} locale="en-GB" initialEnvelope={answered.envelope} />
      </>
    ),
  );
}
