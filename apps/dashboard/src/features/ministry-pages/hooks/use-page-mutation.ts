"use client";

/**
 * The Worker and Project Pages family's single mutation transport.
 *
 * One hook posts the four-field mutation input — `{ operationId, scope, expectedRevision, payload }`
 * — to the handler a caller names, and answers with exactly one of the eight mutation outcomes. It
 * is the family's only `POST`: the sibling hooks that drive page variants, sections, release, reach,
 * withdrawal and media each hand it a documented handler path plus the key prefixes to re-read, and
 * compose their own payload schema and review step around it. One transport is what keeps "what
 * happened" a single answer across the family — a second client would eventually disagree with this
 * one about whether a lost acknowledgement was a success. It serves the family's nineteen named
 * mutations and nothing else: the sixteen page writes and the three media writes the data service
 * already names.
 *
 * What it does, and nothing more:
 *
 * - **Sends the input verbatim.** The body is the object it receives, never re-keyed and never
 *   extended, so the `operationId` the caller minted stays the identity a replay is recognised by.
 * - **Answers with the body's outcome.** The handler already mapped its answer through the service's
 *   own response mapping, so a non-2xx status is not an exception here: a 409 conflict, a 403 denial
 *   and a 422 validation result are outcomes like any other and are returned unchanged. A body that
 *   is not an outcome — a proxy's error page, a truncated stream, a `2xx` carrying something else
 *   entirely — becomes `unknown`, because success and failure are both lies about a response nobody
 *   could read.
 * - **Reports a transport fault as `unavailable`.** A request that never completed a round trip
 *   produced no outcome, so it is reported as the source being unreachable, naming the application's
 *   own data service and the one retry that is safe: the same operation id, which a replay answers
 *   with the stored result.
 * - **Re-reads where the truth is worth checking.** An accepted change makes every read that
 *   described the previous revision stale. `unknown` re-reads too, as a check of the true state and
 *   never as a confirmation.
 *
 * What it deliberately does not do. It mints no `operationId`, because identity belongs to the
 * caller — one per intent. It keeps no ledger and no record of past operations, because the service
 * owns replay. It validates nothing, because the per-mutation hook's own schema and the service
 * remain authoritative. It renders nothing, owns no review step (`useReviewedMutation` owns
 * review-and-receipt), writes nothing optimistically, and holds no second "submitting" flag:
 * `isPending` is the double-submit fence, and two owners of that fact would eventually disagree. It
 * reads no clock, so no instant a person sees can come from the browser; the displayed instant is
 * the read envelope's `asOf`. Nothing retries either: a timed-out mutation may already have been
 * applied, TanStack Query does not retry mutations by default, and repeating one is always the
 * caller's deliberate act under the same identity.
 *
 * Layering. This module composes `useMutation`, `fetch` and cache invalidation, and imports only the
 * contract modules that own the outcome vocabulary. It reaches no store, no read, no mutation, no
 * media or content module, no feature and no styled component, and it receives the query-key
 * prefixes it invalidates as configuration rather than importing the family's key builders.
 *
 * Plan items that put this file in scope: AAP 0.7.1 (the four-field input and the closed outcome
 * set), A2 (Route Handlers as the only browser mutation transport), 0.3.2 (one authorised data path
 * whose outcome the UI renders durably) and 0.12.1 criteria 12, 17 and 18 (release and withdrawal,
 * per-variant results, media).
 */

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { assertNever } from "@/lib/result";
import type { MutationInput } from "@/modules/data-service";
/* The outcome module rather than the service barrel, because this is a browser module: a value
 * import of the barrel would pull every read, every mutation and the store into the client bundle.
 * The barrel carries the contract types a boundary names; the guard and the constructors a client
 * answers with are owned here, and are imported from their owner rather than restated, so a ninth
 * outcome or a changed denial shape reaches this file as a compile error instead of drifting. */
import {
  isOutcome,
  unavailable,
  unknown,
  type MutationOutcome,
} from "@/modules/data-service/outcome";

/**
 * What one member of the family's mutation hooks is configured with.
 *
 * The transport holds no opinion about which handlers exist or how the cache is keyed; both belong
 * to the job that owns them, so a new page mutation adds an entry to its own hook rather than
 * touching this one.
 */
export interface PageMutationConfig {
  /**
   * The documented handler path this mutation posts to, such as `/api/pages/sections`. It is a
   * literal written by the calling hook: a path is never assembled from anything a person typed,
   * because a caller-supplied address would make this transport a request forger.
   */
  path: string;
  /**
   * Query-key prefixes to re-read on `accepted` and `alreadyAccepted`, and — as a check of the true
   * state only — on `unknown`. A prefix, not an exact key: the reads a change invalidates are all
   * the reads that described the record, whatever their filters.
   */
  invalidate?: readonly (readonly unknown[])[];
}

/**
 * The source system a transport fault names: the application's own data service.
 *
 * Not the store, a file, a provider or a host. An `unavailable` outcome identifies the boundary that
 * could not be reached without disclosing anything about what holds the data, and the reference
 * carried with it is the handler path, which is public by construction.
 */
const HANDLER_SOURCE_SYSTEM = "data-service";

/**
 * What the caller is told when a request never completed its round trip.
 *
 * The safe next step is stated because it genuinely is safe: the service answers a replay of the
 * same operation id with the stored result rather than applying the effect a second time. Nothing
 * here invites a fresh attempt at the work itself.
 */
const TRANSPORT_GUIDANCE =
  "The request did not complete, so this change is reported as neither applied nor refused. Retry it with the same operation id: a replay returns the original result instead of repeating the effect.";

/**
 * Reads the handler's JSON body, treating a body that cannot be parsed as "no outcome" rather than
 * as a fault of its own.
 *
 * A truncated stream, an empty body and an HTML error page all land here, and the caller's next
 * decision is the same in each case: the request is unconfirmed, so it is answered as `unknown`.
 */
async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/**
 * Posts one mutation input to one documented handler and answers with exactly one outcome.
 *
 * The four-field input travels verbatim, so the `operationId` inside it is the identity the service
 * replays. The body is read whatever the status was: the handler maps every outcome through the
 * service's one status ladder, so a 409 conflict and a 202 unknown arrive as outcomes rather than
 * as errors this side has to reinterpret — reinterpreting them here would be a second policy for
 * the same contract.
 */
async function postPageMutation<P>(
  path: string,
  input: MutationInput<P>,
): Promise<MutationOutcome> {
  let answer: Response;
  try {
    answer = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    /* A rejected `fetch` covers a network fault and an abort alike, and both mean the same thing
     * here: no outcome crossed the wire. The effect's fate is not known to this side, so the answer
     * states the source that could not be reached and the retry that cannot duplicate anything. */
    return unavailable({
      operationId: input.operationId,
      source: { system: HANDLER_SOURCE_SYSTEM, reference: path },
      guidance: TRANSPORT_GUIDANCE,
    });
  }

  const body = await readJsonBody(answer);
  if (isOutcome(body)) {
    return body;
  }
  /* A body that is not an outcome is not a success, whatever its status. `unknown` carries the
   * caller's own operation id, which is the only handle that can recover the truth, and it promises
   * neither success nor failure so no surface can turn it into a resend. */
  return unknown({ operationId: input.operationId });
}

/**
 * Re-reads every configured key prefix after an outcome whose truth is worth checking.
 *
 * The prefixes are the caller's, so the cache keys stay owned by the read hooks that declare them
 * and this module never builds one. `invalidateQueries` resolves rather than rejects unless it is
 * told to throw, so a re-read that fails is presented by the read that owns it and never escapes
 * from here as an exception the mutation's receipt could not describe.
 */
function reReadPrefixes(
  queryClient: QueryClient,
  prefixes: PageMutationConfig["invalidate"],
): void {
  for (const queryKey of prefixes ?? []) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * The family's single mutation transport: posts the four-field input to a documented handler and
 * returns one of eight outcomes; invalidates on accepted/alreadyAccepted, re-reads on unknown.
 *
 * `P` is the mutation's payload type, so the hook that owns a job parameterises this one with the
 * payload its own schema produces and the caller's `mutate` is typed by it.
 */
export function usePageMutation<P>(
  config: PageMutationConfig,
): UseMutationResult<MutationOutcome, never, MutationInput<P>> {
  const queryClient = useQueryClient();
  const { path, invalidate } = config;

  return useMutation<MutationOutcome, never, MutationInput<P>>({
    mutationFn: (input) => postPageMutation(path, input),
    onSuccess: (outcome) => {
      switch (outcome.outcome) {
        case "accepted":
        case "alreadyAccepted":
          /* The change landed — now, or on the attempt this request replayed — so every read that
           * described the record's previous revision is stale. An `alreadyAccepted` replay reports
           * the stored result rather than a new effect, and re-reads for the same reason. */
          reReadPrefixes(queryClient, invalidate);
          return;
        case "unknown":
          /* A follow-up read only. It shows what the record actually holds now: a check of the true
           * state, never a confirmation that this request was applied. */
          reReadPrefixes(queryClient, invalidate);
          return;
        case "unchanged":
        case "conflict":
        case "invalid":
        case "denied":
        case "unavailable":
          /* Nothing was written, so nothing read is stale. A conflict hands the caller its preserved
           * input beside the current value, an outage changed no record, and a denial must not cause
           * a read that could describe what the caller may not see. */
          return;
        default:
          /* A ninth outcome has to decide its own invalidation, rather than inheriting one of these
           * arms because it happened to be last. */
          assertNever(outcome, "Unhandled mutation outcome");
      }
    },
  });
}
