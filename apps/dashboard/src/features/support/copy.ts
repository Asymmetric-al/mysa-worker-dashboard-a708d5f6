/**
 * The Support family's single wording source: the basis and the grain every financial figure is
 * reported on, the coverage and as-of identity the six artifacts share, the *In progress* and
 * *no percentage* notes, the explanations behind the five recurring outcomes and the six value
 * states, the five measure names, the four reports, the chart captions, the empty states and the
 * thank-you follow-up.
 *
 * Why it exists. The support family is the one place in this application where a set of figures must
 * agree with each other: the on-screen total, the chart series, the table rows, a drilldown, the CSV
 * export and the print view all describe one `ReportResult` for one query and one snapshot. They
 * agree in arithmetic because `runReport` computes them once, and they agree in words because the
 * sentences that say what the figures mean are declared here and nowhere else in the family. AAP
 * 0.8.1 and AAP 0.8.8 state the rule; criteria 1, 6 and 7 are the evidence.
 *
 * What this module does not own, and deliberately does not repeat. Two shared vocabularies already
 * exist and are imported rather than retyped, because a second copy of either would be a second
 * answer to a question the application already answers once:
 *
 * - the short recurring-outcome labels live in `BUCKET_LABELS` (`@/modules/support/buckets`) and are
 *   rendered by `@/components/status-badge`; the sentences here explain a bucket and never spell its
 *   label again, so a component renders the label it imported beside the meaning it read here;
 * - the words that render a non-value (`Zero`, `Unknown`, `Withheld`, `Unavailable`,
 *   `Incomplete subtotal`) live in `VALUE_STATE_WORDS` (`@/components/status-badge`) and the amounts
 *   themselves are formatted by `@/modules/money/format`; the sentences here explain a state and
 *   format nothing;
 * - the basis itself is declared in `@/modules/support/basis`, and the statement below interpolates
 *   that module rather than paraphrasing it, so the wording cannot drift from the rule.
 *
 * Facts this wording keeps apart. Received gifts, recurring collection outcomes, commitments,
 * monthly-equivalent support and the support goal are five measures and never five parts of one
 * total. Zero, unknown, withheld, unavailable and an incomplete subtotal are five different facts and
 * never one "no figure". A commitment is not cash, a processing occurrence is not received money, a
 * missing month is a gap rather than a zero, and a bucket never implies a payment can be retried
 * here. No sentence in this module merges two of those facts, and every sentence describes a surface
 * this release retains: the wording carries no capability beyond that retained scope, so a reader
 * cannot learn of an action from copy the application will not perform.
 *
 * Text and types only. No JSX, no component, no store, no clock and no arithmetic: this module
 * declares sentences, the fields they interpolate and the exhaustive maps that make a missing entry a
 * compile error. It imports the basis and the bucket type, and the value-state and coverage types as
 * types, and nothing else.
 */

import type { CoverageState, ValueState } from "@/modules/data-service/envelope";
import {
  BASIS_DESCRIPTION,
  SUPPORT_BASIS,
  SUPPORT_MEASURE_LABELS,
  type SupportMeasure,
} from "@/modules/support/basis";
import type { RecurringBucket } from "@/modules/support/buckets";

// ---------------------------------------------------------------------------------------------
// The one basis, and the grain it counts at
// ---------------------------------------------------------------------------------------------

/**
 * The one basis statement every support surface states, built from the module that owns the basis.
 *
 * The sentence is composed rather than written here: `SUPPORT_BASIS` names the basis the application
 * measures and `BASIS_DESCRIPTION` states what that basis measures, so this constant adds no claim of
 * its own and cannot drift from `@/modules/support/basis`. It exists because a figure without its
 * basis is not comparable with another figure, and because six artifacts printing six paraphrases of
 * one basis is the same defect as six artifacts computing six totals.
 */
export const SUPPORT_BASIS_STATEMENT: string =
  `Every received-support figure in this family is reported on the one named basis this application ` +
  `measures, ${SUPPORT_BASIS}, and on no other. ${BASIS_DESCRIPTION}`;

/**
 * The grain statement: what one row is, and why three counts are never added together.
 *
 * A supporter's history can legitimately be read at more than one grain, and the grain is where a
 * double count becomes possible: a gift, its allocations and its donor are three different counts of
 * the same money. The statement fixes the rule in words — one row is one authorised allocation, a
 * gift with no allocation is one row at gift grain, and the counts stay separate — and carries the
 * rule's own worked example, so a reader can check the figure they are looking at against it.
 */
export const SUPPORT_GRAIN_STATEMENT: string =
  "One row is one authorised allocation, and a gift that carries no allocation is one row at gift " +
  "grain. Gift, allocation and donor counts are each counted at their own grain and are never added " +
  "together: a 100-unit gift split 40/60 shows only the allocation this read is authorised to see, " +
  "and a view that legitimately holds both grain levels counts the 100 once.";

// ---------------------------------------------------------------------------------------------
// Coverage, as-of and the snapshot identity
// ---------------------------------------------------------------------------------------------

/**
 * One coverage sentence per coverage state, keyed by the envelope's own union so a fourth state
 * cannot be added without being worded here.
 *
 * The state and the dates are the envelope's: this file supplies the sentence and the two
 * placeholders it interpolates, `{from}` and `{to}`, which a surface fills with the boundaries it was
 * given, already formatted in the reader's terms. Coverage says how much of the past a read reaches
 * and never stands in for the state of an individual value, so each sentence states the range and
 * then the one thing that follows from it for a subtotal computed over that period.
 *
 * The `unknown` entry interpolates nothing on purpose: when the source stated no range, there is no
 * boundary to print, and a surface must not substitute the period's own bounds, today's date or an
 * empty string for one. `@/components/state-notice` renders the same coverage fact as a notice in its
 * own sentence; these templates are the caption line the artifacts state, and they carry the notice's
 * meaning unchanged — partial or unknown coverage makes every subtotal it underlies an incomplete
 * subtotal.
 */
export const COVERAGE_TEMPLATES: Readonly<Record<CoverageState, string>> = {
  complete:
    "Coverage is complete from {from} to {to}: the source holds the whole period, so a subtotal over " +
    "it is a total of that period.",
  partial:
    "Coverage is partial: the source holds {from} to {to} only, so every subtotal over this period is " +
    "an incomplete subtotal and is labelled as one wherever it appears.",
  unknown:
    "Coverage is unknown: the source stated no covered range, so no subtotal here is presented as a " +
    "total, and no boundary is filled in with an assumed date.",
};

/**
 * The as-of sentence: the instant a read was evaluated at, which is not when the source last changed.
 *
 * The single placeholder `{asOf}` is the envelope's `asOf`. The sentence keeps the two timestamps
 * apart in words because they are apart in fact: a read can be evaluated long after the source last
 * moved, and two surfaces may be compared only when their as-of instants and their coverage agree.
 */
export const AS_OF_TEMPLATE: string =
  "As of {asOf} — the instant this read was evaluated, which is not when the source last changed.";

/**
 * The snapshot identity line the six artifacts state, in one fixed order: query, basis, currency,
 * period, coverage and as-of.
 *
 * It is a template rather than six sentences because the six artifacts must be able to print the same
 * line: a download whose header states a different currency, period or coverage from the screen it
 * came from is a different figure wearing the same numbers. Each placeholder is filled from the
 * snapshot the read already carries — `{basis}` with the basis above, `{query}` with the filters in
 * force, `{period}` with the period as stated, `{coverage}` with the coverage sentence, `{asOf}` with
 * the envelope's instant — and `{currency}` is the single currency partition the figures are stated
 * in. A read holding more than one currency states one snapshot per currency, because this
 * application never combines currencies into one figure.
 *
 * The CSV writer lives in `modules/export`, which may not import a feature module, so it states these
 * same six fields in this same order from the report result itself; this template is the screen and
 * print wording of exactly those fields.
 */
export const SNAPSHOT_TEMPLATE: string =
  "Snapshot — query: {query}; basis: {basis}; currency: {currency}; period: {period}; coverage: " +
  "{coverage}; as of: {asOf}.";

// ---------------------------------------------------------------------------------------------
// The two notes a figure can need
// ---------------------------------------------------------------------------------------------

/**
 * The note a current period carries, so a period that has not closed is never read as a final figure.
 *
 * Whether a period is current is the envelope's answer and not this file's: the words are supplied
 * here, the judgement is not. A note rather than a second total, because the period's figures are the
 * figures — they simply do not cover all of it yet.
 */
export const IN_PROGRESS_NOTE: string =
  "In progress — this period has not closed, so its figures cover only the part of it that has " +
  "happened, and every subtotal over it is an incomplete subtotal.";

/**
 * Why no percentage is shown, keyed by the four reasons the rule admits plus a `default` for a case
 * that reaches a surface without one of them.
 *
 * A percentage needs a compatible numerator and a positive, known denominator, and this application
 * never manufactures either. The four keys are the four ways that need goes unmet, and each sentence
 * says which one applied rather than leaving an empty space where a number would have been. The
 * `default` entry carries the other half of the rule in words: where the conditions are met the
 * figure is shown exactly as computed, so a valid 120% reads 120% and is never capped at 100%, and
 * where they are not met no substitute figure is invented.
 */
export const NO_PERCENTAGE_REASONS = [
  "no-goal",
  "zero-denominator",
  "unknown-denominator",
  "incompatible-measure",
] as const;

/** One reason a percentage is not shown. Closed on purpose: another would be a product change. */
export type NoPercentageReason = (typeof NO_PERCENTAGE_REASONS)[number];

/** The sentence for one reason a percentage is not shown, plus the default for an unclassified one. */
export const NO_PERCENTAGE: Readonly<Record<NoPercentageReason | "default", string>> = {
  "no-goal":
    "No percentage is shown because no support goal is set. A missing goal and a goal of zero are " +
    "different facts, and neither is a denominator.",
  "zero-denominator":
    "No percentage is shown because the goal is zero, and a share of zero is undefined. Nothing is " +
    "divided by it and no figure is put in its place.",
  "unknown-denominator":
    "No percentage is shown because the denominator is not known. A value the source did not " +
    "establish cannot carry a percentage, so the percentage is left out rather than guessed.",
  "incompatible-measure":
    "No percentage is shown because the goal and the figure it would be compared with measure " +
    "different things. Received gifts, recurring collection outcomes, commitments, monthly-equivalent " +
    "support and the goal are five measures and are never divided by one another.",
  default:
    "No percentage is shown, because a percentage needs a compatible numerator and a positive, known " +
    "denominator. Where both exist the figure is shown exactly as it was computed, so a valid 120% " +
    "reads 120% and is never capped at 100%; where they do not exist, nothing stands in its place.",
};

// ---------------------------------------------------------------------------------------------
// The recurring outcomes
// ---------------------------------------------------------------------------------------------

/**
 * What each recurring outcome means, keyed by the bucket union so a sixth in-partition outcome — or a
 * renamed `outside-partition` — fails to compile until it is explained here.
 *
 * Each sentence explains the bucket a read reports; the label itself is not repeated, because
 * `BUCKET_LABELS` owns it and a component renders the two together. Three reminders hold across the
 * table and are stated inside the entries that need them: a bucket never implies a payment can be
 * retried, corrected or posted from this application, which performs no financial action at all; an
 * occurrence the source holds no receipt for is an absent receipt and never donor debt or a claim
 * about the supporter's intent; and evidence that is unknown or stale stays outside the partition
 * rather than being guessed into one of the five outcomes.
 */
export const BUCKET_MEANING: Readonly<Record<RecurringBucket, string>> = {
  received:
    "The source holds a settled collection for this occurrence, so it is cash evidence of what " +
    "arrived and not a promise of what was committed.",
  processing:
    "The source reports the collection in flight. No cash is counted for it while it is in flight, " +
    "and its outcome is still open.",
  upcoming:
    "The occurrence is set for a future date and is not yet due, so it is a plan on the source's " +
    "calendar: neither a payment nor a commitment fulfilled.",
  "recovery-needs-attention":
    "The source reports a collection that needs attention. This surface cannot retry, correct or post " +
    "a payment, so the entry states the source's own state and leaves the remedy where it belongs.",
  "not-received":
    "The source holds no receipt for this occurrence. That is an absent receipt, not donor debt and " +
    "not a statement about the supporter's intent.",
  "outside-partition":
    "The evidence is unknown or stale, so the occurrence deliberately sits outside the five outcomes: " +
    "it is counted in none of them, is never guessed into one, and is never presented as a sixth " +
    "outcome.",
};

// ---------------------------------------------------------------------------------------------
// The value states
// ---------------------------------------------------------------------------------------------

/**
 * What each value state means, keyed by the envelope's union so a seventh state cannot be invented or
 * left unexplained.
 *
 * These are explanations, not renderings: the words a reader sees in place of a number are
 * `VALUE_STATE_WORDS` in `@/components/status-badge`, and the number itself is formatted by
 * `@/modules/money/format`. Nothing here writes a `0`, an empty string or a dash for a state that is
 * not a value, because the whole point of the vocabulary is that a genuine zero, a value the source
 * never supplied, a value this context withholds, a source that could not be read and a subtotal over
 * partial coverage each read as themselves.
 */
export const VALUE_STATE_MEANING: Readonly<Record<ValueState, string>> = {
  value:
    "The source recorded this value, so it reads as the number it is, together with the coverage " +
    "stated beside it.",
  zero:
    "The source recorded a zero — a known value and not a missing one — so it is never rendered as " +
    "absent, blank or as a gap.",
  unknown:
    "The source did not establish this value, so nothing is assumed, nothing is filled in, and no " +
    "zero stands in its place.",
  withheld:
    "A value is recorded and this context does not show it, so it is left out rather than shown, and " +
    "the remaining figures cannot be used to work it out by subtraction.",
  unavailable:
    "The source behind this value could not be read, so the value is unavailable rather than missing " +
    "or zero, and the source itself is left as it stands.",
  "incomplete-subtotal":
    "Coverage for the period is partial, so this subtotal covers only the part the source holds and " +
    "says so; it is never presented as a total of the period.",
};

// ---------------------------------------------------------------------------------------------
// The five measures
// ---------------------------------------------------------------------------------------------

/**
 * The reader-facing name of each of the five measures, taken from the module that declares them.
 *
 * This is not a second vocabulary: the strings are `SUPPORT_MEASURE_LABELS` from
 * `@/modules/support/basis`, bound to the same `SupportMeasure` union, so a sixth measure cannot be
 * added without appearing here and no surface can rename one. The family reads its measure names from
 * this binding so that a support surface has one import for its wording — and there is no "total
 * support" entry, because the five measures are five measurements of different facts rather than five
 * components of one figure.
 */
export const MEASURE_LABELS: Readonly<Record<SupportMeasure, string>> = SUPPORT_MEASURE_LABELS;

// ---------------------------------------------------------------------------------------------
// The four reports
// ---------------------------------------------------------------------------------------------

/**
 * The four report identities, exactly as AAP 0.8.1 fixes them: a closed set, with no registration
 * function and no way to add an identity at runtime.
 *
 * `report-catalog.ts` owns the catalogue and binds these keys to the report engine's own identity
 * field, so this union and the engine cannot drift apart, and the route's `[reportId]` segment is
 * validated against the catalogue rather than against a string written in a component.
 */
export type ReportCopyKey = "received" | "history" | "matrix" | "comparison";

/** The title and one-sentence description of one report. */
export interface ReportCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The title and description of each of the four reports, keyed so an identity added later fails to
 * compile until it is worded here.
 *
 * Each description states what the report is, the period or grain it counts at, and the one thing it
 * refuses to do — so no surface can present one report as another and no reader has to guess whether
 * a difference is money, generosity or coverage.
 */
export const REPORT_COPY: Readonly<Record<ReportCopyKey, ReportCopy>> = {
  received: {
    title: "Received support",
    description:
      "Monthly and year-to-date received support, with an equal-elapsed-period comparison so a partial " +
      "period is never set against a whole one.",
  },
  history: {
    title: "Monthly history",
    description:
      "One chosen year's monthly figures, each month stated as its own period, with a month the source " +
      "does not cover shown as a gap rather than a zero.",
  },
  matrix: {
    title: "Partners by month",
    description:
      "A partner-by-month matrix whose cells open the exact records behind them, so a cell, the rows it " +
      "narrows to and the total it belongs to are one figure at three grains.",
  },
  comparison: {
    title: "Period comparison",
    description:
      "Two periods compared as a signed difference, with the contributor changes that reconcile it, and " +
      "no percentage where the earlier period is zero.",
  },
};

/**
 * The notice a support report surface shows for a report identity the catalogue does not carry.
 *
 * The catalogue is closed at four, so this is not another report and not a fallback: the route
 * refuses an unrecognised segment before a report is rendered, and this notice states that refusal in
 * words instead of quietly showing the closest report. It offers the one report that exists, so a
 * stale bookmark leads somewhere true.
 */
export const REPORT_NOT_FOUND: EmptyStateCopy = {
  title: "That report is not one of the four",
  body:
    "This application reports received support in four fixed ways, and this address names none of " +
    "them. No other report is substituted for it, because a report that looks like the one you asked " +
    "for is worse than a report you know is different.",
  action: { label: "Open the received-support report", href: "/support/reports/received" },
};

// ---------------------------------------------------------------------------------------------
// Chart captions
// ---------------------------------------------------------------------------------------------

/** The caption templates a chart figure needs: its unit, its coverage, its as-of and its summary. */
export interface ChartCaptionTemplates {
  readonly unit: string;
  readonly coverage: string;
  readonly asOf: string;
  readonly summaryOpener: string;
}

/**
 * The captions every chart states, because a chart that omits its unit, coverage or as-of time is a
 * picture of a number nobody can check.
 *
 * `unit` interpolates `{currency}` and states the currency the series is drawn in, together with the
 * rule that two currencies are neither drawn as one series nor combined into one figure. `coverage`
 * interpolates `{coverage}` with the range-filled sentence from {@link COVERAGE_TEMPLATES} for the
 * state the read recorded, and adds what that means for a series: a period the source does not cover
 * is a gap rather than a point at zero. `asOf` is the as-of template itself, so a chart and the table
 * beneath it cannot state two different instants. `summaryOpener` is the prose summary's first line:
 * it names `{series}`, the `{currency}` that series is in and a `{takeaway}` slot the surface fills in
 * words, which is the sentence a reader hears before the data table is reached.
 */
export const CHART_CAPTIONS: ChartCaptionTemplates = {
  unit:
    "Amounts are in {currency}. Two currencies are never drawn as one series and never combined into " +
    "a single figure.",
  coverage:
    "{coverage} A period the source does not cover is a gap in the series rather than a point at zero.",
  asOf: AS_OF_TEMPLATE,
  summaryOpener: "{series} in {currency}: {takeaway}",
};

// ---------------------------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------------------------

/** The support surfaces that can honestly be empty, one member per rendered region. */
export type SupportEmptySurface = "gifts" | "commitments" | "goal" | "reports";

/** The one action an empty surface offers: a label and the route it leads to. */
export interface EmptyStateAction {
  readonly label: string;
  readonly href: string;
}

/**
 * The wording of one empty surface: what is absent, why that is not a failure, and where to go next.
 *
 * `action` is always available on that surface. `secondary` is present only where a second step is
 * real and capability-gated — the goal entry carries the goal-editing action only because a context
 * without the goal-editing capability must not offer it — so a surface shows `secondary` only where
 * the capability is present.
 */
export interface EmptyStateCopy {
  readonly title: string;
  readonly body: string;
  readonly action: EmptyStateAction;
  readonly secondary?: EmptyStateAction;
}

/**
 * The first action each empty support surface offers, in text and a destination.
 *
 * An empty ledger, no commitment, no goal and no report opened yet are four different situations and
 * each is worded as itself: no entry claims the source holds nothing when it may hold nothing for the
 * query, no entry offers to create a commitment the application cannot create, and the goal entry
 * states plainly that a missing goal is not a goal of zero. Each action leads to a route that exists
 * in this application, so the empty state is a way forward rather than an illustration.
 */
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
    body:
      "A goal is optional, and having none is a different fact from a goal of zero: until one exists " +
      "no percentage is shown, and no figure is put in its place.",
    action: { label: "Read this month's received support", href: "/support" },
    secondary: { label: "Set or change the goal", href: "/support" },
  },
  reports: {
    title: "No report has been opened yet",
    body:
      "The four reports read the same report result as this overview, so a report repeats the figures " +
      "already stated here rather than computing a second set of them.",
    action: { label: "Open the received-support report", href: "/support/reports/received" },
  },
};

// ---------------------------------------------------------------------------------------------
// The follow-up a gift may lead to
// ---------------------------------------------------------------------------------------------

/** The label, the explanation and the result note of the thank-you follow-up a gift may yield. */
export interface GivingFollowUpCopy {
  readonly actionLabel: string;
  readonly description: string;
  readonly resultNote: string;
}

/**
 * The wording of the thank-you follow-up offered beside a gift.
 *
 * The affordance is small and the boundary is stated with it, because a thank-you written from a
 * financial figure is exactly where a task would be mistaken for a transaction: what the action does
 * is create one ordinary follow-up task, and what it does not do is post a gift, correct an amount,
 * send a message or create a stewardship obligation. `resultNote` says the same thing after the task
 * exists, so the durable result is as explicit as the offer.
 */
export const GIVING_FOLLOW_UP: GivingFollowUpCopy = {
  actionLabel: "Create a thank-you task",
  description:
    "This creates one ordinary follow-up task for you to work through. It posts no gift, corrects no " +
    "amount, records no financial change, sends no message and creates no stewardship obligation.",
  resultNote:
    "The task was created. Nothing about the gift changed: no financial record was written, no " +
    "message was sent and no obligation was created.",
};
