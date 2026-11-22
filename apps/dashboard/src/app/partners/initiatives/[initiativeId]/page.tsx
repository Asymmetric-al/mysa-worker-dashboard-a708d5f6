/** `/partners/initiatives/[initiativeId]` — one initiative (AAP 0.9.1). **What this file is.** Composition, nothing else: the two reads the detail surface states its counts from, the outreach family's own detail body over the initiative envelope, and an honest notice in place of the body when the read is denied, refused or cannot answer. */

import type { ReactElement } from "react";

import StateNotice, { type NoticeAction } from "@/components/state-notice";
import InitiativeDetail from "@/features/initiatives/components/initiative-detail";
import { INITIATIVE_COPY, STATE_NOTICE_COPY } from "@/features/initiatives/copy";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The reads resolve the session, the context and the scenario instant per request, so nothing on this address may be cached. */
export const dynamic = "force-dynamic";

/** The initiative list this detail belongs to: the way back from a refusal, and the base of the address a failed read retries. */
const INITIATIVES_ROUTE = "/partners/initiatives";

/** The word a failed read's one recovery carries. A read has no effect to repeat, so recovery is asking this same view again. */
const RETRY_LABEL = "Try again";

/** A notice stands where the whole record would have, so it states the surface's own highest heading. */
const NOTICE_HEADING_LEVEL = 1;

/** The one recovery a refusal admits: the list this detail belongs to, which names no record of its own. */
const BACK_TO_LIST: NoticeAction = { label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE };

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/** One initiative's own address, built from its opaque identifier and encoded, so an identifier is never read as grammar. */
function initiativeHrefOf(initiativeId: string): string {
  return `${INITIATIVES_ROUTE}/${encodeURIComponent(initiativeId)}`;
}

/** The one recovery a failed read admits: asking this same view again, because a read has no effect to repeat. */
function retryOf(initiativeId: string): NoticeAction {
  return { label: RETRY_LABEL, href: initiativeHrefOf(initiativeId) };
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** What this route receives: Next 16 hands a route its segment parameters as a promise, so they are awaited before any read. */
export interface InitiativeDetailPageProps {
  readonly params: Promise<{ readonly initiativeId: string }>;
}

/**
 * One initiative: its identity and state, the reviewed working list, the Requests with the terms version each
 * answers, the counts those Requests are measured against and the dated history the reads answered — rendered
 * by the family's own detail body, which keeps all five sections and re-reads this initiative under the scope
 * it was answered with. The two reads are issued together, so they answer the same request from the same
 * snapshot, and the identifier travels unchanged: the organisation, ministry, support subject and principal
 * are derived by the service from this session, never from the address.
 *
 * A denial, an outage or a refusal replaces the body with its own notice. None of the three is rendered as an
 * empty initiative, a zero or a 404, because a refused record and a missing one must read the same.
 */
export default async function InitiativeDetailPage({ params }: InitiativeDetailPageProps): Promise<ReactElement> {
  const { initiativeId } = await params;
  // Coordinate outreach — the job this route serves, read once rather than twice: the detail the declared
  // scope permits, and the results read whose counts each state the base they are measured against.
  const [initiative, results] = await Promise.all([reads.outreach.readInitiative(initiativeId), reads.outreach.readInitiativeResults(initiativeId)]);
  switch (initiative.kind) {
    case "envelope":
      // The results envelope travels only when that read answered one: a denied or unavailable results read
      // leaves the section stating an unavailable read rather than zero responses, and never fails this page.
      return <InitiativeDetail envelope={initiative.envelope} resultsEnvelope={results.kind === "envelope" ? results.envelope : undefined} />;
    case "denied":
      // A refusal states no name, purpose, count, date or existence flag, so this address answers the same
      // whether or not an initiative holds this identifier, and the shell's own work stays usable.
      return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={STATE_NOTICE_COPY.denied.title} description={STATE_NOTICE_COPY.denied.body} reasonCode={initiative.denied.reasonCode} action={BACK_TO_LIST} />;
    case "unavailable":
      // The source did not answer, so this initiative is reported as unavailable rather than as absent,
      // empty or zero, and the outcome names the source that failed.
      return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={STATE_NOTICE_COPY.unavailable.title} description={initiative.unavailable.guidance} source={initiative.unavailable.source} action={retryOf(initiativeId)} />;
    case "refused":
      // This route sends an identifier and nothing else, so the arm is stated rather than assumed
      // unreachable: a refusal says the request was refused, not that the initiative's source failed.
      return <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={STATE_NOTICE_COPY.refused.title} description={STATE_NOTICE_COPY.refused.body} action={BACK_TO_LIST} />;
    default:
      return assertNever(initiative, "Unhandled initiative detail read result");
  }
}
