/** The operation ledger and the one mutation runner every named mutation executes inside. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { logger, type LogScope } from "@/lib/logger";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import type { SessionDocumentKey, SessionDocuments } from "@/modules/store/paths";
import { transact } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import { assertScopeUnder, assertScopeUnchangedUnder, outcomeOfRefusal, resolveSession, type ResolvedSession, type ScopeAuthority, type ScopeDecision, type SessionResolution } from "./authorize";
import { mutationInputSchema, operationRecordSchema, type MutationInput, type OperationRecord, type Scope } from "./envelope";
import { LOCAL_STORE_SYSTEM, UNIDENTIFIED_ATTEMPT, accepted, alreadyAccepted, conflict, denied, invalid, outcomeFromError, unavailable, unchanged, unknown, type DeniedOutcome, type MutationOutcome, type MutationResult, type PerItemResult, type UnavailableOutcome } from "./outcome";
export const OPERATION_LEDGER_VERSION = 1;
export type OperationLedger = { readonly version: number; readonly records: Readonly<Record<string, OperationRecord>> };
/** The ledger of a session that has never mutated. */
export const emptyLedger = (): OperationLedger => ({ version: OPERATION_LEDGER_VERSION, records: {} });
export class LedgerConflictError extends Error {
  readonly operationId: string;
  constructor(operationId: string) {
    super(`The operation ledger already holds a result for ${JSON.stringify(operationId)}, and an entry is never overwritten: a replay is answered from the stored record instead.`);
    this.name = "LedgerConflictError";
    this.operationId = operationId;
    // Keeps `instanceof` working where a built-in subclass is downlevelled past ES2015 semantics.
    Object.setPrototypeOf(this, LedgerConflictError.prototype);
  }
}
/** Refusal raised when a stored ledger document cannot be read as one. */
export class LedgerUnreadableError extends Error {
  readonly part: string;
  constructor(part: string) {
    super(`The operation ledger cannot be read: ${part}. Nothing was written, and the stored document is reported rather than replaced, because an unreadable ledger cannot prove an attempt has not already been accepted.`);
    this.name = "LedgerUnreadableError";
    this.part = part;
    Object.setPrototypeOf(this, LedgerUnreadableError.prototype);
  }
}
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function readEntry(value: unknown): OperationRecord {
  const parsed = operationRecordSchema.safeParse(value);
  if (!parsed.success) throw new LedgerUnreadableError("a stored entry is not an operation record");
  return parsed.data;
}
function collectEntry(records: Record<string, OperationRecord>, entry: OperationRecord): void {
  if (Object.hasOwn(records, entry.operationId)) throw new LedgerUnreadableError("the document records one operation id twice");
  records[entry.operationId] = entry;
}
/** Reads a stored operations document as a ledger, in either arrangement it can be found in. */
export function readLedger(value: unknown): OperationLedger {
  if (value === undefined) return emptyLedger();
  if (!isPlainObject(value)) throw new LedgerUnreadableError("the document is not an object");
  const version: unknown = value.version;
  if (typeof version !== "number" || !Number.isInteger(version)) throw new LedgerUnreadableError("the document states no integer format version");
  if (version !== OPERATION_LEDGER_VERSION) throw new LedgerUnreadableError(`the document states format version ${String(version)}, and this build reads version ${String(OPERATION_LEDGER_VERSION)}`);
  const records: Record<string, OperationRecord> = {};
  const map: unknown = value.records;
  if (map !== undefined) {
    if (!isPlainObject(map)) throw new LedgerUnreadableError("the records member is not an object keyed by operation id");
    for (const [operationId, stored] of Object.entries(map)) {
      const entry = readEntry(stored);
      if (entry.operationId !== operationId) throw new LedgerUnreadableError("a records member disagrees with the operation id it is keyed by");
      collectEntry(records, entry);
    }
  }
  const entries: unknown = value.entries;
  if (entries !== undefined) {
    if (!Array.isArray(entries)) throw new LedgerUnreadableError("the entries member is not an array of operation records");
    for (const stored of entries) collectEntry(records, readEntry(stored));
  }
  return { version, records };
}
export type BeginResult = { readonly state: "fresh" } | { readonly state: "replay"; readonly record: OperationRecord } | { readonly state: "changed-intent"; readonly record: OperationRecord };
/** Reads an attempt's identity against the ledger: absent → `fresh`, same intent → `replay`, different intent → `changed-intent`, and nothing else. */
export function begin(ledger: OperationLedger, operationId: string, intentHash: string): BeginResult {
  const stored = lookup(ledger, operationId);
  if (stored === undefined) return { state: "fresh" };
  return stored.intentHash === intentHash ? { state: "replay", record: stored } : { state: "changed-intent", record: stored };
}
export function record(ledger: OperationLedger, entry: OperationRecord): OperationLedger {
  if (Object.hasOwn(ledger.records, entry.operationId)) throw new LedgerConflictError(entry.operationId);
  return { version: ledger.version, records: { ...ledger.records, [entry.operationId]: entry } };
}
export const lookup = (ledger: OperationLedger, operationId: string): OperationRecord | undefined => (Object.hasOwn(ledger.records, operationId) ? ledger.records[operationId] : undefined);
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
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
        if (member === undefined) continue;
        members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
      }
      return `{${members.join(",")}}`;
    }
    default:
      return `<unsupported:${typeof value}>`;
  }
}
/** The intent of one attempt, as a SHA-256 hex digest: what the attempt asks for, in the context it claims. */
export function intentHash(scope: Scope, payload: unknown): string {
  const intent = canonicalJson({ scope, payload });
  return createHash("sha256").update(intent, "utf8").digest("hex");
}
export type MutationName = string;
export type CurrentTarget = { readonly kind: "record"; readonly revision: string; readonly value: unknown } | { readonly kind: "absent" };
const ABSENT_TARGET_REVISION = "no-target";
const advancedRevision = (revision: string): string => `${revision}#advanced`;
export type MutationContext = { readonly docs: SessionDocuments; readonly session: ResolvedSession; readonly currentRevision: string; readonly operationId: string };
/** What `apply` answers: nothing to do, the change it made, or a refusal it reached only by reading the record the change acts on. */
export type ApplyResult<R extends MutationResult> =
  | { readonly changed: false }
  | { readonly refused: MutationOutcome }
  | { readonly changed: true; readonly revision: string; readonly result: R; readonly created?: readonly string[]; readonly changedIds?: readonly string[]; readonly items?: readonly PerItemResult[]; readonly scope?: Scope };
export interface MutationPlan<P, R extends MutationResult> {
  readonly sessionId: string;
  readonly input: MutationInput<P>;
  readonly schema: z.ZodType<P>;
  readonly name: MutationName;
  readonly authorize: (session: ResolvedSession) => ScopeDecision;
  readonly scopeAuthority?: ScopeAuthority;
  readonly readCurrent?: (docs: SessionDocuments) => CurrentTarget;
  readonly diagnosticPass?: "attempt" | "probe";
  readonly apply: (context: MutationContext) => ApplyResult<R> | Promise<ApplyResult<R>>;
}
class MutationRefused extends Error {
  readonly outcome: MutationOutcome;
  constructor(outcome: MutationOutcome) {
    super(`The change was refused after it was applied: ${outcome.outcome}.`);
    this.name = "MutationRefused";
    this.outcome = outcome;
    Object.setPrototypeOf(this, MutationRefused.prototype);
  }
}
function attemptIdOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return UNIDENTIFIED_ATTEMPT;
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}
function claimedScope(input: unknown): LogScope | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const scope: unknown = Reflect.get(input, "scope");
  if (typeof scope !== "object" || scope === null) return undefined;
  const organizationId: unknown = Reflect.get(scope, "organizationId");
  const ministryId: unknown = Reflect.get(scope, "ministryId");
  const supportSubjectId: unknown = Reflect.get(scope, "supportSubjectId");
  const principalId: unknown = Reflect.get(scope, "principalId");
  if (typeof organizationId !== "string" || organizationId.length === 0 || typeof ministryId !== "string" || ministryId.length === 0 || typeof supportSubjectId !== "string" || supportSubjectId.length === 0 || typeof principalId !== "string" || principalId.length === 0) return undefined;
  return { organizationId, ministryId, supportSubjectId, principalId };
}
const diagnosticScopeFor = (claimed: LogScope, session: ResolvedSession): LogScope => ({ ...claimed, principalId: session.principalId });
type SessionForMutation = { readonly ok: true; readonly session: ResolvedSession } | { readonly ok: false; readonly outcome: DeniedOutcome | UnavailableOutcome };
async function sessionForMutation(sessionId: string, operationId: string): Promise<SessionForMutation> {
  let fromRequest: SessionResolution | undefined;
  try {
    fromRequest = await resolveSession();
  } catch {
    // `next/headers` has no request to read outside a request scope, which is a test or a script rather than a browser: the named path below serves it.
    fromRequest = undefined;
  }
  const requestRefusal = fromRequest === undefined || fromRequest.ok ? undefined : fromRequest.refusal;
  if (fromRequest !== undefined && fromRequest.ok) return fromRequest.session.sessionId === sessionId ? { ok: true, session: fromRequest.session } : { ok: false, outcome: denied({ operationId, reasonCode: "not-admitted" }) };
  try {
    const named = await resolveSession({ sessionId });
    if (named.ok) return { ok: true, session: named.session };
    return { ok: false, outcome: outcomeOfRefusal(requestRefusal?.kind === "unavailable" ? requestRefusal : named.refusal, operationId) };
  } catch {
    // Naming a session directly is refused outside a development build, and a refusal to name one is not a session: the request cookie's own answer is the honest one.
    return { ok: false, outcome: requestRefusal === undefined ? denied({ operationId, reasonCode: "session-unavailable" }) : outcomeOfRefusal(requestRefusal, operationId) };
  }
}
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };
const LEDGER_UNAVAILABLE_GUIDANCE = "Reload the page to read this session's operation ledger again; if it stays unreadable, reset the development seed, which rebuilds the session documents deterministically.";
// No named mutation writes the generated workload document: every accepted attempt writes the ledger, the development mutations are the only ones that reach the meta document, and a record change is always a wholesale rewrite of the state document. A transaction declares exactly those three documents, so it never copies or serialises the dataset a mutation cannot touch.
const MUTATION_WRITE_SET = ["meta", "operations", "state"] as const satisfies readonly SessionDocumentKey[];
export async function runMutation<P, R extends MutationResult>(plan: MutationPlan<P, R>): Promise<MutationOutcome> {
  const startedAt = performance.now();
  const operationId = attemptIdOf(plan.input);
  let diagnosticScope = claimedScope(plan.input);
  const report = (outcome: MutationOutcome): MutationOutcome => {
    const elapsedMs = performance.now() - startedAt;
    const carriedOn = plan.diagnosticPass === "probe" && outcome.outcome === "unchanged";
    if (diagnosticScope !== undefined && !carriedOn) logger.mutation({ operationId, scope: diagnosticScope, outcome: outcome.outcome, elapsedMs });
    if (outcome.outcome === "unavailable") logger.sourceUnavailable({ job: plan.name, source: outcome.source });
    return outcome;
  };
  // 1. The four-field envelope, then the payload. A failure here has read nothing and changed nothing, and its messages are keyed by the payload's own field paths so a form can place them.
  const envelope = mutationInputSchema(z.unknown()).safeParse(plan.input);
  if (!envelope.success) return report(invalid({ operationId, fields: envelope.error }));
  const parsedPayload = plan.schema.safeParse(envelope.data.payload);
  if (!parsedPayload.success) return report(invalid({ operationId, fields: parsedPayload.error }));
  const input: MutationInput<P> = { ...envelope.data, payload: parsedPayload.data };
  diagnosticScope = input.scope;
  // 2. The session this request acts for, the scope it claims, then the mutation's own authority. Authorisation precedes everything a record question could disclose: a refusal here carries a reason code and no count, title, existence flag or size.
  const authority = await sessionForMutation(plan.sessionId, operationId);
  if (!authority.ok) return report(authority.outcome);
  const session = authority.session;
  // From here the attempt has an authenticated actor, so the line names it: the claim is what the attempt asked to act in, and the session is who acted. Both stay distinct on the line, which is what lets a refusal be attributed to the persona it happened to.
  diagnosticScope = diagnosticScopeFor(diagnosticScope, session);
  const scopeAuthority = plan.scopeAuthority ?? "membership";
  const scopeDecision = assertScopeUnder(session, input.scope, scopeAuthority);
  if (!scopeDecision.ok) return report(denied({ operationId, reasonCode: scopeDecision.denial.reasonCode }));
  const permission = plan.authorize(session);
  if (!permission.ok) return report(denied({ operationId, reasonCode: permission.denial.reasonCode }));
  // 3 to 7 happen inside one transaction, so the check, the effect and the ledger entry are one write under that session's lock.
  const intent = intentHash(input.scope, input.payload);
  try {
    const outcome = await transact<MutationOutcome>(plan.sessionId, MUTATION_WRITE_SET, async (docs) => {
      // The stored plan is read through the development runtime's one reader and consulted by this mutation's own name; the read layer asks the same reader and the same `failureFor`, so no second mechanism decides whether a failure is armed.
      const armed = failureFor(failurePlanOfDocument(docs.meta), "mutation", plan.name);
      if (armed === "denied") {
        // `denied` is the one mode the registry arms on reads today, so a mutation reaches this branch only if a plan naming a mutation with it ever becomes readable. It answers with the denial `authorize.ts` gives — the same shape, the same absence of any fact about the record — and rebuilds it with this attempt's
        // own operation id rather than the read marker.
        return denied({ operationId, reasonCode: "no-permission" });
      }
      // 3. The attempt's identity, decided against the ledger inside the transaction so the check and the append below cannot be separated by another writer.
      const ledger = readLedger(docs.operations);
      const begun = begin(ledger, operationId, intent);
      const target = plan.readCurrent?.(docs) ?? ABSENT_TARGET;
      const targetRevision = target.kind === "record" ? target.revision : ABSENT_TARGET_REVISION;
      const targetValue = target.kind === "record" ? target.value : null;
      // What an answer reports as the current revision: the record's own revision when there is one, and otherwise the revision the caller stated — a creation whose record this boundary cannot locate changed nothing, so the caller's own token is the honest answer.
      const reportedRevision = target.kind === "record" ? target.revision : input.expectedRevision;
      if (begun.state === "replay") {
        // No new effect and no new revision: the stored result is the answer, so a caller that lost the first response recovers exactly what it was told. The entry carries what the accepted answer reported — the change's own revision and the identifiers it created or changed — so the replay states those rather than
        // the revision the caller presented with the request. An entry written before an answer stored them falls back to the target's current revision.
        return alreadyAccepted({
          operationId,
          revision: begun.record.revision ?? reportedRevision,
          // The ledger holds the opaque value it was given; every result written to it came from an `ApplyResult<R>` whose `R` is constrained to `MutationResult`, so the stored value is one.
          result: begun.record.result as MutationResult,
          ...(begun.record.created === undefined ? {} : { created: begun.record.created }),
          ...(begun.record.changed === undefined ? {} : { changed: begun.record.changed }),
          ...(begun.record.items === undefined ? {} : { items: begun.record.items }),
        });
      }
      if (begun.state === "changed-intent") {
        // One attempt identity means one attempt. The stored record proves the id was used, so a different intent under it is a conflict rather than a second effect.
        return conflict({ operationId, currentRevision: reportedRevision, current: targetValue, preservedInput: input.payload, reason: "changed-intent" });
      }
      // 4. Optimistic concurrency. A creation compares no revision, because there is no stored value a stale expectation could overwrite. The armed changed-revision failure compares against a deliberately advanced revision, so its answer is a genuine conflict, not a fabricated one.
      const comparedRevision = armed === "conflict" ? advancedRevision(targetRevision) : targetRevision;
      const comparisonApplies = target.kind === "record" || armed === "conflict";
      if (comparisonApplies && input.expectedRevision !== comparedRevision) return conflict({ operationId, currentRevision: comparedRevision, current: targetValue, preservedInput: input.payload, reason: "stale-revision" });
      // 5. The change itself, applied to this transaction's draft.
      const applied = await plan.apply({ docs, session, currentRevision: targetRevision, operationId });
      if ("refused" in applied) {
        // A refusal the mutation reached only after reading the record: nothing was applied, no revision advanced and no ledger entry is written, so the caller's input is preserved and the effect is absent rather than merely unreported.
        return applied.refused;
      }
      if (!applied.changed) {
        // Nothing needed doing: no revision advance, no history or activity entry, nothing recorded.
        return unchanged({ operationId, revision: reportedRevision });
      }
      // A write re-checks the scope it started from and the one it produced, so a change can never move a record into a context the caller cannot see. Throwing is how a draft is discarded: the store writes nothing when this callback throws.
      const scopeHeld = assertScopeUnchangedUnder(session, input.scope, applied.scope ?? input.scope, scopeAuthority);
      if (!scopeHeld.ok) throw new MutationRefused(denied({ operationId, reasonCode: scopeHeld.denial.reasonCode }));
      // 6. The ledger entry is recorded in this same transaction: the effect and its record are one write, which is the whole of the replay guarantee. The entry stores what the answer reports beside the result, so a replay states the change's own revision and identifiers rather than the revision token the caller
      // presented.
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
      const appliedOutcome = accepted({ operationId, revision: applied.revision, created: applied.created, changed: applied.changedIds, items: applied.items });
      // 7. The armed lost acknowledgement answers after the commit: the effect and its ledger entry are stored and the response is withheld, so replaying the same operation id recovers the result and exactly one effect exists.
      return armed === "unknown" ? unknown({ operationId }) : appliedOutcome;
    });
    return report(outcome);
  } catch (error) {
    if (error instanceof MutationRefused) return report(error.outcome);
    if (error instanceof LedgerUnreadableError) {
      // The ledger belongs to the local store, so an unreadable one is a source that could not answer: `unavailable` names it and offers recovery, never a repeat of the write.
      return report(unavailable({ operationId, source: { system: LOCAL_STORE_SYSTEM, reference: "operations-ledger" }, guidance: LEDGER_UNAVAILABLE_GUIDANCE }));
    }
    return report(outcomeFromError(operationId, error));
  }
}
