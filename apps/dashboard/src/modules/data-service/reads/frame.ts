import type { z } from "zod";
import { logger } from "@/lib/logger";
import type { SourceReference } from "@/lib/ids";
import { compareCodeUnits } from "@/lib/ordering";
import { exponentOf } from "@/modules/money/currency";
import { readSession } from "@/modules/store/repository";
import type { SessionDocuments } from "@/modules/store/paths";
import type { GiftRow, SupportProjection } from "@/modules/support/basis";
import type { CommitmentRow } from "@/modules/support/buckets";
import { clampPageSize } from "@/modules/support/report";
import { parseCivilDate } from "@/modules/time/civil";
import { instantAt } from "@/modules/time/clock";
import { assertScope, readResultOfRefusal, recordRefusalOutage, resolveSession, type AccessDecision, type ResolvedSession, type SessionResolution, type SessionSource } from "../authorize";
import { buildEnvelope, type CommitmentRowRecord, type Coverage, type GiftRowRecord, type ReadAction, type ReadEnvelope, type RecordedValueState, type Scope, type SupportProjectionRecord, type ValueState } from "../envelope";
import { LOCAL_STORE_SYSTEM, denied, unavailable, type DenialReason, type ReadResult } from "../outcome";
import { type CivilDate } from "../../time/civil";
export const READ_ATTEMPT_ID = "read";
export const WHOLE_COLLECTION_COVERAGE: Coverage = { from: null, to: null, state: "complete" };
export type ScenarioInstant = ReturnType<typeof instantAt>;
export type OpenedSession = { readonly ok: true; readonly session: ResolvedSession; readonly instant: ScenarioInstant } | { readonly ok: false; readonly result: ReadResult<never> };
export type OpenedRead = { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope; readonly instant: ScenarioInstant } | { readonly ok: false; readonly result: ReadResult<never> };
export type StoredRead = { readonly ok: true; readonly documents: SessionDocuments } | { readonly ok: false; readonly result: ReadResult<never> };
/** The read's denial, stated the one way every read states it. */ export const deniedRead = (reasonCode: DenialReason): ReadResult<never> => ({ kind: "denied", denied: denied({ operationId: READ_ATTEMPT_ID, reasonCode }) });
/** An unavailable source, logged against the job that could not read it and worded by that job's own guidance. */
export function sourceUnavailableRead(input: { readonly job: string; readonly source: SourceReference; readonly guidance: string }): ReadResult<never> {
  logger.sourceUnavailable({ job: input.job, source: { system: input.source.system, reference: input.source.reference } });
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: input.source, guidance: input.guidance }) };
}
/** The parts of an envelope a read states about its own answer once it has projected its data: the source it read, the revision that names what it read, and the value states and advisory actions the envelope carries. A read that states a period states its own coverage; every other read covers the whole collection. */
export interface ReadAnswer<T, C extends Coverage = Coverage> {
  readonly data: T;
  readonly source: SourceReference;
  readonly revision: string;
  readonly coverage?: C;
  readonly valueStates?: Readonly<Record<string, RecordedValueState>>;
  readonly actions?: readonly ReadAction[];
}
/** The result a read answers with: its answer's envelope, at the scope it read in and the instant its clock states. */
export function answerOf<T, C extends Coverage = Coverage>(scope: Scope, asOf: string, answer: ReadAnswer<T, C>): ReadResult<ReadEnvelope<T, C>> {
  return { kind: "envelope", envelope: buildEnvelope<T, C>({ data: answer.data, scope, source: answer.source, revision: answer.revision, asOf, coverage: answer.coverage ?? (WHOLE_COLLECTION_COVERAGE as C), valueStates: answer.valueStates ?? {}, actions: answer.actions ?? [] }) };
}
/** Resolves the session a read acts for and the instant its clock states. A resolver fault is answered as the session refusal the caller names, and rethrown where the caller names none; a store fault that refused the read is named to the diagnostic stream under the job's own name. */
export async function resolveReading(options: { readonly job: string; readonly source?: SessionSource; readonly sessionFaultReason?: DenialReason }): Promise<OpenedSession> {
  let resolution: SessionResolution;
  try {
    resolution = await resolveSession(options.source);
  } catch (fault) {
    if (options.sessionFaultReason === undefined) throw fault;
    return { ok: false, result: deniedRead(options.sessionFaultReason) };
  }
  if (resolution.ok) return { ok: true, session: resolution.session, instant: instantAt(resolution.session.clockOffsetMs) };
  recordRefusalOutage(options.job, resolution.refusal);
  return { ok: false, result: readResultOfRefusal(resolution.refusal) };
}
/** Resolves the session, the scope it selected and its instant, then applies the one authority this job needs beyond membership in that scope. */
export async function openRead(options: { readonly job: string; readonly source?: SessionSource; readonly unselectedReason: DenialReason; readonly permit?: (session: ResolvedSession, scope: Scope) => AccessDecision; readonly sessionFaultReason?: DenialReason }): Promise<OpenedRead> {
  const opened = await resolveReading(options);
  if (!opened.ok) return opened;
  const { session, instant } = opened;
  const scope = session.selected;
  if (scope === null) return { ok: false, result: deniedRead(options.unselectedReason) };
  const admitted = assertScope(session, scope);
  if (!admitted.ok) return { ok: false, result: { kind: "denied", denied: admitted.denial } };
  const permitted = options.permit?.(session, scope);
  return permitted !== undefined && !permitted.allowed ? { ok: false, result: { kind: "denied", denied: permitted.denial } } : { ok: true, session, scope, instant };
}
export type DecodedStore<T> = { readonly ok: true; readonly value: T; readonly documents: SessionDocuments } | { readonly ok: false; readonly result: ReadResult<never> };
/** The one source a read reports when the defect is the store rather than the document it holds. */ export const storeSource = (reference: string): SourceReference => ({ system: LOCAL_STORE_SYSTEM, reference });
/** An unavailable synthetic store, named by the reference a read states for it. */
export const storeUnavailableRead = (job: string, reference: string, guidance: string): ReadResult<never> => sourceUnavailableRead({ job, source: storeSource(reference), guidance });
/** Reads the session's stored documents, answering an unreadable store, a missing session and an undecodable document as the one unavailable source this read reports. */
export async function readStoreDocument(options: { readonly session: ResolvedSession; readonly job: string; readonly source: SourceReference; readonly guidance: string; readonly absentReference?: string; readonly faultReference?: (fault: unknown) => string }): Promise<StoredRead> {
  const reference = (stated: string | undefined): SourceReference => (stated === undefined ? options.source : { system: options.source.system, reference: stated });
  let documents: SessionDocuments | undefined;
  try {
    documents = await readSession(options.session.sessionId);
  } catch (fault) {
    return { ok: false, result: sourceUnavailableRead({ job: options.job, source: reference(options.faultReference?.(fault)), guidance: options.guidance }) };
  }
  return documents === undefined ? { ok: false, result: sourceUnavailableRead({ job: options.job, source: reference(options.absentReference), guidance: options.guidance }) } : { ok: true, documents };
}
/** Reads the session's stored documents and decodes the state document they hold, which is the whole of what most reads do before they project. */
export async function readDecodedState<T>(options: { readonly session: ResolvedSession; readonly job: string; readonly source: SourceReference; readonly schema: z.ZodType<T>; readonly guidance: string }): Promise<DecodedStore<T>> {
  const stored = await readStoreDocument(options);
  if (!stored.ok) return stored;
  const decoded = options.schema.safeParse(stored.documents.state);
  return !decoded.success ? { ok: false, result: sourceUnavailableRead({ job: options.job, source: options.source, guidance: options.guidance }) } : { ok: true, value: decoded.data, documents: stored.documents };
}
export type OpenedStatefulRead<T> = { readonly ok: true; readonly session: ResolvedSession; readonly scope: Scope; readonly instant: ScenarioInstant; readonly state: T; readonly documents: SessionDocuments } | { readonly ok: false; readonly result: ReadResult<never> };
/** Opens a read's session, scope and job authority and decodes the state document it projects from, which is the whole of what a stateful read does before it reads a record. */ export async function openStatefulRead<T>(options: {
  readonly source?: SessionSource;
  readonly unselectedReason: DenialReason;
  readonly permit?: (session: ResolvedSession, scope: Scope) => AccessDecision;
  readonly sessionFaultReason?: DenialReason;
  readonly job: string;
  readonly sourceOf: SourceReference;
  readonly schema: z.ZodType<T>;
  readonly guidance: string;
}): Promise<OpenedStatefulRead<T>> {
  const opened = await openRead(options);
  if (!opened.ok) return opened;
  const stored = await readDecodedState({ session: opened.session, job: options.job, source: options.sourceOf, schema: options.schema, guidance: options.guidance });
  return !stored.ok ? stored : { ok: true, session: opened.session, scope: opened.scope, instant: opened.instant, state: stored.value, documents: stored.documents };
}
/** One validation per document object for the schema a read decodes it with, so a read that asks for two halves of one document decodes neither twice on the same bytes. */
export function cachedDecoder<T>(schema: z.ZodType<T>): (value: unknown) => z.ZodSafeParseResult<T> {
  const remembered = new WeakMap<object, z.ZodSafeParseResult<T>>();
  return (value) => {
    if (typeof value !== "object" || value === null) return schema.safeParse(value);
    const held = remembered.get(value);
    if (held !== undefined) return held;
    const parsed = schema.safeParse(value);
    remembered.set(value, parsed);
    return parsed;
  };
}
/** Two sources' coverage merged into the one a read states for both: unknown wherever either is, and complete only where both are. */ export function mergedCoverage(base: Coverage, workload: Coverage): Coverage {
  if (base.state === "unknown" || workload.state === "unknown") return { from: null, to: null, state: "unknown" };
  const earlier = (left: string | null, right: string | null): string | null => (left === null ? right : right === null ? left : left <= right ? left : right);
  return { from: earlier(base.from, workload.from), to: earlier(base.to, workload.to), state: base.state === "complete" && workload.state === "complete" ? "complete" : "partial" };
}
export type PageWindow = { readonly page: number; readonly pageSize: number; readonly pageCount: number; readonly start: number; readonly end: number };
/** The window a page request selects over a whole result, clamped to the pages that exist. */ export function pageWindow(total: number, requestedPage: number | undefined, requestedPageSize: number | undefined): PageWindow {
  const pageSize = clampPageSize(requestedPageSize);
  const pageCount = Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, requestedPage === undefined || !Number.isFinite(requestedPage) ? 1 : Math.trunc(requestedPage)), Math.max(1, pageCount));
  const start = (page - 1) * pageSize;
  return { page, pageSize, pageCount, start, end: start + pageSize };
}
/** One stored gift row projected into the report engine's own row, which every read that states received support feeds it. */ export function toReportGiftRow(record: GiftRowRecord): GiftRow {
  const originalGiftOn = statedDateOrNull(record.originalGiftOn, "gift date");
  return {
    giftRowId: record.giftRowId,
    giftId: record.giftId,
    ...(record.allocationId === null ? {} : { allocationId: record.allocationId }),
    amount: record.amount,
    ...(originalGiftOn === undefined ? {} : { originalGiftOn }),
    datePrecision: record.datePrecision,
    ...(record.designation === null ? {} : { designation: record.designation }),
    attribution: record.attribution,
    ...(record.refundOf === null ? {} : { refundOf: record.refundOf }),
    provenance: record.provenance,
    entryOn: statedDate(record.entryOn, "gift entry date"),
  };
}
/** One stored commitment row projected into the report engine's own row, with its stated dates as civil dates and its fixed total as the progress it records. */ export function toCommitmentRow(record: CommitmentRowRecord): CommitmentRow {
  const lastSuccessfulOn = statedDateOrNull(record.lastSuccessfulOn, "commitment date");
  const nextEligibleOn = statedDateOrNull(record.nextEligibleOn, "commitment date");
  const resumeOn = statedDateOrNull(record.pause.resumeOn, "commitment pause date");
  return {
    commitmentRowId: record.commitmentRowId,
    kind: record.kind,
    cadence: record.cadence,
    perOccurrence: record.perOccurrence,
    bucketState: record.bucketState,
    ...(lastSuccessfulOn === undefined ? {} : { lastSuccessfulOn }),
    ...(nextEligibleOn === undefined ? {} : { nextEligibleOn }),
    pause: resumeOn === undefined ? { state: record.pause.state } : { state: record.pause.state, resumeOn },
    ...(record.fixedTotal === null ? {} : { fixedTotal: record.fixedTotal }),
  };
}
/** The eight-character FNV-1a digest of a stored string, so a record's stored form can be compared without carrying the form itself. */ export function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/** One stored gift row as the report engine's own row, or nothing when a stored day it states is not a civil date, because no figure is derived from a substituted day. */
export function giftRowOrNull(record: GiftRowRecord): GiftRow | undefined {
  try {
    return toReportGiftRow(record);
  } catch (fault) {
    if (fault instanceof TypeError) return undefined;
    throw fault;
  }
}
/** One stored commitment row as the report engine's own row, or nothing when a stored day it states is not a civil date. */ export function commitmentRowOrNull(record: CommitmentRowRecord): CommitmentRow | undefined {
  try {
    return toCommitmentRow(record);
  } catch (fault) {
    if (fault instanceof TypeError) return undefined;
    throw fault;
  }
}
/** Every stored gift row converted, or nothing at all when one of them states a day this runtime cannot read: a projection states its rows whole or not at all. */
export function giftRowsOf(records: readonly GiftRowRecord[]): readonly GiftRow[] | undefined {
  const rows: GiftRow[] = [];
  for (const record of records) {
    const row = giftRowOrNull(record);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return rows;
}
/** Every stored commitment row converted, or nothing at all when one of them states a day this runtime cannot read. */ export function commitmentRowsOf(records: readonly CommitmentRowRecord[]): readonly CommitmentRow[] | undefined {
  const rows: CommitmentRow[] = [];
  for (const record of records) {
    const row = commitmentRowOrNull(record);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return rows;
}
/** A collection's revision: one prefix and a digest of its parts, taken in the order the caller orders them. */ export function hashedRevision(prefix: string, orderedParts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const part of orderedParts) {
    for (const character of `${part}\u001f`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
/** The revision of a collection stated by its own revisions, which no later read can state the same way twice without the same members. */
export function collectionRevision(family: string, members: readonly { readonly revision: string }[]): string {
  return `${family}/${String(members.length)}/${digest(
    members
      .map((member) => member.revision)
      .toSorted(compareCodeUnits)
      .join("\u0000"),
  )}`;
}
/** The projection a read states its figures from: the stored record's own projection with the generated workload's coverage and currency exponents merged over it, and its goal only where the surface that owns the goal reads it. */
export function statedProjection(input: {
  readonly record: SupportProjectionRecord;
  readonly gifts: readonly GiftRowRecord[];
  readonly workloadGifts: readonly GiftRowRecord[];
  readonly commitments: readonly CommitmentRowRecord[];
  readonly header?: { readonly coverage: Coverage; readonly currencies: readonly string[] };
  readonly asOf: string;
  readonly withGoal: boolean;
}): SupportProjection {
  const { record, header } = input;
  const currencyExponents = header === undefined ? record.currencyExponents : { ...record.currencyExponents, ...knownExponentsOf(header.currencies) };
  const coverage = header === undefined ? record.coverage : mergedCoverage(record.coverage, header.coverage);
  const { supportSubjectId, basis, lastSourceUpdate, source } = record;
  return { supportSubjectId, basis, currencyExponents, coverage, asOf: input.asOf, lastSourceUpdate, source, ...(input.withGoal && record.goal !== null ? { goal: record.goal } : {}), gifts: [...input.gifts, ...input.workloadGifts].map(toReportGiftRow), commitments: input.commitments.map(toCommitmentRow) };
}
/** The state a count is recorded as: a whole-result total is never unknown, and zero is stated as zero rather than as a value. */ export const countState = (count: number): RecordedValueState => (count === 0 ? "zero" : "value");
/** The state a derived value is recorded as when the value it came from may itself be a subtotal. */ export const recordedStateOf = (state: ValueState): RecordedValueState => (state === "incomplete-subtotal" ? "value" : state);
/** One advisory action, stated the way every read states it: an unavailable action always says why it is. */
export const readAction = (name: string, available: boolean, reason = "This action is not available here."): ReadAction => (available ? { name, available } : { name, available, reason });
export { storedInstantOf as instantOf } from "../projection";
/** The currency exponents this application knows for the codes one source states, so a generated workload header merges into a stored record without inventing a precision. */
export function knownExponentsOf(codes: readonly string[]): Record<string, number> {
  const exponents: Record<string, number> = {};
  for (const code of codes) {
    const exponent = exponentOf(code);
    if (exponent !== undefined) exponents[code] = exponent;
  }
  return exponents;
}
/** A stored civil date, or nothing when the record states none this runtime cannot read. */ export function civilDateOf(value: string): CivilDate | undefined {
  const parsed = parseCivilDate(value);
  return parsed.status === "parsed" ? parsed.date : undefined;
}
/** A stored civil date a record cannot be read without. */ export function statedDate(value: string, field: string): CivilDate {
  const parsed = civilDateOf(value);
  if (parsed === undefined) throw new TypeError(`A stored ${field} value is not a civil date, so the record it belongs to cannot be read.`);
  return parsed;
}
/** A stored civil date the record may leave unstated. */ export const statedDateOrNull = (value: string | null, field: string): CivilDate | undefined => (value === null ? undefined : statedDate(value, field));
/** Orders two optional texts: the stated one first, then the absent, both by code unit. */
export const compareOptionalText = (left: string | null, right: string | null): number => (left === null ? (right === null ? 0 : 1) : right === null ? -1 : compareCodeUnits(left, right));
