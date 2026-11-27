import type { CoverageState, ValueState } from "@/modules/data-service/envelope";
import { BASIS_DESCRIPTION, SUPPORT_MEASURE_LABELS, type SupportMeasure } from "@/modules/support/basis";
import type { CommitmentKind, RecurringBucket } from "@/modules/support/buckets";
export const SUPPORT_BASIS_STATEMENT: string = `Effective cash allocation — every received-support figure uses this single basis. ${BASIS_DESCRIPTION}`;
export const SUPPORT_GRAIN_STATEMENT: string =
  "Each row is one authorised allocation, or one whole gift if unsplit. Gift, allocation, and donor counts are tracked separately and never added together.";
export const COVERAGE_TEMPLATES: Readonly<Record<CoverageState, string>> = {
  complete: "Complete from {from} to {to} — covers the full period.",
  partial: "Partial ({from} to {to} only) — subtotals cover only this range and are marked incomplete.",
  unknown: "Coverage dates aren’t stated by the source, so subtotals aren’t shown as period totals.",
};
export const AS_OF_TEMPLATE: string = "Read as of {asOf} (when this snapshot was loaded, not when the source last updated).";
export const IN_PROGRESS_NOTE: string = "Period in progress — figures cover activity so far, and subtotals are marked incomplete.";
export const NO_PERCENTAGE_REASONS = ["no-goal", "zero-denominator", "unknown-denominator", "incompatible-measure"] as const;
export type NoPercentageReason = (typeof NO_PERCENTAGE_REASONS)[number];
export const NO_PERCENTAGE: Readonly<Record<NoPercentageReason | "default", string>> = {
  "no-goal": "No percentage is shown because no support goal is set yet.",
  "zero-denominator": "No percentage is shown because the goal amount is zero.",
  "unknown-denominator": "No percentage is shown because the comparison amount isn’t available from the source.",
  "incompatible-measure": "No percentage is shown because the goal and this figure measure different things and aren’t divided by one another.",
  default: "No percentage is shown without a matching figure and a known positive baseline. Valid percentages over 100% are shown as computed and never capped.",
};
/** The goal form's currency choice, offered only where the read reports more than one currency for the subject. */
export const GOAL_CURRENCY_CHOICE = {
  unset: "Choose a currency",
  unchosen: "currency not chosen yet",
  awaitingCurrency: "Choose a currency first so the amount matches its decimal precision.",
  guidance: "Your support is reported in more than one currency. Choose which currency to set this goal in.",
} as const;
/** What the goal form states when the read reports no currency it holds an exact minor-unit precision for. */
export const GOAL_CURRENCY_UNSTATED: { readonly title: string; readonly body: string } = {
  title: "No supported currency available",
  body: "The source doesn’t report a currency with a known decimal precision for this account, so a goal can’t be saved until one is available.",
};
export const BUCKET_MEANING: Readonly<Record<RecurringBucket, string>> = {
  received: "Settled collection recorded by the source — counted as received cash.",
  processing: "Collection is still in progress and isn’t counted as received cash yet.",
  upcoming: "Scheduled for a future date and not due yet.",
  "recovery-needs-attention": "Collection needs attention at the payment source. Mysa can’t retry or edit payments directly.",
  "not-received": "No receipt recorded for this occurrence. This notes an absent receipt, not a debt or judgment about the partner.",
  "outside-partition": "Evidence is unknown or stale, so this commitment stays outside the five status buckets rather than being guessed.",
};
export const VALUE_STATE_MEANING: Readonly<Record<ValueState, string>> = {
  value: "Recorded by the source for the coverage shown.",
  zero: "Explicit zero recorded by the source — distinct from missing data.",
  unknown: "Not established by the source — shown as unknown rather than zero.",
  withheld: "Recorded in the source, but hidden in this view and excluded from totals.",
  unavailable: "Couldn’t load this value from the source right now — shown as unavailable rather than zero.",
  "incomplete-subtotal": "Based on partial period coverage — shown as an incomplete subtotal rather than a full total.",
};
/** How a count stated beside a figure reads, per value state: a count taken over partial coverage says so rather than reading as a whole count. */
export const COUNT_STATE_NOTE: Readonly<Record<ValueState, string | null>> = {
  value: null,
  zero: "recorded zero",
  unknown: "unknown",
  withheld: "withheld",
  unavailable: "unavailable",
  "incomplete-subtotal": "partial coverage",
};
export const MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = SUPPORT_MEASURE_LABELS;
export const COMMITMENT_KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  "automatic-recurring": "Automatic recurring",
  "manual-recurring": "Manual recurring",
  "fixed-total": "Fixed total",
};
export const FIXED_TOTAL_FIELDS = [
  { field: "promised", label: "Promised" },
  { field: "fulfilled", label: "Fulfilled" },
  { field: "released", label: "Released" },
  { field: "remaining", label: "Remaining" },
] as const;
export type ReportCopyKey = "received" | "history" | "matrix" | "comparison";
export type ReportCopy = { readonly title: string; readonly description: string };
export const REPORT_COPY: Readonly<Record<ReportCopyKey, ReportCopy>> = {
  received: {
    title: "Received support",
    description: "Monthly and year-to-date cash received, compared against an equal-length prior period.",
  },
  history: {
    title: "Monthly history",
    description: "Month-by-month giving for a selected year, showing uncovered months as gaps rather than zeros.",
  },
  matrix: {
    title: "Partners by month",
    description: "Giving broken down by partner and month. Select any amount to view the underlying gifts.",
  },
  comparison: {
    title: "Period comparison",
    description: "Side-by-side difference between two periods with the partner changes that explain it.",
  },
};
export const REPORT_NOT_FOUND: EmptyStateCopy = {
  title: "Report not found",
  body: "That address doesn’t match one of the four support reports. Choose a report below or open Received support.",
  action: { label: "Open Received support report", href: "/support/reports/received" },
};
export type ChartCaptionTemplates = { readonly unit: string; readonly coverage: string; readonly asOf: string; readonly summaryOpener: string };
export const CHART_CAPTIONS: ChartCaptionTemplates = {
  unit: "Amounts in {currency}. Currencies are always shown separately and never combined.",
  coverage: "{coverage} Months without source coverage appear as gaps rather than zeros.",
  asOf: AS_OF_TEMPLATE,
  summaryOpener: "{series} ({currency}): {takeaway}",
};
export type SupportEmptySurface = "gifts" | "commitments" | "monthlyEquivalents" | "goal" | "reports";
export type EmptyStateAction = { readonly label: string; readonly href: string };
export type EmptyStateCopy = { readonly title: string; readonly body: string; readonly action: EmptyStateAction; readonly secondary?: EmptyStateAction };
export const EMPTY_STATES: Readonly<Record<SupportEmptySurface, EmptyStateCopy>> = {
  gifts: {
    title: "No gifts match these filters",
    body: "No gifts were found for this period and filter set. Uncovered periods appear as gaps rather than zeros — try widening the period or clearing filters.",
    action: { label: "Clear filters", href: "/support/gifts" },
  },
  commitments: {
    title: "No commitments reported",
    body: "Commitments come read-only from your giving source and aren’t counted as received cash.",
    action: { label: "View received gifts", href: "/support/gifts" },
  },
  monthlyEquivalents: {
    title: "No monthly equivalents supplied",
    body: "Your giving source reports {count} commitments but doesn’t provide a monthly-equivalent figure for them. Mysa displays source-calculated equivalents only and doesn’t estimate them.",
    action: { label: "View commitments", href: "/support/commitments" },
  },
  goal: {
    title: "No support goal set",
    body: "Setting a support goal is optional. Until you add one, no goal percentage is shown.",
    action: { label: "View received support", href: "/support" },
    secondary: { label: "Set support goal", href: "/support" },
  },
  reports: {
    title: "No report data to show",
    body: "All four reports use the same verified figures as your Support overview.",
    action: { label: "Open Received support report", href: "/support/reports/received" },
  },
};
/** What the monthly-equivalent view states when the source reports no commitment at all. */
export const MONTHLY_EQUIVALENT_NO_COMMITMENTS: string =
  "Your giving source reports no commitments right now, so there are no monthly equivalents to display.";
export type GivingFollowUpCopy = { readonly actionLabel: string; readonly description: string; readonly resultNote: string };
export const GIVING_FOLLOW_UP: GivingFollowUpCopy = {
  actionLabel: "Create thank-you task",
  description: "Adds a normal follow-up task to your Tasks list. It doesn’t edit the gift, send an email, or change financial records.",
  resultNote: "Thank-you task added to your Tasks list. The gift record itself wasn’t changed.",
};
export type TemplateSegment = string | { readonly slot: string; readonly value: string | undefined };
const TEMPLATE_SLOT = /\{(\w+)\}/; /** Splits a template into its own words and its `{slot}`s, in order, and substitutes nothing. */
export const templateSegments = (template: string, values: Readonly<Record<string, string>>): readonly TemplateSegment[] => template.split(TEMPLATE_SLOT).map((part, index) => (index % 2 === 0 ? part : { slot: part, value: values[part] }));
/** Fills a template's `{slot}`s from the values supplied, and changes nothing else. */ export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return templateSegments(template, values)
    .map((segment) => (typeof segment === "string" ? segment : (segment.value ?? `{${segment.slot}}`)))
    .join("");
}
