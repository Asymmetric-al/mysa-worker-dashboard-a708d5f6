/**
 * `/support/commitments` — every commitment the source reports, with the recurring outcome the
 * current occurrence sits in, read-only.
 *
 * **Why this route exists.** AAP 0.9.1 lists `support/commitments/page.tsx` in the deliverable tree
 * and 0.9.2 makes a route a composition with no business logic; 0.10.1 keeps "commitments with the
 * three kinds and the five outcome buckets" in the Support family, and 0.6.4 answers "How is support
 * going?" here. The one read this route states is `readCommitments` (AAP 0.6.1), over the
 * `Commitment row` shape of 0.6.2, under the money rules of 0.8.1 and the page window of 0.8.7.
 *
 * **One data path.** A Server Component calls the service read directly: this route never fetches
 * `/api/support/commitments` (0.3.2 forbids a server request to the application's own endpoint),
 * never reaches `modules/store`, and never imports a `reads/*` deep path. Scope is derived from the
 * development session inside the service, so the route passes nothing that could invent authority.
 * It forwards only the page window it read out of the URL, because filtering, sorting, paging and the
 * whole-result count belong to the service (0.3.2, 0.8.1): nothing on this surface is computed here,
 * no amount is formatted here, and no figure is derived here.
 *
 * **Read-only, and why the surface says so in words.** A commitment belongs to the finance owner
 * behind the seam (0.3.3), so nothing here posts, retries, pauses, resumes, cancels or corrects it,
 * and no control on this surface creates a gift, a message or a task. The composed family surface
 * states that where the reader meets the list, because the absence of a button is not an explanation:
 * a commitment is not received money, and a collection in progress is not cash (Rule 1 clause 3).
 *
 * **Three arms, and none of them an empty surface.** `readCommitments` answers with the closed
 * `ReadResult` union — an envelope, a denial, or an unavailable source — and this file switches on all
 * three and closes the switch with `assertNever`, so a fourth arm added to the contract fails this
 * file's compilation instead of falling through to a blank screen. A refusal states no count, amount,
 * title or existence hint, because authorisation precedes enumeration (0.3.2). An outage names the
 * source that did not answer and never becomes a zero or an empty list (0.7.1); the seeded
 * "unavailable financial source" scenario of 0.12.5 arrives on that arm. This route never answers
 * with Next's default 404 helper, because that would replace the route with a bare not-found page and
 * drop the shell, including the persistent **Development data** label (0.7.2).
 *
 * **What the route adds, and what it leaves to the family.**
 * `features/support/components/commitment-list` owns the rows, the five-bucket partition with
 * `outside-partition` beside it, the snapshot statement and the one table preset — so no second
 * table, badge, pager, scroll region or state notice is composed here (Rule 1 clause 2). This file
 * contributes the one `h1`, a sentence naming what a commitment is not, and the envelope's own
 * refused filters with their reasons, so a reader is told why this list carries no filter bar instead
 * of having to infer it.
 *
 * **Freshness.** `dynamic = "force-dynamic"` is stated rather than inferred: the read is derived from
 * this session's cookie and its stored documents on every request, so a cached render would answer
 * for a scope, a revision or a source state the store no longer holds.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { CommitmentList } from "@/features/support/components/commitment-list";
import { assertNever } from "@/lib/result";
import { reads, type ReadAction } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The read's own shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What `readCommitments` answers with: an envelope, a denial, or an unavailable source behind it. */
type CommitmentsResult = Awaited<ReturnType<typeof reads.support.readCommitments>>;

/**
 * The query this route may state, taken from the read's own signature. The read accepts a page window
 * and nothing else, so a facet this URL might carry can never reach the service as an untyped field
 * map: the compiler refuses it here instead.
 */
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

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The rows come from this session's stored documents and from a source whose coverage and failure
 * state are read per request, so the route is rendered per request rather than cached.
 */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Commitments";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/**
 * The interface locale the composed surface formats amounts in. A viewer's own locale is a client
 * presentation preference, held by the shell that renders beside this route, which a Server
 * Component cannot read: this route therefore states the application's default rather than inventing
 * a choice it cannot observe.
 */
const INTERFACE_LOCALE = "en-GB";

/**
 * The two URL keys the commitments list reads and writes (`features/support/hooks/use-commitments`).
 * Keeping them identical is what makes a commitment-detail visit return to the same page and size,
 * and what lets this server render and the browser's own read state the same window.
 */
const PARAM_PAGE_INDEX = "page.index";

const PARAM_PAGE_SIZE = "page.size";

/** A whole number of the kind a page window is stated in: no sign, no fraction, no exponent. */
const WHOLE_NUMBER = /^\d+$/u;

/** The id the narrowing section is labelled by, stated once so the heading and the region agree. */
const NARROWING_HEADING_ID = "commitments-narrowing";

/**
 * This route's own wording. Every commitment row, bucket label, amount and state sentence belongs to
 * `features/support` or to `components/state-notice` and is composed rather than copied; the words
 * below are the ones no other module owns.
 */
const COMMITMENTS_PAGE_COPY = {
  title: PAGE_TITLE,
  lead:
    "Every commitment the source reports, with the recurring outcome the current occurrence sits in. " +
    "A commitment is not received money and a collection in progress is not cash: these rows state " +
    "the source's own kind, cadence, currency and collection evidence, and none of them is counted in " +
    "a received-support figure.",
  narrowing: {
    heading: "What this list can be narrowed by",
    body: "This list is read whole from the source, so it carries no period filter and no currency filter. The reasons the read gives for both are stated below.",
  },
  denied: "This session may not read the commitments in this context, so nothing about them is stated here: no count, no amount, no empty list and no hint of whether any commitment exists.",
  unavailableTitle: `${PAGE_TITLE} could not be read`,
} as const;

/**
 * The filter names the support reads can refuse, in the words a reader knows them by. A name outside
 * this short list is shown exactly as the action states it, so nothing here invents a label for a
 * filter the service has not described.
 */
const FILTER_ACTION_LABELS: Readonly<Record<string, string>> = {
  filterByPeriod: "Period",
  filterByCurrency: "Currency",
};

/**
 * The one action the envelope states that this section must not list. The additional-types display
 * choice is not a filter: the composed list renders it as its own control beside the rows, with the
 * read's own reason for it, so it is skipped here rather than described as a filter this list refuses.
 */
const ADDITIONAL_TYPES_ACTION = "showAdditionalTypes";

// ---------------------------------------------------------------------------------------------
// The window the URL states
// ---------------------------------------------------------------------------------------------

/** One value of a repeated query key, since the same key may arrive more than once. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The whole number a query key states, or `undefined` when it states none. A value that is not a
 * whole number is not repaired into one: the read applies its own default, so an unreadable request
 * answers with a page window the service states rather than a window this route invented.
 */
function wholeNumberFrom(params: SearchParams, name: string): number | undefined {
  const raw = firstValue(params[name]);
  if (raw === undefined || !WHOLE_NUMBER.test(raw)) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * The page window this URL states, in the read's own two members.
 *
 * The default size, the 200-row cap and the clamp of an out-of-range index are the service's
 * contract (AAP 0.8.7), so this function passes only what the URL actually states and lets the read
 * answer with the window it applied — which the envelope then reports back as `data.page`.
 */
function pageQueryOf(params: SearchParams): CommitmentsQuery {
  const index = wholeNumberFrom(params, PARAM_PAGE_INDEX);
  const size = wholeNumberFrom(params, PARAM_PAGE_SIZE);
  if (index === undefined && size === undefined) {
    return {};
  }
  return {
    page: {
      ...(index === undefined ? {} : { index }),
      ...(size === undefined ? {} : { size }),
    },
  };
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

// ---------------------------------------------------------------------------------------------
// The surface above the list
// ---------------------------------------------------------------------------------------------

/**
 * The filters this list does not apply, in the read's own reasons.
 *
 * A facet bar that offered them would be a control whose only possible answer is a refusal, so the
 * surface states the refusal instead of presenting the control (Rule 1 clause 3). The list's state
 * lives in the URL and the family's commitments view owns its own controls, so this route composes no
 * filter surface of its own rather than wrapping one that could not narrow anything. When the read
 * refuses nothing, this section renders nothing rather than an empty frame.
 */
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

/**
 * The surface the envelope arm renders: the page's one `h1`, the sentence that keeps a commitment
 * apart from received money, the filters the read refuses, and the family's own list.
 *
 * The envelope is handed to the list as its seed, so the first paint states the result rather than a
 * loading skeleton, and the scope it was read under is the scope the browser's later reads state.
 */
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

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/**
 * The commitments list. One read, one page window, then one of the read's three answers rendered in
 * full: the list, a refusal that reveals nothing, or the outage that names the source which did not
 * answer.
 */
export default async function CommitmentsPage({ searchParams }: CommitmentsPageProps): Promise<ReactElement> {
  const params = await searchParams;
  const result = await reads.support.readCommitments(pageQueryOf(params));
  switch (result.kind) {
    case "envelope":
      return <CommitmentsSurface envelope={result.envelope} />;
    case "denied":
      // No count, no title of any commitment and no empty list: the answer is the same whether or not
      // a commitment exists in the scope this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={COMMITMENTS_PAGE_COPY.title} description={COMMITMENTS_PAGE_COPY.denied} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The read's own guidance names the condition and says the work can be tried again; the source
      // identity is stated so an outage is never mistaken for an empty list or a zero.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={COMMITMENTS_PAGE_COPY.unavailableTitle} description={result.unavailable.guidance} source={result.unavailable.source} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled commitments read result");
  }
}
