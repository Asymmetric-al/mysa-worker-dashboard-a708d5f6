import { z, ZodError } from "zod";
import { routeMethods } from "@/app/api/methods";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { UNIDENTIFIED_ATTEMPT, operationIdentityOf, readRequestBody } from "../../handler";
import { NO_STORE_RESPONSE, READ_ATTEMPT, readGrammar, readRoute } from "../../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_QUESTIONS = 5;
const MAX_QUESTION_SCALARS = 500;
const MAX_ANSWER_SCALARS = 4000;
const MAX_REQUEST_BYTES = 262144;
const MAX_REQUEST_KIB = MAX_REQUEST_BYTES / 1024;
const EDITOR_DOCUMENT_PREFIX = /^\s*\{\s*"type"\s*:\s*"doc"/u;
const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  pageInvalid: "Read the page as a whole number of one or more, so the check-ins arrive on the page you asked for rather than one this read chose.",
  pageSizeInvalid: "Read the page size as a whole number of one or more, so the check-ins arrive in pages of the size you asked for; the service applies its own cap.",
  requestTooLarge(bytes: number): string {
    return `This check-in request passed the ${MAX_REQUEST_BYTES}-byte limit (${MAX_REQUEST_KIB} KiB): ${bytes} bytes had arrived or been declared when it was refused. Nothing was saved: keep the check-in within the limit and send it again.`;
  },
  questionSetExceeded(count: number): string {
    return `This check-in carries ${count} questions and the limit is ${MAX_QUESTIONS}. Nothing was dropped: take one question out and send it again, with every other question worded exactly as you wrote it.`;
  },
  notText(label: string): string {
    return `${label} is plain text, so send it as a string rather than as a document, a list or a number.`;
  },
  documentRefused(label: string): string {
    return `${label} is plain text, so send the words themselves rather than a serialised editor document. Nothing was saved: write it as plain text and send it again.`;
  },
  scalarsExceeded(label: string, scalars: number, limit: number): string {
    return `${label} is ${scalars} characters long and the limit is ${limit}. Nothing was dropped: bring it within the limit and send it again.`;
  },
  unexpectedField(mutation: string, field: string): string {
    return `A ${mutation} accepts only the fields that belong to it, and "${field}" is not one of them. A check-in change discloses words the worker already wrote: it sends no message, notifies nobody, records no interaction and creates no task, so a field asking for one of those is refused rather than ignored.`;
  },
  checkInRequired: "This change belongs to one check-in, so open the check-in from its list and send it again.",
  sharedRevisionRequired: "This change belongs to one shared revision, so open the check-in from its list and send it again.",
} as const;
function plainTextField(label: string, maxScalars: number): z.ZodType<string> {
  return z.string({ error: MESSAGES.notText(label) }).superRefine((text, context) => {
    if (EDITOR_DOCUMENT_PREFIX.test(text)) {
      context.addIssue({ code: "custom", message: MESSAGES.documentRefused(label) });
      return;
    }
    const scalars = Array.from(text).length;
    if (scalars > maxScalars) context.addIssue({ code: "custom", message: MESSAGES.scalarsExceeded(label, scalars, maxScalars) });
  });
}
const questionTextField = plainTextField("A question", MAX_QUESTION_SCALARS);
const answerTextField = plainTextField("An answer", MAX_ANSWER_SCALARS);
const questionListField = z.array(questionTextField, { error: MESSAGES.notText("A question") }).superRefine((questions, context) => {
  if (questions.length > MAX_QUESTIONS) context.addIssue({ code: "custom", message: MESSAGES.questionSetExceeded(questions.length) });
});
const answerListField = z.array(answerTextField, { error: MESSAGES.notText("An answer") });
const checkInIdField = z.string({ error: MESSAGES.checkInRequired }).trim().min(1, MESSAGES.checkInRequired);
const sharedRevisionIdField = z.string({ error: MESSAGES.sharedRevisionRequired }).trim().min(1, MESSAGES.sharedRevisionRequired);
const CHECK_IN_MUTATIONS = ["saveCheckIn", "shareCheckIn", "updateSharedCheckIn", "withdrawCheckIn"] as const;
type CheckInMutation = (typeof CHECK_IN_MUTATIONS)[number];
function checkInMutationPayload<Mutation extends CheckInMutation, Shape extends z.ZodRawShape>(mutation: Mutation, shape: Shape) {
  const fields = { operation: z.literal(mutation), ...shape };
  return z.looseObject(fields).superRefine((payload, context) => {
    for (const field of Object.keys(payload)) {
      if (Object.hasOwn(fields, field)) continue;
      context.addIssue({ code: "custom", path: [field], message: MESSAGES.unexpectedField(mutation, field) });
    }
  });
}
const saveCheckInPayload = checkInMutationPayload("saveCheckIn", { checkInId: checkInIdField.optional(), questions: questionListField.optional(), answers: answerListField });
const shareCheckInPayload = checkInMutationPayload("shareCheckIn", { checkInId: checkInIdField, questions: questionListField.optional(), answers: answerListField.optional() });
const updateSharedCheckInPayload = checkInMutationPayload("updateSharedCheckIn", { checkInId: checkInIdField, sharedRevisionId: sharedRevisionIdField.optional(), questions: questionListField.optional(), answers: answerListField });
const withdrawCheckInPayload = checkInMutationPayload("withdrawCheckIn", { checkInId: checkInIdField, sharedRevisionId: sharedRevisionIdField.optional() });
const checkInPayloadSchema = z.discriminatedUnion("operation", [saveCheckInPayload, shareCheckInPayload, updateSharedCheckInPayload, withdrawCheckInPayload]);
type CheckInPayload = z.infer<typeof checkInPayloadSchema>;
const checkInRequestSchema = mutationInputSchema(checkInPayloadSchema);
const checkInListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
async function runCheckInMutation(input: MutationInput<CheckInPayload>): Promise<MutationOutcome> {
  switch (input.payload.operation) {
    case "saveCheckIn": {
      const { checkInId, questions, answers } = input.payload;
      return mutations.coaching.saveCheckIn({ ...input, payload: { checkInId, questions, answers } });
    }
    case "shareCheckIn": {
      const { checkInId, questions, answers } = input.payload;
      return mutations.coaching.shareCheckIn({ ...input, payload: { checkInId, questions, answers } });
    }
    case "updateSharedCheckIn": {
      const { checkInId, sharedRevisionId, questions, answers } = input.payload;
      return mutations.coaching.updateSharedCheckIn({ ...input, payload: { checkInId, sharedRevisionId, questions, answers } });
    }
    case "withdrawCheckIn": {
      const { checkInId, sharedRevisionId } = input.payload;
      return mutations.coaching.withdrawCheckIn({ ...input, payload: { checkInId, sharedRevisionId } });
    }
  }
}
const answer = (result: Parameters<typeof toResponse>[0]): Response => toResponse(result, { headers: { "cache-control": "no-store" } });
/** One page of the worker's check-ins, each keeping its captured question set, its private autosave and its shared revision apart, with the page window and limits the service reports. */
const readCheckIns = readRoute(readGrammar(checkInListQuerySchema, pagingParamsOf), (query) => reads.coaching.readCheckIns(query), READ_ATTEMPT, NO_STORE_RESPONSE);
/** One named check-in change, selected by `payload.operation`; answers with exactly one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
async function changeCheckIn(request: Request): Promise<Response> {
  const body = await readRequestBody(request, MAX_REQUEST_BYTES);
  if (body.kind === "oversized") return answer(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: [], message: MESSAGES.requestTooLarge(body.bytes), input: undefined }])));
  if (body.kind === "unreadable") return answer(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: [], message: MESSAGES.bodyNotJson, input: undefined }])));
  const parsed = checkInRequestSchema.safeParse(body.value);
  if (!parsed.success) return answer(outcomeFromError(operationIdentityOf(body.value), parsed.error));
  try {
    return answer(await runCheckInMutation(parsed.data));
  } catch (error) {
    return answer(outcomeFromError(parsed.data.operationId, error));
  }
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readCheckIns, POST: changeCheckIn });
