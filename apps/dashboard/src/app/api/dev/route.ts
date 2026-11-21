/**
 * The namespaced development-control handler: `GET` reports this session's development runtime, `POST`
 * operates exactly one of its five named controls.
 *
 * **What it is.** A thin adapter and nothing else — gate, read the body, validate it, dispatch one named
 * service mutation with the caller's own fields, record the attempt, and map the answer through the one
 * outcome ladder. It holds no clock read, no time arithmetic, no seed content, no scenario list, no
 * failure vocabulary, no store access and no business rule: the scenario registry, the clock offset, the
 * three failure modes with their ten named targets, the deterministic reset, the payload rules,
 * authorisation, revision checks, the operation ledger and every boundary belong to the service
 * (`@/modules/data-service`), which is the only module this file reaches.
 *
 * **Gate first.** Both handlers begin with `isDevelopment()` from `@/lib/guards`. Outside a development
 * build the answer is the closed `denied` outcome with `capability-absent`, carrying no scenario, clock,
 * failure-plan or reset name — not even an empty list of available actions — because the honest
 * statement is that this build does not carry the capability. No read, no mutation, no `.data/` access
 * and no body read happens on that path, and the outcome says nothing about whether a session exists.
 * The five mutations ask the development boundary again inside the service (`assertDevelopmentOnly`);
 * that is defence in depth, not a substitute for this gate.
 *
 * **The five actions are the whole set.** `setScenario`, `setClock`, `advanceClock`, `setFailurePlan`
 * and `resetSeed` — and nothing else. There is no sixth action, no persona-minting or role-switching
 * action, no `?action=` alias, no query-string discriminator, no second development endpoint anywhere in
 * the application, and no blessing of a payload field the service does not itself validate. Clearing the
 * armed failure is a payload form of `setFailurePlan` (`{ plan: null }`) rather than an action of its own,
 * because the armed plan is one slot with two states and every operation here has one name. A capability
 * the fixed inventory does not contain is a gap for the owning agent to record, never an extra action
 * added here.
 *
 * **The wire contract clients share** (declared here, mirrored by the development panel's own request
 * schemas, and stated so the two sides cannot drift). The body is the four-field mutation input of
 * AAP 0.7.1 plus one discriminant:
 *
 *     { action, operationId, scope, expectedRevision, payload }
 *
 * `operationId`, `scope` and `expectedRevision` are validated by the service's own input schema and are
 * passed through unchanged — above all `operationId`, which is the identity of the attempt and the only
 * reason a lost acknowledgement comes back as `alreadyAccepted` instead of a second effect. This file
 * never mints one. Each action carries its own payload, named exactly as the mutation that validates it
 * names it (no unit conversion happens here, so a client sends the unit the service states):
 *
 * - `setScenario` → `{ scenarioId }`
 * - `setClock` → `{ offsetIso }`, an ISO-8601 date-time that states its offset
 * - `advanceClock` → `{ bySeconds }`, a whole number of seconds greater than zero
 * - `setFailurePlan` → `{ mode, target: { kind: "read" | "mutation", name } }` to arm one failure, or
 *   `{ plan: null }` to disarm the armed one, and exactly one of the two forms per request
 * - `resetSeed` → `{}`, an empty object; the destructive confirmation belongs to the surface that asks
 *   for it, because the service's reset payload states no fields at all
 *
 * **One vocabulary owner each.** The payload schemas here validate *shape*: types, presence, bounds and
 * — because each is strict — a field the service does not validate. Which scenario ids exist, which
 * three modes may be armed, which targets are demonstrated and whether a clock reading is an instant the
 * clock accepts are the service's decisions, so they are neither enumerated nor copied here; a value
 * outside them comes back from the service as `invalid` with the field path that carried it. The same
 * discipline applies to the discriminant: five schemas whose `action` is a distinct literal can accept
 * one body at most once, and that count is asserted rather than assumed.
 *
 * **One response ladder.** Every branch answers through `toResponse`, and a throw is mapped by
 * `outcomeFromError` — a store or filesystem fault becomes `unavailable`, an unrecognised failure becomes
 * `unknown` carrying the caller's `operationId`. No status code, body shape or error message is written
 * by hand, so `unknown` stays distinct from success and from failure, and recovery is the same
 * `operationId` rather than a resend under a new one.
 *
 * **What it never does.** It never reads the session cookie itself (the service resolves the session),
 * never imports the synthetic store or the development runtime, never reads the environment directly,
 * never reads the wall clock — the elapsed figure is a `performance.now()` delta for the diagnostic
 * line, never a scenario instant — never writes to the console, never logs a payload, a seed value, a
 * scenario list, a path, an environment value, an email address or an amount, and never
 * offers a rate limit or a cache directive (AAP 0.6.3 states that none is implemented). It is not an
 * Edge route: the store writes through `node:fs`.
 *
 * Plan items that put this file in scope: AAP 0.6.3 (`GET/POST /api/dev` — "read/modify scenario, clock,
 * failure plan; `POST reset`", reachable only with a development session), 0.7.1 (the four-field
 * mutation input and the closed eight outcomes), 0.7.2 (the scenario clock as the only source of now,
 * the deterministic failure modes, "no secrets, no fallback"), 0.8.7 and assumptions A12 (a per-session
 * offset moved only by the development control, every boundary evaluated at read or command time) and
 * A13 (one failure armed for one named call at a time, visible through `GET`); 0.9.1 and 0.11.1 name
 * this path, 0.12.4 and 0.12.6 rely on its reset and on the absence of any configuration.
 *
 * Rule 1 obligations. *Clause 1 (preserve the agreed scope):* this handler is exactly the plan's
 * `GET/POST /api/dev`, and every stated deferral stays deferred — no provider client, no queue, no
 * scheduler, no webhook, no second development surface, no fallback to fixtures in a production build.
 * *Clause 2 (reuse the specified patterns, make the simplest sufficient decision):* one envelope, one
 * closed outcome union, one operation ledger and one scope resolver, all reached through
 * `@/modules/data-service` and nothing deeper; no generic command dispatcher, no capability registry, no
 * wrapper module and no second response ladder. *Clause 3 (preserve the meaning and completion of
 * included workflows):* a development read is never presented as record data, `unknown` stays distinct
 * from success and failure, and no note body, check-in, message body, email address, amount, path, seed
 * literal or environment value can travel in a response or a diagnostic line.
 */
import { z } from "zod";

import { isDevelopment, isRecord } from "@/lib/guards";
import { logger, type LogScope } from "@/lib/logger";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";
/* The two constructors come from the module that owns them rather than through the service barrel,
 * which re-exports the conversion helpers only: one constructor per outcome is what keeps denial
 * redaction mechanical, so an answer built here is built the same way every other answer is. */
import { denied, invalid } from "@/modules/data-service/outcome";

/**
 * Every request is evaluated per request: the service reads the development-session cookie, so the same
 * URL answers differently for two sessions and must never be served as a cached static answer.
 */
export const dynamic = "force-dynamic";

/** The synthetic store writes through `node:fs`, so the Edge runtime cannot serve this route. */
export const runtime = "nodejs";

// ---------------------------------------------------------------------------------------------
// The five named controls
// ---------------------------------------------------------------------------------------------

/**
 * The discriminants, in the order the panel lists them. This tuple is the whole set of actions this
 * handler accepts — a sixth is not a smaller decision but a different inventory.
 */
const DEV_ACTIONS = [
  "setScenario",
  "setClock",
  "advanceClock",
  "setFailurePlan",
  "resetSeed",
] as const;

/** One of the five named controls. */
type DevAction = (typeof DEV_ACTIONS)[number];

/** Membership as a lookup, so a parsed body's action is checked rather than trusted. */
const DEV_ACTION_SET: ReadonlySet<string> = new Set<string>(DEV_ACTIONS);

/**
 * The attempt marker a read answer carries where a mutation would carry its operation id.
 *
 * A `GET` performs no effect, so it has no operation to name and mints no identifier of its own.
 * `"read"` is the non-unique attempt marker the other read handlers answer with, which keeps a
 * failed read from looking like a change someone could replay.
 */
const READ_ATTEMPT_MARKER = "read";

/**
 * The attempt marker a request carries when no attempt was lodged.
 *
 * A body whose `operationId` is absent or unusable has no attempt identity, and inventing a canonical
 * one would offer a recovery handle that could find nothing. The identity a caller presents is used
 * whenever it is one; otherwise the marker says plainly that no attempt was established.
 */
const UNREACHED_ATTEMPT = "dev-route";

/** Longest text this handler accepts in a payload field or in the operation id it echoes. */
const WIRE_TEXT_LIMIT = 64;

/** Why a body carried no action this handler accepts. */
const ACTION_MESSAGE = `A development request names the action it asks for: ${DEV_ACTIONS.join(", ")}.`;

/**
 * Why a body could not be resolved to one action. Unreachable while the five discriminants are distinct
 * literals; stated because the one-match property is asserted here rather than assumed.
 */
const AMBIGUOUS_ACTION_MESSAGE = `A development request carries exactly one action, and ${DEV_ACTIONS.join(", ")} are five distinct names.`;

// ---------------------------------------------------------------------------------------------
// The payload vocabulary, owned by the service
// ---------------------------------------------------------------------------------------------

/**
 * The three payload fields whose vocabulary belongs to the service: the scenario registry, the three
 * failure modes and the names of the demonstrated targets.
 *
 * Each type is read from the mutation that validates it rather than imported from a second declaration,
 * so this route cannot hold a copy of a closed set that the service might extend. Only the shape is
 * checked here; membership is the service's `invalid` answer, keyed on the field that carried the value.
 */
type ScenarioIdWire = Parameters<typeof mutations.dev.setScenario>[0]["payload"]["scenarioId"];

/** Either form of a failure-plan payload, as the service's `setFailurePlan` declares them. */
type SetFailurePlanPayloadWire = Parameters<typeof mutations.dev.setFailurePlan>[0]["payload"];

/**
 * The arming member of that payload: the form that names a mode and a target, which is the only one
 * carrying the vocabulary below. The disarm member is the one that states a null plan instead.
 */
type ArmingFailurePlanPayloadWire = Exclude<SetFailurePlanPayloadWire, { plan: null }>;

type FailureModeWire = ArmingFailurePlanPayloadWire["mode"];
type FailureTargetNameWire = ArmingFailurePlanPayloadWire["target"]["name"];

/**
 * Validates a non-empty bounded text of a kind whose vocabulary the service owns.
 *
 * The predicate checks the shape only — a string, not blank, within the bound — because enumerating the
 * scenario ids, the failure modes or the target names here would make this file a second owner of them.
 * No trimming transform is applied: the caller's value is dispatched exactly as it arrived, so the
 * service judges the same bytes this handler did.
 */
function serviceWord<Word extends string>(): z.ZodType<Word> {
  return z.custom<Word>(
    (value) =>
      typeof value === "string" && value.trim().length > 0 && value.length <= WIRE_TEXT_LIMIT,
    `This field is a non-empty name of at most ${String(WIRE_TEXT_LIMIT)} characters.`,
  );
}

/** The scenario a session asks to run in; the service refuses an id this release does not define. */
const setScenarioPayload = z.strictObject({ scenarioId: serviceWord<ScenarioIdWire>() });

/** The instant a session asks its scenario clock to read, exactly as the clock states it. */
const setClockPayload = z.strictObject({ offsetIso: z.string().min(1).max(WIRE_TEXT_LIMIT) });

/**
 * The forward move a caller asks for: whole seconds, and only forwards.
 *
 * Both refusals state that rule rather than the schema library's vocabulary, and neither restates the
 * span the runtime enforces: that bound belongs to the mutation, which words it on the same field.
 */
const advanceClockPayload = z.strictObject({
  bySeconds: z
    .int({
      error:
        "A clock advance moves the scenario clock by whole seconds, so state the seconds to move by rather than a fraction of one.",
    })
    .positive({
      error:
        "A clock advance moves the scenario clock forward, so the seconds it moves by are greater than zero.",
    }),
});

/**
 * The failure to arm: one mode and one named call.
 *
 * `read` and `mutation` are the two kinds of call a plan can target and are part of the shape; which
 * modes exist and which names are demonstrated is the service's registry, reached by name alone.
 */
const armFailurePlanPayload = z.strictObject({
  mode: serviceWord<FailureModeWire>(),
  target: z.strictObject({
    kind: z.enum(["read", "mutation"]),
    name: serviceWord<FailureTargetNameWire>(),
  }),
});

/**
 * The disarm: one member stating the absent plan that replaces the armed one.
 *
 * It is the payload form of `setFailurePlan` that clears the failure, not a sixth action, because exactly
 * one failure is armed at a time (assumption A13).
 */
const disarmFailurePlanPayload = z.strictObject({ plan: z.null() });

/** The one member only the disarm states, which is what tells the payload's two forms apart. */
const DISARM_PLAN_MEMBER = "plan";

/**
 * The failure-plan payload, in either form: the failure to arm, or the disarm.
 *
 * Which form the body states is decided by the member only the disarm carries, and that form's own
 * schema answers with its own issues. Zod's `union` would report both forms' issues as one form-level
 * error carrying no field path, and a refusal the panel cannot place against the control that carried
 * the value is the defect this handler's payload schemas exist to avoid. The declared type is the
 * service's own union and this refinement is what holds a body to it, since which form a body states
 * has to be read before either schema can judge it.
 */
const setFailurePlanPayload: z.ZodType<SetFailurePlanPayloadWire> = z
  .custom<SetFailurePlanPayloadWire>()
  .superRefine((payload, ctx) => {
    const parsed =
      isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER)
        ? disarmFailurePlanPayload.safeParse(payload)
        : armFailurePlanPayload.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // The form's own message and field path are what a caller acts on; the machine code belongs to
        // the schema library, and an `invalid` outcome is keyed by the path and read for the message.
        ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
      }
    }
  });

/**
 * A reset states nothing: there is nothing a caller can choose about it.
 *
 * The destructive confirmation is asked by the surface that offers the control (the development panel's
 * review step), not by a payload field, because the service's reset payload refuses any field at all.
 */
const resetSeedPayload = z.custom<Parameters<typeof mutations.dev.resetSeed>[0]["payload"]>(
  (value) => isRecord(value) && Object.keys(value).length === 0,
  "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.",
);

// ---------------------------------------------------------------------------------------------
// One request schema per control
// ---------------------------------------------------------------------------------------------

/**
 * Builds the request schema of one control: its discriminant, then the service's own input envelope
 * around this control's payload shape.
 *
 * The service's input schema stays the only declaration of `operationId`, `scope` and
 * `expectedRevision` — including the canonical UUID form of an operation id — and it is strict, so a
 * body carrying a field the service does not validate is refused here with that field named rather than
 * quietly dropped.
 */
function requestSchema<P>(action: DevAction, payload: z.ZodType<P>): z.ZodType<MutationInput<P>> {
  return z.preprocess(
    (raw: unknown) => requestProjection(raw, action),
    mutationInputSchema(payload),
  );
}

/**
 * The four fields the service judges, with the discriminant removed, or `undefined` when this control is
 * not the one the body states.
 *
 * Returning `undefined` is how a schema declines a body it does not describe: the strict envelope then
 * reports that the input is not the object it expects, and the schema for the control the body *did*
 * name is the one whose messages are answered with.
 */
function requestProjection(raw: unknown, action: DevAction): Record<string, unknown> | undefined {
  if (!isRecord(raw) || raw.action !== action) {
    return undefined;
  }
  const projection: Record<string, unknown> = { ...raw };
  delete projection.action;
  return projection;
}

/** Which control the body asks for, and whether its own payload shape holds. */
const setScenarioRequest = requestSchema("setScenario", setScenarioPayload);
const setClockRequest = requestSchema("setClock", setClockPayload);
const advanceClockRequest = requestSchema("advanceClock", advanceClockPayload);
const setFailurePlanRequest = requestSchema("setFailurePlan", setFailurePlanPayload);
const resetSeedRequest = requestSchema("resetSeed", resetSeedPayload);

// ---------------------------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------------------------

/**
 * Reads the request body as JSON, answering `undefined` for a body that is absent or is not JSON.
 *
 * A malformed body is a request that states no action, so it reaches the same refusal as a body that
 * names none: `invalid` keyed on `action`, never a thrown parse error and never a 500.
 */
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

/** The attempt identity the caller presented, or the marker that says no attempt was established. */
function operationIdOf(body: unknown): string {
  if (isRecord(body)) {
    const presented = body.operationId;
    if (
      typeof presented === "string" &&
      presented.length > 0 &&
      presented.length <= WIRE_TEXT_LIMIT
    ) {
      return presented;
    }
  }
  return UNREACHED_ATTEMPT;
}

/** The control the body names, or `null` when it names none this handler accepts. */
function devActionOf(body: unknown): DevAction | null {
  if (!isRecord(body)) {
    return null;
  }
  const action = body.action;
  return isDevAction(action) ? action : null;
}

/** Reports whether a value names one of the five controls. */
function isDevAction(value: unknown): value is DevAction {
  return typeof value === "string" && DEV_ACTION_SET.has(value);
}

// ---------------------------------------------------------------------------------------------
// The outcomes this file may answer before a mutation runs
// ---------------------------------------------------------------------------------------------

/**
 * The denial a build without the development runtime answers with.
 *
 * `capability-absent` is the closed reason that describes the caller's relationship to the request when
 * the capability itself is not there: the outcome names no scenario, no clock, no plan and no reset, and
 * says nothing about whether a session exists.
 */
function developmentDenial(): MutationOutcome {
  return denied({ operationId: UNREACHED_ATTEMPT, reasonCode: "capability-absent" });
}

/** The refusal a body earns when it does not resolve to exactly one action this handler accepts. */
function refusalOnAction(operationId: string, message: string): MutationOutcome {
  return invalid({ operationId, fields: { action: [message] } });
}

// ---------------------------------------------------------------------------------------------
// Dispatch: one named mutation, one attempt line, one response ladder
// ---------------------------------------------------------------------------------------------

/** One dispatched attempt: the identity it carries, the scope it acts in and when it began. */
interface DispatchedAttempt {
  readonly operationId: string;
  readonly scope: LogScope;
  readonly startedAt: number;
}

/**
 * Calls the one named mutation and answers with its outcome, through the one ladder.
 *
 * The caller's four fields reach the mutation unchanged, so a replay is recognised by identity rather
 * than by a guessed payload. A throw is mapped rather than propagated: a store fault becomes
 * `unavailable` with the source that could not answer, and anything unrecognised becomes `unknown` with
 * the caller's `operationId` for recovery. The attempt is recorded as this transport saw it — one line
 * naming the operation, the scope, the outcome and the elapsed milliseconds, and for an outage the
 * identity of the source — and the payload is not part of that line, by the logger's own construction.
 */
async function dispatchAttempt(
  attempt: DispatchedAttempt,
  call: () => Promise<MutationOutcome>,
): Promise<Response> {
  let outcome: MutationOutcome;
  try {
    outcome = await call();
  } catch (error) {
    outcome = outcomeFromError(attempt.operationId, error);
  }

  logger.mutation({
    operationId: attempt.operationId,
    scope: attempt.scope,
    outcome: outcome.outcome,
    elapsedMs: performance.now() - attempt.startedAt,
  });
  if (outcome.outcome === "unavailable") {
    logger.sourceUnavailable({ job: "dev", source: outcome.source });
  }

  return toResponse(outcome);
}

// ---------------------------------------------------------------------------------------------
// The handlers
// ---------------------------------------------------------------------------------------------

/**
 * Reports this session's development runtime — the scenario, the clock offset and the instant it derives,
 * the one armed failure plan, the advertised modes and named targets, the seeded personas, the
 * scenario's availability flags and whether a reset is available — as the development read's envelope,
 * unchanged.
 *
 * Outcomes: the envelope (200), `denied` without any development detail outside a development build,
 * `unavailable` or `unknown` for a thrown store or unrecognised fault, or the read's own
 * `unavailable`/`denied`. Nothing is filtered, recomputed or selected by query parameter, so the panel
 * offers exactly what the service advertises.
 */
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

/**
 * Operates exactly one of the five named development controls and answers with one of the closed
 * outcomes: `accepted`, `alreadyAccepted` for a replay of the same `operationId` with the same intent,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 *
 * The body is refused before anything is dispatched when it names no action this handler accepts, and
 * when it names one whose own schema rejects it — the second case answering with the service-mapped
 * messages for the offending field path.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDevelopment()) {
    return toResponse(developmentDenial());
  }

  const startedAt = performance.now();
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
  const accepted = [scenario, clock, advanced, plan, reset].filter(
    (attempt) => attempt.success,
  ).length;

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
      return dispatchAttempt({ operationId, scope: input.scope, startedAt }, () =>
        mutations.dev.setScenario(input),
      );
    }
    case "setClock": {
      if (!clock.success) {
        return toResponse(outcomeFromError(operationId, clock.error));
      }
      const input = clock.data;
      return dispatchAttempt({ operationId, scope: input.scope, startedAt }, () =>
        mutations.dev.setClock(input),
      );
    }
    case "advanceClock": {
      if (!advanced.success) {
        return toResponse(outcomeFromError(operationId, advanced.error));
      }
      const input = advanced.data;
      return dispatchAttempt({ operationId, scope: input.scope, startedAt }, () =>
        mutations.dev.advanceClock(input),
      );
    }
    case "setFailurePlan": {
      if (!plan.success) {
        return toResponse(outcomeFromError(operationId, plan.error));
      }
      const input = plan.data;
      return dispatchAttempt({ operationId, scope: input.scope, startedAt }, () =>
        mutations.dev.setFailurePlan(input),
      );
    }
    case "resetSeed": {
      if (!reset.success) {
        return toResponse(outcomeFromError(operationId, reset.error));
      }
      const input = reset.data;
      return dispatchAttempt({ operationId, scope: input.scope, startedAt }, () =>
        mutations.dev.resetSeed(input),
      );
    }
  }
}
