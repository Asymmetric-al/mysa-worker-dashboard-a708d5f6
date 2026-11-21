/** The shell family's one browser transport: this session's development runtime (`GET|POST /api/dev`) and the context switch (`POST /api/session/context`). **Why one module.** AAP 0.3.2 makes a Route … */

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

/** The five controls the development handler accepts, in the order the panel offers them. */
export const DEV_ACTIONS = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed"] as const;

/** One named development control. */
export type DevAction = (typeof DEV_ACTIONS)[number];

/** The source this transport names when a request produced no readable answer. */
const TRANSPORT_SOURCE = Object.freeze({ system: "browser-transport", reference: "shell-development-runtime" });

/** The marker a failed read carries where a mutation would carry its operation id. */
const READ_ATTEMPT = "read";

/** Why a request that never reached the service could not answer, stated for the reader's next step. */
const TRANSPORT_GUIDANCE = "The development handler could not be reached, so nothing was changed and nothing was read. Retry " + "the same request: a replay of the same operation id returns the original result rather than " + "repeating the effect.";

/** The context switch's guidance when the request never reached the service. */
const CONTEXT_TRANSPORT_GUIDANCE = "The context switch could not be reached, so the context in force is unchanged. Retry the same " + "switch: re-submitting this attempt's operation id returns its recorded result rather than moving " + "the session twice.";

// ---------------------------------------------------------------------------------------------
// The closed outcome set, as a local narrowing
// ---------------------------------------------------------------------------------------------

/** Whether a value names one of the eight closed outcomes. */
const OUTCOME_NAMES: Readonly<Record<MutationOutcome["outcome"], true>> = Object.freeze({ accepted: true, alreadyAccepted: true, unchanged: true, conflict: true, denied: true, invalid: true, unavailable: true, unknown: true });

function isOutcomeName(value: unknown): value is MutationOutcome["outcome"] {
  return typeof value === "string" && Object.hasOwn(OUTCOME_NAMES, value);
}

/** Whether a body is one of the closed outcomes, with its attempt identity intact. */
function isOutcomeBody(value: unknown): value is MutationOutcome {
  return isRecord(value) && isOutcomeName(value.outcome) && typeof value.operationId === "string";
}

/** The body of an outage this transport had to build itself: the source that could not answer, and the retry that is safe. */
function unavailableMember(operationId: string, guidance: string): UnavailableOutcome {
  return { outcome: "unavailable", operationId, source: TRANSPORT_SOURCE, guidance };
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
async function send(path: string, init: { readonly method: "GET" | "POST"; readonly body?: unknown }): Promise<Response | undefined> {
  try {
    return await fetch(path, {
      method: init.method,
      headers: init.method === "GET" ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
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

/** Whether a body is the read envelope this family consumes. */
function isDevStateEnvelope(value: unknown): value is ReadEnvelope<DevState> {
  return isRecord(value) && isRecord(value.data) && typeof value.revision === "string" && isRecord(value.scope) && isRecord(value.source);
}

/** Reads this session's development runtime. */
export async function readDevState(): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const response = await send(DEV_ENDPOINT, { method: "GET" });
  if (response === undefined) {
    return { kind: "unavailable", unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE) };
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

  if (isOutcomeBody(body) && body.outcome === "invalid") {
    // The request is the fault rather than the source: the field-keyed refusal is the read's own answer,
    // and naming the handler as an outage would say a source failed that answered.
    return { kind: "refused", refused: body };
  }

  return { kind: "unavailable", unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE) };
}

/** Operates exactly one of the five development controls and answers with its outcome. */
export async function submitDevAction(action: DevAction, input: MutationInput<unknown>): Promise<MutationOutcome> {
  const response = await send(DEV_ENDPOINT, { method: "POST", body: { action, ...input } });

  if (response === undefined) {
    return unavailableMember(input.operationId, TRANSPORT_GUIDANCE);
  }

  const body = await readJsonBody(response);
  return isOutcomeBody(body) ? body : unknownMember(input.operationId);
}

/** Switches the context in force, through the one `selectContext` mutation. */
export async function submitContextSelection(input: SelectContextRequest): Promise<MutationOutcome> {
  const response = await send(CONTEXT_SWITCH_ENDPOINT, { method: "POST", body: input });

  if (response === undefined) {
    return unavailableMember(input.operationId, CONTEXT_TRANSPORT_GUIDANCE);
  }

  const body = await readJsonBody(response);
  return isOutcomeBody(body) ? body : unknownMember(input.operationId);
}
