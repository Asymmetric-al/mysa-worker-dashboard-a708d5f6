import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { canView, readResultOfRefusal, recordRefusalOutage, resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { ministryIdSchema, organizationIdSchema, principalIdSchema, SESSION_STATES, supportSubjectIdSchema, type ReadAction, type ReadEnvelope, type RecordedValueState, type Scope, type SessionState } from "@/modules/data-service/envelope";
import type { ReadResult } from "@/modules/data-service/outcome";
import { answerOf, sourceUnavailableRead } from "./frame";
import { DEMONSTRABLE_TARGETS, describeFailurePlan, type DemonstrableTarget, type FailurePlanDescription } from "@/modules/dev-runtime/failures";
import { DEV_SOURCE, devStateRevision, parseSessionMeta, PERSISTED_PERSONA_KINDS, SCENARIO_DEFINITIONS, SCENARIO_IDS, scenarioFlagsFor, type PersistedPersonaKind, type ScenarioFlags, type ScenarioId } from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { instantAt, SEED_INSTANT } from "@/modules/time/clock";
const DEVELOPMENT_RUNTIME_REFERENCE = "dev-runtime";
const DEVELOPMENT_RUNTIME_CONTEXT: Pick<Scope, "organizationId" | "ministryId" | "supportSubjectId"> = Object.freeze({
  organizationId: organizationIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  ministryId: ministryIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  supportSubjectId: supportSubjectIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
});
const persistedPersonasSchema = z.array(z.object({ id: z.string().min(1), principalId: principalIdSchema, kind: z.enum(PERSISTED_PERSONA_KINDS), label: z.string().min(1), description: z.string().min(1) }));
export type DevPersona = { readonly id: string; readonly principalId: string; readonly kind: PersistedPersonaKind; readonly label: string; readonly description: string };
type DevScenarioChoice = { readonly id: ScenarioId; readonly label: string; readonly description: string };
type DevPersonaCatalogue = { readonly state: "persisted" | "absent" | "unreadable"; readonly personas: readonly DevPersona[]; readonly finding: string | null };
type DevScenario = { readonly id: ScenarioId; readonly label: string; readonly description: string; readonly flags: ScenarioFlags };
type DevClock = { readonly offsetMilliseconds: number; readonly seedInstant: string; readonly derivedInstant: string };
type DevReset = { readonly available: boolean; readonly restoresKnownSeed: boolean; readonly statement: string };
export type DevState = { readonly scenario: DevScenario; readonly scenarios: readonly DevScenarioChoice[]; readonly clock: DevClock } & { readonly failurePlan: FailurePlanDescription; readonly failureTargets: readonly DemonstrableTarget[]; readonly activePersonaId: string | null } & {
  readonly personaCatalogue: DevPersonaCatalogue;
  readonly sessionState: SessionState;
  readonly sessionStates: readonly SessionState[];
} & { readonly reset: DevReset; readonly contextSelected: boolean };
const PERSONA_CATALOGUE_ABSENT_FINDING =
  "The persisted session document carries no persona catalogue, so no seeded persona can be listed. A deterministic reset writes the seeded roster into every session's development document, so a document carrying none was written before the roster existed or edited by hand; this read reports a roster unchanged the moment the document holds one, and it will not import the seed's dataset builder to guess it.";
const PERSONA_CATALOGUE_UNREADABLE_FINDING =
  "The persisted session document carries a persona catalogue this build cannot read: each entry needs an identifier, the principal it acts as, one of the four seeded kinds, a label and a description. The roster is reported as unavailable rather than filtered, so a persona the seed holds is never silently dropped from the switch.";
const DEV_STORE_FAULT_GUIDANCE = "The session store could not be read, so this session's scenario, clock and failure plan are " + "unavailable rather than absent. Retrying is safe, and a deterministic reset re-seeds every " + "session from the known seed.";
const DEV_DOCUMENT_ABSENT_GUIDANCE = "No development document exists for this session, so its scenario, clock and failure plan are " + "unavailable rather than a default scenario. A deterministic reset lays one down from the known " + "seed instead of this read inventing one.";
const DEV_DOCUMENT_UNREADABLE_GUIDANCE = "This session's development document cannot be read as one this build understands, so its " + "scenario, clock and failure plan are unavailable. A deterministic reset replaces it from the " + "known seed.";
const DEV_RESET: DevReset = Object.freeze({
  available: true,
  restoresKnownSeed: true,
  statement: "A reset discards the synthetic store and re-seeds every session from the deterministic seed, so " + "two resets produce the same readable records. This read reports that the control is available " + "and never performs it.",
});
const DEV_ACTIONS: readonly ReadAction[] = Object.freeze([
  { name: "setScenario", available: true },
  { name: "setClock", available: true },
  { name: "advanceClock", available: true },
  { name: "setFailurePlan", available: true },
  { name: "resetSeed", available: true },
]);
const devScopeFor = (session: ResolvedSession): Scope => session.selected ?? { ...DEVELOPMENT_RUNTIME_CONTEXT, principalId: session.principalId };
function personaCatalogueFor(document: unknown): DevPersonaCatalogue {
  const member = isRecord(document) && Object.hasOwn(document, "personas") ? document.personas : undefined;
  if (member === undefined) return { state: "absent", personas: [], finding: PERSONA_CATALOGUE_ABSENT_FINDING };
  const parsed = persistedPersonasSchema.safeParse(member);
  if (!parsed.success) return { state: "unreadable", personas: [], finding: PERSONA_CATALOGUE_UNREADABLE_FINDING };
  return { state: "persisted", personas: parsed.data.map((persona) => ({ id: persona.id, principalId: persona.principalId, kind: persona.kind, label: persona.label, description: persona.description })), finding: null };
}
const activePersonaIdOf = (personas: readonly DevPersona[], principalId: string): string | null => personas.find((persona) => persona.principalId === principalId)?.id ?? null;
function devValueStates(catalogue: DevPersonaCatalogue, offsetMilliseconds: number): Readonly<Record<string, RecordedValueState>> {
  const personaState: RecordedValueState = catalogue.state !== "persisted" ? "unavailable" : catalogue.personas.length === 0 ? "zero" : "value";
  return { "clock.offsetMilliseconds": offsetMilliseconds === 0 ? "zero" : "value", "clock.derivedInstant": "value", personas: personaState };
}
/** Reads this session's development state — scenario, clock offset and derived instant, the armed failure plan, the persona catalogue, the scenario availability flags and reset availability —. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDevState(source?: SessionSource): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    recordRefusalOutage("readDevState", resolved.refusal);
    return readResultOfRefusal(resolved.refusal);
  }
  const session = resolved.session;
  const access = canView(session, { kind: "dev-runtime" });
  if (!access.allowed) return { kind: "denied", denied: access.denial };
  let documents: Awaited<ReturnType<typeof readSession>>;
  try {
    documents = await readSession(session.sessionId);
  } catch {
    return sourceUnavailableRead({ job: "readDevState", source: DEV_SOURCE, guidance: DEV_STORE_FAULT_GUIDANCE });
  }
  if (documents === undefined) return sourceUnavailableRead({ job: "readDevState", source: DEV_SOURCE, guidance: DEV_DOCUMENT_ABSENT_GUIDANCE });
  const parsed = parseSessionMeta(documents.meta);
  if (!parsed.ok) return sourceUnavailableRead({ job: "readDevState", source: DEV_SOURCE, guidance: DEV_DOCUMENT_UNREADABLE_GUIDANCE });
  const meta = parsed.value;
  const catalogue = personaCatalogueFor(documents.meta);
  const scenario = SCENARIO_DEFINITIONS[meta.scenarioId];
  const derivedInstant = instantAt(meta.clockOffsetMs).toString();
  const data: DevState = {
    scenario: { id: meta.scenarioId, label: scenario.label, description: scenario.description, flags: scenarioFlagsFor(meta.scenarioId) },
    scenarios: SCENARIO_IDS.map((id) => ({ id, label: SCENARIO_DEFINITIONS[id].label, description: SCENARIO_DEFINITIONS[id].description })),
    clock: { offsetMilliseconds: meta.clockOffsetMs, seedInstant: SEED_INSTANT.toString(), derivedInstant },
    failurePlan: describeFailurePlan(meta.failurePlan),
    failureTargets: DEMONSTRABLE_TARGETS,
    activePersonaId: activePersonaIdOf(catalogue.personas, session.principalId),
    personaCatalogue: catalogue,
    sessionState: meta.sessionState,
    sessionStates: SESSION_STATES,
    reset: DEV_RESET,
    contextSelected: session.selected !== null,
  };
  return answerOf(devScopeFor(session), derivedInstant, { data, source: DEV_SOURCE, revision: devStateRevision(meta, session.principalId), valueStates: devValueStates(catalogue, meta.clockOffsetMs), actions: DEV_ACTIONS });
}
