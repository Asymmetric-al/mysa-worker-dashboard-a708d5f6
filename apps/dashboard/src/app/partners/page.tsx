/**
 * `/partners` — the Partners roster route: one roster over people, households, churches, organizations and the worker's
 * own private preparation, with the query toolbar, saved views and configurable columns that read it.
 *
 * Named by AAP 0.9.1's route tree, 0.11.1's `src/app/**` row, 0.10.1 family 2 and 0.6.4's second question ("What do I
 * know about this relationship?"), and serving acceptance criteria 3, 5 and 19. It is composition only: no row, filter,
 * ordering, total, permission or private note is decided here.
 *
 * **Why this route reads at all.** The family's roster surface runs its three reads under the exact authority it is
 * handed, and authority is only ever stated by a service answer. `reads.partners.findPartners` is the one read that
 * states both the scope the surface must act in and whether this session may create a private preparation in it, and
 * the same answer lets a denial, an outage or a refused request replace the surface before anything is composed.
 *
 * **Why the address owns the query.** Search, facets, ordering, page and page size live in the URL under the grammar the
 * roster surface parses, so opening a record and returning re-issues the identical read with the list where the worker
 * left it (AAP 0.1.1 Continuity; criterion 5). This route asks its own read with that same state, so the answer it
 * states and the answer the surface states describe one query rather than two.
 *
 * **What stays the service's.** Nothing here filters, sorts, pages, counts, totals or dedupes: the whole-result count,
 * every value state, the admitted actions and every row are the read's own. Two records that look alike stay two
 * records even when a name, an address or an email is identical; a giving figure is never recomputed on this route; and
 * no private note or preparation text enters the shared projection the roster renders.
 *
 * **Every arm is honest.** A denial states its closed reason and no count, name or size; an outage states the source
 * that could not be read and offers this same view again; a refused request says the request was refused rather than
 * that the roster is empty; and a page beyond the last one the result holds is answered by the last page it does hold,
 * so the list is never asked to state that no partner exists while its own pager states how many it holds. The shell
 * owns the single `main` landmark and the persistent Development data label, so neither is repeated here, and this page
 * states the one `h1` the route has.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PartnerRoster from "@/features/partners/components/partner-roster";
import PrivatePreparationForm from "@/features/partners/components/private-preparation-form";
import { parseRosterQuery, rosterQuerySearch, rosterReadQuery, type RosterQueryState } from "@/features/partners/query/roster-query";
import { cn } from "@/lib/cn";
import { querySearchParamsOf } from "@/lib/query-params";
import { assertNever } from "@/lib/result";
import { reads, type ReadAction } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** What one roster read answers: the envelope of one page of the whole result, or the read's own refusal. */
type RosterRead = Awaited<ReturnType<typeof reads.partners.findPartners>>;

/** The envelope an admitted roster read answers with: the rows of one page, the whole-result count and the authority they were read under. */
type RosterEnvelope = Extract<RosterRead, { readonly kind: "envelope" }>["envelope"];

/** The admitted roster read: the answer this route composes the family's roster surface for, and the one it seeds that surface with. */
type RosterEnvelopeRead = { readonly kind: "envelope"; readonly envelope: RosterEnvelope };

/** The three answers that are not that envelope: a denial, an outage behind the records, or a refused request. */
type RosterRefusal = Exclude<RosterRead, { readonly kind: "envelope" }>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** Admission, the selected context, the scenario instant and the source's coverage are resolved per request, so nothing on this route may be cached across a context switch. */
export const dynamic = "force-dynamic";

/** The document title: the surface, and nothing that would duplicate the root layout's template suffix. */
export const metadata: Metadata = { title: "Partners" };

/** The page's own heading, which is also the name the roster surface and its records are read beside. */
const PAGE_TITLE = "Partners";

/** This surface's own address, which a retry re-requests, and the anchor of the private-contact block it also states. */
const ROSTER_HREF = "/partners";

const ADD_CONTACT_ANCHOR = "add-private-contact";

/** The one advisory action whose presence mounts the private-contact block below the roster. */
const CREATE_PREPARATION_ACTION = "createPrivatePreparation";

/** This route's own wording. Not one word of it is a count, an amount, a record name or a permission. */
const PAGE_COPY = {
  lede: "Everyone this ministry's records hold: people, households, churches, organizations and your own private preparation, searched and filtered over the whole authorised result rather than the page on screen.",
  classes:
    "Two records that look alike stay two records, even where a name, an email address or a postal address is identical, and a tag, a favourite or an open task proves nothing about contact, consent or giving. Private preparation is a record class of its own: it is written and read here, and it is never copied into a shared history or another record's audience.",
  emptyAction: "Add a private contact",
  denied: { title: "The partner roster is not available in this context", body: "This session may not read these records in the context it is working in, so no row, count, name or size is stated here — a refusal is not an empty roster. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The partner roster could not be read", retry: "Try this read again" },
  refused: {
    title: "This roster's request was refused",
    body: "The address states a view the partner read does not admit, so nothing was read and the source behind the roster did not fail. Every filter, ordering, page and page size this route sends is drawn from the read's own vocabulary, so a refusal says the request was refused rather than that the records are empty.",
  },
} as const;

// ---------------------------------------------------------------------------------------------
// This same view as an address
// ---------------------------------------------------------------------------------------------

/**
 * This same view as an address, written by the one grammar the roster surface writes its own address with: a retry
 * re-reads the roster the worker was looking at rather than dropping the view, and a page beyond the last one the
 * result holds is answered by the last page it does hold. The page is replaced rather than appended, so one view is
 * one address.
 */
function rosterHrefOf(view: RosterQueryState): string {
  const query = rosterQuerySearch(view);
  return query === "" ? ROSTER_HREF : `${ROSTER_HREF}?${query}`;
}

/** Whether the read admits one named action. The action is advisory, so the service re-checks it when the form submits. */
function admits(actions: readonly ReadAction[], name: string): boolean {
  return actions.some((action) => action.name === name && action.available);
}

// ---------------------------------------------------------------------------------------------
// The answers that are not the roster
// ---------------------------------------------------------------------------------------------

/** The first action an empty roster offers: the private-contact block this page states below it. */
function AddContactLink(): ReactElement {
  return (
    <Link href={`#${ADD_CONTACT_ANCHOR}`} className={cn(buttonVariants({ variant: "outline" }), "h-auto max-w-full whitespace-normal")}>
      {PAGE_COPY.emptyAction}
    </Link>
  );
}

/**
 * The notice a roster that is not an envelope is stated with: one heading below the page's own, and a re-request of this
 * same view where one is possible. A denial carries its closed reason code and nothing about the records behind it, and
 * an outage carries the source and the read's own guidance — never an empty list, a zero or seeded data.
 */
function RosterNotice({ result, sameView }: { readonly result: RosterRefusal; readonly sameView: string }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={2} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={2} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: sameView }} />;
    case "refused":
      return <StateNotice kind="refused" headingLevel={2} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled partner roster read result");
  }
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** What this route receives: Next 16 hands `searchParams` as a promise, resolved before any read. */
export interface PartnersRosterPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/**
 * The roster over one scope: the read of the view the address describes, the family's own roster surface over it, and
 * the one record class that is composed beside it — the worker's private preparation, which the same read admitted.
 * A denial, an outage or a refused request replaces the surface with its own notice rather than with an empty roster.
 */
export default async function PartnersRosterPage({ searchParams }: PartnersRosterPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const view = parseRosterQuery(querySearchParamsOf(stated));
  const query = rosterReadQuery(view);
  // The organization, ministry, support subject and principal are derived by the service from this session: the address
  // supplies a view and nothing that could invent authority.
  const result = await reads.partners.findPartners(query);
  if (result.kind === "envelope" && (query.page?.index ?? 0) >= result.envelope.data.page.totalPages) {
    // A page beyond the last one this result holds is answered by the last page it does hold. Left alone, an address
    // like `?page=999` would reach the list as an empty page of a non-empty result, and the list would state that no
    // partner exists while its own pager states how many it holds — so the address is corrected here, before anything
    // is rendered, rather than the reader being told a falsehood about the collection.
    redirect(rosterHrefOf({ ...view, page: result.envelope.data.page.totalPages }));
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this route: the roster's own notices open at level two, and the private-contact form states its own heading. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.classes}</p>
      </div>
      {result.kind === "envelope" ? <RosterBody result={result} /> : <RosterNotice result={result} sameView={rosterHrefOf(view)} />}
    </div>
  );
}

/** What the route renders for an admitted read: the family's roster surface, seeded with this read's own answer, and the private-contact block beside it. */
function RosterBody({ result }: { readonly result: RosterEnvelopeRead }): ReactElement {
  const { envelope } = result;
  const mayPrepare = admits(envelope.actions, CREATE_PREPARATION_ACTION);
  return (
    <>
      {/* One composition of the list pattern, and only one: the family's roster surface owns the toolbar, the table preset,
          the pager and the scroll region, and asks the service for the same view this read answered. It is handed this
          read's answer as its seed, so the first paint states these rows and this whole-result count rather than a
          loading notice and the mount issues no second read of the same view. The surface's own row action is the way
          into each record, so this route adds none and cannot offer a second one. */}
      <PartnerRoster scope={envelope.scope} initialResult={result} emptyAction={mayPrepare ? <AddContactLink /> : undefined} />
      {mayPrepare ? (
        // The form is mounted once, and the empty roster's first action points here rather than mounting a second copy: a
        // worker who already holds records must still be able to add a private contact. Its heading is the form's own, so
        // this block adds a focusable anchor target and no second heading.
        <div id={ADD_CONTACT_ANCHOR} tabIndex={-1} className="scroll-mt-6">
          <PrivatePreparationForm scope={envelope.scope} expectedRevision={envelope.revision} />
        </div>
      ) : null}
    </>
  );
}
