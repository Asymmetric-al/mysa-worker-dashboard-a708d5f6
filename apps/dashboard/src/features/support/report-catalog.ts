import { REPORT_COPY } from "./copy";
import type { ReportQuery } from "@/modules/support/report";
export type ReportId = "received" | "history" | "matrix" | "comparison";
export const REPORT_ORDER = ["received", "history", "matrix", "comparison"] as const satisfies readonly ReportId[];
export type ReportLayout = "received" | "history" | "matrix" | "comparison";
type ReportEntry = { readonly id: ReportId; readonly layout: ReportLayout; readonly queryId: ReportQuery["reportId"]; readonly title: string; readonly description: string };
export const REPORT_CATALOG: Readonly<Record<ReportId, ReportEntry>> = {
  received: { id: "received", layout: "received", queryId: "received-period-and-year-to-date", title: REPORT_COPY.received.title, description: REPORT_COPY.received.description },
  history: { id: "history", layout: "history", queryId: "monthly-history", title: REPORT_COPY.history.title, description: REPORT_COPY.history.description },
  matrix: { id: "matrix", layout: "matrix", queryId: "partner-month-matrix", title: REPORT_COPY.matrix.title, description: REPORT_COPY.matrix.description },
  comparison: { id: "comparison", layout: "comparison", queryId: "period-comparison", title: REPORT_COPY.comparison.title, description: REPORT_COPY.comparison.description },
};
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
