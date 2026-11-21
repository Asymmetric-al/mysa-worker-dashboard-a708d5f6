/**
 * The one development-runtime read: what this session's development panel needs to be honest and
 * reproducible, and nothing else.
 */
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { canView, readResultOfRefusal, resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import {
  buildEnvelope,
  ministryIdSchema,
  organizationIdSchema,
  principalIdSchema,
  SESSION_STATES,
  supportSubjectIdSchema,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
  type Scope,
  type SessionState,
} from "@/modules/data-service/envelope";
import { unavailable, type ReadResult } from "@/modules/data-service/outcome";
import { DEMONSTRABLE_TARGETS, describeFailurePlan, type DemonstrableTarget, type FailurePlanDescription } from "@/modules/dev-runtime/failures";
import {
  DEV_SOURCE,
  devStateRevision,
  parseSessionMeta,
  PERSISTED_PERSONA_KINDS,
  SCENARIO_DEFINITIONS,
  SCENARIO_IDS,
  scenarioFlagsFor,
  type PersistedPersonaKind,
  type ScenarioFlags,
  type ScenarioId,
} from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { instantAt, SEED_INSTANT } from "@/modules/time/clock";
// The attempt identity a read refusal carries
const READ_ATTEMPT_ID = "read";
// The scope of a read whose session has chosen no context
const DEVELOPMENT_RUNTIME_REFERENCE = "dev-runtime";

const DEVELOPMENT_RUNTIME_CONTEXT: Pick<Scope, "organizationId" | "ministryId" | "supportSubjectId"> = Object.freeze({
  organizationId: organizationIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  ministryId: ministryIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  supportSubjectId: supportSubjectIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
});
// The seeded persona catalogue, as the persisted document carries it
const persistedPersonaSchema = z.object({
  id: z.string().min(1),
  principalId: principalIdSchema,
  kind: z.enum(PERSISTED_PERSONA_KINDS),
  label: z.string().min(1),
  description: z.string().min(1),
});
const persistedPersonasSchema = z.array(persistedPersonaSchema);
/** One seeded persona, as the development panel lists it. */
export interface DevPersona {
  readonly id: string;
  readonly principalId: string;
  readonly kind: PersistedPersonaKind;
  readonly label: string;
  readonly description: string;
}
// The development state
interface DevScenarioChoice {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
}
interface DevPersonaCatalogue {
  readonly state: "persisted" | "absent" | "unreadable";
  readonly personas: readonly DevPersona[];
  readonly finding: string | null;
}
interface DevScenario {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
  readonly flags: ScenarioFlags;
}
interface DevClock {
  readonly offsetMilliseconds: number;
  readonly seedInstant: string;
  readonly derivedInstant: string;
}
interface DevReset {
  readonly available: boolean;
  readonly restoresKnownSeed: boolean;
  readonly statement: string;
}
/** Everything the development panel renders, and nothing else. */
export interface DevState {
  readonly scenario: DevScenario;
  readonly scenarios: readonly DevScenarioChoice[];
  readonly clock: DevClock;
  readonly failurePlan: FailurePlanDescription;
  readonly failureTargets: readonly DemonstrableTarget[];
  readonly activePersonaId: string | null;
  readonly personaCatalogue: DevPersonaCatalogue;
  readonly sessionState: SessionState;
  readonly sessionStates: readonly SessionState[];
  readonly reset: DevReset;
  readonly contextSelected: boolean;
}
// What the read reports when it cannot report a state
const PERSONA_CATALOGUE_ABSENT_FINDING =
  "The persisted session document carries no persona catalogue, so no seeded persona can be listed. " +
  "A deterministic reset writes the seeded roster into every session's development document, so a " +
  "document carrying none was written before the roster existed or edited by hand; this read reports " +
  "a roster unchanged the moment the document holds one, and it will not import the seed's dataset " +
  "builder to guess it.";
const PERSONA_CATALOGUE_UNREADABLE_FINDING =
  "The persisted session document carries a persona catalogue this build cannot read: each entry " +
  "needs an identifier, the principal it acts as, one of the four seeded kinds, a label and a " +
  "description. The roster is reported as unavailable rather than filtered, so a persona the seed " +
  "holds is never silently dropped from the switch.";
const DEV_STORE_FAULT_GUIDANCE =
  "The session store could not be read, so this session's scenario, clock and failure plan are " +
  "unavailable rather than absent. Retrying is safe, and a deterministic reset re-seeds every " +
  "session from the known seed.";
const DEV_DOCUMENT_ABSENT_GUIDANCE =
  "No development document exists for this session, so its scenario, clock and failure plan are " +
  "unavailable rather than a default scenario. A deterministic reset lays one down from the known " +
  "seed instead of this read inventing one.";
const DEV_DOCUMENT_UNREADABLE_GUIDANCE =
  "This session's development document cannot be read as one this build understands, so its " +
  "scenario, clock and failure plan are unavailable. A deterministic reset replaces it from the " +
  "known seed.";
const DEV_RESET: DevReset = Object.freeze({
  available: true,
  restoresKnownSeed: true,
  statement:
    "A reset discards the synthetic store and re-seeds every session from the deterministic seed, so " +
    "two resets produce the same readable records. This read reports that the control is available " +
    "and never performs it.",
});
const DEV_ACTIONS: readonly ReadAction[] = Object.freeze([
  { name: "setScenario", available: true },
  { name: "setClock", available: true },
  { name: "advanceClock", available: true },
  { name: "setFailurePlan", available: true },
  { name: "resetSeed", available: true },
]);
// Projections
function devScopeFor(session: ResolvedSession): Scope {
  if (session.selected !== null) {
    return session.selected;
  }
  return { ...DEVELOPMENT_RUNTIME_CONTEXT, principalId: session.principalId };
}
function personaCatalogueFor(document: unknown): DevPersonaCatalogue {
  const member = isRecord(document) && Object.hasOwn(document, "personas") ? document.personas : undefined;
  if (member === undefined) {
    return { state: "absent", personas: [], finding: PERSONA_CATALOGUE_ABSENT_FINDING };
  }
  const parsed = persistedPersonasSchema.safeParse(member);
  if (!parsed.success) {
    return { state: "unreadable", personas: [], finding: PERSONA_CATALOGUE_UNREADABLE_FINDING };
  }
  return {
    state: "persisted",
    personas: parsed.data.map((persona) => ({
      id: persona.id,
      principalId: persona.principalId,
      kind: persona.kind,
      label: persona.label,
      description: persona.description,
    })),
    finding: null,
  };
}
function activePersonaIdOf(personas: readonly DevPersona[], principalId: string): string | null {
  const match = personas.find((persona) => persona.principalId === principalId);
  return match === undefined ? null : match.id;
}
function devValueStates(catalogue: DevPersonaCatalogue, offsetMilliseconds: number): Readonly<Record<string, RecordedValueState>> {
  const personaState: RecordedValueState = catalogue.state !== "persisted" ? "unavailable" : catalogue.personas.length === 0 ? "zero" : "value";
  return {
    "clock.offsetMilliseconds": offsetMilliseconds === 0 ? "zero" : "value",
    "clock.derivedInstant": "value",
    personas: personaState,
  };
}
function devStateUnavailable(guidance: string): ReadResult<ReadEnvelope<DevState>> {
  logger.sourceUnavailable({ job: "readDevState", source: DEV_SOURCE });
  return {
    kind: "unavailable",
    unavailable: unavailable({
      operationId: READ_ATTEMPT_ID,
      source: DEV_SOURCE,
      guidance,
    }),
  };
}
// The read
/** Reads this session's development state — scenario, clock offset and derived instant, the armed failure plan, the persona catalogue, the scenario availability flags and reset availability —. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function readDevState(source?: SessionSource): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    // A session that cannot be established, or a state that admits nothing, is refused with the one
    // shape a refusal has: no scenario name, no persona list, no failure-plan detail. A store that
    // could not answer is the different fact, and it keeps the outage answer this read documents.
    return readResultOfRefusal(resolved.refusal);
  }
  const session = resolved.session;
  // The development panel's authority is the build, not admission, and this is the one permission
  // question a session that grants nothing may still ask — which is what makes a denied, expired or
  // unavailable session demonstrable and escapable. It is asked of the one authorisation module
  // rather than asserted with a throwing guard, because a read answers with a value: `denied` is the
  // honest answer outside a development build, and an exception would be a defect.
  const access = canView(session, { kind: "dev-runtime" });
  if (!access.allowed) {
    return { kind: "denied", denied: access.denial };
  }
  let documents: Awaited<ReturnType<typeof readSession>>;
  try {
    documents = await readSession(session.sessionId);
  } catch {
    return devStateUnavailable(DEV_STORE_FAULT_GUIDANCE);
  }
  if (documents === undefined) {
    return devStateUnavailable(DEV_DOCUMENT_ABSENT_GUIDANCE);
  }
  // The document is parsed by the module that writes it, so a value this release does not define is
  // refused there instead of being coerced here: a session quietly running the wrong world would make
  // every demonstration of an unavailable source or a partial release prove nothing.
  const parsed = parseSessionMeta(documents.meta);
  if (!parsed.ok) {
    return devStateUnavailable(DEV_DOCUMENT_UNREADABLE_GUIDANCE);
  }
  const meta = parsed.value;
  const catalogue = personaCatalogueFor(documents.meta);
  const scenario = SCENARIO_DEFINITIONS[meta.scenarioId];
  const derivedInstant = instantAt(meta.clockOffsetMs).toString();
  const data: DevState = {
    scenario: {
      id: meta.scenarioId,
      label: scenario.label,
      description: scenario.description,
      flags: scenarioFlagsFor(meta.scenarioId),
    },
    scenarios: SCENARIO_IDS.map((id) => {
      const definition = SCENARIO_DEFINITIONS[id];
      return { id, label: definition.label, description: definition.description };
    }),
    clock: {
      offsetMilliseconds: meta.clockOffsetMs,
      seedInstant: SEED_INSTANT.toString(),
      derivedInstant,
    },
    failurePlan: describeFailurePlan(meta.failurePlan),
    failureTargets: DEMONSTRABLE_TARGETS,
    activePersonaId: activePersonaIdOf(catalogue.personas, session.principalId),
    personaCatalogue: catalogue,
    sessionState: meta.sessionState,
    sessionStates: SESSION_STATES,
    reset: DEV_RESET,
    contextSelected: session.selected !== null,
  };
  const envelope = buildEnvelope<DevState>({
    data,
    scope: devScopeFor(session),
    source: DEV_SOURCE,
    revision: devStateRevision(meta, session.principalId),
    // The instant is the session's own: it is derived from the offset this document persists, so a
    // read for one session never reports the instant another session last moved the process clock to.
    asOf: derivedInstant,
    // There is no financial period here and none is fabricated: the read covers this session's whole
    // development document, which is what `complete` states, and both period bounds are absent because
    // the state has no period at all.
    coverage: { from: null, to: null, state: "complete" },
    valueStates: devValueStates(catalogue, meta.clockOffsetMs),
    actions: DEV_ACTIONS,
  });
  return { kind: "envelope", envelope };
}
