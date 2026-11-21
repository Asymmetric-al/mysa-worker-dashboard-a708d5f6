/**
 * The development scenario registry, the per-session scenario document, and the one controllable
 * clock offset.
 *
 * Three controls let a demonstration start from a known world without editing a single record: which
 * of the closed scenarios a session sits in, how far the scenario clock stands from the seed
 * instant, and the session's `.meta.json` document that persists both beside the armed failure plan
 * and the selected organization/ministry context. This module owns those three and nothing else.
 * Every boundary the release defines — a referral's New and Continued windows, a coaching share
 * cutoff, the 24-hour notification usefulness window, the 168-hour confirmation window, a
 * recurrence's next admitted date — is a pure function of `(input, now)` evaluated at read or
 * command time, so moving this offset is the whole of moving time. Nothing here observes a clock in
 * the background: there is no timer, no interval, no queued callback and no scheduled job, and a
 * boundary therefore never becomes true "eventually" — it becomes true when a read or command is
 * evaluated against the moved instant.
 *
 * The offset is process-wide and persisted per session. `@/modules/time/clock` holds one offset for
 * the process; the authoritative value for a session lives in its `.meta.json`. `setClock` and
 * `advanceClock` persist the session's value and then move the process clock, and
 * `applySessionClock` re-applies a stored value when a session becomes active. Two sessions in
 * different scenarios therefore cannot hold two different times at once: the browser suite runs a
 * single worker with `fullyParallel: false` for exactly this reason, and inventing per-session timers
 * to hide the limitation would be the second clock this module exists to prevent.
 *
 * This module must never serve a request-path read or mutation. It is the one place besides
 * `@/modules/data-service` that imports the synthetic store, and that exception exists so seeding,
 * workload generation, reset and the development panel can lay down and adjust a session before any
 * request runs. Every write goes through `store/repository#transact`, so the per-session lock and the
 * atomic temp-then-rename write apply and a crash leaves either the previous document or the new one.
 * No file is opened, named or parsed here, and no document is kept in memory between calls.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Development runtime": session scenario, clock, failure plan, seed, generator and
 *   reset, exposing `setScenario`, `setClock`, `advanceClock` and `readDevState`.
 * - AAP 0.7.2 "The controllable local clock" with its boundary table, and 0.9.2's
 *   `<sessionId>.meta.json` holding the scenario id, the clock offset, the selected context and the
 *   failure plan.
 * - Assumption A12: the scenario clock is an offset stored per session, moved only by the
 *   development control, with every boundary evaluated at read or command time.
 *
 * Rule 1 obligations this file keeps. The registry is closed to the flags the retained criteria
 * actually start from — the three feature-specific unavailabilities and the worker-continuation
 * setting — so no scenario exists for a deferred capability, a provider or a deployment. There is one
 * registry, one offset and one document shape: no second configuration store, no second way to move
 * time, and no wrapper that only re-exports the clock. Because every boundary is a pure function of
 * `now`, moving this offset moves all of them together and none of them can drift to a different
 * reading of the clock.
 *
 * Layering: a development-runtime module below the data service. It imports the clock controls, the
 * store's session surface with the fault it raises for an undecodable document, the shared narrowing
 * guards, the sibling failure-plan vocabulary and the result helpers, and it never reads the machine
 * clock: it draws no current-time value, no randomness, and it arms no timer, interval, microtask
 * chain or scheduled callback. Every instant it derives comes from `SEED_INSTANT`. It imports no
 * data-service read, mutation or dev-state value, no feature, no component and no route. Its one
 * import from that layer is the session-admission vocabulary of
 * `@/modules/data-service/envelope` — a leaf contract module that reaches no store and no request
 * path — because that module owns the persisted session record this runtime lays down; importing it
 * here, and never the reverse, is what keeps that vocabulary single and the two layers acyclic.
 */
import { isRecord } from "@/lib/guards";
import { err, ok, type Result } from "@/lib/result";
import {
  admittedMembershipSchema,
  SESSION_STATES,
  type AdmittedMembership,
  type SessionState,
} from "@/modules/data-service/envelope";
import { CorruptJsonError } from "@/modules/store/atomic";
import { isSafeSessionId } from "@/modules/store/paths";
import { readSession, SessionNotFoundError, transact } from "@/modules/store/repository";
import { advanceClockOffset, SEED_INSTANT, setClockOffset } from "@/modules/time/clock";

import { EMPTY_FAILURE_PLAN, parseFailurePlan, type FailurePlanDocument } from "./failures";

// ---------------------------------------------------------------------------------------------
// The closed scenario registry
// ---------------------------------------------------------------------------------------------

/**
 * The scenarios this release defines, in the order the development panel lists them.
 *
 * Private so the union below has exactly one declaration to be derived from: a scenario exists
 * because it appears here, and adding one extends {@link ScenarioId} instead of drifting away from an
 * independently written union.
 */
const SCENARIO_ID_LIST = [
  "baseline",
  "financial-source-unavailable",
  "media-unavailable",
  "coaching-module-unavailable",
  "continuation-on",
  "continuation-off",
  "partial-release-failure",
] as const;

/**
 * A scenario a session may run in. The union is closed on purpose: a scenario named in a request,
 * a seed or a browser spec that this release does not define is a compile error rather than a
 * runtime fallback to `baseline`, because silently running the wrong world is what makes a
 * demonstration prove nothing.
 */
export type ScenarioId = (typeof SCENARIO_ID_LIST)[number];

/** The registry's order, frozen so no caller can append a scenario no other session sees declared. */
export const SCENARIO_IDS: readonly ScenarioId[] = Object.freeze(SCENARIO_ID_LIST);

/** The scenario every session starts in: every source available, worker continuation off. */
export const DEFAULT_SCENARIO_ID: ScenarioId = "baseline";

/**
 * What a scenario makes available or unavailable.
 *
 * The three source flags name what a surface must render honestly — an unavailable financial source,
 * an unavailable media asset, an unavailable coaching module — and the continuation setting names the
 * one policy the referral journey depends on. Nothing else is a scenario: a flag for a capability
 * this release defers would be scaffolding for a feature that does not exist.
 */
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

/** Freezes one registry row, including its flags, so a reader of the registry cannot alter a scenario. */
function defineScenario(definition: ScenarioDefinition): ScenarioDefinition {
  return Object.freeze({ ...definition, flags: Object.freeze({ ...definition.flags }) });
}

/**
 * The one scenario table, keyed by every id {@link ScenarioId} admits.
 *
 * The `Record<ScenarioId, …>` type is the exhaustiveness check: a new scenario id without a row here
 * does not compile, so the panel, the seed and the specs cannot address a scenario that has no
 * definition. Each row states what it makes demonstrable, because a tester choosing a scenario in the
 * development panel is choosing the condition a surface has to render honestly.
 */
export const SCENARIO_DEFINITIONS: Readonly<Record<ScenarioId, ScenarioDefinition>> = Object.freeze(
  {
    baseline: defineScenario({
      label: "Baseline",
      description:
        "Every source available and worker continuation off — the state every criterion other than the feature-specific ones starts from.",
      flags: {
        financialSource: "available",
        mediaAsset: "available",
        coachingModule: "available",
        continuationSetting: "off",
      },
    }),
    "financial-source-unavailable": defineScenario({
      label: "Financial source unavailable",
      description:
        "Support reports its source as unavailable — never as zero and never as an empty list — while contact, work and content jobs continue normally.",
      flags: {
        financialSource: "unavailable",
        mediaAsset: "available",
        coachingModule: "available",
        continuationSetting: "off",
      },
    }),
    "media-unavailable": defineScenario({
      label: "Media unavailable",
      description:
        "A placement reports its asset unavailable, keeping its poster or text alternative and its retry action, so a failed preparation never hides the prose around it.",
      flags: {
        financialSource: "available",
        mediaAsset: "unavailable",
        coachingModule: "available",
        continuationSetting: "off",
      },
    }),
    "coaching-module-unavailable": defineScenario({
      label: "Coaching module unavailable",
      description:
        "One admitted coaching module's source is down: that module reports unavailable while the other admitted modules stay usable and are never blanked with it.",
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
      description:
        "The worker-continuation setting is on, so an ordinarily expired referral cycle offers the Continue action within its current permission.",
      flags: {
        financialSource: "available",
        mediaAsset: "available",
        coachingModule: "available",
        continuationSetting: "on",
      },
    }),
    "continuation-off": defineScenario({
      label: "Continuation off",
      description:
        "The worker-continuation setting is explicitly off, so an expired referral offers no Continue action; named so a spec depends on this scenario rather than on the baseline default.",
      flags: {
        financialSource: "available",
        mediaAsset: "available",
        coachingModule: "available",
        continuationSetting: "off",
      },
    }),
    "partial-release-failure": defineScenario({
      label: "Partial release failure",
      description:
        "One variant of a submission releases while a sibling fails, preserving the sibling's prior-good release head instead of rolling the successful one back.",
      flags: {
        financialSource: "available",
        mediaAsset: "available",
        coachingModule: "available",
        continuationSetting: "off",
      },
    }),
  },
);

/**
 * Whether a value names a scenario this release defines.
 *
 * Membership is read from {@link SCENARIO_DEFINITIONS}' own keys, so the runtime set and the declared
 * type stay one declaration rather than a second list that could be edited on its own.
 */
export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && Object.hasOwn(SCENARIO_DEFINITIONS, value);
}

/**
 * The flags a scenario sets.
 *
 * The returned object is the registry's frozen row, not a copy: it is the same object for every
 * caller, and reading it is the only way a surface may learn that a source is unavailable.
 */
export function scenarioFlagsFor(scenarioId: ScenarioId): ScenarioFlags {
  if (!isScenarioId(scenarioId)) {
    throw new RangeError(
      `Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`,
    );
  }
  return SCENARIO_DEFINITIONS[scenarioId].flags;
}

// ---------------------------------------------------------------------------------------------
// Session state, context and the meta document
// ---------------------------------------------------------------------------------------------

/**
 * The admission states a session can be in, in the order the shell presents them, and the membership
 * a principal is admitted under — re-exported from the read envelope that owns the persisted record.
 *
 * `@/modules/data-service/envelope` is the one declaration of that vocabulary, because it owns the
 * session context record a state and a membership are stored in. This module re-exports both rather
 * than keeping a second copy, so the state a scenario lays down and the state a stored context carries
 * cannot drift apart, and every caller of this module keeps the names it already imports.
 */
export { SESSION_STATES };
export type { AdmittedMembership, SessionState };

/** Whether a value names an admission state this release defines. */
export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && (SESSION_STATES as readonly string[]).includes(value);
}

/**
 * The context an action runs inside: the organization, the ministry and the support subject whose
 * records are being read or changed.
 *
 * These are three separate references on purpose. A ministry is not an organization, and a support
 * subject is neither: equal-looking ids establish neither identity nor authority.
 */
export interface SelectedContext {
  organizationId: string;
  ministryId: string;
  supportSubjectId: string;
}

/** The document version this module writes; a stored document of any other version is unreadable. */
const SESSION_META_VERSION = 1;

/**
 * Everything the development runtime persists beside a session's records.
 *
 * One document holds the scenario, the clock offset, the armed failure plan, the admission state, the
 * selected context and the session's capability set, so a session restored from disk is restored
 * whole. `selectedContext` is nullable because it is chosen after admission succeeds, and it stays
 * `null` for a session that never got that far.
 *
 * `capabilities` is the session's own statement of what the person acting in it may do beyond
 * admission — a capability a domain module names, such as the support goal's `canEditGoal`, held by
 * one principal and not by another inside the same ministry. It lives with the session because
 * nothing about a record establishes it, and it is deliberately empty for a document written before
 * the field existed, so an unstated capability denies rather than grants.
 */
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
}

/** Why a stored meta document, or a control request, was refused. */
export const SESSION_REFUSAL_CODES = [
  "unknown-scenario",
  "unknown-session",
  "invalid-offset",
  "out-of-range-offset",
  "meta-unreadable",
] as const;

/** The machine-readable reason a meta document or a control request was refused. */
export type SessionRefusalCode = (typeof SESSION_REFUSAL_CODES)[number];

/**
 * A refusal, as a value.
 *
 * Reading a stored document and moving a development control are both answered rather than thrown at,
 * so the panel renders the reason the way it renders any other result and a browser request never
 * turns a stored or requested value into a failed request. `message` is for a person reading the
 * panel; `code` is what a caller branches on.
 */
export interface SessionMetaRefusal {
  readonly code: SessionRefusalCode;
  readonly message: string;
}

/**
 * The refusal a development control returns.
 *
 * It is the same vocabulary as {@link SessionMetaRefusal} because a control reads the stored document
 * before it writes it: a session whose document is unreadable refuses the control for the same reason
 * and with the same code the read reports.
 */
export type SessionControlRefusal = SessionMetaRefusal;

/** Builds a refusal; internal because every code is produced in one place, by this module. */
function refuse(code: SessionRefusalCode, message: string): SessionMetaRefusal {
  return { code, message };
}

/**
 * The farthest the scenario clock may travel from `SEED_INSTANT`, in either direction.
 *
 * Ten calendar years from the seed instant, derived rather than guessed, so "well past any boundary"
 * is a stated span instead of an arbitrary number. A larger offset is refused because a mistyped
 * millisecond count would otherwise move a session so far that every window reads expired and no
 * demonstrable boundary remains.
 */
export const CLOCK_OFFSET_LIMIT_MS: number =
  SEED_INSTANT.toZonedDateTimeISO("UTC").add({ years: 10 }).epochMilliseconds -
  SEED_INSTANT.epochMilliseconds;

// ---------------------------------------------------------------------------------------------
// Stored-value validation
// ---------------------------------------------------------------------------------------------

/**
 * Whether a value is a string carrying at least one non-whitespace character.
 *
 * Trimmed on purpose, unlike `@/lib/guards`'s length-based `isNonEmptyString`: a stored reference of
 * spaces names no organization, ministry or subject, so it is refused rather than admitted as a
 * present field.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Describes a refused value for a message without echoing it back whole.
 *
 * A stored field or a request body can be long, and a message that copies it into a log line would
 * carry whatever it holds; a summary is enough for a person to recognise what they sent.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length <= 40
      ? JSON.stringify(value)
      : `a ${String(value.length)}-character string`;
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

/** The refusal a value earns for not being a whole number of milliseconds at all. */
function invalidOffsetRefusal(value: unknown): SessionMetaRefusal {
  return refuse(
    "invalid-offset",
    `A clock offset is a whole number of milliseconds from the seed instant, in either direction; ${describeValue(value)} is not one that can be represented exactly.`,
  );
}

/** The refusal a whole offset earns for standing farther from the seed instant than the limit. */
function outOfRangeOffsetRefusal(value: number): SessionMetaRefusal {
  return refuse(
    "out-of-range-offset",
    `A clock offset stays within ${String(CLOCK_OFFSET_LIMIT_MS)} milliseconds (ten years) of the seed instant; ${describeValue(value)} is farther than that.`,
  );
}

/**
 * Whether a value is a whole number of milliseconds, the only form an offset may take.
 *
 * A fractional or non-finite value is refused rather than rounded, because rounding would move a
 * boundary by an amount nobody asked for.
 */
function isWholeMillisecond(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Whether a whole offset stands inside {@link CLOCK_OFFSET_LIMIT_MS}, in either direction. */
function isWithinOffsetLimit(value: number): boolean {
  return value >= -CLOCK_OFFSET_LIMIT_MS && value <= CLOCK_OFFSET_LIMIT_MS;
}

/**
 * The refusal an offset earns, or `undefined` when it is usable.
 *
 * One check serves the absolute control and the relative one, so both agree on what an offset is: a
 * whole number of milliseconds from the seed instant, inside {@link CLOCK_OFFSET_LIMIT_MS}.
 */
function offsetRefusalFor(value: unknown): SessionMetaRefusal | undefined {
  if (!isWholeMillisecond(value)) {
    return invalidOffsetRefusal(value);
  }
  return isWithinOffsetLimit(value) ? undefined : outOfRangeOffsetRefusal(value);
}

/**
 * Reads admitted memberships, or `undefined` when the value is not a list of distinct non-empty
 * organization, ministry and support-subject references.
 *
 * Each entry is minted through the read envelope's own schema, so a stored membership is the branded
 * shape a session context record carries: the runtime half and the record half are one type rather
 * than two that merely resemble each other. A repeat is refused rather than collapsed: the document
 * says the principal was admitted to the same authority twice, which no seed produces, and quietly
 * deduplicating it would hide a hand-edited file that a person needs to see.
 */
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
    if (
      !isNonEmptyString(organizationId) ||
      !isNonEmptyString(ministryId) ||
      !isNonEmptyString(supportSubjectId)
    ) {
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
      if (
        existing.organizationId === admission.data.organizationId &&
        existing.ministryId === admission.data.ministryId &&
        existing.supportSubjectId === admission.data.supportSubjectId
      ) {
        return undefined;
      }
    }
    memberships.push(admission.data);
  }
  return memberships;
}

/**
 * Reads a session's capability set, or `undefined` when the value is not a list of distinct names.
 *
 * A capability is an opaque name a domain module owns (`canEditGoal` is `modules/support/goal.ts`'s),
 * so this module validates the shape of the list and never the meaning of a member: naming one here
 * that no module owns would grant nothing, because every capability question is asked by its owner.
 * A repeat is refused rather than collapsed, on the same reasoning as a repeated admission, and an
 * absent field is the empty list — a document written before the field existed states no capability,
 * which denies rather than grants.
 */
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

/**
 * Reads the selected context: `null` for a session that has not chosen one, the context itself when
 * all three references are present, and `undefined` when the value is neither.
 */
function parseSelectedContext(value: unknown): SelectedContext | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const { organizationId, ministryId, supportSubjectId } = value;
  if (
    !isNonEmptyString(organizationId) ||
    !isNonEmptyString(ministryId) ||
    !isNonEmptyString(supportSubjectId)
  ) {
    return undefined;
  }
  return { organizationId, ministryId, supportSubjectId };
}

// ---------------------------------------------------------------------------------------------
// Building and reading the document
// ---------------------------------------------------------------------------------------------

/**
 * What a caller knows when it lays a session down.
 *
 * The principal, the admitted memberships and the admission state are required, because this module
 * never invents a principal and never generates an id: a session that names nobody is not a session,
 * and a fabricated identity would make an isolation test prove nothing. The rest default to the
 * state every session starts in — the baseline scenario, the seed instant, the disarmed failure
 * plan, no selected context and no capability — so a seed row states only what it is actually
 * varying.
 */
export interface SessionMetaSeedInput {
  principalId: string;
  admittedMemberships: readonly AdmittedMembership[];
  sessionState: SessionState;
  scenarioId?: ScenarioId;
  clockOffsetMs?: number;
  failurePlan?: FailurePlanDocument;
  selectedContext?: SelectedContext | null;
  capabilities?: readonly string[];
}

/**
 * Builds the document a freshly seeded session carries.
 *
 * Every value is checked against the same vocabulary {@link parseSessionMeta} uses, and a value this
 * release does not define throws: the caller is seed or reset code holding typed arguments, so a
 * refusal here is a defect in that code rather than something a person can act on. Stored documents
 * are the case that answers with a refusal instead of throwing, because those can be hand-edited.
 */
export function buildSessionMeta(input: SessionMetaSeedInput): SessionMetaDocument {
  const { principalId, admittedMemberships, sessionState } = input;

  if (!isNonEmptyString(principalId)) {
    throw new TypeError(
      "A session meta document needs the principal it acts for: buildSessionMeta never invents one.",
    );
  }

  const memberships = parseAdmittedMemberships(admittedMemberships);
  if (memberships === undefined) {
    throw new TypeError(
      "A session meta document's admitted memberships are zero or more distinct triples of non-empty organization, ministry and support-subject ids.",
    );
  }

  if (!isSessionState(sessionState)) {
    throw new TypeError(
      `Unknown session state ${describeValue(sessionState)}: this release defines ${SESSION_STATES.join(", ")}.`,
    );
  }

  const scenarioId = input.scenarioId ?? DEFAULT_SCENARIO_ID;
  if (!isScenarioId(scenarioId)) {
    throw new RangeError(
      `Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`,
    );
  }

  const clockOffsetMs = input.clockOffsetMs ?? 0;
  const offsetRefusal = offsetRefusalFor(clockOffsetMs);
  if (offsetRefusal !== undefined) {
    throw new RangeError(offsetRefusal.message);
  }

  const failurePlan = parseFailurePlan(input.failurePlan ?? EMPTY_FAILURE_PLAN);
  if (!failurePlan.ok) {
    throw new TypeError(
      `A session meta document carries a usable failure plan: ${failurePlan.error.message}`,
    );
  }

  const selectedContext = parseSelectedContext(input.selectedContext ?? null);
  if (selectedContext === undefined) {
    throw new TypeError(
      "A session meta document's selected context is null or a non-empty organization, ministry and support subject reference.",
    );
  }

  const capabilities = parseCapabilities(input.capabilities ?? []);
  if (capabilities === undefined) {
    throw new TypeError(
      "A session meta document's capability set is zero or more distinct non-empty capability names.",
    );
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
  };
}

/**
 * Reads a document back from its stored form, refusing rather than throwing on anything unusable.
 *
 * A session's `.meta.json` can be hand-edited, truncated by an interrupted write or written by an
 * earlier build, and a request path must survive all three. Every field is therefore checked against
 * this module's own vocabulary, and an unknown scenario id is refused as `unknown-scenario` instead
 * of being coerced to `baseline`: a session quietly running the wrong world would make every
 * demonstration of an unavailable source, a continuation policy or a partial release prove nothing.
 * Fields this version does not know are ignored, and the value returned carries only the fields
 * declared below.
 */
export function parseSessionMeta(value: unknown): Result<SessionMetaDocument, SessionMetaRefusal> {
  if (!isRecord(value)) {
    return err(
      refuse(
        "meta-unreadable",
        "A session meta document is an object carrying a version, a scenario, a clock offset, a failure plan, an admission state, a principal and its admitted memberships.",
      ),
    );
  }

  const { version } = value;
  if (version !== SESSION_META_VERSION) {
    return err(
      refuse(
        "meta-unreadable",
        `A session meta document is version ${String(SESSION_META_VERSION)}; the stored document states ${describeValue(version)}.`,
      ),
    );
  }

  const { scenarioId } = value;
  if (!isScenarioId(scenarioId)) {
    return err(
      refuse(
        "unknown-scenario",
        `The stored session names ${describeValue(scenarioId)}, which is not one of ${SCENARIO_IDS.join(", ")}.`,
      ),
    );
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
    return err(
      refuse(
        "meta-unreadable",
        `The stored session's failure plan is unusable: ${failurePlan.error.message}`,
      ),
    );
  }

  const { sessionState } = value;
  if (!isSessionState(sessionState)) {
    return err(
      refuse(
        "meta-unreadable",
        `The stored session's admission state is ${describeValue(sessionState)}, which is not one of ${SESSION_STATES.join(", ")}.`,
      ),
    );
  }

  const { principalId } = value;
  if (!isNonEmptyString(principalId)) {
    return err(
      refuse(
        "meta-unreadable",
        "A session meta document names the principal it acts for, and never an empty or invented one.",
      ),
    );
  }

  const admittedMemberships = parseAdmittedMemberships(value.admittedMemberships);
  if (admittedMemberships === undefined) {
    return err(
      refuse(
        "meta-unreadable",
        "The stored session's admitted memberships are zero or more distinct triples of non-empty organization, ministry and support-subject ids.",
      ),
    );
  }

  // The key has to be present even when its value is null: an absent context is a truncation, while a
  // stored null is the ordinary state of a session that has not chosen one yet.
  if (!Object.hasOwn(value, "selectedContext")) {
    return err(
      refuse(
        "meta-unreadable",
        "A session meta document carries its selected context, as null when no context has been chosen.",
      ),
    );
  }
  const selectedContext = parseSelectedContext(value.selectedContext);
  if (selectedContext === undefined) {
    return err(
      refuse(
        "meta-unreadable",
        "The stored session's selected context is null or a non-empty organization, ministry and support subject reference.",
      ),
    );
  }

  // An absent capability set is a document written before the field existed, and it resolves to no
  // capability rather than to a refusal: every capability question fails closed, so reading such a
  // document as read-only is the honest answer, while refusing it would report an unreadable session
  // for a file that is merely older. A present value that is not a list of distinct names is refused
  // like every other unusable field, because it states something this build cannot honour.
  const capabilities = parseCapabilities(value.capabilities ?? []);
  if (capabilities === undefined) {
    return err(
      refuse(
        "meta-unreadable",
        "The stored session's capability set is zero or more distinct non-empty capability names.",
      ),
    );
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
  });
}

// ---------------------------------------------------------------------------------------------
// The development controls
// ---------------------------------------------------------------------------------------------

/** One change applied to a session's stored document, or the refusal that stops it. */
type MetaUpdate = (meta: SessionMetaDocument) => Result<SessionMetaDocument, SessionControlRefusal>;

/**
 * Runs one control against a session's document and returns the document as it now stands.
 *
 * Every control shares this path, so the three of them cannot disagree about which sessions exist,
 * which documents are readable, or where a write lands: the id is checked with the store's own safety
 * rule before any file is named, the transaction takes the session's lock, and only a document whose
 * bytes changed is written. A missing session is a refusal rather than a creation — `reset` owns
 * laying sessions down — and a document that cannot be read as one is refused as `meta-unreadable`
 * rather than replaced by a default, because replacing it would silently discard an armed failure
 * plan or a selected context.
 */
async function updateSessionMeta(
  sessionId: string,
  update: MetaUpdate,
): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isSafeSessionId(sessionId)) {
    return err(
      refuse(
        "unknown-session",
        `${describeValue(sessionId)} cannot name a session: a session id is 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`,
      ),
    );
  }

  try {
    return await transact<Result<SessionMetaDocument, SessionControlRefusal>>(
      sessionId,
      (draft) => {
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
      },
    );
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return err(
        refuse(
          "unknown-session",
          `No session ${JSON.stringify(sessionId)} exists in the store, and a development control never creates one: reset seeds every session.`,
        ),
      );
    }
    // A read or write fault that is neither an absent session nor an unreadable document is a store
    // fault, and it stays a thrown error so the one error model can report it as unavailable.
    throw error;
  }
}

/**
 * Selects the scenario a session runs in.
 *
 * The clock offset, the failure plan, the admission state, the principal, the memberships and the
 * selected context are kept exactly as they were: a scenario changes what the world makes available,
 * not who is looking at it, what is armed or what time it is. The session's stored offset is then
 * re-applied, so the process clock agrees with the session that just became active.
 */
export async function setScenario(
  sessionId: string,
  scenarioId: ScenarioId,
): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (!isScenarioId(scenarioId)) {
    return err(
      refuse(
        "unknown-scenario",
        `Unknown scenario ${describeValue(scenarioId)}: this release defines ${SCENARIO_IDS.join(", ")}.`,
      ),
    );
  }

  const updated = await updateSessionMeta(sessionId, (meta) => ok({ ...meta, scenarioId }));
  if (!updated.ok) {
    return updated;
  }

  applySessionClock(updated.value);
  return updated;
}

/**
 * Sets how far a session's scenario clock stands from the seed instant, in milliseconds.
 *
 * A fractional, non-finite or out-of-range offset is refused before anything is written, so a stored
 * document never holds a value the boundary functions would have to guess at. Passing `0` restores
 * the seed instant. The document is persisted first and the process clock moved second, so a failed
 * write leaves the clock where it was.
 */
export async function setClock(
  sessionId: string,
  offsetMs: number,
): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  const refusal = offsetRefusalFor(offsetMs);
  if (refusal !== undefined) {
    return err(refusal);
  }

  const updated = await updateSessionMeta(sessionId, (meta) =>
    ok({ ...meta, clockOffsetMs: offsetMs }),
  );
  if (!updated.ok) {
    return updated;
  }

  setClockOffset(offsetMs);
  return updated;
}

/**
 * Moves a session's scenario clock forward by a stated number of milliseconds.
 *
 * Only forward motion exists: a negative advance is refused, so a spec cannot rewind time halfway
 * through a journey and land on an earlier instant than one it has already observed. `setClock` is
 * the control for an absolute offset. The resulting offset is checked against the same limit as a
 * set, and the process clock advances by exactly the amount the document gained.
 */
export async function advanceClock(
  sessionId: string,
  byMs: number,
): Promise<Result<SessionMetaDocument, SessionControlRefusal>> {
  if (typeof byMs !== "number" || !Number.isSafeInteger(byMs) || byMs <= 0) {
    return err(
      refuse(
        "invalid-offset",
        `A clock advance moves forward by a positive whole number of milliseconds; ${describeValue(byMs)} is not one. Use setClock for an absolute offset.`,
      ),
    );
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

/**
 * Re-applies a document's stored offset to the process clock, writing nothing.
 *
 * A session becomes active when the panel selects it or when a control changes it, and this is how
 * the process clock catches up with the document that just became active. The offset is checked
 * first, so a document built by hand cannot move the clock past its stated limit.
 */
export function applySessionClock(meta: SessionMetaDocument): void {
  const refusal = offsetRefusalFor(meta.clockOffsetMs);
  if (refusal !== undefined) {
    throw new RangeError(refusal.message);
  }
  setClockOffset(meta.clockOffsetMs);
}

/**
 * What a session's development document read found: the document, no session, or a store that could
 * not be read.
 *
 * `document` is the stored document parsed; `absent` is no such session, or a document this release
 * cannot read as one, which a destructive reset replaces with a usable one; `unavailable` is the
 * store itself failing to answer, which is never presented as an absent session and never answered by
 * offering a reset. The last two stay apart because the facts differ: an unreadable store says
 * nothing about whether the session exists, and AAP 0.1.1 "Continuity" with 0.15.2 "Honesty" requires
 * `empty` and `unavailable` to stay distinct.
 */
export type DevStateRead =
  | { readonly kind: "document"; readonly meta: SessionMetaDocument }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly message: string };

/**
 * Reads a session's development document and reports which of those three facts it found.
 *
 * Nothing here throws: a request path asks this to describe a session, so every outcome is a value.
 * A session the store does not hold, a document written by another version of this module and a body
 * that cannot be decoded are `absent` — a destructive reset lays down a usable document — while the
 * store failing to answer at all is `unavailable`, because an unreadable directory or an I/O fault
 * says nothing about whether the session exists. The message names no file path, no session id and no
 * stored value, so a fault cannot disclose what it could not read. A caller that must report why a
 * stored document was unusable uses {@link parseSessionMeta} itself.
 */
export async function readDevState(sessionId: string): Promise<DevStateRead> {
  if (!isSafeSessionId(sessionId)) {
    return { kind: "absent" };
  }

  try {
    const documents = await readSession(sessionId);
    if (documents === undefined) {
      return { kind: "absent" };
    }

    const parsed = parseSessionMeta(documents.meta);
    return parsed.ok ? { kind: "document", meta: parsed.value } : { kind: "absent" };
  } catch (error) {
    // Undecodable bytes, and the missing sibling document `readSession` reports the same way, are a
    // document this release cannot read as this session's own, which a reset replaces. Every other
    // fault is the store itself failing to answer, and presenting that as an absent session is what
    // would invite a destructive reset for a session that may be perfectly intact.
    if (error instanceof CorruptJsonError) {
      return { kind: "absent" };
    }
    return {
      kind: "unavailable",
      message:
        "The session store could not be read, so this session's scenario, clock and failure plan are unavailable rather than absent.",
    };
  }
}
