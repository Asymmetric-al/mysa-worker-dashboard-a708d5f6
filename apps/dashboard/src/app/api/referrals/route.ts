import { z } from "zod";
import { mutationInputSchema, mutations, reads, refusedRead, toResponse, type ReferralCycleRecord } from "@/modules/data-service";
import { writeRoute } from "../handler";
import { READ_ATTEMPT, readResponse } from "../read";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_REFERENCE_LENGTH = 200;
const MAX_SYSTEM_LENGTH = 64;
const MAX_ZONE_LENGTH = 64;
const MAX_SEARCH_LENGTH = 120;
const MESSAGES = {
  partnerRequired: "Choose the person this introduction refers to.",
  partnerTooLong: "A partner reference is at most 200 characters.",
  dateRequired: "State the date the introduction actually happened on.",
  dateInvalid: "Enter the date as a real calendar date in the form YYYY-MM-DD.",
  dateWithUnknownPrecision: "An unknown introduction date states no date at all, rather than a guess a later reader would treat as evidence.",
  precisionRequired: "Record how precisely the date is known: the date itself, an approximation, or unknown.",
  zoneRequired: "State the time zone this introduction date is known in.",
  zoneInvalid: "Use a time zone name such as Europe/London, or an offset such as +05:30.",
  sourceSystemRequired: "Name the source system that issued this reference.",
  sourceSystemTooLong: "A source system name is at most 64 characters.",
  sourceReferenceRequired: "Enter the reference the source issued.",
  sourceReferenceTooLong: "A source reference is at most 200 characters.",
  listInvalid: "Read one of the three referral lists: active, incomplete-date or expired.",
  searchTooLong: "Shorten the search to 120 characters or fewer.",
  pageInvalid: "State the page as a whole number from 1.",
  pageSizeInvalid: "State the page size as a whole number from 1.",
} as const;
type ReferralListQuery = NonNullable<Parameters<typeof reads.referrals.readReferrals>[0]>;
type ReferralListName = NonNullable<ReferralListQuery["list"]>;
const REFERRAL_LISTS = ["active", "incomplete-date", "expired"] as const satisfies readonly ReferralListName[];
const DATE_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly ReferralCycleRecord["datePrecision"][];
const SOURCE_ZONE_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*|[+-]\d{2}:\d{2})$/u;
const referralListQuerySchema = z.strictObject({
  list: z.enum(REFERRAL_LISTS, { error: MESSAGES.listInvalid }).optional(),
  search: z.string({ error: MESSAGES.searchTooLong }).trim().max(MAX_SEARCH_LENGTH, MESSAGES.searchTooLong).optional(),
  page: z.coerce.number({ error: MESSAGES.pageInvalid }).int({ error: MESSAGES.pageInvalid }).min(1, { error: MESSAGES.pageInvalid }).optional(),
  pageSize: z.coerce.number({ error: MESSAGES.pageSizeInvalid }).int({ error: MESSAGES.pageSizeInvalid }).min(1, { error: MESSAGES.pageSizeInvalid }).optional(),
});
const rawReferralListParams = (search: URLSearchParams): Record<string, unknown> => ({ list: search.get("list") ?? undefined, search: search.get("search") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined });
const introductionPayloadSchema = z
  .strictObject({
    partnerId: z.string({ error: MESSAGES.partnerRequired }).trim().min(1, MESSAGES.partnerRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.partnerTooLong),
    originalIntroductionOn: z.union([z.iso.date({ error: MESSAGES.dateInvalid }), z.null()]).optional(),
    datePrecision: z.enum(DATE_PRECISIONS, { error: MESSAGES.precisionRequired }),
    sourceZone: z.string({ error: MESSAGES.zoneRequired }).trim().min(1, MESSAGES.zoneRequired).max(MAX_ZONE_LENGTH, MESSAGES.zoneInvalid).regex(SOURCE_ZONE_SHAPE, MESSAGES.zoneInvalid),
    sourceReference: z.strictObject({
      system: z.string({ error: MESSAGES.sourceSystemRequired }).trim().min(1, MESSAGES.sourceSystemRequired).max(MAX_SYSTEM_LENGTH, MESSAGES.sourceSystemTooLong),
      reference: z.string({ error: MESSAGES.sourceReferenceRequired }).trim().min(1, MESSAGES.sourceReferenceRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.sourceReferenceTooLong),
    }),
  })
  .superRefine((payload, context) => {
    const stated = payload.originalIntroductionOn ?? null;
    if (payload.datePrecision === "unknown") {
      if (stated !== null) context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: MESSAGES.dateWithUnknownPrecision });
      return;
    }
    if (stated === null) context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: MESSAGES.dateRequired });
  });
const recordIntroductionBodySchema = mutationInputSchema(introductionPayloadSchema);
const REFERRAL_ID_PARAM = "referralId";
/** One page of one referral list, or the one cycle the request named, as one envelope either way, or the read's own `denied`/`unavailable` outcome. */
async function readReferrals(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const referralId = search.get(REFERRAL_ID_PARAM);
  if (referralId !== null && referralId.trim().length > 0) return readResponse(READ_ATTEMPT, () => reads.referrals.readReferral(referralId));
  const grammar = referralListQuerySchema.safeParse(rawReferralListParams(search));
  if (!grammar.success) return toResponse(refusedRead(READ_ATTEMPT, grammar.error));
  return readResponse(READ_ATTEMPT, () => reads.referrals.readReferrals(grammar.data));
}
/** Records one cycle's original introduction date and the precision it is known to, as `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. The one diagnostic line for the attempt is written by the service's own runner, under the authority it holds. */
const recordCycleIntroduction = (request: Request): Promise<Response> => writeRoute(request, recordIntroductionBodySchema, (input) => mutations.referrals.recordIntroduction(input));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readReferrals, POST: recordCycleIntroduction });
