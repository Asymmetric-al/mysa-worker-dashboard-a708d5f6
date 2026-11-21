/**
 * The three reads the shell is built from: the admission statement, the context chooser, and Home.
 *
 * This module answers the questions a worker asks before any record is in front of them — who am I
 * admitted as, which context am I acting in, and what needs my attention today — and each answer is a
 * {@link ReadEnvelope}, never a bare record, an array or a count. The envelope is what lets the shell
 * state the authority a screen was read under (`scope`), the instant it was evaluated at (`asOf`), the
 * period its data covers (`coverage`), which of its values are real, zero, unknown, withheld or
 * unavailable (`valueStates`), and which actions it may offer (`actions`). A bare result could state
 * none of that, and "no gifts this month" would then be indistinguishable from "the finance source is
 * down".
 *
 * Scope is re-derived on every call from the development session (`../authorize`), never accepted from
 * an argument, a request body or a query string, and every record is authorised through `canView`
 * before it is enumerated: a read that may not see something returns a `denied` or `unavailable`
 * outcome carrying no count, no title, no existence flag and no size, so search, sorting and paging
 * can never be turned into a disclosure oracle.
 *
 * What this file deliberately does not do:
 *
 * - It does not recompute a date boundary. Every "overdue", "today", "upcoming" and "window state"
 *   judgement comes from `modules/time` (`todayInZone`, `referralWindowState`) evaluated against this
 *   session's scenario instant, so a second implementation of a calendar rule cannot exist here.
 * - It does not compute a financial figure. Received support for the current period is
 *   `runReport`'s result over the stored projection, so Home states the same number, coverage and
 *   as-of time the Support surfaces state, rather than a local sum that could drift from them.
 * - It carries no direct clock read — neither a current-milliseconds call nor an instant built from
 *   the host clock — and no `process.env`: time arrives from the one scenario clock, and the one zone
 *   this module states is the report family's declared default rather than the machine's.
 * - It never falls back to fixtures. A session the store does not hold is refused, an unreadable
 *   document is `unavailable` with its source identity, and neither is answered as an empty workspace.
 *
 * One representation needs explaining because the envelope's type cannot express it. A session that
 * admits nothing — `denied`, `no-access`, an expired or an unavailable session — has no organisation,
 * ministry or support subject to name, so its envelope states an *empty* scope: every scope identifier
 * is the empty string, which no identifier can ever be (they are all non-empty), so nothing in it can
 * be mistaken for an identity or for authority. That is the honest encoding of "this read ran under no
 * authority", and the shell reads those states from `data.state` and its recovery-guidance key.
 *
 * Layering: a service read module. It imports the envelope and outcome contracts, the authorisation
 * resolver, the store's read function (never a write), the domain modules for time, value states and
 * the one report computation, and `lib` diagnostics. It imports no component, no feature, no route, no
 * UI primitive and no second state owner, and it writes nothing.
 */

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { compareCodeUnits } from "@/lib/ordering";
import { redactDenial } from "@/lib/redaction";
import type { CommitmentRow } from "@/modules/support/buckets";
import {
  REPORT_DEFAULT_TIME_ZONE,
  buildReportQuery,
  runReport,
  type PeriodState,
} from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import {
  civilDateAt,
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
} from "@/modules/time/civil";
import { referralWindowState } from "@/modules/time/window";
import { readSession } from "@/modules/store/repository";

import {
  assertScope,
  canView,
  readResultOfRefusal,
  resolveSession,
  type ResolvedSession,
} from "../authorize";
import {
  buildEnvelope,
  commitmentRowRecordSchema,
  contentDocumentRecordSchema,
  contentVariantRecordSchema,
  coachingTargetRecordSchema,
  giftRowRecordSchema,
  importProposalRecordSchema,
  interactionRecordSchema,
  notificationIntentRecordSchema,
  notificationSendResultRecordSchema,
  partnerRecordSchema,
  referralCycleRecordSchema,
  sessionContextRecordSchema,
  supportProjectionRecordSchema,
  taskRecordSchema,
  taskSeriesRecordSchema,
  type AdmittedMembership,
  type CoachingTargetRecord,
  type CommitmentRowRecord,
  type ContentDocumentRecord,
  type ContentVariantRecord,
  type Coverage,
  type GiftRowRecord,
  type ImportProposalRecord,
  type InteractionRecord,
  type NotificationIntentRecord,
  type NotificationSendResultRecord,
  type PartnerRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type ReferralCycleRecord,
  type Scope,
  type SessionContextRecord,
  type SessionState,
  type SupportProjectionRecord,
  type TaskRecord,
  type TaskSeriesRecord,
  type ValueState,
} from "../envelope";
import {
  LOCAL_STORE_SYSTEM,
  denied,
  unavailable,
  type DenialReason,
  type DeniedOutcome,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// Admission: the five states the shell must tell apart
// ---------------------------------------------------------------------------------------------

/**
 * The stable key of the guidance the shell renders for one admission state.
 *
 * The words belong to the shell's own copy module; this key is what the service states, so a sentence
 * is never composed (or translated) here. `workspace-ready` is the admitted state, and the other four
 * are the four ways a person is stopped: an account to recover, a request to make, a session to renew,
 * and a source to retry.
 */
export type AdmissionGuidanceKey =
  | "workspace-ready"
  | "account-recovery"
  | "request-access"
  | "sign-in-again"
  | "retry-later";

/**
 * The context the session is acting in: the three references one admitted membership states.
 *
 * They are opaque strings with no readable meaning, kept as three separate values because an
 * organisation, a ministry and a finance subject are different references with different owners. No
 * display name, email address or postal address is derived here.
 */
export interface AdmissionContext {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
}

/**
 * What the shell may know about admission.
 *
 * In the four states other than `signed-in` this carries the state discriminator and its guidance key
 * and nothing else: `principalId`, `context` and `scenarioId` are `null`, so no identity, membership
 * entry, count or size can reach a surface that has not been admitted. The guidance is the whole of
 * what a person in one of those states is told — there is nothing to enumerate and no retry that could
 * reveal whether a record exists.
 */
export interface AdmissionStateData {
  readonly state: SessionState;
  readonly guidance: AdmissionGuidanceKey;
  readonly principalId: string | null;
  readonly context: AdmissionContext | null;
  readonly scenarioId: string | null;
}

// ---------------------------------------------------------------------------------------------
// The context chooser
// ---------------------------------------------------------------------------------------------

/**
 * One admitted ministry, as the chooser lists it.
 *
 * `label` is empty when the source states no name, exactly as the shell's context indicator expects:
 * an unnamed context falls through to its opaque reference rather than rendering a blank prominent
 * line. `selected` marks the context currently in force by comparing all three references, so a
 * ministry with two finance subjects can never mark the wrong one.
 */
export interface AdmittedMinistryEntry {
  readonly ministryId: string;
  readonly ministryLabel: string;
  readonly supportSubjectId: string;
  readonly selected: boolean;
}

/** One organisation and the ministries it admits for this principal. */
export interface ContextChooserGroup {
  readonly organizationId: string;
  readonly organizationLabel: string;
  readonly ministries: readonly AdmittedMinistryEntry[];
}

/**
 * The chooser, or the fact that there is nothing to choose.
 *
 * `directEntry` is true when exactly one ministry is admitted: the shell then opens that context
 * without a chooser, because a control offering one option is not a choice. With several, `groups`
 * lists exactly the memberships the session resolver admitted and no others — a membership the
 * principal does not hold is absent rather than disabled, since a disabled entry would disclose that
 * some other context exists.
 */
export interface ContextChooserData {
  readonly directEntry: boolean;
  readonly groups: readonly ContextChooserGroup[];
}

// ---------------------------------------------------------------------------------------------
// Home: Attention, Information, Unfinished work
// ---------------------------------------------------------------------------------------------

/** The three sections Home is partitioned into, in the order the surface renders them. */
export type HomeSection = "attention" | "information" | "unfinished-work";

/**
 * Why one item is on Home.
 *
 * This is the answer to "why is this here?", and it is a closed set so a surface cannot invent a
 * reason and a test can assert the whole vocabulary. None of these keys is derived from an amount:
 * urgency is never a figure here.
 */
export type HomeReasonKey =
  | "task-overdue"
  | "task-due-today"
  | "task-upcoming"
  | "task-undated"
  | "series-plan-needs-review"
  | "commitment-needs-attention"
  | "support-received-this-period"
  | "interaction-recorded"
  | "referral-window-active"
  | "referral-window-expired"
  | "target-placed-on-home"
  | "draft-saved"
  | "candidate-awaiting-review"
  | "import-awaiting-decisions"
  | "notification-needs-attention";

/**
 * Where one item stands, in the smallest vocabulary the states need.
 *
 * `draft` and `awaiting-review` stay apart because a saved draft and a submitted candidate are
 * different stages of the same edition; `placed` and `paused` describe a target the worker chose to
 * see here, which creates no commitment; `received` marks the one financial item, whose amount is
 * stated in its figure rather than in this word.
 */
export type HomeItemStatus =
  | "overdue"
  | "due-today"
  | "upcoming"
  | "undated"
  | "needs-review"
  | "needs-attention"
  | "active"
  | "expired"
  | "recorded"
  | "received"
  | "placed"
  | "paused"
  | "draft"
  | "awaiting-review";

/**
 * One currency's part of the received-support figure, exactly as `runReport` states it.
 *
 * `minorUnits` is an integer in that currency's smallest unit, and it is `null` whenever the state
 * says no amount may be stated (an unknown currency, a withheld value, a source that is down). A
 * genuine zero keeps its state `zero`, so a zero and a gap never render alike.
 */
export interface HomeSupportAmount {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
}

/** The period the support figure covers, with the state that says whether it has closed. */
export interface HomeSupportPeriod {
  readonly from: string;
  readonly to: string;
  readonly state: PeriodState;
}

/**
 * Received support in the current period, as the one report computation states it.
 *
 * `state` is `unavailable` when the finance source could not be read: the figure then carries its
 * source identity and no amounts at all, because an outage is never rendered as a zero or as "no
 * gifts". `period` and `coverage` are `null` in that case only — nothing else can leave a stated
 * figure without a period, since the period is what `runReport` resolved the query to.
 */
export interface HomeSupportFigure {
  readonly state: "stated" | "unavailable";
  readonly source: SourceReference;
  readonly asOf: string;
  readonly period: HomeSupportPeriod | null;
  readonly coverage: Coverage | null;
  readonly amounts: readonly HomeSupportAmount[];
}

/**
 * One thing Home shows, with both questions already answered.
 *
 * `reason` says why it is here and `destination` says where it takes the worker; an item missing
 * either is a defect, so both are required. `label` is the record's own wording where it states some —
 * a task title, a source cadence, an interaction type, a partner's display name — and `null` where the
 * record states no display text, so the surface composes its own wording instead of the service
 * inventing copy. `onDate` is the civil day the item is about, `locale` the edition a content item
 * belongs to, and `figure` only ever appears on the received-support item.
 */
export interface HomeItem {
  readonly itemId: string;
  readonly section: HomeSection;
  readonly reason: HomeReasonKey;
  readonly destination: string;
  readonly label: string | null;
  readonly status: HomeItemStatus;
  readonly onDate: string | null;
  readonly locale: string | null;
  readonly figure?: HomeSupportFigure;
}

/** Everything Home states: its items, in section order, and nothing else. */
export interface HomeData {
  readonly items: readonly HomeItem[];
}

// ---------------------------------------------------------------------------------------------
// Fixed values this module states
// ---------------------------------------------------------------------------------------------

/**
 * The operation identity a read refusal carries.
 *
 * A read has no attempt identity — nothing was asked to change, so nothing can be replayed — and
 * `../authorize` states the same marker for the refusals it builds. It is repeated here because the
 * service keeps that constant private and a denial's shape must stay byte-identical wherever it is
 * built: only the reason code may differ between two refusals.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The zone Home's day boundary is resolved in.
 *
 * The report family's declared default, imported rather than restated, because no session-scoped
 * display-zone preference is part of a session's records today. Using a declared constant is what
 * keeps "today" out of the host machine's zone: the same seed instant yields the same boundary on
 * every machine, which is what makes a browser test evidence.
 */
const HOME_TIME_ZONE = REPORT_DEFAULT_TIME_ZONE;

/** The guidance each admission state states, listed once so no branch can invent another word. */
const GUIDANCE_BY_STATE: Readonly<Record<SessionState, AdmissionGuidanceKey>> = Object.freeze({
  "signed-in": "workspace-ready",
  "no-access": "account-recovery",
  denied: "request-access",
  expired: "sign-in-again",
  unavailable: "retry-later",
});

/** The opaque reference each read states for the session documents it read. */
const ADMISSION_SEED_REFERENCE = "session-admission";
const CHOOSER_SEED_REFERENCE = "session-contexts";
const HOME_SEED_REFERENCE = "home";

/** The item identity of the one financial item, so its value-state paths are stable. */
const SUPPORT_ITEM_ID = "support-received-this-period";

/** How many recent interactions Home states before the partner surface is the better place to look. */
const RECENT_INTERACTION_LIMIT = 5;

/** The stable guidance a read gives when a store document cannot be read: retry, nothing was changed. */
const STORE_UNAVAILABLE_GUIDANCE =
  "This session's records could not be read. Nothing was changed; try again in a moment.";

// ---------------------------------------------------------------------------------------------
// The session documents these reads parse
// ---------------------------------------------------------------------------------------------

/**
 * The one member of the state document the admission and chooser reads need: the session context
 * record, which is the root of scope and the record a context switch revises.
 *
 * Each read declares only the families it consumes, and `z.object` leaves every other family out
 * rather than copying it, so the shell's two session reads never pay for the records they do not use.
 */
const admissionDocumentSchema = z.object({ context: sessionContextRecordSchema });

/**
 * Every record family Home states an item from.
 *
 * A family is declared here only when an item names something in it, and each record's shape is the
 * schema `../envelope` already owns — this module restates no record vocabulary, so a field the
 * contract gains reaches Home instead of being stripped from it.
 */
const homeDocumentSchema = z.object({
  context: sessionContextRecordSchema,
  partners: z.array(partnerRecordSchema),
  tasks: z.array(taskRecordSchema),
  series: z.array(taskSeriesRecordSchema),
  interactions: z.array(interactionRecordSchema),
  referrals: z.array(referralCycleRecordSchema),
  contentDocuments: z.array(contentDocumentRecordSchema),
  contentVariants: z.array(contentVariantRecordSchema),
  importProposals: z.array(importProposalRecordSchema),
  notificationIntents: z.array(notificationIntentRecordSchema),
  notificationResults: z.array(notificationSendResultRecordSchema),
  coachingTargets: z.array(coachingTargetRecordSchema),
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});

/** What {@link homeDocumentSchema} parses to. */
type HomeDocument = z.infer<typeof homeDocumentSchema>;

/**
 * The generated workload's gift collection.
 *
 * `scripts/generate-workload.ts` writes a session's large dataset as its own document beside the
 * readable seed, so a session that has been through `bun run seed:workload` holds gifts in two places.
 * Home states one received-support figure, and it is the figure the Support surfaces state, so a
 * present workload's gifts are read here too rather than left out of the period's total.
 */
const workloadGiftDocumentSchema = z.object({ gifts: z.array(giftRowRecordSchema) });

// ---------------------------------------------------------------------------------------------
// Shared plumbing: sources, refusals, the scenario instant and civil dates
// ---------------------------------------------------------------------------------------------

/** The source a session-document read states: the local store, with an opaque reference per job. */
function storeSource(reference: string): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference };
}

/**
 * Builds the one refusal shape a read answers with, redacted so no field added to the outcome later
 * can carry an existence flag, a count, a title or a size of a record the caller may not read.
 */
function refuse(reason: DenialReason): DeniedOutcome {
  return redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }));
}

/** A refused read: the caller may not enumerate anything, and nothing about a record is disclosed. */
function deniedResult<T>(reason: DenialReason): ReadResult<ReadEnvelope<T>> {
  return { kind: "denied", denied: refuse(reason) };
}

/**
 * A read whose source could not answer, as the contract requires it: the outcome names the source and
 * offers retry guidance, and it is never an empty envelope, an empty list or a zero. The one
 * diagnostic line carries the job and the source identity and nothing else.
 */
function sourceUnavailableResult<T>(
  job: string,
  source: SourceReference,
  guidance: string = STORE_UNAVAILABLE_GUIDANCE,
): ReadResult<ReadEnvelope<T>> {
  logger.sourceUnavailable({ job, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}

/**
 * The scenario instant this session's reads are evaluated at, as an ISO-8601 string.
 *
 * Derived from the session's own persisted offset through the clock module's `instantAt`, because two
 * browser contexts may sit in different scenarios at once: the process clock carries the offset of
 * whichever session last moved it, so a read that took the process clock directly could be evaluated
 * years away from the scenario it is serving. This is still the one clock — the fixed seed instant plus
 * an offset the development runtime persists — and no host clock is read anywhere in this module.
 */
function asOfText(session: ResolvedSession): string {
  return instantAt(session.clockOffsetMs).toString();
}

/**
 * The scope a session that admits nothing states.
 *
 * Every identifier is empty, which no identifier can be (all four are non-empty by contract), so this
 * scope names no organisation, ministry, finance subject or principal and cannot be mistaken for
 * authority or for an identity. It is the honest encoding of "this read ran under no authority" for a
 * session in one of the four admission states that grant none.
 */
const NO_CONTEXT_SCOPE: Scope = Object.freeze({
  organizationId: "" as Scope["organizationId"],
  ministryId: "" as Scope["ministryId"],
  supportSubjectId: "" as Scope["supportSubjectId"],
  principalId: "" as Scope["principalId"],
});

/**
 * Reads one stated civil date, refusing rather than dropping a value it cannot read.
 *
 * A stored date that cannot be read means the record is not what the schema said it was; substituting
 * "no date" would silently change what the record states, so this throws and the read answers
 * `unavailable` instead of reporting a different fact.
 */
function readStatedDate(value: string, field: string): CivilDate {
  const parsed = parseCivilDate(value);
  if (parsed.status === "refused") {
    throw new TypeError(
      `A stored ${field} value is not a civil date, so the record cannot be read.`,
    );
  }
  return parsed.date;
}

/** Reads an optional civil date: `undefined` only when the record states none. */
function readStatedDateOrNull(value: string | null, field: string): CivilDate | undefined {
  return value === null ? undefined : readStatedDate(value, field);
}

/**
 * Reads a stored instant, or `undefined` when the value cannot be read as one.
 *
 * Used only for a referral window endpoint: a window whose endpoint cannot be evaluated has no state
 * to report, and `referralWindowState` answers exactly that for an absent endpoint. It is never used
 * to substitute a different instant for one the record stated.
 */
function readInstant(value: string | null): Temporal.Instant | undefined {
  if (value === null) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}

/**
 * "Today" for this read: the calendar day the scenario instant falls on, in the zone Home declares.
 * The judgement itself is `modules/time/civil`'s, so no second calendar rule exists here.
 */
function todayFor(at: Temporal.Instant): CivilDate | undefined {
  const resolved = todayInZone(HOME_TIME_ZONE, at);
  return resolved.status === "resolved" ? resolved.date : undefined;
}

// ---------------------------------------------------------------------------------------------
// Received support: one report, built from the stored projection
// ---------------------------------------------------------------------------------------------

/**
 * One authorised gift row in the working shape the report computation reads.
 *
 * The mirror exists because this read may not import the report family's internal projection module;
 * it is checked against `runReport`'s own parameter type at the call, so a field that projection
 * requires, renames or retypes fails this module's compilation instead of quietly changing a figure.
 */
interface ReportGiftRow {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId?: string;
  readonly amount: GiftRowRecord["amount"];
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: GiftRowRecord["datePrecision"];
  readonly designation?: string;
  readonly attribution: GiftRowRecord["attribution"];
  readonly refundOf?: string;
  readonly provenance: GiftRowRecord["provenance"];
  readonly entryOn: CivilDate;
}

/** The read-only projection the report is computed from, in the same checked-mirror sense. */
interface ReportSupportProjection {
  readonly supportSubjectId: string;
  readonly basis: SupportProjectionRecord["basis"];
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
  readonly goal?: NonNullable<SupportProjectionRecord["goal"]>;
  readonly gifts: readonly ReportGiftRow[];
  readonly commitments: readonly CommitmentRow[];
}

/** Projects one stored gift row, keeping the grain it states and its exact minor units. */
function toReportGiftRow(record: GiftRowRecord): ReportGiftRow {
  const originalGiftOn = readStatedDateOrNull(record.originalGiftOn, "gift date");
  return {
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(originalGiftOn === undefined ? {} : { originalGiftOn }),
    datePrecision: record.datePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn: readStatedDate(record.entryOn, "gift entry date"),
  };
}

/**
 * Projects one stored commitment row.
 *
 * A commitment is never cash and never reaches the received figure: it travels with the projection
 * because the projection states it, and no surface adds the two.
 */
function toCommitmentRow(record: CommitmentRowRecord): CommitmentRow {
  const lastSuccessfulOn = readStatedDateOrNull(record.lastSuccessfulOn, "commitment date");
  const nextEligibleOn = readStatedDateOrNull(record.nextEligibleOn, "commitment date");
  const resumeOn = readStatedDateOrNull(record.pause.resumeOn, "commitment pause date");
  return {
    commitmentRowId: record.commitmentRowId,
    kind: record.kind,
    cadence: record.cadence,
    perOccurrence: record.perOccurrence,
    bucketState: record.bucketState,
    ...(lastSuccessfulOn === undefined ? {} : { lastSuccessfulOn }),
    ...(nextEligibleOn === undefined ? {} : { nextEligibleOn }),
    pause:
      resumeOn === undefined
        ? { state: record.pause.state }
        : { state: record.pause.state, resumeOn },
    ...(record.fixedTotal === null ? {} : { fixedTotal: record.fixedTotal }),
  };
}

/**
 * Builds the projection the one report computation reads, from the session's stored records.
 *
 * `asOf` is the instant this read was evaluated at, not the instant the source last answered: the
 * projection states both, and they are different facts. The goal travels only when the source states
 * one, so "no goal" stays distinguishable from a goal of zero.
 */
function buildSupportProjection(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly asOf: string;
}): ReportSupportProjection {
  const record = input.projectionRecord;
  return {
    supportSubjectId: record.supportSubjectId,
    basis: record.basis,
    currencyExponents: record.currencyExponents,
    coverage: record.coverage,
    asOf: input.asOf,
    lastSourceUpdate: record.lastSourceUpdate,
    source: record.source,
    ...(record.goal === null ? {} : { goal: record.goal }),
    gifts: input.gifts.map(toReportGiftRow),
    commitments: input.commitments.map(toCommitmentRow),
  };
}

/**
 * States received support for the current period by running the one report the Support surfaces run.
 *
 * Nothing here adds, filters or buckets a figure: the query is the report family's own received-support
 * report for this month, all currencies, in the declared zone, and the summary it answers is copied out
 * verbatim — one entry per currency, each with its exponent, its exact minor units and the value state
 * that says whether it may be stated at all. That is what keeps Home's number the same number, with the
 * same coverage and as-of time, as the Support overview's.
 */
function statedSupportFigure(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly scope: Scope;
  readonly asOf: string;
}): HomeSupportFigure {
  const projection = buildSupportProjection(input);
  const built = buildReportQuery({
    reportId: "received-period-and-year-to-date",
    scope: {
      organizationId: input.scope.organizationId,
      ministryId: input.scope.ministryId,
      supportSubjectId: input.scope.supportSubjectId,
      principalId: input.scope.principalId,
    },
    period: { kind: "preset", preset: "this-month" },
    currency: { kind: "all" },
    timeZone: HOME_TIME_ZONE,
  });
  if (!built.ok) {
    throw new TypeError(
      `The Home support query was refused on ${built.problems.map((problem) => problem.field).join(", ")}, so no received-support figure is stated.`,
    );
  }
  const result = runReport(built.query, projection);
  return {
    state: "stated",
    source: result.snapshot.source,
    asOf: result.snapshot.asOf,
    period: {
      from: serialiseCivilDate(result.snapshot.period.from),
      to: serialiseCivilDate(result.snapshot.period.to),
      state: result.snapshot.period.state,
    },
    coverage: result.snapshot.coverage,
    amounts: result.summary.map((summary) => ({
      currency: summary.currency,
      exponent: summary.exponent ?? null,
      minorUnits: summary.received.minorUnits,
      valueState: summary.received.valueState,
    })),
  };
}

/**
 * The figure for a source that could not answer: its identity, the instant it was asked, and no
 * amounts at all. An outage is never rendered as a zero or as "no gifts", and the coverage the source
 * last stated travels with it so a surface can say what it was unable to read.
 */
function unavailableSupportFigure(
  record: SupportProjectionRecord,
  asOf: string,
): HomeSupportFigure {
  return {
    state: "unavailable",
    source: record.source,
    asOf,
    period: null,
    coverage: record.coverage,
    amounts: [],
  };
}

/**
 * The recorded value state of one amount, for the envelope's map.
 *
 * `incomplete-subtotal` is the one state a read may not record — `buildEnvelope` derives it from the
 * read's coverage — so a partial subtotal is recorded as the known state it was built from and
 * re-derived from that same coverage, which is why the two can never disagree.
 */
function recordedStateOf(amount: HomeSupportAmount): RecordedValueState {
  switch (amount.valueState) {
    case "value":
    case "zero":
    case "unknown":
    case "withheld":
    case "unavailable":
      return amount.valueState;
    case "incomplete-subtotal":
      return amount.minorUnits === 0 ? "zero" : "value";
  }
}

// ---------------------------------------------------------------------------------------------
// Home: building one item per record
// ---------------------------------------------------------------------------------------------

/** What every item builder needs: the authority the read ran under and the day it was evaluated on. */
interface HomeBuildContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  /** The calendar day the scenario instant falls on, or `undefined` if it could not be resolved. */
  readonly today: CivilDate | undefined;
}

/** A recorded action with a reason exactly when it is unavailable, so no caller has to invent one. */
function action(name: string, available: boolean, reason: string): ReadAction {
  return available ? { name, available: true } : { name, available: false, reason };
}

/**
 * Builds one item, with every field the surface needs already decided.
 *
 * Taking one object keeps the four facts the contract requires — identifier, section, reason,
 * destination — impossible to omit by accident, and keeps the optional ones (`onDate`, `locale`,
 * `figure`) absent rather than present-and-undefined when a record states none.
 */
function homeItem(input: {
  readonly itemId: string;
  readonly section: HomeSection;
  readonly reason: HomeReasonKey;
  readonly destination: string;
  readonly label: string | null;
  readonly status: HomeItemStatus;
  readonly onDate?: string | null;
  readonly locale?: string | null;
  readonly figure?: HomeSupportFigure;
}): HomeItem {
  return {
    itemId: input.itemId,
    section: input.section,
    reason: input.reason,
    destination: input.destination,
    label: input.label,
    status: input.status,
    onDate: input.onDate ?? null,
    locale: input.locale ?? null,
    ...(input.figure === undefined ? {} : { figure: input.figure }),
  };
}

/** Orders items by the day they are about, then by identifier, so the same read always reads alike. */
function compareByDayThenId(left: HomeItem, right: HomeItem): number {
  const leftDay = left.onDate ?? "";
  const rightDay = right.onDate ?? "";
  return leftDay === rightDay
    ? compareCodeUnits(left.itemId, right.itemId)
    : compareCodeUnits(leftDay, rightDay);
}

/**
 * The series whose plan needs review.
 *
 * One item stands for the whole missed plan, in Attention, because the alternative — three overdue
 * copies of one recurring task — is the overdue stack the specification forbids. The destination is
 * the series itself, where the three resolutions (keep this occurrence, move the next date forward,
 * stop the series) are offered, so this item promises no conversation and performs no task.
 */
function seriesPlanReviewItems(
  series: readonly TaskSeriesRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const items: HomeItem[] = [];
  for (const entry of [...series].sort((left, right) =>
    compareCodeUnits(left.seriesId, right.seriesId),
  )) {
    if (!entry.planNeedsReview || entry.state === "stopped") {
      continue;
    }
    const view = canView(context.session, {
      kind: "series",
      scope: context.scope,
      ownerPrincipalId: entry.ownerPrincipalId,
    });
    if (!view.allowed) {
      continue;
    }
    items.push(
      homeItem({
        itemId: `series:${entry.seriesId}`,
        section: "attention",
        reason: "series-plan-needs-review",
        destination: `/work/series/${entry.seriesId}`,
        label: entry.title,
        status: "needs-review",
      }),
    );
  }
  return items;
}

/**
 * The open work, split by the day it is due.
 *
 * Overdue and due-today work is Attention and future work is Information, and an undated task is
 * Unfinished work rather than an invented date: the lists it belongs to live in Work, and Home states
 * the same four facts those lists state without recomputing any of them. A task belonging to a series
 * whose plan needs review is left out here, because that series' single item already speaks for it.
 */
function taskItems(
  tasks: readonly TaskRecord[],
  planReviewSeriesIds: ReadonlySet<string>,
  context: HomeBuildContext,
): {
  readonly attention: readonly HomeItem[];
  readonly information: readonly HomeItem[];
  readonly unfinished: readonly HomeItem[];
} {
  const attention: HomeItem[] = [];
  const information: HomeItem[] = [];
  const unfinished: HomeItem[] = [];
  const dated: { readonly task: TaskRecord; readonly day: CivilDate }[] = [];

  for (const task of [...tasks].sort((left, right) =>
    compareCodeUnits(left.taskId, right.taskId),
  )) {
    if (task.status !== "open" && task.status !== "reopened") {
      continue;
    }
    if (task.seriesId !== null && planReviewSeriesIds.has(task.seriesId)) {
      continue;
    }
    const view = canView(context.session, {
      kind: "task",
      scope: context.scope,
      ownerPrincipalId: task.ownerPrincipalId,
    });
    if (!view.allowed) {
      continue;
    }
    const parsed = task.dueOn === null ? undefined : parseCivilDate(task.dueOn);
    if (parsed === undefined || parsed.status === "refused") {
      // An undated task, and one whose stored day the calendar cannot read, are never given an
      // invented date and never hidden: the Work list's Undated list is where the record is decided.
      unfinished.push(taskHomeItem(task, "unfinished-work", "task-undated", "undated", null));
      continue;
    }
    dated.push({ task, day: parsed.date });
  }

  const today = context.today;
  for (const { task, day } of dated) {
    const onDate = serialiseCivilDate(day);
    if (today === undefined) {
      // Without a resolved day boundary nothing is called overdue or due today: the item states the
      // day it is due and the Work list owns the judgement.
      information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
      continue;
    }
    const order = Temporal.PlainDate.compare(day, today);
    if (order < 0) {
      attention.push(taskHomeItem(task, "attention", "task-overdue", "overdue", onDate));
    } else if (order === 0) {
      attention.push(taskHomeItem(task, "attention", "task-due-today", "due-today", onDate));
    } else {
      information.push(taskHomeItem(task, "information", "task-upcoming", "upcoming", onDate));
    }
  }

  attention.sort(compareByDayThenId);
  information.sort(compareByDayThenId);
  unfinished.sort(compareByDayThenId);
  return { attention, information, unfinished };
}

/**
 * One task as an item.
 *
 * Every task destination is the Work surface, which owns the five lists the task belongs to: Home
 * states the fact and why it is here, and never pretends a task is decided in a menu on Home.
 */
function taskHomeItem(
  task: TaskRecord,
  section: HomeSection,
  reason: HomeReasonKey,
  status: HomeItemStatus,
  onDate: string | null,
): HomeItem {
  return homeItem({
    itemId: `task:${task.taskId}`,
    section,
    reason,
    destination: "/work",
    label: task.title,
    status,
    onDate,
  });
}

/**
 * The commitments whose recovery needs attention.
 *
 * The bucket is the source's own (`recovery-needs-attention`), never derived from an amount, and the
 * item carries no figure at all: a commitment is not cash, and urgency is never read out of money. The
 * label is the source's cadence wording, verbatim.
 */
function commitmentAttentionItems(
  commitments: readonly CommitmentRowRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const view = canView(context.session, {
    kind: "support-subject",
    scope: context.scope,
    capabilities: [],
  });
  if (!view.allowed) {
    return [];
  }
  return commitments
    .filter((record) => record.bucketState === "recovery-needs-attention")
    .sort((left, right) => compareCodeUnits(left.commitmentRowId, right.commitmentRowId))
    .map((record) =>
      homeItem({
        itemId: `commitment:${record.commitmentRowId}`,
        section: "attention",
        reason: "commitment-needs-attention",
        destination: `/support/commitments/${record.commitmentRowId}`,
        label: record.cadence,
        status: "needs-attention",
      }),
    );
}

/**
 * The publications whose notification needs attention.
 *
 * "Published, notification needs attention" is a real and valid result, so it is Unfinished work and
 * never an error: an intent with no recorded outcome, or one whose outcomes include a failed or an
 * unknown send, is reported here. None of the three per-recipient states is presented as delivery or
 * as reading — an accepted copy is a provider accepting it, which is why only the other two raise an
 * item.
 */
function notificationItems(
  intents: readonly NotificationIntentRecord[],
  results: readonly NotificationSendResultRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  // Delivery belongs to the publication family — an intent names the document and the release it was
  // recorded for — so the permission that gates an edition gates its send results too, and a caller
  // who may not read the edition is not shown that a notice for it exists.
  const view = canView(context.session, { kind: "content-variant", scope: context.scope });
  if (!view.allowed) {
    return [];
  }

  const resultsByIntent = new Map<string, NotificationSendResultRecord[]>();
  for (const result of results) {
    const existing = resultsByIntent.get(result.intentId);
    if (existing === undefined) {
      resultsByIntent.set(result.intentId, [result]);
    } else {
      existing.push(result);
    }
  }

  const items: HomeItem[] = [];
  for (const intent of [...intents].sort((left, right) =>
    compareCodeUnits(left.intentId, right.intentId),
  )) {
    const outcomes = resultsByIntent.get(intent.intentId) ?? [];
    const needsAttention =
      outcomes.length === 0 ||
      outcomes.some((outcome) => outcome.recipients.some((copy) => copy.state !== "accepted"));
    if (!needsAttention) {
      continue;
    }
    const lastRecordedAt = outcomes.at(-1)?.recordedAt ?? null;
    items.push(
      homeItem({
        itemId: `notification:${intent.intentId}`,
        section: "unfinished-work",
        reason: "notification-needs-attention",
        destination: "/communication/delivery",
        label: null,
        status: "needs-attention",
        onDate: lastRecordedAt === null ? null : civilDayOf(lastRecordedAt),
      }),
    );
  }
  return items;
}

/**
 * What actually happened, most recent first.
 *
 * Only recorded interactions appear, with the day the record states and its own type wording. A note's
 * body never travels: an interaction's private note is a different record class, and Home states that
 * something happened and where to read it, nothing more. An interaction whose partner record this
 * caller may not read is left out rather than pointing at a destination that would refuse them.
 */
function interactionItems(
  interactions: readonly InteractionRecord[],
  partners: readonly PartnerRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const view = canView(context.session, { kind: "interaction", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const items: HomeItem[] = [];
  for (const record of interactions) {
    const partner = partnersById.get(record.partnerId);
    if (partner === undefined) {
      continue;
    }
    const partnerView = canView(context.session, {
      kind: "partner",
      scope: context.scope,
      audience: partner.audience,
      authorPrincipalId: context.session.principalId,
    });
    if (!partnerView.allowed) {
      continue;
    }
    items.push(
      homeItem({
        itemId: `interaction:${record.interactionId}`,
        section: "information",
        reason: "interaction-recorded",
        destination: `/partners/${partner.partnerId}`,
        label: partner.displayName,
        status: "recorded",
        onDate: record.occurredOn,
      }),
    );
  }
  items.sort((left, right) => {
    const leftDay = left.onDate ?? "";
    const rightDay = right.onDate ?? "";
    return leftDay === rightDay
      ? compareCodeUnits(left.itemId, right.itemId)
      : compareCodeUnits(rightDay, leftDay);
  });
  return items.slice(0, RECENT_INTERACTION_LIMIT);
}

/**
 * The referral windows that carry a deadline, judged by the boundary function that owns the rule.
 *
 * A cycle whose introduction date is approximate or unknown has no deadline and therefore no window
 * state to report here; its own list is the place that says so. The status is the boundary owner's
 * answer, never a comparison written in this file, and the exact endpoint stays on the referral where
 * it is stated rather than being recomputed for a Home label.
 */
function referralItems(
  referrals: readonly ReferralCycleRecord[],
  partners: readonly PartnerRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const view = canView(context.session, { kind: "referral", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const partnersById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  const now = instantAt(context.session.clockOffsetMs);
  const items: HomeItem[] = [];
  for (const cycle of [...referrals].sort((left, right) =>
    compareCodeUnits(left.referralId, right.referralId),
  )) {
    if (cycle.consumed) {
      // A consumed cycle has already produced its one successor: its window is settled history, not
      // a window changing state, and reporting it here would state a deadline that no longer matters.
      continue;
    }
    const windowEnd = readInstant(cycle.windowEnd);
    if (windowEnd === undefined) {
      continue;
    }
    const state = referralWindowState({ windowEnd, now });
    if (state.status !== "active" && state.status !== "expired") {
      continue;
    }
    const partner = partnersById.get(cycle.partnerId);
    items.push(
      homeItem({
        itemId: `referral:${cycle.referralId}`,
        section: "information",
        reason: state.status === "active" ? "referral-window-active" : "referral-window-expired",
        destination: `/partners/referrals/${cycle.referralId}`,
        label: partner?.displayName ?? null,
        status: state.status,
      }),
    );
  }
  return items;
}

/**
 * The editions that are unfinished: a saved draft, or a candidate awaiting its one review step.
 *
 * Draft and candidate are different stages and stay different items, so a surface can never present a
 * saved draft as though it were with a reviewer. An edition whose only content is a release states no
 * item at all — published work is not unfinished — which is what keeps "saved draft" and "published
 * release" distinguishable in this data rather than in a status string a component guesses at.
 */
function contentItems(
  documents: readonly ContentDocumentRecord[],
  variants: readonly ContentVariantRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const view = canView(context.session, { kind: "content-variant", scope: context.scope });
  if (!view.allowed) {
    return [];
  }
  const documentsById = new Map(documents.map((document) => [document.documentId, document]));
  const items: HomeItem[] = [];
  for (const variant of [...variants].sort((left, right) =>
    compareCodeUnits(left.variantId, right.variantId),
  )) {
    const document = documentsById.get(variant.documentId);
    if (document === undefined) {
      continue;
    }
    const destination = contentDestination(document, variant);
    if (variant.candidateId !== null) {
      items.push(
        homeItem({
          itemId: `variant:${variant.variantId}`,
          section: "unfinished-work",
          reason: "candidate-awaiting-review",
          destination,
          label: document.kind,
          status: "awaiting-review",
          locale: variant.locale,
        }),
      );
      continue;
    }
    if (variant.draftRevisionId !== null) {
      items.push(
        homeItem({
          itemId: `variant:${variant.variantId}`,
          section: "unfinished-work",
          reason: "draft-saved",
          destination,
          label: document.kind,
          status: "draft",
          locale: variant.locale,
        }),
      );
    }
  }
  return items;
}

/** Where an edition is edited: an Update's variant editor, or the Page builder for either page family. */
function contentDestination(
  document: ContentDocumentRecord,
  variant: ContentVariantRecord,
): string {
  return document.family === "update"
    ? `/communication/${document.documentId}/${variant.variantId}`
    : `/pages/${document.documentId}`;
}

/**
 * The import proposals still awaiting decisions.
 *
 * The proposal's file name is deliberately not used as a label: it is display metadata for the worker's
 * own receipt and is never echoed into rendered output, so the surface words this item from its reason
 * key and the file itself stays where the worker chose it.
 */
function importItems(
  proposals: readonly ImportProposalRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  const view = canView(context.session, {
    kind: "partner",
    scope: context.scope,
    audience: "private",
    authorPrincipalId: context.session.principalId,
  });
  if (!view.allowed) {
    return [];
  }
  return proposals
    .filter((proposal) => proposal.processedAt === null)
    .sort((left, right) => compareCodeUnits(left.importOperationId, right.importOperationId))
    .map((proposal) =>
      homeItem({
        itemId: `import:${proposal.importOperationId}`,
        section: "unfinished-work",
        reason: "import-awaiting-decisions",
        destination: "/partners/import",
        label: null,
        status: "awaiting-review",
      }),
    );
}

/**
 * The targets this worker chose to see here.
 *
 * `homePlacement` is the only reason a target appears on Home, and placing it creates no commitment,
 * reminder or notification: the label is the worker's own private wording, which is theirs to see on
 * their own workspace and is never part of anything a coach is shown.
 */
function targetItems(
  targets: readonly CoachingTargetRecord[],
  context: HomeBuildContext,
): readonly HomeItem[] {
  return targets
    .filter(
      (target) =>
        target.workerPrincipalId === context.session.principalId &&
        target.homePlacement === "placed" &&
        target.state !== "ended",
    )
    .sort((left, right) => compareCodeUnits(left.targetId, right.targetId))
    .map((target) =>
      homeItem({
        itemId: `target:${target.targetId}`,
        section: "information",
        reason: "target-placed-on-home",
        destination: "/coaching/targets",
        label: target.privateLabel,
        status: target.state === "paused" ? "paused" : "placed",
      }),
    );
}

/**
 * The one financial item: received support in the current period.
 *
 * The figure is `runReport`'s, so the item states the same number, coverage and as-of time as the
 * Support overview. An unavailable figure keeps its item: the surface then says the source could not
 * be read, which is a different sentence from "nothing was received this month".
 */
function supportItem(figure: HomeSupportFigure): HomeItem {
  return homeItem({
    itemId: SUPPORT_ITEM_ID,
    section: "information",
    reason: "support-received-this-period",
    destination: "/support",
    label: null,
    status: "received",
    figure,
  });
}

/**
 * The calendar day an instant falls on, in the zone Home declares, or `null` when it cannot be read.
 *
 * The conversion is `modules/time/civil`'s, so the zone vocabulary and the calendar rule keep one
 * owner; this function only decides that a day it cannot resolve is stated as absent.
 */
function civilDayOf(value: string): string | null {
  const instant = readInstant(value);
  if (instant === undefined) {
    return null;
  }
  const resolved = civilDateAt(instant, HOME_TIME_ZONE);
  return resolved.status === "resolved" ? serialiseCivilDate(resolved.date) : null;
}

// ---------------------------------------------------------------------------------------------
// Scope and admission, shared by the three reads
// ---------------------------------------------------------------------------------------------

/** Wraps a built envelope as the answering half of a read. */
function envelopeResult<T>(envelope: ReadEnvelope<T>): ReadResult<ReadEnvelope<T>> {
  return { kind: "envelope", envelope };
}

/** The context a session's stored record states, with the scope it is the authority for. */
interface StoredSelection {
  readonly context: AdmissionContext;
  readonly scope: Scope;
}

/**
 * Reads the context the session's own record states, or `undefined` when none has been chosen.
 *
 * The session context record is the root of scope, so its three selections plus its principal are what
 * a read acts under. A partial selection is not a context: unless all three are stated, nothing is,
 * and no default organisation, ministry or finance subject is ever substituted for a missing one.
 */
function selectionOf(record: SessionContextRecord): StoredSelection | undefined {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  if (
    selectedOrganizationId === null ||
    selectedMinistryId === null ||
    selectedSupportSubjectId === null
  ) {
    return undefined;
  }
  return {
    context: {
      organizationId: selectedOrganizationId,
      ministryId: selectedMinistryId,
      supportSubjectId: selectedSupportSubjectId,
    },
    scope: {
      organizationId: selectedOrganizationId,
      ministryId: selectedMinistryId,
      supportSubjectId: selectedSupportSubjectId,
      principalId: record.principalId,
    },
  };
}

/**
 * Groups the memberships the session resolver admitted, marking the one in force.
 *
 * The order is the session's own, because it is the order the session stated its admissions in. No
 * membership the principal does not hold can reach this list: it is built from the resolved session,
 * not from the store, so a disabled or greyed entry cannot disclose that another context exists.
 *
 * Both labels are empty because the store states no organisation or ministry name — the memberships
 * are three opaque references — and an empty label is exactly what the shell's context indicator
 * expects: it falls back to the reference rather than rendering a blank prominent line.
 */
function groupAdmissions(
  memberships: readonly AdmittedMembership[],
  selected: AdmissionContext | undefined,
): readonly ContextChooserGroup[] {
  const groups = new Map<string, { ministries: AdmittedMinistryEntry[] }>();
  for (const membership of memberships) {
    const existing = groups.get(membership.organizationId) ?? { ministries: [] };
    existing.ministries.push({
      ministryId: membership.ministryId,
      ministryLabel: "",
      supportSubjectId: membership.supportSubjectId,
      selected:
        selected !== undefined &&
        selected.organizationId === membership.organizationId &&
        selected.ministryId === membership.ministryId &&
        selected.supportSubjectId === membership.supportSubjectId,
    });
    groups.set(membership.organizationId, existing);
  }
  return [...groups.entries()].map(([organizationId, group]) => ({
    organizationId,
    organizationLabel: "",
    ministries: group.ministries,
  }));
}

/** The distinct ministry count a session admits, which is what decides whether a chooser is offered. */
function admittedMinistryCount(memberships: readonly AdmittedMembership[]): number {
  const distinct = new Set(
    memberships.map((membership) => `${membership.organizationId}::${membership.ministryId}`),
  );
  return distinct.size;
}

/**
 * The actions the admission statement offers, derived from the session's own state.
 *
 * Advisory only — the service re-derives scope and permission when one is submitted — and each absent
 * action states why it is absent. `selectContext` is the one mutation this job's inventory names, and
 * only a signed-in session that admits more than one ministry can perform it: a single ministry opens
 * directly, and a session that has expired, was denied, is unavailable or holds no account admits no
 * authority at all, so its reason states that admission fact rather than a ministry count the state
 * does not grant.
 *
 * No session-switch action is offered. The session a preview acts as is chosen by the development
 * session cookie the seeded sessions are addressed by, and this release has no switch mutation — the
 * development runtime's own commands are scenario, clock, failure plan and reset — so a
 * `switchDevelopmentSession` entry would name a control that can never act. Switching between the
 * seeded sessions stays a development control of the shell, outside this envelope.
 */
function admissionActions(session: ResolvedSession): readonly ReadAction[] {
  switch (session.sessionState) {
    case "signed-in": {
      const ministryCount = admittedMinistryCount(session.admittedMemberships);
      return [
        action(
          "selectContext",
          ministryCount > 1,
          ministryCount === 1
            ? "One ministry is admitted, so that context opens directly and there is nothing to choose."
            : ministryCount === 0
              ? "The session admits no ministry, so there is no context to select."
              : "Several ministries are admitted, so a context can be selected.",
        ),
      ];
    }
    case "no-access":
      return [
        action(
          "selectContext",
          false,
          "This session is not admitted: the account it names holds no membership, so there is no context to select.",
        ),
      ];
    case "denied":
      return [
        action(
          "selectContext",
          false,
          "This session is not admitted, so there is no context to select.",
        ),
      ];
    case "expired":
      return [
        action(
          "selectContext",
          false,
          "This session has expired and is not admitted, so there is no context to select.",
        ),
      ];
    case "unavailable":
      return [
        action(
          "selectContext",
          false,
          "This session is unavailable and is not admitted, so there is no context to select.",
        ),
      ];
  }
}

/** The value-state map for a stated support figure, keyed by the path the surface reads. */
function supportValueStates(
  figure: HomeSupportFigure,
): Readonly<Record<string, RecordedValueState>> {
  const states: Record<string, RecordedValueState> = {};
  for (const amount of figure.amounts) {
    states[`${SUPPORT_ITEM_ID}.figure.amounts.${amount.currency}.minorUnits`] =
      recordedStateOf(amount);
  }
  return states;
}

// ---------------------------------------------------------------------------------------------
// readAdmissionState
// ---------------------------------------------------------------------------------------------

/**
 * Reads the session's admission: which of the five states it is in, the guidance key the shell renders,
 * and — only when admitted — the principal, the selected context and the scenario it runs in.
 * Answers `envelope`, `denied` when the session cannot be established or a stated context is not
 * admitted, and `unavailable` when the store itself could not answer.
 */
export async function readAdmissionState(): Promise<ReadResult<ReadEnvelope<AdmissionStateData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    // No usable session is a refusal, not an empty workspace: the shell is told nothing about any
    // record, and it offers the retry or sign-in guidance it owns. A store that could not answer is
    // the different fact, and it reaches the surface as the outage it is.
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  const asOf = asOfText(session);
  const source = storeSource(ADMISSION_SEED_REFERENCE);
  const actions = admissionActions(session);
  const coverage: Coverage = { from: null, to: asOf, state: "complete" };

  let storedContext: SessionContextRecord;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readAdmissionState", source);
    }
    const parsed = admissionDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readAdmissionState", source);
    }
    storedContext = parsed.data.context;
  } catch {
    return sourceUnavailableResult("readAdmissionState", source);
  }

  if (session.sessionState !== "signed-in") {
    // The four states that grant nothing state the state, its guidance and the session record's
    // revision, and no principal, membership, count or size at all.
    return envelopeResult(
      buildEnvelope<AdmissionStateData>({
        data: {
          state: session.sessionState,
          guidance: GUIDANCE_BY_STATE[session.sessionState],
          principalId: null,
          context: null,
          scenarioId: null,
        },
        scope: NO_CONTEXT_SCOPE,
        source,
        revision: storedContext.revision,
        asOf,
        coverage,
        valueStates: {},
        actions,
      }),
    );
  }

  const selection = selectionOf(storedContext);
  if (selection === undefined) {
    // Admitted, but no context chosen yet: the shell shows the chooser, and this read states no
    // context because none is in force. Nothing is assumed in its place.
    return envelopeResult(
      buildEnvelope<AdmissionStateData>({
        data: {
          state: "signed-in",
          guidance: "workspace-ready",
          principalId: session.principalId,
          context: null,
          scenarioId: session.scenarioId,
        },
        scope: NO_CONTEXT_SCOPE,
        source,
        revision: storedContext.revision,
        asOf,
        coverage,
        valueStates: {},
        actions,
      }),
    );
  }

  const admission = assertScope(session, selection.scope);
  if (!admission.ok) {
    return { kind: "denied", denied: admission.denial };
  }

  return envelopeResult(
    buildEnvelope<AdmissionStateData>({
      data: {
        state: "signed-in",
        guidance: "workspace-ready",
        principalId: session.principalId,
        context: selection.context,
        scenarioId: session.scenarioId,
      },
      scope: selection.scope,
      source,
      revision: storedContext.revision,
      asOf,
      coverage,
      valueStates: {},
      actions,
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// readContextChooser
// ---------------------------------------------------------------------------------------------

/**
 * Reads the memberships this session may act in, grouped by organisation and ministry, with the one in
 * force marked and `directEntry` set when a single ministry makes a chooser unnecessary. Answers
 * `envelope`, `denied` for a session that is not signed in, and `unavailable` when the store itself
 * could not answer.
 */
export async function readContextChooser(): Promise<ReadResult<ReadEnvelope<ContextChooserData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  if (session.sessionState !== "signed-in") {
    // A session that cannot act enumerates nothing. Which state it is in is `readAdmissionState`'s
    // answer, and a denial never carries it.
    return deniedResult<ContextChooserData>("not-admitted");
  }

  const asOf = asOfText(session);
  const source = storeSource(CHOOSER_SEED_REFERENCE);

  let storedContext: SessionContextRecord;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readContextChooser", source);
    }
    const parsed = admissionDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readContextChooser", source);
    }
    storedContext = parsed.data.context;
  } catch {
    return sourceUnavailableResult("readContextChooser", source);
  }

  const selection = selectionOf(storedContext);
  const groups = groupAdmissions(session.admittedMemberships, selection?.context);
  const ministryCount = admittedMinistryCount(session.admittedMemberships);
  const data: ContextChooserData = { directEntry: ministryCount === 1, groups };

  return envelopeResult(
    buildEnvelope<ContextChooserData>({
      data,
      scope: selection?.scope ?? NO_CONTEXT_SCOPE,
      source,
      revision: storedContext.revision,
      asOf,
      coverage: { from: null, to: asOf, state: "complete" },
      valueStates: {},
      actions: [
        action(
          "selectContext",
          ministryCount > 1,
          ministryCount === 1
            ? "One ministry is admitted, so the workspace opens directly and no chooser is offered."
            : "The session admits no ministry, so there is no context to select.",
        ),
      ],
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// readHome
// ---------------------------------------------------------------------------------------------

/**
 * Reads the worker's day as Attention, Information and Unfinished work, every item carrying why it is
 * there and where it goes, with received support stated through the one report computation. Answers
 * `envelope`, `denied` for a session that is not signed in or has no context in force, and
 * `unavailable` when the store itself could not answer.
 */
export async function readHome(): Promise<ReadResult<ReadEnvelope<HomeData>>> {
  const resolution = await resolveSession();
  if (!resolution.ok) {
    return readResultOfRefusal(resolution.refusal);
  }
  const session = resolution.session;
  if (session.sessionState !== "signed-in") {
    return deniedResult<HomeData>("not-admitted");
  }

  const at = instantAt(session.clockOffsetMs);
  const asOf = at.toString();
  const source = storeSource(HOME_SEED_REFERENCE);

  let document: HomeDocument;
  let workloadGifts: readonly GiftRowRecord[] = [];
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return sourceUnavailableResult("readHome", source);
    }
    const parsed = homeDocumentSchema.safeParse(documents.state);
    if (!parsed.success) {
      return sourceUnavailableResult("readHome", source);
    }
    document = parsed.data;
    if (documents.workload !== undefined) {
      const workload = workloadGiftDocumentSchema.safeParse(documents.workload);
      if (!workload.success) {
        return sourceUnavailableResult("readHome", source);
      }
      workloadGifts = workload.data.gifts;
    }
  } catch {
    return sourceUnavailableResult("readHome", source);
  }

  const selection = selectionOf(document.context);
  if (selection === undefined) {
    // Signed in with no context in force: this principal may not enumerate a ministry's work, and an
    // empty Home would be indistinguishable from a quiet day. A principal admitted to nothing and one
    // that has simply not chosen yet are told apart by the reason code, which is the only fact a
    // refusal may carry.
    return deniedResult<HomeData>(
      session.admittedMemberships.length === 0 ? "no-membership" : "not-admitted",
    );
  }
  const admission = assertScope(session, selection.scope);
  if (!admission.ok) {
    return { kind: "denied", denied: admission.denial };
  }

  const build: HomeBuildContext = { session, scope: selection.scope, today: todayFor(at) };

  const figure =
    document.supportProjection === null
      ? undefined
      : homeSupportFigure({
          projectionRecord: document.supportProjection,
          gifts: document.gifts,
          workloadGifts,
          commitments: document.commitments,
          scope: selection.scope,
          asOf,
        });

  const planReviewSeriesIds = new Set(
    document.series.filter((entry) => entry.planNeedsReview).map((entry) => entry.seriesId),
  );
  const taskPartition = taskItems(document.tasks, planReviewSeriesIds, build);

  const attention: HomeItem[] = [
    ...seriesPlanReviewItems(document.series, build),
    ...commitmentAttentionItems(document.commitments, build),
    ...taskPartition.attention,
  ];
  const information: HomeItem[] = [
    ...(figure === undefined ? [] : [supportItem(figure)]),
    ...referralItems(document.referrals, document.partners, build),
    ...interactionItems(document.interactions, document.partners, build),
    ...taskPartition.information,
    ...targetItems(document.coachingTargets, build),
  ];
  const unfinished: HomeItem[] = [
    ...contentItems(document.contentDocuments, document.contentVariants, build),
    ...importItems(document.importProposals, build),
    ...notificationItems(document.notificationIntents, document.notificationResults, build),
    ...taskPartition.unfinished,
  ];

  const items: readonly HomeItem[] = [...attention, ...information, ...unfinished];
  const coverage: Coverage = figure?.coverage ?? { from: null, to: asOf, state: "complete" };
  const hasDueWork = items.some(
    (item) => item.reason === "task-overdue" || item.reason === "task-due-today",
  );
  const hasPlanReview = items.some((item) => item.reason === "series-plan-needs-review");
  const hasNotificationAttention = items.some(
    (item) => item.reason === "notification-needs-attention",
  );

  return envelopeResult(
    buildEnvelope<HomeData>({
      data: { items },
      scope: selection.scope,
      source,
      revision: document.context.revision,
      asOf,
      coverage,
      valueStates: figure === undefined ? {} : supportValueStates(figure),
      actions: [
        action("completeTask", hasDueWork, "No open task is dated for today or earlier."),
        action("resolveMissedPlan", hasPlanReview, "No recurring plan needs review."),
        action(
          "requestNotification",
          hasNotificationAttention,
          "No published edition has a notification that needs attention.",
        ),
      ],
    }),
  );
}

/**
 * The received-support figure for Home, or the statement that its source could not answer.
 *
 * The projection is built from the session's own gift rows plus any generated workload the session
 * holds, so a session measured over the published workload states the same period total the Support
 * surfaces state. A record that cannot be projected — a stored date the calendar refuses, a query the
 * report family refuses — leaves Home usable and this one figure unavailable, because a source that
 * cannot answer must never stop independent work from being done.
 */
function homeSupportFigure(input: {
  readonly projectionRecord: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly workloadGifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly scope: Scope;
  readonly asOf: string;
}): HomeSupportFigure {
  try {
    return statedSupportFigure({
      projectionRecord: input.projectionRecord,
      gifts: [...input.gifts, ...input.workloadGifts],
      commitments: input.commitments,
      scope: input.scope,
      asOf: input.asOf,
    });
  } catch {
    logger.sourceUnavailable({ job: "readHome", source: input.projectionRecord.source });
    return unavailableSupportFigure(input.projectionRecord, input.asOf);
  }
}
