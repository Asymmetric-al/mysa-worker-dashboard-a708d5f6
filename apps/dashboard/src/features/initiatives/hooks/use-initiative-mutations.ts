"use client";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { ZodType } from "zod";
import type { MutationSubmit } from "@/components/action-review";
import { scopeKey } from "@/components/context-switch-guard";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import type { Scope } from "@/modules/data-service";
import { INITIATIVE_API, postMutation, type InitiativeApiPath } from "../api-client";
import { closeInitiativePayloadSchema, reopenInitiativePayloadSchema, type CloseInitiativePayload, type ReopenInitiativePayload } from "../schemas/closure";
import { createInitiativePayloadSchema, type CreateInitiativePayload } from "../schemas/initiative";
import { addMembersPayloadSchema, removeMemberPayloadSchema, returnMemberPayloadSchema, type AddMembersPayload, type MemberAction, type RemoveMemberPayload, type ReturnMemberPayload } from "../schemas/member";
import { setStagePayloadSchema, type StagePayload } from "../schemas/stage";
const INVALIDATED_JOBS = ["initiatives", "initiative", "initiative-results"] as const;
/** The one invalidation policy for this family's reads: let the reads answer with what the service now holds, rather than writing the outcome's record into the cache by hand. */
export async function invalidateInitiativeReads(queryClient: QueryClient, scope: Scope): Promise<void> {
  const prefix = scopeKey(scope);
  await Promise.all(INVALIDATED_JOBS.map((job) => queryClient.invalidateQueries({ queryKey: [...prefix, job] })));
}
const ACCEPTING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);
export type InitiativeMutationState = { status: "idle" } | { status: "submitting" } | { status: "settled"; outcome: MutationOutcome };
export type NamedChange<P> = { readonly operationId: string; readonly expectedRevision: string; readonly payload: P };
type InitiativeMutationHandle<Variables> = { readonly submit: (variables: Variables) => void; readonly state: InitiativeMutationState };
type WireBody<P, W> = (payload: P) => W;
type MembersWire<P, Action extends MemberAction> = P & { readonly action: Action };
/** The one browser mutation this family submits: one named change, its schema, and the body the route reads. */
export function useInitiativeMutation<P, W>(path: InitiativeApiPath, schema: ZodType<P>, toWire: WireBody<P, W>, scope: Scope): InitiativeMutationHandle<NamedChange<P>> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, never, NamedChange<P>>({
    mutationFn: async (change: NamedChange<P>): Promise<MutationOutcome> => {
      const parsed = schema.safeParse(change.payload);
      if (!parsed.success) return invalid({ operationId: change.operationId, fields: parsed.error });
      return postMutation(path, { operationId: change.operationId, scope, expectedRevision: change.expectedRevision, payload: toWire(parsed.data) });
    },
    retry: false,
    onSuccess: async (outcome: MutationOutcome): Promise<void> => {
      if (!ACCEPTING_OUTCOMES.has(outcome.outcome)) return;
      await invalidateInitiativeReads(queryClient, scope);
    },
  });
  const state: InitiativeMutationState = mutation.isPending ? { status: "submitting" } : mutation.data === undefined ? { status: "idle" } : { status: "settled", outcome: mutation.data };
  return { submit: mutation.mutate, state };
}
type PendingAttempt = { readonly operationId: string; readonly resolve: (outcome: MutationOutcome) => void };
/** The promise a reviewed step submits through, over a handle that answers through its own settled state rather than returning one: the attempt's own identity is matched to the outcome, so a late answer to an earlier attempt cannot resolve a later one. */
export function useAttemptSubmit<P>(handle: InitiativeMutationHandle<NamedChange<P>>): MutationSubmit<P> {
  const pending = useRef<PendingAttempt | null>(null);
  const settled = handle.state.status === "settled" ? handle.state.outcome : null;
  useEffect(() => {
    const waiting = pending.current;
    if (settled === null || waiting === null || waiting.operationId !== settled.operationId) return;
    pending.current = null;
    waiting.resolve(settled);
  }, [settled]);
  const dispatch = handle.submit;
  return useCallback(
    (input) =>
      new Promise<MutationOutcome>((resolve) => {
        pending.current = { operationId: input.operationId, resolve };
        dispatch({ operationId: input.operationId, expectedRevision: input.expectedRevision, payload: input.payload });
      }),
    [dispatch],
  );
}
/** Drives `createInitiative` and answers with one of the eight outcomes: `accepted` with the new revision, `alreadyAccepted` for a replay of the same attempt, or `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`. */
export const useCreateInitiative = (scope: Scope): InitiativeMutationHandle<NamedChange<CreateInitiativePayload>> => useInitiativeMutation<CreateInitiativePayload, CreateInitiativePayload>(INITIATIVE_API.initiatives, createInitiativePayloadSchema, (payload) => payload, scope);
/** Drives `addMembers` and answers with one of the eight outcomes, reporting each selected partner in the result's per-item list rather than as one aggregate state. */
export const useAddMembers = (scope: Scope): InitiativeMutationHandle<NamedChange<AddMembersPayload>> => useInitiativeMutation<AddMembersPayload, MembersWire<AddMembersPayload, "add">>(INITIATIVE_API.members, addMembersPayloadSchema, (payload) => ({ ...payload, action: "add" }), scope);
/** Drives `removeMember` and answers with one of the eight outcomes; removal keeps the member's history and no independent obligation it carried. */
export const useRemoveMember = (scope: Scope): InitiativeMutationHandle<NamedChange<RemoveMemberPayload>> => useInitiativeMutation<RemoveMemberPayload, MembersWire<RemoveMemberPayload, "remove">>(INITIATIVE_API.members, removeMemberPayloadSchema, (payload) => ({ ...payload, action: "remove" }), scope);
/** Drives `returnMember` and answers with one of the eight outcomes; only eligible planning returns, so the restored state is the service's answer and never an assumption here. */
export const useReturnMember = (scope: Scope): InitiativeMutationHandle<NamedChange<ReturnMemberPayload>> => useInitiativeMutation<ReturnMemberPayload, MembersWire<ReturnMemberPayload, "return">>(INITIATIVE_API.members, returnMemberPayloadSchema, (payload) => ({ ...payload, action: "return" }), scope);
/** Drives `setStage` and answers with one of the eight outcomes; a same-value assessment answers `unchanged`, which is a legitimate result and not an error. */
export const useSetStage = (scope: Scope): InitiativeMutationHandle<NamedChange<StagePayload>> => useInitiativeMutation<StagePayload, StagePayload>(INITIATIVE_API.stages, setStagePayloadSchema, (payload) => payload, scope);
/** Drives `closeInitiative` and answers with one of the eight outcomes; closure fences new solicitation and resolves no obligation, records no pledge and sends nothing. */
export const useCloseInitiative = (scope: Scope): InitiativeMutationHandle<NamedChange<CloseInitiativePayload>> => useInitiativeMutation<CloseInitiativePayload, CloseInitiativePayload>(INITIATIVE_API.close, closeInitiativePayloadSchema, (payload) => payload, scope);
/** Drives `reopenInitiative` and answers with one of the eight outcomes; closure history and current exclusions survive a reopen, so the reopened surface is read back rather than inferred. */
export const useReopenInitiative = (scope: Scope): InitiativeMutationHandle<NamedChange<ReopenInitiativePayload>> => useInitiativeMutation<ReopenInitiativePayload, ReopenInitiativePayload>(INITIATIVE_API.reopen, reopenInitiativePayloadSchema, (payload) => payload, scope);
