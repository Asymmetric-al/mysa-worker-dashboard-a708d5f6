/**
 * The closed set of mutation outcomes, the constructors that produce them, and the one mapping
 * from an outcome to an HTTP response.
 *
 * Every named mutation in the data service answers with exactly one of the eight outcomes below,
 * and every Route Handler turns that answer into a response through `toResponse`. There is no ninth
 * member and no second ladder: a handler that invented its own status mapping, or a mutation that
 * answered with a boolean, would reintroduce the ambiguity this module exists to remove. The eight
 * members are the contract because each states something genuinely different about what is true
 * after a request:
 *
 * - `accepted` — applied once, with the new revision.
 * - `alreadyAccepted` — the same `operationId` replayed: the stored result, no new effect, no new
 *   revision.
 * - `unchanged` — nothing needed doing, so nothing happened and no history entry was written.
 * - `conflict` — the expected revision or the intent is stale, and the caller's input is preserved
 *   beside the current value for comparison.
 * - `denied` — the caller has no authority, and the answer reveals nothing about what it may not
 *   see.
 * - `invalid` — the payload failed validation: per-field messages and no side effect.
 * - `unavailable` — the source behind the work is down; never an empty list and never a zero.
 * - `unknown` — the effect may have been applied and the acknowledgement was lost. The
 *   `operationId` is the only recovery handle, so the outcome promises neither success nor failure.
 *
 * Publication, provider acceptance, delivery and reading are four separate outcomes that the
 * audience and content modules model for themselves. None of them is a mutation outcome, and none
 * may be folded into one: a `delivered` or `read` member here would let a surface claim that a
 * message was read because a mutation succeeded.
 *
 * `ReadResult` lives here rather than beside the request envelope for one structural reason. A read
 * cannot answer with a bare envelope when it is denied or when its source is unavailable: a denial
 * must carry no count, title, existence flag or size, and an absent source must never be presented
 * as an empty list or a zero. Declaring both contracts in this file keeps `outcome.ts` and
 * `envelope.ts` acyclic — the envelope module may import this one, never the reverse — which is
 * also why nothing here refers to the envelope's shape. `readMediaAsset` is the one documented
 * exception: it answers with bytes rather than an envelope, so it carries no `ReadResult`.
 *
 * The status mapping is fixed and uniform. `denied` is always 403, whether or not the record
 * exists, because a 404-for-missing / 403-for-hidden pair is an existence oracle: a caller could
 * enumerate hidden records from the status code alone. `unknown` is 202 in the other direction —
 * the status says the request was understood and its fate is not known, so a client may not read it
 * as success — and `unavailable` is 503 carrying the source identity and retry guidance, so a
 * surface can name which source is down instead of showing a zero.
 *
 * Plan items that put this file in scope: AAP 0.7.1 (the four-field mutation input and this closed
 * outcome set), 0.3.2 (one authorised data path whose outcome the UI renders durably), 0.6.1 and
 * 0.11.1 (`modules/data-service/{index,envelope,outcome,operations,authorize}.ts`), 0.12.5 (the
 * injected failures whose recovery depends on `conflict` and `unknown` staying distinct) and 0.15.1
 * (a thrown exception is a defect, not a presentation: a fault becomes `unavailable` and an
 * unrecognised failure becomes `unknown`).
 *
 * Layering: this module reaches nothing but the framework-free helpers it reuses and the two fixed
 * stack packages it needs. It imports no store, service, component or feature; it reads no clock,
 * performs no I/O, writes no diagnostic and carries no payload of its own. Nothing here decides
 * whether a caller *may* do something — authorisation happens before an outcome is built — so the
 * only authority this file exercises is over what a denial is allowed to say.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { SourceReference } from "@/lib/ids";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";

/**
 * The source system name an `unavailable` outcome carries when the local synthetic store itself
 * could not complete the request. The store is the only writable state this application owns, so
 * this is the one source this module can name without knowing which future owner a read consulted.
 */
export const LOCAL_STORE_SYSTEM = "local-store";

/**
 * A value that survives a JSON round trip unchanged. Constraining a payload to this type is what
 * lets it be written to the operation ledger and read back as the same value on a replay, so a
 * stored result never depends on a class instance, a `Date`, a `Map` or a function surviving.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [field: string]: JsonValue };

/**
 * The opaque payload a mutation chooses to return: created identifiers, per-item results, a
 * receipt, an import summary. It is deliberately not specified further — the operation that owns
 * the result is the only place that knows its shape — but it is held to `JsonValue` so the ledger
 * can store it and a replay can return it byte for byte.
 */
export type MutationResult = JsonValue;

/**
 * The result for one row of an operation that acts on several items at once.
 *
 * The state vocabulary belongs to the mutation that owns it and stays closed there, so four
 * different jobs never collapse into one word: bulk task actions use `accepted | unchanged |
 * excluded | failed`, import rows use `accepted | already-accepted | skipped | needs-review |
 * failed`, and a per-variant release uses `released | failed | needs-attention`. Widening the
 * default `State` here would erase that distinction; a mutation narrows it at its own boundary.
 *
 * `reason` is what a person reads; `reasonCode` is what a surface switches on. Neither may carry a
 * private value — a per-item reason says why an item was left alone, never what it contained.
 */
export type PerItemResult<State extends string = string> = {
  readonly targetId: string;
  readonly state: State;
  readonly revision?: string;
  readonly reasonCode?: string;
  readonly reason?: string;
};

/**
 * The closed set of denial reason codes.
 *
 * Each code describes the caller's relationship to the request, never the thing requested: no code
 * may name a record, a count, a title, a size or an existence flag, because a denial that answered
 * "not found" differently from "not permitted" would let a caller enumerate what it cannot see.
 * `session-expired` and `session-unavailable` are here because a session that cannot be established
 * is answered as a denial: it carries no authority, and retry advice would ask the caller to repeat
 * a request that can never succeed.
 */
export const DENIAL_REASONS = [
  "not-admitted",
  "no-membership",
  "no-permission",
  "no-export-permission",
  "no-protected-grant",
  "capability-absent",
  "session-expired",
  "session-unavailable",
] as const;

/** One reason a caller may be denied; a member of the closed list above. */
export type DenialReason = (typeof DENIAL_REASONS)[number];

/** The two ways a caller's input can be stale: the record moved, or the same id carried new intent. */
export type ConflictReason = "stale-revision" | "changed-intent";

/**
 * Validation messages keyed by field path, as `invalid` carries them: `fields["name.first"]` holds
 * every message for that path. A form-level issue that names no field is keyed `ROOT_FIELD_KEY`.
 */
export type FieldMessages = Readonly<Record<string, readonly string[]>>;

/**
 * The key under which an issue with no path is reported. Schema-level problems (a payload that is
 * not an object at all) belong to the form rather than to a field, and the form still has to render
 * them, so they need one stable key that can never collide with a real field path.
 */
export const ROOT_FIELD_KEY = "_root";

/** The operation was applied exactly once; `revision` is what the record now stands at. */
export type AcceptedOutcome = {
  readonly outcome: "accepted";
  readonly operationId: string;
  readonly revision: string;
  /** Identifiers the operation created, in the order the mutation reports them. */
  readonly created?: readonly string[];
  /** Identifiers the operation changed. */
  readonly changed?: readonly string[];
  /** Per-item results for an operation that acts on rows; absent when the operation has one effect. */
  readonly items?: readonly PerItemResult[];
};

/**
 * The same `operationId` arrived again with the same intent, so the stored result is returned and
 * nothing new happens: no second effect and no new revision, which is what makes a lost
 * acknowledgement recoverable instead of a reason to send the work again.
 *
 * `revision` and the three identifier members are the ones the accepted answer reported, not the
 * caller's request: a client recovering from a lost acknowledgement reads from a replay the same
 * new revision, created identifiers, changed identifiers and per-item results it would have read
 * from the answer it never received.
 */
export type AlreadyAcceptedOutcome = {
  readonly outcome: "alreadyAccepted";
  readonly operationId: string;
  readonly revision: string;
  readonly result: MutationResult;
  /** Identifiers the operation created, as the accepted answer stated them. */
  readonly created?: readonly string[];
  /** Identifiers the operation changed, as the accepted answer stated them. */
  readonly changed?: readonly string[];
  /** Per-item results, as the accepted answer stated them. */
  readonly items?: readonly PerItemResult[];
};

/** The payload would produce no change, so no history or activity entry was written. */
export type UnchangedOutcome = {
  readonly outcome: "unchanged";
  readonly operationId: string;
  readonly revision: string;
};

/**
 * The caller's expected revision, or the intent behind its `operationId`, no longer matches. Both
 * the current value and the caller's preserved input travel back, because a conflict must never
 * silently replace work someone did: the comparison is the point.
 */
export type ConflictOutcome = {
  readonly outcome: "conflict";
  readonly operationId: string;
  readonly currentRevision: string;
  readonly current: unknown;
  readonly preservedInput: unknown;
  readonly reason: ConflictReason;
};

/**
 * The caller has no authority for this request. The shape is identical whether or not the record
 * exists, and the reason code describes the relationship rather than the record, so the outcome
 * cannot be used to learn that something exists.
 */
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

/**
 * The source behind the work is down. `source` names it and `guidance` says what to do next, so a
 * surface can report the outage instead of presenting the absence of data as an empty list or a
 * zero. An unavailable source is never a successful read of nothing.
 */
export type UnavailableOutcome = {
  readonly outcome: "unavailable";
  readonly operationId: string;
  readonly source: SourceReference;
  readonly guidance: string;
};

/**
 * The effect may or may not have been applied and the acknowledgement was lost. The `operationId`
 * is the only recovery handle — the caller re-queries or replays the same id — and the outcome
 * makes no claim in either direction, which is why uncertainty never turns into a resend.
 */
export type UnknownOutcome = {
  readonly outcome: "unknown";
  readonly operationId: string;
};

/**
 * Everything a mutation may answer with: exactly eight members, discriminated on `outcome`. Any
 * ninth member would have to name a genuinely different fact; a state that belongs to a domain
 * (accepted by a provider, delivered, read, withdrawn) belongs to that domain's model instead.
 */
export type MutationOutcome =
  | AcceptedOutcome
  | AlreadyAcceptedOutcome
  | UnchangedOutcome
  | ConflictOutcome
  | DeniedOutcome
  | InvalidOutcome
  | UnavailableOutcome
  | UnknownOutcome;

/**
 * What a read answers with: the scoped envelope, or the reason it could not be built.
 *
 * The two failure branches carry no envelope at all rather than an empty one, so a denied read
 * cannot leak a count, a title, an existence flag or a size, and an absent source cannot be
 * rendered as "nothing was found". `T` is the envelope type the caller expects, supplied by
 * `envelope.ts` at the call site; this module never needs to know its shape.
 */
export type ReadResult<T> =
  | { readonly kind: "envelope"; readonly envelope: T }
  | { readonly kind: "denied"; readonly denied: DeniedOutcome }
  | { readonly kind: "unavailable"; readonly unavailable: UnavailableOutcome };

/**
 * Answers that the operation was applied exactly once.
 *
 * The new `revision` is mandatory: a caller that changed a record has to say what the record now
 * stands at, so the next write can present it as its expected revision.
 */
export function accepted(input: {
  operationId: string;
  revision: string;
  created?: readonly string[];
  changed?: readonly string[];
  items?: readonly PerItemResult[];
}): AcceptedOutcome {
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

/**
 * Answers a replay: the same `operationId` with the same intent returns the stored result, with no
 * new effect and no new revision. The stored result is what the original call answered with, so a
 * caller that lost the first response recovers the same identifiers it would have had — the change's
 * own revision, the identifiers it created or changed and any per-item results, never the revision
 * the caller happened to present with the request.
 */
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

/**
 * Answers that the payload would change nothing. No history entry and no activity record is
 * written, which is what keeps an idempotent repeat from looking like work someone did.
 */
export function unchanged(input: { operationId: string; revision: string }): UnchangedOutcome {
  return { outcome: "unchanged", operationId: input.operationId, revision: input.revision };
}

/**
 * Answers that the caller's input is stale, carrying both the current value and the caller's
 * preserved input so a surface can show them side by side and let someone decide. The input is
 * preserved even for a changed-intent reuse of an `operationId`, because the caller's work is the
 * one thing a conflict must never discard.
 */
export function conflict(input: {
  operationId: string;
  currentRevision: string;
  current: unknown;
  preservedInput: unknown;
  reason: ConflictReason;
}): ConflictOutcome {
  return {
    outcome: "conflict",
    operationId: input.operationId,
    currentRevision: input.currentRevision,
    current: input.current,
    preservedInput: input.preservedInput,
    reason: input.reason,
  };
}

/**
 * Answers that the caller has no authority for this request.
 *
 * Every denial passes through `redactDenial` on its way out, here and again in `toResponse`. The
 * three fields a denial carries are not on the denial key list, so the pass changes nothing today;
 * it is the mechanical guarantee that a field added to this outcome later cannot carry an
 * existence flag, a count, a title or a size by accident.
 */
export function denied(input: { operationId: string; reasonCode: DenialReason }): DeniedOutcome {
  return redactDenial<DeniedOutcome>({
    outcome: "denied",
    operationId: input.operationId,
    reasonCode: input.reasonCode,
  });
}

/**
 * Turns a Zod error into the path-keyed messages `invalid` carries.
 *
 * Zod 4's public accessors are used deliberately: `issues` and each issue's `path`. A path of
 * segments is joined with dots, which is how a form and a field component address the same field,
 * and an issue with no path belongs to the form under `ROOT_FIELD_KEY`. Identical messages for one
 * path are reported once, so a repeated rule does not read as several failures.
 */
function fieldMessagesFromIssues(error: ZodError): FieldMessages {
  const messages: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key =
      issue.path.length === 0
        ? ROOT_FIELD_KEY
        : issue.path.map((segment) => String(segment)).join(".");
    const existing = messages[key];
    if (existing === undefined) {
      messages[key] = [issue.message];
    } else if (!existing.includes(issue.message)) {
      existing.push(issue.message);
    }
  }
  return messages;
}

/** The envelope member a request body's payload hangs off, as a whole-body schema names it. */
const PAYLOAD_FIELD_PATH = "payload";

/** The path a field inside the payload arrives under when the whole request body was validated. */
const PAYLOAD_FIELD_PREFIX = `${PAYLOAD_FIELD_PATH}.`;

/**
 * Re-keys an `invalid` body's fields onto the payload the caller posted, which is the convention
 * every form in this tree already renders: the media picker's field labels are `placement.altText`
 * and `probe.width`, the import mapper reads `byField.confirmedMapping`, and the hooks that
 * pre-validate a payload themselves (`use-save-goal`, `use-follow-up-task`) answer with the payload's
 * own paths. A handler that validated the whole request body reports the same input as
 * `payload.title`, so the transport is the outlier and this is the one place that reconciles it.
 *
 * A path beginning `payload.` loses that prefix and nothing else changes. The bare path `payload`
 * names the payload object as a whole rather than a control, so it becomes `ROOT_FIELD_KEY`: a
 * form-level issue, which is the answer the service already gives for the same input. Every other
 * key is an envelope-level refusal or a payload-relative key the service produced, and passes through
 * untouched. Order is kept — keys in the order they arrived, each key's messages in their own order,
 * and two source keys that collapse onto one append the later messages rather than replace them.
 */
function payloadRelativeFields(fields: FieldMessages): FieldMessages {
  const messages: Record<string, string[]> = {};
  for (const [path, pathMessages] of Object.entries(fields)) {
    let key = path;
    if (key === PAYLOAD_FIELD_PATH) {
      key = ROOT_FIELD_KEY;
    } else if (key.startsWith(PAYLOAD_FIELD_PREFIX)) {
      key = key.slice(PAYLOAD_FIELD_PREFIX.length);
    }
    const existing = messages[key];
    if (existing === undefined) {
      messages[key] = [...pathMessages];
    } else {
      for (const message of pathMessages) {
        if (!existing.includes(message)) {
          existing.push(message);
        }
      }
    }
  }
  return messages;
}

/**
 * Answers that the payload failed validation, with per-field messages and no side effect.
 *
 * It takes either a Zod error or a map the caller built itself, so a mutation that has already
 * normalised its messages and one that catches a parse failure both answer through one shape.
 */
export function invalid(input: {
  operationId: string;
  fields: FieldMessages | ZodError;
}): InvalidOutcome {
  const fields =
    input.fields instanceof ZodError ? fieldMessagesFromIssues(input.fields) : input.fields;
  return { outcome: "invalid", operationId: input.operationId, fields };
}

/**
 * Answers that the source behind the work is down. The source identity and the guidance travel
 * with the outcome so a surface reports the outage instead of rendering the missing data as an
 * empty list or a zero.
 */
export function unavailable(input: {
  operationId: string;
  source: SourceReference;
  guidance: string;
}): UnavailableOutcome {
  return {
    outcome: "unavailable",
    operationId: input.operationId,
    source: input.source,
    guidance: input.guidance,
  };
}

/**
 * Answers that the effect may have been applied and the acknowledgement was lost. The
 * `operationId` is the recovery handle: the caller re-queries or replays it. This constructor
 * cannot be used to express success or failure, because the outcome states neither.
 */
export function unknown(input: { operationId: string }): UnknownOutcome {
  return { outcome: "unknown", operationId: input.operationId };
}

/**
 * Turns an outcome — or a read result — into the one HTTP response a Route Handler returns.
 *
 * This is the only status ladder in the application. A handler that mapped an outcome itself would
 * be a second policy for the same contract, and the two would eventually disagree about whether a
 * lost acknowledgement is a success.
 *
 * Three properties of the mapping are deliberate and must not be "tidied":
 *
 * - `denied` is 403 for every denial, with the same body shape whether or not the record exists,
 *   because 404-versus-403 is an existence oracle.
 * - `unknown` is 202 and carries the `operationId`; the body promises neither success nor failure.
 * - `unavailable` is 503 and carries `{ system, reference }` plus retry guidance, so a surface can
 *   name the source that is down rather than showing an empty list or a zero.
 *
 * Bodies are the outcome objects themselves — never `{ ok: true }` or `{ data }` wrappers — so the
 * union's discriminant is the contract a client switches on. No caching directive is set on a
 * mutation response: the response is not reusable at all, and a policy header here would be a
 * second, contradictory statement of that.
 *
 * Field keys on an `invalid` body are relative to the payload the caller posted, never to the
 * envelope it arrived in: `fieldErrorsFromInvalid` attaches each message to the control that carried
 * the value, so `title` and `placement.altText` are the keys a form renders. A schema that validated
 * the whole request body reports that same input as `payload.title`, and the prefix is what this
 * mapping removes. An envelope-level refusal keeps its own name (`operationId`, `scope`,
 * `expectedRevision`), and an issue with the payload as a whole — which names no control and belongs
 * to the form — is keyed `ROOT_FIELD_KEY` like every other form-level issue.
 *
 * A read result flattens onto the wire, because the status already discriminates it: 200 carries
 * the envelope itself, 403 the denial and 503 the outage. The `kind` wrapper belongs to the
 * in-process value a read returns, which is what `isReadResult` narrows; a client that has a
 * response reads the status first and then `isOutcome` for the two failure bodies.
 */
export function toResponse(
  input: MutationOutcome | ReadResult<unknown>,
  init?: { headers?: HeadersInit },
): Response {
  const headers = new Headers(init?.headers);
  // Stated explicitly rather than relied on: a body carrying a person's name, a currency code or
  // a right-to-left string must be decoded as UTF-8 by every client, including curl.
  headers.set("content-type", "application/json; charset=utf-8");

  if (isReadResult(input)) {
    switch (input.kind) {
      case "envelope":
        // An envelope is scope-dependent private data whose staleness would break whole-query
        // agreement, so it is never stored by an intermediary or a browser cache.
        headers.set("cache-control", "no-store");
        return NextResponse.json(input.envelope === undefined ? null : input.envelope, {
          status: 200,
          headers,
        });
      case "denied":
        return respond(input.denied, headers);
      case "unavailable":
        return respond(input.unavailable, headers);
      default:
        return assertNever(input, "Unhandled read result");
    }
  }

  return respond(input, headers);
}

/**
 * The one status ladder, reached from both arms of `toResponse` so a denial or an outage carries
 * exactly the status it would carry as a bare outcome.
 *
 * The grouped cases are not an accident: `accepted`, `alreadyAccepted` and `unchanged` are three
 * different facts that share one status, and they keep their separate discriminants in the body so
 * a client still distinguishes "applied now" from "applied earlier" from "nothing to do".
 */
function respond(outcome: MutationOutcome, headers: Headers): Response {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unchanged":
      return NextResponse.json(outcome, { status: 200, headers });
    case "conflict":
      return NextResponse.json(outcome, { status: 409, headers });
    case "denied":
      // Redacted once more on the way out: a denial built by hand, without the constructor, still
      // cannot carry an existence flag, a count, a title or a size.
      return NextResponse.json(redactDenial(outcome), { status: 403, headers });
    case "invalid":
      // Field keys are re-based onto the payload the caller posted at the one boundary every
      // mutation response crosses, so a handler that validated the whole body and a service that
      // validated the payload alone answer with one convention.
      return NextResponse.json(
        { ...outcome, fields: payloadRelativeFields(outcome.fields) },
        { status: 422, headers },
      );
    case "unavailable":
      return NextResponse.json(outcome, { status: 503, headers });
    case "unknown":
      return NextResponse.json(outcome, { status: 202, headers });
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}

/**
 * The store fault raised when a session document exists but cannot be decoded.
 *
 * Exported because it is the one name {@link outcomeFromError} maps to `unavailable`, and a mutation
 * module that refuses a document it cannot read is stating the same condition one layer up. A caller
 * that restates the literal instead of importing it is how one of them comes to drift and answer
 * `unknown` for a fault the store itself reports honestly.
 */
export const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

/** The store fault raised for a session id that cannot name a document; refused, never repaired. */
const INVALID_SESSION_FAULT = "InvalidSessionIdError";

/** The store fault raised for a session id that names no stored session; a transaction never creates one. */
const SESSION_NOT_FOUND_FAULT = "SessionNotFoundError";

/**
 * The filesystem fault codes that describe the store's own medium rather than the caller's input:
 * a missing directory, a full disk, a permission denial, an I/O error. A coding fault carries an
 * `ERR_*` code instead and is deliberately not matched here, because it means a defect rather than
 * an outage and the honest answer to it is `unknown`.
 */
const FILESYSTEM_FAULT_CODE = /^E[A-Z]{2,}$/;

/**
 * What a caller is told when the store could not complete the request. It names the retry that is
 * safe — the same operation id, which a replay answers with the stored result — instead of inviting
 * a second attempt at the effect.
 */
const STORE_RETRY_GUIDANCE =
  "The local synthetic store could not complete this request. Retry the same request with the same operation id: a replay returns the original result rather than repeating the effect. If it keeps failing, reset the development data from Settings and reopen the session.";

/**
 * Reads a string-valued property from a caught value without assuming it is a well-behaved
 * `Error`. The read is guarded because this function runs inside a handler's failure path, where a
 * throwing getter or an exotic object must not become a second failure.
 */
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

/**
 * Recognises a store or medium fault and answers with the opaque marker that identifies it.
 *
 * The store's own fault classes are matched by name rather than by `instanceof`, because this
 * module may not import the store: the data service is the only layer that reaches it, and a
 * structural check keeps that direction intact. The marker is the fault's name or code — never a
 * path, never a document's contents — so an `unavailable` outcome identifies the source without
 * disclosing what it holds.
 */
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

/**
 * Converts a caught value into the outcome a Route Handler may return.
 *
 * A thrown exception is a defect, not a presentation (AAP 0.15.1), so this function has exactly
 * four honest answers and no fifth:
 *
 * - a validation error that escaped the service is still a validation error, reported as `invalid`
 *   with per-field messages (validation is supposed to return `invalid` without throwing, so this
 *   branch is defensive rather than expected);
 * - a store or medium fault becomes `unavailable`, naming the store and the retry that is safe;
 * - a session that cannot be established becomes `denied`, because it yields no authority and no
 *   retry can change that: a session id that cannot name a document and a session the store does
 *   not hold are answered alike, since neither becomes authoritative by being asked for again;
 * - anything unrecognised becomes `unknown`, carrying the `operationId` and nothing else, because
 *   when the fate of the effect is not known, success and failure are both lies.
 *
 * No payload, note body, email address or amount is ever placed in the outcome, and nothing here
 * logs: the diagnostic belongs to `@/lib/logger`, which redacts on its own terms.
 */
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
  const reference = storeFaultReference(error);
  if (reference !== undefined) {
    return unavailable({
      operationId,
      source: { system: LOCAL_STORE_SYSTEM, reference },
      guidance: STORE_RETRY_GUIDANCE,
    });
  }
  return unknown({ operationId });
}

/** The closed denial vocabulary as a lookup, so a parsed body's reason code is checked rather than trusted. */
const DENIAL_REASON_SET: ReadonlySet<string> = new Set<string>(DENIAL_REASONS);

/** Narrows an untrusted value to one of the closed denial reason codes. */
function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && DENIAL_REASON_SET.has(value);
}

/** Narrows an untrusted value to a source identity with both of its parts present. */
function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}

/**
 * Reports whether a parsed value is a mutation outcome.
 *
 * This is how a client hook and a Route Handler narrow a JSON body without a type assertion. The
 * switch below reads an untrusted string rather than a union, so its final `return false` is the
 * correct closing branch — `assertNever` belongs to the exhaustive switches over `MutationOutcome`
 * in `respond`, where a ninth member must fail to compile.
 */
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
      return (
        isNonEmptyString(value.operationId) &&
        typeof value.revision === "string" &&
        "result" in value
      );
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
      return (
        isNonEmptyString(value.operationId) &&
        isSourceReference(value.source) &&
        isNonEmptyString(value.guidance)
      );
    case "unknown":
      return isNonEmptyString(value.operationId);
    default:
      return false;
  }
}

/**
 * Reports whether a parsed value is a read result: an envelope, a denial or an outage.
 *
 * The envelope branch requires the `envelope` key to be present, so a truncated body is rejected
 * rather than read as a read that found nothing — the distinction this whole union exists to keep.
 */
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
