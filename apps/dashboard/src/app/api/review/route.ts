import type { NextRequest } from "next/server";
import { z } from "zod";
import { isRecord } from "@/lib/guards";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, reads, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../session-cookie";
import { writeRoute } from "../handler";
import { readGrammar, readRoute } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REFERENCE_MAX_CHARS = 160;
const REVIEW_NOTE_MAX_CHARS = 4_000;
const MESSAGES = {
  candidateRequired: "Name the frozen candidate this decision answers, as candidateId, so the answer lands on the candidate the reviewer read.",
  referenceTooLong: "That reference is longer than any this application produces, so copy it from the review panel.",
  variantRequired: "Name the edition this revision belongs to, as variantId, so a submission freezes a revision of its own edition.",
  revisionRequired: "Name the exact revision to freeze, as revisionId, so the candidate is the revision the reviewer was shown rather than whatever is drafted now.",
  noteBlank: "Say what the note states, or leave it out: an empty note states nothing.",
  noteTooLong: `Keep the note to ${REVIEW_NOTE_MAX_CHARS} characters, which is all a review record holds.`,
  notifyModeRefused: "Choose how this submission asks for its release, as publish-only or publish-and-notify: the submission records that mode and a reviewer cannot change it afterwards.",
  bodyNotJson: "Send the review decision as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
const recordReferenceSchema = (required: string): z.ZodType<string> => z.string({ error: required }).trim().min(1, required).max(REFERENCE_MAX_CHARS, MESSAGES.referenceTooLong);
const variantIdSchema = recordReferenceSchema(MESSAGES.variantRequired);
const revisionIdSchema = recordReferenceSchema(MESSAGES.revisionRequired);
const candidateIdSchema = recordReferenceSchema(MESSAGES.candidateRequired);
const noteSchema = z.string({ error: MESSAGES.noteBlank }).trim().min(1, MESSAGES.noteBlank).max(REVIEW_NOTE_MAX_CHARS, MESSAGES.noteTooLong);
// The release mode the review record keeps, which the submission fixes. The pair is the service's own closed set, and any other value is refused here by name rather than dropped, so a mode the record would not hold never reaches it.
const notifyModeSchema = z.enum(["publish-only", "publish-and-notify"], { error: MESSAGES.notifyModeRefused });
const submitForReviewPayloadSchema = z.strictObject({ operation: z.literal("submitForReview"), variantId: variantIdSchema, revisionId: revisionIdSchema, notifyMode: notifyModeSchema.optional() });
const approveCandidatePayloadSchema = z.strictObject({ operation: z.literal("approveCandidate"), candidateId: candidateIdSchema });
const reviewerNoteFields = { candidateId: candidateIdSchema, note: noteSchema.optional(), reason: noteSchema.optional() } as const;
const requestChangesPayloadSchema = z.strictObject({ operation: z.literal("requestChanges"), ...reviewerNoteFields });
const rejectCandidatePayloadSchema = z.strictObject({ operation: z.literal("rejectCandidate"), ...reviewerNoteFields });
const reviewPayloadSchema = z.discriminatedUnion("operation", [submitForReviewPayloadSchema, approveCandidatePayloadSchema, requestChangesPayloadSchema, rejectCandidatePayloadSchema]);
type ReviewPayload = z.output<typeof reviewPayloadSchema>;
type ReviewOperation = ReviewPayload["operation"];
type ReviewRequest = MutationInput<ReviewPayload>;
const reviewRequestBodySchema = z.custom<unknown>((value) => isRecord(value), { error: MESSAGES.bodyNotJson }).pipe(mutationInputSchema(reviewPayloadSchema));
const reviewQuerySchema = z.strictObject({ variantId: variantIdSchema });
function withoutOperation<P extends { readonly operation: ReviewOperation }>(payload: P): Omit<P, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
async function runReview(sessionId: string, input: ReviewRequest): Promise<MutationOutcome> {
  const { payload } = input;
  switch (payload.operation) {
    case "submitForReview":
      return mutations.updates.submitForReview(sessionId, { ...input, payload: withoutOperation(payload) });
    case "approveCandidate":
      return mutations.updates.approveCandidate(sessionId, { ...input, payload: withoutOperation(payload) });
    case "requestChanges":
      return mutations.updates.requestChanges(sessionId, { ...input, payload: withoutOperation(payload) });
    case "rejectCandidate":
      return mutations.updates.rejectCandidate(sessionId, { ...input, payload: withoutOperation(payload) });
    default:
      return assertNever(payload, "Unhandled review mutation");
  }
}
/** The frozen candidate one edition holds under review, with the single review step and the per-variant approval the service decides. */
export const GET = readRoute(
  readGrammar(reviewQuerySchema, (search) => ({ variantId: search.get("variantId") ?? "" })),
  (query) => reads.updates.readCandidate({ variantId: query.variantId }),
);
/** One review step, named by `payload.operation`: a body that is not JSON, a field this path does not admit or an unknown step is refused before anything is read or written, under the operation identity the caller sent. */
export const POST = (request: NextRequest): Promise<Response> => writeRoute(request, reviewRequestBodySchema, (input) => runReview(sessionIdOf(request), input));
