import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { exponentOf } from "@/modules/money/currency";
import { clampPageSize } from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import { civilDateAt, parseCivilDate, serialiseCivilDate, type CivilDate, type DatePrecision } from "@/modules/time/civil";
import { newWindowEnd, referralWindowState, type MidnightResolution, type NewWindowEnd, type ReferralWindowStatus, type WindowRefusalReason } from "@/modules/time/window";
import { assertScope, canEdit, canView, readResultOfRefusal, recordRefusalOutage, resolveSession, type ResolvedSession, type SessionSource } from "../authorize";
import { INITIATIVE_STAGES, buildEnvelope, initiativeMemberRecordSchema, initiativeRecordSchema, partnerRecordSchema, project, recordRevisionSchema, referralCycleRecordSchema, REQUEST_RESPONSE_KINDS, requestRecordSchema, taskRecordSchema } from "../envelope";
import type { Coverage, InitiativeMemberRecord, InitiativeMemberState, InitiativeRecord, InitiativeState, PartnerKind, PartnerRecord, PrincipalId, ReadAction, ReadEnvelope, RecordedValueState, ReferralCycleRecord, ReferralWindowKind, RequestRecord, RequestResponseKind, Scope, TaskKind } from "../envelope";
import type { TaskRecord, TaskRecordStatus } from "../envelope";
import { LOCAL_STORE_SYSTEM, type ReadResult } from "../outcome";
import { answerOf, deniedRead, instantOf, readStoreDocument, storeUnavailableRead } from "./frame";
const OUTREACH_SOURCE_REFERENCE = "outreach";
const NEW_WINDOW_PERIOD_SEARCH_LIMIT = 400;
const outreachDocumentsSchema = z.object({
  context: z.object({ revision: recordRevisionSchema }),
  partners: z.array(partnerRecordSchema),
  initiatives: z.array(initiativeRecordSchema),
  initiativeMembers: z.array(initiativeMemberRecordSchema),
  requests: z.array(requestRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  tasks: z.array(taskRecordSchema),
});
type OutreachDocuments = z.infer<typeof outreachDocumentsSchema>;
type OutreachRefusal = { readonly ok: false; readonly result: ReadResult<never> };
type OutreachAccess = { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope; readonly now: Temporal.Instant; readonly documents: OutreachDocuments };
type OutreachOpening = OutreachAccess | OutreachRefusal;
const STORE_UNREADABLE_GUIDANCE = "The session's records could not be read. Reload the workspace, or reset the seed from Settings.";
const DOCUMENT_UNREADABLE_GUIDANCE = "The stored outreach records are not in a shape this build can read. Reset the seed from Settings to restore the known dataset.";
async function openOutreach(job: string, source?: SessionSource): Promise<OutreachOpening> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    recordRefusalOutage(job, resolved.refusal);
    return { ok: false, result: readResultOfRefusal(resolved.refusal) };
  }
  const { session } = resolved;
  const scope = session.selected;
  if (scope === null) {
    const admitted = session.admittedMemberships[0];
    if (admitted !== undefined) {
      const gate = assertScope(session, { organizationId: admitted.organizationId, ministryId: admitted.ministryId, supportSubjectId: admitted.supportSubjectId, principalId: session.principalId });
      if (!gate.ok) return { ok: false, result: { kind: "denied", denied: gate.denial } };
    }
    return { ok: false, result: deniedRead("no-membership") };
  }
  const scoped = assertScope(session, scope);
  if (!scoped.ok) return { ok: false, result: { kind: "denied", denied: scoped.denial } };
  const stored = await readStoreDocument({ session, job, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, guidance: STORE_UNREADABLE_GUIDANCE });
  if (!stored.ok) return { ok: false, result: stored.result };
  const parsed = outreachDocumentsSchema.safeParse(stored.documents.state);
  return parsed.success ? { ok: true, session, scope, now: instantAt(session.clockOffsetMs), documents: parsed.data } : { ok: false, result: storeUnavailableRead(job, OUTREACH_SOURCE_REFERENCE, DOCUMENT_UNREADABLE_GUIDANCE) };
}
/** One initiative as its two detail reads open it: the initiative itself, the partners this session may read and the documents it is stated from. */ type InitiativeSubject =
  | { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope; readonly now: Temporal.Instant; readonly documents: OutreachDocuments; readonly initiative: InitiativeRecord; readonly partners: ReadonlyMap<string, PartnerRecord> }
  | { readonly ok: false; readonly result: ReadResult<never> };
async function initiativeSubjectOf(job: string, initiativeId: string, source?: SessionSource): Promise<InitiativeSubject> {
  const opening = await openOutreach(job, source);
  if (!opening.ok) return opening;
  const { session, scope, now, documents } = opening;
  const initiative = documents.initiatives.find((record) => record.initiativeId === initiativeId);
  if (initiative === undefined) return { ok: false, result: deniedRead("no-permission") };
  const decision = canView(session, { kind: "initiative", scope, ministryId: initiative.ministryContextId, responsiblePrincipalId: initiative.responsiblePrincipalId });
  return !decision.allowed ? { ok: false, result: { kind: "denied", denied: decision.denial } } : { ok: true, session, scope, now, documents, initiative, partners: readablePartners(session, scope, documents) };
}
const pageOf = (requested: number | undefined): number => (requested !== undefined && Number.isSafeInteger(requested) && requested >= 1 ? requested : 1);
function slicePage<T>(rows: readonly T[], page: number, pageSize: number): readonly T[] {
  const offset = (page - 1) * pageSize;
  return rows.slice(offset, offset + pageSize);
}
function markCount(states: Record<string, RecordedValueState>, path: string, count: number): void {
  states[path] = count === 0 ? "zero" : "value";
}
function markOptional(states: Record<string, RecordedValueState>, path: string, present: boolean): void {
  states[path] = present ? "value" : "unknown";
}
const earliestCivil = (dates: readonly (string | null)[]): string | null => dates.filter((value): value is string => value !== null).sort()[0] ?? null;
function latestCivil(dates: readonly (string | null)[]): string | null {
  const stated = dates.filter((value): value is string => value !== null).sort();
  return stated[stated.length - 1] ?? null;
}
const completeCoverage = (from: string | null, to: string | null): Coverage => ({ from, to, state: "complete" });
function instantOrder(value: string): number {
  const instant = instantOf(value);
  return instant === undefined ? Number.NEGATIVE_INFINITY : instant.epochMilliseconds;
}
const canReadPartner = (session: ResolvedSession, scope: Scope, partner: PartnerRecord): boolean => canView(session, { kind: "partner", scope, audience: partner.audience, authorPrincipalId: partner.audience === "private" ? session.principalId : null }).allowed;
function readablePartners(session: ResolvedSession, scope: Scope, documents: OutreachDocuments): ReadonlyMap<string, PartnerRecord> {
  const readable = new Map<string, PartnerRecord>();
  for (const partner of documents.partners) if (canReadPartner(session, scope, partner)) readable.set(partner.partnerId, partner);
  return readable;
}
export type InitiativeLifecycle = "open" | "reopened" | "closed";
export type InitiativeSort = "name" | "period-start" | "state";
export type InitiativesQuery = { readonly state?: InitiativeState; readonly search?: string; readonly sort?: InitiativeSort; readonly page?: number; readonly pageSize?: number };
export type InitiativeMembershipCounts = { readonly included: number; readonly removed: number; readonly excluded: number };
export type InitiativeRow = { readonly initiativeId: string; readonly name: string; readonly purpose: string; readonly responsiblePrincipalId: PrincipalId } & { readonly period: { readonly from: string | null; readonly to: string | null } | null; readonly state: InitiativeState } & {
  readonly lifecycle: InitiativeLifecycle;
  readonly closureDisposition: string | null;
  readonly memberStates: InitiativeMembershipCounts;
} & { readonly revision: string };
export type InitiativeListPage = { readonly items: readonly InitiativeRow[]; readonly total: number; readonly page: number; readonly pageSize: number };
const lifecycleOf = (initiative: InitiativeRecord): InitiativeLifecycle => (initiative.state === "closed" ? "closed" : initiative.closureDisposition === null ? "open" : "reopened");
/** The counts a row states when none of its working list survives the readable-partner filter. */ const NO_MEMBER_STATES: InitiativeMembershipCounts = { included: 0, removed: 0, excluded: 0 };
/** The working-list counts of one initiative's members, over the members whose partner this session may read. */
function memberStatesOf(members: readonly InitiativeMemberRecord[], partners: ReadonlyMap<string, PartnerRecord>): InitiativeMembershipCounts {
  const counts = { included: 0, removed: 0, excluded: 0 };
  for (const member of members) {
    if (partners.get(member.partnerId) === undefined) continue;
    counts[member.state] += 1;
  }
  return counts;
}
/** Every initiative's working-list counts, grouped in one pass, so a list read counts each membership once rather than rescanning the collection for every row it presents. */
function memberStatesByInitiative(members: readonly InitiativeMemberRecord[], partners: ReadonlyMap<string, PartnerRecord>): ReadonlyMap<string, InitiativeMembershipCounts> {
  const grouped = new Map<string, { included: number; removed: number; excluded: number }>();
  for (const member of members) {
    if (partners.get(member.partnerId) === undefined) continue;
    const counts = grouped.get(member.initiativeId) ?? { included: 0, removed: 0, excluded: 0 };
    counts[member.state] += 1;
    grouped.set(member.initiativeId, counts);
  }
  return grouped;
}
const initiativeRowOf = (initiative: InitiativeRecord, memberStates: InitiativeMembershipCounts): InitiativeRow => ({
  initiativeId: initiative.initiativeId,
  name: initiative.name,
  purpose: initiative.purpose,
  responsiblePrincipalId: initiative.responsiblePrincipalId,
  period: initiative.period === null ? null : { from: initiative.period.from, to: initiative.period.to },
  state: initiative.state,
  lifecycle: lifecycleOf(initiative),
  closureDisposition: initiative.closureDisposition,
  memberStates,
  revision: initiative.revision,
});
function sortOfInitiative(requested: InitiativeSort | undefined): InitiativeSort {
  switch (requested) {
    case "period-start":
    case "state":
    case "name":
      return requested;
    default:
      return "name";
  }
}
const civilOrderKey = (date: string | null): readonly [number, string] => (date === null ? [1, ""] : [0, date]);
function compareTasksByDue(left: TaskRecord, right: TaskRecord): number {
  const leftKey = civilOrderKey(left.dueOn);
  const rightKey = civilOrderKey(right.dueOn);
  return leftKey[0] !== rightKey[0] ? leftKey[0] - rightKey[0] : leftKey[1] !== rightKey[1] ? (leftKey[1] < rightKey[1] ? -1 : 1) : left.taskId < right.taskId ? -1 : 1;
}
const LIFECYCLE_ORDER: Readonly<Record<InitiativeLifecycle, number>> = { open: 0, reopened: 1, closed: 2 };
const lifecycleOrder = (lifecycle: InitiativeLifecycle): number => LIFECYCLE_ORDER[lifecycle];
function compareInitiatives(sort: InitiativeSort, left: InitiativeRow, right: InitiativeRow): number {
  if (sort === "period-start") {
    const a = civilOrderKey(left.period === null ? null : left.period.from);
    const b = civilOrderKey(right.period === null ? null : right.period.from);
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  }
  if (sort === "state") {
    const difference = lifecycleOrder(left.lifecycle) - lifecycleOrder(right.lifecycle);
    if (difference !== 0) return difference;
  }
  return compareCodeUnits(left.name, right.name);
}
type EnvelopeFields<T> = { readonly source: Parameters<typeof buildEnvelope>[0]["source"]; readonly revision: string; readonly data: T; readonly valueStates: Parameters<typeof buildEnvelope>[0]["valueStates"]; readonly actions: Parameters<typeof buildEnvelope>[0]["actions"] };
type OutreachEnvelope = { readonly scope: Parameters<typeof buildEnvelope>[0]["scope"]; readonly now: Temporal.Instant };
/** The result a read answers with, assembled through this file's own envelope builder. */
function respond<T>(state: OutreachEnvelope, coverage: Parameters<typeof buildEnvelope>[0]["coverage"], fields: EnvelopeFields<T>): ReadResult<ReadEnvelope<T>> {
  return answerOf(state.scope, state.now.toString(), { data: fields.data, source: fields.source, revision: fields.revision, coverage, valueStates: fields.valueStates, actions: fields.actions });
}
/** Lists the initiatives of the admitted ministry with their purpose, accountable person, optional period and state, paged over the whole authorised result. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInitiatives(query: InitiativesQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<InitiativeListPage>>> {
  const opening = await openOutreach("readInitiatives", source);
  if (!opening.ok) return opening.result;
  const { session, scope, now, documents } = opening;
  const memberStates = memberStatesByInitiative(documents.initiativeMembers, readablePartners(session, scope, documents));
  const readable: InitiativeRow[] = [];
  for (const initiative of documents.initiatives) {
    if (!canView(session, { kind: "initiative", scope, ministryId: initiative.ministryContextId, responsiblePrincipalId: initiative.responsiblePrincipalId }).allowed) continue;
    readable.push(initiativeRowOf(initiative, memberStates.get(initiative.initiativeId) ?? NO_MEMBER_STATES));
  }
  const needle = (query.search ?? "").trim().toLowerCase();
  const stateFilter = query.state;
  const matching = readable.filter((row) => {
    return stateFilter !== undefined && row.state !== stateFilter ? false : needle === "" ? true : row.name.toLowerCase().includes(needle) || row.purpose.toLowerCase().includes(needle);
  });
  const sort = sortOfInitiative(query.sort);
  const ordered = [...matching].sort((left, right) => compareInitiatives(sort, left, right));
  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const items = slicePage(ordered, page, pageSize);
  const states: Record<string, RecordedValueState> = {};
  markCount(states, "page.total", ordered.length);
  for (const row of items) {
    markOptional(states, `${row.initiativeId}.period.from`, row.period !== null && row.period.from !== null);
    markOptional(states, `${row.initiativeId}.period.to`, row.period !== null && row.period.to !== null);
    markOptional(states, `${row.initiativeId}.closureDisposition`, row.closureDisposition !== null);
    markCount(states, `${row.initiativeId}.memberStates.included`, row.memberStates.included);
    markCount(states, `${row.initiativeId}.memberStates.removed`, row.memberStates.removed);
    markCount(states, `${row.initiativeId}.memberStates.excluded`, row.memberStates.excluded);
  }
  const actions: readonly ReadAction[] = [{ name: "createInitiative", available: true }, ordered.length === 0 ? { name: "readInitiative", available: false, reason: "No initiative in this ministry matches the current view." } : { name: "readInitiative", available: true }];
  const data: InitiativeListPage = { items, total: ordered.length, page, pageSize };
  const coverage = completeCoverage(earliestCivil(readable.map((row) => (row.period === null ? null : row.period.from))), latestCivil(readable.map((row) => (row.period === null ? null : row.period.to))));
  return respond({ scope, now }, coverage, { data, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, revision: documents.context.revision, valueStates: states, actions });
}
// What one initiative's detail may ask for: a membership-state filter and one page of each list it states — the working list, the Requests it recorded and the work it owns, each windowed on its own so paging one leaves the others where the reader left them.
export type InitiativeDetailQuery = { readonly memberState?: InitiativeMemberState; readonly page?: number; readonly pageSize?: number } & { readonly requestsPage?: number; readonly requestsPageSize?: number } & { readonly nextWorkPage?: number; readonly nextWorkPageSize?: number };
export type InitiativeStageState = "admitted" | "retired" | "unrecorded";
export type InitiativeStageOption = { readonly value: string; readonly admitted: boolean };
export type InitiativeMemberHistoryRow = { readonly state: InitiativeMemberState; readonly at: string; readonly byPrincipalId: PrincipalId; readonly reason: string | null };
export type InitiativeMemberRow = { readonly memberId: string; readonly partnerId: string; readonly partnerDisplayName: string; readonly partnerKind: PartnerKind } & { readonly state: InitiativeMemberState; readonly stage: string | null; readonly stageState: InitiativeStageState; readonly addedAt: string } & {
  readonly returnedAt: string | null;
  readonly history: readonly InitiativeMemberHistoryRow[];
  readonly revision: string;
};
export type RequestedTermsRow = { readonly version: string; readonly basis: "requested-terms" } & { readonly money: { readonly currency: string; readonly minorUnits: number; readonly currencyExponent: number | null; readonly cadence: string | null; readonly term: string | null } | null } & {
  readonly nonFinancial: string | null;
};
export type RequestPresentationRow = { readonly presentedOn: string; readonly manner: string; readonly versionRef: string; readonly citesCurrentVersion: boolean };
export type RequestResponseRow = { readonly kind: RequestResponseKind; readonly respondentId: string; readonly standingEvidence: string | null; readonly termsVersionRef: string; readonly recordedAt: string; readonly answersCurrentVersion: boolean };
export type InitiativeRequestRow = { readonly requestId: string; readonly recipientPartnerId: string; readonly recipientDisplayName: string | null } & { readonly representedOrganizationId: string | null; readonly purpose: string; readonly terms: RequestedTermsRow } & {
  readonly presentation: RequestPresentationRow | null;
  readonly response: RequestResponseRow | null;
} & { readonly answeredEarlierTermsVersion: boolean; readonly unanswered: boolean; readonly nextWorkIds: readonly string[] } & { readonly revision: string };
export type InitiativeTaskRow = { readonly taskId: string; readonly title: string; readonly dueOn: string | null; readonly plannedTime: string | null; readonly timeZone: string | null; readonly kind: TaskKind; readonly status: TaskRecordStatus; readonly ownerPrincipalId: PrincipalId; readonly revision: string };
export type InitiativeHistoryRow =
  | { readonly kind: "member-state"; readonly at: string; readonly memberId: string; readonly state: InitiativeMemberState; readonly byPrincipalId: PrincipalId; readonly reason: string | null }
  | { readonly kind: "request-response"; readonly at: string; readonly requestId: string; readonly responseKind: RequestResponseKind; readonly termsVersionRef: string; readonly respondentId: string };
export type InitiativeWorkingListPage = { readonly items: readonly InitiativeMemberRow[]; readonly total: number; readonly page: number; readonly pageSize: number };
/** One page of a list the detail states, over the whole list it states. */ type InitiativePageOf<T> = { readonly items: readonly T[]; readonly total: number; readonly page: number; readonly pageSize: number };
/** One page of the Requests this initiative recorded, over the whole list of them. */ export type InitiativeRequestsPage = InitiativePageOf<InitiativeRequestRow>;
/** One page of the work this initiative owns, over the whole list it owns. */ export type InitiativeNextWorkPage = InitiativePageOf<InitiativeTaskRow>;
/** Everything one initiative's detail presents: its overview, list, Requests, work and history. */
export type InitiativeDetail = { readonly initiative: InitiativeRow; readonly stages: readonly InitiativeStageOption[]; readonly workingList: InitiativeWorkingListPage } & { readonly requests: InitiativeRequestsPage } & { readonly nextWork: InitiativeNextWorkPage } & {
  readonly history: readonly InitiativeHistoryRow[];
};
const stageStateOf = (stage: string | null): InitiativeStageState => (stage === null ? "unrecorded" : (INITIATIVE_STAGES as readonly string[]).includes(stage) ? "admitted" : "retired");
function stageOptionsOf(members: readonly InitiativeMemberRecord[]): readonly InitiativeStageOption[] {
  const options: InitiativeStageOption[] = INITIATIVE_STAGES.map((value) => ({ value, admitted: true }));
  const retired = new Set<string>();
  for (const member of members) if (member.stage !== null && stageStateOf(member.stage) === "retired") retired.add(member.stage);
  return [...options, ...[...retired].sort().map((value) => ({ value, admitted: false }))];
}
const MEMBER_STATE_ORDER: Readonly<Record<InitiativeMemberState, number>> = { included: 0, removed: 1, excluded: 2 };
const memberStateOrder = (state: InitiativeMemberState): number => MEMBER_STATE_ORDER[state];
function memberRowOf(member: InitiativeMemberRecord, partners: ReadonlyMap<string, PartnerRecord>): InitiativeMemberRow | undefined {
  const partner = partners.get(member.partnerId);
  if (partner === undefined) return undefined;
  return {
    memberId: member.memberId,
    partnerId: member.partnerId,
    partnerDisplayName: partner.displayName,
    partnerKind: partner.kind,
    state: member.state,
    stage: member.stage,
    stageState: stageStateOf(member.stage),
    addedAt: member.addedAt,
    returnedAt: member.returnedAt,
    history: member.history.map((entry) => ({ state: entry.state, at: entry.at, byPrincipalId: entry.byPrincipalId, reason: entry.reason })),
    revision: member.revision,
  };
}
function requestedTermsOf(terms: RequestRecord["terms"]): RequestedTermsRow {
  return {
    version: terms.version,
    basis: "requested-terms",
    money: terms.money === null ? null : { currency: terms.money.amount.currency, minorUnits: terms.money.amount.minorUnits, currencyExponent: exponentOf(terms.money.amount.currency) ?? null, cadence: terms.money.cadence, term: terms.money.term },
    nonFinancial: terms.nonFinancial,
  };
}
function requestRowOf(request: RequestRecord, partners: ReadonlyMap<string, PartnerRecord>): InitiativeRequestRow {
  const recipient = partners.get(request.recipientPartnerId);
  const currentVersion = request.terms.version;
  return {
    requestId: request.requestId,
    recipientPartnerId: request.recipientPartnerId,
    recipientDisplayName: recipient === undefined ? null : recipient.displayName,
    representedOrganizationId: request.representedOrganizationId,
    purpose: request.purpose,
    terms: requestedTermsOf(request.terms),
    presentation: request.presentation === null ? null : { presentedOn: request.presentation.presentedOn, manner: request.presentation.manner, versionRef: request.presentation.versionRef, citesCurrentVersion: request.presentation.versionRef === currentVersion },
    response:
      request.response === null
        ? null
        : { kind: request.response.kind, respondentId: request.response.respondentId, standingEvidence: request.response.standingEvidence, termsVersionRef: request.response.termsVersionRef, recordedAt: request.response.recordedAt, answersCurrentVersion: request.response.termsVersionRef === currentVersion },
    answeredEarlierTermsVersion: request.response !== null && request.response.termsVersionRef !== currentVersion,
    unanswered: request.response === null,
    nextWorkIds: request.nextWorkIds,
    revision: request.revision,
  };
}
const taskRowOf = (task: TaskRecord): InitiativeTaskRow => ({ taskId: task.taskId, title: task.title, dueOn: task.dueOn, plannedTime: task.plannedTime, timeZone: task.timeZone, kind: task.kind, status: task.status, ownerPrincipalId: task.ownerPrincipalId, revision: task.revision });
function historyOf(initiativeId: string, members: readonly InitiativeMemberRecord[], requests: readonly RequestRecord[]): readonly InitiativeHistoryRow[] {
  const entries: InitiativeHistoryRow[] = [];
  for (const member of members) {
    if (member.initiativeId !== initiativeId) continue;
    for (const change of member.history) entries.push({ kind: "member-state", at: change.at, memberId: member.memberId, state: change.state, byPrincipalId: change.byPrincipalId, reason: change.reason });
  }
  for (const request of requests) {
    if (request.initiativeId !== initiativeId || request.response === null) continue;
    entries.push({ kind: "request-response", at: request.response.recordedAt, requestId: request.requestId, responseKind: request.response.kind, termsVersionRef: request.response.termsVersionRef, respondentId: request.response.respondentId });
  }
  return entries.sort((left, right) => instantOrder(right.at) - instantOrder(left.at));
}
function initiativeActions(input: { readonly session: ResolvedSession; readonly scope: Scope; readonly initiative: InitiativeRecord; readonly members: readonly InitiativeMemberRecord[]; readonly requests: readonly RequestRecord[] }): readonly ReadAction[] {
  const edits = canEdit(input.session, { kind: "initiative", scope: input.scope, ministryId: input.initiative.ministryContextId, responsiblePrincipalId: input.initiative.responsiblePrincipalId });
  const closed = lifecycleOf(input.initiative) === "closed";
  const responsibleReason = "Only the principal responsible for this initiative may change it.";
  const listed = input.members.filter((member) => member.state === "included").length > 0;
  const returned = input.members.filter((member) => member.state === "removed").length > 0;
  const awaitingPresentation = input.requests.some((request) => request.presentation === null);
  const awaitingResponse = input.requests.some((request) => request.presentation !== null && request.response === null);
  const refused = (name: string, reason: string): ReadAction => ({ name, available: false, reason: edits.allowed ? reason : responsibleReason });
  return [
    edits.allowed && !closed ? { name: "addMembers", available: true } : refused("addMembers", "This initiative is closed, so its working list no longer takes new members."),
    edits.allowed && listed ? { name: "removeMember", available: true } : refused("removeMember", "The working list has no included member to remove."),
    edits.allowed && returned ? { name: "returnMember", available: true } : refused("returnMember", "No removed member is available to return."),
    edits.allowed && listed ? { name: "setStage", available: true } : refused("setStage", "A stage is recorded against an included member, and the working list has none."),
    edits.allowed && !closed ? { name: "draftRequest", available: true } : refused("draftRequest", "This initiative is closed, so no new Request may be drafted."),
    edits.allowed && awaitingPresentation && !closed ? { name: "presentRequest", available: true } : refused("presentRequest", closed ? "This initiative is closed, so no new solicitation may be presented." : "No drafted Request is waiting to be presented."),
    edits.allowed && awaitingResponse ? { name: "recordRequestResponse", available: true } : refused("recordRequestResponse", "No presented Request is waiting for a response."),
    edits.allowed && !closed ? { name: "closeInitiative", available: true } : refused("closeInitiative", "This initiative is already closed."),
    edits.allowed && closed ? { name: "reopenInitiative", available: true } : refused("reopenInitiative", "Only a closed initiative can be reopened."),
  ];
}
/** Reads one initiative: its overview, the reviewed working list, its Requests with the terms version each answers, the work it owns and its dated history — each of those three lists stated as one page of its own whole result, with the window it occupies and the total it is measured against. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInitiative(initiativeId: string, query: InitiativeDetailQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<InitiativeDetail>>> {
  const subject = await initiativeSubjectOf("readInitiative", initiativeId, source);
  if (!subject.ok) return subject.result;
  const { session, scope, now, documents, initiative, partners } = subject;
  const members = documents.initiativeMembers.filter((member) => member.initiativeId === initiative.initiativeId);
  const requests = documents.requests.filter((request) => request.initiativeId === initiative.initiativeId).sort((left, right) => (left.requestId < right.requestId ? -1 : 1));
  const workingList = members
    .map((member) => memberRowOf(member, partners))
    .filter((row): row is InitiativeMemberRow => row !== undefined)
    .filter((row) => query.memberState === undefined || row.state === query.memberState)
    .sort((left, right) => {
      const byState = memberStateOrder(left.state) - memberStateOrder(right.state);
      return byState !== 0 ? byState : compareCodeUnits(left.partnerDisplayName, right.partnerDisplayName);
    });
  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const items = slicePage(workingList, page, pageSize);
  const requestRows = requests.map((request) => requestRowOf(request, partners));
  // Each list is windowed on its own, over its own whole result: a Request answered on page three of the Requests leaves the working list and the owned work on the pages the reader left them on, and every total below stays the whole-result count rather than the length of the page.
  const requestsPage = pageOf(query.requestsPage);
  const requestsPageSize = clampPageSize(query.requestsPageSize);
  const requestPageRows = slicePage(requestRows, requestsPage, requestsPageSize);
  const nextWork = documents.tasks
    .filter((task) => task.initiativeId === initiative.initiativeId && (task.status === "open" || task.status === "reopened"))
    .sort(compareTasksByDue)
    .map(taskRowOf);
  const nextWorkPage = pageOf(query.nextWorkPage);
  const nextWorkPageSize = clampPageSize(query.nextWorkPageSize);
  const nextWorkPageRows = slicePage(nextWork, nextWorkPage, nextWorkPageSize);
  const states: Record<string, RecordedValueState> = {};
  markCount(states, "workingList.total", workingList.length);
  markCount(states, "requests.total", requestRows.length);
  markCount(states, "nextWork.total", nextWork.length);
  markOptional(states, "initiative.period.from", initiative.period !== null && initiative.period.from !== null);
  markOptional(states, "initiative.period.to", initiative.period !== null && initiative.period.to !== null);
  markOptional(states, "initiative.closureDisposition", initiative.closureDisposition !== null);
  for (const row of items) {
    markOptional(states, `${row.memberId}.stage`, row.stage !== null);
    markOptional(states, `${row.memberId}.returnedAt`, row.returnedAt !== null);
  }
  for (const request of requestPageRows) {
    markOptional(states, `${request.requestId}.representedOrganizationId`, request.representedOrganizationId !== null);
    markOptional(states, `${request.requestId}.presentation`, request.presentation !== null);
    markOptional(states, `${request.requestId}.response`, request.response !== null);
    markOptional(states, `${request.requestId}.terms.money`, request.terms.money !== null);
    if (request.terms.money !== null) markOptional(states, `${request.requestId}.terms.money.currencyExponent`, request.terms.money.currencyExponent !== null);
    if (request.recipientDisplayName === null) {
      states[`${request.requestId}.recipientDisplayName`] = "withheld";
    } else {
      states[`${request.requestId}.recipientDisplayName`] = "value";
    }
  }
  for (const task of nextWorkPageRows) {
    markOptional(states, `${task.taskId}.dueOn`, task.dueOn !== null);
    markOptional(states, `${task.taskId}.plannedTime`, task.plannedTime !== null);
  }
  const data: InitiativeDetail = {
    initiative: initiativeRowOf(initiative, memberStatesOf(members, partners)),
    stages: stageOptionsOf(members),
    workingList: { items, total: workingList.length, page, pageSize },
    requests: { items: requestPageRows, total: requestRows.length, page: requestsPage, pageSize: requestsPageSize },
    nextWork: { items: nextWorkPageRows, total: nextWork.length, page: nextWorkPage, pageSize: nextWorkPageSize },
    history: historyOf(initiative.initiativeId, members, requests),
  };
  const coverage = completeCoverage(earliestCivil([initiative.period === null ? null : initiative.period.from, ...requests.map((request) => (request.presentation === null ? null : request.presentation.presentedOn))]), latestCivil([initiative.period === null ? null : initiative.period.to]));
  const actions = initiativeActions({ session, scope, initiative, members, requests });
  return respond({ scope, now }, coverage, { data, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, revision: initiative.revision, valueStates: states, actions });
}
export type MeasuredCount = { readonly count: number; readonly denominator: number; readonly denominatorMeaning: string; readonly percentage?: number };
export type ResponseKindResult = MeasuredCount & { readonly kind: RequestResponseKind };
export type TermsVersionResult = { readonly termsVersion: string; readonly state: "current" | "superseded"; readonly requestsReferencing: number; readonly responses: MeasuredCount };
export type InitiativeResults = { readonly initiative: { readonly initiativeId: string; readonly name: string; readonly state: InitiativeState; readonly lifecycle: InitiativeLifecycle; readonly revision: string } } & {
  readonly workingList: { readonly included: MeasuredCount; readonly removed: MeasuredCount; readonly excluded: MeasuredCount };
} & { readonly requests: { readonly presented: MeasuredCount; readonly answered: MeasuredCount; readonly unanswered: MeasuredCount } } & { readonly responseKinds: readonly ResponseKindResult[]; readonly termsVersions: readonly TermsVersionResult[] };
const WORKING_LIST_BASE = "partners the reviewed working list carries";
const REQUEST_BASE = "Requests recorded for this initiative";
function measuredCount(count: number, denominator: number, denominatorMeaning: string): MeasuredCount {
  const base = { count, denominator, denominatorMeaning };
  return denominator <= 0 ? base : { ...base, percentage: Math.round((count * 1000) / denominator) / 10 };
}
/** How one terms version accumulated across the results read's single pass: the Requests naming it, the responses bound to it, and whether any Request states it as its current terms. */
type TermsVersionTally = { referencing: number; bound: number; current: boolean };
/** The version a terms token names, taken from its trailing digits — the `terms-v<N>` form the composer and `storedTermsOf` produce — and 1 where the token states none, so versions order by the version they name rather than by their text. */
function termsVersionOrdinal(termsVersion: string): number {
  const stated = /(\d+)$/u.exec(termsVersion)?.[1];
  return stated === undefined ? 1 : Number(stated);
}
/** The one terms version the results state as current: the greatest of the versions a Request now states as its terms, ordered by that version's own number and then by code unit. A version only an earlier presentation or an earlier answer names stays superseded, so two versions are never both labelled current. */
function currentTermsVersionOf(versions: ReadonlyMap<string, TermsVersionTally>): string | null {
  const stated = [...versions].filter(([, tally]) => tally.current).map(([termsVersion]) => termsVersion);
  stated.sort((left, right) => termsVersionOrdinal(right) - termsVersionOrdinal(left) || compareCodeUnits(right, left));
  return stated.at(0) ?? null;
}
/** Reads one initiative's results: every count as a numerator over a stated base. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readInitiativeResults(initiativeId: string, source?: SessionSource): Promise<ReadResult<ReadEnvelope<InitiativeResults>>> {
  const subject = await initiativeSubjectOf("readInitiativeResults", initiativeId, source);
  if (!subject.ok) return subject.result;
  const { scope, now, documents, initiative, partners } = subject;
  const members = documents.initiativeMembers.filter((member) => member.initiativeId === initiative.initiativeId && partners.has(member.partnerId));
  const requests = documents.requests.filter((request) => request.initiativeId === initiative.initiativeId);
  const rosterTotal = members.length;
  const included = members.filter((member) => member.state === "included").length;
  const removed = members.filter((member) => member.state === "removed").length;
  const excluded = members.filter((member) => member.state === "excluded").length;
  // One pass over the Requests answers every count below, and the whole version table with it, so the read never re-filters the set once per response kind and once per terms version.
  let presented = 0;
  let answered = 0;
  let unanswered = 0;
  const responsesByKind = new Map<RequestResponseKind, number>();
  const versions = new Map<string, TermsVersionTally>();
  for (const request of requests) {
    if (request.presentation !== null) presented += 1;
    if (request.response === null) {
      unanswered += 1;
    } else {
      answered += 1;
      responsesByKind.set(request.response.kind, (responsesByKind.get(request.response.kind) ?? 0) + 1);
    }
    // A request counts once for a version however many of its own fields name that version: the version's base is a count of Requests, never a count of fields.
    const statedVersions = new Set([request.terms.version]);
    if (request.presentation !== null) statedVersions.add(request.presentation.versionRef);
    if (request.response !== null) statedVersions.add(request.response.termsVersionRef);
    for (const termsVersion of statedVersions) {
      const tally = versions.get(termsVersion) ?? { referencing: 0, bound: 0, current: false };
      tally.referencing += 1;
      if (termsVersion === request.terms.version) tally.current = true;
      versions.set(termsVersion, tally);
    }
    if (request.response !== null) {
      const boundTo = versions.get(request.response.termsVersionRef);
      if (boundTo !== undefined) boundTo.bound += 1;
    }
  }
  const responseKinds: ResponseKindResult[] = REQUEST_RESPONSE_KINDS.map((kind) => ({ kind, ...measuredCount(kind === "unanswered" ? unanswered : (responsesByKind.get(kind) ?? 0), requests.length, REQUEST_BASE) }));
  const currentTermsVersion = currentTermsVersionOf(versions);
  const termsVersions: TermsVersionResult[] = [...versions.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([termsVersion, tally]) => ({ termsVersion, state: termsVersion === currentTermsVersion ? "current" : "superseded", requestsReferencing: tally.referencing, responses: measuredCount(tally.bound, tally.referencing, "Requests that stated or answered this terms version") }));
  const data: InitiativeResults = {
    initiative: { initiativeId: initiative.initiativeId, name: initiative.name, state: initiative.state, lifecycle: lifecycleOf(initiative), revision: initiative.revision },
    workingList: { included: measuredCount(included, rosterTotal, WORKING_LIST_BASE), removed: measuredCount(removed, rosterTotal, WORKING_LIST_BASE), excluded: measuredCount(excluded, rosterTotal, WORKING_LIST_BASE) },
    requests: { presented: measuredCount(presented, requests.length, REQUEST_BASE), answered: measuredCount(answered, requests.length, REQUEST_BASE), unanswered: measuredCount(unanswered, requests.length, REQUEST_BASE) },
    responseKinds,
    termsVersions,
  };
  const states: Record<string, RecordedValueState> = {};
  for (const [path, value] of [
    ["workingList.included", data.workingList.included],
    ["workingList.removed", data.workingList.removed],
    ["workingList.excluded", data.workingList.excluded],
    ["requests.presented", data.requests.presented],
    ["requests.answered", data.requests.answered],
    ["requests.unanswered", data.requests.unanswered],
  ] as const) {
    markCount(states, `${path}.count`, value.count);
    markCount(states, `${path}.denominator`, value.denominator);
    markOptional(states, `${path}.percentage`, value.percentage !== undefined);
  }
  for (const kind of responseKinds) {
    markCount(states, `responseKinds.${kind.kind}.count`, kind.count);
    markOptional(states, `responseKinds.${kind.kind}.percentage`, kind.percentage !== undefined);
  }
  for (const version of termsVersions) {
    markCount(states, `termsVersions.${version.termsVersion}.requestsReferencing`, version.requestsReferencing);
    markCount(states, `termsVersions.${version.termsVersion}.responses.count`, version.responses.count);
    markOptional(states, `termsVersions.${version.termsVersion}.responses.percentage`, version.responses.percentage !== undefined);
  }
  const coverage = completeCoverage(earliestCivil([initiative.period === null ? null : initiative.period.from, ...requests.map((request) => (request.presentation === null ? null : request.presentation.presentedOn))]), latestCivil([initiative.period === null ? null : initiative.period.to]));
  return respond({ scope, now }, coverage, { data, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, revision: initiative.revision, valueStates: states, actions: [{ name: "readInitiative", available: true }] });
}
export type ReferralListName = "active" | "incomplete-date" | "expired";
export type ReferralsQuery = { readonly list?: ReferralListName; readonly search?: string; readonly page?: number; readonly pageSize?: number };
export type ReferralNominalWindow = { readonly lastIncludedOn: string; readonly wording: string; readonly disagreesWithResolved: boolean; readonly resolution: MidnightResolution };
export type ReferralDeadlineView = { readonly kind: ReferralWindowKind; readonly end: string; readonly nominal: ReferralNominalWindow | null; readonly nominalUnavailableReason: string | null; readonly resolvedOn: string | null };
export type ContinuationEligibility = { readonly available: boolean; readonly reason: string | null; readonly cycle: { readonly consumed: boolean; readonly successorId: string | null } };
export type ContinuationPolicy = { readonly setting: "on" | "off" | "unknown"; readonly reason: string | null };
export type ReferralDetailRow = { readonly referralId: string; readonly partnerId: string; readonly partnerDisplayName: string; readonly partnerKind: PartnerKind } & { readonly datePrecision: DatePrecision; readonly originalIntroductionOn: string | null; readonly sourceZone: string } & {
  readonly sourceReference: SourceReference | null;
  readonly cycleIndex: number;
  readonly windowKind: ReferralWindowKind;
} & { readonly windowStart: string | null; readonly windowEnd: string | null; readonly consumed: boolean; readonly predecessorId: string | null } & { readonly successorId: string | null; readonly status: ReferralWindowStatus; readonly deadline: ReferralDeadlineView | null } & {
  readonly continuation: ContinuationEligibility;
  readonly revision: string;
};
const EXPIRED_REFERRAL_FIELDS = ["referralId", "partnerDisplayName", "sourceReference", "status", "originalIntroductionOn", "datePrecision", "windowKind", "windowStart", "windowEnd", "cycleIndex", "consumed", "continuation"] as const satisfies readonly (keyof ReferralDetailRow)[];
export type ExpiredReferralRow = Pick<ReferralDetailRow, (typeof EXPIRED_REFERRAL_FIELDS)[number]>;
export type ReferralListRow = { readonly referralId: string; readonly partnerDisplayName: string; readonly datePrecision: DatePrecision } & { readonly originalIntroductionOn: string | null; readonly cycleIndex: number; readonly windowKind: ReferralWindowKind } & {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly status: ReferralWindowStatus["status"];
} & { readonly statusReason: WindowRefusalReason | null; readonly consumed: boolean; readonly continuation: ContinuationEligibility };
export type ReferralListData =
  | { readonly list: "active" | "incomplete-date"; readonly items: readonly ReferralListRow[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly continuationPolicy: ContinuationPolicy }
  | { readonly list: "expired"; readonly items: readonly ExpiredReferralRow[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly continuationPolicy: ContinuationPolicy };
export type ReferralDetailData = { readonly view: "detail"; readonly referral: ReferralDetailRow; readonly continuationPolicy: ContinuationPolicy } | { readonly view: "expired-history"; readonly referral: ExpiredReferralRow; readonly continuationPolicy: ContinuationPolicy };
function continuationPolicyOf(session: ResolvedSession): ContinuationPolicy {
  const setting = isScenarioId(session.scenarioId) ? scenarioFlagsFor(session.scenarioId).continuationSetting : "unknown";
  switch (setting) {
    case "on":
      return { setting, reason: null };
    case "off":
      return { setting, reason: "Worker continuation is off, so an ordinarily expired referral offers no Continue action." };
    case "unknown":
      return { setting, reason: "The worker-continuation setting could not be read, so no Continue action is offered." };
  }
}
function referralStatusOf(cycle: ReferralCycleRecord, now: Temporal.Instant): ReferralWindowStatus {
  const end = instantOf(cycle.windowEnd);
  return cycle.windowEnd !== null && end === undefined ? { status: "refused", reason: "invalid-date" } : referralWindowState({ windowEnd: end, now });
}
function matchingNewWindowRule(input: { readonly cycle: ReferralCycleRecord; readonly originalIntroductionOn: CivilDate; readonly end: Temporal.Instant }): Extract<NewWindowEnd, { status: "bounded" }> | undefined {
  if (input.cycle.datePrecision !== "date") return undefined;
  for (let days = 1; days <= NEW_WINDOW_PERIOD_SEARCH_LIMIT; days += 1) {
    const candidate = newWindowEnd({ originalIntroductionOn: input.originalIntroductionOn, datePrecision: input.cycle.datePrecision, sourceZone: input.cycle.sourceZone, days });
    if (candidate.status === "bounded" && candidate.resolvedEndInstant.toString() === input.end.toString()) return candidate;
  }
  return undefined;
}
function deadlineOf(cycle: ReferralCycleRecord): ReferralDeadlineView | null {
  const end = instantOf(cycle.windowEnd);
  if (end === undefined) return null;
  const resolved = civilDateAt(end, cycle.sourceZone);
  const resolvedOn = resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null;
  if (cycle.windowKind === "continued") return { kind: "continued", end: end.toString(), nominal: null, nominalUnavailableReason: "A continuation is counted in elapsed seconds from the instant it was accepted, so it has no calendar-day wording.", resolvedOn };
  const parsedDate = cycle.originalIntroductionOn === null ? undefined : parseCivilDate(cycle.originalIntroductionOn);
  if (parsedDate === undefined || parsedDate.status === "refused") return { kind: cycle.windowKind, end: end.toString(), nominal: null, nominalUnavailableReason: "The stored introduction date cannot be read as a calendar date, so no calendar-day wording is stated for this endpoint.", resolvedOn };
  const rule = matchingNewWindowRule({ cycle, originalIntroductionOn: parsedDate.date, end });
  if (rule === undefined) return { kind: cycle.windowKind, end: end.toString(), nominal: null, nominalUnavailableReason: "The persisted endpoint is not the endpoint any period of the New-window rule resolves today, so the persisted instant stands and no nominal wording is stated for it.", resolvedOn };
  return { kind: cycle.windowKind, end: end.toString(), nominal: { lastIncludedOn: serialiseCivilDate(rule.nominalLastIncludedOn), wording: rule.nominalWording, disagreesWithResolved: rule.nominalDisagreesWithResolved, resolution: rule.resolution }, nominalUnavailableReason: null, resolvedOn };
}
function continuationOf(input: { readonly status: ReferralWindowStatus; readonly cycle: ReferralCycleRecord; readonly successorId: string | null; readonly policy: ContinuationPolicy }): ContinuationEligibility {
  const cycleState = { consumed: input.cycle.consumed, successorId: input.successorId };
  const unavailable = (reason: string): ContinuationEligibility => ({ available: false, reason, cycle: cycleState });
  switch (input.status.status) {
    case "active":
      return unavailable("This referral's window has not ended, so there is nothing to continue.");
    case "no-deadline":
      return unavailable("The introduction date is not precise enough to have had a window, so there is nothing to continue.");
    case "refused":
      return unavailable("The window this referral carries could not be evaluated, so no continuation is offered.");
    case "expired":
      break;
  }
  if (input.cycle.windowKind !== "new") return unavailable("This cycle is itself a continuation, and an introduction carries at most one continuation.");
  return input.cycle.consumed || input.successorId !== null ? unavailable("This referral cycle has already been continued.") : input.policy.reason !== null ? unavailable(input.policy.reason) : { available: true, reason: null, cycle: cycleState };
}
function successorIdOf(referralId: string, referrals: readonly ReferralCycleRecord[]): string | null {
  const successor = referrals.find((cycle) => cycle.predecessorId === referralId);
  return successor === undefined ? null : successor.referralId;
}
type ReferralRowBase = Omit<ReferralDetailRow, "deadline">;
function referralRowOf(input: { readonly cycle: ReferralCycleRecord; readonly partners: ReadonlyMap<string, PartnerRecord>; readonly referrals: readonly ReferralCycleRecord[]; readonly now: Temporal.Instant; readonly policy: ContinuationPolicy }): ReferralRowBase | undefined {
  const partner = input.partners.get(input.cycle.partnerId);
  if (partner === undefined) return undefined;
  const status = referralStatusOf(input.cycle, input.now);
  const successorId = successorIdOf(input.cycle.referralId, input.referrals);
  return {
    referralId: input.cycle.referralId,
    partnerId: input.cycle.partnerId,
    partnerDisplayName: partner.displayName,
    partnerKind: partner.kind,
    datePrecision: input.cycle.datePrecision,
    originalIntroductionOn: input.cycle.originalIntroductionOn,
    sourceZone: input.cycle.sourceZone,
    sourceReference: input.cycle.sourceReference,
    cycleIndex: input.cycle.cycleIndex,
    windowKind: input.cycle.windowKind,
    windowStart: input.cycle.windowStart,
    windowEnd: input.cycle.windowEnd,
    consumed: input.cycle.consumed,
    predecessorId: input.cycle.predecessorId,
    successorId,
    status,
    continuation: continuationOf({ status, cycle: input.cycle, successorId, policy: input.policy }),
    revision: input.cycle.revision,
  };
}
const LIST_OF_STATUS: Readonly<Record<ReferralWindowStatus["status"], ReferralListName>> = { active: "active", expired: "expired", "no-deadline": "incomplete-date", refused: "incomplete-date" };
const listOfStatus = (status: ReferralWindowStatus): ReferralListName => LIST_OF_STATUS[status.status];
function referralListRowOf(row: ReferralRowBase): ReferralListRow {
  const { referralId, partnerDisplayName, datePrecision, originalIntroductionOn, cycleIndex, windowKind, windowStart, windowEnd, consumed, continuation } = row;
  return { referralId, partnerDisplayName, datePrecision, originalIntroductionOn, cycleIndex, windowKind, windowStart, windowEnd, status: row.status.status, statusReason: row.status.status === "refused" ? row.status.reason : null, consumed, continuation };
}
function latestResolvedDay(rows: readonly ReferralRowBase[]): string | null {
  const days: (string | null)[] = [];
  for (const row of rows) {
    const end = instantOf(row.windowEnd);
    if (end === undefined) {
      days.push(null);
      continue;
    }
    const resolved = civilDateAt(end, row.sourceZone);
    days.push(resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null);
  }
  return latestCivil(days);
}
const compareDatesDescending = (left: string | null, right: string | null): number => (left === null && right === null ? 0 : left === null ? 1 : right === null ? -1 : instantOrder(right) - instantOrder(left));
function compareReferrals(left: ReferralRowBase, right: ReferralRowBase): number {
  const byEnd = compareDatesDescending(left.windowEnd, right.windowEnd);
  if (byEnd !== 0) return byEnd;
  const byIntroduction = compareDatesDescending(left.originalIntroductionOn, right.originalIntroductionOn);
  return byIntroduction !== 0 ? byIntroduction : left.referralId < right.referralId ? -1 : 1;
}
/** Lists referrals in one of the three lists: Active, incomplete-date, or the narrow permitted Expired view. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReferrals(query: ReferralsQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReferralListData>>> {
  const opening = await openOutreach("readReferrals", source);
  if (!opening.ok) return opening.result;
  const { session, scope, now, documents } = opening;
  const permitted = canView(session, { kind: "referral", scope });
  if (!permitted.allowed) return { kind: "denied", denied: permitted.denial };
  const partners = readablePartners(session, scope, documents);
  const continuationPolicy = continuationPolicyOf(session);
  const rows: ReferralRowBase[] = [];
  for (const cycle of documents.referrals) {
    const row = referralRowOf({ cycle, partners, referrals: documents.referrals, now, policy: continuationPolicy });
    if (row !== undefined) rows.push(row);
  }
  const list: ReferralListName = query.list ?? "active";
  const needle = (query.search ?? "").trim().toLowerCase();
  const matching = rows
    .filter((row) => listOfStatus(row.status) === list)
    .filter((row) => needle === "" || row.partnerDisplayName.toLowerCase().includes(needle))
    .sort(compareReferrals);
  const page = pageOf(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const pageRows = slicePage(matching, page, pageSize);
  const states: Record<string, RecordedValueState> = {};
  markCount(states, "page.total", matching.length);
  for (const row of pageRows) {
    markOptional(states, `${row.referralId}.originalIntroductionOn`, row.originalIntroductionOn !== null);
    markOptional(states, `${row.referralId}.windowStart`, row.windowStart !== null);
    markOptional(states, `${row.referralId}.windowEnd`, row.windowEnd !== null);
    markOptional(states, `${row.referralId}.sourceReference`, row.sourceReference !== null);
  }
  const continueOffered = matching.some((row) => row.continuation.available);
  const actions: readonly ReadAction[] = [
    { name: "recordIntroduction", available: true },
    ...(continueOffered ? [{ name: "continueReferral", available: true }] : []),
    matching.length === 0 ? { name: "readReferral", available: false, reason: `No referral is in the ${list} list for the current view.` } : { name: "readReferral", available: true },
  ];
  const data: ReferralListData = list === "expired" ? { list, items: pageRows.map((row) => project(row, EXPIRED_REFERRAL_FIELDS)), total: matching.length, page, pageSize, continuationPolicy } : { list, items: pageRows.map(referralListRowOf), total: matching.length, page, pageSize, continuationPolicy };
  return respond({ scope, now }, completeCoverage(earliestCivil(matching.map((row) => row.originalIntroductionOn)), latestResolvedDay(matching)), { data, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, revision: documents.context.revision, valueStates: states, actions });
}
/** Reads one referral: the introduction it records with its precision, the window resolved from it, the disclosure that sits beside the resolved instant, where it stands now and whether it may. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReferral(referralId: string, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReferralDetailData>>> {
  const opening = await openOutreach("readReferral", source);
  if (!opening.ok) return opening.result;
  const { session, scope, now, documents } = opening;
  const cycle = documents.referrals.find((record) => record.referralId === referralId);
  if (cycle === undefined) return deniedRead("no-permission");
  const decision = canView(session, { kind: "referral", scope });
  if (!decision.allowed) return { kind: "denied", denied: decision.denial };
  const partners = readablePartners(session, scope, documents);
  const continuationPolicy = continuationPolicyOf(session);
  const base = referralRowOf({ cycle, partners, referrals: documents.referrals, now, policy: continuationPolicy });
  if (base === undefined) return deniedRead("no-permission");
  const row: ReferralDetailRow = { ...base, deadline: deadlineOf(cycle) };
  const expired = row.status.status === "expired";
  const data: ReferralDetailData = expired ? { view: "expired-history", referral: project(row, EXPIRED_REFERRAL_FIELDS), continuationPolicy } : { view: "detail", referral: row, continuationPolicy };
  const states: Record<string, RecordedValueState> = {};
  markOptional(states, `${row.referralId}.originalIntroductionOn`, row.originalIntroductionOn !== null);
  markOptional(states, `${row.referralId}.windowStart`, row.windowStart !== null);
  markOptional(states, `${row.referralId}.windowEnd`, row.windowEnd !== null);
  markOptional(states, `${row.referralId}.sourceReference`, row.sourceReference !== null);
  if (!expired) {
    markOptional(states, `${row.referralId}.deadline`, row.deadline !== null);
    markOptional(states, `${row.referralId}.deadline.nominal`, row.deadline !== null && row.deadline.nominal !== null);
    markOptional(states, `${row.referralId}.deadline.resolvedOn`, row.deadline !== null && row.deadline.resolvedOn !== null);
    markOptional(states, `${row.referralId}.successorId`, row.successorId !== null);
    markOptional(states, `${row.referralId}.predecessorId`, row.predecessorId !== null);
  }
  const actions: readonly ReadAction[] = row.continuation.available ? [{ name: "continueReferral", available: true }] : [];
  return answerOf(scope, now.toString(), { data, source: { system: LOCAL_STORE_SYSTEM, reference: OUTREACH_SOURCE_REFERENCE }, revision: row.revision, coverage: completeCoverage(row.originalIntroductionOn, latestResolvedDay([row])), valueStates: states, actions });
}
