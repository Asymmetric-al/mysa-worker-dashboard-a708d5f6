/** The read envelope, the mutation request envelope, the single value-state vocabulary and the stored form of every logical record this application keeps. */
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { MEMBERSHIP_STATES } from "@/modules/audience/membership";
import type { ModuleKey } from "@/modules/coaching/grant";
import { TARGET_MEASURES } from "@/modules/coaching/target";
import { CONTENT_DIRECTIONS, type ContentDirection, type ContentDocumentJson } from "@/modules/content/document";
import { RENDITION_REFUSAL_REASONS, type RenditionRefusalReason } from "@/modules/content/notice";
import { CONTENT_KINDS, RELEASE_REACH_VALUES, VARIANT_AUDIENCES, VARIANT_FAMILIES } from "@/modules/content/variant";
import { IMPORT_ROW_RESULT_STATES } from "@/modules/import/receipt";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
import type { MinorUnits, Money } from "@/modules/money/amount";
import { COMMITMENT_KINDS, RECURRING_BUCKETS, type CommitmentKind, type RecurringBucket } from "@/modules/support/buckets";
import { GOAL_MEASURE } from "@/modules/support/goal";
import { DATE_PRECISIONS, type DatePrecision } from "@/modules/time/civil";
import { REPEAT_PROFILES, SERIES_STATES, type RepeatProfile, type SeriesState } from "@/modules/time/recurrence";
export const VALUE_STATES = ["value", "zero", "unknown", "withheld", "unavailable", "incomplete-subtotal"] as const;
export type ValueState = (typeof VALUE_STATES)[number];
export type RecordedValueState = Exclude<ValueState, "incomplete-subtotal">;
export const valueStateSchema: z.ZodType<ValueState> = z.enum(VALUE_STATES);
/** Validates a state a read may record, refusing the derived member at the boundary. */
export const recordedValueStateSchema: z.ZodType<RecordedValueState> = z.enum(["value", "zero", "unknown", "withheld", "unavailable"]);
type BrandedIdentifier<Name extends string> = string & { readonly __brand: Name };
export type OrganizationId = BrandedIdentifier<"OrganizationId">;
export type MinistryId = BrandedIdentifier<"MinistryId">;
/** The finance and support subject a projection is scoped to — never the ministry it is reported in. */
export type SupportSubjectId = BrandedIdentifier<"SupportSubjectId">;
export type PrincipalId = BrandedIdentifier<"PrincipalId">;
function identifierSchema<Name extends string>(): z.ZodType<BrandedIdentifier<Name>> {
  return z
    .string()
    .min(1)
    .transform((value) => value as BrandedIdentifier<Name>);
}
export const organizationIdSchema: z.ZodType<OrganizationId> = identifierSchema<"OrganizationId">();
export const ministryIdSchema: z.ZodType<MinistryId> = identifierSchema<"MinistryId">();
export const supportSubjectIdSchema: z.ZodType<SupportSubjectId> = identifierSchema<"SupportSubjectId">();
export const principalIdSchema: z.ZodType<PrincipalId> = identifierSchema<"PrincipalId">();
export type Scope = { readonly organizationId: OrganizationId; readonly ministryId: MinistryId; readonly supportSubjectId: SupportSubjectId; readonly principalId: PrincipalId };
export const scopeSchema: z.ZodType<Scope> = z.object(
  { organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema, principalId: principalIdSchema },
  { error: "A mutation states the scope it believes it is acting in: the organization, the ministry, the support subject and the principal, so the service can check the caller is admitted to that context rather than infer it from the records." },
);
/** Reports whether two scopes are the same authority: exact equality on all four identifiers. */
export function sameScope(left: Scope, right: Scope): boolean {
  return left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId && left.principalId === right.principalId;
}
export const COVERAGE_STATES = ["complete", "partial", "unknown"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];
export type Coverage = { readonly from: string | null; readonly to: string | null; readonly state: CoverageState };
export type FinancialCoverage = Coverage & { readonly currency: string; readonly dateBasis: string };
export const coverageSchema: z.ZodType<Coverage> = z.object({ from: z.string().min(1).nullable(), to: z.string().min(1).nullable(), state: z.enum(COVERAGE_STATES) });
export const financialCoverageSchema: z.ZodType<FinancialCoverage> = z.object({ from: z.string().min(1).nullable(), to: z.string().min(1).nullable(), state: z.enum(COVERAGE_STATES), currency: z.string().min(1), dateBasis: z.string().min(1) });
export type ReadAction = { readonly name: string; readonly available: boolean; readonly reason?: string };
export const readActionSchema: z.ZodType<ReadAction> = z.object({ name: z.string().min(1), available: z.boolean(), reason: z.string().min(1).optional() });
export type ReadEnvelope<T, C extends Coverage = Coverage> = { readonly data: T; readonly scope: Scope; readonly source: SourceReference; readonly revision: string; readonly asOf: string; readonly coverage: C; readonly valueStates: Readonly<Record<string, ValueState>>; readonly actions: readonly ReadAction[] };
export interface ReadEnvelopeInput<T, C extends Coverage = Coverage> {
  readonly data: T;
  readonly scope: Scope;
  readonly source: SourceReference;
  readonly revision: string;
  readonly asOf: string;
  readonly coverage: C;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}
/** Builds the envelope a read returns, deriving the one state a caller may not choose. */
export function buildEnvelope<T, C extends Coverage = Coverage>(input: ReadEnvelopeInput<T, C>): ReadEnvelope<T, C> {
  return Object.freeze({ data: input.data, scope: input.scope, source: input.source, revision: input.revision, asOf: input.asOf, coverage: input.coverage, valueStates: deriveValueStates(input.valueStates, input.coverage.state), actions: Object.freeze([...input.actions]) });
}
function deriveValueStates(recorded: Readonly<Record<string, RecordedValueState>>, coverageState: CoverageState): Readonly<Record<string, ValueState>> {
  const derived: Record<string, ValueState> = {};
  for (const [path, state] of Object.entries(recorded)) {
    derived[path] = deriveValueState(state, coverageState);
  }
  return Object.freeze(derived);
}
function deriveValueState(recorded: RecordedValueState, coverageState: CoverageState): ValueState {
  if (recorded === "withheld" || recorded === "unknown" || recorded === "unavailable") {
    return recorded;
  }
  return coverageState === "partial" ? "incomplete-subtotal" : recorded;
}
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type MutationInput<P> = { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly payload: P };
/** The one shape guard every mutation runs before any state change. */
export function mutationInputSchema<P>(payloadSchema: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.strictObject({
    operationId: z
      .string({ error: "A mutation names the operationId of the attempt it makes, so a replay is recognised by identity and a lost acknowledgement is re-queried rather than resent." })
      .regex(OPERATION_ID_PATTERN, "An operationId is the canonical lowercase UUID v4 that newOperationId mints, so a replay can be recognised by identity rather than guessed from a repeated payload."),
    scope: scopeSchema,
    expectedRevision: z
      .string({ error: "A mutation names the revision the caller read before it makes the change, so a write built on a version another change has replaced is a conflict rather than an overwrite." })
      .min(1, "A mutation states the revision it saw, so a stale write is a conflict rather than an overwrite."),
    // Presence is the member's own rule and is judged before the caller's schema: an absent payload is told what a mutation needs from it, and a present one is judged by that schema alone — the pipe stops at the first refusal, so one fault never arrives as two messages.
    payload: z.custom<unknown>((stated) => stated !== undefined, { error: "A mutation states the change it asks for as its payload, so the service can validate it before it reads or writes anything." }).pipe(payloadSchema),
  });
}
/** A record's optimistic-concurrency token: never empty, opaque, and changed by every accepted write. */
export const recordRevisionSchema: z.ZodType<string> = z.string().min(1);
/** A calendar date stored as `YYYY-MM-DD`, with no time, zone or instant behind it. */
export const storedCivilDateSchema: z.ZodType<string> = z.iso.date();
export const storedInstantSchema: z.ZodType<string> = z.iso.datetime({ offset: true });
export const storedDatePrecisionSchema: z.ZodType<DatePrecision> = z.enum(DATE_PRECISIONS);
export const sourceReferenceSchema: z.ZodType<SourceReference> = z.object({ system: z.string().min(1), reference: z.string().min(1) });
/** An exact amount as stored: a currency code and a whole number of that currency's minor units. */
export const moneySchema: z.ZodType<Money> = z.object({ currency: z.string().min(1), minorUnits: z.int() }).transform((stored): Money => ({ currency: stored.currency, minorUnits: stored.minorUnits as MinorUnits }));
export const RECORD_AUDIENCES = ["private", "shared"] as const;
export type RecordAudience = (typeof RECORD_AUDIENCES)[number];
export const recordAudienceSchema: z.ZodType<RecordAudience> = z.enum(RECORD_AUDIENCES);
export const SESSION_STATES = ["signed-in", "unavailable", "denied", "expired", "no-access"] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const sessionStateSchema: z.ZodType<SessionState> = z.enum(SESSION_STATES);
export interface AdmittedMembership {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
  /** The organisation name the source of record states for this context, absent when that source names none. */
  readonly organizationLabel?: string;
  /** The ministry name the source of record states for this context, absent when that source names none. */
  readonly ministryLabel?: string;
}
export const admittedMembershipSchema: z.ZodType<AdmittedMembership> = z.object({ organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema, organizationLabel: z.string().min(1).optional(), ministryLabel: z.string().min(1).optional() });
export type SessionClockOffset = { readonly milliseconds: number };
export const sessionClockOffsetSchema: z.ZodType<SessionClockOffset> = z.object({ milliseconds: z.int() });
/** The root of scope: the session a cookie resolves to, and everything a request derives from it. */
export interface SessionContextRecord {
  readonly sessionId: string;
  readonly principalId: PrincipalId;
  readonly admittedMemberships: readonly AdmittedMembership[];
  readonly selectedOrganizationId: OrganizationId | null;
  readonly selectedMinistryId: MinistryId | null;
  readonly selectedSupportSubjectId: SupportSubjectId | null;
  readonly sessionState: SessionState;
  readonly scenarioId: string;
  readonly clockOffset: SessionClockOffset;
  readonly revision: string;
}
export const sessionContextRecordSchema: z.ZodType<SessionContextRecord> = z.object({
  sessionId: z.string().min(1),
  principalId: principalIdSchema,
  admittedMemberships: z.array(admittedMembershipSchema),
  selectedOrganizationId: organizationIdSchema.nullable(),
  selectedMinistryId: ministryIdSchema.nullable(),
  selectedSupportSubjectId: supportSubjectIdSchema.nullable(),
  sessionState: sessionStateSchema,
  scenarioId: z.string().min(1),
  clockOffset: sessionClockOffsetSchema,
  revision: recordRevisionSchema,
});
export const PARTNER_KINDS = ["person", "household", "church", "organization", "private-preparation"] as const;
/** What kind of record a partner is: never inferred from a name, an address or a gift. */
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const partnerKindSchema: z.ZodType<PartnerKind> = z.enum(PARTNER_KINDS);
export const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const;
export type ContactMethodKind = (typeof CONTACT_METHOD_KINDS)[number];
export type PartnerContactMethod = { readonly kind: ContactMethodKind; readonly value: string; readonly permitted: boolean; readonly verified: false };
export type PartnerRestriction = { readonly kind: string; readonly detail: string };
export type PartnerNameParts = { readonly given: string | null; readonly family: string | null; readonly additional: readonly string[] };
/** One partner record: a person, household, church, other organisation, or the worker's own private preparation. */
export interface PartnerRecord {
  readonly partnerId: string;
  readonly kind: PartnerKind;
  readonly displayName: string;
  readonly nameParts: PartnerNameParts | null;
  readonly contactMethods: readonly PartnerContactMethod[];
  readonly restrictions: readonly PartnerRestriction[];
  readonly tags: readonly string[];
  readonly favourite: boolean;
  readonly stage: string | null;
  readonly audience: RecordAudience;
  readonly revision: string;
  readonly source: SourceReference | null;
}
export const partnerContactMethodSchema: z.ZodType<PartnerContactMethod> = z.object({ kind: z.enum(CONTACT_METHOD_KINDS), value: z.string().min(1), permitted: z.boolean(), verified: z.literal(false) });
export const partnerRestrictionSchema: z.ZodType<PartnerRestriction> = z.object({ kind: z.string().min(1), detail: z.string().min(1) });
export const partnerNamePartsSchema: z.ZodType<PartnerNameParts> = z.object({ given: z.string().min(1).nullable(), family: z.string().min(1).nullable(), additional: z.array(z.string().min(1)) });
export const partnerRecordSchema: z.ZodType<PartnerRecord> = z.object({
  partnerId: z.string().min(1),
  kind: partnerKindSchema,
  displayName: z.string().min(1),
  nameParts: partnerNamePartsSchema.nullable(),
  contactMethods: z.array(partnerContactMethodSchema),
  restrictions: z.array(partnerRestrictionSchema),
  tags: z.array(z.string().min(1)),
  favourite: z.boolean(),
  stage: z.string().min(1).nullable(),
  audience: recordAudienceSchema,
  revision: recordRevisionSchema,
  source: sourceReferenceSchema.nullable(),
});
export type PrivateNoteRecord = { readonly noteId: string; readonly partnerId: string; readonly authorPrincipalId: PrincipalId; readonly body: string; readonly audience: "private"; readonly createdAt: string; readonly revision: string };
export const privateNoteRecordSchema: z.ZodType<PrivateNoteRecord> = z.object({ noteId: z.string().min(1), partnerId: z.string().min(1), authorPrincipalId: principalIdSchema, body: z.string(), audience: z.literal("private"), createdAt: storedInstantSchema, revision: recordRevisionSchema });
export interface InteractionNote {
  readonly body: string;
  readonly audience: RecordAudience;
  /** The principal who wrote the note. */
  readonly authorPrincipalId?: PrincipalId;
}
export type InteractionParticipant = { readonly role: string; readonly partnerId: string | null; readonly principalId: PrincipalId | null };
/** Something that actually happened, recorded with the precision its date is known to. */
export interface InteractionRecord {
  readonly interactionId: string;
  readonly partnerId: string;
  readonly type: string;
  readonly occurredOn: string | null;
  readonly precision: DatePrecision;
  readonly outcome: string;
  readonly participants: readonly InteractionParticipant[];
  readonly note: InteractionNote | null;
  readonly provenance: SourceReference | null;
  readonly revision: string;
}
export const interactionParticipantSchema: z.ZodType<InteractionParticipant> = z.object({ role: z.string().min(1), partnerId: z.string().min(1).nullable(), principalId: principalIdSchema.nullable() });
export const interactionNoteSchema: z.ZodType<InteractionNote> = z.object({ body: z.string(), audience: recordAudienceSchema, authorPrincipalId: principalIdSchema.optional() });
export const interactionRecordSchema: z.ZodType<InteractionRecord> = z
  .object({
    interactionId: z.string().min(1),
    partnerId: z.string().min(1),
    type: z.string().min(1),
    occurredOn: storedCivilDateSchema.nullable(),
    precision: storedDatePrecisionSchema,
    outcome: z.string(),
    participants: z.array(interactionParticipantSchema),
    note: interactionNoteSchema.nullable(),
    provenance: sourceReferenceSchema.nullable(),
    revision: recordRevisionSchema,
  })
  .refine((record) => (record.precision === "unknown") === (record.occurredOn === null), { path: ["occurredOn"], message: "An unrecorded date is stated as unknown precision with no date, and a known or approximate date states the day it refers to, so the two never disagree." });
export const TASK_STATUSES = ["open", "completed", "reopened", "cancelled"] as const;
export type TaskRecordStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema: z.ZodType<TaskRecordStatus> = z.enum(TASK_STATUSES);
export const TASK_KINDS = ["default", "meeting"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
/** One piece of work. */
export interface TaskRecord {
  readonly taskId: string;
  readonly title: string;
  readonly category: string | null;
  readonly dueOn: string | null;
  readonly plannedTime: string | null;
  readonly timeZone: string | null;
  readonly kind: TaskKind;
  readonly status: TaskRecordStatus;
  readonly partnerId: string | null;
  readonly initiativeId: string | null;
  readonly seriesId: string | null;
  readonly ownerPrincipalId: PrincipalId;
  readonly note: string | null;
  readonly revision: string;
}
const PLANNED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const taskRecordSchema: z.ZodType<TaskRecord> = z
  .object({
    taskId: z.string().min(1),
    title: z.string().min(1),
    category: z.string().min(1).nullable(),
    dueOn: storedCivilDateSchema.nullable(),
    plannedTime: z.string().regex(PLANNED_TIME_PATTERN).nullable(),
    timeZone: z.string().min(1).nullable(),
    kind: z.enum(TASK_KINDS),
    status: taskStatusSchema,
    partnerId: z.string().min(1).nullable(),
    initiativeId: z.string().min(1).nullable(),
    seriesId: z.string().min(1).nullable(),
    ownerPrincipalId: principalIdSchema,
    note: z.string().nullable(),
    revision: recordRevisionSchema,
  })
  .refine((task) => task.plannedTime === null || (task.kind === "meeting" && task.timeZone !== null), { path: ["plannedTime"], message: "A planned time belongs to a meeting task and always discloses the zone it is stated in, so a wall-clock time is never read as an instant in an assumed zone." });
/** The fingerprint of the task meaning a shared summary's description was reviewed against. */
export function taskReviewedFingerprint(task: TaskRecord): string {
  return [task.taskId, task.title, task.category ?? "", task.note ?? ""].join("\u0000");
}
export type SeriesEndRecord = { readonly kind: "on-date"; readonly on: string } | { readonly kind: "after-count"; readonly count: number } | { readonly kind: "ongoing-personal-policy" };
export const seriesEndRecordSchema: z.ZodType<SeriesEndRecord> = z.discriminatedUnion("kind", [z.object({ kind: z.literal("on-date"), on: storedCivilDateSchema }), z.object({ kind: z.literal("after-count"), count: z.int().min(1) }), z.object({ kind: z.literal("ongoing-personal-policy") })]);
export type SeriesRuleRecord = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end: SeriesEndRecord };
export const seriesRuleRecordSchema: z.ZodType<SeriesRuleRecord> = z.object({ profile: z.enum(REPEAT_PROFILES), interval: z.int().min(1), dayOfMonth: z.int().min(1).max(31).nullable(), firstDueOn: storedCivilDateSchema, planningTimeZone: z.string().min(1), end: seriesEndRecordSchema });
export type SeriesRuleRevisionRecord = { readonly revisionId: string; readonly effectiveFrom: string; readonly rule: SeriesRuleRecord };
export const seriesRuleRevisionRecordSchema: z.ZodType<SeriesRuleRevisionRecord> = z.object({ revisionId: z.string().min(1), effectiveFrom: storedCivilDateSchema, rule: seriesRuleRecordSchema });
/** A repeating piece of work and the rule that admits its occurrences. */
export interface TaskSeriesRecord {
  readonly seriesId: string;
  readonly ownerPrincipalId: PrincipalId;
  readonly title: string;
  readonly currentRule: SeriesRuleRecord;
  readonly effectiveRevisions: readonly SeriesRuleRevisionRecord[];
  readonly currentOccurrenceId: string | null;
  readonly state: SeriesState;
  readonly planNeedsReview: boolean;
  readonly revision: string;
}
export const taskSeriesRecordSchema: z.ZodType<TaskSeriesRecord> = z.object({
  seriesId: z.string().min(1),
  ownerPrincipalId: principalIdSchema,
  title: z.string().min(1),
  currentRule: seriesRuleRecordSchema,
  effectiveRevisions: z.array(seriesRuleRevisionRecordSchema),
  currentOccurrenceId: z.string().min(1).nullable(),
  state: z.enum(SERIES_STATES),
  planNeedsReview: z.boolean(),
  revision: recordRevisionSchema,
});
export const INITIATIVE_STATES = ["open", "closed"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];
export type InitiativePeriod = { readonly from: string | null; readonly to: string | null };
/** A finite piece of outreach with a reviewed working list. */
export interface InitiativeRecord {
  readonly initiativeId: string;
  readonly name: string;
  readonly purpose: string;
  readonly ministryContextId: MinistryId;
  readonly responsiblePrincipalId: PrincipalId;
  readonly period: InitiativePeriod | null;
  readonly state: InitiativeState;
  readonly closureDisposition: string | null;
  readonly revision: string;
}
export const initiativePeriodSchema: z.ZodType<InitiativePeriod> = z.object({ from: storedCivilDateSchema.nullable(), to: storedCivilDateSchema.nullable() });
export const initiativeRecordSchema: z.ZodType<InitiativeRecord> = z.object({
  initiativeId: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().min(1),
  ministryContextId: ministryIdSchema,
  responsiblePrincipalId: principalIdSchema,
  period: initiativePeriodSchema.nullable(),
  state: z.enum(INITIATIVE_STATES),
  closureDisposition: z.string().min(1).nullable(),
  revision: recordRevisionSchema,
});
export const INITIATIVE_MEMBER_STATES = ["included", "removed", "excluded"] as const;
export type InitiativeMemberState = (typeof INITIATIVE_MEMBER_STATES)[number];
/** The five source-approved stages a working-list member's stage is drawn from, declared once so the stage a write admits and the stage a read lists can never be two lists. */
export const INITIATIVE_STAGES = ["Not yet asked", "Asked", "Answered", "Follow up due", "Paused"] as const;
export type InitiativeMemberHistoryEntry = { readonly state: InitiativeMemberState; readonly at: string; readonly byPrincipalId: PrincipalId; readonly reason: string | null };
/** One partner on an initiative's working list. */
export interface InitiativeMemberRecord {
  readonly memberId: string;
  readonly initiativeId: string;
  readonly partnerId: string;
  readonly state: InitiativeMemberState;
  readonly stage: string | null;
  readonly addedAt: string;
  readonly returnedAt: string | null;
  readonly history: readonly InitiativeMemberHistoryEntry[];
  readonly revision: string;
}
export const initiativeMemberHistoryEntrySchema: z.ZodType<InitiativeMemberHistoryEntry> = z.object({ state: z.enum(INITIATIVE_MEMBER_STATES), at: storedInstantSchema, byPrincipalId: principalIdSchema, reason: z.string().min(1).nullable() });
export const initiativeMemberRecordSchema: z.ZodType<InitiativeMemberRecord> = z.object({
  memberId: z.string().min(1),
  initiativeId: z.string().min(1),
  partnerId: z.string().min(1),
  state: z.enum(INITIATIVE_MEMBER_STATES),
  stage: z.string().min(1).nullable(),
  addedAt: storedInstantSchema,
  returnedAt: storedInstantSchema.nullable(),
  history: z.array(initiativeMemberHistoryEntrySchema),
  revision: recordRevisionSchema,
});
/** The seven ways a Request can be answered, each a distinct fact about the conversation. */
export const REQUEST_RESPONSE_KINDS = ["agreed", "conditional", "partial", "deferred", "declined", "unanswered", "needs-clarification"] as const;
export type RequestResponseKind = (typeof REQUEST_RESPONSE_KINDS)[number];
export type RequestTerms = { readonly version: string; readonly money: { readonly amount: Money; readonly cadence: string | null; readonly term: string | null } | null; readonly nonFinancial: string | null };
export type RequestPresentation = { readonly presentedOn: string; readonly manner: string; readonly versionRef: string };
export type RequestResponse = { readonly kind: RequestResponseKind; readonly respondentId: string; readonly standingEvidence: string | null; readonly termsVersionRef: string; readonly recordedAt: string };
/** One independently answerable invitation. */
export interface RequestRecord {
  readonly requestId: string;
  readonly initiativeId: string;
  readonly recipientPartnerId: string;
  readonly representedOrganizationId: string | null;
  readonly purpose: string;
  readonly terms: RequestTerms;
  readonly presentation: RequestPresentation | null;
  readonly response: RequestResponse | null;
  readonly nextWorkIds: readonly string[];
  readonly revision: string;
}
export const requestTermsSchema: z.ZodType<RequestTerms> = z.object({ version: z.string().min(1), money: z.object({ amount: moneySchema, cadence: z.string().min(1).nullable(), term: z.string().min(1).nullable() }).nullable(), nonFinancial: z.string().min(1).nullable() });
export const requestPresentationSchema: z.ZodType<RequestPresentation> = z.object({ presentedOn: storedCivilDateSchema, manner: z.string().min(1), versionRef: z.string().min(1) });
export const requestResponseSchema: z.ZodType<RequestResponse> = z.object({ kind: z.enum(REQUEST_RESPONSE_KINDS), respondentId: z.string().min(1), standingEvidence: z.string().min(1).nullable(), termsVersionRef: z.string().min(1), recordedAt: storedInstantSchema });
export const requestRecordSchema: z.ZodType<RequestRecord> = z.object({
  requestId: z.string().min(1),
  initiativeId: z.string().min(1),
  recipientPartnerId: z.string().min(1),
  representedOrganizationId: z.string().min(1).nullable(),
  purpose: z.string().min(1),
  terms: requestTermsSchema,
  presentation: requestPresentationSchema.nullable(),
  response: requestResponseSchema.nullable(),
  nextWorkIds: z.array(z.string().min(1)),
  revision: recordRevisionSchema,
});
export const REFERRAL_WINDOW_KINDS = ["new", "continued"] as const;
export type ReferralWindowKind = (typeof REFERRAL_WINDOW_KINDS)[number];
/** One referral cycle for a partner. */
export interface ReferralCycleRecord {
  readonly referralId: string;
  readonly partnerId: string;
  readonly originalIntroductionOn: string | null;
  readonly datePrecision: DatePrecision;
  readonly sourceZone: string;
  readonly sourceReference: SourceReference | null;
  readonly cycleIndex: number;
  readonly windowKind: ReferralWindowKind;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly consumed: boolean;
  readonly predecessorId: string | null;
  readonly revision: string;
}
export const referralCycleRecordSchema: z.ZodType<ReferralCycleRecord> = z
  .object({
    referralId: z.string().min(1),
    partnerId: z.string().min(1),
    originalIntroductionOn: storedCivilDateSchema.nullable(),
    datePrecision: storedDatePrecisionSchema,
    sourceZone: z.string().min(1),
    sourceReference: sourceReferenceSchema.nullable(),
    cycleIndex: z.int().nonnegative(),
    windowKind: z.enum(REFERRAL_WINDOW_KINDS),
    windowStart: storedInstantSchema.nullable(),
    windowEnd: storedInstantSchema.nullable(),
    consumed: z.boolean(),
    predecessorId: z.string().min(1).nullable(),
    revision: recordRevisionSchema,
  })
  .refine((referral) => referral.datePrecision !== "unknown" || referral.originalIntroductionOn === null, { path: ["originalIntroductionOn"], message: "An unknown introduction date states no date at all, rather than a guessed one that a later reader would treat as evidence." })
  .refine((referral) => referral.datePrecision === "date" || referral.windowEnd === null, { path: ["windowEnd"], message: "Only a date-precise introduction yields a deadline. An approximate or unknown date states no endpoint, no Active or Expired judgement and no Continue action, so neither can ever be given one." });
/** The one reporting basis this release names: source-qualified effective cash allocations, attributed to their original gift dates. */
export const SUPPORT_BASES = ["effective_cash_allocation"] as const;
export type SupportBasis = (typeof SUPPORT_BASES)[number];
/** The measures a support goal can be set against: the goal module's own {@link GOAL_MEASURE} declaration, held as a one-member tuple so the stored record states exactly the token the goal mutation accepts and the goal read publishes. */
export const SUPPORT_GOAL_MEASURES = [GOAL_MEASURE] as const;
/** Which measure a goal counts, derived from {@link SUPPORT_GOAL_MEASURES}. */
export type SupportGoalMeasure = (typeof SUPPORT_GOAL_MEASURES)[number];
export type SupportGoalRecord = { readonly amount: Money; readonly measure: SupportGoalMeasure; readonly effectiveFrom: string; readonly revision: string };
/** A source-qualified financial projection with its provenance, coverage and as-of time. */
export interface SupportProjectionRecord {
  readonly supportSubjectId: SupportSubjectId;
  readonly basis: SupportBasis;
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly goal: SupportGoalRecord | null;
  readonly source: SourceReference;
  readonly revision: string;
}
export const supportGoalRecordSchema: z.ZodType<SupportGoalRecord> = z.object({ amount: moneySchema, measure: z.enum(SUPPORT_GOAL_MEASURES), effectiveFrom: storedCivilDateSchema, revision: recordRevisionSchema });
export const supportProjectionRecordSchema: z.ZodType<SupportProjectionRecord> = z.object({
  supportSubjectId: supportSubjectIdSchema,
  basis: z.enum(SUPPORT_BASES),
  currencyExponents: z.record(z.string().min(1), z.int().nonnegative()),
  coverage: coverageSchema,
  asOf: storedInstantSchema,
  lastSourceUpdate: storedInstantSchema,
  goal: supportGoalRecordSchema.nullable(),
  source: sourceReferenceSchema,
  revision: recordRevisionSchema,
});
export type GiftAttribution = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
export const giftAttributionSchema: z.ZodType<GiftAttribution> = z.discriminatedUnion("kind", [z.object({ kind: z.literal("partner"), partnerId: z.string().min(1) }), z.object({ kind: z.literal("anonymous") }), z.object({ kind: z.literal("unresolved") })]);
/** One received gift at the grain it is reported in: an authorised allocation row, or a whole gift that carries no allocation. */
export interface GiftRowRecord {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId: string | null;
  readonly amount: Money;
  readonly originalGiftOn: string | null;
  readonly datePrecision: DatePrecision;
  readonly designation: string | null;
  readonly attribution: GiftAttribution;
  readonly refundOf: string | null;
  readonly provenance: SourceReference;
  readonly entryOn: string;
  readonly revision: string;
}
export const giftRowRecordSchema: z.ZodType<GiftRowRecord> = z.object({
  giftRowId: z.string().min(1),
  giftId: z.string().min(1),
  allocationId: z.string().min(1).nullable(),
  amount: moneySchema,
  originalGiftOn: storedCivilDateSchema.nullable(),
  datePrecision: storedDatePrecisionSchema,
  designation: z.string().min(1).nullable(),
  attribution: giftAttributionSchema,
  refundOf: z.string().min(1).nullable(),
  provenance: sourceReferenceSchema,
  entryOn: storedCivilDateSchema,
  revision: recordRevisionSchema,
});
/** One commitment row, read-only, in its stored form. */
export interface CommitmentRowRecord {
  readonly commitmentRowId: string;
  readonly kind: CommitmentKind;
  readonly cadence: string;
  readonly perOccurrence: Money;
  readonly bucketState: RecurringBucket;
  readonly lastSuccessfulOn: string | null;
  readonly nextEligibleOn: string | null;
  readonly pause: CommitmentPauseRecord;
  readonly fixedTotal: CommitmentFixedTotalRecord | null;
  readonly provenance: SourceReference;
  readonly revision: string;
}
export type CommitmentPauseRecord = { readonly state: "active" | "paused"; readonly resumeOn: string | null };
export type CommitmentFixedTotalRecord = { readonly promised: Money; readonly fulfilled: Money; readonly released: Money; readonly remaining: Money };
export const commitmentPauseRecordSchema: z.ZodType<CommitmentPauseRecord> = z.object({ state: z.enum(["active", "paused"]), resumeOn: storedCivilDateSchema.nullable() });
export const commitmentFixedTotalRecordSchema: z.ZodType<CommitmentFixedTotalRecord> = z.object({ promised: moneySchema, fulfilled: moneySchema, released: moneySchema, remaining: moneySchema });
export const commitmentRowRecordSchema: z.ZodType<CommitmentRowRecord> = z
  .object({
    commitmentRowId: z.string().min(1),
    kind: z.enum(COMMITMENT_KINDS),
    cadence: z.string().min(1),
    perOccurrence: moneySchema,
    bucketState: z.enum(RECURRING_BUCKETS),
    lastSuccessfulOn: storedCivilDateSchema.nullable(),
    nextEligibleOn: storedCivilDateSchema.nullable(),
    pause: commitmentPauseRecordSchema,
    fixedTotal: commitmentFixedTotalRecordSchema.nullable(),
    provenance: sourceReferenceSchema,
    revision: recordRevisionSchema,
  })
  .refine((commitment) => (commitment.kind === "fixed-total") === (commitment.fixedTotal !== null), { path: ["fixedTotal"], message: "Only a fixed-total commitment has a promised, fulfilled, released and remaining total; a recurring commitment states none, so an absent total is never read as zero." });
/** Which family of content a document is, drawn from {@link VARIANT_FAMILIES} in `modules/content/variant.ts`, which declares the three families once. */
export type ContentFamily = (typeof VARIANT_FAMILIES)[number];
/** What kind of content a document holds, drawn from {@link CONTENT_KINDS} in `modules/content/variant.ts`, which declares the four kinds once. */
export type ContentKind = (typeof CONTENT_KINDS)[number];
export type GivingBinding = { readonly designation: SourceReference; readonly label: string };
export type ContentDocumentRecord = { readonly documentId: string; readonly family: ContentFamily; readonly kind: ContentKind; readonly sourceSubject: SourceReference; readonly siteId: string; readonly givingBinding: GivingBinding | null; readonly managedFields: readonly string[]; readonly revision: string };
export const givingBindingSchema: z.ZodType<GivingBinding> = z.object({ designation: sourceReferenceSchema, label: z.string().min(1) });
export const contentDocumentRecordSchema: z.ZodType<ContentDocumentRecord> = z.object({
  documentId: z.string().min(1),
  family: z.enum(VARIANT_FAMILIES),
  kind: z.enum(CONTENT_KINDS),
  sourceSubject: sourceReferenceSchema,
  siteId: z.string().min(1),
  givingBinding: givingBindingSchema.nullable(),
  managedFields: z.array(z.string().min(1)),
  revision: recordRevisionSchema,
});
/** Who a variant is written for, drawn from {@link VARIANT_AUDIENCES} in `modules/content/variant.ts`, which declares the two audiences once. */
export type ContentAudience = (typeof VARIANT_AUDIENCES)[number];
export const contentAudienceSchema: z.ZodType<ContentAudience> = z.enum(VARIANT_AUDIENCES);
export type ContentTranslationSource = { readonly variantId: string; readonly revisionId: string };
/** One working edition: a document, the audience it addresses, the exact content locale and direction. */
export interface ContentVariantRecord {
  readonly variantId: string;
  readonly documentId: string;
  readonly audience: ContentAudience;
  readonly locale: string;
  readonly direction: ContentDirection;
  readonly draftRevisionId: string | null;
  readonly candidateId: string | null;
  readonly releaseHeadId: string | null;
  readonly translationSource: ContentTranslationSource | null;
  readonly revision: string;
}
export const contentTranslationSourceSchema: z.ZodType<ContentTranslationSource> = z.object({ variantId: z.string().min(1), revisionId: z.string().min(1) });
export const contentVariantRecordSchema: z.ZodType<ContentVariantRecord> = z.object({
  variantId: z.string().min(1),
  documentId: z.string().min(1),
  audience: contentAudienceSchema,
  locale: z.string().min(1),
  direction: z.enum(CONTENT_DIRECTIONS),
  draftRevisionId: z.string().min(1).nullable(),
  candidateId: z.string().min(1).nullable(),
  releaseHeadId: z.string().min(1).nullable(),
  translationSource: contentTranslationSourceSchema.nullable(),
  revision: recordRevisionSchema,
});
export type MediaPlacementRecord = { readonly placementId: string; readonly assetId: string; readonly sectionElement: string | null; readonly position: number; readonly altText: string; readonly caption: string | null; readonly credit: string | null };
export type ContentCaptionTrackRecord = { readonly assetId: string; readonly renditionId: string; readonly language: string; readonly label: string; readonly isDefault: boolean };
export type SharePresentationRecord = { readonly title: string; readonly description: string; readonly imageAssetId: string | null; readonly imageAltText: string | null };
/** One exact revision of a variant's content. */
export interface ContentRevisionRecord {
  readonly revisionId: string;
  readonly variantId: string;
  readonly body: ContentDocumentJson;
  readonly mediaPlacements: readonly MediaPlacementRecord[];
  readonly captions: readonly ContentCaptionTrackRecord[];
  readonly sharePresentation: SharePresentationRecord;
  readonly contentChecksum: string;
  readonly authorPrincipalId: PrincipalId;
  readonly createdAt: string;
  readonly revision: string;
}
export const mediaPlacementRecordSchema: z.ZodType<MediaPlacementRecord> = z.object({
  placementId: z.string().min(1),
  assetId: z.string().min(1),
  sectionElement: z.string().min(1).nullable(),
  position: z.int().nonnegative(),
  altText: z.string().min(1),
  caption: z.string().min(1).nullable(),
  credit: z.string().min(1).nullable(),
});
export const contentCaptionTrackRecordSchema: z.ZodType<ContentCaptionTrackRecord> = z.object({ assetId: z.string().min(1), renditionId: z.string().min(1), language: z.string().min(1), label: z.string().min(1), isDefault: z.boolean() });
export const sharePresentationRecordSchema: z.ZodType<SharePresentationRecord> = z.object({ title: z.string().min(1), description: z.string(), imageAssetId: z.string().min(1).nullable(), imageAltText: z.string().min(1).nullable() });
/** The revision schema, built from the document validator that owns the content profile. */
export function contentRevisionRecordSchema(documentSchema: z.ZodType<ContentDocumentJson>): z.ZodType<ContentRevisionRecord> {
  return z.object({
    revisionId: z.string().min(1),
    variantId: z.string().min(1),
    body: documentSchema,
    mediaPlacements: z.array(mediaPlacementRecordSchema),
    captions: z.array(contentCaptionTrackRecordSchema),
    sharePresentation: sharePresentationRecordSchema,
    contentChecksum: z.string().min(1),
    authorPrincipalId: principalIdSchema,
    createdAt: storedInstantSchema,
    revision: recordRevisionSchema,
  });
}
/** The eight section types a page family's catalogue admits, in the order it offers them, declared once so the module that composes a page and the module that reads its catalogue cannot disagree about what a section may be. */
export const PAGE_SECTION_TYPES = ["introduction", "story", "prayer", "milestone", "image", "video", "giving", "progress"] as const;
/** One section type a page catalogue offers, derived from {@link PAGE_SECTION_TYPES}. */
export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];
/** The two preset identities the page catalogue proposes, declared once so a preset's composition and the control that applies it stay one list. */
export const PAGE_PRESET_IDS = ["preset-opening-and-story", "preset-story-and-prayer"] as const;
/** One preset identity, derived from {@link PAGE_PRESET_IDS}. */
export type PagePresetId = (typeof PAGE_PRESET_IDS)[number];
export const MEDIA_ASSET_KINDS = ["image", "video"] as const;
/** Whether an asset is an image or a video, established by its content and never by its extension. */
export type MediaAssetKind = (typeof MEDIA_ASSET_KINDS)[number];
// The media module owns the rendition purposes, and the stored record states the same five. This module is imported by browser components, so it binds to the owner's type rather than importing its runtime tuple, which pulls the image and video pipeline in: adding a purpose there and not here fails to compile.
export const MEDIA_ASSET_RENDITION_PURPOSES = ["display", "playback", "poster", "captions", "transcript"] as const satisfies readonly MediaRenditionPurpose[];
type UnlistedRenditionPurpose = Exclude<MediaRenditionPurpose, (typeof MEDIA_ASSET_RENDITION_PURPOSES)[number]>;
/** A compile-time guard rather than a runtime switch: this constant only type-checks while `UnlistedRenditionPurpose` is `never`. */
export const MEDIA_ASSET_RENDITION_PURPOSES_ARE_COMPLETE: UnlistedRenditionPurpose extends never ? true : false = true;
export type MediaAssetRenditionPurpose = (typeof MEDIA_ASSET_RENDITION_PURPOSES)[number];
export type MediaAssetProfileRecord = { readonly container: string; readonly codec: string; readonly durationSeconds: number | null; readonly width: number; readonly height: number };
export type MediaAssetRenditionRecord = { readonly renditionId: string; readonly purpose: MediaAssetRenditionPurpose; readonly bytesRef: string; readonly mimeType: string };
export type MediaTagVerificationRecord = { readonly checked: boolean; readonly residualTags: readonly string[] };
/** One scoped media asset. */
export interface MediaAssetRecord {
  readonly assetId: string;
  readonly kind: MediaAssetKind;
  readonly profileCheck: MediaAssetProfileRecord;
  readonly sourceOriginalRef: string;
  readonly renditions: readonly MediaAssetRenditionRecord[];
  readonly scope: Scope;
  readonly tagVerification: MediaTagVerificationRecord;
  readonly revision: string;
}
export const mediaAssetProfileRecordSchema: z.ZodType<MediaAssetProfileRecord> = z.object({ container: z.string().min(1), codec: z.string().min(1), durationSeconds: z.number().nonnegative().nullable(), width: z.int().nonnegative(), height: z.int().nonnegative() });
export const mediaAssetRenditionRecordSchema: z.ZodType<MediaAssetRenditionRecord> = z.object({ renditionId: z.string().min(1), purpose: z.enum(MEDIA_ASSET_RENDITION_PURPOSES), bytesRef: z.string().min(1), mimeType: z.string().min(1) });
export const mediaTagVerificationRecordSchema: z.ZodType<MediaTagVerificationRecord> = z.object({ checked: z.boolean(), residualTags: z.array(z.string().min(1)) });
export const mediaAssetRecordSchema: z.ZodType<MediaAssetRecord> = z.object({
  assetId: z.string().min(1),
  kind: z.enum(MEDIA_ASSET_KINDS),
  profileCheck: mediaAssetProfileRecordSchema,
  sourceOriginalRef: z.string().min(1),
  renditions: z.array(mediaAssetRenditionRecordSchema),
  scope: scopeSchema,
  tagVerification: mediaTagVerificationRecordSchema,
  revision: recordRevisionSchema,
});
/** How far a released edition reaches — not public, public by link only (unlisted and noindex), or listed publicly in the discovery index — drawn from {@link RELEASE_REACH_VALUES} in `modules/content/variant.ts`, which declares the three values once. */
export type ReleaseReach = (typeof RELEASE_REACH_VALUES)[number];
export const releaseReachSchema: z.ZodType<ReleaseReach> = z.enum(RELEASE_REACH_VALUES);
/** One release of one variant: an exact frozen revision, in one audience, in one locale. */
export interface ReleaseRecord {
  readonly releaseId: string;
  readonly variantId: string;
  readonly revisionId: string;
  readonly audience: ContentAudience;
  readonly locale: string;
  readonly publishedAt: string;
  readonly reach: ReleaseReach;
  readonly withdrawnAt: string | null;
  readonly supersededBy: string | null;
  readonly revision: string;
}
export const releaseRecordSchema: z.ZodType<ReleaseRecord> = z.object({
  releaseId: z.string().min(1),
  variantId: z.string().min(1),
  revisionId: z.string().min(1),
  audience: contentAudienceSchema,
  locale: z.string().min(1),
  publishedAt: storedInstantSchema,
  reach: releaseReachSchema,
  withdrawnAt: storedInstantSchema.nullable(),
  supersededBy: z.string().min(1).nullable(),
  revision: recordRevisionSchema,
});
export const NOTIFICATION_PURPOSES = ["update-email"] as const;
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number];
export const NOTIFICATION_RECIPIENT_STATES = ["accepted", "failed", "unknown"] as const;
export type NotificationRecipientState = (typeof NOTIFICATION_RECIPIENT_STATES)[number];
export type NotificationIntentRecord = { readonly intentId: string; readonly publisherId: string; readonly purpose: NotificationPurpose; readonly documentId: string; readonly releaseId: string; readonly intendedAt: string; readonly ceilingCount: number; readonly revision: string };
export type NotificationRecipientOutcomeRecord = { readonly recipientId: string; readonly renditionId: string; readonly state: NotificationRecipientState; readonly at: string };
export type NotificationSendResultRecord = { readonly sendResultId: string; readonly intentId: string; readonly recipients: readonly NotificationRecipientOutcomeRecord[]; readonly unserved: readonly NotificationUnservedRecipientRecord[]; readonly recordedAt: string; readonly revision: string };
export const notificationRecipientOutcomeRecordSchema: z.ZodType<NotificationRecipientOutcomeRecord> = z.object({ recipientId: z.string().min(1), renditionId: z.string().min(1), state: z.enum(NOTIFICATION_RECIPIENT_STATES), at: storedInstantSchema });
export const NOTIFICATION_UNSERVED_REASONS = ["already-covered", "no-eligible-rendition"] as const;
/** One reason an eligible recipient received no copy, derived from {@link NOTIFICATION_UNSERVED_REASONS}. */
export type NotificationUnservedReason = (typeof NOTIFICATION_UNSERVED_REASONS)[number];
export type NotificationUnservedRecipientRecord =
  | { readonly recipientId: string; readonly reason: "already-covered"; readonly coveredByIntentId: string; readonly coveredByRenditionId: string }
  | { readonly recipientId: string; readonly reason: "no-eligible-rendition"; readonly renditionRefusal: RenditionRefusalReason };
export const notificationUnservedRecipientRecordSchema: z.ZodType<NotificationUnservedRecipientRecord> = z.discriminatedUnion("reason", [
  z.object({ recipientId: z.string().min(1), reason: z.literal("already-covered"), coveredByIntentId: z.string().min(1), coveredByRenditionId: z.string().min(1) }),
  z.object({ recipientId: z.string().min(1), reason: z.literal("no-eligible-rendition"), renditionRefusal: z.enum(RENDITION_REFUSAL_REASONS) }),
]);
export const notificationIntentRecordSchema: z.ZodType<NotificationIntentRecord> = z.object({
  intentId: z.string().min(1),
  publisherId: z.string().min(1),
  purpose: z.enum(NOTIFICATION_PURPOSES),
  documentId: z.string().min(1),
  releaseId: z.string().min(1),
  intendedAt: storedInstantSchema,
  ceilingCount: z.int().nonnegative(),
  revision: recordRevisionSchema,
});
export const notificationSendResultRecordSchema: z.ZodType<NotificationSendResultRecord> = z.object({
  sendResultId: z.string().min(1),
  intentId: z.string().min(1),
  recipients: z.array(notificationRecipientOutcomeRecordSchema),
  // Required, not defaulted: a send result that leaves this empty says every eligible recipient was served, so an absent list would be read as an account nobody wrote. Every result this build records states it, and `bun run reset` rebuilds the seed that does.
  unserved: z.array(notificationUnservedRecipientRecordSchema),
  recordedAt: storedInstantSchema,
  revision: recordRevisionSchema,
});
/** Where a membership stands for one publisher's one purpose, drawn from {@link MEMBERSHIP_STATES} in `modules/audience/membership.ts`, which declares the four states once. */
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
/** One purpose-specific membership and the reader's preference. */
export interface MembershipRecord {
  readonly membershipId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly publisherId: string;
  readonly purpose: NotificationPurpose;
  readonly state: MembershipState;
  readonly acceptedAt: string | null;
  readonly confirmationDeadline: string | null;
  readonly languagePreference: string | null;
  readonly revision: string;
}
export const membershipRecordSchema: z.ZodType<MembershipRecord> = z.object({
  membershipId: z.string().min(1),
  email: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  publisherId: z.string().min(1),
  purpose: z.enum(NOTIFICATION_PURPOSES),
  state: z.enum(MEMBERSHIP_STATES),
  acceptedAt: storedInstantSchema.nullable(),
  confirmationDeadline: storedInstantSchema.nullable(),
  languagePreference: z.string().min(1).nullable(),
  revision: recordRevisionSchema,
});
export const COACHING_GRANT_STATES = ["invited", "accepted", "active", "revoked", "expired", "ended", "left"] as const;
export type CoachingGrantState = (typeof COACHING_GRANT_STATES)[number];
export type CoachingModuleSelection = Readonly<Record<ModuleKey, boolean>>;
export type CoachingDurationRecord = { readonly kind: "ongoing" | "through-date"; readonly cutoffInstant: string | null; readonly frozenZone: string };
export type CoachingFinancialRangeRecord = { readonly from: string; readonly to: string; readonly currency: string };
export type CoachingInvitationRecord = { readonly issuedAt: string; readonly expiresAt: string; readonly supersededBy: string | null };
/** One coaching relationship, invited by a worker and accepted by a named coach. */
export interface CoachingGrantRecord {
  readonly grantId: string;
  readonly workerPrincipalId: PrincipalId;
  readonly coachPrincipalId: PrincipalId;
  readonly ministryIds: readonly MinistryId[];
  readonly modules: CoachingModuleSelection;
  readonly duration: CoachingDurationRecord;
  readonly financialRange: CoachingFinancialRangeRecord | null;
  readonly state: CoachingGrantState;
  readonly invitation: CoachingInvitationRecord;
  readonly revision: string;
}
const coachingModuleSelectionShape: Readonly<Record<ModuleKey, z.ZodBoolean>> = { "support-goal": z.boolean(), "support-results": z.boolean(), targets: z.boolean(), "check-ins": z.boolean(), "task-summaries": z.boolean() };
/** Validates the five module switches as stored, so a module the worker never shared reads `false`. */
export const coachingModuleSelectionSchema: z.ZodType<CoachingModuleSelection> = z.object(coachingModuleSelectionShape);
export const coachingDurationRecordSchema: z.ZodType<CoachingDurationRecord> = z
  .object({ kind: z.enum(["ongoing", "through-date"]), cutoffInstant: storedInstantSchema.nullable(), frozenZone: z.string().min(1) })
  .refine((duration) => (duration.kind === "through-date") === (duration.cutoffInstant !== null), { path: ["cutoffInstant"], message: "A share-through grant states the cutoff it was accepted with, and an ongoing grant states none: a missing duration is not permission and never reads as an unbounded one." });
export const coachingFinancialRangeRecordSchema: z.ZodType<CoachingFinancialRangeRecord> = z.object({ from: storedCivilDateSchema, to: storedCivilDateSchema, currency: z.string().min(1) });
export const coachingInvitationRecordSchema: z.ZodType<CoachingInvitationRecord> = z.object({ issuedAt: storedInstantSchema, expiresAt: storedInstantSchema, supersededBy: z.string().min(1).nullable() });
export const coachingGrantRecordSchema: z.ZodType<CoachingGrantRecord> = z.object({
  grantId: z.string().min(1),
  workerPrincipalId: principalIdSchema,
  coachPrincipalId: principalIdSchema,
  ministryIds: z.array(ministryIdSchema),
  modules: coachingModuleSelectionSchema,
  duration: coachingDurationRecordSchema,
  financialRange: coachingFinancialRangeRecordSchema.nullable(),
  state: z.enum(COACHING_GRANT_STATES),
  invitation: coachingInvitationRecordSchema,
  revision: recordRevisionSchema,
});
/** Which activity a target counts, drawn from {@link TARGET_MEASURES} in `modules/coaching/target.ts`, which declares the four measures once. */
export type CoachingTargetMeasure = (typeof TARGET_MEASURES)[number];
export const COACHING_TARGET_PERIOD_KINDS = ["weekly", "monthly", "custom"] as const;
export type CoachingTargetPeriodKind = (typeof COACHING_TARGET_PERIOD_KINDS)[number];
export type CoachingTargetPeriodRecord = { readonly kind: CoachingTargetPeriodKind; readonly from: string | null; readonly to: string | null };
export type CoachingTargetVersionRecord = { readonly revisionId: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly quantity: number; readonly measure: CoachingTargetMeasure; readonly calendarStart: string };
/** One target: the worker's own plan, and the version history a closed period resolves against. */
export interface CoachingTargetRecord {
  readonly targetId: string;
  readonly workerPrincipalId: PrincipalId;
  readonly privateLabel: string;
  readonly measure: CoachingTargetMeasure;
  readonly quantity: number;
  readonly period: CoachingTargetPeriodRecord;
  readonly calendarStart: string;
  readonly homePlacement: "placed" | "unplaced";
  readonly state: "active" | "paused" | "ended";
  readonly versions: readonly CoachingTargetVersionRecord[];
  readonly revision: string;
}
export const coachingTargetPeriodRecordSchema: z.ZodType<CoachingTargetPeriodRecord> = z
  .object({ kind: z.enum(COACHING_TARGET_PERIOD_KINDS), from: storedCivilDateSchema.nullable(), to: storedCivilDateSchema.nullable() })
  .refine((period) => (period.kind === "custom") === (period.from !== null && period.to !== null), { path: ["from"], message: "A one-off custom period states both its first and last day, and a recurring period states neither: a recurring target is bucketed by the calendar, so it cannot carry a range." });
export const coachingTargetVersionRecordSchema: z.ZodType<CoachingTargetVersionRecord> = z.object({
  revisionId: z.string().min(1),
  effectiveFrom: storedCivilDateSchema,
  effectiveTo: storedCivilDateSchema.nullable(),
  quantity: z.int().nonnegative(),
  measure: z.enum(TARGET_MEASURES),
  calendarStart: storedCivilDateSchema,
});
export const coachingTargetRecordSchema: z.ZodType<CoachingTargetRecord> = z.object({
  targetId: z.string().min(1),
  workerPrincipalId: principalIdSchema,
  privateLabel: z.string().min(1),
  measure: z.enum(TARGET_MEASURES),
  quantity: z.int().nonnegative(),
  period: coachingTargetPeriodRecordSchema,
  calendarStart: storedCivilDateSchema,
  homePlacement: z.enum(["placed", "unplaced"]),
  state: z.enum(["active", "paused", "ended"]),
  versions: z.array(coachingTargetVersionRecordSchema),
  revision: recordRevisionSchema,
});
function scalarCount(value: string): number {
  return [...value].length;
}
export type CoachingCheckInQuestionRecord = { readonly wording: string; readonly order: number };
export type CoachingCheckInAnswerRecord = { readonly questionOrder: number | null; readonly text: string };
export type CoachingCheckInPrivateDraftRecord = { readonly revisionId: string; readonly questions: readonly CoachingCheckInQuestionRecord[]; readonly questionsCapturedAt: string; readonly answers: readonly CoachingCheckInAnswerRecord[]; readonly savedAt: string };
/** The revision a named coach may read, created by an explicit Share. */
export interface CoachingCheckInSharedRevisionRecord {
  readonly revisionId: string;
  readonly questions: readonly CoachingCheckInQuestionRecord[];
  readonly questionsCapturedAt: string;
  readonly answers: readonly CoachingCheckInAnswerRecord[];
  readonly recipientPrincipalIds: readonly PrincipalId[];
  readonly duration: CoachingDurationRecord;
  readonly sharedAt: string;
  readonly updatedAt: string;
  readonly withdrawnAt: string | null;
}
export type CoachingCheckInRecord = { readonly checkInId: string; readonly workerPrincipalId: PrincipalId; readonly grantId: string; readonly privateDraft: CoachingCheckInPrivateDraftRecord | null; readonly shared: CoachingCheckInSharedRevisionRecord | null; readonly revision: string };
export const coachingCheckInQuestionRecordSchema: z.ZodType<CoachingCheckInQuestionRecord> = z.object({
  wording: z.string().refine((wording) => scalarCount(wording) <= 500, { message: "A question is at most 500 Unicode scalars; a longer one is refused with its count rather than shortened, because a shortened question would change what the worker asked." }),
  order: z.int().nonnegative(),
});
export const coachingCheckInAnswerRecordSchema: z.ZodType<CoachingCheckInAnswerRecord> = z.object({
  questionOrder: z.int().nonnegative().nullable(),
  text: z.string().refine((text) => scalarCount(text) <= 4000, { message: "An answer is at most 4,000 Unicode scalars; a longer one is refused with its count rather than truncated, because a truncated answer would misstate what the worker wrote." }),
});
export const coachingCheckInPrivateDraftRecordSchema: z.ZodType<CoachingCheckInPrivateDraftRecord> = z.object({
  revisionId: z.string().min(1),
  questions: z.array(coachingCheckInQuestionRecordSchema).max(5),
  questionsCapturedAt: storedInstantSchema,
  answers: z.array(coachingCheckInAnswerRecordSchema),
  savedAt: storedInstantSchema,
});
export const coachingCheckInSharedRevisionRecordSchema: z.ZodType<CoachingCheckInSharedRevisionRecord> = z.object({
  revisionId: z.string().min(1),
  questions: z.array(coachingCheckInQuestionRecordSchema).max(5),
  questionsCapturedAt: storedInstantSchema,
  answers: z.array(coachingCheckInAnswerRecordSchema),
  recipientPrincipalIds: z.array(principalIdSchema),
  duration: coachingDurationRecordSchema,
  sharedAt: storedInstantSchema,
  updatedAt: storedInstantSchema,
  withdrawnAt: storedInstantSchema.nullable(),
});
export const coachingCheckInRecordSchema: z.ZodType<CoachingCheckInRecord> = z.object({
  checkInId: z.string().min(1),
  workerPrincipalId: principalIdSchema,
  grantId: z.string().min(1),
  privateDraft: coachingCheckInPrivateDraftRecordSchema.nullable(),
  shared: coachingCheckInSharedRevisionRecordSchema.nullable(),
  revision: recordRevisionSchema,
});
/** One share of one occurrence of one task, as stored. */
export interface CoachingTaskShareRecord {
  readonly shareId: string;
  readonly taskId: string;
  readonly occurrenceId: string;
  readonly reviewedSummary: { readonly description: string; readonly codePoints: number; readonly reviewedAt: string };
  readonly reviewedFingerprint: string;
  readonly state: "shared" | "removed";
  readonly revision: number;
  readonly withdrawnAt?: string | null;
}
export const coachingTaskShareRecordSchema: z.ZodType<CoachingTaskShareRecord> = z.object({
  shareId: z.string().min(1),
  taskId: z.string().min(1),
  occurrenceId: z.string().min(1),
  reviewedSummary: z.object({ description: z.string(), codePoints: z.int().nonnegative(), reviewedAt: storedInstantSchema }),
  reviewedFingerprint: z.string().min(1),
  state: z.enum(["shared", "removed"]),
  revision: z.int().nonnegative(),
  withdrawnAt: storedInstantSchema.nullable().optional(),
});
export const OPERATION_OUTCOME_NAMES = ["accepted", "alreadyAccepted", "unchanged", "conflict", "denied", "invalid", "unavailable", "unknown"] as const;
export type OperationOutcomeName = (typeof OPERATION_OUTCOME_NAMES)[number];
export type StoredPerItemResult = { readonly targetId: string; readonly state: string; readonly revision?: string; readonly reasonCode?: string; readonly reason?: string };
const storedPerItemResultSchema: z.ZodType<StoredPerItemResult> = z.object({ targetId: z.string().min(1), state: z.string().min(1), revision: z.string().min(1).optional(), reasonCode: z.string().min(1).optional(), reason: z.string().optional() });
/** One recorded mutation attempt. */
export interface OperationRecord {
  readonly operationId: string;
  readonly intentHash: string;
  readonly scope: Scope;
  readonly outcome: OperationOutcomeName;
  readonly result: unknown;
  readonly revision?: string;
  readonly created?: readonly string[];
  readonly changed?: readonly string[];
  readonly items?: readonly StoredPerItemResult[];
  readonly at: string;
}
export const operationRecordSchema: z.ZodType<OperationRecord> = z.object({
  operationId: z.string().min(1),
  intentHash: z.string().min(1),
  scope: scopeSchema,
  outcome: z.enum(OPERATION_OUTCOME_NAMES),
  result: z.unknown(),
  revision: recordRevisionSchema.optional(),
  created: z.array(z.string().min(1)).optional(),
  changed: z.array(z.string().min(1)).optional(),
  items: z.array(storedPerItemResultSchema).optional(),
  at: storedInstantSchema,
});
export const IMPORT_ROW_DECISIONS = ["new-private-entry", "reuse-authorized-identity", "skip", "unresolved"] as const;
export type ImportRowDecision = (typeof IMPORT_ROW_DECISIONS)[number];
/** What became of one row — one of five results, so an accepted row is never confused with an already-accepted one — drawn from {@link IMPORT_ROW_RESULT_STATES} in `modules/import/receipt.ts`, which declares them once. */
export type ImportRowState = (typeof IMPORT_ROW_RESULT_STATES)[number];
export type ImportFileMetaRecord = { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
export type ImportFileFingerprintRecord = { readonly checksum: string; readonly columnCount: number; readonly dataRowCount: number };
export type ImportCellCorrectionRecord = { readonly columnNumber: number; readonly value: string };
export type ImportMatchReferenceRecord = { readonly system: string; readonly reference: string };
export type ImportColumnAssignmentRecord = { readonly columnIndex: number; readonly header: string; readonly field: string | null };
export type ImportRowDecisionRecord = { readonly rowNumber: number; readonly decision: ImportRowDecision; readonly targetPartnerId: string | null; readonly corrections: readonly ImportCellCorrectionRecord[]; readonly candidate: ImportMatchReferenceRecord | null; readonly reason: string | null };
export type ImportRowResultRecord = { readonly rowNumber: number; readonly state: ImportRowState; readonly partnerId: string | null; readonly message: string | null };
export type ImportSummaryRecord = { readonly newEntries: number; readonly reusedIdentities: number; readonly skipped: number; readonly needsReview: number };
/** One import proposal and its receipt. */
export interface ImportProposalRecord {
  readonly importOperationId: string;
  readonly fileMeta: ImportFileMetaRecord;
  readonly fingerprint: ImportFileFingerprintRecord;
  readonly mapping: readonly ImportColumnAssignmentRecord[];
  readonly rowDecisions: readonly ImportRowDecisionRecord[];
  readonly summary: ImportSummaryRecord;
  readonly results: readonly ImportRowResultRecord[];
  readonly processedAt: string | null;
  readonly revision: string;
}
export const importFileMetaRecordSchema: z.ZodType<ImportFileMetaRecord> = z.object({ name: z.string().min(1), bytes: z.int().nonnegative(), rowCount: z.int().nonnegative(), columnCount: z.int().nonnegative() });
export const importFileFingerprintRecordSchema: z.ZodType<ImportFileFingerprintRecord> = z.object({ checksum: z.string().min(1), columnCount: z.int().nonnegative(), dataRowCount: z.int().nonnegative() });
export const importCellCorrectionRecordSchema: z.ZodType<ImportCellCorrectionRecord> = z.object({ columnNumber: z.int().positive(), value: z.string() });
export const importMatchReferenceRecordSchema: z.ZodType<ImportMatchReferenceRecord> = z.object({ system: z.string().min(1), reference: z.string().min(1) });
export const importColumnAssignmentRecordSchema: z.ZodType<ImportColumnAssignmentRecord> = z.object({ columnIndex: z.int().nonnegative(), header: z.string().min(1), field: z.string().min(1).nullable() });
export const importRowDecisionRecordSchema: z.ZodType<ImportRowDecisionRecord> = z.object({
  rowNumber: z.int().nonnegative(),
  decision: z.enum(IMPORT_ROW_DECISIONS),
  targetPartnerId: z.string().min(1).nullable(),
  // A document written before a decision carried these members still parses: the decision it records is the whole of what that document stated, and the defaults say exactly that — no corrections, no candidate and no reason were recorded, not that none existed.
  corrections: z.array(importCellCorrectionRecordSchema).default([]),
  candidate: importMatchReferenceRecordSchema.nullable().default(null),
  reason: z.string().nullable().default(null),
});
export const importRowResultRecordSchema: z.ZodType<ImportRowResultRecord> = z.object({ rowNumber: z.int().nonnegative(), state: z.enum(IMPORT_ROW_RESULT_STATES), partnerId: z.string().min(1).nullable(), message: z.string().min(1).nullable() });
export const importSummaryRecordSchema: z.ZodType<ImportSummaryRecord> = z.object({ newEntries: z.int().nonnegative(), reusedIdentities: z.int().nonnegative(), skipped: z.int().nonnegative(), needsReview: z.int().nonnegative() });
export const importProposalRecordSchema: z.ZodType<ImportProposalRecord> = z.object({
  importOperationId: z.string().min(1),
  fileMeta: importFileMetaRecordSchema,
  fingerprint: importFileFingerprintRecordSchema,
  mapping: z.array(importColumnAssignmentRecordSchema),
  rowDecisions: z.array(importRowDecisionRecordSchema),
  summary: importSummaryRecordSchema,
  results: z.array(importRowResultRecordSchema),
  processedAt: storedInstantSchema.nullable(),
  revision: recordRevisionSchema,
});
/** Narrows a record to the fields a caller is authorised to see. */
export function project<T extends object, K extends keyof T>(record: T, visible: readonly K[]): Pick<T, K> {
  const projected = {} as Pick<T, K>;
  for (const key of visible) {
    projected[key] = record[key];
  }
  return projected;
}
