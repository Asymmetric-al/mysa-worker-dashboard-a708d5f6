/**
 * The initiatives family's one browser transport: the closed set of paths this family may call, the
 * one POST that submits a named change, and the one GET that reads a result.
 */
import { newOperationId, type SourceReference } from "@/lib/ids";
import type { DenialReason, MutationInput, MutationOutcome, ReadResult } from "@/modules/data-service";
// Fixed values
const TRANSPORT_SYSTEM = "data-service-transport";

const NO_RESPONSE_REFERENCE = "no-response";

const UNREADABLE_BODY_REFERENCE = "unreadable-body";

const UNEXPECTED_BODY_REFERENCE = "unexpected-body";

const UNREAD_RESULT_GUIDANCE = "This page could not read the result from the local data service. Nothing was changed, because a read has no effect to repeat, so the same request can be tried again.";

const UNENCODABLE_PAYLOAD_MESSAGE = "This change could not be encoded for sending, so nothing was sent. Check the entered values and try again.";
// The closed set of paths
/** The closed set of transport paths this family may call, exactly as AAP 0.6.3 names them. */
export const INITIATIVE_API = Object.freeze({
  initiatives: "/api/initiatives",
  members: "/api/initiatives/members",
  stages: "/api/initiatives/stages",
  requests: "/api/initiatives/requests",
  response: "/api/initiatives/requests/response",
  close: "/api/initiatives/close",
  reopen: "/api/initiatives/reopen",
} as const);
/** Every path {@link INITIATIVE_API} declares, and the only transport path a hook in this family may pass. */
export type InitiativeApiPath = (typeof INITIATIVE_API)[keyof typeof INITIATIVE_API];
// Narrowing untrusted bodies
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function isSourceReference(value: unknown): value is SourceReference {
  return isRecord(value) && isNonEmptyString(value.system) && isNonEmptyString(value.reference);
}
const DENIAL_REASONS: { readonly [Reason in DenialReason]: true } = {
  "not-admitted": true,
  "no-membership": true,
  "no-permission": true,
  "no-export-permission": true,
  "no-protected-grant": true,
  "capability-absent": true,
  "session-expired": true,
  "session-unavailable": true,
};
function isDenialReason(value: unknown): value is DenialReason {
  return typeof value === "string" && Object.hasOwn(DENIAL_REASONS, value);
}
type OutcomeName = MutationOutcome["outcome"];

type OutcomeCheck = (body: Record<string, unknown>) => boolean;

const OUTCOME_CHECKS: { readonly [Name in OutcomeName]: OutcomeCheck } = {
  accepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  alreadyAccepted: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string" && "result" in body,
  unchanged: (body) => isNonEmptyString(body.operationId) && typeof body.revision === "string",
  conflict: (body) =>
    isNonEmptyString(body.operationId) &&
    typeof body.currentRevision === "string" &&
    (body.reason === "stale-revision" || body.reason === "changed-intent") &&
    "current" in body &&
    "preservedInput" in body,
  denied: (body) => isNonEmptyString(body.operationId) && isDenialReason(body.reasonCode),
  invalid: (body) => isNonEmptyString(body.operationId) && isRecord(body.fields),
  unavailable: (body) => isNonEmptyString(body.operationId) && isSourceReference(body.source) && isNonEmptyString(body.guidance),
  unknown: (body) => isNonEmptyString(body.operationId),
};
/** Reports whether a parsed body is one of the eight mutation outcomes. */
export function isMutationOutcome(value: unknown): value is MutationOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const name: unknown = value.outcome;
  if (typeof name !== "string" || !Object.hasOwn(OUTCOME_CHECKS, name)) {
    return false;
  }
  return OUTCOME_CHECKS[name as OutcomeName](value);
}
// The two directions
/** Submits one named change to the initiative route it belongs to and answers with exactly one of the eight mutation outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`. */
export async function postMutation<P>(path: InitiativeApiPath, input: MutationInput<P>): Promise<MutationOutcome> {
  let body: string;
  try {
    body = JSON.stringify(input);
  } catch {
    return {
      outcome: "invalid",
      operationId: input.operationId,
      fields: { payload: [UNENCODABLE_PAYLOAD_MESSAGE] },
    };
  }
  let text: string;
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body,
    });
    text = await response.text();
  } catch {
    return { outcome: "unknown", operationId: input.operationId };
  }
  const parsed = parseJson(text);
  if (parsed !== null && isMutationOutcome(parsed.value)) {
    return parsed.value;
  }
  return { outcome: "unknown", operationId: input.operationId };
}
/** Reads one initiative result under the scope and query state the caller supplies, and answers with the three outcomes the in-process service read produces: `{ kind: "envelope", envelope }`. */
export async function readEnvelope<T>(path: InitiativeApiPath, params: Readonly<Record<string, string | number | undefined>>): Promise<ReadResult<T>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const search = query.toString();
  const url = search === "" ? path : `${path}?${search}`;
  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    status = response.status;
    text = await response.text();
  } catch {
    return unreadResult(NO_RESPONSE_REFERENCE);
  }
  const parsed = parseJson(text);
  if (parsed === null) {
    return unreadResult(UNREADABLE_BODY_REFERENCE);
  }
  const body: unknown = parsed.value;
  if (status === 200) {
    return isRecord(body) ? { kind: "envelope", envelope: body as T } : unreadResult(UNEXPECTED_BODY_REFERENCE);
  }
  if (isMutationOutcome(body)) {
    if (body.outcome === "denied") {
      return { kind: "denied", denied: body };
    }
    if (body.outcome === "unavailable") {
      return { kind: "unavailable", unavailable: body };
    }
  }
  return unreadResult(UNEXPECTED_BODY_REFERENCE);
}
// Body parsing and the outage a read can name
interface ParsedBody {
  readonly value: unknown;
}
function parseJson(text: string): ParsedBody | null {
  if (text === "") {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return null;
  }
}
function unreadResult<T>(reference: string): ReadResult<T> {
  return {
    kind: "unavailable",
    unavailable: {
      outcome: "unavailable",
      operationId: newOperationId(),
      source: { system: TRANSPORT_SYSTEM, reference },
      guidance: UNREAD_RESULT_GUIDANCE,
    },
  };
}
