/**
 * `GET /api/review` and `POST /api/review` — the application's one review transport: the frozen
 * candidate an edition has under review, and the four named writes that answer it.
 *
 * An approval recorded here is not a release: no payload on this path carries a release mode, a
 * reach, an audience or anything describing a send, so a reviewer's answer can never widen what the
 * submission asked for. Publication, notification, media and preview have their own named paths.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// The read resolves the development session, the scenario clock and the edition's current pointers per
// request: a cached candidate would outlive the review it belongs to.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const READ_ATTEMPT_ID = "read";

// The bounds the review records themselves hold, mirrored here so a value the service would refuse is
// refused at the boundary with the field named rather than after a transaction opens.
const REFERENCE_MAX_CHARS = 160;

const REVIEW_NOTE_MAX_CHARS = 4_000;

const MESSAGES = {
  candidateRequired: "Name the frozen candidate this decision answers, as candidateId, so the answer lands on the candidate the reviewer read.",
  referenceTooLong: "That reference is longer than any this application produces, so copy it from the review panel.",
  variantRequired: "Name the edition this revision belongs to, as variantId, so a submission freezes a revision of its own edition.",
  revisionRequired: "Name the exact revision to freeze, as revisionId, so the candidate is the revision the reviewer was shown rather than whatever is drafted now.",
  noteBlank: "Say what the note states, or leave it out: an empty note states nothing.",
  noteTooLong: `Keep the note to ${REVIEW_NOTE_MAX_CHARS} characters, which is all a review record holds.`,
  bodyNotJson: "Send the review decision as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;

function recordReferenceSchema(required: string): z.ZodType<string> {
  return z.string({ error: required }).trim().min(1, required).max(REFERENCE_MAX_CHARS, MESSAGES.referenceTooLong);
}
// Field shapes the four review mutations declare
const variantIdSchema = recordReferenceSchema(MESSAGES.variantRequired);

const revisionIdSchema = recordReferenceSchema(MESSAGES.revisionRequired);

const candidateIdSchema = recordReferenceSchema(MESSAGES.candidateRequired);

const noteSchema = z.string({ error: MESSAGES.noteBlank }).trim().min(1, MESSAGES.noteBlank).max(REVIEW_NOTE_MAX_CHARS, MESSAGES.noteTooLong);
// One payload schema per step, mirroring the fields that step's own service schema declares. Each is
// strict, because Zod strips an unknown key by default: a field this path does not admit has to be
// refused by name, not dropped, so no answer can carry a decision the review record does not hold.
const submitForReviewPayloadSchema = z.strictObject({
  op: z.literal("submitForReview"),
  variantId: variantIdSchema,
  revisionId: revisionIdSchema,
});
const approveCandidatePayloadSchema = z.strictObject({
  op: z.literal("approveCandidate"),
  candidateId: candidateIdSchema,
});
// The reviewer's own words, bounded once and shared by the two steps that carry them.
const reviewerNoteFields = {
  candidateId: candidateIdSchema,
  note: noteSchema.optional(),
  reason: noteSchema.optional(),
} as const;
const requestChangesPayloadSchema = z.strictObject({
  op: z.literal("requestChanges"),
  ...reviewerNoteFields,
});
const rejectCandidatePayloadSchema = z.strictObject({
  op: z.literal("rejectCandidate"),
  ...reviewerNoteFields,
});
// A per-mutation schema set on a shared path, selected by `op` — not a universal dispatcher: there is
// no table name, no field map and no branch that forwards a key its step does not declare.
const reviewPayloadSchema = z.discriminatedUnion("op", [submitForReviewPayloadSchema, approveCandidatePayloadSchema, requestChangesPayloadSchema, rejectCandidatePayloadSchema]);

type ReviewPayload = z.output<typeof reviewPayloadSchema>;

type ReviewOperation = ReviewPayload["op"];

type ReviewRequest = MutationInput<ReviewPayload>;
// A body that is not a JSON object is answered in the same words whatever it holds, so the caller is
// told to send the four-field envelope rather than reading Zod's account of an absent property.
const reviewRequestBodySchema = z.custom<unknown>((value) => isRecord(value), { error: MESSAGES.bodyNotJson }).pipe(mutationInputSchema(reviewPayloadSchema));
// The read side: the one query value this transport admits
const reviewQuerySchema = z.strictObject({ variantId: variantIdSchema });

const attemptIdentitySchema = z.object({ operationId: z.string() });
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
/** `op` selects the step here; the service's own payload schemas do not know it, so it is removed before the call. */
function withoutOperation<P extends { readonly op: ReviewOperation }>(payload: P): Omit<P, "op"> {
  const { op: _discriminant, ...forwarded } = payload;
  return forwarded;
}
/** One review step per request: the switch calls exactly one named mutation and never chains two. */
async function runReview(sessionId: string, input: ReviewRequest): Promise<MutationOutcome> {
  const { payload } = input;
  switch (payload.op) {
    case "submitForReview":
      return mutations.updates.submitForReview(sessionId, { ...input, payload: withoutOperation(payload) });
    case "approveCandidate":
      return mutations.updates.approveCandidate(sessionId, { ...input, payload: withoutOperation(payload) });
    case "requestChanges":
      return mutations.updates.requestChanges(sessionId, { ...input, payload: withoutOperation(payload) });
    case "rejectCandidate":
      return mutations.updates.rejectCandidate(sessionId, { ...input, payload: withoutOperation(payload) });
    default:
      // Unreachable: the four steps above are the closed set the union admits, so a fifth fails to
      // compile at this call instead of reaching the runtime.
      return assertNever(payload, "Unhandled review mutation");
  }
}
/**
 * The frozen candidate one edition holds under review, with the single review step and the per-variant
 * approval the service decides. Reading freezes nothing, approves nothing and releases nothing.
 *
 * The edition is named rather than the candidate because the read that owns the frozen revision set
 * resolves by edition: a candidate's identity is the frozen revision's identity, not a lookup key, so a
 * candidate identity sent here would name no record at all.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = reviewQuerySchema.safeParse({ variantId: new URL(request.url).searchParams.get("variantId") ?? "" });
  if (!parsed.success) {
    // A query this read does not admit is a request-level refusal answered with the same per-field
    // `invalid` outcome the four writes answer, because nothing behind the read failed and a caller has
    // to be told which value to correct.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, parsed.error));
  }
  try {
    return toResponse(await reads.updates.readCandidate({ variantId: parsed.data.variantId }));
  } catch (error) {
    // One mapper knows the difference between a store outage, a session that cannot be established and
    // a lost acknowledgement, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/**
 * One review step, named by `payload.op`, answered with exactly one of the service's eight outcomes:
 * `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or
 * `unknown`. A second answer to the same candidate is the service's decision, not this handler's.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const parsed = reviewRequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    // A body that is not JSON, a field this path does not admit or an unknown step is refused before
    // anything is read or written, under the operation identity the caller sent so a recovery can
    // still be matched to the attempt it belongs to.
    return toResponse(outcomeFromError(operationIdentityOf(raw), parsed.error));
  }
  try {
    return toResponse(await runReview(sessionIdOf(request), parsed.data));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the mutation answers refusals as outcomes, so
    // a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
