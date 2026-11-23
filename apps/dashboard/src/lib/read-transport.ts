"use client";
/** The one owner of the browser's data transport. */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useRef } from "react";
import type { ZodType } from "zod";
import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { newOperationId, type SourceReference } from "@/lib/ids";
import type { Coverage, MutationInput, OperationOutcomeName, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import { invalid, isOutcome, isReadResult, outcomeFromError, unavailable, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
// ---------------------------------------------------------------------------------------------
// The statuses one read answers with
// ---------------------------------------------------------------------------------------------
/** The one status a read answers a usable envelope with. */
const ENVELOPE_STATUS = 200;
/** The status a refused authority answers with. */
const DENIED_STATUS = 403;
/** The status a session that expired or could not be established answers with: the same denial, and no permission refused. */
const SESSION_FAULT_STATUS = 401;
/** The status an outage answers with. */
const UNAVAILABLE_STATUS = 503;
/** The status a request the read does not admit answers with: the field-keyed refusal, which is the request's own fault. */
const REFUSED_STATUS = 422;
/** The identity a read reports its answers under: a read has no attempt of its own, and the service names read-level outcomes with this one. */
export const READ_ATTEMPT_ID = "read";
/** The source system a transport fault is reported under: the handler of this application, named so an outage names something a person can act on. */
const HANDLER_SOURCE_SYSTEM = "data-service";
/** The sentence a change's answer carries when it is neither one of the eight outcomes nor a fault this module can place. */
const UNREADABLE_ANSWER_MESSAGE = "The handler answered with a body that is not one of the eight outcomes, so this attempt's result is not known from the response.";
/** The two outcomes that leave a family's reads out of date: the ones that produced or replayed an effect. */
const DEFAULT_REFRESHING: readonly OperationOutcomeName[] = ["accepted", "alreadyAccepted"];
/** Raised when a read produced none of its four answers: the request failed, the answer was not JSON, or the body was not one the status carries. */
export class ReadTransportError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  constructor(url: string, status: number | undefined, detail: string) {
    super(`${url} ${status === undefined ? "did not answer" : `answered ${String(status)}`} with ${detail}, so this read produced no result.`);
    this.name = "ReadTransportError";
    this.url = url;
    this.status = status;
    Object.setPrototypeOf(this, ReadTransportError.prototype); // Keeps `instanceof` working where the class is downlevelled past ES2015 semantics, which is what lets a caller narrow with `instanceof ReadTransportError`.
  }
}
// ---------------------------------------------------------------------------------------------
// The guards over the two bodies a read answers with
// ---------------------------------------------------------------------------------------------
/** Whether one advisory action is named and flagged; its reason, when it is unavailable, is stated by the service. */
function isReadAction(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string" && typeof value.available === "boolean";
}
/** Whether a parsed body is a read envelope whose payload the caller's own guard admits: the frame the service owns, checked once for the whole tree. */
export function isReadEnvelopeOf<T, C extends Coverage = Coverage>(value: unknown, admits: (data: unknown) => boolean): value is ReadEnvelope<T, C> {
  if (!isRecord(value)) return false;
  return admits(value.data) && isRecord(value.scope) && isRecord(value.source) && isNonEmptyString(value.revision) && isNonEmptyString(value.asOf) && isRecord(value.coverage) && isRecord(value.valueStates) && Array.isArray(value.actions) && value.actions.every(isReadAction);
}
/** One read's request: where it goes, what it asks with, and what payload it admits. */
export interface ReadTarget {
  /** The path this read asks, already carrying its own query. */
  readonly url: string;
  /** The body a read that has to state its query in one carries; a read with none asks by GET. */
  readonly body?: unknown;
  /** Whether the envelope's `data` member is the payload this read documents. */
  readonly admits: (data: unknown) => boolean;
}
/** One read that states its own outage: where it goes, what payload it admits, and what a reader is told when it produces no answer. */
export interface OutageReadTarget extends ReadTarget {
  /** The source a failed request is reported against, so an outage names what did not answer. */
  readonly source: SourceReference;
  /** What the surface tells a reader when this read produced no answer, stated by the feature that owns the surface. */
  readonly guidance: string;
}
/** One read's demand of the wire: the four arms it states, or the fault that stopped it from stating one. */
type TransportAnswer<T, C extends Coverage> = { readonly kind: "result"; readonly result: ReadResult<ReadEnvelope<T, C>> } | { readonly kind: "none"; readonly status: number | undefined; readonly detail: string };
/** Narrows a body that is already a read result onto this read's own envelope, so a wrapped answer is read the same way a flat one is. */
function wrappedResultOf<T, C extends Coverage>(target: ReadTarget, body: ReadResult<unknown>): ReadResult<ReadEnvelope<T, C>> | undefined {
  switch (body.kind) {
    case "envelope":
      return isReadEnvelopeOf<T, C>(body.envelope, target.admits) ? { kind: "envelope", envelope: body.envelope } : undefined;
    case "denied":
      return { kind: "denied", denied: body.denied };
    case "unavailable":
      return { kind: "unavailable", unavailable: body.unavailable };
    case "refused":
      return { kind: "refused", refused: body.refused };
  }
}
/** Reads the wire's answer back into the four arms a read states, and answers `undefined` for a status or a body this read does not answer with. */
function resultOf<T, C extends Coverage>(target: ReadTarget, status: number, body: unknown): ReadResult<ReadEnvelope<T, C>> | undefined {
  // A handler may answer the result itself rather than the envelope inside it, and that arm is read before the status:
  // the wrapping already states which of the four answers this is.
  if (isReadResult(body)) return wrappedResultOf(target, body);
  switch (status) {
    case ENVELOPE_STATUS:
      return isReadEnvelopeOf<T, C>(body, target.admits) ? { kind: "envelope", envelope: body } : undefined;
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      return isOutcome(body) && body.outcome === "denied" ? { kind: "denied", denied: body } : undefined;
    case UNAVAILABLE_STATUS:
      return isOutcome(body) && body.outcome === "unavailable" ? { kind: "unavailable", unavailable: body } : undefined;
    case REFUSED_STATUS:
      return isOutcome(body) && body.outcome === "invalid" ? { kind: "refused", refused: body } : undefined; // The request stated something the read does not admit: the caller is handed the field-keyed refusal to correct rather than an outage of a source that answered perfectly well.
    default:
      return undefined;
  }
}
/** Issues the one request a read makes and answers either its four arms or the fault that stopped it. */
async function transportOf<T, C extends Coverage>(target: ReadTarget): Promise<TransportAnswer<T, C>> {
  const asksWithBody = target.body !== undefined;
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: asksWithBody ? "POST" : "GET",
      headers: asksWithBody ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      credentials: "same-origin", // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request carries it, and the handler resolves the caller's authority from it rather than from the query.
      cache: "no-store", // Next caches opt-in, and a stale envelope would be a lie about the store's current state.
      ...(asksWithBody ? { body: JSON.stringify(target.body) } : {}),
    });
  } catch {
    return { kind: "none", status: undefined, detail: "no answer at all" }; // No caller abandons a read — it fills the cache rather than belonging to one component — so a request that threw here was cut off by the transport itself, and the surface is handed its own outage.
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "none", status: response.status, detail: "a body that is not JSON" };
  }
  const result = resultOf<T, C>(target, response.status, body);
  if (result === undefined) return { kind: "none", status: response.status, detail: "a body this read does not answer with" };
  return { kind: "result", result };
}
/** Reads one URL and answers the four results a read states, throwing {@link ReadTransportError} for a status the read */
export async function fetchRead<T, C extends Coverage = Coverage>(target: ReadTarget): Promise<ReadResult<ReadEnvelope<T, C>>> {
  const answer = await transportOf<T, C>(target);
  if (answer.kind === "result") return answer.result;
  throw new ReadTransportError(target.url, answer.status, answer.detail);
}
/** Reads one URL and answers the outage this read states when the request produced none of its four results, so no surface is handed no answer at all. */
export async function fetchReadOrOutage<T, C extends Coverage = Coverage>(target: OutageReadTarget): Promise<ReadResult<ReadEnvelope<T, C>>> {
  const answer = await transportOf<T, C>(target);
  if (answer.kind === "result") return answer.result;
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: target.source, guidance: target.guidance }) };
}
/** The source a transport fault is reported under for a read that names no source of its own: the handler this application called. */
export function handlerSource(reference: string): SourceReference {
  return { system: HANDLER_SOURCE_SYSTEM, reference };
}
// ---------------------------------------------------------------------------------------------
// The key and the query every read is cached under
// ---------------------------------------------------------------------------------------------
/** The key every read in this application uses: the scope's own segments, the read's job, and whatever else tells two requests of that job apart. */
export type ReadQueryKey = readonly [...ScopeKey, string, ...(readonly unknown[])];
/** Builds one read's cache key, so a key can only ever lead with the scope and no two requests share an entry. */
export function readQueryKey(key: ScopeKey, job: string, segment: readonly unknown[] = []): ReadQueryKey {
  return [...key, job, ...segment];
}
/** The one shape every read answers with in the cache: its own four arms, or the pending and error states TanStack owns. */
export type ReadQueryResult<T, C extends Coverage = Coverage> = UseQueryResult<ReadResult<ReadEnvelope<T, C>>, Error>;
/** What a read needs to become a cached query. */
export interface ReadQueryOptions<T, C extends Coverage = Coverage> {
  /** The scope's own key segments, taken from the one builder every cache key in this application starts with. */
  readonly key: ScopeKey;
  /** The read's job, in the vocabulary the service read uses. */
  readonly job: string;
  /** Whatever else tells two requests of this job apart: the query, the page, or the record's identifier. */
  readonly segment?: readonly unknown[];
  /** The one request this query issues: a read fills the cache rather than belonging to one component, so it takes nothing that could abandon it. */
  readonly read: () => Promise<ReadResult<ReadEnvelope<T, C>>>;
  /** How long the answer is treated as fresh, where the family states it. */
  readonly staleTime?: number;
  /** Whether the read is issued at all: a query nobody named stays idle rather than asking about nothing. */
  readonly enabled?: boolean;
  /** The answer a server render already holds, offered to this entry as its first one. */
  readonly initialAnswer?: ReadResult<ReadEnvelope<T, C>>;
  /** Whether mounting asks again; a seeded view states `false` so the server's answer is the first paint. */
  readonly refetchOnMount?: boolean;
  /** Whether a page on screen is kept while the next one lands, so a pending read is a busy list and never an empty one. */
  readonly keepPrevious?: boolean;
}
/** How long a seeded answer stands for: the as-of instant the envelope states, and nothing at all when it states none. */
export function asOfInstant(asOf: string): number | undefined {
  const instant = Date.parse(asOf);
  return Number.isFinite(instant) ? instant : undefined;
}
/** Reads one job into the cache under its scope-led key: the answer is the read's own four arms, unwrapped, so every surface narrows it the same way. The query is never cancelled by an observer unmounting — the answer belongs to the cache, not to the component that asked — so one request per key is in flight at a time and a remount inside the cache's lifetime joins that request instead of repeating it. */
export function useReadQuery<T, C extends Coverage = Coverage>(options: ReadQueryOptions<T, C>): ReadQueryResult<T, C> {
  const { key, job, segment, read, staleTime, enabled, initialAnswer, refetchOnMount, keepPrevious } = options;
  const seededAt = initialAnswer !== undefined && initialAnswer.kind === "envelope" ? asOfInstant(initialAnswer.envelope.asOf) : undefined; // A seeded entry is as fresh as the instant the envelope states it was read at, so the first paint is the server's own answer rather than the moment the browser mounted.
  return useQuery<ReadResult<ReadEnvelope<T, C>>, Error>({
    queryKey: readQueryKey(key, job, segment),
    queryFn: () => read(),
    retry: false, // A refusal is an answer this read states, not a moment to ask again: a retry loop would turn one denial, outage or refused request into a stream of requests and still leave the surface with nothing to show.
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(refetchOnMount === undefined ? {} : { refetchOnMount }),
    ...(keepPrevious === true ? { placeholderData: keepPreviousData } : {}),
    ...(initialAnswer === undefined ? {} : { initialData: initialAnswer }),
    ...(seededAt === undefined ? {} : { initialDataUpdatedAt: seededAt }),
  });
}
/** The envelope a settled result carries, or `null` while there is none: a denial and an outage carry no envelope, and a query that has not answered carries no result. */
export function envelopeIn<T, C extends Coverage = Coverage>(result: ReadResult<ReadEnvelope<T, C>> | undefined): ReadEnvelope<T, C> | null {
  return result !== undefined && result.kind === "envelope" ? result.envelope : null;
}
// ---------------------------------------------------------------------------------------------
// The change: one POST, its outcome, and the reads it leaves out of date
// ---------------------------------------------------------------------------------------------
/** Whether the device reports no connection at all — the one case in which this client did not send the request, so an outage is stated rather than an attempt whose fate is undetermined. */
function definitelyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
/** Sends one named change's four fields to the handler that admits it and answers exactly one of the eight outcomes: */
export async function sendMutation<Payload>(url: string, input: MutationInput<Payload>, offlineGuidance: string): Promise<MutationOutcome> {
  // The four fields are copied rather than spread from the caller's object: nothing else the caller holds can join the
  const fields: MutationInput<Payload> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload }; // body on its way out, and no member the service would refuse travels with it.
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin", // The development session is an httpOnly, sameSite=lax cookie, so the handler can derive scope only from a same-origin request that carries it.
      cache: "no-store", // A stored answer would be a different attempt's answer: two submissions under one identity must both reach the handler that recognises the replay.
      body: JSON.stringify(fields),
    });
  } catch (fault) {
    // A device that reports no connection never sent the request, so `unavailable` states an outage with its retry
    // guidance rather than an undetermined attempt. Anywhere else, an effect that may have been applied cannot be told
    // from one that was not, so `unknown` carries the caller's own identity and recovery is a re-query of that identity.
    if (definitelyOffline()) return unavailable({ operationId: fields.operationId, source: handlerSource(url), guidance: offlineGuidance });
    return outcomeFromError(fields.operationId, fault);
  }
  let answered: unknown; // The body is the contract, not the status: a denial, a conflict and a lost acknowledgement all travel as the body of the one outcome, so gating on `response.ok` would discard exactly the outcomes a caller has to render.
  try {
    answered = await response.json();
  } catch (fault) {
    return outcomeFromError(fields.operationId, fault);
  }
  return isOutcome(answered) ? answered : outcomeFromError(fields.operationId, new Error(UNREADABLE_ANSWER_MESSAGE));
}
/** Re-reads the job segments a settled change makes stale, inside the scope the change was made in and nowhere else. */
export async function refreshJobs(queryClient: QueryClient, outcome: MutationOutcome, key: ScopeKey, jobs: readonly string[], refreshing: readonly OperationOutcomeName[] = DEFAULT_REFRESHING): Promise<void> {
  if (!refreshing.includes(outcome.outcome)) return;
  await Promise.all(jobs.map((job) => queryClient.invalidateQueries({ queryKey: [...key, job] }))); // Prefix invalidation follows the hierarchical key every read uses, so every params variant of each job in this scope is asked for again while no other context's entry is touched.
}
/** What one cached change needs: where it posts, what payload that handler admits, the scope segments its family's reads are keyed by, and what a settled answer leaves stale. */
export interface OutcomeMutationOptions<Payload = unknown> {
  /** The one handler that admits this change. */
  readonly url: string;
  /** The schema the payload this change carries has to satisfy, so the one transport can refuse a malformed value with its field messages before any request leaves the browser; a change whose family declares none posts its payload exactly as the caller stated it. */
  readonly payloadSchema?: ZodType<Payload>;
  /** The job segments of this family's reads that a settled change makes stale. */
  readonly jobs: readonly string[];
  /** What a request that never left this device is reported with, stated by the family that owns the surface. */
  readonly offlineGuidance: string;
  /** The outcomes that leave those reads out of date; the two that produced or replayed an effect unless the family states otherwise. */
  readonly refreshing?: readonly OperationOutcomeName[];
}
/** Submits one of a family's named changes and re-reads what it leaves stale, answering exactly one of the eight outcomes. */
export function useOutcomeMutation<Payload>(options: OutcomeMutationOptions<Payload>): UseMutationResult<MutationOutcome, Error, MutationInput<Payload>> {
  const queryClient = useQueryClient();
  const { url, payloadSchema, jobs, offlineGuidance, refreshing } = options;
  return useMutation<MutationOutcome, Error, MutationInput<Payload>>({
    retry: false, // Recovery is the attempt's `operationId` and the service's ledger, never a library retry: a quiet resubmission would either repeat the effect or answer `changed-intent` for a conflict the caller never caused.
    networkMode: "always", // What a device with no connection is told is this module's decision, not the connection clock's: `sendMutation` must run to answer `unavailable` with the family's own guidance, where the default would pause the attempt here and resume it by itself once the connection returned, applying the change with no notice.
    mutationFn: async (input: MutationInput<Payload>): Promise<MutationOutcome> => {
      // A payload this change's own schema refuses is answered as `invalid` with its field messages and never sent, so the same refusal reaches
      // the surface without a request whose only outcome could be that refusal; the schema's own output is what travels, as the handler's is the same shape.
      if (payloadSchema === undefined) return sendMutation(url, input, offlineGuidance);
      const checked = payloadSchema.safeParse(input.payload);
      if (!checked.success) return invalid({ operationId: input.operationId, fields: checked.error });
      const fields: MutationInput<Payload> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: checked.data };
      return sendMutation(url, fields, offlineGuidance);
    },
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<Payload>): Promise<void> => {
      await refreshJobs(queryClient, outcome, scopeKey(input.scope), jobs, refreshing);
    },
  });
}
// ---------------------------------------------------------------------------------------------
// The attempt's identity
// ---------------------------------------------------------------------------------------------
/** Writes a JSON value with its object members in a fixed order, so two equal intents produce one string. */
function canonicalIntent(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  const members = Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalIntent(member)}`);
  return `{${members.join(",")}}`;
}
/** The stable fingerprint of one intent, for this module's own bookkeeping only: it decides whether the attempt in flight is the same piece of work, and is never sent. */
function intentKeyOf(name: string, scope: Scope, expectedRevision: string, payload: unknown): string {
  return [name, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, canonicalIntent(payload)].join("|");
}
/** The identity one attempt carries, and the way back to the intent it was minted for. */
export interface AttemptIdentity {
  /** The identity to send: the caller's own when it states one, the held id for a repeated intent, and a fresh id for a changed one. */
  readonly operationIdFor: (name: string, scope: Scope, expectedRevision: string, payload: unknown, supplied?: string) => string;
  /** Forget the held identity, so a form starting a new entry makes a new attempt rather than replaying the last one. */
  readonly forget: () => void;
}
/** The identity of one mutation attempt. */
export function useAttemptIdentity(): AttemptIdentity {
  const held = useRef<{ readonly intent: string; readonly operationId: string } | null>(null);
  const operationIdFor = (name: string, scope: Scope, expectedRevision: string, payload: unknown, supplied?: string): string => {
    if (supplied !== undefined && supplied.length > 0) return supplied;
    const intent = intentKeyOf(name, scope, expectedRevision, payload);
    const current = held.current;
    if (current !== null && current.intent === intent) return current.operationId;
    const operationId = newOperationId();
    held.current = { intent, operationId };
    return operationId;
  };
  const forget = (): void => {
    held.current = null; // The retained identity goes with the outcome: reusing the old id would make a genuine second attempt look like a replay.
  };
  return { operationIdFor, forget };
}
