import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { isResolvableTimeZone } from "@/modules/time/civil";
import { claimedWriteRoute, claimedWrites } from "../handler";
import { READ_ATTEMPT, readGrammar, readRoute } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  titleRequired: "Give this task a title, because a title is the one thing a task cannot do without.",
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  categoryTooLong: "A category is a short label of your own, so shorten this one.",
  noteTooLong: "A note is a short reminder about the work, so shorten this one.",
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  linkInvalid: "Choose the linked record from the list, so a link names a record rather than a typed value.",
  dueDateInvalid: "Enter the due date as a real calendar date, so the work is never given a day that does not exist.",
  plannedTimeInvalid: "Enter the planned time as a 24-hour clock time, so a meeting states when it is planned rather than an instant in an assumed zone.",
  plannedTimeRequiresZone: "State the time zone the planned time is read in, so the clock reading is never taken as an assumed zone.",
  plannedTimeOnlyForMeeting: "A planned time belongs to a meeting task, so choose Meeting as the kind of work or remove the time.",
  plannedTimeOtherDay: "The planned time falls on a different day from the due date, so align the two before saving.",
  timeZoneInvalid: "Choose a time zone this runtime recognises, so a stored plan is read in a stated zone.",
  kindInvalid: "Choose Task or Meeting as the kind of work.",
  cancellationNotConfirmed: "Confirm the cancellation, because it is a deliberate act about this task.",
  operationRequired: "State which change this request makes as payload.operation: createTask, editTask, completeTask, reopenTask or cancelTask.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  displayTimeZoneRequired: "State the display time zone this view is read in, so every date in it is judged in the zone you chose rather than one this request assumes.",
  displayTimeZoneBlank: "Name the display time zone rather than leaving it blank, so no date in this view is judged in a zone nobody chose.",
  displayTimeZoneUnresolvable: "Name a display time zone this runtime resolves, such as UTC or Europe/London, so every date in this view is read in a zone that exists.",
  listInvalid: "Read one of the five lists — today, upcoming, overdue, all or undated — so the view holds the work you asked for rather than a wider list you did not.",
  sortInvalid: "Order the list as field:direction, with the field dueOn, title, category or status and the direction asc or desc, so the rows arrive in the order you asked for.",
} as const;
const TITLE_MAX_LENGTH = 200;
const CATEGORY_MAX_LENGTH = 60;
const NOTE_MAX_LENGTH = 2000;
const codePointLength = (value: string): number => Array.from(value).length;
const taskIdSchema = z.string({ error: MESSAGES.taskIdRequired }).trim().min(1, MESSAGES.taskIdRequired);
const linkIdSchema = z.string({ error: MESSAGES.linkInvalid }).trim().min(1, MESSAGES.linkInvalid);
const titleSchema = z
  .string({ error: MESSAGES.titleRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length === 0) {
      ctx.addIssue({ code: "custom", message: MESSAGES.titleRequired });
    } else if (length > TITLE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.titleTooLong });
    }
  });
const categorySchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CATEGORY_MAX_LENGTH) ctx.addIssue({ code: "custom", message: MESSAGES.categoryTooLong });
  });
const noteSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > NOTE_MAX_LENGTH) ctx.addIssue({ code: "custom", message: MESSAGES.noteTooLong });
  });
const civilDateSchema = z.iso.date({ error: MESSAGES.dueDateInvalid });
const timeZoneSchema = z.string({ error: MESSAGES.timeZoneInvalid }).trim().min(1, MESSAGES.timeZoneInvalid);
const TASK_KINDS = ["default", "meeting"] as const;
const taskKindSchema = z.enum(TASK_KINDS, { error: MESSAGES.kindInvalid });
const PLANNED_CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const PLANNED_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/u;
const plannedTimeSchema = z
  .string({ error: MESSAGES.plannedTimeInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (PLANNED_CLOCK_PATTERN.test(value)) return;
    const stated = PLANNED_DATE_TIME_PATTERN.exec(value);
    const day = stated?.[1];
    if (day === undefined || !civilDateSchema.safeParse(day).success) ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeInvalid });
  });
type PlannedPairing = { readonly kind?: "default" | "meeting" | undefined; readonly dueOn?: string | null | undefined; readonly plannedTime?: string | null | undefined; readonly timeZone?: string | null | undefined };
function refinePlannedPairing(value: PlannedPairing, ctx: z.RefinementCtx): void {
  const hasTime = value.plannedTime !== undefined && value.plannedTime !== null;
  const hasZone = value.timeZone !== undefined && value.timeZone !== null;
  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeOnlyForMeeting, path: ["plannedTime"] });
    return;
  }
  if (hasTime && !hasZone) {
    ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeRequiresZone, path: ["timeZone"] });
    return;
  }
  if (!hasTime && hasZone) {
    ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeRequiresZone, path: ["plannedTime"] });
    return;
  }
  const plannedDay = value.plannedTime === undefined || value.plannedTime === null ? undefined : PLANNED_DATE_TIME_PATTERN.exec(value.plannedTime)?.[1];
  const dueDay = value.dueOn;
  if (plannedDay !== undefined && dueDay !== undefined && dueDay !== null && plannedDay !== dueDay) ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeOtherDay, path: ["plannedTime"] });
}
const createTaskPayloadSchema = z
  .strictObject({
    operation: z.literal("createTask"),
    title: titleSchema,
    category: categorySchema.optional(),
    dueOn: civilDateSchema.optional(),
    kind: taskKindSchema.optional(),
    plannedTime: plannedTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    partnerId: linkIdSchema.optional(),
    initiativeId: linkIdSchema.optional(),
    note: noteSchema.optional(),
  })
  .superRefine(refinePlannedPairing);
const editTaskPayloadSchema = z
  .strictObject({
    operation: z.literal("editTask"),
    taskId: taskIdSchema,
    title: titleSchema.optional(),
    category: z.union([categorySchema, z.null()]).optional(),
    dueOn: z.union([civilDateSchema, z.null()]).optional(),
    kind: taskKindSchema.optional(),
    plannedTime: z.union([plannedTimeSchema, z.null()]).optional(),
    timeZone: z.union([timeZoneSchema, z.null()]).optional(),
    partnerId: z.union([linkIdSchema, z.null()]).optional(),
    initiativeId: z.union([linkIdSchema, z.null()]).optional(),
    note: z.union([noteSchema, z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== undefined) refinePlannedPairing(value, ctx);
  });
const completeTaskPayloadSchema = z.strictObject({ operation: z.literal("completeTask"), taskId: taskIdSchema });
const reopenTaskPayloadSchema = z.strictObject({ operation: z.literal("reopenTask"), taskId: taskIdSchema });
const cancelTaskPayloadSchema = z.strictObject({ operation: z.literal("cancelTask"), taskId: taskIdSchema, confirmed: z.literal(true, { error: MESSAGES.cancellationNotConfirmed }) });
const createTaskBodySchema = mutationInputSchema(createTaskPayloadSchema);
const editTaskBodySchema = mutationInputSchema(editTaskPayloadSchema);
const completeTaskBodySchema = mutationInputSchema(completeTaskPayloadSchema);
const reopenTaskBodySchema = mutationInputSchema(reopenTaskPayloadSchema);
const cancelTaskBodySchema = mutationInputSchema(cancelTaskPayloadSchema);
const TASK_OPERATIONS = ["createTask", "editTask", "completeTask", "reopenTask", "cancelTask"] as const;
type TaskOperation = (typeof TASK_OPERATIONS)[number];
type TaskListQuery = Parameters<typeof reads.work.listTasks>[0];
type TaskSortInstruction = NonNullable<TaskListQuery["sort"]>[number];
const TASK_LIST_NAMES = ["today", "upcoming", "overdue", "all", "undated"] as const satisfies readonly TaskListQuery["list"][];
const TASK_SORT_FIELDS = ["dueOn", "title", "category", "status"] as const satisfies readonly TaskSortInstruction["field"][];
const TASK_SORT_DIRECTIONS = ["asc", "desc"] as const satisfies readonly TaskSortInstruction["direction"][];
const isTaskSortField = (value: string): value is TaskSortInstruction["field"] => TASK_SORT_FIELDS.some((admitted) => admitted === value);
const isTaskSortDirection = (value: string): value is TaskSortInstruction["direction"] => TASK_SORT_DIRECTIONS.some((admitted) => admitted === value);
const displayTimeZoneSchema = z
  .string({ error: MESSAGES.displayTimeZoneRequired })
  .trim()
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: MESSAGES.displayTimeZoneBlank });
      return;
    }
    if (!isResolvableTimeZone(value)) ctx.addIssue({ code: "custom", message: MESSAGES.displayTimeZoneUnresolvable });
  });
const listNameSchema = z.enum(TASK_LIST_NAMES, { error: MESSAGES.listInvalid });
const sortSchema = z.array(z.string()).transform((tokens: readonly string[], context): readonly TaskSortInstruction[] => {
  const instructions: TaskSortInstruction[] = [];
  for (const token of tokens) {
    const separator = token.indexOf(":");
    const field = separator === -1 ? token : token.slice(0, separator);
    const direction = separator === -1 ? "" : token.slice(separator + 1);
    if (!isTaskSortField(field) || !isTaskSortDirection(direction)) {
      context.addIssue({ code: "custom", message: MESSAGES.sortInvalid });
      return z.NEVER;
    }
    instructions.push({ field, direction });
  }
  return instructions;
});
const taskListQuerySchema = z.object({ displayTimeZone: displayTimeZoneSchema, list: listNameSchema.optional(), sort: sortSchema.optional() });
type TaskListQueryParams = z.output<typeof taskListQuerySchema>;
function rawTaskListParams(search: URLSearchParams): Record<string, unknown> {
  const sort = search.getAll("sort").flatMap((value) => value.split(","));
  return { displayTimeZone: search.get("displayTimeZone") ?? undefined, list: search.get("list") ?? undefined, sort: sort.length === 0 ? undefined : sort };
}
function taskListQueryOf(search: URLSearchParams, params: TaskListQueryParams): TaskListQuery {
  const page = search.get("page");
  const pageSize = search.get("pageSize");
  return { list: params.list ?? "all", displayTimeZone: params.displayTimeZone, page: page === null ? undefined : Number(page), pageSize: pageSize === null ? undefined : Number(pageSize), ...(params.sort === undefined ? {} : { sort: params.sort }) };
}
type AgendaReadQuery = Parameters<typeof reads.work.readAgenda>[0];
const READ_PARAM = "read";
const AGENDA_READ = "readAgenda";
const agendaQuerySchema = z.object({ displayTimeZone: displayTimeZoneSchema });
type AgendaQueryParams = z.output<typeof agendaQuerySchema>;
const rawAgendaParams = (search: URLSearchParams): Record<string, unknown> => ({ displayTimeZone: search.get("displayTimeZone") ?? undefined });
function agendaQueryOf(search: URLSearchParams, params: AgendaQueryParams): AgendaReadQuery {
  const page = search.get("page");
  const pageSize = search.get("pageSize");
  return { displayTimeZone: params.displayTimeZone, page: page === null ? undefined : Number(page), pageSize: pageSize === null ? undefined : Number(pageSize) };
}
const discriminantSchema = z.object({ payload: z.object({ operation: z.enum(TASK_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.bodyNotJson });
const LIST_ROUTE = readRoute(readGrammar(taskListQuerySchema, rawTaskListParams), (params, search) => reads.work.listTasks(taskListQueryOf(search, params)), READ_ATTEMPT);
const AGENDA_ROUTE = readRoute(readGrammar(agendaQuerySchema, rawAgendaParams), (params, search) => reads.work.readAgenda(agendaQueryOf(search, params)), READ_ATTEMPT);
/** One page of one task list or of the dated agenda, exactly as the request asked for it. */
export const GET = (request: Request): Promise<Response> => (new URL(request.url).searchParams.get(READ_PARAM) === AGENDA_READ ? AGENDA_ROUTE(request) : LIST_ROUTE(request));
/** The five named task mutations, each judged by its own payload schema before it runs. */
const TASK_WRITES = claimedWrites<TaskOperation>("operation", {
  createTask: [createTaskBodySchema, mutations.work.createTask],
  editTask: [editTaskBodySchema, mutations.work.editTask],
  completeTask: [completeTaskBodySchema, mutations.work.completeTask],
  reopenTask: [reopenTaskBodySchema, mutations.work.reopenTask],
  cancelTask: [cancelTaskBodySchema, mutations.work.cancelTask],
});
/** One named task mutation, selected by `payload.operation`. */
export const POST = (request: NextRequest): Promise<Response> => claimedWriteRoute(request, discriminantSchema, (claim) => claim.payload.operation, TASK_WRITES);
