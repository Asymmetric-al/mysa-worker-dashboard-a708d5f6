import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, reads, refusedRead, toResponse } from "@/modules/data-service";
import { writeRoute } from "../handler";
import { READ_ATTEMPT, readResponse } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type InitiativeListQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;
type InitiativeStateName = NonNullable<InitiativeListQuery["state"]>;
type InitiativeSortName = NonNullable<InitiativeListQuery["sort"]>;
type InitiativeDetailQuery = NonNullable<Parameters<typeof reads.outreach.readInitiative>[1]>;
type InitiativeMemberStateName = NonNullable<InitiativeDetailQuery["memberState"]>;
const READ_MESSAGES = {
  stateInvalid: "Read initiatives in one of the states an initiative can stand in — open or closed — or leave the state out to read both.",
  sortInvalid: "Read the list in one of its own orders — name, period-start or state — or leave the order out to read by name.",
  pageInvalid: "State the page as a whole number from 1, or leave it out to read the first page.",
  pageSizeInvalid: "State the page size as a whole number from 1, or leave it out and the read applies its own 50-row default and 200-row ceiling.",
  memberStateInvalid: "Read the working list in one of its three membership states — included, removed or excluded — or leave the state out to read every member.",
  initiativeIdRequired: "Name the initiative to open by an identifier that is not blank, or leave the identifier out to read the list.",
} as const;
const INITIATIVE_STATES = ["open", "closed"] as const satisfies readonly InitiativeStateName[];
const INITIATIVE_SORTS = ["name", "period-start", "state"] as const satisfies readonly InitiativeSortName[];
const INITIATIVE_MEMBER_STATES = ["included", "removed", "excluded"] as const satisfies readonly InitiativeMemberStateName[];
const nonBlank = (message: string): z.ZodString => z.string().refine((value) => value.trim().length > 0, message);
const createInitiativePayloadSchema = z.strictObject({
  name: nonBlank("Give the initiative a name."),
  purpose: nonBlank("Describe what this initiative is for."),
  responsiblePrincipalId: nonBlank("Choose the person responsible for this initiative.").optional(),
  period: z.strictObject({ startOn: nonBlank("State the first day of the period."), endOn: nonBlank("State the last day of the period.") }).optional(),
});
const createInitiativeRequestSchema = mutationInputSchema(createInitiativePayloadSchema);
const initiativeListQuerySchema = z.strictObject({
  state: z.enum(INITIATIVE_STATES, { error: READ_MESSAGES.stateInvalid }).optional(),
  search: z.string().optional(),
  sort: z.enum(INITIATIVE_SORTS, { error: READ_MESSAGES.sortInvalid }).optional(),
  page: z.coerce.number({ error: READ_MESSAGES.pageInvalid }).int({ error: READ_MESSAGES.pageInvalid }).min(1, { error: READ_MESSAGES.pageInvalid }).optional(),
  pageSize: z.coerce.number({ error: READ_MESSAGES.pageSizeInvalid }).int({ error: READ_MESSAGES.pageSizeInvalid }).min(1, { error: READ_MESSAGES.pageSizeInvalid }).optional(),
});
const rawInitiativeListParams = (search: URLSearchParams): Record<string, unknown> => ({ state: search.get("state") ?? undefined, search: search.get("search") ?? undefined, sort: search.get("sort") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined });
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
const rawInitiativeDetailParams = (search: URLSearchParams): Record<string, unknown> => ({
  initiativeId: search.get(INITIATIVE_ID_PARAM) ?? undefined,
  memberState: search.get("memberState") ?? undefined,
  page: search.get("page") ?? undefined,
  pageSize: search.get("pageSize") ?? undefined,
  requestsPage: search.get("requestsPage") ?? undefined,
  requestsPageSize: search.get("requestsPageSize") ?? undefined,
  nextWorkPage: search.get("nextWorkPage") ?? undefined,
  nextWorkPageSize: search.get("nextWorkPageSize") ?? undefined,
});
/** One page of initiatives as the request asked for it, or the one initiative the request named: the read's envelope, or the read's own `denied` or `unavailable` refusal, with a query the read does not admit answered `invalid` at the field that carries it. */
async function readInitiatives(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  if (!search.has(INITIATIVE_ID_PARAM)) {
    const list = initiativeListQuerySchema.safeParse(rawInitiativeListParams(search));
    return list.success ? readResponse(READ_ATTEMPT, () => reads.outreach.readInitiatives(list.data)) : toResponse(refusedRead(READ_ATTEMPT, list.error));
  }
  const detail: z.ZodSafeParseResult<InitiativeDetailQueryParams> = initiativeDetailQuerySchema.safeParse(rawInitiativeDetailParams(search));
  if (!detail.success) return toResponse(refusedRead(READ_ATTEMPT, detail.error));
  const { initiativeId, ...narrowing } = detail.data;
  return readResponse(READ_ATTEMPT, () => reads.outreach.readInitiative(initiativeId, narrowing));
}
/** Creates one initiative in the ministry this session is acting in. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
const createInitiative = (request: Request): Promise<Response> => writeRoute(request, createInitiativeRequestSchema, mutations.outreach.createInitiative);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readInitiatives, POST: createInitiative });
