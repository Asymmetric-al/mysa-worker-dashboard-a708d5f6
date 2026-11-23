import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, dispatch, jsonBodyOf, operationIdentityOf } from "../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
const selectedTaskIds = z.array(z.string({ error: MESSAGES.taskIdRequired }).trim().min(1, MESSAGES.taskIdRequired), { error: MESSAGES.selectionRequired }).min(1, MESSAGES.selectionRequired);
const tagLabel = z.string({ error: MESSAGES.tagRequired }).trim().min(1, MESSAGES.tagRequired);
const followUpTemplate = z.strictObject(
  {
    title: z.string({ error: MESSAGES.titleRequired }).trim().min(1, MESSAGES.titleRequired),
    category: z.string({ error: MESSAGES.categoryInvalid }).trim().min(1, MESSAGES.categoryInvalid).optional(),
    dueOn: z.string({ error: MESSAGES.dueDateInvalid }).regex(CIVIL_DATE_PATTERN, MESSAGES.dueDateInvalid).optional(),
    note: z.string().optional(),
  },
  { error: MESSAGES.templateRequired },
);
const bulkApplyTagPayload = z.strictObject({ operation: z.literal("bulkApplyTag"), taskIds: selectedTaskIds, tag: tagLabel });
const bulkRemoveTagPayload = z.strictObject({ operation: z.literal("bulkRemoveTag"), taskIds: selectedTaskIds, tag: tagLabel });
const bulkCreateTasksPayload = z.strictObject({ operation: z.literal("bulkCreateTasks"), taskIds: selectedTaskIds, template: followUpTemplate });
const bulkCompleteTasksPayload = z.strictObject({ operation: z.literal("bulkCompleteTasks"), taskIds: selectedTaskIds });
const bulkApplyTagBody = mutationInputSchema(bulkApplyTagPayload);
const bulkRemoveTagBody = mutationInputSchema(bulkRemoveTagPayload);
const bulkCreateTasksBody = mutationInputSchema(bulkCreateTasksPayload);
const bulkCompleteTasksBody = mutationInputSchema(bulkCompleteTasksPayload);
const BULK_OPERATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;
type BulkOperation = (typeof BULK_OPERATIONS)[number];
const isBulkOperation = (value: unknown): value is BulkOperation => BULK_OPERATIONS.some((admitted) => admitted === value);
function claimedOperation(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  const payload: unknown = body.payload;
  return isRecord(payload) ? payload.operation : undefined;
}
const refusal = (operationId: string, path: readonly PropertyKey[], message: string): Response => toResponse(outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: [...path], message }])));
/** One bulk action, chosen by `payload.operation`. */
async function applyBulkAction(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  if (body === undefined) return refusal(UNIDENTIFIED_ATTEMPT, ["body"], MESSAGES.bodyNotJson);
  const operation = claimedOperation(body);
  const operationId = operationIdentityOf(body);
  if (!isBulkOperation(operation)) return refusal(operationId, ["payload", "operation"], MESSAGES.operationRequired);
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
      return assertNever(operation, "Unhandled bulk task mutation");
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: applyBulkAction });
