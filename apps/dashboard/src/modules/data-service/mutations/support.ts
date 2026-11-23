import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { minorUnitsOf } from "@/modules/money/amount";
import { GOAL_MEASURE, applyGoalSave, validateGoalAmount, type GoalRecord } from "@/modules/support/goal";
import { parseCivilDate, serialiseCivilDate } from "@/modules/time/civil";
import { canEdit, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import { sameScope, supportProjectionRecordSchema, type MutationInput, type Scope, type SupportGoalMeasure, type SupportGoalRecord, type SupportProjectionRecord } from "../envelope";
import { denied, type MutationOutcome } from "../outcome";
import { attemptIdOf, openMutation, runMutation, type ApplyResult, type CurrentTarget, type MutationContext } from "../operations";
const GOAL_MESSAGES = {
  currencyRequired: "State the currency the goal is set in; an amount without a currency states no target.",
  currencyDisagrees: "State one currency: the currency beside the amount and the one on the form must agree, so a goal cannot be saved in two currencies at once.",
  minorUnitsRequired: "The goal amount arrives as a whole number of the currency's minor units; a major-unit number, a decimal or text cannot be stated exactly and is refused rather than rounded.",
  amountNotWhole: "Set the goal to a whole number of the currency's minor units within the exact range this application can count; a fractional or unbounded count cannot be stated exactly.",
  measureInvalid: "A goal is set against the one measure this release states, received support; it counts received gifts and never a commitment, a monthly equivalent or another goal.",
  effectiveFromRequired: "State the day the goal takes effect on, as a calendar day.",
  effectiveFromInvalid: "State the effective day as a real calendar day written YYYY-MM-DD; a day the calendar does not have is refused rather than moved to the nearest one.",
} as const;
export type GoalSavePayload = { readonly currency?: string; readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: GoalRecord["measure"]; readonly effectiveFrom: string };
const isCountableMinorUnits = (value: number): boolean => Number.isSafeInteger(value) && !Object.is(value, -0);
const refineCivilDay = (value: string, ctx: z.RefinementCtx): void => {
  if (parseCivilDate(value).status !== "parsed") ctx.addIssue({ code: "custom", message: GOAL_MESSAGES.effectiveFromInvalid });
};
const goalAmountPayloadSchema = z.strictObject({ currency: z.string({ error: GOAL_MESSAGES.currencyRequired }).min(1, { error: GOAL_MESSAGES.currencyRequired }), minorUnits: z.int({ error: GOAL_MESSAGES.minorUnitsRequired }) });
const goalSaveInputSchema: z.ZodType<GoalSavePayload> = z
  .strictObject({
    currency: z.string({ error: GOAL_MESSAGES.currencyRequired }).min(1, { error: GOAL_MESSAGES.currencyRequired }).optional(),
    amount: goalAmountPayloadSchema,
    measure: z.literal(GOAL_MEASURE, { error: GOAL_MESSAGES.measureInvalid }),
    effectiveFrom: z.string({ error: GOAL_MESSAGES.effectiveFromRequired }).trim().superRefine(refineCivilDay),
  })
  .superRefine((value, ctx) => {
    if (value.currency !== undefined && value.currency !== value.amount.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: GOAL_MESSAGES.currencyDisagrees });
    const minorUnits = value.amount.minorUnits;
    if (!isCountableMinorUnits(minorUnits)) return ctx.addIssue({ code: "custom", path: ["amount", "minorUnits"], message: GOAL_MESSAGES.amountNotWhole });
    for (const problem of validateGoalAmount({ currency: value.amount.currency, minorUnits: minorUnitsOf(minorUnits) })) ctx.addIssue({ code: "custom", path: ["amount", problem.field], message: problem.message });
  });
const goalStateDocumentSchema = z.object({ supportProjection: supportProjectionRecordSchema.nullable() });
const STORED_GOAL_REVISION = /^[1-9]\d*$/u;
type ProjectionLookup = { readonly status: "found"; readonly state: Record<string, unknown>; readonly projection: SupportProjectionRecord } | { readonly status: "missing" } | { readonly status: "unreadable" };
function lookupProjection(state: unknown, scope: Scope): ProjectionLookup {
  const parsed = isRecord(state) ? goalStateDocumentSchema.safeParse(state) : undefined;
  if (!isRecord(state) || parsed?.success !== true) return { status: "unreadable" };
  const projection = parsed.data.supportProjection;
  return projection === null || projection.supportSubjectId !== scope.supportSubjectId ? { status: "missing" } : { status: "found", state, projection };
}
type CurrentGoal = { readonly status: "none" } | { readonly status: "goal"; readonly goal: GoalRecord } | { readonly status: "unreadable" };
function currentGoalOf(stored: SupportGoalRecord | null): CurrentGoal {
  const effectiveFrom = stored === null ? undefined : parseCivilDate(stored.effectiveFrom);
  const revision = stored === null || !STORED_GOAL_REVISION.test(stored.revision) ? Number.NaN : Number(stored.revision);
  return stored === null ? { status: "none" } : effectiveFrom?.status !== "parsed" || !Number.isSafeInteger(revision) ? { status: "unreadable" } : { status: "goal", goal: { minorUnits: stored.amount.minorUnits, currency: stored.amount.currency, measure: GOAL_MEASURE, effectiveFrom: effectiveFrom.date, revision } };
}
function currentTargetOf(documents: { readonly state: unknown }, scope: Scope): CurrentTarget {
  const lookup = lookupProjection(documents.state, scope);
  const stored = lookup.status === "found" ? lookup.projection.goal : null;
  return stored !== null && currentGoalOf(stored).status === "goal" ? { kind: "record", revision: stored.revision, value: stored } : { kind: "absent" };
}
const storedGoalOf = (goal: GoalRecord): SupportGoalRecord => ({ amount: { currency: goal.currency, minorUnits: goal.minorUnits }, measure: GOAL_MEASURE, effectiveFrom: serialiseCivilDate(goal.effectiveFrom), revision: String(goal.revision) });
export type GoalSaveResult = { readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: SupportGoalMeasure; readonly effectiveFrom: string; readonly revision: string };
const resultOf = (stored: SupportGoalRecord): GoalSaveResult => ({ amount: { currency: stored.amount.currency, minorUnits: stored.amount.minorUnits }, measure: stored.measure, effectiveFrom: stored.effectiveFrom, revision: stored.revision });
const authorizeGoalEdit = (session: ResolvedSession, scope: Scope, operationId: string): ScopeDecision => {
  const capability = canEdit(session, { kind: "support-subject", scope, capabilities: session.capabilities });
  if (!capability.allowed) return { ok: false, denial: capability.denial };
  const selected = session.selected;
  return selected === null ? { ok: false, denial: denied({ operationId, reasonCode: "not-admitted" }) } : sameScope(selected, scope) ? { ok: true } : { ok: false, denial: denied({ operationId, reasonCode: "no-permission" }) };
};
function applyGoal(context: MutationContext, scope: Scope, payload: GoalSavePayload): ApplyResult<GoalSaveResult> {
  const lookup = lookupProjection(context.docs.state, scope);
  const current = lookup.status === "found" ? currentGoalOf(lookup.projection.goal) : ({ status: "unreadable" } as const);
  const minorUnits = payload.amount.minorUnits;
  const effectiveFrom = parseCivilDate(payload.effectiveFrom);
  if (lookup.status !== "found" || current.status === "unreadable" || !isCountableMinorUnits(minorUnits) || effectiveFrom.status !== "parsed") return { changed: false };
  const expectedGoalRevision = current.status === "goal" ? current.goal.revision : 0;
  const decision = applyGoalSave(current.status === "goal" ? current.goal : undefined, { amount: { currency: payload.amount.currency, minorUnits: minorUnitsOf(minorUnits) }, expectedRevision: expectedGoalRevision }, context.session.capabilities, true, effectiveFrom.date);
  if (decision.status !== "accepted") return { changed: false };
  const stored = storedGoalOf(decision.goal);
  context.docs.state = { ...lookup.state, supportProjection: { ...lookup.projection, goal: stored } };
  return { changed: true, revision: stored.revision, result: resultOf(stored), ...(current.status === "none" ? { created: [scope.supportSubjectId] } : { changedIds: [scope.supportSubjectId] }) };
}
/** Saves the one support goal and answers exactly one outcome — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function saveGoal(input: MutationInput<GoalSavePayload>, source?: SessionSource): Promise<MutationOutcome> {
  const operationId = attemptIdOf(input);
  const opening = await openMutation("saveGoal", input, source);
  if (!opening.ok) return opening.outcome;
  const { scope } = input;
  return runMutation<GoalSavePayload, GoalSaveResult>({
    sessionId: opening.sessionId,
    input,
    schema: goalSaveInputSchema,
    name: "saveGoal",
    authorize: (session) => authorizeGoalEdit(session, scope, operationId),
    readCurrent: (documents) => currentTargetOf(documents, scope),
    apply: (context) => applyGoal(context, scope, input.payload),
  });
}
