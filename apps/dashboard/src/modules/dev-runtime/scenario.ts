/**
 * The development scenario registry, the per-session scenario document, and the one controllable clock
 * offset.
 */
import { isRecord } from "@/lib/guards";
import { err, ok, type Result } from "@/lib/result";
import { admittedMembershipSchema, SESSION_STATES, type AdmittedMembership, type SessionState } from "@/modules/data-service/envelope";
import { isSafeSessionId } from "@/modules/store/paths";
import { SessionNotFoundError, transact } from "@/modules/store/repository";
import { advanceClockOffset, SEED_INSTANT, setClockOffset } from "@/modules/time/clock";
import { EMPTY_FAILURE_PLAN, parseFailurePlan, type FailurePlanDocument } from "./failures";
// The closed scenario registry
const SCENARIO_ID_LIST = ["baseline", "financial-source-unavailable", "media-unavailable", "coaching-module-unavailable", "continuation-on", "continuation-off", "partial-release-failure"] as const;
/** A scenario a session may run in. */
export type ScenarioId = (typeof SCENARIO_ID_LIST)[number];
/** The registry's order, frozen so no caller can append a scenario no other session sees declared. */
export const SCENARIO_IDS: readonly ScenarioId[] = Object.freeze(SCENARIO_ID_LIST);
/** The scenario every session starts in: every source available, worker continuation off. */
export const DEFAULT_SCENARIO_ID: ScenarioId = "baseline";
/** What a scenario makes available or unavailable. */
export interface ScenarioFlags {
  financialSource: "available" | "unavailable";
  mediaAsset: "available" | "unavailable";
  coachingModule: "available" | "unavailable";
  continuationSetting: "on" | "off";
}
/** One registry row: how the panel names a scenario, what it demonstrates, and the flags it sets. */
export interface ScenarioDefinition {
  readonly label: string;
  readonly description: string;
  readonly flags: ScenarioFlags;
}
function defineScenario(definition: ScenarioDefinition): ScenarioDefinition {
  return Object.freeze({ ...definition, flags: Object.freeze({ ...definition.flags }) });
}
/** The one scenario table, keyed by every id {@link ScenarioId} admits. */
export const SCENARIO_DEFINITIONS: Readonly<Record<ScenarioId, ScenarioDefinition>> = Object.freeze({
  baseline: defineScenario({
    label: "Baseline",
    description: "Every source available and worker continuation off — the state every criterion other than the feature-specific ones starts from.",
    flags: {
      financialSource: "available",
      mediaAsset: "available",
      coachingModule: "available",
      continuationSetting: "off",
    },
  }),
  "financial-source-unavailable": defineScenario({
    label: "Financial source unavailable",
    description: "Support reports its source as unavailable — never as zero and never as an empty list — while contact, work and content jobs continue normally.",
    flags: {
      financialSource: "unavailable",
      mediaAsset: "available",
      coachingModule: "available",
      continuationSetting: "off",
    },
  }),
  "media-unavailable": defineScenario({
    label: "Media unavailable",
    description: "A placement reports its asset unavailable, keeping its poster or text alternative and its retry action, so a failed preparation never hides the prose around it.",
    flags: {
      financialSource: "available",
      mediaAsset: "unavailable",
      coachingModule: "available",
      continuationSetting: "off",
    },
  }),
  "coaching-module-unavailable": defineScenario({
    label: "Coaching module unavailable",
    description: "One admitted coaching module's source is down: that module reports unavailable while the other admitted modules stay usable and are never blanked with it.",
    flags: {
      financialSource: "available",
      mediaAsset: "available",
      coachingModule: "unavailable",
      continuationSetting: "off",
    },
  }),
  // The referral journey is walked in both directions — an expired cycle that may be continued and
  // one that may not — so both settings are named scenarios rather than one default plus a
  // hand-edited record.
  "continuation-on": defineScenario({
    label: "Continuation on",
    description: "The worker-continuation setting is on, so an ordinarily expired referral cycle offers the Continue action within its current permission.",
    flags: {
      financialSource: "available",
      mediaAsset: "available",
      coachingModule: "available",
      continuationSetting: "on",
    },
  }),
  "continuation-off": defineScenario({
    label: "Continuation off",
    description: "The worker-continuation setting is explicitly off, so an expired referral offers no Continue action; named so a spec depends on this scenario rather than on the baseline default.",
    flags: {
      financialSource: "available",
      mediaAsset: "available",
      coachingModule: "available",
      continuationSetting: "off",
    },
  }),
  "partial-release-failure": defineScenario({
    label: "Partial release failure",
    description: "One variant of a submission releases while a sibling fails, preserving the sibling's prior-good release head instead of rolling the successful one back.",
    flags: {
      financialSource: "available",
      mediaAsset: "available",
      coachingModule: "available",
      continuationSetting: "off",
    },
  }),
});
/** Whether a value names a scenario this release defines. */
export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && Object.hasOwn(SCENARIO_DEFINITIONS, value);
}
/** The flags a scenario sets. */
export function scenarioFlagsFor(scenarioId: ScenarioId): ScenarioFlags {
  if (!isScenarioId(scenarioId)) {
    throw new RangeError(`Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`);
  }
  return SCENARIO_DEFINITIONS[scenarioId].flags;
}
// Session state, context and the meta document
/** The admission states a session can be in, in the order the shell presents them, and the membership a principal is admitted under — re-exported from the read envelope that owns the persisted. */
export { SESSION_STATES };
export type { AdmittedMembership, SessionState };
/** Whether a value names an admission state this release defines. */
export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && (SESSION_STATES as readonly string[]).includes(value);
}
/** The context an action runs inside: the organization, the ministry and the support subject whose records are being read or changed. */
export interface SelectedContext {
  organizationId: string;
  ministryId: string;
  supportSubjectId: string;
}
const SESSION_META_VERSION = 1;
/** The kinds a persisted roster row may state: the receiving readers whose persona decides what a preview shows, and the three worker-side kinds whose identities own work. */
export const PERSISTED_PERSONA_KINDS = ["reader", "worker", "reviewer", "coach"] as const;
/** One kind of seeded identity, as a persisted roster row states it. */
export type PersistedPersonaKind = (typeof PERSISTED_PERSONA_KINDS)[number];
/** One persona as a session's document persists it. */
export interface PersistedPersonaRecord {
  readonly id: string;
  readonly principalId: string;
  readonly kind: PersistedPersonaKind;
  readonly label: string;
  readonly description: string;
}
/** Everything the development runtime persists beside a session's records. */
export interface SessionMetaDocument {
  version: 1;
  scenarioId: ScenarioId;
  clockOffsetMs: number;
  failurePlan: FailurePlanDocument;
  sessionState: SessionState;
  principalId: string;
  admittedMemberships: AdmittedMembership[];
  selectedContext: SelectedContext | null;
  capabilities: string[];
  personas: PersistedPersonaRecord[];
}
const DEV_SOURCE_SYSTEM = "dev-runtime";

const DEV_SOURCE_REFERENCE = "session-meta";
/** The source identity an `unavailable` answer about this document carries. */
export const DEV_SOURCE = Object.freeze({
  system: DEV_SOURCE_SYSTEM,
  reference: DEV_SOURCE_REFERENCE,
});
/** The revision a caller would present as `expectedRevision` if a development mutation took one. */
export function devStateRevision(meta: SessionMetaDocument, principalId: string): string {
  const plan = meta.failurePlan === EMPTY_FAILURE_PLAN ? "none" : `${meta.failurePlan.mode}:${meta.failurePlan.target.kind}:${meta.failurePlan.target.name}@${meta.failurePlan.armedAt}`;
  return ["dev-state.1", `scenario=${meta.scenarioId}`, `offset=${meta.clockOffsetMs}`, `state=${meta.sessionState}`, `principal=${principalId}`, `plan=${plan}`].join("|");
}
/** Why a stored meta document, or a control request, was refused. */
export const SESSION_REFUSAL_CODES = ["unknown-scenario", "unknown-session", "invalid-offset", "out-of-range-offset", "meta-unreadable"] as const;
/** The machine-readable reason a meta document or a control request was refused. */
export type SessionRefusalCode = (typeof SESSION_REFUSAL_CODES)[number];
/** A refusal, as a value. */
export interface SessionMetaRefusal {
  readonly code: SessionRefusalCode;
  readonly message: string;
}
/** The refusal a development control returns. */
export type SessionControlRefusal = SessionMetaRefusal;

function refuse(code: SessionRefusalCode, message: string): SessionMetaRefusal {
  return { code, message };
}
/** The farthest the scenario clock may travel from `SEED_INSTANT`, in either direction. */
export const CLOCK_OFFSET_LIMIT_MS: number = SEED_INSTANT.toZonedDateTimeISO("UTC").add({ years: 10 }).epochMilliseconds - SEED_INSTANT.epochMilliseconds;
// Stored-value validation
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length <= 40 ? JSON.stringify(value) : `a ${String(value.length)}-character string`;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "a non-finite number";
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}
function invalidOffsetRefusal(value: unknown): SessionMetaRefusal {
  return refuse("invalid-offset", `A clock offset is a whole number of milliseconds from the seed instant, in either direction; ${describeValue(value)} is not one that can be represented exactly.`);
}
function outOfRangeOffsetRefusal(value: number): SessionMetaRefusal {
  return refuse("out-of-range-offset", `A clock offset stays within ${String(CLOCK_OFFSET_LIMIT_MS)} milliseconds (ten years) of the seed instant; ${describeValue(value)} is farther than that.`);
}
function isWholeMillisecond(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function isWithinOffsetLimit(value: number): boolean {
  return value >= -CLOCK_OFFSET_LIMIT_MS && value <= CLOCK_OFFSET_LIMIT_MS;
}
function offsetRefusalFor(value: unknown): SessionMetaRefusal | undefined {
  if (!isWholeMillisecond(value)) {
    return invalidOffsetRefusal(value);
  }
  return isWithinOffsetLimit(value) ? undefined : outOfRangeOffsetRefusal(value);
}
function parseAdmittedMemberships(value: unknown): AdmittedMembership[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const memberships: AdmittedMembership[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const { organizationId, ministryId, supportSubjectId } = entry;
    if (!isNonEmptyString(organizationId) || !isNonEmptyString(ministryId) || !isNonEmptyString(supportSubjectId)) {
      return undefined;
    }
    const admission = admittedMembershipSchema.safeParse({
      organizationId,
      ministryId,
      supportSubjectId,
    });
    if (!admission.success) {
      return undefined;
    }
    for (const existing of memberships) {
      if (existing.organizationId === admission.data.organizationId && existing.ministryId === admission.data.ministryId && existing.supportSubjectId === admission.data.supportSubjectId) {
        return undefined;
      }
    }
    memberships.push(admission.data);
  }
  return memberships;
}
function parseCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const capabilities: string[] = [];
  for (const entry of value) {
    if (!isNonEmptyString(entry) || capabilities.includes(entry)) {
      return undefined;
    }
    capabilities.push(entry);
  }
  return capabilities;
}
function isPersistedPersonaKind(value: unknown): value is PersistedPersonaKind {
  return typeof value === "string" && (PERSISTED_PERSONA_KINDS as readonly string[]).includes(value);
}
function parsePersistedPersonas(value: unknown): PersistedPersonaRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const personas: PersistedPersonaRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const { id, principalId, kind, label, description } = entry;
    if (!isNonEmptyString(id) || !isNonEmptyString(principalId) || !isPersistedPersonaKind(kind) || !isNonEmptyString(label) || !isNonEmptyString(description)) {
      return undefined;
    }
    if (personas.some((existing) => existing.id === id)) {
      return undefined;
    }
    personas.push({ id, principalId, kind, label, description });
  }
  return personas;
}
function personaRosterRequirement(): string {
  return `A session meta document's persona roster is zero or more rows, each stating a distinct non-empty identifier, the non-empty principal it acts as, one of ${PERSISTED_PERSONA_KINDS.join(", ")}, a non-empty label and a non-empty description.`;
}
function parseSelectedContext(value: unknown): SelectedContext | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const { organizationId, ministryId, supportSubjectId } = value;
  if (!isNonEmptyString(organizationId) || !isNonEmptyString(ministryId) || !isNonEmptyString(supportSubjectId)) {
    return undefined;
  }
  return { organizationId, ministryId, supportSubjectId };
}
// Building and reading the document
/** What a caller knows when it lays a session down. */
export interface SessionMetaSeedInput {
  principalId: string;
  admittedMemberships: readonly AdmittedMembership[];
  sessionState: SessionState;
  scenarioId?: ScenarioId;
  clockOffsetMs?: number;
  failurePlan?: FailurePlanDocument;
  selectedContext?: SelectedContext | null;
  capabilities?: readonly string[];
  personas?: readonly PersistedPersonaRecord[];
}
/** Builds the document a freshly seeded session carries. */
export function buildSessionMeta(input: SessionMetaSeedInput): SessionMetaDocument {
  const { principalId, admittedMemberships, sessionState } = input;
  if (!isNonEmptyString(principalId)) {
    throw new TypeError("A session meta document needs the principal it acts for: buildSessionMeta never invents one.");
  }
  const memberships = parseAdmittedMemberships(admittedMemberships);
  if (memberships === undefined) {
    throw new TypeError("A session meta document's admitted memberships are zero or more distinct triples of non-empty organization, ministry and support-subject ids.");
  }
  if (!isSessionState(sessionState)) {
    throw new TypeError(`Unknown session state ${describeValue(sessionState)}: this release defines ${SESSION_STATES.join(", ")}.`);
  }
  const scenarioId = input.scenarioId ?? DEFAULT_SCENARIO_ID;
  if (!isScenarioId(scenarioId)) {
    throw new RangeError(`Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`);
  }
  const clockOffsetMs = input.clockOffsetMs ?? 0;
  const offsetRefusal = offsetRefusalFor(clockOffsetMs);
  if (offsetRefusal !== undefined) {
    throw new RangeError(offsetRefusal.message);
  }
  const failurePlan = parseFailurePlan(input.failurePlan ?? EMPTY_FAILURE_PLAN);
  if (!failurePlan.ok) {
    throw new TypeError(`A session meta document carries a usable failure plan: ${failurePlan.error.message}`);
  }
  const selectedContext = parseSelectedContext(input.selectedContext ?? null);
  if (selectedContext === undefined) {
    throw new TypeError("A session meta document's selected context is null or a non-empty organization, ministry and support subject reference.");
  }
  const capabilities = parseCapabilities(input.capabilities ?? []);
  if (capabilities === undefined) {
    throw new TypeError("A session meta document's capability set is zero or more distinct non-empty capability names.");
  }
  // An absent roster is the empty list, exactly as an absent capability set is: a session laid down
  // without personas states none, and the development read reports that absence rather than this
  // builder inventing a roster the seed never described.
  const personas = parsePersistedPersonas(input.personas ?? []);
  if (personas === undefined) {
    throw new TypeError(personaRosterRequirement());
  }
  return {
    version: SESSION_META_VERSION,
    scenarioId,
    clockOffsetMs,
    failurePlan: failurePlan.value,
    sessionState,
    principalId,
    admittedMemberships: memberships,
    selectedContext,
    capabilities,
    personas,
  };
}
/** Reads a document back from its stored form, refusing rather than throwing on anything unusable. */
export function parseSessionMeta(value: unknown): Result<SessionMetaDocument, SessionMetaRefusal> {
  if (!isRecord(value)) {
    return err(
      refuse("meta-unreadable", "A session meta document is an object carrying a version, a scenario, a clock offset, a failure plan, an admission state, a principal and its admitted memberships."),
    );
  }
  const { version } = value;
  if (version !== SESSION_META_VERSION) {
    return err(refuse("meta-unreadable", `A session meta document is version ${String(SESSION_META_VERSION)}; the stored document states ${describeValue(version)}.`));
  }
  const { scenarioId } = value;
  if (!isScenarioId(scenarioId)) {
    return err(refuse("unknown-scenario", `The stored session names ${describeValue(scenarioId)}, which is not one of ${SCENARIO_IDS.join(", ")}.`));
  }
  const { clockOffsetMs } = value;
  if (!isWholeMillisecond(clockOffsetMs)) {
    return err(invalidOffsetRefusal(clockOffsetMs));
  }
  if (!isWithinOffsetLimit(clockOffsetMs)) {
    return err(outOfRangeOffsetRefusal(clockOffsetMs));
  }
  const failurePlan = parseFailurePlan(value.failurePlan);
  if (!failurePlan.ok) {
    return err(refuse("meta-unreadable", `The stored session's failure plan is unusable: ${failurePlan.error.message}`));
  }
  const { sessionState } = value;
  if (!isSessionState(sessionState)) {
    return err(refuse("meta-unreadable", `The stored session's admission state is ${describeValue(sessionState)}, which is not one of ${SESSION_STATES.join(", ")}.`));
  }
  const { principalId } = value;
  if (!isNonEmptyString(principalId)) {
    return err(refuse("meta-unreadable", "A session meta document names the principal it acts for, and never an empty or invented one."));
  }
  const admittedMemberships = parseAdmittedMemberships(value.admittedMemberships);
  if (admittedMemberships === undefined) {
    return err(refuse("meta-unreadable", "The stored session's admitted memberships are zero or more distinct triples of non-empty organization, ministry and support-subject ids."));
  }
  // The key has to be present even when its value is null: an absent context is a truncation, while a
  // stored null is the ordinary state of a session that has not chosen one yet.
  if (!Object.hasOwn(value, "selectedContext")) {
    return err(refuse("meta-unreadable", "A session meta document carries its selected context, as null when no context has been chosen."));
  }
  const selectedContext = parseSelectedContext(value.selectedContext);
  if (selectedContext === undefined) {
    return err(refuse("meta-unreadable", "The stored session's selected context is null or a non-empty organization, ministry and support subject reference."));
  }
  // An absent capability set is a document written before the field existed, and it resolves to no
  // capability rather than to a refusal: every capability question fails closed, so reading such a
  // document as read-only is the honest answer, while refusing it would report an unreadable session
  // for a file that is merely older. A present value that is not a list of distinct names is refused
  // like every other unusable field, because it states something this build cannot honour.
  const capabilities = parseCapabilities(value.capabilities ?? []);
  if (capabilities === undefined) {
    return err(refuse("meta-unreadable", "The stored session's capability set is zero or more distinct non-empty capability names."));
  }
  // An absent roster is a document written before the field existed, and it resolves to no persona
  // rather than to a refusal, on the same reasoning as an absent capability set: the development read
  // reports the catalogue as absent, while refusing the document would call a session unusable that is
  // merely older. A present roster that is not a list of usable rows is refused like every other
  // unusable field, because it states something this build cannot honour — and a caller that writes
  // the document back carries the roster it read, so a control never drops it.
  const personas = parsePersistedPersonas(value.personas ?? []);
  if (personas === undefined) {
    return err(refuse("meta-unreadable", personaRosterRequirement()));
  }
  return ok({
    version: SESSION_META_VERSION,
    scenarioId,
    clockOffsetMs,
    failurePlan: failurePlan.value,
    sessionState,
    principalId,
    admittedMemberships,
    selectedContext,
    capabilities,
    personas,
  });
}
// The development controls
type MetaUpdate = (meta: SessionMetaDocument) => Result<SessionMetaDocument, SessionControlRefusal>;

async function updateSessionMeta(sessionId: string, update: MetaUpdate): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isSafeSessionId(sessionId)) {
    return err(refuse("unknown-session", `${describeValue(sessionId)} cannot name a session: a session id is 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`));
  }
  try {
    return await transact<Result<SessionMetaDocument, SessionControlRefusal>>(sessionId, (draft) => {
      const stored = parseSessionMeta(draft.meta);
      if (!stored.ok) {
        return err(stored.error);
      }
      const next = update(stored.value);
      if (!next.ok) {
        return next;
      }
      // The transaction writes back only a document whose canonical bytes changed, so selecting the
      // scenario a session already runs in, or re-setting the offset it already has, writes nothing.
      draft.meta = next.value;
      return next;
    });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return err(refuse("unknown-session", `No session ${JSON.stringify(sessionId)} exists in the store, and a development control never creates one: reset seeds every session.`));
    }
    // A read or write fault that is neither an absent session nor an unreadable document is a store
    // fault, and it stays a thrown error so the one error model can report it as unavailable.
    throw error;
  }
}
/** Selects the scenario a session runs in. */
export async function setScenario(sessionId: string, scenarioId: ScenarioId): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isScenarioId(scenarioId)) {
    return err(refuse("unknown-scenario", `Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`));
  }
  const updated = await updateSessionMeta(sessionId, (meta) => ok({ ...meta, scenarioId }));
  if (!updated.ok) {
    return updated;
  }
  applySessionClock(updated.value);
  return updated;
}
/** Sets how far a session's scenario clock stands from the seed instant, in milliseconds. */
export async function setClock(sessionId: string, offsetMs: number): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  const refusal = offsetRefusalFor(offsetMs);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const updated = await updateSessionMeta(sessionId, (meta) => ok({ ...meta, clockOffsetMs: offsetMs }));
  if (!updated.ok) {
    return updated;
  }
  setClockOffset(offsetMs);
  return updated;
}
/** Moves a session's scenario clock forward by a stated number of milliseconds. */
export async function advanceClock(sessionId: string, byMs: number): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (typeof byMs !== "number" || !Number.isSafeInteger(byMs) || byMs <= 0) {
    return err(refuse("invalid-offset", `A clock advance moves forward by a positive whole number of milliseconds; ${describeValue(byMs)} is not one. Use setClock for an absolute offset.`));
  }
  const updated = await updateSessionMeta(sessionId, (meta) => {
    const advanced = meta.clockOffsetMs + byMs;
    const refusal = offsetRefusalFor(advanced);
    return refusal === undefined ? ok({ ...meta, clockOffsetMs: advanced }) : err(refusal);
  });
  if (!updated.ok) {
    return updated;
  }
  advanceClockOffset(byMs);
  return updated;
}
/** Re-applies a document's stored offset to the process clock, writing nothing. */
export function applySessionClock(meta: SessionMetaDocument): void {
  const refusal = offsetRefusalFor(meta.clockOffsetMs);
  if (refusal !== undefined) {
    throw new RangeError(refusal.message);
  }
  setClockOffset(meta.clockOffsetMs);
}
