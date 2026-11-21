/**
 * The closed catalogue of this application's four fixed reports: the identity each one is addressed
 * by, the order every surface lists them in, the layout that renders it, the identity the report
 * engine computes it under, and the title and sentence that describe it.
 *
 * Why it is declared once. Five surfaces need the same four identities and the same four titles: the
 * overview's report links, the report frame's heading, the `[reportId]` validation inside
 * `app/support/reports/[reportId]/page.tsx`, the breadcrumb back to the report list, and the print
 * header. Written out in each of those places they drift, and a heading that names one report over a
 * download that names another is how a figure stops being trustworthy. `reportHref` exists for the
 * same reason: a link built in one place and a breadcrumb built in another can disagree about which
 * report the reader is looking at.
 *
 * A closed catalogue, never a registry. AAP 0.8.1 fixes the reporting surface at exactly four
 * reports — received support with an equal-elapsed-period comparison, one chosen year's monthly
 * history, the partner-by-month matrix with cell drilldown, and period comparison — and AAP 0.10.2
 * excludes both a report designer and a fifth report. There is therefore no function that adds a
 * report at runtime, no registration step, no persisted report definition, and no entry, template or
 * string that names a report this release does not compute. An identity exists only as a member of
 * {@link ReportId}, so adding one is a compile error here until it has a layout, an engine identity
 * and its wording.
 *
 * Two identities, kept apart and bridged in one place. The URL identity ({@link ReportId}, the entry's
 * `id`) is the short segment a person sees and a bookmark keeps, and it is also the key `REPORT_COPY`
 * words, so this catalogue and the family's wording source are exhaustive over the same four names.
 * The engine identity (the entry's `queryId`) is the report engine's own `ReportQuery["reportId"]`,
 * which the engine switches on to decide which figures to compute. The two are not merged: the slug
 * is stable because bookmarks outlive internals, while the engine's union belongs to
 * `modules/support/report`. The bridge is `queryId`, typed as that field rather than as a string, so
 * a slug pointed at a report the engine does not compute fails to compile and the catalogue cannot
 * drift from the engine by spelling an identity of its own.
 *
 * What this file does not do, deliberately. It builds no query, states no period, computes no year
 * list, sorts no report data and reads no clock — the period, the currency, the filters and the
 * snapshot identity are the route's and the service's to build, and `readReport` computes from them.
 * It formats no amount and states no percentage: a report's figures are integers of minor units,
 * formatted on the surface from `modules/money/format`. It authors no wording: every title and
 * description is `REPORT_COPY`'s, imported rather than retyped, so a reworded report is reworded once
 * for all six artifacts. It names no component: a catalogue that imported the four layouts would be a
 * registry of renderers and would import-cycle with them, so the route switches on {@link ReportLayout}
 * — a closed data discriminator — and picks the component itself.
 *
 * What each report is, and what none of them proves. Every description states that report's own unit,
 * period, grain and denominator, so no surface can present one report as another: monthly history
 * counts months, the matrix counts partners by month with each cell opening the records behind it,
 * period comparison states a signed difference against the same basis, and received support states a
 * period against an equal-elapsed one so a partial period is never set against a whole one. A report
 * reads money and proposes no change to it: no entry here creates a gift, a pledge, a commitment, a
 * task, a message or a stewardship obligation, and none of the four is a total of another (AAP 0.8.8).
 *
 * Plan items: AAP 0.8.1 (the four fixed reports, and no report designer), AAP 0.8.8 (grain, basis,
 * currency, period, coverage and as-of agreed across every surface), AAP 0.6.4 ("How is support
 * going?"), the AAP 0.9.1 route `app/support/reports/[reportId]/page.tsx` and the AAP 0.11.1 row
 * `features/support/**`. Rule 1 clause 1 is why the set is closed at four, and clause 2 is why the
 * wording and the engine identity are imported rather than restated here.
 */

import { REPORT_COPY } from "./copy";
import type { ReportQuery } from "@/modules/support/report";

// ---------------------------------------------------------------------------------------------
// The four report identities
// ---------------------------------------------------------------------------------------------

/**
 * The four report identities, exactly as the `[reportId]` URL segment carries them: received support,
 * monthly history, the partner-by-month matrix and period comparison.
 *
 * The set is closed and written out rather than derived from a string, so a fifth report is a change
 * to a union the compiler checks everywhere it is consumed — this catalogue, the route's guard and
 * any `switch` over a layout — instead of a value that appears in one list and is validated nowhere.
 * These are also the four keys `REPORT_COPY` words and the four segments {@link reportHref} builds a
 * path from, which is what keeps the three in agreement.
 */
export type ReportId = "received" | "history" | "matrix" | "comparison";

/**
 * The four identities in the fixed order every surface presents them: received support, then monthly
 * history, then the matrix, then the comparison.
 *
 * The order is a product decision and not a sort, so no consumer may reorder it: alphabetically, by
 * recency or by amount it would present a different navigation, a different tab strip and a
 * different print sequence from the one the report family is designed around. It is declared as a
 * tuple so the navigation, the tab strip and the print header iterate one array, and
 * {@link isReportId} answers from this same list rather than from a second copy of the names.
 */
export const REPORT_ORDER = [
  "received",
  "history",
  "matrix",
  "comparison",
] as const satisfies readonly ReportId[];

/**
 * Which layout renders a report: one member per report, matching the four layout components this
 * family owns.
 *
 * It exists so the route switches on data — the catalogue's `layout` — instead of comparing a URL
 * segment against a string literal, and so a `switch` over it is exhaustive: a report without a
 * layout, or a layout without a report, is a compile error rather than a silently empty page. The
 * four members coincide with {@link ReportId} in this release because each report has its own layout;
 * the unions stay separate so a presentation can change without moving a URL that bookmarks keep.
 */
export type ReportLayout = "received" | "history" | "matrix" | "comparison";

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/**
 * One report as every surface needs it: where it is addressed, how it is presented, what the report
 * engine computes for it, and how it is named.
 *
 * Not exported, because the type of a catalogue entry is `(typeof REPORT_CATALOG)[ReportId]`: a
 * consumer that needs to name it derives it from the catalogue, so the shape is described once.
 */
interface ReportEntry {
  /** The URL identity: the `[reportId]` segment, and the key this catalogue is indexed by. */
  readonly id: ReportId;
  /** The layout the route renders, stated as closed data rather than as a component. */
  readonly layout: ReportLayout;
  /**
   * The identity the report engine computes under — the value that goes into
   * `ReportQuery.reportId`. Typed as that field rather than as a string, so a slug that points at a
   * report the engine does not compute is a compile error here.
   */
  readonly queryId: ReportQuery["reportId"];
  /** The title a heading, a tab, a breadcrumb and a print header all print. */
  readonly title: string;
  /** One sentence saying what the report is and what it refuses to do. */
  readonly description: string;
}

/**
 * The four reports, keyed by identity so the record is exhaustive: a fifth member of
 * {@link ReportId} fails to compile here until its layout, its engine identity and its wording exist.
 *
 * Every title and description is `REPORT_COPY`'s, imported rather than retyped, so the sentence a
 * reader sees beside a link is the sentence the report prints, and the sentence the print header
 * repeats. Nothing here builds a query, states a period or holds a figure: the route composes an
 * entry with the period, currency and filters the reader asked for, and `readReport` computes from
 * those, so this file can neither invent a total nor disagree with one.
 */
export const REPORT_CATALOG: Readonly<Record<ReportId, ReportEntry>> = {
  received: {
    id: "received",
    layout: "received",
    queryId: "received-period-and-year-to-date",
    title: REPORT_COPY.received.title,
    description: REPORT_COPY.received.description,
  },
  history: {
    id: "history",
    layout: "history",
    queryId: "monthly-history",
    title: REPORT_COPY.history.title,
    description: REPORT_COPY.history.description,
  },
  matrix: {
    id: "matrix",
    layout: "matrix",
    queryId: "partner-month-matrix",
    title: REPORT_COPY.matrix.title,
    description: REPORT_COPY.matrix.description,
  },
  comparison: {
    id: "comparison",
    layout: "comparison",
    queryId: "period-comparison",
    title: REPORT_COPY.comparison.title,
    description: REPORT_COPY.comparison.description,
  },
};

// ---------------------------------------------------------------------------------------------
// The route's guard, and the two lookups every surface shares
// ---------------------------------------------------------------------------------------------

/**
 * Whether a `[reportId]` segment names one of the four reports.
 *
 * This is the route's own guard: Next hands the segment over as a plain string, and a stale
 * bookmark, a hand-typed address or a mistyped link can carry anything. A `true` answer narrows it to
 * {@link ReportId} so the catalogue can be indexed; a `false` answer is the route's cue to refuse the
 * request honestly — `notFound()`, or `REPORT_NOT_FOUND` in a `state-notice` — because falling back
 * to `received` would answer a question the reader did not ask, with figures that look like the
 * answer. Nothing here guesses, and no caller may treat an unrecognised segment as the first report.
 *
 * Answered from {@link REPORT_ORDER} with a comparison rather than a widened `includes` call, so the
 * literals are compared as themselves and no cast is needed to test an arbitrary string against them.
 */
export function isReportId(value: string): value is ReportId {
  return REPORT_ORDER.some((id) => id === value);
}

/**
 * The title of one report, for a heading, a tab, a breadcrumb and a print header.
 *
 * Answered from the catalogue, which took it from `REPORT_COPY`, so all four surfaces print one
 * string. The parameter is a {@link ReportId} rather than a string on purpose: a caller must have
 * narrowed the segment with {@link isReportId} first, which is what keeps a raw URL segment from
 * reaching a heading.
 */
export function reportTitle(id: ReportId): string {
  return REPORT_CATALOG[id].title;
}

/**
 * The address of one report, for the overview's links, the report switcher and the breadcrumb.
 *
 * Built here and nowhere else, so a link and the heading it leads to cannot name different reports,
 * and so the two notices in `copy.ts` that point at `/support/reports/received` point at exactly the
 * address this function builds for `received`.
 */
export function reportHref(id: ReportId): string {
  return `/support/reports/${id}`;
}
