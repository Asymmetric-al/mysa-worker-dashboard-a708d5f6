"use client";
/**
 * The Audience family's four browser mutations: the deliberate signup that opens the synthetic proof step, the
 * confirmation that closes it, the reader's Off or Immediate choice together with a reading language, and the
 * one-publisher unsubscribe. This is the only place this family writes to the server from the browser.
 *
 * **Authority.** AAP 0.7.1 — every mutation takes the four-field input `{ operationId, scope, expectedRevision,
 * payload }` and answers with exactly one of the eight outcomes; AAP 0.6.3 — the audience Route Handlers
 * `POST /api/audience`, `POST /api/confirm`, `POST /api/preferences` and `POST /api/unsubscribe`, each admitting one
 * named mutation and no `kind` or `mutation` discriminator; AAP 0.9.1 and 0.11.1 row
 * `apps/dashboard/src/features/audience/**`; AAP 0.10.1 family 10, and criteria 10, 11 and 19.
 *
 * The attempt's identity is not minted here. `useReviewedMutation` in `@/components/action-review` owns it upstream,
 * so a retry of one intent reuses one `operationId` and a changed intent draws a new one.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import { isOutcome, outcomeFromError, unavailable, type MutationOutcome } from "@/modules/data-service/outcome";
import type { ConfirmPayload, SignupPayload } from "../schemas/confirmation";
import type { SetPreferencePayload } from "../schemas/preference";
import type { UnsubscribePayload } from "../schemas/unsubscribe";
import { AUDIENCE_JOB_SEGMENTS } from "./use-audience-reads";
// The four handlers, exactly as AAP 0.6.3 names them. Each admits one mutation on POST and answers with that
// mutation's outcome as its own body, so no path here carries a second mutation for a discriminator to choose between.
const SIGNUP_PATH = "/api/audience";
const CONFIRM_PATH = "/api/confirm";
const PREFERENCE_PATH = "/api/preferences";
const UNSUBSCRIBE_PATH = "/api/unsubscribe";
/** The source a rejected connection is reported against: the request boundary of this application, named as a source so an outage names something a person can act on and never a record. */
const HANDLER_SOURCE_SYSTEM = "data-service";
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same step again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
const UNREADABLE_ANSWER_MESSAGE = "The handler answered with a body that is not one of the eight outcomes, so this attempt's result is not known from the response.";
/**
 * Whether the device reports no connection at all — the one case in which this client did not send the request, so an
 * outage is stated rather than an attempt whose fate is undetermined.
 */
function definitelyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
/**
 * Sends one mutation's four fields to the one handler that admits it and answers with exactly one of the eight
 * outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 */
async function postMutation<Payload>(endpoint: string, input: MutationInput<Payload>): Promise<MutationOutcome> {
  // The four fields are copied rather than spread from the caller's object: nothing else the caller holds can join the
  // body on its way out, and no member the service would refuse travels with it.
  const fields: MutationInput<Payload> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: input.payload };
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // The development session is an httpOnly, sameSite=lax cookie, so the handler can derive scope only from a
      // same-origin request that carries it.
      credentials: "same-origin",
      // A stored answer would be a different attempt's answer: two submissions under one identity must both reach the
      // handler that recognises the replay.
      cache: "no-store",
      body: JSON.stringify(fields),
    });
  } catch (fault) {
    // The reply never arrived. Where the device reports no connection at all the request did not leave from here, so
    // `unavailable` states an outage with its retry guidance rather than an undetermined attempt, and resubmitting is
    // safe: the same attempt identity is reused, so a request that had already arrived answers with its original result.
    // Anywhere else a request that was applied and acknowledged into the void is indistinguishable from one that failed,
    // so the mapped outcome — `unknown` — carries the caller's own identity, and recovery is a re-query of that identity
    // rather than a second send under a fresh one.
    if (definitelyOffline()) {
      return unavailable({ operationId: fields.operationId, source: { system: HANDLER_SOURCE_SYSTEM, reference: endpoint }, guidance: OFFLINE_GUIDANCE });
    }
    return outcomeFromError(fields.operationId, fault);
  }
  // The body is the contract, not the status: a denial, a conflict and a lost acknowledgement all travel as bodies of
  // the one outcome, so gating on `response.ok` would discard exactly the outcomes a caller has to render.
  let body: unknown;
  try {
    body = await response.json();
  } catch (fault) {
    return outcomeFromError(fields.operationId, fault);
  }
  return isOutcome(body) ? body : outcomeFromError(fields.operationId, new Error(UNREADABLE_ANSWER_MESSAGE));
}
/** Whether an answer leaves the reads beside it out of date: only the three accepting outcomes changed what this family reads. */
function reachesTheReads(outcome: MutationOutcome): boolean {
  // `unchanged` is included because an answer that produced no change still answered from the current state, and the
  // audience view would otherwise keep showing the membership the answer was about. The other five changed nothing this
  // family reads — and `unknown` in particular must leave recovery to the operation identity the outcome carries, so a
  // refetch never stands in for checking the result.
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
}
/** Asks every read this family keys for again, in the authority the answer was made under. */
async function revalidateAudienceReads(queryClient: QueryClient, scope: Scope): Promise<void> {
  const context = scopeKey(scope);
  // Prefix invalidation over the seven job segments the family's own read module declares, so the audience view, the
  // reader's preferences, the inbox and the receiving views are asked for again the next time each is needed. The
  // segments come from that one definition, so no key is spelled by hand here — and nothing is written into the cache
  // in their place, which is what keeps an accepted preference from being shown as a subscription.
  await Promise.all(AUDIENCE_JOB_SEGMENTS.map((job) => queryClient.invalidateQueries({ queryKey: [...context, job] })));
}
/** Opens one purpose-specific membership for a deliberate signup and leaves it awaiting proof, over `POST /api/audience` (`signupForPurpose`). Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`, unchanged. */
export function useSignupForPurpose(): UseMutationResult<MutationOutcome, Error, MutationInput<SignupPayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<SignupPayload>>({
    // Nothing here retries: a retry cannot distinguish a lost acknowledgement from a failure, so `unknown` is recovered
    // by re-querying the same `operationId` through the review step that owns it, never by this module sending again.
    retry: false,
    mutationFn: (input: MutationInput<SignupPayload>): Promise<MutationOutcome> => postMutation(SIGNUP_PATH, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<SignupPayload>): Promise<void> => {
      if (!reachesTheReads(outcome)) {
        return;
      }
      await revalidateAudienceReads(queryClient, input.scope);
    },
  });
}
/**
 * Confirms one membership inside its 168-elapsed-hour confirmation window, over `POST /api/confirm` (`confirmMembership`):
 * the person's own deliberate act, which this module never performs on mount and never schedules. Answers `accepted`,
 * `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`, unchanged.
 */
export function useConfirmMembership(): UseMutationResult<MutationOutcome, Error, MutationInput<ConfirmPayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<ConfirmPayload>>({
    retry: false,
    mutationFn: (input: MutationInput<ConfirmPayload>): Promise<MutationOutcome> => postMutation(CONFIRM_PATH, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<ConfirmPayload>): Promise<void> => {
      if (!reachesTheReads(outcome)) {
        return;
      }
      await revalidateAudienceReads(queryClient, input.scope);
    },
  });
}
/**
 * Records the reader's Off or Immediate choice, and a reading language when the payload states one, over
 * `POST /api/preferences` (`setPreference`). The two facts stay separate: a language records no consent and resets no
 * notification intent. Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`,
 * `unavailable` or `unknown`, unchanged.
 */
export function useSetPreference(): UseMutationResult<MutationOutcome, Error, MutationInput<SetPreferencePayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<SetPreferencePayload>>({
    retry: false,
    mutationFn: (input: MutationInput<SetPreferencePayload>): Promise<MutationOutcome> => postMutation(PREFERENCE_PATH, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<SetPreferencePayload>): Promise<void> => {
      if (!reachesTheReads(outcome)) {
        return;
      }
      await revalidateAudienceReads(queryClient, input.scope);
    },
  });
}
/**
 * Turns off the acting reader's Update email from one publisher for one purpose, over `POST /api/unsubscribe`
 * (`unsubscribe`), leaving every other membership untouched and claiming no recall of a message already received.
 * Answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`,
 * unchanged.
 */
export function useUnsubscribe(): UseMutationResult<MutationOutcome, Error, MutationInput<UnsubscribePayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<UnsubscribePayload>>({
    retry: false,
    mutationFn: (input: MutationInput<UnsubscribePayload>): Promise<MutationOutcome> => postMutation(UNSUBSCRIBE_PATH, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<UnsubscribePayload>): Promise<void> => {
      if (!reachesTheReads(outcome)) {
        return;
      }
      await revalidateAudienceReads(queryClient, input.scope);
    },
  });
}
