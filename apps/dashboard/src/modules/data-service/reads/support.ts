import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { SourceReference } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import { minorUnitsOf, type Money } from "@/modules/money/amount";
import { exponentOf } from "@/modules/money/currency";
import { BUCKET_LABELS, COMMITMENT_KINDS, OUTSIDE_PARTITION, PARTITION_BUCKETS, isInPartition, type CommitmentKind, type CommitmentRow, type RecurringBucket } from "@/modules/support/buckets";
import type { SupportProjection } from "@/modules/support/basis";
import { GOAL_CAPABILITY, GOAL_MEASURE, formatPercentageBasisPoints, goalProgress, type GoalProgress } from "@/modules/support/goal";
import { CSV_ALL_CURRENCIES, snapshotMetadata, toCsv, type SnapshotFact } from "@/modules/export/csv";
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
import { serialiseCivilDate } from "@/modules/time/civil";
import { canEdit, canExport, type AccessDecision, type ResolvedSession, type SessionSource } from "../authorize";
import {
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
import { LOCAL_STORE_SYSTEM, unavailable, type ReadResult, type UnavailableOutcome } from "../outcome";
import { READ_ATTEMPT_ID, answerOf, cachedDecoder, civilDateOf, countState, deniedRead, openRead, readStoreDocument, recordedStateOf, sourceUnavailableRead, statedProjection } from "./frame";
const DATE_BASIS = "original-gift-date";
const GIFT_ROW_GRAIN = "gift-allocation";
const GOAL_ABSENT_REVISION = "absent";
const STORE_UNAVAILABLE_GUIDANCE = "This session's records could not be read. Nothing was changed; try again in a moment.";
const SUPPORT_SOURCE_REFERENCE = "support";
const SUPPORT_SOURCE_GUIDANCE = "The financial source could not answer for this period, so no amount is stated here — this is not zero and not an empty result. Try again in a moment; nothing was changed.";
const NO_SUPPORT_PROJECTION_GUIDANCE = "No financial source is established for this subject, so no amount is stated — this is not zero and not an empty result. The source's owner has to supply its projection before any figure can be reported.";
const AMOUNT_RANGE_PARTITION_REASON = "An amount range compares one currency's amounts, so it is applied only while a single currency is selected. Choose one currency to use it; no range is ever applied across currencies, because two currencies have no ordering here.";
const METHOD_FILTER_REASON = "The support projection carries no giving-method or classification field, so this facet cannot be applied to it. A filter that was never applied is not presented as a filtered result.";
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
export type SupportPeriodInput = { readonly kind: "preset"; readonly preset: string } | { readonly kind: "explicit"; readonly from: string; readonly to: string } | { readonly kind: "year"; readonly year: number };
export type SupportPartnerInput = { readonly kind: "partner"; readonly partnerId: string } | { readonly kind: "anonymous" } | { readonly kind: "unresolved" };
export type SupportQuery = { readonly period?: SupportPeriodInput; readonly currency?: string } & { readonly amountRange?: { readonly minMinor: number; readonly maxMinor: number }; readonly designation?: string } & { readonly partner?: SupportPartnerInput; readonly method?: string; readonly search?: string } & {
  readonly sort?: { readonly field?: string; readonly direction?: string };
  readonly page?: { readonly index?: number; readonly size?: number };
} & { readonly timeZone?: string };
export interface SupportPageInput {
  readonly page?: { readonly index?: number; readonly size?: number };
  readonly commitmentId?: string;
  readonly showAdditionalTypes?: boolean;
}
export type SupportAmount = { readonly currency: string; readonly exponent: number | null; readonly minorUnits: number | null; readonly valueState: ValueState };
export type SupportPeriod = { readonly from: string; readonly to: string; readonly state: PeriodState };
export type RecurringBucketFigure = { readonly bucket: RecurringBucket; readonly label: string; readonly inPartition: boolean; readonly count: number; readonly valueState: ValueState };
export type CommitmentKindFigure = { readonly kind: CommitmentKind; readonly count: number; readonly valueState: ValueState };
export type MonthlyEquivalentFigure = { readonly commitmentRowId: string; readonly cadence: string; readonly amount: SupportAmount };
export type SupportFixedTotalFigure = { readonly promised: Money; readonly fulfilled: Money; readonly released: Money; readonly remaining: Money };
export type CommitmentFigure = { readonly commitmentRowId: string; readonly kind: CommitmentKind; readonly cadence: string; readonly perOccurrence: Money } & { readonly bucket: RecurringBucket; readonly bucketLabel: string; readonly inPartition: boolean; readonly lastSuccessfulOn: string | null } & {
  readonly nextEligibleOn: string | null;
  readonly pause: { readonly state: "active" | "paused"; readonly resumeOn: string | null };
} & { readonly fixedTotal: SupportFixedTotalFigure | null; readonly monthlyEquivalent: SupportAmount | null };
export type SupportOverviewData = { readonly report: ReportResult; readonly monthlyEquivalent: readonly MonthlyEquivalentFigure[]; readonly buckets: readonly RecurringBucketFigure[]; readonly commitmentKinds: readonly CommitmentKindFigure[] };
export type GiftLedgerData = { readonly report: ReportResult; readonly grain: typeof GIFT_ROW_GRAIN };
export type CommitmentsData = { readonly commitments: readonly CommitmentFigure[]; readonly total: number; readonly page: { readonly index: number; readonly size: number; readonly totalPages: number }; readonly buckets: readonly RecurringBucketFigure[]; readonly commitmentKinds: readonly CommitmentKindFigure[] };
export type SupportGoalFigure = { readonly amount: Money; readonly measure: SupportGoalRecord["measure"]; readonly effectiveFrom: string; readonly revision: string };
/** One currency the subject's financial source states, at the exact precision an amount in it is written: the closed set a goal may be stated in. */
export type GoalCurrency = { readonly currency: string; readonly exponent: number };
/** The goal read: the target, its progress, the currencies the source states for this subject, and the four states that must stay distinguishable. */
export type GoalData = { readonly goal: SupportGoalFigure | null; readonly progress: GoalProgress; readonly percentage: string | null; readonly report: ReportResult; readonly period: SupportPeriod; readonly measure: typeof GOAL_MEASURE; readonly canEditGoal: boolean; readonly currencies: readonly GoalCurrency[] };
export type SupportExportData = { readonly csv: string; readonly filename: string; readonly rowCount: number; readonly metadata: readonly SnapshotFact[]; readonly snapshot: Snapshot };
const supportStateDocumentSchema = z.object({ supportProjection: supportProjectionRecordSchema.nullable(), gifts: z.array(giftRowRecordSchema), commitments: z.array(commitmentRowRecordSchema) });
const workloadDocumentSchema = z.object({ header: z.object({ coverage: coverageSchema, currencies: z.array(z.string().min(1)) }).optional(), gifts: z.array(giftRowRecordSchema) });
type WorkloadDocument = z.infer<typeof workloadDocumentSchema>;
type SupportReadContext = { readonly session: ResolvedSession; readonly scope: Scope; readonly revision: string; readonly asOf: string } & { readonly projection: SupportProjection };
type SupportContextOutcome = { readonly ok: true; readonly context: SupportReadContext } | { readonly ok: false; readonly result: ReadResult<never> };
const SUPPORT_SOURCE: SourceReference = Object.freeze({ system: LOCAL_STORE_SYSTEM, reference: SUPPORT_SOURCE_REFERENCE });
function sourceUnavailable(job: string, source: SourceReference, guidance: string = STORE_UNAVAILABLE_GUIDANCE): UnavailableOutcome {
  logger.sourceUnavailable({ job, source });
  return unavailable({ operationId: READ_ATTEMPT_ID, source, guidance });
}
/** The currencies the subject's source states, each at the precision this application writes an amount in it: a currency this application holds no precision for is left out rather than given an assumed exponent. */
function goalCurrenciesOf(projection: SupportProjection): readonly GoalCurrency[] {
  const currencies: GoalCurrency[] = [];
  for (const currency of Object.keys(projection.currencyExponents)) {
    const exponent = exponentOf(currency);
    if (exponent === undefined) continue;
    currencies.push({ currency, exponent });
  }
  return currencies;
}
// One validated copy per workload document object: the store hands back a fresh object whenever any of the session's files change, so an entry is released with the document version it belongs to.
const validatedWorkload = cachedDecoder(workloadDocumentSchema);
// The latest projection of one workload document, replaced rather than accumulated: a goal save moves the record's revision and a clock change moves the read's as-of instant, and either answer is the only one a read of that document version may come back with.
const storedProjections = new WeakMap<object, { readonly key: string; readonly projection: SupportProjection }>();
function projectionFor(input: Parameters<typeof projectionOf>[0]): SupportProjection {
  const anchor = input.workload;
  if (anchor === undefined) return projectionOf(input);
  const key = `${input.record.supportSubjectId}|${input.record.revision}|${input.asOf}`;
  const remembered = storedProjections.get(anchor);
  if (remembered !== undefined && remembered.key === key) return remembered.projection;
  const built = projectionOf(input);
  storedProjections.set(anchor, { key, projection: built });
  return built;
}
function projectionOf(input: { readonly record: SupportProjectionRecord; readonly gifts: readonly GiftRowRecord[]; readonly workloadGifts: readonly GiftRowRecord[]; readonly workload: WorkloadDocument | undefined; readonly commitments: readonly CommitmentRowRecord[]; readonly asOf: string }): SupportProjection {
  return statedProjection({ record: input.record, gifts: input.gifts, workloadGifts: input.workloadGifts, commitments: input.commitments, header: input.workload?.header, asOf: input.asOf, withGoal: true });
}
async function readContext(job: string, source?: SessionSource, permit?: (session: ResolvedSession, scope: Scope) => AccessDecision): Promise<SupportContextOutcome> {
  const opened = await openRead({ source, unselectedReason: "not-admitted", sessionFaultReason: "session-unavailable", permit });
  if (!opened.ok) return { ok: false, result: opened.result };
  const stored = await readStoreDocument({ session: opened.session, job, source: SUPPORT_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE });
  if (!stored.ok) return { ok: false, result: stored.result };
  if (failureFor(failurePlanOfDocument(stored.documents.meta), "read", job) === "denied") return { ok: false, result: deniedRead("no-permission") };
  const parsed = supportStateDocumentSchema.safeParse(stored.documents.state);
  if (!parsed.success) return { ok: false, result: sourceUnavailableRead({ job, source: SUPPORT_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE }) };
  const workload = validatedWorkload(stored.documents.workload);
  if (stored.documents.workload !== undefined && !workload.success) return { ok: false, result: sourceUnavailableRead({ job, source: SUPPORT_SOURCE, guidance: STORE_UNAVAILABLE_GUIDANCE }) };
  const record = parsed.data.supportProjection;
  if (record === null || record.supportSubjectId !== opened.scope.supportSubjectId) return { ok: false, result: sourceUnavailableRead({ job, source: SUPPORT_SOURCE, guidance: NO_SUPPORT_PROJECTION_GUIDANCE }) };
  const asOf = opened.instant.toString();
  let projection: SupportProjection;
  try {
    projection = projectionFor({ record, gifts: parsed.data.gifts, workloadGifts: workload.success ? workload.data.gifts : [], workload: workload.success ? workload.data : undefined, commitments: parsed.data.commitments, asOf });
  } catch {
    return { ok: false, result: sourceUnavailableRead({ job, source: record.source, guidance: SUPPORT_SOURCE_GUIDANCE }) };
  }
  const financialSourceDown = isScenarioId(opened.session.scenarioId) && scenarioFlagsFor(opened.session.scenarioId).financialSource === "unavailable";
  return financialSourceDown ? { ok: false, result: sourceUnavailableRead({ job, source: projection.source, guidance: SUPPORT_SOURCE_GUIDANCE }) } : { ok: true, context: { session: opened.session, scope: opened.scope, revision: record.revision, asOf, projection } };
}
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
const reportScopeOf = (scope: Scope): ReportScope => ({ organizationId: scope.organizationId, ministryId: scope.ministryId, supportSubjectId: scope.supportSubjectId, principalId: scope.principalId });
const isPreset = (value: string): value is PeriodPreset => PERIOD_PRESETS.some((preset) => preset === value);
const isSortField = (value: string): value is SortField => SORT_FIELDS.some((field) => field === value);
const isSortDirection = (value: string): value is SortDirection => SORT_DIRECTIONS.some((direction) => direction === value);
function optionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
function periodOf(input: SupportPeriodInput | undefined, fallback: ReportPeriod, refused: ReportQueryProblem[]): ReportPeriod {
  if (input === undefined) return fallback;
  switch (input.kind) {
    case "preset":
      if (isPreset(input.preset)) return { kind: "preset", preset: input.preset };
      refused.push({ field: "period.preset", message: "A preset period is one of the five this application offers, and this name is not one of them. Name a period or state two calendar days; no other period is substituted for this one." });
      return fallback;
    case "explicit": {
      const from = civilDateOf(input.from.trim());
      const to = civilDateOf(input.to.trim());
      if (from === undefined || to === undefined) {
        refused.push({ field: "period", message: "A period is two calendar days, each written as a day with no time of day. This request states a value that is not one, so the period is refused rather than guessed at." });
        return fallback;
      }
      if (Temporal.PlainDate.compare(from, to) > 0) {
        refused.push({ field: "period", message: "The period starts after it ends, so it covers no day at all. State the earlier day first; the range is inclusive at both ends." });
        return fallback;
      }
      return { kind: "explicit", from, to };
    }
    case "year":
      if (!Number.isSafeInteger(input.year) || input.year < 1 || input.year > 9999) {
        refused.push({ field: "period.year", message: "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it." });
        return fallback;
      }
      return { kind: "year", year: input.year };
    default:
      refused.push({ field: "period.kind", message: "A period is a preset, two calendar days or a calendar year. This one is none of those, so no period is assumed for it." });
      return fallback;
  }
}
function currencyOf(code: string | undefined): CurrencySelection {
  const trimmed = optionalText(code);
  return trimmed === undefined ? EVERY_CURRENCY : { kind: "one", currency: trimmed };
}
function amountRangeOf(range: SupportQuery["amountRange"], refused: ReportQueryProblem[]): ReportQuery["amountRange"] | undefined {
  if (range === undefined) return undefined;
  if (!Number.isSafeInteger(range.minMinor) || !Number.isSafeInteger(range.maxMinor)) {
    refused.push({ field: "amountRange", message: "An amount range states whole counts of the selected currency's minor units. A fractional or non-finite bound is refused rather than rounded, because rounding would change which rows match." });
    return undefined;
  }
  return { minMinor: minorUnitsOf(range.minMinor), maxMinor: minorUnitsOf(range.maxMinor) };
}
function partnerOf(input: SupportPartnerInput | undefined, refused: ReportQueryProblem[]): ReportPartnerSelection | undefined {
  if (input === undefined) return undefined;
  if (input.kind === "partner") {
    const partnerId = input.partnerId.trim();
    if (partnerId === "") {
      refused.push({ field: "partner.partnerId", message: "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place." });
      return undefined;
    }
    return { kind: "partner", partnerId };
  }
  return { kind: input.kind };
}
function sortOf(input: SupportQuery["sort"], refused: ReportQueryProblem[]): ReportQuery["sort"] | undefined {
  if (input === undefined) return undefined;
  const field = optionalText(input.field);
  if (field === undefined) return undefined;
  if (!isSortField(field)) {
    refused.push({ field: "sort.field", message: "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it." });
    return undefined;
  }
  const direction = optionalText(input.direction) ?? "asc";
  if (!isSortDirection(direction)) {
    refused.push({ field: "sort.direction", message: "A sort runs ascending or descending. This direction is neither, so no order is assumed." });
    return undefined;
  }
  return { field, direction };
}
function pageOf(input: SupportQuery["page"], refused: ReportQueryProblem[]): ReportQuery["page"] {
  if (input === undefined) return { index: 0 };
  const index = input.index ?? 0;
  if (!Number.isSafeInteger(index) || index < 0) {
    refused.push({ field: "page.index", message: "A page index is a whole number of pages from zero. This value is not one, so the first page is read rather than a page nobody asked for." });
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
  if (built.ok) return { query: built.query, refused };
  refused.push(...built.problems);
  const rebuilt = buildReportQuery(withoutRefusedFilters(candidate, built.problems, defaults));
  if (rebuilt.ok) return { query: rebuilt.query, refused };
  const stated = rebuilt.problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
  throw new TypeError(`The support read could not build a query the report engine accepts from its own defaults. ${stated}`);
}
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
    if (exponentOf(row.amount.currency) === undefined) states[`rows.${index}.amount`] = "unknown";
  });
  return { ...result, valueStates: states };
}
function recordedStatesOf(result: ReportResult): Record<string, RecordedValueState> {
  const recorded: Record<string, RecordedValueState> = {};
  for (const [path, state] of Object.entries(result.valueStates)) recorded[path] = recordedStateOf(state);
  return recorded;
}
const statedAmountStateOf = (money: Money): ValueState => (exponentOf(money.currency) === undefined ? "unknown" : money.minorUnits === 0 ? "zero" : "value");
const amountFigureOf = (money: Money, state: ValueState): SupportAmount => ({ currency: money.currency, exponent: exponentOf(money.currency) ?? null, minorUnits: state === "value" || state === "zero" || state === "incomplete-subtotal" ? money.minorUnits : null, valueState: state });
function bucketFiguresOf(rows: readonly CommitmentRow[]): readonly RecurringBucketFigure[] {
  const order: readonly RecurringBucket[] = [...PARTITION_BUCKETS, OUTSIDE_PARTITION];
  const counts = new Map<RecurringBucket, number>();
  for (const bucket of order) counts.set(bucket, 0);
  for (const row of rows) counts.set(row.bucketState, (counts.get(row.bucketState) ?? 0) + 1);
  return order.map((bucket) => {
    const count = counts.get(bucket) ?? 0;
    return { bucket, label: BUCKET_LABELS[bucket], inPartition: isInPartition(bucket), count, valueState: countState(count) };
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
    if (money === undefined) continue;
    figures.push({ commitmentRowId: row.commitmentRowId, cadence: row.cadence, amount: amountFigureOf(money, statedAmountStateOf(money)) });
  }
  return figures;
}
const financialCoverageOf = (projection: SupportProjection, query: ReportQuery): FinancialCoverage => ({ ...projection.coverage, currency: query.currency.kind === "one" ? query.currency.currency : CSV_ALL_CURRENCIES, dateBasis: DATE_BASIS });
function envelopeOf<T, C extends Coverage>(input: { readonly data: T; readonly context: SupportReadContext; readonly coverage: C; readonly revision: string; readonly valueStates: Readonly<Record<string, RecordedValueState>>; readonly actions: readonly ReadAction[] }): ReadResult<ReadEnvelope<T, C>> {
  return answerOf(input.context.scope, input.context.asOf, { data: input.data, source: input.context.projection.source, revision: input.revision, coverage: input.coverage, valueStates: input.valueStates, actions: input.actions });
}
function filterActionName(field: string): string {
  const name = FILTER_ACTION_BY_FIELD[field];
  return name === undefined ? UNNAMED_FILTER_ACTION : name;
}
const refusalActions = (refused: readonly ReportQueryProblem[]): readonly ReadAction[] => refused.map((problem) => ({ name: filterActionName(problem.field), available: false, reason: problem.message }));
const exportAction = (decision: AccessDecision): ReadAction => (decision.allowed ? { name: "exportQuery", available: true } : { name: "exportQuery", available: false, reason: EXPORT_UNAVAILABLE_REASON });
function ledgerActions(query: ReportQuery, refused: readonly ReportQueryProblem[], decision: AccessDecision): readonly ReadAction[] {
  const byName = new Map<string, ReadAction>();
  for (const name of ["filterByPeriod", "filterByCurrency", "filterByAmountRange", "filterByPartner", "filterByDesignation", "filterByMethod", "search", "sortRows", "pageRows"]) byName.set(name, { name, available: true });
  byName.set("filterByAmountRange", { name: "filterByAmountRange", available: query.currency.kind === "one", ...(query.currency.kind === "one" ? {} : { reason: AMOUNT_RANGE_PARTITION_REASON }) });
  byName.set("filterByMethod", { name: "filterByMethod", available: false, reason: METHOD_FILTER_REASON });
  for (const action of refusalActions(refused)) byName.set(action.name, action);
  byName.set("exportQuery", exportAction(decision));
  return [...byName.values()];
}
const FIXED_TOTAL_FIELDS = ["promised", "fulfilled", "released", "remaining"] as const;
const COMMITMENT_PERIOD_REASON = "A commitment is the source's current standing rather than an occurrence inside a period, so no period filter applies to it. The dates it last collected and is next eligible on are stated on the commitment itself.";
const COMMITMENT_CURRENCY_REASON = "Each commitment states its own currency and its own cadence, so a currency filter would hide commitments rather than restate them. The list is read whole and never summed across currencies.";
const SHOW_ADDITIONAL_TYPES_REASON =
  "The finance source supplies the three commitment kinds it distinguishes — an automatic recurring gift, a manual recurring gift and a fixed total — and no additional type, so asking to show additional source-supplied types cannot add a row. Every commitment the source reports is already in this list.";
function compareCommitments(left: CommitmentRow, right: CommitmentRow): number {
  const leftKind = COMMITMENT_KINDS.indexOf(left.kind);
  const rightKind = COMMITMENT_KINDS.indexOf(right.kind);
  return leftKind !== rightKind ? leftKind - rightKind : left.commitmentRowId === right.commitmentRowId ? 0 : left.commitmentRowId < right.commitmentRowId ? -1 : 1;
}
function commitmentFigureOf(row: CommitmentRow): CommitmentFigure {
  const monthly = row.monthlyEquivalentFromSource;
  return {
    commitmentRowId: row.commitmentRowId,
    kind: row.kind,
    cadence: row.cadence,
    perOccurrence: row.perOccurrence,
    bucket: row.bucketState,
    bucketLabel: BUCKET_LABELS[row.bucketState],
    inPartition: isInPartition(row.bucketState),
    lastSuccessfulOn: row.lastSuccessfulOn === undefined ? null : serialiseCivilDate(row.lastSuccessfulOn),
    nextEligibleOn: row.nextEligibleOn === undefined ? null : serialiseCivilDate(row.nextEligibleOn),
    pause: { state: row.pause.state, resumeOn: row.pause.resumeOn === undefined ? null : serialiseCivilDate(row.pause.resumeOn) },
    fixedTotal: row.fixedTotal === undefined ? null : { promised: row.fixedTotal.promised, fulfilled: row.fixedTotal.fulfilled, released: row.fixedTotal.released, remaining: row.fixedTotal.remaining },
    monthlyEquivalent: monthly === undefined ? null : amountFigureOf(monthly, statedAmountStateOf(monthly)),
  };
}
const progressStateOf = (progress: GoalProgress): RecordedValueState => (progress.state === "value" || progress.state === "zero" ? progress.state : "unknown");
function assertReportId(reportId: ReportId): void {
  if (!REPORT_IDS.some((identity) => identity === reportId)) throw new TypeError(`"${String(reportId)}" is not one of the four reports this application computes, so no report is substituted for it. Choose one of ${REPORT_IDS.join(", ")}.`);
}
function exportFilenameOf(result: ReportResult): string {
  const { query, period } = result.snapshot;
  return `support-${query.reportId}-${serialiseCivilDate(period.from)}-to-${serialiseCivilDate(period.to)}.csv`;
}
/** States received support for one period, cash first, and the non-cash measures beside it. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readSupportOverview(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SupportOverviewData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_OVERVIEW, source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const built = buildSupportQuery(query, context.scope, { reportId: OVERVIEW_REPORT_ID, period: DEFAULT_PERIOD, paged: false });
  const report = reportOf(JOB_OVERVIEW, built.query, context);
  if (!report.ok) return { kind: "unavailable", unavailable: report.error };
  const result = report.value;
  const data: SupportOverviewData = { report: result, monthlyEquivalent: monthlyEquivalentsOf(context.projection.commitments), buckets: bucketFiguresOf(context.projection.commitments), commitmentKinds: kindFiguresOf(context.projection.commitments) };
  const valueStates = recordedStatesOf(result);
  for (const figure of data.buckets) valueStates[`buckets.${figure.bucket}.count`] = recordedStateOf(figure.valueState);
  for (const figure of data.commitmentKinds) valueStates[`commitmentKinds.${figure.kind}.count`] = recordedStateOf(figure.valueState);
  for (const figure of data.monthlyEquivalent) valueStates[`monthlyEquivalent.${figure.commitmentRowId}.amount`] = recordedStateOf(figure.amount.valueState);
  return envelopeOf({ data, context, coverage: financialCoverageOf(context.projection, result.snapshot.query), revision: context.revision, valueStates, actions: refusalActions(built.refused) });
}
/** The gifts ledger: one whole-query report over the caller's bounded filter set. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGifts(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<GiftLedgerData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_GIFTS, source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const built = buildSupportQuery(query, context.scope, { reportId: LEDGER_REPORT_ID, period: DEFAULT_PERIOD, paged: true });
  const report = reportOf(JOB_GIFTS, built.query, context);
  if (!report.ok) return { kind: "unavailable", unavailable: report.error };
  const result = report.value;
  const data: GiftLedgerData = { report: result, grain: GIFT_ROW_GRAIN };
  return envelopeOf({ data, context, coverage: financialCoverageOf(context.projection, result.snapshot.query), revision: context.revision, valueStates: recordedStatesOf(result), actions: ledgerActions(result.snapshot.query, built.refused, canExport(context.session, context.scope)) });
}
/** States every commitment the source reports, in its bucket, with the dates the source states for it. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readCommitments(query: SupportPageInput = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<CommitmentsData>>> {
  const outcome = await readContext(JOB_COMMITMENTS, source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const rows = context.projection.commitments;
  const ordered = [...rows].sort(compareCommitments);
  const selected = query.commitmentId === undefined ? ordered : ordered.filter((row) => row.commitmentRowId === query.commitmentId);
  const size = clampPageSize(query.page?.size);
  const totalPages = Math.max(1, Math.ceil(selected.length / size));
  const statedIndex = query.page?.index ?? 0;
  const index = Number.isSafeInteger(statedIndex) && statedIndex >= 0 ? Math.min(statedIndex, totalPages - 1) : 0;
  const data: CommitmentsData = { commitments: selected.slice(index * size, index * size + size).map(commitmentFigureOf), total: ordered.length, page: { index, size, totalPages }, buckets: bucketFiguresOf(rows), commitmentKinds: kindFiguresOf(rows) };
  const valueStates: Record<string, RecordedValueState> = {};
  for (const figure of data.buckets) valueStates[`buckets.${figure.bucket}.count`] = recordedStateOf(figure.valueState);
  for (const figure of data.commitmentKinds) valueStates[`commitmentKinds.${figure.kind}.count`] = recordedStateOf(figure.valueState);
  for (const figure of data.commitments) {
    valueStates[`commitments.${figure.commitmentRowId}.perOccurrence`] = recordedStateOf(statedAmountStateOf(figure.perOccurrence));
    valueStates[`commitments.${figure.commitmentRowId}.monthlyEquivalent`] = figure.monthlyEquivalent === null ? "unknown" : recordedStateOf(figure.monthlyEquivalent.valueState);
    if (figure.fixedTotal === null) continue;
    for (const field of FIXED_TOTAL_FIELDS) valueStates[`commitments.${figure.commitmentRowId}.fixedTotal.${field}`] = recordedStateOf(statedAmountStateOf(figure.fixedTotal[field]));
  }
  valueStates["page.index"] = countState(data.page.index);
  valueStates["page.total"] = countState(data.total);
  const actions = [
    { name: "showAdditionalTypes", available: false, reason: SHOW_ADDITIONAL_TYPES_REASON },
    { name: "filterByPeriod", available: false, reason: COMMITMENT_PERIOD_REASON },
    { name: "filterByCurrency", available: false, reason: COMMITMENT_CURRENCY_REASON },
    { name: "pageRows", available: true },
  ];
  return envelopeOf({ data, context, coverage: context.projection.coverage, revision: context.revision, valueStates, actions });
}
/** States the support goal, its progress and the four facts that must stay distinguishable. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readGoal(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<GoalData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_GOAL, source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const built = buildSupportQuery(query, context.scope, { reportId: GOAL_REPORT_ID, period: GOAL_DEFAULT_PERIOD, paged: false });
  const report = reportOf(JOB_GOAL, built.query, context);
  if (!report.ok) return { kind: "unavailable", unavailable: report.error };
  const result = report.value;
  const decision: AccessDecision = canEdit(context.session, { kind: "support-subject", scope: context.scope, capabilities: context.session.capabilities });
  const stored = context.projection.goal;
  const goal: SupportGoalFigure | null = stored === undefined ? null : project(stored, ["amount", "measure", "effectiveFrom", "revision"]);
  const progress = result.goal ?? goalProgress({});
  const percentage = progress.percentageBasisPoints === null ? null : formatPercentageBasisPoints(progress.percentageBasisPoints);
  const data: GoalData = {
    goal,
    progress,
    percentage,
    report: result,
    period: { from: serialiseCivilDate(result.snapshot.period.from), to: serialiseCivilDate(result.snapshot.period.to), state: result.snapshot.period.state },
    measure: GOAL_MEASURE,
    canEditGoal: decision.allowed,
    currencies: goalCurrenciesOf(context.projection),
  };
  const valueStates = recordedStatesOf(result);
  valueStates["goal.amount"] = goal === null ? "unknown" : recordedStateOf(statedAmountStateOf(goal.amount));
  valueStates["goal.percentage"] = progressStateOf(progress);
  const actions = [decision.allowed ? { name: GOAL_CAPABILITY, available: true } : { name: GOAL_CAPABILITY, available: false, reason: GOAL_EDIT_UNAVAILABLE_REASON }, ...refusalActions(built.refused)];
  return envelopeOf({ data, context, coverage: financialCoverageOf(context.projection, result.snapshot.query), revision: goal === null ? GOAL_ABSENT_REVISION : goal.revision, valueStates, actions });
}
/** Computes one of the four fixed reports of this release, and no other. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readReport(reportId: ReportId, query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<ReportResult, FinancialCoverage>>> {
  assertReportId(reportId);
  const outcome = await readContext(JOB_REPORT, source);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const built = buildSupportQuery(query, context.scope, { reportId, period: REPORT_DEFAULT_PERIOD[reportId], paged: true });
  const report = reportOf(JOB_REPORT, built.query, context);
  if (!report.ok) return { kind: "unavailable", unavailable: report.error };
  const result = report.value;
  return envelopeOf({ data: result, context, coverage: financialCoverageOf(context.projection, result.snapshot.query), revision: context.revision, valueStates: recordedStatesOf(result), actions: [...refusalActions(built.refused), exportAction(canExport(context.session, context.scope))] });
}
/** Takes the whole query out of the application: the same report in CSV form, with the snapshot identity it states; the printed page renders its model from the same result the browser already holds. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readExport(query: SupportQuery = {}, source?: SessionSource): Promise<ReadResult<ReadEnvelope<SupportExportData, FinancialCoverage>>> {
  const outcome = await readContext(JOB_EXPORT, source, canExport);
  if (!outcome.ok) return outcome.result;
  const { context } = outcome;
  const built = buildSupportQuery(query, context.scope, { reportId: EXPORT_REPORT_ID, period: DEFAULT_PERIOD, paged: false });
  const report = reportOf(JOB_EXPORT, built.query, context);
  if (!report.ok) return { kind: "unavailable", unavailable: report.error };
  const result = report.value;
  const valueStates = recordedStatesOf(result);
  valueStates["export.rowCount"] = countState(result.total);
  const data: SupportExportData = { csv: toCsv(result), filename: exportFilenameOf(result), rowCount: result.total, metadata: snapshotMetadata(result), snapshot: result.snapshot };
  return envelopeOf({ data, context, coverage: financialCoverageOf(context.projection, result.snapshot.query), revision: context.revision, valueStates, actions: [{ name: "exportQuery", available: true }, ...refusalActions(built.refused)] });
}
