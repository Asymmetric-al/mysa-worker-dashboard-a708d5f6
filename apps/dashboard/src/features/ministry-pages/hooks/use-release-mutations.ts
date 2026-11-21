"use client";
/** The four writes that carry one Page edition through review and release — `submitForReview`, `approveCandidate`, `requestChanges` and `publishVariants` — as the transports a page surface calls. */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import {
  approveCandidateInputSchema,
  publishVariantsInputSchema,
  requestChangesInputSchema,
  submitForReviewInputSchema,
  type ApproveCandidateInput,
  type ApproveCandidatePayload,
  type PublishVariantsInput,
  type PublishVariantsPayload,
  type RequestChangesInput,
  type RequestChangesPayload,
  type SubmitForReviewInput,
  type SubmitForReviewPayload,
} from "../schemas/release";
import { pagesPrefix } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";

const PAGE_RELEASE_PATH = "/api/pages/release";

type ReleaseStep = "submitForReview" | "approveCandidate" | "requestChanges" | "publishVariants";

interface StepPayloads {
  readonly submitForReview: SubmitForReviewPayload;
  readonly approveCandidate: ApproveCandidatePayload;
  readonly requestChanges: RequestChangesPayload;
  readonly publishVariants: PublishVariantsPayload;
}

type Routed<Step extends ReleaseStep> = StepPayloads[Step] & { readonly operation: Step };

interface AssociatedPage {
  readonly documentId?: string;
}

type SubmitPageForReviewVariables = SubmitForReviewInput;

type ApprovePageCandidateVariables = ApproveCandidateInput;

type RequestPageChangesVariables = RequestChangesInput & AssociatedPage;

type PublishPageVariantsVariables = PublishVariantsInput & AssociatedPage;

function documentedBody(variables: MutationInput<unknown>): MutationInput<unknown> {
  return { operationId: variables.operationId, scope: variables.scope, expectedRevision: variables.expectedRevision, payload: variables.payload };
}

function routedBody<Step extends ReleaseStep>(step: Step, body: MutationInput<StepPayloads[Step]>): MutationInput<Routed<Step>> {
  return { ...body, payload: { ...body.payload, operation: step } };
}

function reReadPages(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope): void {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unknown":
      void queryClient.invalidateQueries({ queryKey: pagesPrefix(scope) });
      return;
    case "unchanged":
    case "conflict":
    case "invalid":
    case "denied":
    case "unavailable":
      return;
    default:
      assertNever(outcome, "Unhandled mutation outcome");
  }
}

/** Freezes one exact revision as the candidate under review (`submitForReview`). */
export function useSubmitPageForReview(): UseMutationResult<MutationOutcome, never, SubmitPageForReviewVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGE_RELEASE_PATH });
  return useMutation<MutationOutcome, never, SubmitPageForReviewVariables>({
    retry: false,
    mutationFn: async (variables: SubmitPageForReviewVariables): Promise<MutationOutcome> => {
      const checked = submitForReviewInputSchema.safeParse(documentedBody(variables));
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync(routedBody("submitForReview", checked.data));
    },
    onSuccess: (outcome: MutationOutcome, variables: SubmitPageForReviewVariables): void => {
      reReadPages(queryClient, outcome, variables.scope);
    },
  });
}

/** Answers one frozen candidate with an approval (`approveCandidate`). */
export function useApprovePageCandidate(): UseMutationResult<MutationOutcome, never, ApprovePageCandidateVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGE_RELEASE_PATH });
  return useMutation<MutationOutcome, never, ApprovePageCandidateVariables>({
    retry: false,
    mutationFn: async (variables: ApprovePageCandidateVariables): Promise<MutationOutcome> => {
      const checked = approveCandidateInputSchema.safeParse(documentedBody(variables));
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync(routedBody("approveCandidate", checked.data));
    },
    onSuccess: (outcome: MutationOutcome, variables: ApprovePageCandidateVariables): void => {
      reReadPages(queryClient, outcome, variables.scope);
    },
  });
}

/** Answers one frozen candidate with a request for a new revision (`requestChanges`). */
export function useRequestPageChanges(): UseMutationResult<MutationOutcome, never, RequestPageChangesVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGE_RELEASE_PATH });
  return useMutation<MutationOutcome, never, RequestPageChangesVariables>({
    retry: false,
    mutationFn: async (variables: RequestPageChangesVariables): Promise<MutationOutcome> => {
      const checked = requestChangesInputSchema.safeParse(documentedBody(variables));
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync(routedBody("requestChanges", checked.data));
    },
    onSuccess: (outcome: MutationOutcome, variables: RequestPageChangesVariables): void => {
      reReadPages(queryClient, outcome, variables.scope);
    },
  });
}

/** Releases the approved candidates selected for a page (`publishVariants`). */
export function usePublishPageVariants(): UseMutationResult<MutationOutcome, never, PublishPageVariantsVariables> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: PAGE_RELEASE_PATH });
  return useMutation<MutationOutcome, never, PublishPageVariantsVariables>({
    retry: false,
    mutationFn: async (variables: PublishPageVariantsVariables): Promise<MutationOutcome> => {
      const checked = publishVariantsInputSchema.safeParse(documentedBody(variables));
      if (!checked.success) {
        return invalid({ operationId: variables.operationId, fields: checked.error });
      }
      return transport.mutateAsync(routedBody("publishVariants", checked.data));
    },
    onSuccess: (outcome: MutationOutcome, variables: PublishPageVariantsVariables): void => {
      reReadPages(queryClient, outcome, variables.scope);
    },
  });
}
