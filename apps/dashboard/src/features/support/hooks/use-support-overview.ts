"use client";
/** The Support overview's one browser read: the client half of `reads.support.readSupportOverview`, whose outcome set is `envelope | denied | unavailable | refused`. */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import type { Scope, reads } from "@/modules/data-service";
// Type-only: the outcome module imports `next/server` for its response mapping, so a value import
// would pull server code into the browser bundle. The two failure arms are decoded from the wire here.
import type { DeniedOutcome, InvalidOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";
/** What the overview read answers with, derived from the service instead of restated here. */
export type SupportOverviewRead = Awaited<ReturnType<typeof reads.support.readSupportOverview>>;

type SupportOverviewEnvelope = Extract<SupportOverviewRead, { readonly kind: "envelope" }>["envelope"];
/** What the overview hook needs to read the surface. */
export interface UseSupportOverviewOptions {
  readonly scope: Scope;
  readonly initialEnvelope?: SupportOverviewRead | undefined;
}
const OVERVIEW_ENDPOINT = "/api/support";

const OVERVIEW_JOB = "overview";

const OVERVIEW_STALE_TIME_MS = 30_000;
/** Reads the Support overview in the given scope: wraps `reads.support.readSupportOverview` and answers `envelope | denied | unavailable | refused`, unchanged. */
export function useSupportOverview({ scope, initialEnvelope }: UseSupportOverviewOptions): UseQueryResult<SupportOverviewRead> {
  return useQuery({ queryKey: [...scopeKey(scope), OVERVIEW_JOB], queryFn: fetchSupportOverview, staleTime: OVERVIEW_STALE_TIME_MS, refetchOnMount: false, initialData: initialEnvelope, initialDataUpdatedAt: initialEnvelope === undefined ? undefined : scenarioAnchorOf(initialEnvelope) });
}
function scenarioAnchorOf(result: SupportOverviewRead): number | undefined {
  if (result.kind !== "envelope") {
    return undefined;
  }
  const anchor = Date.parse(result.envelope.asOf);
  return Number.isFinite(anchor) ? anchor : undefined;
}
const ENVELOPE_STATUS = 200;
const DENIED_STATUS = 403;
/** A session that expired or could not be established answers 401 with the same denial, which is a session fault rather than a permission refusal. */
const SESSION_FAULT_STATUS = 401;
const UNAVAILABLE_STATUS = 503;
/** A query this read does not admit answers 422 with the field-keyed refusal, which is the request's own fault and not a source that did not answer. */
const REFUSED_STATUS = 422;

function noAnswer(status: number, detail: string): Error {
  return new Error(`${OVERVIEW_ENDPOINT} answered ${status} with ${detail}, so the overview read has no answer to state.`);
}
async function fetchSupportOverview(): Promise<SupportOverviewRead> {
  let response: Response;
  try {
    response = await fetch(OVERVIEW_ENDPOINT, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin" });
  } catch (cause) {
    throw new Error(`GET ${OVERVIEW_ENDPOINT} could not be completed.`, { cause });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(`GET ${OVERVIEW_ENDPOINT} answered ${response.status} with a body that is not JSON.`, { cause });
  }
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isOverviewEnvelope(payload)) {
        throw noAnswer(response.status, "a body that is not an overview envelope");
      }
      return { kind: "envelope", envelope: payload };
    case DENIED_STATUS:
    case SESSION_FAULT_STATUS:
      if (!isDeniedBody(payload)) {
        throw noAnswer(response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: payload };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(payload)) {
        throw noAnswer(response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: payload };
    case REFUSED_STATUS:
      if (!isRefusedBody(payload)) {
        throw noAnswer(response.status, "a body that is not a refused request");
      }
      return { kind: "refused", refused: payload };
    default:
      throw noAnswer(response.status, "a status this read does not answer with");
  }
}
function isOverviewEnvelope(value: unknown): value is SupportOverviewEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return isRecord(data) && isRecord(data.report) && Array.isArray(data.monthlyEquivalent) && Array.isArray(data.buckets) && Array.isArray(data.commitmentKinds) && isRecord(scope) && isRecord(coverage) && isRecord(valueStates) && Array.isArray(actions) && typeof asOf === "string" && typeof revision === "string";
}
function isDeniedBody(value: unknown): value is DeniedOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "denied" && typeof value.operationId === "string" && typeof value.reasonCode === "string";
}
function isUnavailableBody(value: unknown): value is UnavailableOutcome {
  if (!isRecord(value)) {
    return false;
  }
  const source = value.source;
  return value.outcome === "unavailable" && typeof value.operationId === "string" && typeof value.guidance === "string" && isRecord(source) && typeof source.system === "string" && typeof source.reference === "string";
}
function isRefusedBody(value: unknown): value is InvalidOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return value.outcome === "invalid" && typeof value.operationId === "string" && isRecord(value.fields);
}
