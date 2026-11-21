"use client";

/**
 * The reviewed, fixed financial range a worker shares with a coach, stated once and never as a
 * drilldown.
 *
 * What it renders. The range's two reviewed civil dates, its currency, the single figure the read
 * supplied for that period, the coverage the source states for it, the as-of instant, the review
 * provenance and the basis the figure is reported on. Every amount comes through
 * `modules/money/format`'s `formatMinor` together with the `ValueState` the read recorded for it, so
 * `value`, `zero`, `unknown`, `withheld`, `unavailable` and `incomplete-subtotal` stay six distinct
 * renderings here exactly as they are on the worker's own Support screens: a genuine zero carries the
 * currency's own digits, and no absence is ever shown as `0`.
 *
 * What it refuses. No sum, no difference, no percentage and no monthly equivalent: a figure that could
 * be rebuilt from what is shown would be the reconstructing total this surface exists without. No gift
 * row, no commitment row, no donor, no designation and no path into the ledger — not a link, not a
 * button and not a filtered route — because that drilldown is not part of what a range share discloses.
 * The wording of the basis, the range and its exclusions comes from `../copy` and
 * `modules/support/basis`, so this family states its basis once and no surface paraphrases it.
 *
 * What it never proves. A shared range is not consent, not permission to make contact and not a
 * delivery: the card states the figures it was given and nothing about a person, a message or a gift.
 *
 * Shape and direction. The card declares `dir="ltr"` because everything it states is left-to-right:
 * this family's copy is English, an amount is an ISO minor-unit figure with its ISO code, and a date or
 * an instant is the stored ISO form. Inside a right-to-left page that declaration is what stops the bidi
 * algorithm from reordering an English sentence around the values embedded in it — a sentence whose
 * dates are isolated `<bdi>` runs is otherwise broken into right-to-left ordered chunks and its final
 * punctuation stranded at the wrong edge. Every interpolated value still sits in its own `<bdi>`, so the
 * declaration never has to guess the direction of one, and no bidi control character is emitted. Spacing
 * uses logical utilities only, the amount uses tabular figures with `text-end`, and the card is one
 * column that reflows at 320 CSS px with no horizontal page scroll and no nested scroll region.
 */

import type { ReactElement, ReactNode } from "react";

import { StateNotice } from "@/components/state-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import type { Coverage, ValueState } from "@/modules/data-service/envelope";
import type { Money } from "@/modules/money/amount";
import { formatMinor } from "@/modules/money/format";
import { BASIS_DESCRIPTION, SUPPORT_BASIS } from "@/modules/support/basis";
import { serialiseCivilDate, type CivilDate } from "@/modules/time/civil";

import { COACHING_COPY, FINANCIAL_RANGE_COPY } from "../copy";

/**
 * One reviewed financial range as a grant discloses it: a fixed period, its currency, and the single
 * figure the read supplied for that currency — with the state that figure was read in and the coverage
 * the source states for the period.
 *
 * `money` is `null` when the read carried no amount at all. That is a distinct fact from an amount of
 * zero, so the surface states it in words rather than substituting a number.
 *
 * A reviewed date arrives in one of the two shapes this application holds a civil date in: the
 * `Temporal.PlainDate` a range built in process carries, or the stored `YYYY-MM-DD` string a decoded
 * read envelope carries. Both render as the same stored form, so neither shape can produce a
 * localized or offset date here.
 */
export interface SharedFinancialRange {
  /** The first reviewed civil date. */
  readonly from: CivilDate | string;
  /** The last reviewed civil date. */
  readonly to: CivilDate | string;
  /** The ISO code the figure is stated in. An unknown code keeps its unknown-currency rendering. */
  readonly currency: string;
  /** The exact amount, or `null` when the read stated no amount for this range. */
  readonly money: Money | null;
  /** The state the read recorded for this figure: the only way it becomes words here. */
  readonly valueState: ValueState;
  /** How much of the reviewed period the source's data actually covers. */
  readonly coverage: Coverage;
  /** The scenario instant the figures were evaluated at, stated exactly as reported. */
  readonly asOf: string;
}

/** Props of {@link FinancialRangeReview}. None of them is derived inside the component. */
export interface FinancialRangeReviewProps {
  /** The reviewed range, or `null` when no range has been shared — an absence, not a zero range. */
  readonly range: SharedFinancialRange | null;
  /** When the worker reviewed the range, as reported by the envelope; absent when not reported. */
  readonly reviewedAt?: string | null;
  /** Who performed that review. `"worker"` is the only role a range review may carry. */
  readonly reviewedByRole?: "worker" | null;
  /** The viewer's display locale, passed straight to `formatMinor`; never read from the host. */
  readonly locale: string;
}

/**
 * The short word beside every figure, so the state is legible without the number and never by colour
 * alone. It names the state rather than describing the amount, which the formatter's own text and
 * accessible label already do.
 */
const STATE_LABELS: Readonly<Record<ValueState, string>> = {
  value: "Recorded amount",
  zero: "Genuine zero",
  unknown: "Unknown",
  withheld: "Withheld",
  unavailable: "Unavailable",
  "incomplete-subtotal": "Incomplete subtotal",
};

/** The three states whose rendering carries digits, and so the three that read as a figure. */
const NUMERIC_STATES: ReadonlySet<ValueState> = new Set<ValueState>([
  "value",
  "zero",
  "incomplete-subtotal",
]);

/** The visible label of the one figure this surface shows. It names the measure, not a total. */
const FIGURE_LABEL = "Received support in this range";

/**
 * What the figure says when the read carried no amount object at all. It is not one of the six value
 * states and deliberately not a seventh state: it states the absence of the amount itself, which no
 * `ValueState` describes, and it can never be read as a zero.
 */
const NO_AMOUNT_TEXT = "No amount shared";

/** The accessible name that accompanies {@link NO_AMOUNT_TEXT}, so the absence is stated in full. */
const NO_AMOUNT_LABEL =
  "No amount was shared for this range. This is neither zero nor an unknown amount: the read supplied no figure at all.";

/** What the card says when no range has been shared yet — an explicit absence, never a zero range. */
const NO_RANGE_SHARED =
  "No financial range has been shared with a coach yet. Choose the dates and review them on this page " +
  "first: nothing from your support view becomes readable to a coach until you do.";

/** The label of the absence badge, so the unshared state is a word and not a missing paragraph. */
const NO_RANGE_BADGE = "Not shared";

/** The heading of the section that states what the named basis measures. */
const BASIS_HEADING = "What this range measures";

/** The heading of the static limitation note that restates the copy's exclusions. */
const EXCLUSIONS_HEADING = "What this range does not show";

/** The heading of the notice shown when the source behind the figure cannot be read. */
const UNAVAILABLE_HEADING = "This financial range cannot be read";

/**
 * The label of each reviewed fact, in the order the card states them. A label names a fact; the fact's
 * wording belongs to `../copy`, so these five short names are the only text this file adds to the
 * statement and they claim nothing about what was read.
 */
const FIELD_LABELS = {
  from: "Range from",
  to: "Range to",
  currency: "Currency",
  basis: "Basis",
  reviewed: "Reviewed",
} as const;

/** The label style shared by every term in the fact list. */
const TERM_CLASS = "font-medium";

/**
 * The class a date or an instant carries. An ISO form is hyphenated, so without this a narrow card
 * breaks it after a hyphen — `2025-01-` on one line and `01` on the next — and a reader can no longer
 * tell which value the halves belong to. These values are at most twenty characters, so keeping them
 * whole never widens the card.
 */
const ISO_VALUE_CLASS = "whitespace-nowrap";

/** One ISO value — a date, an instant, a currency code — as an isolated run that keeps its form. */
function isoValue(value: string): ReactElement {
  return <bdi className={ISO_VALUE_CLASS}>{value}</bdi>;
}

/**
 * Reads a reviewed civil date in the stored ISO form, which is the one form that reads the same in
 * every locale.
 *
 * A range built in process supplies a `Temporal.PlainDate`; one decoded from a read envelope supplies
 * the stored string, which is passed through unchanged so neither shape can render a localized or
 * zoned date here.
 */
function isoDay(date: CivilDate | string): string {
  return typeof date === "string" ? date : serialiseCivilDate(date);
}

/**
 * States how much of the reviewed period the source's data covers.
 *
 * The three coverage states are three different facts and never one sentence with a flag: `complete`
 * says the whole period is covered, `partial` says part of it cannot be read yet (and borrows the
 * family's own wording for that state from `../copy`), and `unknown` says the source never stated its
 * coverage — in which case no figure here is presented as a complete total.
 */
function coverageStatement(coverage: Coverage): ReactNode {
  switch (coverage.state) {
    case "complete":
      return "Coverage is complete for this period, so the figure is a complete total rather than a partial subtotal.";
    case "partial":
      return COACHING_COPY.coachSubject.partial;
    case "unknown":
      return (
        "The source does not state how much of this range it covers, so no figure here is " +
        "presented as a complete total."
      );
  }
}

/**
 * States the coverage boundaries the source actually gave, isolating each date.
 *
 * A boundary is `null` when the source does not state it, which is a different fact from a boundary
 * at the earliest day the source holds — so an unstated edge is said to be unstated rather than filled
 * with the range's own dates.
 */
function coverageBounds(coverage: Coverage): ReactNode {
  const { from, to } = coverage;

  if (from !== null && to !== null) {
    return (
      <>
        Stated coverage runs from {isoValue(from)} to {isoValue(to)}.
      </>
    );
  }
  if (from !== null) {
    return <>Stated coverage starts at {isoValue(from)}, with no end the source states.</>;
  }
  if (to !== null) {
    return <>Stated coverage ends at {isoValue(to)}, with no start the source states.</>;
  }
  return null;
}

/**
 * Renders the reviewed financial range a coach may read, under the one named support basis.
 *
 * States it renders: `value` and `zero` (digits in the currency's own exponent), `unknown`,
 * `withheld`, `unavailable` and `incomplete-subtotal` (their own words), and the absence of a shared
 * range or of an amount, each stated in its own terms. It computes nothing, offers no drilldown and
 * links nowhere.
 */
export function FinancialRangeReview({
  range,
  reviewedAt,
  reviewedByRole,
  locale,
}: FinancialRangeReviewProps): ReactElement {
  if (range === null) {
    return (
      <Card dir="ltr">
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">{FINANCIAL_RANGE_COPY.heading}</h2>
          </CardTitle>
          <CardDescription>{FINANCIAL_RANGE_COPY.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Badge variant="outline">{NO_RANGE_BADGE}</Badge>
          <p className="text-sm break-words">{NO_RANGE_SHARED}</p>
        </CardContent>
      </Card>
    );
  }

  const formatting =
    range.money === null ? null : formatMinor(range.money, range.valueState, locale);
  const carriesDigits = formatting !== null && NUMERIC_STATES.has(range.valueState);
  const bounds = coverageBounds(range.coverage);
  const reviewed = reviewedAt ?? null;

  return (
    <Card dir="ltr">
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-medium">{FINANCIAL_RANGE_COPY.heading}</h2>
        </CardTitle>
        <CardDescription>{FINANCIAL_RANGE_COPY.purpose}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <figure className="flex flex-col gap-2">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span>{FIGURE_LABEL}</span>
            <Badge variant={carriesDigits ? "secondary" : "outline"}>
              {STATE_LABELS[range.valueState]}
            </Badge>
          </figcaption>

          <p
            className={cn(
              "tabular-figures text-2xl font-semibold text-end break-words",
              carriesDigits ? null : "text-muted-foreground",
            )}
          >
            {formatting === null ? (
              <>
                {NO_AMOUNT_TEXT}
                <span className="sr-only">{NO_AMOUNT_LABEL}</span>
              </>
            ) : (
              <>
                <bdi>{formatting.text}</bdi>
                {formatting.accessibleLabel === formatting.text ? null : (
                  <span className="sr-only">{formatting.accessibleLabel}</span>
                )}
              </>
            )}
          </p>

          <p className="text-sm text-muted-foreground">
            {coverageStatement(range.coverage)}
            {bounds === null ? null : <span className="block">{bounds}</span>}
          </p>

          <p className="text-sm text-muted-foreground">
            As of <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{range.asOf}</bdi>, which
            is when these figures were read rather than when the source last changed.
          </p>
        </figure>

        {range.valueState === "unavailable" ? (
          <StateNotice
            kind="unavailable"
            title={UNAVAILABLE_HEADING}
            description={FINANCIAL_RANGE_COPY.unavailable}
            headingLevel={3}
          />
        ) : null}

        <Separator />

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className={TERM_CLASS}>{FIELD_LABELS.from}</dt>
          <dd className="min-w-0 break-words">{isoValue(isoDay(range.from))}</dd>

          <dt className={TERM_CLASS}>{FIELD_LABELS.to}</dt>
          <dd className="min-w-0 break-words">{isoValue(isoDay(range.to))}</dd>

          <dt className={TERM_CLASS}>{FIELD_LABELS.currency}</dt>
          <dd className="min-w-0 break-words">
            <bdi className="mono-identifier">{range.currency}</bdi>
          </dd>

          <dt className={TERM_CLASS}>{FIELD_LABELS.basis}</dt>
          <dd className="min-w-0 break-words">
            <data value={SUPPORT_BASIS}>
              <bdi className="mono-identifier">{SUPPORT_BASIS}</bdi>
            </data>
          </dd>

          {reviewed === null ? null : (
            <>
              <dt className={TERM_CLASS}>{FIELD_LABELS.reviewed}</dt>
              <dd className="min-w-0 break-words">
                {reviewedByRole === "worker" ? "By the worker at " : "At "}
                <bdi className={cn("mono-identifier", ISO_VALUE_CLASS)}>{reviewed}</bdi>
              </dd>
            </>
          )}
        </dl>

        <section className="flex flex-col gap-1">
          <h3 className="font-heading text-sm font-medium">{BASIS_HEADING}</h3>
          <p className="text-sm text-muted-foreground">{BASIS_DESCRIPTION}</p>
        </section>

        <p className="text-sm text-muted-foreground">{FINANCIAL_RANGE_COPY.rangeStatement}</p>

        <Alert role={undefined}>
          <AlertTitle>{EXCLUSIONS_HEADING}</AlertTitle>
          <AlertDescription>{FINANCIAL_RANGE_COPY.exclusions}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export default FinancialRangeReview;
