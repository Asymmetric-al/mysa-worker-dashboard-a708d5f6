/**
 * `GET /api/coaching/checkins` — one page of the worker's own check-ins, each with the captured question
 * set it was written against, the private autosave only the worker reads and the shared revision a named
 * coach may read — and `POST /api/coaching/checkins`, the four named check-in changes: `saveCheckIn`,
 * `shareCheckIn`, `updateSharedCheckIn` and `withdrawCheckIn`.
 *
 * The plan items this transport serves: AAP 0.6.3 (`GET/POST /api/coaching/checkins`); AAP 0.7.1 (the read
 * envelope, the four-field mutation input, the closed eight-outcome set and the named-inventory row
 * "Prepare and share with a coach"); AAP 0.8.4 (plain-text check-ins, a captured question set held apart
 * from the shared revision, sharing that sends no message, records no interaction and creates no task, and
 * a withdrawal that still succeeds while an unrelated content draft is invalid); AAP 0.8.7 (the 5 × 500,
 * 4,000-scalar and 256 KiB limits); AAP 0.9.1 and 0.11.1 (this folder and route in the delivered tree);
 * AAP 0.10.1 "Coaching" with criterion 16.
 *
 * Rule 1 clause 1 keeps this family's file set closed: one file, no `[checkInId]` sub-route and no
 * reminder, digest or outward-mail endpoint. Clause 2 puts four named mutations behind one explicit
 * discriminant, each with its own schema over the one four-field envelope — no universal dispatcher and no
 * generic field-level CRUD. Clause 3 keeps the private autosave and the shared revision distinct, so
 * sharing is a disclosure rather than delivery, an ended relationship is not an unavailable source, and
 * every limit is refused with its measured value instead of being truncated.
 *
 * Wire contract, stated as every shared-path transport in this application states it: the body is
 * `{ operationId, scope, expectedRevision, payload }`, and `payload.operation` names exactly one of the
 * four mutations under the literals listed in `CHECK_IN_MUTATIONS`. The discriminant is stripped before
 * the service sees the payload, so each mutation's own schema judges only its own fields. The Coaching
 * client hooks therefore send `payload.operation`, not `payload.mutation`, and the four literals below are
 * the whole set.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
/** The store reads and writes through `node:fs` behind the service, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock, so no answer may be served from a cache. */
export const dynamic = "force-dynamic";

/**
 * AAP 0.8.7's four check-in limits, mirrored at this boundary: a request over any of them is refused with
 * its measured value before a transaction opens, rather than shortened. The Coaching domain's own
 * check-in module owns these numbers and enforces the same four behind the service, which stays
 * authoritative; a Route Handler may not import a domain module, so an exceeded bound is restated here.
 */
const MAX_QUESTIONS = 5;

const MAX_QUESTION_SCALARS = 500;

const MAX_ANSWER_SCALARS = 4000;

const MAX_REQUEST_BYTES = 262144;

/** The ceiling as readers of the refusal know it. */
const MAX_REQUEST_KIB = MAX_REQUEST_BYTES / 1024;
/** The identity a refusal carries when the request named none: a placeholder, never an invented attempt. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
/** A `GET` performs no effect, so it names no operation. */
const READ_ATTEMPT_ID = "read";
/**
 * No response from either verb may be stored: a shared revision that has just been withdrawn, or a private
 * autosave that has just changed, must take effect on the very next request.
 */
const NOT_STORED = { headers: { "cache-control": "no-store" } } as const;
/**
 * An answer is plain text (AAP 0.8.4). A tag-like sequence and a serialised editor document are the two
 * shapes that would arrive if markup or a rich-text document were posted as an answer, and both are refused
 * by name instead of being escaped, parsed or rendered.
 */
const MARKUP_PATTERN = /<\s*\/?\s*[a-zA-Z][^>]*>/u;

const EDITOR_DOCUMENT_PREFIX = /^\s*\{\s*"type"\s*:\s*"doc"/u;

const UTF8_ENCODER = new TextEncoder();

const MESSAGES = {
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
  requestTooLarge(bytes: number): string {
    return `This check-in request is ${bytes} bytes and the limit is ${MAX_REQUEST_BYTES} bytes (${MAX_REQUEST_KIB} KiB). Nothing was saved: keep the check-in within the limit and send it again.`;
  },
  questionSetExceeded(count: number): string {
    return `This check-in carries ${count} questions and the limit is ${MAX_QUESTIONS}. Nothing was dropped: take one question out and send it again, with every other question worded exactly as you wrote it.`;
  },
  notText(label: string): string {
    return `${label} is plain text, so send it as a string rather than as a document, a list or a number.`;
  },
  markupRefused(label: string): string {
    return `${label} is plain text and this one carries markup. Nothing was saved: write it as plain text and send it again.`;
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
// Text fields: plain text, counted in Unicode scalars
/**
 * One plain-text field bounded in Unicode scalar values. The count is `Array.from(text).length`, not
 * `z.string().max(n)`, because the latter counts UTF-16 code units and would refuse a shorter answer that
 * happens to use characters outside the basic plane.
 */
function plainTextField(label: string, maxScalars: number): z.ZodType<string> {
  return z.string({ error: MESSAGES.notText(label) }).superRefine((text, context) => {
    if (MARKUP_PATTERN.test(text) || EDITOR_DOCUMENT_PREFIX.test(text)) {
      context.addIssue({ code: "custom", message: MESSAGES.markupRefused(label) });
      return;
    }
    const scalars = Array.from(text).length;
    if (scalars > maxScalars) {
      context.addIssue({ code: "custom", message: MESSAGES.scalarsExceeded(label, scalars, maxScalars) });
    }
  });
}
const questionTextField = plainTextField("A question", MAX_QUESTION_SCALARS);

const answerTextField = plainTextField("An answer", MAX_ANSWER_SCALARS);

/** The captured question set, in the order it was submitted: at most five questions, each within its bound. */
const questionListField = z.array(questionTextField, { error: MESSAGES.notText("A question") }).superRefine((questions, context) => {
  if (questions.length > MAX_QUESTIONS) {
    context.addIssue({ code: "custom", message: MESSAGES.questionSetExceeded(questions.length) });
  }
});
/** The answers, in the order they answer those questions: one bound each, and no count of its own, because the request ceiling and the per-answer bound are the documented limits. */
const answerListField = z.array(answerTextField, { error: MESSAGES.notText("An answer") });
// Identifiers are opaque references the service resolves; nothing in this file derives one
const checkInIdField = z.string({ error: MESSAGES.checkInRequired }).trim().min(1, MESSAGES.checkInRequired);

const sharedRevisionIdField = z.string({ error: MESSAGES.sharedRevisionRequired }).trim().min(1, MESSAGES.sharedRevisionRequired);
// The four mutations, one discriminant
const CHECK_IN_MUTATIONS = ["saveCheckIn", "shareCheckIn", "updateSharedCheckIn", "withdrawCheckIn"] as const;

type CheckInMutation = (typeof CHECK_IN_MUTATIONS)[number];
/**
 * One mutation's payload: the discriminant it answers to, its own fields, and no others. A loose object is
 * parsed so that an unknown field is reported at its own path — `notify`, `send`, `email`, `createTask`,
 * `logInteraction` and `html` are each refused by name — and a request carrying one never reaches the
 * service, whose own strict schema would report the same key against the payload as a whole.
 */
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
const saveCheckInPayload = checkInMutationPayload("saveCheckIn", {
  checkInId: checkInIdField.optional(),
  questions: questionListField.optional(),
  answers: answerListField,
});
/**
 * `shareCheckIn` — the one act that makes a revision readable by a named coach. `recipients` and `duration`
 * are refused because who may read the words and for how long are derived from the admitted coaching grant
 * by the service, never from a browser body; `questions` and `answers` are accepted so the worker shares
 * exactly the text they reviewed, and the service refuses a share whose text differs from the saved draft,
 * so a submit cannot rewrite the captured set.
 */
const shareCheckInPayload = checkInMutationPayload("shareCheckIn", {
  checkInId: checkInIdField,
  questions: questionListField.optional(),
  answers: answerListField.optional(),
});
/** `updateSharedCheckIn` — the only change that reaches a revision a coach has already seen; the captured question set is not among its fields. */
const updateSharedCheckInPayload = checkInMutationPayload("updateSharedCheckIn", {
  checkInId: checkInIdField,
  sharedRevisionId: sharedRevisionIdField.optional(),
  questions: questionListField.optional(),
  answers: answerListField,
});
/** `withdrawCheckIn` — ending a coach's access. It carries no content, so it is never judged against a content draft. */
const withdrawCheckInPayload = checkInMutationPayload("withdrawCheckIn", {
  checkInId: checkInIdField,
  sharedRevisionId: sharedRevisionIdField.optional(),
});

const checkInPayloadSchema = z.discriminatedUnion("operation", [saveCheckInPayload, shareCheckInPayload, updateSharedCheckInPayload, withdrawCheckInPayload]);

type CheckInPayload = z.infer<typeof checkInPayloadSchema>;
/**
 * The whole request, judged in one pipeline so every refusal is a Zod issue and one mapper answers it:
 * the 256 KiB ceiling is measured on the raw bytes before anything is parsed, JSON parsing reports its own
 * refusal instead of throwing, and the four-field envelope with one mutation's payload is validated by the
 * service's own `mutationInputSchema`.
 */
const checkInRequestSchema = z
  .string({ error: MESSAGES.bodyNotJson })
  .superRefine((raw, context) => {
    const bytes = UTF8_ENCODER.encode(raw).byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      context.addIssue({ code: "custom", message: MESSAGES.requestTooLarge(bytes) });
    }
  })
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: MESSAGES.bodyNotJson });
      return z.NEVER;
    }
  })
  .pipe(mutationInputSchema(checkInPayloadSchema));
// Helpers
type CheckInListQuery = Parameters<typeof reads.coaching.readCheckIns>[0];
/** The page window the request stated, forwarded exactly as received: the service clamps the coaching page and reports its own limits. */
function checkInListQueryOf(request: Request): CheckInListQuery {
  const params = new URL(request.url).searchParams;
  const page = params.get("page");
  const pageSize = params.get("pageSize");
  return {
    page: page === null ? undefined : Number(page),
    pageSize: pageSize === null ? undefined : Number(pageSize),
  };
}
/**
 * The attempt identity a refusal echoes back. It reads the identifier out of the body without judging
 * anything else: the pipeline above is the only validator, and this names the attempt so a caller can
 * correlate a refusal with the request it sent.
 */
function operationIdentityOf(raw: string): string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return UNIDENTIFIED_ATTEMPT;
  }
  if (typeof body !== "object" || body === null) return UNIDENTIFIED_ATTEMPT;
  const candidate: unknown = Reflect.get(body, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}
/** One named mutation, chosen exhaustively: a fifth literal would fail to compile at this switch rather than fall through at runtime. */
async function runCheckInMutation(input: MutationInput<CheckInPayload>): Promise<MutationOutcome> {
  switch (input.payload.operation) {
    case "saveCheckIn": {
      // Each arm forwards exactly the fields its schema above accepted, so the discriminant is the only
      // thing left behind and no field the transport refused can reach the service.
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
// The two verbs
/** One page of the worker's check-ins, each keeping its captured question set, its private autosave and its shared revision apart, with the page window and limits the service reports. */
export async function GET(request: Request): Promise<Response> {
  try {
    return answer(await reads.coaching.readCheckIns(checkInListQueryOf(request)));
  } catch (error) {
    // A thrown store fault is an outage, a session that cannot be established is a denial, and an
    // unrecognised failure is `unknown`: one mapper knows the difference, so nothing escapes this boundary.
    return answer(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** One named check-in change, selected by `payload.operation`; answers with exactly one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  let raw: string;
  try {
    // Read once, in full: the ceiling below is measured on the bytes that were actually sent, and nothing
    // is truncated to fit it.
    raw = await request.text();
  } catch (error) {
    return answer(outcomeFromError(UNIDENTIFIED_ATTEMPT, error));
  }
  const parsed = checkInRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return answer(outcomeFromError(operationIdentityOf(raw), parsed.error));
  }
  try {
    return answer(await runCheckInMutation(parsed.data));
  } catch (error) {
    // A thrown store fault becomes `unavailable` and an unrecognised failure becomes `unknown` carrying
    // the operation id, so a lost acknowledgement is recovered by replaying the same id rather than by
    // resending the work under a new one.
    return answer(outcomeFromError(parsed.data.operationId, error));
  }
}
