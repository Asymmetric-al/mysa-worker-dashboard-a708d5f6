import { ZodError } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { redactDenial } from "@/lib/redaction";
export const LOCAL_STORE_SYSTEM = "local-store";
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [field: string]: JsonValue };
export type MutationResult = JsonValue;
export type PerItemResult<State extends string = string> = { readonly targetId: string; readonly state: State; readonly revision?: string; readonly reasonCode?: string; readonly reason?: string };
export const DENIAL_REASONS = ["not-admitted", "no-membership", "no-permission", "no-export-permission", "no-protected-grant", "capability-absent", "session-expired", "session-unavailable"] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];
export type ConflictReason = "stale-revision" | "changed-intent";
export type FieldMessages = Readonly<Record<string, readonly string[]>>;
export const ROOT_FIELD_KEY = "_root";
export const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const MAX_ECHOED_OPERATION_ID_LENGTH = 64;
const echoedOperationId = (operationId: string): string => (operationId.length > MAX_ECHOED_OPERATION_ID_LENGTH ? operationId.slice(0, MAX_ECHOED_OPERATION_ID_LENGTH) : operationId);
export type AcceptedOutcome = { readonly outcome: "accepted"; readonly operationId: string; readonly revision: string; readonly created?: readonly string[]; readonly changed?: readonly string[]; readonly items?: readonly PerItemResult[] };
export type AlreadyAcceptedOutcome = { readonly outcome: "alreadyAccepted"; readonly operationId: string; readonly revision: string; readonly result: MutationResult; readonly created?: readonly string[]; readonly changed?: readonly string[]; readonly items?: readonly PerItemResult[] };
export type UnchangedOutcome = { readonly outcome: "unchanged"; readonly operationId: string; readonly revision: string };
export type ConflictOutcome = { readonly outcome: "conflict"; readonly operationId: string; readonly currentRevision: string; readonly current: unknown; readonly preservedInput: unknown; readonly reason: ConflictReason };
export type DeniedOutcome = { readonly outcome: "denied"; readonly operationId: string; readonly reasonCode: DenialReason };
export type InvalidOutcome = { readonly outcome: "invalid"; readonly operationId: string; readonly fields: FieldMessages };
export type UnavailableOutcome = { readonly outcome: "unavailable"; readonly operationId: string; readonly source: SourceReference; readonly guidance: string };
export type UnknownOutcome = { readonly outcome: "unknown"; readonly operationId: string };
export type MutationOutcome = AcceptedOutcome | AlreadyAcceptedOutcome | UnchangedOutcome | ConflictOutcome | DeniedOutcome | InvalidOutcome | UnavailableOutcome | UnknownOutcome;
export type ReadResult<T> = { readonly kind: "envelope"; readonly envelope: T } | { readonly kind: "denied"; readonly denied: DeniedOutcome } | { readonly kind: "unavailable"; readonly unavailable: UnavailableOutcome } | { readonly kind: "refused"; readonly refused: InvalidOutcome };
/** Answers that the operation was applied exactly once. */ export function accepted(input: { operationId: string; revision: string; created?: readonly string[]; changed?: readonly string[]; items?: readonly PerItemResult[] }): AcceptedOutcome {
  return { outcome: "accepted", operationId: echoedOperationId(input.operationId), revision: input.revision, ...(input.created === undefined ? {} : { created: input.created }), ...(input.changed === undefined ? {} : { changed: input.changed }), ...(input.items === undefined ? {} : { items: input.items }) };
}
/** Answers a replay: the same `operationId` with the same intent returns the stored result, with no new effect and no new revision. */
export const alreadyAccepted = (input: { operationId: string; revision: string; result: MutationResult; created?: readonly string[]; changed?: readonly string[]; items?: readonly PerItemResult[] }): AlreadyAcceptedOutcome => ({
  outcome: "alreadyAccepted",
  operationId: echoedOperationId(input.operationId),
  revision: input.revision,
  result: input.result,
  ...(input.created === undefined ? {} : { created: input.created }),
  ...(input.changed === undefined ? {} : { changed: input.changed }),
  ...(input.items === undefined ? {} : { items: input.items }),
});
/** Answers that the payload would change nothing. */ export const unchanged = (input: { operationId: string; revision: string }): UnchangedOutcome => ({ outcome: "unchanged", operationId: echoedOperationId(input.operationId), revision: input.revision });
/** Answers that the caller's input is stale, carrying both the current value and the caller's preserved input so a surface can show them side by side and let someone decide. */
export function conflict(input: { operationId: string; currentRevision: string; current: unknown; preservedInput: unknown; reason: ConflictReason }): ConflictOutcome {
  return { outcome: "conflict", operationId: echoedOperationId(input.operationId), currentRevision: input.currentRevision, current: input.current, preservedInput: input.preservedInput, reason: input.reason };
}
/** Answers that the caller has no authority for this request. */ export const denied = (input: { operationId: string; reasonCode: DenialReason }): DeniedOutcome => redactDenial<DeniedOutcome>({ outcome: "denied", operationId: echoedOperationId(input.operationId), reasonCode: input.reasonCode });
function fieldMessagesFromIssues(error: ZodError): FieldMessages {
  const messages = new Map<string, string[]>();
  const report = (key: string, message: string): void => {
    const existing = messages.get(key);
    if (existing === undefined) {
      messages.set(key, [message]);
    } else if (!existing.includes(message)) existing.push(message);
  };
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      const holdingPath = issue.path.map((segment) => String(segment));
      for (const name of issue.keys) report([...holdingPath, name].join("."), `This request does not accept "${name}": every name it sends must be one the job declares, so remove it rather than having it silently ignored.`);
      continue;
    }
    report(issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((segment) => String(segment)).join("."), issue.message);
  }
  return Object.fromEntries(messages);
}
/** Answers that the payload failed validation, with per-field messages and no side effect. */ export function invalid(input: { operationId: string; fields: FieldMessages | ZodError }): InvalidOutcome {
  const fields = input.fields instanceof ZodError ? fieldMessagesFromIssues(input.fields) : input.fields;
  return { outcome: "invalid", operationId: echoedOperationId(input.operationId), fields };
}
/** The one answer a read gives when the request it was asked to serve is not one it admits: the caller's own query or segment is the fault, so the caller has to correct it. */
export const refusedRead = (operationId: string, fields: FieldMessages | ZodError): ReadResult<never> => ({ kind: "refused", refused: invalid({ operationId, fields }) });
/** Answers that the source behind the work is down. */ export const unavailable = (input: { operationId: string; source: SourceReference; guidance: string }): UnavailableOutcome => ({ outcome: "unavailable", operationId: echoedOperationId(input.operationId), source: input.source, guidance: input.guidance });
/** Answers that the effect may have been applied and the acknowledgement was lost. */ export const unknown = (input: { operationId: string }): UnknownOutcome => ({ outcome: "unknown", operationId: echoedOperationId(input.operationId) });
export const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";
const INVALID_SESSION_FAULT = "InvalidSessionIdError";
const SESSION_NOT_FOUND_FAULT = "SessionNotFoundError";
const FILESYSTEM_FAULT_CODE = /^E[A-Z]{2,}$/;
const STORE_RETRY_GUIDANCE = "The local synthetic store could not complete this request. Retry the same request with the same operation id: a replay returns the original result rather than repeating the effect. If it keeps failing, reset the development data from Settings and reopen the session.";
function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const read: unknown = Reflect.get(value, key);
    return typeof read === "string" ? read : undefined;
  } catch {
    return undefined;
  }
}
function storeFaultReference(error: unknown): string | undefined {
  const name = readStringProperty(error, "name");
  if (name === CORRUPT_DOCUMENT_FAULT) return name;
  const code = readStringProperty(error, "code");
  return code !== undefined && FILESYSTEM_FAULT_CODE.test(code) ? code : undefined;
}
/** Maps a store or medium fault onto the outage it is, or answers `undefined` for any other value. */ export function unavailableFromStoreFault(operationId: string, error: unknown): UnavailableOutcome | undefined {
  const reference = storeFaultReference(error);
  return reference === undefined ? undefined : unavailable({ operationId, source: { system: LOCAL_STORE_SYSTEM, reference }, guidance: STORE_RETRY_GUIDANCE });
}
/** Converts a caught value into the outcome a Route Handler may return. */ export function outcomeFromError(operationId: string, error: unknown): MutationOutcome {
  if (error instanceof ZodError) return invalid({ operationId, fields: error });
  if (readStringProperty(error, "name") === INVALID_SESSION_FAULT) return denied({ operationId, reasonCode: "session-unavailable" });
  if (readStringProperty(error, "name") === SESSION_NOT_FOUND_FAULT) return denied({ operationId, reasonCode: "session-unavailable" });
  const outage = unavailableFromStoreFault(operationId, error);
  return outage !== undefined ? outage : unknown({ operationId });
}
const DENIAL_REASON_SET: ReadonlySet<string> = new Set<string>(DENIAL_REASONS);
const isDenialReason = (value: unknown): value is DenialReason => typeof value === "string" && DENIAL_REASON_SET.has(value);
const isSourceReference = (value: unknown): value is SourceReference => isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
/** Reports whether a parsed value is a mutation outcome. */ export function isOutcome(value: unknown): value is MutationOutcome {
  if (!isRecord(value)) return false;
  const kind: unknown = value.outcome;
  if (typeof kind !== "string") return false;
  switch (kind) {
    case "accepted":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string";
    case "alreadyAccepted":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string" && "result" in value;
    case "unchanged":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string";
    case "conflict":
      return isNonEmptyString(value.operationId) && typeof value.currentRevision === "string" && (value.reason === "stale-revision" || value.reason === "changed-intent") && "current" in value && "preservedInput" in value;
    case "denied":
      return isNonEmptyString(value.operationId) && isDenialReason(value.reasonCode);
    case "invalid":
      return isNonEmptyString(value.operationId) && isRecord(value.fields);
    case "unavailable":
      return isNonEmptyString(value.operationId) && isSourceReference(value.source) && isNonEmptyString(value.guidance);
    case "unknown":
      return isNonEmptyString(value.operationId);
    default:
      return false;
  }
}
/** Reports whether a parsed value is a read result: an envelope, a denial, an outage or a refused request. */ export function isReadResult(value: unknown): value is ReadResult<unknown> {
  if (!isRecord(value)) return false;
  const kind: unknown = value.kind;
  if (typeof kind !== "string") return false;
  switch (kind) {
    case "envelope":
      return "envelope" in value;
    case "denied":
      return isOutcome(value.denied) && value.denied.outcome === "denied";
    case "unavailable":
      return isOutcome(value.unavailable) && value.unavailable.outcome === "unavailable";
    case "refused":
      return isOutcome(value.refused) && value.refused.outcome === "invalid";
    default:
      return false;
  }
}
