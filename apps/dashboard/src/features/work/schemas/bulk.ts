/**
 * The Work family's four bulk-action payload schemas: `bulkApplyTag`, `bulkRemoveTag`,
 * `bulkCreateTasks` and `bulkCompleteTasks`.
 *
 * Three bulk intents exist — a private tag, follow-up tasks and completing independent tasks — and
 * the tag intent carries two directions, so four named mutations validate here. One schema per named
 * mutation: each names its own effect and its own field set, so a request body can only ever mean one
 * thing. There is no schema with a free-form field map, which is the universal command dispatcher
 * this application deliberately does not have.
 *
 * Every selection is an **explicit list of task identifiers**. No schema below can express a filter,
 * a saved view, a query object or "all matching rows", because a selection is not an audience, not a
 * consent and not a campaign: it is the rows the worker ticked, and the service re-checks each one at
 * execute time.
 *
 * A schema here validates the **payload alone**. The four-field mutation input
 * `{ operationId, scope, expectedRevision, payload }` belongs to the read envelope, and
 * `../hooks/use-bulk-task-mutations.ts` composes the two and reuses one operation identity per
 * intent, so a replayed submit returns the same per-item results instead of a second effect. No
 * schema below declares `operationId`, `scope` or `expectedRevision`, and every payload object is a
 * strict object for exactly that reason: an envelope field smuggled into a payload — or any other
 * stray key — is refused here by the rule the service's own strict payload schema applies, instead
 * of being dropped in the browser and answered `invalid` a round trip later.
 *
 * These schemas decide shape, never admissibility. Whether a selected row still exists, whether the
 * caller may change it, whether it can be completed on its own and whether it already carries the
 * tag are the service's questions, answered against the records as they stand. Nothing here reads a
 * clock or compares a revision. A bulk action reports one result per selected row — `accepted`,
 * `unchanged`, `excluded` or `failed` — and never one outcome for the whole selection; that
 * vocabulary lives in `../copy/bulk-actions.ts` and is only ever derived here.
 *
 * Every message a worker can see comes from `../copy/bulk-actions.ts`, with the two that catalogue
 * has no key for yet declared once in {@link BULK_SCHEMA_MESSAGES} and that file named as their home.
 *
 * Plan items: AAP 0.6.1 "Mutations: tasks and recurrence", AAP 0.6.3 `POST /api/tasks/bulk`, the
 * AAP 0.9.1 tree row `features/work/**`, and the bulk-action rules in AAP 0.8.2.
 */

import { z } from "zod";

import { BULK_FIELD_MESSAGES, BULK_ITEM_RESULT_STATES } from "../copy/bulk-actions";

import {
  civilDateSchema,
  taskCategorySchema,
  taskIdSchema,
  taskNoteSchema,
  taskTitleSchema,
} from "./task";

// ---------------------------------------------------------------------------------------------
// Wording this schema set needs and the bulk-action catalogue does not hold yet
// ---------------------------------------------------------------------------------------------

/**
 * The messages this schema set needs that `../copy/bulk-actions.ts` has no key for.
 *
 * That file is the Work family's one bulk-action wording source, and these two entries belong beside
 * the three messages it already words. They are declared here only so that no schema below states a
 * message literal inline, and they move into `../copy/bulk-actions.ts` the moment that catalogue is
 * next edited. Each one describes the value that was refused and what to do about it, never the
 * person who typed it, and neither repeats the limit the schema enforces.
 */
export const BULK_SCHEMA_MESSAGES = {
  /** The same task identifier reached one selection twice. */
  duplicateSelection:
    "Each row appears once in a selection, so remove the repeated row and submit again.",
  /** A private tag longer than a list row can show. */
  tagTooLong: "A private tag is a short label, so shorten this one to a few words.",
} as const;

// ---------------------------------------------------------------------------------------------
// The length the bulk-action bar and the schema share
// ---------------------------------------------------------------------------------------------

/**
 * The longest private tag this schema accepts, counted in Unicode code points.
 *
 * A UI-level guard the specification does not fix a number for: the bulk-action bar's `maxLength`
 * and this schema read the same constant, so a worker is never shown one limit and refused by
 * another. The service still decides what it admits.
 */
export const PRIVATE_TAG_MAX_LENGTH = 60;

// ---------------------------------------------------------------------------------------------
// The selection, the tag and the per-item result state every bulk payload shares
// ---------------------------------------------------------------------------------------------

/**
 * The rows a bulk action applies to: an **explicit** selection of task identifiers.
 *
 * At least one row, and each row once. There is no maximum length: the specification fixes no
 * selection cap, an explicit selection is bounded in practice by the list's own page window, and the
 * service re-checks every identifier, so a number here would refuse work the product allows.
 *
 * A filter, a saved view or a query object can never stand in for this array. That is the guarantee
 * the bulk rules rest on rather than an omission: what the worker ticked is what is affected, and a
 * row that later matches the same filter is never silently included. One repeated identifier is one
 * issue for the selection as a whole, because the selection is what has to be corrected.
 */
export const selectedTaskIdsSchema = z
  .array(taskIdSchema, { error: BULK_FIELD_MESSAGES.emptySelection })
  .min(1, BULK_FIELD_MESSAGES.emptySelection)
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    let repeated = false;

    for (const id of ids) {
      if (seen.has(id)) {
        repeated = true;
        break;
      }
      seen.add(id);
    }

    if (repeated) {
      ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.duplicateSelection });
    }
  });

/**
 * A private tag: the worker's own short label, visible to them alone.
 *
 * Trimmed, non-empty and bounded in code points, with no taxonomy, no controlled list and no
 * normalisation beyond trimming — casing stays the worker's, because two labels that differ only in
 * case are two labels if that is what they meant. Blank text is refused rather than dropped: the tag
 * is the whole purpose of the action, so an empty one would apply nothing and still report a result.
 */
export const privateTagSchema = z
  .string({ error: BULK_FIELD_MESSAGES.tagRequired })
  .trim()
  .superRefine((value, ctx) => {
    const length = Array.from(value).length;

    if (length === 0) {
      ctx.addIssue({ code: "custom", message: BULK_FIELD_MESSAGES.tagRequired });
    } else if (length > PRIVATE_TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: BULK_SCHEMA_MESSAGES.tagTooLong });
    }
  });

/**
 * One row's result from a bulk action, derived from the canonical vocabulary.
 *
 * The closed tuple of those four words is declared once in `../copy/bulk-actions.ts`, beside the
 * labels and the one-line meaning of each; this schema derives from it so the validator and the
 * badges cannot drift apart, and so the four states are never re-listed here. It is consumed on the
 * **result** side by `../components/bulk-action-bar.tsx`, which reads one result per selected row
 * rather than a single outcome for the selection.
 */
export const bulkItemResultStateSchema = z.enum(BULK_ITEM_RESULT_STATES);

/** The validated per-item result state: the same four words the bulk-action catalogue names. */
export type BulkItemResultState = z.infer<typeof bulkItemResultStateSchema>;

// ---------------------------------------------------------------------------------------------
// The follow-up task template the create action repeats per row
// ---------------------------------------------------------------------------------------------

/**
 * The task a bulk create writes once for each selected row: an **ordinary** follow-up task.
 *
 * The same field set as `createTaskSchema` minus everything a batch does not decide. No `kind`, so a
 * follow-up created in bulk is never turned into a meeting; no `plannedTime` and no `timeZone`,
 * because the only plan a batch can honestly make is a due date, and a wall-clock time would describe
 * an appointment per row that nobody stated; and no partner or initiative link, because each created
 * task carries the context of its own selected row and a template-level link would replace every one
 * of them with a single shared answer.
 *
 * `title` is required and the rest is optional, so "follow up" with a due date is a complete
 * follow-up. No field here can record contact, money or a message, so a batch of follow-ups can
 * never claim that anyone was reached or anything was given.
 */
export const followUpTaskTemplateSchema = z.strictObject({
  title: taskTitleSchema,
  category: taskCategorySchema,
  dueOn: civilDateSchema.optional(),
  note: taskNoteSchema,
});

/** The validated follow-up task template; `bulkCreateTasksSchema` repeats it once per selected row. */
export type FollowUpTaskTemplate = z.infer<typeof followUpTaskTemplateSchema>;

// ---------------------------------------------------------------------------------------------
// bulkApplyTag
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `bulkApplyTag` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * One private tag added to each selected row. A row that gains the tag comes back `accepted` and one
 * that already carries it comes back `unchanged`, because whether the tag is already there is a
 * question about the record and therefore the service's to answer. Nothing is sent and no other
 * person sees the tag.
 */
export const bulkApplyTagSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  tag: privateTagSchema,
});

/** The validated `bulkApplyTag` payload. */
export type BulkApplyTagPayload = z.infer<typeof bulkApplyTagSchema>;

// ---------------------------------------------------------------------------------------------
// bulkRemoveTag
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `bulkRemoveTag` payload before `../hooks/use-bulk-task-mutations.ts` submits it as the
 * payload of the four-field mutation input.
 *
 * The same selection and the same tag rule in the other direction. Removing a tag the worker once
 * applied leaves the tasks themselves untouched — a tag is preparation, not the work — and a row that
 * never carried it comes back `unchanged` rather than failed.
 */
export const bulkRemoveTagSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  tag: privateTagSchema,
});

/** The validated `bulkRemoveTag` payload. */
export type BulkRemoveTagPayload = z.infer<typeof bulkRemoveTagSchema>;

// ---------------------------------------------------------------------------------------------
// bulkCreateTasks
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `bulkCreateTasks` payload before `../hooks/use-bulk-task-mutations.ts` submits it as
 * the payload of the four-field mutation input.
 *
 * One ordinary follow-up task per selected row, written from the template above. The selected rows
 * are the context rather than the content: each created task stays linked to its own row's partner or
 * initiative exactly as that row is, and no text, note or link is copied from one row into another.
 * No message is sent and nothing is promised on anyone's behalf.
 */
export const bulkCreateTasksSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
  template: followUpTaskTemplateSchema,
});

/** The validated `bulkCreateTasks` payload. */
export type BulkCreateTasksPayload = z.infer<typeof bulkCreateTasksSchema>;

// ---------------------------------------------------------------------------------------------
// bulkCompleteTasks
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `bulkCompleteTasks` payload before `../hooks/use-bulk-task-mutations.ts` submits it as
 * the payload of the four-field mutation input.
 *
 * A selection and nothing else. There is no completion date, note, contact flag or outcome, because
 * completing a task records that the worker finished it and proves nothing about contact, payment or
 * fulfilment — so the payload holds no field in which such a claim could travel. A row that cannot be
 * completed on its own comes back `excluded`, which is the service's decision taken against the
 * record at execute time and not a state a caller can declare here.
 */
export const bulkCompleteTasksSchema = z.strictObject({
  taskIds: selectedTaskIdsSchema,
});

/** The validated `bulkCompleteTasks` payload. */
export type BulkCompleteTasksPayload = z.infer<typeof bulkCompleteTasksSchema>;
