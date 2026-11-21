/**
 * `GET /api/referrals` — the three referral lists, each cycle with the window the boundary module
 * resolves from its original introduction date, or one cycle's own detail when the request names it —
 * and `POST /api/referrals`, the one write this path performs: recording that original date with the
 * precision it is known to. The single continuation of one expired cycle is a separate command on its
 * own path.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationOutcome, type ReferralCycleRecord } from "@/modules/data-service";
// The read resolves the development-session cookie and evaluates the scenario clock per request, so no response may be cached.
export const dynamic = "force-dynamic";

// An attempt whose body never reached the schema: the marker names that fact rather than inventing an
// operation id, because minting one here would destroy replay recovery for the request that follows.
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const READ_ATTEMPT_ID = "read";

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

// The closed sets, each bound to the field it is read into, so a fourth list or a fourth precision
// fails to compile here instead of reaching the service.
type ReferralListQuery = NonNullable<Parameters<typeof reads.referrals.readReferrals>[0]>;

type ReferralListName = NonNullable<ReferralListQuery["list"]>;

const REFERRAL_LISTS = ["active", "incomplete-date", "expired"] as const satisfies readonly ReferralListName[];

const DATE_PRECISIONS = ["date", "approximate", "unknown"] as const satisfies readonly ReferralCycleRecord["datePrecision"][];

const SOURCE_ZONE_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*|[+-]\d{2}:\d{2})$/u;

// The read side: the query grammar this transport admits
const referralListQuerySchema = z.strictObject({
  list: z.enum(REFERRAL_LISTS, { error: MESSAGES.listInvalid }).optional(),
  search: z.string({ error: MESSAGES.searchTooLong }).trim().max(MAX_SEARCH_LENGTH, MESSAGES.searchTooLong).optional(),
  // The release's 50-row default and 200-row ceiling belong to the read, which clamps the size it is
  // given and reports the whole-result total, so nothing here defaults, caps, counts or slices a page.
  page: z.coerce.number({ error: MESSAGES.pageInvalid }).int({ error: MESSAGES.pageInvalid }).min(1, { error: MESSAGES.pageInvalid }).optional(),
  pageSize: z.coerce.number({ error: MESSAGES.pageSizeInvalid }).int({ error: MESSAGES.pageSizeInvalid }).min(1, { error: MESSAGES.pageSizeInvalid }).optional(),
});
type ReferralListQueryParams = z.output<typeof referralListQuerySchema>;

function rawReferralListParams(search: URLSearchParams): Record<string, unknown> {
  return {
    list: search.get("list") ?? undefined,
    search: search.get("search") ?? undefined,
    page: search.get("page") ?? undefined,
    pageSize: search.get("pageSize") ?? undefined,
  };
}
function referralListQueryOf(params: ReferralListQueryParams): ReferralListQuery {
  return {
    ...(params.list === undefined ? {} : { list: params.list }),
    ...(params.search === undefined ? {} : { search: params.search }),
    ...(params.page === undefined ? {} : { page: params.page }),
    ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
  };
}
// The write side: the introduction, and nothing the service resolves from it
//
// The payload is strict on purpose. Everything a window is derived from — the resolved endpoint, the
// window kind, the deadline, the cycle index, the predecessor, an entry timestamp, a second
// introduction — is answered by the service from the date and its precision, so a body that states
// any of them is refused by name rather than silently stripped and then quietly ignored.
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
      if (stated !== null) {
        context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: MESSAGES.dateWithUnknownPrecision });
      }
      return;
    }
    if (stated === null) {
      context.addIssue({ code: "custom", path: ["originalIntroductionOn"], message: MESSAGES.dateRequired });
    }
  });
const recordIntroductionBodySchema = mutationInputSchema(introductionPayloadSchema);

const PAYLOAD_PATH = "payload";

/**
 * Re-keys a payload refusal from the payload itself onto each key the introduction does not admit, so
 * the caller is told which field to remove instead of that the whole payload was refused.
 */
function namedUnknownFields(error: z.ZodError): z.ZodError {
  let rekeyedAny = false;
  const rekeyed: z.ZodIssue[] = error.issues.flatMap((issue): z.ZodIssue[] => {
    if (issue.code !== "unrecognized_keys" || issue.path.length !== 1 || issue.path[0] !== PAYLOAD_PATH) {
      return [issue];
    }
    rekeyedAny = true;
    return issue.keys.map((key) => ({
      code: "custom" as const,
      message: `The introduction states no "${key}", because it is either answered from the original introduction date and its precision, or set by a different command.`,
      path: [PAYLOAD_PATH, key],
    }));
  });
  return rekeyedAny ? new z.ZodError(rekeyed) : error;
}
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
// The read side: one cycle, or the lists
/**
 * The one parameter a request names a single cycle by. `GET /api/referrals` serves both `readReferrals`
 * and `readReferral`, so the detail is discriminated by this parameter on the one address this family
 * has; an absent or blank identifier leaves the request the list read unchanged.
 */
const REFERRAL_ID_PARAM = "referralId";
function referralDetailRequestOf(request: NextRequest): string | null {
  const referralId = new URL(request.url).searchParams.get(REFERRAL_ID_PARAM);
  return referralId === null || referralId.trim().length === 0 ? null : referralId;
}
/** One page of one referral list — each cycle with its introduction date, its precision and the resolved window, exactly as the read built them — or the one cycle the request named, as one envelope either way, or the read's own `denied`/`unavailable` outcome. */
export async function GET(request: NextRequest): Promise<Response> {
  // One route, two reads: a named cycle is read as its detail, and its absence leaves the request to
  // the list read below, so neither the record nor the lists need a second transport path.
  const referralId = referralDetailRequestOf(request);
  if (referralId !== null) {
    try {
      return toResponse(await reads.referrals.readReferral(referralId));
    } catch (error) {
      // The same mapper answers here as on the list read: the service states its own refusals as
      // outcomes, so a thrown fault is the only thing left to classify.
      return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
    }
  }
  const grammar = referralListQuerySchema.safeParse(rawReferralListParams(new URL(request.url).searchParams));
  if (!grammar.success) {
    // No source behind the read failed here, so a value this list does not admit is answered with the
    // same per-field `invalid` outcome the write answers, naming the field the caller has to correct.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
  }
  try {
    return toResponse(await reads.referrals.readReferrals(referralListQueryOf(grammar.data)));
  } catch (error) {
    // A throw is a store or medium fault rather than a presentation: the service answers its own
    // refusals as outcomes, so the one mapper decides between `unavailable` and `unknown`.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Records one cycle's original introduction date and the precision it is known to, as `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = recordIntroductionBodySchema.safeParse(body);
  if (!parsed.success) {
    // A malformed body and a rejected field are both `invalid` at this boundary, never a thrown 500.
    return toResponse(outcomeFromError(attemptIdOf(body), namedUnknownFields(parsed.error)));
  }
  const startedAt = performance.now();
  let outcome: MutationOutcome;
  try {
    outcome = await mutations.referrals.recordIntroduction(parsed.data);
  } catch (error) {
    outcome = outcomeFromError(parsed.data.operationId, error);
  }
  // One line per attempt at this boundary, carrying only the closed set of diagnostic fields: the
  // operation that names it, the scope it claimed, the outcome's discriminant and the measured
  // duration. It also describes an outcome built from a fault that escaped the service, which the
  // service's own report of a completed attempt cannot.
  logger.mutation({
    operationId: parsed.data.operationId,
    scope: parsed.data.scope,
    outcome: outcome.outcome,
    elapsedMs: performance.now() - startedAt,
  });
  return toResponse(outcome);
}
