/**
 * The Support family's two form payload schemas — the goal save and the thank-you follow-up task a
 * gift may lead to — and the one reader that turns a typed amount into exact minor units.
 *
 * Only what this family submits is checked here: one `saveGoal` payload and one `createTask` payload
 * for a gift's follow-up. There is deliberately no report-query, filter, export, commitment, gift
 * correction, refund or posting schema, because none of those capabilities exists — a commitment is
 * read-only from the source, and an export performs no state change.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope
 * (`@/modules/data-service/envelope`), and the family's hooks compose the two and mint one operation
 * identity per intent, so nothing below declares `operationId`, `scope` or `expectedRevision`. The
 * objects are strict for that reason: an envelope field — or a financial field a follow-up task must
 * never carry — smuggled into a payload is refused here rather than stripped and trusted, at the same
 * boundary `mutations/support.ts` and `mutations/tasks.ts` refuse it.
 *
 * These schemas decide shape, never admissibility. Whether the caller holds `canEditGoal`, whether
 * the goal has moved since the edit was made, whether a linked partner is still visible and whether a
 * save is a replay are the service's questions, answered against the record as it stands
 * (`@/modules/support/goal` decides the goal save itself, and `mutations/support.ts` is its only
 * caller). Nothing here reads a clock, compares a revision or asks a permission question, and a
 * payload accepted here is never an accepted save.
 *
 * What a payload may and may not imply. A goal edit is a goal edit: it sets a target amount in a
 * named currency and states the measure it is a target for, and it can imply no gift, pledge,
 * commitment change, refund, posted amount or public progress share. A follow-up task is a task: the
 * payload carries a title, an optional label, an optional due date, an optional partner and a kind —
 * no amount, no currency, no gift identity, no designation, no message body and no copy of private
 * text — because the action creates work and writes no financial record, sends no message and creates
 * no stewardship obligation.
 *
 * Money stays exact. `parseMajorToMinor` turns the typed string into an integer count of the
 * currency's minor units by string and integer arithmetic only — never by binary floating-point
 * parsing, fixed-decimal formatting, rounding or a float multiplication — and the exponent always
 * comes from `@/modules/money/currency`, so no currency is hard-coded here and none is assumed to
 * have two decimals. `@/modules/support/goal` re-validates the result on the service side; where the
 * two disagree, that module is authoritative and this one is corrected.
 *
 * Plan items: AAP 0.6.1 "Mutations: support" (`saveGoal`, the single permitted financial write) and
 * "Mutations: tasks" (`createTask`); AAP 0.6.3 `POST /api/support/goal` and `GET/POST /api/tasks`;
 * AAP 0.7.1 (a form validates with Zod, then posts the four-field mutation input); AAP 0.8.1 (a goal
 * is read-only without `canEditGoal`, edits at the currency's precision, saves against the base
 * revision); AAP 0.8.2 (a task needs only a title, a due date is a civil date, a category is the
 * worker's own label); AAP 0.8.7 (exact integer minor units with the exponent looked up); the AAP
 * 0.11.1 row `features/support/**`; and criteria 7 and 8.
 */

import { z } from "zod";

import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
import { exponentOf, isKnownCurrency, UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { GOAL_MEASURE, type GoalAmountInput } from "@/modules/support/goal";

// ---------------------------------------------------------------------------------------------
// The wording a worker reads
// ---------------------------------------------------------------------------------------------

/**
 * Every message a rejected payload can show, stated once so the form's messages cannot drift apart
 * and no schema below writes a message literal inline.
 *
 * Each one says what to change and why, names no person and echoes no value beyond the field the
 * worker is looking at, because these strings are rendered beside the control by `form-field`.
 */
const MESSAGES = {
  /** The amount field was left empty. */
  amountRequired: "Enter the amount you want to set as the goal.",
  /** The amount was not a plain figure. */
  amountNotFigures:
    "Enter the amount in figures, such as 1200 or 1200.50 — with a full stop before the decimals and no letters or symbols.",
  /** Zero or a negative figure. */
  amountNotPositive: "Enter an amount greater than zero.",
  /** A figure larger than an exact count of minor units can hold. */
  amountTooLarge:
    "Enter a smaller amount, because this figure is larger than the application holds exactly.",
  /** A currency the source reports in is required. */
  currencyRequired:
    "Choose a currency the services report in, so the amount has a precision the source states rather than one this form assumes.",
  /** The payload stated a measure other than the one a goal is set against. */
  measureInvalid:
    "A goal is set against received gifts, so save the amount and leave the measure as it is.",
  /** No effective day was given. */
  dateRequired: "Enter the day this takes effect on.",
  /** The date was not a day the calendar has. */
  dateInvalid: "Enter a real calendar day as year, month and day.",
  /** No title was given for the task. */
  titleRequired: "Enter what the task is for, because a title is the one thing a task needs.",
  /** A title longer than a list row can show. */
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  /** A category that arrived as something other than text. */
  categoryInvalid: "A category is text, so enter a short label or leave the field empty.",
  /** A category longer than a label needs to be. */
  categoryTooLong: "Shorten the category to a few words, or leave the field empty.",
  /** A linked record that arrived as blank text. */
  partnerInvalid:
    "Choose the person or household from the search results, so the task names a record rather than a typed value.",
  /** A kind of work this application has no name for. */
  kindInvalid: "Choose Task or Meeting as the kind of work.",
} as const;

/**
 * Why a fraction of the typed figure cannot be accepted, naming the currency's own precision.
 *
 * A currency with no minor unit (exponent `0`) cannot take a fraction at all, and a currency that
 * has one takes exactly as many digits as the exponent states — so the message counts the places
 * rather than asserting a default, which is what keeps a three-decimal and a zero-decimal currency
 * from being read as two-decimal ones.
 */
function fractionRefusedMessage(currency: string, exponent: number): string {
  if (exponent === 0) {
    return `A ${currency} amount has no decimal places, so enter a whole amount.`;
  }

  const places = exponent === 1 ? "decimal place" : "decimal places";
  return `Use no more than ${exponent} ${places} for this currency.`;
}

// ---------------------------------------------------------------------------------------------
// The typed amount
// ---------------------------------------------------------------------------------------------

/**
 * Digits with no separators at all — the ordinary case, where any number of digits is one figure.
 */
const PLAIN_DIGITS = /^\d+$/u;

/**
 * Digits grouped in threes, which is how a worker who copy-pastes a figure usually reads it: a first
 * group of one to three digits, then whole groups of three. A comma, a no-break space, a narrow
 * no-break space and an ordinary space are the grouping marks accepted, because those are the ones a
 * pasted figure carries; any other arrangement is refused rather than guessed at, so `1,20` is never
 * silently read as either `120` or `1.20`.
 */
const GROUPED_DIGITS = /^\d{1,3}(?:[,\u00A0\u202F ]\d{3})+$/u;

/** The grouping marks stripped before the digits are counted. */
const GROUPING_MARKS = /[,\u00A0\u202F ]/gu;

/** A leading minus sign, in both the hyphen and the typographic form a keyboard may produce. */
const NEGATIVE_SIGN = /^[-\u2212]/u;

/** The digits after the decimal separator. */
const FRACTION_DIGITS = /^\d+$/u;

/**
 * Reads the amount a worker typed as an exact count of `currency`'s minor units — the one place in
 * this application where a typed amount becomes money.
 *
 * The whole figure is handled as text and as integers: the whole part and the fraction are kept as
 * digit strings, the fraction is right-padded to the currency's exponent, the two are concatenated,
 * and only that complete digit string is parsed as a number. So `1200.5` in a two-decimal currency is
 * `120050`, `1200` in a three-decimal currency is `1200000`, `1200` in a zero-decimal currency is
 * `1200`, and every one of those is exact — where multiplying a binary floating-point reading of
 * `1200.5` by 100 can land a cent short, and fixed-decimal formatting would round a value nobody
 * asked to round.
 *
 * Refusals, each with its own sentence: empty input, input that is not figures, a negative figure,
 * zero, more decimal places than the currency has, a figure too large to hold exactly, and any
 * currency `@/modules/money/currency` gives no exponent for — `UNKNOWN_CURRENCY` included. A currency
 * with no exponent is refused rather than defaulted to two decimals, because a defaulted exponent
 * would state a precision the source never reported.
 *
 * The result carries the branded `MinorUnits` the money module's arithmetic requires. It comes from
 * that module's own constructor rather than from a cast: the value has just been proved to be a
 * positive safe integer, so the constructor's own refusal is unreachable, and no other module can
 * produce the brand.
 */
export function parseMajorToMinor(
  input: string,
  currency: string,
): { ok: true; minorUnits: MinorUnits } | { ok: false; message: string } {
  const exponent = exponentOf(currency);
  if (exponent === undefined || currency === UNKNOWN_CURRENCY) {
    return { ok: false, message: MESSAGES.currencyRequired };
  }

  const typed = input.trim();
  if (typed.length === 0) {
    return { ok: false, message: MESSAGES.amountRequired };
  }

  if (NEGATIVE_SIGN.test(typed)) {
    return { ok: false, message: MESSAGES.amountNotPositive };
  }

  const [wholePart = "", fractionPart, ...furtherParts] = typed.split(".");
  if (furtherParts.length > 0) {
    return { ok: false, message: MESSAGES.amountNotFigures };
  }

  if (!PLAIN_DIGITS.test(wholePart) && !GROUPED_DIGITS.test(wholePart)) {
    return { ok: false, message: MESSAGES.amountNotFigures };
  }

  const fraction = fractionPart ?? "";
  if (fraction.length > 0 && !FRACTION_DIGITS.test(fraction)) {
    return { ok: false, message: MESSAGES.amountNotFigures };
  }

  if (fraction.length > exponent) {
    return { ok: false, message: fractionRefusedMessage(currency, exponent) };
  }

  const digits = `${wholePart.replace(GROUPING_MARKS, "")}${fraction.padEnd(exponent, "0")}`;
  const count = Number.parseInt(digits, 10);

  if (!Number.isSafeInteger(count)) {
    return { ok: false, message: MESSAGES.amountTooLarge };
  }

  if (count <= 0) {
    return { ok: false, message: MESSAGES.amountNotPositive };
  }

  return { ok: true, minorUnits: minorUnitsOf(count) };
}

// ---------------------------------------------------------------------------------------------
// A day on the calendar
// ---------------------------------------------------------------------------------------------

/** The stored form of a civil day: four-digit year, month and day, and nothing else. */
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Whether a year is a leap year in the Gregorian calendar every surface states dates in. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** How many days a month of a given year actually has, so no day past the end of it is accepted. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  return 31;
}

/**
 * Whether the text is a day the calendar has, read from its own digits.
 *
 * A civil day is a date the worker reads, not an instant: `2026-02-30` is refused rather than rolled
 * forward into March, and nothing here asks the platform for "today" or builds a `Date`, so a
 * submission made near midnight in any zone resolves to the same day. Calendar correctness is what
 * this checks; whether the day may be used for this record at all is the service's question.
 */
function isCalendarDay(value: string): boolean {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);

  if (month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Rejects text that is not a day the calendar has, whichever field it arrived on.
 *
 * Shape and calendar only: a day past the end of its month is refused rather than rolled forward, and
 * no time of day, zone or instant is invented for it.
 */
function refineCalendarDay(value: string, ctx: z.RefinementCtx): void {
  if (!isCalendarDay(value)) {
    ctx.addIssue({ code: "custom", message: MESSAGES.dateInvalid });
  }
}

/**
 * A required civil day, carried as the text `YYYY-MM-DD` a date control produces.
 *
 * Trimmed first, because a stray space is a typing artefact rather than a statement about the day,
 * and then checked by shape and by the calendar. The value stays the text the worker's own date
 * carries: it is never turned into an instant, a zone or a midnight, so a goal that takes effect on a
 * day keeps taking effect on that day whatever the display zone becomes.
 */
const civilDaySchema = z
  .string({ error: MESSAGES.dateRequired })
  .trim()
  .superRefine(refineCalendarDay);

/**
 * A civil day that may be left out, where a cleared date control submits empty text.
 *
 * An empty date is the absence of a date and not a malformed one, so it becomes `undefined` — the
 * state of a task with no due date, which is a complete task. Every other value goes through the same
 * calendar check as a required day, so a wrong date is still refused rather than quietly dropped. Only
 * an absent value is treated differently, which is why this field states its own message instead of
 * borrowing the wording that asks for a day that must be given.
 */
const optionalCivilDaySchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string({ error: MESSAGES.dateInvalid }).trim().superRefine(refineCalendarDay).optional(),
);

// ---------------------------------------------------------------------------------------------
// saveGoal
// ---------------------------------------------------------------------------------------------

/**
 * Whether the text is one of the currencies the source reports amounts in.
 *
 * The code is compared exactly and is never trimmed or upper-cased here: a stored amount carries the
 * canonical code, so normalising `usd` into `USD` would accept a payload whose currency differs from
 * the one the worker picked, and case folding is itself locale-sensitive. A non-canonical code is
 * honestly unknown, and `UNKNOWN_CURRENCY` is the sentinel for an amount whose currency the source
 * never identified — it has no exponent, so it is never a currency a goal may be stated in.
 */
function isReportedCurrency(value: string): boolean {
  return value !== UNKNOWN_CURRENCY && isKnownCurrency(value);
}

/**
 * The shape the goal form posts, before the typed amount becomes money.
 *
 * `amount` is the text the worker entered, because converting it needs the currency beside it: the
 * exponent that decides how many decimals are allowed comes from the currency, not from the amount.
 * `measure` is the single measure `@/modules/support/goal` states a goal is set against — imported
 * rather than retyped, so a payload naming another measure is refused and the type, the service and
 * the surface cannot drift apart. It defaults to that measure because a goal form has no measure to
 * choose: an edit changes the amount and nothing else. Because that module declares the constant with
 * the measure union as its type, this field's type is the union while the check is strict equality
 * with the one value — a payload stating another measure is refused on the field, which is the same
 * treatment every other value a worker types receives.
 */
const goalSaveFormSchema = z.strictObject({
  currency: z.string({ error: MESSAGES.currencyRequired }).refine(isReportedCurrency, {
    error: MESSAGES.currencyRequired,
  }),
  amount: z.string({ error: MESSAGES.amountRequired }),
  measure: z.literal(GOAL_MEASURE, { error: MESSAGES.measureInvalid }).default(GOAL_MEASURE),
  effectiveFrom: civilDaySchema,
});

/**
 * Validates the `saveGoal` payload, turning the typed amount into the goal record's amount.
 *
 * The result is the amount as the support projection stores it: the currency code beside the exact
 * minor-unit count, produced by {@link parseMajorToMinor} through the money module's own constructor
 * and checked against `GoalAmountInput`, so this payload states an amount the goal module can validate
 * and compare without conversion. A refused amount becomes one message on the `amount` field — never a
 * form-level message and never a rounded figure — so `form-field` marks the field that is wrong.
 *
 * What the payload deliberately does not carry: no revision and no operation identity (the mutation
 * envelope owns both), no measure the worker could change, no gift, pledge, commitment, posting,
 * refund or public-progress field, and no permission claim. Those absences are why a save made here
 * can only ever be a goal edit.
 */
export const goalSavePayloadSchema = goalSaveFormSchema.transform((form, ctx) => {
  const parsed = parseMajorToMinor(form.amount, form.currency);

  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message, path: ["amount"] });
    return z.NEVER;
  }

  const amount: GoalAmountInput = {
    currency: form.currency,
    minorUnits: parsed.minorUnits,
  };

  return {
    currency: form.currency,
    amount,
    measure: form.measure,
    effectiveFrom: form.effectiveFrom,
  };
});

/** The validated `saveGoal` payload. */
export type GoalSavePayload = z.infer<typeof goalSavePayloadSchema>;

// ---------------------------------------------------------------------------------------------
// The thank-you follow-up a gift may lead to
// ---------------------------------------------------------------------------------------------

/**
 * The longest title this schema accepts, counted in Unicode code points.
 *
 * A form-level guard, not a product limit: the service still decides what it admits. It is stated
 * here so the composer's own limit and this check cannot show a worker one number and refuse another.
 */
const TITLE_MAX_LENGTH = 200;

/**
 * The longest category label this schema accepts, counted in Unicode code points.
 *
 * A category is the worker's own short label, so the bound is about reading it in a list rather than
 * about classifying anything.
 */
const CATEGORY_MAX_LENGTH = 60;

/**
 * Counts a value in Unicode code points, so a title in a script outside the Basic Multilingual Plane
 * counts once rather than twice.
 *
 * `String.prototype.length` counts UTF-16 code units, which would refuse a title the worker can read.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * A task title: the one field a task cannot do without.
 *
 * Trimmed, non-empty and bounded in code points. Nothing else is asked of it, so a reminder written as
 * three words is already a complete task and the follow-up offer needs no other answer from the worker.
 * The check is stated here rather than imported from the Work family's task schema, because a feature
 * folder never imports another one; it is the smallest sufficient form check, and the service's own
 * task validation stays authoritative over what a task may be.
 */
const titleSchema = z
  .string({ error: MESSAGES.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);

    if (length === 0) {
      ctx.addIssue({ code: "custom", message: MESSAGES.titleRequired });
    } else if (length > TITLE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.titleTooLong });
    }
  });

/**
 * A category: the worker's own short label, or no label at all.
 *
 * Not an enum, not a taxonomy and not a stage, so there is no allowed-values list for anything to keep
 * in step with. Blank text becomes `undefined`, because an uncategorised task is a complete state
 * rather than a missing value: no list excludes it and no field reports it as an error.
 */
const categorySchema = z
  .string({ error: MESSAGES.categoryInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CATEGORY_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.categoryTooLong });
    }
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));

/**
 * The record a follow-up task is about, chosen from the options a read envelope admitted.
 *
 * An opaque identifier and nothing more: it is never parsed for meaning, and no display name, email
 * address or postal address is accepted in its place, because an equal-looking value establishes
 * neither identity nor authority. Whether that record still exists and is still visible is the
 * service's question.
 */
const partnerIdSchema = z
  .string({ error: MESSAGES.partnerInvalid })
  .trim()
  .min(1, MESSAGES.partnerInvalid);

/** The two kinds of work a follow-up may be, as the task record states them. */
type FollowUpTaskKind = "default" | "meeting";

/**
 * The kinds of work, listed against the task vocabulary's own union so a kind that union names cannot
 * be missing here without failing to compile.
 *
 * Ordinary work is the default, because a thank-you or a follow-up is a reminder first; a meeting is
 * offered for a conversation the worker intends to hold, and a meeting with no planned time is a
 * complete meeting, so this payload states no schedule of its own.
 */
const FOLLOW_UP_TASK_KINDS = ["default", "meeting"] as const satisfies readonly FollowUpTaskKind[];

/**
 * Validates the `createTask` payload of the thank-you follow-up a gift may lead to.
 *
 * A task and nothing else: a title the worker can edit, an optional label, an optional due date, an
 * optional link to the person or household the gift is about, and a kind that defaults to ordinary
 * work. `dueOn` is a civil date and never a fabricated midnight, so the day the follow-up is due stays
 * the day the worker chose whatever zone it is later read in.
 *
 * The payload has no field for an amount, a currency, a gift or allocation identity, a designation, a
 * message body or a private note, and the strict object refuses any of those if a caller smuggles one
 * in. That absence is the point of the action: it creates one ordinary task to work through, and it
 * writes no financial record, sends no message, records no interaction and creates no stewardship
 * obligation. Completing the task later proves nothing about contact, payment or fulfilment either.
 *
 * `operation` is not a task field. It is the routing discriminant `POST /api/tasks` selects the
 * mutation by, declared as a defaulted literal so that this schema's *output* — which is what the
 * hook sends — names the change it makes. A caller composing a follow-up states a title and a due
 * date and no routing metadata, which is why `use-follow-up-task.ts` types what it accepts with
 * {@link FollowUpTaskInput} while the request it composes carries the parsed output.
 */
export const followUpTaskPayloadSchema = z.strictObject({
  operation: z.literal("createTask").default("createTask"),
  title: titleSchema,
  category: categorySchema,
  dueOn: optionalCivilDaySchema,
  partnerId: partnerIdSchema.optional(),
  kind: z.enum(FOLLOW_UP_TASK_KINDS, { error: MESSAGES.kindInvalid }).default("default"),
});

/** The validated `createTask` payload for a gift's thank-you follow-up. */
export type FollowUpTaskPayload = z.infer<typeof followUpTaskPayloadSchema>;

/**
 * The same payload as a caller states it: the task's own fields, with the routing discriminant
 * absent because this schema supplies it.
 */
export type FollowUpTaskInput = z.input<typeof followUpTaskPayloadSchema>;
