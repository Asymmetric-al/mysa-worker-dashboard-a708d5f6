/**
 * `/communication` — the Ministry Updates roster (AAP 0.9.1, "Updates list and drafts"; AAP 0.10.1 unit 9, the
 * worker half; AAP 0.7.1's "Write and release an Update" row, its `findContentDocuments` listing read).
 *
 * **What this file is.** Composition, nothing else: one service read, then the arm that read's own result union
 * names. Every column, every lifecycle word, the paging window and the one reviewed way to add an edition belong
 * to `features/updates`: `rosterOf` makes the read plain on the server, because a release instant is a
 * `Temporal.Instant` and a class instance cannot cross into a client component, and `updates-list` renders it.
 * Nothing here counts, filters, sorts, derives, defaults or authorises, and no scope, principal or permission is
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
// The route
// ---------------------------------------------------------------------------------------------

/** The Ministry Updates roster: one read under the session's own scope, and the arm its result names. */
export default async function CommunicationPage(): Promise<ReactElement> {
  const result = await reads.updates.findContentDocuments({ families: UPDATE_FAMILY });
  if (result.kind !== "envelope") {
    return <RosterNotice result={result} />;
  }
  return <UpdatesList roster={rosterOf(result.envelope)} headingLevel={PAGE_HEADING_LEVEL} />;
}
