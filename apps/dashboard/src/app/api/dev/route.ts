/** The namespaced development-control handler: */
import { cookies } from "next/headers";
import { z } from "zod";
import { isDevelopment, isRecord } from "@/lib/guards";
import { SESSION_COOKIE, SESSION_COOKIE_GRANT } from "@/lib/session-cookie";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome, type ReadResult } from "@/modules/data-service";
/** The outcome constructors come from the module that owns them rather than through the service barrel, which re-exports the conversion helpers only. */
import { accepted, denied, invalid, unchanged, unavailable } from "@/modules/data-service/outcome";
import { SEEDED_PERSONAS, isSeededSessionId, type PersonaId } from "@/modules/dev-runtime/seed";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../handler";
/** Every request is evaluated per request: the service reads the development-session cookie, so the same URL answers differently for two sessions and must never be served as a cached static. */
export const dynamic = "force-dynamic";
/** The synthetic store writes through `node:fs`, so the Edge runtime cannot serve this route. */
export const runtime = "nodejs";
const DEV_ACTIONS = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed", "selectPersona"] as const;
type DevAction = (typeof DEV_ACTIONS)[number];
const DEV_ACTION_SET: ReadonlySet<string> = new Set<string>(DEV_ACTIONS);
const READ_ATTEMPT_MARKER = "read";
const UNREACHED_ATTEMPT = "dev-route";
const WIRE_TEXT_LIMIT = 64;
const ACTION_MESSAGE = `A development request names the action it asks for: ${DEV_ACTIONS.join(", ")}.`;
const AMBIGUOUS_ACTION_MESSAGE = `A development request carries exactly one action, and ${DEV_ACTIONS.join(", ")} are six distinct names.`;
type ScenarioIdWire = Parameters<typeof mutations.dev.setScenario>[0]["payload"]["scenarioId"];
type SetFailurePlanPayloadWire = Parameters<typeof mutations.dev.setFailurePlan>[0]["payload"];
type ArmingFailurePlanPayloadWire = Exclude<SetFailurePlanPayloadWire, { plan: null }>;
type FailureModeWire = ArmingFailurePlanPayloadWire["mode"];
type FailureTargetNameWire = ArmingFailurePlanPayloadWire["target"]["name"];
function serviceWord<Word extends string>(): z.ZodType<Word> {
  return z.custom<Word>((value) => typeof value === "string" && value.trim().length > 0 && value.length <= WIRE_TEXT_LIMIT, `This field is a non-empty name of at most ${String(WIRE_TEXT_LIMIT)} characters.`);
}
const setScenarioPayload = z.strictObject({ scenarioId: serviceWord<ScenarioIdWire>() });
const setClockPayload = z.strictObject({ offsetIso: z.string().min(1).max(WIRE_TEXT_LIMIT) });
const advanceClockPayload = z.strictObject({
  bySeconds: z.int({ error: "A clock advance moves the scenario clock by whole seconds, so state the seconds to move by rather than a fraction of one." }).positive({ error: "A clock advance moves the scenario clock forward, so the seconds it moves by are greater than zero." }),
});
const armFailurePlanPayload = z.strictObject({ mode: serviceWord<FailureModeWire>(), target: z.strictObject({ kind: z.enum(["read", "mutation"]), name: serviceWord<FailureTargetNameWire>() }) });
const disarmFailurePlanPayload = z.strictObject({ plan: z.null() });
const DISARM_PLAN_MEMBER = "plan";
const setFailurePlanPayload: z.ZodType<SetFailurePlanPayloadWire> = z.custom<SetFailurePlanPayloadWire>().superRefine((payload, ctx) => {
  const parsed = isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER) ? disarmFailurePlanPayload.safeParse(payload) : armFailurePlanPayload.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // The form's own message and field path are what a caller acts on; the machine code belongs to the schema library, and an `invalid` outcome is keyed by the path and read for the message.
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  }
});
const resetSeedPayload = z.custom<Parameters<typeof mutations.dev.resetSeed>[0]["payload"]>((value) => isRecord(value) && Object.keys(value).length === 0, "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.");
/** The persona a switch names is judged against the roster the caller's own read advertises, so the refusals below are what a roster says rather than what a type says. */
const PERSONA_ID_REQUIRED_MESSAGE = "A persona switch names the seeded persona to act as, so send the identifier this session's development read lists rather than an empty value.";
const PERSONA_NOT_LISTED_MESSAGE = "A persona switch names one of the identities this session's development read lists, so send an identifier from that roster rather than one this session does not hold.";
const PERSONA_UNSEEDED_MESSAGE = "This session's roster lists the persona, but this build seeds no session for it, so the switch would hand this browser a session the store cannot resolve. A deterministic reset lays every seeded session down again.";
const selectPersonaPayload = z.strictObject({ personaId: z.string({ error: PERSONA_ID_REQUIRED_MESSAGE }).min(1, PERSONA_ID_REQUIRED_MESSAGE).max(WIRE_TEXT_LIMIT) });
function requestSchema<P>(action: DevAction, payload: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.preprocess((raw: unknown) => requestProjection(raw, action), mutationInputSchema(payload));
}
function requestProjection(raw: unknown, action: DevAction): Record<string, unknown> | undefined {
  if (!isRecord(raw) || raw.action !== action) return undefined;
  const projection: Record<string, unknown> = { ...raw };
  delete projection.action;
  return projection;
}
const setScenarioRequest = requestSchema("setScenario", setScenarioPayload);
const setClockRequest = requestSchema("setClock", setClockPayload);
const advanceClockRequest = requestSchema("advanceClock", advanceClockPayload);
const setFailurePlanRequest = requestSchema("setFailurePlan", setFailurePlanPayload);
const resetSeedRequest = requestSchema("resetSeed", resetSeedPayload);
const selectPersonaRequest = requestSchema("selectPersona", selectPersonaPayload);
/** This path's refusals have always been echoed under its own `dev-route` marker, and it admits a stated attempt id of at most the wire field limit, so those two decisions stay here; the rule that reads the claim is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed === UNIDENTIFIED_ATTEMPT || claimed.length > WIRE_TEXT_LIMIT ? UNREACHED_ATTEMPT : claimed;
}
function devActionOf(body: unknown): DevAction | null {
  if (!isRecord(body)) return null;
  const action = body.action;
  return isDevAction(action) ? action : null;
}
function isDevAction(value: unknown): value is DevAction {
  return typeof value === "string" && DEV_ACTION_SET.has(value);
}
function developmentDenial(): MutationOutcome {
  return denied({ operationId: UNREACHED_ATTEMPT, reasonCode: "capability-absent" });
}
function refusalOnAction(operationId: string, message: string): MutationOutcome {
  return invalid({ operationId, fields: { action: [message] } });
}
interface DispatchedAttempt {
  readonly operationId: string;
}
async function dispatchAttempt(attempt: DispatchedAttempt, call: () => Promise<MutationOutcome>): Promise<Response> {
  let outcome: MutationOutcome;
  try {
    outcome = await call();
  } catch (error) {
    outcome = outcomeFromError(attempt.operationId, error);
  }
  return toResponse(outcome);
}
/** Whether a value names a persona this build seeds, so a roster identifier can address the seed's own row. */
function isPersonaId(value: string): value is PersonaId {
  return Object.hasOwn(SEEDED_PERSONAS, value);
}
/** Re-bases a read's refusal onto the attempt this request carries: the attempt identity is the caller's own, never the identity a read files its own answer under. */
function refusalOverRead(read: Exclude<ReadResult<unknown>, { readonly kind: "envelope" }>, operationId: string): MutationOutcome {
  switch (read.kind) {
    case "denied":
      return denied({ operationId, reasonCode: read.denied.reasonCode });
    case "unavailable":
      return unavailable({ operationId, source: read.unavailable.source, guidance: read.unavailable.guidance });
    case "refused":
      return invalid({ operationId, fields: read.refused.fields });
  }
}
/**
 * Switches the seeded session this browser acts as and answers `accepted` with the persona, the session and
 * the principal now in force, `unchanged` when the browser already acts as that session, or the refusal a
 * read gave: `denied` outside a development build or for a session that cannot be established, `invalid` for
 * a persona this session's roster does not list, `unavailable` when the session that would act cannot be read.
 */
async function selectPersona(attempt: DispatchedAttempt & { readonly personaId: string }): Promise<MutationOutcome> {
  const { operationId, personaId } = attempt;
  // The caller's own development read is what authorises this switch and what lists the personas it may name,
  // so a build without development controls, or a session that establishes nothing, keeps answering its own
  // refusal instead of being switched by a request it would refuse to read.
  const caller = await reads.dev.readDevState();
  if (caller.kind !== "envelope") return refusalOverRead(caller, operationId);
  if (!caller.envelope.data.personaCatalogue.personas.some((persona) => persona.id === personaId)) {
    return invalid({ operationId, fields: { "payload.personaId": [PERSONA_NOT_LISTED_MESSAGE] } });
  }
  const seeded = isPersonaId(personaId) ? SEEDED_PERSONAS[personaId] : undefined;
  if (seeded === undefined || !isSeededSessionId(seeded.defaultSessionId)) {
    return invalid({ operationId, fields: { "payload.personaId": [PERSONA_UNSEEDED_MESSAGE] } });
  }
  const jar = await cookies();
  const alreadyActs = jar.get(SESSION_COOKIE)?.value === seeded.defaultSessionId;
  // The session that will act is read before the cookie is granted, so the outcome reports the revision the
  // document in force afterwards carries, and a persona whose document the store does not hold answers
  // `unavailable` rather than sending this browser to a session nothing can resolve.
  const acting = alreadyActs ? caller : await reads.dev.readDevState({ sessionId: seeded.defaultSessionId });
  if (acting.kind !== "envelope") return refusalOverRead(acting, operationId);
  // Switching the identity is the cookie's own fact: the store keeps no "current identity" record, so the
  // grant belongs to the transport that owns the cookie and no `mutations.dev.*` call stores it (AAP 0.3.2).
  jar.set(SESSION_COOKIE, seeded.defaultSessionId, SESSION_COOKIE_GRANT);
  if (alreadyActs) return unchanged({ operationId, revision: acting.envelope.revision });
  // The seed names several sessions after the persona that acts in them, so the persona's identifier and the
  // session's can be one value: the outcome lists each distinct identifier once, because a receipt lists
  // identifiers and a repeated one would be a duplicate entry rather than a second fact.
  const changed = [...new Set<string>([seeded.id, seeded.defaultSessionId, seeded.principalId])];
  return accepted({ operationId, revision: acting.envelope.revision, changed });
}
/** Reports this session's development runtime — the scenario and the choices it offers, the clock offset and the instant it derives, the one armed failure plan with the advertised modes and named targets, the seeded persona roster with the identity it lists as active, the session state, and the reset it offers. */
export async function GET(): Promise<Response> {
  if (!isDevelopment()) return toResponse(developmentDenial());
  try {
    return toResponse(await reads.dev.readDevState());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
/** Operates exactly one of the six named development controls — the five the service mutates this session's runtime with, and the persona switch this transport grants from the cookie it owns — and answers with one of the closed outcomes: `accepted`, `alreadyAccepted` for a replay of the same `operationId` with the same intent, `unchanged` when the payload would change nothing, and otherwise the refusal a schema or a read gave. */
export async function POST(request: Request): Promise<Response> {
  if (!isDevelopment()) return toResponse(developmentDenial());
  const body = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(body);
  const action = devActionOf(body);
  if (action === null) return toResponse(refusalOnAction(operationId, ACTION_MESSAGE));
  // Every schema is tried against the one body. Six schemas whose discriminants are distinct literals can accept it at most once, and the count is asserted here rather than assumed below.
  const scenario = setScenarioRequest.safeParse(body);
  const clock = setClockRequest.safeParse(body);
  const advanced = advanceClockRequest.safeParse(body);
  const plan = setFailurePlanRequest.safeParse(body);
  const reset = resetSeedRequest.safeParse(body);
  const persona = selectPersonaRequest.safeParse(body);
  const admitted = [scenario, clock, advanced, plan, reset, persona].filter((attempt) => attempt.success).length;
  if (admitted > 1) return toResponse(refusalOnAction(operationId, AMBIGUOUS_ACTION_MESSAGE));
  // The action is one this handler accepts, so exactly one branch below runs and the others are the schemas that declined it.
  switch (action) {
    case "setScenario": {
      if (!scenario.success) return toResponse(outcomeFromError(operationId, scenario.error));
      const input = scenario.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setScenario(input));
    }
    case "setClock": {
      if (!clock.success) return toResponse(outcomeFromError(operationId, clock.error));
      const input = clock.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setClock(input));
    }
    case "advanceClock": {
      if (!advanced.success) return toResponse(outcomeFromError(operationId, advanced.error));
      const input = advanced.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.advanceClock(input));
    }
    case "setFailurePlan": {
      if (!plan.success) return toResponse(outcomeFromError(operationId, plan.error));
      const input = plan.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setFailurePlan(input));
    }
    case "resetSeed": {
      if (!reset.success) return toResponse(outcomeFromError(operationId, reset.error));
      const input = reset.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.resetSeed(input));
    }
    case "selectPersona": {
      if (!persona.success) return toResponse(outcomeFromError(operationId, persona.error));
      const personaId = persona.data.payload.personaId;
      return dispatchAttempt({ operationId }, () => selectPersona({ operationId, personaId }));
    }
  }
}
