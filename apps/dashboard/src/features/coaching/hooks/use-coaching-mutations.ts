"use client";

/**
 * The Coaching family's mutation transport: the sixteen TanStack Query mutations that submit the family's sixteen named
 * service mutations through the routes under `src/app/api/coaching` and hand each handler's outcome back untouched.
 *
 * Scope: AAP 0.11.1's `apps/dashboard/src/features/coaching/**` row (the hooks for the six reads and sixteen
 * mutations); AAP 0.7.1's coaching inventory — `inviteCoach`, `acceptInvitation`, `revokeGrant`, `endCoaching`,
 * `leaveCoaching`, `setModule`, `saveTarget`, `editTarget`, `pauseTarget`, `endTarget`, `saveCheckIn`, `shareCheckIn`,
 * `updateSharedCheckIn`, `withdrawCheckIn`, `shareTaskSummary`, `stopTaskShare`; AAP 0.7.1's four-field mutation input,
 * closed eight-outcome set and operation-ledger replay rule; AAP 0.6.3's POST handler set; AAP 0.15.1's error model;
 * AAP 0.8.4's coaching rules; and criteria 10, 11 and 16.
 *
 * What every request carries is exactly four fields — `{ operationId, scope, expectedRevision, payload }` — and nothing
 * else (AAP 0.7.1). Where the handler on the other side selects a mutation by name, the name travels as
 * `payload.operation`, in the camelCase the service spells it in: that member is how five handlers dispatch one request
 * to one named mutation without a universal dispatcher, and each handler removes it before the service's own strict
 * payload schema sees it. `inviteCoach` and `setModule` have a path to themselves and send no such member, because their
 * payload schemas admit only their own fields.
 *
 * The outcome is returned as the handler produced it. `accepted` and `alreadyAccepted` are the only two that mean an
 * effect exists, and so the only two that refresh anything: the family's queries, and — because the sharing, check-in
 * and target surfaces are handed a server-read envelope rather than mounting a query of their own — the route's own read
 * as well. `conflict` stays with the caller's preserved input so a surface can show it beside the current value; `denied`
 * reveals nothing about a record the caller may not see; `unavailable` is never rendered as zero or as an empty list; and
 * `unknown` is never treated as success, never turned into a toast and never re-sent under a fresh identity — the
 * attempt's `operationId` is the way back to whatever the first attempt produced. A transport fault is answered as
 * `unknown` for that same reason: an effect that may have happened is neither a success nor a refusal, and inventing
 * either would break what `components/operation-result.tsx` is allowed to say.
 *
 * One intent, one identity. An `operationId` is minted when an intent begins, the same id answers every retry of that
 * intent, and a changed intent is a new attempt — reusing an id with changed intent is a `conflict` by contract.
 * `components/action-review.tsx`'s `useReviewedMutation` already mints one id per intent and supplies it; when it does,
 * it is used verbatim and nothing is minted here, so one intent never acquires two identities.
 *
 * The coach identity holds exactly two writes in this release — `useAcceptInvitation` and `useLeaveCoaching`. Every other
 * hook here names a worker-side job, and none of them edits, comments on, assigns, reminds about, completes, reopens,
 * exports or impersonates anything: a coach's access is read-only (AAP 0.8.4).
 */
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";
import { scopeKey } from "@/components/context-switch-guard";
import { newOperationId } from "@/lib/ids";
import { assertNever } from "@/lib/result";
// Types come from the service barrel; the outcome contract's values come from the module that implements it. The barrel
// itself is imported type-only, because its runtime exports reach the store and `node:fs` and a browser transport that
// imported one of them would pull the store into the client bundle. `invalid`, `unknown` and `isOutcome` are taken from
// `@/modules/data-service/outcome` rather than restated here: the eight outcomes and the field-message rule that keys a
// refusal have one implementation, and a second copy in this file would drift from the service that answers with it.
import type { MutationInput, Scope } from "@/modules/data-service";
import { invalid, isOutcome, unknown as unknownOutcome, type MutationOutcome } from "@/modules/data-service/outcome";
import { acceptancePayloadSchema, invitationPayloadSchema, type AcceptancePayload, type InvitationPayload } from "../schemas/invitation";
import { moduleChangePayloadSchema, type ModuleChangePayload } from "../schemas/module";
import { endCoachingPayloadSchema, leaveCoachingPayloadSchema, revokeGrantPayloadSchema, type EndCoachingPayload, type LeaveCoachingPayload, type RevokeGrantPayload } from "../schemas/stop";
import { targetEditPayloadSchema, targetEndPayloadSchema, targetPausePayloadSchema, targetSavePayloadSchema, type TargetEditPayload, type TargetEndPayload, type TargetPausePayload, type TargetSavePayload } from "../schemas/target";
import { saveCheckInPayloadSchema, shareCheckInPayloadSchema, updateSharedCheckInPayloadSchema, withdrawCheckInPayloadSchema, type CheckInSavePayload, type CheckInSharePayload, type CheckInUpdateSharedPayload, type CheckInWithdrawPayload } from "../schemas/checkin";
import { taskSharePayloadSchema, taskShareStopPayloadSchema, type TaskSharePayload, type TaskShareStopPayload } from "../schemas/taskshare";
import { COACHING_JOB_KEYS } from "./use-coaching-reads";

// ---------------------------------------------------------------------------------------------
// The six paths, exactly as AAP 0.6.3 and the handlers name them
// ---------------------------------------------------------------------------------------------

/** `POST /api/coaching` — the one invitation this path issues; its `GET` is the overview read. */
const INVITATION_PATH = "/api/coaching";

/** `POST /api/coaching/grants` — acceptance, revocation, ending and leaving, selected by `payload.operation`. */
const GRANTS_PATH = "/api/coaching/grants";

/** `POST /api/coaching/modules` — one module switched on or off; this path has a mutation to itself and sends no selector. */
const MODULES_PATH = "/api/coaching/modules";

/** `POST /api/coaching/targets` — the four named target changes, selected by `payload.operation`. */
const TARGETS_PATH = "/api/coaching/targets";

/** `POST /api/coaching/checkins` — the four named check-in changes, selected by `payload.operation`. */
const CHECK_INS_PATH = "/api/coaching/checkins";

/** `POST /api/coaching/taskshare` — the two named task-summary changes, selected by `payload.operation`. */
const TASK_SHARES_PATH = "/api/coaching/taskshare";

// ---------------------------------------------------------------------------------------------
// What one attempt is, and the identity it carries
// ---------------------------------------------------------------------------------------------

/** The variables one hook accepts: the context the caller believes it acts in, the revision it read, its payload, and — when `useReviewedMutation` already holds it — the identity of the attempt. */
type Attempt<Payload> = { readonly scope: Scope; readonly expectedRevision: string; readonly payload: Payload; readonly operationId?: string };

/** One mutation's payload as the wire states it: the mutation's own fields plus the member that names the mutation, where its handler reads one. */
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };

/**
 * A value as a canonical string: object members in sorted order, arrays in their own order, and everything else as JSON.
 * Two payloads that differ only in the order their keys were written answer the same string, so re-submitting the same
 * work is recognised as the same intent rather than as a new one.
 */
function canonicalIntent(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalIntent(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalIntent(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * The stable fingerprint of one intent, for this module's own bookkeeping only. It is never sent, and it is not the
 * server's `intentHash` (that is the ledger's SHA-256 over the scope, the expected revision and the payload inside
 * `operations.ts`); this one only decides whether the attempt in flight is the same piece of work as the last one.
 * The scope is part of it because the same payload in another context is a different intent: an id carried across a
 * context switch would be answering for work the caller never asked for in that context.
 */
function intentKeyOf(name: string, scope: Scope, expectedRevision: string, payload: unknown): string {
  return [name, scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId, expectedRevision, canonicalIntent(payload)].join("|");
}

/**
 * The identity the attempt must carry, given the one already held and the intent submitted now.
 *
 * A supplied id — the `action-review` path, which mints one per reviewed intent — is returned verbatim and leaves the
 * held identity alone: the caller owns it, and it is already reused for a retry of that same intent. Otherwise the
 * held id answers a repeated intent, so a retry of the same work reaches the ledger as a replay and recovers the
 * original result instead of applying the effect twice; and a changed intent mints a new id, because the same id with
 * changed intent is a `conflict` by contract. One slot is therefore enough: an intent that is no longer being submitted
 * has no retry left to protect.
 */
function useOperationIdentity(): (name: string, scope: Scope, expectedRevision: string, payload: unknown, supplied?: string) => string {
  const held = useRef<{ readonly intent: string; readonly operationId: string } | null>(null);
  return (name, scope, expectedRevision, payload, supplied) => {
    if (supplied !== undefined && supplied.length > 0) return supplied;
    const intent = intentKeyOf(name, scope, expectedRevision, payload);
    const current = held.current;
    if (current !== null && current.intent === intent) return current.operationId;
    const operationId = newOperationId();
    held.current = { intent, operationId };
    return operationId;
  };
}

/**
 * What a settled outcome means for the reads beside the record it names: the one implementation of that rule.
 *
 * Only `accepted` and `alreadyAccepted` refresh anything, because those are the two outcomes that testify an effect
 * exists. `unchanged` answers from the state already on screen; `conflict`, `denied`, `invalid` and `unavailable`
 * changed nothing this family reads; and `unknown` must refresh nothing at all, because a refetch is not a substitute
 * for checking what the attempt did — recovery is the same `operationId`, and a client that quietly refetched would be
 * telling the worker the outcome had settled. Awaiting the refreshes keeps the mutation pending until the reads settle,
 * so a caller that awaits `mutateAsync` can read the new state immediately afterwards.
 *
 * The job keys alone cannot reach most of what a coaching change alters. `/coaching/sharing`, `/coaching/check-ins` and
 * `/coaching/targets` server-read their envelopes and hand them down, so the sharing summary, the five module toggles,
 * the stop controls and the grant they name, and the check-in editor's state are props rather than cached reads — no
 * key here matches a query those surfaces mount, and a revoked grant, a stopped module or a withdrawn check-in would
 * stay on screen as the state it replaced while the receipt beside it said the change was applied. Asking the route for
 * its own read again is what makes those the service's current answer; it replaces the server payload without
 * remounting these components, so the attempt's receipt — the one durable proof of what happened — stays on screen
 * beside the state it produced.
 */
function useCoachingInvalidation(): (outcome: MutationOutcome, scope: Scope, jobs: readonly string[]) => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async (outcome, scope, jobs) => {
    switch (outcome.outcome) {
      case "accepted":
      case "alreadyAccepted": {
        // Prefix invalidation follows the hierarchical key the family's reads use, so every params variant of each job
        // in this scope refreshes together.
        const context = scopeKey(scope);
        await Promise.all(jobs.map((job) => queryClient.invalidateQueries({ queryKey: [...context, job] })));
        router.refresh();
        return;
      }
      case "unchanged":
      case "conflict":
      case "denied":
      case "invalid":
      case "unavailable":
      case "unknown":
        return;
      default:
        // Unreachable: the eight members above are the closed set, so a ninth outcome fails to compile at this call
        // rather than arriving unhandled.
        return assertNever(outcome, "Unhandled coaching mutation outcome");
    }
  };
}

/**
 * Performs exactly one POST and answers what the handler said.
 *
 * The body is the contract, not the status: all eight outcomes — `denied` and `conflict` among them — travel through the
 * handler's one response mapper, so reading `response.ok` here would discard exactly the outcomes the caller has to
 * render. A request that never arrives, or an answer that is not one of the eight outcomes, is answered as `unknown`
 * carrying the caller's own `operationId`: the effect may or may not have been applied, so nothing here may claim it was
 * or was not, and the attempt's identity is what recovers it.
 */
async function postMutation<Payload>(path: string, body: MutationInput<Payload>): Promise<MutationOutcome> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // The development session is an httpOnly, sameSite=lax cookie, so the handler can derive scope only from a
      // same-origin request that carries it.
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return unknownOutcome({ operationId: body.operationId });
  }
  const answered: unknown = await response.json().catch(() => undefined);
  if (!isOutcome(answered)) return unknownOutcome({ operationId: body.operationId });
  return answered;
}

// ---------------------------------------------------------------------------------------------
// The sixteen mutations, one named job apiece
//
// Every hook below has the same three properties, so they are stated once here rather than repeated
// sixteen times. Each one carries `retry: false`, because no mutation is retried on this module's
// initiative: a retry is the caller's deliberate act under the same operationId, and a retry under a
// fresh one would apply the same intent twice. Each names its attempt through `useOperationIdentity`
// before anything is validated, so a refused payload and an applied one are identified by the same
// rule. And each awaits its own invalidation, so a caller that awaits `mutateAsync` reads the
// refreshed state rather than racing the refetch.
// ---------------------------------------------------------------------------------------------

/** Issues one coaching invitation for a named coach, organization and ministry, with all five modules unselected and the duration it runs for (`inviteCoach`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useInviteCoach(): UseMutationResult<MutationOutcome, Error, Attempt<InvitationPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<InvitationPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("inviteCoach", scope, expectedRevision, payload, supplied);
      const parsed = invitationPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      // This path admits the invitation's own fields and nothing else, so the body carries no selector.
      const body = { operationId, scope, expectedRevision, payload: parsed.data } satisfies MutationInput<InvitationPayload>;
      return postMutation(INVITATION_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio]);
    },
  });
}

/** Records the named coach's deliberate acceptance of one invitation, freezing the share cutoff (`acceptInvitation`) — one of the coach identity's two writes; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useAcceptInvitation(): UseMutationResult<MutationOutcome, Error, Attempt<AcceptancePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<AcceptancePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("acceptInvitation", scope, expectedRevision, payload, supplied);
      const parsed = acceptancePayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "acceptInvitation" } } satisfies MutationInput<WirePayload<AcceptancePayload, "acceptInvitation">>;
      return postMutation(GRANTS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Revokes one coaching relationship and every module it admitted (`revokeGrant`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRevokeGrant(): UseMutationResult<MutationOutcome, Error, Attempt<RevokeGrantPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<RevokeGrantPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("revokeGrant", scope, expectedRevision, payload, supplied);
      const parsed = revokeGrantPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "revokeGrant" } } satisfies MutationInput<WirePayload<RevokeGrantPayload, "revokeGrant">>;
      return postMutation(GRANTS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      // The coach-subject keys are refreshed as well as the portfolio, so the ended state shows on the next read
      // instead of lingering from a cached envelope.
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Ends the coaching relationship as the worker, leaving the source work untouched (`endCoaching`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useEndCoaching(): UseMutationResult<MutationOutcome, Error, Attempt<EndCoachingPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<EndCoachingPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("endCoaching", scope, expectedRevision, payload, supplied);
      const parsed = endCoachingPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "endCoaching" } } satisfies MutationInput<WirePayload<EndCoachingPayload, "endCoaching">>;
      return postMutation(GRANTS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Records that the named coach left the relationship (`leaveCoaching`) — the second of the coach identity's two writes; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useLeaveCoaching(): UseMutationResult<MutationOutcome, Error, Attempt<LeaveCoachingPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<LeaveCoachingPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("leaveCoaching", scope, expectedRevision, payload, supplied);
      const parsed = leaveCoachingPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "leaveCoaching" } } satisfies MutationInput<WirePayload<LeaveCoachingPayload, "leaveCoaching">>;
      return postMutation(GRANTS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      // A coach who has left must not keep reading from a cached subject envelope: both coach keys are refreshed.
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Switches one of the five disclosure modules on or off for one relationship (`setModule`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSetModule(): UseMutationResult<MutationOutcome, Error, Attempt<ModuleChangePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<ModuleChangePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("setModule", scope, expectedRevision, payload, supplied);
      const parsed = moduleChangePayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      // This path carries one mutation and forwards its payload as it arrives, so a selector member would reach the
      // service's own payload schema as a field the change does not accept.
      const body = { operationId, scope, expectedRevision, payload: parsed.data } satisfies MutationInput<ModuleChangePayload>;
      return postMutation(MODULES_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Creates one target over a canonical measure and a Weekly, Monthly or one-off Custom period (`saveTarget`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveTarget(): UseMutationResult<MutationOutcome, Error, Attempt<TargetSavePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TargetSavePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("saveTarget", scope, expectedRevision, payload, supplied);
      const parsed = targetSavePayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "saveTarget" } } satisfies MutationInput<WirePayload<TargetSavePayload, "saveTarget">>;
      return postMutation(TARGETS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.targets, COACHING_JOB_KEYS.overview]);
    },
  });
}

/** Changes a target's quantity, measure or calendar as a new prospective version, leaving closed periods with the version they were measured against (`editTarget`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useEditTarget(): UseMutationResult<MutationOutcome, Error, Attempt<TargetEditPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TargetEditPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("editTarget", scope, expectedRevision, payload, supplied);
      const parsed = targetEditPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "editTarget" } } satisfies MutationInput<WirePayload<TargetEditPayload, "editTarget">>;
      return postMutation(TARGETS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.targets, COACHING_JOB_KEYS.overview]);
    },
  });
}

/** Pauses one target so it stops admitting recorded progress (`pauseTarget`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function usePauseTarget(): UseMutationResult<MutationOutcome, Error, Attempt<TargetPausePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TargetPausePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("pauseTarget", scope, expectedRevision, payload, supplied);
      const parsed = targetPausePayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "pauseTarget" } } satisfies MutationInput<WirePayload<TargetPausePayload, "pauseTarget">>;
      return postMutation(TARGETS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.targets, COACHING_JOB_KEYS.overview]);
    },
  });
}

/** Ends one target, keeping its history and the versions its closed periods were measured against (`endTarget`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useEndTarget(): UseMutationResult<MutationOutcome, Error, Attempt<TargetEndPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TargetEndPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("endTarget", scope, expectedRevision, payload, supplied);
      const parsed = targetEndPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "endTarget" } } satisfies MutationInput<WirePayload<TargetEndPayload, "endTarget">>;
      return postMutation(TARGETS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.targets, COACHING_JOB_KEYS.overview]);
    },
  });
}

/** Saves the worker's private check-in autosave, with the question set it was written against and the answers in question order (`saveCheckIn`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveCheckIn(): UseMutationResult<MutationOutcome, Error, Attempt<CheckInSavePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<CheckInSavePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("saveCheckIn", scope, expectedRevision, payload, supplied);
      // The four check-in limits are the check-in module's own (`../schemas/checkin`), judged here before a round trip;
      // nothing is truncated and nothing is padded, so a payload over a limit is refused with the measure it exceeded.
      const parsed = saveCheckInPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "saveCheckIn" } } satisfies MutationInput<WirePayload<CheckInSavePayload, "saveCheckIn">>;
      return postMutation(CHECK_INS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      // A private autosave reaches no coach, so only the worker's own check-ins are refreshed: no coach key is touched.
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.checkIns]);
    },
  });
}

/** Shares one check-in as a revision a named coach may read (`shareCheckIn`) — the one act that discloses it; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useShareCheckIn(): UseMutationResult<MutationOutcome, Error, Attempt<CheckInSharePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<CheckInSharePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("shareCheckIn", scope, expectedRevision, payload, supplied);
      const parsed = shareCheckInPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "shareCheckIn" } } satisfies MutationInput<WirePayload<CheckInSharePayload, "shareCheckIn">>;
      return postMutation(CHECK_INS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      // Sharing is a disclosure, so the coach's subject read is refreshed as well as the worker's own list.
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.checkIns, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Changes a revision the coach has already read (`updateSharedCheckIn`) — the only change that reaches a shared check-in; answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useUpdateSharedCheckIn(): UseMutationResult<MutationOutcome, Error, Attempt<CheckInUpdateSharedPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<CheckInUpdateSharedPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("updateSharedCheckIn", scope, expectedRevision, payload, supplied);
      const parsed = updateSharedCheckInPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "updateSharedCheckIn" } } satisfies MutationInput<WirePayload<CheckInUpdateSharedPayload, "updateSharedCheckIn">>;
      return postMutation(CHECK_INS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.checkIns, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Withdraws a shared check-in revision, ending the coach's access to it (`withdrawCheckIn`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useWithdrawCheckIn(): UseMutationResult<MutationOutcome, Error, Attempt<CheckInWithdrawPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<CheckInWithdrawPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("withdrawCheckIn", scope, expectedRevision, payload, supplied);
      const parsed = withdrawCheckInPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "withdrawCheckIn" } } satisfies MutationInput<WirePayload<CheckInWithdrawPayload, "withdrawCheckIn">>;
      return postMutation(CHECK_INS_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      // Withdrawal must take effect on the coach's very next read, so the subject key is refreshed with the list.
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.checkIns, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Shares one selected task summary under a reviewed safe description of at most 240 code points (`shareTaskSummary`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useShareTaskSummary(): UseMutationResult<MutationOutcome, Error, Attempt<TaskSharePayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TaskSharePayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("shareTaskSummary", scope, expectedRevision, payload, supplied);
      const parsed = taskSharePayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "shareTaskSummary" } } satisfies MutationInput<WirePayload<TaskSharePayload, "shareTaskSummary">>;
      return postMutation(TASK_SHARES_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.taskShares, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}

/** Stops sharing one task summary, leaving the task itself intact (`stopTaskShare`); answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useStopTaskShare(): UseMutationResult<MutationOutcome, Error, Attempt<TaskShareStopPayload>> {
  const operationIdFor = useOperationIdentity();
  const invalidate = useCoachingInvalidation();
  return useMutation({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<TaskShareStopPayload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor("stopTaskShare", scope, expectedRevision, payload, supplied);
      const parsed = taskShareStopPayloadSchema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const body = { operationId, scope, expectedRevision, payload: { ...parsed.data, operation: "stopTaskShare" } } satisfies MutationInput<WirePayload<TaskShareStopPayload, "stopTaskShare">>;
      return postMutation(TASK_SHARES_PATH, body);
    },
    onSuccess: async (outcome, { scope }) => {
      await invalidate(outcome, scope, [COACHING_JOB_KEYS.taskShares, COACHING_JOB_KEYS.coachSubject]);
    },
  });
}
