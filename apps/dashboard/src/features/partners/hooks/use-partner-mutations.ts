"use client";
/**
 * The Partners family's browser data layer: the eleven named partner changes the family performs, and
 * the one read transport and cache-key vocabulary its two record reads share.
 *
 * Every change presents the four-field contract — `operationId`, `scope`, `expectedRevision`,
 * `payload` — over the family's own Route Handlers, and answers with exactly one of the eight
 * outcomes, unchanged. Three properties follow from that and are the reason this file exists in this
 * shape:
 *
 * - The attempt's identity belongs to the intent. A submit whose intent matches the retained one
 *   reuses its `operationId`, so a lost acknowledgement is answered by the service's replay as
 *   `alreadyAccepted` instead of applying the change twice; a changed intent mints a fresh identity.
 * - The payload is validated before it leaves the browser, with the family's own schema, so a value
 *   that cannot be sent is `invalid` with the same field paths the service would report — and nothing
 *   is dispatched. No rule is added here that the schema and the service do not both hold.
 * - Nothing is inferred from an absent error. `unknown` stays `unknown`, a refused change invalidates
 *   nothing, and no copy of a record is written into the cache: the store is the only owner.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ZodError, ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { assertNever } from "@/lib/result";
import type { MutationInput, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
/**
 * Types only, never values. The outcome module's constructors and response mapper belong to the
 * server: this module narrows the body it receives and builds the two answers a browser can honestly
 * give on its own — `invalid` for a payload its own schema refused, and `unknown` for a request whose
 * fate it cannot know. Importing the constructors here would put the service's response mapping in
 * the client bundle to answer questions only the store can answer.
 */
import type { DeniedOutcome, FieldMessages, MutationOutcome, ReadResult, UnavailableOutcome } from "@/modules/data-service/outcome";
import { logInteractionPayloadSchema, type LogInteractionPayload } from "../schemas/interaction";
import { saveContactEditsPayloadSchema, type SaveContactEditsPayload } from "../schemas/partner-edit";
import {
  archivePreparationPayloadSchema,
  createPrivatePreparationPayloadSchema,
  restorePreparationPayloadSchema,
  type ArchivePreparationPayload,
  type CreatePrivatePreparationPayload,
  type RestorePreparationPayload,
} from "../schemas/preparation";
import { savePrivateNotePayloadSchema, type SavePrivateNotePayload } from "../schemas/private-note";
import { deleteViewPayloadSchema, renameViewPayloadSchema, saveViewPayloadSchema, type DeleteViewPayload, type RenameViewPayload, type SaveViewPayload } from "../schemas/saved-view";
import { setFavouritePayloadSchema, setTagPayloadSchema, type SetFavouritePayload, type SetTagPayload } from "../schemas/tag";

/** The cache segments this family's reads key their results by, declared once so the roster read, the record read and this file cannot drift apart. */
export const PARTNER_KEY = {
  roster: "partners",
  facets: "facets",
  savedViews: "saved-views",
  record: "partner",
  preparation: "preparation",
  interactions: "interactions",
} as const;

/** One cache segment of the Partners family, as {@link PARTNER_KEY} spells it. */
export type PartnerKeySegment = (typeof PARTNER_KEY)[keyof typeof PARTNER_KEY];

/** The eleven named partner mutations, in the order the service groups them: the closed set this module wraps, and no twelfth. */
export const PARTNER_MUTATION_NAMES = [
  "createPrivatePreparation",
  "saveContactEdits",
  "savePrivateNote",
  "logInteraction",
  "archivePreparation",
  "restorePreparation",
  "saveView",
  "renameView",
  "deleteView",
  "setTag",
  "setFavourite",
] as const;

/** One of the eleven names above. */
export type PartnerMutationName = (typeof PARTNER_MUTATION_NAMES)[number];

/**
 * The seven POST paths this family's changes travel to: the creation path, and the six a record
 * addresses.
 *
 * A segment is the opaque identifier the caller holds and states. It is interpolated with
 * `encodeURIComponent` and never parsed, split, compared against a name or an address, or read as
 * anything but the place the request belongs.
 */
export const PARTNER_POST_PATHS = {
  create: (): string => "/api/partners",
  edits: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/edits`,
  notes: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/notes`,
  interactions: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/interactions`,
  views: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/views`,
  archive: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/archive`,
  tags: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/tags`,
} as const;

/** The three named reads of one partner record the record path answers: identity, the caller's own private preparation, and the activity that actually happened. */
export const PARTNER_READ_JOBS = ["record", "preparation", "interactions"] as const;

/** One of the three record read jobs above. */
export type PartnerReadJob = (typeof PARTNER_READ_JOBS)[number];

/**
 * The URL of one of the record's three named reads.
 *
 * The path answers every job from one folded envelope, so the job is stated rather than inferred: a
 * read is named where it is issued, which is what lets the three reads stay three reads in this
 * module even while one request carries all three sections.
 */
export function partnerRecordReadUrl(partnerId: string, job: PartnerReadJob): string {
  return `/api/partners/${encodeURIComponent(partnerId)}?job=${job}`;
}

/**
 * Raised when a read produced no result at all: the request failed, the answer was not JSON, or the
 * body was neither an envelope nor one of the two refusals.
 *
 * It carries the address and the status and nothing else — no response body, no field of a record —
 * so a refusal's private detail cannot ride an error surface into a log or a message.
 */
export class PartnerReadTransportError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(url: string, status: number | undefined, detail: string) {
    super(`${url} ${status === undefined ? "did not answer" : `answered ${String(status)}`} with ${detail}, so this read produced no result.`);
    this.name = "PartnerReadTransportError";
    this.url = url;
    this.status = status;
    // Keeps `instanceof` working where the class is downlevelled past ES2015 semantics, which is what
    // lets a caller narrow with `instanceof PartnerReadTransportError`.
    Object.setPrototypeOf(this, PartnerReadTransportError.prototype);
  }
}

/**
 * Reads one of the family's read URLs and answers the three-way result the contract states: the
 * scoped envelope, a denial, or an unavailable source.
 *
 * The handler emits the envelope as the body itself and a refusal as its outcome, so the parsed body
 * is narrowed rather than re-wrapped: a denial surfaces as a denial and never degrades into an empty
 * list, and an unanswered read reaches `useQuery`'s error state (which the shared state notice renders
 * as unavailable) instead of being fabricated into an empty envelope. HTTP statuses are not mapped
 * here — the service's own response mapper owns that, and the body it produced is the contract.
 */
export async function fetchPartnerRead<T>(url: string): Promise<ReadResult<ReadEnvelope<T>>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      // The development session is an httpOnly, sameSite=lax cookie, so only a same-origin request
      // carries it, and the handler resolves the caller's authority from it rather than from the query.
      credentials: "same-origin",
      // Next 16 caches opt-in, and a stale envelope would be a lie about the store's current state.
      cache: "no-store",
    });
  } catch {
    throw new PartnerReadTransportError(url, undefined, "no answer at all");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PartnerReadTransportError(url, response.status, "a body that is not JSON");
  }
  if (isPartnerEnvelope<T>(body)) {
    return { kind: "envelope", envelope: body };
  }
  if (isDeniedBody(body)) {
    return { kind: "denied", denied: body };
  }
  if (isUnavailableBody(body)) {
    return { kind: "unavailable", unavailable: body };
  }
  throw new PartnerReadTransportError(url, response.status, "a body that is neither an envelope nor one of the two refusals");
}

/** Reports whether a parsed body carries the eight members every read envelope states; `data` is the caller's own slice of the record. */
function isPartnerEnvelope<T>(value: unknown): value is ReadEnvelope<T> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    "data" in value &&
    isRecord(value.scope) &&
    isRecord(value.source) &&
    isNonEmptyString(value.revision) &&
    isNonEmptyString(value.asOf) &&
    isRecord(value.coverage) &&
    isRecord(value.valueStates) &&
    Array.isArray(value.actions)
  );
}

/** Reports whether a parsed body is the denial a refused read answers with. */
function isDeniedBody(value: unknown): value is DeniedOutcome {
  return isRecord(value) && value.outcome === "denied" && isNonEmptyString(value.operationId) && isNonEmptyString(value.reasonCode);
}

/** Reports whether a parsed body is the outage an unavailable read answers with. */
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return (
    value.outcome === "unavailable" &&
    isNonEmptyString(value.operationId) &&
    isNonEmptyString(value.guidance) &&
    isRecord(source) &&
    isNonEmptyString(source.system) &&
    isNonEmptyString(source.reference)
  );
}

/**
 * Reports whether a parsed body is one of the eight mutation outcomes.
 *
 * This is the module's only shape guard over the outcome set, and it is deliberately structural: it
 * checks the discriminant and the members that make each member readable, so `conflict` still carries
 * both the current value and the caller's preserved input, and `unavailable` still names its source.
 * Anything else is not an outcome, and a body that is not an outcome is reported as `unknown` — never
 * read as a success and never converted into a different kind of failure.
 */
function isPartnerOutcome(value: unknown): value is MutationOutcome {
  if (!isRecord(value) || !isNonEmptyString(value.operationId)) {
    return false;
  }
  switch (value.outcome) {
    case "accepted":
    case "unchanged":
      return isNonEmptyString(value.revision);
    case "alreadyAccepted":
      return isNonEmptyString(value.revision) && "result" in value;
    case "conflict":
      return isNonEmptyString(value.currentRevision) && (value.reason === "stale-revision" || value.reason === "changed-intent") && "current" in value && "preservedInput" in value;
    case "denied":
      return isNonEmptyString(value.reasonCode);
    case "invalid":
      return isRecord(value.fields);
    case "unavailable":
      return isNonEmptyString(value.guidance) && isRecord(value.source);
    case "unknown":
      return true;
    default:
      return false;
  }
}

/** A record's optimistic-concurrency token, taken from the mutation contract rather than declared again here. */
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];

/**
 * What a caller supplies for one change: the authority it acts in, the revision it read, and the
 * payload this hook's schema validates.
 *
 * `expectedRevision` is the revision the caller actually saw — the roster envelope's for a creation,
 * the record envelope's for a change. It is never defaulted and never refreshed here: substituting one
 * would turn a genuine `conflict` into an overwrite.
 */
export interface PartnerMutationInput<TPayload> {
  readonly scope: Scope;
  readonly expectedRevision: ExpectedRevision;
  readonly payload: TPayload;
}

/**
 * What every hook in this file hands the component that renders it.
 *
 * The handle states the last outcome verbatim, the caller's own input where a refusal preserved it, and
 * the attempt's identity so an `unknown` can be recovered by operation id rather than resent.
 */
export interface PartnerMutationHandle<TPayload> {
  /** Performs the change once: answers the single outcome, and answers the in-flight attempt when one is already running. */
  readonly submit: (input: PartnerMutationInput<TPayload>) => Promise<MutationOutcome>;
  /** Clears the outcome, the preserved input and the retained attempt identity, for a form starting a genuinely new entry. */
  readonly reset: () => void;
  /** Whether an attempt is in flight, so a form can refuse a second press of its own submit. */
  readonly isPending: boolean;
  /** The last outcome, exactly as the handler answered it; `null` before the first attempt. */
  readonly outcome: MutationOutcome | null;
  /** The caller's own input, kept for `conflict`, `invalid` and `unavailable` so a form can show it beside the current value. */
  readonly submitted: { readonly expectedRevision: ExpectedRevision; readonly payload: TPayload } | null;
  /** The identity of the last attempt, for the `unknown` recovery panel and the operation audit. */
  readonly operationId: string | null;
}

/** The members a route receives as `payload`, once the validated change has been shaped into the body it admits. */
type WireFields = Record<string, unknown>;

/** One named partner mutation, as the one factory below needs it: what it is called, how its payload is judged, and how that payload is shaped for its route. */
interface PartnerMutationConfig<TPayload> {
  readonly name: PartnerMutationName;
  readonly schema: ZodType<TPayload>;
  /**
   * The member a path with several named mutations dispatches on. Its value is always this mutation's
   * own name: the word is routing, and the handler strips it before the named mutation's closed schema
   * reads the rest, so the change's own schema stays exactly the members a worker chose.
   */
  readonly routeDiscriminant?: { readonly field: "intent" | "operation" };
  /** Projects the validated payload onto the members its route accepts, where the route reads the record from the address instead. */
  readonly wire?: (payload: TPayload) => WireFields;
}

/** One settled attempt: the identity it was made under, the outcome it answered with, and the input it was made from. */
interface PartnerSettlement<TPayload> {
  readonly operationId: string;
  readonly outcome: MutationOutcome;
  readonly input: PartnerMutationInput<TPayload>;
}

/** One attempt on its way out: the identity it carries and the change it presents. */
interface PartnerAttempt<TPayload> {
  readonly operationId: string;
  readonly input: PartnerMutationInput<TPayload>;
}

/** The key under which a message that belongs to no field is reported, as the service's own `invalid` reports one. */
const ROOT_FIELD_KEY = "_root";

/** The three outcomes that preserve the caller's input, because the change is still theirs to re-apply. */
const PRESERVING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["conflict", "invalid", "unavailable"]);

/** Groups a schema refusal's messages by field path, in the convention the service and `components/form-field` both read. */
function fieldsOf(error: ZodError): FieldMessages {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? ROOT_FIELD_KEY : issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path];
    if (messages === undefined) {
      fields[path] = [issue.message];
    } else if (!messages.includes(issue.message)) {
      messages.push(issue.message);
    }
  }
  return fields;
}

/** The `invalid` answer for a payload this browser's own schema refused: one of the two outcomes this module may build, and it changes nothing. */
function invalidOutcome(operationId: string, error: ZodError): MutationOutcome {
  return { outcome: "invalid", operationId, fields: fieldsOf(error) };
}

/** The `unknown` answer for a request whose fate this module cannot know: the other outcome it may build, carrying the identity recovery works by. */
function undeterminedOutcome(operationId: string): MutationOutcome {
  return { outcome: "unknown", operationId };
}

/**
 * Writes a JSON value with its object members in a fixed order, so two equal intents produce one
 * string.
 *
 * The intent is compared textually to decide whether a submit is the same attempt as the last one, so
 * an incidental change in key order would be read as a changed intent and answered with a fresh
 * `operationId` — which is exactly the second effect the retained identity exists to prevent.
 */
function stableText(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableText(entry)).join(",")}]`;
  }
  const fields: [string, unknown][] = Object.entries(value);
  fields.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${fields.map(([key, field]) => `${JSON.stringify(key)}:${stableText(field)}`).join(",")}}`;
}

/** The stable identity of one intent: the revision it was read at and the change it asks for. */
function intentTextOf(input: PartnerMutationInput<unknown>): string {
  return stableText({ expectedRevision: input.expectedRevision, payload: input.payload });
}

/** Copies a validated payload's members, so the body carries the schema's output and nothing the caller's object happened to hold. */
function structuredFields(payload: object): WireFields {
  const fields: WireFields = {};
  for (const [key, value] of Object.entries(payload)) {
    fields[key] = value;
  }
  return fields;
}

/** Shapes a validated change into the `payload` its route admits, adding the dispatch word where the path serves several named mutations. */
function wireFieldsOf<TPayload extends object>(config: PartnerMutationConfig<TPayload>, payload: TPayload): WireFields {
  const stated: WireFields = config.wire === undefined ? structuredFields(payload) : config.wire(payload);
  if (config.routeDiscriminant === undefined) {
    return stated;
  }
  return { ...stated, [config.routeDiscriminant.field]: config.name };
}

/**
 * Posts one change and answers the outcome the handler produced.
 *
 * The body is the four contract fields and nothing else, serialised once. A rejected fetch, an
 * unreadable body and a body that is not an outcome all resolve to `unknown` under the identity that
 * was dispatched: a lost acknowledgement is indistinguishable from a failure, so claiming either would
 * be a guess, and the caller's recovery is a replay of that same identity.
 */
async function postPartnerMutation(url: string, body: MutationInput<unknown>): Promise<MutationOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    return undeterminedOutcome(body.operationId);
  }
  let answered: unknown;
  try {
    answered = await response.json();
  } catch {
    return undeterminedOutcome(body.operationId);
  }
  return isPartnerOutcome(answered) ? answered : undeterminedOutcome(body.operationId);
}

/** One read the settled change leaves out of date: its cache segment, and whether it is the record the change addressed. */
interface PartnerRefresh {
  readonly segment: PartnerKeySegment;
  readonly addressedRecord?: true;
}

/**
 * The reads each of the eleven changes leaves out of date, listed once against the closed name set.
 *
 * Segment-only keys are prefix-invalidated across the scope, which covers a segment whose reads carry
 * the record as a parameter in an order this file does not own. The record segment is narrowed to the
 * record the change addressed, so a change to one contact never re-reads every other record's body.
 */
function refreshedReads(name: PartnerMutationName): readonly PartnerRefresh[] {
  switch (name) {
    case "createPrivatePreparation":
      return [{ segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }, { segment: PARTNER_KEY.preparation }];
    case "saveContactEdits":
      return [{ segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }];
    case "savePrivateNote":
      return [{ segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.preparation }];
    case "logInteraction":
      return [{ segment: PARTNER_KEY.interactions }, { segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }];
    case "archivePreparation":
    case "restorePreparation":
      return [{ segment: PARTNER_KEY.preparation }, { segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }];
    case "saveView":
    case "renameView":
    case "deleteView":
      return [{ segment: PARTNER_KEY.savedViews }];
    case "setTag":
    case "setFavourite":
      return [{ segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }, { segment: PARTNER_KEY.record, addressedRecord: true }];
    default:
      // Exhaustive by construction: the eleven names above are the closed set, so a twelfth fails to
      // compile at this call rather than arriving here with no refresh policy at all.
      return assertNever(name, "Unhandled partner mutation");
  }
}

/** Whether the change stands, so the reads beside it are re-read: exactly the two outcomes that produced or replayed an effect. */
function standsAsChanged(outcome: MutationOutcome): boolean {
  return outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
}

/**
 * Re-reads the keys a settled change touched, inside the scope the change was made in and nowhere else.
 *
 * Prefix invalidation follows the hierarchical keys the family's reads use, and the refreshed reads are
 * awaited so a caller that awaits `submit` then reads the state the outcome described. No outcome is
 * written into the cache: the store owns the record, and the shared operation result is the receipt
 * beside it.
 */
async function refreshPartnerReads(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, name: PartnerMutationName, partnerId: string | undefined): Promise<void> {
  if (!standsAsChanged(outcome)) {
    return;
  }
  const prefix = scopeKey(scope);
  const keys = refreshedReads(name).map((refresh) => {
    const addressed = refresh.addressedRecord === true && partnerId !== undefined ? [partnerId] : [];
    return { queryKey: [...prefix, refresh.segment, ...addressed] };
  });
  await Promise.all(keys.map((key) => queryClient.invalidateQueries(key)));
}

/** The caller's input as the handle exposes it: kept only where the outcome says the change is still theirs to re-apply. */
function submittedOf<TPayload>(settlement: PartnerSettlement<TPayload> | null): PartnerMutationHandle<TPayload>["submitted"] {
  if (settlement === null || !PRESERVING_OUTCOMES.has(settlement.outcome.outcome)) {
    return null;
  }
  return { expectedRevision: settlement.input.expectedRevision, payload: settlement.input.payload };
}

/**
 * The one implementation behind the eleven hooks: validate the change with its own schema, post the
 * four-field contract to its own path, narrow the answer to one outcome, and re-read what the change
 * touched.
 *
 * It takes a concrete name, a concrete schema and a concrete path — never a table name, a field map or
 * a mutation named by its caller, because a dispatcher would let a surface compose a change the family
 * never defined. What a settled change re-reads is decided by {@link refreshedReads} alone, so the
 * eleven names and their cache consequences cannot drift apart.
 */
function usePartnerMutation<TPayload extends object>(config: PartnerMutationConfig<TPayload>, url: string, partnerId?: string): PartnerMutationHandle<TPayload> {
  const queryClient = useQueryClient();
  const [settlement, setSettlement] = useState<PartnerSettlement<TPayload> | null>(null);
  // The attempt retained for replay: the identity its intent was dispatched under, kept until a
  // different intent replaces it or the form starts a new entry.
  const identityRef = useRef<{ readonly operationId: string; readonly intent: string } | null>(null);
  const inFlightRef = useRef<Promise<MutationOutcome> | null>(null);

  const mutation = useMutation<MutationOutcome, never, PartnerAttempt<TPayload>>({
    mutationFn: async (attempt: PartnerAttempt<TPayload>): Promise<MutationOutcome> => {
      const parsed = config.schema.safeParse(attempt.input.payload);
      const outcome = parsed.success
        ? await postPartnerMutation(url, {
            operationId: attempt.operationId,
            scope: attempt.input.scope,
            expectedRevision: attempt.input.expectedRevision,
            payload: wireFieldsOf(config, parsed.data),
          })
        : invalidOutcome(attempt.operationId, parsed.error);
      try {
        await refreshPartnerReads(queryClient, outcome, attempt.input.scope, config.name, partnerId);
      } catch {
        // A refresh that fails changes nothing the person was told: the outcome above is the answer,
        // and the reads named here are re-read on the next navigation.
      }
      return outcome;
    },
    // Recovery is the attempt's `operationId` and the service's ledger, never a library retry: a quiet
    // resubmission would either repeat the effect or answer `changed-intent` for a conflict the caller
    // never caused.
    retry: false,
  });
  const { mutateAsync } = mutation;

  const submit = useCallback(
    (input: PartnerMutationInput<TPayload>): Promise<MutationOutcome> => {
      const running = inFlightRef.current;
      if (running !== null) {
        // One attempt at a time: a second press asks for the same change, so it is answered with the
        // attempt already running rather than with a second effect.
        return running;
      }
      const intent = intentTextOf(input);
      const retained = identityRef.current;
      // The same intent replays under the identity it was first sent with, which is what lets a lost
      // acknowledgement return the original result instead of applying the change twice.
      const operationId = retained !== null && retained.intent === intent ? retained.operationId : newOperationId();
      identityRef.current = { operationId, intent };
      const settled = mutateAsync({ operationId, input }).then((outcome: MutationOutcome): MutationOutcome => {
        setSettlement({ operationId, outcome, input });
        return outcome;
      });
      const pending: Promise<MutationOutcome> = settled.finally(() => {
        if (inFlightRef.current === pending) {
          inFlightRef.current = null;
        }
      });
      inFlightRef.current = pending;
      return pending;
    },
    [mutateAsync],
  );

  const reset = useCallback((): void => {
    // The retained identity goes with the outcome: a form starting a new entry is making a new
    // attempt, and reusing the old id would make a genuine second creation look like a replay.
    identityRef.current = null;
    setSettlement(null);
  }, []);

  return {
    submit,
    reset,
    isPending: mutation.isPending,
    outcome: settlement === null ? null : settlement.outcome,
    submitted: submittedOf(settlement),
    operationId: settlement === null ? null : settlement.operationId,
  };
}

/** `createPrivatePreparation`: the worker's own private preparation record, created from a name and nothing else it does not state. */
const CREATE_PRIVATE_PREPARATION: PartnerMutationConfig<CreatePrivatePreparationPayload> = {
  name: "createPrivatePreparation",
  schema: createPrivatePreparationPayloadSchema,
};

/** `saveContactEdits`: the permitted fields of one record, changed against the revision the caller read. */
const SAVE_CONTACT_EDITS: PartnerMutationConfig<SaveContactEditsPayload> = {
  name: "saveContactEdits",
  schema: saveContactEditsPayloadSchema,
};

/**
 * `savePrivateNote`: one private note about one record.
 *
 * The address names the record, so only the note's text travels: the note path's own payload is the
 * body alone, and a body that restated a record would be a second, competing statement of the target
 * the read could not have authorised.
 */
const SAVE_PRIVATE_NOTE: PartnerMutationConfig<SavePrivateNotePayload> = {
  name: "savePrivateNote",
  schema: savePrivateNotePayloadSchema,
  wire: (payload) => ({ body: payload.body }),
};

/** `logInteraction`: something that actually happened, recorded once — never a task, a gift or an opened app. */
const LOG_INTERACTION: PartnerMutationConfig<LogInteractionPayload> = {
  name: "logInteraction",
  schema: logInteractionPayloadSchema,
};

/** `archivePreparation`: one worker-private preparation taken out of the working lists. */
const ARCHIVE_PREPARATION: PartnerMutationConfig<ArchivePreparationPayload> = {
  name: "archivePreparation",
  schema: archivePreparationPayloadSchema,
  routeDiscriminant: { field: "intent" },
};

/** `restorePreparation`: one archived preparation returned to the working lists. */
const RESTORE_PREPARATION: PartnerMutationConfig<RestorePreparationPayload> = {
  name: "restorePreparation",
  schema: restorePreparationPayloadSchema,
  routeDiscriminant: { field: "intent" },
};

/** `saveView`: the caller's own roster query, saved under a name — a personal view, never a shared filter or an audience. */
const SAVE_VIEW: PartnerMutationConfig<SaveViewPayload> = {
  name: "saveView",
  schema: saveViewPayloadSchema,
  routeDiscriminant: { field: "intent" },
};

/** `renameView`: the name of one saved view, and nothing else it stores. */
const RENAME_VIEW: PartnerMutationConfig<RenameViewPayload> = {
  name: "renameView",
  schema: renameViewPayloadSchema,
  routeDiscriminant: { field: "intent" },
};

/** `deleteView`: one saved view removed; the query it held was never a record of anything else. */
const DELETE_VIEW: PartnerMutationConfig<DeleteViewPayload> = {
  name: "deleteView",
  schema: deleteViewPayloadSchema,
  routeDiscriminant: { field: "intent" },
};

/** `setTag`: one personal label applied to or removed from a record — filing, never an audience, a consent or a campaign. */
const SET_TAG: PartnerMutationConfig<SetTagPayload> = {
  name: "setTag",
  schema: setTagPayloadSchema,
  routeDiscriminant: { field: "operation" },
};

/** `setFavourite`: the caller's own favourite mark on one record. */
const SET_FAVOURITE: PartnerMutationConfig<SetFavouritePayload> = {
  name: "setFavourite",
  schema: setFavouritePayloadSchema,
  routeDiscriminant: { field: "operation" },
};

/** Drives `createPrivatePreparation` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useCreatePrivatePreparation(): PartnerMutationHandle<CreatePrivatePreparationPayload> {
  return usePartnerMutation(CREATE_PRIVATE_PREPARATION, PARTNER_POST_PATHS.create());
}

/** Drives `saveContactEdits` for the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveContactEdits(partnerId: string): PartnerMutationHandle<SaveContactEditsPayload> {
  return usePartnerMutation(SAVE_CONTACT_EDITS, PARTNER_POST_PATHS.edits(partnerId), partnerId);
}

/** Drives `savePrivateNote` for the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSavePrivateNote(partnerId: string): PartnerMutationHandle<SavePrivateNotePayload> {
  return usePartnerMutation(SAVE_PRIVATE_NOTE, PARTNER_POST_PATHS.notes(partnerId), partnerId);
}

/** Drives `logInteraction` for the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useLogInteraction(partnerId: string): PartnerMutationHandle<LogInteractionPayload> {
  return usePartnerMutation(LOG_INTERACTION, PARTNER_POST_PATHS.interactions(partnerId), partnerId);
}

/** Drives `archivePreparation` for the preparation named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useArchivePreparation(partnerId: string): PartnerMutationHandle<ArchivePreparationPayload> {
  return usePartnerMutation(ARCHIVE_PREPARATION, PARTNER_POST_PATHS.archive(partnerId), partnerId);
}

/** Drives `restorePreparation` for the preparation named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRestorePreparation(partnerId: string): PartnerMutationHandle<RestorePreparationPayload> {
  return usePartnerMutation(RESTORE_PREPARATION, PARTNER_POST_PATHS.archive(partnerId), partnerId);
}

/** Drives `saveView` — the caller's own roster query, placed under the partner route family, which reads no record from the segment — and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSaveView(partnerId: string): PartnerMutationHandle<SaveViewPayload> {
  return usePartnerMutation(SAVE_VIEW, PARTNER_POST_PATHS.views(partnerId));
}

/** Drives `renameView`, placed on the same path as every other saved-view change, and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useRenameView(partnerId: string): PartnerMutationHandle<RenameViewPayload> {
  return usePartnerMutation(RENAME_VIEW, PARTNER_POST_PATHS.views(partnerId));
}

/** Drives `deleteView`, placed on the same path as every other saved-view change, and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useDeleteView(partnerId: string): PartnerMutationHandle<DeleteViewPayload> {
  return usePartnerMutation(DELETE_VIEW, PARTNER_POST_PATHS.views(partnerId));
}

/** Drives `setTag` on the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSetTag(partnerId: string): PartnerMutationHandle<SetTagPayload> {
  return usePartnerMutation(SET_TAG, PARTNER_POST_PATHS.tags(partnerId), partnerId);
}

/** Drives `setFavourite` on the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export function useSetFavourite(partnerId: string): PartnerMutationHandle<SetFavouritePayload> {
  return usePartnerMutation(SET_FAVOURITE, PARTNER_POST_PATHS.tags(partnerId), partnerId);
}
