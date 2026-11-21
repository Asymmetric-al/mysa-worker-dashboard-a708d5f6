/**
 * The closed catalogue of this application's four fixed reports: the identity each one is addressed
 * by, the order every surface lists them in, the layout that renders it, the identity the report
 * engine computes it under, and the title and sentence that describe it.
 */
import { REPORT_COPY } from "./copy";
import type { ReportQuery } from "@/modules/support/report";
// The four report identities
/** The four report identities, exactly as the `[reportId]` URL segment carries them: received support, monthly history, the partner-by-month matrix and period comparison. */
export type ReportId = "received" | "history" | "matrix" | "comparison";
/** The four identities in the fixed order every surface presents them: received support, then monthly history, then the matrix, then the comparison. */
export const REPORT_ORDER = ["received", "history", "matrix", "comparison"] as const satisfies readonly ReportId[];
/** Which layout renders a report: one member per report, matching the four layout components this family owns. */
export type ReportLayout = "received" | "history" | "matrix" | "comparison";
// The catalogue
interface ReportEntry {
  readonly id: ReportId;
  readonly layout: ReportLayout;
  readonly queryId: ReportQuery["reportId"];
  readonly title: string;
  readonly description: string;
}
/** The four reports, keyed by identity so the record is exhaustive: a fifth member of {@link ReportId} fails to compile here until its layout, its engine identity and its wording exist. */
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
// The route's guard, and the two lookups every surface shares
/** Whether a `[reportId]` segment names one of the four reports. */
export function isReportId(value: string): value is ReportId {
  return REPORT_ORDER.some((id) => id === value);
}
/** The title of one report, for a heading, a tab, a breadcrumb and a print header. */
export function reportTitle(id: ReportId): string {
  return REPORT_CATALOG[id].title;
}
/** The address of one report, for the overview's links, the report switcher and the breadcrumb. */
export function reportHref(id: ReportId): string {
  return `/support/reports/${id}`;
}
