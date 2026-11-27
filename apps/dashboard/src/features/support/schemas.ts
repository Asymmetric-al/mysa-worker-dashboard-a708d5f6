import { z } from "zod";
import { minorUnitsOf, type MinorUnits } from "@/modules/money/amount";
import { exponentOf, isKnownCurrency, UNKNOWN_CURRENCY } from "@/modules/money/currency";
import { GOAL_MEASURE, type GoalAmountInput } from "@/modules/support/goal";
const MESSAGES = {
  amountRequired: "Enter a goal amount.",
  amountNotFigures: "Enter numbers only (for example, 1200 or 1200.50), with a decimal point and no currency symbols.",
  amountNotPositive: "Enter an amount greater than zero.",
  amountTooLarge: "That amount is too large to store accurately. Enter a smaller figure.",
  currencyRequired: "Choose one of the currencies reported for your account.",
  measureInvalid: "Support goals apply to received gifts only.",
  dateRequired: "Choose the date this goal takes effect.",
  dateInvalid: "Enter a valid calendar date (YYYY-MM-DD).",
  titleRequired: "Enter a task title.",
  titleTooLong: "Keep the title under 200 characters.",
  categoryInvalid: "Enter a short label or leave Category blank.",
  categoryTooLong: "Keep the category under 60 characters.",
  partnerInvalid: "Select a partner from the search results.",
  kindInvalid: "Choose Task or Meeting.",
} as const;
const PLAIN_DIGITS = /^\d+$/u;
const GROUPED_DIGITS = /^\d{1,3}(?:[,\u00A0\u202F ]\d{3})+$/u;
const GROUPING_MARKS = /[,\u00A0\u202F ]/gu;
const NEGATIVE_SIGN = /^[-\u2212]/u;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const fractionRefusedMessage = (currency: string, exponent: number): string => (exponent === 0 ? `A ${currency} amount has no decimal places, so enter a whole amount.` : `Use no more than ${exponent} ${exponent === 1 ? "decimal place" : "decimal places"} for this currency.`);
/** Reads the amount a worker typed as an exact count of `currency`'s minor units — the one place in this application where a typed amount becomes money. */ export function parseMajorToMinor(input: string, currency: string): { ok: true; minorUnits: MinorUnits } | { ok: false; message: string } {
  const exponent = exponentOf(currency);
  if (exponent === undefined || currency === UNKNOWN_CURRENCY) return { ok: false, message: MESSAGES.currencyRequired };
  const typed = input.trim();
  if (typed.length === 0) return { ok: false, message: MESSAGES.amountRequired };
  if (NEGATIVE_SIGN.test(typed)) return { ok: false, message: MESSAGES.amountNotPositive };
  const [wholePart = "", fractionPart, ...furtherParts] = typed.split(".");
  const fraction = fractionPart ?? "";
  if (furtherParts.length > 0 || (!PLAIN_DIGITS.test(wholePart) && !GROUPED_DIGITS.test(wholePart)) || (fraction.length > 0 && !PLAIN_DIGITS.test(fraction))) return { ok: false, message: MESSAGES.amountNotFigures };
  if (fraction.length > exponent) return { ok: false, message: fractionRefusedMessage(currency, exponent) };
  const count = Number.parseInt(`${wholePart.replace(GROUPING_MARKS, "")}${fraction.padEnd(exponent, "0")}`, 10);
  return !Number.isSafeInteger(count) ? { ok: false, message: MESSAGES.amountTooLarge } : count <= 0 ? { ok: false, message: MESSAGES.amountNotPositive } : { ok: true, minorUnits: minorUnitsOf(count) };
}
const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const LONG_MONTHS = [4, 6, 9, 11];
function isCalendarDay(value: string): boolean {
  if (!CIVIL_DATE_PATTERN.test(value)) return false;
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  return month < 1 || month > 12 ? false : day >= 1 && day <= (month === 2 ? (isLeapYear(year) ? 29 : 28) : LONG_MONTHS.includes(month) ? 30 : 31);
}
function refineCalendarDay(value: string, ctx: z.RefinementCtx): void {
  if (!isCalendarDay(value)) ctx.addIssue({ code: "custom", message: MESSAGES.dateInvalid });
}
const isReportedCurrency = (value: string): boolean => value !== UNKNOWN_CURRENCY && isKnownCurrency(value);
const goalSaveFormSchema = z.strictObject({
  currency: z.string({ error: MESSAGES.currencyRequired }).refine(isReportedCurrency, { error: MESSAGES.currencyRequired }),
  amount: z.string({ error: MESSAGES.amountRequired }),
  measure: z.literal(GOAL_MEASURE, { error: MESSAGES.measureInvalid }).default(GOAL_MEASURE),
  effectiveFrom: z.string({ error: MESSAGES.dateRequired }).trim().superRefine(refineCalendarDay),
});
export const goalSavePayloadSchema = goalSaveFormSchema.transform((form, ctx) => {
  const parsed = parseMajorToMinor(form.amount, form.currency);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message, path: ["amount"] });
    return z.NEVER;
  }
  const amount: GoalAmountInput = { currency: form.currency, minorUnits: parsed.minorUnits };
  return { currency: form.currency, amount, measure: form.measure, effectiveFrom: form.effectiveFrom };
});
export type GoalSavePayload = z.infer<typeof goalSavePayloadSchema>;
const codePointLength = (value: string): number => Array.from(value).length;
const titleSchema = z
  .string({ error: MESSAGES.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) ctx.addIssue({ code: "custom", message: MESSAGES.titleRequired });
    else if (length > 200) ctx.addIssue({ code: "custom", message: MESSAGES.titleTooLong });
  });
const categorySchema = z
  .string({ error: MESSAGES.categoryInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > 60) ctx.addIssue({ code: "custom", message: MESSAGES.categoryTooLong });
  })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
type FollowUpTaskKind = "default" | "meeting";
const FOLLOW_UP_TASK_KINDS = ["default", "meeting"] as const satisfies readonly FollowUpTaskKind[];
export const followUpTaskPayloadSchema = z.strictObject({
  operation: z.literal("createTask").default("createTask"),
  title: titleSchema,
  category: categorySchema,
  dueOn: z.preprocess((value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value), z.string({ error: MESSAGES.dateInvalid }).trim().superRefine(refineCalendarDay).optional()),
  partnerId: z.string({ error: MESSAGES.partnerInvalid }).trim().min(1, MESSAGES.partnerInvalid).optional(),
  kind: z.enum(FOLLOW_UP_TASK_KINDS, { error: MESSAGES.kindInvalid }).default("default"),
});
export type FollowUpTaskPayload = z.infer<typeof followUpTaskPayloadSchema>;
export type FollowUpTaskInput = z.input<typeof followUpTaskPayloadSchema>;
