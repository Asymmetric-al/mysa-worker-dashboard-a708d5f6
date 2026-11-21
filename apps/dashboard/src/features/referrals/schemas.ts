/**
 * The Referrals family's browser-side payload schemas — recording an original introduction date, and
 * continuing one expired cycle — plus the one normaliser for the three referral lists' query state.
 */
import { z } from "zod";
import type { ReferralCycleRecord } from "@/modules/data-service";
// Wording
//
// Each sentence below is a refusal a field shows, written once so a schema and the control that
// renders it cannot drift apart. Guidance about referrals themselves belongs to the family's copy;
// these are validation messages only, and each names the value that was refused and the remedy.
/** The refusals the `recordIntroduction` payload states, exported so the introduction form and the schema cannot word the same refusal two ways. */
export const INTRODUCTION_MESSAGES = {
  partnerRequired: "Choose the person this introduction refers to.",
  partnerTooLong: "A partner reference is at most 200 characters.",
  dateRequired: "Choose the date this introduction actually happened.",
  dateInvalid: "Enter the date as year, month and day, such as 2026-02-28.",
  unknownStatesNoDate: "An unknown introduction date states no date at all, so clear the date rather than entering a guess a later reader would treat as evidence.",
  precisionRequired: "Record how precisely the introduction date is known: the date itself, an approximation, or unknown.",
  zoneRequired: "State the time zone this introduction date is known in, such as Europe/London.",
  zoneInvalid: "Use a time zone name such as Europe/London, or an offset such as +05:30.",
  sourceSystemRequired: "Name the source system that issued this reference.",
  sourceReferenceRequired: "Enter the reference the source issued.",
  systemTooLong: "A source system name is at most 64 characters.",
  referenceTooLong: "A source reference is at most 200 characters.",
} as const;
/** The refusals the `continueReferral` payload states, exported so the Continue confirmation and the schema cannot word the same refusal two ways. */
export const CONTINUE_MESSAGES = {
  referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
} as const;
/** The refusals the referral list query state states, exported so the toolbar that shows them and the normaliser that raises them cannot drift apart. */
export const LIST_QUERY_MESSAGES = {
  viewInvalid: "Choose one of the referral lists: Active, Incomplete date or Expired.",
  searchTooLong: "Shorten the search to 120 characters or fewer.",
  sortFieldInvalid: "The referral lists are ordered by the end of their window or by their introduction date, so choose one of those.",
  sortAscendingUnavailable: "The referral lists are presented newest first, so the end of the window and the introduction date are shown descending.",
  statedOnce: "State this filter once; this address carries more than one value for it, so the list cannot tell which was meant.",
  formLevel: "This address does not describe a referral list the application can show, so the default list is shown.",
} as const;
// The precision an introduction date is known to
/** The three precisions an introduction date is recorded with, in the fixed order the release states them (AAP 0.8.3). */
export const DATE_PRECISION_VALUES = ["date", "approximate", "unknown"] as const satisfies readonly ReferralCycleRecord["datePrecision"][];
/** One date precision, derived from {@link DATE_PRECISION_VALUES}. */
export type DatePrecisionValue = (typeof DATE_PRECISION_VALUES)[number];
/** Validates the precision an introduction date is known to. */
export const datePrecisionSchema = z.enum(DATE_PRECISION_VALUES, {
  error: INTRODUCTION_MESSAGES.precisionRequired,
}) satisfies z.ZodType<ReferralCycleRecord["datePrecision"]>;
// A civil date, checked against the calendar
const CIVIL_DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
function isRealCivilDate(value: string): boolean {
  const match = CIVIL_DATE_SHAPE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1] ?? "");
  const month = Number(match[2] ?? "");
  const day = Number(match[3] ?? "");
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}
const civilDateSchema = z
  .string({ error: INTRODUCTION_MESSAGES.dateInvalid })
  .trim()
  .refine((value) => isRealCivilDate(value), INTRODUCTION_MESSAGES.dateInvalid);
// The opaque identities and the zone a payload carries
const MAX_REFERENCE_LENGTH = 200;

const MAX_SYSTEM_LENGTH = 64;

const MAX_ZONE_LENGTH = 64;

function referenceFieldSchema(required: string, tooLong: string): z.ZodString {
  return z.string({ error: required }).trim().min(1, required).max(MAX_REFERENCE_LENGTH, tooLong);
}
/** Validates an opaque, source-qualified reference: `{ system, reference }`. */
export const sourceReferenceSchema = z.strictObject({
  system: z.string({ error: INTRODUCTION_MESSAGES.sourceSystemRequired }).trim().min(1, INTRODUCTION_MESSAGES.sourceSystemRequired).max(MAX_SYSTEM_LENGTH, INTRODUCTION_MESSAGES.systemTooLong),
  reference: z
    .string({ error: INTRODUCTION_MESSAGES.sourceReferenceRequired })
    .trim()
    .min(1, INTRODUCTION_MESSAGES.sourceReferenceRequired)
    .max(MAX_REFERENCE_LENGTH, INTRODUCTION_MESSAGES.referenceTooLong),
});
const ZONE_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*|[+-]\d{2}:\d{2})$/u;

const sourceZoneSchema = z
  .string({ error: INTRODUCTION_MESSAGES.zoneRequired })
  .trim()
  .min(1, INTRODUCTION_MESSAGES.zoneRequired)
  .max(MAX_ZONE_LENGTH, INTRODUCTION_MESSAGES.zoneInvalid)
  .regex(ZONE_SHAPE, INTRODUCTION_MESSAGES.zoneInvalid);
// recordIntroduction: the original introduction date, with the precision it is known to
/** Validates the `recordIntroduction` payload: the partner, the original introduction date, the precision that date is known to, the zone it is known in, and the source that issued it. */
export const introductionPayloadSchema = z
  .strictObject({
    partnerId: referenceFieldSchema(INTRODUCTION_MESSAGES.partnerRequired, INTRODUCTION_MESSAGES.partnerTooLong),
    originalIntroductionOn: civilDateSchema.nullable().optional(),
    datePrecision: datePrecisionSchema,
    sourceZone: sourceZoneSchema,
    sourceReference: sourceReferenceSchema,
  })
  .superRefine((payload, context) => {
    if (payload.datePrecision === "unknown") {
      if (payload.originalIntroductionOn !== null && payload.originalIntroductionOn !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["originalIntroductionOn"],
          message: INTRODUCTION_MESSAGES.unknownStatesNoDate,
        });
      }
      return;
    }
    if (payload.originalIntroductionOn === null || payload.originalIntroductionOn === undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalIntroductionOn"],
        message: INTRODUCTION_MESSAGES.dateRequired,
      });
    }
  })
  .transform((payload) => ({
    partnerId: payload.partnerId,
    originalIntroductionOn: payload.originalIntroductionOn ?? null,
    datePrecision: payload.datePrecision,
    sourceZone: payload.sourceZone,
    sourceReference: payload.sourceReference,
  }));
/** The validated `recordIntroduction` payload: the original introduction date and its provenance. */
export type IntroductionPayload = z.infer<typeof introductionPayloadSchema>;
// continueReferral: one consumed cycle, and nothing the service resolves
/** Validates the `continueReferral` payload: the expired cycle the continuation acts on. */
export const continueReferralPayloadSchema = z.strictObject({
  referralId: referenceFieldSchema(CONTINUE_MESSAGES.referralRequired, CONTINUE_MESSAGES.referralTooLong),
});
/** The validated `continueReferral` payload: the identity of the one expired cycle to continue. */
export type ContinueReferralPayload = z.infer<typeof continueReferralPayloadSchema>;
// The three lists, and the query state an address carries for them
/** The three referral lists, in the order the surface presents them: Active, the introductions whose date is not precise enough for a deadline, and the narrow permitted Expired history. */
export const REFERRAL_VIEWS = ["active", "incomplete-date", "expired"] as const;
/** One referral list, derived from {@link REFERRAL_VIEWS}. */
export type ReferralView = (typeof REFERRAL_VIEWS)[number];
/** The list a request that names none is shown: Active, the question the surface opens on. */
export const DEFAULT_REFERRAL_VIEW: ReferralView = "active";
/** The two page sizes the referral pager offers, smallest first: the release's 50-row default and its 200-row ceiling (AAP 0.8.7). */
export const REFERRAL_PAGE_SIZES = [50, 200] as const;
/** The rows one page holds when a request states no size. */
export const DEFAULT_REFERRAL_PAGE_SIZE = 50;
/** The longest search text accepted: a name fragment, bounded so an address cannot carry a document. */
export const REFERRAL_SEARCH_MAX_LENGTH = 120;
/** The two keys the referral lists are ordered by, most significant first: the end of the window, then the introduction date. */
export const REFERRAL_SORT_FIELDS = ["windowEnd", "originalIntroductionOn"] as const;
/** One key a referral list may be ordered by, derived from {@link REFERRAL_SORT_FIELDS}. */
export type ReferralSortField = (typeof REFERRAL_SORT_FIELDS)[number];
/** Validates one ordering of a referral list: a key from the closed set, and the one direction the read honours. */
export const referralSortSchema = z.strictObject({
  field: z.enum(REFERRAL_SORT_FIELDS, { error: LIST_QUERY_MESSAGES.sortFieldInvalid }),
  direction: z.enum(["desc"], { error: LIST_QUERY_MESSAGES.sortAscendingUnavailable }),
});
/** The validated ordering of a referral list. */
export type ReferralSort = z.infer<typeof referralSortSchema>;

function wholeNumberFrom(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined;
  }
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/u.test(text)) {
    return undefined;
  }
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : undefined;
}
function pageFrom(value: unknown): number {
  const page = wholeNumberFrom(value);
  return page === undefined || page < 1 ? 1 : page;
}
function pageSizeFrom(value: unknown): number {
  const size = wholeNumberFrom(value);
  if (size === undefined || size < 1) {
    return DEFAULT_REFERRAL_PAGE_SIZE;
  }
  return size > REFERRAL_PAGE_SIZES[1] ? REFERRAL_PAGE_SIZES[1] : size;
}
const pageFieldSchema = z.unknown().transform(pageFrom);

const pageSizeFieldSchema = z.unknown().transform(pageSizeFrom);
/** The query state one referral list is read with: which list, the whole-dataset search text, the ordering the list is presented in, the page and the page size. */
export interface ReferralListQuery {
  readonly view: ReferralView;
  readonly search: string;
  readonly sort?: ReferralSort;
  readonly page: number;
  readonly pageSize: number;
}
/** Validates and normalises a referral list query, whether it arrives as an address's strings or as the numbers a table already holds. */
export const referralListQuerySchema = z
  .strictObject({
    view: z.enum(REFERRAL_VIEWS, { error: LIST_QUERY_MESSAGES.viewInvalid }).optional(),
    search: z.string({ error: LIST_QUERY_MESSAGES.searchTooLong }).trim().max(REFERRAL_SEARCH_MAX_LENGTH, LIST_QUERY_MESSAGES.searchTooLong).optional(),
    sort: referralSortSchema.optional(),
    page: pageFieldSchema.optional(),
    pageSize: pageSizeFieldSchema.optional(),
  })
  .transform((raw): ReferralListQuery => ({
    view: raw.view ?? DEFAULT_REFERRAL_VIEW,
    search: raw.search ?? "",
    sort: raw.sort,
    page: raw.page ?? 1,
    pageSize: raw.pageSize ?? DEFAULT_REFERRAL_PAGE_SIZE,
  }));
/** Messages keyed by field path, the shape the service's `invalid` outcome also carries, so a control renders a refusal this file raised and a refusal the service returned identically. */
export type ReferralListQueryFieldErrors = Readonly<Record<string, readonly string[]>>;
/** The result of reading an address into referral query state: the normalised query, or messages keyed by the field path a control shows them against. */
export type ReferralListQueryParse = { readonly ok: true; readonly query: ReferralListQuery } | { readonly ok: false; readonly fieldErrors: ReferralListQueryFieldErrors };

const FORM_LEVEL_FIELD = "_root";

const QUERY_KEYS = ["view", "search", "sort", "page", "pageSize"] as const;

function singleValue(searchParams: Record<string, string | string[] | undefined>, key: string, fieldErrors: Record<string, readonly string[]>): string | undefined {
  const raw = searchParams[key];
  if (raw === undefined) {
    return undefined;
  }
  const distinct = [...new Set(Array.isArray(raw) ? raw : [raw])];
  if (distinct.length === 0) {
    return undefined;
  }
  if (distinct.length > 1) {
    fieldErrors[key] = [LIST_QUERY_MESSAGES.statedOnce];
    return undefined;
  }
  return distinct[0];
}
function sortFromText(text: string): { field: string; direction: string } {
  const separator = text.indexOf(":");
  if (separator < 0) {
    return { field: text.trim(), direction: "desc" };
  }
  return {
    field: text.slice(0, separator).trim(),
    direction: text.slice(separator + 1).trim(),
  };
}
/** Normalises a referral list's address parameters into the query state the read executes. */
export function parseReferralListQuery(searchParams: Record<string, string | string[] | undefined>): ReferralListQueryParse {
  const fieldErrors: Record<string, readonly string[]> = {};
  const candidate: Record<string, unknown> = {};
  for (const key of QUERY_KEYS) {
    const value = singleValue(searchParams, key, fieldErrors);
    if (value === undefined) {
      continue;
    }
    candidate[key] = key === "sort" ? sortFromText(value) : value;
  }
  const parsed = referralListQuerySchema.safeParse(candidate);
  if (parsed.success && Object.keys(fieldErrors).length === 0) {
    return { ok: true, query: parsed.data };
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length === 0 ? FORM_LEVEL_FIELD : issue.path.map(String).join(".");
      fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
    }
  }
  return { ok: false, fieldErrors };
}
