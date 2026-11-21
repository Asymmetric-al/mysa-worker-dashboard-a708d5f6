/**
 * The closed set of mutation outcomes, the constructors that produce them, and the two guards that
 * read one back off the wire. The one HTTP response they map to is `response.ts`.
 */
import { ZodError } from "zod";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { redactDenial } from "@/lib/redaction";
/** The source system name an `unavailable` outcome carries when the local synthetic store itself could not complete the request. */
export const LOCAL_STORE_SYSTEM = "local-store";
/** A value that survives a JSON round trip unchanged. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [field: string]: JsonValue };
/** The opaque payload a mutation chooses to return: created identifiers, per-item results, a receipt, an import summary. */
export type MutationResult = JsonValue;
/** The result for one row of an operation that acts on several items at once. */
export type PerItemResult<State extends string = string> = {
  readonly targetId: string;
  readonly state: State;
  readonly revision?: string;
  readonly reasonCode?: string;
  readonly reason?: string;
};
/** The closed set of denial reason codes. */
export const DENIAL_REASONS = ["not-admitted", "no-membership", "no-permission", "no-export-permission", "no-protected-grant", "capability-absent", "session-expired", "session-unavailable"] as const;
/** One reason a caller may be denied; a member of the closed list above. */
export type DenialReason = (typeof DENIAL_REASONS)[number];
/** The two ways a caller's input can be stale: the record moved, or the same id carried new intent. */
export type ConflictReason = "stale-revision" | "changed-intent";
/** Validation messages keyed by field path, as `invalid` carries them: `fields["name.first"]` holds every message for that path. */
export type FieldMessages = Readonly<Record<string, readonly string[]>>;
/** The key under which an issue with no path is reported. */
export const ROOT_FIELD_KEY = "_root";
/** The operation was applied exactly once; `revision` is what the record now stands at. */
export type AcceptedOutcome = {
  readonly outcome: "accepted";
  readonly operationId: string;
  readonly revision: string;
  readonly created?: readonly string[];
  readonly changed?: readonly string[];
  readonly items?: readonly PerItemResult[];
};
/** The same `operationId` arrived again with the same intent, so the stored result is returned and nothing new happens: no second effect and no new revision, which is what makes a lost. */
export type AlreadyAcceptedOutcome = {
  readonly outcome: "alreadyAccepted";
  readonly operationId: string;
  readonly revision: string;
  readonly result: MutationResult;
  readonly created?: readonly string[];
  readonly changed?: readonly string[];
  readonly items?: readonly PerItemResult[];
};
/** The payload would produce no change, so no history or activity entry was written. */
export type UnchangedOutcome = {
  readonly outcome: "unchanged";
  readonly operationId: string;
  readonly revision: string;
};
/** The caller's expected revision, or the intent behind its `operationId`, no longer matches. */
export type ConflictOutcome = {
  readonly outcome: "conflict";
  readonly operationId: string;
  readonly currentRevision: string;
  readonly current: unknown;
  readonly preservedInput: unknown;
  readonly reason: ConflictReason;
};
/** The caller has no authority for this request. */
export type DeniedOutcome = {
  readonly outcome: "denied";
  readonly operationId: string;
  readonly reasonCode: DenialReason;
};
/** The payload failed validation; messages are keyed by field path and nothing was changed. */
export type InvalidOutcome = {
  readonly outcome: "invalid";
  readonly operationId: string;
  readonly fields: FieldMessages;
};
/** The source behind the work is down. */
export type UnavailableOutcome = {
  readonly outcome: "unavailable";
  readonly operationId: string;
  readonly source: SourceReference;
  readonly guidance: string;
};
/** The effect may or may not have been applied and the acknowledgement was lost. */
export type UnknownOutcome = {
  readonly outcome: "unknown";
  readonly operationId: string;
};
/** Everything a mutation may answer with: exactly eight members, discriminated on `outcome`. */
export type MutationOutcome = AcceptedOutcome | AlreadyAcceptedOutcome | UnchangedOutcome | ConflictOutcome | DeniedOutcome | InvalidOutcome | UnavailableOutcome | UnknownOutcome;
/** What a read answers with: the scoped envelope, or the reason it could not be built. */
export type ReadResult<T> =
  | { readonly kind: "envelope"; readonly envelope: T }
  | { readonly kind: "denied"; readonly denied: DeniedOutcome }
  | { readonly kind: "unavailable"; readonly unavailable: UnavailableOutcome };
/** Answers that the operation was applied exactly once. */
export function accepted(input: { operationId: string; revision: string; created?: readonly string[]; changed?: readonly string[]; items?: readonly PerItemResult[] }): AcceptedOutcome {
  return {
    outcome: "accepted",
    operationId: input.operationId,
    revision: input.revision,
    // Absent optional fields are omitted rather than set to `undefined`, so the object in memory
    // has exactly the shape the body carries over the wire: a surface that asks `"items" in
    // outcome` gets a true answer only when the operation really reported per-item results.
    ...(input.created === undefined ? {} : { created: input.created }),
    ...(input.changed === undefined ? {} : { changed: input.changed }),
    ...(input.items === undefined ? {} : { items: input.items }),
  };
}
/** Answers a replay: the same `operationId` with the same intent returns the stored result, with no new effect and no new revision. */
export function alreadyAccepted(input: {
  operationId: string;
  revision: string;
  result: MutationResult;
  created?: readonly string[];
  changed?: readonly string[];
  items?: readonly PerItemResult[];
}): AlreadyAcceptedOutcome {
  return {
    outcome: "alreadyAccepted",
    operationId: input.operationId,
    revision: input.revision,
    result: input.result,
    // Absent members are omitted rather than set to `undefined`, so a replay's body has the same
    // shape as the accepted body it stands in for.
    ...(input.created === undefined ? {} : { created: input.created }),
    ...(input.changed === undefined ? {} : { changed: input.changed }),
    ...(input.items === undefined ? {} : { items: input.items }),
  };
}
/** Answers that the payload would change nothing. */
export function unchanged(input: { operationId: string; revision: string }): UnchangedOutcome {
  return { outcome: "unchanged", operationId: input.operationId, revision: input.revision };
}
/** Answers that the caller's input is stale, carrying both the current value and the caller's preserved input so a surface can show them side by side and let someone decide. */
export function conflict(input: { operationId: string; currentRevision: string; current: unknown; preservedInput: unknown; reason: ConflictReason }): ConflictOutcome {
  return {
    outcome: "conflict",
    operationId: input.operationId,
    currentRevision: input.currentRevision,
    current: input.current,
    preservedInput: input.preservedInput,
    reason: input.reason,
  };
}
/** Answers that the caller has no authority for this request. */
export function denied(input: { operationId: string; reasonCode: DenialReason }): DeniedOutcome {
  return redactDenial<DeniedOutcome>({
    outcome: "denied",
    operationId: input.operationId,
    reasonCode: input.reasonCode,
  });
}
function fieldMessagesFromIssues(error: ZodError): FieldMessages {
  // A field path is the caller's own text, so it may name a member of `Object.prototype` or be
  // `__proto__` itself. Accumulating in a map keeps every path an ordinary key: a plain object would
  // answer `constructor` with the inherited function, and assigning `__proto__` would change the
  // object's prototype rather than record a message, so a refusal for either name would escape this
  // function as a throw instead of arriving as the `invalid` outcome.
  const messages = new Map<string, string[]>();
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((segment) => String(segment)).join(".");
    const existing = messages.get(key);
    if (existing === undefined) {
      messages.set(key, [issue.message]);
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return Object.fromEntries(messages);
}
/** Answers that the payload failed validation, with per-field messages and no side effect. */
export function invalid(input: { operationId: string; fields: FieldMessages | ZodError }): InvalidOutcome {
  const fields = input.fields instanceof ZodError ? fieldMessagesFromIssues(input.fields) : input.fields;
  return { outcome: "invalid", operationId: input.operationId, fields };
}
/** Answers that the source behind the work is down. */
export function unavailable(input: { operationId: string; source: SourceReference; guidance: string }): UnavailableOutcome {
  return {
    outcome: "unavailable",
    operationId: input.operationId,
    source: input.source,
    guidance: input.guidance,
  };
}
/** Answers that the effect may have been applied and the acknowledgement was lost. */
export function unknown(input: { operationId: string }): UnknownOutcome {
  return { outcome: "unknown", operationId: input.operationId };
}
/** The store fault raised for a session document that exists but cannot be decoded. */
export const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

const INVALID_SESSION_FAULT = "InvalidSessionIdError";

const SESSION_NOT_FOUND_FAULT = "SessionNotFoundError";

const FILESYSTEM_FAULT_CODE = /^E[A-Z]{2,}$/;

const STORE_RETRY_GUIDANCE =
  "The local synthetic store could not complete this request. Retry the same request with the same operation id: a replay returns the original result rather than repeating the effect. If it keeps failing, reset the development data from Settings and reopen the session.";
function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  try {
    const read: unknown = Reflect.get(value, key);
    return typeof read === "string" ? read : undefined;
  } catch {
    return undefined;
  }
}
function storeFaultReference(error: unknown): string | undefined {
  const name = readStringProperty(error, "name");
  if (name === CORRUPT_DOCUMENT_FAULT) {
    return name;
  }
  const code = readStringProperty(error, "code");
  if (code !== undefined && FILESYSTEM_FAULT_CODE.test(code)) {
    return code;
  }
  return undefined;
}
/** Maps a store or medium fault onto the outage it is, or answers `undefined` for any other value. */
export function unavailableFromStoreFault(operationId: string, error: unknown): UnavailableOutcome | undefined {
  const reference = storeFaultReference(error);
  if (reference === undefined) {
    return undefined;
  }
  return unavailable({
    operationId,
    source: { system: LOCAL_STORE_SYSTEM, reference },
    guidance: STORE_RETRY_GUIDANCE,
  });
}
/** Converts a caught value into the outcome a Route Handler may return. */
export function outcomeFromError(operationId: string, error: unknown): MutationOutcome {
  if (error instanceof ZodError) {
    return invalid({ operationId, fields: error });
  }
  if (readStringProperty(error, "name") === INVALID_SESSION_FAULT) {
    return denied({ operationId, reasonCode: "session-unavailable" });
  }
  if (readStringProperty(error, "name") === SESSION_NOT_FOUND_FAULT) {
    // Raised before the transaction opened a draft or wrote a document, so the effect definitively
    // did not happen and `unknown` would assert that it might have. `unavailable` would call the
    // store down and invite a retry, but the store answered: it holds no such session, and asking
    // again cannot create one.
    return denied({ operationId, reasonCode: "session-unavailable" });
  }
  const outage = unavailableFromStoreFault(operationId, error);
  if (outage !== undefined) {
    return outage;
  }
  return unknown({ operationId });
}
const DENIAL_REASON_SET: ReadonlySet<string> = new Set<string>(DENIAL_REASONS);

function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && DENIAL_REASON_SET.has(value);
}
function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}
/** Reports whether a parsed value is a mutation outcome. */
export function isOutcome(value: unknown): value is MutationOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const kind: unknown = value.outcome;
  if (typeof kind !== "string") {
    return false;
  }
  switch (kind) {
    case "accepted":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string";
    case "alreadyAccepted":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string" && "result" in value;
    case "unchanged":
      return isNonEmptyString(value.operationId) && typeof value.revision === "string";
    case "conflict":
      return (
        isNonEmptyString(value.operationId) &&
        typeof value.currentRevision === "string" &&
        (value.reason === "stale-revision" || value.reason === "changed-intent") &&
        "current" in value &&
        "preservedInput" in value
      );
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
/** Reports whether a parsed value is a read result: an envelope, a denial or an outage. */
export function isReadResult(value: unknown): value is ReadResult<unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const kind: unknown = value.kind;
  if (typeof kind !== "string") {
    return false;
  }
  switch (kind) {
    case "envelope":
      return "envelope" in value;
    case "denied":
      return isOutcome(value.denied) && value.denied.outcome === "denied";
    case "unavailable":
      return isOutcome(value.unavailable) && value.unavailable.outcome === "unavailable";
    default:
      return false;
  }
}
