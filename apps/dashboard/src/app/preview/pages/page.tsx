/**
 * `/preview/pages` — the public discovery index of Page editions (AAP 0.8.6, 0.9.1, 0.10.1 unit 11).
 *
 * **What this route is.** One public address that enumerates the released Page editions whose reach is
 * `listed`, and nothing else. It composes two things and decides nothing: the service read
 * `readDiscoveryIndex`, and the audience family's own `DiscoveryIndex` surface, which owns the list, the
 * entry links, the empty state, the three refusal renderings and the simulated-effect label.
 *
 * **Why nothing is filtered, counted or resolved here.** An edition shared only by link, and an edition that
 * has been withdrawn, are absent from the read itself rather than suppressed afterwards. That absence is
 * the evidence that a public listing ended, so a filter in this file would manufacture the same page from an
 * answer that still held the edition: the rule would be asserted here instead of demonstrated by the read,
 * and this index could disagree with the direct-link reading view that answers the same question. The
 * answer is therefore handed over unchanged, and no placeholder, hidden count or disabled row states what
 * the read withheld.
 *
 * **Why the surface is given a scope even when the read refuses.** `DiscoveryIndex` states the authority the
 * read ran under and renders whichever arm it answered with. Only an envelope carries an authority; a
 * denial, an outage and a refused request carry none, and those arms read no record, open no query and
 * reach no context. The empty scope below carries such an answer to the notice that belongs to it without
 * asserting a context this route was never admitted to, which is the idiom the root layout uses when
 * admission itself is refused.
 *
 * **Why this page states no heading of its own.** The surface's single `h1` comes from the receiving copy
 * inside `DiscoveryIndex`, together with the statement of what is listed and why an edition is absent. A
 * heading here would be a second name for one surface and a second description of the same rule.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import { DiscoveryIndex } from "@/features/audience/components/discovery-index";
import { reads, type Scope } from "@/modules/data-service";

/** The selected persona, the release reach and the scenario instant are read per request, so a withdrawal, a restriction or a persona switch reaches the next response rather than hiding behind a cached one. */
export const dynamic = "force-dynamic";

/** The document title: the surface, generic, and carrying no record data. Crawler policy belongs only to the link-only reading view, so this route declares none. */
export const metadata: Metadata = { title: "Published pages" };

/**
 * The authority a refused read states none of. Its arms render a denial, an outage or a refused request,
 * none of which reads a record or names a context, so the empty scope below carries the answer to its own
 * notice and is never presented as an authority the service granted.
 */
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };

/** The public discovery index: one read, and the family's own surface rendering that answer as it stands. */
export default async function PageDiscoveryIndexRoute(): Promise<ReactElement> {
  const result = await reads.audience.readDiscoveryIndex();
  // The authority is the one the envelope states; a refusal states none, and the surface's refusal arms read
  // nothing under it. The answer itself is passed through unchanged in every arm, so this route can neither
  // widen nor narrow the list the service decided and holds no copy of a reach rule.
  const scope = result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
  return <DiscoveryIndex scope={scope} initialEnvelope={result} />;
}
