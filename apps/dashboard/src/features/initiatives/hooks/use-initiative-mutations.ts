"use client";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ZodError, ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationOutcome, Scope } from "@/modules/data-service";
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
function isAccepting(outcome: MutationOutcome["outcome"]): boolean {
  return ACCEPTING_OUTCOMES.has(outcome);
}
const ROOT_FIELD_KEY = "_root";
function invalidOutcome(operationId: string, error: ZodError): MutationOutcome {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path];
    if (messages === undefined) {
      fields[path] = [issue.message];
    } else if (!messages.includes(issue.message)) {
      messages.push(issue.message);
    }
  }
  return { outcome: "invalid", operationId, fields };
}
export type InitiativeMutationState = { status: "idle" } | { status: "submitting" } | { status: "settled"; outcome: MutationOutcome };
interface NamedChange<P> {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: P;
}
interface InitiativeMutationHandle<Variables> {
  readonly submit: (variables: Variables) => void;
  readonly state: InitiativeMutationState;
}
type WireBody<P, W> = (payload: P) => W;
type MembersWire<P, Action extends MemberAction> = P & { readonly action: Action };
function useInitiativeMutation<P, W>(path: InitiativeApiPath, schema: ZodType<P>, toWire: WireBody<P, W>, scope: Scope): InitiativeMutationHandle<NamedChange<P>> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, never, NamedChange<P>>({
    mutationFn: async (change: NamedChange<P>): Promise<MutationOutcome> => {
      const parsed = schema.safeParse(change.payload);
      if (!parsed.success) {
        return invalidOutcome(change.operationId, parsed.error);
      }
      return postMutation(path, { operationId: change.operationId, scope, expectedRevision: change.expectedRevision, payload: toWire(parsed.data) });
    },
    retry: false,
    onSuccess: async (outcome: MutationOutcome): Promise<void> => {
      if (!isAccepting(outcome.outcome)) {
        return;
      }
      await invalidateInitiativeReads(queryClient, scope);
    },
  });
  const state: InitiativeMutationState = mutation.isPending ? { status: "submitting" } : mutation.data === undefined ? { status: "idle" } : { status: "settled", outcome: mutation.data };
  return { submit: mutation.mutate, state };
}
export type CreateInitiativeVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: CreateInitiativePayload };
/** Drives `createInitiative` and answers with one of the eight outcomes: `accepted` with the new revision, `alreadyAccepted` for a replay of the same attempt, or `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`. */
export function useCreateInitiative(scope: Scope): InitiativeMutationHandle<CreateInitiativeVariables> {
  return useInitiativeMutation<CreateInitiativePayload, CreateInitiativePayload>(INITIATIVE_API.initiatives, createInitiativePayloadSchema, (payload) => payload, scope);
}
export type AddMembersVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: AddMembersPayload };
/** Drives `addMembers` and answers with one of the eight outcomes, reporting each selected partner in the result's per-item list rather than as one aggregate state. */
export function useAddMembers(scope: Scope): InitiativeMutationHandle<AddMembersVariables> {
  return useInitiativeMutation<AddMembersPayload, MembersWire<AddMembersPayload, "add">>(INITIATIVE_API.members, addMembersPayloadSchema, (payload) => ({ ...payload, action: "add" }), scope);
}
export type RemoveMemberVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: RemoveMemberPayload };
/** Drives `removeMember` and answers with one of the eight outcomes; removal keeps the member's history and no independent obligation it carried. */
export function useRemoveMember(scope: Scope): InitiativeMutationHandle<RemoveMemberVariables> {
  return useInitiativeMutation<RemoveMemberPayload, MembersWire<RemoveMemberPayload, "remove">>(INITIATIVE_API.members, removeMemberPayloadSchema, (payload) => ({ ...payload, action: "remove" }), scope);
}
export type ReturnMemberVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: ReturnMemberPayload };
/** Drives `returnMember` and answers with one of the eight outcomes; only eligible planning returns, so the restored state is the service's answer and never an assumption here. */
export function useReturnMember(scope: Scope): InitiativeMutationHandle<ReturnMemberVariables> {
  return useInitiativeMutation<ReturnMemberPayload, MembersWire<ReturnMemberPayload, "return">>(INITIATIVE_API.members, returnMemberPayloadSchema, (payload) => ({ ...payload, action: "return" }), scope);
}
export type SetStageVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: StagePayload };
/** Drives `setStage` and answers with one of the eight outcomes; a same-value assessment answers `unchanged`, which is a legitimate result and not an error. */
export function useSetStage(scope: Scope): InitiativeMutationHandle<SetStageVariables> {
  return useInitiativeMutation<StagePayload, StagePayload>(INITIATIVE_API.stages, setStagePayloadSchema, (payload) => payload, scope);
}
export type CloseInitiativeVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: CloseInitiativePayload };
/** Drives `closeInitiative` and answers with one of the eight outcomes; closure fences new solicitation and resolves no obligation, records no pledge and sends nothing. */
export function useCloseInitiative(scope: Scope): InitiativeMutationHandle<CloseInitiativeVariables> {
  return useInitiativeMutation<CloseInitiativePayload, CloseInitiativePayload>(INITIATIVE_API.close, closeInitiativePayloadSchema, (payload) => payload, scope);
}
export type ReopenInitiativeVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: ReopenInitiativePayload };
/** Drives `reopenInitiative` and answers with one of the eight outcomes; closure history and current exclusions survive a reopen, so the reopened surface is read back rather than inferred. */
export function useReopenInitiative(scope: Scope): InitiativeMutationHandle<ReopenInitiativeVariables> {
  return useInitiativeMutation<ReopenInitiativePayload, ReopenInitiativePayload>(INITIATIVE_API.reopen, reopenInitiativePayloadSchema, (payload) => payload, scope);
}
