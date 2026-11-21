/** `GET /api/coaching/checkins` — one page of the worker's own check-ins, each with the captured question set it was written against, the private autosave only the worker reads and the shared … */
import { z, ZodError } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { pagingParamsOf, pagingQuerySchema } from "../../paging";
import { UNIDENTIFIED_ATTEMPT, operationIdentityOf } from "../../handler";
/** The store reads and writes through `node:fs` behind the service, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock, so no answer may be served from a cache. */
export const dynamic = "force-dynamic";
/** AAP 0.8.7's four check-in limits, mirrored at this boundary: a request over any of them is refused with its measured value before a transaction opens, rather than shortened. */
const MAX_QUESTIONS = 5;
const MAX_QUESTION_SCALARS = 500;
const MAX_ANSWER_SCALARS = 4000;
const MAX_REQUEST_BYTES = 262144;
/** The ceiling as readers of the refusal know it. */
const MAX_REQUEST_KIB = MAX_REQUEST_BYTES / 1024;
/** A `GET` performs no effect, so it names no operation. */
const READ_ATTEMPT_ID = "read";
/** No response from either verb may be stored: a shared revision that has just been withdrawn, or a private autosave that has just changed, must take effect on the very next request. */
const NOT_STORED = { headers: { "cache-control": "no-store" } } as const;
/** An answer is plain text (AAP 0.8.4), and plain text legitimately contains `<` and `>`: a scripture reference written `<John 3:16>` and a comparison written `x < y > z` are the worker's own words. */
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
/** The answers, in the order they answer those questions: one bound each, and no count of its own, because the request ceiling and the per-answer bound are the documented limits. */
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
/** `saveCheckIn` — the private autosave. It carries no field that could route private words into a shared revision. */
const saveCheckInPayload = checkInMutationPayload("saveCheckIn", { checkInId: checkInIdField.optional(), questions: questionListField.optional(), answers: answerListField });
/** `shareCheckIn` — the one act that makes a revision readable by a named coach. */
const shareCheckInPayload = checkInMutationPayload("shareCheckIn", { checkInId: checkInIdField, questions: questionListField.optional(), answers: answerListField.optional() });
/** `updateSharedCheckIn` — the only change that reaches a revision a coach has already seen; the captured question set is not among its fields. */
const updateSharedCheckInPayload = checkInMutationPayload("updateSharedCheckIn", { checkInId: checkInIdField, sharedRevisionId: sharedRevisionIdField.optional(), questions: questionListField.optional(), answers: answerListField });
/** `withdrawCheckIn` — ending a coach's access. It carries no content, so it is never judged against a content draft. */
const withdrawCheckInPayload = checkInMutationPayload("withdrawCheckIn", { checkInId: checkInIdField, sharedRevisionId: sharedRevisionIdField.optional() });
const checkInPayloadSchema = z.discriminatedUnion("operation", [saveCheckInPayload, shareCheckInPayload, updateSharedCheckInPayload, withdrawCheckInPayload]);
type CheckInPayload = z.infer<typeof checkInPayloadSchema>;
/** The whole request, judged in one pipeline so every refusal is a Zod issue and one mapper answers it: the 256 KiB ceiling has already been measured on the bytes as they arrived, by the reader that … */
const checkInRequestSchema = z
  .string({ error: MESSAGES.bodyNotJson })
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: MESSAGES.bodyNotJson });
      return z.NEVER;
    }
  })
  .pipe(mutationInputSchema(checkInPayloadSchema));
type CheckInListQuery = Parameters<typeof reads.coaching.readCheckIns>[0];
const checkInListQuerySchema = pagingQuerySchema({ page: MESSAGES.pageInvalid, pageSize: MESSAGES.pageSizeInvalid });
/** What reading one request's body produced: the text the pipeline judges, or the byte count at which it was refused. */
type CheckInBody = { readonly kind: "text"; readonly text: string } | { readonly kind: "oversized"; readonly bytes: number };
const utf8Decoder = new TextDecoder("utf-8");
function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
/** Reads one request's body, stopping at the 256 KiB ceiling instead of buffering whatever arrives. */
async function readCheckInBody(request: Request): Promise<CheckInBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) return { kind: "oversized", bytes: declaredBytes };
  }
  const stream = request.body;
  if (stream === null) return { kind: "text", text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { kind: "oversized", bytes: receivedBytes };
    }
    chunks.push(value);
  }
  // Decoded non-fatally, exactly as `request.text()` decodes: a byte sequence that is not valid UTF-8 becomes the replacement character rather than a second refusal the ceiling does not make.
  return { kind: "text", text: utf8Decoder.decode(joinChunks(chunks, receivedBytes)) };
}
/** The attempt identity a refusal echoes back: this path reads its body as text against its own ceiling, so the text is decoded here and the identity itself is the shared reader's. */
function refusalIdentityOfText(raw: string): string {
  try {
    return operationIdentityOf(JSON.parse(raw) as unknown);
  } catch {
    return UNIDENTIFIED_ATTEMPT;
  }
}
/** One named mutation, chosen exhaustively: a fifth literal would fail to compile at this switch rather than fall through at runtime. */
async function runCheckInMutation(input: MutationInput<CheckInPayload>): Promise<MutationOutcome> {
  switch (input.payload.operation) {
    case "saveCheckIn": {
      // Each arm forwards exactly the fields its schema above accepted, so the discriminant is the only thing left behind and no field the transport refused can reach the service.
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
/** The one status and body mapping: an envelope, an outcome or a refusal is never rebuilt by hand here. */
function answer(result: Parameters<typeof toResponse>[0]): Response {
  return toResponse(result, NOT_STORED);
}
/** One page of the worker's check-ins, each keeping its captured question set, its private autosave and its shared revision apart, with the page window and limits the service reports. */
export async function GET(request: Request): Promise<Response> {
  try {
    const grammar = checkInListQuerySchema.safeParse(pagingParamsOf(new URL(request.url).searchParams));
    if (!grammar.success) {
      // A paging value this read does not admit is a request-level refusal answered through this file's one mapper, because no source behind the read failed and the caller has to be told which parameter to correct.
      return answer(outcomeFromError(READ_ATTEMPT_ID, grammar.error));
    }
    return answer(await reads.coaching.readCheckIns(grammar.data satisfies CheckInListQuery));
  } catch (error) {
    // A thrown store fault is an outage, a session that cannot be established is a denial, and an unrecognised failure is `unknown`: one mapper knows the difference, so nothing escapes this boundary.
    return answer(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named check-in change, selected by `payload.operation`; answers with exactly one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  let body: CheckInBody;
  try {
    // Read once, against the ceiling: nothing is truncated to fit it, and nothing past it is held.
    body = await readCheckInBody(request);
  } catch (error) {
    return answer(outcomeFromError(UNIDENTIFIED_ATTEMPT, error));
  }
  if (body.kind === "oversized") {
    // The request was cancelled at the ceiling before its `operationId` could be read, so the refusal names no attempt rather than an invented one — the identity the media transport also reports when its own
    // bound refuses a request — and it travels as `invalid` through the one mapper, like every refusal here.
    return answer(outcomeFromError(UNIDENTIFIED_ATTEMPT, new ZodError([{ code: "custom", path: [], message: MESSAGES.requestTooLarge(body.bytes), input: undefined }])));
  }
  const raw = body.text;
  const parsed = checkInRequestSchema.safeParse(raw);
  if (!parsed.success) return answer(outcomeFromError(refusalIdentityOfText(raw), parsed.error));
  try {
    return answer(await runCheckInMutation(parsed.data));
  } catch (error) {
    // A thrown store fault becomes `unavailable` and an unrecognised failure becomes `unknown` carrying the operation id, so a lost acknowledgement is recovered by replaying the same id rather than by resending the work under a new one.
    return answer(outcomeFromError(parsed.data.operationId, error));
  }
}
