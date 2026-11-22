/** `GET /api/initiatives` — one page of this ministry's initiatives, or one initiative's detail when the request names it — and `POST /api/initiatives`, the one creation this path performs. */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Both verbs resolve the development session and evaluate the scenario clock once per request.
export const dynamic = "force-dynamic";
type InitiativeListQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;
type InitiativeStateName = NonNullable<InitiativeListQuery["state"]>;
type InitiativeSortName = NonNullable<InitiativeListQuery["sort"]>;
type InitiativeDetailQuery = NonNullable<Parameters<typeof reads.outreach.readInitiative>[1]>;
type InitiativeMemberStateName = NonNullable<InitiativeDetailQuery["memberState"]>;
const READ_ATTEMPT_ID = "read";
// What a read refuses, one sentence per field: each names the value the read does not admit and what to send instead, so a wrong request is answered at the field that carries it rather than performed as though it were the request the caller made.
const READ_MESSAGES = {
  stateInvalid: "Read initiatives in one of the states an initiative can stand in — open or closed — or leave the state out to read both.",
  sortInvalid: "Read the list in one of its own orders — name, period-start or state — or leave the order out to read by name.",
  pageInvalid: "State the page as a whole number from 1, or leave it out to read the first page.",
  pageSizeInvalid: "State the page size as a whole number from 1, or leave it out and the read applies its own 50-row default and 200-row ceiling.",
  memberStateInvalid: "Read the working list in one of its three membership states — included, removed or excluded — or leave the state out to read every member.",
  initiativeIdRequired: "Name the initiative to open by an identifier that is not blank, or leave the identifier out to read the list.",
} as const;
// The closed vocabularies the list read admits, stated from its own query type so no wire value is ever asserted into it.
const INITIATIVE_STATES = ["open", "closed"] as const satisfies readonly InitiativeStateName[];
const INITIATIVE_SORTS = ["name", "period-start", "state"] as const satisfies readonly InitiativeSortName[];
const INITIATIVE_MEMBER_STATES = ["included", "removed", "excluded"] as const satisfies readonly InitiativeMemberStateName[];
function nonBlank(message: string): z.ZodString {
  // Trimming is tested here rather than stated as `.trim().min(1)`, so a value of blanks is refused whatever order the schema applies its transformations in.
  return z.string().refine((value) => value.trim().length > 0, message);
}
// The keys a creation admits, and nothing else: the ministry and organisation come from the request's scope, the state and revision belong to the record, and the person responsible is named by an opaque
// principal reference. The object is strict, so a body stating any other key is refused at the path that key occupies rather than silently accepted without it, while bounds, calendar validity and identity
// remain `createInitiative`'s own to judge: only shape and non-emptiness are stated here. The period carries the two ends under the names the service's own schema reads — `startOn` and `endOn` — as civil dates exactly as they arrived: no instant, no display zone and no fabricated midnight.
const createInitiativePayloadSchema = z.strictObject({
  name: nonBlank("Give the initiative a name."),
  purpose: nonBlank("Describe what this initiative is for."),
  responsiblePrincipalId: nonBlank("Choose the person responsible for this initiative.").optional(),
  period: z.strictObject({ startOn: nonBlank("State the first day of the period."), endOn: nonBlank("State the last day of the period.") }).optional(),
});
const createInitiativeRequestSchema = mutationInputSchema(createInitiativePayloadSchema);
// The read side: the query grammar this transport admits  The collector below reads only the keys this family's reads admit, so an address parameter that belongs to something else is ignored rather than refused; a known parameter carrying a value the
// read does not admit is refused at that field by the grammar.
const initiativeListQuerySchema = z.strictObject({
  state: z.enum(INITIATIVE_STATES, { error: READ_MESSAGES.stateInvalid }).optional(),
  // An address parameter is always text, so the search states no refusal of its own: the read matches it against the whole authorised result, and a search that matches nothing is an empty list.
  search: z.string().optional(),
  sort: z.enum(INITIATIVE_SORTS, { error: READ_MESSAGES.sortInvalid }).optional(),
  // The release's 50-row default and 200-row ceiling belong to the read, which clamps the size it is given and reports the whole-result total, so nothing here defaults, caps, counts or slices a page.
  page: z.coerce.number({ error: READ_MESSAGES.pageInvalid }).int({ error: READ_MESSAGES.pageInvalid }).min(1, { error: READ_MESSAGES.pageInvalid }).optional(),
  pageSize: z.coerce.number({ error: READ_MESSAGES.pageSizeInvalid }).int({ error: READ_MESSAGES.pageSizeInvalid }).min(1, { error: READ_MESSAGES.pageSizeInvalid }).optional(),
});
type InitiativeListQueryParams = z.output<typeof initiativeListQuerySchema>;
function rawInitiativeListParams(search: URLSearchParams): Record<string, unknown> {
  return { state: search.get("state") ?? undefined, search: search.get("search") ?? undefined, sort: search.get("sort") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined };
}
/** The question the list read is asked, stated in the read's own vocabulary. */
function initiativeListQueryOf(params: InitiativeListQueryParams): InitiativeListQuery {
  return {
    ...(params.state === undefined ? {} : { state: params.state }),
    ...(params.search === undefined ? {} : { search: params.search }),
    ...(params.sort === undefined ? {} : { sort: params.sort }),
    ...(params.page === undefined ? {} : { page: params.page }),
    ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
  };
}
/** The identifier a request names when it asks for one initiative rather than the list. */
const INITIATIVE_ID_PARAM = "initiativeId";
const initiativeDetailQuerySchema = z.strictObject({
  initiativeId: z.string({ error: READ_MESSAGES.initiativeIdRequired }).trim().min(1, READ_MESSAGES.initiativeIdRequired),
  memberState: z.enum(INITIATIVE_MEMBER_STATES, { error: READ_MESSAGES.memberStateInvalid }).optional(),
  page: z.coerce.number({ error: READ_MESSAGES.pageInvalid }).int({ error: READ_MESSAGES.pageInvalid }).min(1, { error: READ_MESSAGES.pageInvalid }).optional(),
  pageSize: z.coerce.number({ error: READ_MESSAGES.pageSizeInvalid }).int({ error: READ_MESSAGES.pageSizeInvalid }).min(1, { error: READ_MESSAGES.pageSizeInvalid }).optional(),
  // Each of the initiative's three lists carries its own window, so a page of Requests never moves the working list or the work the initiative owns. The 50-row default and the 200-row ceiling belong to the read on every one of them, so nothing here defaults, caps or slices.
  requestsPage: z.coerce.number({ error: READ_MESSAGES.pageInvalid }).int({ error: READ_MESSAGES.pageInvalid }).min(1, { error: READ_MESSAGES.pageInvalid }).optional(),
  requestsPageSize: z.coerce.number({ error: READ_MESSAGES.pageSizeInvalid }).int({ error: READ_MESSAGES.pageSizeInvalid }).min(1, { error: READ_MESSAGES.pageSizeInvalid }).optional(),
  nextWorkPage: z.coerce.number({ error: READ_MESSAGES.pageInvalid }).int({ error: READ_MESSAGES.pageInvalid }).min(1, { error: READ_MESSAGES.pageInvalid }).optional(),
  nextWorkPageSize: z.coerce.number({ error: READ_MESSAGES.pageSizeInvalid }).int({ error: READ_MESSAGES.pageSizeInvalid }).min(1, { error: READ_MESSAGES.pageSizeInvalid }).optional(),
});
type InitiativeDetailQueryParams = z.output<typeof initiativeDetailQuerySchema>;
function rawInitiativeDetailParams(search: URLSearchParams): Record<string, unknown> {
  return {
    initiativeId: search.get(INITIATIVE_ID_PARAM) ?? undefined,
    memberState: search.get("memberState") ?? undefined,
    page: search.get("page") ?? undefined,
    pageSize: search.get("pageSize") ?? undefined,
    requestsPage: search.get("requestsPage") ?? undefined,
    requestsPageSize: search.get("requestsPageSize") ?? undefined,
    nextWorkPage: search.get("nextWorkPage") ?? undefined,
    nextWorkPageSize: search.get("nextWorkPageSize") ?? undefined,
  };
}
/** The narrowing and the three page windows the detail read is asked for, on the same rule the list follows: every value was admitted before it arrived here. */
function initiativeDetailQueryOf(params: InitiativeDetailQueryParams): InitiativeDetailQuery {
  return {
    ...(params.memberState === undefined ? {} : { memberState: params.memberState }),
    ...(params.page === undefined ? {} : { page: params.page }),
    ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
    ...(params.requestsPage === undefined ? {} : { requestsPage: params.requestsPage }),
    ...(params.requestsPageSize === undefined ? {} : { requestsPageSize: params.requestsPageSize }),
    ...(params.nextWorkPage === undefined ? {} : { nextWorkPage: params.nextWorkPage }),
    ...(params.nextWorkPageSize === undefined ? {} : { nextWorkPageSize: params.nextWorkPageSize }),
  };
}
/** One page of initiatives as the request asked for it, or the one initiative the request named: the read's envelope, or the read's own `denied` or `unavailable` refusal. A query the read does not admit is `invalid` at the field that carries it. */
export async function GET(request: Request): Promise<Response> {
  try {
    const search = new URL(request.url).searchParams;
    // One route, two reads: the identifier names a detail and its absence names the list, so this family needs no second transport path for the record it opens.
    if (search.has(INITIATIVE_ID_PARAM)) {
      const detail = initiativeDetailQuerySchema.safeParse(rawInitiativeDetailParams(search));
      if (!detail.success) {
        // No source behind the read failed here, so a value this read does not admit is answered with the same per-field `invalid` outcome the write answers, naming the field to correct.
        return toResponse(outcomeFromError(READ_ATTEMPT_ID, detail.error));
      }
      return toResponse(await reads.outreach.readInitiative(detail.data.initiativeId, initiativeDetailQueryOf(detail.data)));
    }
    const grammar = initiativeListQuerySchema.safeParse(rawInitiativeListParams(search));
    if (!grammar.success) {
      return toResponse(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
    }
    return toResponse(await reads.outreach.readInitiatives(initiativeListQueryOf(grammar.data)));
  } catch (error) {
    // One mapper knows a store outage, a session that cannot be established and a lost acknowledgement apart, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one initiative in the ministry this session is acting in. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = createInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationIdentityOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.outreach.createInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
