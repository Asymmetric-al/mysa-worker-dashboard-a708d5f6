/**
 * The browser transport for the one task model.
 *
 * `GET` reads the caller's query — `list`, `displayTimeZone`, `page`, `pageSize` and `sort`
 * (repeated or comma-separated `field:direction` tokens) — and refuses one that names a display zone
 * it cannot resolve, a list outside the five, or an ordering outside the four fields and two
 * directions, because a due date judged in an assumed zone puts work in a list nobody asked for and a
 * silently widened list or changed order answers a question the caller did not ask. A query that
 * passes goes to `reads.work.listTasks` as stated, and the read owns the page window, the 50-row
 * default and the 200-row cap behind those names.
 *
 * `POST` runs exactly one named mutation. Its discriminant is `payload.operation`, whose closed set
 * is `createTask`, `editTask`, `completeTask`, `reopenTask` and `cancelTask` — the mutation names
 * themselves, so it is routing metadata rather than a task field: it selects one schema here and is
 * removed before that mutation's own strict schema reads the payload, which is why
 * `modules/data-service/mutations/tasks.ts` declares no such member.
 *
 * The rule every client payload schema follows, and every remaining handler follows with it: the
 * payload carries `operation` as routing metadata, each client schema states it as a defaulted literal
 * so the schema's *output* — the wire payload the hooks compose — carries it, and the handler removes
 * it before the mutation's own closed schema reads the payload. The shape alone could not choose the
 * mutation, because `completeTask` and `reopenTask` are both an identifier and nothing else, so a
 * payload that states no `operation` is refused `invalid` keyed `payload.operation`.
 */

import { z } from "zod";

import { assertNever } from "@/lib/result";
import {
  mutationInputSchema,
  mutations,
  outcomeFromError,
  reads,
  toResponse,
  type MutationInput,
  type MutationOutcome,
} from "@/modules/data-service";
import { isResolvableTimeZone } from "@/modules/time/civil";

// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session and evaluates the scenario clock once per request.
export const dynamic = "force-dynamic";

/**
 * The marker the service puts on an attempt that carries no identity of its own.
 *
 * An invalid answer still names an attempt, and a body so malformed that it states no `operationId`
 * has no other identity to report. Matching the service's own marker keeps the two answers alike.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** A read has no attempt to replay, so its failure marker matches the one the reads modules state. */
const READ_ATTEMPT_ID = "read";

/**
 * The wording every refusal in this file uses.
 *
 * The field messages repeat the service's own wording for the same rules, because the mutation
 * re-validates every payload under identical constraints: a worker who corrects a field must not be
 * told two different things about it depending on which layer refused it. The transport messages
 * after them describe a request this file refused before any mutation or read saw it: the write
 * side's two, and the read side's own refusals of a query value the service does not admit.
 */
const MESSAGES = {
  titleRequired:
    "Give this task a title, because a title is the one thing a task cannot do without.",
  titleTooLong: "Shorten the title to a phrase, so it reads at a glance in a list.",
  categoryTooLong: "A category is a short label of your own, so shorten this one.",
  noteTooLong: "A note is a short reminder about the work, so shorten this one.",
  taskIdRequired: "This action applies to one task, so open the task again and retry.",
  linkInvalid:
    "Choose the linked record from the list, so a link names a record rather than a typed value.",
  dueDateInvalid:
    "Enter the due date as a real calendar date, so the work is never given a day that does not exist.",
  plannedTimeInvalid:
    "Enter the planned time as a 24-hour clock time, so a meeting states when it is planned rather than an instant in an assumed zone.",
  plannedTimeRequiresZone:
    "State the time zone the planned time is read in, so the clock reading is never taken as an assumed zone.",
  plannedTimeOnlyForMeeting:
    "A planned time belongs to a meeting task, so choose Meeting as the kind of work or remove the time.",
  plannedTimeOtherDay:
    "The planned time falls on a different day from the due date, so align the two before saving.",
  timeZoneInvalid:
    "Choose a time zone this runtime recognises, so a stored plan is read in a stated zone.",
  kindInvalid: "Choose Task or Meeting as the kind of work.",
  cancelReasonTooLong: "A cancellation reason is a short note, so shorten this one.",
  cancellationNotConfirmed:
    "Confirm the cancellation, because it is a deliberate act about this task.",
  operationRequired:
    "State which change this request makes as payload.operation: createTask, editTask, completeTask, reopenTask or cancelTask.",
  bodyNotJson:
    "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  displayTimeZoneRequired:
    "State the display time zone this view is read in, so every date in it is judged in the zone you chose rather than one this request assumes.",
  displayTimeZoneBlank:
    "Name the display time zone rather than leaving it blank, so no date in this view is judged in a zone nobody chose.",
  displayTimeZoneUnresolvable:
    "Name a display time zone this runtime resolves, such as UTC or Europe/London, so every date in this view is read in a zone that exists.",
  listInvalid:
    "Read one of the five lists — today, upcoming, overdue, all or undated — so the view holds the work you asked for rather than a wider list you did not.",
  sortInvalid:
    "Order the list as field:direction, with the field dueOn, title, category or status and the direction asc or desc, so the rows arrive in the order you asked for.",
} as const;

// ---------------------------------------------------------------------------------------------
// Lengths the composer and these schemas share
// ---------------------------------------------------------------------------------------------

/** The longest title, counted in Unicode code points, as the mutation counts it. */
const TITLE_MAX_LENGTH = 200;

/** The longest category label, counted in Unicode code points. */
const CATEGORY_MAX_LENGTH = 60;

/** The longest note attached to a task, counted in Unicode code points. */
const NOTE_MAX_LENGTH = 2000;

/** The longest cancellation reason, counted in Unicode code points. */
const CANCEL_REASON_MAX_LENGTH = 500;

/** Counts a value in Unicode code points, so a script outside the Basic Multilingual Plane counts once. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

// ---------------------------------------------------------------------------------------------
// Field shapes the five task mutations declare
// ---------------------------------------------------------------------------------------------

/**
 * An opaque record identifier.
 *
 * Never parsed for meaning and never compared with a name or an email address: an identifier is a
 * handle to one record inside one scope, and equal-looking values establish neither identity nor
 * authority.
 */
const taskIdSchema = z
  .string({ error: MESSAGES.taskIdRequired })
  .trim()
  .min(1, MESSAGES.taskIdRequired);

/** An optional link to a partner or an initiative, chosen from the options a read admitted. */
const linkIdSchema = z.string({ error: MESSAGES.linkInvalid }).trim().min(1, MESSAGES.linkInvalid);

/** A task title: the one field a task cannot do without. Trimmed, non-empty, bounded. */
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

/**
 * A category: the worker's own short label.
 *
 * Not an enum and not a taxonomy, so there is no allowed-value list to keep in step with anything.
 * Blank text is left for the mutation to read as the absent state, because an uncategorised task is a
 * complete state rather than a missing value.
 */
const categorySchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CATEGORY_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.categoryTooLong });
    }
  });

/** A note: private preparation about the work, never a record of what happened. */
const noteSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > NOTE_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.noteTooLong });
    }
  });

/** A cancellation reason: a short explanation, never a hidden note about a person. */
const cancelReasonSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > CANCEL_REASON_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: MESSAGES.cancelReasonTooLong });
    }
  });

/**
 * A civil date carried as `YYYY-MM-DD`, and read as a calendar date.
 *
 * A day past the end of its month is refused rather than rolled forward, and no time of day, zone or
 * instant is invented for it — so a due date stays the day the worker chose and a change of display
 * zone never rebases it.
 */
const civilDateSchema = z.iso.date({ error: MESSAGES.dueDateInvalid });

/**
 * The zone a planned time is stated in.
 *
 * Emptiness is refused here because a wall-clock reading without its zone is a time in an assumed
 * zone. Whether this runtime can resolve the identifier is the mutation's question, asked against its
 * own time-zone data rather than against a list this file would have to keep in step.
 */
const timeZoneSchema = z
  .string({ error: MESSAGES.timeZoneInvalid })
  .trim()
  .min(1, MESSAGES.timeZoneInvalid);

/** The two kinds of work: ordinary work, and a meeting that may state a plan. */
const TASK_KINDS = ["default", "meeting"] as const;

/** Whether a task is ordinary work or a meeting. Neither kind makes a task something that happened. */
const taskKindSchema = z.enum(TASK_KINDS, { error: MESSAGES.kindInvalid });

/** A bare 24-hour clock reading, as a meeting may state it without naming a day. */
const PLANNED_CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

/** A date-and-time control's value: the day the plan belongs to, then the clock reading. */
const PLANNED_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/u;

/**
 * A meeting's planned wall-clock time, checked by shape alone.
 *
 * It is never converted to an instant and never re-zoned, because the zone is the separate field the
 * worker discloses. The stored plan is therefore a plan: nothing here can make it read as a meeting
 * that was held, which only an interaction recording that it happened can establish.
 */
const plannedTimeSchema = z
  .string({ error: MESSAGES.plannedTimeInvalid })
  .trim()
  .superRefine((value, ctx) => {
    if (PLANNED_CLOCK_PATTERN.test(value)) {
      return;
    }
    const stated = PLANNED_DATE_TIME_PATTERN.exec(value);
    const day = stated?.[1];
    if (day === undefined || !civilDateSchema.safeParse(day).success) {
      ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeInvalid });
    }
  });

/** The fields the planned-time rule reads, present on every payload that can state a schedule. */
type PlannedPairing = {
  readonly kind?: "default" | "meeting" | undefined;
  readonly dueOn?: string | null | undefined;
  readonly plannedTime?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
};

/**
 * The one planned-time rule: a schedule belongs to a meeting, and a time is always stated in a zone.
 *
 * Refused: an ordinary task carrying a time or a zone, because it would read as an appointment the
 * worker never made; a time with no zone and a zone with no time, because either alone states half of
 * when the meeting is; and a time on a different day from the due date, because the two would
 * describe two different plans. Honest: a meeting stating both, and a meeting stating neither — a
 * plan may exist without a time, and a meeting without a time is still a meeting.
 */
function refinePlannedPairing(value: PlannedPairing, ctx: z.RefinementCtx): void {
  const hasTime = value.plannedTime !== undefined && value.plannedTime !== null;
  const hasZone = value.timeZone !== undefined && value.timeZone !== null;

  if ((value.kind ?? "default") === "default") {
    if (hasTime || hasZone) {
      ctx.addIssue({
        code: "custom",
        message: MESSAGES.plannedTimeOnlyForMeeting,
        path: ["plannedTime"],
      });
    }
    return;
  }

  if (hasTime && !hasZone) {
    ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeRequiresZone, path: ["timeZone"] });
    return;
  }

  if (!hasTime && hasZone) {
    ctx.addIssue({
      code: "custom",
      message: MESSAGES.plannedTimeRequiresZone,
      path: ["plannedTime"],
    });
    return;
  }

  const plannedDay =
    value.plannedTime === undefined || value.plannedTime === null
      ? undefined
      : PLANNED_DATE_TIME_PATTERN.exec(value.plannedTime)?.[1];
  const dueDay = value.dueOn;
  if (
    plannedDay !== undefined &&
    dueDay !== undefined &&
    dueDay !== null &&
    plannedDay !== dueDay
  ) {
    ctx.addIssue({ code: "custom", message: MESSAGES.plannedTimeOtherDay, path: ["plannedTime"] });
  }
}

// ---------------------------------------------------------------------------------------------
// The five payloads, each closed and each naming its own effect
// ---------------------------------------------------------------------------------------------

/**
 * The `createTask` payload: every field but the title is optional.
 *
 * `title` is required because a task is useful the moment it names itself. There is no completion
 * date, outcome, contact flag, amount, consent or audience field, because creating work records what
 * the worker means to do and nothing about what has happened.
 */
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

/**
 * The `editTask` payload: the task, plus whichever editable fields the caller restates.
 *
 * An absent field is left alone and an explicit `null` clears it, so one payload both changes a title
 * and removes a note without restating everything. Whether the result actually differs from the
 * record is the service's question: a handler that compared the two would become a second owner of
 * the `unchanged` answer.
 */
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
    // A restated kind is where the shape of the work changes, and the plan has to agree with it.
    if (value.kind !== undefined) {
      refinePlannedPairing(value, ctx);
    }
  });

/**
 * The `completeTask` payload: an identifier and nothing else.
 *
 * There is no completion date, outcome, note or contact flag, so no claim that anything happened can
 * travel through this request: completing a task says the worker finished it, and a meeting counts as
 * held only when an interaction records that it took place.
 */
const completeTaskPayloadSchema = z.strictObject({
  operation: z.literal("completeTask"),
  taskId: taskIdSchema,
});

/** The `reopenTask` payload: the same identifier and nothing else, because reopening is its own act. */
const reopenTaskPayloadSchema = z.strictObject({
  operation: z.literal("reopenTask"),
  taskId: taskIdSchema,
});

/**
 * The `cancelTask` payload: the task, the confirmation the request must state, and an optional reason.
 *
 * Cancelling is not a delete: no `delete`, `purge`, `archive` or `remove` field exists here, and the
 * mutation keeps the record. The confirmation is required on the wire rather than merely offered — a
 * request that states none is refused with the confirmation message — because cancelling is a
 * deliberate act. A reason is the caller's own short note about why the work stopped.
 */
const cancelTaskPayloadSchema = z.strictObject({
  operation: z.literal("cancelTask"),
  taskId: taskIdSchema,
  confirmed: z.literal(true, { error: MESSAGES.cancellationNotConfirmed }),
  reason: cancelReasonSchema.optional(),
});

// ---------------------------------------------------------------------------------------------
// One body schema per mutation: the four-field envelope, with that mutation's own payload
// ---------------------------------------------------------------------------------------------

const createTaskBodySchema = mutationInputSchema(createTaskPayloadSchema);
const editTaskBodySchema = mutationInputSchema(editTaskPayloadSchema);
const completeTaskBodySchema = mutationInputSchema(completeTaskPayloadSchema);
const reopenTaskBodySchema = mutationInputSchema(reopenTaskPayloadSchema);
const cancelTaskBodySchema = mutationInputSchema(cancelTaskPayloadSchema);

/** The closed set of mutations this path dispatches, in the order the plan states them. */
const TASK_OPERATIONS = [
  "createTask",
  "editTask",
  "completeTask",
  "reopenTask",
  "cancelTask",
] as const;

// ---------------------------------------------------------------------------------------------
// The read side: the query grammar this transport admits
// ---------------------------------------------------------------------------------------------

/** The declared parameter shape of the one read this handler serves. */
type TaskListQuery = Parameters<typeof reads.work.listTasks>[0];

/** One ordering instruction as that read declares it. */
type TaskSortInstruction = NonNullable<TaskListQuery["sort"]>[number];

/**
 * The five lists this transport admits, checked against the read's own type.
 *
 * The names are repeated here because the read's tuple is not re-exported through the service's
 * index, and the `satisfies` clause is what makes the repetition safe: a name the read drops or
 * renames fails to compile in this schema, and a sixth list it adds stays simply unoffered here —
 * this path admits the five the Work family fixes, so no request can widen one of them into another.
 */
const TASK_LIST_NAMES = [
  "today",
  "upcoming",
  "overdue",
  "all",
  "undated",
] as const satisfies readonly TaskListQuery["list"][];

/** The fields a list may be ordered by, checked against the read's own type. */
const TASK_SORT_FIELDS = [
  "dueOn",
  "title",
  "category",
  "status",
] as const satisfies readonly TaskSortInstruction["field"][];

/** The two directions an ordering may take, checked against the read's own type. */
const TASK_SORT_DIRECTIONS = [
  "asc",
  "desc",
] as const satisfies readonly TaskSortInstruction["direction"][];

/** Whether a token names a field this path admits as an ordering. */
function isTaskSortField(value: string): value is TaskSortInstruction["field"] {
  return TASK_SORT_FIELDS.some((admitted) => admitted === value);
}

/** Whether a token names a direction this path admits. */
function isTaskSortDirection(value: string): value is TaskSortInstruction["direction"] {
  return TASK_SORT_DIRECTIONS.some((admitted) => admitted === value);
}

/**
 * The display time zone the view is read in: stated, non-blank and resolvable here.
 *
 * Three states and three messages, because each asks the caller for something different: a request
 * that names no zone, one that names an empty zone, and one that names a zone no calendar can read.
 * Each state reports once — a blank value is refused as blank and not also as a name no database
 * holds, so the caller reads the one thing to correct. The last question is put to
 * `@/modules/time/civil`, the module that owns every boundary judgement behind this surface and the
 * same conversion the read judges "today" with — so a zone admitted here is a zone the read can use,
 * and a caller is never sent away with a mistake the read would refuse.
 */
const displayTimeZoneSchema = z
  .string({ error: MESSAGES.displayTimeZoneRequired })
  .trim()
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: MESSAGES.displayTimeZoneBlank });
      return;
    }
    if (!isResolvableTimeZone(value)) {
      ctx.addIssue({ code: "custom", message: MESSAGES.displayTimeZoneUnresolvable });
    }
  });

/**
 * The list a request states, judged against the five this read answers.
 *
 * Only a stated name is judged: a request that names no list is read as the complete one below, which
 * is the behaviour this path has always documented for a list it was not given.
 */
const listNameSchema = z.enum(TASK_LIST_NAMES, { error: MESSAGES.listInvalid });

/**
 * The ordering a request states: `field:direction` tokens, repeated or comma-separated, in the order
 * given.
 *
 * One inadmissible token refuses the whole ordering — reported once, on `sort`, which is the key a
 * sort control is addressable by — and the message names every field and direction this read admits.
 * Refusing rather than dropping the token is what keeps a list in the order the caller asked for: a
 * field or direction silently discarded would answer in the default order while the surface still
 * showed the order it had requested, and nothing downstream would ever check it.
 */
const sortSchema = z
  .array(z.string())
  .transform((tokens: readonly string[], context): readonly TaskSortInstruction[] => {
    const instructions: TaskSortInstruction[] = [];
    for (const token of tokens) {
      const separator = token.indexOf(":");
      const field = separator === -1 ? token : token.slice(0, separator);
      const direction = separator === -1 ? "" : token.slice(separator + 1);
      if (!isTaskSortField(field) || !isTaskSortDirection(direction)) {
        // No path, so the issue lands on `sort` itself rather than on one token's index.
        context.addIssue({ code: "custom", message: MESSAGES.sortInvalid });
        return z.NEVER;
      }
      instructions.push({ field, direction });
    }
    return instructions;
  });

/**
 * The grammar of the task-list query, judged before the read is called.
 *
 * Three vocabularies are closed here — the five lists, the four ordering fields and the two
 * directions — because a request naming something this read does not admit is a request-level
 * mistake, and the honest answer names the value it got wrong instead of answering with a wider list
 * or a different order than the one asked for. `page` and `pageSize` are deliberately outside it: the
 * read owns the 50-row default, the 200-row cap and the forgiving page window, and a second judgement
 * at this boundary would be a second owner of a contract the envelope's `total` and `pageCount` are
 * read beside.
 */
const taskListQuerySchema = z.object({
  displayTimeZone: displayTimeZoneSchema,
  list: listNameSchema.optional(),
  sort: sortSchema.optional(),
});

/** The query parameters as that schema names them. */
type TaskListQueryParams = z.output<typeof taskListQuerySchema>;

/**
 * The parameters the request stated, gathered without interpretation.
 *
 * An absent parameter is passed as `undefined` rather than as an empty string, so "not stated" and
 * "stated as empty" stay different requests: the first keeps the read's documented default — the
 * complete list and the agreed due-date-then-title order — and the second is a value this boundary
 * has to judge. A repeated or comma-separated `sort` keeps every token, because the order the caller
 * stated is the sequence of those tokens and nothing here reorders them.
 */
function rawTaskListParams(search: URLSearchParams): Record<string, unknown> {
  const sort = search.getAll("sort").flatMap((value) => value.split(","));

  return {
    displayTimeZone: search.get("displayTimeZone") ?? undefined,
    list: search.get("list") ?? undefined,
    sort: sort.length === 0 ? undefined : sort,
  };
}

/**
 * The query the read is called with, once the request's values have been admitted.
 *
 * This boundary decides whether the values the request carries are ones this read admits, and it
 * invents none of them: `displayTimeZone` is handed over as the request stated it, trimmed, because a
 * due date is a civil day in a stated zone and a defaulted zone would put work in a list nobody asked
 * for. A request that states no list is read as the complete one, and one that states no ordering
 * leaves the read's agreed order alone. `page` and `pageSize` travel as `Number(...)` — `undefined`
 * when the URL carries neither — so the read keeps the clamp and the forgiving page window behind
 * them. No count, order, filter or slice is decided here.
 */
function taskListQueryOf(search: URLSearchParams, params: TaskListQueryParams): TaskListQuery {
  const page = search.get("page");
  const pageSize = search.get("pageSize");

  return {
    list: params.list ?? "all",
    displayTimeZone: params.displayTimeZone,
    page: page === null ? undefined : Number(page),
    pageSize: pageSize === null ? undefined : Number(pageSize),
    ...(params.sort === undefined ? {} : { sort: params.sort }),
  };
}

// ---------------------------------------------------------------------------------------------
// The write side: one named mutation per request
// ---------------------------------------------------------------------------------------------

/** The attempt identity a body states, so a refusal can name the attempt the caller can replay. */
const attemptIdentitySchema = z.object({ operationId: z.string() });

/**
 * The discriminant as the transport requires it: `payload.operation`, one of the five mutation names.
 *
 * Only the discriminant is read here, so a body carrying extra keys is not refused at this point: the
 * chosen mutation's own closed schema reports those against their own field paths.
 */
const discriminantSchema = z.object(
  {
    payload: z.object(
      { operation: z.enum(TASK_OPERATIONS, { error: MESSAGES.operationRequired }) },
      { error: MESSAGES.operationRequired },
    ),
  },
  { error: MESSAGES.bodyNotJson },
);

/** The request body, or `undefined` when it is absent or is not valid JSON. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

/** The attempt identity to report on a refusal, read defensively: a malformed body states none. */
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0
    ? identity.data.operationId
    : UNIDENTIFIED_ATTEMPT;
}

/**
 * The payload a mutation receives: the routing discriminant removed, everything else as stated.
 *
 * The mutation's own schema is closed and declares no `operation` field, so leaving the discriminant
 * in place would turn every request into an unrecognised-key refusal. Removing it here is what keeps
 * the field a routing fact rather than a second description of a task.
 */
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}

/**
 * Validates one body against one mutation's own schema, then calls exactly that mutation once.
 *
 * The four contract fields are forwarded untouched, `expectedRevision` and `operationId` included, so
 * a replay still answers with the stored result instead of applying a second effect and a stale
 * revision still reaches the service as a `conflict`. Nothing is minted, bumped or stripped.
 *
 * A throw from the mutation is converted here rather than propagated: the caller always receives one
 * of the closed outcomes, never a framework error page. `outcomeFromError` is the one mapper that
 * knows the difference, so a store or network fault becomes `unavailable` with the source named and
 * an unrecognised failure becomes `unknown` carrying this attempt's `operationId` — the same
 * conversion the read above performs, and the second mapper this file would otherwise need.
 */
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    return toResponse(outcomeFromError(operationId, error));
  }
}

// ---------------------------------------------------------------------------------------------
// The two verbs
// ---------------------------------------------------------------------------------------------

/**
 * One page of one task list, exactly as the request asked for it.
 *
 * The answer is always one envelope — `data`, `scope`, `source`, `revision`, `asOf`, `coverage`,
 * `valueStates`, `actions` — never a bare array and never a handler-computed total. A denial carries
 * no count, title or existence hint, and an unavailable source is neither an empty list nor a zero.
 *
 * A request naming no display time zone, one this runtime cannot resolve, a list outside the five or
 * an ordering outside the closed sets is refused as `invalid` with the field named before the read is
 * called: nothing behind the read is down, and answering an outage would tell every client without a
 * persisted zone to wait for a source that is healthy.
 */
export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;

  try {
    const grammar = taskListQuerySchema.safeParse(rawTaskListParams(search));
    if (!grammar.success) {
      // A value this read does not admit is a request-level refusal, answered with the same
      // per-field `invalid` outcome the five mutations answer, because no source behind the read
      // failed and a caller has to be told which field to correct.
      return toResponse(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
    }
    return toResponse(await reads.work.listTasks(taskListQueryOf(search, grammar.data)));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established
    // and a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

/**
 * One named task mutation, selected by `payload.operation`.
 *
 * Every answer is one of the eight outcomes with its own status, so a client never infers success
 * from an absent error: a stale revision is a `conflict` that preserves the submitted input, a replay
 * is `alreadyAccepted` with the stored result, and a discriminant naming no mutation — a bulk verb or
 * a series verb, which belong to other paths — is `invalid` naming `operation`, the payload-relative
 * field path a form attaches the message to, whose wording names the request field `payload.operation`.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const claimed = discriminantSchema.safeParse(raw);

  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }

  switch (claimed.data.payload.operation) {
    case "createTask":
      return dispatch(createTaskBodySchema, raw, operationId, mutations.work.createTask);
    case "editTask":
      return dispatch(editTaskBodySchema, raw, operationId, mutations.work.editTask);
    case "completeTask":
      return dispatch(completeTaskBodySchema, raw, operationId, mutations.work.completeTask);
    case "reopenTask":
      return dispatch(reopenTaskBodySchema, raw, operationId, mutations.work.reopenTask);
    case "cancelTask":
      return dispatch(cancelTaskBodySchema, raw, operationId, mutations.work.cancelTask);
    default:
      // Unreachable: the five names above are the closed set the discriminant schema admits, so a
      // sixth mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled task mutation");
  }
}
