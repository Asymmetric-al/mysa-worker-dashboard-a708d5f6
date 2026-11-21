/**
 * The one deterministic failure plan: which single simulated failure is armed, against which named
 * call, at which scenario instant.
 *
 * Demonstrating an injected failure needs a plan that is narrow, visible and honest about what it
 * proves. This module declares that plan and nothing else: one mode — `denied`, `conflict` or
 * `unknown` — armed against exactly one named read or mutation, stamped with the scenario instant it
 * was armed at. Exactly one plan is active at a time (assumption A13), so a demonstration cannot
 * confuse which failure it is watching, and {@link setFailurePlan} refuses an arming request while a
 * plan is armed instead of quietly replacing it.
 *
 * This module holds no state of its own. The armed plan is persisted per session by
 * `dev-runtime/scenario.ts` in `<sessionId>.meta.json`, read back for the development panel, and
 * consulted by the data service at the boundary of the named read or mutation it targets. Every
 * export here is therefore plain JSON-serialisable data or a pure function of its arguments.
 * {@link parseFailurePlan} is what a request path uses to read a stored plan back, and it refuses
 * rather than throws, so a hand-edited session file cannot turn into a failed request.
 *
 * The three modes keep three different facts apart, and each answers with the outcome the shared
 * contract fixes. A scope denial discloses no count, title, existence flag or size. A changed
 * revision answers with `conflict`, preserving the caller's input beside the current value. A lost
 * acknowledgement answers with `unknown` carrying only the `operationId`: it is recoverable by
 * operation identity — the caller re-queries or replays that same id — and it is never presented as
 * success or as failure, and never as a reason to send again under a new identity.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Development runtime" (`setFailurePlan()`), 0.7.2 "Deterministic failure modes" and
 *   0.8.9 assumption A13 (one mode for one named mutation or read at a time, visible in the
 *   development panel).
 * - AAP 0.12.5 "Injected Failures and the Criteria That Depend on Them", which fixes the ten named
 *   targets registered below, and AAP 0.11.1 File Creation Plan row
 *   `modules/dev-runtime/{seed,generate,failures,scenario,reset}.ts`.
 *
 * Layering: a development-runtime module below the data service. It reaches no store, no data-service
 * value, no component, no feature and no application code: its imports are the closed outcome-name
 * vocabulary the envelope module declares — a type-only import, erased at build time, so the data
 * service may import this module at runtime without closing a cycle — the generic result helpers
 * `@/lib/result`, the shared narrowing guard `@/lib/guards`, and the pinned `temporal-polyfill` that
 * owns every date and offset decision here. It reads no clock, holds no randomness and does no I/O:
 * `armedAt` is an argument supplied by the scenario, and the current-time constructors of `Date`
 * never appear here.
 *
 * Rule 1 obligations this file keeps. It registers exactly the ten targets and the three modes the
 * specification names, so it arms nothing for a deferred capability and adds no fourth mode. It
 * offers one arming path and one consultation point, so no second failure mechanism sits beside it.
 * Each mode answers with the outcome the contract fixes, so a denial stays silent about what it
 * refused, a conflict holds the caller's input, and an `unknown` stays recoverable by identity.
 */
import { Temporal } from "temporal-polyfill";

import { isRecord } from "@/lib/guards";
import { err, ok, type Result } from "@/lib/result";
import type { OperationOutcomeName } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Modes and target kinds
// ---------------------------------------------------------------------------------------------

/**
 * The three failures a demonstration can arm, taken from the closed outcome set itself.
 *
 * The stored outcome names the envelope module declares are the substrate here, not the outcome
 * objects the outcome module builds: `Extract` narrows a string-literal union, while extracting from
 * an object union would keep whole outcome objects. Deriving the union this way means a renamed or
 * removed outcome in the closed set stops this module compiling instead of drifting away from it, and
 * it keeps the import type-only.
 */
export type FailureMode = Extract<OperationOutcomeName, "denied" | "conflict" | "unknown">;

/**
 * The two kinds of named call a plan can target.
 *
 * A read and a mutation are separated because their outcomes are not interchangeable: a read answers
 * with a denial, while a mutation answers with one of the eight outcomes. Consulting a plan therefore
 * states which kind is asking, and a target name alone never decides it.
 */
export type FailureTargetKind = "read" | "mutation";

/**
 * The ten targets this release demonstrates a failure on, in the order the specification lists them.
 *
 * Kept as the private table the public type is derived from, so the union of target names and the
 * rows they come from cannot diverge: adding a row extends the type, and a name typed here but absent
 * from the rows is a compile error. `modes` is the narrow set each target actually demonstrates — a
 * target is not a free slot for whichever mode a caller fancies, and {@link setFailurePlan} refuses a
 * pairing outside this table.
 */
const DEMONSTRABLE_TARGET_ROWS = [
  {
    kind: "read",
    name: "readPartner",
    modes: ["denied"],
    note: "A denial notice that states no count, title, existence flag or size, with the independent work on the Partner surface still usable.",
  },
  {
    kind: "read",
    name: "readCoachSubject",
    modes: ["denied"],
    note: "A denied coach read of a module that was never shared: nothing about the worker's record is enumerated or hinted at.",
  },
  {
    kind: "read",
    name: "readExport",
    modes: ["denied"],
    note: "An export refused for want of export permission, so no row that the screen withheld can leave through the file.",
  },
  {
    kind: "mutation",
    name: "saveContactEdits",
    modes: ["conflict"],
    note: "A conflict panel showing the current value beside the preserved input, with a deliberate re-apply and no silent overwrite.",
  },
  {
    kind: "mutation",
    name: "saveGoal",
    modes: ["conflict"],
    note: "A stale goal revision refused as a conflict: the amount the caller typed is kept for comparison against the current goal.",
  },
  {
    kind: "mutation",
    name: "saveDraft",
    modes: ["conflict"],
    note: "A draft save against an old revision answers with the conflict, and the readable local text survives it.",
  },
  {
    kind: "mutation",
    name: "logInteraction",
    modes: ["unknown"],
    note: "An uncertain-result panel whose only actions are to check the result and, where eligible, to retry this same work.",
  },
  {
    kind: "mutation",
    name: "acceptImportRows",
    modes: ["unknown"],
    note: "An acceptance whose acknowledgement was lost: the receipt is recoverable by operation identity, so no row is accepted twice.",
  },
  {
    kind: "mutation",
    name: "publishVariants",
    modes: ["unknown"],
    note: "A publication whose fate is not claimed either way, recovered by re-querying the same operation rather than publishing again.",
  },
  {
    kind: "mutation",
    name: "requestNotification",
    modes: ["unknown"],
    note: "A notification intent that may have been submitted: exactly one message per recipient and intent, and no resend under a fresh key.",
  },
] as const;

/**
 * The name of a call a failure can be armed against.
 *
 * Derived from the registry's own rows rather than written out again, so the type is the table: a
 * name that is not in the rows does not type, and a row that is removed stops the name existing.
 */
export type DemonstrableTargetName = (typeof DEMONSTRABLE_TARGET_ROWS)[number]["name"];

/**
 * One call a demonstration can inject a failure into.
 *
 * `note` is the development panel's copy for what the person will actually see, so the panel states
 * the effect of arming a target instead of only naming it.
 */
export interface DemonstrableTarget {
  readonly kind: FailureTargetKind;
  readonly name: DemonstrableTargetName;
  readonly modes: readonly FailureMode[];
  readonly note: string;
}

/**
 * The development panel's label for each mode: the specification's own names for the three
 * demonstrations, kept in one table so the panel, a refusal message and a description agree.
 */
export const MODE_LABEL: Readonly<Record<FailureMode, string>> = Object.freeze({
  denied: "Scope denial",
  conflict: "Changed revision",
  unknown: "Lost acknowledgement",
});

/**
 * The outcome each mode produces, as the closed set's own member name.
 *
 * A mode is named for the outcome it injects, so the two agree member for member; declaring the
 * mapping anyway is what makes a divergence a compile error rather than a silent mismatch between
 * the mode a panel armed and the outcome a caller has to handle.
 */
export const MODE_OUTCOME: Readonly<Record<FailureMode, OperationOutcomeName>> = Object.freeze({
  denied: "denied",
  conflict: "conflict",
  unknown: "unknown",
});

/**
 * The closed registry of demonstrable targets, frozen at runtime as well as in type.
 *
 * Frozen because it is shared by every session in the process: one caller appending to it would arm
 * a failure no other session could see declared. Order is the specification's, so the panel lists
 * the reads and then the mutations in a stable sequence.
 */
export const DEMONSTRABLE_TARGETS: readonly DemonstrableTarget[] =
  Object.freeze(DEMONSTRABLE_TARGET_ROWS);

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

/**
 * The target a plan names: one kind of call and one registry name.
 *
 * Both halves are needed, because the same name could otherwise be read as either a read or a
 * mutation by a consumer guessing from context, and a failure armed for the wrong kind would simply
 * never fire.
 */
export interface FailureTarget {
  readonly kind: FailureTargetKind;
  readonly name: DemonstrableTargetName;
}

/**
 * One armed failure: its mode, the single call it targets, and the scenario instant it was armed at.
 *
 * `armedAt` is a stored instant string rather than a `Temporal` value, because the plan is written to
 * the session's `.meta.json` and read back on every request; the instant is supplied by the
 * development runtime, which is the only owner of the clock.
 */
export interface FailurePlan {
  readonly mode: FailureMode;
  readonly target: FailureTarget;
  readonly armedAt: string;
}

/**
 * The disarmed failure plan.
 *
 * The disarmed state is the absence of a value, not a plan whose mode happens to be empty, and this is
 * the one place it is written: every comparison against it, and the document type below, read the
 * absent plan from here. Its inferred `null` type is what lets a comparison against it narrow a plan
 * to the armed case, which a comparison against a wider declared type would not.
 */
export const EMPTY_FAILURE_PLAN = null;

/**
 * The stored failure plan, disarmed or armed.
 *
 * Derived from {@link EMPTY_FAILURE_PLAN} so the two cannot disagree about what "disarmed" is.
 */
export type FailurePlanDocument = FailurePlan | typeof EMPTY_FAILURE_PLAN;

/** Why an arming request, or a stored plan, was refused. */
export const FAILURE_PLAN_REFUSAL_CODES = [
  "unknown-target",
  "mode-not-demonstrable-on-target",
  "malformed-plan",
  "already-armed",
] as const;

/** The machine-readable reason a failure plan was refused. */
export type FailurePlanRefusalCode = (typeof FAILURE_PLAN_REFUSAL_CODES)[number];

/**
 * A refusal, as a value.
 *
 * Arming is answered rather than thrown at, so the development panel renders the reason the way it
 * renders any other result and a browser request never turns a caller mistake into a failed request.
 * `message` is for a person reading the panel; `code` is what a caller branches on.
 */
export interface FailurePlanRefusal {
  readonly code: FailurePlanRefusalCode;
  readonly message: string;
}

/** Builds a refusal; internal because every code is produced in one place, by this module. */
function refuse(code: FailurePlanRefusalCode, message: string): FailurePlanRefusal {
  return { code, message };
}

// ---------------------------------------------------------------------------------------------
// Stored-value validation
// ---------------------------------------------------------------------------------------------

/**
 * A stored instant: an ISO-8601 date-time that states its offset, which is the form the envelope
 * module stores `armedAt` in.
 *
 * The shape is checked here rather than by a schema library, because this module carries no schema
 * library in its imports: the check is this pattern, then `Temporal`. The pattern states only the
 * stored form — four-digit year, two-digit month, day and time fields, `Z` or a `±HH:MM` offset, an
 * optional fractional second — and leaves the calendar and the offset to `Temporal`, which refuses
 * a date that does not exist such as `2026-02-30`, an hour of `24`, a minute of `60` and an offset
 * of `+24:00`; no month length, leap-year rule or field range therefore lives here. The one range
 * the pattern does state is the second field: `Temporal.Instant.from` accepts a `:60` leap second by
 * clamping it to `:59`, which would store an instant a second away from the one written, so the
 * pattern refuses that field itself.
 */
const STORED_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Narrows an unknown value to a stored instant string, without throwing on anything.
 *
 * `Temporal.Instant.from` throws on a value that names no instant, and a stored plan is a value a
 * person can hand-edit, so the refusal is answered here rather than escaping to a request path.
 */
function isStoredInstant(value: unknown): value is string {
  if (typeof value !== "string" || !STORED_INSTANT_PATTERN.test(value)) {
    return false;
  }
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a value names one of the three modes.
 *
 * Membership is read from {@link MODE_OUTCOME}'s own keys, so the runtime set and the type stay one
 * declaration rather than a second list that could be edited on its own.
 */
function isFailureMode(value: unknown): value is FailureMode {
  return typeof value === "string" && Object.hasOwn(MODE_OUTCOME, value);
}

/** Whether a value names one of the two kinds of call a plan can target. */
function isFailureTargetKind(value: unknown): value is FailureTargetKind {
  return value === "read" || value === "mutation";
}

/**
 * The registry row for a claimed kind and name, or `undefined` when the pair names no demonstrable
 * target.
 *
 * One lookup serves arming, parsing and describing, so all three agree on which calls exist and on the
 * modes each demonstrates.
 */
function demonstrableTargetFor(
  kind: FailureTargetKind,
  name: string,
): DemonstrableTarget | undefined {
  return DEMONSTRABLE_TARGETS.find((target) => target.kind === kind && target.name === name);
}

/** States the modes a target demonstrates, for a refusal message a person can act on. */
function modesWording(target: DemonstrableTarget): string {
  return target.modes.map((mode) => MODE_LABEL[mode]).join(" or ");
}

// ---------------------------------------------------------------------------------------------
// Arming, disarming and consulting
// ---------------------------------------------------------------------------------------------

/**
 * A target as a caller claims it, before the registry has confirmed the pair exists.
 *
 * `name` is a plain string here on purpose: an arming request arrives from the development panel, so
 * the pair has to be checked against the registry rather than trusted by its type. A caller already
 * holding a {@link FailureTarget} passes it unchanged.
 */
export interface ClaimedFailureTarget {
  readonly kind: FailureTargetKind;
  readonly name: string;
}

/**
 * What a caller asks to arm: one mode, the target it names, and the scenario instant of the request.
 *
 * `armedAt` is an argument and not a reading of the clock, because this module owns no clock; the
 * development runtime stamps the request with the session's scenario instant.
 */
export interface FailurePlanRequest {
  readonly mode: FailureMode;
  readonly target: ClaimedFailureTarget;
  readonly armedAt: string;
}

/**
 * Arms one mode on one named call and returns the new plan; stores nothing, and answers every refusal
 * as a value.
 *
 * The request's own validity is settled before the armed state, so a caller repairing a malformed
 * request is told what is wrong with the request rather than only that the slot is taken. The refusals
 * are, in the order they are answered: `unknown-target` when the claimed pair names no demonstrable
 * target, `mode-not-demonstrable-on-target` when the mode is outside that target's set,
 * `malformed-plan` when `armedAt` is not a storable instant, and `already-armed` when a plan is
 * already active — the last refusal is what keeps exactly one failure armed at a time (A13).
 */
export function setFailurePlan(
  current: FailurePlanDocument,
  request: FailurePlanRequest,
): Result<FailurePlan, FailurePlanRefusal> {
  const target = demonstrableTargetFor(request.target.kind, request.target.name);
  if (target === undefined) {
    return err(
      refuse(
        "unknown-target",
        `No ${request.target.kind} named ${request.target.name} demonstrates a failure in this release.`,
      ),
    );
  }
  if (!target.modes.includes(request.mode)) {
    return err(
      refuse(
        "mode-not-demonstrable-on-target",
        `${target.name} demonstrates ${modesWording(target)}, not ${MODE_LABEL[request.mode]}.`,
      ),
    );
  }
  if (!isStoredInstant(request.armedAt)) {
    return err(
      refuse(
        "malformed-plan",
        "An armed failure is stamped with the scenario instant it was armed at, written as an ISO-8601 date-time that states its offset.",
      ),
    );
  }
  if (current !== EMPTY_FAILURE_PLAN) {
    return err(
      refuse(
        "already-armed",
        `${MODE_LABEL[current.mode]} is already armed for ${current.target.name}. Disarm it first, because exactly one failure is active at a time.`,
      ),
    );
  }
  return ok({
    mode: request.mode,
    target: { kind: target.kind, name: target.name },
    armedAt: request.armedAt,
  });
}

/**
 * Disarms whatever is armed, returning the absent plan.
 *
 * The armed plan is the development runtime's to persist, so disarming is a value this module hands
 * back rather than a write: the caller stores it where the plan came from.
 */
export function disarmFailurePlan(): FailurePlanDocument {
  return EMPTY_FAILURE_PLAN;
}

/**
 * The single consultation point: the mode armed for this kind and name, or `undefined` when nothing
 * applies.
 *
 * A caller at the boundary of a named read or mutation asks this one question and nothing else. No
 * other export answers "is a failure armed for this call", so a second path that silently fires — or
 * silently does not — cannot appear beside this one.
 */
export function failureFor(
  plan: FailurePlanDocument,
  kind: FailureTargetKind,
  name: string,
): FailureMode | undefined {
  if (plan === EMPTY_FAILURE_PLAN || plan.target.kind !== kind || plan.target.name !== name) {
    return undefined;
  }
  return plan.mode;
}

// ---------------------------------------------------------------------------------------------
// Description for the development panel
// ---------------------------------------------------------------------------------------------

/**
 * What the development panel renders for the current plan, armed or not.
 *
 * Plain data, with every field present in both states, so the panel has one shape to render and no
 * branch in which a field is missing. `effect` states what the person will see, `recoveryLesson`
 * states what arming it is meant to prove, and `targetNote` carries the registry's copy for the
 * targeted call so the panel explains the specific demonstration rather than only the mode.
 */
export interface FailurePlanDescription {
  readonly armed: boolean;
  readonly mode: FailureMode | null;
  readonly modeLabel: string;
  readonly target: FailureTarget | null;
  readonly targetNote: string | null;
  readonly armedAt: string | null;
  readonly effect: string;
  readonly recoveryLesson: string;
}

/** What each mode shows the person using the feature it fires in. */
const MODE_EFFECT: Readonly<Record<FailureMode, string>> = Object.freeze({
  denied:
    "The call answers with a denial that carries no count, title, existence flag or size, so the surface cannot hint that the refused record exists.",
  conflict:
    "The mutation answers with a conflict that shows the current value beside the input that was sent, which is preserved for comparison.",
  unknown:
    "The mutation answers with unknown, carrying only the operation id: no success and no failure is claimed.",
});

/** What each mode's demonstration is meant to prove about the feature's recovery. */
const MODE_RECOVERY_LESSON: Readonly<Record<FailureMode, string>> = Object.freeze({
  denied:
    "Authorisation happens before enumeration: a refused read discloses nothing about what it refused, and independent work on that surface stays usable.",
  conflict:
    "A stale expected revision is detected rather than silently overwritten, and the change is applied only when the caller re-applies it deliberately.",
  unknown:
    "Recovery is re-querying the same operation id, which returns the stored result: exactly one effect exists, and uncertainty never becomes a resend.",
});

/** The description of the disarmed plan, so the panel renders the same shape when nothing is armed. */
const DISARMED_DESCRIPTION: FailurePlanDescription = Object.freeze({
  armed: false,
  mode: null,
  modeLabel: "No failure armed",
  target: null,
  targetNote: null,
  armedAt: null,
  effect:
    "Every read and every mutation answers from the application's own behaviour; no simulated failure is injected.",
  recoveryLesson:
    "Nothing to recover: with no failure armed there is no injected outcome to reconcile.",
});

/**
 * Describes the plan for the development panel, including the disarmed case.
 *
 * An armed plan is described by a copy, so a panel cannot reach through the description and change
 * what the session has armed; the disarmed case answers with the one frozen description above.
 */
export function describeFailurePlan(plan: FailurePlanDocument): FailurePlanDescription {
  if (plan === EMPTY_FAILURE_PLAN) {
    return DISARMED_DESCRIPTION;
  }
  const target = demonstrableTargetFor(plan.target.kind, plan.target.name);
  return {
    armed: true,
    mode: plan.mode,
    modeLabel: MODE_LABEL[plan.mode],
    target: { kind: plan.target.kind, name: plan.target.name },
    targetNote: target?.note ?? null,
    armedAt: plan.armedAt,
    effect: MODE_EFFECT[plan.mode],
    recoveryLesson: MODE_RECOVERY_LESSON[plan.mode],
  };
}

// ---------------------------------------------------------------------------------------------
// Reading a stored plan
// ---------------------------------------------------------------------------------------------

/**
 * Reads a plan back from its stored form, refusing rather than throwing on anything unusable.
 *
 * A session's `.meta.json` can be hand-edited, truncated by an interrupted write or written by an
 * earlier build, and a request path must survive all three. Everything is therefore checked against
 * this module's own vocabulary: the mode must be one of the three, the target pair must name a
 * registry row, the mode must be one that row demonstrates, and `armedAt` must be a storable instant.
 * The absent plan (`null`) is valid and stays absent; any other unusable value is `malformed-plan`,
 * which a caller presents instead of arming a failure nobody asked for.
 */
export function parseFailurePlan(value: unknown): Result<FailurePlanDocument, FailurePlanRefusal> {
  if (value === EMPTY_FAILURE_PLAN) {
    return ok(EMPTY_FAILURE_PLAN);
  }
  if (!isRecord(value)) {
    return err(
      refuse(
        "malformed-plan",
        "A stored failure plan is either the absent plan or an object carrying a mode, a target and an armed-at instant.",
      ),
    );
  }
  const { mode, target, armedAt } = value;
  if (!isFailureMode(mode)) {
    return err(
      refuse("malformed-plan", "A stored failure plan names one of the three failure modes."),
    );
  }
  if (!isRecord(target)) {
    return err(
      refuse(
        "malformed-plan",
        "A stored failure plan carries a target object naming its kind and its name.",
      ),
    );
  }
  const { kind, name } = target;
  if (!isFailureTargetKind(kind) || typeof name !== "string") {
    return err(
      refuse(
        "malformed-plan",
        'A stored failure target names its kind as "read" or "mutation", together with a target name.',
      ),
    );
  }
  const demonstrable = demonstrableTargetFor(kind, name);
  if (demonstrable === undefined) {
    return err(
      refuse(
        "malformed-plan",
        "A stored failure target names no call this release demonstrates a failure on.",
      ),
    );
  }
  if (!demonstrable.modes.includes(mode)) {
    return err(
      refuse(
        "malformed-plan",
        `${demonstrable.name} demonstrates ${modesWording(demonstrable)}, which is not the mode the stored plan names.`,
      ),
    );
  }
  if (!isStoredInstant(armedAt)) {
    return err(
      refuse(
        "malformed-plan",
        "A stored failure plan carries the scenario instant it was armed at, written as an ISO-8601 date-time that states its offset.",
      ),
    );
  }
  return ok({
    mode,
    target: { kind: demonstrable.kind, name: demonstrable.name },
    armedAt,
  });
}
