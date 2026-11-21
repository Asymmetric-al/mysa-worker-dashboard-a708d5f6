/** `GET /api/partners` — the partner roster with its facet set, and the caller's saved views when the browser names that job in the query string — and `POST /api/partners`, the one creation this path … */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse, type PartnerRecord } from "@/modules/data-service";
import { isResolvableTimeZone, parseCivilDate } from "@/modules/time/civil";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../handler";
type RosterQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;
type RosterSort = NonNullable<RosterQuery["sort"]>;
const ROSTER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const satisfies readonly RosterSort["field"][];
const ROSTER_SORT_DIRECTIONS = ["asc", "desc"] as const satisfies readonly RosterSort["direction"][];
const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const satisfies readonly PartnerRecord["contactMethods"][number]["kind"][];
const UNATTEMPTED_REQUEST_ID = "no-operation-attempted";
// The one job this path serves besides the roster: the caller's own saved views, which the roster's saved-view bar reads so Rename, Delete and repair-on-drift can be driven from the views themselves. It rides the declared roster handler with the job in the query string (AAP 0.6.3 declares `GET
// /api/partners` for this family and no other read path), so a client reaches the list without a second endpoint: a path per job would be a second transport for one read, and the caller has to name which read it wants either way.
const SAVED_VIEWS_JOB = "saved-views";
// The other read this path serves besides the roster: the facet set describing it, which the roster's filter toolbar
// reads on its own. It is named in the query string for the same reason the saved-view job is — one declared read
// path, and the caller naming the read it wants — rather than derived from the roster's own envelope by the client,
// which would make a component the owner of a second shape of the same facts.
const FACETS_JOB = "facets";
function wholeNumber(message: string) {
  return z
    .string()
    .regex(/^\d{1,9}$/, message)
    .transform((value) => Number(value));
}
const rosterQuerySchema = z
  .strictObject({
    search: z.string().optional(),
    facet: z.array(z.string().min(1, "A facet needs a facet and a value.")).optional(),
    sort: z.enum(ROSTER_SORT_FIELDS, "Sort the roster by display name, kind, stage, favourite or last activity.").optional(),
    direction: z.enum(ROSTER_SORT_DIRECTIONS, "A sort runs ascending or descending.").optional(),
    page: wholeNumber("State the page as a whole number from 0, the first page.").optional(),
    pageSize: wholeNumber("State the page size as a whole number.").optional(),
    currency: z.string().min(1, "State the currency the giving figures are read in, or omit it.").optional(),
    from: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    to: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    timeZone: z.string().trim().min(1, "Name the zone the period resolves in, or omit it and the read uses UTC.").optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) {
      context.addIssue({ code: "custom", path: ["page"], message: "State the page a size applies to: a size with no page would either be ignored or silently read as the first page, and neither is a request you made." });
    }
    if ((params.sort === undefined) !== (params.direction === undefined)) {
      context.addIssue({ code: "custom", path: ["sort"], message: "State the sort field and its direction together: a field without a direction, or a direction without a field, orders the roster by nothing in particular." });
    }
    if ((params.from === undefined) !== (params.to === undefined)) {
      context.addIssue({ code: "custom", path: ["period"], message: "State both ends of the period: one date is not a range, and the roster's giving figures are read over a range." });
    }
    if (params.from !== undefined && params.to !== undefined) {
      const from = parseCivilDate(params.from);
      const to = parseCivilDate(params.to);
      if (from.status === "refused") {
        context.addIssue({ code: "custom", path: ["from"], message: `Write the period's start in the stored form YYYY-MM-DD. The value "${params.from}" is not a day the calendar holds, and a start the roster cannot place on the calendar cannot bound the period its giving figures are read over.` });
      }
      if (to.status === "refused") {
        context.addIssue({ code: "custom", path: ["to"], message: `Write the period's end in the stored form YYYY-MM-DD. The value "${params.to}" is not a day the calendar holds, and an end the roster cannot place on the calendar cannot bound the period its giving figures are read over.` });
      }
      // Two values the civil-date module accepted are complete `YYYY-MM-DD` days, which order chronologically exactly as they are written — the same comparison the roster's own stored days are judged by — so the ends are compared as they stand, without a date constructed
      // here to say what the stored form already says.
      if (from.status === "parsed" && to.status === "parsed" && params.from > params.to) {
        context.addIssue({ code: "custom", path: ["to"], message: `State the period's end on or after its start. The period "${params.from}" to "${params.to}" spans no day, so no giving figure is read over it and none is stated.` });
      }
    }
    // A blank value is already refused above, at the same field, so only a value the caller actually named is judged for resolvability: a caller who left it empty is told the one thing to correct rather than being told twice about the same empty string.
    if (params.timeZone !== undefined && params.timeZone.length > 0 && !isResolvableTimeZone(params.timeZone)) {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: `Name a time zone this runtime resolves, or omit it and the read uses UTC. The value "${params.timeZone}" names no zone this runtime holds, and a zone it cannot resolve would judge the roster's overdue, last-activity and last-received-gift days in a calendar the request did not ask for.`,
      });
    }
    for (const expression of params.facet ?? []) {
      const separator = expression.indexOf(":");
      if (separator < 1 || separator === expression.length - 1) {
        context.addIssue({ code: "custom", path: ["facet"], message: `Name each facet as facetId:value. The value "${expression}" states no facet and value pair, so it filters nothing.` });
      }
    }
  });
type RosterQueryParams = z.output<typeof rosterQuerySchema>;
const privatePreparationPayloadSchema = z.strictObject({
  displayName: z.string().trim().min(1, "A preparation record needs a name to recognise the contact by."),
  contactMethods: z.array(z.strictObject({ kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."), value: z.string().trim().min(1, "A contact method needs a value."), permitted: z.boolean() })).optional(),
  note: z.string().trim().min(1, "A note needs at least one visible character.").optional(),
});
const createPreparationRequestSchema = mutationInputSchema(privatePreparationPayloadSchema);
function firstValue(search: URLSearchParams, name: string): string | undefined {
  return search.get(name) ?? undefined;
}
function rawRosterParams(search: URLSearchParams): Record<string, unknown> {
  return {
    search: firstValue(search, "search"),
    facet: search.getAll("facet"),
    sort: firstValue(search, "sort"),
    direction: firstValue(search, "direction"),
    page: firstValue(search, "page"),
    pageSize: firstValue(search, "pageSize"),
    currency: firstValue(search, "currency"),
    from: firstValue(search, "from"),
    to: firstValue(search, "to"),
    timeZone: firstValue(search, "timeZone"),
  };
}
function assembleRosterQuery(params: RosterQueryParams): RosterQuery {
  const applied: Record<string, string[]> = {};
  for (const expression of params.facet ?? []) {
    const separator = expression.indexOf(":");
    const facetId = expression.slice(0, separator);
    const value = expression.slice(separator + 1);
    const selected = applied[facetId];
    if (selected === undefined) {
      applied[facetId] = [value];
    } else {
      selected.push(value);
    }
  }
  const page = params.page === undefined ? undefined : params.pageSize === undefined ? { index: params.page } : { index: params.page, size: params.pageSize };
  const period = params.from === undefined || params.to === undefined ? undefined : { from: params.from, to: params.to };
  return {
    ...(params.search === undefined ? {} : { search: params.search }),
    ...(Object.keys(applied).length === 0 ? {} : { applied }),
    ...(params.sort === undefined || params.direction === undefined ? {} : { sort: { field: params.sort, direction: params.direction } }),
    ...(page === undefined ? {} : { page }),
    ...(params.currency === undefined ? {} : { currency: params.currency }),
    ...(period === undefined ? {} : { period }),
    ...(params.timeZone === undefined ? {} : { timeZone: params.timeZone }),
  };
}
/** This path's refusals have always been echoed under its own `no-operation-attempted` marker, which is also the identity its reads report, so a caller's recovery is matched against the identity it already has; only that marker stays here, while the rule that reads the attempt the body claims is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed === UNIDENTIFIED_ATTEMPT ? UNATTEMPTED_REQUEST_ID : claimed;
}
/** The period and currency a facet read measures its giving facets over, taken from the same parameters the roster read parses, so the facet set and the roster describe one selection. */
function givingSelectionOf(params: RosterQueryParams): NonNullable<Parameters<typeof reads.partners.readFacets>[0]> {
  return { ...(params.currency === undefined ? {} : { currency: params.currency }), ...(params.from === undefined || params.to === undefined ? {} : { period: { from: params.from, to: params.to } }), ...(params.timeZone === undefined ? {} : { timeZone: params.timeZone }) };
}
/** Reads the partner roster, with the facet set describing the same query, as one envelope — or, when another job is named, the caller's own saved views with the drift each one now carries, or the facet set on its own. */
export async function GET(request: NextRequest): Promise<Response> {
  const search = new URL(request.url).searchParams;
  // A job the shell does not name answers the roster, which is this path's own read and the only one a caller who named no job can mean. The saved-view list and the facet set are addressed for the same reason the context chooser is: one declared read path, and the caller names the read it wants.
  if (search.get("job") === SAVED_VIEWS_JOB) {
    try {
      return toResponse(await reads.partners.readSavedViews());
    } catch (error) {
      // A read attempted no effect, so a throw here is a store or medium fault, or a failure whose fate is not known, and its outcome carries the marker rather than an operation id.
      return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, error));
    }
  }
  const params = rosterQuerySchema.safeParse(rawRosterParams(search));
  if (!params.success) {
    return toResponse(refusedRead(UNATTEMPTED_REQUEST_ID, params.error));
  }
  if (search.get("job") === FACETS_JOB) {
    try {
      return toResponse(await reads.partners.readFacets(givingSelectionOf(params.data)));
    } catch (error) {
      // A read attempted no effect, so a throw here is a store or medium fault, or a failure whose fate is not known, and its outcome carries the marker rather than an operation id.
      return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, error));
    }
  }
  try {
    const roster = await reads.partners.findPartners(assembleRosterQuery(params.data));
    return toResponse(roster);
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known. The read attempted no effect, so the outcome carries the marker rather than an operation id.
    return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, error));
  }
}
/** Creates the worker's own private preparation record for a contact. */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = createPreparationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(refusalIdentityOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.partnerPreparation.createPrivatePreparation(parsed.data));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
