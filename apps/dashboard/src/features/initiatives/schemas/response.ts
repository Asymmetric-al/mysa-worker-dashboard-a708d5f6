import { z } from "zod";
import { ASSERTING_RESPONSE_KINDS, RESPONSE_KINDS, type ResponseKind } from "../copy";
// A recorded response is the named respondent's own answer to one Request, bound to the terms version
// it was shown. Agreement creates no pledge, gift, commitment, subscription, notification or send, so
// the payload carries no field for one and no field ascribes an outcome the recorded kind does not
// state. These schemas are the client's shape and fail fast; the data service validates authoritatively.
// The closed vocabulary, taken whole from the family's copy so each kind is declared once.
const responseKindSchema = z.enum(RESPONSE_KINDS, {
  error: "Choose how this Request was answered from the recorded responses.",
});
// The asserting kinds are declared once beside the vocabulary in the copy module, so which kinds must
// say what stands behind them cannot move with a display order, and no kind is restated here.
const ASSERTING_KIND_SET: ReadonlySet<ResponseKind> = new Set(ASSERTING_RESPONSE_KINDS);
/** Client-side shape of a `recordRequestResponse` payload, checked before the service re-checks it. */
export const recordRequestResponsePayloadSchema = z
  .object({
    initiativeId: z
      .string({
        error: "This answer is missing the initiative it belongs to; reopen the initiative and try again.",
      })
      .trim()
      .min(1, "This answer is missing the initiative it belongs to; reopen the initiative and try again."),
    requestId: z
      .string({
        error: "This answer is missing the request it belongs to; reopen the request and try again.",
      })
      .trim()
      .min(1, "This answer is missing the request it belongs to; reopen the request and try again."),
    kind: responseKindSchema,
    // The named respondent is its own opaque reference: never an email address, never a name string,
    // and never inferred from the person the ask was sent to.
    respondentId: z.string({ error: "Name the person who gave this answer." }).trim().min(1, "Name the person who gave this answer."),
    // `null` records that no evidence was written down; the rule below decides when that is allowed.
    standingEvidence: z.string({ error: "Describe what stands behind this answer, or leave it empty." }).trim().nullable(),
    termsVersionRef: z.string({ error: "Record which terms version this answer responds to." }).trim().min(1, "Record which terms version this answer responds to."),
  })
  .strict()
  .superRefine((payload, context) => {
    if (!ASSERTING_KIND_SET.has(payload.kind)) return;
    // A non-asserting answer is a recorded state in its own right: it is never refused for having no
    // evidence and never required to carry it.
    if (payload.standingEvidence !== null && payload.standingEvidence.length > 0) return;
    context.addIssue({
      code: "custom",
      path: ["standingEvidence"],
      message: "Describe what stands behind this answer, or record a different response.",
    });
  });
/** The validated fields of a recorded Request response. */
export type RecordRequestResponsePayload = z.infer<typeof recordRequestResponsePayloadSchema>;
/** Whether a response answers exactly the terms version it was shown. */
export function matchesPresentedVersion(presentedVersionRef: string, value: string): boolean {
  // Opaque references are compared whole: no trimming, case-folding or prefix reading, because two
  // different references are two versions and an equal-looking string establishes no identity.
  return presentedVersionRef === value;
}
/** Parses a response payload and refuses any terms version other than the one presented. */
export function recordRequestResponsePayloadSchemaFor(presentedVersionRef: string): typeof recordRequestResponsePayloadSchema {
  return recordRequestResponsePayloadSchema.superRefine((payload, context) => {
    if (matchesPresentedVersion(presentedVersionRef, payload.termsVersionRef)) return;
    context.addIssue({
      code: "custom",
      path: ["termsVersionRef"],
      message: "Answer the terms version that was presented; reload the request and try again.",
    });
  });
}
