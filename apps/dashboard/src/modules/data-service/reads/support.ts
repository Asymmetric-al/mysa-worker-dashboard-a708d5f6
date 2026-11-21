/**
 * The support family's six reads: the overview, the gifts ledger, the commitments, the goal, the four
 * fixed reports and the whole-query export.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Reads: support" — `readSupportOverview`, `readGifts`, `readCommitments`, `readGoal`,
 *   `readReport` over `support/report`, `money` and the store projections.
 * - AAP 0.7.1's job groups "Understand support" (the five reads above) and "Take support out of the
 *   app" (`readExport`, the same query in CSV form, which performs no state change).
 * - AAP 0.8.1, 0.8.8 and criterion 1 — whole-query agreement among the on-screen total, the chart
 *   series, the table rows, the drilldown, the CSV and the print view.
 * - AAP 0.9.1's tree row and the 0.11.1 deliverable row `modules/data-service/reads/support.ts`.
 *
 * There is exactly one financial computation in this application, and it is not here:
 * `modules/support/report`'s `runReport(query, projection)` produces the single `ReportResult` that
 * the overview, the ledger, the chart, the matrix, the drilldown, the CSV and the print model all
 * read. Every read below calls it and copies its answer. Nothing here re-aggregates, re-sums,
 * averages, caches a total, derives one by subtraction or sorts a financial row set itself, which is
 * what makes the five surfaces agree in count and in minor-unit sums per currency instead of agreeing
 * by careful copying.
 *
 * The measure, grain and coverage this file carries into every envelope are AAP 0.8.8's, stated once
 * in `modules/support/basis`: received support on the one named effective-cash-allocation basis,
 * attributed to each gift's own original gift date, within a stated currency and period, at a stated
 * coverage and as-of time. The grain is one authorised allocation — a gift with no allocation counts
 * once at gift grain, and a split gift contributes only the allocation this read is authorised to see
 * — so the gift, allocation and donor counts are three counts at three grains and are never added
 * together. The five measures (received gifts, recurring collection outcomes, commitments,
 * monthly-equivalent support and the support goal) stay five and are never summed into one "total
 * support": a commitment is never received money, a processing occurrence is never cash, an unmatched
 * received gift never fulfils a promise, and a monthly equivalent is the source's own qualification
 * rather than a division of gifts.
 *
 * Authorisation precedes enumeration. Scope is derived from the development session on every call and
 * is never taken from an argument, so a caller has no way to name a context it is not admitted to; a
 * denial carries no count, no title, no existence flag and no total, because the shape of a denial
 * must not become an oracle for records the caller may not read. An absent financial source is
 * `unavailable` with its source identity — never an empty list and never a zero — so a surface says
 * "the source could not be read" instead of showing a figure the source never stated, and unrelated
 * contact, work and content jobs keep working.
 *
 * Filter state is answered in the envelope's `actions`. The closed read result has three branches —
 * an envelope, a denial and an unavailable source — and none of them is "the request was not valid",
 * so a filter this file refuses (an amount range beside every currency, an unresolvable zone, a
 * giving-method facet this projection does not carry) is stated as an action that is not available,
 * with the reason the report gate gave for it. Nothing is silently dropped: the query actually applied
 * travels in `result.snapshot.query`, so a surface can always state what its figures cover.
 *
 * Layering: a server-side module imported by Server Components and thin Route Handlers. It reads no
 * clock of its own (a session's persisted scenario offset is the only time source), imports no
 * component, no feature and no application route, and reaches the synthetic store through
 * `readSession` alone.
 */

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { readSession } from "@/modules/store/repository";
import {
  BUCKET_LABELS,
  COMMITMENT_KINDS,
  OUTSIDE_PARTITION,
  PARTITION_BUCKETS,
  isInPartition,
  type CommitmentKind,
  type CommitmentRow,
  type FixedTotalProgress,
  type RecurringBucket,
} from "@/modules/support/buckets";
import type { GiftRow, SupportProjection } from "@/modules/support/basis";
import {
  GOAL_CAPABILITY,
  GOAL_MEASURE,
  formatPercentageBasisPoints,
  goalProgress,
  type GoalProgress,
} from "@/modules/support/goal";
import {
  CSV_ALL_CURRENCIES,
  snapshotMetadata,
  toCsv,
  type SnapshotFact,
} from "@/modules/export/csv";
import { printModel, type PrintModel } from "@/modules/export/print";
import {
  PERIOD_PRESETS,
  REPORT_IDS,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  buildReportQuery,
  clampPageSize,
  runReport,
  type CurrencySelection,
  type PeriodPreset,
  type PeriodState,
  type ReportId,
  type ReportPartnerSelection,
  type ReportPeriod,
  type ReportQuery,
  type ReportQueryProblem,
  type ReportResult,
  type ReportScope,
  type Snapshot,
  type SortDirection,
  type SortField,
} from "@/modules/support/report";
import { instantAt } from "@/modules/time/clock";
import {
  parseCivilDate,
  serialiseCivilDate,
  type CivilDate,
} from "@/modules/time/civil";

import {
  assertScope,
  canEdit,
  canExport,
  resolveSession,
  type AccessDecision,
  type ResolvedSession,
  type SessionSource,
} from "../authorize";
import {
  buildEnvelope,
  commitmentRowRecordSchema,
  coverageSchema,
  giftRowRecordSchema,
  project,
  supportProjectionRecordSchema,
  type CommitmentRowRecord,
  type Coverage,
  type FinancialCoverage,
  type GiftRowRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
  type SupportGoalRecord,
  type SupportProjectionRecord,
  type ValueState,
} from "../envelope";
import {
  LOCAL_STORE_SYSTEM,
  denied,
  unavailable,
  type DenialReason,
  type DeniedOutcome,
  type ReadResult,
  type UnavailableOutcome,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// Fixed values this module states once
// ---------------------------------------------------------------------------------------------

/**
 * The attempt identity a read refusal carries.
 *
 * A read has no attempt to replay, so it names no operation: the value exists because a denial's shape
 * is the same for a read and a write, and the only field that may differ between two refusals is the
 * reason code. `../authorize` and the sibling reads state the same marker.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The date basis every financial figure in this file is attributed by: each gift's own original date.
 *
 * It is stated in the envelope's coverage because a total is comparable with another only when the
 * currency, the basis and the date attribution agree. The word is this application's vocabulary for
 * the fact; the basis itself is `modules/support/basis`'s one name.
 */
const DATE_BASIS = "original-gift-date";

/**
 * The grain every row, count and export in this file is stated at: one authorised allocation, or one
 * whole gift where the gift carries no allocation.
 *
 * It matches the grain word the CSV writer states in its own metadata record, because both surfaces
 * describe the same rows; a reader comparing the two must not find two words for one grain.
 */
const GIFT_ROW_GRAIN = "gift-allocation";

/**
 * The revision a goal read states when the subject has set no goal.
 *
 * A goal is the only writable financial fact, and its own revision is the token an edit presents as
 * `expectedRevision`. With no goal there is no such token, and stating the projection's revision
 * instead would give an edit a concurrency token for a record that does not exist — so the absence is
 * stated as its own word, which no stored revision can be.
 */
const GOAL_ABSENT_REVISION = "absent";

/** What a caller is told when this session's records could not be read at all. */
const STORE_UNAVAILABLE_GUIDANCE =
  "This session's records could not be read. Nothing was changed; try again in a moment.";

/**
 * What a caller is told when the financial source answered but its figures could not be computed.
 *
 * The source is named on the outcome; the guidance promises no figure and blames no person, and it
 * keeps independent work honest: contact, work and content read the same session's other records and
 * are unaffected by this outage.
 */
const SUPPORT_SOURCE_GUIDANCE =
  "The financial source could not answer for this period, so no amount is stated here — this is not zero and not an empty result. Try again in a moment; nothing was changed.";

/**
 * What a caller is told when the support subject states no projection at all.
 *
 * A subject with no projection is a source that did not answer, not a subject with no giving: the two
 * would render alike as "0 received", and a zero this application never established is exactly what
 * the value-state vocabulary exists to prevent.
 */
const NO_SUPPORT_PROJECTION_GUIDANCE =
  "No financial source is established for this subject, so no amount is stated — this is not zero and not an empty result. The source's owner has to supply its projection before any figure can be reported.";

/** The one sentence stating why the amount-range facet is unavailable while every currency is read. */
const AMOUNT_RANGE_PARTITION_REASON =
  "An amount range compares one currency's amounts, so it is applied only while a single currency is selected. Choose one currency to use it; no range is ever applied across currencies, because two currencies have no ordering here.";

/** The one sentence stating why this projection offers no giving-method facet. */
const METHOD_FILTER_REASON =
  "The support projection carries no giving-method or classification field, so this facet cannot be applied to it. A filter that was never applied is not presented as a filtered result.";

/** The one sentence stating why a whole-query download is unavailable to this caller. */
const EXPORT_UNAVAILABLE_REASON =
  "This session holds no export permission for this context, so the whole query cannot be downloaded. The figures on screen are unaffected.";

/** The one sentence stating why a goal cannot be edited from this envelope. */
const GOAL_EDIT_UNAVAILABLE_REASON =
  "This session does not hold the goal-editing capability, so the goal is read-only here: no edit control is offered and a save would be refused.";

/**
 * The development scenario whose whole point is that the financial source is down.
 *
 * The scenario registry lives in `modules/dev-runtime/scenario.ts`, which a read may not import: the
 * development runtime is the seam a later owner replaces, and a read that imported it would depend on
 * the controls rather than on the data. The identifier is therefore repeated here, exactly as
 * `authorize.ts` repeats the goal capability across the same boundary, and it is stated as one
 * constant so a rename is a one-line change rather than a scattered hunt.
 *
 * The consequence of the repetition is stated rather than hidden: if that scenario were ever renamed,
 * this check would stop matching and the read would answer as though the source were available. That is
 * the fail-open direction, which is why the last line of defence is not here — the scenario's own
 * session state (`unavailable`) refuses at the admission gate, and the source identity on every
 * `unavailable` answer names what could not be read.
 */
const FINANCIAL_SOURCE_UNAVAILABLE_SCENARIO = "financial-source-unavailable";

/** The job name each read carries into its one diagnostic line, so a log names the read that failed. */
const JOB_OVERVIEW = "readSupportOverview";
const JOB_GIFTS = "readGifts";
const JOB_COMMITMENTS = "readCommitments";
const JOB_GOAL = "readGoal";
const JOB_REPORT = "readReport";
const JOB_EXPORT = "readExport";

/**
 * The report identity each read computes from.
 *
 * Four of the six reads state received support for the period the caller names: the overview is the
 * cash-first view of that period, the ledger is the same period's rows, the goal is measured against
 * the same period's received total, and the export is the same query in file form. The report read
 * chooses one of the four identities instead, and the ledger's identity is the one that carries the
 * equal-elapsed comparison the overview shows secondarily.
 */
const OVERVIEW_REPORT_ID: ReportId = "received-period-and-year-to-date";
const LEDGER_REPORT_ID: ReportId = "received-period-and-year-to-date";
const GOAL_REPORT_ID: ReportId = "received-period-and-year-to-date";
const EXPORT_REPORT_ID: ReportId = "received-period-and-year-to-date";

/**
 * The period each read resolves when the caller states none.
 *
 * A preset names a period rather than an instant, so the same query against the same session resolves
 * to the same two civil dates — the report engine resolves it against the session's scenario instant
 * in the zone the query declares, and never against a host clock. The overview, the ledger, the goal
 * and the export default to the current month because that is the period a worker arrives to look at;
 * the two yearly reports default to the year their own names state.
 */
const DEFAULT_PERIOD: ReportPeriod = { kind: "preset", preset: "this-month" };
const GOAL_DEFAULT_PERIOD: ReportPeriod = { kind: "preset", preset: "year-to-date" };

/** The default period of each of the four fixed reports, keyed so a fifth report cannot be added unnamed. */
const REPORT_DEFAULT_PERIOD: Readonly<Record<ReportId, ReportPeriod>> = Object.freeze({
  "received-period-and-year-to-date": { kind: "preset", preset: "year-to-date" },
  "monthly-history": { kind: "preset", preset: "this-year" },
  "partner-month-matrix": { kind: "preset", preset: "this-year" },
  "period-comparison": { kind: "preset", preset: "this-month" },
});

/**
 * The action names this file publishes for filter state, in the order every list states them.
 *
 * A name is the identity of one action a surface may offer; a refusal is reported against the same
 * name, so a toolbar disables the facet it could not apply instead of presenting a filtered view that
 * was never filtered.
 */
const FILTER_ACTION_BY_FIELD: Readonly<Record<string, string>> = Object.freeze({
  period: "filterByPeriod",
  "period.preset": "filterByPeriod",
  "period.year": "filterByPeriod",
  "period.kind": "filterByPeriod",
  currency: "filterByCurrency",
  "currency.currency": "filterByCurrency",
  "currency.kind": "filterByCurrency",
  amountRange: "filterByAmountRange",
  partner: "filterByPartner",
  "partner.partnerId": "filterByPartner",
  "partner.kind": "filterByPartner",
  designation: "filterByDesignation",
  method: "filterByMethod",
  search: "search",
  sort: "sortRows",
  "sort.field": "sortRows",
  "sort.direction": "sortRows",
  page: "pageRows",
  "page.index": "pageRows",
  "page.size": "pageRows",
  timeZone: "resolvePeriodZone",
  reportId: "selectReport",
  scope: "selectContext",
});

/** The action name a refused field is reported under, and the fallback for a field this file has not named. */
const UNNAMED_FILTER_ACTION = "refuseFilter";

// ---------------------------------------------------------------------------------------------
// The query a caller states
// ---------------------------------------------------------------------------------------------

/**
 * The period a caller names: one of the five presets, two civil days, or a calendar year.
 *
 * The values arrive from a request as strings, so they are stated as strings here and read against
 * `modules/time/civil` before they reach the report engine. A preset resolves against the session's
 * scenario instant in the zone the query declares, an explicit range is inclusive at both ends and
 * compared as civil dates, and a year is normalised by the report engine into the range it names.
 */
export type SupportPeriodInput =
  | { readonly kind: "preset"; readonly preset: string }
  | { readonly kind: "explicit"; readonly from: string; readonly to: string }
  | { readonly kind: "year"; readonly year: number };

/**
 * The attribution a result is restricted to.
 *
 * `anonymous` is a supporter who chose not to be identified and `unresolved` is a source row that
 * supplied no attribution at all. Neither is a household, a church or an organisation representative,
 * and neither ever borrows a partner's identity in order to be filterable.
 */
export type SupportPartnerInput =
  | { readonly kind: "partner"; readonly partnerId: string }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unresolved" };

/**
 * The bounded filter set a support read accepts, in the one shape all six share.
 *
 * This is the whole set and no read invents a sixteenth member: the period, the currency, an amount
 * range inside that currency, the attribution, the source's designation, the source's method or
 * classification where the projection admits one, a search term over permitted fields, a sort, a page
 * window and the zone a preset resolves in.
 *
 * Two rules follow from the projection and are enforced by the report gate rather than restated here.
 * An amount range compares minor units of one currency, so it may be stated only beside a single
 * selected currency: `currency` omitted means every currency present is read as a partition, and a
 * range beside it is refused with its reason instead of being applied across codes. `method` cannot be
 * applied at all, because the projection carries no giving-method field; stating it produces a refusal
 * rather than a silently unfiltered result.
 */
export interface SupportQuery {
  readonly period?: SupportPeriodInput;
  /** One ISO currency code; omitted reads every currency present as a partition, never one total. */
  readonly currency?: string;
  /** An inclusive range in the selected currency's minor units, never a major-unit decimal. */
  readonly amountRange?: { readonly minMinor: number; readonly maxMinor: number };
  readonly designation?: string;
  readonly partner?: SupportPartnerInput;
  readonly method?: string;
  readonly search?: string;
  readonly sort?: { readonly field?: string; readonly direction?: string };
  /** Omitted reads the whole result, which is the export and print path; a list states its page. */
  readonly page?: { readonly index?: number; readonly size?: number };
  /** The zone a period preset resolves in; omitted resolves in the declared default. */
  readonly timeZone?: string;
}

/** The page window a list accepts where the read states no period of its own. */
export interface SupportPageInput {
  readonly page?: { readonly index?: number; readonly size?: number };
}

// ---------------------------------------------------------------------------------------------
// The figures every read states
// ---------------------------------------------------------------------------------------------

/**
 * One currency's stated amount: the exact minor units, the exponent they are read at, and the state
 * that says what kind of value this is.
 *
 * `minorUnits` is `null` whenever the state says no amount may be stated — a currency this
 * application holds no exponent for, a withheld value, a source that is down — and `exponent` is
 * `null` for exactly the currencies the money table does not hold. A genuine zero keeps state `zero`,
 * so a zero and a gap never render alike. Every member is copied from the report result the read
 * computed; none is derived here.
 */
export interface SupportAmount {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
}

/**
 * The period a figure covers, with the state that says whether it has closed.
 *
 * `in-progress` means the period contains or follows the instant the read was evaluated at, so its
 * subtotals cover only the part of it that has happened. The state is the report engine's, never a
 * judgement this file makes.
 */
export interface SupportPeriod {
  readonly from: string;
  readonly to: string;
  readonly state: PeriodState;
}

/**
 * One of the recurring outcome buckets, with the count of commitments the source places in it.
 *
 * The five in-partition buckets are listed in the product's order and `outside-partition` follows
 * them: it is where evidence the source could not place — unknown or stale — is reported, and it is
 * deliberately not a sixth outcome. No badge, count or series may imply one, and a bucket never
 * implies that this application can retry, post, correct or refund a payment, because it cannot.
 */
export interface RecurringBucketFigure {
  readonly bucket: RecurringBucket;
  /** The reader-facing label, from the buckets module's one spelling of it. Never a colour alone. */
  readonly label: string;
  /** Whether this bucket is one of the five; `false` only for `outside-partition`. */
  readonly inPartition: boolean;
  readonly count: number;
  readonly valueState: ValueState;
}

/** One of the three commitment kinds, with the count of commitments of that kind. */
export interface CommitmentKindFigure {
  readonly kind: CommitmentKind;
  readonly count: number;
  readonly valueState: ValueState;
}

/**
 * One commitment's source-qualified monthly equivalent, per currency.
 *
 * The value is the source's own qualified calculation, carried on the commitment; it is never an
 * average of received gifts and never a division of a cadence by this application. A commitment whose
 * source qualified none states no amount at all, which is why the figure is absent rather than zero.
 */
export interface MonthlyEquivalentFigure {
  readonly commitmentRowId: string;
  readonly cadence: string;
  readonly amount: SupportAmount;
}

/** A fixed-total commitment's promised, fulfilled, released and remaining amounts, as the source states them. */
export interface SupportFixedTotalFigure {
  readonly promised: Money;
  readonly fulfilled: Money;
  readonly released: Money;
  readonly remaining: Money;
}

/**
 * One commitment as the commitments read states it.
 *
 * Read-only in every field: this application holds no retry, no pause, no edit and no correction for a
 * commitment, so the words describing its standing are the source's and the only writable financial
 * fact in the application is the goal. `perOccurrence` is the amount the source reports for one
 * occurrence of the stated cadence, and the four fixed-total amounts are stated only for a
 * `fixed-total` commitment: a recurring commitment states none, so an absent total is never a zero.
 */
export interface CommitmentFigure {
  readonly commitmentRowId: string;
  readonly kind: CommitmentKind;
  /** The source's own cadence wording, carried verbatim and never parsed into a rate. */
  readonly cadence: string;
  readonly perOccurrence: Money;
  readonly perOccurrenceState: ValueState;
  readonly bucket: RecurringBucket;
  readonly bucketLabel: string;
  readonly inPartition: boolean;
  readonly lastSuccessfulOn: string | null;
  readonly nextEligibleOn: string | null;
  readonly pause: { readonly state: "active" | "paused"; readonly resumeOn: string | null };
  readonly fixedTotal: SupportFixedTotalFigure | null;
  /** The source's qualified monthly equivalent, or `null` when the source qualified none. */
  readonly monthlyEquivalent: SupportAmount | null;
}

/**
 * The support overview: the cash-first figures for one period, then the secondary non-cash ones.
 *
 * `report` is the whole of the cash side and every figure in it — the per-currency summary, the
 * monthly series with its gaps, the equal-elapsed comparison and the goal progress — is read from
 * that one computation. Its `summary` states the received amount per currency with the three counts at
 * their own grains, so no member of this data restates a figure: to state one twice would be to risk
 * two spellings of it.
 *
 * The other three members are the non-cash measures, each kept visibly apart. Recurring collection
 * outcomes are counted in their five buckets plus whatever the source could not place; commitments are
 * counted by kind; and the monthly equivalent is stated per commitment as the source qualified it.
 * None of them is a component of the received figure, and no member of this data is a sum of another.
 */
export interface SupportOverviewData {
  readonly report: ReportResult;
  readonly monthlyEquivalent: readonly MonthlyEquivalentFigure[];
  readonly buckets: readonly RecurringBucketFigure[];
  readonly commitmentKinds: readonly CommitmentKindFigure[];
}

/**
 * The gifts ledger: one whole-query report over the caller's bounded filter set.
 *
 * `report.rows` is the page window this read asked the engine for and `report.total` is always the
 * whole-result count, so a surface states "showing 50 of 312" from one result rather than by adding
 * one page to a guess. `report.summary` holds the per-currency received amounts and the three counts
 * at their own grains. `grain` states the grain every row and count is at, which is the fact that
 * makes a split gift countable once.
 */
export interface GiftLedgerData {
  readonly report: ReportResult;
  readonly grain: typeof GIFT_ROW_GRAIN;
}

/** The commitments surface: every commitment the source states, plus the bucket and kind partitions. */
export interface CommitmentsData {
  readonly commitments: readonly CommitmentFigure[];
  /** The whole-result count, never the length of the page. */
  readonly total: number;
  readonly page: { readonly index: number; readonly size: number; readonly totalPages: number };
  readonly buckets: readonly RecurringBucketFigure[];
  readonly commitmentKinds: readonly CommitmentKindFigure[];
}

/** The goal record as it is exposed: five facts, and nothing derived from them. */
export interface SupportGoalFigure {
  readonly amount: Money;
  readonly measure: SupportGoalRecord["measure"];
  readonly effectiveFrom: string;
  readonly revision: string;
}

/**
 * The goal read: the target, its progress, and the four states that must stay distinguishable.
 *
 * `goal` is `null` when the subject has set no goal, which is a different fact from a goal of zero.
 * `progress` is `modules/support/goal`'s own answer and is the only place a percentage exists: its
 * state separates "no goal", "no percentage can be formed", a genuine `0%` and a valid `120%`, and a
 * percentage is present only for the last two. `percentage` renders those basis points for display
 * through the goal module's own formatter, so `12000` basis points reads `120%` and is never clamped.
 * `report` is the one computation the numerator comes from: its per-currency summary states the
 * received support the percentage is measured against.
 */
export interface GoalData {
  readonly goal: SupportGoalFigure | null;
  readonly progress: GoalProgress;
  readonly percentage: string | null;
  readonly report: ReportResult;
  readonly period: SupportPeriod;
  readonly measure: typeof GOAL_MEASURE;
  readonly canEditGoal: boolean;
}

/**
 * One whole-query export: the file, its name, and the snapshot identity every surface of that query
 * states.
 *
 * `csv` holds every authorised row of the query — not the loaded page — and carries the grain, basis,
 * currency, period, coverage and snapshot time in its own metadata records, so a download cannot be
 * mistaken for a different query. `metadata` is that same header set as facts, so a surface states
 * them from one spelling instead of parsing its own file back. `print` is the same result rendered for
 * the browser's print layout, which is why the printed page and the download agree.
 */
export interface SupportExportData {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly metadata: readonly SnapshotFact[];
  readonly print: PrintModel;
  readonly snapshot: Snapshot;
}



// ---------------------------------------------------------------------------------------------
// The session documents these reads parse
// ---------------------------------------------------------------------------------------------

/**
 * The members of a session's state document these reads consume.
 *
 * Three families are required, and they are required rather than defaulted for one reason: a document
 * that does not carry them cannot honestly be read as "this subject holds no gifts and no
 * commitments". An absent collection would answer as an empty result, which is the single reading a
 * financial read must never invent, so a missing family makes the source unreadable instead.
 */
const supportStateDocumentSchema = z.object({
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});


/**
 * The generated workload's gift collection and the statement it makes about itself.
 *
 * `bun run seed:workload` writes a session's 100,000-row dataset as its own document beside the
 * readable seed, so a session that has been measured over the published workload holds gifts in two
 * places. The Support surfaces state one received figure and the export holds every authorised row, so
 * a present workload is read here too rather than left out of the period's total.
 *
 * The header is optional because a document without it is still readable as gift rows; when it is
 * present its coverage and currency list are used, so this read never invents a basis, a coverage or an
 * exponent the dataset itself states.
 */
const workloadDocumentSchema = z.object({
  header: z
    .object({
      coverage: coverageSchema,
      currencies: z.array(z.string().min(1)),
    })
    .optional(),
  gifts: z.array(giftRowRecordSchema),
});

/** The generated workload's member this file consumes. */
type WorkloadDocument = z.infer<typeof workloadDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Resolving the caller, the scope and the projection
// ---------------------------------------------------------------------------------------------

/** What every read here works from: the resolved session, its scope, its revision and its projection. */
interface SupportReadContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  /** The revision of the stored support projection, which any change to it must present. */
  readonly revision: string;
  /** The scenario instant this read was evaluated at, as ISO-8601 with its offset. */
  readonly asOf: string;
  /** The read-only projection the one report computation consumes. */
  readonly projection: SupportProjection;
}

/** The answer to "may this read start": the context, or the one refusal it returns. */
type SupportContextOutcome =
  | { readonly ok: true; readonly context: SupportReadContext }
  | { readonly ok: false; readonly refusal: DeniedOutcome | UnavailableOutcome };

/** The store's own identity for a session's documents, used as a read's source and for diagnostics. */
function storeSource(session: ResolvedSession): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference: session.sessionId };
}

/**
 * The one refusal a caller with no authority receives.
 *
 * Every denial in this file is built here, so its shape cannot vary between the reasons a caller must
 * not be able to tell apart. The reason code states the caller's relationship to the request and never
 * a fact about a record: no count, no title, no size and no existence flag.
 */
function refused(reasonCode: DenialReason): DeniedOutcome {
  return denied({ operationId: READ_ATTEMPT_ID, reasonCode });
}

/**
 * The one answer a source that cannot be read produces, with its source identity and retry guidance.
 *
 * An unreadable document, an absent projection and a figure the report engine refused to compute are
 * all answers of this shape, and none of them is ever an empty list or a zero. The single diagnostic
 * line carries the job and the opaque source and nothing else, so nothing the read could not establish
 * reaches a log.
 */
function sourceUnavailable(
  job: string,
  source: SourceReference,
  guidance: string = STORE_UNAVAILABLE_GUIDANCE,
): UnavailableOutcome {
  logger.sourceUnavailable({ job, source });
  return unavailable({ operationId: READ_ATTEMPT_ID, source, guidance });
}

/** Re-expresses a refusal as the failing half of a read result, with no envelope beside it. */
function refusalOf<T>(refusal: DeniedOutcome | UnavailableOutcome): ReadResult<T> {
  return refusal.outcome === "denied"
    ? { kind: "denied", denied: refusal }
    : { kind: "unavailable", unavailable: refusal };
}

/**
 * The scenario instant this session's reads are evaluated at.
 *
 * Derived from the session's own persisted offset, because two browser contexts may sit in different
 * scenarios at once and the process clock carries whichever session last moved it. This is still the
 * one clock — the fixed seed instant plus an offset the development runtime persists — and no host
 * clock is read anywhere in this module.
 */
function sessionInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}

/** Reads one stored civil date, answering `undefined` when the value is not the storage form of a day. */
function civilDateOf(value: string): CivilDate | undefined {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}

/**
 * Reads one stated civil date, refusing rather than dropping a value it cannot read.
 *
 * A stored date that cannot be read means the record is not what the schema said it was. Substituting
 * "no date" would silently change what the record states, so this throws and the read answers
 * `unavailable` instead of reporting a different fact.
 */
function statedDate(value: string, field: string): CivilDate {
  const parsed = civilDateOf(value);
  if (parsed === undefined) {
    throw new TypeError(
      `A stored ${field} value is not a civil date, so the record it belongs to cannot be read.`,
    );
  }
  return parsed;
}

/** Reads an optional stored civil date: `undefined` only when the record states none. */
function statedDateOrNull(value: string | null, field: string): CivilDate | undefined {
  return value === null ? undefined : statedDate(value, field);
}

/**
 * Projects one stored gift row into the grain the report engine consumes.
 *
 * The stored form holds its dates as strings and its absent members as `null`; the projection holds
 * `Temporal` days and absent members as absent keys, which is how a row states "the source recorded no
 * allocation here" and "the source never established this gift's day" without a placeholder. The
 * amount, the attribution and the provenance are carried exactly as stored: this function reads a
 * record into a shape and never computes, converts or repairs one.
 */
function toReportGiftRow(record: GiftRowRecord): GiftRow {
  const originalGiftOn = statedDateOrNull(record.originalGiftOn, "gift date");
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
    entryOn: statedDate(record.entryOn, "gift entry date"),
  };
}

/**
 * Projects one stored commitment row into the projection's own row shape.
 *
 * A commitment the source states once is one row here, and its occurrences are never rows. A stored
 * day that cannot be read makes the whole projection unreadable rather than arriving as "no date",
 * because a commitment whose last successful day is unknown cannot be presented as one that had none.
 */
function toCommitmentRow(record: CommitmentRowRecord): CommitmentRow {
  const lastSuccessfulOn = statedDateOrNull(record.lastSuccessfulOn, "commitment date");
  const nextEligibleOn = statedDateOrNull(record.nextEligibleOn, "commitment date");
  const resumeOn = statedDateOrNull(record.pause.resumeOn, "commitment pause date");
  const fixedTotal: FixedTotalProgress | undefined =
    record.fixedTotal === null
      ? undefined
      : {
          promised: record.fixedTotal.promised,
          fulfilled: record.fixedTotal.fulfilled,
          released: record.fixedTotal.released,
          remaining: record.fixedTotal.remaining,
        };
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
    ...(fixedTotal === undefined ? {} : { fixedTotal }),
  };
}

/**
 * The coverage of a read whose rows come from two sources, stated conservatively.
 *
 * Coverage says how much of the past the data reaches and how complete it is, so a merged answer may
 * claim only what both sources support: a boundary either source leaves unstated is unstated here, the
 * window closes on the earlier of the two ends because beyond it one source has not vouched for its
 * rows, and the state is `complete` only when both say so. A caller that read a merged result as
 * complete would be told its subtotals cover a period one of the two sources never confirmed.
 */
function mergedCoverage(base: Coverage, workload: Coverage): Coverage {
  if (base.state === "unknown" || workload.state === "unknown") {
    return { from: null, to: null, state: "unknown" };
  }
  return {
    from: earlierBoundary(base.from, workload.from),
    to: earlierBoundary(base.to, workload.to),
    state: base.state === "complete" && workload.state === "complete" ? "complete" : "partial",
  };
}

/** The earlier of two stated boundaries, or the stated one when only one is stated. */
function earlierBoundary(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left <= right ? left : right;
}

/**
 * The minor-unit exponents of the currencies a workload states, for the codes the money table holds.
 *
 * A currency the table does not hold is deliberately left out: an amount in it has no precision in this
 * application, so it stays an unknown-currency fact instead of acquiring a default.
 */
function knownExponentsOf(codes: readonly string[]): Record<string, number> {
  const exponents: Record<string, number> = {};
  for (const code of codes) {
    const exponent = exponentOf(code);
    if (exponent !== undefined) {
      exponents[code] = exponent;
    }
  }
  return exponents;
}

/**
 * Builds the read-only projection the one report computation consumes, from the session's records.
 *
 * `asOf` is the instant this read was evaluated at, not the instant the source last answered: the
 * projection states both, and they are different facts. The goal travels only when the source states
 * one, so "no goal" stays distinguishable from a goal of zero; the commitments travel beside the gifts
 * because the projection states them, and they never reach a received figure.
 */
function projectionOf(input: {
  readonly record: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly workloadGifts: readonly GiftRowRecord[];
  readonly workload: WorkloadDocument | undefined;
  readonly commitments: readonly CommitmentRowRecord[];
  readonly asOf: string;
}): SupportProjection {
  const record = input.record;
  const header = input.workload?.header;
  const currencyExponents =
    header === undefined
      ? record.currencyExponents
      : { ...record.currencyExponents, ...knownExponentsOf(header.currencies) };
  const coverage =
    header === undefined ? record.coverage : mergedCoverage(record.coverage, header.coverage);

  return {
    supportSubjectId: record.supportSubjectId,
    basis: record.basis,
    currencyExponents,
    coverage,
    asOf: input.asOf,
    lastSourceUpdate: record.lastSourceUpdate,
    source: record.source,
    ...(record.goal === null ? {} : { goal: record.goal }),
    gifts: [...input.gifts, ...input.workloadGifts].map(toReportGiftRow),
    commitments: input.commitments.map(toCommitmentRow),
  };
}

/**
 * Resolves the session, asserts its selected scope and builds the financial projection.
 *
 * The order is the contract, and each step is where it is because of what the step before it makes
 * safe: the session first, because no request names a scope of its own; then the selected scope,
 * because a session that has chosen no context has no authority to read one; then the store's
 * documents; then the projection. A session resolves `ok` even when it grants nothing — `expired`,
 * `denied`, `unavailable` and `no-access` are states of a real session — so the refusal always comes
 * from `assertScope`, which names the caller's relationship and nothing about a record.
 *
 * Three outcomes are `unavailable` rather than empty: a document that cannot be decoded, a document
 * stating no projection for this subject (or one belonging to another subject), and a stored date the
 * calendar refuses. Each is a source that did not answer, which is never the same fact as a subject
 * with no giving.
 *
 * `source` names a session explicitly for the callers that hold an id and no request — the domain and
 * integration tests that prove isolation by naming a seeded session, and the operational scripts. It
 * names an identity and never a scope: the scope is still derived here from the session's own
 * documents.
 */
async function readContext(
  job: string,
  source?: SessionSource,
  permit?: (session: ResolvedSession, scope: Scope) => AccessDecision,
): Promise<SupportContextOutcome> {
  let resolution: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolution = await resolveSession(source);
  } catch {
    return { ok: false, refusal: refused("session-unavailable") };
  }
  if (!resolution.ok) {
    return { ok: false, refusal: resolution.denial };
  }
  const { session } = resolution;

  const scope = session.selected;
  if (scope === null) {
    return { ok: false, refusal: refused("not-admitted") };
  }
  const scopeDecision = assertScope(session, scope);
  if (!scopeDecision.ok) {
    return { ok: false, refusal: scopeDecision.denial };
  }

  // A read with a permission of its own — the whole-query export — asks it here, before any document
  // is opened: a caller that may not export learns nothing at all about what the query would hold.
  if (permit !== undefined) {
    const permitted = permit(session, scope);
    if (!permitted.allowed) {
      return { ok: false, refusal: permitted.denial };
    }
  }

  let state: unknown;
  let workloadValue: unknown;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return { ok: false, refusal: sourceUnavailable(job, storeSource(session)) };
    }
    state = documents.state;
    workloadValue = documents.workload;
  } catch {
    return { ok: false, refusal: sourceUnavailable(job, storeSource(session)) };
  }

  const parsed = supportStateDocumentSchema.safeParse(state);
  if (!parsed.success) {
    return { ok: false, refusal: sourceUnavailable(job, storeSource(session)) };
  }

  const workload = workloadDocumentSchema.safeParse(workloadValue);
  if (workloadValue !== undefined && !workload.success) {
    return { ok: false, refusal: sourceUnavailable(job, storeSource(session)) };
  }
  const workloadDocument = workload.success ? workload.data : undefined;

  const record = parsed.data.supportProjection;
  if (record === null || record.supportSubjectId !== scope.supportSubjectId) {
    return {
      ok: false,
      refusal: sourceUnavailable(job, storeSource(session), NO_SUPPORT_PROJECTION_GUIDANCE),
    };
  }

  const asOf = sessionInstant(session).toString();
  let projection: SupportProjection;
  try {
    projection = projectionOf({
      record,
      gifts: parsed.data.gifts,
      workloadGifts: workloadDocument?.gifts ?? [],
      workload: workloadDocument,
      commitments: parsed.data.commitments,
      asOf,
    });
  } catch {
    return { ok: false, refusal: sourceUnavailable(job, record.source, SUPPORT_SOURCE_GUIDANCE) };
  }

  // A session the development panel has switched into the "financial source unavailable" world answers
  // as an outage with the source's identity, rather than reporting figures from a source it says it
  // cannot read. The condition is stated here, once, for every financial read of this session.
  if (session.scenarioId === FINANCIAL_SOURCE_UNAVAILABLE_SCENARIO) {
    return {
      ok: false,
      refusal: sourceUnavailable(job, projection.source, SUPPORT_SOURCE_GUIDANCE),
    };
  }

  return {
    ok: true,
    context: { session, scope, revision: record.revision, asOf, projection },
  };
}

// ---------------------------------------------------------------------------------------------
// The single query builder
// ---------------------------------------------------------------------------------------------

/** What a read states about the query it is building, so every read states the same facts. */
interface SupportQueryDefaults {
  /** The report identity the read computes from; one of the four the report module declares. */
  readonly reportId: ReportId;
  /** The period this read resolves when the caller states none. */
  readonly period: ReportPeriod;
  /** Whether the read asks the engine for a page window; the export and the print view never do. */
  readonly paged: boolean;
}

/** One built query, with every filter this read refused to apply and the reason the gate gave. */
interface BuiltSupportQuery {
  readonly query: ReportQuery;
  readonly refused: readonly ReportQueryProblem[];
}

/** The currency selection that reads every currency present as a partition, never as one total. */
const EVERY_CURRENCY: CurrencySelection = Object.freeze({ kind: "all" });

/**
 * The exact authority a report is computed under, taken from the scope this read derived.
 *
 * Four separately owned references, stated as the report module's own plain strings: an organisation
 * is not the ministry it admits, a ministry is not the finance subject a projection belongs to, and
 * none of them is the principal who asked.
 */
function reportScopeOf(scope: Scope): ReportScope {
  return {
    organizationId: scope.organizationId,
    ministryId: scope.ministryId,
    supportSubjectId: scope.supportSubjectId,
    principalId: scope.principalId,
  };
}

/** Whether a stated value names one of the five periods this application offers. */
function isPreset(value: string): value is PeriodPreset {
  return PERIOD_PRESETS.some((preset) => preset === value);
}

/** Whether a stated value names a sortable column. */
function isSortField(value: string): value is SortField {
  return SORT_FIELDS.some((field) => field === value);
}

/** Whether a stated value names a sort direction. */
function isSortDirection(value: string): value is SortDirection {
  return SORT_DIRECTIONS.some((direction) => direction === value);
}

/** A stated optional string with its surrounding space removed, or `undefined` when nothing is left. */
function optionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The period a request states, or the read's own default when it states none it can be read as.
 *
 * A refused period is recorded as a refusal and answered with the read's default rather than silently
 * becoming a different period: the result's own snapshot states the two civil dates it covers, so the
 * surface names the period that was actually computed, and the refusal says the stated one was not.
 */
function periodOf(
  input: SupportPeriodInput | undefined,
  fallback: ReportPeriod,
  refused: ReportQueryProblem[],
): ReportPeriod {
  if (input === undefined) {
    return fallback;
  }
  switch (input.kind) {
    case "preset":
      if (isPreset(input.preset)) {
        return { kind: "preset", preset: input.preset };
      }
      refused.push({
        field: "period.preset",
        message:
          "A preset period is one of the five this application offers, and this name is not one of them. Name a period or state two calendar days; no other period is substituted for this one.",
      });
      return fallback;

    case "explicit": {
      const from = civilDateOf(input.from.trim());
      const to = civilDateOf(input.to.trim());
      if (from === undefined || to === undefined) {
        refused.push({
          field: "period",
          message:
            "A period is two calendar days, each written as a day with no time of day. This request states a value that is not one, so the period is refused rather than guessed at.",
        });
        return fallback;
      }
      if (Temporal.PlainDate.compare(from, to) > 0) {
        refused.push({
          field: "period",
          message:
            "The period starts after it ends, so it covers no day at all. State the earlier day first; the range is inclusive at both ends.",
        });
        return fallback;
      }
      return { kind: "explicit", from, to };
    }

    case "year":
      if (!Number.isSafeInteger(input.year) || input.year < 1 || input.year > 9999) {
        refused.push({
          field: "period.year",
          message:
            "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it.",
        });
        return fallback;
      }
      return { kind: "year", year: input.year };

    default:
      refused.push({
        field: "period.kind",
        message:
          "A period is a preset, two calendar days or a calendar year. This one is none of those, so no period is assumed for it.",
      });
      return fallback;
  }
}

/** The currency selection a request states: one named code, or every currency present. */
function currencyOf(code: string | undefined): CurrencySelection {
  const trimmed = optionalText(code);
  return trimmed === undefined ? EVERY_CURRENCY : { kind: "one", currency: trimmed };
}

/**
 * The amount range a request states, in the selected currency's minor units.
 *
 * A bound that is not a whole count of minor units is refused rather than rounded, because rounding
 * would change which rows match. The range beside every currency is left to the report gate, which
 * refuses it for the reason this file then reports: the rule belongs where the partition is decided.
 */
function amountRangeOf(
  range: SupportQuery["amountRange"],
  refused: ReportQueryProblem[],
): ReportQuery["amountRange"] | undefined {
  if (range === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(range.minMinor) || !Number.isSafeInteger(range.maxMinor)) {
    refused.push({
      field: "amountRange",
      message:
        "An amount range states whole counts of the selected currency's minor units. A fractional or non-finite bound is refused rather than rounded, because rounding would change which rows match.",
    });
    return undefined;
  }
  return { minMinor: minorUnitsOf(range.minMinor), maxMinor: minorUnitsOf(range.maxMinor) };
}

/** The attribution a request states, or a refusal when it names no partner it can be read as. */
function partnerOf(
  input: SupportPartnerInput | undefined,
  refused: ReportQueryProblem[],
): ReportPartnerSelection | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input.kind === "partner") {
    const partnerId = input.partnerId.trim();
    if (partnerId === "") {
      refused.push({
        field: "partner.partnerId",
        message:
          "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place.",
      });
      return undefined;
    }
    return { kind: "partner", partnerId };
  }
  return { kind: input.kind };
}

/**
 * The sort a request states, or a refusal when it names an ordering nothing declares.
 *
 * Only the three fields the report module declares are sortable, and only ascending or descending:
 * an arbitrary field would be an ordering no surface could describe. A field stated without a
 * direction reads ascending, which is the order a column header applies on its first click.
 */
function sortOf(
  input: SupportQuery["sort"],
  refused: ReportQueryProblem[],
): ReportQuery["sort"] | undefined {
  if (input === undefined) {
    return undefined;
  }
  const field = optionalText(input.field);
  if (field === undefined) {
    return undefined;
  }
  if (!isSortField(field)) {
    refused.push({
      field: "sort.field",
      message:
        "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it.",
    });
    return undefined;
  }
  const direction = optionalText(input.direction) ?? "asc";
  if (!isSortDirection(direction)) {
    refused.push({
      field: "sort.direction",
      message: "A sort runs ascending or descending. This direction is neither, so no order is assumed.",
    });
    return undefined;
  }
  return { field, direction };
}

/**
 * The page window a list asks for: the stated page, the first page when none is stated, and never a
 * window the caller cannot have.
 *
 * The size is not clamped here: the report engine clamps it, so the floor and the cap have one
 * implementation. An index that is not a whole page is refused and answered with the first page rather
 * than with the whole result, because a list that silently returned everything would look like a page
 * of everything.
 */
function pageOf(
  input: SupportQuery["page"],
  refused: ReportQueryProblem[],
): ReportQuery["page"] {
  if (input === undefined) {
    return { index: 0 };
  }
  const index = input.index ?? 0;
  if (!Number.isSafeInteger(index) || index < 0) {
    refused.push({
      field: "page.index",
      message:
        "A page index is a whole number of pages from zero. This value is not one, so the first page is read rather than a page nobody asked for.",
    });
    return { index: 0 };
  }
  return input.size === undefined ? { index } : { index, size: input.size };
}

/** The root of a refused field's path, so one refusal drops the whole filter it belongs to. */
function rootFieldOf(field: string): string {
  const separator = field.indexOf(".");
  return separator === -1 ? field : field.slice(0, separator);
}

/**
 * The candidate query with the filters the gate refused removed, and the two filters a read cannot do
 * without reset to that read's own defaults.
 *
 * Dropping is the only honest response to a refused filter: applying it anyway would answer a different
 * question, and ignoring it without saying so would present an unfiltered result as a filtered one.
 * The refusal itself travels in the read's `actions`, so the surface states what was not applied.
 */
function withoutRefusedFilters(
  query: ReportQuery,
  problems: readonly ReportQueryProblem[],
  defaults: SupportQueryDefaults,
): ReportQuery {
  const refused = new Set(problems.map((problem) => rootFieldOf(problem.field)));
  return {
    reportId: query.reportId,
    scope: query.scope,
    period: refused.has("period") ? defaults.period : query.period,
    currency: refused.has("currency") ? EVERY_CURRENCY : query.currency,
    ...(query.amountRange === undefined || refused.has("amountRange")
      ? {}
      : { amountRange: query.amountRange }),
    ...(query.designation === undefined || refused.has("designation")
      ? {}
      : { designation: query.designation }),
    ...(query.partner === undefined || refused.has("partner") ? {} : { partner: query.partner }),
    ...(query.method === undefined || refused.has("method") ? {} : { method: query.method }),
    ...(query.search === undefined || refused.has("search") ? {} : { search: query.search }),
    ...(query.sort === undefined || refused.has("sort") ? {} : { sort: query.sort }),
    ...(query.page === undefined || refused.has("page") ? {} : { page: query.page }),
    ...(query.timeZone === undefined || refused.has("timeZone") ? {} : { timeZone: query.timeZone }),
  };
}

/**
 * Maps a caller's filter state onto the one report query this read computes from.
 *
 * This is the single place a support filter becomes a report query, and every read here goes through
 * it. That is what keeps the chart, the table, the drilldown, the export and the print view of one
 * screen describing the same query: there is one mapping, so there cannot be two answers to one
 * filter.
 *
 * The gate has the last word. The candidate is built from what the caller stated and is then put
 * through `buildReportQuery`, which trims, clamps the page size, normalises a year into its range and
 * refuses anything a report may not be asked for — an amount range beside every currency, a zone that
 * cannot be resolved, a method facet the projection does not carry. Each refusal is recorded with the
 * gate's own message and the refused filter is dropped, one rebuild follows, and a second refusal is a
 * defect in this file rather than a caller's mistake, so it throws instead of answering.
 */
function buildSupportQuery(
  input: SupportQuery,
  scope: Scope,
  defaults: SupportQueryDefaults,
): BuiltSupportQuery {
  const refused: ReportQueryProblem[] = [];
  const designation = optionalText(input.designation);
  const search = optionalText(input.search);
  const method = optionalText(input.method);
  const timeZone = optionalText(input.timeZone);
  const partner = partnerOf(input.partner, refused);
  const sort = sortOf(input.sort, refused);
  const amountRange = amountRangeOf(input.amountRange, refused);

  const candidate: ReportQuery = {
    reportId: defaults.reportId,
    scope: reportScopeOf(scope),
    period: periodOf(input.period, defaults.period, refused),
    currency: currencyOf(input.currency),
    ...(amountRange === undefined ? {} : { amountRange }),
    ...(designation === undefined ? {} : { designation }),
    ...(partner === undefined ? {} : { partner }),
    ...(method === undefined ? {} : { method }),
    ...(search === undefined ? {} : { search }),
    ...(sort === undefined ? {} : { sort }),
    ...(defaults.paged ? { page: pageOf(input.page, refused) } : {}),
    ...(timeZone === undefined ? {} : { timeZone }),
  };

  const built = buildReportQuery(candidate);
  if (built.ok) {
    return { query: built.query, refused };
  }

  refused.push(...built.problems);
  const rebuilt = buildReportQuery(withoutRefusedFilters(candidate, built.problems, defaults));
  if (rebuilt.ok) {
    return { query: rebuilt.query, refused };
  }

  const stated = rebuilt.problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
  throw new TypeError(
    `The support read could not build a query the report engine accepts from its own defaults. ${stated}`,
  );
}

// ---------------------------------------------------------------------------------------------
// The one computation, and the states it states
// ---------------------------------------------------------------------------------------------

/**
 * Runs the one financial computation and states every row's amount honestly.
 *
 * `runReport` is the whole of the arithmetic: this function adds nothing to it and takes nothing from
 * it. The single correction it makes is a value-state one. An amount whose currency the source never
 * identified has no exponent in this application, so it is not a `value` a reader may format: it is
 * `unknown`, and it stays that way in the screen, the chart's table, the CSV and the print model
 * because they all read this same value-state map. Without the correction a bare `7500` would print
 * as if it were seven thousand five hundred of something.
 *
 * A report the engine refuses to compute — an unreadable stored goal, a basis this application does
 * not measure — is a source that could not answer, so it becomes `unavailable` with the projection's
 * own source identity rather than an exception reaching a component.
 */
function reportOf(
  job: string,
  query: ReportQuery,
  context: SupportReadContext,
): Result<ReportResult, UnavailableOutcome> {
  try {
    return ok(withStatedRowAmounts(runReport(query, context.projection)));
  } catch {
    return err(sourceUnavailable(job, context.projection.source, SUPPORT_SOURCE_GUIDANCE));
  }
}

/** The report's own value-state map, with every unidentifiable currency's row amount marked unknown. */
function withStatedRowAmounts(result: ReportResult): ReportResult {
  const states: Record<string, ValueState> = { ...result.valueStates };
  result.rows.forEach((row, index) => {
    if (exponentOf(row.amount.currency) === undefined) {
      states[`rows.${index}.amount`] = "unknown";
    }
  });
  return { ...result, valueStates: states };
}

/**
 * Maps a report's value state onto a recorded one.
 *
 * `incomplete-subtotal` is the state the envelope derives, so a figure the report marked incomplete for
 * partial coverage is recorded as the known value it is: this read declares that coverage, and
 * `buildEnvelope` derives the incompleteness again rather than trusting a caller to state it.
 */
function recordedStateOf(state: ValueState): RecordedValueState {
  switch (state) {
    case "value":
    case "zero":
    case "unknown":
    case "withheld":
    case "unavailable":
      return state;
    case "incomplete-subtotal":
      return "value";
  }
}

/** Records every value-bearing path one report result states, ready for the envelope's derivation. */
function recordedStatesOf(result: ReportResult): Record<string, RecordedValueState> {
  const recorded: Record<string, RecordedValueState> = {};
  for (const [path, state] of Object.entries(result.valueStates)) {
    recorded[path] = recordedStateOf(state);
  }
  return recorded;
}

/** Records one count's state: a count of zero is a genuine zero, not a missing value. */
function countState(count: number): RecordedValueState {
  return count > 0 ? "value" : "zero";
}

/**
 * The state of one amount the report did not state: a known currency's amount is a value or a genuine
 * zero, and a currency this application holds no exponent for is unknown rather than a number.
 */
function statedAmountStateOf(money: Money): ValueState {
  if (exponentOf(money.currency) === undefined) {
    return "unknown";
  }
  return money.minorUnits === 0 ? "zero" : "value";
}

/** One amount in the family's figure shape, carrying exact minor units only when a state may state them. */
function amountFigureOf(money: Money, state: ValueState): SupportAmount {
  const carriesAmount = state === "value" || state === "zero" || state === "incomplete-subtotal";
  return {
    currency: money.currency,
    exponent: exponentOf(money.currency) ?? null,
    minorUnits: carriesAmount ? money.minorUnits : null,
    valueState: state,
  };
}

/**
 * The goal's progress, as the one report computation answered it.
 *
 * A projection carrying no goal produces no `goal` on the result, and the goal module's own answer for
 * that case is the `no-goal` state — which is a different rendering from a goal of zero, from a
 * percentage that cannot be formed, and from a genuine `0%`. Nothing here computes a percentage.
 */
function progressOf(result: ReportResult): GoalProgress {
  return result.goal ?? goalProgress({});
}

/** The five recurring buckets plus `outside-partition`, each with its own count. */
function bucketFiguresOf(rows: readonly CommitmentRow[]): readonly RecurringBucketFigure[] {
  const order: readonly RecurringBucket[] = [...PARTITION_BUCKETS, OUTSIDE_PARTITION];
  const counts = new Map<RecurringBucket, number>();
  for (const bucket of order) {
    counts.set(bucket, 0);
  }
  for (const row of rows) {
    counts.set(row.bucketState, (counts.get(row.bucketState) ?? 0) + 1);
  }
  return order.map((bucket) => {
    const count = counts.get(bucket) ?? 0;
    return {
      bucket,
      label: BUCKET_LABELS[bucket],
      inPartition: isInPartition(bucket),
      count,
      valueState: countState(count),
    };
  });
}

/** The three commitment kinds, each with its own count and never added to another count. */
function kindFiguresOf(rows: readonly CommitmentRow[]): readonly CommitmentKindFigure[] {
  return COMMITMENT_KINDS.map((kind) => {
    const count = rows.filter((row) => row.kind === kind).length;
    return { kind, count, valueState: countState(count) };
  });
}

/** Every commitment's source-qualified monthly equivalent, in the order the source states them. */
function monthlyEquivalentsOf(rows: readonly CommitmentRow[]): readonly MonthlyEquivalentFigure[] {
  const figures: MonthlyEquivalentFigure[] = [];
  for (const row of rows) {
    const money = row.monthlyEquivalentFromSource;
    if (money === undefined) {
      continue;
    }
    figures.push({
      commitmentRowId: row.commitmentRowId,
      cadence: row.cadence,
      amount: amountFigureOf(money, statedAmountStateOf(money)),
    });
  }
  return figures;
}

/** The coverage of a financial read: the projection's own coverage, its currency and its date basis. */
function financialCoverageOf(projection: SupportProjection, query: ReportQuery): FinancialCoverage {
  return {
    ...projection.coverage,
    currency: query.currency.kind === "one" ? query.currency.currency : CSV_ALL_CURRENCIES,
    dateBasis: DATE_BASIS,
  };
}

/**
 * Builds the envelope a read returns, filling the five facts every read here shares.
 *
 * The scope is the one this read derived, the source is the support projection's own, the revision is
 * the stored projection's, and the as-of instant is the scenario instant the read was evaluated at. The
 * coverage and the value states are the caller's, because only the read knows what it stated and which
 * paths carry a value.
 */
function envelopeOf<T, C extends Coverage>(input: {
  readonly data: T;
  readonly context: SupportReadContext;
  readonly coverage: C;
  readonly revision: string;
  readonly valueStates: Readonly<Record<string, RecordedValueState>>;
  readonly actions: readonly ReadAction[];
}): ReadEnvelope<T, C> {
  return buildEnvelope({
    data: input.data,
    scope: input.context.scope,
    source: input.context.projection.source,
    revision: input.revision,
    asOf: input.context.asOf,
    coverage: input.coverage,
    valueStates: input.valueStates,
    actions: input.actions,
  });
}

// ---------------------------------------------------------------------------------------------
// What the reads say about the filters they could not apply
// ---------------------------------------------------------------------------------------------

/** The action name a refused field is reported under. */
function filterActionName(field: string): string {
  const name = FILTER_ACTION_BY_FIELD[field];
  return name === undefined ? UNNAMED_FILTER_ACTION : name;
}

/** One action per refused filter, stating the gate's own reason and never a count or a record. */
function refusalActions(refused: readonly ReportQueryProblem[]): readonly ReadAction[] {
  return refused.map((problem) => ({
    name: filterActionName(problem.field),
    available: false,
    reason: problem.message,
  }));
}

/** The action that states whether this caller may take the whole query out of the application. */
function exportAction(decision: AccessDecision): ReadAction {
  return decision.allowed
    ? { name: "exportQuery", available: true }
    : { name: "exportQuery", available: false, reason: EXPORT_UNAVAILABLE_REASON };
}

/**
 * The ledger's filter actions: the bounded facet set, each stating whether it may be applied.
 *
 * The amount range is available only beside a single currency, the method facet is never available
 * because the projection carries no such field, and every facet the gate refused is reported with the
 * gate's own reason. A surface therefore disables the control it cannot use, and never presents an
 * unfiltered result as a filtered one.
 */
function ledgerActions(
  query: ReportQuery,
  refused: readonly ReportQueryProblem[],
  decision: AccessDecision,
): readonly ReadAction[] {
  const byName = new Map<string, ReadAction>();
  const order = [
    "filterByPeriod",
    "filterByCurrency",
    "filterByAmountRange",
    "filterByPartner",
    "filterByDesignation",
    "filterByMethod",
    "search",
    "sortRows",
    "pageRows",
  ];
  for (const name of order) {
    byName.set(name, { name, available: true });
  }
  byName.set("filterByAmountRange", {
    name: "filterByAmountRange",
    available: query.currency.kind === "one",
    ...(query.currency.kind === "one" ? {} : { reason: AMOUNT_RANGE_PARTITION_REASON }),
  });
  byName.set("filterByMethod", {
    name: "filterByMethod",
    available: false,
    reason: METHOD_FILTER_REASON,
  });
  for (const action of refusalActions(refused)) {
    byName.set(action.name, action);
  }
  byName.set("exportQuery", exportAction(decision));
  return [...byName.values()];
}


// ---------------------------------------------------------------------------------------------
// The figures the commitment and export reads state
// ---------------------------------------------------------------------------------------------

/** The four amounts a fixed-total commitment is measured by, listed once so none can be forgotten. */
const FIXED_TOTAL_FIELDS = ["promised", "fulfilled", "released", "remaining"] as const;

/** Why a commitment list offers no period filter, stated where the action is. */
const COMMITMENT_PERIOD_REASON =
  "A commitment is the source's current standing rather than an occurrence inside a period, so no period filter applies to it. The dates it last collected and is next eligible on are stated on the commitment itself.";

/** Why a commitment list offers no currency filter, stated where the action is. */
const COMMITMENT_CURRENCY_REASON =
  "Each commitment states its own currency and its own cadence, so a currency filter would hide commitments rather than restate them. The list is read whole and never summed across currencies.";

/**
 * Orders two commitments the way the list reads: the three kinds in the product's order, then the
 * commitment's own opaque reference.
 *
 * The identifier is the one tiebreak, so two readings of the same records state the same page — a list
 * whose order drifted between requests would make a page window meaningless.
 */
function compareCommitments(left: CommitmentRow, right: CommitmentRow): number {
  const leftKind = COMMITMENT_KINDS.indexOf(left.kind);
  const rightKind = COMMITMENT_KINDS.indexOf(right.kind);
  if (leftKind !== rightKind) {
    return leftKind - rightKind;
  }
  if (left.commitmentRowId === right.commitmentRowId) {
    return 0;
  }
  return left.commitmentRowId < right.commitmentRowId ? -1 : 1;
}

/**
 * States one commitment in the shape the surface reads.
 *
 * Every amount is carried exactly as the source stated it, and every date is written in the storage
 * form of a civil day rather than as an instant: a commitment collects on a day, and a display-zone
 * change must not move it. The bucket's label comes from the buckets module's one spelling, so no
 * component holds a second copy of it.
 */
function commitmentFigureOf(row: CommitmentRow): CommitmentFigure {
  const monthly = row.monthlyEquivalentFromSource;
  return {
    commitmentRowId: row.commitmentRowId,
    kind: row.kind,
    cadence: row.cadence,
    perOccurrence: row.perOccurrence,
    perOccurrenceState: statedAmountStateOf(row.perOccurrence),
    bucket: row.bucketState,
    bucketLabel: BUCKET_LABELS[row.bucketState],
    inPartition: isInPartition(row.bucketState),
    lastSuccessfulOn:
      row.lastSuccessfulOn === undefined ? null : serialiseCivilDate(row.lastSuccessfulOn),
    nextEligibleOn: row.nextEligibleOn === undefined ? null : serialiseCivilDate(row.nextEligibleOn),
    pause: {
      state: row.pause.state,
      resumeOn: row.pause.resumeOn === undefined ? null : serialiseCivilDate(row.pause.resumeOn),
    },
    fixedTotal:
      row.fixedTotal === undefined
        ? null
        : {
            promised: row.fixedTotal.promised,
            fulfilled: row.fixedTotal.fulfilled,
            released: row.fixedTotal.released,
            remaining: row.fixedTotal.remaining,
          },
    monthlyEquivalent:
      monthly === undefined ? null : amountFigureOf(monthly, statedAmountStateOf(monthly)),
  };
}

/**
 * Records the state of a progress figure's percentage.
 *
 * A percentage that was computed is a value, and one that is genuinely zero is a genuine zero. Every
 * other state — no goal, no percentage, incompatible, paused, ended, unavailable — carries no
 * percentage, which the recorded state says; the precise reason travels in the progress figure itself,
 * because a percentage is not a number of which "unknown" is the whole story.
 */
function progressStateOf(progress: GoalProgress): RecordedValueState {
  switch (progress.state) {
    case "value":
      return "value";
    case "zero":
      return "zero";
    default:
      return "unknown";
  }
}

/**
 * Refuses a report identity this application does not compute.
 *
 * The four identities are a closed set, and a value outside it is a defect at the boundary rather than
 * a user choice: substituting one report for another would answer a question nobody asked. The route
 * that accepts a report segment resolves it against the same catalogue before calling here, and the
 * transport edge turns this thrown fault into an outcome.
 */
function assertReportId(reportId: ReportId): void {
  if (!REPORT_IDS.some((identity) => identity === reportId)) {
    throw new TypeError(
      `"${String(reportId)}" is not one of the four reports this application computes, so no report is substituted for it. Choose one of ${REPORT_IDS.join(", ")}.`,
    );
  }
}

/**
 * The filename an export is offered as: the application's own words and the period's two civil days.
 *
 * It is built only from the closed report identity and two serialised civil dates, so no record's
 * value, no designation, no partner reference and no user-supplied text can reach a filename — the one
 * place a downloaded file could otherwise carry something a surface would never print.
 */
function exportFilenameOf(result: ReportResult): string {
  const { query, period } = result.snapshot;
  return `support-${query.reportId}-${serialiseCivilDate(period.from)}-to-${serialiseCivilDate(period.to)}.csv`;
}

// ---------------------------------------------------------------------------------------------
// "Understand support": the overview, the ledger, the commitments and the goal
// ---------------------------------------------------------------------------------------------

/**
 * States received support for one period, cash first, and the non-cash measures beside it.
 *
 * The order is the product's and it is the order of this data: the period's received support per
 * currency (AAP 0.8.1 measures five different facts and never adds them), then the recurring
 * collection outcomes in their five buckets, then — secondarily — the commitments counted by kind and
 * the monthly equivalent the source itself qualified. A commitment is never presented as cash, a
 * processing occurrence is never received money, and an unmatched received gift never fulfils a
 * promise: each is stated under its own measure and none is derived from another.
 *
 * The figures are `runReport`'s, for the period the caller states and this month when they state none.
 * A period still running is labelled `in-progress` in the result's snapshot, its subtotals carry the
 * derived `incomplete-subtotal` state, and a month the source recorded nothing in is a gap in the
 * series rather than a dip to zero. A goal the subject has set yields the report's own progress figure;
 * a denominator that cannot carry a percentage yields no percentage at all.
 *
 * The recurring buckets are the source's current standing for each commitment, not a window this
 * application invents: a commitment row states the bucket its occurrence is in now, and the dates it
 * last collected and is next eligible on travel with it. Those dates are what a surface shows beside a
 * bucket, and a bucket never implies that this application can retry a payment.
 *
 * @param query the period, currency, filters and zone the overview is stated in; the same bounded
 *   filter set narrows the period's figures, and a filter the report gate refuses is stated in
 *   `actions` with its reason.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readSupportOverview(
  query: SupportQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<SupportOverviewData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_OVERVIEW, source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const built = buildSupportQuery(query, context.scope, {
    reportId: OVERVIEW_REPORT_ID,
    period: DEFAULT_PERIOD,
    paged: false,
  });
  const report = reportOf(JOB_OVERVIEW, built.query, context);
  if (!report.ok) {
    return { kind: "unavailable", unavailable: report.error };
  }
  const result = report.value;

  const data: SupportOverviewData = {
    report: result,
    monthlyEquivalent: monthlyEquivalentsOf(context.projection.commitments),
    buckets: bucketFiguresOf(context.projection.commitments),
    commitmentKinds: kindFiguresOf(context.projection.commitments),
  };

  const valueStates = recordedStatesOf(result);
  for (const figure of data.buckets) {
    valueStates[`buckets.${figure.bucket}.count`] = recordedStateOf(figure.valueState);
  }
  for (const figure of data.commitmentKinds) {
    valueStates[`commitmentKinds.${figure.kind}.count`] = recordedStateOf(figure.valueState);
  }
  for (const figure of data.monthlyEquivalent) {
    valueStates[`monthlyEquivalent.${figure.commitmentRowId}.amount`] = recordedStateOf(
      figure.amount.valueState,
    );
  }

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data,
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: context.revision,
      valueStates,
      actions: refusalActions(built.refused),
    }),
  };
}

/**
 * The gifts ledger: one whole-query report over the caller's bounded filter set.
 *
 * The filter set is the whole of what this read accepts, and the report engine owns every one of its
 * effects: the period, the currency partition, an amount range inside one selected currency, the
 * attribution (a partner, anonymous support or unattributed support), the source's designation, the
 * search term, the sort and the page window. The amount range is available only while exactly one
 * currency is selected, because a range compares minor units and two currencies have no ordering here;
 * beside every currency the gate refuses it and this read states that refusal in `actions` instead of
 * applying it or dropping it silently. The method facet is never available, because the projection
 * carries no giving-method field.
 *
 * Rows are at the allocation grain: a 100-unit gift split 40/60 shows only the allocation this caller
 * is authorised to see, a view that legitimately holds both the parent and an allocation counts the
 * gift once, and the gift, allocation and donor counts in the summary are three counts that are never
 * added together. Anonymous support is a first-class attribution and never a missing partner; a refund
 * names the row it corrects; an amount whose currency the source never identified keeps that state
 * instead of acquiring a code, a conversion or a default.
 *
 * `total` is always the whole-result count and the page is 50 rows unless the caller states a size,
 * which the engine clamps to 200. An unpaged request is the whole result, and that is the export and
 * print path rather than a bigger page.
 *
 * @param query the bounded filter set and the page window this ledger is stated for.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readGifts(
  query: SupportQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<GiftLedgerData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_GIFTS, source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const built = buildSupportQuery(query, context.scope, {
    reportId: LEDGER_REPORT_ID,
    period: DEFAULT_PERIOD,
    paged: true,
  });
  const report = reportOf(JOB_GIFTS, built.query, context);
  if (!report.ok) {
    return { kind: "unavailable", unavailable: report.error };
  }
  const result = report.value;

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data: { report: result, grain: GIFT_ROW_GRAIN },
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: context.revision,
      valueStates: recordedStatesOf(result),
      actions: ledgerActions(
        result.snapshot.query,
        built.refused,
        canExport(context.session, context.scope),
      ),
    }),
  };
}

/**
 * States every commitment the source reports, in its bucket, with the dates the source states for it.
 *
 * A commitment is not received money and its occurrences are not rows: one commitment is one row here,
 * carrying the amount the source reports per occurrence of its own cadence, the bucket its occurrence
 * currently stands in, the day it last collected and the day it is next eligible on. The six buckets
 * are stated as a partition of five plus `outside-partition`, where evidence the source could not
 * place — unknown or stale — is reported as a first-class value rather than a sixth outcome; a
 * `not-received` occurrence says the source holds no receipt, never that the donor owes anything; and
 * a `fixed-total` commitment states its promised, fulfilled, released and remaining amounts exactly,
 * while a recurring one states none, so an absent total is never a zero.
 *
 * A monthly equivalent appears only where the source qualified one. This read never averages gifts,
 * never divides a cadence, and never derives an equivalent of its own: the figure is the source's
 * calculation carried on the row, and a commitment without one states no amount at all.
 *
 * Nothing here is writable. There is no retry, no pause, no correction and no edit on this data,
 * because this application performs no financial action: the only writable financial fact in the
 * application is the goal, and it is `saveGoal`'s.
 *
 * @param query the page window this list is stated for; no filter applies, and `actions` says why.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readCommitments(
  query: SupportPageInput = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<CommitmentsData>>> {
  const outcome = await readContext(JOB_COMMITMENTS, source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const rows = context.projection.commitments;
  const ordered = [...rows].sort(compareCommitments);
  const size = clampPageSize(query.page?.size);
  const totalPages = Math.max(1, Math.ceil(ordered.length / size));
  const statedIndex = query.page?.index ?? 0;
  const index =
    Number.isSafeInteger(statedIndex) && statedIndex >= 0
      ? Math.min(statedIndex, totalPages - 1)
      : 0;
  const window = ordered.slice(index * size, index * size + size);

  const data: CommitmentsData = {
    commitments: window.map(commitmentFigureOf),
    total: ordered.length,
    page: { index, size, totalPages },
    buckets: bucketFiguresOf(rows),
    commitmentKinds: kindFiguresOf(rows),
  };

  const valueStates: Record<string, RecordedValueState> = {};
  for (const figure of data.buckets) {
    valueStates[`buckets.${figure.bucket}.count`] = recordedStateOf(figure.valueState);
  }
  for (const figure of data.commitmentKinds) {
    valueStates[`commitmentKinds.${figure.kind}.count`] = recordedStateOf(figure.valueState);
  }
  for (const figure of data.commitments) {
    valueStates[`commitments.${figure.commitmentRowId}.perOccurrence`] = recordedStateOf(
      figure.perOccurrenceState,
    );
    valueStates[`commitments.${figure.commitmentRowId}.monthlyEquivalent`] =
      figure.monthlyEquivalent === null
        ? "unknown"
        : recordedStateOf(figure.monthlyEquivalent.valueState);
    if (figure.fixedTotal === null) {
      continue;
    }
    for (const field of FIXED_TOTAL_FIELDS) {
      const amount = figure.fixedTotal[field];
      valueStates[`commitments.${figure.commitmentRowId}.fixedTotal.${field}`] = recordedStateOf(
        statedAmountStateOf(amount),
      );
    }
  }
  valueStates["page.index"] = countState(data.page.index);
  valueStates["page.total"] = countState(data.total);

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data,
      context,
      coverage: context.projection.coverage,
      revision: context.revision,
      valueStates,
      actions: [
        { name: "filterByPeriod", available: false, reason: COMMITMENT_PERIOD_REASON },
        { name: "filterByCurrency", available: false, reason: COMMITMENT_CURRENCY_REASON },
        { name: "pageRows", available: true },
      ],
    }),
  };
}

/**
 * States the support goal, its progress and the four facts that must stay distinguishable.
 *
 * The four are not one fact: a subject with no goal, a goal that yields no percentage, a genuine `0%`
 * and a valid `120%` are four different renderings, and the goal module's progress state is what
 * separates them. A percentage needs a numerator and a positive denominator of the same measure in the
 * same currency, so a missing, zero, unknown or incompatible one produces no percentage at all — not
 * `0`, not `NaN` and not a substituted figure — and a ratio above one is never clamped, because a
 * worker who exceeded a goal is not at 100% of it.
 *
 * The goal is editable only under the explicit `canEditGoal` capability, which is stated here as an
 * action rather than as a hidden flag: with the capability absent the surface offers no edit control at
 * all, and the save that control would have made is refused by the same test inside `saveGoal`. The
 * envelope's revision is the goal's own concurrency token when a goal exists, so a save presents
 * exactly the revision it read; with no goal there is no token to present, and the absence is stated.
 *
 * Editing a goal never rewrites an earlier report, never publishes public progress and never changes a
 * commitment: those are three different facts this read does not touch, and progress is measured over
 * the period the caller names rather than stored beside the goal.
 *
 * @param query the period and currency the percentage is measured over, defaulting to the year to date.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readGoal(
  query: SupportQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<GoalData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_GOAL, source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const built = buildSupportQuery(query, context.scope, {
    reportId: GOAL_REPORT_ID,
    period: GOAL_DEFAULT_PERIOD,
    paged: false,
  });
  const report = reportOf(JOB_GOAL, built.query, context);
  if (!report.ok) {
    return { kind: "unavailable", unavailable: report.error };
  }
  const result = report.value;

  const decision: AccessDecision = canEdit(context.session, {
    kind: "support-subject",
    scope: context.scope,
    capabilities: context.session.capabilities,
  });
  const stored = context.projection.goal;
  const goal: SupportGoalFigure | null =
    stored === undefined
      ? null
      : project(stored, ["amount", "measure", "effectiveFrom", "revision"]);
  const progress = progressOf(result);
  const percentage =
    progress.percentageBasisPoints === null
      ? null
      : formatPercentageBasisPoints(progress.percentageBasisPoints);

  const data: GoalData = {
    goal,
    progress,
    percentage,
    report: result,
    period: {
      from: serialiseCivilDate(result.snapshot.period.from),
      to: serialiseCivilDate(result.snapshot.period.to),
      state: result.snapshot.period.state,
    },
    measure: GOAL_MEASURE,
    canEditGoal: decision.allowed,
  };

  const valueStates = recordedStatesOf(result);
  valueStates["goal.amount"] =
    goal === null ? "unknown" : recordedStateOf(statedAmountStateOf(goal.amount));
  valueStates["goal.percentage"] = progressStateOf(progress);

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data,
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: goal === null ? GOAL_ABSENT_REVISION : goal.revision,
      valueStates,
      actions: [
        decision.allowed
          ? { name: GOAL_CAPABILITY, available: true }
          : { name: GOAL_CAPABILITY, available: false, reason: GOAL_EDIT_UNAVAILABLE_REASON },
        ...refusalActions(built.refused),
      ],
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// "Take support out of the app": the four fixed reports and the whole-query export
// ---------------------------------------------------------------------------------------------

/**
 * Computes one of the four fixed reports of this release, and no other.
 *
 * The identity is one of four — received support for a period with its year-to-date and equal-elapsed
 * comparison, the monthly history of a chosen year, the partner-by-month matrix whose every cell
 * carries the query that opens the records behind it, and the two-period comparison with a signed
 * difference and the contributor deltas that reconcile it. This application has no report designer, no
 * report builder and no fifth report, and an identity it does not compute is refused rather than
 * replaced by another.
 *
 * Every report answers the same `ReportResult`, carrying the snapshot identity — the query, the scope,
 * the currency partition, the period, the one basis, the coverage and the as-of instant — that the
 * chart, the table, the drilldown, the CSV and the print view all state. That is what makes their
 * agreement structural: they read one result rather than five computations of one query. Sorting and
 * paging change `rows` and never `summary`, `series` or `total`, a period the source recorded nothing
 * in is a gap in the series, and an incomplete period's subtotals carry the state that says so.
 *
 * A matrix cell whose value is withheld, unknown or inside partial coverage carries that state, so a
 * partial cell is never shown as a complete number. A contributor who gave in the earlier period and
 * not in the later one is a change in giving and nothing more: no surface of this data labels them a
 * lost partner, because a change in giving implies nothing about a person's motivation.
 *
 * @param reportId which of the four reports to compute.
 * @param query the period, currency, filters, sort and page the report is stated for.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readReport(
  reportId: ReportId,
  query: SupportQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<ReportResult, FinancialCoverage>>> {
  assertReportId(reportId);

  const outcome = await readContext(JOB_REPORT, source);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const built = buildSupportQuery(query, context.scope, {
    reportId,
    period: REPORT_DEFAULT_PERIOD[reportId],
    paged: true,
  });
  const report = reportOf(JOB_REPORT, built.query, context);
  if (!report.ok) {
    return { kind: "unavailable", unavailable: report.error };
  }
  const result = report.value;

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data: result,
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: context.revision,
      valueStates: recordedStatesOf(result),
      actions: [
        ...refusalActions(built.refused),
        exportAction(canExport(context.session, context.scope)),
      ],
    }),
  };
}

/**
 * Takes the whole query out of the application: the same report in CSV form, with the print model.
 *
 * This is the same `runReport` call the screen made, for the same filters, printed and written by the
 * application's one CSV writer and one print model — never a second query, a second aggregation, a
 * re-sorted page or a second writer. The file therefore contains every authorised row of the query
 * rather than the loaded page, and its own metadata records state the grain, the basis, the currency,
 * the period, the coverage and the snapshot time, so a download cannot be mistaken for the answer to a
 * different question. The printed page states the same facts from the same function.
 *
 * Export permission is re-checked here on every request, before any record is opened: a caller without
 * it receives a denial with no count and no total, and learns nothing about what the query would hold.
 * A withheld value never appears in the file, directly or by subtraction, and an unknown or incomplete
 * amount keeps its own wording rather than becoming a zero or an empty cell.
 *
 * The suggested filename is the application's own — the report's fixed name and the period's two civil
 * days — never a value echoed from a record, so nothing a record holds can reach a filename.
 *
 * @param query the filters of the query being taken out; the page window is ignored, because an export
 *   is the whole query.
 * @param source an explicit session id for a direct caller; the browser path derives it from the cookie.
 */
export async function readExport(
  query: SupportQuery = {},
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<SupportExportData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_EXPORT, source, canExport);
  if (!outcome.ok) {
    return refusalOf(outcome.refusal);
  }
  const { context } = outcome;

  const built = buildSupportQuery(query, context.scope, {
    reportId: EXPORT_REPORT_ID,
    period: DEFAULT_PERIOD,
    paged: false,
  });
  const report = reportOf(JOB_EXPORT, built.query, context);
  if (!report.ok) {
    return { kind: "unavailable", unavailable: report.error };
  }
  const result = report.value;

  const valueStates = recordedStatesOf(result);
  valueStates["export.rowCount"] = countState(result.total);

  return {
    kind: "envelope",
    envelope: envelopeOf({
      data: {
        csv: toCsv(result),
        filename: exportFilenameOf(result),
        rowCount: result.total,
        metadata: snapshotMetadata(result),
        print: printModel(result),
        snapshot: result.snapshot,
      },
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: context.revision,
      valueStates,
      actions: [
        { name: "exportQuery", available: true },
        ...refusalActions(built.refused),
      ],
    }),
  };
}

