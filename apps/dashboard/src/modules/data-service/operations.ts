/**
 * The operation ledger and the one mutation runner every named mutation executes inside.
 *
 * Two responsibilities live here and nothing else. The **ledger** is the session's
 * `<sessionId>.operations.json` document: one immutable {@link OperationRecord} per `operationId`,
 * append-only, which is what makes every acceptance recoverable by operation identity. The
 * **runner** is {@link runMutation}: the single place the order of validation, authorisation, replay
 * detection, revision comparison, application, scope re-check and recording is written, so that no
 * `mutations/*` file can reorder it. This module does not own an outcome (`./outcome`), a record
 * shape (`./envelope`) or a permission decision (`./authorize`); it composes them.
 *
 * **The idempotency mechanism is one line of ordering.** The ledger entry is recorded *inside the
 * effect's own transaction*, so the change and its record are one write: a dropped acknowledgement
 * still leaves the entry that turns a replay into `alreadyAccepted` with the original result.
 * Recording the entry afterwards in a second transaction would leave exactly the window the
 * specification's `unknown` outcome describes, and would leave repeating the work under a fresh
 * identity as the only recovery.
 *
 * **This is not a command dispatcher.** {@link runMutation} takes a concrete payload `schema` and a
 * concrete `apply` function, both supplied by the one named mutation that calls it, and answers with
 * one of the closed outcomes. It takes no table name, no field map, no string-keyed operation table
 * and no capability registry, so there is no generic `execute(operation, payload)` entry point beside
 * it and no mutation can be invented at runtime. A mutation that needs a new effect gets a new named
 * method, never a new row in a table of effects.
 *
 * **The order the runner fixes, in this sequence and nowhere else:**
 *
 * 1. the four-field request envelope, then the payload, validated against the caller's schema — a
 *    failure answers `invalid` with per-field messages and performs no side effect;
 * 2. the session is resolved and the claimed scope asserted, then the mutation's own authority is
 *    asked — a failure answers `denied` with a reason code that reveals nothing;
 * 3. the intent is hashed and **one** store transaction is opened; inside it, `begin` decides
 *    `replay` (→ `alreadyAccepted`, no effect, no new revision) or `changed-intent` (→ `conflict`
 *    with the caller's payload preserved), and an absent entry is `fresh`;
 * 4. `expectedRevision` is compared with the target's current revision — a mismatch answers
 *    `conflict` with `reason: "stale-revision"`, the current value and the preserved input, with
 *    nothing written;
 * 5. `apply` runs, answering `{ changed: false }` (→ `unchanged`, no revision advance, no history or
 *    activity entry, nothing recorded) or `{ changed: true, … }`; a refusal it reached from the record
 *    (`{ refused }`) is returned with nothing written at all;
 * 6. the change's scope is re-checked against the scope it started from, then the ledger entry is
 *    recorded in that same transaction and the transaction commits;
 * 7. exactly one of the eight outcomes from `./outcome` is returned.
 *
 * **The stored document, and the seeded one.** This ledger keeps its entries in a `records` map
 * keyed by `operationId` and by nothing else: no composite key, no per-mutation bucket, no index by
 * intent, because the operation's own identity is the only thing a replay is recognised by. The
 * deterministic seed writes the same document in its other arrangement — an `entries` array, which is
 * the same information — so {@link readLedger} normalises either form and {@link record} always
 * writes the map. Recovery is therefore a lookup in a local JSON document, never a job: there is no
 * queue, outbox, event bus, scheduler, retry worker, webhook or provider client in this design, and
 * none is scaffolded here.
 *
 * **What it never does.** It reads no clock but the scenario clock (`@/modules/time/clock`), opens no
 * file (the store is reached only through `store/repository`), holds no randomness, writes no second
 * diagnostic, and lets no exception cross its boundary: a store or apply fault becomes the closed
 * set's `unavailable` or `unknown` through `outcomeFromError`, because those are the only honest
 * answers when the fate of an effect is not known.
 *
 * Layering: it imports `node:crypto`, `zod`, `@/lib/logger`, the store's transaction function, the
 * scenario clock, the failure plan, and its three sibling contracts `./authorize`, `./envelope` and
 * `./outcome`. It imports no component, feature or application route, and no store internals.
 *
 * Rule 1 obligations this file keeps. Clause 1: recovery is a lookup, and nothing here scaffolds a
 * deferred integration. Clause 2: one ledger, one runner, one hash and one transaction path, reusing
 * the existing helpers instead of declaring a second of anything. Clause 3: an undetermined effect
 * stays `unknown` and is recoverable by identity, a replay returns the original result with no
 * duplicate effect, a conflict preserves the caller's input, and a no-op is `unchanged` with no
 * history written.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { logger, type LogScope } from "@/lib/logger";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import type { SessionDocuments } from "@/modules/store/paths";
import { transact } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";

import {
  assertScopeUnder,
  assertScopeUnchangedUnder,
  outcomeOfRefusal,
  resolveSession,
  type ResolvedSession,
  type ScopeAuthority,
  type ScopeDecision,
  type SessionResolution,
} from "./authorize";
import {
  mutationInputSchema,
  operationRecordSchema,
  type MutationInput,
  type OperationRecord,
  type Scope,
} from "./envelope";
import {
  LOCAL_STORE_SYSTEM,
  accepted,
  alreadyAccepted,
  conflict,
  denied,
  invalid,
  outcomeFromError,
  unavailable,
  unchanged,
  unknown,
  type DeniedOutcome,
  type MutationOutcome,
  type MutationResult,
  type PerItemResult,
  type UnavailableOutcome,
} from "./outcome";

// ---------------------------------------------------------------------------------------------
// The ledger document
// ---------------------------------------------------------------------------------------------

/**
 * The version of the operations document this build writes and reads.
 *
 * It is the ledger document's own format marker, stated here because the ledger document is this
 * module's concern. The seeded empty document states the same version, so a freshly reset session and
 * a session that has accepted an operation are the same format.
 */
export const OPERATION_LEDGER_VERSION = 1;

/**
 * One session's operation ledger: its format version and one record per attempt that was accepted.
 *
 * `records` is keyed by `operationId` — the attempt's own identity, minted by the caller and never
 * derived from a payload, a clock or a counter — so a replay is recognised by identity alone. The
 * value type is `Readonly` because the document is append-only in meaning: {@link record} returns a
 * new document rather than mutating this one, so no caller can rewrite an accepted result.
 */
export interface OperationLedger {
  readonly version: number;
  readonly records: Readonly<Record<string, OperationRecord>>;
}

/**
 * The ledger of a session that has never mutated.
 *
 * A fresh object each call, so one caller appending to it cannot hand the same empty document to
 * every other caller in the process. Restoring this document is what a seed reset does, and it is
 * what makes the replay of any `operationId` a first attempt again.
 */
export function emptyLedger(): OperationLedger {
  return { version: OPERATION_LEDGER_VERSION, records: {} };
}

/**
 * Refusal raised when an attempt would rewrite an accepted ledger entry.
 *
 * Append-only is the property the whole recovery story rests on: overwriting an entry is precisely
 * how a replay would stop returning the original result, so a second record for one `operationId` is
 * refused as a defect rather than answered as an outcome. The runner converts it into the closed
 * set's `unknown`, never into a success and never into a silent overwrite.
 */
export class LedgerConflictError extends Error {
  /** The attempt identity that already has a recorded result. */
  readonly operationId: string;

  constructor(operationId: string) {
    super(
      `The operation ledger already holds a result for ${JSON.stringify(operationId)}, and an entry is never overwritten: a replay is answered from the stored record instead.`,
    );
    this.name = "LedgerConflictError";
    this.operationId = operationId;
    // Keeps `instanceof` working where a built-in subclass is downlevelled past ES2015 semantics.
    Object.setPrototypeOf(this, LedgerConflictError.prototype);
  }
}

/**
 * Refusal raised when a stored ledger document cannot be read as one.
 *
 * It carries what is wrong and never what the document holds: no path, no entry and no payload. The
 * runner answers it as `unavailable` for the local store, because a ledger that cannot be read is a
 * source that could not answer — and answering it as an empty ledger would silently permit a second
 * effect for an attempt that may already have been accepted.
 */
export class LedgerUnreadableError extends Error {
  /** Which part of the document could not be read, stated without quoting its contents. */
  readonly part: string;

  constructor(part: string) {
    super(
      `The operation ledger cannot be read: ${part}. Nothing was written, and the stored document is reported rather than replaced, because an unreadable ledger cannot prove an attempt has not already been accepted.`,
    );
    this.name = "LedgerUnreadableError";
    this.part = part;
    Object.setPrototypeOf(this, LedgerUnreadableError.prototype);
  }
}

/** Reports whether a value is a plain object, as a stored JSON object is once decoded. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one stored entry, refusing rather than dropping anything unusable.
 *
 * The record schema `./envelope` declares is the only validator: this module never re-states an
 * entry's shape, so a field added to a record reaches the ledger with it.
 */
function readEntry(value: unknown): OperationRecord {
  const parsed = operationRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new LedgerUnreadableError("a stored entry is not an operation record");
  }
  return parsed.data;
}

/**
 * Adds one entry to a records map being assembled, refusing a repeated `operationId`.
 *
 * The map is the document this module writes, so a document that already holds two entries for one
 * identity was not written by this ledger and cannot be read as if it were.
 */
function collectEntry(records: Record<string, OperationRecord>, entry: OperationRecord): void {
  if (Object.hasOwn(records, entry.operationId)) {
    throw new LedgerUnreadableError("the document records one operation id twice");
  }
  records[entry.operationId] = entry;
}

/**
 * Reads a stored operations document as a ledger, in either arrangement it can be found in.
 *
 * {@link record} writes the `records` map keyed by `operationId`. The deterministic seed writes the
 * same entries as an `entries` array, which is the same information in the other arrangement, so
 * both read alike: a session that was just seeded and a session that has accepted operations behave
 * identically. An absent document reads as {@link emptyLedger}; anything present that is not a
 * usable ledger is refused rather than read as empty, because reading it as empty would let a
 * possibly-accepted attempt be applied a second time.
 */
export function readLedger(value: unknown): OperationLedger {
  if (value === undefined) {
    return emptyLedger();
  }
  if (!isPlainObject(value)) {
    throw new LedgerUnreadableError("the document is not an object");
  }

  const version: unknown = value.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new LedgerUnreadableError("the document states no integer format version");
  }
  if (version !== OPERATION_LEDGER_VERSION) {
    throw new LedgerUnreadableError(
      `the document states format version ${String(version)}, and this build reads version ${String(OPERATION_LEDGER_VERSION)}`,
    );
  }

  const records: Record<string, OperationRecord> = {};

  const map: unknown = value.records;
  if (map !== undefined) {
    if (!isPlainObject(map)) {
      throw new LedgerUnreadableError("the records member is not an object keyed by operation id");
    }
    for (const [operationId, stored] of Object.entries(map)) {
      const entry = readEntry(stored);
      if (entry.operationId !== operationId) {
        throw new LedgerUnreadableError(
          "a records member disagrees with the operation id it is keyed by",
        );
      }
      collectEntry(records, entry);
    }
  }

  const entries: unknown = value.entries;
  if (entries !== undefined) {
    if (!Array.isArray(entries)) {
      throw new LedgerUnreadableError("the entries member is not an array of operation records");
    }
    for (const stored of entries) {
      collectEntry(records, readEntry(stored));
    }
  }

  return { version, records };
}

// ---------------------------------------------------------------------------------------------
// begin, record, lookup — pure over the document
// ---------------------------------------------------------------------------------------------

/**
 * What an attempt's identity means before anything is applied.
 *
 * `fresh` is an identity the ledger has never seen; `replay` is the same identity presented with the
 * same intent, which answers from the stored record and applies nothing; `changed-intent` is the same
 * identity presented with a different intent, which is a conflict because one attempt id names one
 * attempt.
 */
export type BeginResult =
  | { readonly state: "fresh" }
  | { readonly state: "replay"; readonly record: OperationRecord }
  | { readonly state: "changed-intent"; readonly record: OperationRecord };

/**
 * Reads an attempt's identity against the ledger: absent → `fresh`, same intent → `replay`,
 * different intent → `changed-intent`, and nothing else.
 *
 * No heuristic stands beside that decision. A payload that merely looks like an earlier one is a new
 * attempt and gets a new effect, because only the caller's `operationId` says which attempt this is.
 */
export function begin(
  ledger: OperationLedger,
  operationId: string,
  intentHash: string,
): BeginResult {
  const stored = lookup(ledger, operationId);
  if (stored === undefined) {
    return { state: "fresh" };
  }
  return stored.intentHash === intentHash
    ? { state: "replay", record: stored }
    : { state: "changed-intent", record: stored };
}

/**
 * Appends one accepted attempt to the ledger, returning the new document.
 *
 * Append-only: an `operationId` that already has a record is refused with {@link
 * LedgerConflictError}, never replaced, because the stored result is what a replay has to return.
 * The returned document is new and the argument is untouched, so a caller holding the previous
 * document — a transaction's own copy, or a read's — cannot observe a half-applied append.
 */
export function record(ledger: OperationLedger, entry: OperationRecord): OperationLedger {
  if (Object.hasOwn(ledger.records, entry.operationId)) {
    throw new LedgerConflictError(entry.operationId);
  }
  return {
    version: ledger.version,
    records: { ...ledger.records, [entry.operationId]: entry },
  };
}

/**
 * The recorded result of one attempt, or `undefined` when the ledger holds none.
 *
 * This is the only read path a "check the result" action uses: an uncertain outcome is resolved by
 * re-querying the identity it carries, which is why uncertainty never turns into a repeat under a
 * new identity.
 */
export function lookup(ledger: OperationLedger, operationId: string): OperationRecord | undefined {
  return Object.hasOwn(ledger.records, operationId) ? ledger.records[operationId] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Intent identity
// ---------------------------------------------------------------------------------------------

/**
 * The canonical serialisation a hash is taken over: object keys sorted at every depth.
 *
 * Sorted keys are what make the digest independent of the order a caller happened to build its
 * payload in, so the same intent always hashes the same. Arrays keep their order, because a list's
 * order is part of what the caller meant. A member whose value is `undefined` is dropped exactly as
 * `JSON.stringify` drops it, so a payload that survives a JSON round trip hashes identically before
 * and after the trip.
 *
 * Values canonical JSON cannot carry — a bigint, a function, a symbol, a non-finite number — are
 * written as a token that is deliberately not valid JSON, so two such payloads never collide with a
 * real value's serialisation and the function stays total: it never throws on a payload that reached
 * it from JavaScript without the compiler's help.
 */
function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "<non-finite-number>";
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      const members: string[] = [];
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        const member = record[key];
        if (member === undefined) {
          continue;
        }
        members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
      }
      return `{${members.join(",")}}`;
    }
    default:
      return `<unsupported:${typeof value}>`;
  }
}

/**
 * The intent of one attempt, as a SHA-256 hex digest.
 *
 * `{ scope, expectedRevision, payload }` is exactly what makes two attempts the same attempt: the
 * same authority, the same revision seen and the same requested change. A different payload under an
 * unchanged identity is a different intent and answers `conflict`, so this hash is what keeps an
 * `operationId` from being quietly reused for other work. There is no salt, no clock and no
 * randomness in it, so the same intent hashes the same on every machine and in every run.
 */
export function intentHash(scope: Scope, expectedRevision: string, payload: unknown): string {
  const intent = canonicalJson({ scope, expectedRevision, payload });
  return createHash("sha256").update(intent, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------------------------
// The runner's contract
// ---------------------------------------------------------------------------------------------

/**
 * The name of a named mutation, as the failure plan and the diagnostic line know it.
 *
 * The names are the service's own inventory (`saveGoal`, `logInteraction`, `publishVariants`, …).
 * This module never enumerates them: a name is a label the caller states for diagnostics and for the
 * armed failure plan, and a closed union here would be a second inventory of the mutations that would
 * drift from the one the service exposes.
 */
export type MutationName = string;

/**
 * The target a change applies to, as the runner needs it before applying anything.
 *
 * `record` states the revision the record now stands at and the current value a conflict reports
 * beside the caller's preserved input. `absent` states that the change creates a record rather than
 * replacing one, so there is no stored revision a stale expectation could overwrite — which is why a
 * creation compares no revision.
 */
export type CurrentTarget =
  | { readonly kind: "record"; readonly revision: string; readonly value: unknown }
  | { readonly kind: "absent" };

/** The revision a target stands at when there is no stored record to compare against. */
const ABSENT_TARGET_REVISION = "no-target";

/**
 * The revision a deliberately advanced record would stand at, for the armed changed-revision failure.
 *
 * Deterministic and never equal to a revision this application mints, so the comparison that follows
 * is a genuine comparison whose result is a genuine `conflict` — the demonstration runs the real
 * check rather than short-circuiting it.
 */
function advancedRevision(revision: string): string {
  return `${revision}#advanced`;
}

/**
 * What an `apply` callback is given: the transaction's documents, the authoritative session and the
 * target's current revision.
 *
 * All three are mandatory, and the type states them as members rather than arguments so a callback
 * that omits one fails to compile. The callback mutates `docs` in place inside the transaction, which
 * is why the runner can re-check the produced scope and record the ledger entry in the same write.
 */
export interface MutationContext {
  /** The session's documents inside the open transaction; mutations of this draft are the effect. */
  readonly docs: SessionDocuments;
  /** The authoritative session the change acts for, resolved from the development-session cookie. */
  readonly session: ResolvedSession;
  /** The revision the target stood at before the change, which `apply` presents back as its result. */
  readonly currentRevision: string;
  /**
   * The attempt identity the caller supplied, so an `apply` that refuses after reading the record can
   * answer with the same operation id every other outcome carries.
   *
   * A refusal is the one outcome an `apply` may build itself, and every constructor in `./outcome`
   * requires this identity. Supplying it here is what keeps a refusal recoverable and attributable
   * rather than a second, anonymously built answer.
   */
  readonly operationId: string;
}

/**
 * What `apply` answers: nothing to do, the change it made, or a refusal it reached only by reading the
 * record the change acts on.
 *
 * `{ changed: false }` is a real answer and not an error: the payload would produce no change, so the
 * runner answers `unchanged`, advances no revision, writes no history or activity entry and records
 * nothing. `{ changed: true }` must state the new `revision` and the opaque `result` a replay returns
 * verbatim, so the stored result is exactly what the first caller was told.
 *
 * `{ refused }` exists because some questions can only be answered from the record, and the record is
 * readable only inside the transaction: whether this caller is the side of the relationship a command
 * belongs to, whether the episode it addresses is still open, and whether the value it presents is
 * still current. Those answers must be able to be `denied`, `conflict` or `invalid` — with no effect,
 * no revision advance and no ledger entry — rather than being flattened into `unchanged`, which would
 * report a refusal as though nothing needed doing. The refusal travels as one of the closed outcomes,
 * so the caller reads it exactly as it reads a refusal the runner itself produced.
 *
 * The identifier list a caller changed is named `changedIds` because `changed` is this union's own
 * discriminant: one property carries one meaning at this boundary. `scope` is the context the change
 * produced, and stating it is how the runner re-checks that a write never moves a record into a
 * context the caller cannot see; omitting it means the change kept the scope it started from.
 */
export type ApplyResult<R extends MutationResult> =
  | { readonly changed: false }
  | { readonly refused: MutationOutcome }
  | {
      readonly changed: true;
      /** The revision the record now stands at, presented back by the next write. */
      readonly revision: string;
      /** The opaque result a replay returns byte for byte. */
      readonly result: R;
      /** Identifiers the operation created, in the order the mutation reports them. */
      readonly created?: readonly string[];
      /** Identifiers the operation changed. */
      readonly changedIds?: readonly string[];
      /** Per-item results for an operation that acts on rows. */
      readonly items?: readonly PerItemResult[];
      /** The context the change produced, when it can differ from the one it started from. */
      readonly scope?: Scope;
    };

/**
 * One named mutation's request to the runner.
 *
 * Every member is supplied by the one mutation that owns the job: a concrete payload schema, a
 * concrete authority question, an optional locator for the target's current revision, and a concrete
 * apply function. Nothing here names a table, a field map or an operation, which is the difference
 * between this helper and the universal dispatcher the release forbids.
 */
export interface MutationPlan<P, R extends MutationResult> {
  /** The session the change acts for: its store documents and its transaction lock are keyed by it. */
  readonly sessionId: string;
  /** The four-field request as it arrived; untrusted until the schema below has read it. */
  readonly input: MutationInput<P>;
  /** The payload's own schema, which decides whether the request is well formed. */
  readonly schema: z.ZodType<P>;
  /** The mutation's name, used by the armed failure plan and by the diagnostic line. */
  readonly name: MutationName;
  /**
   * The mutation's own authority question, asked after the claimed scope has been asserted.
   *
   * It answers with `authorize.ts`'s `ScopeDecision` so a refusal travels in the one shape every
   * denial uses — a reason code that names the caller's relationship and nothing it asked about.
   */
  readonly authorize: (session: ResolvedSession) => ScopeDecision;
  /**
   * What this mutation's authority to act in the claimed scope is derived from.
   *
   * Omitted, it is `membership`: the caller must be admitted to the organisation, ministry and support
   * subject it claims, which is every worker action. A mutation a principal performs under a grant
   * rather than a membership — the coach's own acceptance and departure — states `grant` instead, so
   * the claimed scope must still name the session's own principal and the session must still be
   * admitting, while the ministry membership is the one thing that is not required. That refusal would
   * otherwise make the coach's two writes unreachable, because a coach holds no membership and must
   * not be given one; what the grant itself admits is decided by the mutation's own `apply`, which can
   * read the record inside the transaction.
   */
  readonly scopeAuthority?: ScopeAuthority;
  /**
   * Locates the target's current revision, for the optimistic-concurrency comparison.
   *
   * Absent for a mutation whose only effect is to create a record, because a creation has no stored
   * revision a stale expectation could overwrite. A mutation that changes an existing record states
   * it, and its `record` answer is what makes a stale `expectedRevision` a `conflict`.
   */
  readonly readCurrent?: (docs: SessionDocuments) => CurrentTarget;
  /**
   * Which pass of a multi-pass mutation this call is: the attempt that answers the caller, or a probe.
   *
   * A `probe` pass is one a module runs only to establish what its own answering pass may depend on —
   * that the envelope and payload are well formed, the caller holds the authority, the attempt is not a
   * replay, the revision is current and the record it would rewrite is readable. Its `apply` answers
   * `{ changed: false }`, so the runner's `unchanged` is a carry-on signal that sends the module on to
   * the change, not the answer the caller received. A probe pass therefore writes no diagnostic line for
   * `unchanged`, and writes its line for every other outcome, because every other outcome is the answer
   * the caller received and so is the one line this attempt gets.
   *
   * Defaults to `attempt`: the pass whose outcome is the caller's answer, and the only pass a mutation
   * that runs once performs.
   */
  readonly diagnosticPass?: "attempt" | "probe";
  /** The change itself, run inside the transaction with the documents, the session and the revision. */
  readonly apply: (context: MutationContext) => ApplyResult<R> | Promise<ApplyResult<R>>;
}

/**
 * Carries a refusal out of an open transaction without writing anything.
 *
 * `store/repository` writes nothing when a transaction callback throws, which is the only way to undo
 * a change an `apply` has already made to the draft. The runner throws this after the post-apply scope
 * re-check refuses, catches it at its own boundary and answers with the denial it carries, so the
 * denial is a normal outcome and never an exception the caller sees.
 */
class MutationRefused extends Error {
  /** The denial the transaction is unwound for. */
  readonly outcome: MutationOutcome;

  constructor(outcome: MutationOutcome) {
    super(`The change was refused after it was applied: ${outcome.outcome}.`);
    this.name = "MutationRefused";
    this.outcome = outcome;
    Object.setPrototypeOf(this, MutationRefused.prototype);
  }
}

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

/** The attempt identity a request that states no usable one is answered and logged under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The attempt identity a request carries, read without trusting its type.
 *
 * A body arrives from a browser, so the runner reads the identity structurally before validation
 * rather than assuming the declared type holds. A request that states none is answered under
 * {@link UNIDENTIFIED_ATTEMPT}: it is invalid either way, and the caller still needs a field-level
 * answer rather than a thrown error.
 */
function attemptIdOf(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}

/**
 * The four identifiers a request claims to be acting in, for the diagnostic line only.
 *
 * It is read best-effort before validation, so an attempt refused for a malformed envelope is still
 * traceable to a context; an identity that is not a non-empty string yields `undefined` and the line
 * is skipped. These identifiers are claims at this point, never authority: nothing here authorises
 * anything, and the store's own scope check is what decides.
 */
function claimedScope(input: unknown): LogScope | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const scope: unknown = Reflect.get(input, "scope");
  if (typeof scope !== "object" || scope === null) {
    return undefined;
  }
  const organizationId: unknown = Reflect.get(scope, "organizationId");
  const ministryId: unknown = Reflect.get(scope, "ministryId");
  const supportSubjectId: unknown = Reflect.get(scope, "supportSubjectId");
  const principalId: unknown = Reflect.get(scope, "principalId");
  if (
    typeof organizationId !== "string" ||
    organizationId.length === 0 ||
    typeof ministryId !== "string" ||
    ministryId.length === 0 ||
    typeof supportSubjectId !== "string" ||
    supportSubjectId.length === 0 ||
    typeof principalId !== "string" ||
    principalId.length === 0
  ) {
    return undefined;
  }
  return { organizationId, ministryId, supportSubjectId, principalId };
}

/**
 * The scope an authorised attempt is logged under: the context it claimed, with the principal that acted.
 *
 * A request's `scope` is a claim and never authority: an identifier that looks like another persona's
 * establishes neither identity nor authority, and the session the request carried is what establishes
 * it. So once the session has resolved, the line names the session's own principal — the persona that
 * acted, and therefore the one a refusal is attributable to — while the three context identifiers stay
 * the ones the attempt claimed, because that context is what the attempt was evaluated against. Until
 * the session resolves there is no authenticated principal to name, and an attempt refused before that
 * point carries the claim as it stands rather than an invented actor.
 */
function diagnosticScopeFor(claimed: LogScope, session: ResolvedSession): LogScope {
  return { ...claimed, principalId: session.principalId };
}

/**
 * The session a mutation acts for, or the outcome that refuses it.
 *
 * The refusing half is the outcome rather than a reason code, so the runner answers with exactly the
 * fact the resolver established: a denial when the request names no stored session, and the store's
 * own outage when the store is what could not answer.
 */
type SessionForMutation =
  | { readonly ok: true; readonly session: ResolvedSession }
  | { readonly ok: false; readonly outcome: DeniedOutcome | UnavailableOutcome };

/**
 * Resolves the authoritative session for one attempt.
 *
 * The development-session cookie is the identity a request carries, so it is the first and ordinary
 * path. A caller that holds a session id and no request scope — the domain and integration tests that
 * prove isolation by naming a seeded session, an operational script — is served by the named path
 * `authorize.ts` gates to a development build; in a production build that path refuses, and the
 * cookie's own refusal stands. Whichever path answers, the session it resolves must be the session the
 * caller named: acting for another session is refused rather than written into.
 *
 * A store that could not answer outranks a denial whichever path reached it. The request's own refusal
 * is the authoritative fact there — the named path may have been asked for an id this attempt never
 * resolved, and answering that as a denial would tell the caller they lack access to a store that never
 * replied.
 */
async function sessionForMutation(
  sessionId: string,
  operationId: string,
): Promise<SessionForMutation> {
  let fromRequest: SessionResolution | undefined;
  try {
    fromRequest = await resolveSession();
  } catch {
    // `next/headers` has no request to read outside a request scope, which is a test or a script
    // rather than a browser: the named path below serves it.
    fromRequest = undefined;
  }

  const requestRefusal =
    fromRequest === undefined || fromRequest.ok ? undefined : fromRequest.refusal;

  if (fromRequest !== undefined && fromRequest.ok) {
    return fromRequest.session.sessionId === sessionId
      ? { ok: true, session: fromRequest.session }
      : { ok: false, outcome: denied({ operationId, reasonCode: "not-admitted" }) };
  }

  try {
    const named = await resolveSession({ sessionId });
    if (named.ok) {
      return { ok: true, session: named.session };
    }
    return {
      ok: false,
      outcome: outcomeOfRefusal(
        requestRefusal?.kind === "unavailable" ? requestRefusal : named.refusal,
        operationId,
      ),
    };
  } catch {
    // Naming a session directly is refused outside a development build, and a refusal to name one is
    // not a session: the request cookie's own answer is the honest one.
    return {
      ok: false,
      outcome:
        requestRefusal === undefined
          ? denied({ operationId, reasonCode: "session-unavailable" })
          : outcomeOfRefusal(requestRefusal, operationId),
    };
  }
}

/** The target of a change that creates a record rather than replacing one. */
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };

/**
 * What an unreadable ledger tells the person to do: it never offers to repeat the write.
 *
 * An unreadable ledger means the attempt cannot be proven applied or unapplied, so the guidance names
 * the source and a recovery that rebuilds the documents rather than repeating the write.
 */
const LEDGER_UNAVAILABLE_GUIDANCE =
  "Reload the page to read this session's operation ledger again; if it stays unreadable, reset the development seed, which rebuilds the session documents deterministically.";

/**
 * Runs one named mutation and answers with exactly one of the eight outcomes.
 *
 * This is the only place the order in this file's header is written. A `mutations/*` file that
 * validated its own payload, compared its own revision or wrote its own ledger entry would be a
 * second implementation of the same contract, and the `mutation-contract` test is written to catch
 * it. The arguments are the mutation's own schema and its own apply function, never a table name or a
 * field map, so there is nothing here to dispatch on.
 *
 * Every refusal is a returned outcome; every fault is converted at this boundary. Nothing is thrown
 * to the caller, because an exception is a defect rather than a presentation, and a caller can act
 * only on a value from the closed set.
 */
export async function runMutation<P, R extends MutationResult>(
  plan: MutationPlan<P, R>,
): Promise<MutationOutcome> {
  const startedAt = performance.now();
  const operationId = attemptIdOf(plan.input);
  let diagnosticScope = claimedScope(plan.input);

  /**
   * Logs the attempt once, after its outcome is known, and returns the outcome unchanged.
   *
   * The line carries the operation id, the scope, the outcome's name and the elapsed time — no
   * payload, no note body, no email address, no amount. An attempt whose scope cannot be read is not
   * logged rather than logged in a narrower shape, because the line is closed and a partial one would
   * describe the attempt in the wrong context.
   *
   * This is the only writer of the one attempt line, so the stream counts attempts and states the
   * outcome each caller received. Its `principalId` is the session's own principal once the session has
   * resolved, and the claim only for an attempt refused before it could be. A `probe` pass's
   * `unchanged` is the one outcome that writes no line, because it is a carry-on signal for the module
   * that asked rather than the caller's answer: the line for that attempt, if it has one, is the probe's
   * line for the outcome that answered instead.
   */
  const report = (outcome: MutationOutcome): MutationOutcome => {
    const elapsedMs = performance.now() - startedAt;
    const carriedOn = plan.diagnosticPass === "probe" && outcome.outcome === "unchanged";
    if (diagnosticScope !== undefined && !carriedOn) {
      logger.mutation({
        operationId,
        scope: diagnosticScope,
        outcome: outcome.outcome,
        elapsedMs,
      });
    }
    if (outcome.outcome === "unavailable") {
      logger.sourceUnavailable({ job: plan.name, source: outcome.source });
    }
    return outcome;
  };

  // 1. The four-field envelope, then the payload. A failure here has read nothing and changed
  // nothing, and its messages are keyed by the payload's own field paths so a form can place them.
  const envelope = mutationInputSchema(z.unknown()).safeParse(plan.input);
  if (!envelope.success) {
    return report(invalid({ operationId, fields: envelope.error }));
  }
  const parsedPayload = plan.schema.safeParse(envelope.data.payload);
  if (!parsedPayload.success) {
    return report(invalid({ operationId, fields: parsedPayload.error }));
  }
  const input: MutationInput<P> = { ...envelope.data, payload: parsedPayload.data };
  diagnosticScope = input.scope;

  // 2. The session this request acts for, the scope it claims, then the mutation's own authority.
  // Authorisation precedes everything a record question could disclose: a refusal here carries a
  // reason code and no count, title, existence flag or size.
  const authority = await sessionForMutation(plan.sessionId, operationId);
  if (!authority.ok) {
    return report(authority.outcome);
  }
  const session = authority.session;
  // From here the attempt has an authenticated actor, so the line names it: the claim is what the
  // attempt asked to act in, and the session is who acted. Both stay distinct on the line, which is
  // what lets a refusal be attributed to the persona it happened to.
  diagnosticScope = diagnosticScopeFor(diagnosticScope, session);
  const scopeAuthority = plan.scopeAuthority ?? "membership";
  const scopeDecision = assertScopeUnder(session, input.scope, scopeAuthority);
  if (!scopeDecision.ok) {
    return report(denied({ operationId, reasonCode: scopeDecision.denial.reasonCode }));
  }
  const permission = plan.authorize(session);
  if (!permission.ok) {
    return report(denied({ operationId, reasonCode: permission.denial.reasonCode }));
  }

  // 3 to 7 happen inside one transaction, so the check, the effect and the ledger entry are one write
  // under that session's lock.
  const intent = intentHash(input.scope, input.expectedRevision, input.payload);

  try {
    const outcome = await transact<MutationOutcome>(plan.sessionId, async (docs) => {
      // The stored plan is read through the development runtime's one reader and consulted by this
      // mutation's own name; the read layer asks the same reader and the same `failureFor`, so no
      // second mechanism decides whether a failure is armed.
      const armed = failureFor(failurePlanOfDocument(docs.meta), "mutation", plan.name);
      if (armed === "denied") {
        // `denied` is the one mode the registry arms on reads today, so a mutation reaches this branch
        // only if a plan naming a mutation with it ever becomes readable. It answers with the denial
        // `authorize.ts` gives — the same shape, the same absence of any fact about the record — and
        // rebuilds it with this attempt's own operation id rather than the read marker.
        return denied({ operationId, reasonCode: "no-permission" });
      }

      // 3. The attempt's identity, decided against the ledger inside the transaction so the check and
      // the append below cannot be separated by another writer.
      const ledger = readLedger(docs.operations);
      const begun = begin(ledger, operationId, intent);

      const target = plan.readCurrent?.(docs) ?? ABSENT_TARGET;
      const targetRevision = target.kind === "record" ? target.revision : ABSENT_TARGET_REVISION;
      const targetValue = target.kind === "record" ? target.value : null;
      // What an answer reports as the current revision: the record's own revision when there is one,
      // and otherwise the revision the caller stated — a creation whose record this boundary cannot
      // locate changed nothing, so the caller's own token is the honest answer.
      const reportedRevision = target.kind === "record" ? target.revision : input.expectedRevision;

      if (begun.state === "replay") {
        // No new effect and no new revision: the stored result is the answer, so a caller that lost
        // the first response recovers exactly what it was told. The entry carries what the accepted
        // answer reported — the change's own revision and the identifiers it created or changed — so
        // the replay states those rather than the revision the caller presented with the request. An
        // entry written before an answer stored them falls back to the target's current revision.
        return alreadyAccepted({
          operationId,
          revision: begun.record.revision ?? reportedRevision,
          // The ledger holds the opaque value it was given; every result written to it came from an
          // `ApplyResult<R>` whose `R` is constrained to `MutationResult`, so the stored value is one.
          result: begun.record.result as MutationResult,
          ...(begun.record.created === undefined ? {} : { created: begun.record.created }),
          ...(begun.record.changed === undefined ? {} : { changed: begun.record.changed }),
          ...(begun.record.items === undefined ? {} : { items: begun.record.items }),
        });
      }
      if (begun.state === "changed-intent") {
        // One attempt identity means one attempt. The stored record proves the id was used, so a
        // different intent under it is a conflict rather than a second effect.
        return conflict({
          operationId,
          currentRevision: reportedRevision,
          current: targetValue,
          preservedInput: input.payload,
          reason: "changed-intent",
        });
      }

      // 4. Optimistic concurrency. A creation compares no revision, because there is no stored value a
      // stale expectation could overwrite. The armed changed-revision failure compares against a
      // deliberately advanced revision, so its answer is a genuine conflict, not a fabricated one.
      const comparedRevision =
        armed === "conflict" ? advancedRevision(targetRevision) : targetRevision;
      const comparisonApplies = target.kind === "record" || armed === "conflict";
      if (comparisonApplies && input.expectedRevision !== comparedRevision) {
        return conflict({
          operationId,
          currentRevision: comparedRevision,
          current: targetValue,
          preservedInput: input.payload,
          reason: "stale-revision",
        });
      }

      // 5. The change itself, applied to this transaction's draft.
      const applied = await plan.apply({
        docs,
        session,
        currentRevision: targetRevision,
        operationId,
      });
      if ("refused" in applied) {
        // A refusal the mutation reached only after reading the record: nothing was applied, no
        // revision advanced and no ledger entry is written, so the caller's input is preserved and the
        // effect is absent rather than merely unreported.
        return applied.refused;
      }
      if (!applied.changed) {
        // Nothing needed doing: no revision advance, no history or activity entry, nothing recorded.
        return unchanged({ operationId, revision: reportedRevision });
      }

      // A write re-checks the scope it started from and the one it produced, so a change can never
      // move a record into a context the caller cannot see. Throwing is how a draft is discarded: the
      // store writes nothing when this callback throws.
      const scopeHeld = assertScopeUnchangedUnder(
        session,
        input.scope,
        applied.scope ?? input.scope,
        scopeAuthority,
      );
      if (!scopeHeld.ok) {
        throw new MutationRefused(denied({ operationId, reasonCode: scopeHeld.denial.reasonCode }));
      }

      // 6. The ledger entry is recorded in this same transaction: the effect and its record are one
      // write, which is the whole of the replay guarantee. The entry stores what the answer reports
      // beside the result, so a replay states the change's own revision and identifiers rather than
      // the revision token the caller presented.
      const entry: OperationRecord = {
        operationId,
        intentHash: intent,
        scope: input.scope,
        outcome: "accepted",
        result: applied.result,
        revision: applied.revision,
        ...(applied.created === undefined ? {} : { created: applied.created }),
        ...(applied.changedIds === undefined ? {} : { changed: applied.changedIds }),
        ...(applied.items === undefined ? {} : { items: applied.items }),
        at: now().toString(),
      };
      docs.operations = record(ledger, entry);

      const appliedOutcome = accepted({
        operationId,
        revision: applied.revision,
        created: applied.created,
        changed: applied.changedIds,
        items: applied.items,
      });

      // 7. The armed lost acknowledgement answers after the commit: the effect and its ledger entry are
      // stored and the response is withheld, so replaying the same operation id recovers the result
      // and exactly one effect exists.
      return armed === "unknown" ? unknown({ operationId }) : appliedOutcome;
    });

    return report(outcome);
  } catch (error) {
    if (error instanceof MutationRefused) {
      return report(error.outcome);
    }
    if (error instanceof LedgerUnreadableError) {
      // The ledger belongs to the local store, so an unreadable one is a source that could not
      // answer: `unavailable` names it and offers recovery, never a repeat of the write.
      return report(
        unavailable({
          operationId,
          source: { system: LOCAL_STORE_SYSTEM, reference: "operations-ledger" },
          guidance: LEDGER_UNAVAILABLE_GUIDANCE,
        }),
      );
    }
    return report(outcomeFromError(operationId, error));
  }
}
