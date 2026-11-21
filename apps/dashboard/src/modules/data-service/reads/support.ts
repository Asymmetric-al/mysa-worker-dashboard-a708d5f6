/**
 * The support family's six reads: the overview, the gifts ledger, the commitments, the goal, the four
 * fixed reports and the whole-query export.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
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
import { GOAL_CAPABILITY, GOAL_MEASURE, formatPercentageBasisPoints, goalProgress, type GoalProgress } from "@/modules/support/goal";
import { CSV_ALL_CURRENCIES, snapshotMetadata, toCsv, type SnapshotFact } from "@/modules/export/csv";
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
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
import { assertScope, canEdit, canExport, outcomeOfRefusal, resolveSession, type AccessDecision, type ResolvedSession, type SessionSource } from "../authorize";
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
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type DeniedOutcome, type ReadResult, type UnavailableOutcome } from "../outcome";
// Fixed values this module states once
const READ_ATTEMPT_ID = "read";

const DATE_BASIS = "original-gift-date";

const GIFT_ROW_GRAIN = "gift-allocation";

const GOAL_ABSENT_REVISION = "absent";

const STORE_UNAVAILABLE_GUIDANCE = "This session's records could not be read. Nothing was changed; try again in a moment.";

const SUPPORT_SOURCE_REFERENCE = "support";

const SUPPORT_SOURCE_GUIDANCE =
  "The financial source could not answer for this period, so no amount is stated here — this is not zero and not an empty result. Try again in a moment; nothing was changed.";
const NO_SUPPORT_PROJECTION_GUIDANCE =
  "No financial source is established for this subject, so no amount is stated — this is not zero and not an empty result. The source's owner has to supply its projection before any figure can be reported.";
const AMOUNT_RANGE_PARTITION_REASON =
  "An amount range compares one currency's amounts, so it is applied only while a single currency is selected. Choose one currency to use it; no range is ever applied across currencies, because two currencies have no ordering here.";
const METHOD_FILTER_REASON =
  "The support projection carries no giving-method or classification field, so this facet cannot be applied to it. A filter that was never applied is not presented as a filtered result.";
const EXPORT_UNAVAILABLE_REASON = "This session holds no export permission for this context, so the whole query cannot be downloaded. The figures on screen are unaffected.";

const GOAL_EDIT_UNAVAILABLE_REASON = "This session does not hold the goal-editing capability, so the goal is read-only here: no edit control is offered and a save would be refused.";

const JOB_OVERVIEW = "readSupportOverview";
const JOB_GIFTS = "readGifts";
const JOB_COMMITMENTS = "readCommitments";
const JOB_GOAL = "readGoal";
const JOB_REPORT = "readReport";
const JOB_EXPORT = "readExport";

const OVERVIEW_REPORT_ID: ReportId = "received-period-and-year-to-date";
const LEDGER_REPORT_ID: ReportId = "received-period-and-year-to-date";
const GOAL_REPORT_ID: ReportId = "received-period-and-year-to-date";
const EXPORT_REPORT_ID: ReportId = "received-period-and-year-to-date";

const DEFAULT_PERIOD: ReportPeriod = { kind: "preset", preset: "this-month" };
const GOAL_DEFAULT_PERIOD: ReportPeriod = { kind: "preset", preset: "year-to-date" };

const REPORT_DEFAULT_PERIOD: Readonly<Record<ReportId, ReportPeriod>> = Object.freeze({
  "received-period-and-year-to-date": { kind: "preset", preset: "year-to-date" },
  "monthly-history": { kind: "preset", preset: "this-year" },
  "partner-month-matrix": { kind: "preset", preset: "this-year" },
  "period-comparison": { kind: "preset", preset: "this-month" },
});
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
const UNNAMED_FILTER_ACTION = "refuseFilter";
// The query a caller states
/** The period a caller names: one of the five presets, two civil days, or a calendar year. */
export type SupportPeriodInput =
  | { readonly kind: "preset"; readonly preset: string }
  | { readonly kind: "explicit"; readonly from: string; readonly to: string }
  | { readonly kind: "year"; readonly year: number };
/** The attribution a result is restricted to. */
export type SupportPartnerInput = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
/** The bounded filter set a support read accepts, in the one shape all six share. */
export interface SupportQuery {
  readonly period?: SupportPeriodInput;
  readonly currency?: string;
  readonly amountRange?: { readonly minMinor: number; readonly maxMinor: number };
  readonly designation?: string;
  readonly partner?: SupportPartnerInput;
  readonly method?: string;
  readonly search?: string;
  readonly sort?: { readonly field?: string; readonly direction?: string };
  readonly page?: { readonly index?: number; readonly size?: number };
  readonly timeZone?: string;
}
/** The page window a list accepts where the read states no period of its own. */
export interface SupportPageInput {
  readonly page?: { readonly index?: number; readonly size?: number };
}
// The figures every read states
/** One currency's stated amount: the exact minor units, the exponent they are read at, and the state that says what kind of value this is. */
export interface SupportAmount {
  readonly currency: string;
  readonly exponent: number | null;
  readonly minorUnits: number | null;
  readonly valueState: ValueState;
}
/** The period a figure covers, with the state that says whether it has closed. */
export interface SupportPeriod {
  readonly from: string;
  readonly to: string;
  readonly state: PeriodState;
}
/** One of the recurring outcome buckets, with the count of commitments the source places in it. */
export interface RecurringBucketFigure {
  readonly bucket: RecurringBucket;
  readonly label: string;
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
/** One commitment's source-qualified monthly equivalent, per currency. */
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
/** One commitment as the commitments read states it. */
export interface CommitmentFigure {
  readonly commitmentRowId: string;
  readonly kind: CommitmentKind;
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
  readonly monthlyEquivalent: SupportAmount | null;
}
/** The support overview: the cash-first figures for one period, then the secondary non-cash ones. */
export interface SupportOverviewData {
  readonly report: ReportResult;
  readonly monthlyEquivalent: readonly MonthlyEquivalentFigure[];
  readonly buckets: readonly RecurringBucketFigure[];
  readonly commitmentKinds: readonly CommitmentKindFigure[];
}
/** The gifts ledger: one whole-query report over the caller's bounded filter set. */
export interface GiftLedgerData {
  readonly report: ReportResult;
  readonly grain: typeof GIFT_ROW_GRAIN;
}
/** The commitments surface: every commitment the source states, plus the bucket and kind partitions. */
export interface CommitmentsData {
  readonly commitments: readonly CommitmentFigure[];
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
/** The goal read: the target, its progress, and the four states that must stay distinguishable. */
export interface GoalData {
  readonly goal: SupportGoalFigure | null;
  readonly progress: GoalProgress;
  readonly percentage: string | null;
  readonly report: ReportResult;
  readonly period: SupportPeriod;
  readonly measure: typeof GOAL_MEASURE;
  readonly canEditGoal: boolean;
}
/** One whole-query export: the file, its name, and the snapshot identity every surface of that query states. */
export interface SupportExportData {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly metadata: readonly SnapshotFact[];
  readonly print: PrintModel;
  readonly snapshot: Snapshot;
}
// The session documents these reads parse
const supportStateDocumentSchema = z.object({
  supportProjection: supportProjectionRecordSchema.nullable(),
  gifts: z.array(giftRowRecordSchema),
  commitments: z.array(commitmentRowRecordSchema),
});
const workloadDocumentSchema = z.object({
  header: z
    .object({
      coverage: coverageSchema,
      currencies: z.array(z.string().min(1)),
    })
    .optional(),
  gifts: z.array(giftRowRecordSchema),
});
type WorkloadDocument = z.infer<typeof workloadDocumentSchema>;
// Resolving the caller, the scope and the projection
interface SupportReadContext {
  readonly session: ResolvedSession;
  readonly scope: Scope;
  readonly revision: string;
  readonly asOf: string;
  readonly projection: SupportProjection;
}
type SupportContextOutcome = { readonly ok: true; readonly context: SupportReadContext } | { readonly ok: false; readonly refusal: DeniedOutcome | UnavailableOutcome };

function storeSource(): SourceReference {
  return { system: LOCAL_STORE_SYSTEM, reference: SUPPORT_SOURCE_REFERENCE };
}
function refused(reasonCode: DenialReason): DeniedOutcome {
  return denied({ operationId: READ_ATTEMPT_ID, reasonCode });
}
function sourceUnavailable(job: string, source: SourceReference, guidance: string = STORE_UNAVAILABLE_GUIDANCE): UnavailableOutcome {
  logger.sourceUnavailable({ job, source });
  return unavailable({ operationId: READ_ATTEMPT_ID, source, guidance });
}
function refusalOf<T>(refusal: DeniedOutcome | UnavailableOutcome): ReadResult<T> {
  return refusal.outcome === "denied" ? { kind: "denied", denied: refusal } : { kind: "unavailable", unavailable: refusal };
}
function sessionInstant(session: ResolvedSession): Temporal.Instant {
  return instantAt(session.clockOffsetMs);
}
function civilDateOf(value: string): CivilDate | undefined {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}
function statedDate(value: string, field: string): CivilDate {
  const parsed = civilDateOf(value);
  if (parsed === undefined) {
    throw new TypeError(`A stored ${field} value is not a civil date, so the record it belongs to cannot be read.`);
  }
  return parsed;
}
function statedDateOrNull(value: string | null, field: string): CivilDate | undefined {
  return value === null ? undefined : statedDate(value, field);
}
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
    pause: resumeOn === undefined ? { state: record.pause.state } : { state: record.pause.state, resumeOn },
    ...(fixedTotal === undefined ? {} : { fixedTotal }),
  };
}
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
function earlierBoundary(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left <= right ? left : right;
}
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
const validatedWorkloads = new WeakMap<object, ReturnType<typeof workloadDocumentSchema.safeParse>>();

function validatedWorkload(value: unknown): ReturnType<typeof workloadDocumentSchema.safeParse> {
  if (typeof value !== "object" || value === null) {
    return workloadDocumentSchema.safeParse(value);
  }
  const remembered = validatedWorkloads.get(value);
  if (remembered !== undefined) {
    return remembered;
  }
  const parsed = workloadDocumentSchema.safeParse(value);
  validatedWorkloads.set(value, parsed);
  return parsed;
}
const storedProjections = new WeakMap<object, Map<string, SupportProjection>>();

function projectionFor(input: Parameters<typeof projectionOf>[0]): SupportProjection {
  const anchor = input.workload;
  if (anchor === undefined) {
    return projectionOf(input);
  }
  let remembered = storedProjections.get(anchor);
  if (remembered === undefined) {
    remembered = new Map<string, SupportProjection>();
    storedProjections.set(anchor, remembered);
  }
  const key = `${input.record.supportSubjectId}|${input.record.revision}|${input.asOf}`;
  const cached = remembered.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const built = projectionOf(input);
  remembered.set(key, built);
  return built;
}
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
  const currencyExponents = header === undefined ? record.currencyExponents : { ...record.currencyExponents, ...knownExponentsOf(header.currencies) };
  const coverage = header === undefined ? record.coverage : mergedCoverage(record.coverage, header.coverage);
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
async function readContext(job: string, source?: SessionSource, permit?: (session: ResolvedSession, scope: Scope) => AccessDecision): Promise<SupportContextOutcome> {
  let resolution: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolution = await resolveSession(source);
  } catch {
    return { ok: false, refusal: refused("session-unavailable") };
  }
  if (!resolution.ok) {
    return { ok: false, refusal: outcomeOfRefusal(resolution.refusal, READ_ATTEMPT_ID) };
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
  let meta: unknown;
  try {
    const documents = await readSession(session.sessionId);
    if (documents === undefined) {
      return { ok: false, refusal: sourceUnavailable(job, storeSource()) };
    }
    state = documents.state;
    workloadValue = documents.workload;
    meta = documents.meta;
  } catch {
    return { ok: false, refusal: sourceUnavailable(job, storeSource()) };
  }
  // An armed scope-denial plan must take effect on the read it names, so it is answered here — after
  // the documents are read and before the state and workload documents are decoded, so nothing is
  // enumerated, totalled or projected first. The refusal is this module's ordinary denial by its
  // ordinary reason code: no count, title, existence flag or size leaves with it.
  if (failureFor(failurePlanOfDocument(meta), "read", job) === "denied") {
    return { ok: false, refusal: refused("no-permission") };
  }
  const parsed = supportStateDocumentSchema.safeParse(state);
  if (!parsed.success) {
    return { ok: false, refusal: sourceUnavailable(job, storeSource()) };
  }
  const workload = validatedWorkload(workloadValue);
  if (workloadValue !== undefined && !workload.success) {
    return { ok: false, refusal: sourceUnavailable(job, storeSource()) };
  }
  const workloadDocument = workload.success ? workload.data : undefined;
  const record = parsed.data.supportProjection;
  if (record === null || record.supportSubjectId !== scope.supportSubjectId) {
    return {
      ok: false,
      refusal: sourceUnavailable(job, storeSource(), NO_SUPPORT_PROJECTION_GUIDANCE),
    };
  }
  const asOf = sessionInstant(session).toString();
  let projection: SupportProjection;
  try {
    projection = projectionFor({
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
  // The scenario registry is the single owner of the scenario vocabulary, and the flag its row sets is
  // what this read consults: a session the development panel has switched into the "financial source
  // unavailable" world answers as an outage with the source's identity, rather than reporting figures
  // from a source it says it cannot read. A scenario id this build does not define cannot establish
  // that the source is up, so it answers the same way instead of serving on an assumption. The
  // condition is stated here, once, for every financial read of this session.
  if (!isScenarioId(session.scenarioId) || scenarioFlagsFor(session.scenarioId).financialSource === "unavailable") {
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
// The single query builder
interface SupportQueryDefaults {
  readonly reportId: ReportId;
  readonly period: ReportPeriod;
  readonly paged: boolean;
}
interface BuiltSupportQuery {
  readonly query: ReportQuery;
  readonly refused: readonly ReportQueryProblem[];
}
const EVERY_CURRENCY: CurrencySelection = Object.freeze({ kind: "all" });

function reportScopeOf(scope: Scope): ReportScope {
  return {
    organizationId: scope.organizationId,
    ministryId: scope.ministryId,
    supportSubjectId: scope.supportSubjectId,
    principalId: scope.principalId,
  };
}
function isPreset(value: string): value is PeriodPreset {
  return PERIOD_PRESETS.some((preset) => preset === value);
}
function isSortField(value: string): value is SortField {
  return SORT_FIELDS.some((field) => field === value);
}
function isSortDirection(value: string): value is SortDirection {
  return SORT_DIRECTIONS.some((direction) => direction === value);
}
function optionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
function periodOf(input: SupportPeriodInput | undefined, fallback: ReportPeriod, refused: ReportQueryProblem[]): ReportPeriod {
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
        message: "A preset period is one of the five this application offers, and this name is not one of them. Name a period or state two calendar days; no other period is substituted for this one.",
      });
      return fallback;
    case "explicit": {
      const from = civilDateOf(input.from.trim());
      const to = civilDateOf(input.to.trim());
      if (from === undefined || to === undefined) {
        refused.push({
          field: "period",
          message: "A period is two calendar days, each written as a day with no time of day. This request states a value that is not one, so the period is refused rather than guessed at.",
        });
        return fallback;
      }
      if (Temporal.PlainDate.compare(from, to) > 0) {
        refused.push({
          field: "period",
          message: "The period starts after it ends, so it covers no day at all. State the earlier day first; the range is inclusive at both ends.",
        });
        return fallback;
      }
      return { kind: "explicit", from, to };
    }
    case "year":
      if (!Number.isSafeInteger(input.year) || input.year < 1 || input.year > 9999) {
        refused.push({
          field: "period.year",
          message: "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it.",
        });
        return fallback;
      }
      return { kind: "year", year: input.year };
    default:
      refused.push({
        field: "period.kind",
        message: "A period is a preset, two calendar days or a calendar year. This one is none of those, so no period is assumed for it.",
      });
      return fallback;
  }
}
function currencyOf(code: string | undefined): CurrencySelection {
  const trimmed = optionalText(code);
  return trimmed === undefined ? EVERY_CURRENCY : { kind: "one", currency: trimmed };
}
function amountRangeOf(range: SupportQuery["amountRange"], refused: ReportQueryProblem[]): ReportQuery["amountRange"] | undefined {
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
function partnerOf(input: SupportPartnerInput | undefined, refused: ReportQueryProblem[]): ReportPartnerSelection | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input.kind === "partner") {
    const partnerId = input.partnerId.trim();
    if (partnerId === "") {
      refused.push({
        field: "partner.partnerId",
        message: "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place.",
      });
      return undefined;
    }
    return { kind: "partner", partnerId };
  }
  return { kind: input.kind };
}
function sortOf(input: SupportQuery["sort"], refused: ReportQueryProblem[]): ReportQuery["sort"] | undefined {
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
      message: "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it.",
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
function pageOf(input: SupportQuery["page"], refused: ReportQueryProblem[]): ReportQuery["page"] {
  if (input === undefined) {
    return { index: 0 };
  }
  const index = input.index ?? 0;
  if (!Number.isSafeInteger(index) || index < 0) {
    refused.push({
      field: "page.index",
      message: "A page index is a whole number of pages from zero. This value is not one, so the first page is read rather than a page nobody asked for.",
    });
    return { index: 0 };
  }
  return input.size === undefined ? { index } : { index, size: input.size };
}
function rootFieldOf(field: string): string {
  const separator = field.indexOf(".");
  return separator === -1 ? field : field.slice(0, separator);
}
function withoutRefusedFilters(query: ReportQuery, problems: readonly ReportQueryProblem[], defaults: SupportQueryDefaults): ReportQuery {
  const refused = new Set(problems.map((problem) => rootFieldOf(problem.field)));
  return {
    reportId: query.reportId,
    scope: query.scope,
    period: refused.has("period") ? defaults.period : query.period,
    currency: refused.has("currency") ? EVERY_CURRENCY : query.currency,
    ...(query.amountRange === undefined || refused.has("amountRange") ? {} : { amountRange: query.amountRange }),
    ...(query.designation === undefined || refused.has("designation") ? {} : { designation: query.designation }),
    ...(query.partner === undefined || refused.has("partner") ? {} : { partner: query.partner }),
    ...(query.method === undefined || refused.has("method") ? {} : { method: query.method }),
    ...(query.search === undefined || refused.has("search") ? {} : { search: query.search }),
    ...(query.sort === undefined || refused.has("sort") ? {} : { sort: query.sort }),
    ...(query.page === undefined || refused.has("page") ? {} : { page: query.page }),
    ...(query.timeZone === undefined || refused.has("timeZone") ? {} : { timeZone: query.timeZone }),
  };
}
function buildSupportQuery(input: SupportQuery, scope: Scope, defaults: SupportQueryDefaults): BuiltSupportQuery {
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
  throw new TypeError(`The support read could not build a query the report engine accepts from its own defaults. ${stated}`);
}
// The one computation, and the states it states
function reportOf(job: string, query: ReportQuery, context: SupportReadContext): Result<ReportResult, UnavailableOutcome> {
  try {
    return ok(withStatedRowAmounts(runReport(query, context.projection)));
  } catch {
    return err(sourceUnavailable(job, context.projection.source, SUPPORT_SOURCE_GUIDANCE));
  }
}
function withStatedRowAmounts(result: ReportResult): ReportResult {
  const states: Record<string, ValueState> = { ...result.valueStates };
  result.rows.forEach((row, index) => {
    if (exponentOf(row.amount.currency) === undefined) {
      states[`rows.${index}.amount`] = "unknown";
    }
  });
  return { ...result, valueStates: states };
}
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
function recordedStatesOf(result: ReportResult): Record<string, RecordedValueState> {
  const recorded: Record<string, RecordedValueState> = {};
  for (const [path, state] of Object.entries(result.valueStates)) {
    recorded[path] = recordedStateOf(state);
  }
  return recorded;
}
function countState(count: number): RecordedValueState {
  return count > 0 ? "value" : "zero";
}
function statedAmountStateOf(money: Money): ValueState {
  if (exponentOf(money.currency) === undefined) {
    return "unknown";
  }
  return money.minorUnits === 0 ? "zero" : "value";
}
function amountFigureOf(money: Money, state: ValueState): SupportAmount {
  const carriesAmount = state === "value" || state === "zero" || state === "incomplete-subtotal";
  return {
    currency: money.currency,
    exponent: exponentOf(money.currency) ?? null,
    minorUnits: carriesAmount ? money.minorUnits : null,
    valueState: state,
  };
}
function progressOf(result: ReportResult): GoalProgress {
  return result.goal ?? goalProgress({});
}
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
function kindFiguresOf(rows: readonly CommitmentRow[]): readonly CommitmentKindFigure[] {
  return COMMITMENT_KINDS.map((kind) => {
    const count = rows.filter((row) => row.kind === kind).length;
    return { kind, count, valueState: countState(count) };
  });
}
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
function financialCoverageOf(projection: SupportProjection, query: ReportQuery): FinancialCoverage {
  return {
    ...projection.coverage,
    currency: query.currency.kind === "one" ? query.currency.currency : CSV_ALL_CURRENCIES,
    dateBasis: DATE_BASIS,
  };
}
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
// What the reads say about the filters they could not apply
function filterActionName(field: string): string {
  const name = FILTER_ACTION_BY_FIELD[field];
  return name === undefined ? UNNAMED_FILTER_ACTION : name;
}
function refusalActions(refused: readonly ReportQueryProblem[]): readonly ReadAction[] {
  return refused.map((problem) => ({
    name: filterActionName(problem.field),
    available: false,
    reason: problem.message,
  }));
}
function exportAction(decision: AccessDecision): ReadAction {
  return decision.allowed ? { name: "exportQuery", available: true } : { name: "exportQuery", available: false, reason: EXPORT_UNAVAILABLE_REASON };
}
function ledgerActions(query: ReportQuery, refused: readonly ReportQueryProblem[], decision: AccessDecision): readonly ReadAction[] {
  const byName = new Map<string, ReadAction>();
  const order = ["filterByPeriod", "filterByCurrency", "filterByAmountRange", "filterByPartner", "filterByDesignation", "filterByMethod", "search", "sortRows", "pageRows"];
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
// The figures the commitment and export reads state
const FIXED_TOTAL_FIELDS = ["promised", "fulfilled", "released", "remaining"] as const;

const COMMITMENT_PERIOD_REASON =
  "A commitment is the source's current standing rather than an occurrence inside a period, so no period filter applies to it. The dates it last collected and is next eligible on are stated on the commitment itself.";
const COMMITMENT_CURRENCY_REASON =
  "Each commitment states its own currency and its own cadence, so a currency filter would hide commitments rather than restate them. The list is read whole and never summed across currencies.";
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
    lastSuccessfulOn: row.lastSuccessfulOn === undefined ? null : serialiseCivilDate(row.lastSuccessfulOn),
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
    monthlyEquivalent: monthly === undefined ? null : amountFigureOf(monthly, statedAmountStateOf(monthly)),
  };
}
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
function assertReportId(reportId: ReportId): void {
  if (!REPORT_IDS.some((identity) => identity === reportId)) {
    throw new TypeError(`"${String(reportId)}" is not one of the four reports this application computes, so no report is substituted for it. Choose one of ${REPORT_IDS.join(", ")}.`);
  }
}
function exportFilenameOf(result: ReportResult): string {
  const { query, period } = result.snapshot;
  return `support-${query.reportId}-${serialiseCivilDate(period.from)}-to-${serialiseCivilDate(period.to)}.csv`;
}
// "Understand support": the overview, the ledger, the commitments and the goal
/** States received support for one period, cash first, and the non-cash measures beside it. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSupportOverview(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SupportOverviewData, FinancialCoverage>>> {
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
    valueStates[`monthlyEquivalent.${figure.commitmentRowId}.amount`] = recordedStateOf(figure.amount.valueState);
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
/** The gifts ledger: one whole-query report over the caller's bounded filter set. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGifts(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<GiftLedgerData, FinancialCoverage>>> {
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
      actions: ledgerActions(result.snapshot.query, built.refused, canExport(context.session, context.scope)),
    }),
  };
}
/** States every commitment the source reports, in its bucket, with the dates the source states for it. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCommitments(query: SupportPageInput = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<CommitmentsData>>> {
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
  const index = Number.isSafeInteger(statedIndex) && statedIndex >= 0 ? Math.min(statedIndex, totalPages - 1) : 0;
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
    valueStates[`commitments.${figure.commitmentRowId}.perOccurrence`] = recordedStateOf(figure.perOccurrenceState);
    valueStates[`commitments.${figure.commitmentRowId}.monthlyEquivalent`] = figure.monthlyEquivalent === null ? "unknown" : recordedStateOf(figure.monthlyEquivalent.valueState);
    if (figure.fixedTotal === null) {
      continue;
    }
    for (const field of FIXED_TOTAL_FIELDS) {
      const amount = figure.fixedTotal[field];
      valueStates[`commitments.${figure.commitmentRowId}.fixedTotal.${field}`] = recordedStateOf(statedAmountStateOf(amount));
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
/** States the support goal, its progress and the four facts that must stay distinguishable. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGoal(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<GoalData, FinancialCoverage>>> {
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
  const goal: SupportGoalFigure | null = stored === undefined ? null : project(stored, ["amount", "measure", "effectiveFrom", "revision"]);
  const progress = progressOf(result);
  const percentage = progress.percentageBasisPoints === null ? null : formatPercentageBasisPoints(progress.percentageBasisPoints);
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
  valueStates["goal.amount"] = goal === null ? "unknown" : recordedStateOf(statedAmountStateOf(goal.amount));
  valueStates["goal.percentage"] = progressStateOf(progress);
  return {
    kind: "envelope",
    envelope: envelopeOf({
      data,
      context,
      coverage: financialCoverageOf(context.projection, result.snapshot.query),
      revision: goal === null ? GOAL_ABSENT_REVISION : goal.revision,
      valueStates,
      actions: [decision.allowed ? { name: GOAL_CAPABILITY, available: true } : { name: GOAL_CAPABILITY, available: false, reason: GOAL_EDIT_UNAVAILABLE_REASON }, ...refusalActions(built.refused)],
    }),
  };
}
// "Take support out of the app": the four fixed reports and the whole-query export
/** Computes one of the four fixed reports of this release, and no other. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReport(reportId: ReportId, query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReportResult, FinancialCoverage>>> {
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
      actions: [...refusalActions(built.refused), exportAction(canExport(context.session, context.scope))],
    }),
  };
}
/** Takes the whole query out of the application: the same report in CSV form, with the print model. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readExport(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SupportExportData, FinancialCoverage>>> {
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
      actions: [{ name: "exportQuery", available: true }, ...refusalActions(built.refused)],
    }),
  };
}
