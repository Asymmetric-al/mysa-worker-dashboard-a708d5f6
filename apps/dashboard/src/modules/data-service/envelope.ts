import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { MEMBERSHIP_STATES } from "@/modules/audience/membership";
import type { ModuleKey } from "@/modules/coaching/grant";
import { TARGET_MEASURES } from "@/modules/coaching/target";
import { CONTENT_DIRECTIONS, type ContentDocumentJson } from "@/modules/content/document";
import { RENDITION_REFUSAL_REASONS, type RenditionRefusalReason } from "@/modules/content/notice";
import { CONTENT_KINDS, RELEASE_REACH_VALUES, VARIANT_AUDIENCES, VARIANT_FAMILIES } from "@/modules/content/variant";
import { IMPORT_ROW_RESULT_STATES } from "@/modules/import/receipt";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
import type { MinorUnits, Money } from "@/modules/money/amount";
import { COMMITMENT_KINDS, RECURRING_BUCKETS } from "@/modules/support/buckets";
import { GOAL_MEASURE } from "@/modules/support/goal";
import { DATE_PRECISIONS, type DatePrecision } from "@/modules/time/civil";
import { REPEAT_PROFILES, SERIES_STATES, type RepeatProfile } from "@/modules/time/recurrence";
/** The field shapes the stored records share, stated once so each record's table reads as its field list. */ const text = z.string().min(1);
const nullableText = text.nullable();
const optionalText = text.optional();
const textList = z.array(text);
/** A stored record's shape as every reader sees it. */
export type StoredRecord<T> = T extends string | number | boolean | bigint | symbol | null | undefined ? T : unknown extends T ? T : T extends (infer Item)[] ? readonly StoredRecord<Item>[] : { readonly [K in keyof T]: StoredRecord<T[K]> };
export const VALUE_STATES = ["value", "zero", "unknown", "withheld", "unavailable", "incomplete-subtotal"] as const;
export type ValueState = (typeof VALUE_STATES)[number];
export type RecordedValueState = Exclude<ValueState, "incomplete-subtotal">;
export const recordedValueStateSchema: z.ZodType<RecordedValueState> = z.enum(["value", "zero", "unknown", "withheld", "unavailable"]);
type BrandedIdentifier<Name extends string> = string & { readonly __brand: Name };
export type OrganizationId = BrandedIdentifier<"OrganizationId">;
export type MinistryId = BrandedIdentifier<"MinistryId">;
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
export const sameScope = (left: Scope, right: Scope): boolean => left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId && left.principalId === right.principalId;
export const COVERAGE_STATES = ["complete", "partial", "unknown"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];
export type Coverage = { readonly from: string | null; readonly to: string | null; readonly state: CoverageState };
export type FinancialCoverage = Coverage & { readonly currency: string; readonly dateBasis: string };
export const coverageSchema: z.ZodType<Coverage> = z.object({ from: nullableText, to: nullableText, state: z.enum(COVERAGE_STATES) });
export type ReadAction = { readonly name: string; readonly available: boolean; readonly reason?: string };
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
/** Builds the envelope a read returns, deriving the one state a caller may not choose. */ export function buildEnvelope<T, C extends Coverage = Coverage>(input: ReadEnvelopeInput<T, C>): ReadEnvelope<T, C> {
  return Object.freeze({ data: input.data, scope: input.scope, source: input.source, revision: input.revision, asOf: input.asOf, coverage: input.coverage, valueStates: deriveValueStates(input.valueStates, input.coverage.state), actions: Object.freeze([...input.actions]) });
}
function deriveValueStates(recorded: Readonly<Record<string, RecordedValueState>>, coverageState: CoverageState): Readonly<Record<string, ValueState>> {
  const derived: Record<string, ValueState> = {};
  for (const [path, state] of Object.entries(recorded)) derived[path] = deriveValueState(state, coverageState);
  return Object.freeze(derived);
}
const deriveValueState = (recorded: RecordedValueState, coverageState: CoverageState): ValueState => (recorded === "withheld" || recorded === "unknown" || recorded === "unavailable" ? recorded : coverageState === "partial" ? "incomplete-subtotal" : recorded);
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type MutationInput<P> = { readonly operationId: string; readonly scope: Scope; readonly expectedRevision: string; readonly payload: P };
/** The one shape guard every mutation runs before any state change. */ export function mutationInputSchema<P>(payloadSchema: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.strictObject({
    operationId: z
      .string({ error: "A mutation names the operationId of the attempt it makes, so a replay is recognised by identity and a lost acknowledgement is re-queried rather than resent." })
      .regex(OPERATION_ID_PATTERN, "An operationId is the canonical lowercase UUID v4 that newOperationId mints, so a replay can be recognised by identity rather than guessed from a repeated payload."),
    scope: scopeSchema,
    expectedRevision: z
      .string({ error: "A mutation names the revision the caller read before it makes the change, so a write built on a version another change has replaced is a conflict rather than an overwrite." })
      .min(1, "A mutation states the revision it saw, so a stale write is a conflict rather than an overwrite."),
    payload: z.custom<unknown>((stated) => stated !== undefined, { error: "A mutation states the change it asks for as its payload, so the service can validate it before it reads or writes anything." }).pipe(payloadSchema),
  });
}
export const recordRevisionSchema: z.ZodType<string> = text;
export const storedCivilDateSchema: z.ZodType<string> = z.iso.date();
export const storedInstantSchema: z.ZodType<string> = z.iso.datetime({ offset: true });
export const storedDatePrecisionSchema: z.ZodType<DatePrecision> = z.enum(DATE_PRECISIONS);
export const sourceReferenceSchema: z.ZodType<SourceReference> = z.object({ system: text, reference: text });
// The field shapes every record's table repeats, under a short local name, so each record's schema reads as its field list.
const rev = recordRevisionSchema,
  pid = principalIdSchema,
  mid = ministryIdSchema,
  sid = supportSubjectIdSchema,
  date = storedCivilDateSchema,
  inst = storedInstantSchema,
  prec = storedDatePrecisionSchema,
  ref = sourceReferenceSchema,
  opt = nullableText,
  ids = textList;
export const moneySchema: z.ZodType<Money> = z.object({ currency: text, minorUnits: z.int() }).transform((stored): Money => ({ currency: stored.currency, minorUnits: stored.minorUnits as MinorUnits }));
export const RECORD_AUDIENCES = ["private", "shared"] as const;
export type RecordAudience = (typeof RECORD_AUDIENCES)[number];
export const recordAudienceSchema: z.ZodType<RecordAudience> = z.enum(RECORD_AUDIENCES);
export const SESSION_STATES = ["signed-in", "unavailable", "denied", "expired", "no-access"] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const sessionStateSchema: z.ZodType<SessionState> = z.enum(SESSION_STATES);
export const admittedMembershipSchema = z.object({ organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema, organizationLabel: optionalText, ministryLabel: optionalText });
export type AdmittedMembership = StoredRecord<z.infer<typeof admittedMembershipSchema>>;
export type SessionClockOffset = { readonly milliseconds: number };
export const sessionClockOffsetSchema: z.ZodType<SessionClockOffset> = z.object({ milliseconds: z.int() });
export const sessionContextRecordSchema = z.object({
  sessionId: text,
  principalId: principalIdSchema,
  admittedMemberships: z.array(admittedMembershipSchema),
  selectedOrganizationId: organizationIdSchema.nullable(),
  selectedMinistryId: ministryIdSchema.nullable(),
  selectedSupportSubjectId: supportSubjectIdSchema.nullable(),
  sessionState: sessionStateSchema,
  scenarioId: text,
  clockOffset: sessionClockOffsetSchema,
  revision: recordRevisionSchema,
});
export type SessionContextRecord = StoredRecord<z.infer<typeof sessionContextRecordSchema>>;
export const PARTNER_KINDS = ["person", "household", "church", "organization", "private-preparation"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const partnerKindSchema: z.ZodType<PartnerKind> = z.enum(PARTNER_KINDS);
export const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const;
export type ContactMethodKind = (typeof CONTACT_METHOD_KINDS)[number];
export type PartnerContactMethod = { readonly kind: ContactMethodKind; readonly value: string; readonly permitted: boolean; readonly verified: false };
export type PartnerRestriction = { readonly kind: string; readonly detail: string };
export type PartnerNameParts = { readonly given: string | null; readonly family: string | null; readonly additional: readonly string[] };
export const partnerContactMethodSchema: z.ZodType<PartnerContactMethod> = z.object({ kind: z.enum(CONTACT_METHOD_KINDS), value: text, permitted: z.boolean(), verified: z.literal(false) });
export const partnerRestrictionSchema: z.ZodType<PartnerRestriction> = z.object({ kind: text, detail: text });
export const partnerNamePartsSchema: z.ZodType<PartnerNameParts> = z.object({ given: nullableText, family: nullableText, additional: textList });
const partnerRecordShape = z.object({
  partnerId: text,
  kind: partnerKindSchema,
  displayName: text,
  nameParts: partnerNamePartsSchema.nullable(),
  contactMethods: z.array(partnerContactMethodSchema),
  restrictions: z.array(partnerRestrictionSchema),
  tags: textList,
  favourite: z.boolean(),
  stage: nullableText,
  audience: recordAudienceSchema,
  revision: recordRevisionSchema,
  source: sourceReferenceSchema.nullable(),
});
export type PartnerRecord = StoredRecord<z.infer<typeof partnerRecordShape>>;
export const partnerRecordSchema: z.ZodType<PartnerRecord> = partnerRecordShape;
export type PrivateNoteRecord = { readonly noteId: string; readonly partnerId: string; readonly authorPrincipalId: PrincipalId; readonly body: string; readonly audience: "private"; readonly createdAt: string; readonly revision: string };
export const privateNoteRecordSchema: z.ZodType<PrivateNoteRecord> = z.object({ noteId: text, partnerId: text, authorPrincipalId: principalIdSchema, body: z.string(), audience: z.literal("private"), createdAt: storedInstantSchema, revision: recordRevisionSchema });
export type InteractionParticipant = { readonly role: string; readonly partnerId: string | null; readonly principalId: PrincipalId | null };
export const interactionParticipantSchema: z.ZodType<InteractionParticipant> = z.object({ role: text, partnerId: nullableText, principalId: principalIdSchema.nullable() });
export const interactionNoteSchema = z.object({ body: z.string(), audience: recordAudienceSchema, authorPrincipalId: principalIdSchema.optional() });
export type InteractionNote = StoredRecord<z.infer<typeof interactionNoteSchema>>;
export const interactionRecordSchema = z
  .object({ interactionId: text, partnerId: text, type: text, occurredOn: date.nullable(), precision: prec, outcome: z.string(), participants: z.array(interactionParticipantSchema), note: interactionNoteSchema.nullable(), provenance: ref.nullable(), revision: rev })
  .refine((record) => (record.precision === "unknown") === (record.occurredOn === null), { path: ["occurredOn"], message: "An unrecorded date is stated as unknown precision with no date, and a known or approximate date states the day it refers to, so the two never disagree." });
export type InteractionRecord = StoredRecord<z.infer<typeof interactionRecordSchema>>;
export const TASK_STATUSES = ["open", "completed", "reopened", "cancelled"] as const;
export type TaskRecordStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema: z.ZodType<TaskRecordStatus> = z.enum(TASK_STATUSES);
export const TASK_KINDS = ["default", "meeting"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
const PLANNED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const taskRecordSchema = z
  .object({
    taskId: text,
    title: text,
    category: nullableText,
    dueOn: storedCivilDateSchema.nullable(),
    plannedTime: z.string().regex(PLANNED_TIME_PATTERN).nullable(),
    timeZone: nullableText,
    kind: z.enum(TASK_KINDS),
    status: taskStatusSchema,
    partnerId: nullableText,
    initiativeId: nullableText,
    seriesId: nullableText,
    ownerPrincipalId: principalIdSchema,
    note: z.string().nullable(),
    revision: recordRevisionSchema,
  })
  .refine((task) => task.plannedTime === null || (task.kind === "meeting" && task.timeZone !== null), { path: ["plannedTime"], message: "A planned time belongs to a meeting task and always discloses the zone it is stated in, so a wall-clock time is never read as an instant in an assumed zone." });
export type TaskRecord = StoredRecord<z.infer<typeof taskRecordSchema>>;
/** The fingerprint of the task meaning a shared summary's description was reviewed against. */
export const taskReviewedFingerprint = (task: TaskRecord): string => [task.taskId, task.title, task.category ?? "", task.note ?? ""].join("\u0000");
export type SeriesEndRecord = { readonly kind: "on-date"; readonly on: string } | { readonly kind: "after-count"; readonly count: number } | { readonly kind: "ongoing-personal-policy" };
export const seriesEndRecordSchema: z.ZodType<SeriesEndRecord> = z.discriminatedUnion("kind", [z.object({ kind: z.literal("on-date"), on: storedCivilDateSchema }), z.object({ kind: z.literal("after-count"), count: z.int().min(1) }), z.object({ kind: z.literal("ongoing-personal-policy") })]);
export type SeriesRuleRecord = { readonly profile: RepeatProfile; readonly interval: number; readonly dayOfMonth: number | null; readonly firstDueOn: string; readonly planningTimeZone: string; readonly end: SeriesEndRecord };
export const seriesRuleRecordSchema: z.ZodType<SeriesRuleRecord> = z.object({ profile: z.enum(REPEAT_PROFILES), interval: z.int().min(1), dayOfMonth: z.int().min(1).max(31).nullable(), firstDueOn: storedCivilDateSchema, planningTimeZone: text, end: seriesEndRecordSchema });
export type SeriesRuleRevisionRecord = { readonly revisionId: string; readonly effectiveFrom: string; readonly rule: SeriesRuleRecord };
export const seriesRuleRevisionRecordSchema: z.ZodType<SeriesRuleRevisionRecord> = z.object({ revisionId: text, effectiveFrom: storedCivilDateSchema, rule: seriesRuleRecordSchema });
export const taskSeriesRecordSchema = z.object({ seriesId: text, ownerPrincipalId: pid, title: text, currentRule: seriesRuleRecordSchema, effectiveRevisions: z.array(seriesRuleRevisionRecordSchema), currentOccurrenceId: opt, state: z.enum(SERIES_STATES), planNeedsReview: z.boolean(), revision: rev });
export type TaskSeriesRecord = StoredRecord<z.infer<typeof taskSeriesRecordSchema>>;
export const INITIATIVE_STATES = ["open", "closed"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];
export type InitiativePeriod = { readonly from: string | null; readonly to: string | null };
export const initiativePeriodSchema: z.ZodType<InitiativePeriod> = z.object({ from: storedCivilDateSchema.nullable(), to: storedCivilDateSchema.nullable() });
export const initiativeRecordSchema = z.object({ initiativeId: text, name: text, purpose: text, ministryContextId: mid, responsiblePrincipalId: pid, period: initiativePeriodSchema.nullable(), state: z.enum(INITIATIVE_STATES), closureDisposition: opt, revision: rev });
export type InitiativeRecord = StoredRecord<z.infer<typeof initiativeRecordSchema>>;
export const INITIATIVE_MEMBER_STATES = ["included", "removed", "excluded"] as const;
export type InitiativeMemberState = (typeof INITIATIVE_MEMBER_STATES)[number];
export const INITIATIVE_STAGES = ["Not yet asked", "Asked", "Answered", "Follow up due", "Paused"] as const;
export type InitiativeMemberHistoryEntry = { readonly state: InitiativeMemberState; readonly at: string; readonly byPrincipalId: PrincipalId; readonly reason: string | null };
export const initiativeMemberHistoryEntrySchema: z.ZodType<InitiativeMemberHistoryEntry> = z.object({ state: z.enum(INITIATIVE_MEMBER_STATES), at: storedInstantSchema, byPrincipalId: principalIdSchema, reason: nullableText });
export const initiativeMemberRecordSchema = z.object({ memberId: text, initiativeId: text, partnerId: text, state: z.enum(INITIATIVE_MEMBER_STATES), stage: opt, addedAt: inst, returnedAt: inst.nullable(), history: z.array(initiativeMemberHistoryEntrySchema), revision: rev });
export type InitiativeMemberRecord = StoredRecord<z.infer<typeof initiativeMemberRecordSchema>>;
export const REQUEST_RESPONSE_KINDS = ["agreed", "conditional", "partial", "deferred", "declined", "unanswered", "needs-clarification"] as const;
export type RequestResponseKind = (typeof REQUEST_RESPONSE_KINDS)[number];
export type RequestTerms = { readonly version: string; readonly money: { readonly amount: Money; readonly cadence: string | null; readonly term: string | null } | null; readonly nonFinancial: string | null };
export type RequestPresentation = { readonly presentedOn: string; readonly manner: string; readonly versionRef: string };
export type RequestResponse = { readonly kind: RequestResponseKind; readonly respondentId: string; readonly standingEvidence: string | null; readonly termsVersionRef: string; readonly recordedAt: string };
export const requestTermsSchema: z.ZodType<RequestTerms> = z.object({ version: text, money: z.object({ amount: moneySchema, cadence: nullableText, term: nullableText }).nullable(), nonFinancial: nullableText });
export const requestPresentationSchema: z.ZodType<RequestPresentation> = z.object({ presentedOn: storedCivilDateSchema, manner: text, versionRef: text });
export const requestResponseSchema: z.ZodType<RequestResponse> = z.object({ kind: z.enum(REQUEST_RESPONSE_KINDS), respondentId: text, standingEvidence: nullableText, termsVersionRef: text, recordedAt: storedInstantSchema });
export const requestRecordSchema = z.object({ requestId: text, initiativeId: text, recipientPartnerId: text, representedOrganizationId: opt, purpose: text, terms: requestTermsSchema, presentation: requestPresentationSchema.nullable(), response: requestResponseSchema.nullable(), nextWorkIds: ids, revision: rev });
export type RequestRecord = StoredRecord<z.infer<typeof requestRecordSchema>>;
export const REFERRAL_WINDOW_KINDS = ["new", "continued"] as const;
export type ReferralWindowKind = (typeof REFERRAL_WINDOW_KINDS)[number];
export const referralCycleRecordSchema = z
  .object({
    referralId: text,
    partnerId: text,
    originalIntroductionOn: storedCivilDateSchema.nullable(),
    datePrecision: storedDatePrecisionSchema,
    sourceZone: text,
    sourceReference: sourceReferenceSchema.nullable(),
    cycleIndex: z.int().nonnegative(),
    windowKind: z.enum(REFERRAL_WINDOW_KINDS),
    windowStart: storedInstantSchema.nullable(),
    windowEnd: storedInstantSchema.nullable(),
    consumed: z.boolean(),
    predecessorId: nullableText,
    revision: recordRevisionSchema,
  })
  .refine((referral) => referral.datePrecision !== "unknown" || referral.originalIntroductionOn === null, { path: ["originalIntroductionOn"], message: "An unknown introduction date states no date at all, rather than a guessed one that a later reader would treat as evidence." })
  .refine((referral) => referral.datePrecision === "date" || referral.windowEnd === null, { path: ["windowEnd"], message: "Only a date-precise introduction yields a deadline. An approximate or unknown date states no endpoint, no Active or Expired judgement and no Continue action, so neither can ever be given one." });
export type ReferralCycleRecord = StoredRecord<z.infer<typeof referralCycleRecordSchema>>;
export const SUPPORT_BASES = ["effective_cash_allocation"] as const;
export type SupportBasis = (typeof SUPPORT_BASES)[number];
export const SUPPORT_GOAL_MEASURES = [GOAL_MEASURE] as const;
export type SupportGoalMeasure = (typeof SUPPORT_GOAL_MEASURES)[number];
export type SupportGoalRecord = { readonly amount: Money; readonly measure: SupportGoalMeasure; readonly effectiveFrom: string; readonly revision: string };
export const supportGoalRecordSchema: z.ZodType<SupportGoalRecord> = z.object({ amount: moneySchema, measure: z.enum(SUPPORT_GOAL_MEASURES), effectiveFrom: storedCivilDateSchema, revision: recordRevisionSchema });
export const supportProjectionRecordSchema = z.object({ supportSubjectId: sid, basis: z.enum(SUPPORT_BASES), currencyExponents: z.record(text, z.int().nonnegative()), coverage: coverageSchema, asOf: inst, lastSourceUpdate: inst, goal: supportGoalRecordSchema.nullable(), source: ref, revision: rev });
export type SupportProjectionRecord = StoredRecord<z.infer<typeof supportProjectionRecordSchema>>;
export type GiftAttribution = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
export const giftAttributionSchema: z.ZodType<GiftAttribution> = z.discriminatedUnion("kind", [z.object({ kind: z.literal("partner"), partnerId: text }), z.object({ kind: z.literal("anonymous") }), z.object({ kind: z.literal("unresolved") })]);
export type GiftRowRecord = StoredRecord<z.infer<typeof giftRowRecordSchema>>;
export const giftRowRecordSchema = z.object({ giftRowId: text, giftId: text, allocationId: opt, amount: moneySchema, originalGiftOn: date.nullable(), datePrecision: prec, designation: opt, attribution: giftAttributionSchema, refundOf: opt, provenance: ref, entryOn: date, revision: rev });
export type CommitmentRowRecord = StoredRecord<z.infer<typeof commitmentRowRecordSchema>>;
export type CommitmentPauseRecord = { readonly state: "active" | "paused"; readonly resumeOn: string | null };
export type CommitmentFixedTotalRecord = { readonly promised: Money; readonly fulfilled: Money; readonly released: Money; readonly remaining: Money };
export const commitmentPauseRecordSchema: z.ZodType<CommitmentPauseRecord> = z.object({ state: z.enum(["active", "paused"]), resumeOn: storedCivilDateSchema.nullable() });
export const commitmentFixedTotalRecordSchema: z.ZodType<CommitmentFixedTotalRecord> = z.object({ promised: moneySchema, fulfilled: moneySchema, released: moneySchema, remaining: moneySchema });
export const commitmentRowRecordSchema = z
  .object({
    commitmentRowId: text,
    kind: z.enum(COMMITMENT_KINDS),
    cadence: text,
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
export type ContentFamily = (typeof VARIANT_FAMILIES)[number];
export type ContentKind = (typeof CONTENT_KINDS)[number];
export type GivingBinding = { readonly designation: SourceReference; readonly label: string };
export type ContentDocumentRecord = { readonly documentId: string; readonly family: ContentFamily; readonly kind: ContentKind; readonly sourceSubject: SourceReference; readonly siteId: string; readonly givingBinding: GivingBinding | null; readonly managedFields: readonly string[]; readonly revision: string };
export const givingBindingSchema: z.ZodType<GivingBinding> = z.object({ designation: sourceReferenceSchema, label: text });
export const contentDocumentRecordSchema: z.ZodType<ContentDocumentRecord> = z.object({ documentId: text, family: z.enum(VARIANT_FAMILIES), kind: z.enum(CONTENT_KINDS), sourceSubject: ref, siteId: text, givingBinding: givingBindingSchema.nullable(), managedFields: ids, revision: rev });
export type ContentAudience = (typeof VARIANT_AUDIENCES)[number];
export const contentAudienceSchema: z.ZodType<ContentAudience> = z.enum(VARIANT_AUDIENCES);
export type ContentTranslationSource = { readonly variantId: string; readonly revisionId: string };
export type ContentVariantRecord = StoredRecord<z.infer<typeof contentVariantRecordSchema>>;
export const contentTranslationSourceSchema: z.ZodType<ContentTranslationSource> = z.object({ variantId: text, revisionId: text });
export const contentVariantRecordSchema = z.object({ variantId: text, documentId: text, audience: contentAudienceSchema, locale: text, direction: z.enum(CONTENT_DIRECTIONS), draftRevisionId: opt, candidateId: opt, releaseHeadId: opt, translationSource: contentTranslationSourceSchema.nullable(), revision: rev });
export type MediaPlacementRecord = { readonly placementId: string; readonly assetId: string; readonly sectionElement: string | null; readonly position: number; readonly altText: string; readonly caption: string | null; readonly credit: string | null };
export type ContentCaptionTrackRecord = { readonly assetId: string; readonly renditionId: string; readonly language: string; readonly label: string; readonly isDefault: boolean };
export type SharePresentationRecord = { readonly title: string; readonly description: string; readonly imageAssetId: string | null; readonly imageAltText: string | null };
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
export const mediaPlacementRecordSchema: z.ZodType<MediaPlacementRecord> = z.object({ placementId: text, assetId: text, sectionElement: nullableText, position: z.int().nonnegative(), altText: text, caption: nullableText, credit: nullableText });
export const contentCaptionTrackRecordSchema: z.ZodType<ContentCaptionTrackRecord> = z.object({ assetId: text, renditionId: text, language: text, label: text, isDefault: z.boolean() });
export const sharePresentationRecordSchema: z.ZodType<SharePresentationRecord> = z.object({ title: text, description: z.string(), imageAssetId: nullableText, imageAltText: nullableText });
export const storedContentRevisionRecordSchema = z.object({
  revisionId: text,
  variantId: text,
  body: z.unknown(),
  mediaPlacements: z.array(mediaPlacementRecordSchema),
  captions: z.array(contentCaptionTrackRecordSchema),
  sharePresentation: sharePresentationRecordSchema,
  contentChecksum: text,
  authorPrincipalId: principalIdSchema,
  createdAt: storedInstantSchema,
  revision: recordRevisionSchema,
});
export type StoredContentRevisionRecord = StoredRecord<z.infer<typeof storedContentRevisionRecordSchema>>;
/** Every section type a Page can be composed from: the union of the two family catalogues, and the set a schema or a stored section is checked against. */
export const PAGE_SECTION_TYPES = ["introduction", "story", "prayer", "milestone", "image", "video", "giving", "progress"] as const;
export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number];
/** The shape of the two catalogues: one admitted tuple per page family, keyed by the family a section change addresses. */
type PageFamilyCatalogues = Readonly<Record<Exclude<ContentFamily, "update">, readonly PageSectionType[]>>;
/** The section types each page family admits, stated once per family so a section is admitted or refused by the family the change addresses rather than by one list both families share. The two families hold the same eight types today and each still states its own tuple: the day one family's set differs, the other family's admission does not move with it. */
export const PAGE_SECTION_TYPES_BY_FAMILY: PageFamilyCatalogues = { "worker-page": ["introduction", "story", "prayer", "milestone", "image", "video", "giving", "progress"], "project-page": ["introduction", "story", "prayer", "milestone", "image", "video", "giving", "progress"] };
type FamilyAdmittedSectionType = (typeof PAGE_SECTION_TYPES_BY_FAMILY)[keyof typeof PAGE_SECTION_TYPES_BY_FAMILY][number];
type SectionTypeOutsideEveryFamily = Exclude<PageSectionType, FamilyAdmittedSectionType>;
/** Every type the union states is admitted by a page family, so no schema accepts a type no Page can be composed with. */
export const PAGE_SECTION_TYPES_ARE_ALL_ADMITTED: SectionTypeOutsideEveryFamily extends never ? true : false = true;
export const PAGE_PRESET_IDS = ["preset-opening-and-story", "preset-story-and-prayer"] as const;
export type PagePresetId = (typeof PAGE_PRESET_IDS)[number];
export const MEDIA_ASSET_KINDS = ["image", "video"] as const;
export type MediaAssetKind = (typeof MEDIA_ASSET_KINDS)[number];
export const MEDIA_ASSET_RENDITION_PURPOSES = ["display", "playback", "poster", "captions", "transcript"] as const satisfies readonly MediaRenditionPurpose[];
type UnlistedRenditionPurpose = Exclude<MediaRenditionPurpose, (typeof MEDIA_ASSET_RENDITION_PURPOSES)[number]>;
export const MEDIA_ASSET_RENDITION_PURPOSES_ARE_COMPLETE: UnlistedRenditionPurpose extends never ? true : false = true;
export type MediaAssetRenditionPurpose = (typeof MEDIA_ASSET_RENDITION_PURPOSES)[number];
export type MediaAssetProfileRecord = { readonly container: string; readonly codec: string; readonly durationSeconds: number | null; readonly width: number; readonly height: number };
export type MediaAssetRenditionRecord = { readonly renditionId: string; readonly purpose: MediaAssetRenditionPurpose; readonly bytesRef: string; readonly mimeType: string };
export type MediaTagVerificationRecord = { readonly checked: boolean; readonly residualTags: readonly string[] };
export type MediaAssetRecord = StoredRecord<z.infer<typeof mediaAssetRecordSchema>>;
export const mediaAssetProfileRecordSchema: z.ZodType<MediaAssetProfileRecord> = z.object({ container: text, codec: text, durationSeconds: z.number().nonnegative().nullable(), width: z.int().nonnegative(), height: z.int().nonnegative() });
export const mediaAssetRenditionRecordSchema: z.ZodType<MediaAssetRenditionRecord> = z.object({ renditionId: text, purpose: z.enum(MEDIA_ASSET_RENDITION_PURPOSES), bytesRef: text, mimeType: text });
export const mediaTagVerificationRecordSchema: z.ZodType<MediaTagVerificationRecord> = z.object({ checked: z.boolean(), residualTags: textList });
export const mediaAssetRecordSchema = z.object({ assetId: text, kind: z.enum(MEDIA_ASSET_KINDS), profileCheck: mediaAssetProfileRecordSchema, sourceOriginalRef: text, renditions: z.array(mediaAssetRenditionRecordSchema), scope: scopeSchema, tagVerification: mediaTagVerificationRecordSchema, revision: rev });
export type ReleaseReach = (typeof RELEASE_REACH_VALUES)[number];
export const releaseReachSchema: z.ZodType<ReleaseReach> = z.enum(RELEASE_REACH_VALUES);
export type ReleaseRecord = StoredRecord<z.infer<typeof releaseRecordSchema>>;
export const releaseRecordSchema = z.object({ releaseId: text, variantId: text, revisionId: text, audience: contentAudienceSchema, locale: text, publishedAt: storedInstantSchema, reach: releaseReachSchema, withdrawnAt: storedInstantSchema.nullable(), supersededBy: nullableText, revision: recordRevisionSchema });
export const NOTIFICATION_PURPOSES = ["update-email"] as const;
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number];
export const NOTIFICATION_RECIPIENT_STATES = ["accepted", "failed", "unknown"] as const;
export type NotificationRecipientState = (typeof NOTIFICATION_RECIPIENT_STATES)[number];
export type NotificationIntentRecord = { readonly intentId: string; readonly publisherId: string; readonly purpose: NotificationPurpose; readonly documentId: string; readonly releaseId: string; readonly intendedAt: string; readonly ceilingCount: number; readonly revision: string };
export type NotificationRecipientOutcomeRecord = { readonly recipientId: string; readonly renditionId: string; readonly state: NotificationRecipientState; readonly at: string };
export type NotificationSendResultRecord = { readonly sendResultId: string; readonly intentId: string; readonly recipients: readonly NotificationRecipientOutcomeRecord[]; readonly unserved: readonly NotificationUnservedRecipientRecord[]; readonly recordedAt: string; readonly revision: string };
export const notificationRecipientOutcomeRecordSchema: z.ZodType<NotificationRecipientOutcomeRecord> = z.object({ recipientId: text, renditionId: text, state: z.enum(NOTIFICATION_RECIPIENT_STATES), at: storedInstantSchema });
export const NOTIFICATION_UNSERVED_REASONS = ["already-covered", "no-eligible-rendition"] as const;
export type NotificationUnservedRecipientRecord =
  | { readonly recipientId: string; readonly reason: "already-covered"; readonly coveredByIntentId: string; readonly coveredByRenditionId: string }
  | { readonly recipientId: string; readonly reason: "no-eligible-rendition"; readonly renditionRefusal: RenditionRefusalReason };
export const notificationUnservedRecipientRecordSchema: z.ZodType<NotificationUnservedRecipientRecord> = z.discriminatedUnion("reason", [
  z.object({ recipientId: text, reason: z.literal("already-covered"), coveredByIntentId: text, coveredByRenditionId: text }),
  z.object({ recipientId: text, reason: z.literal("no-eligible-rendition"), renditionRefusal: z.enum(RENDITION_REFUSAL_REASONS) }),
]);
export const notificationIntentRecordSchema: z.ZodType<NotificationIntentRecord> = z.object({ intentId: text, publisherId: text, purpose: z.enum(NOTIFICATION_PURPOSES), documentId: text, releaseId: text, intendedAt: storedInstantSchema, ceilingCount: z.int().nonnegative(), revision: recordRevisionSchema });
export const notificationSendResultRecordSchema: z.ZodType<NotificationSendResultRecord> = z.object({ sendResultId: text, intentId: text, recipients: z.array(notificationRecipientOutcomeRecordSchema), unserved: z.array(notificationUnservedRecipientRecordSchema), recordedAt: inst, revision: rev });
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export type MembershipRecord = StoredRecord<z.infer<typeof membershipRecordSchema>>;
export const membershipRecordSchema = z.object({ membershipId: text, email: text, displayName: opt, publisherId: text, purpose: z.enum(NOTIFICATION_PURPOSES), state: z.enum(MEMBERSHIP_STATES), acceptedAt: inst.nullable(), confirmationDeadline: inst.nullable(), languagePreference: opt, revision: rev });
export const COACHING_GRANT_STATES = ["invited", "accepted", "active", "revoked", "expired", "ended", "left"] as const;
export type CoachingModuleSelection = Readonly<Record<ModuleKey, boolean>>;
export type CoachingDurationRecord = { readonly kind: "ongoing" | "through-date"; readonly cutoffInstant: string | null; readonly frozenZone: string };
export type CoachingFinancialRangeRecord = { readonly from: string; readonly to: string; readonly currency: string };
export type CoachingInvitationRecord = { readonly issuedAt: string; readonly expiresAt: string; readonly supersededBy: string | null };
export type CoachingGrantRecord = StoredRecord<z.infer<typeof coachingGrantRecordSchema>>;
const coachingModuleSelectionShape: Readonly<Record<ModuleKey, z.ZodBoolean>> = { "support-goal": z.boolean(), "support-results": z.boolean(), targets: z.boolean(), "check-ins": z.boolean(), "task-summaries": z.boolean() };
export const coachingModuleSelectionSchema: z.ZodType<CoachingModuleSelection> = z.object(coachingModuleSelectionShape);
export const coachingDurationRecordSchema: z.ZodType<CoachingDurationRecord> = z
  .object({ kind: z.enum(["ongoing", "through-date"]), cutoffInstant: storedInstantSchema.nullable(), frozenZone: text })
  .refine((duration) => (duration.kind === "through-date") === (duration.cutoffInstant !== null), { path: ["cutoffInstant"], message: "A share-through grant states the cutoff it was accepted with, and an ongoing grant states none: a missing duration is not permission and never reads as an unbounded one." });
export const coachingFinancialRangeRecordSchema: z.ZodType<CoachingFinancialRangeRecord> = z.object({ from: storedCivilDateSchema, to: storedCivilDateSchema, currency: text });
export const coachingInvitationRecordSchema: z.ZodType<CoachingInvitationRecord> = z.object({ issuedAt: storedInstantSchema, expiresAt: storedInstantSchema, supersededBy: nullableText });
export const coachingGrantRecordSchema = z.object({
  grantId: text,
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
export type CoachingTargetMeasure = (typeof TARGET_MEASURES)[number];
export const COACHING_TARGET_PERIOD_KINDS = ["weekly", "monthly", "custom"] as const;
export type CoachingTargetPeriodKind = (typeof COACHING_TARGET_PERIOD_KINDS)[number];
export type CoachingTargetPeriodRecord = { readonly kind: CoachingTargetPeriodKind; readonly from: string | null; readonly to: string | null };
export type CoachingTargetVersionRecord = { readonly revisionId: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly quantity: number; readonly measure: CoachingTargetMeasure; readonly calendarStart: string };
export type CoachingTargetRecord = StoredRecord<z.infer<typeof coachingTargetRecordSchema>>;
export const coachingTargetPeriodRecordSchema: z.ZodType<CoachingTargetPeriodRecord> = z
  .object({ kind: z.enum(COACHING_TARGET_PERIOD_KINDS), from: storedCivilDateSchema.nullable(), to: storedCivilDateSchema.nullable() })
  .refine((period) => (period.kind === "custom") === (period.from !== null && period.to !== null), { path: ["from"], message: "A one-off custom period states both its first and last day, and a recurring period states neither: a recurring target is bucketed by the calendar, so it cannot carry a range." });
export const coachingTargetVersionRecordSchema: z.ZodType<CoachingTargetVersionRecord> = z.object({ revisionId: text, effectiveFrom: storedCivilDateSchema, effectiveTo: storedCivilDateSchema.nullable(), quantity: z.int().nonnegative(), measure: z.enum(TARGET_MEASURES), calendarStart: storedCivilDateSchema });
export const coachingTargetRecordSchema = z.object({
  targetId: text,
  workerPrincipalId: principalIdSchema,
  privateLabel: text,
  measure: z.enum(TARGET_MEASURES),
  quantity: z.int().nonnegative(),
  period: coachingTargetPeriodRecordSchema,
  calendarStart: storedCivilDateSchema,
  homePlacement: z.enum(["placed", "unplaced"]),
  state: z.enum(["active", "paused", "ended"]),
  versions: z.array(coachingTargetVersionRecordSchema),
  revision: recordRevisionSchema,
});
const scalarCount = (value: string): number => [...value].length;
export type CoachingCheckInQuestionRecord = { readonly wording: string; readonly order: number };
export type CoachingCheckInAnswerRecord = { readonly questionOrder: number | null; readonly text: string };
export type CoachingCheckInPrivateDraftRecord = { readonly revisionId: string; readonly questions: readonly CoachingCheckInQuestionRecord[]; readonly questionsCapturedAt: string; readonly answers: readonly CoachingCheckInAnswerRecord[]; readonly savedAt: string };
export type CoachingCheckInSharedRevisionRecord = StoredRecord<z.infer<typeof coachingCheckInSharedRevisionRecordSchema>>;
export type CoachingCheckInRecord = { readonly checkInId: string; readonly workerPrincipalId: PrincipalId; readonly grantId: string; readonly privateDraft: CoachingCheckInPrivateDraftRecord | null; readonly shared: CoachingCheckInSharedRevisionRecord | null; readonly revision: string };
export const coachingCheckInQuestionRecordSchema: z.ZodType<CoachingCheckInQuestionRecord> = z.object({
  wording: z.string().refine((wording) => scalarCount(wording) <= 500, { message: "A question is at most 500 Unicode scalars; a longer one is refused with its count rather than shortened, because a shortened question would change what the worker asked." }),
  order: z.int().nonnegative(),
});
export const coachingCheckInAnswerRecordSchema: z.ZodType<CoachingCheckInAnswerRecord> = z.object({
  questionOrder: z.int().nonnegative().nullable(),
  text: z.string().refine((text) => scalarCount(text) <= 4000, { message: "An answer is at most 4,000 Unicode scalars; a longer one is refused with its count rather than truncated, because a truncated answer would misstate what the worker wrote." }),
});
export const coachingCheckInPrivateDraftRecordSchema: z.ZodType<CoachingCheckInPrivateDraftRecord> = z.object({ revisionId: text, questions: z.array(coachingCheckInQuestionRecordSchema).max(5), questionsCapturedAt: inst, answers: z.array(coachingCheckInAnswerRecordSchema), savedAt: inst });
export const coachingCheckInSharedRevisionRecordSchema = z.object({
  revisionId: text,
  questions: z.array(coachingCheckInQuestionRecordSchema).max(5),
  questionsCapturedAt: storedInstantSchema,
  answers: z.array(coachingCheckInAnswerRecordSchema),
  recipientPrincipalIds: z.array(principalIdSchema),
  duration: coachingDurationRecordSchema,
  sharedAt: storedInstantSchema,
  updatedAt: storedInstantSchema,
  withdrawnAt: storedInstantSchema.nullable(),
});
export const coachingCheckInRecordSchema: z.ZodType<CoachingCheckInRecord> = z.object({ checkInId: text, workerPrincipalId: principalIdSchema, grantId: text, privateDraft: coachingCheckInPrivateDraftRecordSchema.nullable(), shared: coachingCheckInSharedRevisionRecordSchema.nullable(), revision: recordRevisionSchema });
export type CoachingTaskShareRecord = StoredRecord<z.infer<typeof coachingTaskShareRecordSchema>>;
export const coachingTaskShareRecordSchema = z.object({
  shareId: text,
  taskId: text,
  occurrenceId: text,
  reviewedSummary: z.object({ description: z.string(), codePoints: z.int().nonnegative(), reviewedAt: storedInstantSchema }),
  reviewedFingerprint: text,
  state: z.enum(["shared", "removed"]),
  revision: z.int().nonnegative(),
  withdrawnAt: storedInstantSchema.nullable().optional(),
});
export const OPERATION_OUTCOME_NAMES = ["accepted", "alreadyAccepted", "unchanged", "conflict", "denied", "invalid", "unavailable", "unknown"] as const;
export type OperationOutcomeName = (typeof OPERATION_OUTCOME_NAMES)[number];
export type StoredPerItemResult = { readonly targetId: string; readonly state: string; readonly revision?: string; readonly reasonCode?: string; readonly reason?: string };
const storedPerItemResultSchema: z.ZodType<StoredPerItemResult> = z.object({ targetId: text, state: text, revision: optionalText, reasonCode: optionalText, reason: z.string().optional() });
export type OperationRecord = StoredRecord<z.infer<typeof operationRecordSchema>>;
export const operationRecordSchema = z.object({ operationId: text, intentHash: text, scope: scopeSchema, outcome: z.enum(OPERATION_OUTCOME_NAMES), result: z.unknown(), revision: rev.optional(), created: ids.optional(), changed: ids.optional(), items: z.array(storedPerItemResultSchema).optional(), at: inst });
export const IMPORT_ROW_DECISIONS = ["new-private-entry", "reuse-authorized-identity", "skip", "unresolved"] as const;
export type ImportRowDecision = (typeof IMPORT_ROW_DECISIONS)[number];
export type ImportRowState = (typeof IMPORT_ROW_RESULT_STATES)[number];
export type ImportFileMetaRecord = { readonly name: string; readonly bytes: number; readonly rowCount: number; readonly columnCount: number };
export type ImportFileFingerprintRecord = { readonly checksum: string; readonly columnCount: number; readonly dataRowCount: number };
export type ImportCellCorrectionRecord = { readonly columnNumber: number; readonly value: string };
export type ImportMatchReferenceRecord = { readonly system: string; readonly reference: string };
export type ImportColumnAssignmentRecord = { readonly columnIndex: number; readonly header: string; readonly field: string | null };
export type ImportRowDecisionRecord = { readonly rowNumber: number; readonly decision: ImportRowDecision; readonly targetPartnerId: string | null; readonly corrections: readonly ImportCellCorrectionRecord[]; readonly candidate: ImportMatchReferenceRecord | null; readonly reason: string | null };
export type ImportRowResultRecord = { readonly rowNumber: number; readonly state: ImportRowState; readonly partnerId: string | null; readonly message: string | null };
export type ImportSummaryRecord = { readonly newEntries: number; readonly reusedIdentities: number; readonly skipped: number; readonly needsReview: number };
export type ImportProposalRecord = StoredRecord<z.infer<typeof importProposalRecordSchema>>;
export const importFileMetaRecordSchema: z.ZodType<ImportFileMetaRecord> = z.object({ name: text, bytes: z.int().nonnegative(), rowCount: z.int().nonnegative(), columnCount: z.int().nonnegative() });
export const importFileFingerprintRecordSchema: z.ZodType<ImportFileFingerprintRecord> = z.object({ checksum: text, columnCount: z.int().nonnegative(), dataRowCount: z.int().nonnegative() });
export const importCellCorrectionRecordSchema: z.ZodType<ImportCellCorrectionRecord> = z.object({ columnNumber: z.int().positive(), value: z.string() });
export const importMatchReferenceRecordSchema: z.ZodType<ImportMatchReferenceRecord> = z.object({ system: text, reference: text });
export const importColumnAssignmentRecordSchema: z.ZodType<ImportColumnAssignmentRecord> = z.object({ columnIndex: z.int().nonnegative(), header: text, field: nullableText });
export const importRowDecisionRecordSchema: z.ZodType<ImportRowDecisionRecord> = z.object({
  rowNumber: z.int().nonnegative(),
  decision: z.enum(IMPORT_ROW_DECISIONS),
  targetPartnerId: nullableText,
  corrections: z.array(importCellCorrectionRecordSchema).default([]),
  candidate: importMatchReferenceRecordSchema.nullable().default(null),
  reason: z.string().nullable().default(null),
});
export const importRowResultRecordSchema: z.ZodType<ImportRowResultRecord> = z.object({ rowNumber: z.int().nonnegative(), state: z.enum(IMPORT_ROW_RESULT_STATES), partnerId: nullableText, message: nullableText });
export const importSummaryRecordSchema: z.ZodType<ImportSummaryRecord> = z.object({ newEntries: z.int().nonnegative(), reusedIdentities: z.int().nonnegative(), skipped: z.int().nonnegative(), needsReview: z.int().nonnegative() });
export const importProposalRecordSchema = z.object({
  importOperationId: text,
  fileMeta: importFileMetaRecordSchema,
  fingerprint: importFileFingerprintRecordSchema,
  mapping: z.array(importColumnAssignmentRecordSchema),
  rowDecisions: z.array(importRowDecisionRecordSchema),
  summary: importSummaryRecordSchema,
  results: z.array(importRowResultRecordSchema),
  processedAt: storedInstantSchema.nullable(),
  revision: recordRevisionSchema,
});
/** Narrows a record to the fields a caller is authorised to see. */ export function project<T extends object, K extends keyof T>(record: T, visible: readonly K[]): Pick<T, K> {
  const projected = {} as Pick<T, K>;
  for (const key of visible) projected[key] = record[key];
  return projected;
}
