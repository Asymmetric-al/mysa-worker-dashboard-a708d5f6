import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, reads, refusedRead, toResponse, type PartnerRecord } from "@/modules/data-service";
import { isResolvableTimeZone, parseCivilDate } from "@/modules/time/civil";
import { refusalIdentityGiven, writeRoute } from "../handler";
import { routeMethods } from "../methods";
import { readResponse } from "../read";
import { wholePageParameter } from "../paging";
import { refusedSearchParameters } from "../search";
type RosterQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;
type RosterSort = NonNullable<RosterQuery["sort"]>;
const ROSTER_SORT_FIELDS = ["displayName", "kind", "stage", "favourite", "lastActivityOn"] as const satisfies readonly RosterSort["field"][];
const ROSTER_SORT_DIRECTIONS = ["asc", "desc"] as const satisfies readonly RosterSort["direction"][];
const CONTACT_METHOD_KINDS = ["email", "phone", "postal"] as const satisfies readonly PartnerRecord["contactMethods"][number]["kind"][];
const UNATTEMPTED_REQUEST_ID = "no-operation-attempted";
const SAVED_VIEWS_JOB = "saved-views";
const FACETS_JOB = "facets";
const ROSTER_JOB = "roster";
/** The parameters each of this path's three jobs applies: the roster reads the whole filter set, the facet set describes the giving selection it is read with, and the saved views read none of them. */
const JOB_PARAMETERS: Readonly<Record<typeof ROSTER_JOB | typeof SAVED_VIEWS_JOB | typeof FACETS_JOB, readonly (keyof RosterQueryParams)[]>> = {
  [ROSTER_JOB]: ["search", "facet", "sort", "direction", "page", "pageSize", "currency", "from", "to", "timeZone"],
  [FACETS_JOB]: ["currency", "from", "to", "timeZone"],
  [SAVED_VIEWS_JOB]: [],
};
const rosterQuerySchema = z
  .strictObject({
    job: z.enum([ROSTER_JOB, SAVED_VIEWS_JOB, FACETS_JOB], "Read the roster, or name the saved-views or facets job, which with the roster are the only answers this path gives.").optional(),
    search: z.string().optional(),
    facet: z.array(z.string().min(1, "A facet needs a facet and a value.")).optional(),
    sort: z.enum(ROSTER_SORT_FIELDS, "Sort the roster by display name, kind, stage, favourite or last activity.").optional(),
    direction: z.enum(ROSTER_SORT_DIRECTIONS, "A sort runs ascending or descending.").optional(),
    page: wholePageParameter("State the page as a whole number from 0, the first page.").optional(),
    pageSize: wholePageParameter("State the page size as a whole number.").optional(),
    currency: z.string().min(1, "State the currency the giving figures are read in, or omit it.").optional(),
    from: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    to: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    timeZone: z.string().trim().min(1, "Name the zone the period resolves in, or omit it and the read uses UTC.").optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) context.addIssue({ code: "custom", path: ["page"], message: "State the page a size applies to: a size with no page would either be ignored or silently read as the first page, and neither is a request you made." });
    if ((params.sort === undefined) !== (params.direction === undefined)) context.addIssue({ code: "custom", path: ["sort"], message: "State the sort field and its direction together: a field without a direction, or a direction without a field, orders the roster by nothing in particular." });
    if ((params.from === undefined) !== (params.to === undefined)) context.addIssue({ code: "custom", path: ["period"], message: "State both ends of the period: one date is not a range, and the roster's giving figures are read over a range." });
    if (params.from !== undefined && params.to !== undefined) {
      const from = parseCivilDate(params.from);
      const to = parseCivilDate(params.to);
      if (from.status === "refused")
        context.addIssue({ code: "custom", path: ["from"], message: `Write the period's start in the stored form YYYY-MM-DD. The value "${params.from}" is not a day the calendar holds, and a start the roster cannot place on the calendar cannot bound the period its giving figures are read over.` });
      if (to.status === "refused") context.addIssue({ code: "custom", path: ["to"], message: `Write the period's end in the stored form YYYY-MM-DD. The value "${params.to}" is not a day the calendar holds, and an end the roster cannot place on the calendar cannot bound the period its giving figures are read over.` });
      if (from.status === "parsed" && to.status === "parsed" && params.from > params.to) context.addIssue({ code: "custom", path: ["to"], message: `State the period's end on or after its start. The period "${params.from}" to "${params.to}" spans no day, so no giving figure is read over it and none is stated.` });
    }
    if (params.timeZone !== undefined && params.timeZone.length > 0 && !isResolvableTimeZone(params.timeZone)) {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: `Name a time zone this runtime resolves, or omit it and the read uses UTC. The value "${params.timeZone}" names no zone this runtime holds, and a zone it cannot resolve would judge the roster's overdue, last-activity and last-received-gift days in a calendar the request did not ask for.`,
      });
    }
    for (const expression of params.facet ?? []) {
      const separator = expression.indexOf(":");
      if (separator < 1 || separator === expression.length - 1) context.addIssue({ code: "custom", path: ["facet"], message: `Name each facet as facetId:value. The value "${expression}" states no facet and value pair, so it filters nothing.` });
    }
    if (params.job === undefined) return;
    // Each job applies the parameters it reads: a parameter the chosen job cannot apply is refused rather than dropped once the job is known, because a read that dropped it would answer a result the caller did not ask for.
    const applied = JOB_PARAMETERS[params.job];
    for (const name of Object.keys(params) as (keyof RosterQueryParams)[]) {
      if (name === "job" || applied.includes(name)) continue;
      context.addIssue({ code: "custom", path: [name], message: `The "${params.job}" job reads no "${name}", so remove it: this path applies each parameter to the job that reads it rather than ignoring one the chosen job cannot.` });
    }
  });
type RosterQueryParams = z.output<typeof rosterQuerySchema>;
const privatePreparationPayloadSchema = z.strictObject({
  displayName: z.string().trim().min(1, "A preparation record needs a name to recognise the contact by."),
  contactMethods: z.array(z.strictObject({ kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."), value: z.string().trim().min(1, "A contact method needs a value."), permitted: z.boolean() })).optional(),
  note: z.string().trim().min(1, "A note needs at least one visible character.").optional(),
});
const createPreparationRequestSchema = mutationInputSchema(privatePreparationPayloadSchema);
function rawRosterParams(search: URLSearchParams): Record<string, unknown> {
  // Every name the request states is handed to the grammar, so a parameter this read does not declare is refused by name rather than dropped before the schema can see it; a repeated facet keeps all of its values, because several facets narrow one result together.
  const stated: Record<string, unknown> = {};
  for (const name of new Set(search.keys())) stated[name] = name === "facet" ? search.getAll("facet") : (search.get(name) ?? undefined);
  return stated;
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
const refusalIdentityOf = refusalIdentityGiven(UNATTEMPTED_REQUEST_ID);
const givingSelectionOf = (params: RosterQueryParams): NonNullable<Parameters<typeof reads.partners.readFacets>[0]> => ({
  ...(params.currency === undefined ? {} : { currency: params.currency }),
  ...(params.from === undefined || params.to === undefined ? {} : { period: { from: params.from, to: params.to } }),
  ...(params.timeZone === undefined ? {} : { timeZone: params.timeZone }),
});
async function readRoster(request: NextRequest): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const params = rosterQuerySchema.safeParse(rawRosterParams(search));
  if (!params.success) return toResponse(refusedRead(UNATTEMPTED_REQUEST_ID, refusedSearchParameters(params.error)));
  if (params.data.job === SAVED_VIEWS_JOB) return readResponse(UNATTEMPTED_REQUEST_ID, () => reads.partners.readSavedViews());
  if (params.data.job === FACETS_JOB) return readResponse(UNATTEMPTED_REQUEST_ID, () => reads.partners.readFacets(givingSelectionOf(params.data)));
  return readResponse(UNATTEMPTED_REQUEST_ID, () => reads.partners.findPartners(assembleRosterQuery(params.data)));
}
const createPreparation = (request: NextRequest): Promise<Response> => writeRoute(request, createPreparationRequestSchema, mutations.partnerPreparation.createPrivatePreparation, refusalIdentityOf);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readRoster, POST: createPreparation });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
