"use client";

/**
 * The browser transport for `saveGoal` — the one financial write this application has — and the one
 * place a goal edit leaves the page.
 *
 * Scope: AAP 0.6.1 ("Mutations: support": `saveGoal`, the single permitted financial write), 0.6.3
 * (`POST /api/support/goal`), 0.7.1 (the four-field mutation input and the closed outcome set for the
 * "Understand support" job, whose only mutation this is), 0.8.1 (the goal rules), 0.11.1
 * (`features/support/**`), and criterion 7 (`canEditGoal` off means no edit control; a stale save
 * returns `conflict` with the typed amount preserved; a replay returns the stored result).
 *
 * What this file owns, and nothing else does:
 *
 * - **The payload check, before anything leaves the browser.** `goalSavePayloadSchema` from
 *   `../schemas` is the one validator of a goal payload and it is the family's own, so the amount
 *   rule — a reported currency, a positive figure at that currency's exponent, no rounded, coercible
 *   or defaulted value — is stated there and never restated here. A refused payload becomes an
 *   `invalid` outcome whose messages are keyed by field path, and no request is sent at all.
 * - **The request envelope.** Exactly `{ operationId, scope, expectedRevision, payload }` is posted to
 *   the relative `/api/support/goal`, with `credentials: "same-origin"` so the development-session
 *   cookie travels. The payload is the schema's parsed value rather than the typed text, because the
 *   service accepts the amount as exact minor units beside its currency; converting it anywhere else
 *   would hide the refusal the worker needs to read.
 * - **One attempt identity per intent.** The identity is the whole recovery mechanism: replaying it
 *   answers `alreadyAccepted` with the stored result and applies no second save, while a fresh id for
 *   a retry would turn a lost acknowledgement into a second effect. It is reused while the intent
 *   (scope, expected revision, payload) is unchanged and minted the moment the intent genuinely
 *   changes, keyed by {@link intentKeyOf} — never by a clock and never by a random value derived from
 *   the payload. An identity the caller supplies is used unchanged: the shared review step
 *   `useReviewedMutation` is the application's single decider of an attempt's identity, and a second
 *   owner of that rule would let the two disagree about what one intent is.
 * - **The refresh that follows acceptance.** An accepted or already-accepted save invalidates the
 *   current scope's `goal`, `overview` and `report` reads and nothing else: one number changed, so the
 *   gift ledger, the commitments and every other partner have nothing to refetch. The other six
 *   outcomes invalidate nothing, because a conflict, a refusal, a validation failure or an outage
 *   changed no record. Clearing the query cache belongs to the context fence in
 *   `@/components/context-switch-guard`, so a mutation never clears it.
 *
 * What it deliberately does not do. It posts, corrects, refunds and infers no money; it touches no
 * gift, commitment, report row or public progress; it computes no percentage and settles no
 * permission question (`canEditGoal` travels on the read envelope and the service re-checks it on
 * submit, so a stale envelope can produce a `denied` but never an unauthorised save); it renders no
 * receipt and no toast, because the caller composes the shared review step and the durable
 * `operation-result` that say what happened. A throw is a defect rather than a presentation (AAP
 * 0.15.1): both the request and the body read are guarded, so a transport failure or a body that is
 * not one of the eight outcomes resolves with the union's own `unknown` member carrying this
 * attempt's `operationId` — the token the same submission replays, so the receipt offers its
 * check-the-result recovery, and never a success, a failure or a resend.
 *
 * Rule 1 obligations this file keeps. *Clause 1 (preserve the agreed scope):* one mutation, with no
 * financial administration, second goal or provider path beside it. *Clause 2 (reuse the patterns):*
 * the four-field input and the outcome union come from the data-service contracts, the payload schema
 * from the family's `schemas.ts`, and the review step and receipt from the shared components, with no
 * second wrapper, validation vocabulary or receipt. *Clause 3 (preserve meaning):* `accepted` and
 * `alreadyAccepted` stay distinguishable, a replay creates no new revision, a `conflict` preserves the
 * caller's input for comparison, a `denied` reveals nothing, `unavailable` is never a zero, and
 * uncertainty is recovered by its `operationId` rather than resent.
 */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";
import type { input as SchemaInput } from "zod";

import { scopeKey } from "@/components/context-switch-guard";
import { newOperationId } from "@/lib/ids";
import type { MutationInput, Scope } from "@/modules/data-service/envelope";
import {
  invalid,
  isOutcome,
  unknown as unknownOutcome,
  type MutationOutcome,
} from "@/modules/data-service/outcome";

import { goalSavePayloadSchema, type GoalSavePayload } from "../schemas";

/** The one path a goal save is posted to: a relative URL, so the request stays inside this origin. */
const SAVE_GOAL_PATH = "/api/support/goal";

/**
 * The cached reads an accepted save can make stale, named as the job segment of their query keys.
 *
 * `scopeKey(scope)` leads every key and the job follows it, so these three prefixes cover the goal the
 * worker just set, the overview that summarises it and the report that measures progress against it —
 * at every set of parameters. Nothing else is refreshed, because a goal save changes one target.
 */
const REFRESHED_JOBS = ["goal", "overview", "report"] as const;

/**
 * The payload a caller submits: the goal form's own values, before the amount becomes money.
 *
 * It is the schema's input type rather than a second declaration, so a field added to, tightened in or
 * removed from `goalSavePayloadSchema` changes this type with it. The amount is the text the worker
 * typed, because the exponent that decides how many decimals it may have comes from the currency
 * beside it, and that conversion is the schema's job.
 */
export type GoalSaveFormPayload = SchemaInput<typeof goalSavePayloadSchema>;

/**
 * Everything one save presents, which is the mutation input with the payload in its form-shaped form
 * and the attempt identity optional because this hook can mint it.
 *
 * `expectedRevision` is the revision of the goal envelope the caller read. It is never fabricated, never
 * omitted and never refreshed silently after a `conflict`: re-applying against the value the conflict
 * reported is the caller's decision, and it is a new intent with a new identity.
 */
export interface SaveGoalVariables {
  /** The exact authority the caller believes it is acting in; the service verifies it. */
  readonly scope: Scope;
  /** The revision of the goal the caller saw, presented so a stale save conflicts rather than wins. */
  readonly expectedRevision: string;
  /** The goal form's values, checked by `goalSavePayloadSchema` before the request is built. */
  readonly payload: GoalSaveFormPayload;
  /** The attempt identity the caller owns, when the shared review step supplies one. */
  readonly operationId?: string;
}

/** One attempt identity, held with the intent it belongs to so a changed intent cannot reuse it. */
interface AttemptIdentity {
  /** The deterministic key of the intent this identity was minted for. */
  readonly key: string;
  /** The canonical lowercase UUID v4 the request carries, and the handle a replay is recognised by. */
  readonly operationId: string;
}

/**
 * Renders a value as canonical text, so two intents can be compared for meaning rather than for key
 * order.
 *
 * Object members are visited in sorted key order and arrays keep their order, so the same intent always
 * yields the same text and a genuinely different one cannot collide with it. Nothing here reads a
 * clock, sorts with a locale comparison or hashes: a deterministic rendering of the values themselves
 * is what the identity decision needs.
 */
function canonicalIntent(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const members = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalIntent((value as Record<string, unknown>)[key])}`,
      );
    return `{${members.join(",")}}`;
  }

  const primitive = JSON.stringify(value);
  return primitive === undefined ? "null" : primitive;
}

/**
 * The deterministic key of one intent: what is being changed, against which revision, in which
 * context.
 *
 * All of it is part of the intent, because a save aimed at another ministry, built on another revision
 * or carrying another amount is a different attempt at a different effect. Changing any of them must
 * therefore mint a new identity rather than replay an id that already means something else — which the
 * service would answer as a changed-intent `conflict`.
 */
function intentKeyOf(scope: Scope, expectedRevision: string, payload: GoalSaveFormPayload): string {
  return canonicalIntent({ payload, expectedRevision, scope });
}

/**
 * The identity the next attempt carries: the caller's when it supplied one, otherwise the identity
 * already minted for this intent, otherwise a new one.
 *
 * A supplied identity wins outright because the shared review step minted it for exactly this intent
 * and a second owner of the rule would be one too many. A retry of the same intent deliberately lands
 * on the same id, which is what makes the service answer `alreadyAccepted` instead of saving twice. An
 * empty string is treated as no identity at all: it cannot name an attempt, so replaying it could never
 * recover one, and sending it would turn a caller's slip into a field error about an opaque id.
 */
function attemptFor(
  current: AttemptIdentity | null,
  key: string,
  supplied: string | undefined,
): AttemptIdentity {
  if (supplied !== undefined && supplied.length > 0) {
    return { key, operationId: supplied };
  }

  if (current !== null && current.key === key) {
    return current;
  }

  return { key, operationId: newOperationId() };
}

/**
 * Posts one `saveGoal` intent and answers with exactly one outcome — `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 *
 * The outcome is returned as the service built it and is never translated: `accepted` and
 * `alreadyAccepted` say different things about when the save happened, `unchanged` says nothing
 * happened, `conflict` carries the value the caller's input collided with, `denied` carries a reason
 * code and no record, `invalid` carries per-field messages, `unavailable` names a source that is down,
 * and `unknown` claims neither success nor failure. The caller renders that outcome in the shared
 * receipt and decides whether re-applying a conflict is what it wants.
 */
export function useSaveGoal(): UseMutationResult<MutationOutcome, Error, SaveGoalVariables> {
  const queryClient = useQueryClient();

  /* The identity lives in a ref, not in state: it is read and written inside the submission rather than
   * rendered, and a re-render between a failed attempt and its retry must not lose it. Its key is what
   * ties it to one intent, so a changed form value gets a fresh id instead of replaying the old one. */
  const attempt = useRef<AttemptIdentity | null>(null);

  return useMutation<MutationOutcome, Error, SaveGoalVariables>({
    mutationFn: async (variables: SaveGoalVariables): Promise<MutationOutcome> => {
      const identity = attemptFor(
        attempt.current,
        intentKeyOf(variables.scope, variables.expectedRevision, variables.payload),
        variables.operationId,
      );
      attempt.current = identity;

      /* Validation comes before the request, not after the service's answer: a refused amount must cost
       * the worker nothing but the message on the field, and must never become a round trip that could
       * have had an effect. The schema's own error is handed to the outcome constructor, which keys each
       * message by the field path the form renders it beside. */
      const checked = goalSavePayloadSchema.safeParse(variables.payload);
      if (!checked.success) {
        return invalid({ operationId: identity.operationId, fields: checked.error });
      }

      const input: MutationInput<GoalSavePayload> = {
        operationId: identity.operationId,
        scope: variables.scope,
        expectedRevision: variables.expectedRevision,
        payload: checked.data,
      };

      let response: Response;
      try {
        response = await fetch(SAVE_GOAL_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(input),
        });
      } catch {
        return unknownOutcome({ operationId: identity.operationId });
      }

      /* The status is not the answer: `denied` is a 403 and `unknown` a 202, and neither is a failure of
       * the transport. The body is the outcome, so a body that cannot be read as one leaves the effect's
       * fate genuinely unknown — answered with the union's `unknown` member and this attempt's
       * `operationId`, never a second save and never a quietly assumed success. */
      const answered: unknown = await response.json().catch(() => undefined);
      if (!isOutcome(answered)) {
        return unknownOutcome({ operationId: identity.operationId });
      }

      return answered;
    },
    onSuccess: async (outcome: MutationOutcome, variables: SaveGoalVariables): Promise<void> => {
      if (outcome.outcome !== "accepted" && outcome.outcome !== "alreadyAccepted") {
        return;
      }

      const scope = scopeKey(variables.scope);
      await Promise.all(
        REFRESHED_JOBS.map((job) => queryClient.invalidateQueries({ queryKey: [...scope, job] })),
      );
    },
  });
}
