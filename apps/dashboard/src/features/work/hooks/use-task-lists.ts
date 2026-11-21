"use client";
/**
 * The Work surface's one browser read of the five task lists: the client half of
 * `reads.work.listTasks`, answering `envelope | denied | unavailable` exactly as that read answers.
 *
 * **What it does not do.** It computes nothing. Which list a row belongs to, the whole-result `total`,
 * the coverage and the `asOf` instant all arrive in the envelope, because the service filters, sorts
 * and pages over the whole authorised dataset (AAP 0.8.1) and a second computation here is how a
 * list starts disagreeing with the report beside it. It reads no clock — a caller that needs "now"
 * reads `asOf` from the envelope — it derives no scope, and it adds no freshness window of its own,
 * so a list mounted after the scenario clock moves is read again rather than served from a page that
 * is no longer true.
 *
 * **Why the wire decodes the three arms instead of asserting them.** `toResponse` flattens a read
 * onto the status: 200 carries the envelope itself with no `kind` wrapper, 403 the denial and 503 the
 * outage. Asserting the body as the read's result would therefore hand a caller a value whose `kind`
 * is `undefined`, so a denial or an outage would render as a task list — the thing Rule 1 clause 3
 * forbids. The three arms are rebuilt here from the status, and a status or body this read does not
 * answer with is thrown as the fault it is rather than invented as an empty list.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
// Type-only, like every data-service import here: these are the read's own contract, and the client
// bundle takes the types without loading the modules that produce them.
import type { Scope, reads } from "@/modules/data-service";
import type { DeniedOutcome, UnavailableOutcome } from "@/modules/data-service/outcome";

// ---------------------------------------------------------------------------------------------
// The read's own contract, derived rather than restated
// ---------------------------------------------------------------------------------------------

/** What a caller asks the lists for — `reads.work.listTasks`'s own query, so a second description of the list query cannot drift from the service's. */
export type TaskListsQuery = Parameters<typeof reads.work.listTasks>[0];

/** What `reads.work.listTasks` answers: the scoped envelope, or the reason it could not be built, handed on unwrapped. */
export type TaskListsResult = Awaited<ReturnType<typeof reads.work.listTasks>>;

/** The envelope arm alone, which is the one shape the wire guard has to admit. */
type TaskListsEnvelope = Extract<TaskListsResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------------------------

/** The task handler's read path (AAP 0.6.3): relative, because the browser transport is this application's own origin. */
const TASKS_ENDPOINT = "/api/tasks";

/** The cache-key job segment, beside the scope segments `scopeKey` already supplies. */
const TASKS_JOB = "tasks";

/** The read this request asks for, named on the wire so one request in a log says which read it made. */
const READ_PARAM = "read";

const TASKS_READ = "listTasks";

/**
 * Every member of the query and the request field that carries it. Typed as a total map over
 * `keyof TaskListsQuery`, so a member added to the read's query fails to compile here rather than
 * being silently left out of the request while still present in the cache key.
 */
const WIRE_PARAM = {
  list: "list",
  displayTimeZone: "displayTimeZone",
  page: "page",
  pageSize: "pageSize",
  sort: "sort",
} as const satisfies Record<keyof TaskListsQuery, string>;

/** How one ordering instruction is stated on the wire: the handler's own `field:direction` token. */
const SORT_TOKEN_SEPARATOR = ":";

const ENVELOPE_STATUS = 200;

const DENIED_STATUS = 403;

const UNAVAILABLE_STATUS = 503;

/**
 * Writes a list query as the handler's search string: every member stated rather than paraphrased,
 * with the ordering sent as one repeated token per instruction — the grammar `GET /api/tasks` reads.
 */
function toTaskListSearch(query: TaskListsQuery): string {
  const search = new URLSearchParams();
  search.set(READ_PARAM, TASKS_READ);
  search.set(WIRE_PARAM.list, query.list);
  search.set(WIRE_PARAM.displayTimeZone, query.displayTimeZone);
  if (query.page !== undefined) {
    search.set(WIRE_PARAM.page, String(query.page));
  }
  if (query.pageSize !== undefined) {
    search.set(WIRE_PARAM.pageSize, String(query.pageSize));
  }
  for (const instruction of query.sort ?? []) {
    search.append(WIRE_PARAM.sort, `${instruction.field}${SORT_TOKEN_SEPARATOR}${instruction.direction}`);
  }
  return search.toString();
}

// ---------------------------------------------------------------------------------------------
// The one request
// ---------------------------------------------------------------------------------------------

function noAnswer(status: number, detail: string): Error {
  return new Error(`${TASKS_ENDPOINT} answered ${status} with ${detail}, so this task list has no answer to show.`);
}

/** Reads one page of one task list and answers the read's own result; a transport fault or an answer this read does not give is thrown, never dressed as an empty list. */
async function fetchTaskLists(query: TaskListsQuery, signal: AbortSignal): Promise<TaskListsResult> {
  let response: Response;
  try {
    response = await fetch(`${TASKS_ENDPOINT}?${toTaskListSearch(query)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
  } catch (cause) {
    throw new Error(`GET ${TASKS_ENDPOINT} could not be completed.`, { cause });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(`GET ${TASKS_ENDPOINT} answered ${response.status} with a body that is not JSON.`, { cause });
  }
  switch (response.status) {
    case ENVELOPE_STATUS:
      if (!isTaskListsEnvelope(payload)) {
        throw noAnswer(response.status, "a body that is not a task list envelope");
      }
      return { kind: "envelope", envelope: payload };
    case DENIED_STATUS:
      if (!isDeniedBody(payload)) {
        throw noAnswer(response.status, "a body that is not a denial");
      }
      return { kind: "denied", denied: payload };
    case UNAVAILABLE_STATUS:
      if (!isUnavailableBody(payload)) {
        throw noAnswer(response.status, "a body that is not an unavailable source");
      }
      return { kind: "unavailable", unavailable: payload };
    default:
      throw noAnswer(response.status, "a status this read does not answer with");
  }
}

function isTaskListsEnvelope(value: unknown): value is TaskListsEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const { data, scope, coverage, valueStates, actions, asOf, revision } = value;
  return (
    isRecord(data) &&
    typeof data.list === "string" &&
    typeof data.displayTimeZone === "string" &&
    typeof data.today === "string" &&
    Array.isArray(data.tasks) &&
    typeof data.total === "number" &&
    isRecord(scope) &&
    isRecord(coverage) &&
    isRecord(valueStates) &&
    Array.isArray(actions) &&
    typeof asOf === "string" &&
    typeof revision === "string"
  );
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
  return (
    value.outcome === "unavailable" &&
    typeof value.operationId === "string" &&
    typeof value.guidance === "string" &&
    isRecord(source) &&
    typeof source.system === "string" &&
    typeof source.reference === "string"
  );
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

/**
 * Reads one of the five task lists for the given scope and query: `reads.work.listTasks` over
 * `GET /api/tasks`, returning the read's `envelope | denied | unavailable` unchanged so a caller
 * narrows on it and never sees a denial or an outage as a list.
 */
export function useTaskLists(scope: Scope, query: TaskListsQuery): UseQueryResult<TaskListsResult> {
  return useQuery({
    // The whole query sits in the key, because the request sends the whole query: no two different
    // lists or pages may share one entry. The scope segments come from the one builder the context
    // fence clears, so a switch cannot leave a previous ministry's rows in reach.
    queryKey: [...scopeKey(scope), TASKS_JOB, query],
    // The signal is forwarded, which is what lets the context fence's `cancelQueries()` abort a read
    // that was issued under the context the worker has just left.
    queryFn: ({ signal }) => fetchTaskLists(query, signal),
  });
}
