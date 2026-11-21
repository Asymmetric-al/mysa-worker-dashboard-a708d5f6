/**
 * The six request-path mutations of the development runtime: the context switch every session uses to
 * choose the ministry it acts in, and the five controls the development panel operates — the scenario,
 * the scenario clock's absolute offset, a forward clock advance, one armed simulated failure, and the
 * deterministic reset.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { assertDevelopmentOnly, isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { assertScope, canView, resolveSession, type ResolvedSession, type ScopeDecision, type SessionSource } from "@/modules/data-service/authorize";
import {
  ministryIdSchema,
  organizationIdSchema,
  sessionContextRecordSchema,
  supportSubjectIdSchema,
  type OrganizationId,
  type MinistryId,
  type MutationInput,
  type Scope,
  type SessionContextRecord,
  type SupportSubjectId,
} from "@/modules/data-service/envelope";
import { LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, denied, invalid, unchanged, unavailable, type MutationOutcome, type MutationResult } from "@/modules/data-service/outcome";
import { runMutation } from "@/modules/data-service/operations";
import {
  DEMONSTRABLE_TARGETS,
  EMPTY_FAILURE_PLAN,
  disarmFailurePlan,
  setFailurePlan as armFailurePlan,
  type FailureMode,
  type FailurePlanRefusal,
  type FailureTargetKind,
} from "@/modules/dev-runtime/failures";
import { resetSeed as resetDevelopmentSeed, type ResetSummary } from "@/modules/dev-runtime/reset";
import {
  CLOCK_OFFSET_LIMIT_MS,
  DEV_SOURCE,
  SCENARIO_IDS,
  advanceClock as advanceSessionClock,
  devStateRevision,
  isScenarioId,
  parseSessionMeta,
  setClock as applySessionClock,
  setScenario as applySession,
  type ScenarioId,
  type SessionControlRefusal,
  type SessionMetaDocument,
} from "@/modules/dev-runtime/scenario";
import { readSession } from "@/modules/store/repository";
import { SEED_INSTANT, instantAt } from "@/modules/time/clock";
// The session a request acts for
const NO_SESSION_ID = "";

interface ActingSession {
  readonly sessionId: string;
  readonly principalId: string;
}
async function actingSessionContext(source?: SessionSource): Promise<ActingSession> {
  try {
    const fromRequest = await resolveSession();
    if (fromRequest.ok) {
      return {
        sessionId: fromRequest.session.sessionId,
        principalId: fromRequest.session.principalId,
      };
    }
  } catch {
    // `next/headers` has no request to read outside a request scope, which is a test or a script
    // rather than a browser: the named path below serves it.
  }
  if (source === undefined) {
    return { sessionId: NO_SESSION_ID, principalId: "" };
  }
  try {
    const named = await resolveSession(source);
    if (named.ok) {
      return { sessionId: named.session.sessionId, principalId: named.session.principalId };
    }
  } catch {
    // Naming a session directly is refused outside a development build, and a refusal to name one is
    // not a session: the absent id lets the runner answer with the one refusal shape.
  }
  return { sessionId: NO_SESSION_ID, principalId: "" };
}
// Authority and the development boundary
function developmentAuthority(session: ResolvedSession): ScopeDecision {
  const access = canView(session, { kind: "dev-runtime" });
  return access.allowed ? { ok: true } : { ok: false, denial: access.denial };
}
const DEVELOPMENT_DOCUMENT_GUIDANCE =
  "Reload the page to read this session's development document again; if it stays unreadable, reset the development seed, which lays every seeded session down again deterministically.";
const SESSION_STATE_GUIDANCE =
  "Reload the page to read this session's context record again; if it stays unreadable, reset the development seed, which lays every seeded session's documents down again deterministically.";
const SESSION_STATE_SOURCE_REFERENCE = "session-state";

const RESET_SOURCE_REFERENCE = "reset";

const RESET_GUIDANCE = "Reload the page to check whether the store was reset; if it stays unavailable, run the reset from the terminal, which reports the sessions it laid down.";

function sourceUnavailable(operationId: string, source: { readonly system: string; readonly reference: string }, guidance: string): MutationOutcome {
  logger.sourceUnavailable({ job: "development-runtime", source });
  return unavailable({ operationId, source, guidance });
}
function developmentDocumentUnavailable(operationId: string): MutationOutcome {
  return sourceUnavailable(operationId, DEV_SOURCE, DEVELOPMENT_DOCUMENT_GUIDANCE);
}
function sessionStateUnavailable(operationId: string): MutationOutcome {
  return sourceUnavailable(operationId, { system: DEV_SOURCE.system, reference: SESSION_STATE_SOURCE_REFERENCE }, SESSION_STATE_GUIDANCE);
}
function resetStoreUnavailable(operationId: string): MutationOutcome {
  return sourceUnavailable(operationId, { system: LOCAL_STORE_SYSTEM, reference: RESET_SOURCE_REFERENCE }, RESET_GUIDANCE);
}
// The revision tokens this file advances
function nextRevision(previous: string): string {
  const trailing = /^(.*?)(\d+)$/.exec(previous);
  if (trailing === null) {
    return `${previous}.1`;
  }
  const prefix = trailing[1] ?? "";
  const current = Number(trailing[2] ?? "");
  return Number.isSafeInteger(current) ? `${prefix}${String(current + 1)}` : `${previous}.1`;
}
// The probe pass
type DevelopmentProbe =
  | { readonly kind: "answer"; readonly outcome: MutationOutcome }
  | { readonly kind: "unreadable"; readonly operationId: string }
  | {
      readonly kind: "document";
      readonly meta: SessionMetaDocument;
      readonly revision: string;
    };
interface ProbeRequest<P extends MutationResult> {
  readonly sessionId: string;
  readonly principalId: string;
  readonly input: MutationInput<P>;
  readonly schema: z.ZodType<P>;
  readonly name: string;
  readonly developmentControl: string;
}
async function probeDevelopmentDocument<P extends MutationResult>(request: ProbeRequest<P>): Promise<DevelopmentProbe> {
  let observed: SessionMetaDocument | undefined;
  const outcome = await runMutation<P, MutationResult>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    diagnosticPass: "probe",
    authorize: developmentAuthority,
    // The development control is authorised by the build and acts on the caller's own session document,
    // so ministry admission is not asked of a persona that holds none: `authorize.ts` answers the
    // `dev-runtime` question ahead of its admission gate, while the runner's default "membership"
    // authority would refuse the call with `no-membership` before that question was ever put. The
    // session must still be live and must name the principal it acts for.
    scopeAuthority: "owner",
    readCurrent: (documents) => {
      const parsed = parseSessionMeta(documents.meta);
      return parsed.ok
        ? {
            kind: "record",
            revision: devStateRevision(parsed.value, request.principalId),
            value: parsed.value,
          }
        : { kind: "absent" };
    },
    apply: (context) => {
      assertDevelopmentOnly(request.developmentControl);
      const parsed = parseSessionMeta(context.docs.meta);
      if (parsed.ok) {
        observed = parsed.value;
      }
      return { changed: false };
    },
  });
  if (outcome.outcome !== "unchanged") {
    return { kind: "answer", outcome };
  }
  if (observed === undefined) {
    return { kind: "unreadable", operationId: request.input.operationId };
  }
  return {
    kind: "document",
    meta: observed,
    revision: devStateRevision(observed, request.principalId),
  };
}
async function recordDevelopmentChange<P extends MutationResult, R extends MutationResult>(
  request: {
    readonly sessionId: string;
    readonly input: MutationInput<P>;
    readonly schema: z.ZodType<P>;
    readonly name: string;
  },
  change: {
    readonly revision: string;
    readonly result: R;
    readonly created?: readonly string[];
  },
): Promise<MutationOutcome> {
  return runMutation<P, R>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    // As in `probeDevelopmentDocument`: the document changed is the caller's own session document, so no
    // ministry admission is asked of the persona.
    authorize: developmentAuthority,
    scopeAuthority: "owner",
    apply: () => ({
      changed: true,
      revision: change.revision,
      result: change.result,
      ...(change.created === undefined ? {} : { created: change.created }),
    }),
  });
}
// selectContext — enter and change context
/** The decisions a caller may state for work it has not saved before a context switch. */
export const UNSAVED_WORK_RESOLUTIONS = ["save", "discard", "stay"] as const;
/** One stated decision about unsaved work; the closed three-value choice the guard offers. */
export type UnsavedWorkResolution = (typeof UNSAVED_WORK_RESOLUTIONS)[number];
/** The context a caller asks to move to. */
export type SelectContextPayload = {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
  readonly resolveUnsavedWork?: UnsavedWorkResolution;
};
/** The selection that is authoritative after the switch, and what happened to the caller's work. */
export type SelectContextResult = {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly revision: string;
  readonly unsavedWork: UnsavedWorkResolution | "none";
};
interface StoredSelection {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
}
const selectContextPayloadSchema: z.ZodType<SelectContextPayload> = z.strictObject({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
  resolveUnsavedWork: z.enum(UNSAVED_WORK_RESOLUTIONS).optional(),
});
function storedContextRecord(state: unknown): SessionContextRecord | undefined {
  if (!isRecord(state)) {
    return undefined;
  }
  const parsed = sessionContextRecordSchema.safeParse(state.context);
  return parsed.success ? parsed.data : undefined;
}
function storedSelection(record: SessionContextRecord): StoredSelection | undefined {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  if (selectedOrganizationId === null || selectedMinistryId === null || selectedSupportSubjectId === null) {
    return undefined;
  }
  return {
    organizationId: selectedOrganizationId,
    ministryId: selectedMinistryId,
    supportSubjectId: selectedSupportSubjectId,
  };
}
function sameSelection(left: StoredSelection, right: StoredSelection): boolean {
  return left.organizationId === right.organizationId && left.ministryId === right.ministryId && left.supportSubjectId === right.supportSubjectId;
}
/** Switches the context this session acts in and answers one of the eight outcomes. */
export async function selectContext(input: MutationInput<SelectContextPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  // The mutation's own authority question: the context being moved *to* must be an admitted membership
  // of the acting principal. The principal comes from the session, never from the payload, so a
  // request cannot nominate the person it acts for.
  const authorize = (session: ResolvedSession): ScopeDecision => {
    const selection = selectContextPayloadSchema.safeParse(input.payload);
    if (!selection.success) {
      // Unreachable through the runner, which validates the payload before it asks this question; a
      // caller that reached it could not be admitted to a context it did not state.
      return {
        ok: false,
        denial: denied({ operationId: input.operationId, reasonCode: "no-permission" }),
      };
    }
    const target: Scope = {
      organizationId: selection.data.organizationId,
      ministryId: selection.data.ministryId,
      supportSubjectId: selection.data.supportSubjectId,
      principalId: session.principalId,
    };
    return assertScope(session, target);
  };
  // The probe reads the context record the caller's revision belongs to and changes nothing, so an
  // attempt that is invalid, refused, a replay or stale is answered before the switch is attempted and
  // an unreadable record is reported as an outage instead of being overwritten. It states
  // `diagnosticPass: "probe"`, so the `unchanged` it answers to move this function on to the switch
  // writes no diagnostic line: the caller's answer is the switch's own outcome, and that is the
  // attempt's one line. A switch that finds the context already in force answers `unchanged` from this
  // probe, so it writes no line at all — the module decided that answer itself, before the change.
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
      if (stored === undefined) {
        return { kind: "absent" };
      }
      return {
        kind: "record",
        revision: stored.revision,
        value: storedSelection(stored) ?? null,
      };
    },
    apply: () => ({ changed: false }),
  });
  if (probe.outcome !== "unchanged") {
    return probe;
  }
  if (observed === undefined) {
    return sessionStateUnavailable(input.operationId);
  }
  // Validated by the probe before it reached this point.
  const target: StoredSelection = {
    organizationId: input.payload.organizationId,
    ministryId: input.payload.ministryId,
    supportSubjectId: input.payload.supportSubjectId,
  };
  const current = storedSelection(observed);
  if (current !== undefined && sameSelection(current, target)) {
    // Nothing to switch: the runner's own `unchanged`, with the revision the caller read.
    return probe;
  }
  const resolution = input.payload.resolveUnsavedWork;
  if (resolution === "stay") {
    // A caller that chose to keep the work it holds has answered the guard's question, so the switch is
    // not attempted: nothing is applied and no history or activity entry is written. The answer is the
    // closed set's "no change" with the revision the context still stands at, because no staleness or
    // reused identity exists to report and a conflict would demand a decision the caller just made.
    return unchanged({ operationId: input.operationId, revision: observed.revision });
  }
  // The switch: the development document is the authority the session resolver reads, and the state
  // record's context is the selection the shell displays and whose revision the caller presents next.
  // Both move in one transaction, so a response that started in the old context cannot be mistaken for
  // the new one's — the fence the client raises around its cache is backed by a single atomic write.
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
      if (!isRecord(meta)) {
        // Unreachable: the runner resolved this session from this same document, so a development
        // document that is not an object would have been refused before the transaction opened. If it
        // ever were reached, no selection can become authoritative, so nothing changed.
        return { changed: false };
      }
      const stateRecord = isRecord(context.docs.state) ? context.docs.state : undefined;
      const stored = stateRecord === undefined ? undefined : storedContextRecord(stateRecord);
      const revision = stored === undefined ? input.expectedRevision : nextRevision(stored.revision);
      context.docs.meta = { ...meta, selectedContext: { ...target } };
      if (stateRecord !== undefined && stored !== undefined) {
        context.docs.state = {
          ...stateRecord,
          context: {
            ...stored,
            selectedOrganizationId: target.organizationId,
            selectedMinistryId: target.ministryId,
            selectedSupportSubjectId: target.supportSubjectId,
            revision,
          },
        };
      }
      const result: SelectContextResult = {
        organizationId: target.organizationId,
        ministryId: target.ministryId,
        supportSubjectId: target.supportSubjectId,
        revision,
        unsavedWork: resolution ?? "none",
      };
      return { changed: true, revision, result };
    },
  });
}
// Refusals the development runtime answers with a value
function controlRefusal(operationId: string, refusal: SessionControlRefusal, field: string): MutationOutcome {
  switch (refusal.code) {
    case "meta-unreadable":
      return developmentDocumentUnavailable(operationId);
    case "unknown-session":
      return denied({ operationId, reasonCode: "session-unavailable" });
    case "unknown-scenario":
    case "invalid-offset":
    case "out-of-range-offset":
      return invalid({ operationId, fields: { [field]: [refusal.message] } });
  }
}
function failurePlanRefusal(operationId: string, refusal: FailurePlanRefusal): MutationOutcome {
  switch (refusal.code) {
    case "unknown-target":
      return invalid({ operationId, fields: { "target.name": [refusal.message] } });
    case "mode-not-demonstrable-on-target":
      return invalid({ operationId, fields: { mode: [refusal.message] } });
    case "malformed-plan":
    case "already-armed":
      return invalid({ operationId, fields: { [ROOT_FIELD_KEY]: [refusal.message] } });
  }
}
const MILLISECOND_NANOSECONDS = 1_000_000n;

function clockOffsetMilliseconds(instantText: string): number | undefined {
  if (typeof instantText !== "string" || instantText.length === 0) {
    return undefined;
  }
  let instant: Temporal.Instant;
  try {
    instant = Temporal.Instant.from(instantText);
  } catch {
    return undefined;
  }
  if (instant.epochNanoseconds % MILLISECOND_NANOSECONDS !== 0n) {
    return undefined;
  }
  const offsetMilliseconds = instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
  return Math.abs(offsetMilliseconds) <= CLOCK_OFFSET_LIMIT_MS ? offsetMilliseconds : undefined;
}
const CLOCK_READING_MESSAGE = "A clock reading is an ISO-8601 date-time that states its offset, lands on a whole millisecond, and stays within ten years of the seed instant.";
// setScenario — which world this session runs in
/** The scenario a session asks to run in. */
export type SetScenarioPayload = {
  readonly scenarioId: ScenarioId;
};
/** The scenario the session now runs in, and the offset the change kept. */
export type SetScenarioResult = {
  readonly scenarioId: ScenarioId;
  readonly clockOffsetMs: number;
};
const scenarioIdSchema: z.ZodType<ScenarioId> = z.custom<ScenarioId>(isScenarioId, `A scenario is one this release defines: ${SCENARIO_IDS.join(", ")}.`);

const setScenarioPayloadSchema: z.ZodType<SetScenarioPayload> = z.strictObject({
  scenarioId: scenarioIdSchema,
});
/** Selects the scenario this session runs in and answers one of the eight outcomes. */
export async function setScenario(input: MutationInput<SetScenarioPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setScenarioPayloadSchema,
    name: "setScenario",
    developmentControl: "setScenario",
  };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }
  if (probe.meta.scenarioId === input.payload.scenarioId) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }
  const applied = await applySession(acting.sessionId, input.payload.scenarioId);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "scenarioId");
  }
  const result: SetScenarioResult = {
    scenarioId: applied.value.scenarioId,
    clockOffsetMs: applied.value.clockOffsetMs,
  };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}
// setClock — how far this session's scenario clock stands from the seed instant
/** The instant a session asks its scenario clock to read. */
export type SetClockPayload = {
  readonly offsetIso: string;
};
/** The offset the clock now stands at, in the unit the clock itself works in. */
export type SetClockResult = {
  readonly clockOffsetMs: number;
};
const setClockPayloadSchema: z.ZodType<SetClockPayload> = z.strictObject({
  offsetIso: z.string().refine((value) => clockOffsetMilliseconds(value) !== undefined, CLOCK_READING_MESSAGE),
});
/** Sets how far this session's scenario clock stands from the seed instant and answers one of the eight outcomes. */
export async function setClock(input: MutationInput<SetClockPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setClockPayloadSchema,
    name: "setClock",
    developmentControl: "setClock",
  };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }
  // The probe validated this reading, so the conversion cannot fail here; the branch restates the same
  // refusal rather than letting an undefined offset reach the clock.
  const offsetMilliseconds = clockOffsetMilliseconds(input.payload.offsetIso);
  if (offsetMilliseconds === undefined) {
    return invalid({
      operationId: input.operationId,
      fields: { offsetIso: [CLOCK_READING_MESSAGE] },
    });
  }
  if (probe.meta.clockOffsetMs === offsetMilliseconds) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }
  const applied = await applySessionClock(acting.sessionId, offsetMilliseconds);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "offsetIso");
  }
  const result: SetClockResult = { clockOffsetMs: applied.value.clockOffsetMs };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}
// advanceClock — step this session across a boundary
/** The forward move a caller asks the scenario clock for, in seconds. */
export type AdvanceClockPayload = {
  readonly bySeconds: number;
};
/** How far the clock moved and where it now stands. */
export type AdvanceClockResult = {
  readonly bySeconds: number;
  readonly clockOffsetMs: number;
};
const CLOCK_ADVANCE_LIMIT_SECONDS = Math.floor(CLOCK_OFFSET_LIMIT_MS / 1000);

const advanceClockPayloadSchema: z.ZodType<AdvanceClockPayload> = z.strictObject({
  bySeconds: z
    .int()
    .positive()
    .max(
      CLOCK_ADVANCE_LIMIT_SECONDS,
      `A clock advance is a whole number of seconds from 1 to ${String(CLOCK_ADVANCE_LIMIT_SECONDS)}, because the scenario clock stays within ten years of the seed instant.`,
    ),
});
/** Moves this session's scenario clock forward and answers one of the eight outcomes. */
export async function advanceClock(input: MutationInput<AdvanceClockPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: advanceClockPayloadSchema,
    name: "advanceClock",
    developmentControl: "advanceClock",
  };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }
  const applied = await advanceSessionClock(acting.sessionId, input.payload.bySeconds * 1000);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "bySeconds");
  }
  const result: AdvanceClockResult = {
    bySeconds: input.payload.bySeconds,
    clockOffsetMs: applied.value.clockOffsetMs,
  };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}
// setFailurePlan — one armed simulated failure
/** The failure to arm, and the one call it is demonstrated on. */
export type ArmingFailurePlanPayload = {
  readonly mode: FailureMode;
  readonly target: {
    readonly kind: FailureTargetKind;
    readonly name: string;
  };
};
/** The disarm: the payload form that clears the armed failure and leaves every record as it stands. */
export type DisarmingFailurePlanPayload = {
  readonly plan: null;
};
/** Either form of a `setFailurePlan` payload: the failure to arm, or the disarm that clears it. */
export type SetFailurePlanPayload = ArmingFailurePlanPayload | DisarmingFailurePlanPayload;
/** The plan now armed, as the development document stores it. */
export type SetFailurePlanResult = {
  readonly mode: FailureMode;
  readonly target: {
    readonly kind: FailureTargetKind;
    readonly name: string;
  };
  readonly armedAt: string;
};
const FAILURE_MODES = ["denied", "conflict", "unknown"] as const satisfies readonly FailureMode[];

const FAILURE_TARGET_KINDS = ["read", "mutation"] as const satisfies readonly FailureTargetKind[];

function isDemonstrableTargetName(name: string): boolean {
  return DEMONSTRABLE_TARGETS.some((target) => target.name === name);
}
const DEMONSTRABLE_TARGET_MESSAGE = `A target names the call a failure is demonstrated on: ${DEMONSTRABLE_TARGETS.map((target) => target.name).join(", ")}.`;

const DISARM_PLAN_MEMBER = "plan";

const armFailurePlanPayloadSchema: z.ZodType<ArmingFailurePlanPayload> = z.strictObject({
  mode: z.enum(FAILURE_MODES),
  target: z.strictObject({
    kind: z.enum(FAILURE_TARGET_KINDS),
    name: z.string().refine(isDemonstrableTargetName, DEMONSTRABLE_TARGET_MESSAGE),
  }),
});
const disarmFailurePlanPayloadSchema: z.ZodType<DisarmingFailurePlanPayload> = z.strictObject({
  plan: z.null(),
});
const setFailurePlanPayloadSchema: z.ZodType<SetFailurePlanPayload> = z.custom<SetFailurePlanPayload>().superRefine((payload, ctx) => {
  const parsed = isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER) ? disarmFailurePlanPayloadSchema.safeParse(payload) : armFailurePlanPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // The branch's own message and field path are what a caller acts on; the machine code belongs to
      // the schema library, and an `invalid` outcome is keyed by the path and read for the message.
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  }
});
/** Arms one simulated failure on one named read or mutation, or disarms the armed one, for this session only, and answers one of the eight outcomes. */
export async function setFailurePlan(input: MutationInput<SetFailurePlanPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setFailurePlanPayloadSchema,
    name: "setFailurePlan",
    developmentControl: "setFailurePlan",
  };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }
  // The disarm states the absence of a plan, so there is nothing to stamp and nothing to arm: the
  // document is written back with the plan cleared. A document that already holds no plan would
  // produce no change and is answered as such (AAP 0.7.1, `unchanged`).
  if ("plan" in input.payload) {
    const disarmed = disarmFailurePlan();
    if (probe.meta.failurePlan === EMPTY_FAILURE_PLAN) {
      return unchanged({ operationId: input.operationId, revision: probe.revision });
    }
    const clearedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: disarmed };
    const revision = devStateRevision(clearedDocument, acting.principalId);
    return runMutation<SetFailurePlanPayload, SetFailurePlanResult | null>({
      sessionId: acting.sessionId,
      input,
      schema: setFailurePlanPayloadSchema,
      name: "setFailurePlan",
      // As in `probeDevelopmentDocument`: the plan is cleared on the caller's own session document, so no
      // ministry admission is asked of the persona.
      authorize: developmentAuthority,
      scopeAuthority: "owner",
      apply: (context) => {
        const meta = context.docs.meta;
        if (!isRecord(meta)) {
          // Unreachable: the runner resolved this session from this same document. No plan can be
          // cleared in a document that is not one, so nothing changed.
          return { changed: false };
        }
        context.docs.meta = { ...meta, failurePlan: disarmed };
        return { changed: true, revision, result: null };
      },
    });
  }
  const { mode, target } = input.payload;
  const armed = probe.meta.failurePlan;
  if (armed !== null && armed.mode === mode && armed.target.kind === target.kind && armed.target.name === target.name) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }
  // The instant the plan is stamped with is this session's own scenario instant, derived from the
  // offset its document persists, so a plan armed from one session never records another session's
  // clock position.
  const armedAt = instantAt(probe.meta.clockOffsetMs).toString();
  const arming = armFailurePlan(probe.meta.failurePlan, { mode, target, armedAt });
  if (!arming.ok) {
    return failurePlanRefusal(input.operationId, arming.error);
  }
  const plan = arming.value;
  const armedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: plan };
  const revision = devStateRevision(armedDocument, acting.principalId);
  return runMutation<SetFailurePlanPayload, SetFailurePlanResult>({
    sessionId: acting.sessionId,
    input,
    schema: setFailurePlanPayloadSchema,
    name: "setFailurePlan",
    // As in `probeDevelopmentDocument`: the plan is armed on the caller's own session document, so no
    // ministry admission is asked of the persona.
    authorize: developmentAuthority,
    scopeAuthority: "owner",
    apply: (context) => {
      const meta = context.docs.meta;
      if (!isRecord(meta)) {
        // Unreachable: the runner resolved this session from this same document. No plan can be
        // recorded in a document that is not one, so nothing changed.
        return { changed: false };
      }
      // The document is written back from the record it was read as, so every member this module does
      // not own — the scenario, the offset, the admission state, the memberships, the selection — is
      // carried through untouched.
      context.docs.meta = { ...meta, failurePlan: plan };
      const result: SetFailurePlanResult = {
        mode: plan.mode,
        target: { kind: plan.target.kind, name: plan.target.name },
        armedAt: plan.armedAt,
      };
      return { changed: true, revision, result };
    },
  });
}
// resetSeed — the deterministic reset
/** A seed reset states nothing: there is nothing a caller can choose about it. */
export type ResetSeedPayload = Record<string, never>;
/** What a reset laid down and what it removed, as the operation's stored result. */
export type ResetSeedResult = {
  readonly seededSessions: readonly string[];
  readonly removedSessions: readonly string[];
  readonly clockOffsetMs: number;
  readonly partners: number;
  readonly seedInstant: string;
};
const resetSeedPayloadSchema: z.ZodType<ResetSeedPayload> = z.custom<ResetSeedPayload>(
  (value) => isRecord(value) && Object.keys(value).length === 0,
  "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.",
);
/**
 * The revision token the re-seeded documents publish for one session, or `undefined` when the document
 * the reset laid down cannot be read; a store fault throws here, so the mutation answers it as the
 * outage it is rather than as an unreadable document.
 */
async function seededDevStateRevision(sessionId: string, principalId: string): Promise<string | undefined> {
  const documents = await readSession(sessionId);
  if (documents === undefined) {
    return undefined;
  }
  const parsed = parseSessionMeta(documents.meta);
  return parsed.ok ? devStateRevision(parsed.value, principalId) : undefined;
}

/** Discards every stored session, lays every seeded session down again deterministically, returns the scenario clock to the seed instant, and answers one of the eight outcomes. */
export async function resetSeed(input: MutationInput<ResetSeedPayload>, source?: SessionSource): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: resetSeedPayloadSchema,
    name: "resetSeed",
    developmentControl: "resetSeed",
  };
  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }
  let summary: ResetSummary;
  try {
    summary = await resetDevelopmentSeed();
  } catch {
    return resetStoreUnavailable(input.operationId);
  }
  const result: ResetSeedResult = {
    seededSessions: summary.seededSessions,
    removedSessions: summary.removedSessions,
    clockOffsetMs: summary.clockOffsetMs,
    partners: summary.partners,
    seedInstant: summary.seedInstant,
  };
  let revision: string | undefined;
  try {
    revision = await seededDevStateRevision(acting.sessionId, acting.principalId);
  } catch {
    revision = undefined;
  }
  if (revision === undefined) {
    // The reset replaced the state the caller presented a revision for, so the only token this answer
    // can carry is the one the seeded document now produces; the caller's own pre-reset token names a
    // state the store no longer holds and would answer its next mutation as a stale revision. A document
    // this boundary has not read yields no token at all: the reset did happen, so the answer is the
    // store's outage — never a fabricated revision, and never a denial of the effect.
    return resetStoreUnavailable(input.operationId);
  }
  return recordDevelopmentChange(request, {
    revision,
    result,
    created: summary.seededSessions,
  });
}
