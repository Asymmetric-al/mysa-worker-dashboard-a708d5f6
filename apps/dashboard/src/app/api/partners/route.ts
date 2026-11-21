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
 * The roster read and the facet read are folded into one envelope instead of answered as two
 * documents. `findPartners` answers one page of rows plus the whole-result total for a query;
 * `readFacets` answers every filter the caller may use, with the whole-result count of records
 * carrying each value, for that same query. Served separately, a surface could show counts describing
 * a different filter set than the rows it renders, and each document would have to state its own
 * basis. Folded, the facet set travels under `data.facets` inside the roster's envelope, and the
 * facet read's `valueStates` merge in under the `facets.` paths they already carry, so every
 * value-bearing field the response holds has a state the surface can read. There is no `/api/facets`
 * path and none may be added: this fold is the only place facet data leaves the application.
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
  type ReadEnvelope,
  type ReadResult,
} from "@/modules/data-service";

/**
 * The envelope a service read answers with, taken from the read's own signature.
 *
 * Deriving the shape instead of naming the module's exported interface keeps this handler honest
 * about what the service will actually hand it: a read that starts answering a different page takes
 * the fold's type with it, rather than leaving a hand-written duplicate to drift.
 */
type EnvelopeOf<Read> = Read extends {
  readonly kind: "envelope";
  readonly envelope: infer Envelope;
}
  ? Envelope
  : never;

/** What the roster read answers: one page of rows, the whole-result total and the applied filters. */
type RosterEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.partners.findPartners>>>;

/** What the facet read answers: every filter the caller may use, with its admitted values. */
type FacetEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.partners.readFacets>>>;

/** The roster query the read accepts, taken from the read's own parameter list. */
type RosterQuery = NonNullable<Parameters<typeof reads.partners.findPartners>[0]>;

/** One field the roster may be sorted by, as the read declares it. */
type RosterSort = NonNullable<RosterQuery["sort"]>;

/**
 * The roster page with the facet set folded in beside it.
 *
 * The envelope's other seven members are the roster read's own, unchanged: one scope, one source, one
 * revision, one as-of instant, one coverage and one action list describe both halves of this answer,
 * and stating two could let a surface compare a count against rows read at a different moment.
 */
type RosterEnvelopeWithFacets = ReadEnvelope<
  RosterEnvelope["data"] & { readonly facets: FacetEnvelope["data"] }
>;

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
 * actually took effect in `data.applied`.
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
 * Reads the partner roster and the facet set describing the same query, as one envelope.
 *
 * Outcome set: `envelope` (the roster page under its own members, with `data.facets` beside it),
 * `denied` (no admitted session or context) and `unavailable` (the records could not be read). A
 * refusal from either read ends the request with that refusal — it is never replaced by an empty
 * roster, an empty facet set or a zeroed count.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const params = rosterQuerySchema.safeParse(rawRosterParams(search));
  if (!params.success) {
    return toResponse(outcomeFromError(UNATTEMPTED_REQUEST_ID, params.error));
  }
  const query = assembleRosterQuery(params.data);

  const roster = await reads.partners.findPartners(query);
  if (roster.kind !== "envelope") {
    return toResponse(roster);
  }

  // The same query object, so the counts describe the filter set the rows were read under.
  const facets = await reads.partners.readFacets(query);
  if (facets.kind !== "envelope") {
    return toResponse(facets);
  }

  const folded: RosterEnvelopeWithFacets = {
    ...roster.envelope,
    data: { ...roster.envelope.data, facets: facets.envelope.data },
    valueStates: { ...roster.envelope.valueStates, ...facets.envelope.valueStates },
  };
  const result: ReadResult<RosterEnvelopeWithFacets> = { kind: "envelope", envelope: folded };
  return toResponse(result);
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
