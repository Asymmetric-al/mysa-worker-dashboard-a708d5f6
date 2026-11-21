/**
 * The shell family's one browser transport: this session's development runtime (`GET|POST /api/dev`)
 * and the context switch (`POST /api/session/context`).
 *
 * **Why one module.** AAP 0.3.2 makes a Route Handler the only browser mutation transport and forbids
 * a Server Action, and Rule 1 clause 2 forbids a generic request dispatcher: the paths are named once
 * here and nowhere else in this family, so the shell's client composition cannot grow a second call
 * path to the same route. The two development reads and writes arrive as the service's own contracts —
 * `ReadResult` on the way in, one of the closed eight outcomes on the way out — and this module adds no
 * field, status, retry, cache or fallback of its own.
 *
 * **Why the narrowing is written here.** `@/modules/data-service` exports `isOutcome` and
 * `isReadResult`, but that outcome module imports `next/server` and the logger, so a *value* import
 * inside a client component would drag server code into the browser bundle (the same reason the
 * sibling `features/initiatives/api-client.ts` narrows locally). This module therefore imports types
 * only and re-establishes the closed outcome set as an exhaustive `Record<MutationOutcome["outcome"],
 * check>`, so a member added to, renamed in or removed from the union fails typecheck here instead of
 * letting an unknown body through as a valid answer.
 *
 * **What the wire actually carries.** `toResponse` flattens both directions onto the status: for a read,
 * 200 carries the envelope itself, 403 the denial and 503 the outage with no `kind` wrapper; for a
 * mutation, `accepted`/`alreadyAccepted`/`unchanged` are 200, `conflict` 409, `denied` 403, `invalid`
 * 422, `unavailable` 503 and `unknown` 202. Those are answers a caller renders, so nothing here treats
 * a non-2xx status as a thrown fault.
 *
 * **What it never does.** It throws nothing out of a call the shell drives: a rejected request, a body
 * that is not JSON and a body that is neither an envelope nor one of the eight outcomes become the
 * honest answer for their direction — an `unavailable` read (a read never renders as nothing found) or
 * an `unknown` outcome carrying the caller's own `operationId` (success and failure would both be
 * lies). It never retries, never mints an operation identity (the caller owns that, so a retry is a
 * replay), never reads a clock, never logs and never computes a value the service produced.
 *
 * **Layering.** `features/shell → modules/data-service (types) → lib`. It imports no store, no
 * development-runtime module and no component, so it is safe in the browser bundle and in a test.
 */

import { isRecord } from "@/lib/guards";
import type { ReadEnvelope } from "@/modules/data-service/envelope";
import type { MutationInput, MutationOutcome, ReadResult } from "@/modules/data-service";
// The outage member by name, type-only: `outcome.ts` imports `next/server`, so this module takes its
// types from it and never its values.
import type { UnavailableOutcome } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";
import type { SelectContextRequest } from "./schemas/select-context";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The namespaced development handler (AAP 0.6.3): one read, five named controls, one path. */
export const DEV_ENDPOINT = "/api/dev";

/** The context-switch handler (AAP 0.6.3): `selectContext`, and nothing else. */
export const CONTEXT_SWITCH_ENDPOINT = "/api/session/context";

/**
 * The five controls the development handler accepts, in the order the panel offers them.
 *
 * The set is the AAP 0.6.1/0.6.3 inventory and the handler's own closed discriminant list, declared
 * again here only as the type a caller may name: no control exists outside it, so a sixth is a change
 * to the contract rather than a string this module can pass.
 */
export const DEV_ACTIONS = [
  "setScenario",
  "setClock",
  "advanceClock",
  "setFailurePlan",
  "resetSeed",
] as const;

/** One named development control. */
export type DevAction = (typeof DEV_ACTIONS)[number];

/**
 * The source this transport names when a request produced no readable answer.
 *
 * It is the transport rather than the local store, because the request can fail before it reaches the
 * service, so naming the store would claim knowledge of where the failure happened. An opaque
 * reference only: it is displayed as text and never parsed.
 */
const TRANSPORT_SOURCE = Object.freeze({
  system: "browser-transport",
  reference: "shell-development-runtime",
});

/**
 * The marker a failed read carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier: `"read"` is the
 * same non-unique attempt marker every read result in the service already carries, which keeps a
 * failed read from being mistaken for a change someone could replay.
 */
const READ_ATTEMPT = "read";

/** Why a request that never reached the service could not answer, stated for the reader's next step. */
const TRANSPORT_GUIDANCE =
  "The development handler could not be reached, so nothing was changed and nothing was read. Retry " +
  "the same request: a replay of the same operation id returns the original result rather than " +
  "repeating the effect.";

/** The context switch's guidance when the request never reached the service. */
const CONTEXT_TRANSPORT_GUIDANCE =
  "The context switch could not be reached, so the context in force is unchanged. Retry the same " +
  "switch: re-submitting this attempt's operation id returns its recorded result rather than moving " +
  "the session twice.";

// ---------------------------------------------------------------------------------------------
// The closed outcome set, as a local narrowing
// ---------------------------------------------------------------------------------------------

/**
 * Whether a value names one of the eight closed outcomes.
 *
 * Written as an exhaustive record over the union's own discriminant, so this module never holds a
 * second list that could fall behind the contract: a ninth member added to `MutationOutcome` fails to
 * compile here until it is classified.
 */
const OUTCOME_NAMES: Readonly<Record<MutationOutcome["outcome"], true>> = Object.freeze({
  accepted: true,
  alreadyAccepted: true,
  unchanged: true,
  conflict: true,
  denied: true,
  invalid: true,
  unavailable: true,
  unknown: true,
});

function isOutcomeName(value: unknown): value is MutationOutcome["outcome"] {
  return typeof value === "string" && Object.hasOwn(OUTCOME_NAMES, value);
}

/** Whether a body is one of the closed outcomes, with its attempt identity intact. */
function isOutcomeBody(value: unknown): value is MutationOutcome {
  return isRecord(value) && isOutcomeName(value.outcome) && typeof value.operationId === "string";
}

/**
 * The body of an outage this transport had to build itself: the source that could not answer, and the
 * retry that is safe. It carries no count, no empty collection and no zero, because an outage is never
 * a successful answer of nothing.
 */
function unavailableMember(operationId: string, guidance: string): UnavailableOutcome {
  return {
    outcome: "unavailable",
    operationId,
    source: TRANSPORT_SOURCE,
    guidance,
  };
}

/** The body of an unconfirmed result: the attempt identity is the only recovery handle. */
function unknownMember(operationId: string): MutationOutcome {
  return { outcome: "unknown", operationId };
}

// ---------------------------------------------------------------------------------------------
// Reading a response
// ---------------------------------------------------------------------------------------------

/** The parsed JSON body, or `undefined` when the body is absent or is not JSON. */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sends one request and answers its response, or `undefined` when nothing was received. */
async function send(
  path: string,
  init: { readonly method: "GET" | "POST"; readonly body?: unknown },
): Promise<Response | undefined> {
  try {
    return await fetch(path, {
      method: init.method,
      headers:
        init.method === "GET"
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
      // The answer is derived from this session's cookie on every request, so a stored copy would
      // serve one session's context to another (AAP 0.7.2).
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// The development runtime
// ---------------------------------------------------------------------------------------------

/**
 * Whether a body is the read envelope this family consumes.
 *
 * Only the members the panel reads are checked, and only for shape: the service owns every value in
 * them. A body that is an envelope of some other shape is refused rather than handed to the panel,
 * because a missing `revision` would silently break the `expectedRevision` a control must present.
 */
function isDevStateEnvelope(value: unknown): value is ReadEnvelope<DevState> {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.revision === "string" &&
    isRecord(value.scope) &&
    isRecord(value.source)
  );
}

/**
 * Reads this session's development runtime.
 *
 * Answers the read union the service itself returns: the envelope (200), the denial (403) or the
 * outage (503). A request that never reached the handler, and a body that is neither of the three,
 * answer `unavailable` with the transport's own source — a development state that could not be read
 * is never rendered as "no scenario, no clock and no plan armed" (AAP 0.7.1: absent is not a default).
 */
export async function readDevState(): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const response = await send(DEV_ENDPOINT, { method: "GET" });
  if (response === undefined) {
    return {
      kind: "unavailable",
      unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE),
    };
  }

  const body = await readJsonBody(response);

  if (response.status === 200 && isDevStateEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }

  if (isOutcomeBody(body) && body.outcome === "denied") {
    return { kind: "denied", denied: body };
  }

  if (isOutcomeBody(body) && body.outcome === "unavailable") {
    return { kind: "unavailable", unavailable: body };
  }

  return { kind: "unavailable", unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE) };
}

/**
 * Operates exactly one of the five development controls and answers with its outcome.
 *
 * The caller supplies the complete four-field input, including the `operationId` it reuses for a retry,
 * because the identity of an attempt is what makes a replay a replay instead of a second effect. A
 * response that carries no recognisable outcome is reported as `unknown` for that same identity: the
 * effect's fate is not known, and neither success nor failure would be true.
 */
export async function submitDevAction(
  action: DevAction,
  input: MutationInput<unknown>,
): Promise<MutationOutcome> {
  const response = await send(DEV_ENDPOINT, {
    method: "POST",
    body: { action, ...input },
  });

  if (response === undefined) {
    return unavailableMember(input.operationId, TRANSPORT_GUIDANCE);
  }

  const body = await readJsonBody(response);
  return isOutcomeBody(body) ? body : unknownMember(input.operationId);
}

/**
 * Switches the context in force, through the one `selectContext` mutation.
 *
 * The request is the sibling schema's own contract rather than a shape restated here: the caller's
 * `operationId`, the scope it is acting in now, the context record's revision it saw, the selection it
 * asks for, and — when the person has answered the guard — their decision about work they are holding, so
 * the result states what happened to it instead of assuming nothing was at stake. A response that carries
 * no recognisable outcome is `unknown` under the same identity, and a request that never left is an
 * outage — either way the displayed context does not move, so a refusal never looks like a switch.
 */
export async function submitContextSelection(
  input: SelectContextRequest,
): Promise<MutationOutcome> {
  const response = await send(CONTEXT_SWITCH_ENDPOINT, { method: "POST", body: input });

  if (response === undefined) {
    return unavailableMember(input.operationId, CONTEXT_TRANSPORT_GUIDANCE);
  }

  const body = await readJsonBody(response);
  return isOutcomeBody(body) ? body : unknownMember(input.operationId);
}
