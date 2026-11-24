import { cookies } from "next/headers";
import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { isDevelopment, isRecord } from "@/lib/guards";
import { logger, UNSTATED_SCOPE, type LogScope } from "@/lib/logger";
import { SESSION_COOKIE, SESSION_COOKIE_GRANT } from "@/lib/session-cookie";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome, type ReadResult } from "@/modules/data-service";
import { accepted, denied, invalid, unchanged, unavailable } from "@/modules/data-service/outcome";
import { SEEDED_PERSONAS, isSeededSessionId, type PersonaId } from "@/modules/dev-runtime/seed";
import { jsonBodyOf, mutate, refusalIdentityGiven } from "../handler";
import { READ_ATTEMPT, readResponse } from "../read";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DEV_ACTIONS = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed", "selectPersona"] as const;
type DevAction = (typeof DEV_ACTIONS)[number];
const DEV_ACTION_SET: ReadonlySet<string> = new Set<string>(DEV_ACTIONS);
const UNREACHED_ATTEMPT = "dev-route";
const WIRE_TEXT_LIMIT = 64;
const ACTION_MESSAGE = `A development request names the action it asks for: ${DEV_ACTIONS.join(", ")}.`;
const AMBIGUOUS_ACTION_MESSAGE = `A development request carries exactly one action, and ${DEV_ACTIONS.join(", ")} are six distinct names.`;
type SetFailurePlanPayloadWire = Parameters<typeof mutations.dev.setFailurePlan>[0]["payload"];
type ArmingFailurePlanPayloadWire = Exclude<SetFailurePlanPayloadWire, { plan: null }>;
/** What a persona switch reports once it has settled: the outcome it answers with, and the authority the caller's own read established, which is what its diagnostic line states. */ type PersonaSwitch = { readonly outcome: MutationOutcome; readonly authority: LogScope };
const serviceWord = <Word extends string>(): z.ZodType<Word> => z.custom<Word>((value) => typeof value === "string" && value.trim().length > 0 && value.length <= WIRE_TEXT_LIMIT, `This field is a non-empty name of at most ${String(WIRE_TEXT_LIMIT)} characters.`);
const setScenarioPayload = z.strictObject({ scenarioId: serviceWord<Parameters<typeof mutations.dev.setScenario>[0]["payload"]["scenarioId"]>() });
const setClockPayload = z.strictObject({ offsetIso: z.string().min(1).max(WIRE_TEXT_LIMIT) });
const advanceClockPayload = z.strictObject({
  bySeconds: z.int({ error: "A clock advance moves the scenario clock by whole seconds, so state the seconds to move by rather than a fraction of one." }).positive({ error: "A clock advance moves the scenario clock forward, so the seconds it moves by are greater than zero." }),
});
const armFailurePlanPayload = z.strictObject({ mode: serviceWord<ArmingFailurePlanPayloadWire["mode"]>(), target: z.strictObject({ kind: z.enum(["read", "mutation"]), name: serviceWord<ArmingFailurePlanPayloadWire["target"]["name"]>() }) });
const disarmFailurePlanPayload = z.strictObject({ plan: z.null() });
const setFailurePlanPayload: z.ZodType<SetFailurePlanPayloadWire> = z.custom<SetFailurePlanPayloadWire>().superRefine((payload, ctx) => {
  const parsed = isRecord(payload) && Object.hasOwn(payload, "plan") ? disarmFailurePlanPayload.safeParse(payload) : armFailurePlanPayload.safeParse(payload);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
});
const resetSeedPayload = z.custom<Parameters<typeof mutations.dev.resetSeed>[0]["payload"]>((value) => isRecord(value) && Object.keys(value).length === 0, "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.");
/** The persona a switch names is judged against the roster the caller's own read advertises, so the refusals below are what a roster says rather than what a type says. */
const PERSONA_ID_REQUIRED_MESSAGE = "A persona switch names the seeded persona to act as, so send the identifier this session's development read lists rather than an empty value.";
const PERSONA_NOT_LISTED_MESSAGE = "A persona switch names one of the identities this session's development read lists, so send an identifier from that roster rather than one this session does not hold.";
const PERSONA_UNSEEDED_MESSAGE = "This session's roster lists the persona, but this build seeds no session for it, so the switch would hand this browser a session the store cannot resolve. A deterministic reset lays every seeded session down again.";
const selectPersonaPayload = z.strictObject({ personaId: z.string({ error: PERSONA_ID_REQUIRED_MESSAGE }).min(1, PERSONA_ID_REQUIRED_MESSAGE).max(WIRE_TEXT_LIMIT) });
const requestSchema = <P>(action: DevAction, payload: z.ZodType<P>): z.ZodType<MutationInput<P>> =>
  z.preprocess((raw: unknown) => {
    if (!isRecord(raw) || raw.action !== action) return undefined;
    const projection: Record<string, unknown> = { ...raw };
    delete projection.action;
    return projection;
  }, mutationInputSchema(payload));
const setScenarioRequest = requestSchema("setScenario", setScenarioPayload);
const setClockRequest = requestSchema("setClock", setClockPayload);
const advanceClockRequest = requestSchema("advanceClock", advanceClockPayload);
const setFailurePlanRequest = requestSchema("setFailurePlan", setFailurePlanPayload);
const resetSeedRequest = requestSchema("resetSeed", resetSeedPayload);
const selectPersonaRequest = requestSchema("selectPersona", selectPersonaPayload);
const refusalIdentityOf = refusalIdentityGiven(UNREACHED_ATTEMPT, WIRE_TEXT_LIMIT);
const isDevAction = (value: unknown): value is DevAction => typeof value === "string" && DEV_ACTION_SET.has(value);
const devActionOf = (body: unknown): DevAction | null => (isRecord(body) && isDevAction(body.action) ? body.action : null);
const developmentDenial = (): MutationOutcome => denied({ operationId: UNREACHED_ATTEMPT, reasonCode: "capability-absent" });
const refusalOnAction = (operationId: string, message: string): MutationOutcome => invalid({ operationId, fields: { action: [message] } });
const isPersonaId = (value: string): value is PersonaId => Object.hasOwn(SEEDED_PERSONAS, value);
/** Re-bases a read's refusal onto the attempt this request carries: the attempt identity is the caller's own, never the identity a read files its own answer under. */ function refusalOverRead(read: Exclude<ReadResult<unknown>, { readonly kind: "envelope" }>, operationId: string): MutationOutcome {
  switch (read.kind) {
    case "denied":
      return denied({ operationId, reasonCode: read.denied.reasonCode });
    case "unavailable":
      return unavailable({ operationId, source: read.unavailable.source, guidance: read.unavailable.guidance });
    case "refused":
      return invalid({ operationId, fields: read.refused.fields });
  }
}
/** Switches the seeded session this browser acts as and answers `accepted` with the persona, the session and the principal now in force, `unchanged` when the browser already acts as that session, or the refusal a read gave: `denied` outside a development build or for a session that cannot be established, `invalid` for a persona this session's roster does not list, `unavailable` when the session that would act cannot be read. The switch is diagnosed: the line it writes states the authority that authorised it — the scope the caller's own read established, the session acting now — rather than the identity the grant then makes this browser act as. */
async function selectPersona(operationId: string, personaId: string): Promise<PersonaSwitch> {
  // The caller's own development read is what authorises this switch and what lists the personas it may name, so a build without development controls, or a session that establishes nothing, keeps answering its own refusal instead of being switched by a request it would refuse to read.
  const caller = await reads.dev.readDevState();
  if (caller.kind !== "envelope") return { outcome: refusalOverRead(caller, operationId), authority: UNSTATED_SCOPE };
  // Every answer below is reported under the authority the caller's own read established: a scope read off the request would state a context the switch never held.
  const authority: LogScope = caller.envelope.scope;
  if (!caller.envelope.data.personaCatalogue.personas.some((persona) => persona.id === personaId)) return { outcome: invalid({ operationId, fields: { "payload.personaId": [PERSONA_NOT_LISTED_MESSAGE] } }), authority };
  const seeded = isPersonaId(personaId) ? SEEDED_PERSONAS[personaId] : undefined;
  if (seeded === undefined || !isSeededSessionId(seeded.defaultSessionId)) return { outcome: invalid({ operationId, fields: { "payload.personaId": [PERSONA_UNSEEDED_MESSAGE] } }), authority };
  const jar = await cookies();
  const alreadyActs = jar.get(SESSION_COOKIE)?.value === seeded.defaultSessionId;
  // The session that will act is read before the cookie is granted, so the outcome reports the revision the document in force afterwards carries, and a persona whose document the store does not hold answers `unavailable` rather than sending this browser to a session nothing can resolve.
  const acting = alreadyActs ? caller : await reads.dev.readDevState({ sessionId: seeded.defaultSessionId });
  if (acting.kind !== "envelope") return { outcome: refusalOverRead(acting, operationId), authority };
  jar.set(SESSION_COOKIE, seeded.defaultSessionId, SESSION_COOKIE_GRANT); // Switching the identity is the cookie's own fact: the store keeps no "current identity" record, so the grant belongs to the transport that owns the cookie and no `mutations.dev.*` call stores it (AAP 0.3.2).
  if (alreadyActs) return { outcome: unchanged({ operationId, revision: acting.envelope.revision }), authority };
  // The seed names several sessions after the persona that acts in them, so the persona's identifier and the session's can be one value: the outcome lists each distinct identifier once, because a receipt lists identifiers and a repeated one would be a duplicate entry rather than a second fact.
  return { outcome: accepted({ operationId, revision: acting.envelope.revision, changed: [...new Set<string>([seeded.id, seeded.defaultSessionId, seeded.principalId])] }), authority };
}
/** Switches this browser's persona through {@link selectPersona} and writes the one mutation line the attempt earns, so the control that changes which identity every later read answers for is attributable in the stream whatever its outcome: a throw becomes the outcome this transport answers with, reported under the scope no read established. */
async function selectPersonaDiagnosed(operationId: string, personaId: string): Promise<MutationOutcome> {
  const startedAt = performance.now(); // Taken before any await, so the line reports the whole attempt rather than the part of it after its first read.
  let switched: PersonaSwitch;
  try {
    switched = await selectPersona(operationId, personaId);
  } catch (error) {
    switched = { outcome: outcomeFromError(operationId, error), authority: UNSTATED_SCOPE };
  }
  logger.mutation({ operationId, scope: switched.authority, outcome: switched.outcome.outcome, elapsedMs: performance.now() - startedAt });
  return switched.outcome;
}
const readDevState = (): Promise<Response> => (isDevelopment() ? readResponse(READ_ATTEMPT, () => reads.dev.readDevState()) : Promise.resolve(toResponse(developmentDenial())));
/** Operates exactly one of the six named development controls — the five the service mutates this session's runtime with, and the persona switch this transport grants from the cookie it owns — and answers with one of the closed outcomes: `accepted`, `alreadyAccepted` for a replay of the same `operationId` with the same intent, `unchanged` when the payload would change nothing, and otherwise the refusal that names what to correct. */
async function operateDevControl(request: Request): Promise<Response> {
  if (!isDevelopment()) return toResponse(developmentDenial());
  const body = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(body);
  const action = devActionOf(body);
  if (action === null) return toResponse(refusalOnAction(operationId, ACTION_MESSAGE));
  const scenario = setScenarioRequest.safeParse(body);
  const clock = setClockRequest.safeParse(body);
  const advanced = advanceClockRequest.safeParse(body);
  const plan = setFailurePlanRequest.safeParse(body);
  const reset = resetSeedRequest.safeParse(body);
  const persona = selectPersonaRequest.safeParse(body);
  // Every schema is tried against the one body. Six schemas whose discriminants are distinct literals can accept it at most once, and the count is asserted here rather than assumed below.
  if ([scenario, clock, advanced, plan, reset, persona].filter((attempt) => attempt.success).length > 1) return toResponse(refusalOnAction(operationId, AMBIGUOUS_ACTION_MESSAGE));
  switch (action) {
    case "setScenario":
      return scenario.success ? mutate(operationId, () => mutations.dev.setScenario(scenario.data)) : toResponse(outcomeFromError(operationId, scenario.error));
    case "setClock":
      return clock.success ? mutate(operationId, () => mutations.dev.setClock(clock.data)) : toResponse(outcomeFromError(operationId, clock.error));
    case "advanceClock":
      return advanced.success ? mutate(operationId, () => mutations.dev.advanceClock(advanced.data)) : toResponse(outcomeFromError(operationId, advanced.error));
    case "setFailurePlan":
      return plan.success ? mutate(operationId, () => mutations.dev.setFailurePlan(plan.data)) : toResponse(outcomeFromError(operationId, plan.error));
    case "resetSeed":
      return reset.success ? mutate(operationId, () => mutations.dev.resetSeed(reset.data)) : toResponse(outcomeFromError(operationId, reset.error));
    case "selectPersona":
      return persona.success ? mutate(operationId, () => selectPersonaDiagnosed(operationId, persona.data.payload.personaId)) : toResponse(outcomeFromError(operationId, persona.error));
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readDevState, POST: operateDevControl });
