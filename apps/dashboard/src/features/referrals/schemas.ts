import { z } from "zod";
import type { ReferralCycleRecord } from "@/modules/data-service";
import { parseCivilDate } from "@/modules/time/civil";
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
export const CONTINUE_MESSAGES = { referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.", referralTooLong: "A referral reference is at most 200 characters." } as const;
export const LIST_QUERY_MESSAGES = {
  viewInvalid: "Choose one of the referral lists: Active, Incomplete date or Expired.",
  searchTooLong: "Shorten the search to 120 characters or fewer.",
  statedOnce: "State this filter once; this address carries more than one value for it, so the list cannot tell which was meant.",
  formLevel: "This address does not describe a referral list the application can show, so the default list is shown.",
} as const;
export const DATE_PRECISION_VALUES = ["date", "approximate", "unknown"] as const satisfies readonly ReferralCycleRecord["datePrecision"][];
export type DatePrecisionValue = (typeof DATE_PRECISION_VALUES)[number];
export const datePrecisionSchema = z.enum(DATE_PRECISION_VALUES, { error: INTRODUCTION_MESSAGES.precisionRequired }) satisfies z.ZodType<ReferralCycleRecord["datePrecision"]>;
const civilDateSchema = z
  .string({ error: INTRODUCTION_MESSAGES.dateInvalid })
  .trim()
  .refine((value) => parseCivilDate(value).status === "parsed", INTRODUCTION_MESSAGES.dateInvalid);
const MAX_REFERENCE_LENGTH = 200;
const referenceFieldSchema = (required: string, tooLong: string): z.ZodString => z.string({ error: required }).trim().min(1, required).max(MAX_REFERENCE_LENGTH, tooLong);
export const sourceReferenceSchema = z.strictObject({
  system: z.string({ error: INTRODUCTION_MESSAGES.sourceSystemRequired }).trim().min(1, INTRODUCTION_MESSAGES.sourceSystemRequired).max(64, INTRODUCTION_MESSAGES.systemTooLong),
  reference: z.string({ error: INTRODUCTION_MESSAGES.sourceReferenceRequired }).trim().min(1, INTRODUCTION_MESSAGES.sourceReferenceRequired).max(MAX_REFERENCE_LENGTH, INTRODUCTION_MESSAGES.referenceTooLong),
});
const ZONE_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*|[+-]\d{2}:\d{2})$/u;
export const sourceZoneSchema = z.string({ error: INTRODUCTION_MESSAGES.zoneRequired }).trim().min(1, INTRODUCTION_MESSAGES.zoneRequired).max(64, INTRODUCTION_MESSAGES.zoneInvalid).regex(ZONE_SHAPE, INTRODUCTION_MESSAGES.zoneInvalid);
export const introductionPayloadSchema = z
  .strictObject({ partnerId: referenceFieldSchema(INTRODUCTION_MESSAGES.partnerRequired, INTRODUCTION_MESSAGES.partnerTooLong), originalIntroductionOn: civilDateSchema.nullable().optional(), datePrecision: datePrecisionSchema, sourceZone: sourceZoneSchema, sourceReference: sourceReferenceSchema })
  .superRefine((payload, context) => {
    if (payload.datePrecision === "unknown") {
      if (payload.originalIntroductionOn !== null && payload.originalIntroductionOn !== undefined) context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: INTRODUCTION_MESSAGES.unknownStatesNoDate });
      return;
    }
    if (payload.originalIntroductionOn === null || payload.originalIntroductionOn === undefined) context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: INTRODUCTION_MESSAGES.dateRequired });
  })
  .transform((payload) => ({ partnerId: payload.partnerId, originalIntroductionOn: payload.originalIntroductionOn ?? null, datePrecision: payload.datePrecision, sourceZone: payload.sourceZone, sourceReference: payload.sourceReference }));
export type IntroductionPayload = z.infer<typeof introductionPayloadSchema>;
export const continueReferralPayloadSchema = z.strictObject({ referralId: referenceFieldSchema(CONTINUE_MESSAGES.referralRequired, CONTINUE_MESSAGES.referralTooLong) });
export type ContinueReferralPayload = z.infer<typeof continueReferralPayloadSchema>;
export const REFERRAL_VIEWS = ["active", "incomplete-date", "expired"] as const;
export type ReferralView = (typeof REFERRAL_VIEWS)[number];
export const DEFAULT_REFERRAL_VIEW: ReferralView = "active";
export const REFERRAL_PAGE_SIZES = [50, 200] as const;
export const DEFAULT_REFERRAL_PAGE_SIZE = 50;
function wholeNumberFrom(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/u.test(text)) return undefined;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : undefined;
}
function pageFrom(value: unknown): number {
  const page = wholeNumberFrom(value);
  return page === undefined || page < 1 ? 1 : page;
}
function pageSizeFrom(value: unknown): number {
  const size = wholeNumberFrom(value);
  if (size === undefined || size < 1) return DEFAULT_REFERRAL_PAGE_SIZE;
  return size > REFERRAL_PAGE_SIZES[1] ? REFERRAL_PAGE_SIZES[1] : size;
}
const pageFieldSchema = z.unknown().transform(pageFrom);
const pageSizeFieldSchema = z.unknown().transform(pageSizeFrom);
export type ReferralListQuery = { readonly list: ReferralView; readonly search: string; readonly page: number; readonly pageSize: number };
export const referralListQuerySchema = z
  .strictObject({ list: z.enum(REFERRAL_VIEWS, { error: LIST_QUERY_MESSAGES.viewInvalid }).optional(), search: z.string({ error: LIST_QUERY_MESSAGES.searchTooLong }).trim().max(120, LIST_QUERY_MESSAGES.searchTooLong).optional(), page: pageFieldSchema.optional(), pageSize: pageSizeFieldSchema.optional() })
  .transform((raw): ReferralListQuery => ({ list: raw.list ?? DEFAULT_REFERRAL_VIEW, search: raw.search ?? "", page: raw.page ?? 1, pageSize: raw.pageSize ?? DEFAULT_REFERRAL_PAGE_SIZE }));
export type ReferralListQueryFieldErrors = Readonly<Record<string, readonly string[]>>;
export type ReferralListQueryParse = { readonly ok: true; readonly query: ReferralListQuery } | { readonly ok: false; readonly fieldErrors: ReferralListQueryFieldErrors };
const QUERY_KEYS = ["list", "search", "page", "pageSize"] as const;
function singleValue(searchParams: Record<string, string | string[] | undefined>, key: string, fieldErrors: Record<string, readonly string[]>): string | undefined {
  const raw = searchParams[key];
  if (raw === undefined) return undefined;
  const distinct = [...new Set(Array.isArray(raw) ? raw : [raw])];
  if (distinct.length === 0) return undefined;
  if (distinct.length > 1) {
    fieldErrors[key] = [LIST_QUERY_MESSAGES.statedOnce];
    return undefined;
  }
  return distinct[0];
}
/** Normalises a referral list's address parameters into the query state the read executes. */ export function parseReferralListQuery(searchParams: Record<string, string | string[] | undefined>): ReferralListQueryParse {
  const fieldErrors: Record<string, readonly string[]> = {};
  const candidate: Record<string, unknown> = {};
  for (const key of QUERY_KEYS) {
    const value = singleValue(searchParams, key, fieldErrors);
    if (value === undefined) continue;
    candidate[key] = value;
  }
  const parsed = referralListQuerySchema.safeParse(candidate);
  if (parsed.success && Object.keys(fieldErrors).length === 0) return { ok: true, query: parsed.data };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length === 0 ? "_root" : issue.path.map(String).join(".");
      fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
    }
  }
  return { ok: false, fieldErrors };
}
