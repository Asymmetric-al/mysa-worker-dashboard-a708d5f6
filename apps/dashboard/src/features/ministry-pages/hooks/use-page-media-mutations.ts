"use client";
/**
 * The browser transport for the three media writes a Page draft makes — `registerMediaAsset`,
 * `replacePlacement` and `removePlacement` — each posted to the one handler the API specification gives
 * them and answered with one outcome of the closed eight, returned verbatim.
 *
 * A registration records a descriptor: the prepared asset's identity and the words a reader is told
 * about it. The file itself is prepared behind the mutation, in the server's media module, where the
 * profile limits, the magic-byte typing, the decode, the re-encode, the tag check and the metadata
 * stripping live. Nothing here measures a byte, opens a container, infers a kind from a name or an
 * extension, or builds a rendition address, so the media profile has one declaration and no second,
 * browser-shaped copy of it that could drift.
 */
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { ZodError, type ZodType } from "zod";
import type { MutationInput, MutationOutcome } from "@/modules/data-service";
/**
 * The outcome constructor rather than the service barrel, because this is a browser module: a value
 * import of the barrel would pull every read, every mutation and the store — and the `node:fs` behind
 * them — into the client bundle. The barrel supplies the contract types a boundary names; the refusal
 * a checked body answers with is taken from the module that owns it.
 */
import { invalid } from "@/modules/data-service/outcome";
import {
  registerMediaAssetInputSchema,
  removePlacementInputSchema,
  replacePlacementInputSchema,
  type RegisterMediaAssetPayload,
  type RemovePlacementPayload,
  type ReplacePlacementPayload,
} from "../schemas/media";
import { pageKey } from "./page-query-keys";
import { usePageMutation } from "./use-page-mutation";
/** The one handler the three media mutations are posted to (AAP 0.6.3). */
const MEDIA_PATH = "/api/media";
/** What one media write presents: the four-field input every mutation carries, plus the Page whose draft it edits. */
export interface PageMediaVariables<P> extends MutationInput<P> {
  /**
   * The Page whose draft this write edits. It keys the re-read and never enters the request body: the
   * handler dispatches on the payload alone, and the payload's own schema is strict about its members.
   */
  readonly documentId: string;
}
/** What each hook returns: its data is the outcome of one media write and nothing else. */
export type PageMediaMutation<P> = UseMutationResult<MutationOutcome, never, PageMediaVariables<P>>;
/**
 * The routing discriminant the handler dispatches on. The sibling payload schemas state the closed
 * payload the mutation validates and carry no discriminant, so each hook adds its own literal once the
 * body is checked, and the handler removes it again before the service reads the payload.
 */
type RegisterMediaAssetRequest = RegisterMediaAssetPayload & { readonly operation: "registerMediaAsset" };

type ReplacePlacementRequest = ReplacePlacementPayload & { readonly operation: "replacePlacement" };

type RemovePlacementRequest = RemovePlacementPayload & { readonly operation: "removePlacement" };
/**
 * The four members of the request envelope, stated member by member rather than spread and stripped, so
 * the Page identity cannot reach the body through a later edit: these four are the whole request.
 */
function envelopeOf<P>(variables: PageMediaVariables<P>): MutationInput<P> {
  return {
    operationId: variables.operationId,
    scope: variables.scope,
    expectedRevision: variables.expectedRevision,
    payload: variables.payload,
  };
}
/** A checked body, or the refusal it answers with instead of a request. */
type CheckedBody<P> = { readonly ok: true; readonly input: MutationInput<P> } | { readonly ok: false; readonly outcome: MutationOutcome };
/**
 * States a payload fault at the payload's own field path. The body's schema carries the payload as one
 * of its members, so a fault inside it arrives as `payload.altText`; the author fixes that field in the
 * picker's form, and the service reports the identical refusal under `altText`. Removing the prefix here
 * is what makes a browser refusal and a service refusal name the field the same way. A fault in the
 * envelope itself — the operation identity, the expected revision, the scope — keeps its own name.
 */
function payloadFieldPaths(error: ZodError): ZodError {
  return new ZodError(
    error.issues.map((issue) => {
      const [head, ...rest] = issue.path;
      return head === "payload" ? { ...issue, path: rest } : issue;
    }),
  );
}
/**
 * Checks one four-field body against its mutation's own schema before anything leaves the browser. A
 * refused body — alternative text missing or blank, a placement with no draft target, an identity or a
 * revision that cannot be stated — answers `invalid` with the field paths it names and posts nothing.
 */
function checkBody<P>(schema: ZodType<MutationInput<P>>, variables: PageMediaVariables<P>): CheckedBody<P> {
  const checked = schema.safeParse(envelopeOf(variables));
  if (!checked.success) {
    return { ok: false, outcome: invalid({ operationId: variables.operationId, fields: payloadFieldPaths(checked.error) }) };
  }
  return { ok: true, input: checked.data };
}
/**
 * Which outcomes leave the Page worth re-reading. `accepted` and `alreadyAccepted` changed it, and
 * `unknown` may have: the effect could exist and only a fresh read can say which placement the draft now
 * holds. The other five changed nothing, so re-reading would report the same page back and throw away a
 * selection the author is still working with. Listed per outcome, so a ninth outcome fails to compile
 * here instead of silently joining one side.
 */
const RE_READ_OUTCOMES: Record<MutationOutcome["outcome"], boolean> = {
  accepted: true,
  alreadyAccepted: true,
  unknown: true,
  unchanged: false,
  conflict: false,
  invalid: false,
  denied: false,
  unavailable: false,
};
/**
 * Re-reads one Page — its body, its locale editions, its giving binding and every preview of it — after
 * a write whose fate leaves the placement in question. Never a write of its own, never a retry of the
 * mutation: the outcome stands as the handler reported it.
 */
function reReadPage<P>(queryClient: QueryClient, outcome: MutationOutcome, variables: PageMediaVariables<P>): void {
  if (!RE_READ_OUTCOMES[outcome.outcome]) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: pageKey(variables.scope, variables.documentId) });
}
/**
 * Registers one prepared image or video as a scoped asset for a Page draft, as `registerMediaAsset`.
 * Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`
 * or `unknown`; a refused registration leaves the draft's prose and its existing placements untouched.
 */
export function useRegisterPageMediaAsset(): PageMediaMutation<RegisterMediaAssetPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<RegisterMediaAssetPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(registerMediaAssetInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<RegisterMediaAssetRequest> = {
        ...body.input,
        payload: { operation: "registerMediaAsset", ...body.input.payload },
      };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    // An uncertain registration is recovered by re-querying the same operation id, never by sending the
    // same bytes again under a fresh one: a replay returns the original result.
    retry: false,
  });
}
/**
 * Fills one existing placement of a Page draft with another prepared asset, or restates the description
 * of the asset it already shows, as `replacePlacement`. Outcomes are `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`; a refused replacement leaves
 * the placement as it was.
 */
export function useReplacePagePlacement(): PageMediaMutation<ReplacePlacementPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<ReplacePlacementPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(replacePlacementInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<ReplacePlacementRequest> = {
        ...body.input,
        payload: { operation: "replacePlacement", ...body.input.payload },
      };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    retry: false,
  });
}
/**
 * Detaches one placement from a Page draft, as `removePlacement`; no asset is deleted and no release is
 * withdrawn, because a removal is neither. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`,
 * `conflict`, `denied`, `invalid`, `unavailable` or `unknown`; a refused removal leaves the placement in
 * place.
 */
export function useRemovePagePlacement(): PageMediaMutation<RemovePlacementPayload> {
  const queryClient = useQueryClient();
  const transport = usePageMutation({ path: MEDIA_PATH });
  return useMutation<MutationOutcome, never, PageMediaVariables<RemovePlacementPayload>>({
    mutationFn: async (variables) => {
      const body = checkBody(removePlacementInputSchema, variables);
      if (!body.ok) {
        return body.outcome;
      }
      const request: MutationInput<RemovePlacementRequest> = {
        ...body.input,
        payload: { operation: "removePlacement", ...body.input.payload },
      };
      return transport.mutateAsync(request);
    },
    onSuccess: (outcome, variables) => {
      reReadPage(queryClient, outcome, variables);
    },
    retry: false,
  });
}
