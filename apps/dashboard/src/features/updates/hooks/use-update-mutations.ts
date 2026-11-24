"use client";
import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { useReviewedMutation, type UseReviewedMutationResult } from "@/components/action-review";
import { readJsonBody } from "@/lib/read-transport";
import { assertNever } from "@/lib/result";
import type { StoppableRequest } from "@/lib/read-transport";
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
import {
  createVariantSchema,
  saveDraftSchema,
  submitForReviewSchema,
  registerMediaAssetSchema,
  removePlacementSchema,
  requestNotificationSchema,
  publishVariantsSchema,
  restoreRevisionAsDraftSchema,
  withdrawLocaleSchema,
  withdrawUpdateSchema,
  type CreateVariantPayload,
  type SaveDraftPayload,
  type SubmitForReviewPayload,
  type RegisterMediaAssetPayload,
  type RemovePlacementPayload,
  type RequestNotificationPayload,
  type PublishMode,
  type PublishVariantsPayload,
  type RestoreRevisionAsDraftPayload,
  type WithdrawLocalePayload,
  type WithdrawUpdatePayload,
} from "../schemas";
import { updateQueryKey, type UpdatesReadJob } from "./use-update-queries";
export const UPDATES_MUTATION_NAMES = ["createVariant", "saveDraft", "submitForReview", "approveCandidate", "requestChanges", "rejectCandidate", "publishVariants", "requestNotification", "withdrawUpdate", "withdrawLocale", "restoreRevisionAsDraft", "registerMediaAsset", "removePlacement"] as const;
export type UpdatesMutationName = (typeof UPDATES_MUTATION_NAMES)[number];
export const UPDATES_MUTATION_ENDPOINTS = {
  createVariant: "/api/variants",
  saveDraft: "/api/drafts",
  submitForReview: "/api/review",
  approveCandidate: "/api/review",
  requestChanges: "/api/review",
  rejectCandidate: "/api/review",
  publishVariants: "/api/publish",
  requestNotification: "/api/notify",
  withdrawUpdate: "/api/withdraw",
  withdrawLocale: "/api/withdraw",
  restoreRevisionAsDraft: "/api/drafts",
  registerMediaAsset: "/api/media",
  removePlacement: "/api/media",
} as const satisfies Readonly<Record<UpdatesMutationName, string>>;
export const UPDATES_MUTATION_INVALIDATIONS = {
  createVariant: ["variant-overview", "release"],
  saveDraft: ["draft", "variant-overview"],
  submitForReview: ["variant-overview", "candidate"],
  approveCandidate: ["candidate", "variant-overview", "share-presentation"],
  requestChanges: ["candidate", "variant-overview"],
  rejectCandidate: ["candidate", "variant-overview"],
  publishVariants: ["release", "variant-overview", "share-presentation"],
  requestNotification: ["send-result", "share-presentation", "variant-overview"],
  withdrawUpdate: ["release", "variant-overview", "share-presentation"],
  withdrawLocale: ["release", "variant-overview", "share-presentation"],
  restoreRevisionAsDraft: ["draft", "variant-overview"],
  registerMediaAsset: ["draft"],
  removePlacement: ["draft"],
} as const satisfies Readonly<Record<UpdatesMutationName, readonly UpdatesReadJob[]>>;
const TRANSPORT_GUIDANCE = "The request did not complete, so this change is reported as neither applied nor refused. Retry the same work: it keeps the attempt's own identity, and replaying it answers with the result already recorded rather than repeating the effect.";
const MISSING_HANDLER_STATUSES: ReadonlySet<number> = new Set<number>([404, 405]);
const BASE64_CHUNK_BYTES = 49_152;
const sourceOf = (endpoint: string, name: UpdatesMutationName): { readonly system: string; readonly reference: string } => ({ system: "data-service", reference: `${endpoint}#${name}` });
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + BASE64_CHUNK_BYTES, bytes.length)))));
  }
  return parts.join("");
}
const jobsFor = <P>(invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]), payload: P): readonly UpdatesReadJob[] => (typeof invalidates === "function" ? invalidates(payload) : invalidates);
function jobsToRevalidate<P>(outcome: MutationOutcome, invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]), payload: P): readonly UpdatesReadJob[] {
  switch (outcome.outcome) {
    case "accepted":
    case "alreadyAccepted":
    case "unknown":
      return jobsFor(invalidates, payload);
    case "conflict": {
      const [comparedAgainst] = jobsFor(invalidates, payload);
      return comparedAgainst === undefined ? [] : [comparedAgainst];
    }
    case "unchanged":
    case "denied":
    case "invalid":
    case "unavailable":
      return [];
    default:
      return assertNever(outcome, "Unhandled mutation outcome");
  }
}
const revalidateUpdates = async (queryClient: QueryClient, scope: Scope, jobs: readonly UpdatesReadJob[]): Promise<void> => void (await Promise.all(jobs.map((job) => queryClient.invalidateQueries({ queryKey: updateQueryKey(scope, job) }))));
/** One named mutation as the transport takes it: its own name and endpoint, the schema its payload is judged by, the reads it invalidates and the request body it sends. */
type UpdatesMutationConfig<P> = { readonly name: UpdatesMutationName; readonly endpoint: string; readonly schema: ZodType<P>; readonly invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]); readonly request: (payload: P) => unknown };
async function runUpdatesMutation<P>(queryClient: QueryClient, config: UpdatesMutationConfig<P>, input: MutationInput<P> & StoppableRequest): Promise<MutationOutcome> {
  const { endpoint, invalidates, name, request, schema } = config;
  const signal = input.signal; // Transport state, held apart from the body built below, so it can never be carried to the service.
  const checked = schema.safeParse(input.payload);
  if (!checked.success) return invalid({ operationId: input.operationId, fields: checked.error });
  let body: unknown;
  try {
    body = await request(checked.data);
  } catch {
    return unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: "This request could not be prepared here, so nothing was sent and nothing was recorded from it. If it carries a chosen file, choose the file again: it never left this browser, so no attempt can have applied it." });
  }
  let answer: Response;
  try {
    answer = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: body }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    // A stopped request is not an outage of the source: the answer may exist, so it is reported as the lost acknowledgement the caller re-reads on, which is what keeps the draft's real state on screen after the wait was stopped.
    if (signal?.aborted === true) return unknown({ operationId: input.operationId });
    return unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: TRANSPORT_GUIDANCE });
  }
  const answered = await readJsonBody(answer);
  let outcome: MutationOutcome;
  if (isOutcome(answered)) {
    outcome = answered;
  } else if (MISSING_HANDLER_STATUSES.has(answer.status)) {
    outcome = unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: TRANSPORT_GUIDANCE });
  } else outcome = unknown({ operationId: input.operationId });
  await revalidateUpdates(queryClient, input.scope, jobsToRevalidate(outcome, invalidates, checked.data));
  return outcome;
}
function useUpdatesMutation<P>(name: UpdatesMutationName, schema: ZodType<P>, request: (payload: P) => unknown, invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]) = UPDATES_MUTATION_INVALIDATIONS[name]): UseReviewedMutationResult<P> {
  const queryClient = useQueryClient();
  const submit = useCallback((input: MutationInput<P> & StoppableRequest): Promise<MutationOutcome> => runUpdatesMutation(queryClient, { name, endpoint: UPDATES_MUTATION_ENDPOINTS[name], schema, invalidates, request }, input), [queryClient, name, schema, invalidates, request]);
  return useReviewedMutation<P>(submit);
}
const asGiven = <P>(payload: P): P => payload;
async function registerMediaAssetBody(payload: RegisterMediaAssetPayload): Promise<unknown> {
  const { altText, caption, credit, language, transcript } = payload.placement;
  // The poster and the caption track are the two members the service prepares as their own renditions, so the body carries the files themselves: the poster's bytes through the same chunked encoder as the video, and the WebVTT text as text.
  const poster = payload.poster === undefined ? undefined : { bytesBase64: await base64Of(payload.poster.file), name: payload.poster.file.name, altText: payload.poster.altText ?? altText };
  const captions = payload.captions === undefined ? undefined : { vtt: await payload.captions.file.text(), language: payload.captions.language, ...(payload.captions.label === undefined ? {} : { label: payload.captions.label }) };
  return {
    operation: "registerMediaAsset",
    kind: payload.kind,
    source: { bytesBase64: await base64Of(payload.file) },
    altText,
    placement: { altText, ...(caption === undefined ? {} : { caption }), ...(credit === undefined ? {} : { credit }), ...(language === undefined ? {} : { language }) },
    ...(transcript === undefined ? {} : { transcript: { text: transcript } }),
    ...(poster === undefined ? {} : { poster }),
    ...(captions === undefined ? {} : { captions }),
  };
}
const publishInvalidations = (payload: PublishVariantsPayload): readonly UpdatesReadJob[] => (payload.variants.some((selection) => selection.mode === ("publish-and-notify-now" satisfies PublishMode)) ? [...UPDATES_MUTATION_INVALIDATIONS.publishVariants, "send-result"] : UPDATES_MUTATION_INVALIDATIONS.publishVariants);
export const useCreateVariant = (): UseReviewedMutationResult<CreateVariantPayload> => useUpdatesMutation("createVariant", createVariantSchema, asGiven);
/** `saveDraft` — saves one edition's working document against the revision its editor holds, moving the draft pointer and nothing else; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useSaveDraft = (): UseReviewedMutationResult<SaveDraftPayload> => useUpdatesMutation("saveDraft", saveDraftSchema, (payload: SaveDraftPayload): unknown => ({ operation: "saveDraft", ...payload }));
export const useSubmitForReview = (): UseReviewedMutationResult<SubmitForReviewPayload> => useUpdatesMutation("submitForReview", submitForReviewSchema, (payload: SubmitForReviewPayload): unknown => ({ operation: "submitForReview", ...payload }));
export const usePublishVariants = (): UseReviewedMutationResult<PublishVariantsPayload> => useUpdatesMutation("publishVariants", publishVariantsSchema, asGiven, publishInvalidations);
export const useRequestNotification = (): UseReviewedMutationResult<RequestNotificationPayload> => useUpdatesMutation("requestNotification", requestNotificationSchema, asGiven);
export const useWithdrawUpdate = (): UseReviewedMutationResult<WithdrawUpdatePayload> => useUpdatesMutation("withdrawUpdate", withdrawUpdateSchema, (payload: WithdrawUpdatePayload): unknown => ({ operation: "withdrawUpdate", documentId: payload.documentId }));
export const useWithdrawLocale = (): UseReviewedMutationResult<WithdrawLocalePayload> => useUpdatesMutation("withdrawLocale", withdrawLocaleSchema, (payload: WithdrawLocalePayload): unknown => ({ operation: "withdrawLocale", variantId: payload.variantId }));
export const useRestoreRevisionAsDraft = (): UseReviewedMutationResult<RestoreRevisionAsDraftPayload> => useUpdatesMutation("restoreRevisionAsDraft", restoreRevisionAsDraftSchema, (payload: RestoreRevisionAsDraftPayload): unknown => ({ operation: "restoreRevisionAsDraft", ...payload }));
export const useRegisterMediaAsset = (): UseReviewedMutationResult<RegisterMediaAssetPayload> => useUpdatesMutation("registerMediaAsset", registerMediaAssetSchema, registerMediaAssetBody);
export const useRemovePlacement = (): UseReviewedMutationResult<RemovePlacementPayload> => useUpdatesMutation("removePlacement", removePlacementSchema, (payload: RemovePlacementPayload): unknown => ({ operation: "removePlacement", variantId: payload.variantId, placementId: payload.placementId }));
