"use client";

/**
 * The browser transport for the one piece of work a gift may lead to: the thank-you follow-up the gift
 * detail offers, submitted as the named mutation `createTask` over `POST /api/tasks`.
 *
 * **Why a task can never become a financial act.** The payload accepted here is
 * `followUpTaskPayloadSchema` from `../schemas` — a title, an optional label, an optional civil due
 * date, an optional partner link and a kind. It has no field for an amount, a currency, a gift or
 * allocation identity, a designation, a message body or a commitment, so "thank you for this gift" can
 * only ever become work to do. What leaves this file is the schema's *output*, not the object the
 * caller handed over, so a financial field smuggled into a payload is dropped before the request is
 * sent rather than trusted because a type said it could not be there. That absence is criterion 8's
 * defence, and it holds whatever a later caller does. The one member that output adds to what a caller
 * states is `operation`, the routing discriminant `POST /api/tasks` selects `createTask` by, which is
 * why this hook accepts `FollowUpTaskInput` and sends `parsed.data`.
 *
 * **One identity per intent.** `createTask` is recoverable by identity: replaying an `operationId`
 * returns the task already created instead of creating a second one. The identity therefore belongs to
 * an *intent* — the same scope, expected revision and payload — and is held in a ref, minted once by
 * `newOperationId` for the first attempt at that intent and reused by every retry of it. A caller that
 * already owns an identity (the shared review step mints one and hands it over) has it used verbatim,
 * so the two never disagree about which attempt is which. Nothing here reads a clock or a random
 * source to invent one.
 *
 * **The request is the four-field mutation input, plus the one routing discriminant.** The body
 * carries `{ operationId, scope, expectedRevision, payload }` — `mutationInputSchema` is a strict
 * object, so a fifth field at that level would be an `invalid` outcome rather than a discarded one,
 * and an `?action=` query string or an `/api/tasks/create` endpoint would be a second dispatch form
 * for one path. `POST /api/tasks` carries the whole task family, so the handler selects the mutation
 * from `payload.operation` over its closed set of five names and removes that member before the
 * mutation's own closed schema reads the payload. The discriminant therefore travels inside `payload`
 * beside the task fields, supplied by `followUpTaskPayloadSchema` rather than by a caller: it is
 * routing metadata the handler strips, and never a field a task records.
 *
 * **`expectedRevision` is the caller's, never invented.** It is the revision of the envelope the
 * affordance was rendered from, which is what makes a stale submission a `conflict` preserving the
 * person's text instead of an overwrite. A fabricated `0` here would quietly defeat that check.
 *
 * **Every answer is one of the eight outcomes, unchanged.** `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` and `unknown` are returned exactly as the
 * handler wrote them: nothing is coerced, nothing is inferred from an absent error, and the HTTP status
 * is not a second discriminant — a denial is 403, an uncertain effect 202, an outage 503, and only the
 * body says which fact a response carries. A payload the schema refuses never leaves the browser: it
 * resolves to `invalid` with the field messages the receipt's form summary renders.
 *
 * **An unreadable answer becomes `unknown`, never a throw.** A rejected request, or a body that is not
 * one of the eight outcomes, leaves the effect's fate unknown from the response, so this hook answers
 * with the union's own `unknown` member carrying the `operationId` rather than raising an exception.
 * An exception is not a presentation: the receipt renders the closed set and has no arm for one, and
 * `unknown` is the member that exists for exactly this fact — it promises neither success nor failure
 * and hands over the only handle by which the attempt can be recovered. Nothing here retries, and
 * nothing mints a second identity for one intent; because the identity is keyed to the intent, the
 * recovery a person performs — submitting the same follow-up again — replays the same operation and
 * answers `alreadyAccepted` instead of creating a second task.
 *
 * **What is invalidated, and what is not.** A created task appears where the worker looks next, so the
 * two Work cache prefixes for this scope — `tasks` and `agenda` — are invalidated on `accepted` and
 * `alreadyAccepted`, and nothing is invalidated on any other outcome. No financial key is touched:
 * creating work cannot change a gift row, a support projection, a commitment, the goal or a report, and
 * invalidating one would assert that it had. The cache is never cleared, because a context switch is
 * the only thing allowed to fence it.
 *
 * **Layering.** This module composes the data-service contracts (`envelope`, `outcome`), the operation
 * identity from `lib/ids` and `scopeKey` from the context-switch guard. It reaches no store, no other
 * feature, no report function and no HTTP client beyond the one relative `fetch` below.
 *
 * Plan items: AAP 0.6.1 "Mutations: tasks" (`createTask`); AAP 0.6.3 `GET/POST /api/tasks` and the
 * four-field mutation input; AAP 0.7.1 (the closed eight-outcome set, and a form that validates with
 * Zod before posting); AAP 0.7.2 (an uncertain result is recovered by the same operation, never a
 * resend); AAP 0.9.1 `features/support/**`; AAP 0.15.1 (a fault the contract cannot read is not
 * success); and criterion 8.
 */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";

import { scopeKey } from "@/components/context-switch-guard";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import {
  invalid,
  isOutcome,
  unknown as unknownOutcome,
  type MutationOutcome,
} from "@/modules/data-service/outcome";

import {
  followUpTaskPayloadSchema,
  type FollowUpTaskInput,
  type FollowUpTaskPayload,
} from "../schemas";

// ---------------------------------------------------------------------------------------------
// The one handler, and the cache segments a created task can appear under
// ---------------------------------------------------------------------------------------------

/**
 * The route handler this transport posts to.
 *
 * Relative on purpose: the browser request must be same-origin, because the development session is an
 * `httpOnly`, `sameSite=lax` cookie and the handler derives scope from it rather than from the body.
 */
const TASKS_ENDPOINT = "/api/tasks";

/**
 * The two job segments a created task becomes visible under, stated once so the invalidation below and
 * any reader of it agree on the wording.
 *
 * `queryKey(scope, job, params)` builds `[...scopeKey(scope), job, params]`, so a prefix of
 * `[...scopeKey(scope), "tasks"]` matches every parameterised tasks key in this scope and leaves other
 * jobs — including every financial one — untouched.
 */
const TASKS_JOB = "tasks";
const AGENDA_JOB = "agenda";

// ---------------------------------------------------------------------------------------------
// What one submission needs
// ---------------------------------------------------------------------------------------------

/**
 * The input one follow-up submission presents, before this hook adds the attempt identity.
 *
 * `scope` is the context the person is acting in, `expectedRevision` the revision of the envelope the
 * affordance was rendered from, and `payload` the task as the caller states it — `FollowUpTaskInput`,
 * which carries no routing metadata, because the schema supplies `operation` and this hook sends its
 * parsed output. `operationId` is optional and exists for a caller that already owns the identity of
 * the attempt — the shared review step mints one per intent and passes it here — so a replay is
 * recognised by identity rather than guessed from a repeated payload.
 */
export interface FollowUpTaskVariables {
  readonly scope: Scope;
  readonly expectedRevision: string;
  readonly payload: FollowUpTaskInput;
  readonly operationId?: string;
}

/** What the gift detail holds: the mutation, whose data is the outcome and nothing else. */
export type FollowUpTaskMutation = UseMutationResult<MutationOutcome, Error, FollowUpTaskVariables>;

/**
 * The identity this hook is holding for one intent.
 *
 * Keeping the intent beside the identity is what makes the reuse rule checkable: the identity is
 * reused only while the intent is unchanged, and any change to the scope, the expected revision or the
 * payload is a different attempt that must not inherit an identity already spent on another one.
 */
interface FollowUpAttempt {
  readonly operationId: string;
  readonly intent: string;
}

// ---------------------------------------------------------------------------------------------
// Identity, keyed by intent
// ---------------------------------------------------------------------------------------------

/**
 * One payload field as text, for the intent key only.
 *
 * The payload is typed, but a JavaScript caller can still hand over a field that is not a string — and
 * `JSON.stringify` throws on a value it cannot serialise, which would break the click handler instead
 * of refusing the submission it should refuse. A field that is not text keys as absent text, so the
 * key is always a deterministic string and the schema below is the thing that refuses the payload.
 */
function intentText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A deterministic name for one submission's intent.
 *
 * Every input the request varies by is in it — the four scope identifiers, the expected revision and
 * each payload field, in a fixed order — so the same submission always produces the same text and a
 * changed one always produces a different text. It is never a hash of a clock or a random source: the
 * identity derived from it must be reproducible across a retry, or a replay would create a second task.
 */
function intentKeyOf(scope: Scope, expectedRevision: string, payload: FollowUpTaskInput): string {
  return JSON.stringify([
    scope.organizationId,
    scope.ministryId,
    scope.supportSubjectId,
    scope.principalId,
    expectedRevision,
    intentText(payload.title),
    intentText(payload.category),
    intentText(payload.dueOn),
    intentText(payload.partnerId),
    intentText(payload.kind),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------------------------

/**
 * The response body parsed as JSON, or `null` when it carried nothing this client could read.
 *
 * A handler that fails below the contract — a platform error page, an empty body — answers with
 * something `Response.json()` rejects on. `null` routes that into the same recovery as any other
 * unreadable body rather than letting it look like a mutation outcome that happened to be missing.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/**
 * Submits the gift's thank-you follow-up as `createTask`, answering with one of the eight outcomes —
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown` — and creating a task and no financial record, no message and no stewardship obligation.
 *
 * The payload cannot express an amount, a currency, a gift identity or a message, so the only thing
 * this call can produce is work; completing that work later proves nothing about contact, payment or
 * fulfilment either. See this file's header for the identity, invalidation and uncertainty rules.
 */
export function useFollowUpTask(): FollowUpTaskMutation {
  const queryClient = useQueryClient();
  const attemptRef = useRef<FollowUpAttempt | null>(null);

  return useMutation<MutationOutcome, Error, FollowUpTaskVariables>({
    mutationFn: async (variables) => {
      const intent = intentKeyOf(variables.scope, variables.expectedRevision, variables.payload);
      const held = attemptRef.current;
      const operationId =
        variables.operationId ??
        (held !== null && held.intent === intent ? held.operationId : newOperationId());
      attemptRef.current = { operationId, intent };

      const parsed = followUpTaskPayloadSchema.safeParse(variables.payload);
      if (!parsed.success) {
        /* Nothing was sent, so the answer is the schema's own refusal: the constructor turns the Zod
         * error into field-keyed messages, which is what the receipt's form summary marks up. */
        return invalid({ operationId, fields: parsed.error });
      }

      const request: MutationInput<FollowUpTaskPayload> = {
        operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        // The schema's output carries `operation`, the routing discriminant the handler dispatches on
        // and removes before the mutation's closed schema validates the payload; it is not a task field
        // and it is not keyed into the attempt identity above.
        payload: parsed.data,
      };

      let response: Response;
      try {
        response = await fetch(TASKS_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The development session is an httpOnly, sameSite=lax cookie, so the handler can only
          // derive scope from a same-origin request that carries it.
          credentials: "same-origin",
          body: JSON.stringify(request),
        });
      } catch {
        /* No response arrived at all, so whether the task was created is not known. The union's
         * `unknown` member states exactly that and hands over the identity; the same submission
         * replays it, which is why a lost acknowledgement is neither a failure nor a second task. */
        return unknownOutcome({ operationId });
      }

      const body = await readJsonBody(response);
      if (!isOutcome(body)) {
        /* A response arrived that this client cannot read as an outcome, so its fate is unknown for
         * the same reason and answered the same way — never as success, never as failure. */
        return unknownOutcome({ operationId });
      }

      return body;
    },

    onSuccess: async (outcome, variables) => {
      /* Only the two outcomes that report a task now existing change what the lists would show. A
       * refusal, a stale revision, a refused payload, an outage or an unconfirmed effect leaves the
       * record as it was, so re-reading would be a guess about a write that did not happen. */
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
        return;
      }

      const scope = scopeKey(variables.scope);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...scope, TASKS_JOB] }),
        queryClient.invalidateQueries({ queryKey: [...scope, AGENDA_JOB] }),
      ]);
    },
  });
}
