/**
 * The browser transport for the four bulk task actions.
 *
 * AAP 0.6.3 places `POST /api/tasks/bulk` here and binds it to `bulkApplyTag`, `bulkRemoveTag`,
 * `bulkCreateTasks` and `bulkCompleteTasks`. It allows one closed schema per mutation on a shared
 * path while forbidding the universal command dispatcher, so a request names its action in
 * `payload.operation` and nothing else selects it. AAP 0.7.1 fixes the four-field input
 * `{operationId, scope, expectedRevision, payload}` and the closed eight-outcome set, and AAP 0.8.2
 * fixes what a bulk action may be: the two directions of one private-tag action, ordinary follow-up
 * tasks, and rows that can be completed independently — reported per item as `accepted`,
 * `unchanged`, `excluded` or `failed`, never as an aggregate "done", because a selection is never an
 * audience, a consent or a campaign.
 *
 * This handler routes and maps and decides nothing. Eligibility, the private-tag rule, the revision
 * check and every per-item result belong to the service behind `@/modules/data-service`, and no rate
 * limiter or quota sits here because the plan fixes none.
 */
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
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

// The selection: explicit row ids, never a query. A bulk action that accepted a filter, a saved view
// or an "all matching" flag would turn a choice of rows into an audience (AAP 0.8.2).
const selectedTaskIds = z.array(z.string({ error: MESSAGES.taskIdRequired }).trim().min(1, MESSAGES.taskIdRequired), { error: MESSAGES.selectionRequired }).min(1, MESSAGES.selectionRequired);

const tagLabel = z.string({ error: MESSAGES.tagRequired }).trim().min(1, MESSAGES.tagRequired);

// The one task a bulk create repeats per selected row: an ordinary follow-up task, so no meeting
// timing, no linked record and no audience belongs to it. Timing a meeting is `createTask` on
// `/api/tasks`, and the strict schema below is what refuses those keys here rather than dropping
// them (AAP 0.8.2).
const followUpTemplate = z.strictObject(
  {
    title: z.string({ error: MESSAGES.titleRequired }).trim().min(1, MESSAGES.titleRequired),
    category: z.string({ error: MESSAGES.categoryInvalid }).trim().min(1, MESSAGES.categoryInvalid).optional(),
    // A due date is a calendar day, so a shape check is all this transport owns: the service judges
    // whether the day exists, and nothing here turns a civil date into an instant.
    dueOn: z.string({ error: MESSAGES.dueDateInvalid }).regex(CIVIL_DATE_PATTERN, MESSAGES.dueDateInvalid).optional(),
    note: z.string().optional(),
  },
  { error: MESSAGES.templateRequired },
);

// One closed payload per mutation, discriminated by `payload.operation`. Every object here is strict:
// Zod strips unknown keys by default, so without it a body carrying `audience`, `consent`,
// `recipient`, `send`, `query`, `filter`, `all: true` or `selectAll` would be accepted silently and a
// selection would quietly become a campaign. `z.strictObject` is Zod 4's spelling of `.strict()`.
const bulkApplyTagPayload = z.strictObject({
  operation: z.literal("bulkApplyTag"),
  taskIds: selectedTaskIds,
  tag: tagLabel,
});

const bulkRemoveTagPayload = z.strictObject({
  operation: z.literal("bulkRemoveTag"),
  taskIds: selectedTaskIds,
  tag: tagLabel,
});

const bulkCreateTasksPayload = z.strictObject({
  operation: z.literal("bulkCreateTasks"),
  taskIds: selectedTaskIds,
  template: followUpTemplate,
});

const bulkCompleteTasksPayload = z.strictObject({
  operation: z.literal("bulkCompleteTasks"),
  taskIds: selectedTaskIds,
});

// One body schema per mutation: the four-field input the envelope owns, judged with that mutation's
// own payload. `operationId`, `scope` and `expectedRevision` are never restated here, so the caller's
// operation id and the revision it read reach the service exactly as it stated them.
const bulkApplyTagBody = mutationInputSchema(bulkApplyTagPayload);
const bulkRemoveTagBody = mutationInputSchema(bulkRemoveTagPayload);
const bulkCreateTasksBody = mutationInputSchema(bulkCreateTasksPayload);
const bulkCompleteTasksBody = mutationInputSchema(bulkCompleteTasksPayload);

const BULK_OPERATIONS = ["bulkApplyTag", "bulkRemoveTag", "bulkCreateTasks", "bulkCompleteTasks"] as const;

type BulkOperation = (typeof BULK_OPERATIONS)[number];

/** The operation id an `invalid` outcome carries when the body named none this transport could read. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

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

/** The operation id a refused body still needs, so a caller can match the answer to its own attempt. */
function claimedOperationId(body: unknown): string {
  if (!isRecord(body)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const operationId: unknown = body.operationId;
  return typeof operationId === "string" && operationId.length > 0 ? operationId : UNIDENTIFIED_ATTEMPT;
}

/**
 * The answer for a body this transport refused before calling the service. The refusal is stated as a
 * validation issue at the caller's own field path, so `outcomeFromError` and `toResponse` produce
 * exactly the `invalid` outcome any other validation failure produces — the field path here is the
 * body's, and a `payload.`-prefixed path is re-based onto the payload on the way out.
 */
function refusal(operationId: string, path: readonly PropertyKey[], message: string): Response {
  return toResponse(outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: [...path], message }])));
}

/**
 * Why a field the caller sent has no place in this request. The reason differs by where the surplus
 * field sits: outside the template it is a selection pretending to be an audience or a query, and
 * inside it, it is a follow-up task pretending to be a scheduled meeting.
 */
function surplusFieldMessage(path: readonly PropertyKey[], key: string): string {
  if (path.includes("template")) {
    return `Remove "${key}": a bulk follow-up task is ordinary work, so it carries a title with an optional category, due date and note; timing a meeting is one task created on /api/tasks.`;
  }
  return `Remove "${key}": a bulk request carries its operation, the rows you selected and the fields of that action, so it never carries an audience, a consent, a filter, a saved view or a send.`;
}

/**
 * Re-keys each surplus-key issue onto the key that is surplus, so a body carrying `audience`,
 * `consent` or `send` is refused at `payload.audience` rather than at the whole payload. Zod holds the
 * names in the issue but places the path at the object, which cannot tell a caller which field to
 * remove.
 */
function fieldError(error: z.ZodError): z.ZodError {
  const issues: z.ZodError["issues"][number][] = [];
  let rekeyed = false;
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      rekeyed = true;
      for (const key of issue.keys) {
        issues.push({
          code: "custom",
          path: [...issue.path, key],
          message: surplusFieldMessage(issue.path, key),
        });
      }
      continue;
    }
    issues.push(issue);
  }
  return rekeyed ? new z.ZodError(issues) : error;
}

/** The payload the service validates: the action's own fields, without the discriminant that chose it. */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Judges one body against one mutation's own schema and calls that mutation by name. Nothing is
 * retried, defaulted or summarised: the outcome — including every per-item result — is returned as the
 * service produced it.
 */
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  body: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, fieldError(parsed.error)));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // One mapper decides what a thrown fault means: a store outage is `unavailable`, an unrecognised
    // failure is `unknown` carrying the operation id a caller can re-query.
    return toResponse(outcomeFromError(operationId, error));
  }
}

/**
 * One bulk action, chosen by `payload.operation`. There is no fifth action: a bulk cancel, delete or
 * undo does not exist, and a name this transport does not admit is a request the caller can correct.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // A body that is not JSON is a request the caller can correct, never a fault behind it, so it is
    // answered as `invalid` on the `body` field rather than as `unknown` or a thrown 500.
    return refusal(UNIDENTIFIED_ATTEMPT, ["body"], MESSAGES.bodyNotJson);
  }
  const operation = claimedOperation(body);
  const operationId = claimedOperationId(body);
  if (!isBulkOperation(operation)) {
    return refusal(operationId, ["payload", "operation"], MESSAGES.operationRequired);
  }
  switch (operation) {
    case "bulkApplyTag":
      return dispatch(bulkApplyTagBody, body, operationId, mutations.work.bulkApplyTag);
    case "bulkRemoveTag":
      return dispatch(bulkRemoveTagBody, body, operationId, mutations.work.bulkRemoveTag);
    case "bulkCreateTasks":
      return dispatch(bulkCreateTasksBody, body, operationId, mutations.work.bulkCreateTasks);
    case "bulkCompleteTasks":
      return dispatch(bulkCompleteTasksBody, body, operationId, mutations.work.bulkCompleteTasks);
    default:
      // Unreachable: the four names above are the closed set the guard admits, so a fifth action
      // fails to compile here instead of reaching the runtime.
      return assertNever(operation, "Unhandled bulk task mutation");
  }
}
