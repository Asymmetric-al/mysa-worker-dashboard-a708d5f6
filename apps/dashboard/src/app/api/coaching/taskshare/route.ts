/**
 * `GET /api/coaching/taskshare` — the task summaries the worker selected for sharing, and how each one
 * stands now — and `POST /api/coaching/taskshare`, the two named changes a share admits.
 *
 * **The read.** `GET` forwards the page window the request stated — `page` and `pageSize` — to
 * `reads.coaching.readTaskShares` untouched. The read applies the coaching family's 25-row default and
 * 100-row cap, states each share's reviewed description beside the task's live due date and status, and
 * reports a description whose task has changed since review as withheld until it is reviewed again.
 * Nothing is defaulted, clamped or re-measured here.
 *
 * **The writes.** `POST` runs exactly one named mutation, selected by `payload.operation`, whose closed
 * set is `shareTaskSummary` and `stopTaskShare`. The body is the four-field mutation input of AAP 0.7.1
 * plus that discriminant:
 *
 *     { operationId, scope, expectedRevision, payload: { operation, ...this mutation's fields } }
 *
 * `operation` is routing metadata, not a field of any share: it selects one schema here and is removed
 * before the mutation reads the payload, whose own strict schema is the only declaration of its fields
 * and the only source of the per-field messages an `invalid` answer carries. `operationId`, `scope` and
 * `expectedRevision` are forwarded untouched, so a replay is recognised by identity and a stale revision
 * still reaches the service as a `conflict`.
 *
 * **Nothing private can travel through here.** A share carries the description the worker reviewed and
 * nothing else it could carry: the payload schema declares no title, body, donor, amount, attachment,
 * link, source reference or private history, and the 240-code-point limit is enforced by the module that
 * owns it — with the measured count, never by shortening the text. Stopping a share leaves the task
 * intact, deletes no source work, and claims no recall of what a coach has already read.
 *
 * **Who authorises.** The service, inside each mutation: it re-derives the caller from the development
 * session, checks that the task is the worker's own, and refuses a stale share. This file checks no
 * permission, reads no clock and measures no text.
 *
 * **One status ladder.** Every answer goes through `toResponse` — an envelope is 200, as are
 * `accepted`, `alreadyAccepted` and `unchanged`; `unknown` is 202 with the `operationId`; `denied` 403,
 * `conflict` 409, `invalid` 422 and `unavailable` 503 naming the source. A throw is mapped by
 * `outcomeFromError` rather than escaping, on both verbs, so no fault is answered with an empty share
 * list.
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
 * The description limit and its message belong to the coaching module that measures it, so no ceiling
 * and no wording about a description appears here.
 */
const MESSAGES = {
  operationRequired:
    "State which change this request makes as payload.operation: shareTaskSummary or stopTaskShare.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

// ---------------------------------------------------------------------------------------------
// One payload type per named mutation, read from the mutation that validates it
// ---------------------------------------------------------------------------------------------

/** What `shareTaskSummary` accepts: the task, the occurrence and the description the worker reviewed. */
type ShareTaskSummaryPayload = Parameters<typeof mutations.coaching.shareTaskSummary>[0]["payload"];

/** What `stopTaskShare` accepts: the share identity and nothing else. */
type StopTaskSharePayload = Parameters<typeof mutations.coaching.stopTaskShare>[0]["payload"];

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

const shareTaskSummaryBodySchema = mutationInputSchema(
  z.custom<WirePayload<ShareTaskSummaryPayload, "shareTaskSummary">>(),
);
const stopTaskShareBodySchema = mutationInputSchema(
  z.custom<WirePayload<StopTaskSharePayload, "stopTaskShare">>(),
);

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const TASK_SHARE_OPERATIONS = ["shareTaskSummary", "stopTaskShare"] as const;

// ---------------------------------------------------------------------------------------------
// The read side: the page window the request stated, forwarded as it stands
// ---------------------------------------------------------------------------------------------

/** The declared parameter shape of the one read this handler serves. */
type TaskShareListQuery = Parameters<typeof reads.coaching.readTaskShares>[0];

/**
 * The page window exactly as the request stated it.
 *
 * An absent parameter stays absent rather than becoming a zero, so "not stated" and "stated as the first
 * page" remain different requests and the read's own default applies to the first of them. A value that
 * is not a number is passed on as the `NaN` a URL produces, which the read treats as unstated rather
 * than a page this file invented.
 */
function taskShareListQueryOf(request: Request): TaskShareListQuery {
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
 * The discriminant as the transport requires it: `payload.operation`, one of this path's two names.
 *
 * Only the discriminant is read here, so a body carrying extra keys is not refused at this point: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(TASK_SHARE_OPERATIONS, { error: MESSAGES.operationRequired }) },
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
 * Both task-share payload schemas are closed and declare no `operation` field, so leaving the
 * discriminant in place would turn every request into an unrecognised-key refusal. Removing it here is
 * what keeps the field a routing fact rather than a second description of a share.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched. A throw is mapped rather than propagated: the
 * service answers its refusals as outcomes, so a throw means a store or medium fault, or a failure whose
 * fate is not known.
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
 * One page of the worker's shared task summaries, each with the description that was reviewed, the
 * task's live due date and status, and whether the description still matches the task.
 *
 * The answer is always one envelope — `data`, `scope`, `source`, `revision`, `asOf`, `coverage`,
 * `valueStates`, `actions` — never a bare array. There is no portfolio-wide figure of any kind: no
 * count of shares, no sum and no ranking. A denial carries no task title, count or existence hint, and
 * an unavailable source is neither an empty list nor a zero.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.coaching.readTaskShares(taskShareListQueryOf(request)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * One named task-share mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status: a stale revision is a `conflict` that
 * preserves the submitted description for comparison, a replay is `alreadyAccepted` with the stored
 * result, a description over the limit is `invalid` with its measured count, and a discriminant naming a
 * mutation of another coaching path is `invalid` naming `payload.operation`.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "shareTaskSummary":
      return dispatch(
        shareTaskSummaryBodySchema,
        raw,
        operationId,
        mutations.coaching.shareTaskSummary,
      );
    case "stopTaskShare":
      return dispatch(stopTaskShareBodySchema, raw, operationId, mutations.coaching.stopTaskShare);
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching task-share mutation");
  }
}
