import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
/** The largest clock amount these schemas accept, in seconds — roughly ten years. */ export const CLOCK_OFFSET_GUARD_SECONDS = 315_360_000;
const DEV_SCHEMA_MESSAGES = {
  actionRequired: "A development request names the action it asks for, so send the control's own action with the rest of the request.",
  identifierRequired: "This change names no record, so choose the value it applies to and submit again.",
  identifierTooLong: "An identifier is an opaque handle of at most 200 characters, so choose one rather than writing one.",
  clockReadingRequired: "A clock reading is an ISO-8601 date-time that states its offset, such as 2026-11-21T09:00:00+01:00.",
  clockAmountNotWhole: "A clock advance is a whole number of seconds, so round this one to a second.",
  clockAmountOutOfRange: `A clock advance is a whole number of seconds from 1 to ${String(CLOCK_OFFSET_GUARD_SECONDS)}, because the scenario clock stays within ten years of the seed instant.`,
  failureModeRequired: "A failure plan names the mode it arms, so choose one of the advertised modes.",
  failureModeNotAdvertised: "Choose a failure mode the development runtime advertises.",
  failureTargetKindInvalid: "A failure is armed against one read or one mutation, so say which of the two.",
  failureTargetNameRequired: "A failure plan names the one read or mutation that will answer with it.",
  failureTargetNotAdvertised: "Choose a read or mutation the development runtime advertises.",
  failurePlanDisarmNotAbsent: "A failure plan is disarmed by stating a null plan, because the plan it clears is the one already armed.",
} as const;
const opaqueIdentifierSchema = z.string({ error: DEV_SCHEMA_MESSAGES.identifierRequired }).trim().min(1, DEV_SCHEMA_MESSAGES.identifierRequired).max(200, DEV_SCHEMA_MESSAGES.identifierTooLong);
const advanceClockPayloadSchema = z.strictObject({
  bySeconds: z.number({ error: DEV_SCHEMA_MESSAGES.clockAmountNotWhole }).int({ error: DEV_SCHEMA_MESSAGES.clockAmountNotWhole }).positive({ error: DEV_SCHEMA_MESSAGES.clockAmountOutOfRange }).max(CLOCK_OFFSET_GUARD_SECONDS, { error: DEV_SCHEMA_MESSAGES.clockAmountOutOfRange }),
});
export type DevRequest<Action extends string, Payload> = MutationInput<Payload> & { readonly action: Action };
function requestProjectionOf(raw: unknown, action: string): Record<string, unknown> | undefined {
  if (!isRecord(raw) || raw.action !== action) return undefined;
  const projection: Record<string, unknown> = { ...raw };
  delete projection.action;
  return projection;
}
const developmentRequestSchema = <Action extends string, Payload>(action: Action, payload: z.ZodType<Payload>): z.ZodType<DevRequest<Action, Payload>> =>
  z
    .looseObject({ action: z.literal(action, { error: DEV_SCHEMA_MESSAGES.actionRequired }) })
    .transform((raw): unknown => requestProjectionOf(raw, action))
    .pipe(mutationInputSchema(payload))
    .transform((input) => ({ action, ...input }));
export type AdvertisedFailureTarget = { kind: "read" | "mutation"; name: string };
export type AdvertisedFailurePlan = { modes: readonly string[]; targets: readonly AdvertisedFailureTarget[] };
export const setScenarioRequestSchema = developmentRequestSchema("setScenario", z.strictObject({ scenarioId: opaqueIdentifierSchema }));
export const setClockRequestSchema = developmentRequestSchema("setClock", z.strictObject({ offsetIso: z.iso.datetime({ offset: true, error: DEV_SCHEMA_MESSAGES.clockReadingRequired }) }));
export const advanceClockRequestSchema = developmentRequestSchema("advanceClock", advanceClockPayloadSchema);
export const resetSeedRequestSchema = developmentRequestSchema("resetSeed", z.strictObject({}));
export type AdvertisedFailureArming = { mode: string; target: AdvertisedFailureTarget };
export type AdvertisedFailureDisarm = { plan: null };
export type AdvertisedFailurePlanPayload = AdvertisedFailureArming | AdvertisedFailureDisarm;
/** Validates setFailurePlan against the modes and targets the caller's development read advertises. */ export function makeSetFailurePlanRequestSchema(advertised: AdvertisedFailurePlan) {
  const armPlanSchema: z.ZodType<AdvertisedFailureArming> = z
    .strictObject({
      mode: z.string({ error: DEV_SCHEMA_MESSAGES.failureModeRequired }).min(1, DEV_SCHEMA_MESSAGES.failureModeRequired),
      target: z.strictObject({ kind: z.enum(["read", "mutation"], { error: DEV_SCHEMA_MESSAGES.failureTargetKindInvalid }), name: z.string({ error: DEV_SCHEMA_MESSAGES.failureTargetNameRequired }).min(1, DEV_SCHEMA_MESSAGES.failureTargetNameRequired) }),
    })
    .superRefine((plan, ctx) => {
      if (!advertised.modes.includes(plan.mode)) ctx.addIssue({ code: "custom", path: ["mode"], message: DEV_SCHEMA_MESSAGES.failureModeNotAdvertised });
      const isAdvertisedTarget = advertised.targets.some((target) => target.kind === plan.target.kind && target.name === plan.target.name);
      if (!isAdvertisedTarget) ctx.addIssue({ code: "custom", path: ["target", "name"], message: DEV_SCHEMA_MESSAGES.failureTargetNotAdvertised });
    });
  const planSchema: z.ZodType<AdvertisedFailurePlanPayload> = z.custom<AdvertisedFailurePlanPayload>().superRefine((payload, ctx) => {
    const parsed = typeof payload === "object" && payload !== null && Object.hasOwn(payload, "plan") ? z.strictObject({ plan: z.null({ error: DEV_SCHEMA_MESSAGES.failurePlanDisarmNotAbsent }) }).safeParse(payload) : armPlanSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });
  return developmentRequestSchema("setFailurePlan", planSchema);
}
/** The five development mutations this family sends, verb-first and identical to the service's names. */ export const DEV_MUTATION_NAMES = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed"] as const;
export type DevMutationName = (typeof DEV_MUTATION_NAMES)[number];
/** Every action these transports send: the five service mutations, and the session switch, which has no `mutations.dev.*` counterpart because the identity a browser acts as is its own cookie's fact. */ export type DevTransportAction = DevMutationName | "selectPersona";
const selectPersonaPayloadSchema = z.strictObject({ personaId: opaqueIdentifierSchema });
/** The switch names one seeded persona of the roster the development read lists, and the handler grants this browser's cookie rather than storing anything. */ export const selectPersonaRequestSchema = developmentRequestSchema("selectPersona", selectPersonaPayloadSchema);
