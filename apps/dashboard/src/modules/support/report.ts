/**
 * `runReport` — the one financial computation in this application, and the only place a received-support
 * figure is filtered, summed, bucketed, compared or paged.
 *
 * The rule this file exists for is whole-query agreement. The overview's total, the chart series, the
 * ledger's table rows, a matrix cell's drilldown, the CSV export and the print view are six artifacts
 * of one `ReportResult` for one query and one snapshot, so they agree because they are one computation
 * rather than six careful copies. No other module, feature or component may compute a financial total:
 * `modules/export/{csv,print}`, `data-service/reads/support.ts` and `features/support` read this file's
 * result instead, and the root lint configuration plus `tests/domain/report-agreement.test.ts` and
 * `tests/integration/export-parity.test.ts` are the evidence.
 *
 * What this file measures, and what it never merges. A row is one authorised allocation, or one whole
 * gift that carries no allocation (`./basis` states the basis, the grain and the projection). Three
 * counts — gifts, allocations, donors — are each counted at their own grain and are never added
 * together; currencies are partitioned and never combined into one figure; a commitment is not cash
 * and never reaches a report from here; and received gifts, recurring collection outcomes,
 * commitments, monthly-equivalent support and the goal stay the five separate measures `./basis`
 * declares. A gift, its allocations and its donor are three different counts of the same money, which
 * is why the grain de-duplication below is explicit and commented rather than incidental.
 *
 * Five renderings stay five. `zero` is a recorded zero, `unknown` a value the source never
 * established, `withheld` a value this context may not show, `unavailable` a source that could not be
 * read, and `incomplete-subtotal` a real figure covering only the part of the period the source holds.
 * Each is carried as a `ValueState` from `data-service/envelope` on the value it describes, and
 * `incomplete-subtotal` is derived here from the projection's coverage in one helper instead of being
 * chosen by a caller, so a component cannot decide for itself whether a subtotal is partial. A bucket
 * in which the source recorded nothing is a gap — `gap: true` with no amount — and never a zero and
 * never an interpolated value, because a monthly point states what the source recorded for that month.
 *
 * Purity is a property of the whole file. This module reads no clock (`asOf` and the civil dates
 * derived from it arrive on the projection), touches no file, no network, no store and no React tree,
 * holds no module state and has no side effect at import; every export is a constant, a type or a pure
 * function of its arguments, so an identical call returns a deep-equal result. Period boundaries are
 * resolved through `modules/time/civil` and every amount is added, negated or compared through
 * `modules/money`, so no floating-point value and no locale-sensitive comparison enters a figure.
 *
 * The query gate is the other half of the contract: `buildReportQuery` is a refusing smart constructor,
 * so a query that could produce a dishonest total — an amount range across two currencies, a reversed
 * period, a page size no list will serve — cannot be represented. `runReport` re-checks that gate and
 * refuses a hand-built query with a `TypeError`, exactly as it refuses a projection reporting a second
 * basis, because both are broken contracts rather than user-facing outcomes: the service maps a thrown
 * fault to its own closed outcome set at the transport edge, where such a vocabulary exists.
 *
 * Framework-free: no third-party import except `temporal-polyfill`, which supplies the `PlainDate` and
 * `Instant` arithmetic `modules/time/civil` already uses, imported directly so TypeScript 7's missing
 * `Temporal` global is never assumed.
 */

import { Temporal } from "temporal-polyfill";

import type { SourceReference } from "../../lib/ids";
import type {
  Coverage,
  GiftAttribution,
  SupportGoalRecord,
  ValueState,
} from "../data-service/envelope";
import {
  addMinor,
  compareMinor,
  minorUnitsOf,
  negateMinor,
  type MinorUnits,
  type Money,
} from "../money/amount";
import { exponentOf, isKnownCurrency } from "../money/currency";
import {
  parseCivilDate,
  serialiseCivilDate,
  todayInZone,
  type CivilDate,
  type DatePrecision,
} from "../time/civil";
import {
  SUPPORT_BASIS,
  assertSingleBasis,
  type GiftRow,
  type SupportBasis,
  type SupportProjection,
} from "./basis";
import { GOAL_MEASURE, goalProgress, type GoalProgress, type GoalRecord } from "./goal";

// ---------------------------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------------------------

/** Rows a list or a report shows per page when the caller states no size. */
export const PAGE_SIZE_DEFAULT = 50;

/** The largest page this application serves; a bigger request is clamped rather than honoured. */
export const PAGE_SIZE_CAP = 200;

/**
 * Turns any requested page size into the one the service serves: the default when none was stated,
 * the cap when more was asked for, and never fewer than one row.
 *
 * A fractional request is truncated rather than rounded, because a page of 12.7 rows is a page of 12
 * and rounding up would quietly serve one row more than asked. A non-finite request falls back to the
 * default instead of producing a `NaN` window, so a decoded query cannot make the window empty or
 * unbounded. The cap exists so a single request cannot ask for a whole workload in one page; a caller
 * that wants every authorised row asks for an unpaged read (no `page` at all), which is the export
 * and print path, not a bigger page.
 */
export function clampPageSize(size?: number): number {
  if (size === undefined || !Number.isFinite(size)) {
    return PAGE_SIZE_DEFAULT;
  }
  const whole = Math.trunc(size);
  if (whole < 1) {
    return 1;
  }
  if (whole > PAGE_SIZE_CAP) {
    return PAGE_SIZE_CAP;
  }
  return whole;
}

// ---------------------------------------------------------------------------------------------
// The four reports
// ---------------------------------------------------------------------------------------------

/**
 * The four fixed reports of the first release, and the whole set: `./report` computes no fifth report
 * and this application has no report designer, no scheduled report and no report builder.
 *
 * - `received-period-and-year-to-date` — received support for the stated period, with an
 *   equal-elapsed-period comparison so a partial period is never set against a whole one.
 * - `monthly-history` — one chosen year's months, each stated as its own period.
 * - `partner-month-matrix` — partner by month, every cell carrying the query that opens the exact
 *   records behind it.
 * - `period-comparison` — two periods as a signed difference with the contributor changes that
 *   reconcile it.
 */
export type ReportId =
  | "received-period-and-year-to-date"
  | "monthly-history"
  | "partner-month-matrix"
  | "period-comparison";

/** The four report identities in the order every surface lists them, so a fifth cannot appear unnoticed. */
export const REPORT_IDS = [
  "received-period-and-year-to-date",
  "monthly-history",
  "partner-month-matrix",
  "period-comparison",
] as const satisfies readonly ReportId[];

// ---------------------------------------------------------------------------------------------
// Periods, currencies, sorting and paging as the caller states them
// ---------------------------------------------------------------------------------------------

/**
 * The five periods a caller may name instead of giving two civil dates.
 *
 * They are resolved against the scenario instant the projection carries, in the zone the query
 * declares, and never against a clock: a preset names a period, not an instant, so the same query
 * against the same projection always resolves to the same two dates.
 */
export const PERIOD_PRESETS = [
  "this-month",
  "last-month",
  "this-year",
  "last-year",
  "year-to-date",
] as const;

/** One named period, derived from {@link PERIOD_PRESETS} so a sixth cannot be added in one place only. */
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** The fields a Gifts result may be sorted by. Closed: an arbitrary field would be an ordering nothing states. */
export const SORT_FIELDS = ["originalGiftOn", "amountMinor", "designation"] as const;

/** One sortable field, derived from {@link SORT_FIELDS}. */
export type SortField = (typeof SORT_FIELDS)[number];

/** The two directions a sort may take. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;

/** One sort direction, derived from {@link SORT_DIRECTIONS}. */
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * The exact authority a report is computed under: the four references that are separately owned and
 * never interchangeable.
 *
 * They are stated as opaque strings because they arrive from a request body and from a stored scope,
 * and because the four are different identities with different owners — an organisation is not the
 * ministry it admits, a ministry is not the finance subject a projection belongs to, and none of them
 * is the principal who asked. A report never joins on a name, an email address or a postal address,
 * and an equal-looking identifier in another context establishes nothing here.
 */
export interface ReportScope {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
}

/**
 * Which currency's amounts a report states.
 *
 * `all` partitions the result: one summary, one series and one matrix cell set per currency present,
 * and never one combined figure, because no exchange rate exists in this application. `one` restricts
 * the result to a single code, which is also the only selection an amount range may be applied under —
 * a range across currencies would compare KWD thousandths with JPY yen.
 */
export type CurrencySelection =
  | { readonly kind: "all" }
  | { readonly kind: "one"; readonly currency: string };

/**
 * The period a report covers.
 *
 * A preset is resolved against the scenario instant; an explicit range is inclusive at both ends and
 * compared as civil dates, so a display-zone change moves no boundary; a year names one calendar year
 * and is what `monthly-history` buckets into months. `buildReportQuery` normalises a year into the
 * equivalent explicit range, so every period reaching `runReport` states two civil dates directly.
 */
export type ReportPeriod =
  | { readonly kind: "preset"; readonly preset: PeriodPreset }
  | { readonly kind: "explicit"; readonly from: CivilDate; readonly to: CivilDate }
  | { readonly kind: "year"; readonly year: number };

/**
 * Which attribution a result is restricted to.
 *
 * `anonymous` is a supporter who chose not to be identified and `unresolved` is a source row that
 * supplied no attribution; neither is a household, a church or an organisation representative, and
 * neither ever borrows a partner identity.
 */
export type ReportPartnerSelection =
  | { readonly kind: "partner"; readonly partnerId: string }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unresolved" };

/**
 * One report request: the fixed report, the authority it runs under, the period and the filters.
 *
 * Every filter is a fact the query states and the result answers; nothing is inferred from another
 * field. `amountRange` is legal only beside a single selected currency and is expressed in that
 * currency's minor units, because a range is a comparison of amounts and two currencies have no
 * ordering. `page` absent means an unpaged read — every authorised row, which is what the CSV export
 * and the print view read, so a download holds the whole result rather than the loaded page.
 *
 * `timeZone` is the zone a preset resolves in; it defaults to UTC so a query without one still
 * resolves to exactly one pair of dates. Nothing here reads a clock.
 */
export interface ReportQuery {
  readonly reportId: ReportId;
  readonly scope: ReportScope;
  readonly period: ReportPeriod;
  readonly currency: CurrencySelection;
  readonly amountRange?: { readonly minMinor: MinorUnits; readonly maxMinor: MinorUnits };
  readonly designation?: string;
  readonly partner?: ReportPartnerSelection;
  /**
   * A giving method or classification the source would have to admit. The support projection carries
   * no such field, so {@link validateReportQuery} refuses this filter rather than ignoring it: a filter
   * silently dropped would answer a question nobody asked.
   */
  readonly method?: string;
  readonly search?: string;
  readonly sort?: { readonly field: SortField; readonly direction: SortDirection };
  readonly page?: { readonly index: number; readonly size?: number };
  readonly timeZone?: string;
}

/** One reason a report request was refused, keyed by the field it belongs to. */
export interface ReportQueryProblem {
  readonly field: string;
  readonly message: string;
}

/** The four scope references, listed once so no validation round forgets one of them. */
const SCOPE_FIELDS = ["organizationId", "ministryId", "supportSubjectId", "principalId"] as const;

/** The zone a period preset resolves in when the caller states none, so no host zone is ever used. */
export const REPORT_DEFAULT_TIME_ZONE = "UTC";

/** The fixed instant the zone probe resolves; a constant, so nothing here reads a clock. */
const ZONE_PROBE_INSTANT = Temporal.Instant.fromEpochMilliseconds(0);

/**
 * Whether a zone identifier is one the calendar arithmetic can resolve.
 *
 * Asked through `modules/time/civil` rather than through an `Intl` call of this module's own, so the
 * zone vocabulary has one owner. A zone that cannot resolve would leave a preset with no civil dates,
 * which is why it is refused at the gate instead of falling back to another zone.
 */
function isResolvableZone(timeZone: string): boolean {
  return todayInZone(timeZone, ZONE_PROBE_INSTANT).status === "resolved";
}

/**
 * Checks one report request and returns every problem it has, or an empty list when it is acceptable.
 *
 * The order of the checks is fixed so the same request always yields the same list: identity, scope,
 * period, currency and its range, the row filters, the sort and the page. Each message names what must
 * change and never echoes an amount, a record or a value the caller may not see.
 */
export function validateReportQuery(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];

  if (!REPORT_IDS.includes(query.reportId)) {
    problems.push({
      field: "reportId",
      message:
        "This application reports received support in four fixed ways. Choose one of the four identities; no other report is computed and none is substituted for an unrecognised one.",
    });
  }

  // The three structures below are checked for presence before they are read, so a request body that
  // failed to decode is answered with per-field problems rather than with a thrown fault.
  const scope: ReportScope | undefined = query.scope;
  if (typeof scope !== "object" || scope === null) {
    problems.push({
      field: "scope",
      message:
        "Every report runs under the four references that state its authority, and this request states none. No report is computed under an assumed context.",
    });
  } else {
    for (const field of SCOPE_FIELDS) {
      const value: string = scope[field];
      if (typeof value !== "string" || value.trim() === "") {
        problems.push({
          field: `scope.${field}`,
          message:
            "Every report runs under the four references that state its authority. This one is missing, and a report is never computed under an assumed context.",
        });
      }
    }
  }

  const period: ReportPeriod | undefined = query.period;
  if (typeof period !== "object" || period === null) {
    problems.push({
      field: "period",
      message:
        "A report covers a period, and this request states none. No period is assumed in its place.",
    });
  } else {
    problems.push(...validatePeriod(period));
  }

  const currency: CurrencySelection | undefined = query.currency;
  if (typeof currency !== "object" || currency === null) {
    problems.push({
      field: "currency",
      message:
        "A report states the currency or currencies its figures are in, and this request states none. No currency is assumed in its place.",
    });
  } else {
    problems.push(...validateCurrency(query));
  }

  problems.push(...validateFilters(query));
  problems.push(...validateSort(query.sort));
  problems.push(...validatePage(query.page));

  if (query.timeZone !== undefined && !isResolvableZone(query.timeZone)) {
    problems.push({
      field: "timeZone",
      message:
        "A period preset resolves in the zone the query names, and this zone cannot be resolved. Choose a tz database identifier; the application never substitutes the host's zone.",
    });
  }

  return problems;
}

/** Checks the stated period: a known preset, two civil dates in order, or a four-digit year. */
function validatePeriod(period: ReportPeriod): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];

  switch (period.kind) {
    case "preset":
      if (!PERIOD_PRESETS.includes(period.preset)) {
        problems.push({
          field: "period.preset",
          message:
            "A preset period is one of the five this application offers. Name one of them, or state two civil dates instead.",
        });
      }
      return problems;

    case "explicit": {
      if (!isCivilDate(period.from) || !isCivilDate(period.to)) {
        problems.push({
          field: "period",
          message:
            "An explicit period is two civil dates, each a calendar day with no time of day. A date-time string is refused rather than truncated, because a truncated time would move the period's boundary.",
        });
        return problems;
      }
      if (Temporal.PlainDate.compare(period.from, period.to) > 0) {
        problems.push({
          field: "period",
          message:
            "The period starts after it ends, so it covers no day at all. State the earlier date first; the range is inclusive at both ends.",
        });
      }
      return problems;
    }

    case "year": {
      const year: number = period.year;
      if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
        problems.push({
          field: "period.year",
          message:
            "A calendar year is stated as a whole four-digit year. This value is not one, so no year's months are computed for it.",
        });
      }
      return problems;
    }

    default:
      problems.push({
        field: "period.kind",
        message:
          "A period is a preset, two civil dates or a calendar year. This one is none of those, so no period is assumed for it.",
      });
      return problems;
  }
}

/**
 * Checks the currency selection and the amount range beside it.
 *
 * An amount range is refused under `all`: it compares minor units, and minor units of two currencies
 * are not comparable at any rate this application holds. A reversed range is refused too, and so is a
 * range whose bounds are not whole counts of minor units, because a range is stated exactly or not at
 * all.
 */
function validateCurrency(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  const selection: CurrencySelection = query.currency;
  const range = query.amountRange;

  if (selection.kind === "all") {
    if (range !== undefined) {
      problems.push({
        field: "amountRange",
        message:
          "An amount range compares one currency's amounts, so it needs a single selected currency. Clear the range or choose one currency; a range across currencies would compare amounts that have no ordering.",
      });
    }
    return problems;
  }

  if (selection.kind === "one") {
    if (typeof selection.currency !== "string" || selection.currency.trim() === "") {
      problems.push({
        field: "currency.currency",
        message:
          "A single-currency selection states the currency code. This one is empty, and no currency is assumed in its place.",
      });
    }
    if (range !== undefined) {
      if (!Number.isSafeInteger(range.minMinor) || !Number.isSafeInteger(range.maxMinor)) {
        problems.push({
          field: "amountRange",
          message:
            "An amount range states whole counts of the selected currency's minor units. A fractional or non-finite bound is refused rather than rounded, because rounding would change which rows match.",
        });
      } else if (range.minMinor > range.maxMinor) {
        problems.push({
          field: "amountRange",
          message:
            "The amount range starts above where it ends, so it matches nothing. State the lower bound first; both bounds are inclusive.",
        });
      }
    }
    return problems;
  }

  problems.push({
    field: "currency.kind",
    message:
      "A currency selection is either every currency present or one named currency. This one is neither, so no partition is assumed for it.",
  });
  return problems;
}

/** Checks the row filters: the attribution, the designation, the method and the search term. */
function validateFilters(query: ReportQuery): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];

  if (query.partner !== undefined) {
    const partner = query.partner;
    if (partner.kind === "partner") {
      if (typeof partner.partnerId !== "string" || partner.partnerId.trim() === "") {
        problems.push({
          field: "partner.partnerId",
          message:
            "A partner filter states the partner's own reference. This one is empty, and no partner is assumed in its place.",
        });
      }
    } else if (partner.kind !== "anonymous" && partner.kind !== "unresolved") {
      problems.push({
        field: "partner.kind",
        message:
          "An attribution filter is a partner reference, anonymous support or unattributed support. This one is none of those.",
      });
    }
  }

  if (query.designation !== undefined && query.designation.trim() === "") {
    problems.push({
      field: "designation",
      message:
        "A designation filter states the source's own designation. An empty one selects nothing rather than everything, so it is refused; omit the filter to read every designation.",
    });
  }

  if (query.method !== undefined) {
    problems.push({
      field: "method",
      message:
        "The support projection carries no giving-method or classification field, so a method facet cannot be applied to it. The filter is refused rather than quietly ignored, because a result that was never filtered must not be presented as a filtered one.",
    });
  }

  if (query.search !== undefined && query.search.trim() === "") {
    problems.push({
      field: "search",
      message:
        "A search term states the text to look for. An empty term matches every row rather than none, so it is refused; omit the search to read the whole result.",
    });
  }

  return problems;
}

/** Checks the stated sort: a known field and a known direction. */
function validateSort(sort: ReportQuery["sort"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (sort === undefined) {
    return problems;
  }
  if (!SORT_FIELDS.includes(sort.field)) {
    problems.push({
      field: "sort.field",
      message:
        "A result is sorted by the gift's own date, its amount or its designation. This field is not one of those, and no other ordering is invented for it.",
    });
  }
  if (!SORT_DIRECTIONS.includes(sort.direction)) {
    problems.push({
      field: "sort.direction",
      message:
        "A sort runs ascending or descending. This direction is neither, so no order is assumed.",
    });
  }
  return problems;
}

/**
 * Checks the page window.
 *
 * The index is a non-negative whole number of pages, and the size is a finite number the cap and the
 * floor are applied to. An index past the last page is not a problem: it is an empty window, which is
 * an honest answer to a request for rows that are not there.
 */
function validatePage(page: ReportQuery["page"]): ReportQueryProblem[] {
  const problems: ReportQueryProblem[] = [];
  if (page === undefined) {
    return problems;
  }
  if (!Number.isSafeInteger(page.index) || page.index < 0) {
    problems.push({
      field: "page.index",
      message:
        "A page index is a whole number of pages from zero. This value is not one, so no page is assumed for it.",
    });
  }
  if (page.size !== undefined && !Number.isFinite(page.size)) {
    problems.push({
      field: "page.size",
      message:
        "A page size is a finite number of rows. This one is not, and the default page size is not substituted for a stated one that cannot be read.",
    });
  }
  return problems;
}

/**
 * Builds the query a report is computed from, refusing one that could produce a dishonest total.
 *
 * Three things happen here and in no other place: the stated strings are trimmed and an empty optional
 * filter is dropped, the page size is clamped through {@link clampPageSize}, and a calendar year is
 * normalised into the explicit range it names. The gate then runs over the normalised query, so a
 * problem that trimming settled — an empty designation — is not reported as a refusal.
 *
 * Resolving a preset is deliberately not done here: a preset needs the scenario instant, which lives
 * on the projection and not on the query, and reading a clock in a constructor would make two
 * identical requests resolve to two different periods. `runReport` resolves it, from the projection's
 * as-of instant in the query's zone.
 */
export function buildReportQuery(
  input: ReportQuery,
): { ok: true; query: ReportQuery } | { ok: false; problems: ReportQueryProblem[] } {
  const normalised = trimOptionalFields(input);
  const problems = validateReportQuery(normalised);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, query: normalisePeriod(normalised) };
}

/** Trims the stated strings, drops an empty optional filter and clamps the page size. */
function trimOptionalFields(input: ReportQuery): ReportQuery {
  const page = input.page;
  const designation = blankToUndefined(input.designation);
  const search = blankToUndefined(input.search);
  const method = blankToUndefined(input.method);
  const timeZone = blankToUndefined(input.timeZone);
  const partner: ReportPartnerSelection | undefined =
    input.partner === undefined || input.partner === null
      ? undefined
      : input.partner.kind === "partner"
        ? { kind: "partner", partnerId: trimmedText(input.partner.partnerId) }
        : input.partner;

  return {
    reportId: input.reportId,
    scope: trimScope(input.scope),
    period: input.period,
    currency: trimCurrency(input.currency),
    ...(designation === undefined ? {} : { designation }),
    ...(search === undefined ? {} : { search }),
    ...(method === undefined ? {} : { method }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(partner === undefined ? {} : { partner }),
    ...(input.amountRange === undefined ? {} : { amountRange: input.amountRange }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
    ...(page === undefined || page === null
      ? {}
      : { page: { index: page.index, size: clampPageSize(page.size) } }),
  };
}

/** A stated string with its surrounding space removed, or `""` when nothing at all is stated. */
function trimmedText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A stated string with its surrounding space removed, or `undefined` when nothing is left of it. */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = trimmedText(value);
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Trims the four scope references, leaving a scope that did not decode as it arrived so the gate
 * refuses it rather than this function throwing on it.
 */
function trimScope(scope: ReportScope): ReportScope {
  // Widened on purpose: this value arrives from a request body, so what actually arrived is compared
  // rather than the type it was declared with.
  const arrived: unknown = scope;
  if (typeof arrived !== "object" || arrived === null) {
    return scope;
  }
  return {
    organizationId: trimmedText(scope.organizationId),
    ministryId: trimmedText(scope.ministryId),
    supportSubjectId: trimmedText(scope.supportSubjectId),
    principalId: trimmedText(scope.principalId),
  };
}

/** Trims a selected currency code, leaving any other selection exactly as it arrived. */
function trimCurrency(currency: CurrencySelection): CurrencySelection {
  const arrived: unknown = currency;
  if (typeof arrived !== "object" || arrived === null || currency.kind !== "one") {
    return currency;
  }
  return { kind: "one", currency: trimmedText(currency.currency) };
}

/** Rewrites a calendar-year period as the explicit inclusive range it names. */
function normalisePeriod(input: ReportQuery): ReportQuery {
  const period = input.period;
  if (period.kind !== "year") {
    return input;
  }
  return {
    ...input,
    period: {
      kind: "explicit",
      from: Temporal.PlainDate.from({ year: period.year, month: 1, day: 1 }),
      to: Temporal.PlainDate.from({ year: period.year, month: 12, day: 31 }),
    },
  };
}

/** Whether a value is a civil date, so a decoded query cannot smuggle another shape through. */
function isCivilDate(value: unknown): value is CivilDate {
  return value instanceof Temporal.PlainDate;
}

// ---------------------------------------------------------------------------------------------
// What a report answers
// ---------------------------------------------------------------------------------------------

/**
 * Whether the period a report covers has closed.
 *
 * `in-progress` means the period contains or follows the instant the read was evaluated at, so its
 * figures cover only the part of it that has happened; every surface labels such a period *In
 * progress* and treats its subtotals as incomplete. `complete` means the period ended before that
 * instant. The state is derived from the period and the projection's as-of instant, never chosen.
 */
export type PeriodState = "complete" | "in-progress";

/**
 * One stated amount: the exact minor units and the state that says what kind of value it is.
 *
 * The two travel together because either alone is misleading. `value`, `zero` and
 * `incomplete-subtotal` carry their amount — an incomplete subtotal is a real figure for the part of
 * the period the source holds, and it is labelled as partial rather than withheld, which is what keeps
 * the screen, the chart's table, the drilldown, the CSV and the print view agreeing in minor units.
 * `unknown`, `withheld` and `unavailable` carry no amount at all, so no surface can print a number
 * beside a claim the source never made.
 */
export interface StatedValue {
  /** The exact amount, or `null` when the state says no amount may be stated. */
  readonly minorUnits: MinorUnits | null;
  readonly valueState: ValueState;
}

/**
 * One stated count: how many rows there are, and the state that says what the count is a count of.
 *
 * A count is counted at its own grain and is never added to another count. The number is always the
 * number of rows this result holds; the state says whether it may be presented as the count of the
 * result — a count over partial coverage is an incomplete subtotal, and a count over coverage the
 * source did not state is not presented as a total.
 */
export interface StatedCount {
  readonly count: number;
  readonly valueState: ValueState;
}

/**
 * One currency's part of the result: its received support and its three counts, at their own grains.
 *
 * There is one entry per currency and no combined figure anywhere, because adding EUR minor units to
 * USD minor units states a number this application cannot know. `exponent` is the currency's
 * minor-unit precision; it is `undefined` for a currency this application holds no exponent for, and
 * such an entry's received amount is never stated (its `valueState` is `unknown`) instead of being
 * defaulted to two decimals. `giftCount`, `allocationCount` and `donorCount` are the three grains of
 * the same money and are never summed: `giftCount` counts distinct gifts, `allocationCount` counts
 * allocation rows, and `donorCount` counts distinct partner references, so anonymous support raises
 * the received total without inflating the donor count.
 */
export interface CurrencySummary {
  readonly currency: string;
  readonly exponent: number | undefined;
  readonly received: StatedValue;
  readonly giftCount: StatedCount;
  readonly allocationCount: StatedCount;
  readonly donorCount: StatedCount;
}

/**
 * One point of a currency's series: the amount the source recorded in one month bucket.
 *
 * A series is per currency — there is no combined series, because two currencies are never drawn as
 * one line. A bucket in which the source recorded no authorised row is a `gap`: no amount and no
 * interpolation, so a chart shows a break rather than a dip to zero. `bucketStart` and `bucketEnd` are
 * the bucket's civil dates clipped to the period, so a part-month at either end of the period states
 * the days it actually covers.
 */
export interface SeriesPoint {
  readonly bucketStart: CivilDate;
  readonly bucketEnd: CivilDate;
  readonly currency: string;
  readonly value: StatedValue;
  readonly gap: boolean;
}

/**
 * One authorised allocation at its own grain, as the rows of a result.
 *
 * A gift with no allocation is one row at gift grain; a split gift contributes the allocation this
 * read is authorised to see, so a view that legitimately holds both grain levels counts the gift once.
 * Attribution is explicit — a partner reference, anonymous support or unattributed support — and an
 * anonymous or unattributed row carries no partner identity at all. Every row of a dated result states
 * the gift's own day, because a row whose day the source never established stays out of a dated period
 * rather than being given the entry date or today; the day is optional here only so the shape mirrors
 * the projection's row rather than inventing a second one.
 */
export interface ReportRow {
  readonly giftRowId: string;
  readonly giftId: string;
  readonly allocationId?: string;
  readonly amount: Money;
  readonly originalGiftOn?: CivilDate;
  readonly datePrecision: DatePrecision;
  readonly designation?: string;
  readonly attribution: GiftAttribution;
  readonly refundOf?: string;
  readonly provenance: SourceReference;
  readonly entryOn: CivilDate;
}

/**
 * One cell of the partner-by-month matrix: a partner's amount in one month of one currency.
 *
 * `currency` is stated on the cell because a cell is a sum, and a sum of two currencies is not a
 * number: the matrix therefore holds one cell per currency per month rather than one cell per month.
 * `drilldown` is the whole query narrowed to this cell — the same authority and filters, this cell's
 * month and this cell's attribution, no page window — so the records it returns are a subset of the
 * same result's authorised rows and their sums add to the drilled value. `gap` states that the source
 * recorded no authorised row in this cell, in which case no amount is stated at all; a gap cell still
 * carries its drilldown, and that query honestly returns no rows.
 */
export interface MatrixCell {
  readonly bucketStart: CivilDate;
  readonly bucketEnd: CivilDate;
  readonly currency: string;
  readonly value: StatedValue;
  readonly gap: boolean;
  readonly drilldown: ReportQuery;
}

/**
 * One matrix row: one attribution across every month of the matrix.
 *
 * `cells` is currency-major — for currency index `c` and month index `m` the cell is at
 * `c * matrix.months.length + m` — and every cell also states its own `currency` and `bucketStart`, so
 * a consumer finds a cell by those two facts instead of by arithmetic. `partnerId` is present only for
 * a partner row. `label` is a fallback identifier, not a display name: the projection carries no name,
 * an email address or a postal address, because none of them establishes identity, so a partner row
 * labels itself with its opaque reference and a surface that can read the partner record shows the name
 * it read there.
 */
export interface MatrixRow {
  readonly partnerId?: string;
  readonly attribution: GiftAttribution;
  readonly label: string;
  readonly cells: readonly MatrixCell[];
}

/**
 * The partner-by-month matrix: the months it covers, the currencies it is stated in and one row per
 * attribution.
 *
 * Rows are ordered deterministically — partner rows by their opaque reference, then anonymous support,
 * then unattributed support — and each row's cells cover every currency in `currencies` for every
 * month in `months`. No cell is ever a sum across currencies.
 */
export interface Matrix {
  readonly currencies: readonly string[];
  readonly months: readonly { readonly start: CivilDate; readonly end: CivilDate }[];
  readonly rows: readonly MatrixRow[];
}

/**
 * One contributor's change between the two periods of a comparison.
 *
 * `minorUnits` is signed: a supporter who gave more contributes a positive delta and one who gave less
 * contributes a negative one. A partner row names its partner; anonymous and unattributed rows state
 * their attribution instead, because support that carries no partner identity must not be given one in
 * order to balance a total.
 */
export interface ContributorDelta {
  readonly partnerId?: string;
  readonly attribution?: GiftAttribution;
  readonly currency: string;
  readonly minorUnits: MinorUnits;
}

/**
 * Two periods compared, per currency, as a signed difference with the contributor changes that
 * reconcile it.
 *
 * `baseline` is the equal number of days immediately before `current`, so a partial period is never set
 * against a whole one; `equalElapsed` states whether the two spans really are the same length, and no
 * comparison is presented as valid when it is false. `differenceMinor` is current minus baseline, and
 * `reconciles` states whether the contributor deltas of that currency sum exactly to it — a comparison
 * that could not be reconciled says so rather than gaining a fabricated balancing entry. A currency
 * this application holds no exponent for never appears here, because its amounts cannot be stated,
 * compared or differenced; it remains visible in the summary as an unknown-currency fact.
 */
export interface ReportComparison {
  readonly current: { readonly from: CivilDate; readonly to: CivilDate };
  readonly baseline: { readonly from: CivilDate; readonly to: CivilDate };
  readonly equalElapsed: boolean;
  readonly perCurrency: readonly {
    readonly currency: string;
    readonly currentMinor: MinorUnits;
    readonly baselineMinor: MinorUnits;
    readonly differenceMinor: MinorUnits;
    readonly direction: "increase" | "decrease" | "unchanged";
    readonly valueState: ValueState;
  }[];
  readonly contributorDeltas: readonly ContributorDelta[];
  readonly reconciles: boolean;
}

/**
 * The identity of the result: the query, the authority, the period, the coverage and the instant.
 *
 * Six artifacts of one result state these same facts, so a download whose header claims a different
 * currency, period, coverage or as-of time from the screen it came from is a different figure wearing
 * the same numbers. `basis` is the one named basis (`./basis`), `coverage` is the projection's own
 * statement of how much of the past the read covers, `asOf` is the scenario instant the read was
 * evaluated at and `lastSourceUpdate` is when the source last changed — three facts that are never
 * collapsed into one timestamp. `currencies` is the partition the figures are stated in.
 */
export interface Snapshot {
  readonly query: ReportQuery;
  readonly scope: ReportScope;
  readonly basis: SupportBasis;
  readonly currencies: readonly string[];
  readonly period: {
    readonly from: CivilDate;
    readonly to: CivilDate;
    readonly state: PeriodState;
  };
  readonly coverage: Coverage;
  readonly asOf: string;
  readonly lastSourceUpdate: string;
  readonly source: SourceReference;
}

/**
 * Everything one report answers for one query and one snapshot.
 *
 * This is the single value the overview, the ledger, the chart, the matrix, the drilldown, the CSV
 * export and the print view read, which is why the six agree. `summary` holds one entry per currency
 * and never a combined total; `series` holds one point per currency per month bucket; `rows` holds the
 * current page window, or every authorised row when the query was unpaged; `total` is always the
 * whole-result count, never the count of the window. `comparison` is present for the two reports that
 * state one, `matrix` for the matrix report, and `goal` when the projection carries a goal — its
 * percentage is `./goal`'s computation and is never recomputed here.
 *
 * `valueStates` maps every value-bearing path in the result to its state — summary amounts and counts,
 * series points, row amounts, comparison figures and matrix cells — so no surface has to decide for
 * itself whether a number it is about to print is a zero, an unknown, a withheld value, an unavailable
 * source or an incomplete subtotal.
 */
export interface ReportResult {
  readonly snapshot: Snapshot;
  readonly summary: readonly CurrencySummary[];
  readonly series: readonly SeriesPoint[];
  readonly rows: readonly ReportRow[];
  readonly total: number;
  readonly page?: { readonly index: number; readonly size: number; readonly totalPages: number };
  readonly comparison?: ReportComparison;
  readonly matrix?: Matrix;
  readonly goal?: GoalProgress;
  readonly valueStates: Readonly<Record<string, ValueState>>;
}

// ---------------------------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------------------------

/** Two civil dates with nothing else attached: the period a figure covers. */
interface PeriodRange {
  readonly from: CivilDate;
  readonly to: CivilDate;
}

/** A period with the state that says whether it has closed. */
interface ResolvedPeriod extends PeriodRange {
  readonly state: PeriodState;
}

/** One month of a series or a matrix: the month's days clipped to the period being reported. */
interface MonthBucket {
  readonly start: CivilDate;
  readonly end: CivilDate;
}

/** The result of a paged read: the window's rows, and the page identity when a page was asked for. */
interface WindowedRows {
  readonly rows: readonly ReportRow[];
  readonly page?: { readonly index: number; readonly size: number; readonly totalPages: number };
}

/**
 * Computes one report from one query and one projection — the single computation behind every
 * financial surface in this application.
 *
 * The order below is the order the honesty rules need: the query gate and the single basis are checked
 * before anything is computed, the period is resolved from the projection's own as-of instant, one pass
 * over the projection's rows applies every filter, the grain de-duplication then makes the row set
 * countable, and every artifact — summary, series, window, comparison, matrix, goal — is built from that
 * one filtered set. Nothing is recomputed for a second surface and nothing is aggregated twice, which is
 * what makes the six artifacts agree in count and in minor-unit sums per currency.
 *
 * @param query the request, as built by {@link buildReportQuery}; a hand-built one that fails the gate
 *   is refused, because a query that could produce a dishonest total must not be computed.
 * @param projection the read-only support projection, carrying the basis, the coverage, the as-of
 *   instant and the authorised gift rows of one support subject.
 */
export function runReport(query: ReportQuery, projection: SupportProjection): ReportResult {
  assertQueryGate(query);
  assertSingleBasis(projection);
  const basis: SupportBasis = SUPPORT_BASIS;

  const asOf = instantOf(projection.asOf);
  const timeZone = query.timeZone ?? REPORT_DEFAULT_TIME_ZONE;
  const today = civilTodayIn(timeZone, asOf);
  const period = resolvePeriod(query.period, today);
  const baseline = needsComparison(query.reportId) ? precedingEqualElapsed(period) : undefined;

  // One filtering pass over every authorised row, then one de-duplication at the grain. Both artifacts
  // below are derived from this same set, so a filter can never apply to one surface and not another.
  // Each surviving row's calendar day and month are then read once, because a whole-result read compares
  // a row's day on every filter and orders it on every sort comparison, and a `Temporal` date's fields
  // are not free to read.
  const searchTerm = query.search === undefined ? undefined : query.search.toLowerCase();
  const prepared = prepareRows(
    deduplicateAtGrain(
      projection.gifts.filter((row) => matchesNonDateFilters(row, query, searchTerm)),
    ),
    period.from,
  );
  const current = sortPreparedRows(
    prepared.filter((row) => isWithin(row, dayKeyOf(period.from), dayKeyOf(period.to))),
    query.sort,
  );
  const baselineRows =
    baseline === undefined
      ? []
      : prepared.filter((row) => isWithin(row, dayKeyOf(baseline.from), dayKeyOf(baseline.to)));

  const currencies = currenciesOf(current, query.currency);
  const summary = summarise(current, currencies, projection.coverage);
  const buckets = monthBuckets(period.from, period.to);
  const series = buildSeries(current, buckets, currencies, projection.coverage);
  const windowed = windowRows(
    current.map((row) => toReportRow(row.row)),
    query.page,
  );
  const comparison =
    baseline === undefined
      ? undefined
      : buildComparison({ period, baseline, coverage: projection.coverage, current, baselineRows });
  const matrix =
    query.reportId === "partner-month-matrix"
      ? buildMatrix({
          query,
          buckets,
          currencies,
          rows: current,
          coverage: projection.coverage,
        })
      : undefined;
  const goal =
    projection.goal === undefined
      ? undefined
      : buildGoal(projection.goal, summary, query.currency, projection.coverage);

  return {
    snapshot: {
      query,
      scope: query.scope,
      basis,
      currencies,
      period: { from: period.from, to: period.to, state: period.state },
      coverage: projection.coverage,
      asOf: projection.asOf,
      lastSourceUpdate: projection.lastSourceUpdate,
      source: projection.source,
    },
    summary,
    series,
    rows: windowed.rows,
    total: current.length,
    ...(windowed.page === undefined ? {} : { page: windowed.page }),
    ...(comparison === undefined ? {} : { comparison }),
    ...(matrix === undefined ? {} : { matrix }),
    ...(goal === undefined ? {} : { goal }),
    valueStates: collectValueStates({
      summary,
      series,
      rows: windowed.rows,
      ...(comparison === undefined ? {} : { comparison }),
      ...(matrix === undefined ? {} : { matrix }),
    }),
  };
}

/** Refuses a query that did not pass the gate, naming every problem so a defect is not guessed at. */
function assertQueryGate(query: ReportQuery): void {
  const problems = validateReportQuery(query);
  if (problems.length === 0) {
    return;
  }
  const stated = problems.map((problem) => `${problem.field}: ${problem.message}`).join(" ");
  throw new TypeError(
    `runReport refuses a report query that did not pass buildReportQuery. ${stated}`,
  );
}

/** Reads the projection's as-of value as an instant, refusing a value that is not one. */
function instantOf(asOf: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(asOf);
  } catch {
    throw new TypeError(
      `Support projection as-of value "${asOf}" is not an ISO instant, so no period can be resolved against it. The value is refused rather than replaced by a clock reading.`,
    );
  }
}

/** Reads the calendar day the as-of instant falls on in the zone the query declares. */
function civilTodayIn(timeZone: string, asOf: Temporal.Instant): CivilDate {
  const resolved = todayInZone(timeZone, asOf);
  if (resolved.status === "refused") {
    throw new TypeError(
      `The zone "${timeZone}" cannot be resolved, so the report's period has no civil dates. The zone is refused rather than replaced by the host's.`,
    );
  }
  return resolved.date;
}

/** The reports that state a comparison: the received-support report and the period comparison. */
function needsComparison(reportId: ReportId): boolean {
  return reportId === "received-period-and-year-to-date" || reportId === "period-comparison";
}

/**
 * Resolves a stated period into two civil dates and the state that says whether it has closed.
 *
 * A period whose last day is the as-of day or later is `in-progress`: its figures cover only the part
 * of it that has happened, so every subtotal over it is labelled incomplete rather than presented as a
 * total. A period that ended before the as-of day is `complete`.
 */
function resolvePeriod(period: ReportPeriod, today: CivilDate): ResolvedPeriod {
  const range = periodRangeOf(period, today);
  const state: PeriodState =
    Temporal.PlainDate.compare(range.to, today) >= 0 ? "in-progress" : "complete";
  return { from: range.from, to: range.to, state };
}

/** Resolves a stated period into its two inclusive civil dates. */
function periodRangeOf(period: ReportPeriod, today: CivilDate): PeriodRange {
  switch (period.kind) {
    case "explicit":
      return { from: period.from, to: period.to };
    case "year":
      return yearRange(period.year);
    case "preset":
      return presetRange(period.preset, today);
    default:
      throw new TypeError(
        "The report's period is a preset, two civil dates or a calendar year, and this value is none of those. No period is assumed for it.",
      );
  }
}

/** One preset period, resolved against the as-of day in the zone the query declares. */
function presetRange(preset: PeriodPreset, today: CivilDate): PeriodRange {
  const monthStart = today.with({ day: 1 });
  switch (preset) {
    case "this-month":
      return { from: monthStart, to: monthStart.add({ months: 1 }).subtract({ days: 1 }) };
    case "last-month": {
      const end = monthStart.subtract({ days: 1 });
      return { from: end.with({ day: 1 }), to: end };
    }
    case "this-year":
      return yearRange(today.year);
    case "last-year":
      return yearRange(today.year - 1);
    case "year-to-date":
      return { from: yearRange(today.year).from, to: today };
    default:
      throw new TypeError(
        `"${String(preset)}" is not one of the five preset periods this application offers, so no period is assumed for it.`,
      );
  }
}

/** One whole calendar year as an inclusive civil range. */
function yearRange(year: number): PeriodRange {
  return {
    from: Temporal.PlainDate.from({ year, month: 1, day: 1 }),
    to: Temporal.PlainDate.from({ year, month: 12, day: 31 }),
  };
}

/**
 * The equal number of days immediately before a period, for an equal-elapsed comparison.
 *
 * A calendar month set beside the calendar month before it would compare 28 days with 31 and call the
 * difference a change in giving; the baseline is therefore the same count of days ending the day before
 * the current period starts, so the two spans are equal however each one falls across month boundaries.
 */
function precedingEqualElapsed(period: PeriodRange): PeriodRange {
  const days = daysInclusive(period.from, period.to);
  const to = period.from.subtract({ days: 1 });
  return { from: to.subtract({ days: days - 1 }), to };
}

/** How many civil days a period covers, both ends included. */
function daysInclusive(from: CivilDate, to: CivilDate): number {
  return from.until(to, { largestUnit: "days" }).days + 1;
}

/**
 * The month buckets a period is reported in: one per month the period touches, each clipped to the
 * period's own bounds so a period starting mid-month states the days it actually covers.
 */
function monthBuckets(from: CivilDate, to: CivilDate): readonly MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const lastMonthStart = to.with({ day: 1 });
  let monthStart = from.with({ day: 1 });

  while (Temporal.PlainDate.compare(monthStart, lastMonthStart) <= 0) {
    const monthEnd = monthStart.add({ months: 1 }).subtract({ days: 1 });
    buckets.push({
      start: Temporal.PlainDate.compare(monthStart, from) < 0 ? from : monthStart,
      end: Temporal.PlainDate.compare(monthEnd, to) > 0 ? to : monthEnd,
    });
    monthStart = monthStart.add({ months: 1 });
  }

  return buckets;
}

/** How many months a date lies after the month a period starts in, which is its bucket index. */
function monthOffset(date: CivilDate, origin: CivilDate): number {
  return (date.year - origin.year) * 12 + (date.month - origin.month);
}

/**
 * One authorised row with the two calendar facts a read needs, read from the `Temporal` value once.
 *
 * `dayKey` orders and compares civil days exactly — `2026-03-15` is `20260315` — and is an ordering key
 * only: it is never an amount, never a date to display and never a stored value. `monthIndex` is the row's
 * distance in months from the month the reported period starts in, which is its series and matrix bucket.
 */
interface PreparedRow {
  readonly row: GiftRow;
  readonly dayKey: number;
  readonly monthIndex: number;
}

/** The ordering key of a civil day: its year, month and day as one integer. */
function dayKeyOf(date: CivilDate): number {
  return date.year * 10_000 + date.month * 100 + date.day;
}

/**
 * Reads each row's day and month once, dropping a row whose day the source never stated.
 *
 * An undated row cannot be attributed to a period, so it is not given today's date, the entry date or a
 * mid-month guess: it stays out of a dated result entirely rather than being placed on a day the source
 * did not record.
 */
function prepareRows(rows: readonly GiftRow[], originMonth: CivilDate): readonly PreparedRow[] {
  const prepared: PreparedRow[] = [];
  for (const row of rows) {
    const date = row.originalGiftOn;
    if (date === undefined) {
      continue;
    }
    prepared.push({ row, dayKey: dayKeyOf(date), monthIndex: monthOffset(date, originMonth) });
  }
  return prepared;
}

/** Whether a row's own gift day falls inside a period, both bounds included. */
function isWithin(row: PreparedRow, fromKey: number, toKey: number): boolean {
  return row.dayKey >= fromKey && row.dayKey <= toKey;
}

/**
 * Applies every filter that does not depend on a date: the currency, the amount range inside it, the
 * designation, the attribution and the search term.
 *
 * The amount range compares two exact integer counts of the one currency the gate let it be applied
 * under; it adds nothing, converts nothing and never reaches across two codes. The search reads only
 * fields this projection carries — the designations, the identifiers and the source reference — and
 * never a name, an email address or a postal address, because none is present here and none is a join
 * key.
 */
function matchesNonDateFilters(
  row: GiftRow,
  query: ReportQuery,
  searchTerm: string | undefined,
): boolean {
  if (query.currency.kind === "one" && row.amount.currency !== query.currency.currency) {
    return false;
  }

  const range = query.amountRange;
  if (range !== undefined) {
    const amount: number = row.amount.minorUnits;
    if (amount < range.minMinor || amount > range.maxMinor) {
      return false;
    }
  }

  if (query.designation !== undefined && row.designation !== query.designation) {
    return false;
  }

  const partner = query.partner;
  if (partner !== undefined) {
    if (partner.kind === "partner") {
      if (row.attribution.kind !== "partner" || row.attribution.partnerId !== partner.partnerId) {
        return false;
      }
    } else if (row.attribution.kind !== partner.kind) {
      return false;
    }
  }

  if (searchTerm !== undefined && !matchesSearch(row, searchTerm)) {
    return false;
  }

  return true;
}

/** Whether any permitted field of a row contains the search term, which arrives already lower-cased. */
function matchesSearch(row: GiftRow, needle: string): boolean {
  const fields: readonly (string | undefined)[] = [
    row.designation,
    row.giftId,
    row.giftRowId,
    row.allocationId,
    row.provenance.system,
    row.provenance.reference,
    row.attribution.kind === "partner" ? row.attribution.partnerId : undefined,
  ];
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}

/**
 * Counts a gift once when a view legitimately holds both grain levels.
 *
 * The grain rule: one row is one authorised allocation, and a gift that carries no allocation is one
 * row at gift grain. A split gift therefore arrives as its allocation rows, and if the parent gift row
 * is in the same read — a source that reports the whole gift beside its parts — adding it again would
 * count the gift twice. The authored allocation wins: a gift-grain row whose gift has allocation rows
 * in this same read is dropped, and the allocations that express the authorised amounts are kept. That
 * is why a 100-unit gift split 40/60 shows the authorised allocation, and a view holding both grain
 * levels counts the 100 once.
 *
 * A correction is never dropped, whatever else its gift holds: a refund or credit row carries the
 * source's own signed amount and names the row it corrects, so folding it into a parent would silently
 * remove a correction from a period that already reported it. Repeated row identities are ignored after
 * the first, so a projection that repeats a row cannot double-count it.
 */
function deduplicateAtGrain(rows: readonly GiftRow[]): readonly GiftRow[] {
  const giftsWithAllocations = new Set<string>();
  for (const row of rows) {
    if (row.allocationId !== undefined) {
      giftsWithAllocations.add(row.giftId);
    }
  }

  const seen = new Set<string>();
  const kept: GiftRow[] = [];
  for (const row of rows) {
    if (seen.has(row.giftRowId)) {
      continue;
    }
    const isGiftGrainRow = row.allocationId === undefined;
    const isCorrection = row.refundOf !== undefined;
    if (isGiftGrainRow && !isCorrection && giftsWithAllocations.has(row.giftId)) {
      continue;
    }
    seen.add(row.giftRowId);
    kept.push(row);
  }
  return kept;
}

/**
 * Orders prepared rows deterministically: the requested sort, then a tie-break on the row identity.
 *
 * The tie-break is ascending in both directions and compares code units, so two identical calls return
 * the same order on every machine and a page boundary never repeats or skips a row. A row whose
 * designation is absent sorts after the rows that state one, in either direction, because a missing value
 * is not a small one. The default order is the gift's own date descending — the ledger's natural reading —
 * and the day key makes that comparison an integer one rather than a calendar one.
 */
function sortPreparedRows(
  rows: readonly PreparedRow[],
  sort: ReportQuery["sort"],
): readonly PreparedRow[] {
  return [...rows].sort((left, right) => compareRows(left, right, sort));
}

/** Compares two rows by the requested sort, or by gift date descending when none was requested. */
function compareRows(left: PreparedRow, right: PreparedRow, sort: ReportQuery["sort"]): number {
  if (sort === undefined) {
    const byDay = right.dayKey - left.dayKey;
    return byDay === 0 ? compareIdentifiers(left.row.giftRowId, right.row.giftRowId) : byDay;
  }
  const descending = sort.direction === "desc";
  const primary =
    sort.field === "originalGiftOn"
      ? signOf(left.dayKey - right.dayKey, descending)
      : sort.field === "amountMinor"
        ? signOf(compareAmounts(left.row.amount, right.row.amount), descending)
        : compareText(left.row.designation, right.row.designation, descending);
  return primary === 0 ? compareIdentifiers(left.row.giftRowId, right.row.giftRowId) : primary;
}

/** Compares two optional texts, keeping an absent one last in either direction. */
function compareText(
  left: string | undefined,
  right: string | undefined,
  descending: boolean,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return signOf(compareIdentifiers(left, right), descending);
}

/**
 * Compares two amounts without ever comparing two currencies' magnitudes.
 *
 * Two codes are ordered by code, so an amount sort over every currency groups the currencies rather
 * than pretending their minor units are comparable. Within one known code the money module's own
 * comparison decides; within a code that has no exponent the two exact integer counts are ordered
 * against each other, because ordering is neither summing nor formatting and nothing here converts an
 * amount.
 */
function compareAmounts(left: Money, right: Money): number {
  if (left.currency !== right.currency) {
    return compareIdentifiers(left.currency, right.currency);
  }
  if (isKnownCurrency(left.currency)) {
    return compareMinor(left, right);
  }
  const leftUnits: number = left.minorUnits;
  const rightUnits: number = right.minorUnits;
  if (leftUnits === rightUnits) {
    return 0;
  }
  return leftUnits < rightUnits ? -1 : 1;
}

/** Applies a direction to an ordering, leaving "last" placements to the caller. */
function signOf(order: number, descending: boolean): number {
  return descending ? -order : order;
}

/**
 * Compares two opaque strings by code unit, never by a locale-sensitive collation.
 *
 * A locale-aware comparison would order the same rows differently on two machines, which would let an
 * exported file depend on the reader's locale and would break the agreement between a page and its
 * export.
 */
function compareIdentifiers(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

/** One currency's running aggregate while the authorised rows are read once. */
interface CurrencyAggregate {
  total: Money | undefined;
  readonly giftIds: Set<string>;
  allocationCount: number;
  readonly donorIds: Set<string>;
}

/**
 * The currencies a result is stated in, in code-unit order: every currency present in the authorised
 * rows, plus the selected one when a single currency was asked for, so a currency with no matching row
 * is a genuine zero for that currency rather than a gap.
 */
function currenciesOf(
  rows: readonly PreparedRow[],
  selection: CurrencySelection,
): readonly string[] {
  const codes = new Set<string>();
  for (const { row } of rows) {
    codes.add(row.amount.currency);
  }
  if (selection.kind === "one") {
    codes.add(selection.currency);
  }
  return [...codes].sort(compareIdentifiers);
}

/**
 * Builds one summary per currency from the authorised row set: the received amount and the three counts
 * at their own grains.
 *
 * A currency with no exponent in this application receives no stated amount: its rows are exact facts,
 * but their total cannot be stated at a precision the application does not hold, so the entry's
 * `received` state is `unknown` and its amount absent rather than defaulted to two decimals. Counts are
 * counted at their own grain — distinct gifts, allocation rows, distinct partner references — and
 * anonymous support raises the received amount without ever inflating the donor count.
 */
function summarise(
  rows: readonly PreparedRow[],
  currencies: readonly string[],
  coverage: Coverage,
): readonly CurrencySummary[] {
  const aggregates = new Map<string, CurrencyAggregate>();

  for (const { row } of rows) {
    const currency = row.amount.currency;
    const aggregate = aggregateFor(aggregates, currency);
    if (row.allocationId !== undefined) {
      aggregate.allocationCount += 1;
    }
    aggregate.giftIds.add(row.giftId);
    if (row.attribution.kind === "partner") {
      aggregate.donorIds.add(row.attribution.partnerId);
    }
    if (isKnownCurrency(currency)) {
      aggregate.total =
        aggregate.total === undefined ? row.amount : addMinor(aggregate.total, row.amount);
    }
  }

  return currencies.map((currency) => {
    const aggregate = aggregates.get(currency);
    const receivedMinor: MinorUnits | null = isKnownCurrency(currency)
      ? (aggregate?.total?.minorUnits ?? minorUnitsOf(0))
      : null;
    return {
      currency,
      exponent: exponentOf(currency),
      received: statedValue(receivedMinor, coverage),
      giftCount: statedCount(aggregate?.giftIds.size ?? 0, coverage),
      allocationCount: statedCount(aggregate?.allocationCount ?? 0, coverage),
      donorCount: statedCount(aggregate?.donorIds.size ?? 0, coverage),
    };
  });
}

/** Reads a currency's aggregate, creating it on first sight of that currency. */
function aggregateFor(
  aggregates: Map<string, CurrencyAggregate>,
  currency: string,
): CurrencyAggregate {
  const existing = aggregates.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created: CurrencyAggregate = {
    total: undefined,
    giftIds: new Set<string>(),
    allocationCount: 0,
    donorIds: new Set<string>(),
  };
  aggregates.set(currency, created);
  return created;
}

/**
 * States one amount and the state it is in, deriving the coverage state instead of accepting it.
 *
 * This is the one place `incomplete-subtotal` is decided: a subtotal over partial coverage carries its
 * figure and is marked partial, so it is never presented as a total of the period and every surface
 * labels it the same way. It keeps the figure rather than withholding it because the application's one
 * money formatter renders an incomplete subtotal as its digits plus a mandatory incompleteness marker,
 * and because the six artifacts of one result have to agree in minor-unit sums per currency — a value
 * blanked out here could not be compared with the export that printed it. Coverage the source did not
 * state yields no amount at all, because nothing here is presented as a total of a period whose extent
 * is unknown. An amount that cannot be stated — an unknown currency — arrives as `null` and stays
 * `unknown`.
 */
function statedValue(minorUnits: MinorUnits | null, coverage: Coverage): StatedValue {
  if (minorUnits === null || coverage.state === "unknown") {
    return { minorUnits: null, valueState: "unknown" };
  }
  if (coverage.state === "partial") {
    return { minorUnits, valueState: "incomplete-subtotal" };
  }
  return minorUnits === 0
    ? { minorUnits, valueState: "zero" }
    : { minorUnits, valueState: "value" };
}

/**
 * States one count with the same coverage derivation as an amount, keeping the count it actually saw.
 *
 * The count is always the number of rows this result holds; the state says whether it may be presented
 * as the count of the result, because a count over partial coverage counts only the part the source
 * holds.
 */
function statedCount(count: number, coverage: Coverage): StatedCount {
  if (coverage.state === "unknown") {
    return { count, valueState: "unknown" };
  }
  if (coverage.state === "partial") {
    return { count, valueState: "incomplete-subtotal" };
  }
  return count === 0 ? { count, valueState: "zero" } : { count, valueState: "value" };
}

/** A zero amount in a named currency, built as a minor-unit integer rather than as a major-unit zero. */
function zeroMoney(currency: string): Money {
  return { currency, minorUnits: minorUnitsOf(0) };
}

/** One currency's series while it is being built: the running total and the row count per month. */
interface CurrencySeries {
  readonly totals: Money[];
  readonly counts: number[];
}

/**
 * Builds the monthly series, one point per currency per month bucket.
 *
 * A bucket in which the source recorded no authorised row is a `gap`: no amount, no interpolation and no
 * zero, because a monthly point states what the source recorded for that month and a zero would claim it
 * recorded nothing. A currency this application holds no exponent for has no series at all, since a
 * series is a sequence of totals and that total cannot be stated; the currency remains in the summary as
 * an unknown-currency fact.
 */
function buildSeries(
  rows: readonly PreparedRow[],
  buckets: readonly MonthBucket[],
  currencies: readonly string[],
  coverage: Coverage,
): readonly SeriesPoint[] {
  const series = new Map<string, CurrencySeries>();
  for (const currency of currencies) {
    if (!isKnownCurrency(currency)) {
      continue;
    }
    series.set(currency, {
      totals: buckets.map(() => zeroMoney(currency)),
      counts: buckets.map(() => 0),
    });
  }

  for (const prepared of rows) {
    const currencySeries = series.get(prepared.row.amount.currency);
    const index = prepared.monthIndex;
    if (currencySeries === undefined) {
      continue;
    }
    const total = currencySeries.totals[index];
    if (total === undefined) {
      continue;
    }
    currencySeries.totals[index] = addMinor(total, prepared.row.amount);
    currencySeries.counts[index] = (currencySeries.counts[index] ?? 0) + 1;
  }

  const points: SeriesPoint[] = [];
  for (const currency of currencies) {
    const currencySeries = series.get(currency);
    if (currencySeries === undefined) {
      continue;
    }
    for (const [index, bucket] of buckets.entries()) {
      const count = currencySeries.counts[index] ?? 0;
      const total = currencySeries.totals[index];
      const recorded = count > 0 && total !== undefined;
      points.push({
        bucketStart: bucket.start,
        bucketEnd: bucket.end,
        currency,
        value: recorded
          ? statedValue(total.minorUnits, coverage)
          : { minorUnits: null, valueState: "unknown" },
        gap: !recorded,
      });
    }
  }
  return points;
}

/**
 * The row window a result carries.
 *
 * A present page yields the rows for that page and the page identity beside them, with the size clamped
 * to the list's own bounds. An absent page yields every authorised row and no page identity at all,
 * which is exactly the shape the CSV writer and the print model read: the export of a filtered query
 * contains the whole result rather than the page someone happened to be looking at.
 */
function windowRows(rows: readonly ReportRow[], page: ReportQuery["page"]): WindowedRows {
  if (page === undefined) {
    return { rows };
  }
  const size = clampPageSize(page.size);
  const totalPages = rows.length === 0 ? 0 : Math.ceil(rows.length / size);
  const start = page.index * size;
  return { rows: rows.slice(start, start + size), page: { index: page.index, size, totalPages } };
}

/** Copies one authorised row into the result's row shape, stating only the facts the row carries. */
function toReportRow(row: GiftRow): ReportRow {
  return {
    giftRowId: row.giftRowId,
    giftId: row.giftId,
    amount: row.amount,
    datePrecision: row.datePrecision,
    attribution: row.attribution,
    provenance: row.provenance,
    entryOn: row.entryOn,
    ...(row.allocationId === undefined ? {} : { allocationId: row.allocationId }),
    ...(row.originalGiftOn === undefined ? {} : { originalGiftOn: row.originalGiftOn }),
    ...(row.designation === undefined ? {} : { designation: row.designation }),
    ...(row.refundOf === undefined ? {} : { refundOf: row.refundOf }),
  };
}

// ---------------------------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------------------------

/** What a comparison is built from: the two periods, the coverage, and the two authorised row sets. */
interface ComparisonInput {
  readonly period: PeriodRange;
  readonly baseline: PeriodRange;
  readonly coverage: Coverage;
  readonly current: readonly PreparedRow[];
  readonly baselineRows: readonly PreparedRow[];
}

/**
 * Builds the signed difference between two equal-elapsed periods and the contributor changes that
 * reconcile it.
 *
 * Every figure is per currency, and a currency this application holds no exponent for is absent from the
 * comparison entirely: its amounts cannot be stated, so they cannot be differenced either, and it stays
 * visible in the summary as an unknown-currency fact rather than being given an assumed precision. The
 * difference is current minus baseline, so a supporter who gave more contributes a positive delta, and
 * `reconciles` reports whether the deltas of each currency add up to that currency's difference exactly.
 * When they do not, `reconciles` is false and no balancing entry is invented to hide it.
 */
function buildComparison(input: ComparisonInput): ReportComparison {
  const current = sumKnownByCurrency(input.current);
  const baseline = sumKnownByCurrency(input.baselineRows);
  const currencies = [...new Set([...current.keys(), ...baseline.keys()])].sort(compareIdentifiers);

  const perCurrency = currencies.map((currency) => {
    const currentMoney = current.get(currency) ?? zeroMoney(currency);
    const baselineMoney = baseline.get(currency) ?? zeroMoney(currency);
    const difference = addMinor(currentMoney, negateMinor(baselineMoney));
    return {
      currency,
      currentMinor: currentMoney.minorUnits,
      baselineMinor: baselineMoney.minorUnits,
      differenceMinor: difference.minorUnits,
      direction: directionOf(difference.minorUnits),
      valueState: comparisonValueState(currentMoney, baselineMoney, input.coverage),
    };
  });

  const contributorDeltas = buildContributorDeltas(input.current, input.baselineRows);

  return {
    current: { from: input.period.from, to: input.period.to },
    baseline: { from: input.baseline.from, to: input.baseline.to },
    equalElapsed:
      daysInclusive(input.period.from, input.period.to) ===
      daysInclusive(input.baseline.from, input.baseline.to),
    perCurrency,
    contributorDeltas,
    reconciles: reconciles(perCurrency, contributorDeltas),
  };
}

/** Sums a row set per known currency, through the money module, and never across two currencies. */
function sumKnownByCurrency(rows: readonly PreparedRow[]): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const { row } of rows) {
    const currency = row.amount.currency;
    if (!isKnownCurrency(currency)) {
      continue;
    }
    const current = totals.get(currency);
    totals.set(currency, current === undefined ? row.amount : addMinor(current, row.amount));
  }
  return totals;
}

/** Which way a difference points, stated as a direction rather than as a sign a reader must decode. */
function directionOf(minorUnits: MinorUnits): "increase" | "decrease" | "unchanged" {
  const units: number = minorUnits;
  if (units > 0) {
    return "increase";
  }
  return units < 0 ? "decrease" : "unchanged";
}

/** The state of one currency's comparison, derived from coverage and from whether either side moved. */
function comparisonValueState(current: Money, baseline: Money, coverage: Coverage): ValueState {
  if (coverage.state === "unknown") {
    return "unknown";
  }
  if (coverage.state === "partial") {
    return "incomplete-subtotal";
  }
  return compareMinor(current, zeroMoney(current.currency)) === 0 &&
    compareMinor(baseline, zeroMoney(baseline.currency)) === 0
    ? "zero"
    : "value";
}

/** One contributor's two running totals while the comparison is built. */
interface ContributorAccumulator {
  readonly attribution: GiftAttribution;
  readonly current: Map<string, Money>;
  readonly baseline: Map<string, Money>;
}

/** The attribution order every delta list and matrix follows: partner, anonymous, unattributed. */
const ATTRIBUTION_ORDER = [
  "partner",
  "anonymous",
  "unresolved",
] as const satisfies readonly GiftAttribution["kind"][];

/**
 * The contributor deltas: one entry per attribution and currency whose amount changed between the two
 * periods.
 *
 * A contributor is an attribution, not a name: a partner row names its partner reference, and anonymous
 * and unattributed support each appear as themselves, so the deltas reconcile to the difference without
 * giving identifiable support an identity it does not have. An unchanged contributor is omitted, and a
 * currency with no exponent is absent, matching the comparison it reconciles.
 */
function buildContributorDeltas(
  current: readonly PreparedRow[],
  baselineRows: readonly PreparedRow[],
): readonly ContributorDelta[] {
  const accumulators = new Map<string, ContributorAccumulator>();
  for (const row of current) {
    accumulateContributor(accumulators, row, "current");
  }
  for (const row of baselineRows) {
    accumulateContributor(accumulators, row, "baseline");
  }

  const deltas: ContributorDelta[] = [];
  for (const accumulator of accumulators.values()) {
    const currencies = [
      ...new Set([...accumulator.current.keys(), ...accumulator.baseline.keys()]),
    ].sort(compareIdentifiers);
    for (const currency of currencies) {
      const currentMoney = accumulator.current.get(currency) ?? zeroMoney(currency);
      const baselineMoney = accumulator.baseline.get(currency) ?? zeroMoney(currency);
      const difference = addMinor(currentMoney, negateMinor(baselineMoney));
      if (difference.minorUnits === 0) {
        continue;
      }
      deltas.push({
        currency,
        minorUnits: difference.minorUnits,
        attribution: accumulator.attribution,
        ...(accumulator.attribution.kind === "partner"
          ? { partnerId: accumulator.attribution.partnerId }
          : {}),
      });
    }
  }
  return deltas.sort(compareContributorDeltas);
}

/** Adds one row's amount to its attribution's running total for the period it belongs to. */
function accumulateContributor(
  accumulators: Map<string, ContributorAccumulator>,
  prepared: PreparedRow,
  slot: "current" | "baseline",
): void {
  const row = prepared.row;
  const currency = row.amount.currency;
  if (!isKnownCurrency(currency)) {
    return;
  }
  const accumulator = contributorFor(accumulators, row.attribution);
  const totals = slot === "current" ? accumulator.current : accumulator.baseline;
  const running = totals.get(currency);
  totals.set(currency, running === undefined ? row.amount : addMinor(running, row.amount));
}

/** Reads one attribution's accumulator, creating it on first sight of that attribution. */
function contributorFor(
  accumulators: Map<string, ContributorAccumulator>,
  attribution: GiftAttribution,
): ContributorAccumulator {
  const key = attributionKey(attribution);
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: ContributorAccumulator = {
    attribution,
    current: new Map<string, Money>(),
    baseline: new Map<string, Money>(),
  };
  accumulators.set(key, created);
  return created;
}

/** Orders deltas by currency, then by attribution, then by partner reference, so the list is stable. */
function compareContributorDeltas(left: ContributorDelta, right: ContributorDelta): number {
  const byCurrency = compareIdentifiers(left.currency, right.currency);
  if (byCurrency !== 0) {
    return byCurrency;
  }
  const leftKind = left.attribution?.kind ?? "partner";
  const rightKind = right.attribution?.kind ?? "partner";
  const byKind = ATTRIBUTION_ORDER.indexOf(leftKind) - ATTRIBUTION_ORDER.indexOf(rightKind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareIdentifiers(left.partnerId ?? "", right.partnerId ?? "");
}

/** Whether the contributor deltas of every currency add up exactly to that currency's difference. */
function reconciles(
  perCurrency: ReportComparison["perCurrency"],
  deltas: readonly ContributorDelta[],
): boolean {
  for (const entry of perCurrency) {
    let total = zeroMoney(entry.currency);
    for (const delta of deltas) {
      if (delta.currency !== entry.currency) {
        continue;
      }
      total = addMinor(total, { currency: delta.currency, minorUnits: delta.minorUnits });
    }
    if (
      compareMinor(total, { currency: entry.currency, minorUnits: entry.differenceMinor }) !== 0
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

/** What the matrix is built from: the query, the months, the currencies and the authorised rows. */
interface MatrixInput {
  readonly query: ReportQuery;
  readonly buckets: readonly MonthBucket[];
  readonly currencies: readonly string[];
  readonly rows: readonly PreparedRow[];
  readonly coverage: Coverage;
}

/** One attribution's running totals while the matrix is built, per currency and per month. */
interface MatrixAccumulator {
  readonly attribution: GiftAttribution;
  readonly totals: Map<string, (Money | undefined)[]>;
  readonly counts: Map<string, number[]>;
}

/** The label an unattributed matrix row carries when no partner identity exists to label it with. */
const ANONYMOUS_LABEL = "Anonymous support";

/** The label an unidentifiable source row carries, kept distinct from anonymous support. */
const UNRESOLVED_LABEL = "Unattributed support";

/**
 * Builds the partner-by-month matrix: one row per attribution, one cell per currency per month.
 *
 * A cell states its currency because a cell is a sum, and a sum of two currencies is not a number; the
 * matrix therefore holds a currency's cell set rather than one cell per month, and no cell ever crosses
 * codes. Each cell carries the query that opens the records behind it, narrowed to that cell's month and
 * attribution with no page window, so a drilldown's rows are a subset of the same result's authorised
 * rows and its sums add to the cell. A cell in which the source recorded no authorised row is a gap with
 * no amount — never a zero — and its drilldown honestly returns nothing.
 *
 * The matrix is partner-grain, so anonymous and unattributed support appear as their own rows rather
 * than being folded into a partner: the matrix must reconcile with the summary of the same result, and
 * support that carries no identity cannot be given one to make a table add up.
 */
function buildMatrix(input: MatrixInput): Matrix {
  const accumulators = new Map<string, MatrixAccumulator>();
  const bucketCount = input.buckets.length;

  for (const prepared of input.rows) {
    const row = prepared.row;
    const accumulator = matrixAccumulatorFor(accumulators, row.attribution);
    const currency = row.amount.currency;
    const index = prepared.monthIndex;
    if (index < 0 || index >= bucketCount) {
      continue;
    }
    const counts = bucketCountsFor(accumulator.counts, currency, bucketCount);
    counts[index] = (counts[index] ?? 0) + 1;
    if (!isKnownCurrency(currency)) {
      continue;
    }
    const totals = bucketTotalsFor(accumulator.totals, currency, bucketCount);
    const running = totals[index];
    totals[index] = running === undefined ? row.amount : addMinor(running, row.amount);
  }

  const rows = [...accumulators.values()]
    .map((accumulator) => ({
      ...(accumulator.attribution.kind === "partner"
        ? { partnerId: accumulator.attribution.partnerId }
        : {}),
      attribution: accumulator.attribution,
      label: labelOf(accumulator.attribution),
      cells: buildMatrixCells(accumulator, input),
    }))
    .sort(compareMatrixRows);

  return {
    currencies: input.currencies,
    months: input.buckets.map((bucket) => ({ start: bucket.start, end: bucket.end })),
    rows,
  };
}

/** Reads an attribution's matrix accumulator, creating it on first sight of that attribution. */
function matrixAccumulatorFor(
  accumulators: Map<string, MatrixAccumulator>,
  attribution: GiftAttribution,
): MatrixAccumulator {
  const key = attributionKey(attribution);
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: MatrixAccumulator = {
    attribution,
    totals: new Map<string, (Money | undefined)[]>(),
    counts: new Map<string, number[]>(),
  };
  accumulators.set(key, created);
  return created;
}

/** The per-month totals of one currency, one slot per month bucket. */
function bucketTotalsFor(
  totals: Map<string, (Money | undefined)[]>,
  currency: string,
  bucketCount: number,
): (Money | undefined)[] {
  const existing = totals.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created = Array.from({ length: bucketCount }, (): Money | undefined => undefined);
  totals.set(currency, created);
  return created;
}

/** The per-month row counts of one currency, one slot per month bucket. */
function bucketCountsFor(
  counts: Map<string, number[]>,
  currency: string,
  bucketCount: number,
): number[] {
  const existing = counts.get(currency);
  if (existing !== undefined) {
    return existing;
  }
  const created = Array.from({ length: bucketCount }, () => 0);
  counts.set(currency, created);
  return created;
}

/** Every cell of one matrix row, currency-major and month-minor, each carrying its own drilldown. */
function buildMatrixCells(
  accumulator: MatrixAccumulator,
  input: MatrixInput,
): readonly MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const currency of input.currencies) {
    const counts = accumulator.counts.get(currency);
    const totals = accumulator.totals.get(currency);
    for (const [index, bucket] of input.buckets.entries()) {
      const count = counts?.[index] ?? 0;
      const total = totals?.[index];
      const recorded = count > 0 && total !== undefined;
      cells.push({
        bucketStart: bucket.start,
        bucketEnd: bucket.end,
        currency,
        value: recorded
          ? statedValue(total.minorUnits, input.coverage)
          : { minorUnits: null, valueState: "unknown" },
        gap: !recorded,
        drilldown: {
          ...input.query,
          period: { kind: "explicit", from: bucket.start, to: bucket.end },
          partner: accumulator.attribution,
          currency: { kind: "one", currency },
          page: undefined,
        },
      });
    }
  }
  return cells;
}

/** The key an attribution is accumulated under: the partner's own reference, or the attribution kind. */
function attributionKey(attribution: GiftAttribution): string {
  return attribution.kind === "partner" ? `partner:${attribution.partnerId}` : attribution.kind;
}

/** The fallback label of a matrix row; a partner row labels itself with its opaque reference. */
function labelOf(attribution: GiftAttribution): string {
  switch (attribution.kind) {
    case "partner":
      return attribution.partnerId;
    case "anonymous":
      return ANONYMOUS_LABEL;
    default:
      return UNRESOLVED_LABEL;
  }
}

/** Orders matrix rows: partner rows by their reference, then anonymous, then unattributed support. */
function compareMatrixRows(left: MatrixRow, right: MatrixRow): number {
  const byKind =
    ATTRIBUTION_ORDER.indexOf(left.attribution.kind) -
    ATTRIBUTION_ORDER.indexOf(right.attribution.kind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareIdentifiers(left.partnerId ?? "", right.partnerId ?? "");
}

// ---------------------------------------------------------------------------------------------
// The goal
// ---------------------------------------------------------------------------------------------

/**
 * States the goal's progress, delegating the percentage to `./goal`.
 *
 * The numerator is the received support of this query's period in the goal's own currency, because a
 * goal is a target for money that arrives and is compared with received gifts and with nothing else. A
 * query restricted to another currency cannot state it, so the figure is reported as incompatible rather
 * than computed from a different currency's amount; a period in which the source recorded nothing in the
 * goal's currency yields a genuine zero only when the coverage is complete, because partial coverage
 * cannot tell an empty period from an uncovered one. No percentage is computed here: this function hands
 * the exact minor units to `./goal`, which owns the ratio, the states and the 120% rule.
 */
function buildGoal(
  goal: SupportGoalRecord,
  summary: readonly CurrencySummary[],
  selection: CurrencySelection,
  coverage: Coverage,
): GoalProgress {
  const record = goalRecordOf(goal);
  const entry = summary.find((candidate) => candidate.currency === record.currency);
  const currencySelected = selection.kind === "all" || selection.currency === record.currency;

  let numerator: MinorUnits | undefined;
  if (currencySelected) {
    const received = entry?.received;
    if (received !== undefined) {
      numerator = received.minorUnits ?? undefined;
    } else if (coverage.state === "complete") {
      numerator = minorUnitsOf(0);
    }
  }

  return goalProgress({
    goal: record,
    measureCompatible: currencySelected,
    ...(numerator === undefined ? {} : { numeratorMinor: numerator }),
  });
}

/**
 * Reads the stored goal as the shape `./goal` computes from, refusing a goal that cannot be stated.
 *
 * The stored record holds its effective date as a civil-date string and its revision as a string; both
 * are read here, and a value that is not one is refused rather than defaulted, because a goal dated by
 * guess or saved against a revision nobody saw is a goal nobody can compare or safely edit. The stored
 * measure is the one received-support basis, which this report measures as received gifts, so the goal's
 * measure is that constant and not a second vocabulary.
 */
function goalRecordOf(goal: SupportGoalRecord): GoalRecord {
  const effectiveFrom = parseCivilDate(goal.effectiveFrom);
  if (effectiveFrom.status === "refused") {
    throw new TypeError(
      `Support goal effective date "${goal.effectiveFrom}" is not a civil date, so the goal cannot be measured against a period. The value is refused rather than replaced by today.`,
    );
  }
  const revision = Number(goal.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError(
      `Support goal revision "${goal.revision}" is not a positive whole revision, so no goal is presented against a revision nobody read.`,
    );
  }
  return {
    minorUnits: goal.amount.minorUnits,
    currency: goal.amount.currency,
    measure: GOAL_MEASURE,
    effectiveFrom: effectiveFrom.date,
    revision,
  };
}

// ---------------------------------------------------------------------------------------------
// The value-state map
// ---------------------------------------------------------------------------------------------

/** What the value-state map is collected from: every part of the result that carries a value. */
interface ValueStateInput {
  readonly summary: readonly CurrencySummary[];
  readonly series: readonly SeriesPoint[];
  readonly rows: readonly ReportRow[];
  readonly comparison?: ReportComparison;
  readonly matrix?: Matrix;
}

/**
 * Records the state of every value-bearing path in the result, so no surface decides for itself what a
 * number means.
 *
 * The keys are the paths a component reads: a summary amount or count by currency, a series point by
 * currency and month, a row amount by its position in the window, a comparison figure by currency and a
 * matrix cell by attribution, currency and month. A row's own amount is an exact recorded fact, so its
 * state is `value` or a genuine `zero`; the coverage-derived states belong to the subtotals built from
 * rows, which is where a partial period has to announce itself.
 */
function collectValueStates(input: ValueStateInput): Readonly<Record<string, ValueState>> {
  const states: Record<string, ValueState> = {};

  for (const entry of input.summary) {
    states[`summary.${entry.currency}.received`] = entry.received.valueState;
    states[`summary.${entry.currency}.giftCount`] = entry.giftCount.valueState;
    states[`summary.${entry.currency}.allocationCount`] = entry.allocationCount.valueState;
    states[`summary.${entry.currency}.donorCount`] = entry.donorCount.valueState;
  }

  for (const point of input.series) {
    states[`series.${point.currency}.${serialiseCivilDate(point.bucketStart)}`] =
      point.value.valueState;
  }

  input.rows.forEach((row, index) => {
    states[`rows.${index}.amount`] = row.amount.minorUnits === 0 ? "zero" : "value";
  });

  const comparison = input.comparison;
  if (comparison !== undefined) {
    for (const entry of comparison.perCurrency) {
      states[`comparison.${entry.currency}.current`] = entry.valueState;
      states[`comparison.${entry.currency}.baseline`] = entry.valueState;
      states[`comparison.${entry.currency}.difference`] = entry.valueState;
    }
  }

  const matrix = input.matrix;
  if (matrix !== undefined) {
    for (const row of matrix.rows) {
      const key = row.partnerId ?? row.attribution.kind;
      for (const cell of row.cells) {
        states[`matrix.${key}.${cell.currency}.${serialiseCivilDate(cell.bucketStart)}`] =
          cell.value.valueState;
      }
    }
  }

  return states;
}
