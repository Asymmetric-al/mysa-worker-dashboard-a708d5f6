import { isRecord } from "@/lib/guards";
import { err, ok, type Result } from "@/lib/result";
import { isSafeSessionId } from "@/lib/session-cookie";
import { admittedMembershipSchema, SESSION_STATES, type AdmittedMembership, type SessionState } from "@/modules/data-service/envelope";
import { SessionNotFoundError, transact } from "@/modules/store/repository";
import { advanceClockOffset, SEED_INSTANT, setClockOffset } from "@/modules/time/clock";
import { EMPTY_FAILURE_PLAN, parseFailurePlan, type FailurePlanDocument } from "./failures";
const SCENARIO_ID_LIST = ["baseline", "financial-source-unavailable", "media-unavailable", "coaching-module-unavailable", "continuation-on", "continuation-off", "partial-release-failure"] as const;
export type ScenarioId = (typeof SCENARIO_ID_LIST)[number];
export const SCENARIO_IDS: readonly ScenarioId[] = Object.freeze(SCENARIO_ID_LIST);
export const DEFAULT_SCENARIO_ID: ScenarioId = "baseline";
export type ScenarioFlags = { financialSource: "available" | "unavailable"; mediaAsset: "available" | "unavailable"; coachingModule: "available" | "unavailable"; continuationSetting: "on" | "off" };
export type ScenarioDefinition = { readonly label: string; readonly description: string; readonly flags: ScenarioFlags };
const BASELINE_FLAGS: ScenarioFlags = { financialSource: "available", mediaAsset: "available", coachingModule: "available", continuationSetting: "off" };
const defineScenario = (label: string, description: string, flags: Partial<ScenarioFlags> = {}): ScenarioDefinition => Object.freeze({ label, description, flags: Object.freeze({ ...BASELINE_FLAGS, ...flags }) });
export const SCENARIO_DEFINITIONS: Readonly<Record<ScenarioId, ScenarioDefinition>> = Object.freeze({
  baseline: defineScenario("Baseline", "Every source available and worker continuation off — the state every criterion other than the feature-specific ones starts from."),
  "financial-source-unavailable": defineScenario("Financial source unavailable", "Support reports its source as unavailable — never as zero and never as an empty list — while contact, work and content jobs continue normally.", { financialSource: "unavailable" }),
  "media-unavailable": defineScenario("Media unavailable", "A placement reports its asset unavailable, keeping its poster or text alternative and its retry action, so a failed preparation never hides the prose around it.", { mediaAsset: "unavailable" }),
  "coaching-module-unavailable": defineScenario("Coaching module unavailable", "One admitted coaching module's source is down: that module reports unavailable while the other admitted modules stay usable and are never blanked with it.", { coachingModule: "unavailable" }),
  "continuation-on": defineScenario("Continuation on", "The worker-continuation setting is on, so an ordinarily expired referral cycle offers the Continue action within its current permission.", { continuationSetting: "on" }),
  "continuation-off": defineScenario("Continuation off", "The worker-continuation setting is explicitly off, so an expired referral offers no Continue action; named so a spec depends on this scenario rather than on the baseline default."),
  "partial-release-failure": defineScenario("Partial release failure", "One variant of a submission releases while a sibling fails, preserving the sibling's prior-good release head instead of rolling the successful one back."),
});
export const isScenarioId = (value: unknown): value is ScenarioId => typeof value === "string" && Object.hasOwn(SCENARIO_DEFINITIONS, value);
/** The flags a scenario sets. */
export function scenarioFlagsFor(scenarioId: ScenarioId): ScenarioFlags {
  if (!isScenarioId(scenarioId)) throw new RangeError(`Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`);
  return SCENARIO_DEFINITIONS[scenarioId].flags;
}
export { SESSION_STATES };
export type { AdmittedMembership, SessionState };
export const isSessionState = (value: unknown): value is SessionState => typeof value === "string" && (SESSION_STATES as readonly string[]).includes(value);
export type SelectedContext = { organizationId: string; ministryId: string; supportSubjectId: string };
const SESSION_META_VERSION = 1;
export const PERSISTED_PERSONA_KINDS = ["reader", "worker", "reviewer", "coach"] as const;
export type PersistedPersonaKind = (typeof PERSISTED_PERSONA_KINDS)[number];
export type PersistedPersonaRecord = { readonly id: string; readonly principalId: string; readonly kind: PersistedPersonaKind; readonly label: string; readonly description: string };
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
export const DEV_SOURCE = Object.freeze({ system: DEV_SOURCE_SYSTEM, reference: DEV_SOURCE_REFERENCE });
/** The revision a caller would present as `expectedRevision` if a development mutation took one. */
export function devStateRevision(meta: SessionMetaDocument, principalId: string): string {
  const plan = meta.failurePlan === EMPTY_FAILURE_PLAN ? "none" : `${meta.failurePlan.mode}:${meta.failurePlan.target.kind}:${meta.failurePlan.target.name}@${meta.failurePlan.armedAt}`;
  return ["dev-state.1", `scenario=${meta.scenarioId}`, `offset=${meta.clockOffsetMs}`, `state=${meta.sessionState}`, `principal=${principalId}`, `plan=${plan}`].join("|");
}
export const SESSION_REFUSAL_CODES = ["unknown-scenario", "unknown-session", "invalid-offset", "out-of-range-offset", "meta-unreadable"] as const;
export type SessionRefusalCode = (typeof SESSION_REFUSAL_CODES)[number];
export type SessionMetaRefusal = { readonly code: SessionRefusalCode; readonly message: string };
export type SessionControlRefusal = SessionMetaRefusal;
const refuse = (code: SessionRefusalCode, message: string): SessionMetaRefusal => ({ code, message });
export const CLOCK_OFFSET_LIMIT_MS: number = SEED_INSTANT.toZonedDateTimeISO("UTC").add({ years: 10 }).epochMilliseconds - SEED_INSTANT.epochMilliseconds;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function describeValue(value: unknown): string {
  if (typeof value === "string") return value.length <= 40 ? JSON.stringify(value) : `a ${String(value.length)}-character string`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "a non-finite number";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return Array.isArray(value) ? "an array" : typeof value === "object" ? "an object" : `a ${typeof value}`;
}
const invalidOffsetRefusal = (value: unknown): SessionMetaRefusal => refuse("invalid-offset", `A clock offset is a whole number of milliseconds from the seed instant, in either direction; ${describeValue(value)} is not one that can be represented exactly.`);
const outOfRangeOffsetRefusal = (value: number): SessionMetaRefusal => refuse("out-of-range-offset", `A clock offset stays within ${String(CLOCK_OFFSET_LIMIT_MS)} milliseconds (ten years) of the seed instant; ${describeValue(value)} is farther than that.`);
const isWholeMillisecond = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const isWithinOffsetLimit = (value: number): boolean => value >= -CLOCK_OFFSET_LIMIT_MS && value <= CLOCK_OFFSET_LIMIT_MS;
const offsetRefusalFor = (value: unknown): SessionMetaRefusal | undefined => (!isWholeMillisecond(value) ? invalidOffsetRefusal(value) : isWithinOffsetLimit(value) ? undefined : outOfRangeOffsetRefusal(value));
function parseAdmittedMemberships(value: unknown): AdmittedMembership[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const memberships: AdmittedMembership[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { organizationId, ministryId, supportSubjectId, organizationLabel, ministryLabel } = entry;
    if (!isNonEmptyString(organizationId) || !isNonEmptyString(ministryId) || !isNonEmptyString(supportSubjectId)) return undefined;
    const admission = admittedMembershipSchema.safeParse({ organizationId, ministryId, supportSubjectId, ...(isNonEmptyString(organizationLabel) ? { organizationLabel } : {}), ...(isNonEmptyString(ministryLabel) ? { ministryLabel } : {}) });
    if (!admission.success) return undefined;
    for (const existing of memberships) if (existing.organizationId === admission.data.organizationId && existing.ministryId === admission.data.ministryId && existing.supportSubjectId === admission.data.supportSubjectId) return undefined;
    memberships.push(admission.data);
  }
  return memberships;
}
const parseCapabilities = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every(isNonEmptyString) && new Set<string>(value).size === value.length ? value : undefined);
const isPersistedPersonaKind = (value: unknown): value is PersistedPersonaKind => typeof value === "string" && (PERSISTED_PERSONA_KINDS as readonly string[]).includes(value);
function parsePersistedPersonas(value: unknown): PersistedPersonaRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const personas: PersistedPersonaRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { id, principalId, kind, label, description } = entry;
    if (!isNonEmptyString(id) || !isNonEmptyString(principalId) || !isPersistedPersonaKind(kind) || !isNonEmptyString(label) || !isNonEmptyString(description)) return undefined;
    if (personas.some((existing) => existing.id === id)) return undefined;
    personas.push({ id, principalId, kind, label, description });
  }
  return personas;
}
const personaRosterRequirement = (): string => `A session meta document's persona roster is zero or more rows, each stating a distinct non-empty identifier, the non-empty principal it acts as, one of ${PERSISTED_PERSONA_KINDS.join(", ")}, a non-empty label and a non-empty description.`;
function parseSelectedContext(value: unknown): SelectedContext | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { organizationId, ministryId, supportSubjectId } = value;
  return !isNonEmptyString(organizationId) || !isNonEmptyString(ministryId) || !isNonEmptyString(supportSubjectId) ? undefined : { organizationId, ministryId, supportSubjectId };
}
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
export function buildSessionMeta(input: SessionMetaSeedInput): SessionMetaDocument {
  const parsed = parseSessionMeta({
    version: SESSION_META_VERSION,
    scenarioId: input.scenarioId ?? DEFAULT_SCENARIO_ID,
    clockOffsetMs: input.clockOffsetMs ?? 0,
    failurePlan: input.failurePlan ?? EMPTY_FAILURE_PLAN,
    sessionState: input.sessionState,
    principalId: input.principalId,
    admittedMemberships: input.admittedMemberships,
    selectedContext: input.selectedContext ?? null,
    capabilities: input.capabilities ?? [],
    personas: input.personas ?? [],
  });
  if (parsed.ok) return parsed.value;
  throw parsed.error.code === "unknown-scenario" || parsed.error.code === "invalid-offset" || parsed.error.code === "out-of-range-offset" ? new RangeError(parsed.error.message) : new TypeError(parsed.error.message);
}
/** Reads a document back from its stored form, refusing rather than throwing on anything unusable. */
export function parseSessionMeta(value: unknown): Result<SessionMetaDocument, SessionMetaRefusal> {
  if (!isRecord(value)) return err(refuse("meta-unreadable", "A session meta document is an object carrying a version, a scenario, a clock offset, a failure plan, an admission state, a principal and its admitted memberships."));
  const { version } = value;
  if (version !== SESSION_META_VERSION) return err(refuse("meta-unreadable", `A session meta document is version ${String(SESSION_META_VERSION)}; the stored document states ${describeValue(version)}.`));
  const { scenarioId } = value;
  if (!isScenarioId(scenarioId)) return err(refuse("unknown-scenario", `The stored session names ${describeValue(scenarioId)}, which is not one of ${SCENARIO_IDS.join(", ")}.`));
  const { clockOffsetMs } = value;
  if (!isWholeMillisecond(clockOffsetMs)) return err(invalidOffsetRefusal(clockOffsetMs));
  if (!isWithinOffsetLimit(clockOffsetMs)) return err(outOfRangeOffsetRefusal(clockOffsetMs));
  const failurePlan = parseFailurePlan(value.failurePlan);
  if (!failurePlan.ok) return err(refuse("meta-unreadable", `The stored session's failure plan is unusable: ${failurePlan.error.message}`));
  const { sessionState } = value;
  if (!isSessionState(sessionState)) return err(refuse("meta-unreadable", `The stored session's admission state is ${describeValue(sessionState)}, which is not one of ${SESSION_STATES.join(", ")}.`));
  const { principalId } = value;
  if (!isNonEmptyString(principalId)) return err(refuse("meta-unreadable", "A session meta document names the principal it acts for, and never an empty or invented one."));
  const admittedMemberships = parseAdmittedMemberships(value.admittedMemberships);
  if (admittedMemberships === undefined) return err(refuse("meta-unreadable", "The stored session's admitted memberships are zero or more distinct triples of non-empty organization, ministry and support-subject ids."));
  if (!Object.hasOwn(value, "selectedContext")) return err(refuse("meta-unreadable", "A session meta document carries its selected context, as null when no context has been chosen."));
  const selectedContext = parseSelectedContext(value.selectedContext);
  if (selectedContext === undefined) return err(refuse("meta-unreadable", "The stored session's selected context is null or a non-empty organization, ministry and support subject reference."));
  const capabilities = parseCapabilities(value.capabilities ?? []);
  if (capabilities === undefined) return err(refuse("meta-unreadable", "The stored session's capability set is zero or more distinct non-empty capability names."));
  const personas = parsePersistedPersonas(value.personas ?? []);
  return personas === undefined ? err(refuse("meta-unreadable", personaRosterRequirement())) : ok({ version: SESSION_META_VERSION, scenarioId, clockOffsetMs, failurePlan: failurePlan.value, sessionState, principalId, admittedMemberships, selectedContext, capabilities, personas });
}
type MetaUpdate = (meta: SessionMetaDocument) => Result<SessionMetaDocument, SessionControlRefusal>;
async function updateSessionMeta(sessionId: string, update: MetaUpdate): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isSafeSessionId(sessionId)) return err(refuse("unknown-session", `${describeValue(sessionId)} cannot name a session: a session id is 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`));
  try {
    return await transact<Result<SessionMetaDocument, SessionControlRefusal>>(sessionId, ["meta"], (draft) => {
      const stored = parseSessionMeta(draft.meta);
      if (!stored.ok) return err(stored.error);
      const next = update(stored.value);
      if (!next.ok) return next;
      draft.meta = next.value;
      return next;
    });
  } catch (error) {
    if (error instanceof SessionNotFoundError) return err(refuse("unknown-session", `No session ${JSON.stringify(sessionId)} exists in the store, and a development control never creates one: reset seeds every session.`));
    throw error;
  }
}
export async function setScenario(sessionId: string, scenarioId: ScenarioId): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isScenarioId(scenarioId)) return err(refuse("unknown-scenario", `Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`));
  const updated = await updateSessionMeta(sessionId, (meta) => ok({ ...meta, scenarioId }));
  if (!updated.ok) return updated;
  applySessionClock(updated.value);
  return updated;
}
export async function setClock(sessionId: string, offsetMs: number): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  const refusal = offsetRefusalFor(offsetMs);
  if (refusal !== undefined) return err(refusal);
  const updated = await updateSessionMeta(sessionId, (meta) => ok({ ...meta, clockOffsetMs: offsetMs }));
  if (!updated.ok) return updated;
  setClockOffset(offsetMs);
  return updated;
}
export async function advanceClock(sessionId: string, byMs: number): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (typeof byMs !== "number" || !Number.isSafeInteger(byMs) || byMs <= 0) return err(refuse("invalid-offset", `A clock advance moves forward by a positive whole number of milliseconds; ${describeValue(byMs)} is not one. Use setClock for an absolute offset.`));
  const updated = await updateSessionMeta(sessionId, (meta) => {
    const nextOffset = meta.clockOffsetMs + byMs;
    const refusal = offsetRefusalFor(nextOffset);
    return refusal === undefined ? ok({ ...meta, clockOffsetMs: nextOffset }) : err(refusal);
  });
  if (!updated.ok) return updated;
  advanceClockOffset(byMs);
  return updated;
}
/** Re-applies a document's stored offset to the process clock, writing nothing. */
export function applySessionClock(meta: SessionMetaDocument): void {
  const refusal = offsetRefusalFor(meta.clockOffsetMs);
  if (refusal !== undefined) throw new RangeError(refusal.message);
  setClockOffset(meta.clockOffsetMs);
}
