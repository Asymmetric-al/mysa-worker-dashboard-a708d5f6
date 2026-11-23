import { z } from "zod";
import { CHECKIN_MAX_ANSWER_SCALARS, CHECKIN_MAX_QUESTION_SCALARS, CHECKIN_MAX_QUESTIONS, CHECKIN_MAX_REQUEST_BYTES } from "@/modules/coaching/checkin";
import { MODULE_KEYS, type ModuleKey } from "@/modules/coaching/grant";
import { TARGET_MEASURES, type TargetMeasure, type TargetPeriod } from "@/modules/coaching/target";
import { TASK_SUMMARY_MAX_CODE_POINTS } from "@/modules/coaching/taskshare";
import { parseCivilDate } from "@/modules/time/civil";
import { LIMIT_COPY, type StopEffect } from "./copy";
const opaqueReferenceSchema = z.string().trim().min(1);
const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") ctx.addIssue({ code: "custom" });
  });
export const moduleChangePayloadSchema = z.strictObject({ grantId: z.string().trim().min(1), moduleKey: z.enum(MODULE_KEYS), enabled: z.boolean() });
export type ModuleChangePayload = z.infer<typeof moduleChangePayloadSchema>;
const invitedModulesShape = { "support-goal": z.literal(false), "support-results": z.literal(false), targets: z.literal(false), "check-ins": z.literal(false), "task-summaries": z.literal(false) } satisfies Record<ModuleKey, z.ZodLiteral<false>>;
const shareDurationSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ongoing") }), z.strictObject({ kind: z.literal("through-date"), shareThroughDate: civilDateSchema })]);
const financialRangeSchema = z.strictObject({ fromDate: civilDateSchema, toDate: civilDateSchema, currency: z.string().trim().min(1).optional() }).refine((range) => range.fromDate <= range.toDate, { path: ["toDate"] });
export const invitationPayloadSchema = z.strictObject({ coachPrincipalId: opaqueReferenceSchema, organizationId: opaqueReferenceSchema, ministryId: opaqueReferenceSchema, modules: z.strictObject(invitedModulesShape), duration: shareDurationSchema, financialRange: financialRangeSchema.optional() });
export type InvitationPayload = z.infer<typeof invitationPayloadSchema>;
export const acceptancePayloadSchema = z.strictObject({ grantId: opaqueReferenceSchema, invitationRevision: z.number().int().min(0) });
export type AcceptancePayload = z.infer<typeof acceptancePayloadSchema>;
const measureSchema = z.enum(TARGET_MEASURES) satisfies z.ZodType<TargetMeasure, TargetMeasure>;
const PERIOD_KINDS = ["weekly", "monthly", "custom"] as const satisfies readonly TargetPeriod["kind"][];
type PayloadPeriodKind = (typeof PERIOD_KINDS)[number];
const periodSchema = z.enum(PERIOD_KINDS);
type PeriodChoice = { readonly period: PayloadPeriodKind; readonly calendarStart?: string | undefined; readonly periodEnd?: string | undefined };
function requireCustomPeriodDates(value: PeriodChoice, ctx: z.RefinementCtx): void {
  if (value.period !== "custom") return;
  if (value.calendarStart === undefined) ctx.addIssue({ code: "custom", path: ["calendarStart"], message: "A one-off period states the day it starts." });
  if (value.periodEnd === undefined) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "A one-off period states the day it ends." });
}
const targetIdSchema = z.string().trim().min(1);
export const targetSavePayloadSchema = z
  .strictObject({ measure: measureSchema, quantity: z.number().int().min(1), period: periodSchema, calendarStart: civilDateSchema.optional(), periodEnd: civilDateSchema.optional(), privateLabel: z.string().trim().min(1), homePlacement: z.boolean() })
  .superRefine(requireCustomPeriodDates);
export type TargetSavePayload = z.infer<typeof targetSavePayloadSchema>;
export const targetEditPayloadSchema = z
  .strictObject({ targetId: targetIdSchema, measure: measureSchema, quantity: z.number().int().min(1), period: periodSchema, calendarStart: civilDateSchema.optional(), periodEnd: civilDateSchema.optional(), privateLabel: z.string().trim().min(1).optional(), homePlacement: z.boolean().optional() })
  .superRefine(requireCustomPeriodDates);
export type TargetEditPayload = z.infer<typeof targetEditPayloadSchema>;
export const targetPausePayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetPausePayload = z.infer<typeof targetPausePayloadSchema>;
export const targetEndPayloadSchema = z.strictObject({ targetId: targetIdSchema });
export type TargetEndPayload = z.infer<typeof targetEndPayloadSchema>;
const CHECKIN_SCHEMA_MESSAGES = {
  missingCheckIn: "This change belongs to one check-in, so reopen the check-in from its list and try again.",
  missingSharedRevision: "This change belongs to one shared revision, so reopen the check-in and try again.",
  questionNotText: "A question is plain text, so take out anything that is not text and save again.",
  answerNotText: "An answer is plain text, so take out anything that is not text and save again.",
} as const;
const answersMisaligned = (answers: number, questions: number): string => `This check-in carries ${answers} answers and ${questions} questions. Nothing was padded or dropped: give each question one answer and save again.`;
const checkInIdSchema = z.string({ error: CHECKIN_SCHEMA_MESSAGES.missingCheckIn }).min(1, CHECKIN_SCHEMA_MESSAGES.missingCheckIn);
const sharedRevisionIdSchema = z.string({ error: CHECKIN_SCHEMA_MESSAGES.missingSharedRevision }).min(1, CHECKIN_SCHEMA_MESSAGES.missingSharedRevision);
const questionsSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.questionNotText }), { error: CHECKIN_SCHEMA_MESSAGES.questionNotText });
const answersSchema = z.array(z.string({ error: CHECKIN_SCHEMA_MESSAGES.answerNotText }), { error: CHECKIN_SCHEMA_MESSAGES.answerNotText });
type CheckInBody = { readonly questions: readonly string[]; readonly answers: readonly string[] };
const UTF8_ENCODER = new TextEncoder();
function applyCheckInLimits(payload: CheckInBody, context: z.RefinementCtx): void {
  const { questions, answers } = payload;
  if (questions.length > CHECKIN_MAX_QUESTIONS) context.addIssue({ code: "custom", path: ["questions"], message: LIMIT_COPY.questionSetExceeded(questions.length) });
  for (const [index, wording] of questions.entries()) {
    const scalars = Array.from(wording).length;
    if (scalars > CHECKIN_MAX_QUESTION_SCALARS) context.addIssue({ code: "custom", path: ["questions", index], message: LIMIT_COPY.questionTextExceeded(index + 1, scalars) });
  }
  if (answers.length !== questions.length) context.addIssue({ code: "custom", path: ["answers"], message: answersMisaligned(answers.length, questions.length) });
  for (const [index, text] of answers.entries()) {
    const scalars = Array.from(text).length;
    if (scalars > CHECKIN_MAX_ANSWER_SCALARS) context.addIssue({ code: "custom", path: ["answers", index], message: LIMIT_COPY.answerTextExceeded(index + 1, scalars) });
  }
  const bytes = UTF8_ENCODER.encode(JSON.stringify(payload)).byteLength;
  if (bytes > CHECKIN_MAX_REQUEST_BYTES) context.addIssue({ code: "custom", message: LIMIT_COPY.requestSizeExceeded(bytes) });
}
export const saveCheckInPayloadSchema = z.strictObject({ checkInId: checkInIdSchema.optional(), questions: questionsSchema, answers: answersSchema }).superRefine(applyCheckInLimits);
export type CheckInSavePayload = z.infer<typeof saveCheckInPayloadSchema>;
export const shareCheckInPayloadSchema = z.strictObject({ checkInId: checkInIdSchema, questions: questionsSchema, answers: answersSchema }).superRefine(applyCheckInLimits);
export type CheckInSharePayload = z.infer<typeof shareCheckInPayloadSchema>;
export const updateSharedCheckInPayloadSchema = z.strictObject({ checkInId: checkInIdSchema, sharedRevisionId: sharedRevisionIdSchema, questions: questionsSchema, answers: answersSchema }).superRefine(applyCheckInLimits);
export type CheckInUpdateSharedPayload = z.infer<typeof updateSharedCheckInPayloadSchema>;
export const withdrawCheckInPayloadSchema = z.strictObject({ checkInId: checkInIdSchema, sharedRevisionId: sharedRevisionIdSchema });
export type CheckInWithdrawPayload = z.infer<typeof withdrawCheckInPayloadSchema>;
const TASK_SHARE_SCHEMA_MESSAGES = {
  taskRequired: "This payload names no task, so reload the shared summaries and choose the task again.",
  occurrenceRequired: "This payload names no occurrence, so choose the occurrence you want to share and try again.",
  descriptionRequired: "This payload carries no description, so write what you want your coach to read and review it before sharing.",
} as const;
const safeDescriptionSchema = z.string().superRefine((description, ctx) => {
  if (description.trim() === "") {
    ctx.addIssue({ code: "custom", message: TASK_SHARE_SCHEMA_MESSAGES.descriptionRequired });
    return;
  }
  const codePoints = Array.from(description).length;
  if (codePoints > TASK_SUMMARY_MAX_CODE_POINTS) ctx.addIssue({ code: "custom", message: LIMIT_COPY.taskDescriptionExceeded(codePoints) });
});
export const taskSharePayloadSchema = z.strictObject({
  taskId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.taskRequired),
  occurrenceId: z.string().trim().min(1, TASK_SHARE_SCHEMA_MESSAGES.occurrenceRequired).optional(),
  reviewedFingerprint: z.string().trim().min(1, "A shared summary records the review it belongs to, so review the description and share it again."),
  safeDescription: safeDescriptionSchema,
});
export type TaskSharePayload = z.infer<typeof taskSharePayloadSchema>;
export const taskShareStopPayloadSchema = z.strictObject({ taskShareId: z.string().trim().min(1, "This payload names no shared summary, so reload the shared summaries and stop it again.") });
export type TaskShareStopPayload = z.infer<typeof taskShareStopPayloadSchema>;
export const revokeGrantPayloadSchema = z.strictObject({ grantId: opaqueReferenceSchema });
export type RevokeGrantPayload = z.infer<typeof revokeGrantPayloadSchema>;
export const endCoachingPayloadSchema = z.strictObject({ grantId: opaqueReferenceSchema });
export type EndCoachingPayload = z.infer<typeof endCoachingPayloadSchema>;
export const leaveCoachingPayloadSchema = z.strictObject({ grantId: opaqueReferenceSchema });
export type LeaveCoachingPayload = z.infer<typeof leaveCoachingPayloadSchema>;
export type StopMutation = "setModule" | "withdrawCheckIn" | "stopTaskShare" | "endCoaching" | "leaveCoaching" | "revokeGrant";
export type StopAction = { readonly mutation: StopMutation; readonly schema: z.ZodType };
export const STOP_ACTIONS = {
  "stop-module": { mutation: "setModule", schema: moduleChangePayloadSchema },
  "withdraw-check-in": { mutation: "withdrawCheckIn", schema: withdrawCheckInPayloadSchema },
  "remove-task-share": { mutation: "stopTaskShare", schema: taskShareStopPayloadSchema },
  "end-relationship": { mutation: "endCoaching", schema: endCoachingPayloadSchema },
  "coach-leave": { mutation: "leaveCoaching", schema: leaveCoachingPayloadSchema },
  revoke: { mutation: "revokeGrant", schema: revokeGrantPayloadSchema },
} as const satisfies Record<StopEffect, StopAction>;
export const stopActionFor = (effect: StopEffect): StopAction => STOP_ACTIONS[effect];
