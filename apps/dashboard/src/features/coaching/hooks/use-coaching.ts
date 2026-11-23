"use client";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { fetchRead, refreshJobs, sendMutation, useAttemptIdentity } from "@/lib/read-transport";
import type { ReadEnvelope, ReadResult, Scope, reads } from "@/modules/data-service";
import { invalid, type MutationOutcome } from "@/modules/data-service/outcome";
import * as coachingSchemas from "../schemas";
export const COACHING_JOB_KEYS = { overview: "coaching-overview", targets: "targets", checkIns: "check-ins", taskShares: "task-shares", coachPortfolio: "coach-portfolio", coachSubject: "coach-subject" } as const;
type DataOf<Result> = Result extends { readonly kind: "envelope"; readonly envelope: { readonly data: infer Data } } ? Data : never;
type CheckInsData = DataOf<Awaited<ReturnType<typeof reads.coaching.readCheckIns>>>;
type CoachPortfolioData = DataOf<Awaited<ReturnType<typeof reads.coach.readCoachPortfolio>>>;
type CheckInsQuery = NonNullable<Parameters<typeof reads.coaching.readCheckIns>[0]>;
function readUrl(endpoint: string, query: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, String(value)]),
  ).toString();
  return search === "" ? endpoint : `${endpoint}?${search}`;
}
type CoachingRead<Params> = { readonly job: string; readonly url: (params: Params) => string; readonly admits: (data: Record<string, unknown>) => boolean };
function useCoachingRead<Data, Params>(scope: Scope, read: CoachingRead<Params>, params: Params): UseQueryResult<ReadResult<ReadEnvelope<Data>>, Error> {
  const queryKey = params === undefined ? [...scopeKey(scope), read.job] : [...scopeKey(scope), read.job, params];
  return useQuery({ queryKey, queryFn: ({ signal }) => fetchRead<Data>({ url: read.url(params), admits: (data: unknown): boolean => isRecord(data) && read.admits(data), signal }), retry: false });
}
const CHECK_INS_READ: CoachingRead<CheckInsQuery> = { job: COACHING_JOB_KEYS.checkIns, url: (params) => readUrl("/api/coaching/checkins", params), admits: (data) => Array.isArray(data.checkIns) && isRecord(data.limits) && isRecord(data.page) };
const PORTFOLIO_READ: CoachingRead<undefined> = { job: COACHING_JOB_KEYS.coachPortfolio, url: () => readUrl("/api/coaching/subjects", { view: "portfolio" }), admits: (data) => Array.isArray(data.subjects) && typeof data.holdsNoSubjects === "boolean" };
export const useCheckIns = (scope: Scope, params: CheckInsQuery): UseQueryResult<ReadResult<ReadEnvelope<CheckInsData>>, Error> => useCoachingRead<CheckInsData, CheckInsQuery>(scope, CHECK_INS_READ, params);
export const useCoachPortfolio = (scope: Scope): UseQueryResult<ReadResult<ReadEnvelope<CoachPortfolioData>>, Error> => useCoachingRead<CoachPortfolioData, undefined>(scope, PORTFOLIO_READ, undefined);
type Attempt<Payload> = { readonly scope: Scope; readonly expectedRevision: string; readonly payload: Payload; readonly operationId?: string };
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
const COACHING_MUTATION_NAMES = ["inviteCoach", "acceptInvitation", "revokeGrant", "endCoaching", "leaveCoaching", "setModule", "saveTarget", "editTarget", "pauseTarget", "endTarget", "saveCheckIn", "shareCheckIn", "updateSharedCheckIn", "withdrawCheckIn", "shareTaskSummary", "stopTaskShare"] as const;
type CoachingMutationName = (typeof COACHING_MUTATION_NAMES)[number];
type CoachingMutationConfig<Payload> = { readonly name: CoachingMutationName; readonly path: string; readonly schema: ZodType<Payload>; readonly statesOperation: boolean; readonly jobs: readonly string[] };
function useCoachingMutation<Payload extends object>(config: CoachingMutationConfig<Payload>): UseMutationResult<MutationOutcome, Error, Attempt<Payload>> {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { operationIdFor } = useAttemptIdentity();
  const { name, path, schema, statesOperation, jobs } = config;
  return useMutation<MutationOutcome, Error, Attempt<Payload>>({
    retry: false,
    mutationFn: async ({ scope, expectedRevision, payload, operationId: supplied }: Attempt<Payload>): Promise<MutationOutcome> => {
      const operationId = operationIdFor(name, scope, expectedRevision, payload, supplied);
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return invalid({ operationId, fields: parsed.error });
      const stated: Payload = statesOperation ? { ...parsed.data, operation: name } : parsed.data;
      return sendMutation(path, { operationId, scope, expectedRevision, payload: stated }, OFFLINE_GUIDANCE);
    },
    onSuccess: async (outcome: MutationOutcome, { scope }: Attempt<Payload>): Promise<void> => {
      await refreshJobs(queryClient, outcome, scopeKey(scope), jobs);
      // The sharing, check-in and target surfaces are handed a server-read envelope rather than mounting a query of their own, so only the route re-reading itself keeps a revoked grant, a stopped module or a withdrawn check-in off the screen.
      if (outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted") router.refresh();
    },
  });
}
const GRANTS_JOBS = [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio, COACHING_JOB_KEYS.coachSubject];
const TARGET_JOBS = [COACHING_JOB_KEYS.targets, COACHING_JOB_KEYS.overview];
const CHECK_IN_SHARE_JOBS = [COACHING_JOB_KEYS.checkIns, COACHING_JOB_KEYS.coachSubject];
const TASK_SHARE_JOBS = [COACHING_JOB_KEYS.taskShares, COACHING_JOB_KEYS.coachSubject];
const INVITE_COACH: CoachingMutationConfig<coachingSchemas.InvitationPayload> = { name: "inviteCoach", path: "/api/coaching", schema: coachingSchemas.invitationPayloadSchema, statesOperation: false, jobs: [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachPortfolio] };
const ACCEPT_INVITATION: CoachingMutationConfig<coachingSchemas.AcceptancePayload> = { name: "acceptInvitation", path: "/api/coaching/grants", schema: coachingSchemas.acceptancePayloadSchema, statesOperation: true, jobs: GRANTS_JOBS };
const REVOKE_GRANT: CoachingMutationConfig<coachingSchemas.RevokeGrantPayload> = { name: "revokeGrant", path: "/api/coaching/grants", schema: coachingSchemas.revokeGrantPayloadSchema, statesOperation: true, jobs: GRANTS_JOBS };
const END_COACHING: CoachingMutationConfig<coachingSchemas.EndCoachingPayload> = { name: "endCoaching", path: "/api/coaching/grants", schema: coachingSchemas.endCoachingPayloadSchema, statesOperation: true, jobs: GRANTS_JOBS };
const LEAVE_COACHING: CoachingMutationConfig<coachingSchemas.LeaveCoachingPayload> = { name: "leaveCoaching", path: "/api/coaching/grants", schema: coachingSchemas.leaveCoachingPayloadSchema, statesOperation: true, jobs: GRANTS_JOBS };
const SET_MODULE: CoachingMutationConfig<coachingSchemas.ModuleChangePayload> = { name: "setModule", path: "/api/coaching/modules", schema: coachingSchemas.moduleChangePayloadSchema, statesOperation: false, jobs: [COACHING_JOB_KEYS.overview, COACHING_JOB_KEYS.coachSubject] };
const SAVE_TARGET: CoachingMutationConfig<coachingSchemas.TargetSavePayload> = { name: "saveTarget", path: "/api/coaching/targets", schema: coachingSchemas.targetSavePayloadSchema, statesOperation: true, jobs: TARGET_JOBS };
const EDIT_TARGET: CoachingMutationConfig<coachingSchemas.TargetEditPayload> = { name: "editTarget", path: "/api/coaching/targets", schema: coachingSchemas.targetEditPayloadSchema, statesOperation: true, jobs: TARGET_JOBS };
const PAUSE_TARGET: CoachingMutationConfig<coachingSchemas.TargetPausePayload> = { name: "pauseTarget", path: "/api/coaching/targets", schema: coachingSchemas.targetPausePayloadSchema, statesOperation: true, jobs: TARGET_JOBS };
const END_TARGET: CoachingMutationConfig<coachingSchemas.TargetEndPayload> = { name: "endTarget", path: "/api/coaching/targets", schema: coachingSchemas.targetEndPayloadSchema, statesOperation: true, jobs: TARGET_JOBS };
const SAVE_CHECK_IN: CoachingMutationConfig<coachingSchemas.CheckInSavePayload> = { name: "saveCheckIn", path: "/api/coaching/checkins", schema: coachingSchemas.saveCheckInPayloadSchema, statesOperation: true, jobs: [COACHING_JOB_KEYS.checkIns] };
const SHARE_CHECK_IN: CoachingMutationConfig<coachingSchemas.CheckInSharePayload> = { name: "shareCheckIn", path: "/api/coaching/checkins", schema: coachingSchemas.shareCheckInPayloadSchema, statesOperation: true, jobs: CHECK_IN_SHARE_JOBS };
const UPDATE_SHARED_CHECK_IN: CoachingMutationConfig<coachingSchemas.CheckInUpdateSharedPayload> = { name: "updateSharedCheckIn", path: "/api/coaching/checkins", schema: coachingSchemas.updateSharedCheckInPayloadSchema, statesOperation: true, jobs: CHECK_IN_SHARE_JOBS };
const WITHDRAW_CHECK_IN: CoachingMutationConfig<coachingSchemas.CheckInWithdrawPayload> = { name: "withdrawCheckIn", path: "/api/coaching/checkins", schema: coachingSchemas.withdrawCheckInPayloadSchema, statesOperation: true, jobs: CHECK_IN_SHARE_JOBS };
const SHARE_TASK_SUMMARY: CoachingMutationConfig<coachingSchemas.TaskSharePayload> = { name: "shareTaskSummary", path: "/api/coaching/taskshare", schema: coachingSchemas.taskSharePayloadSchema, statesOperation: true, jobs: TASK_SHARE_JOBS };
const STOP_TASK_SHARE: CoachingMutationConfig<coachingSchemas.TaskShareStopPayload> = { name: "stopTaskShare", path: "/api/coaching/taskshare", schema: coachingSchemas.taskShareStopPayloadSchema, statesOperation: true, jobs: TASK_SHARE_JOBS };
export const useInviteCoach = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.InvitationPayload>> => useCoachingMutation(INVITE_COACH);
export const useAcceptInvitation = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.AcceptancePayload>> => useCoachingMutation(ACCEPT_INVITATION);
export const useRevokeGrant = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.RevokeGrantPayload>> => useCoachingMutation(REVOKE_GRANT);
export const useEndCoaching = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.EndCoachingPayload>> => useCoachingMutation(END_COACHING);
export const useLeaveCoaching = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.LeaveCoachingPayload>> => useCoachingMutation(LEAVE_COACHING);
export const useSetModule = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.ModuleChangePayload>> => useCoachingMutation(SET_MODULE);
export const useSaveTarget = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TargetSavePayload>> => useCoachingMutation(SAVE_TARGET);
export const useEditTarget = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TargetEditPayload>> => useCoachingMutation(EDIT_TARGET);
export const usePauseTarget = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TargetPausePayload>> => useCoachingMutation(PAUSE_TARGET);
export const useEndTarget = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TargetEndPayload>> => useCoachingMutation(END_TARGET);
export const useSaveCheckIn = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.CheckInSavePayload>> => useCoachingMutation(SAVE_CHECK_IN);
export const useShareCheckIn = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.CheckInSharePayload>> => useCoachingMutation(SHARE_CHECK_IN);
export const useUpdateSharedCheckIn = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.CheckInUpdateSharedPayload>> => useCoachingMutation(UPDATE_SHARED_CHECK_IN);
export const useWithdrawCheckIn = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.CheckInWithdrawPayload>> => useCoachingMutation(WITHDRAW_CHECK_IN);
export const useShareTaskSummary = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TaskSharePayload>> => useCoachingMutation(SHARE_TASK_SUMMARY);
export const useStopTaskShare = (): UseMutationResult<MutationOutcome, Error, Attempt<coachingSchemas.TaskShareStopPayload>> => useCoachingMutation(STOP_TASK_SHARE);
