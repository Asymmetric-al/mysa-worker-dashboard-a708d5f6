/** The browser transport for the four bulk task actions. */
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The service resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";
/** The wording a caller reads when this transport refuses a body, or when a field fails its rule. */
const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  operationRequired: "State which bulk action this request makes as payload.operation: bulkApplyTag, bulkRemoveTag, bulkCreateTasks or bulkCompleteTasks.",
  selectionRequired: "Select at least one row, because a bulk action applies only to the rows you chose and never to a filter, a saved view or a whole list.",
  taskIdRequired: "A selection names each row by its task id, so include the id of every row you selected.",
  tagRequired: "Name the private tag this action applies, so each selected row carries the label you chose.",
  templateRequired: "Describe the follow-up task this action creates once per selected row, as a title with an optional category, due date and note.",
  titleRequired: "Give the follow-up task a title, because a title is the one thing a task cannot do without.",
  categoryInvalid: "A category is a short label of your own, so enter one or leave the field out.",
  dueDateInvalid: "Enter the follow-up due date as a calendar date written YYYY-MM-DD, so no row is given a day that does not exist.",
} as const;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
// The selection: explicit row ids, never a query. A bulk action that accepted a filter, a saved view or an "all matching" flag would turn a choice of rows into an audience (AAP 0.8.2).
const selectedTaskIds = z.array(z.string({ error: MESSAGES.taskIdRequired }).trim().min(1, MESSAGES.taskIdRequired), { error: MESSAGES.selectionRequired }).min(1, MESSAGES.selectionRequired);
const tagLabel = z.string({ error: MESSAGES.tagRequired }).trim().min(1, MESSAGES.tagRequired);
// The one task a bulk create repeats per selected row: an ordinary follow-up task, so no meeting timing, no linked record and no audience belongs to it. Timing a meeting is `createTask` on `/api/tasks`, and the strict schema below is what refuses those keys here rather than dropping
// them (AAP 0.8.2).
const followUpTemplate = z.strictObject(
  {
    title: z.string({ error: MESSAGES.titleRequired }).trim().min(1, MESSAGES.titleRequired),
    category: z.string({ error: MESSAGES.categoryInvalid }).trim().min(1, MESSAGES.categoryInvalid).optional(),
    // A due date is a calendar day, so a shape check is all this transport owns: the service judges whether the day exists, and nothing here turns a civil date into an instant.
    dueOn: z.string({ error: MESSAGES.dueDateInvalid }).regex(CIVIL_DATE_PATTERN, MESSAGES.dueDateInvalid).optional(),
    note: z.string().optional(),
  },
  { error: MESSAGES.templateRequired },
);
// One closed payload per mutation, discriminated by `payload.operation`. Every object here is strict: Zod strips unknown keys by default, so without it a body carrying `audience`, `consent`, `recipient`, `send`, `query`, `filter`, `all: true` or `selectAll` would be accepted silently and a
// selection would quietly become a campaign. `z.strictObject` is Zod 4's spelling of `.strict()`.
const bulkApplyTagPayload = z.strictObject({ operation: z.literal("bulkApplyTag"), taskIds: selectedTaskIds, tag: tagLabel });
const bulkRemoveTagPayload = z.strictObject({ operation: z.literal("bulkRemoveTag"), taskIds: selectedTaskIds, tag: tagLabel });
const bulkCreateTasksPayload = z.strictObject({ operation: z.literal("bulkCreateTasks"), taskIds: selectedTaskIds, template: followUpTemplate });
const bulkCompleteTasksPayload = z.strictObject({ operation: z.literal("bulkCompleteTasks"), taskIds: selectedTaskIds });
// One body schema per mutation: the four-field input the envelope owns, judged with that mutation's own payload. `operationId`, `scope` and `expectedRevision` are never restated here, so the caller's operation id and the revision it read reach the service exactly as it stated them.
const bulkApplyTagBody = mutationInputSchema(bulkApplyTagPayload);
const bulkRemoveTagBody = mutationInputSchema(bulkRemoveTagPayload);
const bulkCreateTasksBody = mutationInputSchema(bulkCreateTasksPayload);
const bulkCompleteTasksBody = mutationInputSchema(bulkCompleteTasksPayload);
const BULK_OPERATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;
type BulkOperation = (typeof BULK_OPERATIONS)[number];
function isBulkOperation(value: unknown): value is BulkOperation {
  return BULK_OPERATIONS.some((admitted) => admitted === value);
}
/** The action a body claims, read without a cast and without trusting that `payload` is an object. */
function claimedOperation(body: unknown): unknown {
  if (!isRecord(body)) {
    return undefined;
  }
  const payload: unknown = body.payload;
  return isRecord(payload) ? payload.operation : undefined;
}
/** The answer for a body this transport refused before calling the service. */
function refusal(operationId: string, path: readonly PropertyKey[], message: string): Response {
  return toResponse(outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: [...path], message }])));
}
/** One bulk action, chosen by `payload.operation`. */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  if (body === undefined) {
    // A body that is not JSON is a request the caller can correct, never a fault behind it, so it is answered as `invalid` on the `body` field rather than as `unknown` or a thrown 500.
    return refusal(UNIDENTIFIED_ATTEMPT, ["body"], MESSAGES.bodyNotJson);
  }
  const operation = claimedOperation(body);
  const operationId = operationIdentityOf(body);
  if (!isBulkOperation(operation)) {
    return refusal(operationId, ["payload", "operation"], MESSAGES.operationRequired);
  }
  switch (operation) {
    case "bulkApplyTag":
      return dispatch(bulkApplyTagBody, body, operationId, "operation", mutations.work.bulkApplyTag);
    case "bulkRemoveTag":
      return dispatch(bulkRemoveTagBody, body, operationId, "operation", mutations.work.bulkRemoveTag);
    case "bulkCreateTasks":
      return dispatch(bulkCreateTasksBody, body, operationId, "operation", mutations.work.bulkCreateTasks);
    case "bulkCompleteTasks":
      return dispatch(bulkCompleteTasksBody, body, operationId, "operation", mutations.work.bulkCompleteTasks);
    default:
      // Unreachable: the four names above are the closed set the guard admits, so a fifth action fails to compile here instead of reaching the runtime.
      return assertNever(operation, "Unhandled bulk task mutation");
  }
}
