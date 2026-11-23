import { Temporal } from "temporal-polyfill";
import { isRecord } from "@/lib/guards";
import { err, ok, type Result } from "@/lib/result";
import type { OperationOutcomeName } from "@/modules/data-service/envelope";
export type FailureMode = Extract<OperationOutcomeName, "denied" | "conflict" | "unknown">;
export type FailureTargetKind = "read" | "mutation";
const DEMONSTRABLE_TARGET_ROWS = [
  { kind: "read", name: "readPartner", modes: ["denied"], note: "A denial notice that states no count, title, existence flag or size, with the independent work on the Partner surface still usable." },
  { kind: "read", name: "readCoachSubject", modes: ["denied"], note: "A denied coach read of a module that was never shared: nothing about the worker's record is enumerated or hinted at." },
  { kind: "read", name: "readExport", modes: ["denied"], note: "An export refused for want of export permission, so no row that the screen withheld can leave through the file." },
  { kind: "mutation", name: "saveContactEdits", modes: ["conflict"], note: "A conflict panel showing the current value beside the preserved input, with a deliberate re-apply and no silent overwrite." },
  { kind: "mutation", name: "saveGoal", modes: ["conflict"], note: "A stale goal revision refused as a conflict: the amount the caller typed is kept for comparison against the current goal." },
  { kind: "mutation", name: "saveDraft", modes: ["conflict"], note: "A draft save against an old revision answers with the conflict, and the readable local text survives it." },
  { kind: "mutation", name: "logInteraction", modes: ["unknown"], note: "An uncertain-result panel whose only actions are to check the result and, where eligible, to retry this same work." },
  { kind: "mutation", name: "acceptImportRows", modes: ["unknown"], note: "An acceptance whose acknowledgement was lost: the receipt is recoverable by operation identity, so no row is accepted twice." },
  { kind: "mutation", name: "publishVariants", modes: ["unknown"], note: "A publication whose fate is not claimed either way, recovered by re-querying the same operation rather than publishing again." },
  { kind: "mutation", name: "requestNotification", modes: ["unknown"], note: "A notification intent that may have been submitted: exactly one message per recipient and intent, and no resend under a fresh key." },
] as const;
export type DemonstrableTargetName = (typeof DEMONSTRABLE_TARGET_ROWS)[number]["name"];
export type DemonstrableTarget = { readonly kind: FailureTargetKind; readonly name: DemonstrableTargetName; readonly modes: readonly FailureMode[]; readonly note: string };
export const MODE_LABEL: Readonly<Record<FailureMode, string>> = Object.freeze({ denied: "Scope denial", conflict: "Changed revision", unknown: "Lost acknowledgement" });
export const MODE_OUTCOME: Readonly<Record<FailureMode, OperationOutcomeName>> = Object.freeze({ denied: "denied", conflict: "conflict", unknown: "unknown" });
export const DEMONSTRABLE_TARGETS: readonly DemonstrableTarget[] = Object.freeze(DEMONSTRABLE_TARGET_ROWS);
export type FailureTarget = { readonly kind: FailureTargetKind; readonly name: DemonstrableTargetName };
export type FailurePlan = { readonly mode: FailureMode; readonly target: FailureTarget; readonly armedAt: string };
export const EMPTY_FAILURE_PLAN = null;
export type FailurePlanDocument = FailurePlan | typeof EMPTY_FAILURE_PLAN;
export const FAILURE_PLAN_REFUSAL_CODES = ["unknown-target", "mode-not-demonstrable-on-target", "malformed-plan", "already-armed"] as const;
export type FailurePlanRefusalCode = (typeof FAILURE_PLAN_REFUSAL_CODES)[number];
export type FailurePlanRefusal = { readonly code: FailurePlanRefusalCode; readonly message: string };
const refuse = (code: FailurePlanRefusalCode, message: string): FailurePlanRefusal => ({ code, message });
const STORED_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
function isStoredInstant(value: unknown): value is string {
  if (typeof value !== "string" || !STORED_INSTANT_PATTERN.test(value)) return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}
const isFailureMode = (value: unknown): value is FailureMode => typeof value === "string" && Object.hasOwn(MODE_OUTCOME, value);
const isFailureTargetKind = (value: unknown): value is FailureTargetKind => value === "read" || value === "mutation";
const demonstrableTargetFor = (kind: FailureTargetKind, name: string): DemonstrableTarget | undefined => DEMONSTRABLE_TARGETS.find((target) => target.kind === kind && target.name === name);
const modesWording = (target: DemonstrableTarget): string => target.modes.map((mode) => MODE_LABEL[mode]).join(" or ");
export type ClaimedFailureTarget = { readonly kind: FailureTargetKind; readonly name: string };
export type FailurePlanRequest = { readonly mode: FailureMode; readonly target: ClaimedFailureTarget; readonly armedAt: string };
/** Arms one mode on one named call and returns the new plan; stores nothing, and answers every refusal as a value. */
export function setFailurePlan(current: FailurePlanDocument, request: FailurePlanRequest): Result<FailurePlan, FailurePlanRefusal> {
  const target = demonstrableTargetFor(request.target.kind, request.target.name);
  if (target === undefined) return err(refuse("unknown-target", `No ${request.target.kind} named ${request.target.name} demonstrates a failure in this release.`));
  if (!target.modes.includes(request.mode)) return err(refuse("mode-not-demonstrable-on-target", `${target.name} demonstrates ${modesWording(target)}, not ${MODE_LABEL[request.mode]}.`));
  if (!isStoredInstant(request.armedAt)) return err(refuse("malformed-plan", "An armed failure is stamped with the scenario instant it was armed at, written as an ISO-8601 date-time that states its offset."));
  if (current !== EMPTY_FAILURE_PLAN) return err(refuse("already-armed", `${MODE_LABEL[current.mode]} is already armed for ${current.target.name}. Disarm it first by sending setFailurePlan with a null plan, because exactly one failure is active at a time.`));
  return ok({ mode: request.mode, target: { kind: target.kind, name: target.name }, armedAt: request.armedAt });
}
export const disarmFailurePlan = (): FailurePlanDocument => EMPTY_FAILURE_PLAN;
/** The single consultation point: the mode armed for this kind and name, or `undefined` when nothing applies. */
export const failureFor = (plan: FailurePlanDocument, kind: FailureTargetKind, name: string): FailureMode | undefined => (plan === EMPTY_FAILURE_PLAN || plan.target.kind !== kind || plan.target.name !== name ? undefined : plan.mode);
export type FailurePlanDescription = { readonly armed: boolean; readonly mode: FailureMode | null; readonly modeLabel: string; readonly target: FailureTarget | null; readonly targetNote: string | null; readonly armedAt: string | null; readonly effect: string; readonly recoveryLesson: string };
const MODE_EFFECT: Readonly<Record<FailureMode, string>> = Object.freeze({
  denied: "The call answers with a denial that carries no count, title, existence flag or size, so the surface cannot hint that the refused record exists.",
  conflict: "The mutation answers with a conflict that shows the current value beside the input that was sent, which is preserved for comparison.",
  unknown: "The mutation answers with unknown, carrying only the operation id: no success and no failure is claimed.",
});
const MODE_RECOVERY_LESSON: Readonly<Record<FailureMode, string>> = Object.freeze({
  denied: "Authorisation happens before enumeration: a refused read discloses nothing about what it refused, and independent work on that surface stays usable.",
  conflict: "A stale expected revision is detected rather than silently overwritten, and the change is applied only when the caller re-applies it deliberately.",
  unknown: "Recovery is re-querying the same operation id, which returns the stored result: exactly one effect exists, and uncertainty never becomes a resend.",
});
const DISARMED_DESCRIPTION: FailurePlanDescription = Object.freeze({
  armed: false,
  mode: null,
  modeLabel: "No failure armed",
  target: null,
  targetNote: null,
  armedAt: null,
  effect: "Every read and every mutation answers from the application's own behaviour; no simulated failure is injected.",
  recoveryLesson: "Nothing to recover: with no failure armed there is no injected outcome to reconcile.",
});
/** Describes the plan for the development panel, including the disarmed case. */
export function describeFailurePlan(plan: FailurePlanDocument): FailurePlanDescription {
  if (plan === EMPTY_FAILURE_PLAN) return DISARMED_DESCRIPTION;
  const target = demonstrableTargetFor(plan.target.kind, plan.target.name);
  return { armed: true, mode: plan.mode, modeLabel: MODE_LABEL[plan.mode], target: { kind: plan.target.kind, name: plan.target.name }, targetNote: target?.note ?? null, armedAt: plan.armedAt, effect: MODE_EFFECT[plan.mode], recoveryLesson: MODE_RECOVERY_LESSON[plan.mode] };
}
/** Reads a plan back from its stored form, refusing rather than throwing on anything unusable. */
export function parseFailurePlan(value: unknown): Result<FailurePlanDocument, FailurePlanRefusal> {
  if (value === EMPTY_FAILURE_PLAN) return ok(EMPTY_FAILURE_PLAN);
  if (!isRecord(value)) return err(refuse("malformed-plan", "A stored failure plan is either the absent plan or an object carrying a mode, a target and an armed-at instant."));
  const { mode, target, armedAt } = value;
  if (!isFailureMode(mode)) return err(refuse("malformed-plan", "A stored failure plan names one of the three failure modes."));
  if (!isRecord(target)) return err(refuse("malformed-plan", "A stored failure plan carries a target object naming its kind and its name."));
  const { kind, name } = target;
  if (!isFailureTargetKind(kind) || typeof name !== "string") return err(refuse("malformed-plan", 'A stored failure target names its kind as "read" or "mutation", together with a target name.'));
  const demonstrable = demonstrableTargetFor(kind, name);
  if (demonstrable === undefined) return err(refuse("malformed-plan", "A stored failure target names no call this release demonstrates a failure on."));
  if (!demonstrable.modes.includes(mode)) return err(refuse("malformed-plan", `${demonstrable.name} demonstrates ${modesWording(demonstrable)}, which is not the mode the stored plan names.`));
  return !isStoredInstant(armedAt) ? err(refuse("malformed-plan", "A stored failure plan carries the scenario instant it was armed at, written as an ISO-8601 date-time that states its offset.")) : ok({ mode, target: { kind: demonstrable.kind, name: demonstrable.name }, armedAt });
}
/** Reads the armed plan out of one session document, or the absent plan. */
export function failurePlanOfDocument(document: unknown): FailurePlanDocument {
  if (!isRecord(document)) return EMPTY_FAILURE_PLAN;
  const parsed = parseFailurePlan(Reflect.get(document, "failurePlan"));
  return parsed.ok ? parsed.value : EMPTY_FAILURE_PLAN;
}
