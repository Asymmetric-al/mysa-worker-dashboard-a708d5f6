/**
 * The six request-path mutations of the development runtime: the context switch every session uses to
 * choose the ministry it acts in, and the five controls the development panel operates — the scenario,
 * the scenario clock's absolute offset, a forward clock advance, one armed simulated failure, and the
 * deterministic reset.
 *
 * **Why the context switch lives here.** AAP 0.7.1 puts `selectContext` under the visible job "Enter
 * and change context", and the fixed nine-file mutation inventory has no shell module, so it is the
 * first export in this file. It is an ordinary signed-in action and is deliberately *not* gated to a
 * development build: choosing a context is how a principal admitted to two ministries acts in either,
 * and a real authenticated build would switch contexts the same way. The other five are the
 * development runtime's own knobs, and every one of them asks the development boundary before it
 * touches state, so a production build answers `denied` rather than quietly running a scenario, a
 * clock offset, an armed failure or a reset (AAP 0.7.2: production never falls back to fixtures).
 *
 * **The two constraints that fix this file's shape.**
 *
 * 1. `runMutation` owns the transaction. Every mutation validates its own payload schema, has the
 *    caller's scope asserted, answers a replay from the ledger, compares `expectedRevision`, applies,
 *    re-checks the produced scope and records the ledger entry inside one store transaction that the
 *    runner opens and closes (AAP 0.7.1). This file never calls `transact`, never reads a session's
 *    documents itself, never compares a revision and never writes a ledger entry, so the replay
 *    guarantee and the conflict semantics have exactly one implementation.
 * 2. The development runtime's own controls take the same session's lock. `scenario.ts#setScenario`,
 *    `setClock` and `advanceClock` persist the `.meta.json` document through a transaction of their
 *    own, and `reset.ts#resetSeed` replaces every session's document set, this session's included. The
 *    store's mutex is deliberately not re-entrant — one acquisition per operation — so calling any of
 *    them from inside the runner's transaction would wait on itself for ever. They are therefore
 *    called *between* two passes of the runner:
 *    - a **probe** pass, whose apply changes nothing, establishes everything the answer may depend on
 *      — the envelope and payload are well formed, the caller is admitted and holds the authority, the
 *      attempt is not a replay, the caller's `expectedRevision` is current, and the document the
 *      control would rewrite is readable — and answers that outcome itself whenever it is not
 *      `unchanged`;
 *    - the **change**, performed by the dev-runtime module that owns it, only after the probe has
 *      authorised it;
 *    - a **record** pass, whose apply reports the change the probe authorised, so the operation
 *      identity and its opaque result reach the ledger and replaying it recovers them instead of
 *      running the control a second time.
 *    `setFailurePlan` is the one control whose effect is a pure function of the document it read
 *    (`failures.ts#setFailurePlan` stores nothing), so its document is written inside the recording
 *    pass's transaction; its probe still runs first, because a document this release cannot read is
 *    `unavailable` rather than something a mutation may quietly overwrite.
 *
 * **A control is operated from a session that can act.** The runner asserts the claimed scope — and so
 * the admission gate — before a mutation's own authority question, which is what makes every record
 * write refuse a session that grants nothing. A session in `denied`, `expired` or `no-access` therefore
 * leaves that state by switching session first — the persona switch the development panel offers — and
 * only then changes the scenario, the clock or the seed. The read side is answerable for every session
 * because it changes nothing; a write is not, because a session that grants nothing holds no scope to
 * name.
 *
 * **The context switch is one transaction.** It writes the development document, which is the
 * authority `authorize.ts#resolveSession` reads, and the state document's context record, which is the
 * selection the shell displays and whose revision the client presents as `expectedRevision` — together,
 * so the persisted selection moves atomically and a response that started in the old context cannot be
 * mistaken for the new one's (AAP 0.6.2 "Session context", 0.6.3 `POST /api/session/context`).
 *
 * **What this file never does**, by construction rather than by discipline: it reads no wall clock —
 * the scenario clock is the only source of now, and only `dev-runtime/scenario.ts` moves it — draws no
 * randomness, opens no file, logs no payload, note, address, identifier or seed value, and never
 * answers with a boolean instead of one of the eight outcomes. It starts no timer, schedules nothing
 * and observes nothing in the background: every boundary the release defines is evaluated at read or
 * command time against the offset this file's controls move (assumption A12).
 *
 * **Rule 1 obligations.** *Clause 1 (preserve the agreed scope):* this is the development runtime's
 * complete write surface and nothing else — no CI hook, no deployment machinery, no environment
 * template, no provider client and no scaffolding for a deferred integration appears here, and
 * `selectContext` stays an ordinary signed-in mutation instead of being folded into the development
 * gate. *Clause 2 (reuse the specified patterns):* one runner, one ledger, one schema per mutation,
 * one clock, one failure plan, one reset and one revision token (imported from
 * `dev-runtime/scenario.ts#devStateRevision` rather than re-derived). *Clause 3 (preserve meaning
 * and completion):* a lost acknowledgement stays `unknown` and is recovered by `operationId`, a
 * replay returns the stored result with no second effect, a reset restores the known seed and
 * reports only what it did, and a context switch never discards unsaved work silently.
 *
 * Layering: the write layer of the data service. It imports the guard of the development boundary, the
 * one authorisation module, the envelope and outcome contracts, the runner, the development runtime's
 * scenario, failure-plan and reset modules, and the scenario clock. It imports no component, feature or
 * application route, and it reaches the store only through `runMutation` — never through the store's
 * repository module, and never through a filesystem call of its own.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { assertDevelopmentOnly, isRecord } from "@/lib/guards";
import { logger } from "@/lib/logger";
import {
  assertScope,
  canView,
  resolveSession,
  type ResolvedSession,
  type ScopeDecision,
  type SessionSource,
} from "@/modules/data-service/authorize";
import {
  ministryIdSchema,
  organizationIdSchema,
  sessionContextRecordSchema,
  supportSubjectIdSchema,
  type OrganizationId,
  type MinistryId,
  type MutationInput,
  type Scope,
  type SessionContextRecord,
  type SupportSubjectId,
} from "@/modules/data-service/envelope";
import {
  LOCAL_STORE_SYSTEM,
  ROOT_FIELD_KEY,
  conflict,
  denied,
  invalid,
  unchanged,
  unavailable,
  type MutationOutcome,
  type MutationResult,
} from "@/modules/data-service/outcome";
import { runMutation } from "@/modules/data-service/operations";
import {
  DEMONSTRABLE_TARGETS,
  EMPTY_FAILURE_PLAN,
  disarmFailurePlan,
  setFailurePlan as armFailurePlan,
  type FailureMode,
  type FailurePlanRefusal,
  type FailureTargetKind,
} from "@/modules/dev-runtime/failures";
import { resetSeed as resetDevelopmentSeed, type ResetSummary } from "@/modules/dev-runtime/reset";
import {
  CLOCK_OFFSET_LIMIT_MS,
  DEV_SOURCE,
  SCENARIO_IDS,
  advanceClock as advanceSessionClock,
  devStateRevision,
  isScenarioId,
  parseSessionMeta,
  setClock as applySessionClock,
  setScenario as applySession,
  type ScenarioId,
  type SessionControlRefusal,
  type SessionMetaDocument,
} from "@/modules/dev-runtime/scenario";
import { SEED_INSTANT, instantAt } from "@/modules/time/clock";

// ---------------------------------------------------------------------------------------------
// The session a request acts for
// ---------------------------------------------------------------------------------------------

/**
 * The id a request that established no session is answered under.
 *
 * A mutation's plan needs the session id before the runner is called, because that id keys the store
 * documents and the transaction lock. When no session can be established there is nothing to key, and
 * this file passes the absent id through to the runner rather than answering the refusal itself: the
 * runner's own session lookup refuses an id that names no session, so the `denied` outcome keeps its
 * single shape, its single reason code and the caller's own operation identity, and no second
 * resolution path appears here.
 */
const NO_SESSION_ID = "";

/** The session a request acts for, as the two references a mutation's plan and its token need. */
interface ActingSession {
  /** The id that keys the session's store documents; absent when no session was established. */
  readonly sessionId: string;
  /** The acting principal, which the development document's revision token includes. */
  readonly principalId: string;
}

/**
 * Resolves the session this request acts for, in the order the runner resolves it.
 *
 * The development-session cookie is the ordinary path. A caller that holds a session id and no request
 * scope — the domain and integration tests that prove a control against a seeded session, an
 * operational script — names it through {@link SessionSource}, which `authorize.ts` gates to a
 * development build. Whichever path answers, the id returned here is a fact about the request rather
 * than authority: the runner re-resolves the session, asserts the claimed scope and asks this
 * mutation's own authority question before anything is written, so a resolution this file got wrong
 * cannot authorise a change.
 */
async function actingSessionContext(source?: SessionSource): Promise<ActingSession> {
  try {
    const fromRequest = await resolveSession();
    if (fromRequest.ok) {
      return {
        sessionId: fromRequest.session.sessionId,
        principalId: fromRequest.session.principalId,
      };
    }
  } catch {
    // `next/headers` has no request to read outside a request scope, which is a test or a script
    // rather than a browser: the named path below serves it.
  }

  if (source === undefined) {
    return { sessionId: NO_SESSION_ID, principalId: "" };
  }

  try {
    const named = await resolveSession(source);
    if (named.ok) {
      return { sessionId: named.session.sessionId, principalId: named.session.principalId };
    }
  } catch {
    // Naming a session directly is refused outside a development build, and a refusal to name one is
    // not a session: the absent id lets the runner answer with the one refusal shape.
  }

  return { sessionId: NO_SESSION_ID, principalId: "" };
}

// ---------------------------------------------------------------------------------------------
// Authority and the development boundary
// ---------------------------------------------------------------------------------------------

/**
 * The authority question the five development controls ask: the build, never a membership.
 *
 * `authorize.ts` answers the `dev-runtime` target from the build the application runs in and does so
 * before the admission gate, because moving a scenario, a clock or an armed failure is how a
 * demonstration of an unavailable source or a partial release is set up. It is asked as a permission
 * question rather than asserted with a throwing guard, because a mutation answers with a value: outside
 * a development build the answer is the closed `denied` outcome with the reason code the authorisation
 * module gives, which discloses nothing.
 */
function developmentAuthority(session: ResolvedSession): ScopeDecision {
  const access = canView(session, { kind: "dev-runtime" });
  return access.allowed ? { ok: true } : { ok: false, denial: access.denial };
}

/**
 * Why a development document that cannot be read is `unavailable` rather than a default.
 *
 * A session whose `.meta.json` this release cannot parse has no honest scenario, offset or failure
 * plan to report, and presenting one anyway — `baseline`, offset `0`, nothing armed — would make every
 * demonstration of an unavailable source, a continuation policy or a partial release prove nothing.
 * The guidance names the one recovery that rebuilds the documents deterministically.
 */
const DEVELOPMENT_DOCUMENT_GUIDANCE =
  "Reload the page to read this session's development document again; if it stays unreadable, reset the development seed, which lays every seeded session down again deterministically.";

/**
 * Why a session's context record that cannot be read is `unavailable` rather than a default.
 *
 * The context record is the root of scope: a session whose state document carries no readable record
 * has no selection to report and no revision to advance, and inventing one — the first admitted
 * membership, the organisation it happens to start with — would hand a request authority it never
 * asked for. The guidance names the one recovery that lays the session's documents down again.
 */
const SESSION_STATE_GUIDANCE =
  "Reload the page to read this session's context record again; if it stays unreadable, reset the development seed, which lays every seeded session's documents down again deterministically.";

/** The source identity a session's own context record carries when it cannot be read. */
const SESSION_STATE_SOURCE_REFERENCE = "session-state";

/** The source identity a reset that could not complete carries, so a surface can name what is down. */
const RESET_SOURCE_REFERENCE = "reset";

/** The guidance a reset that threw leaves the person: the store, not the request, is what failed. */
const RESET_GUIDANCE =
  "Reload the page to check whether the store was reset; if it stays unavailable, run the reset from the terminal, which reports the sessions it laid down.";

/**
 * The one place an answer this file builds itself is reported as an outage.
 *
 * The runner writes the diagnostic line for every outcome it produces, so the `unavailable` answers
 * built here — a development document this release cannot read, a context record it cannot read, and a
 * reset that threw — would otherwise be the only outages in the application with no line in the local
 * log. They go through the shared logger with its own source record and nothing else: no session id, no
 * document content, no seed value. An answer this file reaches on its own is decided before or beside
 * the runner's passes, so it writes the source line and no attempt line: there is no attempt the runner
 * answered to count.
 */
function sourceUnavailable(
  operationId: string,
  source: { readonly system: string; readonly reference: string },
  guidance: string,
): MutationOutcome {
  logger.sourceUnavailable({ job: "development-runtime", source });
  return unavailable({ operationId, source, guidance });
}

/** The `unavailable` answer for a development document this release cannot read. */
function developmentDocumentUnavailable(operationId: string): MutationOutcome {
  return sourceUnavailable(operationId, DEV_SOURCE, DEVELOPMENT_DOCUMENT_GUIDANCE);
}

/** The `unavailable` answer for a session's context record this release cannot read. */
function sessionStateUnavailable(operationId: string): MutationOutcome {
  return sourceUnavailable(
    operationId,
    { system: DEV_SOURCE.system, reference: SESSION_STATE_SOURCE_REFERENCE },
    SESSION_STATE_GUIDANCE,
  );
}

// ---------------------------------------------------------------------------------------------
// The revision tokens this file advances
// ---------------------------------------------------------------------------------------------

/**
 * The next revision token of a record this mutation changed.
 *
 * A revision is an opaque token whose only contract is that it differs after every accepted write, so
 * the token the seed mints (`rev-1`) is advanced by incrementing its trailing number and any other
 * shape gains a suffix. Nothing parses depth, order or meaning out of the result; a caller compares it
 * for equality with the value it read, which is all the optimistic-concurrency check needs.
 */
function nextRevision(previous: string): string {
  const trailing = /^(.*?)(\d+)$/.exec(previous);
  if (trailing === null) {
    return `${previous}.1`;
  }
  const prefix = trailing[1] ?? "";
  const current = Number(trailing[2] ?? "");
  return Number.isSafeInteger(current) ? `${prefix}${String(current + 1)}` : `${previous}.1`;
}

// ---------------------------------------------------------------------------------------------
// The probe pass
// ---------------------------------------------------------------------------------------------

/**
 * What the probe established: an outcome to return, a document it could not read, or the document the
 * control may act on.
 *
 * `answer` carries the runner's own outcome — `invalid`, `denied`, `alreadyAccepted`, `conflict` — and
 * is returned unchanged, because the runner built it from the ledger, the scope assertion and the
 * revision comparison. `unreadable` is the one fact the runner cannot express, and `document` is a
 * request that was authorised, is not a replay and would change something.
 */
type DevelopmentProbe =
  | { readonly kind: "answer"; readonly outcome: MutationOutcome }
  | { readonly kind: "unreadable"; readonly operationId: string }
  | {
      readonly kind: "document";
      readonly meta: SessionMetaDocument;
      readonly revision: string;
    };

/** One development control's request to the probe. */
interface ProbeRequest<P extends MutationResult> {
  /** The session the control acts for, as {@link actingSessionContext} resolved it. */
  readonly sessionId: string;
  /** The acting principal, because the document's revision token includes it. */
  readonly principalId: string;
  /** The four-field request as it arrived. */
  readonly input: MutationInput<P>;
  /** The payload's own schema, which the runner validates before anything else. */
  readonly schema: z.ZodType<P>;
  /** The control's name, as the diagnostic line and any armed failure plan know it. */
  readonly name: string;
  /** The development control being reached, named in the boundary assertion. */
  readonly developmentControl: string;
}

/**
 * Runs the pass that authorises a development control and reports the document it would rewrite.
 *
 * The apply changes nothing — it reads the stored development document and returns
 * `{ changed: false }`, which makes the runner answer `unchanged` for a request that reached this
 * point. Everything else the runner answers is returned as it stands: an invalid payload, a refused
 * session, a replay (with the result the first call was given) or a conflict. The development boundary
 * is asserted at the head of that apply, before the document is read and before any state or
 * diagnostic, so the boundary is stated at the write itself and not only in the authority question
 * above it.
 *
 * The pass states `diagnosticPass: "probe"`, so the runner writes no line for the `unchanged` that
 * sends this control on to its change: that outcome is this file's carry-on signal, not the answer the
 * caller received, and the attempt's one line is the record pass's line for the outcome that answered.
 * The control's anomalies are unaffected — a replay, a stale revision, a refused session or a payload
 * the schema rejects is the caller's answer, and the runner writes its line for it here.
 *
 * The caller's `expectedRevision` is compared against the token the read published
 * (`dev-runtime/scenario.ts#devStateRevision`, imported rather than re-derived), so a control
 * submitted from a panel that has since moved is a `conflict` with the current document beside the
 * caller's request instead of an overwrite.
 *
 * Two controls submitted at the same instant can both pass their probes, and each then performs its
 * own change: two presses of the advance button move the clock twice, exactly as two presses mean.
 * Nothing here pretends otherwise, and no lock is held across the passes — the store's per-session
 * mutex serialises each write, which is the concurrency boundary this runtime states.
 */
async function probeDevelopmentDocument<P extends MutationResult>(
  request: ProbeRequest<P>,
): Promise<DevelopmentProbe> {
  let observed: SessionMetaDocument | undefined;

  const outcome = await runMutation<P, MutationResult>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    diagnosticPass: "probe",
    authorize: developmentAuthority,
    readCurrent: (documents) => {
      const parsed = parseSessionMeta(documents.meta);
      return parsed.ok
        ? {
            kind: "record",
            revision: devStateRevision(parsed.value, request.principalId),
            value: parsed.value,
          }
        : { kind: "absent" };
    },
    apply: (context) => {
      assertDevelopmentOnly(request.developmentControl);
      const parsed = parseSessionMeta(context.docs.meta);
      if (parsed.ok) {
        observed = parsed.value;
      }
      return { changed: false };
    },
  });

  if (outcome.outcome !== "unchanged") {
    return { kind: "answer", outcome };
  }
  if (observed === undefined) {
    return { kind: "unreadable", operationId: request.input.operationId };
  }
  return {
    kind: "document",
    meta: observed,
    revision: devStateRevision(observed, request.principalId),
  };
}

/**
 * Records a change the probe authorised and the development runtime has already performed.
 *
 * This pass compares no revision: the caller's `expectedRevision` was checked against the state the
 * probe read, and the state has deliberately moved since — comparing it again against the document the
 * change produced would turn every accepted control into a conflict. It writes the ledger entry in the
 * runner's own transaction, with the same payload and therefore the same intent hash the first call
 * used, so replaying the caller's `operationId` answers `alreadyAccepted` with the stored result and
 * runs the control no second time.
 */
async function recordDevelopmentChange<P extends MutationResult, R extends MutationResult>(
  request: {
    readonly sessionId: string;
    readonly input: MutationInput<P>;
    readonly schema: z.ZodType<P>;
    readonly name: string;
  },
  change: {
    /** The revision the caller may present next: the document's own token after the change. */
    readonly revision: string;
    /** The opaque result a replay returns verbatim. */
    readonly result: R;
    /** Identifiers the operation created, when it created any. */
    readonly created?: readonly string[];
  },
): Promise<MutationOutcome> {
  return runMutation<P, R>({
    sessionId: request.sessionId,
    input: request.input,
    schema: request.schema,
    name: request.name,
    authorize: developmentAuthority,
    apply: () => ({
      changed: true,
      revision: change.revision,
      result: change.result,
      ...(change.created === undefined ? {} : { created: change.created }),
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// selectContext — enter and change context
// ---------------------------------------------------------------------------------------------

/** The decisions a caller may state for work it has not saved before a context switch. */
export const UNSAVED_WORK_RESOLUTIONS = ["save", "discard", "stay"] as const;

/** One stated decision about unsaved work; the closed three-value choice the guard offers. */
export type UnsavedWorkResolution = (typeof UNSAVED_WORK_RESOLUTIONS)[number];

/**
 * The context a caller asks to move to.
 *
 * The acting principal is deliberately absent: it is the session's, never a choice a surface offers, so
 * a request cannot name another person as the one acting. The three identifiers are opaque references
 * with different owners, and `resolveUnsavedWork` is the caller's own statement about work it is
 * holding — the runtime keeps no such flag, because unsaved input lives in the surface that holds it.
 */
export type SelectContextPayload = {
  readonly organizationId: OrganizationId;
  readonly ministryId: MinistryId;
  readonly supportSubjectId: SupportSubjectId;
  readonly resolveUnsavedWork?: UnsavedWorkResolution;
};

/** The selection that is authoritative after the switch, and what happened to the caller's work. */
export type SelectContextResult = {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly revision: string;
  readonly unsavedWork: UnsavedWorkResolution | "none";
};

/** The three selections a stored context record states once a context has been chosen. */
interface StoredSelection {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
}

const selectContextPayloadSchema: z.ZodType<SelectContextPayload> = z.strictObject({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
  resolveUnsavedWork: z.enum(UNSAVED_WORK_RESOLUTIONS).optional(),
});

/**
 * The stored context record a state document carries, or `undefined` when it carries none this release
 * can read.
 *
 * The record's shape is `envelope.ts`'s — the single declaration of the vocabulary — so a field the
 * contract gains is read here instead of being stripped by a second copy of the schema.
 */
function storedContextRecord(state: unknown): SessionContextRecord | undefined {
  if (!isRecord(state)) {
    return undefined;
  }
  const parsed = sessionContextRecordSchema.safeParse(state.context);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The three selections a stored record states, or `undefined` while it states none.
 *
 * A partial selection is not a context: unless all three are present, nothing is, and no organisation,
 * ministry or support subject is ever substituted for a missing one.
 */
function storedSelection(record: SessionContextRecord): StoredSelection | undefined {
  const { selectedOrganizationId, selectedMinistryId, selectedSupportSubjectId } = record;
  if (
    selectedOrganizationId === null ||
    selectedMinistryId === null ||
    selectedSupportSubjectId === null
  ) {
    return undefined;
  }
  return {
    organizationId: selectedOrganizationId,
    ministryId: selectedMinistryId,
    supportSubjectId: selectedSupportSubjectId,
  };
}

/** Reports whether two selections name the same context; the acting principal is not part of either. */
function sameSelection(left: StoredSelection, right: StoredSelection): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.ministryId === right.ministryId &&
    left.supportSubjectId === right.supportSubjectId
  );
}

/**
 * Switches the context this session acts in and answers one of the eight outcomes.
 *
 * The target context must be admitted for the acting principal — all three references together, as one
 * membership — or the answer is `denied` with a reason code that names the caller's relationship and
 * nothing it asked about, so a refusal discloses neither the existence of another context nor its
 * identifiers. The claimed scope is asserted separately by the runner, which is what makes the switch
 * act from a context the caller genuinely holds.
 *
 * Work the caller has not saved is never discarded silently. `stay` answers `conflict` with the
 * selection in force beside the caller's request, which is the shape the guard renders and the one
 * outcome where the person's own decision is returned as the result; `save` and `discard` proceed and
 * are recorded in the result. An absent decision proceeds, because the runtime keeps no unsaved-work
 * flag — the surface that holds the input is the only thing that knows, and the guard is what asks.
 *
 * Answers `accepted` (the selection is now authoritative, with the revision the caller may present
 * next), `alreadyAccepted` for a replay, `unchanged` when the context is already the one asked for,
 * `conflict` for a stale `expectedRevision` or a stated `stay`, `denied` when the target is not
 * admitted, `invalid` for a malformed payload, and `unavailable` when the session's state or
 * development document cannot be read.
 */
export async function selectContext(
  input: MutationInput<SelectContextPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);

  // The mutation's own authority question: the context being moved *to* must be an admitted membership
  // of the acting principal. The principal comes from the session, never from the payload, so a
  // request cannot nominate the person it acts for.
  const authorize = (session: ResolvedSession): ScopeDecision => {
    const selection = selectContextPayloadSchema.safeParse(input.payload);
    if (!selection.success) {
      // Unreachable through the runner, which validates the payload before it asks this question; a
      // caller that reached it could not be admitted to a context it did not state.
      return {
        ok: false,
        denial: denied({ operationId: input.operationId, reasonCode: "no-permission" }),
      };
    }
    const target: Scope = {
      organizationId: selection.data.organizationId,
      ministryId: selection.data.ministryId,
      supportSubjectId: selection.data.supportSubjectId,
      principalId: session.principalId,
    };
    return assertScope(session, target);
  };

  // The probe reads the context record the caller's revision belongs to and changes nothing, so an
  // attempt that is invalid, refused, a replay or stale is answered before the switch is attempted and
  // an unreadable record is reported as an outage instead of being overwritten. It states
  // `diagnosticPass: "probe"`, so the `unchanged` it answers to move this function on to the switch
  // writes no diagnostic line: the caller's answer is the switch's own outcome, and that is the
  // attempt's one line. A switch that finds the context already in force answers `unchanged` from this
  // probe, so it writes no line at all — the module decided that answer itself, before the change.
  let observed: SessionContextRecord | undefined;

  const probe = await runMutation<SelectContextPayload, MutationResult>({
    sessionId: acting.sessionId,
    input,
    schema: selectContextPayloadSchema,
    name: "selectContext",
    diagnosticPass: "probe",
    authorize,
    readCurrent: (documents) => {
      const stored = storedContextRecord(documents.state);
      observed = stored;
      if (stored === undefined) {
        return { kind: "absent" };
      }
      return {
        kind: "record",
        revision: stored.revision,
        value: storedSelection(stored) ?? null,
      };
    },
    apply: () => ({ changed: false }),
  });

  if (probe.outcome !== "unchanged") {
    return probe;
  }
  if (observed === undefined) {
    return sessionStateUnavailable(input.operationId);
  }

  // Validated by the probe before it reached this point.
  const target: StoredSelection = {
    organizationId: input.payload.organizationId,
    ministryId: input.payload.ministryId,
    supportSubjectId: input.payload.supportSubjectId,
  };
  const current = storedSelection(observed);
  if (current !== undefined && sameSelection(current, target)) {
    // Nothing to switch: the runner's own `unchanged`, with the revision the caller read.
    return probe;
  }

  const resolution = input.payload.resolveUnsavedWork;
  if (resolution === "stay") {
    // The caller resolved to keep the work it holds. The two-member reason set has no value for a
    // decision, and this is provably not a reused attempt identity, so the answer states the half that
    // is stale — the caller's view of the switch it can make — and carries the selection in force
    // beside the request, which is exactly what the guard puts side by side for the person to compare.
    return conflict({
      operationId: input.operationId,
      currentRevision: observed.revision,
      current: current ?? null,
      preservedInput: input.payload,
      reason: "stale-revision",
    });
  }

  // The switch: the development document is the authority the session resolver reads, and the state
  // record's context is the selection the shell displays and whose revision the caller presents next.
  // Both move in one transaction, so a response that started in the old context cannot be mistaken for
  // the new one's — the fence the client raises around its cache is backed by a single atomic write.
  return runMutation<SelectContextPayload, SelectContextResult>({
    sessionId: acting.sessionId,
    input,
    schema: selectContextPayloadSchema,
    name: "selectContext",
    authorize,
    readCurrent: (documents) => {
      const stored = storedContextRecord(documents.state);
      return stored === undefined
        ? { kind: "absent" }
        : { kind: "record", revision: stored.revision, value: storedSelection(stored) ?? null };
    },
    apply: (context) => {
      const meta = context.docs.meta;
      if (!isRecord(meta)) {
        // Unreachable: the runner resolved this session from this same document, so a development
        // document that is not an object would have been refused before the transaction opened. If it
        // ever were reached, no selection can become authoritative, so nothing changed.
        return { changed: false };
      }

      const stateRecord = isRecord(context.docs.state) ? context.docs.state : undefined;
      const stored = stateRecord === undefined ? undefined : storedContextRecord(stateRecord);
      const revision =
        stored === undefined ? input.expectedRevision : nextRevision(stored.revision);

      context.docs.meta = { ...meta, selectedContext: { ...target } };
      if (stateRecord !== undefined && stored !== undefined) {
        context.docs.state = {
          ...stateRecord,
          context: {
            ...stored,
            selectedOrganizationId: target.organizationId,
            selectedMinistryId: target.ministryId,
            selectedSupportSubjectId: target.supportSubjectId,
            revision,
          },
        };
      }

      const result: SelectContextResult = {
        organizationId: target.organizationId,
        ministryId: target.ministryId,
        supportSubjectId: target.supportSubjectId,
        revision,
        unsavedWork: resolution ?? "none",
      };
      return { changed: true, revision, result };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Refusals the development runtime answers with a value
// ---------------------------------------------------------------------------------------------

/**
 * Maps a refusal a development control answered with into the closed outcome set.
 *
 * The control functions report a refusal rather than throwing, so this is the one place their five
 * codes become outcomes: an unreadable development document is an outage; a session the store no longer
 * holds is the denial a vanished session gets everywhere; and a value this release does not define or
 * cannot represent is `invalid`, keyed by the payload field that carried it, so the panel places the
 * message the way every other form does.
 */
function controlRefusal(
  operationId: string,
  refusal: SessionControlRefusal,
  field: string,
): MutationOutcome {
  switch (refusal.code) {
    case "meta-unreadable":
      return developmentDocumentUnavailable(operationId);
    case "unknown-session":
      return denied({ operationId, reasonCode: "session-unavailable" });
    case "unknown-scenario":
    case "invalid-offset":
    case "out-of-range-offset":
      return invalid({ operationId, fields: { [field]: [refusal.message] } });
  }
}

/**
 * Maps a refused arming request into the closed outcome set.
 *
 * A target or a mode the registry does not pair is a payload problem and is keyed by the field that
 * carried it. A plan that is already armed is a form-level condition rather than a field: the request
 * is well formed and the state refuses it, and the refusal's own message names what is armed and the
 * one step that clears it, so the person can act on it without a second control existing here.
 */
function failurePlanRefusal(operationId: string, refusal: FailurePlanRefusal): MutationOutcome {
  switch (refusal.code) {
    case "unknown-target":
      return invalid({ operationId, fields: { "target.name": [refusal.message] } });
    case "mode-not-demonstrable-on-target":
      return invalid({ operationId, fields: { mode: [refusal.message] } });
    case "malformed-plan":
    case "already-armed":
      return invalid({ operationId, fields: { [ROOT_FIELD_KEY]: [refusal.message] } });
  }
}

/** One millisecond as a count of nanoseconds, the unit an instant is exact in. */
const MILLISECOND_NANOSECONDS = 1_000_000n;

/**
 * Reads a scenario clock reading as an offset from the seed instant.
 *
 * The instant is what a person states — the panel shows the derived instant — and the offset from one
 * fixed anchor is what the clock and every boundary evaluation use, so the conversion happens here and
 * nowhere else. Three readings are refused: a value that names no instant, one that lands between
 * milliseconds (an offset the clock cannot represent exactly, which would silently round a boundary),
 * and one outside the ten-year span the scenario clock keeps, past which every window reads expired and
 * no demonstrable boundary remains.
 */
function clockOffsetMilliseconds(instantText: string): number | undefined {
  if (typeof instantText !== "string" || instantText.length === 0) {
    return undefined;
  }

  let instant: Temporal.Instant;
  try {
    instant = Temporal.Instant.from(instantText);
  } catch {
    return undefined;
  }

  if (instant.epochNanoseconds % MILLISECOND_NANOSECONDS !== 0n) {
    return undefined;
  }

  const offsetMilliseconds = instant.epochMilliseconds - SEED_INSTANT.epochMilliseconds;
  return Math.abs(offsetMilliseconds) <= CLOCK_OFFSET_LIMIT_MS ? offsetMilliseconds : undefined;
}

/** Why a clock reading was refused, stated once so the schema and the conversion cannot disagree. */
const CLOCK_READING_MESSAGE =
  "A clock reading is an ISO-8601 date-time that states its offset, lands on a whole millisecond, and stays within ten years of the seed instant.";

// ---------------------------------------------------------------------------------------------
// setScenario — which world this session runs in
// ---------------------------------------------------------------------------------------------

/** The scenario a session asks to run in. Closed: a scenario this release does not define is invalid. */
export type SetScenarioPayload = {
  readonly scenarioId: ScenarioId;
};

/** The scenario the session now runs in, and the offset the change kept. */
export type SetScenarioResult = {
  readonly scenarioId: ScenarioId;
  readonly clockOffsetMs: number;
};

const scenarioIdSchema: z.ZodType<ScenarioId> = z.custom<ScenarioId>(
  isScenarioId,
  `A scenario is one this release defines: ${SCENARIO_IDS.join(", ")}.`,
);

const setScenarioPayloadSchema: z.ZodType<SetScenarioPayload> = z.strictObject({
  scenarioId: scenarioIdSchema,
});

/**
 * Selects the scenario this session runs in and answers one of the eight outcomes.
 *
 * The choice is per session, so two browser contexts can sit in different scenarios at once and neither
 * disturbs the other (AAP 0.7.2). A scenario changes what the world makes available — an unavailable
 * financial source, media asset or coaching module, the worker-continuation setting, a partial release —
 * and nothing else: the clock offset, the armed failure, the admission state, the principal, the
 * memberships and the selected context are kept exactly as they were.
 *
 * Answers `accepted` with the document's revision after the change, `unchanged` when the session
 * already runs in that scenario, `alreadyAccepted` for a replay, `conflict` for a stale
 * `expectedRevision`, `denied` outside a development build, `invalid` for a scenario this release does
 * not define, and `unavailable` when the development document cannot be read.
 */
export async function setScenario(
  input: MutationInput<SetScenarioPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setScenarioPayloadSchema,
    name: "setScenario",
    developmentControl: "setScenario",
  };

  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }

  if (probe.meta.scenarioId === input.payload.scenarioId) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }

  const applied = await applySession(acting.sessionId, input.payload.scenarioId);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "scenarioId");
  }

  const result: SetScenarioResult = {
    scenarioId: applied.value.scenarioId,
    clockOffsetMs: applied.value.clockOffsetMs,
  };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}

// ---------------------------------------------------------------------------------------------
// setClock — how far this session's scenario clock stands from the seed instant
// ---------------------------------------------------------------------------------------------

/** The instant a session asks its scenario clock to read. */
export type SetClockPayload = {
  readonly offsetIso: string;
};

/** The offset the clock now stands at, in the unit the clock itself works in. */
export type SetClockResult = {
  readonly clockOffsetMs: number;
};

const setClockPayloadSchema: z.ZodType<SetClockPayload> = z.strictObject({
  offsetIso: z
    .string()
    .refine((value) => clockOffsetMilliseconds(value) !== undefined, CLOCK_READING_MESSAGE),
});

/**
 * Sets how far this session's scenario clock stands from the seed instant and answers one of the eight
 * outcomes.
 *
 * One of the only two names that move time (with `advanceClock`): nothing observes the clock in the
 * background, so every boundary the release defines is evaluated at read or command time against the
 * offset this control persists (assumption A12). The document is written first and the process clock
 * moved second by the module that owns both, so a failed write leaves the clock where it was.
 *
 * Answers `accepted` with the document's revision after the change, `unchanged` when the clock already
 * reads that instant, `alreadyAccepted` for a replay, `conflict` for a stale `expectedRevision`,
 * `denied` outside a development build, `invalid` for a reading that names no instant, lands between
 * milliseconds or leaves the ten-year span, and `unavailable` when the development document cannot be
 * read.
 */
export async function setClock(
  input: MutationInput<SetClockPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setClockPayloadSchema,
    name: "setClock",
    developmentControl: "setClock",
  };

  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }

  // The probe validated this reading, so the conversion cannot fail here; the branch restates the same
  // refusal rather than letting an undefined offset reach the clock.
  const offsetMilliseconds = clockOffsetMilliseconds(input.payload.offsetIso);
  if (offsetMilliseconds === undefined) {
    return invalid({
      operationId: input.operationId,
      fields: { offsetIso: [CLOCK_READING_MESSAGE] },
    });
  }
  if (probe.meta.clockOffsetMs === offsetMilliseconds) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }

  const applied = await applySessionClock(acting.sessionId, offsetMilliseconds);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "offsetIso");
  }

  const result: SetClockResult = { clockOffsetMs: applied.value.clockOffsetMs };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}

// ---------------------------------------------------------------------------------------------
// advanceClock — step this session across a boundary
// ---------------------------------------------------------------------------------------------

/** The forward move a caller asks the scenario clock for, in seconds. */
export type AdvanceClockPayload = {
  readonly bySeconds: number;
};

/** How far the clock moved and where it now stands. */
export type AdvanceClockResult = {
  readonly bySeconds: number;
  readonly clockOffsetMs: number;
};

/**
 * The largest single advance, in seconds: the ten-year span from the seed instant, in the unit a person
 * states. A larger request is refused by the payload schema before anything is read.
 */
const CLOCK_ADVANCE_LIMIT_SECONDS = Math.floor(CLOCK_OFFSET_LIMIT_MS / 1000);

const advanceClockPayloadSchema: z.ZodType<AdvanceClockPayload> = z.strictObject({
  bySeconds: z
    .int()
    .positive()
    .max(
      CLOCK_ADVANCE_LIMIT_SECONDS,
      `A clock advance is a whole number of seconds from 1 to ${String(CLOCK_ADVANCE_LIMIT_SECONDS)}, because the scenario clock stays within ten years of the seed instant.`,
    ),
});

/**
 * Moves this session's scenario clock forward and answers one of the eight outcomes.
 *
 * Only forward motion exists: a negative advance is refused, so a journey cannot be rewound halfway
 * through to land on an instant it has already observed, and `setClock` is the control for an absolute
 * reading. The resulting offset is held to the same ten-year span as a set, which is why an advance
 * that would leave it is refused with the field that carried the amount.
 *
 * Answers `accepted` with the document's revision after the change, `alreadyAccepted` for a replay,
 * `conflict` for a stale `expectedRevision`, `denied` outside a development build, `invalid` for an
 * amount that is not a positive whole number of seconds or would leave the span, and `unavailable` when
 * the development document cannot be read.
 */
export async function advanceClock(
  input: MutationInput<AdvanceClockPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: advanceClockPayloadSchema,
    name: "advanceClock",
    developmentControl: "advanceClock",
  };

  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }

  const applied = await advanceSessionClock(acting.sessionId, input.payload.bySeconds * 1000);
  if (!applied.ok) {
    return controlRefusal(input.operationId, applied.error, "bySeconds");
  }

  const result: AdvanceClockResult = {
    bySeconds: input.payload.bySeconds,
    clockOffsetMs: applied.value.clockOffsetMs,
  };
  return recordDevelopmentChange(request, {
    revision: devStateRevision(applied.value, acting.principalId),
    result,
  });
}

// ---------------------------------------------------------------------------------------------
// setFailurePlan — one armed simulated failure
// ---------------------------------------------------------------------------------------------

/** The failure to arm, and the one call it is demonstrated on. */
export type ArmingFailurePlanPayload = {
  readonly mode: FailureMode;
  readonly target: {
    readonly kind: FailureTargetKind;
    readonly name: string;
  };
};

/**
 * The disarm: the payload form that clears the armed failure and leaves every record as it stands.
 *
 * `plan: null` states the absence of a plan rather than a second one, so a caller clears the slot this
 * session's document holds without a second control and without the destructive reset.
 */
export type DisarmingFailurePlanPayload = {
  readonly plan: null;
};

/**
 * Either form of a `setFailurePlan` payload: the failure to arm, or the disarm that clears it.
 *
 * One control with two forms rather than two controls, because arming and clearing are the two states
 * of the one slot exactly one failure occupies (assumption A13).
 */
export type SetFailurePlanPayload = ArmingFailurePlanPayload | DisarmingFailurePlanPayload;

/** The plan now armed, as the development document stores it. */
export type SetFailurePlanResult = {
  readonly mode: FailureMode;
  readonly target: {
    readonly kind: FailureTargetKind;
    readonly name: string;
  };
  readonly armedAt: string;
};

/**
 * The three modes, listed once here and tied to the failure module's own union by `satisfies`, so a
 * mode that module renamed or removed stops this file compiling instead of drifting from it.
 */
const FAILURE_MODES = ["denied", "conflict", "unknown"] as const satisfies readonly FailureMode[];

/** The two kinds of named call a plan can target, on the same terms as the modes above. */
const FAILURE_TARGET_KINDS = ["read", "mutation"] as const satisfies readonly FailureTargetKind[];

/**
 * Whether a name is one the failure registry demonstrates a mode on.
 *
 * The registry is the inventory, so membership is read from its own rows rather than from a second list
 * here: a name this release does not demonstrate is `invalid` at the field that carried it.
 */
function isDemonstrableTargetName(name: string): boolean {
  return DEMONSTRABLE_TARGETS.some((target) => target.name === name);
}

const DEMONSTRABLE_TARGET_MESSAGE = `A target names the call a failure is demonstrated on: ${DEMONSTRABLE_TARGETS.map((target) => target.name).join(", ")}.`;

/**
 * The one member only the disarm states, which is what tells the payload's two forms apart before
 * either is validated.
 */
const DISARM_PLAN_MEMBER = "plan";

const armFailurePlanPayloadSchema: z.ZodType<ArmingFailurePlanPayload> = z.strictObject({
  mode: z.enum(FAILURE_MODES),
  target: z.strictObject({
    kind: z.enum(FAILURE_TARGET_KINDS),
    name: z.string().refine(isDemonstrableTargetName, DEMONSTRABLE_TARGET_MESSAGE),
  }),
});

/** The disarm states the absent plan and nothing else, so a strict object of that one member is its form. */
const disarmFailurePlanPayloadSchema: z.ZodType<DisarmingFailurePlanPayload> = z.strictObject({
  plan: z.null(),
});

/**
 * Validates either form of the payload, answering the messages of the form the request states.
 *
 * A request states either the failure to arm — `{mode, target: {kind, name}}` — or the disarm,
 * `{plan: null}`, and exactly one of the two. The form is decided here by the one member only the
 * disarm carries, and the form's own schema answers with its own issues, so the arming form keeps the
 * field paths and messages it has always produced. A union of the two schemas would fold both forms'
 * issues into a single form-level error carrying no field path, which would leave a form unable to
 * place a refusal against the control that carried the value.
 *
 * The declared type is the payload's own union and this refinement is what holds a value to it: which
 * form the value states has to be read before either schema can judge it, so no predicate is handed to
 * `custom` and every check lives in the two form schemas above.
 */
const setFailurePlanPayloadSchema: z.ZodType<SetFailurePlanPayload> = z
  .custom<SetFailurePlanPayload>()
  .superRefine((payload, ctx) => {
    const parsed =
      isRecord(payload) && Object.hasOwn(payload, DISARM_PLAN_MEMBER)
        ? disarmFailurePlanPayloadSchema.safeParse(payload)
        : armFailurePlanPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // The branch's own message and field path are what a caller acts on; the machine code belongs to
        // the schema library, and an `invalid` outcome is keyed by the path and read for the message.
        ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
      }
    }
  });

/**
 * Arms one simulated failure on one named read or mutation, or disarms the armed one, for this session
 * only, and answers one of the eight outcomes.
 *
 * The payload states one of two forms: the failure to arm — `{mode, target: {kind, name}}` — or the
 * disarm, `{plan: null}`, which clears the armed plan and leaves every record as it stands. The disarm
 * is part of this control rather than a second one because exactly one failure is active at a time
 * (assumption A13): the plan lives in the session's development document and is visible in the panel
 * through `reads/dev.ts#readDevState`, so the slot it occupies has to be clearable without the
 * destructive reset, and `dev-runtime/failures.ts#disarmFailurePlan` states the cleared value.
 *
 * The registry decides which mode a target demonstrates: the three deterministic failures of AAP 0.7.2
 * — a scope denial, a changed revision and a lost acknowledgement — are each demonstrated on the calls
 * that own the recovery they prove. Arming a second plan while one is active is refused with the armed
 * plan named and the one reachable step that clears it.
 *
 * The change is written inside the recording pass's transaction because this control's effect is a pure
 * function of the document it read: nothing outside the store is touched, so the probe's document and
 * the write are one step apart only by the check that produced them.
 *
 * Answers `accepted` with the document's revision after the change — the armed plan, or the cleared
 * document with a `null` result for a disarm — `unchanged` when the request would change nothing (that
 * plan is already armed, or no plan is armed to clear), `alreadyAccepted` for a replay, `conflict` for
 * a stale `expectedRevision`, `denied` outside a development build, `invalid` for a target or a mode the
 * registry does not pair, for a plan already armed, or for a payload that states neither form or both,
 * and `unavailable` when the development document cannot be read.
 */
export async function setFailurePlan(
  input: MutationInput<SetFailurePlanPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: setFailurePlanPayloadSchema,
    name: "setFailurePlan",
    developmentControl: "setFailurePlan",
  };

  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }

  // The disarm states the absence of a plan, so there is nothing to stamp and nothing to arm: the
  // document is written back with the plan cleared. A document that already holds no plan would
  // produce no change and is answered as such (AAP 0.7.1, `unchanged`).
  if ("plan" in input.payload) {
    const disarmed = disarmFailurePlan();
    if (probe.meta.failurePlan === EMPTY_FAILURE_PLAN) {
      return unchanged({ operationId: input.operationId, revision: probe.revision });
    }
    const clearedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: disarmed };
    const revision = devStateRevision(clearedDocument, acting.principalId);

    return runMutation<SetFailurePlanPayload, SetFailurePlanResult | null>({
      sessionId: acting.sessionId,
      input,
      schema: setFailurePlanPayloadSchema,
      name: "setFailurePlan",
      authorize: developmentAuthority,
      apply: (context) => {
        const meta = context.docs.meta;
        if (!isRecord(meta)) {
          // Unreachable: the runner resolved this session from this same document. No plan can be
          // cleared in a document that is not one, so nothing changed.
          return { changed: false };
        }
        context.docs.meta = { ...meta, failurePlan: disarmed };
        return { changed: true, revision, result: null };
      },
    });
  }

  const { mode, target } = input.payload;
  const armed = probe.meta.failurePlan;
  if (
    armed !== null &&
    armed.mode === mode &&
    armed.target.kind === target.kind &&
    armed.target.name === target.name
  ) {
    return unchanged({ operationId: input.operationId, revision: probe.revision });
  }

  // The instant the plan is stamped with is this session's own scenario instant, derived from the
  // offset its document persists, so a plan armed from one session never records another session's
  // clock position.
  const armedAt = instantAt(probe.meta.clockOffsetMs).toString();
  const arming = armFailurePlan(probe.meta.failurePlan, { mode, target, armedAt });
  if (!arming.ok) {
    return failurePlanRefusal(input.operationId, arming.error);
  }

  const plan = arming.value;
  const armedDocument: SessionMetaDocument = { ...probe.meta, failurePlan: plan };
  const revision = devStateRevision(armedDocument, acting.principalId);

  return runMutation<SetFailurePlanPayload, SetFailurePlanResult>({
    sessionId: acting.sessionId,
    input,
    schema: setFailurePlanPayloadSchema,
    name: "setFailurePlan",
    authorize: developmentAuthority,
    apply: (context) => {
      const meta = context.docs.meta;
      if (!isRecord(meta)) {
        // Unreachable: the runner resolved this session from this same document. No plan can be
        // recorded in a document that is not one, so nothing changed.
        return { changed: false };
      }
      // The document is written back from the record it was read as, so every member this module does
      // not own — the scenario, the offset, the admission state, the memberships, the selection — is
      // carried through untouched.
      context.docs.meta = { ...meta, failurePlan: plan };
      const result: SetFailurePlanResult = {
        mode: plan.mode,
        target: { kind: plan.target.kind, name: plan.target.name },
        armedAt: plan.armedAt,
      };
      return { changed: true, revision, result };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// resetSeed — the deterministic reset
// ---------------------------------------------------------------------------------------------

/** A seed reset states nothing: there is nothing a caller can choose about it. */
export type ResetSeedPayload = Record<string, never>;

/** What a reset laid down and what it removed, as the operation's stored result. */
export type ResetSeedResult = {
  readonly seededSessions: readonly string[];
  readonly removedSessions: readonly string[];
  readonly clockOffsetMs: number;
  readonly partners: number;
  readonly seedInstant: string;
};

const resetSeedPayloadSchema: z.ZodType<ResetSeedPayload> = z.custom<ResetSeedPayload>(
  (value) => isRecord(value) && Object.keys(value).length === 0,
  "A seed reset states no fields: it discards every stored session and lays every seeded session down again, so there is nothing to choose.",
);

/**
 * Discards every stored session, lays every seeded session down again deterministically, returns the
 * scenario clock to the seed instant, and answers one of the eight outcomes.
 *
 * The one reset path: `bun run reset`, the Settings control and the Playwright project all come through
 * `dev-runtime/reset.ts`, and this mutation is its request-path surface. Two resets of an untouched
 * store produce identical bytes, which is what lets every criterion start from a known seed. The
 * workload document is deliberately not seeded, so a reset removes a previously generated workload and
 * the measurement step follows it.
 *
 * The effect runs between the two passes because a reset rewrites this session's own documents: it
 * cannot run inside a transaction that holds this session's lock (the store's mutex is not re-entrant),
 * so the probe authorises the request first and the recording pass writes the ledger entry afterwards.
 * A reset that threw is `unavailable` — it claims neither that the store was reset nor that it was not —
 * and the created session ids travel with the accepted answer, so the reply reports what was laid down
 * rather than a partial claim.
 *
 * Answers `accepted` with the session ids laid down, `alreadyAccepted` for a replay (the stored
 * summary), `conflict` for a stale `expectedRevision`, `denied` outside a development build, `invalid`
 * for a payload that states a field, and `unavailable` when the store could not complete the reset.
 */
export async function resetSeed(
  input: MutationInput<ResetSeedPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const acting = await actingSessionContext(source);
  const request = {
    sessionId: acting.sessionId,
    principalId: acting.principalId,
    input,
    schema: resetSeedPayloadSchema,
    name: "resetSeed",
    developmentControl: "resetSeed",
  };

  const probe = await probeDevelopmentDocument(request);
  if (probe.kind === "answer") {
    return probe.outcome;
  }
  if (probe.kind === "unreadable") {
    return developmentDocumentUnavailable(probe.operationId);
  }

  let summary: ResetSummary;
  try {
    summary = await resetDevelopmentSeed();
  } catch {
    return sourceUnavailable(
      input.operationId,
      { system: LOCAL_STORE_SYSTEM, reference: RESET_SOURCE_REFERENCE },
      RESET_GUIDANCE,
    );
  }

  const result: ResetSeedResult = {
    seededSessions: summary.seededSessions,
    removedSessions: summary.removedSessions,
    clockOffsetMs: summary.clockOffsetMs,
    partners: summary.partners,
    seedInstant: summary.seedInstant,
  };
  return recordDevelopmentChange(request, {
    // A reset lays down the seed's own documents, so the token this boundary can state honestly is the
    // one the caller presented; the next `readDevState` reports the seeded document's own token.
    revision: input.expectedRevision,
    result,
    created: summary.seededSessions,
  });
}
