/** `/partners/initiatives/[initiativeId]` — one initiative (AAP 0.9.1). **What this file is.** Composition, nothing else: the reads the detail surface states its counts from, the eligible-partner set its working-list picker adds from, the outreach family's own detail body over the initiative envelope, and an honest notice in place of the body when the read is denied, refused or cannot answer. */

import type { ReactElement } from "react";

import StateNotice, { type NoticeAction } from "@/components/state-notice";
import InitiativeDetail, { type InitiativeDetailProps } from "@/features/initiatives/components/initiative-detail";
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
// The eligible-partner set the working list adds from
// ---------------------------------------------------------------------------------------------

/** The detail read's own envelope: the contract every value below is taken from rather than restated. */
type InitiativeEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];

/** One row of the reviewed working list, as that read supplies it: the partner it names and the membership it holds. */
type MemberRow = InitiativeEnvelope["data"]["workingList"]["items"][number];

/** The candidate read the picker accepts: the eligible partners themselves, or the source's refusal to answer for them. */
type CandidateRead = NonNullable<InitiativeDetailProps["candidates"]>;

type AvailableCandidates = Extract<CandidateRead, { readonly state: "available" }>;

type CandidatePartner = AvailableCandidates["partners"][number];

type CandidateMembership = NonNullable<CandidatePartner["membership"]>;

/** The partner roster's first page. This read counts pages from zero, so the first page is page `0`. */
const CANDIDATE_PAGE_INDEX = 0;

/** The roster's documented page ceiling (AAP 0.8.7): the most one read returns, so the most this page can enumerate. */
const CANDIDATE_PAGE_SIZE = 200;

/**
 * The answer this page gives the working list when it cannot hand the picker a whole eligible set.
 *
 * It names the composition itself as the source, exactly as the detail body does when no page supplies a
 * candidate read at all. A partial set is never passed off as the eligible set: the picker's own search
 * answers "no eligible partner matches" for anyone it was not given, which would be a false statement
 * about a partner who is eligible.
 */
const CANDIDATES_UNCOMPOSED: CandidateRead = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };

/** The membership each partner on this initiative's working list already holds, keyed by the partner it names. */
function membershipByPartner(members: readonly MemberRow[]): ReadonlyMap<string, CandidateMembership> {
  return new Map(members.map((member) => [member.partnerId, { memberId: member.memberId, state: member.state }] as const));
}

/**
 * The eligible-partner set this page composes for the working list's picker.
 *
 * Only partners the worker explicitly selects join a working list, so the picker needs the whole eligible
 * set to offer — and the partner roster is the one read whose job is to enumerate readable partners. A
 * partner who already holds a membership is passed with it, so the picker leaves them out of the choices
 * rather than offering a row whose only possible answer is "unchanged" or "not eligible": exclusion is a
 * source fact this surface never re-opens. A worker-private preparation record is a different record
 * class from a shared relationship and is never a candidate for an approach.
 *
 * The set is passed whole or not at all: a roster larger than one page is not enumerable here, so the
 * picker is told it holds no answer instead of being handed the first page as though it were the set.
 */
async function eligibleCandidatesOf(initiative: InitiativeEnvelope): Promise<CandidateRead> {
  const roster = await reads.partners.findPartners({ page: { index: CANDIDATE_PAGE_INDEX, size: CANDIDATE_PAGE_SIZE } });
  if (roster.kind === "unavailable") {
    // The source did not answer, so its own identity and guidance travel to the picker's notice: never an
    // empty set and never a count of zero.
    return { state: "unavailable", source: roster.unavailable.source };
  }
  if (roster.kind !== "envelope") {
    // A denied or refused roster read reveals nothing about any partner, so the picker is told it has no
    // answer rather than being handed an empty set that would read as "nobody is eligible".
    return CANDIDATES_UNCOMPOSED;
  }
  const { rows, total } = roster.envelope.data;
  if (rows.length < total) {
    return CANDIDATES_UNCOMPOSED;
  }
  const membership = membershipByPartner(initiative.data.workingList.items);
  return { state: "available", partners: rows.filter((row) => row.partner.audience === "shared").map((row) => ({ partnerId: row.partner.partnerId, displayName: row.partner.displayName, membership: membership.get(row.partner.partnerId) ?? null })) };
}

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
 * it was answered with. The two initiative reads are issued together, so they answer the same request from the
 * same snapshot, and the eligible-partner read is issued afterwards for the working list's picker alone. The
 * identifier travels unchanged: the organisation, ministry, support subject and principal are derived by the
 * service from this session, never from the address.
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
    case "envelope": {
      // Coordinate outreach — the job this route serves. The working list's picker adds only partners the
      // worker selects, so this page composes the eligible set it offers; the read is made only once the
      // initiative itself was readable, so a refusal costs no further read.
      const candidates = await eligibleCandidatesOf(initiative.envelope);
      // The results envelope travels only when that read answered one: a denied or unavailable results read
      // leaves the section stating an unavailable read rather than zero responses, and never fails this page.
      return <InitiativeDetail envelope={initiative.envelope} candidates={candidates} resultsEnvelope={results.kind === "envelope" ? results.envelope : undefined} />;
    }
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
