"use client";
/**
 * The Request half of this family's browser mutation layer: one hook per named mutation —
 * `draftRequest`, `presentRequest` and `recordRequestResponse` — and nothing else.
 *
 * Four things are shared, and none of them is restated here. The transport is `../api-client`, which
 * owns the closed set of paths and the one POST that answers with exactly one of the eight outcomes.
 * The invalidation policy is `./use-initiative-mutations`, which owns what a change that stands makes
 * stale. The attempt's identity is the review step's: it mints one `operationId` per intent, reuses it
 * for a retry of the same work and renews it only for a changed intent, so this file mints no identity
 * of its own. The payload shapes are the family's schemas, which are the only place the terms rules
 * live: money and a non-financial ask are mutually exclusive, a non-financial ask carries no amount,
 * and a requested amount is a whole number of minor units in the currency beside it.
 *
 * **What a Request is, and what these hooks must not turn it into (AAP 0.8.3).** One Request is one
 * independently answerable invitation: a recorded response binds to the terms version it answers, and
 * earlier presented versions stay preserved. Agreement is a recorded answer and nothing more — no
 * pledge, gift, commitment, task, subscription, notification or send follows from it here, no read
 * outside this family is invalidated by it, and no money arithmetic is performed on it. A requested
 * amount is terms the worker asked for, never support that was received, so this file never parses,
 * rounds, scales or defaults a `minorUnits` value; it hands the validated integer to the transport.
 *
 * **The one path that carries two named mutations.** `POST /api/initiatives/requests` serves both
 * `draftRequest` and `presentRequest`, so its body states which one the attempt makes in
 * `payload.operation`. That word is routing rather than part of the change — the route strips it before
 * the named mutation sees the payload, and each change's own schema stays exactly the fields a worker
 * chose. It is written here, at the only point where a validated change and a request body both exist,
 * rather than asked of every caller or folded into a family schema that the service shares.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ZodError, ZodType } from "zod";
import type { MutationOutcome, Scope } from "@/modules/data-service";
import { INITIATIVE_API, postMutation, type InitiativeApiPath } from "../api-client";
import { draftRequestPayloadSchema, presentRequestPayloadSchema, type DraftRequestPayload, type PresentRequestPayload } from "../schemas/request";
import { recordRequestResponsePayloadSchemaFor, type RecordRequestResponsePayload } from "../schemas/response";
import { invalidateInitiativeReads, type InitiativeMutationState } from "./use-initiative-mutations";
/**
 * The three outcomes that mean the change stands, so the family's reads are re-read.
 *
 * The other five re-read nothing. A refused or unavailable change has produced nothing to read, and an
 * `unknown` one has produced a result nobody can confirm yet: re-reading on it would present the
 * surface as though the effect had been confirmed, which is exactly what the outcome says cannot be
 * known. This mirrors the policy the sibling mutation file applies, and the policy itself — which jobs
 * are re-read and under which scope prefix — stays declared there.
 */
const ACCEPTING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["accepted", "alreadyAccepted", "unchanged"]);
function isAccepting(outcome: MutationOutcome["outcome"]): boolean {
  return ACCEPTING_OUTCOMES.has(outcome);
}
/** The key under which the one field-error presentation renders a message that belongs to no field, as `fieldErrorsFromInvalid` reads it. */
const ROOT_FIELD_KEY = "_root";
/**
 * The `invalid` member of the closed outcome set, built here for the payload this layer refuses before
 * sending it.
 *
 * It spares a round trip for a payload that cannot be sent; it never replaces the service's authority,
 * which validates the same payload again and whose per-field messages are the ones a caller ultimately
 * sees. Every issue's path is joined as the form reads it, so `fieldErrorsFromInvalid` accepts this
 * outcome unchanged, and an issue with no path becomes the form-level message.
 *
 * The builder is local because the service's own constructor lives beside the response mapping the
 * browser bundle does not carry, and the family's transport exports no such constructor. This is a
 * shape adapter over `zod`, not a second state owner: it writes no cache, holds nothing and is called
 * once per refused submit.
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
/** The two named mutations the requests path serves, as the word that routes a body to one of them. */
type RequestOperation = "draftRequest" | "presentRequest";
/** The three things a caller supplies for one named change: the identity of the attempt, the revision it read, and the payload this hook's schema validates. The scope is the only member this layer adds. */
interface RequestChange<P> {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: P;
}
/** What a hook in this file hands the component that renders it: one way to submit, and the state the result renders from. */
interface RequestMutationHandle<Variables> {
  readonly submit: (variables: Variables) => void;
  readonly state: InitiativeMutationState;
}
/**
 * A validated change as `POST /api/initiatives/requests` admits it: the change itself, plus the word
 * that tells the one requests path which of its two named mutations the request makes.
 */
type RequestsWire<P> = P & { readonly operation: RequestOperation };
/**
 * One named Request mutation, performed through the family's one transport.
 *
 * The payload is validated before anything leaves the browser, so a value that cannot be sent answers
 * `invalid` with per-field messages instead of becoming an `unknown` a caller would have to recover
 * from an effect that never happened. `toWire` then shapes the validated change into its route's body;
 * it adds nothing a caller chose and drops nothing the change states. `retry: false` is stated rather
 * than assumed: recovery is the attempt's `operationId` and the service's ledger, never a library retry
 * under the same or a fresh identity, which would risk a second effect or a `changed-intent` conflict
 * the caller never caused.
 */
function useRequestMutation<P, W>(path: InitiativeApiPath, schema: ZodType<P>, toWire: (payload: P) => W, scope: Scope): RequestMutationHandle<RequestChange<P>> {
  const queryClient = useQueryClient();
  const mutation = useMutation<MutationOutcome, never, RequestChange<P>>({
    mutationFn: async (change: RequestChange<P>): Promise<MutationOutcome> => {
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
/** The variables of `draftRequest`: the attempt's identity, the initiative revision the caller read, and the recipient, purpose and requested terms the family's schema validates. */
export type DraftRequestVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: DraftRequestPayload;
};
/**
 * Drives `draftRequest` — one independently answerable Request inside an initiative, carrying requested
 * terms that are never received support — and answers with one of the eight outcomes: `accepted` with
 * the new revision, `alreadyAccepted` for a replay of the same attempt, or `unchanged`, `conflict`,
 * `denied`, `invalid`, `unavailable`, `unknown`.
 */
export function useDraftRequest(scope: Scope): { submit: (variables: DraftRequestVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<DraftRequestPayload, RequestsWire<DraftRequestPayload>>(
    INITIATIVE_API.requests,
    draftRequestPayloadSchema,
    (payload) => ({ ...payload, operation: "draftRequest" }),
    scope,
  );
}
/** The variables of `presentRequest`: the attempt's identity, the Request revision the caller read, and what was presented, on which civil date and on which terms version. */
export type PresentRequestVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: PresentRequestPayload;
};
/**
 * Drives `presentRequest` — the record of how and when an ask reached its recipient, on a stated terms
 * version, and never a claim that anything was sent, delivered or read — and answers with one of the
 * eight outcomes, `accepted` or a legitimate `unchanged` when the same presentation is already recorded.
 */
export function usePresentRequest(scope: Scope): { submit: (variables: PresentRequestVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<PresentRequestPayload, RequestsWire<PresentRequestPayload>>(
    INITIATIVE_API.requests,
    presentRequestPayloadSchema,
    (payload) => ({ ...payload, operation: "presentRequest" }),
    scope,
  );
}
/** The variables of `recordRequestResponse`: the attempt's identity, the Request revision the caller read, and the named respondent's answer with the terms version it answers. */
export type RecordRequestResponseVariables = {
  readonly operationId: string;
  readonly expectedRevision: string;
  readonly payload: RecordRequestResponsePayload;
};
/**
 * Drives `recordRequestResponse` — the named respondent's own answer, bound to the terms version that
 * was presented — and answers with one of the eight outcomes: `accepted` with the new revision,
 * `unchanged` when the same answer is already recorded, or `alreadyAccepted`, `conflict`, `denied`,
 * `invalid`, `unavailable`, `unknown`.
 *
 * The presented version is a property of the surface for the life of the form, so it arrives as a hook
 * argument rather than with one attempt's variables. Its schema refuses, before the network, an answer
 * written against any other version — the answer the worker saw is the answer that may be recorded —
 * and the service re-checks the same rule against the presentation it stored.
 */
export function useRecordRequestResponse(scope: Scope, presentedVersionRef: string): { submit: (variables: RecordRequestResponseVariables) => void; state: InitiativeMutationState } {
  return useRequestMutation<RecordRequestResponsePayload, RecordRequestResponsePayload>(
    INITIATIVE_API.response,
    recordRequestResponsePayloadSchemaFor(presentedVersionRef),
    (payload) => payload,
    scope,
  );
}
