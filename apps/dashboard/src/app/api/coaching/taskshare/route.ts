/** `GET /api/coaching/taskshare` — the task summaries the worker selected for sharing, and how each one stands now — and `POST /api/coaching/taskshare`, the two named changes a share admits. */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
/** The `invalid` constructor comes from the module that owns the outcome union rather than through the service barrel, which re-exports the conversion helpers only: a refusal built here is built the … */
import { invalid } from "@/modules/data-service/outcome";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
/** The store reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock once per request. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: shareTaskSummary or stopTaskShare.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  pageInvalid: "Read the page as a whole number of one or more, so the summaries arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the summaries arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
/** One payload type per named mutation, read from the mutation that validates it rather than restated here: the service's own strict schema stays the single definition of the field names it admits … */
type ShareTaskSummaryPayload = Parameters<typeof mutations.coaching.shareTaskSummary>[0]["payload"];
type StopTaskSharePayload = Parameters<typeof mutations.coaching.stopTaskShare>[0]["payload"];
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
// One body schema per mutation: the four-field envelope around that mutation's own payload
const shareTaskSummaryBodySchema = mutationInputSchema(z.custom<WirePayload<ShareTaskSummaryPayload, "shareTaskSummary">>());
const stopTaskShareBodySchema = mutationInputSchema(z.custom<WirePayload<StopTaskSharePayload, "stopTaskShare">>());
const TASK_SHARE_OPERATIONS = ["shareTaskSummary", "stopTaskShare"] as const;
// The read side: the page window the request stated, and nothing else it could ask for
type TaskShareListQuery = Parameters<typeof reads.coaching.readTaskShares>[0];
/** The page window a caller may state, in this read's own wording. */
const taskShareListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
// The write side: one named mutation per request
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TASK_SHARE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) });
/** The JSON object a change arrives in, or `undefined` when the body is absent or is not one. */
function jsonObjectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}
// The two verbs
/** One page of the worker's shared task summaries, each with the description that was reviewed, the task's live due date and status, and whether the description still matches the task. */
export async function GET(request: Request): Promise<Response> {
  try {
    const grammar = taskShareListQuerySchema.safeParse(pagingParamsOf(new URL(request.url).searchParams));
    if (!grammar.success) {
      // A paging value this read does not admit is a request-level refusal answered with the same per-field `invalid` outcome the two mutations answer, because no source behind the read failed and the caller has to be told which parameter to correct.
      return toResponse(refusedRead(READ_ATTEMPT_ID, grammar.error));
    }
    return toResponse(await reads.coaching.readTaskShares(grammar.data satisfies TaskShareListQuery));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named task-share mutation, selected by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const body = jsonObjectOf(raw);
  if (body === undefined) {
    // A body that never arrived as a JSON object is named where it went wrong — `body` — rather than under a root key a form cannot place against anything the caller sent.
    return toResponse(invalid({ operationId, fields: { body: [MESSAGES.bodyNotJson] } }));
  }
  const claimed = discriminantSchema.safeParse(body);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "shareTaskSummary":
      return dispatch(shareTaskSummaryBodySchema, raw, operationId, "operation", mutations.coaching.shareTaskSummary);
    case "stopTaskShare":
      return dispatch(stopTaskShareBodySchema, raw, operationId, "operation", mutations.coaching.stopTaskShare);
    default:
      // Unreachable: the two names above are the closed set the discriminant schema admits, so a third mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled coaching task-share mutation");
  }
}
