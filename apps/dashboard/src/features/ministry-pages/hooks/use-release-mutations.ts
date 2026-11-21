"use client";
/**
 * The four writes that carry one Page edition through review and release — `submitForReview`,
 * `approveCandidate`, `requestChanges` and `publishVariants` — as the transports a page surface calls.
 *
 * Each hook does the three things the family's one transport cannot do alone. It presents the
 * documented four-field envelope to `../schemas/release.ts` before anything leaves the browser, so a
 * refusal names the field that is wrong and no request is made. It asks the release handler for the
 * exact step by adding that step's operation name, which the strict payload schemas deliberately do not
 * carry. And it re-reads the page family from the service's own answer, because the cache prefix to
 * re-read is keyed by the scope the caller acts in, which arrives with the variables rather than with
 * the hook.
 *
 * What no hook here does: it mints no `operationId` — the surface keeps the identity of an attempt so a
 * retry replays it and a lost acknowledgement is re-queried rather than repeated — it changes no
 * lifecycle locally, and it sends nothing to anyone. A Page release publishes an edition; there is no
 * message, no recipient and no delivery outcome in this family, so no step here can be read as one.
 */
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

/** The handler the four release steps share, which selects the step by `payload.operation`. */
const PAGE_RELEASE_PATH = "/api/pages/release";

/** The closed set of steps the release handler admits, named once so the request cannot name a fifth. */
type ReleaseStep = "submitForReview" | "approveCandidate" | "requestChanges" | "publishVariants";

/**
 * Each admitted step and the payload its own schema describes.
 *
 * Pairing them here is what stops one step being sent another's payload: `routedBody` reads the payload
 * from the step it is given, so an approval carrying a submission or a release carrying a note fails to
 * compile at the call rather than at the service.
 */
interface StepPayloads {
  readonly submitForReview: SubmitForReviewPayload;
  readonly approveCandidate: ApproveCandidatePayload;
  readonly requestChanges: RequestChangesPayload;
  readonly publishVariants: PublishVariantsPayload;
}

/** One step's payload as the handler routes it: the schema's own fields plus the step it asks for. */
type Routed<Step extends ReleaseStep> = StepPayloads[Step] & { readonly operation: Step };

/**
 * One member a page surface may carry that the mutation does not: the page it is acting on, so a
 * pending or answered result can be shown beside that page.
 *
 * It stays out of validation and off the wire. The payload schemas are strict, so a member they do not
 * document is an error rather than something to forward, and the family re-read covers every page in
 * the scope anyway; the member is the surface's own correlation and nothing else.
 */
interface AssociatedPage {
  readonly documentId?: string;
}

/** What one submission presents: the documented envelope around the frozen revision's identity. */
type SubmitPageForReviewVariables = SubmitForReviewInput;

/** What one approval presents: one frozen candidate in the payload the approval schema admits. */
type ApprovePageCandidateVariables = ApproveCandidateInput;

/** What one request for changes presents: the candidate and the note its author acts on. */
type RequestPageChangesVariables = RequestChangesInput & AssociatedPage;

/** What one release presents: the page and the approved candidates it releases. */
type PublishPageVariantsVariables = PublishVariantsInput & AssociatedPage;

/**
 * The four documented members of the envelope, taken from the caller's variables.
 *
 * Rebuilding them keeps a surface-only member — the page a result is shown beside — from being judged
 * as an undocumented field and from travelling to the service, without asking any hook to restate what
 * an envelope is.
 */
function documentedBody(variables: MutationInput<unknown>): MutationInput<unknown> {
  return {
    operationId: variables.operationId,
    scope: variables.scope,
    expectedRevision: variables.expectedRevision,
    payload: variables.payload,
  };
}

/**
 * The body the release handler receives: the validated envelope with the step it names.
 *
 * The step is added here rather than admitted by the payload schema because the schemas describe what
 * each mutation accepts, and no mutation takes the name of itself as a field; the handler reads the
 * step and strips it before the mutation is called.
 */
function routedBody<Step extends ReleaseStep>(step: Step, body: MutationInput<StepPayloads[Step]>): MutationInput<Routed<Step>> {
  return { ...body, payload: { ...body.payload, operation: step } };
}

/**
 * Re-reads the page family from the service's answer to one attempt.
 *
 * A lifecycle word and an index row are consequences no surface can derive, and `accepted`,
 * `alreadyAccepted` and `unknown` all leave the truth in the service: the first two because it changed,
 * the third because it may have. One re-read of `pagesPrefix(scope)` answers all three — it covers the
 * page body, its locale editions, its giving binding and every preview of every page in the scope. A
 * refusal changed nothing, so it re-reads nothing, and no optimistic lifecycle change exists to undo: a
 * candidate can never appear released because a request resolved.
 */
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

/**
 * Freezes one exact revision as the candidate under review (`submitForReview`).
 *
 * The revision is the caller's: this hook accepts no document body, never submits a draft implicitly
 * and never substitutes the newest draft for the revision the author sent, because the candidate is the
 * revision a reviewer will read. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`,
 * `denied`, `invalid`, `unavailable` or `unknown`; `accepted` reports the frozen candidate it created.
 */
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

/**
 * Answers one frozen candidate with an approval (`approveCandidate`).
 *
 * Exactly one candidate is named, so approving one language edition approves no other, and the release
 * mode it records is the single value the payload schema admits, because a page approval releases
 * without telling anyone. The hook chains no release onto the approval; releasing is a separate,
 * deliberate step under its own attempt. Outcomes are the eight above, and none of them is a release.
 */
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

/**
 * Answers one frozen candidate with a request for a new revision (`requestChanges`).
 *
 * The note is the reviewer's own words and the only thing the author works from; the candidate stays
 * under review and nothing is released, so this step can never be mistaken for an editorial cleanup
 * that unblocked a publication. Outcomes are the eight above.
 */
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

/**
 * Releases the approved candidates selected for a page (`publishVariants`).
 *
 * The result travels back exactly as the service answered it, reported per selected candidate: an
 * edition that could not be released keeps the release it already had while its siblings advance, and
 * this hook neither rolls a success back, retries a failure, nor aggregates the members into one "done".
 * The failed member recovers only when the caller re-submits the same attempt — the same `operationId` —
 * which is why the identity belongs to the surface and never to this file. Outcomes are the eight above,
 * with the per-candidate detail in the result.
 */
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
