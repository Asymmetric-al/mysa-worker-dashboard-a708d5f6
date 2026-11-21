/**
 * The Referrals family's only browser transport for its two writes — recording that an introduction
 * actually happened, and continuing one ordinarily expired cycle — and the two hooks the introduction
 * form and the Continue confirmation submit through.
 *
 * Scope: AAP 0.9.1 (`features/referrals/**`), AAP 0.11.1 (the referral lists, detail and Continue), and
 * the AAP 0.6.1 / 0.7.1 inventory row "Act on an introduction", whose two commands these are
 * (`recordIntroduction`, `continueReferral`), over the AAP 0.6.3 transports `POST /api/referrals` and
 * `POST /api/referrals/continue`. Because both writes travel through the one private helper below, the
 * four-field mutation contract is written down once for this family rather than once per command.
 *
 * This module declares no client-boundary directive of its own: it exports hooks only, so the components
 * that render them own that boundary.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service";
/**
 * The outcome module rather than the service barrel for these four, because this is a browser module:
 * a value import of the barrel would pull every named read, every named mutation and the synthetic store
 * behind them into the client bundle. The barrel still carries the contract types a boundary names; the
 * guard and the constructors a client answers with come from their owner, so a ninth outcome or a
 * changed denial shape reaches this file as a compile error instead of drifting from the service.
 */
import { invalid, isOutcome, unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { continueReferralPayloadSchema, introductionPayloadSchema, type ContinueReferralPayload, type IntroductionPayload } from "../schemas";
// The two handlers, exactly as AAP 0.6.3 names them
/** Records an original introduction date: `POST /api/referrals` dispatches to `recordIntroduction`. */
const RECORD_INTRODUCTION_PATH = "/api/referrals";
/** Continues one ordinarily expired cycle: `POST /api/referrals/continue` dispatches to `continueReferral`. */
const CONTINUE_REFERRAL_PATH = "/api/referrals/continue";
// The cache segments a referral write can change: the three lists, and every cycle read
const REFERRALS_JOB = "referrals";

const REFERRAL_JOB = "referral";
// Reading the answer
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
/**
 * The folder's only mutation transport — validates, posts the four-field body, parses the outcome and
 * turns a lost acknowledgement into `unknown` with the same `operationId`.
 */
async function postReferralMutation<TPayload>(path: string, schema: ZodType<TPayload>, input: MutationInput<TPayload>): Promise<MutationOutcome> {
  // Validate before sending: this is the form-side copy of the service's own payload check, so a value
  // the service would refuse is refused here, with the same field paths, and the person is not made to
  // wait for a round trip to learn what this page already knew.
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    return invalid({ operationId: input.operationId, fields: parsed.error });
  }
  // Only the schema's output travels: the schema is the allow-list, so a member the caller's object
  // carried by accident cannot reach the handler. The four fields are copied rather than spread from the
  // input for the same reason — nothing else the caller holds can join the body on its way out.
  const body: MutationInput<TPayload> = {
    operationId: input.operationId,
    scope: input.scope,
    expectedRevision: input.expectedRevision,
    payload: parsed.data,
  };
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // The development session is an httpOnly, sameSite=lax cookie, so the handler can derive scope
      // only from a same-origin request that carries it.
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    // The reply never arrived, so this module cannot tell a request that was never applied from one that
    // was applied and acknowledged into the void — and a lost acknowledgement is indistinguishable from a
    // failure. `unknown` is therefore the one honest answer; it carries the caller's own `operationId`, so
    // recovery happens by operation identity in `components/operation-result.tsx`, never by re-sending
    // the work under a fresh key.
    return unknownOutcome({ operationId: input.operationId });
  }
  // The body is the contract, not the status: all eight outcomes — `denied`, `conflict` and `unknown`
  // among them — travel through the handler's one response mapper, so gating on `response.ok` would
  // discard exactly the outcomes the caller has to render.
  const answered = await readJsonBody(response);
  if (!isOutcome(answered)) {
    return unknownOutcome({ operationId: input.operationId });
  }
  return answered;
}
// What a settled answer means for the reads beside it
function reachesTheRecord(outcome: MutationOutcome): boolean {
  // `unchanged` is included because an answer that produced no change still answered from the current
  // state, and the list beside it would otherwise keep showing the cycle the answer was about. The other
  // five changed nothing this family reads, and `unknown` in particular must leave recovery by operation
  // identity to the receipt: a refetch is not a substitute for checking the result.
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted" || outcome.outcome === "unchanged";
}
/** Re-reads the three referral lists and every open cycle inside the scope the write was made in, and nothing outside it. */
async function revalidateReferrals(queryClient: QueryClient, scope: Scope): Promise<void> {
  const context = scopeKey(scope);
  // Prefix invalidation follows the hierarchical key the family's reads use, so the lists and each detail
  // refresh together. Awaiting the two keeps the mutation pending until the refreshed reads settle, which
  // is what lets a caller that awaits `mutateAsync` then read the new state.
  await Promise.all([queryClient.invalidateQueries({ queryKey: [...context, REFERRALS_JOB] }), queryClient.invalidateQueries({ queryKey: [...context, REFERRAL_JOB] })]);
}
// Identity belongs to the caller
//
// Both hooks take the whole four-field input and rewrite none of it. `operationId` is minted where the
// intent is reviewed — `useReviewedMutation` in `components/action-review.tsx` — which reuses it for a
// retry of the same work: minting a second one here would apply the same intent under a fresh key, and
// both the replay that answers `alreadyAccepted` and the release's at-most-one-successor-per-cycle rule
// depend on that identity holding. `expectedRevision` is the revision the caller read; substituting one
// would turn a genuine `conflict` — two tabs against one consumed cycle — into an overwrite. Neither hook
// writes an outcome into the cache either: the store is the only owner of the record, and
// `components/operation-result.tsx` is the durable receipt beside it.
/**
 * Records that an introduction actually happened, over `POST /api/referrals` (`recordIntroduction`).
 * Variables are the whole mutation input — the attempt identity, the scope and the revision the caller
 * read, with the introduction form's payload — and the result is exactly one of the eight outcomes.
 */
export function useRecordIntroduction(): UseMutationResult<MutationOutcome, Error, MutationInput<IntroductionPayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<IntroductionPayload>>({
    // A mutation is never retried on this module's initiative: a retry is the caller's deliberate act
    // under the same `operationId`. The transport answers every failure as an outcome, so `error` stays
    // null here and the component reads the outcome rather than a thrown message.
    retry: false,
    mutationFn: (input: MutationInput<IntroductionPayload>): Promise<MutationOutcome> => postReferralMutation(RECORD_INTRODUCTION_PATH, introductionPayloadSchema, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<IntroductionPayload>): Promise<void> => {
      if (!reachesTheRecord(outcome)) {
        return;
      }
      await revalidateReferrals(queryClient, input.scope);
    },
  });
}
/**
 * Continues one ordinarily expired referral cycle, over `POST /api/referrals/continue`
 * (`continueReferral`). Variables are the whole mutation input and the result is exactly one of the eight
 * outcomes; where the continuation ends, whether the cycle is ordinarily expired and whether continuation
 * is offered at all are the service's answers at command time, so a racing second Continue settles as
 * `conflict` or `unchanged` exactly like any other stale attempt.
 */
export function useContinueReferral(): UseMutationResult<MutationOutcome, Error, MutationInput<ContinueReferralPayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<ContinueReferralPayload>>({
    retry: false,
    mutationFn: (input: MutationInput<ContinueReferralPayload>): Promise<MutationOutcome> => postReferralMutation(CONTINUE_REFERRAL_PATH, continueReferralPayloadSchema, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<ContinueReferralPayload>): Promise<void> => {
      if (!reachesTheRecord(outcome)) {
        return;
      }
      await revalidateReferrals(queryClient, input.scope);
    },
  });
}
