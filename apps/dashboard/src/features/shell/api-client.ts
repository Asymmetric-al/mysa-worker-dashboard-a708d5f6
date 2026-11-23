import { isRecord } from "@/lib/guards";
import type { ReadEnvelope } from "@/modules/data-service/envelope";
import type { MutationInput, MutationOutcome, ReadResult } from "@/modules/data-service";
import type { UnavailableOutcome } from "@/modules/data-service/outcome";
import type { DevState } from "@/modules/data-service/reads/dev";
import type { SelectContextRequest } from "./schemas/select-context";
/** The namespaced development handler (AAP 0.6.3): one read, six named controls, one path. */ export const DEV_ENDPOINT = "/api/dev";
/** The context-switch handler (AAP 0.6.3): `selectContext`, and nothing else. */ export const CONTEXT_SWITCH_ENDPOINT = "/api/session/context";
/** The six controls the development handler accepts, in the order the panel offers them. */ export const DEV_ACTIONS = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed", "selectPersona"] as const;
/** One named development control. */ export type DevAction = (typeof DEV_ACTIONS)[number];
const TRANSPORT_SOURCE = Object.freeze({ system: "browser-transport", reference: "shell-development-runtime" });
const READ_ATTEMPT = "read";
const TRANSPORT_GUIDANCE = "The development handler could not be reached, so nothing was changed and nothing was read. Retry " + "the same request: a replay of the same operation id returns the original result rather than " + "repeating the effect.";
const CONTEXT_TRANSPORT_GUIDANCE = "The context switch could not be reached, so the context in force is unchanged. Retry the same " + "switch: re-submitting this attempt's operation id returns its recorded result rather than moving " + "the session twice.";
const OUTCOME_NAMES: Readonly<Record<MutationOutcome["outcome"], true>> = Object.freeze({ accepted: true, alreadyAccepted: true, unchanged: true, conflict: true, denied: true, invalid: true, unavailable: true, unknown: true });
const isOutcomeName = (value: unknown): value is MutationOutcome["outcome"] => typeof value === "string" && Object.hasOwn(OUTCOME_NAMES, value);
const isOutcomeBody = (value: unknown): value is MutationOutcome => isRecord(value) && isOutcomeName(value.outcome) && typeof value.operationId === "string";
const unavailableMember = (operationId: string, guidance: string): UnavailableOutcome => ({ outcome: "unavailable", operationId, source: TRANSPORT_SOURCE, guidance });
const unknownMember = (operationId: string): MutationOutcome => ({ outcome: "unknown", operationId });
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim().length === 0 ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}
async function submit(path: string, body: unknown, operationId: string, guidance: string): Promise<MutationOutcome> {
  const response = await send(path, { method: "POST", body });
  if (response === undefined) return unavailableMember(operationId, guidance);
  const parsed = await readJsonBody(response);
  return isOutcomeBody(parsed) ? parsed : unknownMember(operationId);
}
async function send(path: string, init: { readonly method: "GET" | "POST"; readonly body?: unknown }): Promise<Response | undefined> {
  try {
    return await fetch(path, { method: init.method, headers: init.method === "GET" ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" }, body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? {}), cache: "no-store", redirect: "error" });
  } catch {
    return undefined;
  }
}
const isDevStateEnvelope = (value: unknown): value is ReadEnvelope<DevState> => isRecord(value) && isRecord(value.data) && typeof value.revision === "string" && isRecord(value.scope) && isRecord(value.source);
/** Reads this session's development runtime. */ export async function readDevState(): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const response = await send(DEV_ENDPOINT, { method: "GET" });
  if (response === undefined) return { kind: "unavailable", unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE) };
  const body = await readJsonBody(response);
  if (response.status === 200 && isDevStateEnvelope(body)) return { kind: "envelope", envelope: body };
  if (isOutcomeBody(body) && body.outcome === "denied") return { kind: "denied", denied: body };
  return isOutcomeBody(body) && body.outcome === "unavailable" ? { kind: "unavailable", unavailable: body } : isOutcomeBody(body) && body.outcome === "invalid" ? { kind: "refused", refused: body } : { kind: "unavailable", unavailable: unavailableMember(READ_ATTEMPT, TRANSPORT_GUIDANCE) };
}
/** Operates exactly one of the five development controls and answers with its outcome. */ export const submitDevAction = (action: DevAction, input: MutationInput<unknown>): Promise<MutationOutcome> => submit(DEV_ENDPOINT, { action, ...input }, input.operationId, TRANSPORT_GUIDANCE);
/** Switches the context in force, through the one `selectContext` mutation. */ export const submitContextSelection = (input: SelectContextRequest): Promise<MutationOutcome> => submit(CONTEXT_SWITCH_ENDPOINT, input, input.operationId, CONTEXT_TRANSPORT_GUIDANCE);
