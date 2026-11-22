/** `/partners/initiatives` — the initiative list (AAP 0.9.1). **What this file is.** Composition, nothing else: one read of the authorised list, the outreach family's own list surface over it, and an honest notice in place of the list when the read is denied, refused or cannot answer. */

import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import InitiativeList from "@/features/initiatives/components/initiative-list";
import { initiativesReadQuery, parseInitiativesQuery } from "@/features/initiatives/query/initiatives-query";
import { querySearchParamsOf } from "@/lib/query-params";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The address, as Next 16 hands a route its search parameters
// ---------------------------------------------------------------------------------------------

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/** This surface's own address, so a retry re-reads the view the reader was in rather than dropping it. */
const LIST_HREF = "/partners/initiatives";

/** This route's own wording for the three answers that are not the list. Not one of them states a count, a name, a working list or a size. */
const PAGE_COPY = {
  denied: { title: "Initiatives are not available in this context", body: "This session may not read initiatives in the context it is working in, so no initiative, working list or count is stated here — a refusal is not an empty list. Another context, if this session holds one, can be chosen from the shell." },
  unavailable: { title: "The initiative list could not be read", retry: "Try this read again" },
  refused: { title: "The initiative list's request was refused", body: "The address states a view the initiative read does not admit, so nothing was read and the source behind the list did not fail. State a view it admits and ask again." },
} as const;

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
  // The address is parsed by the one grammar the list surface writes its own address with, and the read is asked for
  // exactly the view it describes.
  const query = initiativesReadQuery(parseInitiativesQuery(querySearchParamsOf(stated)));
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
