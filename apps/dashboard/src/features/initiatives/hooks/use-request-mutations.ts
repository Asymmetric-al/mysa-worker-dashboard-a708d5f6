"use client";
/** The Request half of this family's browser mutation layer: one hook per named mutation — `draftRequest`, `presentRequest` and `recordRequestResponse` — and nothing else. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ZodError, ZodType } from "zod";
import type { MutationOutcome, Scope } from "@/modules/data-service";
import { INITIATIVE_API, postMutation, type InitiativeApiPath } from "../api-client";
import { draftRequestPayloadSchema, presentRequestPayloadSchema, type DraftRequestPayload, type PresentRequestPayload } from "../schemas/request";
import { recordRequestResponsePayloadSchemaFor, type RecordRequestResponsePayload } from "../schemas/response";
import { invalidateInitiativeReads, type InitiativeMutationState } from "./use-initiative-mutations";
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
type RequestOperation = "draftRequest" | "presentRequest";
interface RequestChange<P> {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: P;
}
interface RequestMutationHandle<Variables> {
  readonly submit: (variables: Variables) => void;
  readonly state: InitiativeMutationState;
}
type RequestsWire<P> = P & { readonly operation: RequestOperation };
function useRequestMutation<P, W>(path: InitiativeApiPath, schema: ZodType<P>, toWire: (payload: P) => W, scope: Scope): RequestMutationHandle<RequestChange<P>> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, never, RequestChange<P>>({
    mutationFn: async (change: RequestChange<P>): Promise<MutationOutcome> => {
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
export type DraftRequestVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: DraftRequestPayload };
/** Drives `draftRequest` — one independently answerable Request inside an initiative, carrying requested terms that are never received support — and answers with one of the eight outcomes: */
export function useDraftRequest(scope: Scope): { submit: (variables: DraftRequestVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<DraftRequestPayload, RequestsWire<DraftRequestPayload>>(INITIATIVE_API.requests, draftRequestPayloadSchema, (payload) => ({ ...payload, operation: "draftRequest" }), scope);
}
export type PresentRequestVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: PresentRequestPayload };
/** Drives `presentRequest` — the record of how and when an ask reached its recipient, on a stated terms version, and never a claim that anything was sent, delivered or read — and answers with one of … */
export function usePresentRequest(scope: Scope): { submit: (variables: PresentRequestVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<PresentRequestPayload, RequestsWire<PresentRequestPayload>>(INITIATIVE_API.requests, presentRequestPayloadSchema, (payload) => ({ ...payload, operation: "presentRequest" }), scope);
}
export type RecordRequestResponseVariables = { readonly operationId: string; readonly expectedRevision: string; readonly payload: RecordRequestResponsePayload };
/** Drives `recordRequestResponse` — the named respondent's own answer, bound to the terms version that was presented — and answers with one of the eight outcomes: */
export function useRecordRequestResponse(scope: Scope, presentedVersionRef: string): { submit: (variables: RecordRequestResponseVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<RecordRequestResponsePayload, RecordRequestResponsePayload>(INITIATIVE_API.response, recordRequestResponsePayloadSchemaFor(presentedVersionRef), (payload) => payload, scope);
}
