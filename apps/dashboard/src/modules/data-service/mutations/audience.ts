import { Temporal } from "temporal-polyfill";
import { ZodError, z } from "zod";
import { unsubscribe as recordOffChoice } from "@/modules/audience/consent";
import { MEMBER_CHOICES, UPDATE_EMAIL_PURPOSE, confirmAt, newPendingMembership, withChoice, withLanguagePreference, type MembershipRecord as DomainMembership, type AudiencePurpose, type ConfirmationRefusalReason, type MemberChoice, type MembershipScope, type MembershipState } from "@/modules/audience/membership";
import { instantAt } from "@/modules/time/clock";
import { confirmationDeadline } from "@/modules/time/window";
import { audienceRecordsSessionIdOf, canEdit, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import { membershipRecordSchema, type MembershipRecord as StoredMembership, type MutationInput } from "../envelope";
import { denied, type MutationOutcome, type MutationResult } from "../outcome";
import { openMutation, runMutation, type ApplyResult, type CurrentTarget, type MutationContext, type MutationName } from "../operations";
type StateDocumentHolder = { state: unknown };
const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";
class UnreadableStateDocumentError extends Error {
  constructor(part: string) {
    super(`The session's state document cannot be read: ${part}. Nothing was written.`);
    this.name = CORRUPT_DOCUMENT_FAULT;
    Object.setPrototypeOf(this, UnreadableStateDocumentError.prototype);
  }
}
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function membershipsOf(holder: StateDocumentHolder): StoredMembership[] {
  const state: unknown = holder.state;
  if (!isPlainObject(state)) throw new UnreadableStateDocumentError("it is not an object");
  const parsed = z.array(membershipRecordSchema).safeParse(state.memberships);
  if (!parsed.success) throw new UnreadableStateDocumentError("it holds no readable membership rows");
  return [...parsed.data];
}
function withMemberships(holder: StateDocumentHolder, memberships: readonly StoredMembership[]): void {
  const state: unknown = holder.state;
  if (!isPlainObject(state)) throw new UnreadableStateDocumentError("it is not an object");
  holder.state = { ...state, memberships };
}
const replacingMembership = (memberships: readonly StoredMembership[], next: StoredMembership): readonly StoredMembership[] => memberships.map((row) => (row.membershipId === next.membershipId ? next : row));
function instantOf(value: string | null): Temporal.Instant | undefined {
  if (value === null || value.length === 0) return undefined;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}
function revisionOrdinal(revision: string): number {
  const digits = /([0-9]+)$/u.exec(revision);
  if (digits === null) return 1;
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
const revisionTokenOf = (ordinal: number): string => `rev-${String(ordinal)}`;
function domainMembershipOf(record: StoredMembership, scope: MembershipScope): DomainMembership {
  const acceptedAt = instantOf(record.acceptedAt);
  const confirmation = instantOf(record.confirmationDeadline);
  const choice: MemberChoice = record.state === "off" || record.state === "restricted" ? "off" : "immediate";
  return {
    membershipId: record.membershipId,
    scope,
    publisherId: record.publisherId,
    purpose: record.purpose,
    recipientId: record.membershipId,
    email: record.email,
    state: record.state,
    choice,
    languagePreference: record.languagePreference ?? "",
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(acceptedAt !== undefined && record.state === "active" ? { confirmedAt: acceptedAt } : {}),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
    revision: revisionOrdinal(record.revision),
  };
}
const storedAcceptanceOf = (previous: StoredMembership, next: DomainMembership): string | null =>
  next.state === "awaiting-proof" ? (next.acceptedAt === undefined ? null : next.acceptedAt.toString()) : next.confirmedAt !== undefined ? next.confirmedAt.toString() : next.state === "active" ? (next.acceptedAt?.toString() ?? previous.acceptedAt) : null;
function storedMembershipFrom(previous: StoredMembership, next: DomainMembership): StoredMembership {
  const acceptedAt = storedAcceptanceOf(previous, next);
  const confirmationDeadline = acceptedAt === null ? null : next.confirmationDeadline === undefined ? previous.confirmationDeadline : next.confirmationDeadline.toString();
  const languagePreference = next.languagePreference.length === 0 ? previous.languagePreference : next.languagePreference;
  return { membershipId: previous.membershipId, email: previous.email, displayName: previous.displayName, publisherId: previous.publisherId, purpose: previous.purpose, state: next.state, acceptedAt, confirmationDeadline, languagePreference, revision: revisionTokenOf(next.revision) };
}
function newStoredMembership(membership: DomainMembership, displayName: string | null): StoredMembership {
  const confirmationDeadline = membership.confirmationDeadline === undefined ? null : membership.confirmationDeadline.toString();
  const languagePreference = membership.languagePreference.length === 0 ? null : membership.languagePreference;
  const acceptedAt = membership.acceptedAt === undefined ? null : membership.acceptedAt.toString();
  return { membershipId: membership.membershipId, email: membership.email, displayName, publisherId: membership.publisherId, purpose: membership.purpose, state: membership.state, acceptedAt, confirmationDeadline, languagePreference, revision: revisionTokenOf(membership.revision) };
}
type MembershipStanding = { readonly membershipId: string; readonly publisherId: string; readonly purpose: AudiencePurpose; readonly state: MembershipState; readonly acceptedAt: string | null; readonly confirmationDeadline: string | null; readonly languagePreference: string | null; readonly revision: string };
function standingOf(record: StoredMembership): MembershipStanding {
  return { membershipId: record.membershipId, publisherId: record.publisherId, purpose: record.purpose, state: record.state, acceptedAt: record.acceptedAt, confirmationDeadline: record.confirmationDeadline, languagePreference: record.languagePreference, revision: record.revision };
}
function currentTargetOf(holder: StateDocumentHolder, locate: (memberships: readonly StoredMembership[]) => StoredMembership | undefined): CurrentTarget {
  const record = locate(membershipsOf(holder));
  return record === undefined ? { kind: "absent" } : { kind: "record", revision: record.revision, value: standingOf(record) };
}
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const purposeSchema = z.literal(UPDATE_EMAIL_PURPOSE, `This release keeps memberships for one purpose only (${UPDATE_EMAIL_PURPOSE}); another purpose would need its own consent.`);
const choiceSchema = z.enum(MEMBER_CHOICES, `The audience offers Off and Immediate only; ${MEMBER_CHOICES.join(" and ")} are the two choices.`);
const publisherIdSchema = z.string().min(1, "A membership names the publisher whose Update email it is for.").max(200, "A publisher reference is at most 200 characters.");
const emailSchema = z.email("This is not a complete email address. The address is stored as a value on the membership and is never used to find, merge or link a record.");
const displayNameSchema = z.string().min(1, "A display name is at least one character, or left out.").max(120, "A display name is at most 120 characters.");
const languagePreferenceSchema = z.string().regex(LANGUAGE_TAG_SHAPE, "A language preference is a BCP-47 tag such as en, fr-CA or ar.").max(35, "A language tag is at most 35 characters.");
const membershipIdSchema = z.string().min(1, "This request names the membership it addresses.").max(200, "A membership identifier is at most 200 characters.");
const signupPayloadSchema = z.strictObject({ publisherId: publisherIdSchema, purpose: purposeSchema, email: emailSchema, displayName: displayNameSchema.optional(), languagePreference: languagePreferenceSchema.optional() });
const confirmPayloadSchema = z.strictObject({ membershipId: membershipIdSchema });
const preferencePayloadSchema = z.strictObject({ membershipId: membershipIdSchema, choice: choiceSchema, languagePreference: languagePreferenceSchema.optional() });
const unsubscribePayloadSchema = z.strictObject({ publisherId: publisherIdSchema, purpose: purposeSchema });
type SignupPayload = z.infer<typeof signupPayloadSchema>;
type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;
type PreferencePayload = z.infer<typeof preferencePayloadSchema>;
type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;
const AUTHORITY_QUESTION_ID = "authority-question";
const addressedByCaller = (session: ResolvedSession, membershipId: string | undefined): ScopeDecision => (membershipId === undefined || membershipId !== session.principalId ? { ok: false, denial: denied({ operationId: AUTHORITY_QUESTION_ID, reasonCode: "no-permission" }) } : { ok: true });
function claimedMembershipId(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  const payload: unknown = Reflect.get(input, "payload");
  if (!isPlainObject(payload)) return undefined;
  const candidate: unknown = Reflect.get(payload, "membershipId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
const membershipScopeOf = (scope: MutationInput<unknown>["scope"]): MembershipScope => ({ organizationId: scope.organizationId, ministryId: scope.ministryId });
const membershipTargetOf = (documents: StateDocumentHolder, membershipId: string | undefined): CurrentTarget => currentTargetOf(documents, (rows) => rows.find((row) => row.membershipId === membershipId));
type SignupResult = {
  readonly membershipId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly state: MembershipState;
  readonly revision: string;
  readonly confirmationDeadline: string | null;
  readonly proof: { readonly status: "pending"; readonly claimsMailSent: false; readonly nextStep: "confirm-from-the-rendered-message" };
};
type ConfirmResult = { readonly membershipId: string; readonly state: MembershipState; readonly confirmedAt: string | null; readonly revision: string };
type PreferenceResult = { readonly membershipId: string; readonly state: MembershipState; readonly choice: MemberChoice; readonly languagePreference: string | null; readonly revision: string; readonly changed: { readonly choice: boolean; readonly languagePreference: boolean } };
type UnsubscribeResult = { readonly membershipId: string; readonly publisherId: string; readonly purpose: AudiencePurpose; readonly state: MembershipState; readonly choice: MemberChoice; readonly revision: string; readonly claimsRecall: false };
const refusedConfirmation = (reason: ConfirmationRefusalReason, message: string): ZodError => new ZodError([{ code: "custom", path: ["membershipId"], message: `${reason}: ${message}` }]);
function refuseConfirmation(record: StoredMembership, reason: ConfirmationRefusalReason, at: Temporal.Instant): never {
  switch (reason) {
    case "confirmation-expired": {
      const acceptedAt = instantOf(record.acceptedAt);
      const closedAt = acceptedAt === undefined ? undefined : confirmationDeadline({ acceptedAt, now: at }).deadlineInstant;
      throw refusedConfirmation(
        reason,
        closedAt === undefined
          ? "This membership records no acceptance, so there is no window for a confirmation to fall inside."
          : `The confirmation window ended at ${closedAt.toString()}, so a confirmation at that instant or later is refused. The window is fixed by the acceptance already recorded: a reload, a retry and a message sent again never extend it.`,
      );
    }
    case "not-awaiting-proof":
      throw refusedConfirmation(
        reason,
        record.state === "active"
          ? "This membership is already active, so there is nothing for a confirmation to prove."
          : `This membership is ${record.state}, so it is not waiting for proof. Only a membership in the proof step can be confirmed: an off or restricted membership is never turned on by a confirmation, and choosing Immediate is the person's own act.`,
      );
    case "source-excluded":
      throw refusedConfirmation(reason, "This row was supplied by a source system and is excluded, so no confirmation activates it.");
  }
}
function applySignup(context: MutationContext, payload: SignupPayload, scope: MembershipScope): ApplyResult<SignupResult> {
  const at = instantAt(context.session.clockOffsetMs);
  const memberships = membershipsOf(context.docs);
  const identity = context.session.principalId;
  if (memberships.find((row) => row.publisherId === payload.publisherId && row.purpose === payload.purpose && row.membershipId === identity) !== undefined) return { changed: false };
  const { membership, proof } = newPendingMembership({ membershipId: identity, scope, publisherId: payload.publisherId, purpose: payload.purpose, recipientId: identity, email: payload.email, languagePreference: payload.languagePreference ?? "" }, at);
  const stored = newStoredMembership(membership, payload.displayName ?? null);
  withMemberships(context.docs, [...memberships, stored]);
  const result = { membershipId: stored.membershipId, publisherId: stored.publisherId, purpose: stored.purpose, state: stored.state, revision: stored.revision, confirmationDeadline: stored.confirmationDeadline, proof: { status: proof.status, claimsMailSent: proof.claimsMailSent, nextStep: proof.nextStep } };
  return { changed: true, revision: stored.revision, created: [stored.membershipId], result };
}
type WritableMembership = { readonly memberships: readonly StoredMembership[]; readonly record: StoredMembership; readonly domain: DomainMembership; readonly at: Temporal.Instant };
/** The one membership a request names, read into its domain shape, when the caller may edit it; `undefined` is answered as "nothing to change". */ function writableMembership(context: MutationContext, scope: MembershipScope, membershipId: string): WritableMembership | undefined {
  const memberships = membershipsOf(context.docs);
  const record = memberships.find((row) => row.membershipId === membershipId);
  const domain = record === undefined ? undefined : domainMembershipOf(record, scope);
  return record === undefined || domain === undefined || !canEdit(context.session, { kind: "membership", record: domain }).allowed ? undefined : { memberships, record, domain, at: instantAt(context.session.clockOffsetMs) };
}
function applyConfirmation(context: MutationContext, payload: ConfirmPayload, scope: MembershipScope): ApplyResult<ConfirmResult> {
  const found = writableMembership(context, scope, payload.membershipId);
  if (found === undefined) return { changed: false };
  const confirmed = confirmAt(found.domain, found.at);
  if (confirmed.status === "refused") return confirmed.reason === "not-awaiting-proof" && found.record.state === "active" ? { changed: false } : refuseConfirmation(found.record, confirmed.reason, found.at);
  const stored = storedMembershipFrom(found.record, confirmed.membership);
  withMemberships(context.docs, replacingMembership(found.memberships, stored));
  return { changed: true, revision: stored.revision, changedIds: [stored.membershipId], result: { membershipId: stored.membershipId, state: stored.state, confirmedAt: stored.acceptedAt, revision: stored.revision } };
}
function applyPreference(context: MutationContext, payload: PreferencePayload, scope: MembershipScope): ApplyResult<PreferenceResult> {
  const found = writableMembership(context, scope, payload.membershipId);
  if (found === undefined) return { changed: false };
  const afterChoice = withChoice(found.domain, payload.choice, found.at);
  const choiceChanged = afterChoice !== found.domain;
  const afterLanguage = payload.languagePreference === undefined ? afterChoice : withLanguagePreference(afterChoice, payload.languagePreference);
  const languageChanged = afterLanguage !== afterChoice;
  if (!choiceChanged && !languageChanged) return { changed: false };
  const stored = storedMembershipFrom(found.record, afterLanguage);
  withMemberships(context.docs, replacingMembership(found.memberships, stored));
  const choice: MemberChoice = stored.state === "off" || stored.state === "restricted" ? "off" : "immediate";
  return { changed: true, revision: stored.revision, changedIds: [stored.membershipId], result: { membershipId: stored.membershipId, state: stored.state, choice, languagePreference: stored.languagePreference, revision: stored.revision, changed: { choice: choiceChanged, languagePreference: languageChanged } } };
}
function applyUnsubscribe(context: MutationContext, payload: UnsubscribePayload, scope: MembershipScope): ApplyResult<UnsubscribeResult> {
  const memberships = membershipsOf(context.docs);
  const record = memberships.find((row) => row.publisherId === payload.publisherId && row.purpose === payload.purpose && row.membershipId === context.session.principalId);
  const domain = record === undefined ? undefined : domainMembershipOf(record, scope);
  if (record === undefined || domain === undefined || !canEdit(context.session, { kind: "membership", record: domain }).allowed) return { changed: false };
  const transition = recordOffChoice({ memberships: [domain], publisherId: record.publisherId, purpose: record.purpose, recipientId: record.membershipId }, instantAt(context.session.clockOffsetMs));
  const next = transition.memberships[0];
  if (transition.changedMembershipId === null || next === undefined) return { changed: false };
  const stored = storedMembershipFrom(record, next);
  withMemberships(context.docs, replacingMembership(memberships, stored));
  return { changed: true, revision: stored.revision, changedIds: [stored.membershipId], result: { membershipId: stored.membershipId, publisherId: stored.publisherId, purpose: stored.purpose, state: stored.state, choice: "off", revision: stored.revision, claimsRecall: false } };
}
type AudienceSpec<R extends MutationResult> = { readonly authorize?: (session: ResolvedSession) => ScopeDecision; readonly readCurrent?: (documents: MutationContext["docs"], session: ResolvedSession) => CurrentTarget; readonly apply: (context: MutationContext, session: ResolvedSession) => ApplyResult<R> };
const OWN_RECORD_ADMITTED: (session: ResolvedSession) => ScopeDecision = () => ({ ok: true });
async function runAudienceMutation<P, R extends MutationResult>(input: MutationInput<P>, source: SessionSource | undefined, schema: z.ZodType<P>, name: MutationName, spec: AudienceSpec<R>): Promise<MutationOutcome> {
  const opening = await openMutation(name, input, source);
  if (!opening.ok) return opening.outcome;
  const { session } = opening;
  return runMutation<P, R>({
    sessionId: session.sessionId,
    // The reader names the change and acts as its own identity; the membership row it changes lives in the publisher's world, so the transaction addresses that world rather than a copy only the reader's own page would see.
    recordsSessionId: audienceRecordsSessionIdOf(session),
    input,
    schema,
    name,
    scopeAuthority: "owner",
    authorize: spec.authorize ?? OWN_RECORD_ADMITTED,
    readCurrent: (documents) => (spec.readCurrent === undefined ? { kind: "absent" } : spec.readCurrent(documents, session)),
    apply: (context) => spec.apply(context, session),
  });
}
/** Opens one purpose-specific membership for the caller and leaves it waiting for proof. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const signupForPurpose = async (input: MutationInput<SignupPayload>, source?: SessionSource): Promise<MutationOutcome> => runAudienceMutation(input, source, signupPayloadSchema, "signupForPurpose", { apply: (context) => applySignup(context, input.payload, membershipScopeOf(input.scope)) });
/** Confirms one membership's address, on the person's explicit action and inside its window only. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const confirmMembership = async (input: MutationInput<ConfirmPayload>, source?: SessionSource): Promise<MutationOutcome> =>
  runAudienceMutation(input, source, confirmPayloadSchema, "confirmMembership", {
    authorize: (resolved) => addressedByCaller(resolved, claimedMembershipId(input)),
    readCurrent: (documents) => membershipTargetOf(documents, claimedMembershipId(input)),
    apply: (context) => applyConfirmation(context, input.payload, membershipScopeOf(input.scope)),
  });
/** Records the person's Off or Immediate decision, and a reading language if the request states one. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const setPreference = async (input: MutationInput<PreferencePayload>, source?: SessionSource): Promise<MutationOutcome> =>
  runAudienceMutation(input, source, preferencePayloadSchema, "setPreference", {
    authorize: (resolved) => addressedByCaller(resolved, claimedMembershipId(input)),
    readCurrent: (documents) => membershipTargetOf(documents, claimedMembershipId(input)),
    apply: (context) => applyPreference(context, input.payload, membershipScopeOf(input.scope)),
  });
/** Turns the caller's membership for one publisher and one purpose off, and leaves every other membership untouched. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const unsubscribe = async (input: MutationInput<UnsubscribePayload>, source?: SessionSource): Promise<MutationOutcome> =>
  runAudienceMutation(input, source, unsubscribePayloadSchema, "unsubscribe", {
    readCurrent: (documents, session) => currentTargetOf(documents, (memberships) => memberships.find((row) => row.publisherId === input.payload.publisherId && row.purpose === input.payload.purpose && row.membershipId === session.principalId)),
    apply: (context) => applyUnsubscribe(context, input.payload, membershipScopeOf(input.scope)),
  });
