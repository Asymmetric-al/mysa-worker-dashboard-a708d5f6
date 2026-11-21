/**
 * `POST /api/partners/[partnerId]/views` — the browser's only way to save, rename or delete the
 * caller's own saved roster query.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Saving, renaming or deleting a view resolves this session's admission and evaluates the scenario clock
// once per request, so no answer here may be served from a cache.
export const dynamic = "force-dynamic";

interface PartnerViewsParams {
  readonly partnerId: string;
}
// The attempt marker a body with no readable operation id is answered under: the request named no attempt,
// so none of its own can be reported back to it.
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
// Wording
//
// Each sentence says what to correct and why the rule exists, so a refusal is actionable where it is read.
const MESSAGES = {
  intentRequired: "State which change this request makes as payload.intent: saveView, renameView or deleteView.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  viewIdRequired: "This change applies to one saved view, so name it as viewId.",
  viewIdTooLong: "A saved view's identifier is the opaque value the roster gave you, so choose the view again from the list.",
  viewNameRequired: "A saved view needs a name, so state the name this query is saved under.",
  viewNameTooLong: "A saved view's name is at most 80 characters, so shorten this one.",
  searchRequired: "A saved view states the search text it was saved with, empty when it had none.",
  searchTooLong: "The stored search text is at most 200 characters, so shorten the query or save the view from a narrower search.",
  facetIdRequired: "A stored filter is missing the facet it belongs to.",
  facetIdTooLong: "A stored filter names a facet this roster does not have, so save the view again from the filter bar.",
  facetValueRequired: "A selected filter value is empty, so it matches nothing.",
  facetValueTooLong: "A selected filter value is longer than the roster holds, so save the view again from the filter bar.",
  facetValuesTooMany: "One filter stores at most 200 selected values, so narrow the selection before saving it.",
  columnKeyEmpty: "A stored column entry is missing the column it names.",
  sortFieldMissing: "A stored sort needs the column it orders by.",
  sortFieldTooLong: "A stored sort names a column this roster does not have, so save the view again from the list header.",
  sortDirectionInvalid: "A stored sort runs ascending or descending.",
  pageSizeInvalid: "A stored page size is a whole number of rows, so state it as one.",
  pageSizeTooSmall: "A stored page holds at least one row.",
  pageSizeTooLarge: "A stored page holds at most 200 rows, so choose the smaller page size.",
} as const;
// Bounds
//
// The mutation declares these ceilings for the record it stores, and it validates the payload again before
// writing, so the same number is stated here: a request refused at this boundary is refused with a message
// that names the field, and no request that reaches the service is refused for a length this file allowed.
const OPAQUE_ID_MAX_LENGTH = 160;

const VIEW_NAME_MAX_LENGTH = 80;

const SEARCH_TEXT_MAX_LENGTH = 200;

const FACET_ID_MAX_LENGTH = 80;

const FACET_VALUE_MAX_LENGTH = 160;

const FACET_VALUES_MAX_COUNT = 200;

const PAGE_SIZE_CAP = 200;

const VIEW_SORT_DIRECTIONS = ["asc", "desc"] as const;
// The stored query
//
// The saved view keeps the choices the roster read is issued with, and nothing else: this transport checks
// that the stored value has that shape and never runs, filters, sorts, expands or counts it, because the
// service re-issues the stored query when the view is opened.
const storedViewQuerySchema = z.strictObject({
  search: z.string({ error: MESSAGES.searchRequired }).max(SEARCH_TEXT_MAX_LENGTH, MESSAGES.searchTooLong),
  applied: z.record(
    z.string({ error: MESSAGES.facetIdRequired }).min(1, MESSAGES.facetIdRequired).max(FACET_ID_MAX_LENGTH, MESSAGES.facetIdTooLong),
    z
      .array(z.string({ error: MESSAGES.facetValueRequired }).min(1, MESSAGES.facetValueRequired).max(FACET_VALUE_MAX_LENGTH, MESSAGES.facetValueTooLong))
      .max(FACET_VALUES_MAX_COUNT, MESSAGES.facetValuesTooMany),
  ),
  columnVisibility: z.record(z.string().min(1, MESSAGES.columnKeyEmpty), z.boolean()).optional(),
  sort: z
    .strictObject({
      field: z.string({ error: MESSAGES.sortFieldMissing }).min(1, MESSAGES.sortFieldMissing).max(FACET_ID_MAX_LENGTH, MESSAGES.sortFieldTooLong),
      direction: z.enum(VIEW_SORT_DIRECTIONS, { error: MESSAGES.sortDirectionInvalid }),
    })
    .optional(),
  pageSize: z.int({ error: MESSAGES.pageSizeInvalid }).min(1, MESSAGES.pageSizeTooSmall).max(PAGE_SIZE_CAP, MESSAGES.pageSizeTooLarge).optional(),
});

const viewIdSchema = z.string({ error: MESSAGES.viewIdRequired }).min(1, MESSAGES.viewIdRequired).max(OPAQUE_ID_MAX_LENGTH, MESSAGES.viewIdTooLong);

const viewNameSchema = z.string({ error: MESSAGES.viewNameRequired }).trim().min(1, MESSAGES.viewNameRequired).max(VIEW_NAME_MAX_LENGTH, MESSAGES.viewNameTooLong);
// The payloads
//
// One payload per named mutation, each closed: an unknown member is `invalid` with the key named in the
// message rather than quietly dropped, which is what makes a body mixing two intents a refusal instead of a
// guess. `saveView` carrying an existing `viewId` is how a view is updated: the caller's choices replace the
// ones it saved before, and no separate update or repair mutation exists.
const saveViewPayloadSchema = z.strictObject({
  intent: z.literal("saveView"),
  viewId: viewIdSchema.optional(),
  name: viewNameSchema,
  queryState: storedViewQuerySchema,
});

const renameViewPayloadSchema = z.strictObject({
  intent: z.literal("renameView"),
  viewId: viewIdSchema,
  name: viewNameSchema,
});

const deleteViewPayloadSchema = z.strictObject({
  intent: z.literal("deleteView"),
  viewId: viewIdSchema,
});
// One body schema per mutation: the four-field envelope, with that mutation's own payload
const saveViewBodySchema = mutationInputSchema(saveViewPayloadSchema);

const renameViewBodySchema = mutationInputSchema(renameViewPayloadSchema);

const deleteViewBodySchema = mutationInputSchema(deleteViewPayloadSchema);

const VIEW_INTENTS = ["saveView", "renameView", "deleteView"] as const;
// The write side: one named mutation per request
const attemptIdentitySchema = z.object({ operationId: z.string() });

const intentClaimSchema = z.object(
  {
    payload: z.object({ intent: z.enum(VIEW_INTENTS, { error: MESSAGES.intentRequired }) }, { error: MESSAGES.intentRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    // A body that is not JSON names no attempt and no intent; it is answered with the field messages below
    // rather than an exception escaping the boundary.
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
function payloadOf<Payload extends { readonly intent: string }>(payload: Payload): Omit<Payload, "intent"> {
  // The intent chooses which mutation this request makes; it is this transport's own member and not a member
  // of any mutation's payload, whose schema is closed against unknown keys, so it is removed here rather than
  // forwarded as a field the service would refuse.
  const { intent: _discriminant, ...forwarded } = payload;
  return forwarded;
}
async function dispatch<Payload extends { readonly intent: string }>(
  schema: z.ZodType<MutationInput<Payload>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<Payload, "intent">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // The outcome carries per-field messages keyed by the payload's own paths, and `toResponse` re-bases them
    // onto the payload the caller posted.
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and a lost
    // acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** Saves, renames or deletes one saved view the caller owns, selected by `payload.intent`. */
export async function POST(request: Request, { params }: { params: Promise<PartnerViewsParams> }): Promise<Response> {
  // Next 16 hands the dynamic segment as a promise, so it is awaited. The segment is awaited rather than read:
  // it places this path under a partner and is not a saved view's identity, so it is never folded into the
  // payload, never narrows or widens the query a view stores, and never joins anything.
  await params;
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = intentClaimSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.intent) {
    case "saveView":
      return dispatch(saveViewBodySchema, raw, operationId, mutations.partners.saveView);
    case "renameView":
      return dispatch(renameViewBodySchema, raw, operationId, mutations.partners.renameView);
    case "deleteView":
      return dispatch(deleteViewBodySchema, raw, operationId, mutations.partners.deleteView);
    default:
      // Unreachable: the three names above are the closed set the intent schema admits, so a fourth intent
      // fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.intent, "Unhandled saved-view mutation");
  }
}
