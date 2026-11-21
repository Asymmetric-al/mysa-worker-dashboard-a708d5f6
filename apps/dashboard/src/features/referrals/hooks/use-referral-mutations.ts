import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, isOutcome, unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { continueReferralPayloadSchema, introductionPayloadSchema, type ContinueReferralPayload, type IntroductionPayload } from "../schemas";
// The two handlers, exactly as AAP 0.6.3 names them
const RECORD_INTRODUCTION_PATH = "/api/referrals";
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
  const body: MutationInput<TPayload> = { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: parsed.data };
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
/** Records that an introduction actually happened, over `POST /api/referrals` (`recordIntroduction`). */
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
/** Continues one ordinarily expired referral cycle, over `POST /api/referrals/continue` (`continueReferral`). */
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
