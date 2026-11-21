/**
 * The shell family's five development-runtime request bodies: one schema per named mutation the
 * development panel and the Settings reset drive through `GET|POST /api/dev` — `setScenario`,
 * `setClock`, `advanceClock`, `setFailurePlan` and `resetSeed`. `readDevState` is a read, so it has no
 * body and no schema here.
 *
 * Each schema is the whole four-field mutation input `{ operationId, scope, expectedRevision,
 * payload }`: `mutationInputSchema` supplies the first three, so this file never re-declares them, and
 * every payload mirrors the field names and shapes the service mutation in
 * `modules/data-service/mutations/dev.ts` validates — `scenarioId`, `offsetIso`, `bySeconds`,
 * `{ mode, target: { kind, name } }`, and an empty object for the reset. Matching that service is what
 * keeps a panel-offered value from being refused as `invalid` a moment after it was accepted here. The
 * confirmation a reset needs is the shared review step's, not a wire field, because the reset mutation
 * accepts no field at all.
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

import { mutationInputSchema } from "@/modules/data-service/envelope";

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

/** One call a failure plan may target: which kind of call it is, and the name the runtime advertises. */
export type AdvertisedFailureTarget = { kind: "read" | "mutation"; name: string };

/** The failure vocabulary a session's development read advertises: its modes and its named calls. */
export type AdvertisedFailurePlan = {
  modes: readonly string[];
  targets: readonly AdvertisedFailureTarget[];
};

/** Validates setScenario — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const setScenarioRequestSchema = mutationInputSchema(setScenarioPayloadSchema);

/** Validates setClock — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const setClockRequestSchema = mutationInputSchema(setClockPayloadSchema);

/** Validates advanceClock — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const advanceClockRequestSchema = mutationInputSchema(advanceClockPayloadSchema);

/** Validates resetSeed — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const resetSeedRequestSchema = mutationInputSchema(resetSeedPayloadSchema);

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

  return mutationInputSchema(planSchema);
}

/** The validated setScenario request: the four-field envelope and the scenario this session runs in. */
export type SetScenarioRequest = z.infer<typeof setScenarioRequestSchema>;

/** The validated setClock request: the four-field envelope and the instant the clock should read. */
export type SetClockRequest = z.infer<typeof setClockRequestSchema>;

/** The validated advanceClock request: the four-field envelope and the forward move in seconds. */
export type AdvanceClockRequest = z.infer<typeof advanceClockRequestSchema>;

/** The validated setFailurePlan request: the four-field envelope, one mode and the one call it arms. */
export type SetFailurePlanRequest = z.infer<ReturnType<typeof makeSetFailurePlanRequestSchema>>;

/** The validated resetSeed request: the four-field envelope and no payload field to state. */
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
