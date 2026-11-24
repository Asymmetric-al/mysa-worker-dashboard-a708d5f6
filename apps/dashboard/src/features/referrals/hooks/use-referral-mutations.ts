import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { refreshJobs, sendMutation } from "@/lib/read-transport";
import type { MutationInput } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import { continueReferralPayloadSchema, introductionPayloadSchema, type ContinueReferralPayload, type IntroductionPayload } from "../schemas";
// A recorded or continued cycle is what a partner's roster row states as its referral status, so the roster and its facet set are re-read beside the referral lists that own the cycle: the job names are the query cache's shared vocabulary, as the support family's follow-up already refreshes the task lists it creates.
const REFRESHED_JOBS = ["referrals", "referral", "partners", "facets"] as const;
const REFRESHING_OUTCOMES = ["accepted", "alreadyAccepted", "unchanged"] as const;
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
async function postReferralMutation<TPayload>(path: string, schema: ZodType<TPayload>, input: MutationInput<TPayload>): Promise<MutationOutcome> {
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) return invalid({ operationId: input.operationId, fields: parsed.error });
  return sendMutation(path, { operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: parsed.data }, OFFLINE_GUIDANCE);
}
function useReferralChange<TPayload>(path: string, schema: ZodType<TPayload>): UseMutationResult<MutationOutcome, Error, MutationInput<TPayload>> {
  const queryClient = useQueryClient();
  return useMutation<MutationOutcome, Error, MutationInput<TPayload>>({
    retry: false,
    mutationFn: (input: MutationInput<TPayload>): Promise<MutationOutcome> => postReferralMutation(path, schema, input),
    onSuccess: async (outcome: MutationOutcome, input: MutationInput<TPayload>): Promise<void> => {
      await refreshJobs(queryClient, outcome, scopeKey(input.scope), REFRESHED_JOBS, REFRESHING_OUTCOMES);
    },
  });
}
/** Records that an introduction actually happened, over `POST /api/referrals` (`recordIntroduction`). */ export const useRecordIntroduction = (): UseMutationResult<MutationOutcome, Error, MutationInput<IntroductionPayload>> => useReferralChange("/api/referrals", introductionPayloadSchema);
/** Continues one ordinarily expired referral cycle, over `POST /api/referrals/continue` (`continueReferral`). */ export const useContinueReferral = (): UseMutationResult<MutationOutcome, Error, MutationInput<ContinueReferralPayload>> => useReferralChange("/api/referrals/continue", continueReferralPayloadSchema);
