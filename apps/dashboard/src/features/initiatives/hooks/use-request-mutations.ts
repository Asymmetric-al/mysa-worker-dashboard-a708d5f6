"use client";
import type { Scope } from "@/modules/data-service";
import { INITIATIVE_API } from "../api-client";
import { draftRequestPayloadSchema, presentRequestPayloadSchema, type DraftRequestPayload, type PresentRequestPayload } from "../schemas/request";
import { recordRequestResponsePayloadSchemaFor, type RecordRequestResponsePayload } from "../schemas/response";
import { useInitiativeMutation, type InitiativeMutationState, type NamedChange } from "./use-initiative-mutations";
type RequestOperation = "draftRequest" | "presentRequest";
type RequestMutationHandle<Variables> = { readonly submit: (variables: Variables) => void; readonly state: InitiativeMutationState };
type RequestsWire<P> = P & { readonly operation: RequestOperation };
/** Drives `draftRequest` — one independently answerable Request inside an initiative, carrying requested terms that are never received support — and answers with one of the eight outcomes. */
export const useDraftRequest = (scope: Scope): RequestMutationHandle<NamedChange<DraftRequestPayload>> => useInitiativeMutation<DraftRequestPayload, RequestsWire<DraftRequestPayload>>(INITIATIVE_API.requests, draftRequestPayloadSchema, (payload) => ({ ...payload, operation: "draftRequest" }), scope);
/** Drives `presentRequest` — the record of how and when an ask reached its recipient, on a stated terms version, and never a claim that anything was sent, delivered or read. */
export const usePresentRequest = (scope: Scope): RequestMutationHandle<NamedChange<PresentRequestPayload>> => useInitiativeMutation<PresentRequestPayload, RequestsWire<PresentRequestPayload>>(INITIATIVE_API.requests, presentRequestPayloadSchema, (payload) => ({ ...payload, operation: "presentRequest" }), scope);
/** Drives `recordRequestResponse` — the named respondent's own answer, bound to the terms version that was presented — and answers with one of the eight outcomes. */ export const useRecordRequestResponse = (scope: Scope, presentedVersionRef: string): RequestMutationHandle<NamedChange<RecordRequestResponsePayload>> =>
  useInitiativeMutation<RecordRequestResponsePayload, RecordRequestResponsePayload>(INITIATIVE_API.response, recordRequestResponsePayloadSchemaFor(presentedVersionRef), (payload) => payload, scope);
