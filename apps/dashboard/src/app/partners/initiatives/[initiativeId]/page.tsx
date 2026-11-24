import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { NoticeAction } from "@/components/state-notice";
import InitiativeDetail, { type InitiativeDetailProps } from "@/features/initiatives/components/initiative-detail";
import { INITIATIVE_COPY, STATE_NOTICE_COPY } from "@/features/initiatives/copy";
import { isSharedRecord } from "@/features/partners/record-class";
import { reads } from "@/modules/data-service";
import { ReadNotices, type ReadNoticeCopy } from "../../../page-frame";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Initiative" };
const INITIATIVES_ROUTE = "/partners/initiatives";
const NOTICE_HEADING_LEVEL = 1;
const BACK_TO_LIST: NoticeAction = { label: INITIATIVE_COPY.listHeading, href: INITIATIVES_ROUTE };
type InitiativeEnvelope = Extract<Awaited<ReturnType<typeof reads.outreach.readInitiative>>, { readonly kind: "envelope" }>["envelope"];
type MemberRow = InitiativeEnvelope["data"]["workingList"]["items"][number];
type CandidateRead = NonNullable<InitiativeDetailProps["candidates"]>;
const CANDIDATE_PAGE_INDEX = 0;
const CANDIDATE_PAGE_SIZE = 200;
const CANDIDATES_UNCOMPOSED: CandidateRead = { state: "unavailable", source: { system: "page-composition", reference: "eligible-partner-candidates" } };
const membershipByPartner = (members: readonly MemberRow[]): ReadonlyMap<string, NonNullable<Extract<CandidateRead, { readonly state: "available" }>["partners"][number]["membership"]>> => new Map(members.map((member) => [member.partnerId, { memberId: member.memberId, state: member.state }] as const));
async function eligibleCandidatesOf(initiative: InitiativeEnvelope): Promise<CandidateRead> {
  const roster = await reads.partners.findPartners({ page: { index: CANDIDATE_PAGE_INDEX, size: CANDIDATE_PAGE_SIZE } });
  if (roster.kind === "unavailable") return { state: "unavailable", source: roster.unavailable.source };
  if (roster.kind !== "envelope") return CANDIDATES_UNCOMPOSED;
  const { rows, total } = roster.envelope.data;
  if (rows.length < total) return CANDIDATES_UNCOMPOSED;
  const membership = membershipByPartner(initiative.data.workingList.items);
  return { state: "available", partners: rows.filter((row) => isSharedRecord(row.partner)).map((row) => ({ partnerId: row.partner.partnerId, displayName: row.partner.displayName, membership: membership.get(row.partner.partnerId) ?? null })) };
}
const initiativeHrefOf = (initiativeId: string): string => `${INITIATIVES_ROUTE}/${encodeURIComponent(initiativeId)}`;
const retryOf = (initiativeId: string): NoticeAction => ({ label: "Try again", href: initiativeHrefOf(initiativeId) });
const NOTICE_COPY: ReadNoticeCopy = {
  headingLevel: NOTICE_HEADING_LEVEL,
  denied: { title: STATE_NOTICE_COPY.denied.title, body: STATE_NOTICE_COPY.denied.body, action: BACK_TO_LIST },
  unavailable: { title: STATE_NOTICE_COPY.unavailable.title },
  refused: { title: STATE_NOTICE_COPY.refused.title, body: STATE_NOTICE_COPY.refused.body, action: BACK_TO_LIST },
};
/** One initiative: its overview, its working list, its Requests, the next work it carries and its history. */
export default async function InitiativeDetailPage({ params }: { readonly params: Promise<{ readonly initiativeId: string }> }): Promise<ReactElement> {
  const { initiativeId } = await params;
  const [initiative, results] = await Promise.all([reads.outreach.readInitiative(initiativeId), reads.outreach.readInitiativeResults(initiativeId)]);
  if (initiative.kind !== "envelope") return <ReadNotices failure={initiative} copy={{ ...NOTICE_COPY, unavailable: { ...NOTICE_COPY.unavailable, action: retryOf(initiativeId) } }} />;
  const candidates = await eligibleCandidatesOf(initiative.envelope);
  return <InitiativeDetail envelope={initiative.envelope} candidates={candidates} resultsEnvelope={results.kind === "envelope" ? results.envelope : undefined} />;
}
