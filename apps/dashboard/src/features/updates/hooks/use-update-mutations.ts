"use client";
/**
 * The Ministry Updates family's browser write plumbing: exactly fourteen hooks, one per named mutation, each composed
 * over the application's one reviewed-mutation step.
 *
 * What this module owns: the handler each named write is posted to, the body that handler reads, and which reads of
 * this family a settled answer leaves stale. What it does not own: an attempt's identity, the review step and the
 * in-flight fence belong to `useReviewedMutation` (`@/components/action-review`); the keys belong to
 * `./use-update-queries`; and the meaning of every answer belongs to the service. Each hook hands the service's
 * `MutationOutcome` back untouched, because a publication, a notification submission, a provider acceptance, a
 * delivery and a reading are five separate results and nothing here may fold one into another.
 */
import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { useReviewedMutation, type UseReviewedMutationResult } from "@/components/action-review";
import { assertNever } from "@/lib/result";
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, isOutcome, unavailable, unknown, type MutationOutcome } from "@/modules/data-service/outcome";
import { createVariantSchema, saveDraftSchema, submitForReviewSchema, type CreateVariantPayload, type SaveDraftPayload, type SubmitForReviewPayload } from "../schemas/draft";
import { registerMediaAssetSchema, removePlacementSchema, replacePlacementSchema, type RegisterMediaAssetPayload, type RemovePlacementPayload, type ReplacePlacementPayload } from "../schemas/media";
import { requestNotificationSchema, type RequestNotificationPayload } from "../schemas/notify";
import { publishVariantsSchema, type PublishMode, type PublishVariantsPayload } from "../schemas/publish";
import { approveCandidateSchema, rejectCandidateSchema, requestChangesSchema, restoreRevisionAsDraftSchema, type ApproveCandidatePayload, type RejectCandidatePayload, type RequestChangesPayload, type RestoreRevisionAsDraftPayload } from "../schemas/review";
import { withdrawLocaleSchema, withdrawUpdateSchema, type WithdrawLocalePayload, type WithdrawUpdatePayload } from "../schemas/withdraw";
import { updateQueryKey, type UpdatesReadJob } from "./use-update-queries";

// ---------------------------------------------------------------------------------------------
// The closed set of named writes, the handler each one rides, and what each one leaves stale
// ---------------------------------------------------------------------------------------------

/** The fourteen named mutations this family's screens can ask for, listed once so the closed set has a runtime form beside its type. A fifteenth is a component defect rather than a hook to add: a new effect needs a new named mutation behind the service first. */
export const UPDATES_MUTATION_NAMES = [
  "createVariant",
  "saveDraft",
  "submitForReview",
  "approveCandidate",
  "requestChanges",
  "rejectCandidate",
  "publishVariants",
  "requestNotification",
  "withdrawUpdate",
  "withdrawLocale",
  "restoreRevisionAsDraft",
  "registerMediaAsset",
  "replacePlacement",
  "removePlacement",
] as const;

/** One named write of the Ministry Updates family. */
export type UpdatesMutationName = (typeof UPDATES_MUTATION_NAMES)[number];

/**
 * The handler that answers each named write (AAP 0.6.3). Several names share one path — the four review answers all
 * post to `/api/review`, the two draft writes to `/api/drafts`, the three media writes to `/api/media` — because a
 * release, a review answer, a draft and a placement each move one record family. What never crosses this boundary is a
 * `{ action, payload }` envelope: each body states the payload its own handler declares, and names the mutation in
 * `payload.operation` exactly where that handler selects on one.
 */
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
  replacePlacement: "/api/media",
  removePlacement: "/api/media",
} as const satisfies Readonly<Record<UpdatesMutationName, string>>;

/**
 * The reads one settled answer leaves out of date, keyed by the mutation's name: this family's own job keys, never a
 * blanket cache operation. `publishVariants` lists the four reads a release moves; its per-recipient results are added
 * by `publishInvalidations` only when a selection actually notifies, because a publish-only release sends nothing.
 */
export const UPDATES_MUTATION_INVALIDATIONS = {
  createVariant: ["variant-overview", "release"],
  saveDraft: ["draft", "variant-overview", "preview"],
  submitForReview: ["variant-overview", "candidate"],
  approveCandidate: ["candidate", "variant-overview", "share-presentation"],
  requestChanges: ["candidate", "variant-overview"],
  rejectCandidate: ["candidate", "variant-overview"],
  publishVariants: ["release", "variant-overview", "preview", "share-presentation"],
  requestNotification: ["send-result", "share-presentation", "variant-overview"],
  withdrawUpdate: ["release", "variant-overview", "preview", "share-presentation"],
  withdrawLocale: ["release", "variant-overview", "preview", "share-presentation"],
  restoreRevisionAsDraft: ["draft", "variant-overview", "preview"],
  registerMediaAsset: ["draft"],
  replacePlacement: ["draft", "preview"],
  removePlacement: ["draft", "preview"],
} as const satisfies Readonly<Record<UpdatesMutationName, readonly UpdatesReadJob[]>>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The source system a fault raised on this side of the request names. It is the browser's own transport rather than the local store, because a request can fail before any handler ran and naming the store would claim knowledge of where the fault was. An opaque reference: it is displayed as text and never parsed. */
const HANDLER_SOURCE_SYSTEM = "data-service";

/** What a request that did or did not arrive is told: retrying keeps the attempt's own identity, and a replay answers with the result recorded for it instead of repeating the effect. */
const TRANSPORT_GUIDANCE = "The request did not complete, so this change is reported as neither applied nor refused. Retry the same work: it keeps the attempt's own identity, and replaying it answers with the result already recorded rather than repeating the effect.";

/** What a request that could not even be assembled here is told: nothing was sent, so nothing can have been applied, and the input the caller still holds is what to send again. */
const PREPARATION_GUIDANCE = "This request could not be prepared here, so nothing was sent and nothing was recorded from it. If it carries a chosen file, choose the file again: it never left this browser, so no attempt can have applied it.";

/** The statuses that mean no handler answered this path, so the request never reached a mutation and nothing was applied. That is an outage of the handler, not an outcome whose fate is unknown. */
const MISSING_HANDLER_STATUSES: ReadonlySet<number> = new Set<number>([404, 405]);

/** The release mode whose selection also moves the notice's per-recipient results; tied to the schema's own vocabulary so a renamed mode fails this file's compilation. */
const NOTIFY_NOW_MODE = "publish-and-notify-now" satisfies PublishMode;

/** How many bytes are encoded at a time when a chosen file becomes request text. A multiple of three, so every chunk but the last encodes to a whole number of base64 quanta and the chunks can simply be joined. */
const BASE64_CHUNK_BYTES = 49_152;

// ---------------------------------------------------------------------------------------------
// The transport: one request path, one reading of an answer
// ---------------------------------------------------------------------------------------------

/** The reference an outage on this side names: the handler's path and the one named write it was asked to perform, so the several writes behind a shared path are told apart in a diagnostic and in the receipt beside the form. */
function sourceOf(endpoint: string, name: UpdatesMutationName): { readonly system: string; readonly reference: string } {
  return { system: HANDLER_SOURCE_SYSTEM, reference: `${endpoint}#${name}` };
}

/** The parsed JSON body, or `undefined` when the answer carried none: an HTML error page is not an outcome. */
async function readJsonBody(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return undefined;
  }
}

/** One chosen file as the request states it: base64 text, because a `File` is not JSON and the handler measures real bytes rather than a claim about them. The file's own name never travels: a handler that recorded it would echo the name of something on this machine. */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + BASE64_CHUNK_BYTES, bytes.length));
    parts.push(btoa(String.fromCharCode(...chunk)));
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------------------------
// What a settled answer means for the reads beside it
// ---------------------------------------------------------------------------------------------

/** The jobs one mutation's settled answer leaves stale, resolved for a payload: most mutations state their jobs once, and a release states one more when it also notifies. */
function jobsFor<P>(invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]), payload: P): readonly UpdatesReadJob[] {
  return typeof invalidates === "function" ? invalidates(payload) : invalidates;
}

/**
 * Which reads to re-read after one answer, and which to leave alone.
 *
 * `accepted` and `alreadyAccepted` re-read the mapped jobs: a replay's stored result can be newer than the envelope on
 * screen. `unknown` re-reads them too, because the effect may have been applied — and recovery is a check under the
 * attempt's identity, which this policy never turns into a fresh attempt. `conflict` re-reads only the read the attempt
 * was made against, so the current value appears beside the input the caller kept; nothing is re-applied through it,
 * because an application against the new revision is a changed intent with an identity of its own. `unchanged`,
 * `denied`, `invalid` and `unavailable` changed nothing this family reads, so a refetch would be noise.
 */
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

/** Re-reads the listed jobs in the scope the attempt named, so a late answer never repopulates another context's keys. */
async function revalidateUpdates(queryClient: QueryClient, scope: Scope, jobs: readonly UpdatesReadJob[]): Promise<void> {
  await Promise.all(jobs.map((job) => queryClient.invalidateQueries({ queryKey: updateQueryKey(scope, job) })));
}

// ---------------------------------------------------------------------------------------------
// One named write, end to end
// ---------------------------------------------------------------------------------------------

/** What one named write needs: the handler, the mutation it names, the caller's payload schema, the body that handler reads, and the reads a settled answer leaves stale. */
interface UpdatesMutationConfig<P> {
  readonly name: UpdatesMutationName;
  readonly endpoint: string;
  readonly schema: ZodType<P>;
  readonly invalidates: readonly UpdatesReadJob[] | ((payload: P) => readonly UpdatesReadJob[]);
  /** The body the handler reads, built from the caller's validated payload. A body is not always the payload itself: a review answer names the candidate the review record holds, a withdrawal posts the identity it withdraws, and a chosen file is stated as bytes rather than as a `File`. */
  readonly request: (payload: P) => unknown;
}

/**
 * Posts one named write and reports exactly what the service answered.
 *
 * The attempt's identity is the one `useReviewedMutation` supplied, echoed here in every answer this function
 * constructs itself; nothing in this module mints, derives or hashes one. Validation runs first, against the caller's
 * own schema, so a value the service would refuse is refused here with the same field paths and without a round trip.
 */
async function runUpdatesMutation<P>(queryClient: QueryClient, config: UpdatesMutationConfig<P>, input: MutationInput<P>): Promise<MutationOutcome> {
  const { endpoint, invalidates, name, request, schema } = config;
  const checked = schema.safeParse(input.payload);
  if (!checked.success) {
    return invalid({ operationId: input.operationId, fields: checked.error });
  }
  let body: unknown;
  try {
    body = await request(checked.data);
  } catch {
    // A payload that could not be prepared here — a chosen file the browser could not read — never left it, so no
    // handler ran and `unknown` would claim an effect that was never attempted: the outage is this side's, and the
    // caller's input is still on screen to be sent again.
    return unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: PREPARATION_GUIDANCE });
  }
  let answer: Response;
  try {
    answer = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ operationId: input.operationId, scope: input.scope, expectedRevision: input.expectedRevision, payload: body }),
    });
  } catch {
    return unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: TRANSPORT_GUIDANCE });
  }
  const answered = await readJsonBody(answer);
  let outcome: MutationOutcome;
  if (isOutcome(answered)) {
    outcome = answered;
  } else if (MISSING_HANDLER_STATUSES.has(answer.status)) {
    outcome = unavailable({ operationId: input.operationId, source: sourceOf(endpoint, name), guidance: TRANSPORT_GUIDANCE });
  } else {
    // Any other body states nothing about what happened, so the attempt is reported as unconfirmed: success and failure
    // would both be claims this transport cannot support, and only a check under that identity can tell them apart.
    outcome = unknown({ operationId: input.operationId });
  }
  await revalidateUpdates(queryClient, input.scope, jobsToRevalidate(outcome, invalidates, checked.data));
  return outcome;
}

/**
 * Composes one named write, and is the only place this family's hooks are built.
 *
 * Why this is a composition and not the universal dispatcher the plan forbids: it holds no field map, no operation
 * table and no branch on a name. Each hook below passes one concrete schema, one concrete body builder and one concrete
 * list of jobs, so the shape of every request is declared at the hook that makes it, and the closed union of names is a
 * type rather than a lookup.
 *
 * `useReviewedMutation` owns the attempt's identity and the in-flight fence, and it exposes no completion callback: the
 * submit function passed to it is the one thin adapter that observes the settled outcome to invalidate the reads it
 * leaves stale, and then returns that outcome unchanged. Retry and re-apply reach the same adapter, so recovery and a
 * deliberate second application are treated exactly like a first attempt.
 */
function useUpdatesMutation<P>({ name, endpoint, schema, invalidates, request }: UpdatesMutationConfig<P>): UseReviewedMutationResult<P> {
  const queryClient = useQueryClient();
  const submit = useCallback((input: MutationInput<P>): Promise<MutationOutcome> => runUpdatesMutation(queryClient, { name, endpoint, schema, invalidates, request }, input), [queryClient, name, endpoint, schema, invalidates, request]);
  return useReviewedMutation<P>(submit);
}

// ---------------------------------------------------------------------------------------------
// The body each handler reads, built from the caller's validated payload
// ---------------------------------------------------------------------------------------------
//
// A handler admits the payload its own record holds, which is often narrower than the schema the screen validated: a
// review answer names the frozen candidate rather than restating the edition and checksum the panel already showed, and
// a withdrawal posts the identity it withdraws. Each builder below therefore states the body its handler declares and
// nothing beside it, because a member the record has no place for would be refused by a stricter schema than the screen
// used and turn a correct decision into an `invalid`.

/** Hands the payload over exactly as the schema produced it: this handler declares those fields and no discriminant. */
function asGiven<P>(payload: P): P {
  return payload;
}

/** `saveDraft` names its mutation in the body, because `/api/drafts` serves two writes and selects on that name. */
function saveDraftBody(payload: SaveDraftPayload): unknown {
  return { operation: "saveDraft", ...payload };
}

/** `restoreRevisionAsDraft` copies one earlier revision into a new draft; the name in the body is what `/api/drafts` selects on. */
function restoreRevisionAsDraftBody(payload: RestoreRevisionAsDraftPayload): unknown {
  return { operation: "restoreRevisionAsDraft", ...payload };
}

/** `submitForReview` freezes one exact revision, named in the body because `/api/review` serves four writes. */
function submitForReviewBody(payload: SubmitForReviewPayload): unknown {
  return { operation: "submitForReview", ...payload };
}

/** An approval names the frozen candidate alone: the candidate *is* the revision the reviewer read, and the edition and checksum the panel carries are its own guard that the panel showed that revision, not fields the review record holds. */
function approveCandidateBody(payload: ApproveCandidatePayload): unknown {
  return { operation: "approveCandidate", candidateId: payload.candidateId };
}

/** A request for changes names the candidate and the reviewer's note, which becomes the note on that review record. */
function requestChangesBody(payload: RequestChangesPayload): unknown {
  return { operation: "requestChanges", candidateId: payload.candidateId, reason: payload.reason };
}

/** A rejection names the candidate, and states a note only when the reviewer wrote one. */
function rejectCandidateBody(payload: RejectCandidatePayload): unknown {
  return { operation: "rejectCandidate", candidateId: payload.candidateId, ...(payload.reason === undefined ? {} : { reason: payload.reason }) };
}

/** A withdrawal of the whole Update posts the document it withdraws, and a withdrawal of one edition posts the edition: the note the screen offered is the caller's own text and stays there, because a withdrawal record states the identity withdrawn and holds no note. */
function withdrawUpdateBody(payload: WithdrawUpdatePayload): unknown {
  return { operation: "withdrawUpdate", documentId: payload.documentId };
}

/** One edition's withdrawal posts the variant id alone: the locale is a display value, never the identity an act applies to. */
function withdrawLocaleBody(payload: WithdrawLocalePayload): unknown {
  return { operation: "withdrawLocale", variantId: payload.variantId };
}

/**
 * A registration states the chosen file as bytes and the placement as the fields the asset record holds. The picker's
 * measured probe stays home — the handler measures the real content rather than a claim about it — a transcript is
 * stated as the track it is, and a poster chosen from assets already registered is not restated here, because this
 * request carries poster bytes rather than a reference to them.
 */
async function registerMediaAssetBody(payload: RegisterMediaAssetPayload): Promise<unknown> {
  const { altText, caption, credit, language, transcript } = payload.placement;
  return {
    operation: "registerMediaAsset",
    kind: payload.kind,
    source: { bytesBase64: await base64Of(payload.file) },
    altText,
    placement: { altText, ...(caption === undefined ? {} : { caption }), ...(credit === undefined ? {} : { credit }), ...(language === undefined ? {} : { language }) },
    ...(transcript === undefined ? {} : { transcript: { text: transcript } }),
  };
}

/** A placement change names the draft edition it edits, the placement it acts on and the descriptor the record holds. */
function replacePlacementBody(payload: ReplacePlacementPayload): unknown {
  const { altText, caption, credit } = payload.placement;
  return { operation: "replacePlacement", variantId: payload.variantId, placementId: payload.placementId, placement: { altText, ...(caption === undefined ? {} : { caption }), ...(credit === undefined ? {} : { credit }) } };
}

/** A removal detaches one placement from one draft edition; no asset is deleted and nothing published is withdrawn. */
function removePlacementBody(payload: RemovePlacementPayload): unknown {
  return { operation: "removePlacement", variantId: payload.variantId, placementId: payload.placementId };
}

/** A release also moves the notice's per-recipient results when a selection notifies now; a publish-only release sends nothing, so asking for those results would be a read the answer cannot have changed. */
function publishInvalidations(payload: PublishVariantsPayload): readonly UpdatesReadJob[] {
  const notifiesNow = payload.variants.some((selection) => selection.mode === NOTIFY_NOW_MODE);
  return notifiesNow ? [...UPDATES_MUTATION_INVALIDATIONS.publishVariants, "send-result"] : UPDATES_MUTATION_INVALIDATIONS.publishVariants;
}

// ---------------------------------------------------------------------------------------------
// The fourteen hooks, one per named mutation
// ---------------------------------------------------------------------------------------------

/** `createVariant` — creates one family-permitted edition of an Update in one exact content locale, with no draft, candidate or release yet; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useCreateVariant(): UseReviewedMutationResult<CreateVariantPayload> {
  const config: UpdatesMutationConfig<CreateVariantPayload> = {
    name: "createVariant",
    endpoint: UPDATES_MUTATION_ENDPOINTS.createVariant,
    schema: createVariantSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.createVariant,
    request: asGiven,
  };
  return useUpdatesMutation(config);
}

/** `saveDraft` — saves one edition's working document against the revision its editor holds, moving the draft pointer and nothing else; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveDraft(): UseReviewedMutationResult<SaveDraftPayload> {
  const config: UpdatesMutationConfig<SaveDraftPayload> = {
    name: "saveDraft",
    endpoint: UPDATES_MUTATION_ENDPOINTS.saveDraft,
    schema: saveDraftSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.saveDraft,
    request: saveDraftBody,
  };
  return useUpdatesMutation(config);
}

/** `submitForReview` — freezes one exact revision of one edition as the candidate a single review step answers; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSubmitForReview(): UseReviewedMutationResult<SubmitForReviewPayload> {
  const config: UpdatesMutationConfig<SubmitForReviewPayload> = {
    name: "submitForReview",
    endpoint: UPDATES_MUTATION_ENDPOINTS.submitForReview,
    schema: submitForReviewSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.submitForReview,
    request: submitForReviewBody,
  };
  return useUpdatesMutation(config);
}

/** `approveCandidate` — approves one frozen candidate in the single review step, keeping the release mode it was submitted under and approving no sibling edition; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useApproveCandidate(): UseReviewedMutationResult<ApproveCandidatePayload> {
  const config: UpdatesMutationConfig<ApproveCandidatePayload> = {
    name: "approveCandidate",
    endpoint: UPDATES_MUTATION_ENDPOINTS.approveCandidate,
    schema: approveCandidateSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.approveCandidate,
    request: approveCandidateBody,
  };
  return useUpdatesMutation(config);
}

/** `requestChanges` — returns one frozen candidate with a note, so a second round is a new submission rather than a silent re-review; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRequestChanges(): UseReviewedMutationResult<RequestChangesPayload> {
  const config: UpdatesMutationConfig<RequestChangesPayload> = {
    name: "requestChanges",
    endpoint: UPDATES_MUTATION_ENDPOINTS.requestChanges,
    schema: requestChangesSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.requestChanges,
    request: requestChangesBody,
  };
  return useUpdatesMutation(config);
}

/** `rejectCandidate` — ends one frozen candidate under the same single-review rule as a request for changes; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRejectCandidate(): UseReviewedMutationResult<RejectCandidatePayload> {
  const config: UpdatesMutationConfig<RejectCandidatePayload> = {
    name: "rejectCandidate",
    endpoint: UPDATES_MUTATION_ENDPOINTS.rejectCandidate,
    schema: rejectCandidateSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.rejectCandidate,
    request: rejectCandidateBody,
  };
  return useUpdatesMutation(config);
}

/**
 * `publishVariants` — releases the exact revision of each selected edition, reporting what each edition's own attempt
 * produced; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 *
 * The per-edition detail travels back exactly as the service stated it, so an edition that kept its prior-good head is
 * not reported as released and one edition's success is never rolled up into a single "done". The mode each selection
 * carries is the one review fixed: the schema refuses a selection that asks to notify under a candidate submitted
 * without that policy, and nothing here widens it.
 */
export function usePublishVariants(): UseReviewedMutationResult<PublishVariantsPayload> {
  const config: UpdatesMutationConfig<PublishVariantsPayload> = {
    name: "publishVariants",
    endpoint: UPDATES_MUTATION_ENDPOINTS.publishVariants,
    schema: publishVariantsSchema,
    invalidates: publishInvalidations,
    request: asGiven,
  };
  return useUpdatesMutation(config);
}

/**
 * `requestNotification` — submits one deliberate notice for one released edition, for the ceiling the review screen
 * showed; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 *
 * The body is the release selection and the acknowledged ceiling and nothing else: who is eligible, which single
 * rendition each recipient is pinned to, how long the notice stays useful and how a repeated attempt is recognised are
 * all decided by the service at command time. No instant, recipient list or dedupe key is computed here.
 */
export function useRequestNotification(): UseReviewedMutationResult<RequestNotificationPayload> {
  const config: UpdatesMutationConfig<RequestNotificationPayload> = {
    name: "requestNotification",
    endpoint: UPDATES_MUTATION_ENDPOINTS.requestNotification,
    schema: requestNotificationSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.requestNotification,
    request: asGiven,
  };
  return useUpdatesMutation(config);
}

/** `withdrawUpdate` — withdraws every released edition of one Update, stating the identity withdrawn rather than a subset a caller assembled; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useWithdrawUpdate(): UseReviewedMutationResult<WithdrawUpdatePayload> {
  const config: UpdatesMutationConfig<WithdrawUpdatePayload> = {
    name: "withdrawUpdate",
    endpoint: UPDATES_MUTATION_ENDPOINTS.withdrawUpdate,
    schema: withdrawUpdateSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.withdrawUpdate,
    request: withdrawUpdateBody,
  };
  return useUpdatesMutation(config);
}

/** `withdrawLocale` — withdraws exactly one language edition, leaving its siblings released; a `conflict` means the release moved and the withdrawal has to be reviewed again rather than retried blindly; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useWithdrawLocale(): UseReviewedMutationResult<WithdrawLocalePayload> {
  const config: UpdatesMutationConfig<WithdrawLocalePayload> = {
    name: "withdrawLocale",
    endpoint: UPDATES_MUTATION_ENDPOINTS.withdrawLocale,
    schema: withdrawLocaleSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.withdrawLocale,
    request: withdrawLocaleBody,
  };
  return useUpdatesMutation(config);
}

/** `restoreRevisionAsDraft` — copies one earlier revision into a new draft, because a restore never rewrites history; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRestoreRevisionAsDraft(): UseReviewedMutationResult<RestoreRevisionAsDraftPayload> {
  const config: UpdatesMutationConfig<RestoreRevisionAsDraftPayload> = {
    name: "restoreRevisionAsDraft",
    endpoint: UPDATES_MUTATION_ENDPOINTS.restoreRevisionAsDraft,
    schema: restoreRevisionAsDraftSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.restoreRevisionAsDraft,
    request: restoreRevisionAsDraftBody,
  };
  return useUpdatesMutation(config);
}

/**
 * `registerMediaAsset` — registers one chosen image or video as a scoped asset, with the renditions the local pipeline
 * prepared; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`.
 *
 * The attempt's intent is the descriptor plus the file, and the reviewed step identifies an intent by what a value
 * canonicalises to — so two files chosen under an identical descriptor share an attempt. The service then answers
 * `conflict` for the second rather than registering it twice, and `reset()` begins a new attempt; nothing here works
 * around that by minting an identity of its own.
 */
export function useRegisterMediaAsset(): UseReviewedMutationResult<RegisterMediaAssetPayload> {
  const config: UpdatesMutationConfig<RegisterMediaAssetPayload> = {
    name: "registerMediaAsset",
    endpoint: UPDATES_MUTATION_ENDPOINTS.registerMediaAsset,
    schema: registerMediaAssetSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.registerMediaAsset,
    request: registerMediaAssetBody,
  };
  return useUpdatesMutation(config);
}

/** `replacePlacement` — fills one placement of a draft edition with another prepared asset, or restates the description of the asset it already shows, without moving the media when no asset is named; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useReplacePlacement(): UseReviewedMutationResult<ReplacePlacementPayload> {
  const config: UpdatesMutationConfig<ReplacePlacementPayload> = {
    name: "replacePlacement",
    endpoint: UPDATES_MUTATION_ENDPOINTS.replacePlacement,
    schema: replacePlacementSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.replacePlacement,
    request: replacePlacementBody,
  };
  return useUpdatesMutation(config);
}

/** `removePlacement` — detaches one placement from a draft edition, leaving the asset, the draft's other placements and every release untouched; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRemovePlacement(): UseReviewedMutationResult<RemovePlacementPayload> {
  const config: UpdatesMutationConfig<RemovePlacementPayload> = {
    name: "removePlacement",
    endpoint: UPDATES_MUTATION_ENDPOINTS.removePlacement,
    schema: removePlacementSchema,
    invalidates: UPDATES_MUTATION_INVALIDATIONS.removePlacement,
    request: removePlacementBody,
  };
  return useUpdatesMutation(config);
}

