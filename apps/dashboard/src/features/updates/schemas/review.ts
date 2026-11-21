/**
 * The Ministry Updates family's review-side payload schemas — `approveCandidate`, `requestChanges`,
 * `rejectCandidate` and `restoreRevisionAsDraft` — the four named mutations the one shared review
 * panel drives (`components/review-panel.tsx`, reached from `communication/review/[candidateId]`),
 * over `POST /api/review`.
 *
 * One schema per named mutation, and nothing shared between them. A body can therefore only ever mean
 * one thing: there is no generic review form, no decision discriminator that would make approval and
 * rejection one payload, and no universal command shape — the dispatcher this application
 * deliberately does not have.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — belongs to the transport and is composed once
 * in `../hooks/use-update-mutations.ts`, so nothing below declares an operation id, a scope or an
 * expected revision, and nothing reads a clock or compares a revision.
 *
 * These schemas are the client's mirror, never the authority. The service re-validates every payload
 * with its own per-mutation schema and answers with the closed outcome set — `invalid` with per-field
 * messages, `conflict` when the revision the caller saw is stale, `denied` when the scope refuses —
 * and `@/components/form-field.tsx` renders whatever it answers. A schema here only spares the
 * reviewer a round trip for a mistake the panel can already see.
 *
 * The distinctions the review rules require (AAP 0.8.5, 0.8.7) are payload constraints here:
 * - a **candidate** freezes one exact revision, so {@link approveCandidateSchema} names that
 *   revision's identity *and* its content checksum, and an approval cannot drift onto a later draft;
 * - an approval answers **one variant** — one audience, one content locale — so approving here
 *   approves no sibling edition, and no payload below can name a second variant or a locale;
 * - review is **one step**, so a further round is a new submission with a new candidate rather than a
 *   second answer to the frozen one; that is the wording `REVIEW_ROUND_NOTE` carries, and the reason
 *   nothing here re-opens a candidate already answered;
 * - a **restore** always produces a new draft, so {@link restoreRevisionAsDraftSchema} names one
 *   revision to copy and no record to overwrite.
 *
 * What is deliberately absent: no publish mode, notification, delivery, scheduling, translation or
 * provider field — a reviewer cannot turn Publish only into Publish and notify now, and this family's
 * publish and notify payloads live beside this file; no body, prose, section or media placement (the
 * one content profile validates a document, and this file never re-declares its schema); no React,
 * hook or component; no synthetic store; no module belonging to another feature; and no server-only
 * renderer.
 */
import { z } from "zod";

import { REVIEW_ROUND_NOTE } from "../copy/updates-copy";
// The family's one identifier shape, imported from the sibling draft schemas rather than restated. No
// review payload names a content locale — a variant's locale comes from the record the service
// returns — so the sibling locale shape is deliberately left out of this file's imports.
import { contentIdSchema } from "./draft";

// ---------------------------------------------------------------------------------------------
// The reviewer's note: one bound, declared once
// ---------------------------------------------------------------------------------------------

/**
 * The longest note a reviewer may leave on a candidate.
 *
 * This is **this family's own bound for a reviewer's note** — a review note is neither a check-in
 * answer nor a shared task description, so it does not restate a limit another domain module owns,
 * and the coaching limits stay where they belong. The service re-validates the note against this same
 * bound, so a longer note is refused with a readable message rather than being silently truncated and
 * then refused by the service after a round trip.
 */
export const REVIEW_REASON_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------------------------
// The four review payloads
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `approveCandidate`: the frozen candidate the reviewer read, named by the exact revision and
 * content checksum the review envelope carried.
 *
 * The identity pair is the whole guard against drift. A candidate freezes one revision, and the
 * revision's checksum travels with it, so stating both means the approval answers the content the
 * reviewer actually read — a draft edited after the freeze cannot become what was approved, because
 * the checksum it would have to carry is the frozen one. `contentChecksum` is opaque: it is bounded
 * only in length, never in width or encoding, so a digest the content profile chooses to produce is
 * accepted rather than shape-matched against a guess.
 *
 * Approving this candidate approves no other variant: not the same document's other audience, not its
 * other locale. A revision that has moved on since the reviewer read it is the service's `conflict`,
 * answered against the values stated here with the reviewer's input preserved for comparison.
 */
export const approveCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  contentChecksum: z
    .string({
      error:
        "Approval names the checksum of the revision you read, so approve the candidate from its " +
        "review panel rather than here.",
    })
    .trim()
    .min(
      1,
      "Approve the candidate from its review panel, which carries the checksum of the revision you " +
        "read. " +
        REVIEW_ROUND_NOTE.approvalIsPerVariant,
    )
    .max(
      64,
      "That checksum is longer than any this application produces, so approve the candidate from " +
        "its review panel rather than pasting one.",
    ),
});

/**
 * Feeds `requestChanges`: the reviewer's note asking the author for a new revision of one candidate.
 *
 * The note is required, because a request for changes with nothing said leaves the author guessing.
 * It is a note on this review record only: nothing here is delivered to anyone, so the payload names
 * no recipient, channel or provider, and the wording of its messages never claims a message was
 * sent. Asking for changes answers the frozen candidate; the author's next attempt is a new
 * submission with a new candidate, which is the wording {@link REVIEW_ROUND_NOTE} carries.
 */
export const requestChangesSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({
      error:
        "Say what needs changing, as a note on this candidate rather than a message to anyone.",
    })
    .trim()
    .min(
      1,
      "Say what needs changing so the author can act on it. " +
        REVIEW_ROUND_NOTE.furtherRoundIsNewSubmission,
    )
    .max(
      REVIEW_REASON_MAX_CHARS,
      `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` +
        "holds, so point at what needs changing and leave the rewriting to the author.",
    ),
});

/**
 * Feeds `rejectCandidate`: the reviewer declining one frozen candidate, with a note that is optional.
 *
 * A rejection needs no explanation, so `reason` may be absent — but absence is the only way to say
 * nothing: a blank or whitespace-only note is refused, because "optional" must never quietly mean
 * "blank". When a note is given it is bounded by the same family limit as a request for changes,
 * since both are notes on one review record and neither is delivered to a recipient. Rejecting
 * answers the frozen candidate and stops there; it publishes nothing, withdraws nothing and leaves
 * any current release exactly as it was.
 */
export const rejectCandidateSchema = z.strictObject({
  candidateId: contentIdSchema,
  variantId: contentIdSchema,
  reason: z
    .string({
      error: "State the reason as a note on this candidate, or leave the reason out entirely.",
    })
    .trim()
    .min(
      1,
      "Either leave the reason out or say what ended this candidate: an empty note states nothing.",
    )
    .max(
      REVIEW_REASON_MAX_CHARS,
      `Keep the note to ${REVIEW_REASON_MAX_CHARS} characters, which is all this review record ` +
        "holds, so say what ended the candidate and leave the rest to its author.",
    )
    .optional(),
});

/**
 * Feeds `restoreRevisionAsDraft`: the one revision to copy into a draft, and nothing else.
 *
 * The mutation always mints a new draft identity — the content module's `restoreAsNewDraft()` gives
 * the copy a fresh revision identity, the restoring principal and a new creation instant, and a
 * revision identity is never reused — so this payload deliberately cannot name a draft, a candidate
 * or a revision to overwrite. The strict object is the mechanism: such a key is refused rather than
 * ignored, which means no caller can express "restore this over that", and every earlier revision,
 * candidate and release is left where it was. Which variant the restored draft belongs to is the
 * service's question, read from the revision itself, so the payload names no variant either.
 */
export const restoreRevisionAsDraftSchema = z.strictObject({
  revisionId: contentIdSchema,
});

// ---------------------------------------------------------------------------------------------
// Payload types: inferred from the schemas, never written beside them
// ---------------------------------------------------------------------------------------------

/** The payload `approveCandidate` accepts, inferred so the review panel and its hook hold one shape. */
export type ApproveCandidatePayload = z.infer<typeof approveCandidateSchema>;

/** The payload `requestChanges` accepts, inferred so the note a reviewer writes has one bound. */
export type RequestChangesPayload = z.infer<typeof requestChangesSchema>;

/** The payload `rejectCandidate` accepts, inferred so an optional note is one shape, not two. */
export type RejectCandidatePayload = z.infer<typeof rejectCandidateSchema>;

/** The payload `restoreRevisionAsDraft` accepts, inferred so a restore cannot name a record. */
export type RestoreRevisionAsDraftPayload = z.infer<typeof restoreRevisionAsDraftSchema>;
