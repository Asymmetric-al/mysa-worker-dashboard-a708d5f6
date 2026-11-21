/**
 * `GET /api/initiatives` — one page of this ministry's initiatives — and `POST /api/initiatives`, the
 * one creation this path performs.
 *
 * **Two verbs, two named methods.** `GET` forwards the caller's query to
 * `reads.outreach.readInitiatives` and answers with that read's envelope, unchanged. `POST` runs
 * `mutations.outreach.createInitiative`, the only mutation that creates an initiative, so this path
 * carries no `payload.operation` discriminant: the other nine outreach changes have their own paths —
 * `/members`, `/stages`, `/requests`, `/requests/response`, `/close`, `/reopen` — which is what keeps
 * every verb mapping to exactly one named service method.
 *
 * **What is deliberately not served here.** `readInitiative` and `readInitiativeResults` get no browser
 * transport, because no path in the API contract names an initiative and this file invents none. The
 * surfaces that read those two — the initiative overview at `/initiatives/[initiativeId]` — are Server
 * Components, and a Server Component calls the service in process instead of fetching the
 * application's own endpoint. So a `GET` with an initiative reference is refused by nothing here and
 * offered by nothing here: the only GET this path answers is the list read.
 *
 * **Who authorises.** The service, per request. The read derives the session and the acting scope from
 * the development-session cookie and drops every initiative this principal may not view before it
 * counts or pages anything, so the envelope's `total` can never include a record the caller cannot
 * open. The creation asserts the same claimed scope and records the acting principal as the person
 * responsible, because this release carries no delegation: a payload naming anyone else is `denied`.
 *
 * **What neither verb does.** No status is chosen (only `toResponse` maps an outcome to one), no body
 * is wrapped or reshaped, no query is defaulted, clamped or renamed, no amount, count or total is
 * computed, and no payload field is re-validated — `createInitiative`'s own closed schema answers
 * `invalid` with per-field messages, so a second schema here would be a second owner of it.
 *
 * **Layering.** `app/api → modules/data-service`, through the barrel only.
 */

import { z } from "zod";

import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
} from "@/modules/data-service";

// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Both verbs resolve the development session and evaluate the scenario clock once per request.
export const dynamic = "force-dynamic";

/** The declared parameter shape of the one read this path serves. */
type InitiativeListQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;

/** One lifecycle state the list read filters on, as that read declares it. */
type InitiativeStateName = NonNullable<InitiativeListQuery["state"]>;

/** One order the list read presents, as that read declares it. */
type InitiativeSortName = NonNullable<InitiativeListQuery["sort"]>;

/** The payload the creation mutation accepts, taken from its own signature. */
type CreateInitiativePayload = Parameters<typeof mutations.outreach.createInitiative>[0]["payload"];

/** A read has no attempt to replay, so a failure it reports carries the marker the reads modules use. */
const READ_ATTEMPT_ID = "read";

/**
 * The marker a refused creation carries where a real attempt would carry its `operationId`.
 *
 * A body too malformed to state a usable id names no attempt, and minting one would invite a replay of
 * work that was never tried. The marker matches the service's own for that case.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The four-field mutation input around the creation payload.
 *
 * The payload member stays opaque because `createInitiative` validates it: a name, a purpose, the
 * accountable person and the optional period are that mutation's own closed rules, and it answers a
 * violation with `invalid` and a message per field path. The envelope is what this file owns.
 */
const createInitiativeRequestSchema = mutationInputSchema(z.custom<CreateInitiativePayload>());

/**
 * The query exactly as the request stated it.
 *
 * Nothing is whitelisted, renamed or defaulted: `state` and `sort` are handed over as written, and the
 * read is what judges them. It orders an unrecognised `sort` by name rather than by nothing in
 * particular, filters on an unrecognised `state` by matching no row, applies its own page size and caps
 * a page at 200 (`pageOf`, `pageSizeOf`, `sortOfInitiative`). The only work done here is the narrowing a
 * URL forces on the transport, because a query string carries text and the read declares which text it
 * reads.
 *
 * An absent parameter stays absent instead of arriving as `undefined` text or as `0`, so "not stated"
 * and "stated as empty" remain different requests — the one distinction a filter cannot recover once it
 * is lost.
 */
function initiativeListQueryOf(request: Request): InitiativeListQuery {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const search = params.get("search");
  const sort = params.get("sort");
  const page = params.get("page");
  const pageSize = params.get("pageSize");

  return {
    ...(state === null ? {} : { state: state as InitiativeStateName }),
    ...(search === null ? {} : { search }),
    ...(sort === null ? {} : { sort: sort as InitiativeSortName }),
    ...(page === null ? {} : { page: Number(page) }),
    ...(pageSize === null ? {} : { pageSize: Number(pageSize) }),
  };
}

/**
 * The operation id a rejected body claimed, read defensively from an untrusted value.
 *
 * Nothing was attempted — the body failed the shared envelope before the mutation saw it — but a caller
 * that sent a usable id keeps it in the refusal.
 */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/**
 * One page of initiatives, exactly as the request asked for it.
 *
 * Each row states its purpose, its accountable person, its optional period, its own state, how its
 * working list stands in the three counts of `included`, `removed` and `excluded`, and its revision —
 * and the envelope states the scope, source, coverage, as-of instant, value states and the actions
 * currently available beside them. So a surface reads how much of the ministry it is looking at and
 * what it may do next without deriving either.
 *
 * Outcome set: `envelope` (200), `denied` (403, with a reason code and no count, name or existence
 * hint) or `unavailable` (503, naming the source and the safe retry — never an empty list or a zero).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.outreach.readInitiatives(initiativeListQueryOf(request)));
  } catch (error) {
    // One mapper knows a store outage, a session that cannot be established and a lost
    // acknowledgement apart, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * Creates one initiative in the ministry this session is acting in.
 *
 * The working list starts empty — a filter that later matches a partner never joins it — and the record
 * starts open with no closure disposition, so the first close is genuinely the first.
 *
 * Outcome set, as the service answers it: `accepted` (with the new identifier and revision),
 * `alreadyAccepted` (a replay, with the stored result and no second record), `denied`, `invalid` (with
 * per-field messages), `conflict`, `unavailable` and `unknown`. The four contract fields are forwarded
 * untouched, so a replay is still recognised by its `operationId` and a stale write is still a
 * `conflict`. A thrown fault becomes the same mapping a GET uses, carrying this attempt's id.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = createInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }

  try {
    return toResponse(await mutations.outreach.createInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
