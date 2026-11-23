import { createHash } from "node:crypto";
import { z } from "zod";
import { logger, type LogScope } from "@/lib/logger";
import { failureFor, failurePlanOfDocument } from "@/modules/dev-runtime/failures";
import type { SessionDocumentKey, SessionDocuments } from "@/modules/store/paths";
import { transact } from "@/modules/store/repository";
import { now } from "@/modules/time/clock";
import { assertScopeUnder, assertScopeUnchangedUnder, outcomeOfRefusal, resolveSession, type ResolvedSession, type ScopeAuthority, type ScopeDecision, type SessionResolution, type SessionSource } from "./authorize";
import { mutationInputSchema, operationRecordSchema, type MutationInput, type OperationRecord, type Scope } from "./envelope";
import { LOCAL_STORE_SYSTEM, UNIDENTIFIED_ATTEMPT, accepted, alreadyAccepted, conflict, denied, invalid, outcomeFromError, unavailable, unchanged, unknown, type DeniedOutcome, type FieldMessages, type MutationOutcome, type MutationResult, type PerItemResult, type UnavailableOutcome } from "./outcome";
export const OPERATION_LEDGER_VERSION = 1;
export type OperationLedger = { readonly version: number; readonly records: Readonly<Record<string, OperationRecord>> };
export const emptyLedger = (): OperationLedger => ({ version: OPERATION_LEDGER_VERSION, records: {} });
export class LedgerConflictError extends Error {
  readonly operationId: string;
  constructor(operationId: string) {
    super(`The operation ledger already holds a result for ${JSON.stringify(operationId)}, and an entry is never overwritten: a replay is answered from the stored record instead.`);
    this.name = "LedgerConflictError";
    this.operationId = operationId;
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
  return stored === undefined ? { state: "fresh" } : stored.intentHash === intentHash ? { state: "replay", record: stored } : { state: "changed-intent", record: stored };
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
  return createHash("sha256").update(canonicalJson({ scope, payload }), "utf8").digest("hex");
}
export type MutationName = string;
export type CurrentTarget = { readonly kind: "record"; readonly revision: string; readonly value: unknown } | { readonly kind: "absent" };
const ABSENT_TARGET_REVISION = "no-target";
const advancedRevision = (revision: string): string => `${revision}#advanced`;
export type MutationContext = { readonly docs: SessionDocuments; readonly session: ResolvedSession; readonly currentRevision: string; readonly operationId: string };
// A nothing-to-do answer may state the revision of the record the attempt found, and the record itself, which the runner then records under the attempt's own identity: an attempt that changed nothing can still be the only identity a caller holds for what it found.
export type ApplyResult<R extends MutationResult> =
  | { readonly changed: false; readonly revision?: string; readonly result?: R }
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
    super(`The change was refused: ${outcome.outcome}.`);
    this.name = "MutationRefused";
    this.outcome = outcome;
    Object.setPrototypeOf(this, MutationRefused.prototype);
  }
}
/** The identity an attempt is reported under, read off the request's own `operationId` and never guessed beyond it. */
export function attemptIdOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return UNIDENTIFIED_ATTEMPT;
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}
/** The payload a mutation's own schema admits, read where an apply body needs the parsed value rather than the request's raw one. */
export const payloadOf = <S extends z.ZodType>(schema: S, input: { readonly payload: unknown }): z.output<S> => schema.parse(input.payload);
export type MutationOpening = { readonly ok: true; readonly sessionId: string; readonly session: ResolvedSession } | { readonly ok: false; readonly outcome: MutationOutcome };
/** The opening every mutation shares: the session an attempt acts for is established before it validates, and a request scope that cannot yield one is refused rather than given an identity. */
export async function openMutation(input: unknown, source?: SessionSource): Promise<MutationOpening> {
  const operationId = attemptIdOf(input);
  try {
    const resolution = await resolveSession(source);
    return resolution.ok ? { ok: true, sessionId: resolution.session.sessionId, session: resolution.session } : { ok: false, outcome: outcomeOfRefusal(resolution.refusal, operationId) };
  } catch {
    return { ok: false, outcome: denied({ operationId, reasonCode: "session-unavailable" }) };
  }
}
/** Refuses the attempt with the outcome it earned: the runner answers it, so a refusal reached after a record was read keeps nothing its draft holds. */
export function refuse(outcome: MutationOutcome): never {
  throw new MutationRefused(outcome);
}
/** Refuses a change to a record the caller does not hold or may not change, disclosing nothing about what exists. */
export function refuseDenied(operationId: string): never {
  return refuse(denied({ operationId, reasonCode: "no-permission" }));
}
/** Refuses a stale attempt, carrying both the current value and the caller's preserved input so a surface can show them side by side. */
export function refuseConflict(input: { readonly operationId: string; readonly currentRevision: string; readonly current: unknown; readonly preservedInput: unknown }): never {
  return refuse(conflict({ ...input, reason: "stale-revision" }));
}
/** Refuses a payload the domain re-ran and did not admit, with per-field messages keyed by field path. */
export function refuseInvalid(operationId: string, fields: FieldMessages | z.ZodError): never {
  return refuse(invalid({ operationId, fields }));
}
/** Refuses the attempt because the store behind the work could not answer: the source is named and the retry guidance is the caller's. */
export function refuseUnavailable(input: { readonly operationId: string; readonly reference: string; readonly guidance: string }): never {
  return refuse(unavailable({ operationId: input.operationId, source: { system: LOCAL_STORE_SYSTEM, reference: input.reference }, guidance: input.guidance }));
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
    fromRequest = undefined;
  }
  const requestRefusal = fromRequest === undefined || fromRequest.ok ? undefined : fromRequest.refusal;
  if (fromRequest !== undefined && fromRequest.ok) return fromRequest.session.sessionId === sessionId ? { ok: true, session: fromRequest.session } : { ok: false, outcome: denied({ operationId, reasonCode: "not-admitted" }) };
  try {
    const named = await resolveSession({ sessionId });
    return named.ok ? { ok: true, session: named.session } : { ok: false, outcome: outcomeOfRefusal(requestRefusal?.kind === "unavailable" ? requestRefusal : named.refusal, operationId) };
  } catch {
    return { ok: false, outcome: requestRefusal === undefined ? denied({ operationId, reasonCode: "session-unavailable" }) : outcomeOfRefusal(requestRefusal, operationId) };
  }
}
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };
const LEDGER_UNAVAILABLE_GUIDANCE = "Reload the page to read this session's operation ledger again; if it stays unreadable, reset the development seed, which rebuilds the session documents deterministically.";
// No named mutation writes the generated workload document: every accepted attempt writes the ledger, the development mutations are the only ones that reach the meta document, and a record change is a wholesale rewrite of the state document.
const MUTATION_WRITE_SET = ["meta", "operations", "state"] as const satisfies readonly SessionDocumentKey[];
export async function runMutation<P, R extends MutationResult>(plan: MutationPlan<P, R>): Promise<MutationOutcome> {
  const startedAt = performance.now();
  const operationId = attemptIdOf(plan.input);
  let diagnosticScope = claimedScope(plan.input);
  const report = (outcome: MutationOutcome): MutationOutcome => {
    const elapsedMs = performance.now() - startedAt;
    if (diagnosticScope !== undefined && !(plan.diagnosticPass === "probe" && outcome.outcome === "unchanged")) logger.mutation({ operationId, scope: diagnosticScope, outcome: outcome.outcome, elapsedMs });
    if (outcome.outcome === "unavailable") logger.sourceUnavailable({ job: plan.name, source: outcome.source });
    return outcome;
  };
  const envelope = mutationInputSchema(z.unknown()).safeParse(plan.input);
  if (!envelope.success) return report(invalid({ operationId, fields: envelope.error }));
  const parsedPayload = plan.schema.safeParse(envelope.data.payload);
  if (!parsedPayload.success) return report(invalid({ operationId, fields: parsedPayload.error }));
  const input: MutationInput<P> = { ...envelope.data, payload: parsedPayload.data };
  diagnosticScope = input.scope;
  const authority = await sessionForMutation(plan.sessionId, operationId);
  if (!authority.ok) return report(authority.outcome);
  const session = authority.session;
  diagnosticScope = diagnosticScopeFor(diagnosticScope, session);
  const scopeAuthority = plan.scopeAuthority ?? "membership";
  const scopeDecision = assertScopeUnder(session, input.scope, scopeAuthority);
  if (!scopeDecision.ok) return report(denied({ operationId, reasonCode: scopeDecision.denial.reasonCode }));
  const permission = plan.authorize(session);
  if (!permission.ok) return report(denied({ operationId, reasonCode: permission.denial.reasonCode }));
  const intent = intentHash(input.scope, input.payload);
  try {
    const outcome = await transact<MutationOutcome>(plan.sessionId, MUTATION_WRITE_SET, async (docs) => {
      const armed = failureFor(failurePlanOfDocument(docs.meta), "mutation", plan.name);
      if (armed === "denied") return denied({ operationId, reasonCode: "no-permission" });
      const ledger = readLedger(docs.operations);
      const begun = begin(ledger, operationId, intent);
      const target = plan.readCurrent?.(docs) ?? ABSENT_TARGET;
      const targetRevision = target.kind === "record" ? target.revision : ABSENT_TARGET_REVISION;
      const targetValue = target.kind === "record" ? target.value : null;
      const reportedRevision = target.kind === "record" ? target.revision : input.expectedRevision;
      if (begun.state === "replay") {
        // An attempt recorded as having changed nothing replays as having changed nothing: the same identity, the revision that attempt found, and no result to recover, because there was never an effect to recover.
        if (begun.record.outcome === "unchanged") return unchanged({ operationId, revision: begun.record.revision ?? reportedRevision });
        return alreadyAccepted({
          operationId,
          revision: begun.record.revision ?? reportedRevision,
          result: begun.record.result as MutationResult,
          ...(begun.record.created === undefined ? {} : { created: begun.record.created }),
          ...(begun.record.changed === undefined ? {} : { changed: begun.record.changed }),
          ...(begun.record.items === undefined ? {} : { items: begun.record.items }),
        });
      }
      if (begun.state === "changed-intent") return conflict({ operationId, currentRevision: reportedRevision, current: targetValue, preservedInput: input.payload, reason: "changed-intent" });
      const comparedRevision = armed === "conflict" ? advancedRevision(targetRevision) : targetRevision;
      if ((target.kind === "record" || armed === "conflict") && input.expectedRevision !== comparedRevision) return conflict({ operationId, currentRevision: comparedRevision, current: targetValue, preservedInput: input.payload, reason: "stale-revision" });
      const applied = await plan.apply({ docs, session, currentRevision: targetRevision, operationId });
      if (!applied.changed) {
        // Nothing needed doing: no revision advance, no history or activity entry. The answer states the revision the change's own record holds when the mutation reported one, so a caller that presented a token of its own is told the revision the record is actually at.
        const revision = applied.revision ?? reportedRevision;
        if (applied.result === undefined) return unchanged({ operationId, revision });
        // A no-change answer that states the record it found records the attempt under its own identity in this same transaction, so a caller holding only the identity it minted can name what it found; the entry's outcome is `unchanged`, which is why replaying it answers `unchanged` rather than an acceptance.
        docs.operations = record(ledger, { operationId, intentHash: intent, scope: input.scope, outcome: "unchanged", result: applied.result, revision, at: now().toString() });
        return unchanged({ operationId, revision });
      }
      const scopeHeld = assertScopeUnchangedUnder(session, input.scope, applied.scope ?? input.scope, scopeAuthority);
      if (!scopeHeld.ok) throw new MutationRefused(denied({ operationId, reasonCode: scopeHeld.denial.reasonCode }));
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
      return armed === "unknown" ? unknown({ operationId }) : accepted({ operationId, revision: applied.revision, created: applied.created, changed: applied.changedIds, items: applied.items });
    });
    return report(outcome);
  } catch (error) {
    return error instanceof MutationRefused ? report(error.outcome) : error instanceof LedgerUnreadableError ? report(unavailable({ operationId, source: { system: LOCAL_STORE_SYSTEM, reference: "operations-ledger" }, guidance: LEDGER_UNAVAILABLE_GUIDANCE })) : report(outcomeFromError(operationId, error));
  }
}
