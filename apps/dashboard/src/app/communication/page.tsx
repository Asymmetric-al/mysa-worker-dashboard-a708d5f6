/**
 * `/communication` — the Ministry Updates roster (AAP 0.9.1, "Updates list and drafts"; AAP 0.10.1 unit 9, the
 * worker half; AAP 0.7.1's "Write and release an Update" row, its `findContentDocuments` listing read).
 *
 * **What this file is.** Composition, nothing else: one service read, then the arm that read's own result union
 * names. Every column, every lifecycle word, the paging window and the one reviewed way to add an edition belong
 * to `features/updates`: `rosterOf` makes the read plain on the server, because a release instant is a
 * `Temporal.Instant` and a class instance cannot cross into a client component, and `updates-list` renders it.
 * Nothing here counts, filters, sorts, derives or authorises, it states no value but the address's own page window
 * and the one content family, and no scope, principal or permission is
 * ever taken from the URL.
 *
 * **Why the listing read rather than the variant overview.** This route is a collection of Updates, so its read is
 * the one that enumerates content documents under the session's own scope, narrowed to the `update` family. The
 * variant overview answers for one named document and belongs to an Update's own record, not to this list.
 *
 * **Why this route prints no heading of its own.** `updates-list` renders the section's heading from the level it
 * is given and states its notices one level below it, so the level is handed to that surface instead of the same
 * heading being printed twice: the route ends with exactly one `h1`.
 *
 * **Why this route declares no rendering directive.** The root layout already renders every route per request,
 * and this read resolves the development-session cookie inside the service, so the segment is request-time work
 * without a second declaration.
 */
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import UpdatesList from "@/features/updates/components/updates-list";
import { rosterOf } from "@/features/updates/roster";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** The one read this route holds, named once so its query and its answer are taken from the read itself. */
type RosterRead = typeof reads.updates.findContentDocuments;

/** What that read answers: the roster's envelope, or the denial, outage or refused request it states instead. */
type RosterResult = Awaited<ReturnType<RosterRead>>;

/** The arms of that union that carry no envelope: the denial, the outage and the refused request. */
type RosterWithoutEnvelope = Exclude<RosterResult, { readonly kind: "envelope" }>;

/** The envelope arm itself: the roster the read answered with, in the encoding the surface is seeded from. */
type RosterEnvelope = Extract<RosterResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The one content family this route lists.
 *
 * An Update is one canonical piece of ministry writing; the Worker and Project page families are listed at their
 * own address, and asking this read for them here would put a second family's records in this roster.
 */
const UPDATE_FAMILY = ["update"] as const;

/** This surface's own address, which a retry re-requests. */
const UPDATES_HREF = "/communication";

/** The level of the heading the family surface renders, which is this route's one `h1`. */
const PAGE_HEADING_LEVEL = 1;

/** This route's own wording: the three conditions that are stated instead of a roster. */
const PAGE_COPY = {
  denied: {
    title: "The Updates are not available in the current context",
    description: "This session may not read the content this context's ministry holds, so no Update, edition, count or title is stated here: a refusal is not an empty list. Another context, if this session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "The Updates could not be read", retry: "Read this list again" },
  refused: {
    title: "This page's request was not one the Updates read admits",
    description: "The read that answers this page refused the request this route made, so nothing was read and nothing is shown in its place. The source did not fail and no permission was refused, and a surface that reported either would describe a condition this read never stated.",
  },
} as const;

// ---------------------------------------------------------------------------------------------
// The arms that carry no envelope
// ---------------------------------------------------------------------------------------------

/**
 * The notice a denial, an outage or a refused request is stated with: this route's one heading, and a retry of the
 * same read where retrying is the useful next step.
 *
 * A denial states no count, no title and no existence — `StateNotice` renders the reason code and nothing about
 * what the scope may hold — so the answer is the same whether or not this ministry holds an Update. An outage is
 * never an empty list: the roster would otherwise claim that nothing has been written.
 */
function RosterNotice({ result }: { readonly result: RosterWithoutEnvelope }): ReactElement {
  switch (result.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.description} reasonCode={result.denied.reasonCode} />;
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: UPDATES_HREF }} />;
    case "refused":
      // A refusal is this route's own fixed query being one the read does not admit, so it is stated as a refusal
      // rather than as an outage, and no retry is offered because repeating the same query would repeat the fault.
      return <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.description} />;
  }
}

// ---------------------------------------------------------------------------------------------
// The envelope in the encoding a Client Component may receive
// ---------------------------------------------------------------------------------------------

/**
 * The envelope as the browser handler would have answered with. The read states a release's instants as
 * `Temporal.Instant` values, and a Client Component receives only plain ones, so this route hands over the
 * exact bytes the transport would: the same facts the render already holds, carrying no object the browser
 * could not have received itself. It re-encodes nothing — the page the roster surface is seeded with is the
 * read's own answer, so the surface's first page costs no second request.
 */
function wireFormOf(envelope: RosterEnvelope): RosterEnvelope {
  const wire: unknown = JSON.parse(JSON.stringify(envelope));
  return wire as RosterEnvelope;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/**
 * The first page of the roster, stated rather than left out because the read answers a page only where one is named:
 * without it the answer would be the whole collection, and the surface would be handed every row of it — the
 * client-side window this route exists to remove.
 */
const FIRST_PAGE = 1;

/** The two parameters this route forwards: the paging window the read declares, and nothing besides them. */
const PARAM = { page: "page", pageSize: "pageSize" } as const;

/** The URL's own parameter record, as Next hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// The read's own query, built from the URL and from nothing else
// ---------------------------------------------------------------------------------------------

/** One search parameter's first value: a repeated parameter is read once, and never treated as a decision. */
function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The query the roster read accepts, in the read's own vocabulary.
 *
 * The surface keeps its page window in the address, so the window read here is the one the surface opens on: the page
 * and row size the address states are what the server paints, and no second request replaces them. Nothing is
 * defaulted, clamped, validated or dropped here — the service derives the window (a page below the first is the first
 * page; the size is the documented 50 with its 200 cap) and owns the whole-result counts beside these rows.
 */
function rosterQueryOf(searchParams: SearchParams): NonNullable<Parameters<RosterRead>[0]> {
  const page = paramOf(searchParams, PARAM.page);
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  return { families: UPDATE_FAMILY, ...(page === undefined ? { page: FIRST_PAGE } : { page: Number(page) }), ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }) };
}

/** The route's props: the address a reader followed, whose window is the one the surface opens on. */
interface CommunicationPageProps {
  readonly searchParams: Promise<SearchParams>;
}

/** The Ministry Updates roster: one page under the session's own scope, and the arm its result names. */
export default async function CommunicationPage({ searchParams }: CommunicationPageProps): Promise<ReactElement> {
  const result = await reads.updates.findContentDocuments(rosterQueryOf(await searchParams));
  if (result.kind !== "envelope") {
    return <RosterNotice result={result} />;
  }
  return <UpdatesList roster={rosterOf(result.envelope)} initialResult={{ kind: "envelope", envelope: wireFormOf(result.envelope) }} headingLevel={PAGE_HEADING_LEVEL} />;
}
