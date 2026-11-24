import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { assertDevelopmentOnly, isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { assertScope, canView, resolveSession, type ResolvedSession, type ScopeDecision, type SessionSource } from "@/modules/data-service/authorize";
import { ministryIdSchema, organizationIdSchema, sessionContextRecordSchema, supportSubjectIdSchema, type MinistryId, type MutationInput, type OrganizationId, type Scope, type SessionContextRecord, type SupportSubjectId } from "@/modules/data-service/envelope";
import { LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, denied, invalid, unchanged, unavailable, type MutationOutcome, type MutationResult } from "@/modules/data-service/outcome";
import { runMutation } from "@/modules/data-service/operations";
import { DEMONSTRABLE_TARGETS, EMPTY_FAILURE_PLAN, disarmFailurePlan, setFailurePlan as armFailurePlan, type FailureMode, type FailurePlanRefusal, type FailureTargetKind } from "@/modules/dev-runtime/failures";
import { resetSeed as resetDevelopmentSeed, type ResetSummary } from "@/modules/dev-runtime/reset";
import { CLOCK_OFFSET_LIMIT_MS, DEV_SOURCE, SCENARIO_IDS, advanceClock as advanceSessionClock, devStateRevision, isScenarioId, parseSessionMeta, setClock as applySessionClock, setScenario as applySession, type ScenarioId, type SessionControlRefusal, type SessionMetaDocument } from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { SEED_INSTANT, instantAt } from "@/modules/time/clock";
const NO_SESSION_ID = "";
type ActingSession = { readonly sessionId: string; readonly principalId: string };
async function actingSessionContext(source?: SessionSource): Promise<ActingSession> {
  try {
    const fromRequest = await resolveSession();
    if (fromRequest.ok) return { sessionId: fromRequest.session.sessionId, principalId: fromRequest.session.principalId };
  } catch {}
  if (source === undefined) return { sessionId: NO_SESSION_ID, principalId: "" };
  try {
    const named = await resolveSession(source);
    if (named.ok) return { sessionId: named.session.sessionId, principalId: named.session.principalId };
  } catch {}
  return { sessionId: NO_SESSION_ID, principalId: "" };
}
function developmentAuthority(session: ResolvedSession): ScopeDecision {
  const access = canView(session, { kind: "dev-runtime" });
  return access.allowed ? { ok: true } : { ok: false, denial: access.denial };
}
const DEVELOPMENT_DOCUMENT_GUIDANCE = "Reload the page to read this session's development document again; if it stays unreadable, reset the development seed, which lays every seeded session down again deterministically.";
const SESSION_STATE_GUIDANCE = "Reload the page to read this session's context record again; if it stays unreadable, reset the development seed, which lays every seeded session's documents down again deterministically.";
const SESSION_STATE_SOURCE_REFERENCE = "session-state";
const RESET_SOURCE_REFERENCE = "reset";
const RESET_GUIDANCE = "Reload the page to check whether the store was reset; if it stays unavailable, run the reset from the terminal, which reports the sessions it laid down.";
function sourceUnavailable(operationId: string, source: { readonly system: string; readonly reference: string }, guidance: string): MutationOutcome {
  logger.sourceUnavailable({ job: "development-runtime", source });
  return unavailable({ operationId, source, guidance });
}
const developmentDocumentUnavailable = (operationId: string): MutationOutcome => sourceUnavailable(operationId, DEV_SOURCE, DEVELOPMENT_DOCUMENT_GUIDANCE);
const sessionStateUnavailable = (operationId: string): MutationOutcome => sourceUnavailable(operationId, { system: DEV_SOURCE.system, reference: SESSION_STATE_SOURCE_REFERENCE }, SESSION_STATE_GUIDANCE);
const resetStoreUnavailable = (operationId: string): MutationOutcome => sourceUnavailable(operationId, { system: LOCAL_STORE_SYSTEM, reference: RESET_SOURCE_REFERENCE }, RESET_GUIDANCE);
function nextRevision(previous: string): string {
  const trailing = /^(.*?)(\d+)$/.exec(previous);
  const current = trailing === null ? Number.NaN : Number(trailing[2] ?? "");
  return trailing === null || !Number.isSafeInteger(current) ? `${previous}.1` : `${trailing[1] ?? ""}${String(current + 1)}`;
}
type DevelopmentProbe = { readonly kind: "answer"; readonly outcome: MutationOutcome } | { readonly kind: "unreadable"; readonly operationId: string } | { readonly kind: "document"; readonly meta: SessionMetaDocument; readonly revision: string };
type ProbeRequest<P extends MutationResult> = { readonly sessionId: string; readonly principalId: string; readonly input: MutationInput<P>; readonly schema: z.ZodType<P>; readonly name: string; readonly developmentControl: string };
async function probeDevelopmentDocument<P extends MutationResult>(request: ProbeRequest<P>): Promise<DevelopmentProbe> {
  let observed: SessionMetaDocument | undefined;
  const outcome = await runMutation<P, MutationResult>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    diagnosticPass: "probe",
    authorize: developmentAuthority,
    scopeAuthority: "owner",
    readCurrent: (documents) => {
      const parsed = parseSessionMeta(documents.meta);
      return parsed.ok ? { kind: "record", revision: devStateRevision(parsed.value, request.principalId), value: parsed.value } : { kind: "absent" };
    },
    apply: (context) => {
      assertDevelopmentOnly(request.developmentControl);
      const parsed = parseSessionMeta(context.docs.meta);
      if (parsed.ok) observed = parsed.value;
      return { changed: false };
    },
  });
  return outcome.outcome !== "unchanged" ? { kind: "answer", outcome } : observed === undefined ? { kind: "unreadable", operationId: request.input.operationId } : { kind: "document", meta: observed, revision: devStateRevision(observed, request.principalId) };
}
async function recordDevelopmentChange<P extends MutationResult, R extends MutationResult>(
  request: { readonly sessionId: string; readonly input: MutationInput<P>; readonly schema: z.ZodType<P>; readonly name: string },
  change: { readonly revision: string; readonly result: R; readonly created?: readonly string[] },
): Promise<MutationOutcome> {
  return runMutation<P, R>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    authorize: developmentAuthority,
    scopeAuthority: "owner",
    apply: () => ({ changed: true, revision: change.revision, result: change.result, ...(change.created === undefined ? {} : { created: change.created }) }),
  });
}
function writeFailurePlan(acting: ActingSession, input: MutationInput<SetFailurePlanPayload>, plan: SessionMetaDocument["failurePlan"], revision: string, result: SetFailurePlanResult | null): Promise<MutationOutcome> {
  return runMutation<SetFailurePlanPayload, SetFailurePlanResult | null>({
    sessionId: acting.sessionId,
    input,
    schema: setFailurePlanPayloadSchema,
    name: "setFailurePlan",
    authorize: developmentAuthority,
    scopeAuthority: "owner",
    apply: (context) => {
      const meta = context.docs.meta;
      if (!isRecord(meta)) return { changed: false };
      context.docs.meta = { ...meta, failurePlan: plan };
      return { changed: true, revision, result };
    },
  });
}
export const UNSAVED_WORK_RESOLUTIONS = ["save", "discard", "stay"] as const;
export type UnsavedWorkResolution = (typeof UNSAVED_WORK_RESOLUTIONS)[number];
export type SelectContextPayload = { readonly organizationId: OrganizationId; readonly ministryId: MinistryId; readonly supportSubjectId: SupportSubjectId; readonly resolveUnsavedWork?: UnsavedWorkResolution };
export type SelectContextResult = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string; readonly revision: string; readonly unsavedWork: UnsavedWorkResolution | "none" };
type StoredSelection = { readonly organizationId: string; readonly ministryId: string; readonly supportSubjectId: string };
const selectContextPayloadSchema: z.ZodType<SelectContextPayload> = z.strictObject({ organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema, resolveUnsavedWork: z.enum(UNSAVED_WORK_RESOLUTIONS).optional() });
function storedContextRecord(state: unknown): SessionContextRecord | undefined {
  const parsed = isRecord(state) ? sessionContextRecordSchema.safeParse(state.context) : undefined;
  return parsed?.success === true ? parsed.data : undefined;
}
const storedSelection = (record: SessionContextRecord): StoredSelection | undefined => {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  return selectedOrganizationId === null || selectedMinistryId === null || selectedSupportSubjectId === null ? undefined : { organizationId: selectedOrganizationId, ministryId: selectedMinistryId, supportSubjectId: selectedSupportSubjectId };
};
/** Switches the context this session acts in and answers one of the eight outcomes. */ export async function selectContext(input: MutationInput<SelectContextPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const authorize = (session: ResolvedSession): ScopeDecision => {
    const selection = selectContextPayloadSchema.safeParse(input.payload);
    if (!selection.success) return { ok: false, denial: denied({ operationId: input.operationId, reasonCode: "no-permission" }) };
    const target: Scope = { organizationId: selection.data.organizationId, ministryId: selection.data.ministryId, supportSubjectId: selection.data.supportSubjectId, principalId: session.principalId };
    return assertScope(session, target);
  };
  let observed: SessionContextRecord | undefined;
  const probe = await runMutation<SelectContextPayload, MutationResult>({
    sessionId: acting.sessionId,
    input,
    schema: selectContextPayloadSchema,
    name: "selectContext",
    diagnosticPass: "probe",
    authorize,
    readCurrent: (documents) => {
      const stored = storedContextRecord(documents.state);
      observed = stored;
      return stored === undefined ? { kind: "absent" } : { kind: "record", revision: stored.revision, value: storedSelection(stored) ?? null };
    },
    apply: () => ({ changed: false }),
  });
  if (probe.outcome !== "unchanged") return probe;
  if (observed === undefined) return sessionStateUnavailable(input.operationId);
  const target: StoredSelection = { organizationId: input.payload.organizationId, ministryId: input.payload.ministryId, supportSubjectId: input.payload.supportSubjectId };
  const current = storedSelection(observed);
  if (current !== undefined && current.organizationId === target.organizationId && current.ministryId === target.ministryId && current.supportSubjectId === target.supportSubjectId) return probe;
  const resolution = input.payload.resolveUnsavedWork;
  if (resolution === "stay") return unchanged({ operationId: input.operationId, revision: observed.revision });
  return runMutation<SelectContextPayload, SelectContextResult>({
    sessionId: acting.sessionId,
    input,
    schema: selectContextPayloadSchema,
    name: "selectContext",
    authorize,
    readCurrent: (documents) => {
      const stored = storedContextRecord(documents.state);
      return stored === undefined ? { kind: "absent" } : { kind: "record", revision: stored.revision, value: storedSelection(stored) ?? null };
    },
    apply: (context) => {
      const meta = context.docs.meta;
      if (!isRecord(meta)) return { changed: false };
      const stateRecord = isRecord(context.docs.state) ? context.docs.state : undefined;
      const stored = stateRecord === undefined ? undefined : storedContextRecord(stateRecord);
      const revision = stored === undefined ? input.expectedRevision : nextRevision(stored.revision);
      context.docs.meta = { ...meta, selectedContext: { ...target } };
      if (stateRecord !== undefined && stored !== undefined) context.docs.state = { ...stateRecord, context: { ...stored, selectedOrganizationId: target.organizationId, selectedMinistryId: target.ministryId, selectedSupportSubjectId: target.supportSubjectId, revision } };
      return { changed: true, revision, result: { organizationId: target.organizationId, ministryId: target.ministryId, supportSubjectId: target.supportSubjectId, revision, unsavedWork: resolution ?? "none" } };
    },
  });
}
function controlRefusal(operationId: string, refusal: SessionControlRefusal, field: string): MutationOutcome {
  return refusal.code === "meta-unreadable" ? developmentDocumentUnavailable(operationId) : refusal.code === "unknown-session" ? denied({ operationId, reasonCode: "session-unavailable" }) : invalid({ operationId, fields: { [field]: [refusal.message] } });
}
const failurePlanRefusal = (operationId: string, refusal: FailurePlanRefusal): MutationOutcome => invalid({ operationId, fields: { [refusal.code === "unknown-target" ? "target.name" : refusal.code === "mode-not-demonstrable-on-target" ? "mode" : ROOT_FIELD_KEY]: [refusal.message] } });
const MILLISECOND_NANOSECONDS = 1_000_000n;
function clockOffsetMilliseconds(instantText: string): number | undefined {
  if (typeof instantText !== "string" || instantText.length === 0) return undefined;
  let instant: Temporal.Instant;
  try {
    instant = Temporal.Instant.from(instantText);
  } catch {
    return undefined;
  }
  if (instant.epochNanoseconds % MILLISECOND_NANOSECONDS !== 0n) return undefined;
  const offsetMilliseconds = instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
  return Math.abs(offsetMilliseconds) <= CLOCK_OFFSET_LIMIT_MS ? offsetMilliseconds : undefined;
}
const CLOCK_READING_MESSAGE = "A clock reading is an ISO-8601 date-time that states its offset, lands on a whole millisecond, and stays within ten years of the seed instant.";
export type SetScenarioPayload = { readonly scenarioId: ScenarioId };
export type SetScenarioResult = { readonly scenarioId: ScenarioId; readonly clockOffsetMs: number };
const scenarioIdSchema: z.ZodType<ScenarioId> = z.custom<ScenarioId>(isScenarioId, `A scenario is one this release defines: ${SCENARIO_IDS.join(", ")}.`);
const setScenarioPayloadSchema: z.ZodType<SetScenarioPayload> = z.strictObject({ scenarioId: scenarioIdSchema });
/** Selects the scenario this session runs in and answers one of the eight outcomes. */ export async function setScenario(input: MutationInput<SetScenarioPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = { sessionId: acting.sessionId, principalId: acting.principalId, input, schema: setScenarioPayloadSchema, name: "setScenario", developmentControl: "setScenario" };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind !== "document") return probe.kind === "answer" ? probe.outcome : developmentDocumentUnavailable(probe.operationId);
  if (probe.meta.scenarioId === input.payload.scenarioId) return unchanged({ operationId: input.operationId, revision: probe.revision });
  const applied = await applySession(acting.sessionId, input.payload.scenarioId);
  if (!applied.ok) return controlRefusal(input.operationId, applied.error, "scenarioId");
  const result: SetScenarioResult = { scenarioId: applied.value.scenarioId, clockOffsetMs: applied.value.clockOffsetMs };
  return recordDevelopmentChange(request, { revision: devStateRevision(applied.value, acting.principalId), result });
}
export type SetClockPayload = { readonly offsetIso: string };
export type SetClockResult = { readonly clockOffsetMs: number };
const setClockPayloadSchema: z.ZodType<SetClockPayload> = z.strictObject({ offsetIso: z.string().refine((value) => clockOffsetMilliseconds(value) !== undefined, CLOCK_READING_MESSAGE) });
/** Sets how far this session's scenario clock stands from the seed instant and answers one of the eight outcomes. */ export async function setClock(input: MutationInput<SetClockPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = { sessionId: acting.sessionId, principalId: acting.principalId, input, schema: setClockPayloadSchema, name: "setClock", developmentControl: "setClock" };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind !== "document") return probe.kind === "answer" ? probe.outcome : developmentDocumentUnavailable(probe.operationId);
  const offsetMilliseconds = clockOffsetMilliseconds(input.payload.offsetIso);
  if (offsetMilliseconds === undefined) return invalid({ operationId: input.operationId, fields: { offsetIso: [CLOCK_READING_MESSAGE] } });
  if (probe.meta.clockOffsetMs === offsetMilliseconds) return unchanged({ operationId: input.operationId, revision: probe.revision });
  const applied = await applySessionClock(acting.sessionId, offsetMilliseconds);
  if (!applied.ok) return controlRefusal(input.operationId, applied.error, "offsetIso");
  const result: SetClockResult = { clockOffsetMs: applied.value.clockOffsetMs };
  return recordDevelopmentChange(request, { revision: devStateRevision(applied.value, acting.principalId), result });
}
export type AdvanceClockPayload = { readonly bySeconds: number };
export type AdvanceClockResult = { readonly bySeconds: number; readonly clockOffsetMs: number };
const CLOCK_ADVANCE_LIMIT_SECONDS = Math.floor(CLOCK_OFFSET_LIMIT_MS / 1000);
const advanceClockPayloadSchema: z.ZodType<AdvanceClockPayload> = z.strictObject({
  bySeconds: z
    .int()
    .positive()
    .max(CLOCK_ADVANCE_LIMIT_SECONDS, `A clock advance is a whole number of seconds from 1 to ${String(CLOCK_ADVANCE_LIMIT_SECONDS)}, because the scenario clock stays within ten years of the seed instant.`),
});
/** Moves this session's scenario clock forward and answers one of the eight outcomes. */ export async function advanceClock(input: MutationInput<AdvanceClockPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = { sessionId: acting.sessionId, principalId: acting.principalId, input, schema: advanceClockPayloadSchema, name: "advanceClock", developmentControl: "advanceClock" };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind !== "document") return probe.kind === "answer" ? probe.outcome : developmentDocumentUnavailable(probe.operationId);
  const applied = await advanceSessionClock(acting.sessionId, input.payload.bySeconds * 1000);
  if (!applied.ok) return controlRefusal(input.operationId, applied.error, "bySeconds");
  const result: AdvanceClockResult = { bySeconds: input.payload.bySeconds, clockOffsetMs: applied.value.clockOffsetMs };
  return recordDevelopmentChange(request, { revision: devStateRevision(applied.value, acting.principalId), result });
}
export type ArmingFailurePlanPayload = { readonly mode: FailureMode; readonly target: { readonly kind: FailureTargetKind; readonly name: string } };
export type DisarmingFailurePlanPayload = { readonly plan: null };
export type SetFailurePlanPayload = ArmingFailurePlanPayload | DisarmingFailurePlanPayload;
export type SetFailurePlanResult = { readonly mode: FailureMode; readonly target: { readonly kind: FailureTargetKind; readonly name: string }; readonly armedAt: string };
const FAILURE_MODES = ["denied", "conflict", "unknown"] as const satisfies readonly FailureMode[];
const FAILURE_TARGET_KINDS = ["read", "mutation"] as const satisfies readonly FailureTargetKind[];
const isDemonstrableTargetName = (name: string): boolean => DEMONSTRABLE_TARGETS.some((target) => target.name === name);
const DEMONSTRABLE_TARGET_MESSAGE = `A target names the call a failure is demonstrated on: ${DEMONSTRABLE_TARGETS.map((target) => target.name).join(", ")}.`;
const DISARM_PLAN_MEMBER = "plan";
const armFailurePlanPayloadSchema: z.ZodType<ArmingFailurePlanPayload> = z.strictObject({ mode: z.enum(FAILURE_MODES), target: z.strictObject({ kind: z.enum(FAILURE_TARGET_KINDS), name: z.string().refine(isDemonstrableTargetName, DEMONSTRABLE_TARGET_MESSAGE) }) });
const disarmFailurePlanPayloadSchema: z.ZodType<DisarmingFailurePlanPayload> = z.strictObject({ plan: z.null() });
const setFailurePlanPayloadSchema: z.ZodType<SetFailurePlanPayload> = z.custom<SetFailurePlanPayload>().superRefine((payload, ctx) => {
  const parsed = isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER) ? disarmFailurePlanPayloadSchema.safeParse(payload) : armFailurePlanPayloadSchema.safeParse(payload);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
});
/** Arms one simulated failure on one named read or mutation, or disarms the armed one, for this session only, and answers one of the eight outcomes. */
export async function setFailurePlan(input: MutationInput<SetFailurePlanPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const probe = await probeDevelopmentDocument({ sessionId: acting.sessionId, principalId: acting.principalId, input, schema: setFailurePlanPayloadSchema, name: "setFailurePlan", developmentControl: "setFailurePlan" });
  if (probe.kind !== "document") return probe.kind === "answer" ? probe.outcome : developmentDocumentUnavailable(probe.operationId);
  if ("plan" in input.payload) {
    const disarmed = disarmFailurePlan();
    if (probe.meta.failurePlan === EMPTY_FAILURE_PLAN) return unchanged({ operationId: input.operationId, revision: probe.revision });
    const clearedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: disarmed };
    return writeFailurePlan(acting, input, disarmed, devStateRevision(clearedDocument, acting.principalId), null);
  }
  const { mode, target } = input.payload;
  const armed = probe.meta.failurePlan;
  if (armed !== null && armed.mode === mode && armed.target.kind === target.kind && armed.target.name === target.name) return unchanged({ operationId: input.operationId, revision: probe.revision });
  const armedAt = instantAt(probe.meta.clockOffsetMs).toString();
  const arming = armFailurePlan(probe.meta.failurePlan, { mode, target, armedAt });
  if (!arming.ok) return failurePlanRefusal(input.operationId, arming.error);
  const plan = arming.value;
  const armedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: plan };
  const result: SetFailurePlanResult = { mode: plan.mode, target: { kind: plan.target.kind, name: plan.target.name }, armedAt: plan.armedAt };
  return writeFailurePlan(acting, input, plan, devStateRevision(armedDocument, acting.principalId), result);
}
export type ResetSeedPayload = Record<string, never>;
export type ResetSeedResult = { readonly seededSessions: readonly string[]; readonly removedSessions: readonly string[]; readonly clockOffsetMs: number; readonly partners: number; readonly seedInstant: string };
const resetSeedPayloadSchema: z.ZodType<ResetSeedPayload> = z.custom<ResetSeedPayload>((value) => isRecord(value) && Object.keys(value).length === 0, "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.");
async function seededDevStateRevision(sessionId: string, principalId: string): Promise<string | undefined> {
  const documents = await readSession(sessionId);
  if (documents === undefined) return undefined;
  const parsed = parseSessionMeta(documents.meta);
  return parsed.ok ? devStateRevision(parsed.value, principalId) : undefined;
}
/** Discards every stored session, lays every seeded session down again deterministically, returns the scenario clock to the seed instant, and answers one of the eight outcomes. */
export async function resetSeed(input: MutationInput<ResetSeedPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = { sessionId: acting.sessionId, principalId: acting.principalId, input, schema: resetSeedPayloadSchema, name: "resetSeed", developmentControl: "resetSeed" };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind !== "document") return probe.kind === "answer" ? probe.outcome : developmentDocumentUnavailable(probe.operationId);
  let summary: ResetSummary;
  try {
    summary = await resetDevelopmentSeed();
  } catch {
    return resetStoreUnavailable(input.operationId);
  }
  const result: ResetSeedResult = { seededSessions: summary.seededSessions, removedSessions: summary.removedSessions, clockOffsetMs: summary.clockOffsetMs, partners: summary.partners, seedInstant: summary.seedInstant };
  let revision: string | undefined;
  try {
    revision = await seededDevStateRevision(acting.sessionId, acting.principalId);
  } catch {
    revision = undefined;
  }
  return revision === undefined ? resetStoreUnavailable(input.operationId) : recordDevelopmentChange(request, { revision, result, created: summary.seededSessions });
}
