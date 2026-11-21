"use client";
/**
 * The initiative-lifecycle half of this family's browser mutation layer: one hook per named mutation —
 * `createInitiative`, `addMembers`, `removeMember`, `returnMember`, `setStage`, `closeInitiative` and
 * `reopenInitiative` — and one policy for what a settled change makes stale.
 *
 * Three things are shared, and none of them is restated here. The transport is `../api-client`, which
 * owns the closed set of paths and the one POST. The scope key is `components/context-switch-guard`,
 * which owns the segments every cache key in this application starts with. The attempt's identity is
 * the review step's: it mints one `operationId` per intent, reuses it for a retry of the same work and
 * renews it only for a changed intent. So this file mints no identity, keeps no second copy of an
 * outcome and invents no record — it validates the payload with the family's own schema, adds the scope
 * it was given, states the one word that routes a members change to its named mutation, and returns
 * whichever of the eight outcomes the service answered with, verbatim.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ZodError, ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import type { MutationOutcome, Scope } from "@/modules/data-service";
import { INITIATIVE_API, postMutation, type InitiativeApiPath } from "../api-client";
import { closeInitiativePayloadSchema, reopenInitiativePayloadSchema, type CloseInitiativePayload, type ReopenInitiativePayload } from "../schemas/closure";
import { createInitiativePayloadSchema, type CreateInitiativePayload } from "../schemas/initiative";
import {
  addMembersPayloadSchema,
  removeMemberPayloadSchema,
  returnMemberPayloadSchema,
  type AddMembersPayload,
  type MemberAction,
  type RemoveMemberPayload,
  type ReturnMemberPayload,
} from "../schemas/member";
import { setStagePayloadSchema, type StagePayload } from "../schemas/stage";
/**
 * The jobs in this family that a change which stands makes stale: the initiative list, one initiative —
 * its detail, working list, requests and closure history — and the results computed for it. `initiative`
 * is also the prefix of the per-initiative key, so `[scope, "initiative", id, …]` is covered without
 * this file naming an id it does not own.
 */
const INVALIDATED_JOBS = ["initiatives", "initiative", "initiative-results"] as const;
/** The one invalidation policy for this family's reads: let the reads answer with what the service now holds, rather than writing the outcome's record into the cache by hand. */
export async function invalidateInitiativeReads(queryClient: QueryClient, scope: Scope): Promise<void> {
  const prefix = scopeKey(scope);
  await Promise.all(INVALIDATED_JOBS.map((job) => queryClient.invalidateQueries({ queryKey: [...prefix, job] })));
}
/**
 * The three outcomes that mean the change stands, so the family's reads are re-read.
 *
 * The other five re-read nothing. A refused or unavailable change has produced nothing to read, and an
 * `unknown` one has produced a result nobody can confirm yet: re-reading on it would present the surface
 * as though the effect had been confirmed, which is exactly what the outcome says cannot be known.
 */
const ACCEPTING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);
function isAccepting(outcome: MutationOutcome["outcome"]): boolean {
  return ACCEPTING_OUTCOMES.has(outcome);
}
/** The key under which the one field-error presentation renders a message that belongs to no field, as `fieldErrorsFromInvalid` reads it. */
const ROOT_FIELD_KEY = "_root";
/**
 * The `invalid` member of the closed outcome set, built here because this is a browser module and the
 * service's own constructor lives with the response mapping the browser bundle does not carry.
 *
 * It spares a round trip for a payload that cannot be sent; it never replaces the service's authority,
 * which validates the same payload again and whose per-field messages are the ones a caller sees. Every
 * path is joined as the form reads it, and an issue with no path becomes the form-level message.
 */
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
/** The three states a reviewed mutation can be in; `settled` carries the outcome verbatim. */
export type InitiativeMutationState = { status: "idle" } | { status: "submitting" } | { status: "settled"; outcome: MutationOutcome };
/** The three things a caller supplies for one named change: the identity of the attempt, the revision it read, and the payload this hook's schema validates. The scope is the only member this layer adds. */
interface NamedChange<P> {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: P;
}
/** What a hook in this file hands the component that renders it: one way to submit, and the state the result renders from. */
interface InitiativeMutationHandle<Variables> {
  readonly submit: (variables: Variables) => void;
  readonly state: InitiativeMutationState;
}
/** A validated change, shaped into the body its route admits. */
type WireBody<P, W> = (payload: P) => W;
/**
 * A members change as `POST /api/initiatives/members` admits it: the change itself, plus the word that
 * tells the one members path which of its three named mutations the request makes.
 *
 * The word is routing and not part of the change — the route strips it before the named mutation sees
 * the payload, and the change's own schema stays exactly the fields a worker chose. So it is written
 * here, at the only point where a validated change and a request body both exist, rather than being
 * asked of every caller or folded into the family's schema.
 */
type MembersWire<P, Action extends MemberAction> = P & { readonly action: Action };
/**
 * One named mutation, performed through the family's one transport.
 *
 * The payload is validated before anything leaves the browser, so a value that cannot be sent answers
 * `invalid` with per-field messages instead of becoming an `unknown` a caller would have to recover
 * from an effect that never happened. `toWire` then shapes the validated change into its route's body;
 * it adds nothing a caller chose and drops nothing the change states. `retry: false` is stated rather
 * than assumed: recovery is the attempt's `operationId` and the service's ledger, never a library retry
 * under the same or a fresh identity, which would risk a second effect or a `changed-intent` conflict
 * the caller never caused.
 */
function useInitiativeMutation<P, W>(path: InitiativeApiPath, schema: ZodType<P>, toWire: WireBody<P, W>, scope: Scope): InitiativeMutationHandle<NamedChange<P>> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, never, NamedChange<P>>({
    mutationFn: async (change: NamedChange<P>): Promise<MutationOutcome> => {
      const parsed = schema.safeParse(change.payload);
      if (!parsed.success) {
        return invalidOutcome(change.operationId, parsed.error);
      }
      return postMutation(path, {
        operationId: change.operationId,
        scope,
        expectedRevision: change.expectedRevision,
        payload: toWire(parsed.data),
      });
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
/** The variables of `createInitiative`: the attempt's identity, the list revision the caller read, and a payload the family's schema validates. */
export type CreateInitiativeVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: CreateInitiativePayload;
};
/** Drives `createInitiative` and answers with one of the eight outcomes: `accepted` with the new revision, `alreadyAccepted` for a replay of the same attempt, or `unchanged`, `conflict`, `denied`, `invalid`, `unavailable`, `unknown`. */
export function useCreateInitiative(scope: Scope): InitiativeMutationHandle<CreateInitiativeVariables> {
  return useInitiativeMutation<CreateInitiativePayload, CreateInitiativePayload>(INITIATIVE_API.initiatives, createInitiativePayloadSchema, (payload) => payload, scope);
}
/** The variables of `addMembers`: the attempt's identity, the initiative revision the caller read, and the initiative plus the partners explicitly selected. */
export type AddMembersVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: AddMembersPayload;
};
/** Drives `addMembers` and answers with one of the eight outcomes, reporting each selected partner in the result's per-item list rather than as one aggregate state. */
export function useAddMembers(scope: Scope): InitiativeMutationHandle<AddMembersVariables> {
  return useInitiativeMutation<AddMembersPayload, MembersWire<AddMembersPayload, "add">>(INITIATIVE_API.members, addMembersPayloadSchema, (payload) => ({ ...payload, action: "add" }), scope);
}
/** The variables of `removeMember`: the attempt's identity, the working-list member's revision the caller read, and the member with an optional reason. */
export type RemoveMemberVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: RemoveMemberPayload;
};
/** Drives `removeMember` and answers with one of the eight outcomes; removal keeps the member's history and no independent obligation it carried. */
export function useRemoveMember(scope: Scope): InitiativeMutationHandle<RemoveMemberVariables> {
  return useInitiativeMutation<RemoveMemberPayload, MembersWire<RemoveMemberPayload, "remove">>(
    INITIATIVE_API.members,
    removeMemberPayloadSchema,
    (payload) => ({ ...payload, action: "remove" }),
    scope,
  );
}
/** The variables of `returnMember`: the attempt's identity, the working-list member's revision the caller read, and the member to restore. */
export type ReturnMemberVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: ReturnMemberPayload;
};
/** Drives `returnMember` and answers with one of the eight outcomes; only eligible planning returns, so the restored state is the service's answer and never an assumption here. */
export function useReturnMember(scope: Scope): InitiativeMutationHandle<ReturnMemberVariables> {
  return useInitiativeMutation<ReturnMemberPayload, MembersWire<ReturnMemberPayload, "return">>(
    INITIATIVE_API.members,
    returnMemberPayloadSchema,
    (payload) => ({ ...payload, action: "return" }),
    scope,
  );
}
/** The variables of `setStage`: the attempt's identity, the working-list member's revision the caller read, and the member with either an approved stage token or an explicit Clear. */
export type SetStageVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: StagePayload;
};
/** Drives `setStage` and answers with one of the eight outcomes; a same-value assessment answers `unchanged`, which is a legitimate result and not an error. */
export function useSetStage(scope: Scope): InitiativeMutationHandle<SetStageVariables> {
  return useInitiativeMutation<StagePayload, StagePayload>(INITIATIVE_API.stages, setStagePayloadSchema, (payload) => payload, scope);
}
/** The variables of `closeInitiative`: the attempt's identity, the initiative revision the caller read, and the disposition or eligible handoff that fates the unfinished work. */
export type CloseInitiativeVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: CloseInitiativePayload;
};
/** Drives `closeInitiative` and answers with one of the eight outcomes; closure fences new solicitation and resolves no obligation, records no pledge and sends nothing. */
export function useCloseInitiative(scope: Scope): InitiativeMutationHandle<CloseInitiativeVariables> {
  return useInitiativeMutation<CloseInitiativePayload, CloseInitiativePayload>(INITIATIVE_API.close, closeInitiativePayloadSchema, (payload) => payload, scope);
}
/** The variables of `reopenInitiative`: the attempt's identity, the initiative revision the caller read, and an optional reason for reopening. */
export type ReopenInitiativeVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: ReopenInitiativePayload;
};
/** Drives `reopenInitiative` and answers with one of the eight outcomes; closure history and current exclusions survive a reopen, so the reopened surface is read back rather than inferred. */
export function useReopenInitiative(scope: Scope): InitiativeMutationHandle<ReopenInitiativeVariables> {
  return useInitiativeMutation<ReopenInitiativePayload, ReopenInitiativePayload>(INITIATIVE_API.reopen, reopenInitiativePayloadSchema, (payload) => payload, scope);
}
