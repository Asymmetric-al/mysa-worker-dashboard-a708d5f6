/**
 * The one development-runtime read: what this session's development panel needs to be honest and
 * reproducible, and nothing else.
 *
 * The release runs against a synthetic world that can be moved — a scenario that makes a source
 * unavailable, a controllable clock, one armed simulated failure and a destructive reset — and every
 * one of those movements is only demonstrable if the person operating the panel can see the state it
 * is in. This read reports that state as a read envelope: the scenario this session runs in, the
 * clock offset and the instant it derives, the armed failure plan, the seeded persona catalogue, the
 * scenario's own availability flags and whether a deterministic reset is available. It supplies
 * state; `components/dev-banner.tsx` renders the permanent **Development data** label, and
 * `components/persona-switcher.tsx` renders the switch, so neither of those owns a list of its own.
 *
 * Five facts this read keeps apart, because folding any two of them would make a demonstration prove
 * the wrong thing:
 *
 * - **Per session, never global.** The scenario and the offset come from this session's own
 *   `.meta.json` (AAP 0.7.2), so two browser contexts can sit in different scenarios. The instant
 *   reported is derived from *this* session's stored offset with `instantAt` rather than from the
 *   process-wide `now()`, because the process holds one offset for whichever session moved it last —
 *   a read acting for one session must not report another session's instant.
 * - **An offset, not a different clock.** The seed instant and the offset are both returned beside
 *   the derived instant, so a reader can see that moving time is moving an offset from one fixed
 *   anchor. Nothing here observes a clock in the background: there is no timer, no interval and no
 *   scheduled callback, and a boundary becomes true when a read or command is evaluated against the
 *   moved instant (assumption A12).
 * - **One armed failure, with an explicit none-armed state.** The plan is described by
 *   `dev-runtime/failures.ts#describeFailurePlan`, the one owner of that shape, which answers the
 *   disarmed case with every field present and the words "No failure armed" rather than an absent
 *   mode (assumption A13: one mode for one named read or mutation at a time).
 * - **Absent is not a default.** A session whose development document cannot be read answers
 *   `unavailable` with the source identity; it never silently becomes "scenario 1, offset 0", because
 *   a session quietly running the wrong world makes every demonstration of an unavailable source or a
 *   partial release prove nothing.
 * - **A refusal enumerates nothing.** Outside a development build the answer is `denied` from the one
 *   authorisation module, carrying no scenario name, no persona list and no failure-plan detail.
 *
 * Where the seeded persona roster comes from. The roster is written by the development seed, which
 * builds the whole deterministic dataset and belongs to the write path: importing it from a
 * request-path read would pull that builder into the serving graph and blur the boundary that keeps
 * the development runtime out of it. The roster is therefore read from the **persisted session
 * document**, and this release's `SessionMetaDocument` does not yet carry it — so the read parses an
 * optional `personas` member, reports the catalogue's state (`persisted`, `absent` or `unreadable`)
 * and names in `finding` exactly what the runtime has to write for the list to appear. It invents no
 * label, kind or identifier to fill the gap: a guessed persona list would be worse than an honest
 * one, because the switch would offer an identity the seed does not describe.
 *
 * Plan items that put this file in scope: AAP 0.6.1 and 0.9.1 (`data-service/reads/dev.ts`, "one
 * read per visible job"), 0.7.1 (`readDevState` under "Operate the development runtime"), 0.7.2 (the
 * scenario clock, the deterministic failure modes and the labels), 0.6.3 (`GET /api/dev`), and
 * assumptions A12 (per-session offset, no background job) and A13 (one armed failure, visible in the
 * panel). AAP 0.11.1 names the file directly.
 *
 * Rule 1 obligations this file keeps. *Clause 1 (preserve the agreed scope):* it reports the state
 * the retained criteria start from — the baseline world, the three seeded unavailabilities, the
 * worker-continuation setting and the partial-release world — and exposes no knob for a deferred
 * capability; production never falls back to fixtures, so a non-development build answers `denied`
 * rather than the seeded state. *Clause 2 (reuse the patterns, one owner):* one read, one envelope,
 * one `project`-shaped view, and every fact it reports is read from the module that owns it — the
 * scenario registry, the failure plan's own description, the clock, the store's one read — so this
 * file keeps no second copy of a scenario, an offset, a plan or a reset, and it never re-implements
 * `setClock` or `advanceClock`. *Clause 3 (preserve the meaning and completion of included
 * workflows):* it reports rather than interprets the availability flags, so a commitment stays
 * not-cash and a scenario flag named `unavailable` stays a scenario setting and not a value state;
 * the persona entries carry identifiers and labels and never a credential, because this application
 * has no credential, token or session secret to carry.
 *
 * Layering: the read layer of the data service. It reaches the store through its one read entry point
 * only — never a transaction, never a reset entry point, because a reset is a mutation and this file
 * reports availability without performing it — and it imports no component, no feature and no
 * application route. Its one clock access is `time/clock.ts`, its one authorisation module is
 * `data-service/authorize.ts`, and it reads no wall clock, draws no randomness and writes no
 * diagnostic except the one unavailable-source line `lib/logger` owns.
 */
import { z } from "zod";

import { isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import {
  canView,
  resolveSession,
  type ResolvedSession,
  type SessionSource,
} from "@/modules/data-service/authorize";
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
import {
  DEMONSTRABLE_TARGETS,
  describeFailurePlan,
  EMPTY_FAILURE_PLAN,
  type DemonstrableTarget,
  type FailurePlanDescription,
} from "@/modules/dev-runtime/failures";
import {
  parseSessionMeta,
  SCENARIO_DEFINITIONS,
  SCENARIO_IDS,
  scenarioFlagsFor,
  type ScenarioFlags,
  type ScenarioId,
  type SessionMetaDocument,
} from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { instantAt, SEED_INSTANT } from "@/modules/time/clock";

// ---------------------------------------------------------------------------------------------
// The development runtime as a source
// ---------------------------------------------------------------------------------------------

/**
 * The source system every answer from this read is attributed to: the development runtime, which owns
 * the scenario, the clock offset, the failure plan and the reset.
 */
const DEV_SOURCE_SYSTEM = "dev-runtime";

/**
 * The opaque reference for what was read: this session's development document.
 *
 * It is a constant rather than the session id on purpose. A `SourceReference` travels into a
 * response, a diagnostic line and any surface that reports an outage, and the session id is the
 * cookie's own value: publishing it would hand out an identifier that names a session outside the
 * request that resolved it. The reference says what kind of record answered without naming whose.
 */
const DEV_SOURCE_REFERENCE = "session-meta";

/** The source identity an `unavailable` answer carries. */
const DEV_SOURCE = Object.freeze({
  system: DEV_SOURCE_SYSTEM,
  reference: DEV_SOURCE_REFERENCE,
});

/**
 * The operation identity a read refusal carries.
 *
 * A read has no attempt identity — nothing was asked to change, so nothing can be replayed — and the
 * resolver states that with this marker instead of inventing an identifier, keeping a read refusal's
 * shape identical to a mutation's. A mutation replaces it with its own `operationId`.
 */
const READ_ATTEMPT_ID = "read";

// ---------------------------------------------------------------------------------------------
// The scope of a read whose session has chosen no context
// ---------------------------------------------------------------------------------------------

/**
 * The reserved reference this read reports in all three context positions when the session has
 * selected no context.
 *
 * The development panel's authority is the build rather than a ministry — `authorize.ts`'s
 * `dev-runtime` target carries no scope at all for exactly that reason — yet the envelope's shape
 * requires a `Scope`. Seven seeded sessions (the coach, the three receiving readers, the subscriber,
 * the no-access user and the denied session) hold no membership and have selected no context, and the
 * panel has to stay answerable for every one of them: switching persona, scenario or clock is how a
 * person leaves a denied, expired or unavailable session.
 *
 * So the alternative to this reference is not a better value, it is a worse one. Inventing an
 * organisation, ministry and support subject the session is not admitted to would publish a false
 * authority into an envelope a caller may act on; refusing would make those seven states
 * undemonstrable. The reference is therefore a single, clearly named development-runtime value, used
 * in each position because this read genuinely has no context to report. It grants nothing:
 * `assertScope` admits only an admitted membership, so a caller that wrongly replayed it into a
 * mutation is refused rather than authorised, and `data.context.selected` is `false` on the same
 * answer so no surface can mistake it for a context.
 */
const DEVELOPMENT_RUNTIME_REFERENCE = "dev-runtime";

/**
 * The three context identifiers of {@link DEVELOPMENT_RUNTIME_REFERENCE}, minted once through the
 * envelope's own brand schemas — the only sanctioned way to turn a stored string into an identifier,
 * so no module needs its own assertion helper.
 */
const DEVELOPMENT_RUNTIME_CONTEXT: Pick<
  Scope,
  "organizationId" | "ministryId" | "supportSubjectId"
> = Object.freeze({
  organizationId: organizationIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  ministryId: ministryIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
  supportSubjectId: supportSubjectIdSchema.parse(DEVELOPMENT_RUNTIME_REFERENCE),
});

// ---------------------------------------------------------------------------------------------
// The seeded persona catalogue, as the persisted document would carry it
// ---------------------------------------------------------------------------------------------

/**
 * The four kinds of seeded identity, matching `components/persona-switcher.tsx`'s grouping: the
 * receiving readers whose persona decides what a preview shows, and the three worker-side kinds whose
 * identities own work.
 */
const PERSISTED_PERSONA_KINDS = ["reader", "worker", "reviewer", "coach"] as const;

/** What a seeded identity is, for the purpose of grouping the switch. */
type DevPersonaKind = (typeof PERSISTED_PERSONA_KINDS)[number];

/**
 * One seeded persona as the persisted catalogue states it.
 *
 * `principalId` is what the active persona is matched by: it is the same reference the session
 * resolved to, so the comparison is identity by reference and never a match on a display name or an
 * email address, neither of which establishes identity (AAP 0.7.1).
 */
const persistedPersonaSchema = z.object({
  id: z.string().min(1),
  principalId: principalIdSchema,
  kind: z.enum(PERSISTED_PERSONA_KINDS),
  label: z.string().min(1),
  description: z.string().min(1),
});

/** The catalogue member a session document may carry: the roster, in the order the panel lists it. */
const persistedPersonasSchema = z.array(persistedPersonaSchema);

/** One seeded persona, as the development panel lists it. */
export interface DevPersona {
  readonly id: string;
  readonly principalId: string;
  readonly kind: DevPersonaKind;
  readonly label: string;
  readonly description: string;
}

// ---------------------------------------------------------------------------------------------
// The development state
// ---------------------------------------------------------------------------------------------

/** One scenario a session may be switched to, as the registry names it. */
interface DevScenarioChoice {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
}

/** What the persisted document said about the persona roster, and why it said it. */
interface DevPersonaCatalogue {
  /**
   * `persisted` the roster is present and usable, `absent` the document carries no such member at
   * all, `unreadable` it carries one this build cannot read. The last two keep their own names
   * because they are different facts with different repairs.
   */
  readonly state: "persisted" | "absent" | "unreadable";
  readonly personas: readonly DevPersona[];
  /** What the runtime has to write for the roster to appear, or `null` when it is present. */
  readonly finding: string | null;
}

/** The scenario this session runs in, with the availability flags it sets. */
interface DevScenario {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
  /**
   * The scenario's own settings, uninterpreted: `financialSource`, `mediaAsset` and `coachingModule`
   * say whether a source is available, and `continuationSetting` names the one policy the referral
   * journey depends on. The word `unavailable` here is the name of a setting, not a value state.
   */
  readonly flags: ScenarioFlags;
}

/**
 * The controllable clock, as an offset rather than a different clock: the fixed seed instant, how far
 * this session stands from it, and the instant those two derive.
 */
interface DevClock {
  readonly offsetMilliseconds: number;
  readonly seedInstant: string;
  readonly derivedInstant: string;
}

/**
 * Whether a deterministic reset is available, and what it restores.
 *
 * `available` is a fact this read establishes by being answered at all: a development build with a
 * readable session can always reset. The read never performs it — `resetSeed` is a mutation — and the
 * statement says so, so a panel cannot present the report as a reset that already happened.
 */
interface DevReset {
  readonly available: boolean;
  readonly restoresKnownSeed: boolean;
  readonly statement: string;
}

/**
 * Everything the development panel renders, and nothing else.
 *
 * The panel needs state, not records: no stored body, no identifier of another session, no file path
 * and no filesystem location appears here. `contextSelected` is the one shape note the envelope's
 * scope cannot carry by itself — it says whether the scope above is a real selected context or the
 * development-runtime reference — so no surface has to infer that from the identifiers.
 *
 * Exported because it is the shape a consumer types its props with; the interfaces it is built from
 * stay local, so the module's runtime surface remains the single read below.
 */
export interface DevState {
  readonly scenario: DevScenario;
  /** Every scenario this release defines, so the panel can offer the switch without its own list. */
  readonly scenarios: readonly DevScenarioChoice[];
  readonly clock: DevClock;
  readonly failurePlan: FailurePlanDescription;
  /** Every demonstrable failure target, with the modes its row allows, for the same reason. */
  readonly failureTargets: readonly DemonstrableTarget[];
  /** The persona the session resolved to, matched against the catalogue, or `null` when unmatched. */
  readonly activePersonaId: string | null;
  readonly personaCatalogue: DevPersonaCatalogue;
  readonly sessionState: SessionState;
  /** The closed set of admission states, so the switch cannot offer one this release does not define. */
  readonly sessionStates: readonly SessionState[];
  readonly reset: DevReset;
  /** Whether `scope` is a context the session selected, or the development-runtime reference. */
  readonly contextSelected: boolean;
}

// ---------------------------------------------------------------------------------------------
// What the read reports when it cannot report a state
// ---------------------------------------------------------------------------------------------

/**
 * What the runtime has to write for the seeded roster to appear, stated where a panel shows it.
 *
 * The read does not import the seeder to fill the gap: the seed builds the whole deterministic
 * dataset and belongs to the write path, so the roster has to reach this read through the session's
 * own persisted document. The wording therefore names the change rather than apologising for a gap,
 * and it names no file, because this is response data and a path in a response is a filesystem
 * location disclosed for nothing.
 */
const PERSONA_CATALOGUE_ABSENT_FINDING =
  "The persisted session document carries no persona catalogue, so no seeded persona can be listed. " +
  "The development runtime has to write the seeded roster into the session's own development " +
  "document and carry that member through the parser that reads it back; this read reports it " +
  "unchanged the moment it is there, and it will not import the seed's dataset builder to guess it.";

/** What an unreadable catalogue would have needed to be, so a malformed roster is fixable. */
const PERSONA_CATALOGUE_UNREADABLE_FINDING =
  "The persisted session document carries a persona catalogue this build cannot read: each entry " +
  "needs an identifier, the principal it acts as, one of the four seeded kinds, a label and a " +
  "description. The roster is reported as unavailable rather than filtered, so a persona the seed " +
  "holds is never silently dropped from the switch.";

/** Why the development document could not be read at all: the store itself failed to answer. */
const DEV_STORE_FAULT_GUIDANCE =
  "The session store could not be read, so this session's scenario, clock and failure plan are " +
  "unavailable rather than absent. Retrying is safe, and a deterministic reset re-seeds every " +
  "session from the known seed.";

/** Why there is no state to report: the session holds no development document. */
const DEV_DOCUMENT_ABSENT_GUIDANCE =
  "No development document exists for this session, so its scenario, clock and failure plan are " +
  "unavailable rather than a default scenario. A deterministic reset lays one down from the known " +
  "seed instead of this read inventing one.";

/** Why there is no state to report: the document is not one this build understands. */
const DEV_DOCUMENT_UNREADABLE_GUIDANCE =
  "This session's development document cannot be read as one this build understands, so its " +
  "scenario, clock and failure plan are unavailable. A deterministic reset replaces it from the " +
  "known seed.";

/**
 * The reset this session can perform, reported and never performed here.
 *
 * Every field is a fixed fact rather than a computed one: reaching this read at all means the
 * application is running in a development build with a readable session, which is exactly the
 * condition under which the reset control works. There is deliberately no third state, because a
 * session whose store could not be read has already been answered as `unavailable`.
 */
const DEV_RESET: DevReset = Object.freeze({
  available: true,
  restoresKnownSeed: true,
  statement:
    "A reset discards the synthetic store and re-seeds every session from the deterministic seed, so " +
    "two resets produce the same readable records. This read reports that the control is available " +
    "and never performs it.",
});

/**
 * The five development mutations this session can perform, in the order the panel offers them.
 *
 * Advisory only: each name is re-authorised and re-validated when it is submitted, so a stale panel
 * can produce a `denied` or `invalid` outcome but never an unauthorised change. Every member is
 * available in any state this read can answer in — a development build with a readable session — and
 * the single-plan rule that `setFailurePlan` enforces while a failure is armed is that mutation's own
 * precondition, reported through `failurePlan` rather than folded into an action's availability.
 */
const DEV_ACTIONS: readonly ReadAction[] = Object.freeze([
  { name: "setScenario", available: true },
  { name: "setClock", available: true },
  { name: "advanceClock", available: true },
  { name: "setFailurePlan", available: true },
  { name: "resetSeed", available: true },
]);

// ---------------------------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------------------------

/**
 * The scope this read ran under: the context the session selected, or the development-runtime
 * reference when it selected none.
 *
 * A session that has chosen no context is not given one: the resolver deliberately leaves the
 * selection `null` rather than promoting the first admitted membership, because inventing a context
 * would hand a request authority it never asked for. The read reports that fact through
 * `contextSelected` and keeps the envelope's shape with {@link DEVELOPMENT_RUNTIME_CONTEXT}.
 */
function devScopeFor(session: ResolvedSession): Scope {
  if (session.selected !== null) {
    return session.selected;
  }
  return { ...DEVELOPMENT_RUNTIME_CONTEXT, principalId: session.principalId };
}

/**
 * Reads the optional persona catalogue out of the persisted development document.
 *
 * Three answers, kept apart because they are three different facts: the roster is present and usable,
 * the document carries no such member at all, or it carries one this build cannot read. Each of the
 * last two yields an empty roster with the finding that says which, and neither invents a persona.
 */
function personaCatalogueFor(document: unknown): DevPersonaCatalogue {
  const member =
    isRecord(document) && Object.hasOwn(document, "personas") ? document.personas : undefined;
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

/**
 * The persona the session resolved to, matched by principal identifier.
 *
 * A principal identifier is the one reference both sides share, so the comparison is identity by
 * reference. A display name or an email address would match two different people as readily as one,
 * and neither establishes identity.
 */
function activePersonaIdOf(personas: readonly DevPersona[], principalId: string): string | null {
  const match = personas.find((persona) => persona.principalId === principalId);
  return match === undefined ? null : match.id;
}

/**
 * The revision a caller would present as `expectedRevision` if a development mutation took one.
 *
 * The development document carries no revision of its own, so this is derived from the facts it
 * states: two reads of an unchanged state return the same value, and any control that moves the
 * scenario, the offset, the admission state or the armed failure changes it. It is reported rather
 * than assumed, so a caller that wants to detect "the state moved since I looked" has one honest
 * comparison instead of a timestamp it would have to invent.
 */
function devStateRevision(meta: SessionMetaDocument, principalId: string): string {
  const plan =
    meta.failurePlan === EMPTY_FAILURE_PLAN
      ? "none"
      : `${meta.failurePlan.mode}:${meta.failurePlan.target.kind}:${meta.failurePlan.target.name}@${meta.failurePlan.armedAt}`;
  return [
    "dev-state.1",
    `scenario=${meta.scenarioId}`,
    `offset=${meta.clockOffsetMs}`,
    `state=${meta.sessionState}`,
    `principal=${principalId}`,
    `plan=${plan}`,
  ].join("|");
}

/**
 * The state of each value-bearing path in the answer, so no surface has to infer one.
 *
 * An offset of exactly zero is `zero` rather than `value`: the session is sitting at the seed instant,
 * which is a known reading and not a missing setting, and the panel must be able to say so. The
 * persona roster is `unavailable` when the document does not carry it — never `zero`, which would
 * claim a roster that is genuinely empty — and `zero` only when a persisted roster lists none.
 */
function devValueStates(
  catalogue: DevPersonaCatalogue,
  offsetMilliseconds: number,
): Readonly<Record<string, RecordedValueState>> {
  const personaState: RecordedValueState =
    catalogue.state !== "persisted"
      ? "unavailable"
      : catalogue.personas.length === 0
        ? "zero"
        : "value";

  return {
    "clock.offsetMilliseconds": offsetMilliseconds === 0 ? "zero" : "value",
    "clock.derivedInstant": "value",
    personas: personaState,
  };
}

/**
 * The one answer for "there is no development state to report", carrying the source identity and the
 * guidance a surface renders instead of an empty panel.
 *
 * The source is named in the diagnostic line as well as in the outcome, because a reader of the local
 * log needs to find the owner without any of the values the read could not return.
 */
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

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/**
 * Reads this session's development state — scenario, clock offset and derived instant, the armed
 * failure plan, the persona catalogue, the scenario availability flags and reset availability — and
 * answers `denied` outside a development build or with no usable session, and `unavailable` when the
 * session's development document cannot be read.
 *
 * `source` names a session directly instead of taking the request cookie. The browser path never
 * supplies one; it exists for the domain and integration tests and the operational scripts that hold
 * a seeded session id and no request, and it is refused outside a development build by the resolver's
 * own guard, so it can never become a production path that names its own identity.
 */
export async function readDevState(
  source?: SessionSource,
): Promise<ReadResult<ReadEnvelope<DevState>>> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    // A session that cannot be established, or a state that admits nothing, is refused with the one
    // shape a refusal has: no scenario name, no persona list, no failure-plan detail.
    return { kind: "denied", denied: resolved.denial };
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

