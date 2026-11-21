/**
 * `GET /api/partners` — the partner roster with its facet set — and `POST /api/partners`, the one
 * creation this path performs: a worker's own private preparation record.
 *
 * Both handlers are thin in the sense the data seam requires. They read the request the browser made,
 * check that the values it carried are values the service accepts, call one named read or one named
 * mutation, and answer through `toResponse`. Nothing here searches, filters, counts, sorts, pages,
 * sums, authorises or compares a revision: each of those has exactly one owner inside
 * `@/modules/data-service`, and a second answer at the boundary would eventually disagree with it —
 * most visibly in `total`, which stays the whole-result count only while the service is its one
 * source.
 *
 * The roster read answers one envelope, not two documents. `findPartners` returns one page of rows,
 * the whole-result total and the facet set describing that same query — every filter the caller may
 * use, with the whole-result count of records carrying each value — under one `asOf`, one revision
 * and one coverage. Read as two calls, a surface could show counts describing a different filter set,
 * or counts read at a later instant than the rows it renders, and each document would have to state
 * its own basis. Here the facet set travels under `data.facets` inside the roster's own envelope, and
 * its option counts carry the `facets.` value-state paths they already had, so every value-bearing
 * field the response holds has a state the surface can read. There is no `/api/facets` path and none
 * may be added: this read is the only place facet data leaves the application. The answer also states
 * which filters took effect — `data.applied` for the facet selections it admitted, `data.appliedSearch`
 * for the search text it searched and `data.appliedPeriod` for the period its giving figures were read
 * over — because only the service knows which of them a retired value or an unavailable source left
 * out, and a toolbar rebuilt from the request would show a filter the read did not apply.
 *
 * A refusal is answered, never repaired. A denial or an absent source comes back through `toResponse`
 * exactly as the read reported it, because an empty roster and a zero count are the two answers an
 * outage must never look like, and a denial that carried a count, a title or a size would let a caller
 * enumerate what it may not see.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
  type PartnerRecord,
} from "@/modules/data-service";
import { isResolvableTimeZone, parseCivilDate } from "@/modules/time/civil";

/** The roster query the read accepts, taken from the read's own parameter list. */
type RosterQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;

/** One field the roster may be sorted by, as the read declares it. */
type RosterSort = NonNullable<RosterQuery["sort"]>;

/**
 * The sort fields the roster offers, checked against the read's own type.
 *
 * The list is repeated here because the read's tuple is not re-exported through the service's index,
 * and the `satisfies` clause is what makes the repetition safe: a field the service stops admitting
 * fails to compile here, and a field the service adds stays simply unoffered by this transport rather
 * than becoming an ordering nothing states.
 */
const ROSTER_SORT_FIELDS = [
  "displayName",
  "kind",
  "stage",
  "favourite",
  "lastActivityOn",
] as const satisfies readonly RosterSort["field"][];

/** The two directions a roster sort may take, checked against the read's own type. */
const ROSTER_SORT_DIRECTIONS = [
  "asc",
  "desc",
] as const satisfies readonly RosterSort["direction"][];

/**
 * The contact method kinds a preparation record may carry, checked against the stored record's type.
 *
 * Mirrored for the same reason as the sort fields, and with the same guard: the stored vocabulary
 * remains the one owner, and a kind it drops fails to compile in this schema.
 */
const CONTACT_METHOD_KINDS = [
  "email",
  "phone",
  "postal",
] as const satisfies readonly PartnerRecord["contactMethods"][number]["kind"][];

/**
 * The marker a request that attempted nothing carries in the operation-id field of its outcome.
 *
 * An `invalid` outcome names the attempt it refused, and a malformed read or a body with no usable
 * `operationId` has no attempt to name. Reporting this marker keeps the outcome's shape uniform while
 * saying plainly that no effect was tried, so nothing is replayed or re-queried under it.
 */
const UNATTEMPTED_REQUEST_ID = "no-operation-attempted";

/**
 * One whole, non-negative number written in decimal, for a page index or a page size.
 *
 * Only the shape is checked here. The roster owns the default page size and the cap that a larger
 * request is clamped to, so a handler-side clamp would silently disagree with the whole-result `total`
 * printed beside it; this schema decides solely that "notanumber" and "-1" are not page values.
 */
function wholeNumber(message: string) {
  return z
    .string()
    .regex(/^\d{1,9}$/, message)
    .transform((value) => Number(value));
}

/**
 * The wire grammar of the roster query: one flat set of search parameters, assembled below into the
 * query object the service reads.
 *
 * The handler checks that each parameter is a value the read can accept — a whole page number, a sort
 * field the roster offers, a facet named `facetId:value`, both ends of a period. It never decides
 * which facets exist, how their values combine, how many rows a page holds, or what any count is: a
 * facet id or value the read does not admit narrows nothing, and the read reports the filters that
 * actually took effect in `data.applied`, `data.appliedSearch` and `data.appliedPeriod`.
 *
 * A period is held to the two things a range needs that its shape alone does not say — each end is a
 * day the calendar holds, written in the stored `YYYY-MM-DD` form, and its start falls on or before
 * its end — and a stated zone is held to the one thing it must be for the read to use it: resolvable
 * by this runtime. Each is refused here, at the field it arrived in, rather than left to the read: an
 * unreadable period would otherwise answer a bare "no giving figures", and an unresolvable zone would
 * leave the roster's overdue, last-activity and last-received-gift days substituted with a calendar
 * nobody asked for, or reported as a source outage for a value the caller supplied.
 */
const rosterQuerySchema = z
  .strictObject({
    search: z.string().optional(),
    facet: z.array(z.string().min(1, "A facet needs a facet and a value.")).optional(),
    sort: z
      .enum(
        ROSTER_SORT_FIELDS,
        "Sort the roster by display name, kind, stage, favourite or last activity.",
      )
      .optional(),
    direction: z.enum(ROSTER_SORT_DIRECTIONS, "A sort runs ascending or descending.").optional(),
    page: wholeNumber("State the page as a whole number from 0, the first page.").optional(),
    pageSize: wholeNumber("State the page size as a whole number.").optional(),
    currency: z
      .string()
      .min(1, "State the currency the giving figures are read in, or omit it.")
      .optional(),
    from: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    to: z.string().min(1, "State both ends of the period, or omit both.").optional(),
    timeZone: z
      .string()
      .trim()
      .min(1, "Name the zone the period resolves in, or omit it and the read uses UTC.")
      .optional(),
  })
  .superRefine((params, context) => {
    if (params.pageSize !== undefined && params.page === undefined) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message:
          "State the page a size applies to: a size with no page would either be ignored or silently read as the first page, and neither is a request you made.",
      });
    }
    if ((params.sort === undefined) !== (params.direction === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["sort"],
        message:
          "State the sort field and its direction together: a field without a direction, or a direction without a field, orders the roster by nothing in particular.",
      });
    }
    if ((params.from === undefined) !== (params.to === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["period"],
        message:
          "State both ends of the period: one date is not a range, and the roster's giving figures are read over a range.",
      });
    }
    if (params.from !== undefined && params.to !== undefined) {
      const from = parseCivilDate(params.from);
      const to = parseCivilDate(params.to);
      if (from.status === "refused") {
        context.addIssue({
          code: "custom",
          path: ["from"],
          message: `Write the period's start in the stored form YYYY-MM-DD. The value "${params.from}" is not a day the calendar holds, and a start the roster cannot place on the calendar cannot bound the period its giving figures are read over.`,
        });
      }
      if (to.status === "refused") {
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: `Write the period's end in the stored form YYYY-MM-DD. The value "${params.to}" is not a day the calendar holds, and an end the roster cannot place on the calendar cannot bound the period its giving figures are read over.`,
        });
      }
      // Two values the civil-date module accepted are complete `YYYY-MM-DD` days, which order
      // chronologically exactly as they are written — the same comparison the roster's own stored
      // days are judged by — so the ends are compared as they stand, without a date constructed
      // here to say what the stored form already says.
      if (from.status === "parsed" && to.status === "parsed" && params.from > params.to) {
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: `State the period's end on or after its start. The period "${params.from}" to "${params.to}" spans no day, so no giving figure is read over it and none is stated.`,
        });
      }
    }
    // A blank value is already refused above, at the same field, so only a value the caller actually
    // named is judged for resolvability: a caller who left it empty is told the one thing to correct
    // rather than being told twice about the same empty string.
    if (
      params.timeZone !== undefined &&
      params.timeZone.length > 0 &&
      !isResolvableTimeZone(params.timeZone)
    ) {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: `Name a time zone this runtime resolves, or omit it and the read uses UTC. The value "${params.timeZone}" names no zone this runtime holds, and a zone it cannot resolve would judge the roster's overdue, last-activity and last-received-gift days in a calendar the request did not ask for.`,
      });
    }
    for (const expression of params.facet ?? []) {
      const separator = expression.indexOf(":");
      if (separator < 1 || separator === expression.length - 1) {
        context.addIssue({
          code: "custom",
          path: ["facet"],
          message: `Name each facet as facetId:value. The value "${expression}" states no facet and value pair, so it filters nothing.`,
        });
      }
    }
  });

/** The roster query as it arrives on the wire, before it is assembled into the read's own query. */
type RosterQueryParams = z.output<typeof rosterQuerySchema>;

/**
 * The one payload a creation at this path accepts: a private preparation record.
 *
 * Only the members a private preparation is authored with are admitted. `kind`, `audience`,
 * `partnerId`, `revision`, `source` and the author are absent on purpose — the mutation fixes them —
 * so a body that sends one is `invalid` with that key named rather than a field silently dropped by a
 * caller that believes it wrote it. A private preparation is unambiguously private, so the transport
 * has nothing to say about who may see the record it asks for.
 *
 * The stored bounds stay with the record's own schema in the service, which validates the payload
 * again before it writes: a display name's length, a contact value's length and how many methods a
 * record holds are the record's rules, and repeating the numbers here would make this file a second
 * owner of the same limit.
 */
const privatePreparationPayloadSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1, "A preparation record needs a name to recognise the contact by."),
  contactMethods: z
    .array(
      z.strictObject({
        kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."),
        value: z.string().trim().min(1, "A contact method needs a value."),
        permitted: z.boolean(),
      }),
    )
    .optional(),
  note: z.string().trim().min(1, "A note needs at least one visible character.").optional(),
});

/** The four-field mutation input the service accepts, around the payload above. */
const createPreparationRequestSchema = mutationInputSchema(privatePreparationPayloadSchema);

/** One search parameter's single value, or `undefined` when the URL does not carry it. */
function firstValue(search: URLSearchParams, name: string): string | undefined {
  return search.get(name) ?? undefined;
}

/**
 * The search parameters as the schema above names them, gathered without interpretation.
 *
 * A repeated `facet` keeps every value, because the roster's combination rule — AND across facets, OR
 * among the values of one facet — is expressed by the repetition and resolved by the service. An
 * absent parameter is passed as `undefined` rather than as an empty string, so "not stated" and
 * "stated as empty" stay different requests.
 */
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

/**
 * Assembles the query object the roster read takes from the parameters that passed the grammar.
 *
 * The work is purely structural: repeated facet expressions group into the values selected per facet
 * id, a page number becomes the zero-based index the envelope reports back, and both halves of a sort
 * or a period are paired. No facet is dropped, no value is altered, no count is computed and no
 * ordering is applied here.
 */
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

  const page =
    params.page === undefined
      ? undefined
      : params.pageSize === undefined
        ? { index: params.page }
        : { index: params.page, size: params.pageSize };
  const period =
    params.from === undefined || params.to === undefined
      ? undefined
      : { from: params.from, to: params.to };

  return {
    ...(params.search === undefined ? {} : { search: params.search }),
    ...(Object.keys(applied).length === 0 ? {} : { applied }),
    ...(params.sort === undefined || params.direction === undefined
      ? {}
      : { sort: { field: params.sort, direction: params.direction } }),
    ...(page === undefined ? {} : { page }),
    ...(params.currency === undefined ? {} : { currency: params.currency }),
    ...(period === undefined ? {} : { period }),
    ...(params.timeZone === undefined ? {} : { timeZone: params.timeZone }),
  };
}

/**
 * The operation id a rejected body claimed, for an `invalid` outcome to name.
 *
 * Read defensively from an untrusted body: a request that arrived with a usable id keeps it, so the
 * caller can correlate the refusal with what it sent, and one that arrived without an id gets the
 * marker instead. Nothing was attempted in either case, so no effect can be replayed under the value
 * reported here.
 */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNATTEMPTED_REQUEST_ID;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNATTEMPTED_REQUEST_ID;
}

/**
 * Reads the partner roster, with the facet set describing the same query, as one envelope.
 *
 * Outcome set: `envelope` (the roster page with its own members, and `data.facets` beside the rows),
 * `denied` (no admitted session or context), `unavailable` (the records could not be read) and
 * `unknown` (a failure whose fate is not known). A refusal is returned as the read reported it — it
 * is never replaced by an empty roster, an empty facet set or a zeroed count.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const params = rosterQuerySchema.safeParse(rawRosterParams(search));
  if (!params.success) {
    return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, params.error));
  }

  try {
    const roster = await reads.partners.findPartners(assembleRosterQuery(params.data));
    return toResponse(roster);
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store or medium fault, or a failure whose fate is not known. The
    // read attempted no effect, so the outcome carries the marker rather than an operation id.
    return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, error));
  }
}

/**
 * Creates the worker's own private preparation record for a contact.
 *
 * Outcome set: `accepted` (created, with the identifier and the advanced revision), `alreadyAccepted`
 * (the same attempt replayed, returning what it first returned), `unchanged`, `conflict`, `denied`,
 * `invalid`, `unavailable` and `unknown` — the service's eight, reported exactly as it answered.
 *
 * The scope and the expected revision in the body are forwarded untouched: the service re-derives the
 * caller's authority and decides whether the revision is current, so the transport trusts neither.
 * Creating a private preparation records no contact consent, no membership, no audience member and no
 * interaction, and this handler adds nothing to the payload that would.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = createPreparationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.partnerPreparation.createPrivatePreparation(parsed.data));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
