/**
 * `GET /api/coaching/targets` — the worker's own targets and their measured periods — and
 * `POST /api/coaching/targets`, the four named changes a target admits.
 *
 * **The read.** `GET` forwards the page window the request stated — `page` and `pageSize` — to
 * `reads.coaching.readTargets` untouched. Nothing is whitelisted, renamed, defaulted or clamped here:
 * the read applies the coaching family's 25-row default, caps a page at 100 and forgives a page that is
 * not a number, so a second rule at the boundary could only disagree with it. The read also owns the
 * measurement: every count comes from actual activity records, credited once and bucketed by occurrence
 * date, a closed period is measured against the version it fell inside, and each count's state is
 * reported in the envelope's `valueStates` rather than inferred from the number.
 *
 * **The writes.** `POST` runs exactly one named mutation, selected by `payload.operation`, whose closed
 * set is `saveTarget`, `editTarget`, `pauseTarget` and `endTarget`. The body is the four-field mutation
 * input of AAP 0.7.1 plus that discriminant:
 *
 *     { operationId, scope, expectedRevision, payload: { operation, ...this mutation's fields } }
 *
 * `operation` is routing metadata, not a field of any target: it selects one schema here and is removed
 * before the mutation reads the payload, whose own strict schema is the only declaration of its fields
 * and the only source of the per-field messages an `invalid` answer carries. `operationId`, `scope` and
 * `expectedRevision` are forwarded untouched, so a replay is recognised by identity and a stale revision
 * still reaches the service as a `conflict`. The module toggles, the grant lifecycle and the check-ins
 * belong to their own paths, so a discriminant naming one of them is `invalid` here.
 *
 * **Who authorises, and what a write never does.** The service does, inside each mutation: it re-derives
 * the caller from the development session, checks that the target is the worker's own, and refuses a
 * stale or ended one. A change to quantity, measure or calendar start opens a prospective version at the
 * boundary the service chooses, so no payload can ask for a proration, a bridge period or a rewrite of a
 * closed period; pausing and ending keep the version history and touch no activity record; and a
 * target's private label never reaches a coach through anything this path returns or accepts.
 *
 * **One status ladder.** Every answer goes through `toResponse` — an envelope is 200, as are
 * `accepted`, `alreadyAccepted` and `unchanged`; `unknown` is 202 with the `operationId`; `denied` 403,
 * `conflict` 409, `invalid` 422 and `unavailable` 503 naming the source. A throw is mapped by
 * `outcomeFromError` rather than escaping, on both verbs, so no fault is answered with an empty target
 * list or a zero.
 *
 * **Layering.** `app/api → modules/data-service`, the package root only: never the synthetic store,
 * never a read or mutation module's deep path, never a feature module for a value or a type.
 */

import { z } from "zod";

import { assertNever } from "@/lib/result";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";

/** The store reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";

/** Both verbs resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own, and the one a read
 * carries in place of an attempt it never makes.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const READ_ATTEMPT_ID = "read";

/**
 * The wording this file owns: the two refusals it makes before any mutation sees the request.
 *
 * Everything a caller can be told about a target field comes from the mutation's own schema, which is
 * the only declaration of those fields — so there is no second wording for a quantity, a period or a
 * private label here.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: saveTarget, editTarget, pauseTarget or endTarget.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

// ---------------------------------------------------------------------------------------------
// One payload type per named mutation, read from the mutation that validates it
// ---------------------------------------------------------------------------------------------

/** What `saveTarget` accepts: the measure, the quantity, the period, the label and the Home placement. */
type SaveTargetPayload = Parameters<typeof mutations.coaching.saveTarget>[0]["payload"];

/** What `editTarget` accepts: one target and the fields of its plan the worker changed. */
type EditTargetPayload = Parameters<typeof mutations.coaching.editTarget>[0]["payload"];

/** What `pauseTarget` accepts: the target alone, because a pause is its own act. */
type PauseTargetPayload = Parameters<typeof mutations.coaching.pauseTarget>[0]["payload"];

/** What `endTarget` accepts: the target alone, because ending is its own act. */
type EndTargetPayload = Parameters<typeof mutations.coaching.endTarget>[0]["payload"];

/**
 * A payload as it arrives on the wire: the mutation's own payload, plus the discriminant that selected
 * it.
 *
 * The intersection is a type statement only. The discriminant is stripped before the mutation reads the
 * payload, so a request cannot smuggle a routing fact into a record that declares no such field.
 */
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };

// ---------------------------------------------------------------------------------------------
// One body schema per mutation: the four-field envelope around that mutation's own payload
// ---------------------------------------------------------------------------------------------

const saveTargetBodySchema = mutationInputSchema(
  z.custom<WirePayload<SaveTargetPayload, "saveTarget">>(),
);
const editTargetBodySchema = mutationInputSchema(
  z.custom<WirePayload<EditTargetPayload, "editTarget">>(),
);
const pauseTargetBodySchema = mutationInputSchema(
  z.custom<WirePayload<PauseTargetPayload, "pauseTarget">>(),
);
const endTargetBodySchema = mutationInputSchema(
  z.custom<WirePayload<EndTargetPayload, "endTarget">>(),
);

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const TARGET_OPERATIONS = ["saveTarget", "editTarget", "pauseTarget", "endTarget"] as const;

// ---------------------------------------------------------------------------------------------
// The read side: the page window the request stated, forwarded as it stands
// ---------------------------------------------------------------------------------------------

/** The declared parameter shape of the one read this handler serves. */
type TargetListQuery = Parameters<typeof reads.coaching.readTargets>[0];

/**
 * The page window exactly as the request stated it.
 *
 * An absent parameter stays absent rather than becoming a zero, so "not stated" and "stated as the first
 * page" remain different requests and the read's own default applies to the first of them. A value that
 * is not a number is passed on as the `NaN` a URL produces, which the read treats as unstated instead of
 * this file inventing a page the worker never asked for.
 */
function targetListQueryOf(request: Request): TargetListQuery {
  const params = new URL(request.url).searchParams;
  const page = params.get("page");
  const pageSize = params.get("pageSize");

  return {
    page: page === null ? undefined : Number(page),
    pageSize: pageSize === null ? undefined : Number(pageSize),
  };
}

// ---------------------------------------------------------------------------------------------
// The write side: one named mutation per request
// ---------------------------------------------------------------------------------------------

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of this path's four names.
 *
 * Only the discriminant is read here, so a body carrying extra keys is not refused at this point: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(TARGET_OPERATIONS, { error: MESSAGES.operationRequired }) },
      { error: MESSAGES.operationRequired },
    ),
  },
  { error: MESSAGES.bodyNotJson },
);

/** The request body, or `undefined` when it is absent or is not valid JSON. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

/** The attempt identity to report on a refusal, read defensively: a malformed body states none. */
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0
    ? identity.data.operationId
    : UNIDENTIFIED_ATTEMPT;
}

/**
 * The payload a mutation receives: the routing discriminant removed, everything else as stated.
 *
 * Every target payload schema is closed and declares no `operation` field, so leaving the discriminant
 * in place would turn every request into an unrecognised-key refusal. Removing it here is what keeps the
 * field a routing fact rather than a second description of a target.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched, `expectedRevision` and `operationId` included. A
 * throw is mapped rather than propagated: the service answers its refusals as outcomes, so a throw means
 * a store or medium fault, or a failure whose fate is not known.
 */
async function dispatch<Wire extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<Wire>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<Wire, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}

// ---------------------------------------------------------------------------------------------
// The two verbs
// ---------------------------------------------------------------------------------------------

/**
 * One page of the worker's targets, each with its versions and its measured periods.
 *
 * The answer is always one envelope — `data`, `scope`, `source`, `revision`, `asOf`, `coverage`,
 * `valueStates`, `actions` — never a bare array and never a handler-computed total. A denial carries no
 * count or existence hint, and an unavailable source is neither an empty list nor a zero.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readTargets(targetListQueryOf(request)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * One named target mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status: a stale revision is a `conflict` that
 * preserves the submitted input, a replay is `alreadyAccepted` with the stored result, and a
 * discriminant naming a mutation of another coaching path is `invalid` naming `payload.operation`.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "saveTarget":
      return dispatch(saveTargetBodySchema, raw, operationId, mutations.coaching.saveTarget);
    case "editTarget":
      return dispatch(editTargetBodySchema, raw, operationId, mutations.coaching.editTarget);
    case "pauseTarget":
      return dispatch(pauseTargetBodySchema, raw, operationId, mutations.coaching.pauseTarget);
    case "endTarget":
      return dispatch(endTargetBodySchema, raw, operationId, mutations.coaching.endTarget);
    default:
      // Unreachable: the four names above are the closed set the discriminant schema admits, so a fifth
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching target mutation");
  }
}
