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
import { cn } from "@/lib/cn";
import { assertNever } from "@/lib/result";
import { reads, type ReadAction } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** What one roster read answers: the envelope of one page of the whole result, or the read's own refusal. */
type RosterRead = Awaited<ReturnType<typeof reads.partners.findPartners>>;

/** The envelope an admitted roster read answers with: the rows of one page, the whole-result count and the authority they were read under. */
type RosterEnvelope = Extract<RosterRead, { readonly kind: "envelope" }>["envelope"];

/** The three answers that are not that envelope: a denial, an outage behind the records, or a refused request. */
type RosterRefusal = Exclude<RosterRead, { readonly kind: "envelope" }>;

/** The roster read's own query: the search, the applied facet selection, the ordering and the page window. */
type RosterQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;

/** One ordering the roster read executes. */
type RosterSort = NonNullable<RosterQuery["sort"]>;

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

/** The first page as the roster's address counts it, and as the read counts it: the caller counts from one, the read from zero. */
const FIRST_PAGE = 1;

/** The documented page window (AAP 0.8.7): 50 rows unless the address asks for the 200-row ceiling. */
const PAGE_SIZE_DEFAULT = 50;

const PAGE_SIZE_CAP = 200;

/** A page or a page size: a whole number, never a sign, a fraction or an exponent. */
const WHOLE_NUMBER = /^\d{1,9}$/u;

/** The orderings the roster read executes, stated from its own vocabulary: an ordering it does not name is left to the read's own default rather than sent as one it would refuse. */
const ROSTER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const satisfies readonly RosterSort["field"][];

/** The two directions an ordering may take. */
const ROSTER_SORT_DIRECTIONS = ["asc", "desc"] as const satisfies readonly RosterSort["direction"][];

/** The search parameters this route reads, named once. The roster surface parses the same names, so one address describes one view. */
const PARAM = { search: "q", facet: "facet", sort: "sort", page: "page", size: "size" } as const;

/** The separator inside one facet expression (`facetId:value`) and inside one ordering (`field:direction`). */
const EXPRESSION_SEPARATOR = ":";

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
// The address' query state, translated into the read's vocabulary
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and no list is treated as a filter decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Every value a repeated search parameter carries, so a facet selection is read whole rather than one value deep. */
function repeatedParamOf(searchParams: SearchParams, name: string): readonly string[] {
  const value = searchParams[name];
  if (value === undefined) {
    return [];
  }
  return typeof value === "string" ? [value] : value;
}

/** A whole count from a parameter, or `undefined` when the parameter is absent, malformed or beyond exact integers. */
function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * The facet selection the address states: every `facetId:value` expression, with a malformed expression carrying no
 * facet or no value dropped, and a value repeated inside one facet stated once. The read combines the values of one
 * facet with OR and the facets themselves with AND, so this is the selection it applies rather than a second one.
 */
function facetSelectionOf(expressions: readonly string[]): Readonly<Record<string, readonly string[]>> | undefined {
  const selection: Record<string, string[]> = {};
  for (const expression of expressions) {
    const separator = expression.indexOf(EXPRESSION_SEPARATOR);
    if (separator < 1 || separator === expression.length - 1) {
      continue;
    }
    const facetKey = expression.slice(0, separator);
    const value = expression.slice(separator + 1);
    const selected = selection[facetKey];
    if (selected === undefined) {
      selection[facetKey] = [value];
    } else if (!selected.includes(value)) {
      selected.push(value);
    }
  }
  return Object.keys(selection).length === 0 ? undefined : selection;
}

/** The ordering the address states: a field and its direction together, or nothing — the read refuses either one alone. */
function rosterSortOf(value: string | undefined): RosterSort | undefined {
  if (value === undefined) {
    return undefined;
  }
  const separator = value.indexOf(EXPRESSION_SEPARATOR);
  if (separator < 1 || separator === value.length - 1) {
    return undefined;
  }
  const field = ROSTER_SORT_FIELDS.find((admitted) => admitted === value.slice(0, separator));
  const direction = ROSTER_SORT_DIRECTIONS.find((admitted) => admitted === value.slice(separator + 1));
  if (field === undefined || direction === undefined) {
    return undefined;
  }
  return { field, direction };
}

/** The page the address states, as the read counts pages: the caller's first page is the read's page zero. */
function pageIndexOf(searchParams: SearchParams): number {
  const page = wholeNumberOf(paramOf(searchParams, PARAM.page));
  return page === undefined || page < FIRST_PAGE ? FIRST_PAGE - 1 : page - FIRST_PAGE;
}

/**
 * The page size the address states, resolved to the two sizes this surface serves (AAP 0.8.7): the default for a size at
 * or below it, the ceiling for a larger one, and the default for a missing or malformed one. The roster surface resolves
 * a stated size the same way and offers its pager only these two, so the read, the address and the pager state one window
 * rather than three.
 */
function pageSizeOf(searchParams: SearchParams): number {
  const size = wholeNumberOf(paramOf(searchParams, PARAM.size));
  if (size === undefined || size <= PAGE_SIZE_DEFAULT) {
    return PAGE_SIZE_DEFAULT;
  }
  return PAGE_SIZE_CAP;
}

/**
 * The roster read's query, built from the address and from nothing else. The roster surface parses this same grammar
 * for its own browser reads, but its parser lives in a client module whose exports cannot be called during a server
 * render, so the rules are stated here as well — with the same defaults and the same window — instead of being reached
 * for across that boundary. The visible columns are deliberately absent: they decide what the surface shows of the
 * result, never which records the result holds.
 */
function rosterQueryOf(searchParams: SearchParams): RosterQuery {
  const search = paramOf(searchParams, PARAM.search)?.trim();
  const applied = facetSelectionOf(repeatedParamOf(searchParams, PARAM.facet));
  const sort = rosterSortOf(paramOf(searchParams, PARAM.sort));
  return {
    // A blank search asks for nothing, so it travels as no filter at all.
    ...(search === undefined || search === "" ? {} : { search }),
    ...(applied === undefined ? {} : { applied }),
    ...(sort === undefined ? {} : { sort }),
    page: { index: pageIndexOf(searchParams), size: pageSizeOf(searchParams) },
  };
}

/**
 * This same view as an address: a retry re-reads the roster the worker was looking at rather than dropping the view, and
 * a page beyond the last one this result holds is answered by the last page it does hold. The page is replaced rather
 * than appended, so one view is one address.
 */
function viewHrefOf(searchParams: SearchParams, page?: number): string {
  const stated = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (page !== undefined && name === PARAM.page) {
      continue;
    }
    const entries = typeof value === "string" ? [value] : (value ?? []);
    for (const entry of entries) {
      stated.append(name, entry);
    }
  }
  // The first page is the default the address leaves out, so only a later page is stated.
  if (page !== undefined && page > FIRST_PAGE) {
    stated.set(PARAM.page, String(page));
  }
  const query = stated.toString();
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
  const query = rosterQueryOf(stated);
  // The organization, ministry, support subject and principal are derived by the service from this session: the address
  // supplies a view and nothing that could invent authority.
  const result = await reads.partners.findPartners(query);
  if (result.kind === "envelope" && (query.page?.index ?? 0) >= result.envelope.data.page.totalPages) {
    // A page beyond the last one this result holds is answered by the last page it does hold. Left alone, an address
    // like `?page=999` would reach the list as an empty page of a non-empty result, and the list would state that no
    // partner exists while its own pager states how many it holds — so the address is corrected here, before anything
    // is rendered, rather than the reader being told a falsehood about the collection.
    redirect(viewHrefOf(stated, result.envelope.data.page.totalPages));
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one h1 on this route: the roster's own notices open at level two, and the private-contact form states its own heading. */}
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.classes}</p>
      </div>
      {result.kind === "envelope" ? <RosterBody envelope={result.envelope} /> : <RosterNotice result={result} sameView={viewHrefOf(stated)} />}
    </div>
  );
}

/** What the route renders for an admitted read: the family's roster surface, and the private-contact block beside it. */
function RosterBody({ envelope }: { readonly envelope: RosterEnvelope }): ReactElement {
  const mayPrepare = admits(envelope.actions, CREATE_PREPARATION_ACTION);
  return (
    <>
      {/* One composition of the list pattern, and only one: the family's roster surface owns the toolbar, the table preset,
          the pager and the scroll region, and asks the service for the same view this read answered. The surface's own row
          action is the way into each record, so this route adds none and cannot offer a second one. */}
      <PartnerRoster scope={envelope.scope} emptyAction={mayPrepare ? <AddContactLink /> : undefined} />
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
