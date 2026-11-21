/**
 * The Support family's single wording source: the basis and the grain every financial figure is
 * reported on, the coverage and as-of identity the six artifacts share, the *In progress* and *no
 * percentage* notes, the explanations behind the five recurring outcomes and the six value states, the
 * five measure names, the four reports, the chart captions, the empty states and the thank-you
 * follow-up.
 */
import type { CoverageState, ValueState } from "@/modules/data-service/envelope";
import { BASIS_DESCRIPTION, SUPPORT_BASIS, SUPPORT_MEASURE_LABELS, type SupportMeasure } from "@/modules/support/basis";
import type { CommitmentKind, RecurringBucket } from "@/modules/support/buckets";
// The one basis, and the grain it counts at
/** The one basis statement every support surface states, built from the module that owns the basis. */
export const SUPPORT_BASIS_STATEMENT: string =
  `Every received-support figure in this family is reported on the one named basis this application ` + `measures, ${SUPPORT_BASIS}, and on no other. ${BASIS_DESCRIPTION}`;
/** The grain statement: what one row is, and why three counts are never added together. */
export const SUPPORT_GRAIN_STATEMENT: string =
  "One row is one authorised allocation, and a gift that carries no allocation is one row at gift " +
  "grain. Gift, allocation and donor counts are each counted at their own grain and are never added " +
  "together: a 100-unit gift split 40/60 shows only the allocation this read is authorised to see, " +
  "and a view that legitimately holds both grain levels counts the 100 once.";
// Coverage, as-of and the snapshot identity
/** One coverage sentence per coverage state, keyed by the envelope's own union so a fourth state cannot be added without being worded here. */
export const COVERAGE_TEMPLATES: Readonly<Record<CoverageState, string>> = {
  complete: "Coverage is complete from {from} to {to}: the source holds the whole period, so a subtotal over " + "it is a total of that period.",
  partial: "Coverage is partial: the source holds {from} to {to} only, so every subtotal over this period is " + "an incomplete subtotal and is labelled as one wherever it appears.",
  unknown: "Coverage is unknown: the source stated no covered range, so no subtotal here is presented as a " + "total, and no boundary is filled in with an assumed date.",
};
/** The as-of sentence: the instant a read was evaluated at, which is not when the source last changed. */
export const AS_OF_TEMPLATE: string = "As of {asOf} — the instant this read was evaluated, which is not when the source last changed.";
/** The snapshot identity line the six artifacts state, in one fixed order: query, basis, currency, period, coverage and as-of. */
export const SNAPSHOT_TEMPLATE: string = "Snapshot — query: {query}; basis: {basis}; currency: {currency}; period: {period}; coverage: " + "{coverage}; as of: {asOf}.";
// The two notes a figure can need
/** The note a current period carries, so a period that has not closed is never read as a final figure. */
export const IN_PROGRESS_NOTE: string =
  "In progress — this period has not closed, so its figures cover only the part of it that has " + "happened, and every subtotal over it is an incomplete subtotal.";
/** Why no percentage is shown, keyed by the four reasons the rule admits plus a `default` for a case that reaches a surface without one of them. */
export const NO_PERCENTAGE_REASONS = ["no-goal", "zero-denominator", "unknown-denominator", "incompatible-measure"] as const;
/** One reason a percentage is not shown. */
export type NoPercentageReason = (typeof NO_PERCENTAGE_REASONS)[number];
/** The sentence for one reason a percentage is not shown, plus the default for an unclassified one. */
export const NO_PERCENTAGE: Readonly<Record<NoPercentageReason | "default", string>> = {
  "no-goal": "No percentage is shown because no support goal is set. A missing goal and a goal of zero are " + "different facts, and neither is a denominator.",
  "zero-denominator": "No percentage is shown because the goal is zero, and a share of zero is undefined. Nothing is " + "divided by it and no figure is put in its place.",
  "unknown-denominator":
    "No percentage is shown because the denominator is not known. A value the source did not " + "establish cannot carry a percentage, so the percentage is left out rather than guessed.",
  "incompatible-measure":
    "No percentage is shown because the goal and the figure it would be compared with measure " +
    "different things. Received gifts, recurring collection outcomes, commitments, monthly-equivalent " +
    "support and the goal are five measures and are never divided by one another.",
  default:
    "No percentage is shown, because a percentage needs a compatible numerator and a positive, known " +
    "denominator. Where both exist the figure is shown exactly as it was computed, so a valid 120% " +
    "reads 120% and is never capped at 100%; where they do not exist, nothing stands in its place.",
};
// The recurring outcomes
/** What each recurring outcome means, keyed by the bucket union so a sixth in-partition outcome — or a renamed `outside-partition` — fails to compile until it is explained here. */
export const BUCKET_MEANING: Readonly<Record<RecurringBucket, string>> = {
  received: "The source holds a settled collection for this occurrence, so it is cash evidence of what " + "arrived and not a promise of what was committed.",
  processing: "The source reports the collection in flight. No cash is counted for it while it is in flight, " + "and its outcome is still open.",
  upcoming: "The occurrence is set for a future date and is not yet due, so it is a plan on the source's " + "calendar: neither a payment nor a commitment fulfilled.",
  "recovery-needs-attention":
    "The source reports a collection that needs attention. This surface cannot retry, correct or post " +
    "a payment, so the entry states the source's own state and leaves the remedy where it belongs.",
  "not-received": "The source holds no receipt for this occurrence. That is an absent receipt, not donor debt and " + "not a statement about the supporter's intent.",
  "outside-partition":
    "The evidence is unknown or stale, so the occurrence deliberately sits outside the five outcomes: " +
    "it is counted in none of them, is never guessed into one, and is never presented as a sixth " +
    "outcome.",
};
// The value states
/** What each value state means, keyed by the envelope's union so a seventh state cannot be invented or left unexplained. */
export const VALUE_STATE_MEANING: Readonly<Record<ValueState, string>> = {
  value: "The source recorded this value, so it reads as the number it is, together with the coverage " + "stated beside it.",
  zero: "The source recorded a zero — a known value and not a missing one — so it is never rendered as " + "absent, blank or as a gap.",
  unknown: "The source did not establish this value, so nothing is assumed, nothing is filled in, and no " + "zero stands in its place.",
  withheld: "A value is recorded and this context does not show it, so it is left out rather than shown, and " + "the remaining figures cannot be used to work it out by subtraction.",
  unavailable: "The source behind this value could not be read, so the value is unavailable rather than missing " + "or zero, and the source itself is left as it stands.",
  "incomplete-subtotal": "Coverage for the period is partial, so this subtotal covers only the part the source holds and " + "says so; it is never presented as a total of the period.",
};
// The five measures
/** The reader-facing name of each of the five measures, taken from the module that declares them. */
export const MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = SUPPORT_MEASURE_LABELS;
// The three commitment kinds
/** The three kinds of commitment in the words the support module distinguishes them by, keyed so a fourth kind cannot be added without being worded here. */
export const COMMITMENT_KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  "automatic-recurring": "Automatic recurring gift",
  "manual-recurring": "Manual recurring gift",
  "fixed-total": "Fixed total",
};
// The four fixed-total figures
/** The four figures a fixed total states, in the source's order and each its own fact: nothing sums, subtracts or shares them. */
export const FIXED_TOTAL_FIELDS = [
  { field: "promised", label: "Promised" },
  { field: "fulfilled", label: "Fulfilled" },
  { field: "released", label: "Released" },
  { field: "remaining", label: "Remaining" },
] as const;
// The four reports
/** The four report identities, exactly as AAP 0.8.1 fixes them: a closed set, with no registration function and no way to add an identity at runtime. */
export type ReportCopyKey = "received" | "history" | "matrix" | "comparison";
/** The title and one-sentence description of one report. */
export interface ReportCopy {
  readonly title: string;
  readonly description: string;
}
/** The title and description of each of the four reports, keyed so an identity added later fails to compile until it is worded here. */
export const REPORT_COPY: Readonly<Record<ReportCopyKey, ReportCopy>> = {
  received: {
    title: "Received support",
    description: "Monthly and year-to-date received support, with an equal-elapsed-period comparison so a partial " + "period is never set against a whole one.",
  },
  history: {
    title: "Monthly history",
    description: "One chosen year's monthly figures, each month stated as its own period, with a month the source " + "does not cover shown as a gap rather than a zero.",
  },
  matrix: {
    title: "Partners by month",
    description: "A partner-by-month matrix whose cells open the exact records behind them, so a cell, the rows it " + "narrows to and the total it belongs to are one figure at three grains.",
  },
  comparison: {
    title: "Period comparison",
    description: "Two periods compared as a signed difference, with the contributor changes that reconcile it, and " + "no percentage where the earlier period is zero.",
  },
};
/** The notice a support report surface shows for a report identity the catalogue does not carry. */
export const REPORT_NOT_FOUND: EmptyStateCopy = {
  title: "That report is not one of the four",
  body:
    "This application reports received support in four fixed ways, and this address names none of " +
    "them. No other report is substituted for it, because a report that looks like the one you asked " +
    "for is worse than a report you know is different.",
  action: { label: "Open the received-support report", href: "/support/reports/received" },
};
// Chart captions
/** The caption templates a chart figure needs: its unit, its coverage, its as-of and its summary. */
export interface ChartCaptionTemplates {
  readonly unit: string;
  readonly coverage: string;
  readonly asOf: string;
  readonly summaryOpener: string;
}
/** The captions every chart states, because a chart that omits its unit, coverage or as-of time is a picture of a number nobody can check. */
export const CHART_CAPTIONS: ChartCaptionTemplates = {
  unit: "Amounts are in {currency}. Two currencies are never drawn as one series and never combined into " + "a single figure.",
  coverage: "{coverage} A period the source does not cover is a gap in the series rather than a point at zero.",
  asOf: AS_OF_TEMPLATE,
  summaryOpener: "{series} in {currency}: {takeaway}",
};
// Empty states
/** The support surfaces that can honestly be empty, one member per rendered region. */
export type SupportEmptySurface = "gifts" | "commitments" | "goal" | "reports";
/** The one action an empty surface offers: a label and the route it leads to. */
export interface EmptyStateAction {
  readonly label: string;
  readonly href: string;
}
/** The wording of one empty surface: what is absent, why that is not a failure, and where to go next. */
export interface EmptyStateCopy {
  readonly title: string;
  readonly body: string;
  readonly action: EmptyStateAction;
  readonly secondary?: EmptyStateAction;
}
/** The first action each empty support surface offers, in text and a destination. */
export const EMPTY_STATES: Readonly<Record<SupportEmptySurface, EmptyStateCopy>> = {
  gifts: {
    title: "No gift is in this result",
    body:
      "A period with no gift in it and a query that selects nothing look the same on this page and " +
      "mean different things: the period states its coverage, and a period the source does not cover " +
      "is a gap rather than a zero. Clear the period and the currency to read the whole ledger.",
    action: { label: "Clear the filters and read the whole ledger", href: "/support/gifts" },
  },
  commitments: {
    title: "The source reports no commitment here",
    body:
      "Commitments are read-only and come from the source, so none can be created on this surface. " +
      "Received support is a different measure and is read on its own; no commitment is ever counted " +
      "as cash.",
    action: { label: "Read received support", href: "/support/gifts" },
  },
  goal: {
    title: "No support goal is set",
    body: "A goal is optional, and having none is a different fact from a goal of zero: until one exists " + "no percentage is shown, and no figure is put in its place.",
    action: { label: "Read this month's received support", href: "/support" },
    secondary: { label: "Set or change the goal", href: "/support" },
  },
  reports: {
    title: "No report has been opened yet",
    body: "The four reports read the same report result as this overview, so a report repeats the figures " + "already stated here rather than computing a second set of them.",
    action: { label: "Open the received-support report", href: "/support/reports/received" },
  },
};
// The follow-up a gift may lead to
/** The label, the explanation and the result note of the thank-you follow-up a gift may yield. */
export interface GivingFollowUpCopy {
  readonly actionLabel: string;
  readonly description: string;
  readonly resultNote: string;
}
/** The wording of the thank-you follow-up offered beside a gift. */
export const GIVING_FOLLOW_UP: GivingFollowUpCopy = {
  actionLabel: "Create a thank-you task",
  description:
    "This creates one ordinary follow-up task for you to work through. It posts no gift, corrects no " + "amount, records no financial change, sends no message and creates no stewardship obligation.",
  resultNote: "The task was created. Nothing about the gift changed: no financial record was written, no " + "message was sent and no obligation was created.",
};
// The one slot-substitution rule for every template above
/** One piece of a template, in the template's own order: the template's words, or one `{slot}` and the value the caller supplied for it. */
export type TemplateSegment = string | { readonly slot: string; readonly value: string | undefined };

const TEMPLATE_SLOT = /\{(\w+)\}/;
/** Splits a template into its own words and its `{slot}`s, in order, and substitutes nothing. */
export function templateSegments(template: string, values: Readonly<Record<string, string>>): readonly TemplateSegment[] {
  return template.split(TEMPLATE_SLOT).map((part, index) => (index % 2 === 0 ? part : { slot: part, value: values[part] }));
}
/** Fills a template's `{slot}`s from the values supplied, and changes nothing else. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return templateSegments(template, values)
    .map((segment) => (typeof segment === "string" ? segment : (segment.value ?? `{${segment.slot}}`)))
    .join("");
}
