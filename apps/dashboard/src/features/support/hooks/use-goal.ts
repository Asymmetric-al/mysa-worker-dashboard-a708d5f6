"use client";

/**
 * Reads the support goal in the browser through `reads.support.readGoal`, whose outcome set is
 * `envelope | denied | unavailable`, and hands the envelope on unchanged.
 *
 * What this hook is for, and what it is not. The goal panel needs one envelope — the goal, the
 * resolved `canEditGoal` capability, the progress state and the reason when no percentage exists —
 * and this file is the only place that asks the service for it. It computes nothing: the percentage,
 * its basis points, whether a denominator can carry one, whether the goal is editable and how an
 * amount reads are all decided in `modules/support/goal` and recorded in the envelope's `data` and
 * `valueStates` (AAP 0.8.1). A hook that divided a numerator by a denominator would be a second
 * implementation of the goal module's own progress rule, and on a zero baseline it would render an
 * invented figure where the envelope says no percentage can be formed, with its reason.
 *
 * The key is a cache contract, not a private detail. `goalQueryKey(scope)` is
 * `["scope", organizationId, ministryId, supportSubjectId, "goal"]` — `scopeKey`'s segments followed
 * by the job segment — so the sibling save hook invalidates this entry by prefix after an `accepted`
 * or `alreadyAccepted` save and the panel shows the new revision without a manual refresh. Renaming
 * the job segment here silently breaks that refresh, which is why it is exported rather than spelled
 * out at both ends.
 *
 * The wire form, and why the transport looks the way it does. `toResponse` in
 * `modules/data-service/outcome` flattens a read result: 200 carries the envelope itself, 403 the
 * denial outcome and 503 the outage. So this transport reads the status first, re-wraps the 200 body
 * as the envelope it is, and rejects the other two. A denial or an outage is a contract answer, but it
 * is not a goal: turning either into an envelope with `goal: null` would present "you may not read
 * this" or "the source is down" as "no goal has been set", which is the one confusion the goal read
 * exists to prevent. The rejection is a plain `Error` naming the endpoint, which is what the caller
 * renders as `state-notice kind="unavailable"`; nothing here waits on a denial, and nothing logs one.
 *
 * Initial data, and the clock. AAP 0.7.2 (assumption A12) makes the scenario instant a domain input:
 * the envelope's `asOf` says when the read was evaluated, and `initialDataUpdatedAt` is that instant.
 * Nothing here reads the browser clock, because the browser's clock is not the scenario clock — the
 * seeded instant deliberately precedes it. `refetchOnMount: false` follows from the same fact: the
 * server already read this envelope for the page being hydrated, so the first mount shows exactly what
 * the server rendered instead of asking again because a wall-clock staleness test says the seeded
 * instant is old. A save invalidates the key by prefix, which refetches the active panel normally.
 *
 * Parameters. `reads.support.readGoal` accepts a support query, and this hook sends none of it. A goal
 * is measured over the read's own default period (year to date) in the goal's own currency, while the
 * rest of `SupportQuery` describes a gift ledger — an amount range inside one currency, a designation,
 * a partner, a search term, a sort, a page window — and none of those selects a single goal figure.
 * The transport's query-string vocabulary belongs to the `/api/support/goal` handler; inventing a
 * spelling here would be a second statement of it, and one the handler could silently ignore while the
 * envelope still looked filtered.
 *
 * Imports are type-only where they could reach server code: `outcome.ts` imports `next/server` for its
 * response mapping, so the contract types come across as types and the parsed body is narrowed with the
 * framework-free guards in `lib/guards`. The envelope's shape is taken from the service itself, so a
 * member renamed or withdrawn in `reads.support.readGoal` stops this file compiling rather than letting
 * a copy of the vocabulary drift.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { scopeKey, type ScopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import type { reads } from "@/modules/data-service";
import type { Scope } from "@/modules/data-service/envelope";

/** The cache job segment of the goal read: the contract the save hook invalidates by prefix. */
const GOAL_QUERY_JOB = "goal";

/** The one browser endpoint that answers with the goal envelope, relative so the session cookie travels. */
const GOAL_ENDPOINT = "/api/support/goal";

/**
 * How long an envelope counts as fresh for a second surface asking the same question.
 *
 * Short on purpose: the envelope carries a scenario snapshot, not a live figure, and every save
 * invalidates the key outright. The span exists so a re-mount beside an already-read panel does not
 * ask the service again for an answer it holds.
 */
const GOAL_STALE_TIME_MS = 30_000;

/**
 * The whole answer `reads.support.readGoal` gives, taken from the service so the shape cannot drift
 * from it — the reads are grouped by the job a caller is doing, and the goal belongs to support.
 */
export type GoalReadResult = Awaited<ReturnType<typeof reads.support.readGoal>>;

/** The envelope a goal read answers with: what the hook's `data` is, and what the panel renders. */
export type GoalEnvelope = Extract<GoalReadResult, { kind: "envelope" }>["envelope"];

/** The exact cache key of the goal read in one context. */
export type GoalQueryKey = readonly [...ScopeKey, typeof GOAL_QUERY_JOB];

/** What the goal read is asked for: the context it runs in, and the envelope a server read supplied. */
export interface UseGoalOptions {
  /** The context the goal is read in; its three scope segments lead the cache key. */
  readonly scope: Scope;
  /**
   * The envelope a Server Component already read for this page. Passed as `initialData`, so the panel's
   * first render is the server's own answer and no second request is made for it.
   */
  readonly initialEnvelope?: GoalEnvelope;
}

/** The one query this hook returns: the envelope, or the pending and error states TanStack owns. */
export type UseGoalResult = UseQueryResult<GoalEnvelope, Error>;

/**
 * The cache key of the goal read for a context: `scopeKey`'s segments and the job segment, in the one
 * order every key in this application uses.
 *
 * Exported so the save hook invalidates the same entry by prefix instead of repeating the literal, and
 * so a caller can read or seed this entry without a second spelling of the key.
 */
export function goalQueryKey(scope: Scope): GoalQueryKey {
  return [...scopeKey(scope), GOAL_QUERY_JOB];
}

/**
 * Reports whether a parsed response body is the envelope the goal read returns.
 *
 * The status already says which arm answered, so this guard checks one thing more: that the body is a
 * whole envelope rather than a truncated one. A body missing `data`, `valueStates` or `revision` would
 * otherwise be rendered as a goal with nothing in it, which is the reading the envelope exists to
 * prevent. What is inside `data` is the read's own projection and is rendered as given — checking it
 * member by member here would be a second copy of `GoalData`.
 */
function isGoalEnvelopeBody(value: unknown): value is GoalEnvelope {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    isRecord(value.scope) &&
    isRecord(value.source) &&
    isNonEmptyString(value.revision) &&
    isNonEmptyString(value.asOf) &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions)
  );
}

/**
 * Asks the goal read for its envelope, or rejects when no envelope is the answer.
 *
 * Three rejections, each naming the endpoint so a developer reading the error knows what failed: the
 * request could not be made, the answer was not an envelope (a denial or an outage, which are answers
 * about this caller or this source and never about a goal), and the body could not be read as the
 * envelope it claims to be. None of them is turned into an envelope, a zero or an empty goal.
 */
async function readGoalEnvelope(): Promise<GoalEnvelope> {
  let response: Response;
  try {
    response = await fetch(GOAL_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} could not be completed.`, { cause });
  }

  if (!response.ok) {
    throw new Error(
      `GET ${GOAL_ENDPOINT} did not answer with a goal envelope (status ${response.status}).`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`GET ${GOAL_ENDPOINT} answered with a body that is not JSON.`, { cause });
  }

  if (!isGoalEnvelopeBody(body)) {
    throw new Error(`GET ${GOAL_ENDPOINT} answered without the envelope its read returns.`);
  }

  return body;
}

/**
 * The goal envelope as a query result for one context, seeded by the envelope a server read supplied.
 *
 * The result is returned exactly as TanStack Query produced it: no `select`, no reshaped `data`, no
 * derived percentage and no editability inference. `data` is the envelope the service built, and the
 * panel reads the goal, the capability, the progress state and every value state from it.
 */
export function useGoal({ scope, initialEnvelope }: UseGoalOptions): UseGoalResult {
  const asOfInstant = initialEnvelope === undefined ? undefined : Date.parse(initialEnvelope.asOf);
  const initialDataUpdatedAt =
    asOfInstant === undefined || Number.isNaN(asOfInstant) ? undefined : asOfInstant;

  return useQuery({
    queryKey: goalQueryKey(scope),
    queryFn: readGoalEnvelope,
    staleTime: GOAL_STALE_TIME_MS,
    refetchOnMount: false,
    initialData: initialEnvelope,
    initialDataUpdatedAt,
  });
}
