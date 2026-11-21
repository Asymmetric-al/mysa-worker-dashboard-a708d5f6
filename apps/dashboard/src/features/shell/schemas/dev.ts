/**
 * The shell family's five development-runtime request bodies: one schema per named mutation the
 * development panel and the Settings reset drive through `GET|POST /api/dev` — `setScenario`,
 * `setClock`, `advanceClock`, `setFailurePlan` and `resetSeed`. `readDevState` is a read, so it has no
 * body and no schema here.
 *
 * Each schema is the whole five-member wire body the route accepts:
 *
 *     { action, operationId, scope, expectedRevision, payload }
 *
 * `action` is routing metadata, not a mutation field: it says which of the five controls the body asks
 * for, and the route removes it before the service validates the four fields of the mutation input.
 * `mutationInputSchema` therefore stays the one declaration of `operationId`, `scope` and
 * `expectedRevision` — this file never re-declares them — and every payload mirrors the field names
 * and shapes the service mutation in `modules/data-service/mutations/dev.ts` validates —
 * `scenarioId`, `offsetIso`, `bySeconds`, `{ mode, target: { kind, name } }`, and an empty object for
 * the reset. Matching that service is what keeps a panel-offered value from being refused as `invalid`
 * a moment after it was accepted here, and carrying the discriminant is what keeps a body this file
 * accepts from being refused as `invalid` keyed `action` at the transport. The confirmation a reset
 * needs is the shared review step's, not a wire field, because the reset mutation accepts no field at
 * all.
 *
 * The envelope module is imported rather than the `@/modules/data-service` barrel: the barrel's value
 * imports reach `node:fs/promises` (scoped media serving and media registration), while this module is
 * imported by the shell's client hooks and by the development panel. Same contract, no server-only code
 * in the browser bundle.
 *
 * The failure vocabulary is not fixed here. The modes and the named reads and mutations that
 * demonstrate them belong to the development runtime, so {@link makeSetFailurePlanRequestSchema}
 * validates membership against the lists a caller passes in and embeds none of them — a stored literal
 * would become a second source of truth about what a demonstration can arm.
 */

import { z } from "zod";

import { isRecord } from "@/lib/guards";
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";

/**
 * The largest clock amount these schemas accept, in seconds — roughly ten years.
 *
 * A wire guard rail, not a product limit: it refuses an absurd integer before it reaches a session
 * document, and because it stays inside the ten-year span the development runtime enforces itself
 * (`CLOCK_OFFSET_LIMIT_MS` in `modules/dev-runtime/scenario.ts`, not imported here because that module
 * is server-only), an amount accepted locally is never one the runtime then refuses.
 */
export const CLOCK_OFFSET_GUARD_SECONDS = 315_360_000;

/** Every field refusal these schemas produce, stated once so no schema repeats a literal inline. */
const DEV_SCHEMA_MESSAGES = {
  actionRequired:
    "A development request names the action it asks for, so send the control's own action with the rest of the request.",
  identifierRequired:
    "This change names no record, so choose the value it applies to and submit again.",
  identifierTooLong:
    "An identifier is an opaque handle of at most 200 characters, so choose one rather than writing one.",
  clockReadingRequired:
    "A clock reading is an ISO-8601 date-time that states its offset, such as 2026-11-21T09:00:00+01:00.",
  clockAmountNotWhole:
    "A clock advance is a whole number of seconds, so round this one to a second.",
  clockAmountOutOfRange: `A clock advance is a whole number of seconds from 1 to ${String(CLOCK_OFFSET_GUARD_SECONDS)}, because the scenario clock stays within ten years of the seed instant.`,
  failureModeRequired:
    "A failure plan names the mode it arms, so choose one of the advertised modes.",
  failureModeNotAdvertised: "Choose a failure mode the development runtime advertises.",
  failureTargetKindInvalid:
    "A failure is armed against one read or one mutation, so say which of the two.",
  failureTargetNameRequired:
    "A failure plan names the one read or mutation that will answer with it.",
  failureTargetNotAdvertised: "Choose a read or mutation the development runtime advertises.",
} as const;

/**
 * One opaque identifier, trimmed and bounded in length.
 *
 * Never parsed for meaning and never compared with a name or an email address: it is a handle to one
 * record inside one scope. Trimmed before it is measured so a whitespace-only value is refused at the
 * field that carried it, and bounded only as a wire sanity rule — which values exist is the service's
 * question, answered against the records and the runtime's own catalogue.
 */
const opaqueIdentifierSchema = z
  .string({ error: DEV_SCHEMA_MESSAGES.identifierRequired })
  .trim()
  .min(1, DEV_SCHEMA_MESSAGES.identifierRequired)
  .max(200, DEV_SCHEMA_MESSAGES.identifierTooLong);

/** The `setScenario` payload: the scenario this session should run in, named but not enumerated here. */
const setScenarioPayloadSchema = z.object({
  scenarioId: opaqueIdentifierSchema,
});

/** The `setClock` payload: the instant the session's scenario clock should read, with its offset stated. */
const setClockPayloadSchema = z.object({
  offsetIso: z.iso.datetime({ offset: true, error: DEV_SCHEMA_MESSAGES.clockReadingRequired }),
});

/** The `advanceClock` payload: how far forward to move, in whole seconds and only forwards. */
const advanceClockPayloadSchema = z.object({
  bySeconds: z
    .number({ error: DEV_SCHEMA_MESSAGES.clockAmountNotWhole })
    .int({ error: DEV_SCHEMA_MESSAGES.clockAmountNotWhole })
    .positive({ error: DEV_SCHEMA_MESSAGES.clockAmountOutOfRange })
    .max(CLOCK_OFFSET_GUARD_SECONDS, { error: DEV_SCHEMA_MESSAGES.clockAmountOutOfRange }),
});

/** The `resetSeed` payload: a reset states nothing, so a field sent with it changes nothing. */
const resetSeedPayloadSchema = z.object({});

/**
 * One validated development request: the four-field mutation input, plus the action it names.
 *
 * The route reads the discriminant to choose one of the five mutations and the service reads the four
 * fields it validates, so both reach a parsed body's own members without this file restating either.
 */
export type DevRequest<Action extends DevMutationName, Payload> = MutationInput<Payload> & {
  readonly action: Action;
};

/**
 * The four fields the service judges, with the discriminant removed, or `undefined` when the body
 * does not name this action.
 *
 * Unreachable behind the literal the request schema checks first, and kept for the same reason the
 * route's own projection exists: a schema that hands the envelope a body must have verified the
 * action it strips, rather than trusting an earlier stage to have done it.
 */
function requestProjectionOf(
  raw: unknown,
  action: DevMutationName,
): Record<string, unknown> | undefined {
  if (!isRecord(raw) || raw.action !== action) {
    return undefined;
  }
  const projection: Record<string, unknown> = { ...raw };
  delete projection.action;
  return projection;
}

/**
 * Builds one control's request schema: its discriminant, the service's own input envelope around this
 * control's payload shape, and the parsed body carrying the action it named.
 *
 * The discriminant is checked first, so a body naming another control answers with one issue at
 * `action` rather than with the payload messages of a control it never named. The body is read
 * loosely so a field the envelope does not expect survives the first stage and is refused there by
 * name instead of being dropped silently. Returning the projection as `unknown` is what lets the
 * envelope, whose input it does not constrain, receive it.
 */
function developmentRequestSchema<Action extends DevMutationName, Payload>(
  action: Action,
  payload: z.ZodType<Payload>,
): z.ZodType<DevRequest<Action, Payload>> {
  return z
    .looseObject({ action: z.literal(action, { error: DEV_SCHEMA_MESSAGES.actionRequired }) })
    .transform((raw): unknown => requestProjectionOf(raw, action))
    .pipe(mutationInputSchema(payload))
    .transform((input) => ({ action, ...input }));
}

/** One call a failure plan may target: which kind of call it is, and the name the runtime advertises. */
export type AdvertisedFailureTarget = { kind: "read" | "mutation"; name: string };

/** The failure vocabulary a session's development read advertises: its modes and its named calls. */
export type AdvertisedFailurePlan = {
  modes: readonly string[];
  targets: readonly AdvertisedFailureTarget[];
};

/** Validates setScenario — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const setScenarioRequestSchema = developmentRequestSchema(
  "setScenario",
  setScenarioPayloadSchema,
);

/** Validates setClock — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const setClockRequestSchema = developmentRequestSchema("setClock", setClockPayloadSchema);

/** Validates advanceClock — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const advanceClockRequestSchema = developmentRequestSchema(
  "advanceClock",
  advanceClockPayloadSchema,
);

/** Validates resetSeed — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const resetSeedRequestSchema = developmentRequestSchema("resetSeed", resetSeedPayloadSchema);

/** Validates setFailurePlan against the modes and targets the caller's development read advertises. */
export function makeSetFailurePlanRequestSchema(advertised: AdvertisedFailurePlan) {
  const planSchema = z
    .object({
      mode: z
        .string({ error: DEV_SCHEMA_MESSAGES.failureModeRequired })
        .min(1, DEV_SCHEMA_MESSAGES.failureModeRequired),
      target: z.object({
        kind: z.enum(["read", "mutation"], {
          error: DEV_SCHEMA_MESSAGES.failureTargetKindInvalid,
        }),
        name: z
          .string({ error: DEV_SCHEMA_MESSAGES.failureTargetNameRequired })
          .min(1, DEV_SCHEMA_MESSAGES.failureTargetNameRequired),
      }),
    })
    .superRefine((plan, ctx) => {
      // Each refusal lands on its own field path, so the form places the message against the control
      // that offered the value rather than against the whole payload.
      if (!advertised.modes.includes(plan.mode)) {
        ctx.addIssue({
          code: "custom",
          path: ["mode"],
          message: DEV_SCHEMA_MESSAGES.failureModeNotAdvertised,
        });
      }

      const isAdvertisedTarget = advertised.targets.some(
        (target) => target.kind === plan.target.kind && target.name === plan.target.name,
      );

      if (!isAdvertisedTarget) {
        ctx.addIssue({
          code: "custom",
          path: ["target", "name"],
          message: DEV_SCHEMA_MESSAGES.failureTargetNotAdvertised,
        });
      }
    });

  return developmentRequestSchema("setFailurePlan", planSchema);
}

/** The validated setScenario request: the action named, the four-field envelope and the scenario to run. */
export type SetScenarioRequest = z.infer<typeof setScenarioRequestSchema>;

/** The validated setClock request: the action named, the four-field envelope and the instant to read. */
export type SetClockRequest = z.infer<typeof setClockRequestSchema>;

/** The validated advanceClock request: the action named, the four-field envelope and the forward move. */
export type AdvanceClockRequest = z.infer<typeof advanceClockRequestSchema>;

/** The validated setFailurePlan request: the action named, the four-field envelope and the call it arms. */
export type SetFailurePlanRequest = z.infer<ReturnType<typeof makeSetFailurePlanRequestSchema>>;

/** The validated resetSeed request: the action named, the four-field envelope and no payload field. */
export type ResetSeedRequest = z.infer<typeof resetSeedRequestSchema>;

/** The five development mutations this family sends, verb-first and identical to the service's names. */
export const DEV_MUTATION_NAMES = [
  "setScenario",
  "setClock",
  "advanceClock",
  "setFailurePlan",
  "resetSeed",
] as const;

/** One development mutation, named the way its schema and the service name it. */
export type DevMutationName = (typeof DEV_MUTATION_NAMES)[number];
