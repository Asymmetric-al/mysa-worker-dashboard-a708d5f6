/** `/support/commitments` — every commitment the source reports, with the recurring outcome the current occurrence sits in, read-only. **Why this route exists.** AAP 0.9.1 lists … */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { CommitmentList } from "@/features/support/components/commitment-list";
import { assertNever } from "@/lib/result";
import { reads, type ReadAction } from "@/modules/data-service";
// The read's own shapes, taken from the service rather than restated
/** What `readCommitments` answers with: an envelope, a denial, or an unavailable source behind it. */
type CommitmentsResult = Awaited<ReturnType<typeof reads.support.readCommitments>>;
/** The query this route may state, taken from the read's own signature. */
type CommitmentsQuery = NonNullable<Parameters<typeof reads.support.readCommitments>[0]>;
/** The envelope arm, narrowed once so the list's props and the statements above it read from it. */
type CommitmentsEnvelope = Extract<CommitmentsResult, { readonly kind: "envelope" }>["envelope"];
/** The search parameters Next hands a Server Component: one key may arrive with several values. */
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
/** Props of {@link CommitmentsPage}. */
export interface CommitmentsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}
/** One filter the read refused to apply, with the reason the read itself gives for refusing it. */
interface RefusedFilter {
  readonly name: string;
  readonly reason: string;
}
// Fixed values
/** The rows come from this session's stored documents and from a source whose coverage and failure state are read per request, so the route is rendered per request rather than cached. */
export const dynamic = "force-dynamic";
/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Commitments";
/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };
/** The interface locale the composed surface formats amounts in. */
const INTERFACE_LOCALE = "en-GB";
/** The two URL keys the commitments list reads and writes (`features/support/hooks/use-commitments`). */
const PARAM_PAGE_INDEX = "page.index";
const PARAM_PAGE_SIZE = "page.size";
/** A whole number of the kind a page window is stated in: no sign, no fraction, no exponent. */
const WHOLE_NUMBER = /^\d+$/u;
/** The id the narrowing section is labelled by, stated once so the heading and the region agree. */
const NARROWING_HEADING_ID = "commitments-narrowing";
/** This route's own wording. */
const COMMITMENTS_PAGE_COPY = {
  title: PAGE_TITLE,
  lead:
    "Every commitment the source reports, with the recurring outcome the current occurrence sits in. " +
    "A commitment is not received money and a collection in progress is not cash: these rows state " +
    "the source's own kind, cadence, currency and collection evidence, and none of them is counted in " +
    "a received-support figure.",
  narrowing: { heading: "What this list can be narrowed by", body: "This list is read whole from the source, so it carries no period filter and no currency filter. The reasons the read gives for both are stated below." },
  denied: "This session may not read the commitments in this context, so nothing about them is stated here: no count, no amount, no empty list and no hint of whether any commitment exists.",
  unavailableTitle: `${PAGE_TITLE} could not be read`,
  refusedTitle: "This list's request was refused",
} as const;
/** The filter names the support reads can refuse, in the words a reader knows them by. */
const FILTER_ACTION_LABELS: Readonly<Record<string, string>> = { filterByPeriod: "Period", filterByCurrency: "Currency" };
/** The one action the envelope states that this section must not list. */
const ADDITIONAL_TYPES_ACTION = "showAdditionalTypes";
// The window the URL states
/** One value of a repeated query key, since the same key may arrive more than once. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
/** The whole number a query key states, or `undefined` when it states none. */
function wholeNumberFrom(params: SearchParams, name: string): number | undefined {
  const raw = firstValue(params[name]);
  if (raw === undefined || !WHOLE_NUMBER.test(raw)) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
/** The page window this URL states, in the read's own two members. */
function pageQueryOf(params: SearchParams): CommitmentsQuery {
  const index = wholeNumberFrom(params, PARAM_PAGE_INDEX);
  const size = wholeNumberFrom(params, PARAM_PAGE_SIZE);
  if (index === undefined && size === undefined) {
    return {};
  }
  return { page: { ...(index === undefined ? {} : { index }), ...(size === undefined ? {} : { size }) } };
}
/** The filters the envelope states as unavailable, each with the reason it states for that. */
function refusedFiltersOf(actions: readonly ReadAction[]): readonly RefusedFilter[] {
  const refused: RefusedFilter[] = [];
  for (const action of actions) {
    if (action.name === ADDITIONAL_TYPES_ACTION) {
      continue;
    }
    if (action.available || action.reason === undefined) {
      continue;
    }
    refused.push({ name: action.name, reason: action.reason });
  }
  return refused;
}
// The surface above the list
/** The filters this list does not apply, in the read's own reasons. */
function NarrowingStatement({ actions }: { readonly actions: readonly ReadAction[] }): ReactElement | null {
  const refused = refusedFiltersOf(actions);
  if (refused.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={NARROWING_HEADING_ID} className="flex min-w-0 flex-col gap-2">
      <h2 id={NARROWING_HEADING_ID} className="text-base font-semibold text-pretty">
        {COMMITMENTS_PAGE_COPY.narrowing.heading}
      </h2>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">{COMMITMENTS_PAGE_COPY.narrowing.body}</p>
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
/** The surface the envelope arm renders: the page's one `h1`, the sentence that keeps a commitment apart from received money, the filters the read refuses, and the family's own list. */
function CommitmentsSurface({ envelope }: { readonly envelope: CommitmentsEnvelope }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this page: the composed surface and the section above open below it. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{COMMITMENTS_PAGE_COPY.title}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{COMMITMENTS_PAGE_COPY.lead}</p>
      </div>
      <NarrowingStatement actions={envelope.actions} />
      <CommitmentList scope={envelope.scope} locale={INTERFACE_LOCALE} initialEnvelope={envelope} />
    </div>
  );
}
// The route
/** The commitments list. */
export default async function CommitmentsPage({ searchParams }: CommitmentsPageProps): Promise<ReactElement> {
  const params = await searchParams;
  const result = await reads.support.readCommitments(pageQueryOf(params));
  switch (result.kind) {
    case "envelope":
      return <CommitmentsSurface envelope={result.envelope} />;
    case "denied":
      // No count, no title of any commitment and no empty list: the answer is the same whether or not a commitment exists in the scope this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={COMMITMENTS_PAGE_COPY.title} description={COMMITMENTS_PAGE_COPY.denied} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The read's own guidance names the condition and says the work can be tried again; the source identity is stated so an outage is never mistaken for an empty list or a zero.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={COMMITMENTS_PAGE_COPY.unavailableTitle} description={result.unavailable.guidance} source={result.unavailable.source} />
        </div>
      );
    case "refused":
      // The page window this address states is not one the read admits. This route calls the read directly, so the arm is stated here rather than thrown, and the notice says the request was refused rather than the commitments source failing.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="refused" headingLevel={1} title={COMMITMENTS_PAGE_COPY.refusedTitle} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled commitments read result");
  }
}
