"use client";

/**
 * Admission for the shell family: this session's one TanStack Query read of `GET /api/session`, which
 * the root layout answers from `reads.context.readAdmissionState` on the server and which this hook
 * reconciles in the browser.
 *
 * **The one job.** It states which of the five session states the session is in, and nothing else. It
 * holds no record of its own — no copy of the envelope beside the cache entry TanStack Query owns, no
 * persona, no settings and no membership endpoint (Rule 1 clause 1). It never calls the data service:
 * the browser reaches the service only through a Route Handler (AAP 0.3.2, assumption A2).
 *
 * **The key carries the authority and nothing else.** It is the guard's scope segments, the job name
 * and a `null` parameter object, and that scope comes only from the server-read envelope the caller
 * seeds (`initial.scope`). It is never derived from the query's own data — a key that changed when the
 * fetch resolved would refetch forever — and after a context switch it changes only because the switch
 * calls `router.refresh()` and the Server Component hands down a new envelope.
 *
 * **The wire.** `toResponse` flattens a read result onto the status: 200 carries the envelope itself,
 * 403 the denial and 503 the outage, with no `kind` wrapper. The answer is therefore decoded by shape
 * here and the query holds a closed answer: an envelope, a denial, an outage, or "none of those
 * shapes". A request that produced no readable body at all is the query's own error, and that error is
 * data for the mapping below rather than something thrown out of this hook.
 *
 * **Four reconciliations with the contracts as they actually exist**, each repeated at the code:
 * - `useContextFence()` as planned takes no arguments it does not have: the guard's fence requires
 *   `{ scope, selectContext, copy }` and *is* the context switch, which
 *   `features/shell/components/shell-frame.tsx` owns. This hook creates no second switch controller:
 *   it takes the fence's `isStale` predicate as an optional argument (the shell already holds one) and,
 *   with none supplied, compares against the scope this render was seeded with through the guard's own
 *   stale predicate.
 * - There is no bootstrap `scopeKey` variant. With no seeded envelope there is no scope to key by, so
 *   the query is disabled and the answer is `loading`: AAP 0.11.2 drives these reads from
 *   server-provided data.
 * - `initialData` is the seeded envelope wrapped in the decoded answer's envelope member, because the
 *   query's data type is the closed answer that must also carry the "unrecognised body" case.
 * - `AdmissionState` here is the read's **data payload** (the service's `AdmissionStateData`).
 *   `components/app-shell` declares a different `AdmissionState` — the five-word state union — which is
 *   this payload's own `state` member.
 *
 * **The five outcomes stay five.** `denied`, `unavailable` and `unknown` are separate arms and are
 * never an empty list, a zero or a spinner. A denial carries the closed reason code and nothing about
 * any record, count, title or size. An envelope from a context the workspace has left is dropped
 * rather than rendered. And when the read cannot be confirmed, the answer is an outage rather than an
 * admission nothing evidenced, so this hook never claims access it does not have.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { isStale, scopeKey, SCOPE_KEY_ROOT, type ContextFence } from "@/components/context-switch-guard";
import type { SourceReference } from "@/lib/ids";
// Type-only from the barrel: its value graph reaches the synthetic store and `next/server`, so a value
// import here would put server code in the browser bundle. The one runtime import below comes from the
// outcome module, which imports only zod, the guards, the id helpers and the redactor.
import type { DenialReason, reads, ReadEnvelope, Scope } from "@/modules/data-service";
import { DENIAL_REASONS, type DeniedOutcome, type UnavailableOutcome } from "@/modules/data-service/outcome";

// What the read answers with, derived from the service rather than restated
/** The job segment of this read's key, named the way the service names the read. */
export const ADMISSION_STATE_JOB = "admission-state";

/** What `reads.context.readAdmissionState` reports about this session. */
type AdmissionRead = Awaited<ReturnType<typeof reads.context.readAdmissionState>>;

/** The envelope the admission read answers with: its data is the state, its guidance key and — only when admitted — the principal, the selected context and the scenario. */
export type AdmissionEnvelope = Extract<AdmissionRead, { readonly kind: "envelope" }>["envelope"];

/** The admission payload: the same `AdmissionStateData` the service returns, taken from the read's own signature rather than declared a second time. */
export type AdmissionState = AdmissionEnvelope["data"];

/** What the context fence is asked: whether an envelope read in one scope has been overtaken by the context now in force. */
export type AdmissionContextFence = Pick<ContextFence, "isStale">;

/** The closed set of answers this read can give. */
export type AdmissionResult =
  | { readonly state: "ready"; readonly envelope: ReadEnvelope<AdmissionState> }
  | { readonly state: "denied"; readonly reason: DenialReason }
  | { readonly state: "unavailable"; readonly source: SourceReference | null }
  | { readonly state: "unknown"; readonly operationId?: string }
  | { readonly state: "loading" };

// The endpoint and the answer it is decoded into
const ADMISSION_ENDPOINT = "/api/session";

/** The parameter object this job states: none. It stays in the key so every key in the application has the same six segments. */
const ADMISSION_STATE_PARAMS = null;

/**
 * The key used while no envelope has been seeded.
 *
 * It is not built through `scopeKey` because there is no scope to build one from: the three scope
 * positions are `null`, which no identifier can equal, and the query is disabled so this entry is never
 * fetched and never holds data. Once the server seeds an envelope the real, scope-led key replaces it.
 */
const UNSCOPED_KEY = [SCOPE_KEY_ROOT, null, null, null, ADMISSION_STATE_JOB, ADMISSION_STATE_PARAMS] as const;

/** What one request answered, before it is mapped to {@link AdmissionResult}. */
type AdmissionAnswer =
  | { readonly kind: "envelope"; readonly envelope: ReadEnvelope<AdmissionState> }
  | { readonly kind: "denied"; readonly reason: DenialReason }
  | { readonly kind: "unavailable"; readonly source: SourceReference }
  | { readonly kind: "unrecognised" };

// Reading an untrusted body
// A local three-line predicate rather than an import from `@/lib/guards`: this file's dependency set is
// the service contracts, the id helpers and the context guard, and the narrowing it needs is one check.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}

/**
 * Whether a value is the scope the envelope carries.
 *
 * The identifiers are checked for being strings and not for being non-empty: a session in one of the
 * four states that grant nothing is answered with a reserved empty scope, which states "no authority"
 * and must still be read as the envelope it is.
 */
function isScope(value: unknown): value is Scope {
  return isRecord(value) && typeof value.organizationId === "string" && typeof value.ministryId === "string" && typeof value.supportSubjectId === "string" && typeof value.principalId === "string";
}

function isAdmissionEnvelope(value: unknown): value is ReadEnvelope<AdmissionState> {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, source, revision, asOf, coverage, valueStates, actions } = value;
  return (
    isRecord(data) &&
    isNonEmptyString(data.state) &&
    isNonEmptyString(data.guidance) &&
    "principalId" in data &&
    "context" in data &&
    "scenarioId" in data &&
    isScope(scope) &&
    isSourceReference(source) &&
    isNonEmptyString(revision) &&
    isNonEmptyString(asOf) &&
    isRecord(coverage) &&
    isNonEmptyString(coverage.state) &&
    isRecord(valueStates) &&
    Array.isArray(actions)
  );
}

function isDenialReason(value: unknown): value is DenialReason {
  // The closed set is the outcome module's own tuple, so a ninth code added to the contract is accepted
  // here without a second list in this file.
  return typeof value === "string" && DENIAL_REASONS.some((reason) => reason === value);
}

function isDeniedBody(value: unknown): value is DeniedOutcome {
  return isRecord(value) && value.outcome === "denied" && typeof value.operationId === "string" && isDenialReason(value.reasonCode);
}

function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  return isRecord(value) && value.outcome === "unavailable" && typeof value.operationId === "string" && isSourceReference(value.source) && isNonEmptyString(value.guidance);
}

/**
 * Reads this session's admission over its own origin.
 *
 * The signal is the query-function context's, so the context fence's `cancelQueries()` really does abort
 * a request that is in flight when the context changes. A transport fault, and a body that is not JSON,
 * reject: the mapping turns that into the outage arm, and the caller can then retry deliberately. A body
 * that is JSON but none of the recognised shapes is answered as such rather than treated as a fault,
 * because the handler did answer and its answer was not an admission statement.
 */
async function readAdmissionAnswer(signal: AbortSignal): Promise<AdmissionAnswer> {
  const response = await fetch(ADMISSION_ENDPOINT, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json();
  if (isAdmissionEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (isDeniedBody(body)) {
    return { kind: "denied", reason: body.reasonCode };
  }
  if (isUnavailableBody(body)) {
    return { kind: "unavailable", source: body.source };
  }
  return { kind: "unrecognised" };
}

// Mapping one answer to the closed result
interface AdmissionMapping {
  readonly result: AdmissionResult;
  readonly discarded: boolean;
}

/**
 * Maps what the read holds onto the closed result, in the one order the outcomes outrank each other.
 *
 * The order is not incidental. A stale envelope is dropped before anything else can be said about it.
 * A denial and an outage the service reported are answers, so they outrank a transport failure that
 * happened afterwards. That failure outranks the envelope we hold, because an admission the hook could
 * not re-confirm is not evidence of access: the outage arm names the source the last envelope came from
 * so the notice can say which source could not answer.
 */
function mapAdmission(input: { readonly answer: AdmissionAnswer | undefined; readonly failed: boolean; readonly isStale: (scopeAtRequestTime: Scope) => boolean }): AdmissionMapping {
  const envelope = input.answer?.kind === "envelope" ? input.answer.envelope : null;
  if (envelope !== null && input.isStale(envelope.scope)) {
    return { result: { state: "loading" }, discarded: true };
  }
  const answer = input.answer;
  if (answer?.kind === "denied") {
    return { result: { state: "denied", reason: answer.reason }, discarded: false };
  }
  if (answer?.kind === "unavailable") {
    return { result: { state: "unavailable", source: answer.source }, discarded: false };
  }
  if (answer?.kind === "unrecognised") {
    // A read produces no effect, so there is nothing to check and no operation identity to name.
    return { result: { state: "unknown" }, discarded: false };
  }
  if (input.failed) {
    // The one arm a failure produces, in the one place it can be stated: the source the last envelope
    // came from when one was held, and `null` — never an invented system name — when none was.
    return { result: { state: "unavailable", source: envelope === null ? null : envelope.source }, discarded: false };
  }
  if (envelope !== null) {
    return { result: { state: "ready", envelope }, discarded: false };
  }
  return { result: { state: "loading" }, discarded: false };
}

/** Attaches the two controls every arm carries, arm by arm, so no arm is widened or collapsed. */
function withControls(result: AdmissionResult, retry: () => void, discarded: boolean): AdmissionResult & { retry(): void; discarded: boolean } {
  switch (result.state) {
    case "ready":
      return { state: "ready", envelope: result.envelope, retry, discarded };
    case "denied":
      return { state: "denied", reason: result.reason, retry, discarded };
    case "unavailable":
      return { state: "unavailable", source: result.source, retry, discarded };
    case "unknown":
      return { state: "unknown", retry, discarded };
    case "loading":
      return { state: "loading", retry, discarded };
  }
}

// The hook
/**
 * Reads this session's admission: `ready` with the envelope, `denied` with the closed reason code,
 * `unavailable` with the source that could not answer, `unknown` for a body that was none of those, or
 * `loading` — plus `retry()` and whether a late answer was discarded.
 *
 * `initial` is the envelope the Server Component already read. It is the first paint, so admission is
 * stated before any request leaves the browser, and it is also the only source of the scope the cache
 * key is built from. `fence.isStale` is the shell's own context fence: pass it and an envelope from a
 * context the workspace has left is dropped even when it is the envelope this render was seeded with.
 */
export function useAdmission(initial?: ReadEnvelope<AdmissionState>, fence?: AdmissionContextFence): AdmissionResult & { retry(): void; discarded: boolean } {
  const seedScope = initial?.scope ?? null;
  const queryKey = useMemo(() => (seedScope === null ? UNSCOPED_KEY : ([...scopeKey(seedScope), ADMISSION_STATE_JOB, ADMISSION_STATE_PARAMS] as const)), [seedScope]);
  const seeded = useMemo<{ readonly initialData: AdmissionAnswer; readonly initialDataUpdatedAt: number } | undefined>(
    () => (initial === undefined ? undefined : { initialData: { kind: "envelope", envelope: initial }, initialDataUpdatedAt: 0 }),
    [initial],
  );
  const query: UseQueryResult<AdmissionAnswer, Error> = useQuery<AdmissionAnswer, Error>({
    queryKey,
    queryFn: ({ signal }) => readAdmissionAnswer(signal),
    // No seeded envelope means no scope to key by and nothing to reconcile: the read is the Server
    // Component's, and a request from here would name an authority this hook does not hold.
    enabled: initial !== undefined,
    // The seeded envelope is the first paint; `initialDataUpdatedAt: 0` with `staleTime: 0` makes the
    // browser reconcile it in the background immediately instead of trusting it indefinitely.
    staleTime: 0,
    // Automatic retries would delay the honest denial or outage surface by seconds, and `retry()` is the
    // documented recovery: one deliberate attempt the person makes, not a silent second request.
    retry: false,
    ...seeded,
  });
  const { refetch } = query;
  const retry = useCallback((): void => {
    // The failure is already this read's own outcome, rendered by the caller, so the promise is observed
    // and nothing is rethrown: a thrown error would be a defect rather than one of the five arms.
    void refetch().catch(() => {
      // Nothing to add: `query.isError` carries the answer the mapping below reads.
    });
  }, [refetch]);
  const scopeIsStale = useCallback(
    (scopeAtRequestTime: Scope): boolean => {
      if (fence !== undefined) {
        return fence.isStale(scopeAtRequestTime);
      }
      // Without the fence the only current context this hook can name is the one the server seeded this
      // render with. That still catches a re-render under a different context; it cannot catch a
      // re-mount that happens before `router.refresh()` lands, which is why the shell passes its fence.
      return seedScope !== null && isStale(scopeAtRequestTime, seedScope);
    },
    [fence, seedScope],
  );
  const mapping = mapAdmission({ answer: query.data, failed: query.isError, isStale: scopeIsStale });
  return withControls(mapping.result, retry, mapping.discarded);
}
