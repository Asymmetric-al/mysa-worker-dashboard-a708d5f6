/** The outreach mutations: the twelve named commands that create and maintain an initiative's reviewed working list, the versioned Requests presented inside it, and the referral cycles that record an … */
import { Temporal } from "temporal-polyfill";
import { ZodError, z } from "zod";
import { sameSourceReference, type SourceReference } from "@/lib/ids";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { isKnownCurrency } from "@/modules/money/currency";
import { instantAt } from "@/modules/time/clock";
import { DATE_PRECISIONS, parseCivilDate, serialiseCivilDate, startOfCivilDay, type CivilDate } from "@/modules/time/civil";
import { continuedWindowEnd, newWindowEnd, referralWindowState } from "@/modules/time/window";
import { assertScope, outcomeOfRefusal, resolveSession, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import { INITIATIVE_STAGES, REQUEST_RESPONSE_KINDS, initiativeMemberRecordSchema, initiativeRecordSchema, moneySchema, partnerRecordSchema, referralCycleRecordSchema, requestRecordSchema, sessionContextRecordSchema, taskRecordSchema } from "../envelope";
import type { InitiativeMemberRecord, InitiativeRecord, MutationInput, ReferralCycleRecord, RequestPresentation, RequestRecord, RequestResponse, RequestResponseKind, RequestTerms, Scope } from "../envelope";
import { runMutation, type ApplyResult, type CurrentTarget, type MutationContext } from "../operations";
import { UNIDENTIFIED_ATTEMPT, denied, type MutationOutcome, type MutationResult, type PerItemResult } from "../outcome";
const FIRST_REVISION = "rev-1";

const REVISION_COUNTER = /^(?<prefix>.*-)(?<counter>\d+)$/u;

const REFERRAL_NEW_WINDOW_DAYS = 14;
const REFERRAL_CONTINUATION_DAYS = 30;

const MAX_SELECTED_PARTNERS = 200;

const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";
function boundedTextSchema(maxCodePoints: number, messages: { readonly required: string; readonly tooLong: string }): z.ZodString {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      const length = Array.from(value).length;
      if (length === 0) {
        context.addIssue({ code: "custom", message: messages.required });
      } else if (length > maxCodePoints) {
        context.addIssue({ code: "custom", message: messages.tooLong });
      }
    });
}
function identifierFieldSchema(message: string): z.ZodString {
  return z.string().trim().min(1, message);
}
const civilDateSchema: z.ZodType<CivilDate> = z
  .string()
  .trim()
  .transform((value: string, context) => {
    const parsed = parseCivilDate(value);
    if (parsed.status === "refused") {
      context.addIssue({ code: "custom", message: "Enter a real calendar date as YYYY-MM-DD." });
      return z.NEVER;
    }
    return parsed.date;
  });
const sourceReferenceFieldSchema: z.ZodType<SourceReference> = z.strictObject({ system: z.string().trim().min(1, "Name the source system that issued this reference."), reference: z.string().trim().min(1, "Enter the reference the source issued.") });
const outreachStateSchema = z.looseObject({
  context: sessionContextRecordSchema,
  partners: z.array(partnerRecordSchema),
  initiatives: z.array(initiativeRecordSchema),
  initiativeMembers: z.array(initiativeMemberRecordSchema),
  requests: z.array(requestRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  tasks: z.array(taskRecordSchema),
});
type OutreachState = z.infer<typeof outreachStateSchema>;

type StoredDocuments = MutationContext["docs"];

class StoredRecordsUnreadable extends Error {
  constructor() {
    super("The stored outreach records cannot be read as this build's records, so nothing was changed. Reset the development seed from Settings to restore the known dataset.");
    this.name = CORRUPT_DOCUMENT_FAULT;
    Object.setPrototypeOf(this, StoredRecordsUnreadable.prototype);
  }
}
function readState(documents: StoredDocuments): OutreachState {
  const parsed = outreachStateSchema.safeParse(documents.state);
  if (!parsed.success) throw new StoredRecordsUnreadable();
  return parsed.data;
}
function writeState(documents: StoredDocuments, state: OutreachState, changed: Partial<OutreachState>): void {
  documents.state = { ...state, ...changed, context: { ...state.context, revision: nextRevision(state.context.revision) } };
}
function nextRevision(revision: string): string {
  const parsed = REVISION_COUNTER.exec(revision);
  const counter = parsed?.groups?.counter;
  const prefix = parsed?.groups?.prefix;
  if (counter === undefined || prefix === undefined) return `${revision}-2`;
  const advanced = Number(counter) + 1;
  return Number.isSafeInteger(advanced) ? `${prefix}${String(advanced)}` : `${revision}-2`;
}
function recordIdFor(kind: string, operationId: string): string {
  return `${kind}-${operationId}`;
}
function commandInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}
function readInstant(value: string): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}
function refuseField(path: string, message: string): never {
  throw new ZodError([{ code: "custom", message, path: [path] }]);
}
type RefusalResult = { readonly refused: MutationOutcome };

function refuseDenied(operationId: string): RefusalResult {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}
type PayloadState<P> = { readonly validated: true; readonly payload: P } | { readonly validated: false };

type OutreachMutation<P, R extends MutationResult> = {
  readonly schema: z.ZodType<P>;
  readonly name: string;
  readonly authorize?: (session: ResolvedSession, payload: P, scope: Scope) => ScopeDecision;
  readonly readCurrent?: (documents: StoredDocuments, payload: P, scope: Scope) => CurrentTarget;
  readonly apply: (context: MutationContext, payload: P, scope: Scope) => ApplyResult<R>;
};
function attemptIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const candidate: unknown = Reflect.get(input, "operationId");
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return UNIDENTIFIED_ATTEMPT;
}
async function runOutreachMutation<P, R extends MutationResult>(input: MutationInput<unknown>, source: SessionSource | undefined, plan: OutreachMutation<P, R>): Promise<MutationOutcome> {
  const parsed = plan.schema.safeParse(input.payload);
  const pending: PayloadState<P> = parsed.success ? { validated: true, payload: parsed.data } : { validated: false };
  const scope = input.scope;
  // `runMutation` serialises its transaction by session, so the session an attempt acts for has to be established before one opens; the runner then resolves it again authoritatively and refuses a request that claims a session it did not come from. A session that cannot be established is
  // refused here, before any record is looked at, so the attempt learns nothing it asked about.
  let sessionId: string;
  try {
    const resolution = await resolveSession(source);
    if (!resolution.ok) return outcomeOfRefusal(resolution.refusal, attemptIdOf(input));
    sessionId = resolution.session.sessionId;
  } catch {
    // A request scope that cannot yield its cookie leaves no session to establish, which is the one refusal the resolver names for that case.
    return denied({ operationId: attemptIdOf(input), reasonCode: "session-unavailable" });
  }
  return runMutation<P, R>({
    sessionId,
    // A browser posts JSON, so the payload arrives untyped. The runner validates both the envelope and this payload before either hook reads them, and the assertion states the type that validation establishes rather than a claim about the bytes that arrived.
    input: input as MutationInput<P>,
    schema: plan.schema,
    name: plan.name,
    authorize: (session) => (pending.validated && plan.authorize !== undefined ? plan.authorize(session, pending.payload, scope) : assertScope(session, scope)),
    readCurrent: (documents) => (pending.validated && plan.readCurrent !== undefined ? plan.readCurrent(documents, pending.payload, scope) : { kind: "absent" }),
    apply: (context) => (pending.validated ? plan.apply(context, pending.payload, scope) : { changed: false }),
  });
}
type InitiativeAccess = { readonly kind: "found"; readonly initiative: InitiativeRecord } | { readonly kind: "refused" };

function initiativeAccessOf(state: OutreachState, initiativeId: string, session: ResolvedSession, scope: Scope): InitiativeAccess {
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined) return { kind: "refused" };
  if (initiative.ministryContextId !== scope.ministryId) return { kind: "refused" };
  return initiative.responsiblePrincipalId === session.principalId ? { kind: "found", initiative } : { kind: "refused" };
}
type RequestAccess = { readonly kind: "found"; readonly request: RequestRecord; readonly initiative: InitiativeRecord } | { readonly kind: "refused" };
function requestAccessOf(state: OutreachState, requestId: string, session: ResolvedSession, scope: Scope): RequestAccess {
  const request = state.requests.find((row) => row.requestId === requestId);
  if (request === undefined) return { kind: "refused" };
  const access = initiativeAccessOf(state, request.initiativeId, session, scope);
  return access.kind === "found" ? { kind: "found", request, initiative: access.initiative } : { kind: "refused" };
}
type LocatedMember = { readonly index: number; readonly member: InitiativeMemberRecord };
function memberOf(state: OutreachState, initiativeId: string, memberId: string): LocatedMember | undefined {
  const index = state.initiativeMembers.findIndex((row) => row.memberId === memberId && row.initiativeId === initiativeId);
  const member = index === -1 ? undefined : state.initiativeMembers[index];
  return member === undefined ? undefined : { index, member };
}
function recordTarget(revision: string, value: unknown): CurrentTarget {
  return { kind: "record", revision, value };
}
function initiativeTargetOf(documents: StoredDocuments, initiativeId: string, scope: Scope): CurrentTarget {
  const state = readState(documents);
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) return { kind: "absent" };
  return recordTarget(initiative.revision, initiative);
}
function requestTargetOf(documents: StoredDocuments, requestId: string, scope: Scope): CurrentTarget {
  const state = readState(documents);
  const request = state.requests.find((row) => row.requestId === requestId);
  if (request === undefined) return { kind: "absent" };
  const initiative = state.initiatives.find((row) => row.initiativeId === request.initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) return { kind: "absent" };
  return recordTarget(request.revision, request);
}
function memberTargetOf(documents: StoredDocuments, initiativeId: string, memberId: string, scope: Scope): CurrentTarget {
  const state = readState(documents);
  const initiative = state.initiatives.find((row) => row.initiativeId === initiativeId);
  if (initiative === undefined || initiative.ministryContextId !== scope.ministryId) return { kind: "absent" };
  const found = memberOf(state, initiativeId, memberId);
  return found === undefined ? { kind: "absent" } : recordTarget(found.member.revision, found.member);
}
const createInitiativePayloadSchema = z
  .strictObject({
    name: boundedTextSchema(200, { required: "Give the initiative a name.", tooLong: "Keep the name to 200 characters or fewer." }),
    purpose: boundedTextSchema(2000, { required: "Describe what this initiative is for.", tooLong: "Keep the purpose to 2,000 characters or fewer." }),
    // An opaque principal reference inside the acting scope: a name or an email address never establishes identity, so neither is accepted in its place. Omitted, it defaults to the caller.
    responsiblePrincipalId: z.string().trim().min(1, "Choose the person responsible for this initiative.").optional(),
    // The acting ministry travels in the mutation's scope, so a body never names a context the caller is not admitted to; the period is a pair of civil dates and carries no time of day or zone.
    period: z.strictObject({ startOn: civilDateSchema, endOn: civilDateSchema }).optional(),
  })
  .superRefine((value, context) => {
    if (value.period === undefined) return;
    if (Temporal.PlainDate.compare(value.period.endOn, value.period.startOn) < 0) context.addIssue({ code: "custom", path: ["period", "endOn"], message: "Choose an end date on or after the start date." });
  });
type CreateInitiativePayload = z.infer<typeof createInitiativePayloadSchema>;
/** Creates one finite piece of outreach in the ministry the caller is acting in. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function createInitiative(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<CreateInitiativePayload, MutationResult>(input, source, { schema: createInitiativePayloadSchema, name: "createInitiative", apply: applyCreateInitiative });
}
function applyCreateInitiative(context: MutationContext, payload: CreateInitiativePayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const { session } = context;
  const responsiblePrincipalId = payload.responsiblePrincipalId ?? session.principalId;
  if (responsiblePrincipalId !== session.principalId) {
    // Admission lets a colleague read a ministry's initiatives; it does not hand one over, and this release records no delegation that would.
    refuseField("responsiblePrincipalId", "Only the acting principal may be responsible for an initiative in this release, because it carries no delegation.");
  }
  const initiativeId = recordIdFor("initiative", context.operationId);
  const period = payload.period === undefined ? null : { from: serialiseCivilDate(payload.period.startOn), to: serialiseCivilDate(payload.period.endOn) };
  const initiative: InitiativeRecord = { initiativeId, name: payload.name, purpose: payload.purpose, ministryContextId: scope.ministryId, responsiblePrincipalId: session.principalId, period, state: "open", closureDisposition: null, revision: FIRST_REVISION };
  writeState(context.docs, state, { initiatives: [...state.initiatives, initiative] });
  return { changed: true, revision: FIRST_REVISION, result: { initiativeId }, created: [initiativeId] };
}
const addMembersPayloadSchema = z
  .strictObject({
    initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
    partnerIds: z
      .array(identifierFieldSchema("This selection is missing a partner; reopen the member picker and choose again."))
      .min(1, "Choose at least one partner to add.")
      .max(MAX_SELECTED_PARTNERS, `Add ${String(MAX_SELECTED_PARTNERS)} partners or fewer at a time.`),
  })
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.partnerIds.forEach((partnerId, index) => {
      if (seen.has(partnerId)) {
        // The path points at the repeated entry, so a picker marks that chip rather than the whole list.
        context.addIssue({ code: "custom", path: ["partnerIds", index], message: "Remove the duplicate partner from this selection." });
        return;
      }
      seen.add(partnerId);
    });
  });
type AddMembersPayload = z.infer<typeof addMembersPayloadSchema>;
/** Adds explicitly selected, eligible partners to an initiative's reviewed working list. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function addMembers(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<AddMembersPayload, MutationResult>(input, source, { schema: addMembersPayloadSchema, name: "addMembers", readCurrent: (documents, payload, scope) => initiativeTargetOf(documents, payload.initiativeId, scope), apply: applyAddMembers });
}
function applyAddMembers(context: MutationContext, payload: AddMembersPayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const { session } = context;
  const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const { initiative } = access;
  if (initiative.state === "closed") refuseField("initiativeId", "This initiative is closed, so its working list no longer takes new members.");
  const at = commandInstant(session).toString();
  const partners = new Map(state.partners.map((partner) => [partner.partnerId, partner] as const));
  const members = [...state.initiativeMembers];
  const items: PerItemResult[] = [];
  const created: string[] = [];
  const changedIds: string[] = [];
  let changed = false;
  for (const partnerId of payload.partnerIds) {
    const partner = partners.get(partnerId);
    if (partner === undefined || partner.audience !== "shared") {
      // A partner this roster does not carry, or the worker's own private preparation, is never approached: private preparation is a different record class from a shared relationship.
      items.push({ targetId: partnerId, state: "excluded", reasonCode: "not-eligible", reason: "This partner is not one this working list can include." });
      continue;
    }
    const index = members.findIndex((row) => row.initiativeId === initiative.initiativeId && row.partnerId === partnerId);
    const existing = index === -1 ? undefined : members[index];
    if (existing === undefined) {
      const memberId = `member-${initiative.initiativeId}-${partnerId}`;
      members.push({ memberId, initiativeId: initiative.initiativeId, partnerId, state: "included", stage: null, addedAt: at, returnedAt: null, history: [{ state: "included", at, byPrincipalId: session.principalId, reason: "Added from the reviewed working list." }], revision: FIRST_REVISION });
      created.push(memberId);
      items.push({ targetId: partnerId, state: "accepted", revision: FIRST_REVISION });
      changed = true;
      continue;
    }
    if (existing.state === "included") {
      items.push({ targetId: partnerId, state: "unchanged", revision: existing.revision, reasonCode: "already-included" });
      continue;
    }
    if (existing.state === "excluded") {
      items.push({ targetId: partnerId, state: "excluded", revision: existing.revision, reasonCode: "excluded-deliberately", reason: "This partner was excluded from this initiative deliberately, so a new selection does not include them." });
      continue;
    }
    const revision = nextRevision(existing.revision);
    members[index] = {
      ...existing,
      state: "included",
      // Selecting a removed partner again puts them back on the working list, so the field that names the instant a member was returned to it is stamped here too; the history keeps the whole account either way.
      returnedAt: at,
      history: [...existing.history, { state: "included", at, byPrincipalId: session.principalId, reason: "Added back to the reviewed working list." }],
      revision,
    };
    changedIds.push(existing.memberId);
    items.push({ targetId: partnerId, state: "accepted", revision });
    changed = true;
  }
  if (!changed) return { changed: false };
  const revision = nextRevision(initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === initiative.initiativeId ? { ...row, revision } : row)), initiativeMembers: members });
  return { changed: true, revision, result: { initiativeId: initiative.initiativeId, addedMemberIds: created, updatedMemberIds: changedIds }, created, changedIds, items };
}
const removeMemberPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
  memberId: identifierFieldSchema("This change is missing the working-list member it belongs to; reload the working list and try again."),
  // Leaving the key out is a valid removal; a blank reason is not silently treated as absent.
  reason: boundedTextSchema(500, { required: "Enter a reason or leave the reason empty.", tooLong: "Keep the reason to 500 characters or fewer." }).optional(),
});
type RemoveMemberPayload = z.infer<typeof removeMemberPayloadSchema>;
/** Removes one partner from an initiative's reviewed working list. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function removeMember(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<RemoveMemberPayload, MutationResult>(input, source, { schema: removeMemberPayloadSchema, name: "removeMember", readCurrent: (documents, payload, scope) => memberTargetOf(documents, payload.initiativeId, payload.memberId, scope), apply: applyRemoveMember });
}
function applyRemoveMember(context: MutationContext, payload: RemoveMemberPayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const { session } = context;
  const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const found = memberOf(state, payload.initiativeId, payload.memberId);
  if (found === undefined) refuseField("memberId", "This working-list member is not on this initiative.");
  const { index, member } = found;
  if (member.state === "removed") return { changed: false };
  if (member.state === "excluded") refuseField("memberId", "This partner was excluded from this initiative deliberately, so a removal is not recorded in place of that decision.");
  const at = commandInstant(session).toString();
  const revision = nextRevision(member.revision);
  const members = [...state.initiativeMembers];
  members[index] = {
    ...member,
    state: "removed",
    // `returnedAt` names the instant a removed member was returned to the working list, so a removal neither stamps nor clears it; the removal instant lives in the history.
    history: [...member.history, { state: "removed", at, byPrincipalId: session.principalId, reason: payload.reason ?? null }],
    revision,
  };
  const initiativeRevision = nextRevision(access.initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === access.initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), initiativeMembers: members });
  return { changed: true, revision, result: { initiativeId: access.initiative.initiativeId, memberId: member.memberId, state: "removed" }, changedIds: [member.memberId] };
}
const returnMemberPayloadSchema = z.strictObject({ initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."), memberId: identifierFieldSchema("This change is missing the working-list member it belongs to; reload the working list and try again.") });
type ReturnMemberPayload = z.infer<typeof returnMemberPayloadSchema>;
/** Returns one removed partner to an initiative's reviewed working list. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function returnMember(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<ReturnMemberPayload, MutationResult>(input, source, { schema: returnMemberPayloadSchema, name: "returnMember", readCurrent: (documents, payload, scope) => memberTargetOf(documents, payload.initiativeId, payload.memberId, scope), apply: applyReturnMember });
}
function applyReturnMember(context: MutationContext, payload: ReturnMemberPayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const { session } = context;
  const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const found = memberOf(state, payload.initiativeId, payload.memberId);
  if (found === undefined) refuseField("memberId", "This working-list member is not on this initiative.");
  const { index, member } = found;
  if (member.state === "included") return { changed: false };
  if (member.state === "excluded") refuseField("memberId", "This partner was excluded from this initiative deliberately, so returning them would include them without that decision changing.");
  const at = commandInstant(session).toString();
  const revision = nextRevision(member.revision);
  const members = [...state.initiativeMembers];
  members[index] = { ...member, state: "included", returnedAt: at, history: [...member.history, { state: "included", at, byPrincipalId: session.principalId, reason: "Returned to the reviewed working list." }], revision };
  const initiativeRevision = nextRevision(access.initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === access.initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), initiativeMembers: members });
  return { changed: true, revision, result: { initiativeId: access.initiative.initiativeId, memberId: member.memberId, state: "included" }, changedIds: [member.memberId] };
}
const setStagePayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
  memberId: identifierFieldSchema("This change is missing the working-list member it belongs to; reload the working list and try again."),
  stage: z.enum(INITIATIVE_STAGES, { error: "Choose a stage from the approved list, or clear the stage." }).nullable(),
});
type SetStagePayload = z.infer<typeof setStagePayloadSchema>;
/** Records one human assessment of where a working-list member stands. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function setStage(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<SetStagePayload, MutationResult>(input, source, { schema: setStagePayloadSchema, name: "setStage", readCurrent: (documents, payload, scope) => memberTargetOf(documents, payload.initiativeId, payload.memberId, scope), apply: applySetStage });
}
function applySetStage(context: MutationContext, payload: SetStagePayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const { session } = context;
  const access = initiativeAccessOf(state, payload.initiativeId, session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const found = memberOf(state, payload.initiativeId, payload.memberId);
  if (found === undefined) refuseField("memberId", "This working-list member is not on this initiative.");
  const { index, member } = found;
  if (member.state !== "included" && payload.stage !== null) refuseField("stage", "A stage is recorded against an included member; return this partner to the working list first.");
  if (member.stage === payload.stage) return { changed: false };
  const at = commandInstant(session).toString();
  const revision = nextRevision(member.revision);
  const members = [...state.initiativeMembers];
  members[index] = {
    ...member,
    stage: payload.stage,
    history: [
      ...member.history,
      {
        // An assessment is not a change of state, so the entry repeats the state the member already stands in and names the stage in the reason: the history is the only place this record keeps an account of what was assessed and when.
        state: member.state,
        at,
        byPrincipalId: session.principalId,
        reason: payload.stage === null ? "Stage cleared." : `Stage recorded as ${payload.stage}.`,
      },
    ],
    revision,
  };
  const initiativeRevision = nextRevision(access.initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === access.initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), initiativeMembers: members });
  return { changed: true, revision, result: { initiativeId: access.initiative.initiativeId, memberId: member.memberId, stage: payload.stage }, changedIds: [member.memberId] };
}
const RESPONSE_KIND_INPUT = [...REQUEST_RESPONSE_KINDS, "needs clarification"] as const;

type ResponseKindInput = (typeof RESPONSE_KIND_INPUT)[number];

const responseKindSchema: z.ZodType<RequestResponseKind> = z.enum(RESPONSE_KIND_INPUT, { error: "Choose how this Request was answered from the recorded responses." }).transform((kind: ResponseKindInput) => (kind === "needs clarification" ? "needs-clarification" : kind));
const requestedTermsSchema = z
  .strictObject({
    version: z.union([z.int({ error: "Record which terms version this ask carries." }).positive("Record which terms version this ask carries."), z.string().trim().min(1, "Record which terms version this ask carries.")]),
    currency: z.string().trim().min(1, "Choose the currency for the requested amount.").optional(),
    minorUnits: z.int({ error: "Enter the amount as a whole number of minor units." }).optional(),
    cadence: z.string().trim().min(1, "Enter the cadence or leave it empty.").optional(),
    term: z.string().trim().min(1, "Enter the term or leave it empty.").optional(),
    nonFinancial: z.strictObject({ description: boundedTextSchema(2000, { required: "Describe the non-financial ask.", tooLong: "Keep the description to 2,000 characters or fewer." }) }).optional(),
  })
  .superRefine((terms, context) => {
    const hasMoneyField = terms.currency !== undefined || terms.minorUnits !== undefined || terms.cadence !== undefined || terms.term !== undefined;
    if (terms.nonFinancial !== undefined) {
      if (hasMoneyField) context.addIssue({ code: "custom", path: ["nonFinancial"], message: "A non-financial ask carries no amount, currency, cadence or term." });
      return;
    }
    if (!hasMoneyField) {
      context.addIssue({ code: "custom", path: ["nonFinancial"], message: "Choose requested financial terms (currency and amount) or describe a non-financial ask." });
      return;
    }
    if (terms.currency === undefined) {
      context.addIssue({ code: "custom", path: ["currency"], message: "Choose the currency for the requested amount." });
    } else if (!isKnownCurrency(terms.currency)) {
      // An amount in a currency whose exponent this build does not hold cannot be stated exactly, and the one money rule forbids defaulting it to two decimals.
      context.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency whose minor unit this build knows, so the requested amount is exact." });
    }
    if (terms.minorUnits === undefined) {
      context.addIssue({ code: "custom", path: ["minorUnits"], message: "Enter the requested amount in minor units." });
    } else if (terms.minorUnits <= 0) {
      context.addIssue({ code: "custom", path: ["minorUnits"], message: "Enter an amount greater than zero; a non-financial ask carries no amount." });
    }
  });
type RequestedTermsPayload = z.infer<typeof requestedTermsSchema>;

function storedTermsOf(terms: RequestedTermsPayload): RequestTerms {
  const version = typeof terms.version === "number" ? `terms-v${String(terms.version)}` : terms.version;
  if (terms.nonFinancial !== undefined) return { version, money: null, nonFinancial: terms.nonFinancial.description };
  const { currency, minorUnits } = terms;
  if (currency === undefined || minorUnits === undefined) {
    // The terms schema requires both for a financial ask, so this is unreachable; refusing keeps the type honest and fails closed rather than writing an amount with no currency.
    refuseField("currency", "Choose the currency for the requested amount.");
  }
  const amount = moneySchema.parse({ currency, minorUnits });
  return { version, money: { amount, cadence: terms.cadence ?? null, term: terms.term ?? null }, nonFinancial: null };
}
export const draftRequestPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
  recipientPartnerId: identifierFieldSchema("Choose the person or organization this request is for."),
  // A separate opaque reference: an organization representative is its own record, so this is never derived from, compared with, or defaulted to the recipient.
  representedOrganizationId: identifierFieldSchema("Choose the organization this person represents, or leave it empty.").optional(),
  purpose: boundedTextSchema(2000, { required: "Describe the purpose of this request.", tooLong: "Keep the purpose to 2,000 characters or fewer." }),
  terms: requestedTermsSchema,
});
type DraftRequestPayload = z.infer<typeof draftRequestPayloadSchema>;
/** Drafts one independently answerable Request inside an initiative. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function draftRequest(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<DraftRequestPayload, MutationResult>(input, source, { schema: draftRequestPayloadSchema, name: "draftRequest", apply: applyDraftRequest });
}
function applyDraftRequest(context: MutationContext, payload: DraftRequestPayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const { initiative } = access;
  if (initiative.state === "closed") refuseField("initiativeId", "This initiative is closed, so no new Request may be drafted.");
  const partners = new Map(state.partners.map((partner) => [partner.partnerId, partner] as const));
  const recipient = partners.get(payload.recipientPartnerId);
  if (recipient === undefined || recipient.audience !== "shared") refuseField("recipientPartnerId", "This Request names a recipient the roster does not carry.");
  if (payload.representedOrganizationId !== undefined) {
    const organization = partners.get(payload.representedOrganizationId);
    if (organization === undefined || organization.audience !== "shared") refuseField("representedOrganizationId", "This Request names an organization the roster does not carry.");
  }
  const terms = storedTermsOf(payload.terms);
  const requestId = recordIdFor("request", context.operationId);
  const request: RequestRecord = {
    requestId,
    initiativeId: initiative.initiativeId,
    recipientPartnerId: payload.recipientPartnerId,
    representedOrganizationId: payload.representedOrganizationId ?? null,
    purpose: payload.purpose,
    terms,
    presentation: null,
    response: null,
    // Work a Response later suggests is recorded by the task family, never inferred into the ask.
    nextWorkIds: [],
    revision: FIRST_REVISION,
  };
  const initiativeRevision = nextRevision(initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), requests: [...state.requests, request] });
  return { changed: true, revision: FIRST_REVISION, result: { requestId, initiativeId: initiative.initiativeId, termsVersion: terms.version }, created: [requestId] };
}
export const presentRequestPayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again.").optional(),
  requestId: identifierFieldSchema("This change is missing the request it belongs to; reopen the request and try again."),
  presentedOn: civilDateSchema,
  manner: boundedTextSchema(200, { required: "Describe how the request was presented.", tooLong: "Keep the description to 200 characters or fewer." }),
  versionRef: identifierFieldSchema("Record which terms version was presented."),
});
type PresentRequestPayload = z.infer<typeof presentRequestPayloadSchema>;
/** Records the actual presentation of a named terms version. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function presentRequest(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<PresentRequestPayload, MutationResult>(input, source, { schema: presentRequestPayloadSchema, name: "presentRequest", readCurrent: (documents, payload, scope) => requestTargetOf(documents, payload.requestId, scope), apply: applyPresentRequest });
}
function applyPresentRequest(context: MutationContext, payload: PresentRequestPayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const access = requestAccessOf(state, payload.requestId, context.session, scope);
  if (access.kind === "refused") return refuseDenied(context.operationId);
  return presentRequestFor(context.docs, state, access, payload);
}
function presentRequestFor(documents: StoredDocuments, state: OutreachState, access: Extract<RequestAccess, { kind: "found" }>, payload: PresentRequestPayload): ApplyResult<MutationResult> {
  const { request, initiative } = access;
  if (payload.initiativeId !== undefined && payload.initiativeId !== request.initiativeId) refuseField("initiativeId", "This Request belongs to a different initiative.");
  if (initiative.state === "closed") {
    // Closure fences new solicitation, and presenting is the moment an ask reaches a person. An answer to an ask already presented stays recordable — `recordRequestResponse` does not consult closure, because closing fences asking rather than the respondent's own reply.
    refuseField("initiativeId", "This initiative is closed, so no new solicitation may be presented.");
  }
  const presentation: RequestPresentation = { presentedOn: serialiseCivilDate(payload.presentedOn), manner: payload.manner, versionRef: payload.versionRef };
  const existing = request.presentation;
  if (existing !== null) {
    if (existing.presentedOn === presentation.presentedOn && existing.manner === presentation.manner && existing.versionRef === presentation.versionRef) return { changed: false };
    refuseField("versionRef", `This Request already records the presentation of ${existing.versionRef} on ${existing.presentedOn}, and a recorded presentation is never overwritten.`);
  }
  const revision = nextRevision(request.revision);
  const initiativeRevision = nextRevision(initiative.revision);
  writeState(documents, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), requests: state.requests.map((row) => (row.requestId === request.requestId ? { ...row, presentation, revision } : row)) });
  return { changed: true, revision, result: { requestId: request.requestId, versionRef: presentation.versionRef }, changedIds: [request.requestId] };
}
const responseFactsSchema = z.strictObject({ kind: responseKindSchema, respondentId: identifierFieldSchema("Name the person who gave this answer."), standingEvidence: z.string().trim().nullable(), termsVersionRef: identifierFieldSchema("Record which terms version this answer responds to.") });
type ResponseFactsPayload = z.infer<typeof responseFactsSchema>;

function normaliseResponsePayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const fields: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if ("response" in fields) return fields;
  const { kind, respondentId, standingEvidence, termsVersionRef, ...rest } = fields;
  if (kind === undefined && respondentId === undefined && termsVersionRef === undefined) return fields;
  return { ...rest, response: { kind, respondentId, standingEvidence: standingEvidence ?? null, termsVersionRef } };
}
/** The `recordRequestResponse` payload: the Request and the named respondent's answer, in the nested shape or the flat one this normalises into it. */
export const recordRequestResponsePayloadSchema = z.preprocess(
  normaliseResponsePayload,
  z.strictObject({ initiativeId: identifierFieldSchema("This answer is missing the initiative it belongs to; reopen the initiative and try again.").optional(), requestId: identifierFieldSchema("This answer is missing the request it belongs to; reopen the request and try again."), response: responseFactsSchema }),
);
type RecordRequestResponsePayload = z.infer<typeof recordRequestResponsePayloadSchema>;
/** Records the named respondent's own answer to one Request, bound to the terms version it answers. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function recordRequestResponse(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<RecordRequestResponsePayload, MutationResult>(input, source, { schema: recordRequestResponsePayloadSchema, name: "recordRequestResponse", readCurrent: (documents, payload, scope) => requestTargetOf(documents, payload.requestId, scope), apply: applyRecordRequestResponse });
}
function applyRecordRequestResponse(context: MutationContext, payload: RecordRequestResponsePayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const access = requestAccessOf(state, payload.requestId, context.session, scope);
  if (access.kind === "refused") return refuseDenied(context.operationId);
  const { request, initiative } = access;
  if (payload.initiativeId !== undefined && payload.initiativeId !== request.initiativeId) refuseField("initiativeId", "This Request belongs to a different initiative.");
  const presentation = request.presentation;
  if (presentation === null) refuseField("response.termsVersionRef", "No terms version has been presented for this Request, so there is nothing to answer yet.");
  const facts: ResponseFactsPayload = payload.response;
  if (presentation.versionRef !== facts.termsVersionRef) refuseField("response.termsVersionRef", "Answer the terms version that was presented; reload the request and try again.");
  const recorded: RequestResponse = { kind: facts.kind, respondentId: facts.respondentId, standingEvidence: facts.standingEvidence, termsVersionRef: facts.termsVersionRef, recordedAt: commandInstant(context.session).toString() };
  const existing = request.response;
  if (existing !== null && existing.kind === recorded.kind && existing.respondentId === recorded.respondentId && existing.standingEvidence === recorded.standingEvidence && existing.termsVersionRef === recorded.termsVersionRef) return { changed: false };
  const revision = nextRevision(request.revision);
  const initiativeRevision = nextRevision(initiative.revision);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === initiative.initiativeId ? { ...row, revision: initiativeRevision } : row)), requests: state.requests.map((row) => (row.requestId === request.requestId ? { ...row, response: recorded, revision } : row)) });
  return { changed: true, revision, result: { requestId: request.requestId, kind: recorded.kind, termsVersionRef: recorded.termsVersionRef }, changedIds: [request.requestId] };
}
const initiativeHandoffSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("eligible-handoff"), toPrincipalId: identifierFieldSchema("Name the person who takes over the unfinished work."), note: boundedTextSchema(500, { required: "Describe what is being handed over.", tooLong: "Keep the note to 500 characters or fewer." }) }),
  z.strictObject({ kind: z.literal("none"), reason: boundedTextSchema(500, { required: "Say why no handoff is needed.", tooLong: "Keep the reason to 500 characters or fewer." }) }),
]);
export const closeInitiativePayloadSchema = z
  .strictObject({
    initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
    disposition: boundedTextSchema(200, { required: "Choose how this initiative is closing, or name who takes over the unfinished work.", tooLong: "Keep the disposition to 200 characters or fewer." }).optional(),
    handoff: initiativeHandoffSchema,
  })
  .superRefine((payload, context) => {
    if (payload.disposition === undefined && payload.handoff.kind !== "eligible-handoff") context.addIssue({ code: "custom", path: ["disposition"], message: "Say how this initiative closes: choose a disposition, or name who takes over the unfinished work." });
  });
type CloseInitiativePayload = z.infer<typeof closeInitiativePayloadSchema>;

function closureDispositionOf(payload: CloseInitiativePayload): string {
  const handoff = payload.handoff;
  const handoffText = handoff.kind === "eligible-handoff" ? `Handed off to ${handoff.toPrincipalId}: ${handoff.note}` : `No handoff needed: ${handoff.reason}`;
  return payload.disposition === undefined ? handoffText : `${payload.disposition} — ${handoffText}`;
}
/** Closes an initiative's solicitation, recording how its unfinished work is dealt with. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function closeInitiative(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<CloseInitiativePayload, MutationResult>(input, source, { schema: closeInitiativePayloadSchema, name: "closeInitiative", readCurrent: (documents, payload, scope) => initiativeTargetOf(documents, payload.initiativeId, scope), apply: applyCloseInitiative });
}
function applyCloseInitiative(context: MutationContext, payload: CloseInitiativePayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const { initiative } = access;
  if (initiative.state === "closed") return { changed: false };
  const items: PerItemResult[] = [
    ...state.tasks
      .filter((task) => task.initiativeId === initiative.initiativeId && (task.status === "open" || task.status === "reopened"))
      .map((task) => ({ targetId: task.taskId, state: "still-open", reasonCode: "independent-obligation", reason: "Closing the initiative does not complete this work, which stays open for whoever owns it." })),
    ...state.requests
      .filter((request) => request.initiativeId === initiative.initiativeId && request.presentation !== null && request.response === null)
      .map((request) => ({ targetId: request.requestId, state: "awaiting-response", reasonCode: "independent-obligation", reason: "This Request was presented and has no recorded answer yet." })),
  ];
  const revision = nextRevision(initiative.revision);
  const closureDisposition = closureDispositionOf(payload);
  writeState(context.docs, state, { initiatives: state.initiatives.map((row) => (row.initiativeId === initiative.initiativeId ? { ...row, state: "closed", closureDisposition, revision } : row)) });
  return { changed: true, revision, result: { initiativeId: initiative.initiativeId, state: "closed", closureDisposition, openWorkCount: items.length }, changedIds: [initiative.initiativeId], items };
}
/** The `reopenInitiative` payload: the initiative and an optional reason, which travels back in the result rather than being stored. */
export const reopenInitiativePayloadSchema = z.strictObject({
  initiativeId: identifierFieldSchema("This change is missing the initiative it belongs to; reopen the initiative and try again."),
  reason: boundedTextSchema(500, { required: "Enter a reason or leave the reason empty.", tooLong: "Keep the reason to 500 characters or fewer." }).optional(),
});
type ReopenInitiativePayload = z.infer<typeof reopenInitiativePayloadSchema>;
/** Reopens a closed initiative for further solicitation. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function reopenInitiative(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<ReopenInitiativePayload, MutationResult>(input, source, { schema: reopenInitiativePayloadSchema, name: "reopenInitiative", readCurrent: (documents, payload, scope) => initiativeTargetOf(documents, payload.initiativeId, scope), apply: applyReopenInitiative });
}
function applyReopenInitiative(context: MutationContext, payload: ReopenInitiativePayload, scope: Scope): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const access = initiativeAccessOf(state, payload.initiativeId, context.session, scope);
  if (access.kind !== "found") return refuseDenied(context.operationId);
  const { initiative } = access;
  if (initiative.state === "open") return { changed: false };
  const revision = nextRevision(initiative.revision);
  writeState(context.docs, state, {
    initiatives: state.initiatives.map((row) =>
      row.initiativeId === initiative.initiativeId
        ? // `closureDisposition` is deliberately preserved: it is the record of the earlier close,
          // and the lifecycle a read reports is derived from it.
          { ...row, state: "open", revision }
        : row,
    ),
  });
  return {
    changed: true,
    revision,
    // The record keeps no reopen note, so the stated reason travels back in the result rather than being validated and dropped.
    result: { initiativeId: initiative.initiativeId, state: "open", reason: payload.reason ?? null },
    changedIds: [initiative.initiativeId],
  };
}
const recordIntroductionPayloadSchema = z
  .strictObject({
    partnerId: identifierFieldSchema("Choose the person this introduction refers to."),
    originalIntroductionOn: civilDateSchema.nullable().optional(),
    datePrecision: z.enum(DATE_PRECISIONS, { error: "Record how precisely the introduction date is known." }),
    sourceZone: identifierFieldSchema("State the time zone the introduction date is known in."),
    sourceReference: sourceReferenceFieldSchema,
  })
  .superRefine((payload, context) => {
    if (payload.datePrecision === "unknown") {
      if (payload.originalIntroductionOn !== null && payload.originalIntroductionOn !== undefined) context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: "An unknown introduction date states no date at all, rather than a guessed one a later reader would treat as evidence." });
      return;
    }
    if (payload.originalIntroductionOn === null || payload.originalIntroductionOn === undefined) {
      context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: "State the date the introduction actually happened on." });
      return;
    }
    if (payload.datePrecision !== "date") return;
    // The window's arithmetic and the zone's DST rule are the boundary module's; asking it here is how a written introduction is refused before anything is stored, when its zone cannot be resolved.
    const window = newWindowEnd({ originalIntroductionOn: payload.originalIntroductionOn, datePrecision: payload.datePrecision, sourceZone: payload.sourceZone, days: REFERRAL_NEW_WINDOW_DAYS });
    if (window.status === "refused") {
      context.addIssue({ code: "custom", path: ["sourceZone"], message: window.reason === "invalid-zone" ? "Choose a time zone this build can resolve, so the window can be stated exactly." : "This introduction date cannot be given a window; check the date and try again." });
    }
  });
type RecordIntroductionPayload = z.infer<typeof recordIntroductionPayloadSchema>;
/** Records the original introduction date of one referral cycle, with the precision it is known to. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function recordIntroduction(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<RecordIntroductionPayload, MutationResult>(input, source, { schema: recordIntroductionPayloadSchema, name: "recordIntroduction", apply: applyRecordIntroduction });
}
function applyRecordIntroduction(context: MutationContext, payload: RecordIntroductionPayload): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const partner = state.partners.find((row) => row.partnerId === payload.partnerId);
  if (partner === undefined || partner.audience !== "shared") refuseField("partnerId", "This introduction names a partner the roster does not carry.");
  const sourceReference: SourceReference = { system: payload.sourceReference.system, reference: payload.sourceReference.reference };
  const recorded = state.referrals.some((cycle) => cycle.partnerId === payload.partnerId && cycle.sourceReference !== null && sameSourceReference(cycle.sourceReference, sourceReference));
  if (recorded) return { changed: false };
  const introductionOn = payload.originalIntroductionOn ?? null;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  if (payload.datePrecision === "date" && introductionOn !== null) {
    const dayStart = startOfCivilDay(introductionOn, payload.sourceZone);
    if (dayStart.status === "refused") refuseField("sourceZone", "Choose a time zone this build can resolve.");
    const window = newWindowEnd({ originalIntroductionOn: introductionOn, datePrecision: payload.datePrecision, sourceZone: payload.sourceZone, days: REFERRAL_NEW_WINDOW_DAYS });
    if (window.status !== "bounded") refuseField("originalIntroductionOn", "This introduction date cannot be given a window.");
    windowStart = dayStart.instant.toString();
    windowEnd = window.resolvedEndInstant.toString();
  }
  const referralId = recordIdFor("referral", context.operationId);
  const originalIntroductionOn = introductionOn === null ? null : serialiseCivilDate(introductionOn);
  const cycle: ReferralCycleRecord = { referralId, partnerId: payload.partnerId, originalIntroductionOn, datePrecision: payload.datePrecision, sourceZone: payload.sourceZone, sourceReference, cycleIndex: 0, windowKind: "new", windowStart, windowEnd, consumed: false, predecessorId: null, revision: FIRST_REVISION };
  writeState(context.docs, state, { referrals: [...state.referrals, cycle] });
  return { changed: true, revision: FIRST_REVISION, result: { referralId, partnerId: payload.partnerId, datePrecision: payload.datePrecision, windowEnd }, created: [referralId] };
}
const continueReferralPayloadSchema = z.strictObject({ referralId: identifierFieldSchema("This change is missing the referral it belongs to; reload the referral and try again.") });
type ContinueReferralPayload = z.infer<typeof continueReferralPayloadSchema>;

function continuationOfferedFor(session: ResolvedSession): boolean {
  return isScenarioId(session.scenarioId) && scenarioFlagsFor(session.scenarioId).continuationSetting === "on";
}
function continuationAuthority(session: ResolvedSession, input: MutationInput<unknown>): ScopeDecision {
  const admitted = assertScope(session, input.scope);
  if (!admitted.ok) return admitted;
  // Worker continuation is off by default, so withholding it is a capability this session does not hold rather than a fault in the request.
  return continuationOfferedFor(session) ? { ok: true } : { ok: false, denial: denied({ operationId: input.operationId, reasonCode: "capability-absent" }) };
}
function referralTargetOf(documents: StoredDocuments, referralId: string): CurrentTarget {
  const state = readState(documents);
  const cycle = state.referrals.find((row) => row.referralId === referralId);
  return cycle === undefined ? { kind: "absent" } : recordTarget(cycle.revision, cycle);
}
/** Continues one ordinarily expired referral cycle, producing at most one successor. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function continueReferral(input: MutationInput<unknown>, source?: SessionSource): Promise<MutationOutcome> {
  return runOutreachMutation<ContinueReferralPayload, MutationResult>(input, source, {
    schema: continueReferralPayloadSchema,
    name: "continueReferral",
    authorize: (session) => continuationAuthority(session, input),
    readCurrent: (documents, payload) => referralTargetOf(documents, payload.referralId),
    apply: applyContinueReferral,
  });
}
function applyContinueReferral(context: MutationContext, payload: ContinueReferralPayload): ApplyResult<MutationResult> {
  const state = readState(context.docs);
  const cycle = state.referrals.find((row) => row.referralId === payload.referralId);
  if (cycle === undefined) refuseField("referralId", "This referral is not one this session holds.");
  if (cycle.windowKind !== "new") refuseField("referralId", "This cycle is itself a continuation, and an introduction carries at most one continuation.");
  const successorId = `${cycle.referralId}-continued`;
  // The cycle's existing successor, if any, is what the window module judges the cycle by: the one-successor guard belongs to the engine rather than to a check repeated here.
  const existingSuccessor = state.referrals.find((row) => row.predecessorId === cycle.referralId);
  if (cycle.datePrecision !== "date") refuseField("referralId", "The introduction date is not precise enough to have had a window, so there is nothing to continue.");
  if (cycle.windowEnd === null) refuseField("referralId", "This referral states no window endpoint, so there is nothing to continue.");
  const windowEnd = readInstant(cycle.windowEnd);
  if (windowEnd === undefined) refuseField("referralId", "The window this referral carries could not be evaluated, so no continuation is offered.");
  const now = commandInstant(context.session);
  const status = referralWindowState({ windowEnd, now });
  switch (status.status) {
    case "active":
      refuseField("referralId", "This referral's window has not ended, so there is nothing to continue.");
    case "no-deadline":
      refuseField("referralId", "The introduction date is not precise enough to have had a window, so there is nothing to continue.");
    case "refused":
      refuseField("referralId", "The window this referral carries could not be evaluated, so no continuation is offered.");
    case "expired":
      break;
  }
  const continued = continuedWindowEnd({ acceptedAt: now, days: REFERRAL_CONTINUATION_DAYS, cycle: { consumed: cycle.consumed, predecessorId: cycle.predecessorId ?? undefined, successorId: existingSuccessor?.referralId } });
  if (continued.status === "refused") {
    if (continued.reason === "already-consumed") {
      // A cycle that already carries a successor produces no second one, and nothing is written: the answer is `unchanged` at the revision the caller now sees.
      return { changed: false };
    }
    refuseField("referralId", "This continuation cannot be bounded from the instant it would be accepted.");
  }
  if (state.referrals.some((row) => row.referralId === successorId)) {
    // The engine's own `already-consumed` refusal above is the active guard against a second cycle for one introduction; this identity check, derived from the predecessor, is the last defence behind it for a cycle stored without the flag.
    return { changed: false };
  }
  const consumedRevision = nextRevision(cycle.revision);
  const successor: ReferralCycleRecord = {
    referralId: successorId,
    partnerId: cycle.partnerId,
    originalIntroductionOn: cycle.originalIntroductionOn,
    datePrecision: cycle.datePrecision,
    sourceZone: cycle.sourceZone,
    sourceReference: cycle.sourceReference,
    cycleIndex: cycle.cycleIndex + 1,
    windowKind: "continued",
    windowStart: now.toString(),
    windowEnd: continued.endInstant.toString(),
    consumed: false,
    predecessorId: cycle.referralId,
    revision: FIRST_REVISION,
  };
  writeState(context.docs, state, { referrals: [...state.referrals.map((row) => (row.referralId === cycle.referralId ? { ...row, consumed: true, revision: consumedRevision } : row)), successor] });
  return { changed: true, revision: consumedRevision, result: { referralId: cycle.referralId, successorId, windowEnd: successor.windowEnd, elapsedSeconds: continued.elapsedSeconds }, created: [successorId], changedIds: [cycle.referralId] };
}
