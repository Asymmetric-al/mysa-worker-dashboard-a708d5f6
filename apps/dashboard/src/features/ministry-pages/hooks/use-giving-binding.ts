"use client";
/** The Give placement's browser read: the one approved giving Designation a Page release may show, or the *Giving unavailable* state with its cause and no fallback fund. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isNonEmptyString, isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import type { ReadEnvelope, Scope, reads } from "@/modules/data-service";
import { isOutcome, isReadResult, unavailable, type ReadResult } from "@/modules/data-service/outcome";
import { givingBindingKey } from "./page-query-keys";
/** The source system a browser-side outage is reported under: the handler this hook called. */
const HANDLER_SOURCE_SYSTEM = "data-service";
/** The attempt identity a read carries, named as the service's own reads name it. */
const READ_ATTEMPT_ID = "read";
/** The Pages handler this read travels through. */
const PAGES_ENDPOINT = "/api/pages";
/** The `view` discriminator of the giving-binding read, spelled as the handler's closed set spells it. */
const GIVING_VIEW = "giving-binding";
/** The one status the Pages handler answers a read envelope with. */
const ENVELOPE_STATUS = 200;
/** The key segment that stands for "no Page named": such a query is disabled and never issues a request, and a real Page identifier is never empty. */
const UNNAMED_DOCUMENT = "";
const TRANSPORT_GUIDANCE = "The giving-binding read did not complete, so this placement has no giving destination to show. Reload the placement to try again; no fallback designation and no amount is shown in the meantime.";
const UNRECOGNISED_GUIDANCE = "The giving-binding read answered with nothing this placement can read, so giving is unavailable here. Reload the placement to try again.";
const REFUSED_GUIDANCE = "The giving-binding read was refused before it read anything, so this placement has no giving destination to show. Reload the placement; nothing about this Page's giving is assumed in the meantime.";
const UNNAMED_GUIDANCE = "No Page was named, so there is no giving placement to read and no designation is assumed.";
// Types, taken from the read the service performs
/** The whole answer `reads.pages.readGivingBinding` gives, taken from the service so the payload shape cannot drift from it: the payload is the service's own, never a restatement of it here. */
type GivingBindingAnswer = Awaited<ReturnType<typeof reads.pages.readGivingBinding>>;
/** What a giving read states: the Page, the release it belongs to, the placement's binding and the progress the source qualifies. */
export type GivingBindingData = Extract<GivingBindingAnswer, { readonly kind: "envelope" }>["envelope"]["data"];
/** The scoped envelope a giving read answers with, which is what the placement renders. */
export type GivingBindingEnvelope = ReadEnvelope<GivingBindingData>;
/** What the placement carries: the one approved Designation, or the *Giving unavailable* state with its cause. */
export type GivingBindingState = GivingBindingData["binding"];
/** The closed set of causes a placement can show no giving for, spelled as the service sends them. */
export type GivingUnavailableCause = Extract<GivingBindingState, { readonly state: "unavailable" }>["cause"];
/** The three answers a giving read gives: the envelope, a denial carrying nothing about the record, or an outage. */
export type GivingBindingReadResult = ReadResult<GivingBindingEnvelope>;
/** What the placement's query hands back: the result above, and no error, because every failure is one of its three answers. */
export type UseGivingBindingResult = UseQueryResult<GivingBindingReadResult, never>;
/** The causes as the service sends them, listed once so a value outside this set is refused at the boundary instead of reaching a surface that would have to invent a fourth state for it. */
const GIVING_UNAVAILABLE_CAUSES = ["missing", "revoked", "incompatible"] as const satisfies readonly GivingUnavailableCause[];
const GIVING_UNAVAILABLE_CAUSE_SET: ReadonlySet<string> = new Set<string>(GIVING_UNAVAILABLE_CAUSES);

function isGivingUnavailableCause(value: unknown): value is GivingUnavailableCause {
  return typeof value === "string" && GIVING_UNAVAILABLE_CAUSE_SET.has(value);
}
function isGivingBindingState(value: unknown): value is GivingBindingState {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.state) {
    case "approved": {
      const designationRef = value.designationRef;
      return isNonEmptyString(value.designationLabel) && isRecord(designationRef) && isNonEmptyString(designationRef.system) && isNonEmptyString(designationRef.reference);
    }
    case "unavailable":
      return isGivingUnavailableCause(value.cause);
    default:
      return false;
  }
}
function isGivingBindingEnvelope(value: unknown): value is GivingBindingEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, source, coverage, valueStates, actions, asOf, revision } = value;
  return isRecord(data) && isGivingBindingState(data.binding) && isRecord(scope) && isRecord(source) && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions) && isNonEmptyString(asOf) && isNonEmptyString(revision);
}
// The one request
function givingBindingPath(documentId: string): string {
  return `${PAGES_ENDPOINT}?view=${GIVING_VIEW}&documentId=${encodeURIComponent(documentId)}`;
}
function handlerUnavailable(reference: string, guidance: string): GivingBindingReadResult {
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source: { system: HANDLER_SOURCE_SYSTEM, reference }, guidance }) };
}
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A body that is not JSON is an answer this placement cannot read, and the caller reports that as
    // an unavailable source rather than as a Page that has no giving designation.
    return undefined;
  }
}
function wrappedResultOf(result: ReadResult<unknown>, path: string): GivingBindingReadResult {
  switch (result.kind) {
    case "envelope": {
      const envelope = result.envelope;
      return isGivingBindingEnvelope(envelope) ? { kind: "envelope", envelope } : handlerUnavailable(path, UNRECOGNISED_GUIDANCE);
    }
    case "denied":
      return { kind: "denied", denied: result.denied };
    case "unavailable":
      return { kind: "unavailable", unavailable: result.unavailable };
    case "refused":
      return { kind: "refused", refused: result.refused };
    default:
      return assertNever(result, "Unhandled giving-binding read result");
  }
}
/** Reads one answer as the giving placement's result. */
function givingBindingResultOf(body: unknown, status: number, path: string): GivingBindingReadResult {
  if (isReadResult(body)) {
    return wrappedResultOf(body, path);
  }
  if (isOutcome(body)) {
    switch (body.outcome) {
      case "denied":
        return { kind: "denied", denied: body };
      case "unavailable":
        return { kind: "unavailable", unavailable: body };
      case "invalid":
        // The identifier this placement was asked for is not one the read admits: the field-keyed refusal
        // is handed on as the read's own answer, because the source behind it answered and only the
        // request was wrong.
        return { kind: "refused", refused: body };
      default:
        // A read is refused as `denied`, outaged as `unavailable`, answered as an envelope or refused as
        // `refused`. Any other outcome means the request never became a read of this placement, which is
        // reported as the source being unavailable to this read rather than as permission or as an empty
        // binding.
        return handlerUnavailable(path, REFUSED_GUIDANCE);
    }
  }
  if (status === ENVELOPE_STATUS && isGivingBindingEnvelope(body)) {
    return { kind: "envelope", envelope: body };
  }
  return handlerUnavailable(path, UNRECOGNISED_GUIDANCE);
}
async function fetchGivingBinding(documentId: string | undefined): Promise<GivingBindingReadResult> {
  if (documentId === undefined || documentId === UNNAMED_DOCUMENT) {
    return handlerUnavailable(PAGES_ENDPOINT, UNNAMED_GUIDANCE);
  }
  const path = givingBindingPath(documentId);
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    return handlerUnavailable(path, TRANSPORT_GUIDANCE);
  }
  const body = await readJsonBody(response);
  return givingBindingResultOf(body, response.status, path);
}
/** Reads the Page's one approved giving Designation, or the *Giving unavailable* state with its cause and no fallback fund; returns an envelope or a `denied`/`unavailable` outcome. */
export function useGivingBinding(scope: Scope, documentId: string | undefined): UseGivingBindingResult {
  return useQuery<GivingBindingReadResult, never>({
    queryKey: givingBindingKey(scope, documentId ?? UNNAMED_DOCUMENT),
    queryFn: () => fetchGivingBinding(documentId),
    // A placement with no Page named has nothing to read, so the query stays disabled rather than
    // asking the handler for a record the caller has not identified.
    enabled: Boolean(documentId),
    // Every failure is one of the three answers above, so a retry would only repeat a settled read:
    // a denial does not become permission and an outage is re-read by the invalidation or the reload
    // the surface offers.
    retry: false,
  });
}
