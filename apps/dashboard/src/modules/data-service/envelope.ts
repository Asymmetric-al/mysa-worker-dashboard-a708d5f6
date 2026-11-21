/**
 * The read envelope, the mutation request envelope, the single value-state vocabulary and the stored
 * form of every logical record this application keeps.
 *
 * Two contracts sit here, and they are the two halves of one agreement between a surface and the
 * service.
 *
 * A read answers with a {@link ReadEnvelope}: the data, the scope it was read in, the source it came
 * from, the revision a caller must present to change it, the scenario instant it was evaluated at,
 * its coverage, one value state per value-bearing path, and the actions currently available. No read
 * returns a bare result, because a bare result cannot say that a value is unknown rather than zero,
 * that a source is unavailable rather than empty, or that a subtotal covers only part of its period.
 *
 * A write presents a {@link MutationInput} — `{ operationId, scope, expectedRevision, payload }` —
 * and receives exactly one outcome from the closed set `./outcome` owns. The request envelope is
 * declared here, beside the read envelope, so that `./outcome` never needs to import this file and
 * the two modules stay acyclic.
 *
 * {@link ValueState} is declared once, here, and nowhere else. Each of its six members states a
 * different fact about a value, and the sixth — `incomplete-subtotal` — is derived by
 * {@link buildEnvelope} from a read's coverage rather than chosen by a caller, so no surface decides
 * for itself whether a subtotal is partial.
 *
 * The record shapes below are the stored JSON form: identifiers are opaque strings, a date is an ISO
 * string accompanied by the precision it is known to, an amount is `{ currency, minorUnits }` with its
 * currency exponent, and a source-derived field carries an opaque `{ system, reference }` pair. A
 * domain module's working type may hold `Temporal` values and brands; it is derived from a record at
 * the service boundary, and the record stays the one form written to, and read back from, the store.
 * Cross-record references are by identifier and scope — never by a display name, an email address or
 * a postal address, because equal-looking values establish neither identity nor authority.
 *
 * This module holds no behaviour beyond the envelope's derivation and {@link project}. It reads no
 * clock, no file, no network and no store, and it imports only `zod` plus type-only repository types,
 * so a Server Component, a Route Handler and a Client Component may all import it.
 */

import { z } from "zod";

import type { SourceReference } from "@/lib/ids";
import type { ContentDirection, ContentDocumentJson } from "@/modules/content/document";
import type { MinorUnits, Money } from "@/modules/money/amount";
import type { CommitmentKind, RecurringBucket } from "@/modules/support/buckets";
import type { DatePrecision } from "@/modules/time/civil";
import type { RepeatProfile, SeriesState } from "@/modules/time/recurrence";

// ---------------------------------------------------------------------------------------------
// Value states
// ---------------------------------------------------------------------------------------------

/**
 * Every fact a value-bearing field can be in, listed once so the closed set has a runtime form as
 * well as a type.
 *
 * `value` and `zero` are the two states of a known number, kept apart because a genuine zero and a
 * missing value must never render alike. `unknown` means the source did not establish a value,
 * `withheld` means an authorised read exists but this caller may not see the value, and `unavailable`
 * means the source behind the read is down. `incomplete-subtotal` is the only member a caller may not
 * choose: {@link buildEnvelope} derives it from coverage.
 */
export const VALUE_STATES = [
  "value",
  "zero",
  "unknown",
  "withheld",
  "unavailable",
  "incomplete-subtotal",
] as const;

/** The state of one value-bearing field. The only way a surface learns that a number is not a number. */
export type ValueState = (typeof VALUE_STATES)[number];

/**
 * The states a read may record for a path: every {@link ValueState} except the derived one.
 *
 * Typing the input of {@link buildEnvelope} this narrowly is what makes a caller passing
 * `incomplete-subtotal` a compile error rather than a quiet second producer of a derived fact.
 */
export type RecordedValueState = Exclude<ValueState, "incomplete-subtotal">;

/** Validates a state a surface or a stored dependency state may name. */
export const valueStateSchema: z.ZodType<ValueState> = z.enum(VALUE_STATES);

/** Validates a state a read may record, refusing the derived member at the boundary. */
export const recordedValueStateSchema: z.ZodType<RecordedValueState> = z.enum([
  "value",
  "zero",
  "unknown",
  "withheld",
  "unavailable",
]);

// ---------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------

/** A branded opaque identifier: an ordinary string at runtime, a distinct type at compile time. */
type BrandedIdentifier<Name extends string> = string & { readonly __brand: Name };

/**
 * The organisation a caller is acting in. A distinct type from the ministry, the support subject and
 * the principal, because the four are different references with different owners and authority.
 */
export type OrganizationId = BrandedIdentifier<"OrganizationId">;

/** The ministry whose records a caller is acting on, admitted by the selected organisation. */
export type MinistryId = BrandedIdentifier<"MinistryId">;

/** The finance and support subject a projection is scoped to — never the ministry it is reported in. */
export type SupportSubjectId = BrandedIdentifier<"SupportSubjectId">;

/** The acting user: the person a session resolved to, and the author of anything they write. */
export type PrincipalId = BrandedIdentifier<"PrincipalId">;

/**
 * Validates one opaque identifier.
 *
 * The brand is compile-time only, exactly as `MinorUnits` is, so this transform is the one place a
 * plain stored string becomes an identifier. Parsing with the exported schemas is therefore the only
 * way to mint a branded id from a record, and no module needs its own assertion helper.
 */
function identifierSchema<Name extends string>(): z.ZodType<BrandedIdentifier<Name>> {
  return z
    .string()
    .min(1)
    .transform((value) => value as BrandedIdentifier<Name>);
}

export const organizationIdSchema: z.ZodType<OrganizationId> = identifierSchema<"OrganizationId">();
export const ministryIdSchema: z.ZodType<MinistryId> = identifierSchema<"MinistryId">();
export const supportSubjectIdSchema: z.ZodType<SupportSubjectId> =
  identifierSchema<"SupportSubjectId">();
export const principalIdSchema: z.ZodType<PrincipalId> = identifierSchema<"PrincipalId">();

/**
 * The exact authority a read ran under, and the context a mutation claims to act in.
 *
 * It is stated explicitly rather than inferred from the records, because the four identifiers are
 * different types with different owners: an equal-looking organisation id, ministry id, support
 * subject id or principal id from another record establishes nothing about this context.
 */
export interface Scope {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
  readonly principalId: PrincipalId;
}

/** Validates a scope, including one that arrived from a browser request body. */
export const scopeSchema: z.ZodType<Scope> = z.object({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
  principalId: principalIdSchema,
});

/**
 * Reports whether two scopes are the same authority: exact equality on all four identifiers.
 *
 * Written as one function so a caller comparing contexts cannot check three fields and forget the
 * fourth, and likewise cannot reach for a display name, an email address or a postal address, none of
 * which establishes identity.
 */
export function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.ministryId === right.ministryId &&
    left.supportSubjectId === right.supportSubjectId &&
    left.principalId === right.principalId
  );
}

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

/** How much of a period a read's data actually covers, listed once for the closed set. */
export const COVERAGE_STATES = ["complete", "partial", "unknown"] as const;

/** How much of a period a read's data covers: all of it, some of it, or an amount that is not known. */
export type CoverageState = (typeof COVERAGE_STATES)[number];

/**
 * The period a read's data covers.
 *
 * `state` says how much of the past the data reaches; it never stands in for the state of an
 * individual value, which is {@link ValueState}'s job. A boundary is `null` when the source does not
 * state it, which is different from a boundary at the earliest day the source holds.
 */
export interface Coverage {
  readonly from: string | null;
  readonly to: string | null;
  readonly state: CoverageState;
}

/**
 * The coverage of a single-currency financial read: a {@link Coverage} that also states the currency
 * its amounts are in and the date basis it attributes them by.
 *
 * Both are required here rather than optional, because a financial total is only comparable with
 * another when the currency and the basis agree — and a non-financial read must not claim either.
 */
export interface FinancialCoverage extends Coverage {
  readonly currency: string;
  readonly dateBasis: string;
}

export const coverageSchema: z.ZodType<Coverage> = z.object({
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
  state: z.enum(COVERAGE_STATES),
});

export const financialCoverageSchema: z.ZodType<FinancialCoverage> = z.object({
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
  state: z.enum(COVERAGE_STATES),
  currency: z.string().min(1),
  dateBasis: z.string().min(1),
});

// ---------------------------------------------------------------------------------------------
// Available actions
// ---------------------------------------------------------------------------------------------

/**
 * One action currently available on the data a read returned.
 *
 * Advisory only. The service re-derives scope, permission and the expected revision when the action
 * is submitted, so a stale envelope can produce a `denied` or `conflict` outcome but can never produce
 * an unauthorised write. `reason` is present when the action is unavailable, and states why without
 * disclosing anything about a record the caller may not read.
 */
export interface ReadAction {
  readonly name: string;
  readonly available: boolean;
  readonly reason?: string;
}

export const readActionSchema: z.ZodType<ReadAction> = z.object({
  name: z.string().min(1),
  available: z.boolean(),
  reason: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------------------------
// The read envelope
// ---------------------------------------------------------------------------------------------

/**
 * What every read returns.
 *
 * The second type parameter carries the coverage kind a read actually states, so a single-currency
 * financial read keeps its currency and date basis visible to its consumer while a read with no
 * financial subject keeps the plain {@link Coverage} the default names. It adds no field: the
 * envelope always has the same eight.
 */
export interface ReadEnvelope<T, C extends Coverage = Coverage> {
  /** The records the view needs, already scoped and already projected. */
  readonly data: T;
  /** The exact authority the read ran under. */
  readonly scope: Scope;
  /** The source system and its opaque reference for what was read. */
  readonly source: SourceReference;
  /** The revision of the record or collection, to present as `expectedRevision` on any change. */
  readonly revision: string;
  /** The scenario instant the read was evaluated at, ISO-8601 with its offset. */
  readonly asOf: string;
  /** How much of the past the data covers. */
  readonly coverage: C;
  /** One state per value-bearing path in `data`, keyed by the field path the view uses. */
  readonly valueStates: Readonly<Record<string, ValueState>>;
  /** The actions currently available, and a reason for each that is not. */
  readonly actions: readonly ReadAction[];
}

/** What a read supplies to {@link buildEnvelope}: the same eight facts, before derivation. */
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

/**
 * Builds the envelope a read returns, deriving the one state a caller may not choose.
 *
 * The derivation, in this precedence:
 *
 * 1. A path recorded as `withheld`, `unknown` or `unavailable` keeps that state whatever the coverage
 *    is. An evidence state is never relabelled, because relabelling a withheld value would disclose
 *    that a value exists and invite a reader to obtain it by subtraction.
 * 2. A path recorded as `value` or `zero` becomes `incomplete-subtotal` when the read's coverage is
 *    `partial`: the number is real, but it does not cover its whole period, and the two known states
 *    are the only ones a partial total can be built from.
 * 3. Anything else is returned unchanged.
 *
 * The returned envelope, its state map and its action list are frozen shallow copies, so a caller
 * holding one out of a query cache cannot alter what another surface reads.
 */
export function buildEnvelope<T, C extends Coverage = Coverage>(
  input: ReadEnvelopeInput<T, C>,
): ReadEnvelope<T, C> {
  return Object.freeze({
    data: input.data,
    scope: input.scope,
    source: input.source,
    revision: input.revision,
    asOf: input.asOf,
    coverage: input.coverage,
    valueStates: deriveValueStates(input.valueStates, input.coverage.state),
    actions: Object.freeze([...input.actions]),
  });
}

/** Applies {@link buildEnvelope}'s derivation to every recorded path. */
function deriveValueStates(
  recorded: Readonly<Record<string, RecordedValueState>>,
  coverageState: CoverageState,
): Readonly<Record<string, ValueState>> {
  const derived: Record<string, ValueState> = {};
  for (const [path, state] of Object.entries(recorded)) {
    derived[path] = deriveValueState(state, coverageState);
  }
  return Object.freeze(derived);
}

/**
 * The single derivation of `incomplete-subtotal`, holding the precedence {@link buildEnvelope}
 * documents: an evidence state survives, and only a known value under partial coverage is relabelled.
 */
function deriveValueState(recorded: RecordedValueState, coverageState: CoverageState): ValueState {
  if (recorded === "withheld" || recorded === "unknown" || recorded === "unavailable") {
    return recorded;
  }
  return coverageState === "partial" ? "incomplete-subtotal" : recorded;
}

// ---------------------------------------------------------------------------------------------
// The mutation request envelope
// ---------------------------------------------------------------------------------------------

/**
 * A canonical lowercase UUID v4, the shape `newOperationId` mints: the version nibble is `4`, the
 * variant nibble is `8`, `9`, `a` or `b`, and every other position is a lowercase hex digit.
 */
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * What every mutation presents.
 *
 * `operationId` identifies one attempt, so replaying it returns the stored result instead of applying
 * a second effect, and recovering an uncertain outcome means re-querying the same identity rather than
 * resending under a new one. `expectedRevision` is the revision the caller saw, and a mismatch is a
 * conflict that preserves the caller's input for comparison. `scope` is the context the caller
 * believes it is acting in, and the service verifies both that the caller is admitted to it and that
 * the resulting record is still inside it.
 */
export interface MutationInput<P> {
  readonly operationId: string;
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: P;
}

/**
 * The one shape guard every mutation runs before any state change.
 *
 * The request envelope is strict: a caller that adds a fifth field has misunderstood the contract, and
 * that is an `invalid` outcome with the field path rather than a field quietly dropped. The payload
 * schema is the caller's own, so an unknown key inside a payload is likewise `invalid` when that
 * schema is strict, which is how each mutation's payload is declared.
 */
export function mutationInputSchema<P>(payloadSchema: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.strictObject({
    operationId: z
      .string()
      .regex(
        OPERATION_ID_PATTERN,
        "An operationId is the canonical lowercase UUID v4 that newOperationId mints, so a replay can be recognised by identity rather than guessed from a repeated payload.",
      ),
    scope: scopeSchema,
    expectedRevision: z
      .string()
      .min(1, "A mutation states the revision it saw, so a stale write is a conflict rather than an overwrite."),
    payload: payloadSchema,
  });
}

// ---------------------------------------------------------------------------------------------
// Stored record primitives
// ---------------------------------------------------------------------------------------------

/**
 * A record's optimistic-concurrency token: never empty, opaque, and changed by every accepted write.
 *
 * A caller that reads a record states this value as `expectedRevision` on the change it makes, so a
 * write built on a version another change has replaced is a `conflict` that preserves the caller's
 * input rather than an overwrite.
 */
export const recordRevisionSchema: z.ZodType<string> = z.string().min(1);

/**
 * A calendar date stored as `YYYY-MM-DD`, with no time, zone or instant behind it.
 *
 * Leading zeros are significant and preserved, the value is never rendered as a number, and a date
 * that does not exist is refused rather than rolled forward — the reason a due date is never a
 * fabricated midnight.
 */
export const storedCivilDateSchema: z.ZodType<string> = z.iso.date();

/** An instant stored as ISO-8601 with its offset, the form `Temporal.Instant.toString()` produces. */
export const storedInstantSchema: z.ZodType<string> = z.iso.datetime({ offset: true });

/**
 * How precisely a stored date is known.
 *
 * The union itself is owned by `modules/time/civil`, which declares it as the only place those three
 * precisions are named; this schema is only its stored form, so the two cannot drift.
 */
export const storedDatePrecisionSchema: z.ZodType<DatePrecision> = z.enum([
  "date",
  "approximate",
  "unknown",
]);

/** An opaque, source-qualified reference: the stored form of the reference `@/lib/ids` declares. */
export const sourceReferenceSchema: z.ZodType<SourceReference> = z.object({
  system: z.string().min(1),
  reference: z.string().min(1),
});

/**
 * An exact amount as stored: a currency code and a whole number of that currency's minor units.
 *
 * The brand on `MinorUnits` is compile-time only, so this transform is where a stored integer becomes
 * an amount, and `minorUnitsOf` remains the function that refuses anything that is not a canonical
 * safe integer. A currency with no exponent is stored as it arrived and is never defaulted to two
 * decimals; a negative amount is a refund or a correction, never an error.
 */
export const moneySchema: z.ZodType<Money> = z
  .object({
    currency: z.string().min(1),
    minorUnits: z.int(),
  })
  .transform(
    (stored): Money => ({
      currency: stored.currency,
      minorUnits: stored.minorUnits as MinorUnits,
    }),
  );

/** Who may read a field that names an audience: the worker alone, or the shared operational record. */
export const RECORD_AUDIENCES = ["private", "shared"] as const;

/** The audience a stored field belongs to. Every audience-bearing field states one. */
export type RecordAudience = (typeof RECORD_AUDIENCES)[number];

export const recordAudienceSchema: z.ZodType<RecordAudience> = z.enum(RECORD_AUDIENCES);


// ---------------------------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------------------------

/**
 * The five states a resolved session can be in: the four admissions, then the no-access recovery
 * state.
 *
 * `signed-in`, `unavailable`, `denied` and `expired` are the four admissions. `no-access` is the user
 * for whom no admitted identity exists, so it carries no admitted membership and its only honest
 * outcome is account-recovery guidance. It never renders as an empty workspace, and it is never
 * collapsed into `denied`: a denial discloses nothing about what it refused, while no-access states
 * the one thing that is known — there is an account to recover.
 */
export const SESSION_STATES = [
  "signed-in",
  "unavailable",
  "denied",
  "expired",
  "no-access",
] as const;

/** The state of the session a request resolved to. */
export type SessionState = (typeof SESSION_STATES)[number];

export const sessionStateSchema: z.ZodType<SessionState> = z.enum(SESSION_STATES);

/**
 * One membership a principal is admitted to: the organisation, ministry and support subject a read or
 * a change may be scoped to.
 *
 * A selection is valid only while its membership is admitted here, and the triplet is the whole
 * authority — no role label is consulted, because authority is re-derived from the records on every
 * read rather than cached in the session.
 */
export interface AdmittedMembership {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
}

export const admittedMembershipSchema: z.ZodType<AdmittedMembership> = z.object({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
});

/**
 * How far the scenario clock is set ahead of the seed instant, in milliseconds.
 *
 * The unit is part of the record and is the one the clock itself works in: `modules/time/clock.ts`
 * sets and advances its offset in milliseconds, so a stored offset carries that same unit and a caller
 * never converts between two, nor loses the sub-second precision an exact boundary test advances by.
 */
export interface SessionClockOffset {
  readonly milliseconds: number;
}

export const sessionClockOffsetSchema: z.ZodType<SessionClockOffset> = z.object({
  milliseconds: z.int(),
});

/**
 * The root of scope: the session a cookie resolves to, and everything a request derives from it.
 *
 * `sessionId` identifies the development session and keys that session's own store files; it is never
 * a principal, an organisation or a ministry. The three selections are `null` until the caller chooses
 * a context, and a context switch fences the responses still in flight for the old one.
 */
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

// ---------------------------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------------------------

/** The closed set of record kinds a partner roster holds. */
export const PARTNER_KINDS = [
  "person",
  "household",
  "church",
  "organization",
  "private-preparation",
] as const;

/** What kind of record a partner is: never inferred from a name, an address or a gift. */
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const partnerKindSchema: z.ZodType<PartnerKind> = z.enum(PARTNER_KINDS);

/** The closed set of ways a partner may be contacted. */
export const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const;

/** How one contact method reaches a partner. */
export type ContactMethodKind = (typeof CONTACT_METHOD_KINDS)[number];

/**
 * One way of reaching a partner, with the two facts that stay separate from each other.
 *
 * `permitted` is contactability — whether the worker may use this method at all. It is not consent to
 * receive a publication, which is a membership with its own state and purpose, and it is not a reader
 * grant for protected content. `verified` is always `false`: this release verifies no address or
 * number, so a stored record never claims that it did.
 */
export interface PartnerContactMethod {
  readonly kind: ContactMethodKind;
  readonly value: string;
  readonly permitted: boolean;
  readonly verified: false;
}

/**
 * A restriction on the relationship, kept as recorded.
 *
 * `kind` is a short source-supplied label rather than a closed taxonomy: a negative restriction says
 * what must not happen, and coercing it into a fixed list would either drop it or invent a meaning.
 */
export interface PartnerRestriction {
  readonly kind: string;
  readonly detail: string;
}

/**
 * The parts a partner's name is recorded in.
 *
 * Ordering and display come from `displayName`; these parts exist so a form can edit a component
 * without rewriting the whole name, and they are never concatenated to derive one.
 */
export interface PartnerNameParts {
  readonly given: string | null;
  readonly family: string | null;
  readonly additional: readonly string[];
}

/**
 * One partner record: a person, household, church, other organisation, or the worker's own private
 * preparation.
 *
 * A private-preparation record may exist with no shared identity at all, and linking it to a shared
 * record is deliberate and never inferred. A household is not a person's contactability or consent,
 * and an organisation's representative is a separate record rather than a field on the organisation.
 */
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

export const partnerContactMethodSchema: z.ZodType<PartnerContactMethod> = z.object({
  kind: z.enum(CONTACT_METHOD_KINDS),
  value: z.string().min(1),
  permitted: z.boolean(),
  verified: z.literal(false),
});

export const partnerRestrictionSchema: z.ZodType<PartnerRestriction> = z.object({
  kind: z.string().min(1),
  detail: z.string().min(1),
});

export const partnerNamePartsSchema: z.ZodType<PartnerNameParts> = z.object({
  given: z.string().min(1).nullable(),
  family: z.string().min(1).nullable(),
  additional: z.array(z.string().min(1)),
});

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

/**
 * A note the worker wrote for themselves: a different record class from a shared operational fact.
 *
 * Its audience is the literal `private`, so no read, export or other record's audience can carry it,
 * and linking, importing or assigning work never copies its text anywhere.
 */
export interface PrivateNoteRecord {
  readonly noteId: string;
  readonly partnerId: string;
  readonly authorPrincipalId: PrincipalId;
  readonly body: string;
  readonly audience: "private";
  readonly createdAt: string;
  readonly revision: string;
}

export const privateNoteRecordSchema: z.ZodType<PrivateNoteRecord> = z.object({
  noteId: z.string().min(1),
  partnerId: z.string().min(1),
  authorPrincipalId: principalIdSchema,
  body: z.string(),
  audience: z.literal("private"),
  createdAt: storedInstantSchema,
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------------------------

/** A note attached to an interaction, labelled with the audience that may read it. */
export interface InteractionNote {
  readonly body: string;
  readonly audience: RecordAudience;
}

/**
 * One participant in an interaction the worker recorded.
 *
 * `role` is the worker's own short label. A participant is referenced by identifier — a partner record
 * or a principal — and never by a name or an address, so two people who look alike in a directory
 * stay two participants.
 */
export interface InteractionParticipant {
  readonly role: string;
  readonly partnerId: string | null;
  readonly principalId: PrincipalId | null;
}

/**
 * Something that actually happened, recorded with the precision its date is known to.
 *
 * A gift, a scheduled task, or the act of opening a mail or dialer app is not an interaction, and
 * completing a task never creates one. `occurredOn` is a civil date and is `null` only when the
 * precision is `unknown`, so an honest "I do not know when" is representable and never becomes a
 * fabricated day or an ordering nobody can justify.
 */
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

export const interactionParticipantSchema: z.ZodType<InteractionParticipant> = z.object({
  role: z.string().min(1),
  partnerId: z.string().min(1).nullable(),
  principalId: principalIdSchema.nullable(),
});

export const interactionNoteSchema: z.ZodType<InteractionNote> = z.object({
  body: z.string(),
  audience: recordAudienceSchema,
});

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
  .refine((record) => (record.precision === "unknown") === (record.occurredOn === null), {
    path: ["occurredOn"],
    message:
      "An unrecorded date is stated as unknown precision with no date, and a known or approximate date states the day it refers to, so the two never disagree.",
  });

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

/** The four states a task can be in. `completed` and `cancelled` are different fates. */
export const TASK_STATUSES = ["open", "completed", "reopened", "cancelled"] as const;

/** Where a task stands. Completing one proves nothing about contact, payment or fulfilment. */
export type TaskRecordStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema: z.ZodType<TaskRecordStatus> = z.enum(TASK_STATUSES);

/** Whether a task is ordinary work or a meeting with a planned time. */
export const TASK_KINDS = ["default", "meeting"] as const;

/** What kind of work a task is. */
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * One piece of work.
 *
 * Only a title is required. `category` is the worker's own short label, not a controlled taxonomy, and
 * changing it changes nothing else. `dueOn` is a civil date. `plannedTime` is a wall-clock time in the
 * disclosed `timeZone` and is present only on a meeting task: planned is not held, and a planned
 * meeting becomes a held one only when an interaction records that it happened.
 */
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

/** A 24-hour wall-clock time of day, `HH:MM`, as a planned meeting states it. */
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
  .refine(
    (task) => task.plannedTime === null || (task.kind === "meeting" && task.timeZone !== null),
    {
      path: ["plannedTime"],
      message:
        "A planned time belongs to a meeting task and always discloses the zone it is stated in, so a wall-clock time is never read as an instant in an assumed zone.",
    },
  );

// ---------------------------------------------------------------------------------------------
// Task series
// ---------------------------------------------------------------------------------------------

/**
 * How a stored series ends, in the three kinds the recurrence engine recognises.
 *
 * An end date is inclusive, a count counts occurrences from the first due date, and the ongoing policy
 * is a qualified choice the worker switched on rather than a missing value — which is why it has its
 * own kind instead of an absent end. The date is a civil date string here, because a stored record is
 * JSON and the engine's working type holds a `Temporal` value.
 */
export type SeriesEndRecord =
  | { readonly kind: "on-date"; readonly on: string }
  | { readonly kind: "after-count"; readonly count: number }
  | { readonly kind: "ongoing-personal-policy" };

export const seriesEndRecordSchema: z.ZodType<SeriesEndRecord> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("on-date"), on: storedCivilDateSchema }),
  z.object({ kind: z.literal("after-count"), count: z.int().min(1) }),
  z.object({ kind: z.literal("ongoing-personal-policy") }),
]);

/**
 * One effective repeat rule, as stored.
 *
 * `profile` is the recurrence engine's own closed set. `interval` is read only by the two "every N"
 * profiles and `dayOfMonth` only by the two monthly ones, both stated as the engine reads them.
 * `firstDueOn` is the date the worker chose and is never recomputed from the rule, and
 * `planningTimeZone` is the series' own zone, so the dates it produces do not depend on the zone the
 * reader's screen is set to.
 */
export interface SeriesRuleRecord {
  readonly profile: RepeatProfile;
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly firstDueOn: string;
  readonly planningTimeZone: string;
  readonly end: SeriesEndRecord;
}

export const seriesRuleRecordSchema: z.ZodType<SeriesRuleRecord> = z.object({
  profile: z.enum(["none", "weekly", "everyNWeeks", "monthlyOnDay", "everyNMonths"]),
  interval: z.int().min(1),
  dayOfMonth: z.int().min(1).max(31).nullable(),
  firstDueOn: storedCivilDateSchema,
  planningTimeZone: z.string().min(1),
  end: seriesEndRecordSchema,
});

/**
 * One prospective rule revision: the rule in force from `effectiveFrom` onwards.
 *
 * A this-and-future edit appends a revision with an explicit boundary instead of rewriting the rule
 * that completed history was measured against.
 */
export interface SeriesRuleRevisionRecord {
  readonly revisionId: string;
  readonly effectiveFrom: string;
  readonly rule: SeriesRuleRecord;
}

export const seriesRuleRevisionRecordSchema: z.ZodType<SeriesRuleRevisionRecord> = z.object({
  revisionId: z.string().min(1),
  effectiveFrom: storedCivilDateSchema,
  rule: seriesRuleRecordSchema,
});

/**
 * A repeating piece of work and the rule that admits its occurrences.
 *
 * `title` travels on the series because an admitted successor is built from it, so a new occurrence
 * needs no copy of some other task. `currentRule` is the rule in force, materialised beside the
 * history it was appended to: both are written in one transaction, so they cannot disagree. At most
 * one occurrence is actionable at a time, `planNeedsReview` states that several dates were missed
 * without manufacturing an overdue stack, and a stopped series keeps its history while admitting
 * nothing further.
 */
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
  state: z.enum(["active", "paused", "stopped"]),
  planNeedsReview: z.boolean(),
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Outreach initiatives
// ---------------------------------------------------------------------------------------------

/** Whether an initiative still accepts new solicitation. */
export const INITIATIVE_STATES = ["open", "closed"] as const;

/** Where an initiative stands. Closing it never resolves the work it leaves behind. */
export type InitiativeState = (typeof INITIATIVE_STATES)[number];

/** The window an initiative runs over, which bounds its planning and never its record-keeping. */
export interface InitiativePeriod {
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * A finite piece of outreach with a reviewed working list.
 *
 * `ministryContextId` is the admitted ministry the initiative runs in, and `responsiblePrincipalId` is
 * the person accountable for it — two different references. `closureDisposition` records how unfinished
 * work was handed on or resolved when the initiative closed, so reopening can preserve it.
 */
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

export const initiativePeriodSchema: z.ZodType<InitiativePeriod> = z.object({
  from: storedCivilDateSchema.nullable(),
  to: storedCivilDateSchema.nullable(),
});

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

/**
 * The three states of a working-list member.
 *
 * `included` is not "asked", `removed` keeps the history of having been included, and `excluded` is a
 * deliberate decision not to approach — three states, never two.
 */
export const INITIATIVE_MEMBER_STATES = ["included", "removed", "excluded"] as const;

/** Where a partner stands on an initiative's working list. */
export type InitiativeMemberState = (typeof INITIATIVE_MEMBER_STATES)[number];

/** One recorded change of a member's state, so a removal or an exclusion is never silent. */
export interface InitiativeMemberHistoryEntry {
  readonly state: InitiativeMemberState;
  readonly at: string;
  readonly byPrincipalId: PrincipalId;
  readonly reason: string | null;
}

/**
 * One partner on an initiative's working list.
 *
 * Membership is explicit and is added by selection: a later filter that happens to match a partner
 * never joins the list. Inclusion is not consent, contact permission or membership of an Update's
 * audience, and a removal preserves obligations recorded elsewhere.
 */
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

export const initiativeMemberHistoryEntrySchema: z.ZodType<InitiativeMemberHistoryEntry> = z.object(
  {
    state: z.enum(INITIATIVE_MEMBER_STATES),
    at: storedInstantSchema,
    byPrincipalId: principalIdSchema,
    reason: z.string().min(1).nullable(),
  },
);

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

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

/** The seven ways a Request can be answered, each a distinct fact about the conversation. */
export const REQUEST_RESPONSE_KINDS = [
  "agreed",
  "conditional",
  "partial",
  "deferred",
  "declined",
  "unanswered",
  "needs-clarification",
] as const;

/** How a Request was answered. Agreement creates no pledge, gift, task, subscription or send. */
export type RequestResponseKind = (typeof REQUEST_RESPONSE_KINDS)[number];

/**
 * What a Request asked for, versioned.
 *
 * `money` is requested terms and never received support: an exact currency, minor-unit amount, cadence
 * and term, with an honest absence where the source states none. A non-financial ask carries no amount
 * at all rather than a zero one.
 */
export interface RequestTerms {
  readonly version: string;
  readonly money: {
    readonly amount: Money;
    readonly cadence: string | null;
    readonly term: string | null;
  } | null;
  readonly nonFinancial: string | null;
}

/** The actual presentation of a Request: when, how, and which terms version it showed. */
export interface RequestPresentation {
  readonly presentedOn: string;
  readonly manner: string;
  readonly versionRef: string;
}

/**
 * A response, bound to the terms version it answers.
 *
 * `respondentId` is the named respondent — a person, or an organisation's representative identified by
 * that representative's own record. `standingEvidence` is what the response was said on the strength
 * of; a job title or a household relationship is not authority and is never treated as one here.
 */
export interface RequestResponse {
  readonly kind: RequestResponseKind;
  readonly respondentId: string;
  readonly standingEvidence: string | null;
  readonly termsVersionRef: string;
  readonly recordedAt: string;
}

/**
 * One independently answerable invitation.
 *
 * The terms carry their own `version`, the presentation cites the version it showed, and the response
 * cites the version it answers — so a late response against terms that have since changed points at the
 * terms it actually answered, and earlier presented versions are preserved rather than overwritten.
 */
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

export const requestTermsSchema: z.ZodType<RequestTerms> = z.object({
  version: z.string().min(1),
  money: z
    .object({
      amount: moneySchema,
      cadence: z.string().min(1).nullable(),
      term: z.string().min(1).nullable(),
    })
    .nullable(),
  nonFinancial: z.string().min(1).nullable(),
});

export const requestPresentationSchema: z.ZodType<RequestPresentation> = z.object({
  presentedOn: storedCivilDateSchema,
  manner: z.string().min(1),
  versionRef: z.string().min(1),
});

export const requestResponseSchema: z.ZodType<RequestResponse> = z.object({
  kind: z.enum(REQUEST_RESPONSE_KINDS),
  respondentId: z.string().min(1),
  standingEvidence: z.string().min(1).nullable(),
  termsVersionRef: z.string().min(1),
  recordedAt: storedInstantSchema,
});

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

// ---------------------------------------------------------------------------------------------
// Referral cycles
// ---------------------------------------------------------------------------------------------

/** Which window a referral cycle is in: its first New window, or a continuation. */
export const REFERRAL_WINDOW_KINDS = ["new", "continued"] as const;

/** Which window a referral cycle records. */
export type ReferralWindowKind = (typeof REFERRAL_WINDOW_KINDS)[number];

/**
 * One referral cycle for a partner.
 *
 * `originalIntroductionOn` is the date of the introduction itself, apart from when the record was
 * entered, so an import, a first view, a reassignment, a merge or a retry never counts as a new
 * introduction and a late first entry can already be expired. `sourceZone` is the zone the window is
 * computed in, and `windowEnd` is the resolved instant preserved from the moment it was computed, so a
 * later travel, settings or timezone-data change cannot move a deadline that was already stated.
 * `predecessorId` names the consumed cycle a continuation follows, which keeps a cycle to at most one
 * successor.
 */
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
  .refine(
    (referral) => referral.datePrecision !== "unknown" || referral.originalIntroductionOn === null,
    {
      path: ["originalIntroductionOn"],
      message:
        "An unknown introduction date states no date at all, rather than a guessed one that a later reader would treat as evidence.",
    },
  )
  .refine((referral) => referral.datePrecision === "date" || referral.windowEnd === null, {
    path: ["windowEnd"],
    message:
      "Only a date-precise introduction yields a deadline. An approximate or unknown date states no endpoint, no Active or Expired judgement and no Continue action, so neither can ever be given one.",
  });

// ---------------------------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------------------------

/**
 * The one reporting basis this release names: source-qualified effective cash allocations, attributed
 * to their original gift dates.
 *
 * A single named basis is the point. Received gifts, recurring collection outcomes, commitments,
 * monthly-equivalent support and the support goal are five different measures, and none of them is
 * comparable with another unless the basis and the date attribution are stated.
 */
export const SUPPORT_BASES = ["effective_cash_allocation"] as const;

/** The measure a support figure is reported on. */
export type SupportBasis = (typeof SUPPORT_BASES)[number];

/** The measure a support goal is set against, which must be the same basis the projection reports. */
export const SUPPORT_GOAL_MEASURES = ["received-support"] as const;

/** Which measure a goal counts. */
export type SupportGoalMeasure = (typeof SUPPORT_GOAL_MEASURES)[number];

/**
 * The one writable fact in the support projection.
 *
 * A goal is a target the worker sets, not a financial record: editing it never posts, corrects or
 * refunds money, never rewrites an earlier report and never changes a commitment. `revision` is the
 * base revision the edit was made against.
 */
export interface SupportGoalRecord {
  readonly amount: Money;
  readonly measure: SupportGoalMeasure;
  readonly effectiveFrom: string;
  readonly revision: string;
}

/**
 * A source-qualified financial projection with its provenance, coverage and as-of time.
 *
 * `currencyExponents` states the minor-unit exponent of every currency present. A currency absent from
 * it has no known exponent, so its amounts are reported as unknown-currency facts rather than summed or
 * defaulted to two decimals. `coverage` says how much of the past the projection covers, `asOf` when it
 * was evaluated and `lastSourceUpdate` when the source last changed, which are three different facts
 * and are never collapsed into one timestamp.
 */
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

export const supportGoalRecordSchema: z.ZodType<SupportGoalRecord> = z.object({
  amount: moneySchema,
  measure: z.enum(SUPPORT_GOAL_MEASURES),
  effectiveFrom: storedCivilDateSchema,
  revision: recordRevisionSchema,
});

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

/**
 * Who a gift row is attributed to.
 *
 * A partner attribution names a record by identifier. `anonymous` is a supporter who chose not to be
 * identified, and `unresolved` is a source row that supplied no identifying attribution at all: the two
 * are different facts, and neither is a household, a church or an organisation representative.
 */
export type GiftAttribution =
  | { readonly kind: "partner"; readonly partnerId: string }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unresolved" };

export const giftAttributionSchema: z.ZodType<GiftAttribution> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("partner"), partnerId: z.string().min(1) }),
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("unresolved") }),
]);

/**
 * One received gift at the grain it is reported in: an authorised allocation row, or a whole gift that
 * carries no allocation.
 *
 * A split gift shows only the allocation this read is authorised to see, and a view that legitimately
 * contains both the parent gift and one of its allocations counts the gift once — the reason `giftId`
 * and `allocationId` are separate references on one row. `originalGiftOn` is the gift's own date with
 * the precision it is known to, `entryOn` is when the record entered this application, and a refund or
 * correction carries a negative amount and names the row it corrects in `refundOf` rather than
 * disappearing.
 */
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

/**
 * One commitment row, read-only, in its stored form.
 *
 * The closed vocabularies it carries are imported from `modules/support/buckets`, which owns the three
 * commitment kinds and the five outcome buckets: `recovery-needs-attention` is the bucket the product
 * labels "Recovery — needs attention", and `outside-partition` is not a sixth bucket but the value that
 * keeps evidence which is unknown or stale out of the five. The read projection the reports consume is
 * that module's `CommitmentRow`; this is the record it is derived from, so the stored form carries the
 * revision and the source reference and holds its dates as the civil-date strings the store persists.
 *
 * `cadence` is a source-supplied label that is displayed and never parsed: a monthly equivalent comes
 * from the qualified source calculation and is never derived by averaging gifts or dividing a cadence.
 * `lastSuccessfulOn` and `nextEligibleOn` are what the source states, so no retry, refund or correction
 * is ever inferred from them. A commitment appears once and its occurrences are not rows.
 */
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

/**
 * Whether a commitment is collecting, in its stored form: `active` or `paused`, with the civil day it
 * resumes on when the source states one.
 *
 * The state words match the bucket module's projection rather than inventing a second word for "not
 * paused", so a stored record and the row a report reads never need translating.
 */
export interface CommitmentPauseRecord {
  readonly state: "active" | "paused";
  readonly resumeOn: string | null;
}

/** A fixed-total commitment's promised, fulfilled, released and remaining amounts, as stored. */
export interface CommitmentFixedTotalRecord {
  readonly promised: Money;
  readonly fulfilled: Money;
  readonly released: Money;
  readonly remaining: Money;
}

export const commitmentPauseRecordSchema: z.ZodType<CommitmentPauseRecord> = z.object({
  state: z.enum(["active", "paused"]),
  resumeOn: storedCivilDateSchema.nullable(),
});

export const commitmentFixedTotalRecordSchema: z.ZodType<CommitmentFixedTotalRecord> = z.object({
  promised: moneySchema,
  fulfilled: moneySchema,
  released: moneySchema,
  remaining: moneySchema,
});

export const commitmentRowRecordSchema: z.ZodType<CommitmentRowRecord> = z
  .object({
    commitmentRowId: z.string().min(1),
    kind: z.enum(["automatic-recurring", "manual-recurring", "fixed-total"]),
    cadence: z.string().min(1),
    perOccurrence: moneySchema,
    bucketState: z.enum([
      "received",
      "processing",
      "upcoming",
      "recovery-needs-attention",
      "not-received",
      "outside-partition",
    ]),
    lastSuccessfulOn: storedCivilDateSchema.nullable(),
    nextEligibleOn: storedCivilDateSchema.nullable(),
    pause: commitmentPauseRecordSchema,
    fixedTotal: commitmentFixedTotalRecordSchema.nullable(),
    provenance: sourceReferenceSchema,
    revision: recordRevisionSchema,
  })
  .refine((commitment) => (commitment.kind === "fixed-total") === (commitment.fixedTotal !== null), {
    path: ["fixedTotal"],
    message:
      "Only a fixed-total commitment has a promised, fulfilled, released and remaining total; a recurring commitment states none, so an absent total is never read as zero.",
  });

// ---------------------------------------------------------------------------------------------
// Content documents and variants
// ---------------------------------------------------------------------------------------------

/** The three families a content document can belong to. */
export const CONTENT_FAMILIES = ["update", "worker-page", "project-page"] as const;

/** Which family of content a document is. A family decides its catalogue and its release semantics. */
export type ContentFamily = (typeof CONTENT_FAMILIES)[number];

/** The four kinds of Update a worker may write. */
export const CONTENT_KINDS = ["update", "prayer", "story", "milestone"] as const;

/** What kind of content a document holds. */
export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * The one approved giving designation a page release may place.
 *
 * `null` is a real and reachable state: with no approved designation bound, every giving placement
 * shows *Giving unavailable* and there is no fallback fund, fictional designation or stored amount to
 * fall back to. The label is display copy; the reference is the opaque identity of the designation.
 */
export interface GivingBinding {
  readonly designation: SourceReference;
  readonly label: string;
}

/**
 * One canonical content identity: the Update or Page itself, apart from any of its editions.
 *
 * `sourceSubject` is the content subject the document is written for, and it is a managed reference:
 * legal identity, source subject and giving binding are not rewritable through prose. `managedFields`
 * names the fields the composition surface locks, so a page cannot be used to change them.
 */
export interface ContentDocumentRecord {
  readonly documentId: string;
  readonly family: ContentFamily;
  readonly kind: ContentKind;
  readonly sourceSubject: SourceReference;
  readonly siteId: string;
  readonly givingBinding: GivingBinding | null;
  readonly managedFields: readonly string[];
  readonly revision: string;
}

export const givingBindingSchema: z.ZodType<GivingBinding> = z.object({
  designation: sourceReferenceSchema,
  label: z.string().min(1),
});

export const contentDocumentRecordSchema: z.ZodType<ContentDocumentRecord> = z.object({
  documentId: z.string().min(1),
  family: z.enum(CONTENT_FAMILIES),
  kind: z.enum(CONTENT_KINDS),
  sourceSubject: sourceReferenceSchema,
  siteId: z.string().min(1),
  givingBinding: givingBindingSchema.nullable(),
  managedFields: z.array(z.string().min(1)),
  revision: recordRevisionSchema,
});

/** The audiences a variant may address. A family decides which of them it permits. */
export const CONTENT_AUDIENCES = ["public", "approved-supporter"] as const;

/** Who a variant is written for. Never inferred from a locale, a membership or a reader's choice. */
export type ContentAudience = (typeof CONTENT_AUDIENCES)[number];

export const contentAudienceSchema: z.ZodType<ContentAudience> = z.enum(CONTENT_AUDIENCES);

/** Where a variant's text came from, when it is a manual translation of another variant. */
export interface ContentTranslationSource {
  readonly variantId: string;
  readonly revisionId: string;
}

/**
 * One working edition: a document, the audience it addresses, the exact content locale and direction.
 *
 * Each variant owns its own draft, candidate and release head, so editing the English edition neither
 * overwrites an Arabic draft nor advances a French release. `translationSource` records the revision a
 * manual translation was made from, which is what lets a stale translation be shown as stale without
 * being withdrawn automatically.
 */
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

export const contentTranslationSourceSchema: z.ZodType<ContentTranslationSource> = z.object({
  variantId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const contentVariantRecordSchema: z.ZodType<ContentVariantRecord> = z.object({
  variantId: z.string().min(1),
  documentId: z.string().min(1),
  audience: contentAudienceSchema,
  locale: z.string().min(1),
  direction: z.enum(["ltr", "rtl"]),
  draftRevisionId: z.string().min(1).nullable(),
  candidateId: z.string().min(1).nullable(),
  releaseHeadId: z.string().min(1).nullable(),
  translationSource: contentTranslationSourceSchema.nullable(),
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Content revisions
// ---------------------------------------------------------------------------------------------

/**
 * One media placement inside a revision.
 *
 * `position` is the builder's order, and it is a stored number precisely because reordering is done
 * with explicit move actions rather than by dragging. `altText` is required for every placement and
 * `caption` is optional: an image or a video always carries a text alternative, and neither is ever
 * derived from the file name, which is never echoed into output.
 */
export interface MediaPlacementRecord {
  readonly placementId: string;
  readonly assetId: string;
  readonly sectionElement: string | null;
  readonly position: number;
  readonly altText: string;
  readonly caption: string | null;
  readonly credit: string | null;
}

/**
 * One admitted caption track for a revision's video placement.
 *
 * The track is referenced by its caption rendition, so a request for it re-authorises exactly as a
 * request for the video does and a caption URL can never become a route around denied playback.
 */
export interface ContentCaptionTrackRecord {
  readonly assetId: string;
  readonly renditionId: string;
  readonly language: string;
  readonly label: string;
  readonly isDefault: boolean;
}

/** The card an Update or a Page shows when it is shared: its own title, description and image. */
export interface SharePresentationRecord {
  readonly title: string;
  readonly description: string;
  readonly imageAssetId: string | null;
  readonly imageAltText: string | null;
}

/**
 * One exact revision of a variant's content.
 *
 * `body` is the versioned Tiptap document, which carries the composed sections — each with its
 * catalogue element, its fields and one of the profile's bounded presentation choices — so the sections
 * have exactly one authoritative copy and a stored diagram never holds two lists that could disagree.
 * A candidate freezes one of these revisions by identity, later edits to the draft cannot reach it, and
 * restoring an earlier revision always creates a new draft.
 *
 * `revision` is this record's own optimistic-concurrency token, which is a different thing from
 * `revisionId`, the identity of this content revision.
 */
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

export const contentCaptionTrackRecordSchema: z.ZodType<ContentCaptionTrackRecord> = z.object({
  assetId: z.string().min(1),
  renditionId: z.string().min(1),
  language: z.string().min(1),
  label: z.string().min(1),
  isDefault: z.boolean(),
});

export const sharePresentationRecordSchema: z.ZodType<SharePresentationRecord> = z.object({
  title: z.string().min(1),
  description: z.string(),
  imageAssetId: z.string().min(1).nullable(),
  imageAltText: z.string().min(1).nullable(),
});

/**
 * The revision schema, built from the document validator that owns the content profile.
 *
 * The Tiptap profile, its admitted nodes and its bounded presentation choices are owned by
 * `modules/content/document`, and `parseDocument` there is the validator every content surface uses.
 * Taking that schema as an argument is how this module keeps the record shape complete without either a
 * second copy of the profile or a runtime edge from the shared contract module into the editor's
 * module graph.
 */
export function contentRevisionRecordSchema(
  documentSchema: z.ZodType<ContentDocumentJson>,
): z.ZodType<ContentRevisionRecord> {
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

// ---------------------------------------------------------------------------------------------
// Media assets
// ---------------------------------------------------------------------------------------------

/** The two kinds of media an admitted asset can be. */
export const MEDIA_ASSET_KINDS = ["image", "video"] as const;

/** Whether an asset is an image or a video, established by its content and never by its extension. */
export type MediaAssetKind = (typeof MEDIA_ASSET_KINDS)[number];

/** The five purposes a stored rendition can serve. */
export const MEDIA_ASSET_RENDITION_PURPOSES = [
  "display",
  "playback",
  "poster",
  "captions",
  "transcript",
] as const;

/** What a rendition is for. Every request for one re-authorises for this purpose. */
export type MediaAssetRenditionPurpose = (typeof MEDIA_ASSET_RENDITION_PURPOSES)[number];

/** What the content inspection established about an asset, in the units the limits are stated in. */
export interface MediaAssetProfileRecord {
  readonly container: string;
  readonly codec: string;
  readonly durationSeconds: number | null;
  readonly width: number;
  readonly height: number;
}

/** One prepared rendition of an asset: what is served, in place of the original bytes. */
export interface MediaAssetRenditionRecord {
  readonly renditionId: string;
  readonly purpose: MediaAssetRenditionPurpose;
  readonly bytesRef: string;
  readonly mimeType: string;
}

/** The result of checking a prepared rendition for descriptive metadata it should no longer carry. */
export interface MediaTagVerificationRecord {
  readonly checked: boolean;
  readonly residualTags: readonly string[];
}

/**
 * One scoped media asset.
 *
 * `sourceOriginalRef` is private and never served: a consumer only ever receives a rendition, through a
 * request that re-authorises for that rendition's purpose, so an original is never behind a permanent
 * public URL. `tagVerification` records what the pipeline established after re-encoding or re-muxing,
 * which is why a residual descriptive tag is a refusal rather than a note.
 */
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

export const mediaAssetProfileRecordSchema: z.ZodType<MediaAssetProfileRecord> = z.object({
  container: z.string().min(1),
  codec: z.string().min(1),
  durationSeconds: z.number().nonnegative().nullable(),
  width: z.int().nonnegative(),
  height: z.int().nonnegative(),
});

export const mediaAssetRenditionRecordSchema: z.ZodType<MediaAssetRenditionRecord> = z.object({
  renditionId: z.string().min(1),
  purpose: z.enum(MEDIA_ASSET_RENDITION_PURPOSES),
  bytesRef: z.string().min(1),
  mimeType: z.string().min(1),
});

export const mediaTagVerificationRecordSchema: z.ZodType<MediaTagVerificationRecord> = z.object({
  checked: z.boolean(),
  residualTags: z.array(z.string().min(1)),
});

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

// ---------------------------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------------------------

/** The three reach values a released edition can have. */
export const RELEASE_REACHES = ["not-public", "link-public", "listed"] as const;

/**
 * How far a released edition reaches: not public, public by link only (unlisted and noindex), or listed
 * publicly in the discovery index.
 */
export type ReleaseReach = (typeof RELEASE_REACHES)[number];

export const releaseReachSchema: z.ZodType<ReleaseReach> = z.enum(RELEASE_REACHES);

/**
 * One release of one variant: an exact frozen revision, in one audience, in one locale.
 *
 * Releases are independent per variant, so one member of a multi-variant release failing preserves the
 * others and leaves the failed member on its prior good head rather than withdrawing it. `withdrawnAt`
 * records that the edition no longer serves; it never claims to recall a copy someone already received,
 * and a withdrawn edition leaves a tombstone with no identifying content.
 */
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

// ---------------------------------------------------------------------------------------------
// Notification intents and send results
// ---------------------------------------------------------------------------------------------

/** The purposes a publication notification may be sent for. One purpose, stated explicitly. */
export const NOTIFICATION_PURPOSES = ["update-email"] as const;

/** Which publisher purpose a notice belongs to. Consent is evaluated per publisher and purpose. */
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number];

/**
 * The three states one recipient's send can be in.
 *
 * There is no fourth state here, and no field anywhere on a record claims that a message reached a
 * recipient or was read: a provider accepting a message is not a mailbox receiving it, and reading it is
 * unobservable to this application.
 */
export const NOTIFICATION_RECIPIENT_STATES = ["accepted", "failed", "unknown"] as const;

/** What happened to one recipient's copy. */
export type NotificationRecipientState = (typeof NOTIFICATION_RECIPIENT_STATES)[number];

/**
 * One notification intent: a deliberate decision to notify for one publication.
 *
 * `releaseId` is pinned at the moment the intent is recorded, so every recipient is offered the
 * rendition of the release that was published rather than whatever head exists when the send runs.
 * `ceilingCount` is the number of eligible recipients the accepted intent covers, so a later signup can
 * never expand it. The dedupe identity is publisher, purpose, recipient and this intent, which is why
 * re-requesting the same notice re-queries this record instead of creating a second one.
 */
export interface NotificationIntentRecord {
  readonly intentId: string;
  readonly publisherId: string;
  readonly purpose: NotificationPurpose;
  readonly documentId: string;
  readonly releaseId: string;
  readonly intendedAt: string;
  readonly ceilingCount: number;
  readonly revision: string;
}

/** One recipient's outcome within a send result, naming the exact rendition that was pinned for them. */
export interface NotificationRecipientOutcomeRecord {
  readonly recipientId: string;
  readonly renditionId: string;
  readonly state: NotificationRecipientState;
  readonly at: string;
}

/**
 * The recorded outcome of one notification intent, per recipient.
 *
 * `unknown` is a real outcome and is never presented as success or failure: it means the effect may have
 * happened but the acknowledgement was lost, and its recovery is to re-query the intent rather than to
 * send again under a fresh identity.
 */
export interface NotificationSendResultRecord {
  readonly sendResultId: string;
  readonly intentId: string;
  readonly recipients: readonly NotificationRecipientOutcomeRecord[];
  readonly recordedAt: string;
  readonly revision: string;
}

export const notificationRecipientOutcomeRecordSchema: z.ZodType<NotificationRecipientOutcomeRecord> =
  z.object({
    recipientId: z.string().min(1),
    renditionId: z.string().min(1),
    state: z.enum(NOTIFICATION_RECIPIENT_STATES),
    at: storedInstantSchema,
  });

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
  recordedAt: storedInstantSchema,
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Audience membership and preference
// ---------------------------------------------------------------------------------------------

/** The four states a purpose-specific membership can be in. */
export const MEMBERSHIP_STATES = ["active", "awaiting-proof", "off", "restricted"] as const;

/**
 * Where a membership stands for one publisher's one purpose.
 *
 * `awaiting-proof` is not membership, `off` is a deliberate choice and `restricted` is a limit the
 * source imposed. None of them is consent to anything else, and none of them is contactability.
 */
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

/**
 * One purpose-specific membership and the reader's preference.
 *
 * `email` is a value and never a join key: it identifies nothing here, and a matching address on a
 * partner record establishes no relationship. `languagePreference` is separate from consent — choosing
 * a language neither subscribes anyone nor resets a notification intent — and `confirmationDeadline` is
 * the 168-hour window acceptance started, stored as the instant it was computed to.
 */
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

// ---------------------------------------------------------------------------------------------
// Coaching grants
// ---------------------------------------------------------------------------------------------

/** The six states of a coaching relationship. Each stop-type has its own state. */
export const COACHING_GRANT_STATES = [
  "invited",
  "accepted",
  "active",
  "revoked",
  "expired",
  "ended",
] as const;

/** Where a coaching grant stands. An ended episode cannot return through a stale action. */
export type CoachingGrantState = (typeof COACHING_GRANT_STATES)[number];

/**
 * The five modules a grant may admit, each an independent flag that starts unselected.
 *
 * A coach reads exactly the modules switched on: an unshared module is absent rather than empty, so
 * "not shared" and "nothing recorded" stay different answers. Re-enabling one after a stop does not
 * restore access to what was shared before it.
 */
export interface CoachingModuleSelection {
  readonly preparation: boolean;
  readonly targets: boolean;
  readonly checkIns: boolean;
  readonly taskSummaries: boolean;
  readonly financialSupport: boolean;
}

/**
 * How long the sharing lasts.
 *
 * `cutoffInstant` is the exclusive start of the civil day after the chosen share-through date in
 * `frozenZone`, resolved once at acceptance and stored: travel, a display-zone change or a later
 * timezone-data update cannot move it. An ongoing grant states no cutoff of its own and is still bounded
 * by any earlier source limit, which the reads honour.
 */
export interface CoachingDurationRecord {
  readonly kind: "ongoing" | "through-date";
  readonly cutoffInstant: string | null;
  readonly frozenZone: string;
}

/** The separately reviewed fixed date range a grant may share support figures over. */
export interface CoachingFinancialRangeRecord {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
}

/** The invitation as issued, including the instant it stops being acceptable on its own. */
export interface CoachingInvitationRecord {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly supersededBy: string | null;
}

/**
 * One coaching relationship, invited by a worker and accepted by a named coach.
 *
 * Delivery, identity verification, deliberate acceptance and active access are four separate outcomes,
 * so an email that matches a coach's address grants nothing. `ministryIds` are the admitted ministries
 * the sharing covers; the grant is read-only for the coach from the moment it is accepted.
 */
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

export const coachingModuleSelectionSchema: z.ZodType<CoachingModuleSelection> = z.object({
  preparation: z.boolean(),
  targets: z.boolean(),
  checkIns: z.boolean(),
  taskSummaries: z.boolean(),
  financialSupport: z.boolean(),
});

export const coachingDurationRecordSchema: z.ZodType<CoachingDurationRecord> = z
  .object({
    kind: z.enum(["ongoing", "through-date"]),
    cutoffInstant: storedInstantSchema.nullable(),
    frozenZone: z.string().min(1),
  })
  .refine((duration) => (duration.kind === "through-date") === (duration.cutoffInstant !== null), {
    path: ["cutoffInstant"],
    message:
      "A share-through grant states the cutoff it was accepted with, and an ongoing grant states none: a missing duration is not permission and never reads as an unbounded one.",
  });

export const coachingFinancialRangeRecordSchema: z.ZodType<CoachingFinancialRangeRecord> = z.object({
  from: storedCivilDateSchema,
  to: storedCivilDateSchema,
  currency: z.string().min(1),
});

export const coachingInvitationRecordSchema: z.ZodType<CoachingInvitationRecord> = z.object({
  issuedAt: storedInstantSchema,
  expiresAt: storedInstantSchema,
  supersededBy: z.string().min(1).nullable(),
});

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

// ---------------------------------------------------------------------------------------------
// Coaching targets
// ---------------------------------------------------------------------------------------------

/** The four canonical measures a target may count. Nothing else is counted as effort. */
export const COACHING_TARGET_MEASURES = [
  "calls-made",
  "personal-messages",
  "conversations",
  "meetings-held",
] as const;

/** Which activity a target counts. Five calls containing two conversations count as five and two. */
export type CoachingTargetMeasure = (typeof COACHING_TARGET_MEASURES)[number];

/** The three periods a target may be set over. Weekly is the default; custom is a one-off range. */
export const COACHING_TARGET_PERIOD_KINDS = ["weekly", "monthly", "custom"] as const;

/** What period a target's quantity applies to. */
export type CoachingTargetPeriodKind = (typeof COACHING_TARGET_PERIOD_KINDS)[number];

/** A target's period, with its own dates when the worker chose a one-off custom range. */
export interface CoachingTargetPeriodRecord {
  readonly kind: CoachingTargetPeriodKind;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * One prospective version of a target's plan.
 *
 * A change to quantity, measure or calendar starts a new version from an explicit effective boundary
 * and closes the previous one, so a closed period keeps the version it was measured against. Versions
 * never overlap and nothing is prorated, so every period falls inside exactly one of them.
 */
export interface CoachingTargetVersionRecord {
  readonly revisionId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly quantity: number;
  readonly measure: CoachingTargetMeasure;
  readonly calendarStart: string;
}

/**
 * One target: the worker's own plan, and the version history a closed period resolves against.
 *
 * `privateLabel` is the worker's own wording and is never disclosed to a coach — it is not part of any
 * module. `homePlacement` decides only where the worker sees the target and carries no commitment,
 * reminder or notification. The current measure, quantity and calendar start are materialised beside the
 * history they were appended to in one transaction, so the two cannot disagree.
 */
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
  .object({
    kind: z.enum(COACHING_TARGET_PERIOD_KINDS),
    from: storedCivilDateSchema.nullable(),
    to: storedCivilDateSchema.nullable(),
  })
  .refine((period) => (period.kind === "custom") === (period.from !== null && period.to !== null), {
    path: ["from"],
    message:
      "A one-off custom period states both its first and last day, and a recurring period states neither: a recurring target is bucketed by the calendar, so it cannot carry a range.",
  });

export const coachingTargetVersionRecordSchema: z.ZodType<CoachingTargetVersionRecord> = z.object({
  revisionId: z.string().min(1),
  effectiveFrom: storedCivilDateSchema,
  effectiveTo: storedCivilDateSchema.nullable(),
  quantity: z.int().nonnegative(),
  measure: z.enum(COACHING_TARGET_MEASURES),
  calendarStart: storedCivilDateSchema,
});

export const coachingTargetRecordSchema: z.ZodType<CoachingTargetRecord> = z.object({
  targetId: z.string().min(1),
  workerPrincipalId: principalIdSchema,
  privateLabel: z.string().min(1),
  measure: z.enum(COACHING_TARGET_MEASURES),
  quantity: z.int().nonnegative(),
  period: coachingTargetPeriodRecordSchema,
  calendarStart: storedCivilDateSchema,
  homePlacement: z.enum(["placed", "unplaced"]),
  state: z.enum(["active", "paused", "ended"]),
  versions: z.array(coachingTargetVersionRecordSchema),
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Coaching check-ins
// ---------------------------------------------------------------------------------------------

/**
 * Counts Unicode scalar values rather than UTF-16 code units.
 *
 * A check-in limit is stated in scalars, so a name or a word outside the basic plane counts as the one
 * character it is. Counting code units instead would refuse a valid question or answer and would make
 * the limit depend on the script the worker writes in.
 */
function scalarCount(value: string): number {
  return [...value].length;
}

/** One question in a check-in's question set, exactly as the worker worded it. */
export interface CoachingCheckInQuestionRecord {
  readonly wording: string;
  readonly order: number;
}

/**
 * One answer, as plain text, naming the captured question it answers.
 *
 * `questionOrder` is `null` for prose that answers no prompt, which is the form a check-in keeps when
 * the worker asked no questions. Text is stored exactly as written and is never truncated to fit a
 * limit: a request over the limit is refused instead.
 */
export interface CoachingCheckInAnswerRecord {
  readonly questionOrder: number | null;
  readonly text: string;
}

/** The worker's own working revision: autosaved, and never readable by a coach on its own. */
export interface CoachingCheckInPrivateDraftRecord {
  readonly revisionId: string;
  readonly questions: readonly CoachingCheckInQuestionRecord[];
  readonly questionsCapturedAt: string;
  readonly answers: readonly CoachingCheckInAnswerRecord[];
  readonly savedAt: string;
}

/**
 * The revision a named coach may read, created by an explicit Share.
 *
 * The question set is the one captured when the editor started, not the one on screen now, so a coach
 * reads the wording the worker actually answered. Private autosave never touches this revision: only
 * Update shared check-in does, and withdrawal keeps it as the record of what was shared.
 */
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

/** One check-in: the worker's private revisions, and at most one shared revision. */
export interface CoachingCheckInRecord {
  readonly checkInId: string;
  readonly workerPrincipalId: PrincipalId;
  readonly grantId: string;
  readonly privateDraft: CoachingCheckInPrivateDraftRecord | null;
  readonly shared: CoachingCheckInSharedRevisionRecord | null;
  readonly revision: string;
}

export const coachingCheckInQuestionRecordSchema: z.ZodType<CoachingCheckInQuestionRecord> = z.object(
  {
    wording: z
      .string()
      .refine((wording) => scalarCount(wording) <= 500, {
        message:
          "A question is at most 500 Unicode scalars; a longer one is refused with its count rather than shortened, because a shortened question would change what the worker asked.",
      }),
    order: z.int().nonnegative(),
  },
);

export const coachingCheckInAnswerRecordSchema: z.ZodType<CoachingCheckInAnswerRecord> = z.object({
  questionOrder: z.int().nonnegative().nullable(),
  text: z.string().refine((text) => scalarCount(text) <= 4000, {
    message:
      "An answer is at most 4,000 Unicode scalars; a longer one is refused with its count rather than truncated, because a truncated answer would misstate what the worker wrote.",
  }),
});

export const coachingCheckInPrivateDraftRecordSchema: z.ZodType<CoachingCheckInPrivateDraftRecord> =
  z.object({
    revisionId: z.string().min(1),
    questions: z.array(coachingCheckInQuestionRecordSchema).max(5),
    questionsCapturedAt: storedInstantSchema,
    answers: z.array(coachingCheckInAnswerRecordSchema),
    savedAt: storedInstantSchema,
  });

export const coachingCheckInSharedRevisionRecordSchema: z.ZodType<CoachingCheckInSharedRevisionRecord> =
  z.object({
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

// ---------------------------------------------------------------------------------------------
// Operation ledger
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of outcomes a mutation can return, in the stored form the ledger records.
 *
 * `./outcome` owns the outcome values themselves and is the module every caller switches over; this is
 * the name each of them is stored by, declared here because a ledger entry is a record this module
 * describes and because an entry has to be branchable without importing the outcome module.
 */
export const OPERATION_OUTCOME_NAMES = [
  "accepted",
  "alreadyAccepted",
  "unchanged",
  "conflict",
  "denied",
  "invalid",
  "unavailable",
  "unknown",
] as const;

/** The name of the outcome a recorded operation produced. */
export type OperationOutcomeName = (typeof OPERATION_OUTCOME_NAMES)[number];

/**
 * One recorded mutation attempt.
 *
 * `intentHash` distinguishes a replay of the same intent — which returns `result` unchanged — from a
 * reuse of the same identity for a different one, which is a conflict. `result` is the stored result
 * returned verbatim on replay, so it is held as the opaque value it is rather than re-typed here.
 *
 * An entry carries no optimistic-concurrency revision: the ledger is append-only and an entry is never
 * updated, so a token to detect a concurrent change to it would describe a change that cannot happen.
 */
export interface OperationRecord {
  readonly operationId: string;
  readonly intentHash: string;
  readonly scope: Scope;
  readonly outcome: OperationOutcomeName;
  readonly result: unknown;
  readonly at: string;
}

export const operationRecordSchema: z.ZodType<OperationRecord> = z.object({
  operationId: z.string().min(1),
  intentHash: z.string().min(1),
  scope: scopeSchema,
  outcome: z.enum(OPERATION_OUTCOME_NAMES),
  result: z.unknown(),
  at: storedInstantSchema,
});

// ---------------------------------------------------------------------------------------------
// Import proposals and receipts
// ---------------------------------------------------------------------------------------------

/** The four decisions a worker can make about one imported row. */
export const IMPORT_ROW_DECISIONS = [
  "new-private-entry",
  "reuse-authorized-identity",
  "skip",
  "unresolved",
] as const;

/** What the worker decided about a row. `unresolved` stays visible rather than defaulting to a new entry. */
export type ImportRowDecision = (typeof IMPORT_ROW_DECISIONS)[number];

/** The five results one row can end in, so an accepted row is never confused with an already-accepted one. */
export const IMPORT_ROW_STATES = [
  "accepted",
  "already-accepted",
  "skipped",
  "needs-review",
  "failed",
] as const;

/** What became of one row. */
export type ImportRowState = (typeof IMPORT_ROW_STATES)[number];

/**
 * What the chosen file is, as measured before any row was processed.
 *
 * `fileName` is recorded for the worker's own receipt and is never echoed into rendered output, a
 * download name or a media descriptor.
 */
export interface ImportFileMetaRecord {
  readonly fileName: string;
  readonly bytes: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

/**
 * What one column was mapped to.
 *
 * `field` names a target from the import vocabulary by its key, and `null` is a column the worker chose
 * to ignore. The vocabulary itself is owned by `modules/import/map`, which validates that the key is one
 * of its own when the mapping is confirmed, so this record states the stored key without a second copy
 * of the list.
 */
export interface ImportColumnAssignmentRecord {
  readonly columnIndex: number;
  readonly header: string;
  readonly field: string | null;
}

/** What the worker decided about one row, and which existing record a reuse targets. */
export interface ImportRowDecisionRecord {
  readonly rowNumber: number;
  readonly decision: ImportRowDecision;
  readonly targetPartnerId: string | null;
}

/** What became of one row, with the route to the record it created or the reason it needs attention. */
export interface ImportRowResultRecord {
  readonly rowNumber: number;
  readonly state: ImportRowState;
  readonly partnerId: string | null;
  readonly message: string | null;
}

/** The counts a worker reviews before accepting, stated per decision so nothing is aggregated away. */
export interface ImportSummaryRecord {
  readonly newEntries: number;
  readonly reusedIdentities: number;
  readonly skipped: number;
  readonly needsReview: number;
}

/**
 * One import proposal and its receipt.
 *
 * `importOperationId` is the stable identity of the whole operation, so a lost acknowledgement recovers
 * the original receipt rather than processing the file a second time. `processedAt` is `null` until the
 * rows are accepted, which is what keeps a reviewed proposal distinguishable from a finished one, and a
 * changed file requires fresh review rather than reusing the decisions recorded here.
 */
export interface ImportProposalRecord {
  readonly importOperationId: string;
  readonly fileMeta: ImportFileMetaRecord;
  readonly mapping: readonly ImportColumnAssignmentRecord[];
  readonly rowDecisions: readonly ImportRowDecisionRecord[];
  readonly summary: ImportSummaryRecord;
  readonly results: readonly ImportRowResultRecord[];
  readonly processedAt: string | null;
  readonly revision: string;
}

export const importFileMetaRecordSchema: z.ZodType<ImportFileMetaRecord> = z.object({
  fileName: z.string().min(1),
  bytes: z.int().nonnegative(),
  rowCount: z.int().nonnegative(),
  columnCount: z.int().nonnegative(),
});

export const importColumnAssignmentRecordSchema: z.ZodType<ImportColumnAssignmentRecord> = z.object({
  columnIndex: z.int().nonnegative(),
  header: z.string().min(1),
  field: z.string().min(1).nullable(),
});

export const importRowDecisionRecordSchema: z.ZodType<ImportRowDecisionRecord> = z.object({
  rowNumber: z.int().nonnegative(),
  decision: z.enum(IMPORT_ROW_DECISIONS),
  targetPartnerId: z.string().min(1).nullable(),
});

export const importRowResultRecordSchema: z.ZodType<ImportRowResultRecord> = z.object({
  rowNumber: z.int().nonnegative(),
  state: z.enum(IMPORT_ROW_STATES),
  partnerId: z.string().min(1).nullable(),
  message: z.string().min(1).nullable(),
});

export const importSummaryRecordSchema: z.ZodType<ImportSummaryRecord> = z.object({
  newEntries: z.int().nonnegative(),
  reusedIdentities: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  needsReview: z.int().nonnegative(),
});

export const importProposalRecordSchema: z.ZodType<ImportProposalRecord> = z.object({
  importOperationId: z.string().min(1),
  fileMeta: importFileMetaRecordSchema,
  mapping: z.array(importColumnAssignmentRecordSchema),
  rowDecisions: z.array(importRowDecisionRecordSchema),
  summary: importSummaryRecordSchema,
  results: z.array(importRowResultRecordSchema),
  processedAt: storedInstantSchema.nullable(),
  revision: recordRevisionSchema,
});

// ---------------------------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------------------------

/**
 * Narrows a record to the fields a caller is authorised to see.
 *
 * Authorisation happens before enumeration, so a projection is built here, from the record and the list
 * of fields the caller may read, and the fields that are left out are absent from the envelope's `data`
 * rather than hidden by a component. The assertion is sound because every key comes from `visible`,
 * which is constrained to the record's own keys, and the result is a new shallow object, so a caller
 * cannot reach an omitted field through the projection.
 *
 * This is not the redaction helper: `@/lib/redaction` replaces values for diagnostics and denial paths,
 * while this chooses a permitted shape in the first place.
 */
export function project<T extends object, K extends keyof T>(
  record: T,
  visible: readonly K[],
): Pick<T, K> {
  const projected = {} as Pick<T, K>;
  for (const key of visible) {
    projected[key] = record[key];
  }
  return projected;
}
