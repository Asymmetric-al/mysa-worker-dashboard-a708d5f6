/**
 * `saveGoal` — the one permitted financial write in this application, and the only change a support
 * subject's projection accepts.
 *
 * A goal is a target the worker sets, not a financial record. Saving one never posts, corrects,
 * refunds or retries money, never touches a gift, an allocation or a commitment, never rewrites an
 * earlier report, never publishes public progress and never grants finance, publishing or coaching
 * permission (AAP 0.1.1, 0.8.1). It writes one fact: the amount, currency, measure and start day of
 * the goal the subject has set.
 *
 * The shape every mutation in this folder keeps (AAP 0.7.1):
 *
 * - the request is the four-field envelope `{ operationId, scope, expectedRevision, payload }`, and
 *   the answer is exactly one member of the closed outcome set — never a boolean, never a record on
 *   its own, never an exception thrown past this boundary;
 * - `../operations.ts#runMutation` owns the whole order — validate, resolve the session, assert the
 *   scope, ask this mutation's own authority question, decide a replay, compare the revision, apply,
 *   re-check the produced scope and record the ledger entry in one transaction. This file calls it
 *   and never re-implements a step of it: no transaction, no store read, no revision comparison and
 *   no ledger write happens here.
 *
 * What this file does own, and nothing else may restate:
 *
 * - the payload contract, which is the shape `features/support/schemas.ts` posts: an amount as exact
 *   minor units with its currency, a duplicate top-level `currency` that must agree with the one
 *   inside the amount when it is stated, the single measure a goal is set against, and the civil day
 *   the goal takes effect on;
 * - the subject the goal belongs to, which comes from the resolved scope on the request and never
 *   from the payload: a payload cannot name a support subject, so it cannot aim a write at one;
 * - the authority question, which is the goal capability `../authorize.ts` decides and the
 *   requirement that a goal save happens in the context the session actually selected.
 *
 * What a save never proves, and what it never leaks. The outcome distinguishes accepted, unchanged,
 * a replay, a conflict, a denial and a refusal, and each is a different fact: a replay returns the
 * result the first call was given and changes nothing, a conflict carries the caller's own input
 * beside the value it collided with, and a denial carries a closed reason code with no amount, no
 * revision, no count and no existence flag — a caller without the capability therefore learns nothing
 * about a goal it may not see.
 *
 * Money and time. Every amount is an integer count of the currency's minor units beside the code
 * whose exponent `@/modules/money/currency` holds; a currency with no exponent is refused rather than
 * defaulted to two decimals, and no floating-point arithmetic, parsing or formatting appears here.
 * A goal's effective day is a civil date: it is stored and returned as `YYYY-MM-DD` and is never a
 * midnight, an instant or a zone. This file reads no clock — the scenario instant on the ledger entry
 * is stamped by the runner through `@/modules/time/clock`, and the only timestamp a goal carries is
 * the day the worker stated.
 *
 * Plan items that put this file in scope: AAP 0.6.1 "Mutations: support" (the single permitted
 * financial write, depending on `authorize`, `operations` and `money`), 0.7.1 ("Understand support":
 * `saveGoal` as the only mutation in that job), 0.8.1 (the goal rules), 0.9.1 and 0.11.1 (the file's
 * place in the tree), and 0.10.1 ("a goal editable only under an explicit `canEditGoal` capability").
 *
 * Rule 1 obligations this file keeps. *Clause 1 (preserve the agreed scope):* one name, `saveGoal`,
 * and no posting, correction, refund, scheduling or provider path beside it — the finance owner is a
 * documented future seam in `docs/architecture.md`, not a hook here. *Clause 2 (reuse the patterns):*
 * one runner, one ledger, one schema, one outcome union, and the goal module's own capability,
 * amount and decision rules are called rather than copied. *Clause 3 (preserve meaning):* a saved
 * target never looks like a gift, a commitment, a public progress statement or a permission grant,
 * and an undetermined effect stays `unknown`, recovered by its operation identity.
 */
import { z } from "zod";

import { isRecord } from "@/lib/guards";
import { minorUnitsOf } from "@/modules/money/amount";
import {
  GOAL_MEASURE,
  applyGoalSave,
  validateGoalAmount,
  type GoalRecord,
} from "@/modules/support/goal";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";

import {
  canEdit,
  outcomeOfRefusal,
  resolveSession,
  type ResolvedSession,
  type ScopeDecision,
  type SessionSource,
} from "../authorize";
import {
  sameScope,
  supportProjectionRecordSchema,
  type MutationInput,
  type Scope,
  type SupportGoalMeasure,
  type SupportGoalRecord,
  type SupportProjectionRecord,
} from "../envelope";
import { denied, type MutationOutcome } from "../outcome";
import {
  runMutation,
  type ApplyResult,
  type CurrentTarget,
  type MutationContext,
} from "../operations";

// ---------------------------------------------------------------------------------------------
// The wording a rejected payload shows
// ---------------------------------------------------------------------------------------------

/**
 * Every message this mutation's schema can return, stated once so a field's wording cannot drift
 * between the shape check and the goal module's own refusal of the same value.
 *
 * The messages name what must change and never echo a value beyond the form's own input. Where
 * `@/modules/support/goal` owns the rule — a positive whole amount, a currency with a known
 * exponent — its own message is used unchanged through `validateGoalAmount`.
 */
const GOAL_MESSAGES = {
  currencyRequired:
    "State the currency the goal is set in; an amount without a currency states no target.",
  currencyDisagrees:
    "State one currency: the currency beside the amount and the one on the form must agree, so a goal cannot be saved in two currencies at once.",
  minorUnitsRequired:
    "The goal amount arrives as a whole number of the currency's minor units; a major-unit number, a decimal or text cannot be stated exactly and is refused rather than rounded.",
  amountNotWhole:
    "Set the goal to a whole number of the currency's minor units within the exact range this application can count; a fractional or unbounded count cannot be stated exactly.",
  measureInvalid:
    "A goal is set against the one measure this release states, received support; it counts received gifts and never a commitment, a monthly equivalent or another goal.",
  effectiveFromRequired: "State the day the goal takes effect on, as a calendar day.",
  effectiveFromInvalid:
    "State the effective day as a real calendar day written YYYY-MM-DD; a day the calendar does not have is refused rather than moved to the nearest one.",
} as const;

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * A goal save as this mutation accepts it: the shape the Support family's goal form posts.
 *
 * `amount` is the goal record's own amount — an exact count of minor units beside its currency — so
 * the payload states money the way the projection stores it and no conversion happens at this
 * boundary. `currency` repeats the code the form's currency control holds; when it is present it must
 * equal `amount.currency`, because a payload stating two currencies describes no single target.
 * `effectiveFrom` is a civil day, carried as the text a date control produces: a goal takes effect on
 * a day, and a display-zone change must not move it.
 */
export interface GoalSavePayload {
  readonly currency?: string;
  readonly amount: {
    readonly currency: string;
    readonly minorUnits: number;
  };
  /**
   * The one measure `GOAL_MEASURE` names: a goal is a target for received gifts, and a payload naming
   * any other measure is refused rather than silently accepted as this one.
   */
  readonly measure: GoalRecord["measure"];
  readonly effectiveFrom: string;
}

/** Whether a value can be a count of minor units: a safe integer that is not negative zero. */
function isCountableMinorUnits(value: number): boolean {
  return Number.isSafeInteger(value) && !Object.is(value, -0);
}

/**
 * Refuses text that is not a day the calendar has, through the one civil-date reader.
 *
 * Shape and calendar only: a day past the end of its month is refused rather than rolled forward, and
 * no time of day, zone or instant is invented for it. `@/modules/support/goal` stores the accepted
 * value as a civil date, so the reader here and the stored form are the same rule.
 */
function refineCivilDay(value: string, ctx: z.RefinementCtx): void {
  if (parseCivilDate(value).status !== "parsed") {
    ctx.addIssue({ code: "custom", message: GOAL_MESSAGES.effectiveFromInvalid });
  }
}

/** The amount as the payload states it: a currency code and an integer count of minor units. */
const goalAmountPayloadSchema = z.strictObject({
  currency: z
    .string({ error: GOAL_MESSAGES.currencyRequired })
    .min(1, { error: GOAL_MESSAGES.currencyRequired }),
  minorUnits: z.int({ error: GOAL_MESSAGES.minorUnitsRequired }),
});

/**
 * The one schema a goal save's payload is read with.
 *
 * Strict, so a payload carrying a field this mutation does not accept — a revision, a support
 * subject, a gift identity, a commitment, a public-progress flag, a capability claim — is refused with
 * that field's path rather than having the field quietly dropped. The amount is then checked by the
 * goal module's own validator, so the rule about a positive whole amount in a currency with a known
 * exponent is stated once, in the module that owns it, and this schema only decides which field path
 * its refusal belongs to.
 *
 * The check runs here, before the runner's authority question, for one reason: a refusal of the input
 * itself must be an `invalid` outcome with per-field messages, and the runner's apply step can only
 * report a change or the absence of one.
 */
const goalSaveInputSchema: z.ZodType<GoalSavePayload> = z
  .strictObject({
    currency: z
      .string({ error: GOAL_MESSAGES.currencyRequired })
      .min(1, { error: GOAL_MESSAGES.currencyRequired })
      .optional(),
    amount: goalAmountPayloadSchema,
    measure: z.literal(GOAL_MEASURE, { error: GOAL_MESSAGES.measureInvalid }),
    effectiveFrom: z
      .string({ error: GOAL_MESSAGES.effectiveFromRequired })
      .trim()
      .superRefine(refineCivilDay),
  })
  .superRefine((value, ctx) => {
    if (value.currency !== undefined && value.currency !== value.amount.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: GOAL_MESSAGES.currencyDisagrees,
      });
    }

    const minorUnits = value.amount.minorUnits;
    if (!isCountableMinorUnits(minorUnits)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount", "minorUnits"],
        message: GOAL_MESSAGES.amountNotWhole,
      });
      return;
    }

    for (const problem of validateGoalAmount({
      currency: value.amount.currency,
      minorUnits: minorUnitsOf(minorUnits),
    })) {
      ctx.addIssue({ code: "custom", path: ["amount", problem.field], message: problem.message });
    }
  });

// ---------------------------------------------------------------------------------------------
// The stored projection this mutation reads and writes
// ---------------------------------------------------------------------------------------------

/**
 * The measure a stored goal states, taken from the closed list the read envelope declares.
 *
 * The stored vocabulary names the basis the goal is set against (`received-support`); the goal module
 * names the measure it is measured as (`received-gifts`). They are the same target written for two
 * readers, and this annotation is what makes a change to either list a compile error here instead of
 * a silent mismatch between the stored record and the report.
 */
const STORED_GOAL_MEASURE: SupportGoalMeasure = "received-support";

/**
 * The members of a session's state document this mutation consumes.
 *
 * Narrow on purpose: the store hands back the whole document as an opaque value, and this schema
 * checks only the projection. It is not the reader the Support surfaces use, and it never becomes
 * one — a write that parsed the whole document would be a second record contract beside theirs.
 */
const goalStateDocumentSchema = z.object({
  supportProjection: supportProjectionRecordSchema.nullable(),
});

/** A goal's stored revision: a positive whole number written as text, or nothing this build can edit. */
const STORED_GOAL_REVISION = /^[1-9]\d*$/u;

/**
 * What reading a session's state document found for the subject this request names.
 *
 * `found` carries the projection together with the raw document it came from, because writing back
 * merges that document rather than replacing it: the other families a session holds — partners,
 * tasks, gifts, content, memberships — are none of this mutation's business and must survive a goal
 * save untouched.
 *
 * `missing` states that this session holds no projection for the subject — the source states no
 * support subject here, or the projection it does hold belongs to another context — and `unreadable`
 * that the document could not be read as one at all. Neither is a goal of zero and neither is an
 * error to invent a value for: nothing is written in either case.
 */
type ProjectionLookup =
  | {
      readonly status: "found";
      readonly state: Record<string, unknown>;
      readonly projection: SupportProjectionRecord;
    }
  | { readonly status: "missing" }
  | { readonly status: "unreadable" };

/**
 * Reads the projection the scope names, and answers what was found without writing anything.
 *
 * The subject is the resolved scope's, never the payload's and never a guess from the projection:
 * a projection that belongs to another support subject is not this request's to change, so it is
 * answered as missing rather than edited.
 */
function lookupProjection(state: unknown, scope: Scope): ProjectionLookup {
  if (!isRecord(state)) {
    return { status: "unreadable" };
  }
  const parsed = goalStateDocumentSchema.safeParse(state);
  if (!parsed.success) {
    return { status: "unreadable" };
  }
  const projection = parsed.data.supportProjection;
  if (projection === null || projection.supportSubjectId !== scope.supportSubjectId) {
    return { status: "missing" };
  }
  return { status: "found", state, projection };
}

/** A stored goal read as the shape the goal module decides and the report measures from. */
type CurrentGoal =
  | { readonly status: "none" }
  | { readonly status: "goal"; readonly goal: GoalRecord }
  | { readonly status: "unreadable" };

/** Reads a stored revision as a whole number, or answers that it is not one this build can present. */
function revisionNumberOf(text: string): number | undefined {
  if (!STORED_GOAL_REVISION.test(text)) {
    return undefined;
  }
  const revision = Number(text);
  return Number.isSafeInteger(revision) ? revision : undefined;
}

/**
 * Reads the stored goal as the working shape, refusing a goal that cannot be stated.
 *
 * The stored record holds its effective day as a civil-date string and its revision as text; both are
 * read here, and a value that is not one is refused rather than defaulted, because a goal dated by
 * guess or saved against a revision nobody read is a goal nobody can compare or safely edit. The
 * stored measure is the one basis, which the goal module measures as received gifts.
 */
function currentGoalOf(stored: SupportGoalRecord | null): CurrentGoal {
  if (stored === null) {
    return { status: "none" };
  }
  const effectiveFrom = parseCivilDate(stored.effectiveFrom);
  const revision = revisionNumberOf(stored.revision);
  if (effectiveFrom.status !== "parsed" || revision === undefined) {
    return { status: "unreadable" };
  }
  return {
    status: "goal",
    goal: {
      minorUnits: stored.amount.minorUnits,
      currency: stored.amount.currency,
      measure: GOAL_MEASURE,
      effectiveFrom: effectiveFrom.date,
      revision,
    },
  };
}

/**
 * The target the runner compares the caller's revision against: the goal's own revision.
 *
 * A goal carries its own concurrency token, so `expectedRevision` on a save is the token the
 * projection's `goal.revision` states — not the projection's revision, which belongs to the source's
 * read model. A scope that states no goal is a creation, and a creation compares no revision: with
 * nothing stored there is no value a stale expectation could overwrite.
 */
function currentTargetOf(documents: { readonly state: unknown }, scope: Scope): CurrentTarget {
  const lookup = lookupProjection(documents.state, scope);
  if (lookup.status !== "found" || lookup.projection.goal === null) {
    return { kind: "absent" };
  }
  const stored = lookup.projection.goal;
  return currentGoalOf(stored).status === "goal"
    ? { kind: "record", revision: stored.revision, value: stored }
    : { kind: "absent" };
}

/** The goal as the projection stores it: exact minor units, the one basis, a civil day, a revision. */
function storedGoalOf(goal: GoalRecord): SupportGoalRecord {
  return {
    amount: { currency: goal.currency, minorUnits: goal.minorUnits },
    measure: STORED_GOAL_MEASURE,
    effectiveFrom: serialiseCivilDate(goal.effectiveFrom),
    revision: String(goal.revision),
  };
}

/**
 * The goal as the caller is told about it: the facts of the stored record, and nothing derived.
 *
 * No percentage, no progress against the period, no coverage and no expectation about money: those
 * are the report function's answer, computed from this amount and never stored with it.
 */
export type GoalSaveResult = {
  readonly amount: { readonly currency: string; readonly minorUnits: number };
  readonly measure: SupportGoalMeasure;
  readonly effectiveFrom: string;
  readonly revision: string;
};

/** Projects a stored goal into the result a replay returns byte for byte. */
function resultOf(stored: SupportGoalRecord): GoalSaveResult {
  return {
    amount: { currency: stored.amount.currency, minorUnits: stored.amount.minorUnits },
    measure: stored.measure,
    effectiveFrom: stored.effectiveFrom,
    revision: stored.revision,
  };
}

// ---------------------------------------------------------------------------------------------
// The authority question
// ---------------------------------------------------------------------------------------------

/** The name the armed failure plan and the diagnostic line know this mutation by. */
const SAVE_GOAL = "saveGoal";

/**
 * Whether this caller may change the goal of the subject this request names.
 *
 * Two questions, in this order. The capability is the one `modules/support/goal.ts` owns: without
 * `canEditGoal` the answer is `capability-absent`, and it carries nothing about the goal — no amount,
 * no revision, no existence flag. Then the session's own selected context must be the one the request
 * acts in, because the projection a session holds is its selected context's: a save aimed at another
 * admitted context would either write into a record it never read or be silently dropped, so it is
 * refused instead. Admission to two ministries is not permission to edit the goal of the one this
 * session is not in.
 */
function authorizeGoalEdit(
  session: ResolvedSession,
  scope: Scope,
  operationId: string,
): ScopeDecision {
  const capability = canEdit(session, {
    kind: "support-subject",
    scope,
    capabilities: session.capabilities,
  });
  if (!capability.allowed) {
    return { ok: false, denial: capability.denial };
  }

  const selected = session.selected;
  if (selected === null) {
    return { ok: false, denial: denied({ operationId, reasonCode: "not-admitted" }) };
  }
  return sameScope(selected, scope)
    ? { ok: true }
    : { ok: false, denial: denied({ operationId, reasonCode: "no-permission" }) };
}

// ---------------------------------------------------------------------------------------------
// The change
// ---------------------------------------------------------------------------------------------

/**
 * Decides and writes the goal, inside the runner's transaction.
 *
 * The order is the goal module's own, reached through it rather than restated: the capability it
 * tests, the amount it validates, the revision it compares, the no-op it recognises, and the record it
 * produces. This function's part is the boundary — find the subject's projection, hand the decision
 * the facts it needs, and write the produced goal back into a copy of the document that keeps every
 * other family untouched.
 *
 * A creation sets the measure and the day the worker stated and starts at revision 1; an edit changes
 * the amount and the currency only, so a new figure cannot move the goal onto another measure or
 * backdate the day it began. Saving the amount the goal already holds writes nothing and answers
 * `unchanged`, which the runner reports without advancing a revision or recording an entry.
 *
 * A session that holds no projection for this subject writes nothing either. The source states no
 * support target here, and a projection invented at this boundary would invent a provenance, a
 * coverage and an as-of time the source never supplied, so the save changes nothing and the surface's
 * next read reports the source's own condition.
 */
function applyGoal(
  context: MutationContext,
  scope: Scope,
  payload: GoalSavePayload,
): ApplyResult<GoalSaveResult> {
  const lookup = lookupProjection(context.docs.state, scope);
  if (lookup.status !== "found") {
    return { changed: false };
  }

  const current = currentGoalOf(lookup.projection.goal);
  if (current.status === "unreadable") {
    return { changed: false };
  }

  const minorUnits = payload.amount.minorUnits;
  const effectiveFrom = parseCivilDate(payload.effectiveFrom);
  if (!isCountableMinorUnits(minorUnits) || effectiveFrom.status !== "parsed") {
    return { changed: false };
  }

  const decision = applyGoalSave(
    current.status === "goal" ? current.goal : undefined,
    {
      amount: { currency: payload.amount.currency, minorUnits: minorUnitsOf(minorUnits) },
      // A creation compares no revision, and the runner compared none either; an edit presents the
      // goal's own revision, which is the token the runner has just matched against the caller's.
      expectedRevision: current.status === "goal" ? current.goal.revision : 0,
    },
    context.session.capabilities,
    true,
    effectiveFrom.date,
  );

  if (decision.status !== "accepted") {
    // Unreachable by construction: the schema refused an inadmissible amount before this step, the
    // runner asked the capability question this call is handed the answer to, and the revision
    // comparison here repeats the one the runner has already made. Nothing has been written, so if
    // that ever stops holding, the honest answer is that this save changed nothing.
    return { changed: false };
  }

  const stored = storedGoalOf(decision.goal);
  context.docs.state = {
    ...lookup.state,
    supportProjection: { ...lookup.projection, goal: stored },
  };

  return {
    changed: true,
    revision: stored.revision,
    result: resultOf(stored),
    ...(current.status === "none"
      ? { created: [scope.supportSubjectId] }
      : { changedIds: [scope.supportSubjectId] }),
  };
}

// ---------------------------------------------------------------------------------------------
// The one export
// ---------------------------------------------------------------------------------------------

/** The attempt identity a request that states none of its own is refused and recovered under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The attempt identity the caller stated, read without trusting its type.
 *
 * A body arrives from a browser, so the identity is read structurally before the schema sees it: a
 * request that cannot be resolved to a session at all is still answered, and it still needs the
 * handle a caller would replay or recover by.
 */
function attemptIdOf(input: unknown): string {
  if (!isRecord(input)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const candidate = input.operationId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}

/**
 * Saves the one support goal and answers exactly one outcome — `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 *
 * The session is resolved here only because the runner needs its identity; every authority question
 * is asked again inside the runner, against the resolved session, before anything is written. The
 * scope and payload the closures below read are the values the runner has just validated: a request
 * whose scope or payload is not well formed is refused before the apply step is reached.
 *
 * `source` names a session explicitly for the callers that hold an id and no request — the domain and
 * integration tests that drive a seeded session, and the operational scripts. A browser request names
 * nothing and takes its development-session cookie.
 */
export async function saveGoal(
  input: MutationInput<GoalSavePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);

  let sessionId: string;
  try {
    const resolution = await resolveSession(source);
    if (!resolution.ok) {
      return outcomeOfRefusal(resolution.refusal, operationId);
    }
    sessionId = resolution.session.sessionId;
  } catch {
    // A request context that cannot yield its session leaves no authority to act with, and no retry
    // can create one: the answer is the refusal, never a fabricated principal.
    return denied({ operationId, reasonCode: "session-unavailable" });
  }

  const scope = input.scope;
  return runMutation<GoalSavePayload, GoalSaveResult>({
    sessionId,
    input,
    schema: goalSaveInputSchema,
    name: SAVE_GOAL,
    authorize: (session) => authorizeGoalEdit(session, scope, operationId),
    readCurrent: (documents) => currentTargetOf(documents, scope),
    apply: (context) => applyGoal(context, scope, input.payload),
  });
}
