/**
 * Whole-query agreement among every financial surface: the domain half of success criterion 1.
 *
 * One query executes once and produces one `ReportResult`. The on-screen summary, the chart series, the
 * table rows beside the whole-result count and the print model all read that one result, so they agree
 * in count and in minor-unit sums per currency because they are one computation rather than six
 * careful copies. This file proves that against `runReport` directly — `e2e/giving-investigation-
 * export.spec.ts` proves the same agreement through the real components and
 * `tests/integration/export-parity.test.ts` proves the CSV, and neither substitutes for the other
 * (AAP 0.12.2). Nothing here re-derives a figure: the only arithmetic is an independent fold of the
 * rows a surface already holds, through `addMinor`, which is the cross-check the rule permits and no
 * second aggregation path.
 *
 * Plan items that put this file in scope: AAP 0.11.1's deliverable row `tests/domain/*.test.ts` naming
 * `report-agreement` for criterion 1; criterion 1 and 0.12.2 "The Decisive Criterion"; AAP 0.8.8
 * "Grain, Basis and Coverage Agreement" — received support on the one named effective-cash-allocation
 * basis, attributed to original gift dates, within a stated currency, period, coverage and as-of time,
 * at the grain of one authorised allocation; AAP 0.8.1's counting, partition, gap, coverage, percentage
 * and paging rules; and AAP 0.9.2's `modules/support/report.ts` as the single computation behind the
 * overview, the ledger, the matrix, the comparison, the chart, the drilldown, the CSV and the print.
 *
 * The rule underneath it is Rule 1 clause 3: the distinctions this criterion turns on — a gift at its
 * own grain versus an allocation, a commitment versus received cash, a gap versus zero, partial versus
 * complete coverage, a percentage versus no percentage, and a value this context may not see versus a
 * value of zero — are asserted here, never commented over, and no assertion is softened to make a run
 * pass. This file adds no coverage target, no reporter, no snapshot inventory and no fifth report.
 *
 * Where the modules' actual surface differs from the brief this file was written against, so that no
 * assertion is weakened to fit a name:
 *
 * - `runReport(query, projection)` takes the read-only support projection as its second argument; the
 *   query alone is not enough to compute a report, which is why every case below hands in a projection.
 * - The whole-result count is `result.total` and not `rows.total`; `result.rows` is the page window (or
 *   every authorised row when the query states no page) and never carries a count of its own.
 * - `seed()` is asynchronous and returns one row per seeded session with its documents attached. This
 *   file assembles the projection itself from the state document's `supportProjection` record and its
 *   stored gift rows, because the service's own projection builder is a `data-service` read this file
 *   may not import, and a projection built by hand from the same records is exactly what a domain test
 *   needs.
 * - The seed's split gift is 100.00 whose authorised allocation in this ministry is 40.00 (its sibling
 *   60.00 belongs to another ministry and is correctly absent from this projection). The AAP's worked
 *   example — "a view legitimately containing both counts 100 once" — is therefore asserted at the
 *   seed's own integers: the pair of rows counts the 40.00 allocation once (4000 minor units), never
 *   the whole gift (10000) and never the pair added together (14000), with `giftCount` counting the
 *   gift once rather than twice.
 * - Goal progress states a percentage in basis points, so the 120% of AAP 0.8.1 is 12000 here and is
 *   asserted against the unit the module actually computes in.
 * - `runReport` never produces a `withheld` value: a projection carries only the rows this context may
 *   read, and hiding happens before the result is built. Withholding is therefore asserted where the
 *   renderings live — `formatMinor` — plus a non-derivability check that no artifact of a result can
 *   state an amount the projection did not carry.
 */
import { describe, expect, it } from "vitest";

import { Temporal } from "temporal-polyfill";

import type {
  Coverage,
  GiftRowRecord,
  SupportGoalRecord,
} from "@/modules/data-service/envelope";
import { DEFAULT_SESSION_ID, seed, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import {
  printModel,
  type PrintCell,
  type PrintModel,
  type PrintRow,
} from "@/modules/export/print";
import { addMinor, minorUnitsOf, negateMinor, type Money } from "@/modules/money/amount";
import { UNKNOWN_CURRENCY, exponentOf } from "@/modules/money/currency";
import { formatMinor } from "@/modules/money/format";
import { SUPPORT_BASIS, type GiftRow, type SupportProjection } from "@/modules/support/basis";
import {
  PAGE_SIZE_CAP,
  PAGE_SIZE_DEFAULT,
  REPORT_IDS,
  buildReportQuery,
  runReport,
  validateReportQuery,
  type CurrencySummary,
  type ReportQuery,
  type ReportResult,
  type SeriesPoint,
} from "@/modules/support/report";

// ---------------------------------------------------------------------------------------------
// The world these cases start from
// ---------------------------------------------------------------------------------------------

/** The period every case reports over unless it states its own: the seeded fiscal year to date. */
const PERIOD_FROM = "2026-01-01";
const PERIOD_TO = "2026-11-20";

/**
 * The seeded established worker's state document, built once.
 *
 * `seed()` persists nothing and reads no clock, so holding its result changes no state another case
 * could observe; building it once keeps every case starting from the identical world.
 */
let established: Promise<SessionStateDocument> | undefined;

function establishedDocument(): Promise<SessionStateDocument> {
  established ??= loadEstablishedDocument();
  return established;
}

async function loadEstablishedDocument(): Promise<SessionStateDocument> {
  const sessions = await seed();
  const session = sessions.find((candidate) => candidate.sessionId === DEFAULT_SESSION_ID);
  if (session === undefined) {
    throw new Error(
      `The seed lays down no session "${DEFAULT_SESSION_ID}", so no financial case can start from the seeded world.`,
    );
  }
  return session.documents.state;
}

/** The four separately owned references a report runs under, read from the seeded context. */
function scopeOf(document: SessionStateDocument): ReportQuery["scope"] {
  const { context } = document;
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = context;
  if (
    selectedOrganizationId === null ||
    selectedMinistryId === null ||
    selectedSupportSubjectId === null
  ) {
    throw new Error(
      "The seeded session selects no context, so a report cannot run under an authority it never chose.",
    );
  }
  return {
    organizationId: selectedOrganizationId,
    ministryId: selectedMinistryId,
    supportSubjectId: selectedSupportSubjectId,
    principalId: context.principalId,
  };
}

/** A calendar day, built the way the domain modules build one: no time of day and no instant behind it. */
function day(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}

/**
 * Turns the stored gift records into the projection's own row shape.
 *
 * The stored form states every optional fact as `null` and every date as text; the projection states an
 * absent fact by its absence and a day as a civil date. Nothing is defaulted on the way through: a gift
 * whose date the source never established keeps no date rather than borrowing the entry date.
 */
function giftRowsOf(records: readonly GiftRowRecord[]): readonly GiftRow[] {
  return records.map((record) => ({
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(record.originalGiftOn === null
      ? {}
      : { originalGiftOn: Temporal.PlainDate.from(record.originalGiftOn) }),
    datePrecision: record.datePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn: Temporal.PlainDate.from(record.entryOn),
  }));
}

/** What a case may restate about the projection it reports from; everything else comes from the seed. */
interface ProjectionShape {
  readonly coverage?: Coverage;
  readonly gifts?: readonly GiftRow[];
  /** `null` states that the subject has no goal, which is a different fact from a goal of zero. */
  readonly goal?: SupportGoalRecord | null;
  readonly asOf?: string;
}

/**
 * The read-only projection a report is computed from.
 *
 * A commitment is not cash, so no commitment row is carried here: `runReport` reads none, this file
 * computes no commitment figure, and a commitment reaching a received-support total is the exact
 * conflation criterion 1 exists to prevent.
 */
function projectionOf(
  document: SessionStateDocument,
  shape: ProjectionShape = {},
): SupportProjection {
  const record = document.supportProjection;
  if (record === null) {
    throw new Error(
      "The seeded session states no support projection, so there is no basis or coverage to report under.",
    );
  }
  const goal = shape.goal === undefined ? record.goal : shape.goal;
  return {
    supportSubjectId: record.supportSubjectId,
    basis: record.basis,
    currencyExponents: record.currencyExponents,
    coverage: shape.coverage ?? record.coverage,
    asOf: shape.asOf ?? record.asOf,
    lastSourceUpdate: record.lastSourceUpdate,
    source: record.source,
    ...(goal === null ? {} : { goal }),
    gifts: shape.gifts ?? giftRowsOf(document.gifts),
    commitments: [],
  };
}

/** A stated amount, built from an exact integer count of minor units and never from a major-unit decimal. */
function amount(currency: string, minorUnits: number): Money {
  return { currency, minorUnits: minorUnitsOf(minorUnits) };
}

/** One report request for the seeded session, with only the facts a case restates. */
function queryOf(document: SessionStateDocument, overrides: Partial<ReportQuery> = {}): ReportQuery {
  return {
    reportId: "received-period-and-year-to-date",
    scope: scopeOf(document),
    period: { kind: "explicit", from: day(PERIOD_FROM), to: day(PERIOD_TO) },
    currency: { kind: "all" },
    ...overrides,
  };
}

/**
 * Runs one report through the refusing constructor every caller uses, so a query this application
 * would refuse fails here as a clear message instead of computing a figure nobody could check.
 */
function run(query: ReportQuery, projection: SupportProjection): ReportResult {
  const built = buildReportQuery(query);
  if (!built.ok) {
    throw new Error(
      `The report query was refused: ${built.problems
        .map((problem) => `${problem.field}: ${problem.message}`)
        .join(" ")}`,
    );
  }
  return runReport(built.query, projection);
}

// ---------------------------------------------------------------------------------------------
// Independent re-summing, and the lookups that keep it honest
// ---------------------------------------------------------------------------------------------

/** Reads a value the fixture guarantees, so a missing one fails with a sentence rather than a `NaN`. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`${what} is missing, so the fixture this case needs is no longer seeded.`);
  }
  return value;
}

/** Folds amounts of one currency through `addMinor`: the only arithmetic this file performs. */
function sumOf(amounts: readonly Money[], currency: string): Money {
  let total = amount(currency, 0);
  for (const entry of amounts) {
    total = addMinor(total, entry);
  }
  return total;
}

/** The exact total of one currency's amounts, as an integer count of minor units. */
function minorTotalOf(amounts: readonly Money[], currency: string): number {
  return sumOf(amounts, currency).minorUnits;
}

/** One currency's entry in a result's partition, or a sentence saying the partition lost it. */
function summaryFor(result: ReportResult, currency: string): CurrencySummary {
  const entry = result.summary.find((candidate) => candidate.currency === currency);
  if (entry === undefined) {
    throw new Error(
      `The result states no ${currency} entry, so the partition dropped a currency its rows are in.`,
    );
  }
  return entry;
}

/** The row amounts a result holds in one currency. */
function rowAmountsOf(result: ReportResult, currency: string): readonly Money[] {
  return result.rows
    .filter((row) => row.amount.currency === currency)
    .map((row) => row.amount);
}

/** One currency's series points, in month order. */
function seriesPointsOf(result: ReportResult, currency: string): readonly SeriesPoint[] {
  return result.series.filter((point) => point.currency === currency);
}

/**
 * The amounts a series records for one currency, with every gap left out.
 *
 * A gap states that the source recorded nothing in that month, which is not a recorded zero, so it
 * contributes no amount to a fold and is asserted separately.
 */
function seriesAmountsOf(result: ReportResult, currency: string): readonly Money[] {
  return seriesPointsOf(result, currency).flatMap((point) =>
    point.gap || point.value.minorUnits === null ? [] : [amount(currency, point.value.minorUnits)],
  );
}

/** Every amount a print model printed, read back from the cells the model itself states. */
function printedAmountsOf(model: PrintModel): readonly Money[] {
  const currencyColumn = printedColumnIndex(model, "currency");
  const minorUnitsColumn = printedColumnIndex(model, "amount_minor_units");
  return model.rows.map((row) => {
    const currencyCell = printedCell(row, currencyColumn, "currency");
    const amountCell = printedCell(row, minorUnitsColumn, "amount_minor_units");
    // A row's own amount is an exact recorded fact, so its state carries a number; a state that does
    // not is refused here rather than read as one, which is what stops this file from inventing a zero.
    if (amountCell.state !== "value" && amountCell.state !== "zero") {
      throw new Error(
        `A printed row states its amount as "${amountCell.state}", so no minor-unit count may be read from it.`,
      );
    }
    const minorUnits = Number.parseInt(amountCell.text, 10);
    if (!Number.isSafeInteger(minorUnits)) {
      throw new Error(
        `The printed minor-unit cell "${amountCell.text}" is not a whole count of minor units.`,
      );
    }
    return amount(currencyCell.text, minorUnits);
  });
}

/** The index of one printed column, found by the header the model states rather than by arithmetic. */
function printedColumnIndex(model: PrintModel, header: string): number {
  const index = model.columns.findIndex((column) => column.header === header);
  if (index < 0) {
    throw new Error(
      `The print model states no "${header}" column, so its rows cannot be read against the result.`,
    );
  }
  return index;
}

/** One cell of one printed row, refused rather than read when the row is shorter than its own columns. */
function printedCell(row: PrintRow, index: number, header: string): PrintCell {
  return need(row[index], `The "${header}" cell of a printed row`);
}

/** One printed summary line, found by the currency it names beside the measure it states. */
function printedSummaryLineOf(model: PrintModel, currency: string) {
  const line = model.summary.find((candidate) => candidate.label.endsWith(`(${currency})`));
  if (line === undefined) {
    throw new Error(`The print model states no summary line for ${currency}.`);
  }
  return line;
}

/** The value of one snapshot fact the print model states, matched by its machine field name. */
function printedFact(model: PrintModel, field: string): string {
  const fact = model.facts.find((candidate) => candidate.field === field);
  if (fact === undefined) {
    throw new Error(`The print model states no "${field}" snapshot fact.`);
  }
  return fact.value;
}

/**
 * Every exact amount recorded anywhere in a result, by walking its object graph.
 *
 * Used to prove a figure the projection did not carry cannot be recovered from any artifact, directly
 * or by subtraction: a value that is not one of the collected amounts is stated nowhere.
 */
function collectMinorUnits(value: unknown, found: number[] = []): readonly number[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMinorUnits(item, found);
    }
    return found;
  }
  if (value === null || typeof value !== "object") {
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "minorUnits" && typeof child === "number") {
      found.push(child);
    } else {
      collectMinorUnits(child, found);
    }
  }
  return found;
}

/**
 * Every currency any amount in a result is stated in.
 *
 * Used to prove the partition is closed: no field of a result holds an amount in a code the partition
 * does not state, so there is no aggregate currency standing in for a combined total.
 */
function collectCurrencies(value: unknown, found: string[] = []): readonly string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCurrencies(item, found);
    }
    return found;
  }
  if (value === null || typeof value !== "object") {
    return found;
  }
  const entries = Object.entries(value);
  const currency = value as { readonly currency?: unknown; readonly minorUnits?: unknown };
  if (typeof currency.currency === "string" && typeof currency.minorUnits === "number") {
    found.push(currency.currency);
  }
  for (const [, child] of entries) {
    collectCurrencies(child, found);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// A larger authorised row set, for the paging rule the seed's short ledger cannot state
// ---------------------------------------------------------------------------------------------

/** The rows the paging cases report over: enough of them that one page is not the whole result. */
const BULK_ROW_COUNT = 120;

/** What each bulk row is worth: 100.00 USD in minor units. */
const BULK_ROW_MINOR_UNITS = 10000;

/** The first day a bulk row falls on, so the row set spans four months of the reported period. */
const BULK_FIRST_DAY = "2026-01-01";

/**
 * A deterministic set of authorised USD rows: one per day from the first, each with its own gift.
 *
 * This is a page-rule fixture and not a workload: the published 10,000-partner workload belongs to the
 * browser spec and the performance measurement, and making a domain test pay for it would make a
 * failure here unattributable.
 */
function bulkGiftRows(): readonly GiftRow[] {
  const origin = day(BULK_FIRST_DAY);
  return Array.from({ length: BULK_ROW_COUNT }, (_unused, index) => {
    const giftId = `gift-bulk-${String(index).padStart(4, "0")}`;
    const giftedOn = origin.add({ days: index });
    return {
      giftRowId: `${giftId}-row`,
      giftId,
      amount: amount("USD", BULK_ROW_MINOR_UNITS),
      originalGiftOn: giftedOn,
      datePrecision: "date",
      attribution: { kind: "partner", partnerId: `partner-bulk-${String(index % 7)}` },
      provenance: { system: "finance", reference: giftId },
      entryOn: giftedOn,
    } satisfies GiftRow;
  });
}

/** The total the bulk row set is worth, folded through `addMinor` like every other sum in this file. */
const BULK_TOTAL_MINOR_UNITS = minorTotalOf(
  bulkGiftRows().map((row) => row.amount),
  "USD",
);

/**
 * The projection the paging cases report over: the bulk rows under complete coverage, so a stored
 * figure is either a recorded value or a genuine zero and the page arithmetic is the only variable.
 */
function bulkProjectionOf(document: SessionStateDocument): SupportProjection {
  return projectionOf(document, {
    coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" },
    gifts: bulkGiftRows(),
  });
}

// ---------------------------------------------------------------------------------------------
// Phase A — one snapshot, one query, and every surface reads it
// ---------------------------------------------------------------------------------------------

describe("one query, one snapshot, and every surface reads it", () => {
  it("states the period, scope, basis, partition, coverage and as-of instant it was computed under", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const query = queryOf(document);
    const result = run(query, projection);

    expect(result.snapshot.query).toEqual(query);
    expect(result.snapshot.scope).toEqual(query.scope);
    expect(result.snapshot.basis).toBe(SUPPORT_BASIS);
    // The identity states the period the query named, not a period open to interpretation: an explicit
    // range survives unchanged, and a preset is resolved against the projection's own as-of instant.
    expect(result.snapshot.period.from.toString()).toBe(PERIOD_FROM);
    expect(result.snapshot.period.to.toString()).toBe(PERIOD_TO);
    expect(result.snapshot.period.state).toBe("in-progress");
    expect(result.snapshot.coverage).toEqual(projection.coverage);
    expect(result.snapshot.asOf).toBe(projection.asOf);
    expect(result.snapshot.lastSourceUpdate).toBe(projection.lastSourceUpdate);
    expect(result.snapshot.source).toEqual(projection.source);
    // The instant the read ran, when the source last changed and how far back it covers are three
    // different facts, so a surface can never present one as another.
    expect(
      new Set([
        result.snapshot.asOf,
        result.snapshot.lastSourceUpdate,
        result.snapshot.coverage.to,
      ]).size,
    ).toBe(3);
    // The partition the figures are stated in is the partition the summary answers in, currency for
    // currency and in the same order, so no surface can list a currency the summary never states.
    expect(result.snapshot.currencies).toEqual(result.summary.map((entry) => entry.currency));
    expect([...result.snapshot.currencies]).toEqual([...result.snapshot.currencies].sort());
  });

  it("prints the same snapshot the result states, so the two surfaces are comparable", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const model = printModel(result);

    expect(printedFact(model, "snapshot_as_of")).toBe(result.snapshot.asOf);
    expect(printedFact(model, "coverage_state")).toBe(result.snapshot.coverage.state);
    expect(printedFact(model, "coverage_from")).toBe(result.snapshot.coverage.from);
    expect(printedFact(model, "coverage_to")).toBe(result.snapshot.coverage.to);
    expect(printedFact(model, "period_from")).toBe(PERIOD_FROM);
    expect(printedFact(model, "period_to")).toBe(PERIOD_TO);
    expect(printedFact(model, "period_state")).toBe(result.snapshot.period.state);
    expect(printedFact(model, "row_total")).toBe(String(result.total));
    expect(printedFact(model, "basis").startsWith(`${SUPPORT_BASIS}:`)).toBe(true);
    expect(model.rowTotal).toBe(result.total);
    expect(model.inProgress).toBe(true);
    expect(model.statusLabel).toBe("In progress");
    // An unpaged read is the whole query, so the page says so instead of claiming one page is the answer.
    expect(model.completeness).toBe("whole-query");
    // One result, one page: the model is a pure function of the result it was handed.
    expect(printModel(result)).toEqual(model);
  });

  it("resolves a named period against the projection's as-of instant rather than a clock", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const query = queryOf(document, { period: { kind: "preset", preset: "this-month" } });

    const thisMonth = run(query, projection);
    expect(thisMonth.snapshot.period.from.toString()).toBe("2026-11-01");
    expect(thisMonth.snapshot.period.to.toString()).toBe("2026-11-30");
    expect(thisMonth.snapshot.period.state).toBe("in-progress");
    // The same query against the same projection resolves to the same period, because nothing here
    // reads the machine clock.
    expect(run(query, projection).snapshot.period).toEqual(thisMonth.snapshot.period);
  });

  it("closes the period when the projection's instant moves past it, leaving the amounts untouched", async () => {
    const document = await establishedDocument();
    const asSeeded = run(queryOf(document), projectionOf(document));
    const later = run(
      queryOf(document),
      projectionOf(document, { asOf: "2026-12-01T00:00:00Z" }),
    );

    expect(asSeeded.snapshot.period.state).toBe("in-progress");
    expect(later.snapshot.period.state).toBe("complete");
    expect(later.snapshot.asOf).not.toBe(asSeeded.snapshot.asOf);
    // The period's state is derived from the instant, so only the state may move: a figure that moved
    // with it would be a different figure wearing the same numbers.
    expect(later.summary).toEqual(asSeeded.summary);
    expect(later.total).toBe(asSeeded.total);
    expect(printModel(asSeeded).statusLabel).toBe("In progress");
    expect(printModel(later).statusLabel).toBeNull();
  });

  it("computes only the four fixed reports and refuses a fifth", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);

    // Four fixed reports and no report designer, no scheduled report and no report builder: the closed
    // set is what "one report function" means, and a fifth identity is refused rather than substituted.
    expect(REPORT_IDS).toHaveLength(4);
    expect(new Set(REPORT_IDS).size).toBe(4);
    for (const reportId of REPORT_IDS) {
      const requested = queryOf(document, { reportId });
      const built = buildReportQuery(requested);
      if (!built.ok) {
        throw new Error(`One of the four fixed reports was refused by the query gate: ${reportId}.`);
      }
      const result = run(requested, projection);
      // Each identity computes, and the snapshot states the query the gate built rather than another.
      expect(result.snapshot.query).toEqual(built.query);
      expect(result.snapshot.query.reportId).toBe(reportId);
    }

    // A report identity outside the set arrives from a decoded request as plain data, so it is stubbed
    // as exactly that: the gate refuses it, and the engine refuses it again for a hand-built query.
    const invented = { ...queryOf(document), reportId: "report-designer" } as unknown as ReportQuery;
    const refused = buildReportQuery(invented);
    if (refused.ok) {
      throw new Error("A report identity outside the four fixed reports was accepted.");
    }
    expect(refused.problems.map((problem) => problem.field)).toContain("reportId");
    expect(validateReportQuery(invented).map((problem) => problem.field)).toContain("reportId");
    expect(() => runReport(invented, projection)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase B — count and sum agreement across surfaces
// ---------------------------------------------------------------------------------------------

describe("count and sum agreement across every surface", () => {
  it("re-sums the table rows, the chart series and the printed rows to the same per-currency totals", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const model = printModel(result);

    expect(result.page).toBeUndefined();
    expect(result.rows).toHaveLength(result.total);
    expect(model.rows).toHaveLength(result.rows.length);
    const printedAmounts = printedAmountsOf(model);

    // A currency with no exponent cannot be summed, so its entry states no amount at all rather than a
    // total this application would have had to assume a precision for.
    expect(
      result.summary
        .filter((entry) => entry.exponent === undefined)
        .map((entry) => entry.received.minorUnits),
    ).toEqual([null]);

    for (const entry of result.summary) {
      if (entry.exponent === undefined) {
        continue;
      }
      expect(entry.exponent).toBe(exponentOf(entry.currency));
      const tableTotal = minorTotalOf(rowAmountsOf(result, entry.currency), entry.currency);
      const seriesTotal = minorTotalOf(seriesAmountsOf(result, entry.currency), entry.currency);
      const printedTotal = minorTotalOf(
        printedAmounts.filter((printed) => printed.currency === entry.currency),
        entry.currency,
      );

      expect(entry.received.minorUnits).toBe(tableTotal);
      expect(seriesTotal).toBe(tableTotal);
      expect(printedTotal).toBe(tableTotal);
    }

    // The printed summary is the result's own summary, rendered by the one money formatter: same
    // currencies, same amounts, same states, and no combined line across them.
    expect(model.summary).toHaveLength(result.summary.length);
    for (const entry of result.summary) {
      const line = printedSummaryLineOf(model, entry.currency);
      const rendered = formatMinor(
        amount(entry.currency, entry.received.minorUnits ?? 0),
        entry.received.valueState,
        "en",
      );
      expect(line.state).toBe(entry.received.valueState);
      expect(line.text).toBe(rendered.text);
      expect(line.accessibleLabel).toBe(rendered.accessibleLabel);
    }
  });

  it("counts the whole result in `total` and never the loaded page", async () => {
    const document = await establishedDocument();
    const projection = bulkProjectionOf(document);
    expect(PAGE_SIZE_DEFAULT).toBe(50);
    expect(PAGE_SIZE_CAP).toBe(200);

    const unpaged = run(queryOf(document), projection);
    expect(unpaged.page).toBeUndefined();
    expect(unpaged.total).toBe(BULK_ROW_COUNT);
    expect(unpaged.rows).toHaveLength(BULK_ROW_COUNT);
    expect(minorTotalOf(rowAmountsOf(unpaged, "USD"), "USD")).toBe(BULK_TOTAL_MINOR_UNITS);

    const firstPage = run(queryOf(document, { page: { index: 0 } }), projection);
    expect(firstPage.page).toEqual({
      index: 0,
      size: PAGE_SIZE_DEFAULT,
      totalPages: 3,
    });
    expect(firstPage.rows).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(firstPage.total).toBe(BULK_ROW_COUNT);
    // A page that reported its own row count as the total would fail here, and so would a total that
    // happened to be the page: the two answers are different numbers on purpose.
    expect(firstPage.rows.length).not.toBe(firstPage.total);
    // One page is the first fifty rows of the fixture and nothing else, folded through `addMinor`.
    expect(minorTotalOf(rowAmountsOf(firstPage, "USD"), "USD")).toBe(
      minorTotalOf(
        bulkGiftRows()
          .slice(0, PAGE_SIZE_DEFAULT)
          .map((row) => row.amount),
        "USD",
      ),
    );
    // The summary is the whole query even on a page, which is why a page's rows never add up to it.
    expect(summaryFor(firstPage, "USD").received.minorUnits).toBe(BULK_TOTAL_MINOR_UNITS);

    const lastPage = run(queryOf(document, { page: { index: 2 } }), projection);
    expect(lastPage.rows).toHaveLength(BULK_ROW_COUNT - 2 * PAGE_SIZE_DEFAULT);

    const oversized = run(queryOf(document, { page: { index: 0, size: 500 } }), projection);
    expect(oversized.page?.size).toBe(PAGE_SIZE_CAP);
  });

  it("keeps every whole-query value unchanged when the sort or the page changes", async () => {
    const document = await establishedDocument();
    const projection = bulkProjectionOf(document);
    const baseline = run(queryOf(document), projection);
    const windows = [
      run(
        queryOf(document, {
          sort: { field: "amountMinor", direction: "asc" },
          page: { index: 1 },
        }),
        projection,
      ),
      run(
        queryOf(document, {
          sort: { field: "originalGiftOn", direction: "asc" },
          page: { index: 2 },
        }),
        projection,
      ),
    ];

    for (const window of windows) {
      // The summary, the chart's series and the whole-result count are whole-query values: a sort or a
      // page that moved one of them would mean the figure was computed from the visible window.
      expect(window.summary).toEqual(baseline.summary);
      expect(window.total).toBe(baseline.total);
      expect(minorTotalOf(seriesAmountsOf(window, "USD"), "USD")).toBe(BULK_TOTAL_MINOR_UNITS);
      expect(window.rows.length).toBeLessThan(window.total);
    }
    const [byAmount, byDate] = windows;
    expect(need(byAmount, "the amount-sorted window").rows).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(need(byDate, "the date-sorted window").rows).toHaveLength(
      BULK_ROW_COUNT - 2 * PAGE_SIZE_DEFAULT,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Phase C — a gift counts once at its own grain
// ---------------------------------------------------------------------------------------------

describe("a gift counts once at its own grain", () => {
  it("states the authorised allocation of a split gift whether one grain level or both are read", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const wholeGift = run(queryOf(document, { search: "gift-harbour-0002" }), projection);

    // The read carries the parent gift row and this ministry's allocation of it. The authorised
    // allocation is what the basis states, so the pair yields 4000 minor units — never the whole gift
    // at gift grain and never the two rows added together.
    expect(wholeGift.rows).toHaveLength(1);
    expect(need(wholeGift.rows[0], "the split gift's single authorised row").allocationId).toBe(
      "alloc-harbour-0002-youth",
    );
    expect(summaryFor(wholeGift, "USD").received.minorUnits).toBe(4000);
    expect(summaryFor(wholeGift, "USD").received.minorUnits).not.toBe(10000);
    expect(summaryFor(wholeGift, "USD").received.minorUnits).not.toBe(14000);
    // The gift is counted once, not once per row.
    expect(summaryFor(wholeGift, "USD").giftCount.count).toBe(1);
    expect(summaryFor(wholeGift, "USD").allocationCount.count).toBe(1);

    // At allocation grain the same figure, so the authorised amount is the figure and not an artefact
    // of the parent having been filtered out.
    const allocationOnly = run(
      queryOf(document, { search: "alloc-harbour-0002-youth" }),
      projection,
    );
    expect(allocationOnly.rows).toHaveLength(1);
    expect(summaryFor(allocationOnly, "USD").received.minorUnits).toBe(4000);

    // At gift grain the whole gift is stated, which is what makes the de-duplication above visible
    // rather than incidental: the parent row is a real row with its own amount.
    const giftGrainOnly = run(queryOf(document, { search: "gift-row-harbour-0002" }), projection);
    expect(giftGrainOnly.rows).toHaveLength(1);
    expect(summaryFor(giftGrainOnly, "USD").received.minorUnits).toBe(10000);
    expect(summaryFor(giftGrainOnly, "USD").allocationCount.count).toBe(0);

    // In the whole-query read the parent row is the one that goes, so the gift contributes once.
    const whole = run(queryOf(document), projection);
    expect(whole.rows.some((row) => row.giftRowId === "gift-row-harbour-0002")).toBe(false);
    const splitGiftAmounts = whole.rows
      .filter((row) => row.giftId === "gift-harbour-0002")
      .map((row) => row.amount);
    expect(splitGiftAmounts).toHaveLength(1);
    expect(minorTotalOf(splitGiftAmounts, "USD")).toBe(4000);
    // The whole query's USD total is the exact sum of the authorised allocations that remain, so
    // counting the split gift a second time would show up here as 28500 rather than 24500.
    expect(minorTotalOf(rowAmountsOf(whole, "USD"), "USD")).toBe(24500);
  });

  it("keeps the gift, allocation and donor counts at their own grains and never adds them together", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));

    for (const entry of result.summary) {
      const rowsInCurrency = result.rows.filter((row) => row.amount.currency === entry.currency);
      const giftIds = new Set(rowsInCurrency.map((row) => row.giftId));
      const allocationRows = rowsInCurrency.filter((row) => row.allocationId !== undefined);
      const donorIds = new Set(
        rowsInCurrency.flatMap((row) =>
          row.attribution.kind === "partner" ? [row.attribution.partnerId] : [],
        ),
      );

      // Three counts of the same money at three grains: distinct gifts, allocation rows, and distinct
      // partner references. Anonymous support raises the received amount without raising the third.
      expect(entry.giftCount.count).toBe(giftIds.size);
      expect(entry.allocationCount.count).toBe(allocationRows.length);
      expect(entry.donorCount.count).toBe(donorIds.size);
      expect(Object.keys(entry)).toEqual([
        "currency",
        "exponent",
        "received",
        "giftCount",
        "allocationCount",
        "donorCount",
      ]);
    }

    // The row count is the row count: it is not the sum of the three counts, and no field states one.
    const summedCounts = result.summary.reduce(
      (total, entry) =>
        total + entry.giftCount.count + entry.allocationCount.count + entry.donorCount.count,
      0,
    );
    expect(result.total).toBe(result.rows.length);
    expect(result.total).not.toBe(summedCounts);
    expect(Object.keys(result.valueStates).filter((path) => path.includes("total"))).toEqual([]);
  });

  it("explains a refunded gift instead of hiding it, and nets the period to the correction", async () => {
    const document = await establishedDocument();
    const result = run(
      queryOf(document, { partner: { kind: "partner", partnerId: "partner-church-st-aidan" } }),
      projectionOf(document),
    );

    // A correction is its own row carrying the source's signed amount and naming the row it corrects,
    // so a period that already reported the gift keeps the explanation rather than losing it.
    expect(result.rows).toHaveLength(2);
    const original = need(
      result.rows.find((row) => row.giftRowId === "gift-row-harbour-0009"),
      "the refunded gift's original row",
    );
    const correction = need(
      result.rows.find((row) => row.refundOf === original.giftRowId),
      "the row that corrects the refunded gift",
    );
    expect(correction.refundOf).toBe(original.giftRowId);
    expect(correction.amount.currency).toBe(original.amount.currency);
    expect(correction.amount.minorUnits).toBe(negateMinor(original.amount).minorUnits);
    expect(original.amount.minorUnits).toBe(7500);

    // The net follows the correction: 7500 given and 7500 refunded is a genuine zero, and the coverage
    // state still says the period is partial, because coverage outranks the zero rendering.
    expect(summaryFor(result, "USD").received.minorUnits).toBe(0);
    expect(minorTotalOf(rowAmountsOf(result, "USD"), "USD")).toBe(0);
    expect(summaryFor(result, "USD").received.valueState).toBe("incomplete-subtotal");

    // Both rows reach the printed table, so the explanation travels with the figure into print.
    const printed = printedAmountsOf(printModel(result)).map((entry) => entry.minorUnits);
    expect(printed).toContain(7500);
    expect(printed).toContain(-7500);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase D — currencies stay partitioned
// ---------------------------------------------------------------------------------------------

describe("currencies stay partitioned", () => {
  it("states one entry per currency and no combined figure anywhere", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));

    expect(result.summary.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
      "KWD",
      UNKNOWN_CURRENCY,
      "USD",
    ]);
    expect(result.snapshot.currencies).toEqual(result.summary.map((entry) => entry.currency));

    // There is no exchange rate in this application, so no amount anywhere in the result is stated in a
    // currency the partition does not name: an aggregate code would be a combined total in disguise.
    const stated = collectCurrencies(result);
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.filter((code) => !result.snapshot.currencies.includes(code))).toEqual([]);

    // The download and the printed page never name one currency beside figures stated in several. With
    // an unknown-currency amount in the partition the answer is that the partition is not fully
    // identified, rather than a code that would present it as complete.
    expect(result.snapshot.currencies.length).toBeGreaterThan(1);
    expect(printedFact(printModel(result), "currency")).toBe(UNKNOWN_CURRENCY);
    const usdOnly = run(
      queryOf(document, { currency: { kind: "one", currency: "USD" } }),
      projectionOf(document),
    );
    expect(usdOnly.summary.map((entry) => entry.currency)).toEqual(["USD"]);
    expect(printedFact(printModel(usdOnly), "currency")).toBe("USD");
  });

  it("respects each currency's exponent and never assumes two decimals", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));

    expect(exponentOf("USD")).toBe(2);
    expect(exponentOf("EUR")).toBe(2);
    expect(exponentOf("KWD")).toBe(3);
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf(UNKNOWN_CURRENCY)).toBeUndefined();

    expect(summaryFor(result, "KWD").exponent).toBe(3);
    expect(summaryFor(result, "JPY").exponent).toBe(0);
    expect(summaryFor(result, "USD").exponent).toBe(2);
    // 1,250 minor units is 1.250 KWD and 5,000 minor units is 5,000 JPY: the same integers, three
    // decimals and none, because the exponent is looked up per code.
    expect(formatMinor(amount("KWD", 1250), "value", "en").plain).toBe("1.250 KWD");
    expect(formatMinor(amount("JPY", 5000), "value", "en").plain).toBe("5000 JPY");
    expect(formatMinor(amount("USD", 4000), "value", "en").plain).toBe("40.00 USD");
    expect(summaryFor(result, "KWD").received.minorUnits).toBe(1250);
    expect(summaryFor(result, "JPY").received.minorUnits).toBe(5000);
  });

  it("keeps an unknown-currency amount as an unknown fact rather than defaulting or dropping it", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const unknown = summaryFor(result, UNKNOWN_CURRENCY);

    expect(unknown.exponent).toBeUndefined();
    expect(unknown.received).toEqual({ minorUnits: null, valueState: "unknown" });
    expect(result.valueStates[`summary.${UNKNOWN_CURRENCY}.received`]).toBe("unknown");
    // Present, counted, and never summed: dropping it would understate the result's coverage of the
    // source, and giving it an exponent would state a total nobody can check.
    expect(unknown.giftCount.count).toBe(1);
    expect(result.rows.some((row) => row.amount.currency === UNKNOWN_CURRENCY)).toBe(true);
    expect(result.total).toBe(10);
    expect(seriesPointsOf(result, UNKNOWN_CURRENCY)).toEqual([]);
    // The rendering states the code and the unknown currency rather than a two-decimal amount.
    const rendered = formatMinor(amount(UNKNOWN_CURRENCY, 7500), "value", "en");
    expect(rendered.plain).toContain(UNKNOWN_CURRENCY);
    expect(rendered.plain).toContain("minor units");
    expect(rendered.plain).not.toContain(".");
  });

  it("refuses an amount range across currencies and applies it only inside one", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const acrossCurrencies = queryOf(document, {
      amountRange: { minMinor: minorUnitsOf(5000), maxMinor: minorUnitsOf(5000) },
    });

    // A range compares minor units, and two currencies' minor units have no ordering, so the query is
    // refused by the constructor rather than answered with a figure that compares KWD with JPY.
    const refused = buildReportQuery(acrossCurrencies);
    if (refused.ok) {
      throw new Error("A range was accepted beside every currency, which would compare amounts that have no ordering.");
    }
    expect(refused.problems.map((problem) => problem.field)).toContain("amountRange");
    expect(validateReportQuery(acrossCurrencies).map((problem) => problem.field)).toContain(
      "amountRange",
    );
    // A hand-built query cannot reach a figure either: the engine re-checks the gate inside itself.
    expect(() => runReport(acrossCurrencies, projection)).toThrow(TypeError);

    const whole = run(queryOf(document), projection);
    expect(
      whole.rows.some(
        (row) => row.amount.currency === "JPY" && row.amount.minorUnits === 5000,
      ),
    ).toBe(true);

    const usdOnly = run(
      queryOf(document, {
        currency: { kind: "one", currency: "USD" },
        amountRange: { minMinor: minorUnitsOf(5000), maxMinor: minorUnitsOf(5000) },
      }),
      projection,
    );
    expect(usdOnly.summary.map((entry) => entry.currency)).toEqual(["USD"]);
    expect(usdOnly.rows.length).toBeGreaterThan(0);
    for (const row of usdOnly.rows) {
      expect(row.amount.currency).toBe("USD");
      expect(row.amount.minorUnits).toBe(5000);
    }
    // The 5,000-minor-unit JPY row is the same integer in another currency, and it is not matched.
    expect(usdOnly.rows.some((row) => row.provenance.reference === "gift-harbour-0005")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Phase E — gaps, coverage and percentages
// ---------------------------------------------------------------------------------------------

describe("gaps, coverage and percentages", () => {
  it("states a month the source recorded nothing in as a gap rather than a zero", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const usd = seriesPointsOf(result, "USD");

    // One point per known currency per month of the period and nothing else: no point is invented for
    // a month the period does not touch, and no month of the period is missing from the grid.
    expect(result.series).toHaveLength(4 * 11);
    expect(usd).toHaveLength(11);
    expect(usd.map((point) => point.bucketStart.toString())).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
    // The last bucket is clipped to the period, so a part-month states the days it actually covers.
    expect(need(usd.at(-1), "the final USD point").bucketEnd.toString()).toBe(PERIOD_TO);

    const january = need(usd[0], "the January USD point");
    expect(january.gap).toBe(true);
    // A gap is not a dip to zero: it carries no amount at all, because a zero would claim the source
    // recorded nothing rather than that nothing was recorded in it.
    expect(january.value.minorUnits).not.toBe(0);
    expect(january.value.minorUnits).toBeNull();
    expect(january.value.valueState).toBe("unknown");
    expect(january.bucketEnd.toString()).toBe("2026-01-31");

    // Exactly the six months that recorded a gift are stated; a synthesised point would make it seven.
    expect(usd.filter((point) => !point.gap)).toHaveLength(6);
    expect(usd.filter((point) => !point.gap && point.value.minorUnits === 0)).toEqual([]);
    for (const point of result.series) {
      expect(point.bucketStart.toString() >= PERIOD_FROM).toBe(true);
      expect(point.bucketEnd.toString() <= PERIOD_TO).toBe(true);
    }

    // The printed page says the gap in words instead of drawing a zero point or a zero row.
    expect(
      printModel(result).notes.some(
        (note) => note.includes("2026-01-01") && note.includes("gap, not zero"),
      ),
    ).toBe(true);
  });

  it("derives an incomplete subtotal from partial coverage and keeps zero, unknown and partial apart", async () => {
    const document = await establishedDocument();
    const partial = run(queryOf(document), projectionOf(document));

    // Partial coverage: every subtotal keeps its real figure and is marked partial, on every artifact.
    expect(partial.snapshot.coverage.state).toBe("partial");
    expect(summaryFor(partial, "USD").received.valueState).toBe("incomplete-subtotal");
    expect(partial.valueStates["summary.USD.received"]).toBe("incomplete-subtotal");
    for (const point of seriesPointsOf(partial, "USD")) {
      if (point.gap) {
        continue;
      }
      expect(point.value.valueState).toBe("incomplete-subtotal");
      expect(partial.valueStates[`series.USD.${point.bucketStart.toString()}`]).toBe(
        "incomplete-subtotal",
      );
    }
    // A row's own amount is an exact recorded fact: the coverage-derived state belongs to the subtotal
    // built from rows, which is where a partial period has to announce itself.
    for (const [index, row] of partial.rows.entries()) {
      const state = partial.valueStates[`rows.${index}.amount`];
      expect(["value", "zero"]).toContain(state);
      expect(row.amount.minorUnits === 0 ? "zero" : "value").toBe(state);
    }
    const partialModel = printModel(partial);
    expect(printedFact(partialModel, "coverage_state")).toBe("partial");
    expect(partialModel.notes.some((note) => note.includes("Coverage is partial"))).toBe(true);
    // The period state and the coverage state are two different facts about the same read.
    expect(partialModel.inProgress).toBe(true);
    expect(partialModel.statusLabel).toBe("In progress");

    // The same rows under complete coverage are the same figures with the derived state gone, which is
    // what makes the state derived from coverage rather than chosen by whoever built the fixture.
    const complete = run(
      queryOf(document),
      projectionOf(document, {
        coverage: { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" },
      }),
    );
    expect(summaryFor(complete, "USD").received.minorUnits).toBe(
      summaryFor(partial, "USD").received.minorUnits,
    );
    expect(summaryFor(complete, "USD").received.valueState).toBe("value");
    expect(printModel(complete).notes.some((note) => note.includes("Coverage is partial"))).toBe(
      false,
    );

    // A genuine zero for a currency the partition names and no row matched, under coverage that covers
    // the period: the entry states zero rather than a gap, and its months are still gaps.
    const zeroQuery = run(
      queryOf(document, {
        period: { kind: "explicit", from: day(BULK_FIRST_DAY), to: day("2026-04-30") },
        currency: { kind: "one", currency: "EUR" },
      }),
      bulkProjectionOf(document),
    );
    const zeroEntry = summaryFor(zeroQuery, "EUR");
    expect(zeroEntry.received).toEqual({ minorUnits: 0, valueState: "zero" });
    expect(zeroEntry.giftCount).toEqual({ count: 0, valueState: "zero" });
    expect(zeroQuery.total).toBe(0);
    expect(seriesPointsOf(zeroQuery, "EUR").every((point) => point.gap)).toBe(true);

    // Coverage the source never stated states no amount at all rather than a total of a period whose
    // extent is unknown, and the page says so.
    const unknownCoverage = run(
      queryOf(document),
      projectionOf(document, { coverage: { from: null, to: null, state: "unknown" } }),
    );
    expect(summaryFor(unknownCoverage, "USD").received).toEqual({
      minorUnits: null,
      valueState: "unknown",
    });
    expect(printModel(unknownCoverage).notes.some((note) => note.includes("Coverage is unknown"))).toBe(
      true,
    );
  });

  it("states no percentage for a zero denominator and keeps a valid 120% at 120%", async () => {
    const document = await establishedDocument();
    const quarter = { kind: "explicit", from: day(BULK_FIRST_DAY), to: day("2026-04-30") } as const;
    const coverage: Coverage = { from: PERIOD_FROM, to: PERIOD_TO, state: "complete" };
    const goalIn = (currency: string, minorUnits: number): SupportGoalRecord => ({
      amount: amount(currency, minorUnits),
      measure: "received-support",
      effectiveFrom: "2026-01-01",
      revision: "1",
    });
    const progressWith = (goal: SupportGoalRecord, overrides: Partial<ReportQuery> = {}) =>
      need(
        run(
          queryOf(document, { period: quarter, ...overrides }),
          projectionOf(document, { coverage, gifts: bulkGiftRows(), goal }),
        ).goal,
        "the goal progress the projection states",
      );

    // 1,200,000 received against a 1,000,000 goal is 120%, stated in the unit the module computes in.
    const reached = progressWith(goalIn("USD", 1000000));
    expect(reached.state).toBe("value");
    expect(reached.percentageBasisPoints).toBe(12000);
    // Neither clamped to a hundred percent nor restated as a ratio.
    expect(reached.percentageBasisPoints).not.toBe(10000);
    expect(reached.percentageBasisPoints).not.toBe(120);

    // A zero denominator yields no percentage at all rather than a division by nothing.
    const noDenominator = progressWith(goalIn("USD", 0));
    expect(noDenominator.state).toBe("no-percentage");
    expect(noDenominator.percentageBasisPoints).toBeNull();

    // A goal in a currency the period recorded nothing in, under coverage that is complete, is a
    // genuine zero: completeness is what tells an empty period from an uncovered one.
    const emptyCurrencyGoal = progressWith(goalIn("EUR", 1000000));
    expect(emptyCurrencyGoal.state).toBe("zero");
    expect(emptyCurrencyGoal.percentageBasisPoints).toBe(0);

    // A query restricted to a different currency cannot state the goal at all, so it is incompatible
    // rather than computed from another currency's amount.
    const otherCurrency = progressWith(goalIn("EUR", 1000000), {
      currency: { kind: "one", currency: "USD" },
    });
    expect(otherCurrency.state).toBe("incompatible");
    expect(otherCurrency.percentageBasisPoints).toBeNull();
  });

  it("states a change as a signed difference whose deltas reconcile, with no percentage to divide by", async () => {
    const document = await establishedDocument();
    const result = run(
      queryOf(document, { reportId: "period-comparison" }),
      projectionOf(document),
    );
    const comparison = need(result.comparison, "the comparison the period report states");

    expect(comparison.equalElapsed).toBe(true);
    expect(comparison.current.from.toString()).toBe(PERIOD_FROM);
    expect(comparison.current.to.toString()).toBe(PERIOD_TO);
    expect(comparison.reconciles).toBe(true);

    const usd = need(
      comparison.perCurrency.find((entry) => entry.currency === "USD"),
      "the USD entry of the comparison",
    );
    // The comparison states a signed difference and a direction. There is no percentage field at all,
    // so a zero baseline cannot produce a division by it.
    expect(Object.keys(usd)).toEqual([
      "currency",
      "currentMinor",
      "baselineMinor",
      "differenceMinor",
      "direction",
      "valueState",
    ]);
    expect(Object.keys(usd).filter((key) => key.toLowerCase().includes("percent"))).toEqual([]);
    // No USD row falls in the equal-elapsed baseline window, so the baseline is a recorded zero and the
    // difference is the whole of the current period.
    expect(usd.baselineMinor).toBe(0);
    expect(usd.differenceMinor).toBe(usd.currentMinor);
    expect(usd.direction).toBe("increase");
    expect(
      addMinor(
        amount("USD", usd.currentMinor),
        negateMinor(amount("USD", usd.baselineMinor)),
      ).minorUnits,
    ).toBe(usd.differenceMinor);

    // The contributor deltas add up to that difference exactly, so the comparison explains itself
    // rather than gaining a fabricated balancing entry.
    const usdDeltas = comparison.contributorDeltas
      .filter((delta) => delta.currency === "USD")
      .map((delta) => amount("USD", delta.minorUnits));
    expect(usdDeltas.length).toBeGreaterThan(0);
    expect(minorTotalOf(usdDeltas, "USD")).toBe(usd.differenceMinor);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase F — withholding and non-derivability
// ---------------------------------------------------------------------------------------------

describe("withholding and non-derivability", () => {
  it("states only what the projection carried, so a hidden amount is in no artifact", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document, { search: "gift-harbour-0002" }), projectionOf(document));

    // The whole gift is 10,000 minor units and the sibling allocation that belongs to another ministry
    // is 6,000; this context may read the 4,000 authorised allocation and nothing else. Every exact
    // amount stated anywhere in the result is that one figure.
    const stated = collectMinorUnits(result);
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.every((units) => units === 4000)).toBe(true);
    expect(stated).not.toContain(10000);
    expect(stated).not.toContain(6000);

    // No artifact states a remainder either: the page, the series and the printed table all carry the
    // authorised figure, so nothing can be recovered from them by subtraction.
    expect(result.total).toBe(1);
    expect(minorTotalOf(seriesAmountsOf(result, "USD"), "USD")).toBe(4000);
    expect(printedAmountsOf(printModel(result)).map((entry) => entry.minorUnits)).toEqual([4000]);
  });

  it("has no field that could state a remainder or a total including a hidden value", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const forbidden = /other|remainder|including|unreported|unadjusted|gross/iu;

    expect(Object.keys(result).filter((key) => forbidden.test(key))).toEqual([]);
    for (const entry of result.summary) {
      expect(Object.keys(entry).filter((key) => forbidden.test(key))).toEqual([]);
      expect(Object.keys(entry.received).filter((key) => forbidden.test(key))).toEqual([]);
    }
    const comparison = need(result.comparison, "the comparison");
    expect(Object.keys(comparison).filter((key) => forbidden.test(key))).toEqual([]);
    for (const entry of comparison.perCurrency) {
      expect(Object.keys(entry).filter((key) => forbidden.test(key))).toEqual([]);
    }

    // The columns a page and a download carry are the row's own fields and nothing beside them, so a
    // hidden amount has no cell to hide in.
    const headers = printModel(result).columns.map((column) => column.header);
    expect(headers).toContain("amount_minor_units");
    expect(headers.filter((header) => forbidden.test(header))).toEqual([]);
  });

  it("renders a withheld value with no digits, so no export or print can turn it into a zero", () => {
    // `runReport` never produces a withheld value — a projection holds only the rows this context may
    // read, and hiding happens before the result is built — so the rendering is asserted where it
    // lives: the one money formatter every surface, download and page reads.
    const withheld = formatMinor(amount("USD", 5000), "withheld", "en");
    expect(withheld.text).toBe("Withheld");
    expect(withheld.plain).toBe("Withheld");
    expect(/\d/u.test(withheld.plain)).toBe(false);
    expect(withheld.accessibleLabel.toLowerCase()).toContain("withheld");
    expect(withheld.accessibleLabel.toLowerCase()).toContain("subtraction");

    // The three states that carry no number carry no digits; the three that carry a number do. That is
    // what stops a withheld value reaching a CSV cell or a printed row as `0`.
    for (const state of ["unknown", "withheld", "unavailable"] as const) {
      const rendered = formatMinor(amount("USD", 5000), state, "en");
      expect(rendered.plain.length).toBeGreaterThan(0);
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(/\d/u.test(rendered.plain)).toBe(false);
      expect(/\d/u.test(rendered.text)).toBe(false);
    }
    for (const state of ["value", "zero", "incomplete-subtotal"] as const) {
      expect(/\d/u.test(formatMinor(amount("USD", 5000), state, "en").plain)).toBe(true);
    }
    // A genuine zero and a withheld value are two different facts and never one rendering.
    expect(formatMinor(amount("USD", 0), "zero", "en").plain).not.toBe(withheld.plain);
  });

  it("adds anonymous support to the total without giving it an identity or a donor count", async () => {
    const document = await establishedDocument();
    const result = run(queryOf(document), projectionOf(document));
    const anonymous = result.rows.filter((row) => row.attribution.kind === "anonymous");

    expect(anonymous).toHaveLength(1);
    const row = need(anonymous[0], "the anonymous support row");
    // No partner identity is borrowed to make a table add up.
    expect("partnerId" in row.attribution).toBe(false);
    expect(row.amount.minorUnits).toBe(5000);
    expect(minorTotalOf(rowAmountsOf(result, "USD"), "USD")).toBe(24500);
    // Its amount is inside the received total and it raises no donor count, which is the grain rule
    // that keeps the two counts from being added together.
    expect(summaryFor(result, "USD").donorCount.count).toBe(4);
    const partnerIds = new Set(
      result.rows.flatMap((each) =>
        each.attribution.kind === "partner" ? [each.attribution.partnerId] : [],
      ),
    );
    expect(partnerIds.size).toBe(7);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase G — the partner-by-month matrix reconciles
// ---------------------------------------------------------------------------------------------

describe("the partner-by-month matrix reconciles to the same totals", () => {
  it("covers every currency and month, and gives every cell a drilldown of the same authority", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(
      queryOf(document, { reportId: "partner-month-matrix" }),
      projection,
    );
    const matrix = need(result.matrix, "the partner-by-month matrix");

    expect(matrix.currencies).toEqual(result.snapshot.currencies);
    expect(matrix.months).toHaveLength(11);
    expect(need(matrix.months[0], "the matrix's first month").start.toString()).toBe(PERIOD_FROM);
    expect(need(matrix.months.at(-1), "the matrix's last month").end.toString()).toBe(PERIOD_TO);

    const expectedCells = matrix.currencies.length * matrix.months.length;
    expect(matrix.rows.length).toBeGreaterThan(0);
    for (const row of matrix.rows) {
      expect(row.cells).toHaveLength(expectedCells);
      for (const cell of row.cells) {
        // The drilldown is the same authority and the same filters, narrowed to this cell's month and
        // attribution with no page window, so it opens the records behind the figure.
        expect(cell.drilldown.scope).toEqual(result.snapshot.scope);
        expect(cell.drilldown.partner).toEqual(row.attribution);
        expect(cell.drilldown.currency).toEqual({ kind: "one", currency: cell.currency });
        expect(cell.drilldown.page).toBeUndefined();
        if (cell.drilldown.period.kind !== "explicit") {
          throw new Error(
            "A matrix cell's drilldown states no explicit period, so it cannot name the month it sums.",
          );
        }
        expect(cell.drilldown.period.from.toString()).toBe(cell.bucketStart.toString());
        expect(cell.drilldown.period.to.toString()).toBe(cell.bucketEnd.toString());
      }
    }
  });

  it("sums every cell of a currency to the summary and every month's column to the series point", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(
      queryOf(document, { reportId: "partner-month-matrix" }),
      projection,
    );
    const matrix = need(result.matrix, "the partner-by-month matrix");

    // A cell is a sum, and a sum of a currency with no exponent is not a number, so every such cell is
    // a gap and the entry states no amount.
    const unsupported = matrix.currencies.filter(
      (currency) => exponentOf(currency) === undefined,
    );
    expect(unsupported).toEqual([UNKNOWN_CURRENCY]);
    const unsupportedCells = matrix.rows.flatMap((row) =>
      row.cells.filter((cell) => unsupported.includes(cell.currency)),
    );
    expect(unsupportedCells.length).toBeGreaterThan(0);
    expect(unsupportedCells.every((cell) => cell.gap)).toBe(true);
    expect(unsupportedCells.every((cell) => cell.value.minorUnits === null)).toBe(true);
    expect(summaryFor(result, UNKNOWN_CURRENCY).received.minorUnits).toBeNull();

    for (const currency of matrix.currencies) {
      if (exponentOf(currency) === undefined) {
        continue;
      }
      const cells = matrix.rows.flatMap((row) =>
        row.cells.filter((cell) => cell.currency === currency),
      );
      const stated = cells.flatMap((cell) =>
        cell.gap || cell.value.minorUnits === null
          ? []
          : [amount(currency, cell.value.minorUnits)],
      );
      expect(minorTotalOf(stated, currency)).toBe(summaryFor(result, currency).received.minorUnits);
    }

    for (const month of matrix.months) {
      for (const currency of matrix.currencies) {
        if (exponentOf(currency) === undefined) {
          continue;
        }
        const column = matrix.rows.flatMap((row) => {
          const cell = row.cells.find(
            (candidate) =>
              candidate.currency === currency && candidate.bucketStart.equals(month.start),
          );
          if (cell === undefined) {
            throw new Error("A matrix row states no cell for a month the matrix itself lists.");
          }
          return cell.gap || cell.value.minorUnits === null
            ? []
            : [amount(currency, cell.value.minorUnits)];
        });
        const point = need(
          seriesPointsOf(result, currency).find((candidate) =>
            candidate.bucketStart.equals(month.start),
          ),
          `the ${currency} series point for ${month.start.toString()}`,
        );
        // A gap month's column holds no cell at all, and a recorded month's column adds up to the
        // series point the chart draws for that month.
        expect(column.length === 0).toBe(point.gap);
        expect(column.length === 0 ? null : minorTotalOf(column, currency)).toBe(
          point.gap ? null : point.value.minorUnits,
        );
      }
    }
  });

  it("sums a row of cells to the same attribution's total in the same result", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(
      queryOf(document, { reportId: "partner-month-matrix" }),
      projection,
    );
    const matrix = need(result.matrix, "the partner-by-month matrix");

    const partnerRow = need(
      matrix.rows.find((row) => row.partnerId === "partner-hana-nakamura"),
      "the matrix row of the split gift's donor",
    );
    const cellAmounts = partnerRow.cells.flatMap((cell) =>
      cell.currency === "USD" && !cell.gap && cell.value.minorUnits !== null
        ? [amount("USD", cell.value.minorUnits)]
        : [],
    );
    const rowAmounts = result.rows
      .filter(
        (row) =>
          row.attribution.kind === "partner" &&
          row.attribution.partnerId === "partner-hana-nakamura" &&
          row.amount.currency === "USD",
      )
      .map((row) => row.amount);

    expect(cellAmounts.length).toBeGreaterThan(0);
    expect(minorTotalOf(cellAmounts, "USD")).toBe(4000);
    expect(minorTotalOf(rowAmounts, "USD")).toBe(minorTotalOf(cellAmounts, "USD"));
  });

  it("returns a drilldown whose rows are a subset of the parent and whose sums add to the cell", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(
      queryOf(document, { reportId: "partner-month-matrix" }),
      projection,
    );
    const matrix = need(result.matrix, "the partner-by-month matrix");
    const partnerRow = need(
      matrix.rows.find((row) => row.partnerId === "partner-hana-nakamura"),
      "the matrix row of the split gift's donor",
    );
    const cell = need(
      partnerRow.cells.find(
        (candidate) =>
          candidate.currency === "USD" && candidate.bucketStart.toString() === "2026-10-01",
      ),
      "the October USD cell of the split gift's donor",
    );

    expect(cell.gap).toBe(false);
    expect(cell.value.minorUnits).toBe(4000);

    const drilldown = run(cell.drilldown, projection);
    const parentRowIds = new Set(result.rows.map((row) => row.giftRowId));
    expect(drilldown.rows.length).toBeGreaterThan(0);
    for (const row of drilldown.rows) {
      expect(parentRowIds.has(row.giftRowId)).toBe(true);
    }
    expect(drilldown.total).toBe(drilldown.rows.length);
    expect(summaryFor(drilldown, "USD").received.minorUnits).toBe(cell.value.minorUnits);
    expect(drilldown.snapshot.scope).toEqual(result.snapshot.scope);
  });

  it("states a cell with nothing in it as a gap and returns nothing for its drilldown", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(queryOf(document, { reportId: "partner-month-matrix" }), projection);
    const matrix = need(result.matrix, "the partner-by-month matrix");
    const partnerRow = need(
      matrix.rows.find((row) => row.partnerId === "partner-jo-mbeki"),
      "the matrix row of the November gift's donor",
    );
    const january = need(
      partnerRow.cells.find(
        (candidate) =>
          candidate.currency === "USD" && candidate.bucketStart.toString() === "2026-01-01",
      ),
      "the January USD cell of the November gift's donor",
    );

    expect(january.gap).toBe(true);
    expect(january.value.minorUnits).not.toBe(0);
    expect(january.value.minorUnits).toBeNull();
    const empty = run(january.drilldown, projection);
    expect(empty.total).toBe(0);
    expect(empty.rows).toEqual([]);

    const november = need(
      partnerRow.cells.find(
        (candidate) =>
          candidate.currency === "USD" && candidate.bucketStart.toString() === "2026-11-01",
      ),
      "the November USD cell of the November gift's donor",
    );
    expect(november.gap).toBe(false);
    expect(november.value.minorUnits).toBe(12500);
  });

  it("keeps an unknown-currency row as an exact record while stating no summed cell for it", async () => {
    const document = await establishedDocument();
    const projection = projectionOf(document);
    const result = run(queryOf(document, { reportId: "partner-month-matrix" }), projection);
    const matrix = need(result.matrix, "the partner-by-month matrix");
    const unresolved = need(
      matrix.rows.find((row) => row.attribution.kind === "unresolved"),
      "the unattributed matrix row",
    );
    const unknownCells = unresolved.cells.filter(
      (cell) => cell.currency === UNKNOWN_CURRENCY,
    );

    expect(unknownCells).toHaveLength(11);
    expect(unknownCells.every((cell) => cell.gap)).toBe(true);
    expect(unknownCells.every((cell) => cell.value.minorUnits === null)).toBe(true);

    // The record is still there and its drilldown still opens it: refusing to sum an amount is not the
    // same as dropping the fact that it exists.
    const cell = need(
      unknownCells.find((candidate) => candidate.bucketStart.toString() === "2026-08-01"),
      "the August cell of the unattributed row",
    );
    const drilldown = run(cell.drilldown, projection);
    expect(drilldown.total).toBe(1);
    expect(need(drilldown.rows[0], "the unattributed drilldown's single row").amount.currency).toBe(
      UNKNOWN_CURRENCY,
    );
  });
});
