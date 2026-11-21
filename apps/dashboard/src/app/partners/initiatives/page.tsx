/** `/partners/initiatives` — the initiative list (AAP 0.9.1). **What this file is.** Composition, nothing else: one read of the authorised list, the outreach family's own list surface over it, and an honest notice in place of the list when the read is denied, refused or cannot answer. */

import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import InitiativeList from "@/features/initiatives/components/initiative-list";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the read rather than restated
// ---------------------------------------------------------------------------------------------

/** The list read's own query: the search, the state filter, the order and the page window. */
type InitiativeListQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;

/** One state the list read admits. */
type InitiativeStateName = NonNullable<InitiativeListQuery["state"]>;

/** One order the list read admits. */
type InitiativeSortName = NonNullable<InitiativeListQuery["sort"]>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/** The two states an initiative stands in, stated from the read's own vocabulary: any other value narrows nothing. */
const INITIATIVE_STATES = ["open", "closed"] as const satisfies readonly InitiativeStateName[];

/** The orders the read admits, stated from its own vocabulary: an order it does not name is left to the read's own default. */
const INITIATIVE_SORTS = ["name", "period-start", "state"] as const satisfies readonly InitiativeSortName[];

/** The read's documented page window (AAP 0.8.7): 50 rows, or the 200-row ceiling. */
const PAGE_SIZE_DEFAULT = 50;

const PAGE_SIZE_CAP = 200;

/** The first page, counted from one as the list read counts pages. */
const FIRST_PAGE = 1;

/** This surface's own address, so a retry re-reads the view the reader was in rather than dropping it. */
const LIST_HREF = "/partners/initiatives";

/** The search parameters this route reads, named once. Anything else in the address is an unrelated key. */
const PARAM = { search: "search", state: "state", sort: "sort", page: "page", pageSize: "pageSize" } as const;

/** A page or a page size: a whole number, never a sign, a fraction or an exponent. */
const WHOLE_NUMBER = /^\d{1,9}$/u;

/** This route's own wording for the three answers that are not the list. Not one of them states a count, a name, a working list or a size. */
const PAGE_COPY = {
  denied: {
    title: "Initiatives are not available in this context",
    body: "This session may not read initiatives in the context it is working in, so no initiative, working list or count is stated here — a refusal is not an empty list. Another context, if this session holds one, can be chosen from the shell.",
  },
  unavailable: {
    title: "The initiative list could not be read",
    retry: "Try this read again",
  },
  refused: {
    title: "The initiative list's request was refused",
    body: "The address states a view the initiative read does not admit, so nothing was read and the source behind the list did not fail. State a view it admits and ask again.",
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

/** A whole count from a parameter, or `undefined` when the parameter is absent, malformed or beyond exact integers. */
function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The state filter the address states, or nothing at all: an unadmitted value asks to read both states rather than nothing. */
function stateOf(searchParams: SearchParams): InitiativeStateName | undefined {
  return INITIATIVE_STATES.find((admitted) => admitted === paramOf(searchParams, PARAM.state));
}

/** The order the address states, or nothing at all: an unadmitted value leaves the read's own default order in force. */
function sortOf(searchParams: SearchParams): InitiativeSortName | undefined {
  return INITIATIVE_SORTS.find((admitted) => admitted === paramOf(searchParams, PARAM.sort));
}

/** The page the address states: a page counted from one, and the first page when it states none the read admits. */
function pageOf(searchParams: SearchParams): number {
  const page = wholeNumberOf(paramOf(searchParams, PARAM.page));
  return page === undefined || page < FIRST_PAGE ? FIRST_PAGE : page;
}

/**
 * The page size the address states. The list's own address grammar admits exactly two sizes — the 50-row
 * default and the 200-row ceiling — so any other stated size reads at the default. This route must state the
 * same window the list surface asks its own browser read for, or the first render would answer a view the
 * address does not describe.
 */
function pageSizeOf(searchParams: SearchParams): number {
  const size = wholeNumberOf(paramOf(searchParams, PARAM.pageSize));
  return size !== undefined && size >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT;
}

/**
 * The read's query, built from the address and from nothing else. The list surface parses this same grammar,
 * but its parser lives in a client module and an export of a client module cannot be called during a server
 * render, so the rules are stated here as well — with the same defaults and the same window — instead of being
 * reached for across that boundary.
 */
function initiativeListQueryOf(searchParams: SearchParams): InitiativeListQuery {
  const search = paramOf(searchParams, PARAM.search);
  const state = stateOf(searchParams);
  const sort = sortOf(searchParams);
  return {
    // A blank search asks for nothing, so it travels as no filter at all.
    ...(search === undefined || search === "" ? {} : { search }),
    ...(state === undefined ? {} : { state }),
    ...(sort === undefined ? {} : { sort }),
    page: pageOf(searchParams),
    pageSize: pageSizeOf(searchParams),
  };
}

/** This same view as an address, so a retry re-reads the list the reader was looking at. */
function sameViewHrefOf(searchParams: SearchParams): string {
  const stated = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) {
      stated.append(name, first);
    }
  }
  const query = stated.toString();
  return query === "" ? LIST_HREF : `${LIST_HREF}?${query}`;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** What this route receives: Next 16 hands `searchParams` as a promise, resolved before any read. */
export interface InitiativesPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/**
 * The initiative list: one whole-query read of the initiatives the admitted ministry permits, filtered,
 * ordered and paged by the read itself, rendered by the family's own list body. A denial, a refusal or an
 * outage replaces the list with its own notice — never with an empty list, a zero or seeded data.
 */
export default async function InitiativesPage({ searchParams }: InitiativesPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const query = initiativeListQueryOf(stated);
  // Coordinate outreach — the job this route serves: the whole authorised result, narrowed and paged by the read.
  const result = await reads.outreach.readInitiatives(query);
  switch (result.kind) {
    case "envelope":
      // The read already happened here, so the family's list starts from this answer and asks the browser for
      // nothing on its first paint; the surface's own heading is the one h1 this page states.
      return <InitiativeList initialEnvelope={result} headingLevel={1} />;
    case "denied":
      // A refusal states no count, name, existence flag or size: the closed reason code is the whole answer,
      // and the only recovery this route can offer is the context the shell lets the session choose.
      return <StateNotice kind="denied" headingLevel={1} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      // The source did not answer, so the list is reported as unavailable and never as an empty or a zero one:
      // the notice states the source, the read's own guidance, and a retry of this same view.
      return <StateNotice kind="unavailable" headingLevel={1} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: sameViewHrefOf(stated) }} />;
    case "refused":
      // This route builds the query from the read's own vocabularies, so the arm is stated here rather than
      // assumed unreachable: a refusal says the request was refused, not that the list's source failed.
      return <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} />;
    default:
      return assertNever(result, "Unhandled initiative list read result");
  }
}
