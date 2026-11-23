import type { NextRequest } from "next/server";
import { z } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, reads, toResponse } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { READ_ATTEMPT, readGrammar, readRoute } from "../../read";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { claimedBodyRoute, claimedWrites, jsonBodyOf, operationIdentityOf } from "../../handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: shareTaskSummary or stopTaskShare.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  pageInvalid: "Read the page as a whole number of one or more, so the summaries arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the summaries arrive in pages of the size you asked for; the service applies its own cap.",
} as const;
type ShareTaskSummaryPayload = Parameters<typeof mutations.coaching.shareTaskSummary>[0]["payload"];
type StopTaskSharePayload = Parameters<typeof mutations.coaching.stopTaskShare>[0]["payload"];
type WirePayload<Payload, Operation extends string> = Payload & { readonly operation: Operation };
const shareTaskSummaryBodySchema = mutationInputSchema(z.custom<WirePayload<ShareTaskSummaryPayload, "shareTaskSummary">>());
const stopTaskShareBodySchema = mutationInputSchema(z.custom<WirePayload<StopTaskSharePayload, "stopTaskShare">>());
const TASK_SHARE_OPERATIONS = ["shareTaskSummary", "stopTaskShare"] as const;
type TaskShareOperation = (typeof TASK_SHARE_OPERATIONS)[number];
const taskShareListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TASK_SHARE_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) });
const jsonObjectOf = (raw: unknown): Record<string, unknown> | undefined => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined);
/** One page of the worker's shared task summaries, each with the description that was reviewed, the task's live due date and status, and whether the description still matches the task. */
const readTaskShares = readRoute(readGrammar(taskShareListQuerySchema, pagingParamsOf), (query) => reads.coaching.readTaskShares(query), READ_ATTEMPT);
/** The two named task-share mutations, each judged by its own payload schema before it runs. */
const TASK_SHARE_WRITES = claimedWrites<TaskShareOperation>("operation", { shareTaskSummary: [shareTaskSummaryBodySchema, mutations.coaching.shareTaskSummary], stopTaskShare: [stopTaskShareBodySchema, mutations.coaching.stopTaskShare] });
/** One named task-share mutation, selected by `payload.operation`. */
async function changeTaskShare(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const body = jsonObjectOf(raw);
  if (body === undefined) return toResponse(invalid({ operationId, fields: { body: [MESSAGES.bodyNotJson] } }));
  return claimedBodyRoute(request, body, discriminantSchema, (claim) => claim.payload.operation, TASK_SHARE_WRITES);
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readTaskShares, POST: changeTaskShare });
