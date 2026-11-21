/**
 * The namespaced development-control handler: `GET` reports this session's development runtime, `POST`
 * operates exactly one of its five named controls.
 */
import { z } from "zod";
import { isDevelopment, isRecord } from "@/lib/guards";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
/**
 * The two constructors come from the module that owns them rather than through the service barrel,
 * which re-exports the conversion helpers only: one constructor per outcome is what keeps denial
 * redaction mechanical, so an answer built here is built the same way every other answer is.
 */
import { denied, invalid } from "@/modules/data-service/outcome";
/** Every request is evaluated per request: the service reads the development-session cookie, so the same URL answers differently for two sessions and must never be served as a cached static. */
export const dynamic = "force-dynamic";
/** The synthetic store writes through `node:fs`, so the Edge runtime cannot serve this route. */
export const runtime = "nodejs";
// The five named controls
const DEV_ACTIONS = ["setScenario", "setClock", "advanceClock", "setFailurePlan", "resetSeed"] as const;

type DevAction = (typeof DEV_ACTIONS)[number];

const DEV_ACTION_SET: ReadonlySet<string> = new Set<string>(DEV_ACTIONS);

const READ_ATTEMPT_MARKER = "read";

const UNREACHED_ATTEMPT = "dev-route";

const WIRE_TEXT_LIMIT = 64;

const ACTION_MESSAGE = `A development request names the action it asks for: ${DEV_ACTIONS.join(", ")}.`;

const AMBIGUOUS_ACTION_MESSAGE = `A development request carries exactly one action, and ${DEV_ACTIONS.join(", ")} are five distinct names.`;
// The payload vocabulary, owned by the service
type ScenarioIdWire = Parameters<typeof mutations.dev.setScenario>[0]["payload"]["scenarioId"];

type SetFailurePlanPayloadWire = Parameters<typeof mutations.dev.setFailurePlan>[0]["payload"];

type ArmingFailurePlanPayloadWire = Exclude<SetFailurePlanPayloadWire, { plan: null }>;

type FailureModeWire = ArmingFailurePlanPayloadWire["mode"];
type FailureTargetNameWire = ArmingFailurePlanPayloadWire["target"]["name"];

function serviceWord<Word extends string>(): z.ZodType<Word> {
  return z.custom<Word>(
    (value) => typeof value === "string" && value.trim().length > 0 && value.length <= WIRE_TEXT_LIMIT,
    `This field is a non-empty name of at most ${String(WIRE_TEXT_LIMIT)} characters.`,
  );
}
const setScenarioPayload = z.strictObject({ scenarioId: serviceWord<ScenarioIdWire>() });

const setClockPayload = z.strictObject({ offsetIso: z.string().min(1).max(WIRE_TEXT_LIMIT) });

const advanceClockPayload = z.strictObject({
  bySeconds: z
    .int({
      error: "A clock advance moves the scenario clock by whole seconds, so state the seconds to move by rather than a fraction of one.",
    })
    .positive({
      error: "A clock advance moves the scenario clock forward, so the seconds it moves by are greater than zero.",
    }),
});
const armFailurePlanPayload = z.strictObject({
  mode: serviceWord<FailureModeWire>(),
  target: z.strictObject({
    kind: z.enum(["read", "mutation"]),
    name: serviceWord<FailureTargetNameWire>(),
  }),
});
const disarmFailurePlanPayload = z.strictObject({ plan: z.null() });

const DISARM_PLAN_MEMBER = "plan";

const setFailurePlanPayload: z.ZodType<SetFailurePlanPayloadWire> = z.custom<SetFailurePlanPayloadWire>().superRefine((payload, ctx) => {
  const parsed = isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER) ? disarmFailurePlanPayload.safeParse(payload) : armFailurePlanPayload.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // The form's own message and field path are what a caller acts on; the machine code belongs to
      // the schema library, and an `invalid` outcome is keyed by the path and read for the message.
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  }
});
const resetSeedPayload = z.custom<Parameters<typeof mutations.dev.resetSeed>[0]["payload"]>(
  (value) => isRecord(value) && Object.keys(value).length === 0,
  "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.",
);
// One request schema per control
function requestSchema<P>(action: DevAction, payload: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.preprocess((raw: unknown) => requestProjection(raw, action), mutationInputSchema(payload));
}
function requestProjection(raw: unknown, action: DevAction): Record<string, unknown> | undefined {
  if (!isRecord(raw) || raw.action !== action) {
    return undefined;
  }
  const projection: Record<string, unknown> = { ...raw };
  delete projection.action;
  return projection;
}
const setScenarioRequest = requestSchema("setScenario", setScenarioPayload);
const setClockRequest = requestSchema("setClock", setClockPayload);
const advanceClockRequest = requestSchema("advanceClock", advanceClockPayload);
const setFailurePlanRequest = requestSchema("setFailurePlan", setFailurePlanPayload);
const resetSeedRequest = requestSchema("resetSeed", resetSeedPayload);
// Reading the request
async function readJsonBody(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return undefined;
  }
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}
function operationIdOf(body: unknown): string {
  if (isRecord(body)) {
    const presented = body.operationId;
    if (typeof presented === "string" && presented.length > 0 && presented.length <= WIRE_TEXT_LIMIT) {
      return presented;
    }
  }
  return UNREACHED_ATTEMPT;
}
function devActionOf(body: unknown): DevAction | null {
  if (!isRecord(body)) {
    return null;
  }
  const action = body.action;
  return isDevAction(action) ? action : null;
}
function isDevAction(value: unknown): value is DevAction {
  return typeof value === "string" && DEV_ACTION_SET.has(value);
}
// The outcomes this file may answer before a mutation runs
function developmentDenial(): MutationOutcome {
  return denied({ operationId: UNREACHED_ATTEMPT, reasonCode: "capability-absent" });
}
function refusalOnAction(operationId: string, message: string): MutationOutcome {
  return invalid({ operationId, fields: { action: [message] } });
}
// Dispatch: one named mutation, one response ladder
interface DispatchedAttempt {
  readonly operationId: string;
}
async function dispatchAttempt(attempt: DispatchedAttempt, call: () => Promise<MutationOutcome>): Promise<Response> {
  let outcome: MutationOutcome;
  try {
    outcome = await call();
  } catch (error) {
    outcome = outcomeFromError(attempt.operationId, error);
  }
  return toResponse(outcome);
}
// The handlers
/** Reports this session's development runtime — the scenario, the clock offset and the instant it derives, the one armed failure plan, the advertised modes and named targets, the seeded. */
export async function GET(): Promise<Response> {
  if (!isDevelopment()) {
    return toResponse(developmentDenial());
  }
  try {
    return toResponse(await reads.dev.readDevState());
  } catch (error) {
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
/** Operates exactly one of the five named development controls and answers with one of the closed outcomes: `accepted`, `alreadyAccepted` for a replay of the same `operationId` with the same. */
export async function POST(request: Request): Promise<Response> {
  if (!isDevelopment()) {
    return toResponse(developmentDenial());
  }
  const body = await readJsonBody(request);
  const operationId = operationIdOf(body);
  const action = devActionOf(body);
  if (action === null) {
    return toResponse(refusalOnAction(operationId, ACTION_MESSAGE));
  }
  // Every schema is tried against the one body. Five schemas whose discriminants are distinct literals
  // can accept it at most once, and the count is asserted here rather than assumed below.
  const scenario = setScenarioRequest.safeParse(body);
  const clock = setClockRequest.safeParse(body);
  const advanced = advanceClockRequest.safeParse(body);
  const plan = setFailurePlanRequest.safeParse(body);
  const reset = resetSeedRequest.safeParse(body);
  const accepted = [scenario, clock, advanced, plan, reset].filter((attempt) => attempt.success).length;
  if (accepted > 1) {
    return toResponse(refusalOnAction(operationId, AMBIGUOUS_ACTION_MESSAGE));
  }
  // The action is one this handler accepts, so exactly one branch below runs and the others are the
  // schemas that declined it.
  switch (action) {
    case "setScenario": {
      if (!scenario.success) {
        return toResponse(outcomeFromError(operationId, scenario.error));
      }
      const input = scenario.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setScenario(input));
    }
    case "setClock": {
      if (!clock.success) {
        return toResponse(outcomeFromError(operationId, clock.error));
      }
      const input = clock.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setClock(input));
    }
    case "advanceClock": {
      if (!advanced.success) {
        return toResponse(outcomeFromError(operationId, advanced.error));
      }
      const input = advanced.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.advanceClock(input));
    }
    case "setFailurePlan": {
      if (!plan.success) {
        return toResponse(outcomeFromError(operationId, plan.error));
      }
      const input = plan.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.setFailurePlan(input));
    }
    case "resetSeed": {
      if (!reset.success) {
        return toResponse(outcomeFromError(operationId, reset.error));
      }
      const input = reset.data;
      return dispatchAttempt({ operationId }, () => mutations.dev.resetSeed(input));
    }
  }
}
