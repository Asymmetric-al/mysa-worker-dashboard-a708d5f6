/**
 * Contact import, the journey's closing act: the browser-side payload checks for the two mutations
 * that end it — `acceptImportRows` (`POST /api/import/accept`) and `cancelImport`
 * (`POST /api/import/cancel`).
 *
 * Scope: AAP 0.6.1 "Mutations: import" (`acceptImportRows`, `cancelImport`); 0.6.3's routes
 * `/api/import/accept` and `/api/import/cancel`; 0.7.1 ("A form validates with Zod, then posts
 * `{ operationId, scope, expectedRevision, payload }`"); 0.3.1 and 0.5.1 pinning Zod 4.6.7; 0.10.1
 * family 6, contact import, with criterion 4 — the file is reviewed, then accepted, and each row's
 * result is reported afterwards.
 *
 * Two payloads share this file deliberately. `cancelImport` carries nothing beyond the shared
 * envelope, so its payload is a strict empty object, and a fourth schema file holding one
 * `z.strictObject({})` would be a wrapper around nothing plus a payload family that does not exist.
 *
 * Shape and vocabulary only. Whether a row may still be accepted, what each accepted row became, the
 * receipt, the replay decision and the cancellation transform belong to
 * `@/modules/data-service/mutations/import` and `@/modules/import/receipt`, which the service runs.
 * Nothing here computes a result, reads a clock, builds a receipt or decides eligibility: these
 * schemas only stop a browser from posting a payload that could not mean what the screen showed, and
 * the service re-validates the same payload before it changes anything.
 *
 * Both schemas are the payload alone. `{ operationId, scope, expectedRevision }` is the shared
 * mutation envelope composed by the review step's mutation hook, so neither object declares it and
 * both are strict: a smuggled envelope field is an issue rather than a key silently dropped, and each
 * issue carries the field path the form anchors its message to.
 */

import { z } from "zod";

import { rowDecisionPayloadSchema } from "./row-decision";
import { IMPORT_MAX_DATA_ROWS } from "@/modules/import/parse";

// ---------------------------------------------------------------------------------------------
// The explicit acknowledgement, the file it was given for, and the decisions it covers
// ---------------------------------------------------------------------------------------------

/**
 * The worker's explicit confirmation that the snapshot they reviewed may be applied.
 *
 * `z.literal(true)` rather than `z.boolean()`: `false`, `"true"` and an absent value are each refused
 * with an issue at this field. Acceptance is an explicit act, and a defaulted or coerced
 * acknowledgement would fabricate consent-to-effect; the literal also types the payload member as
 * `true`, so no unchecked acceptance can be built downstream.
 */
const acknowledgedSchema = z.literal(true, {
  error: "Confirm the acceptance explicitly.",
});

/**
 * The fingerprint the proposal reported for the file the worker reviewed, carried back unread.
 *
 * Bounded as an opaque, non-empty string and nothing more: nothing here computes, hashes, parses,
 * normalises or compares it, because what a fingerprint is made of, and the comparison that detects a
 * changed file, belong to `@/modules/import/decide`. A stale value therefore has to survive this check
 * and reach the service, where a file that changed since the review is a domain refusal the review
 * step reports — failing the shape instead would blame the field for a fact about the file. No format
 * is asserted, so the digest behind it can change without refusing every acceptance.
 */
const fileFingerprintSchema = z
  .string({
    error: "fileFingerprint must carry the fingerprint reported for the file you reviewed.",
  })
  .min(1, {
    error: "fileFingerprint must carry the fingerprint reported for the file you reviewed.",
  });

/**
 * The decisions snapshot the worker actually reviewed, one decision per row they answered.
 *
 * The sibling module's `rowDecisionPayloadSchema` is reused rather than restated: it is the domain's
 * closed union, so a decision this import can record is a decision this payload can carry, and a
 * renamed member or a fifth kind cannot appear here without failing to compile.
 *
 * Non-empty, and capped at the import module's own `IMPORT_MAX_DATA_ROWS`: a snapshot with no decision
 * applies nothing while reading as an act, and the cap is the file's row limit rather than a number
 * typed here, so the two cannot drift apart when that limit changes. Ordering, de-duplication by row
 * number and eligibility are deliberately not checked — the domain owns all three, and a snapshot it
 * refuses must be refused with its own reason rather than pre-empted by a guess here.
 *
 * The snapshot is the intent. Posting the same decisions under the same `operationId` is one attempt
 * whose stored result comes back; a changed snapshot is different work, which the review step gives a
 * new `operationId`. That is why nothing is sorted or de-duplicated in this check: normalising the
 * rows here would make a replay look like a changed intent.
 */
const reviewedDecisionsSchema = z
  .array(rowDecisionPayloadSchema, {
    error: "Review at least one row decision before accepting.",
  })
  .min(1, { error: "Review at least one row decision before accepting." })
  .max(IMPORT_MAX_DATA_ROWS, {
    error: "A reviewed snapshot holds at most one decision per data row the import accepts.",
  });

// ---------------------------------------------------------------------------------------------
// acceptImportRows
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `acceptImportRows` payload: the explicit acknowledgement, the fingerprint of the file
 * it was given for, and the decisions it covers.
 *
 * Accepting creates private preparation entries and nothing else. No member of this payload can
 * subscribe anyone, record consent, join an Update audience, send a message or qualify the uploaded
 * file as safe, so an accepted row is a contact the worker holds — never a permission the file
 * granted.
 */
export const acceptImportRowsPayloadSchema = z.strictObject({
  acknowledged: acknowledgedSchema,
  fileFingerprint: fileFingerprintSchema,
  decisions: reviewedDecisionsSchema,
});

/** The validated `acceptImportRows` payload: what the review step posts once the worker confirms. */
export type AcceptImportRowsPayload = z.infer<typeof acceptImportRowsPayloadSchema>;

// ---------------------------------------------------------------------------------------------
// cancelImport: the payload is empty, and strict about it
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `cancelImport` payload: nothing beyond the shared envelope.
 *
 * A strict empty object refuses any supplied key with an `unrecognized_keys` issue instead of
 * ignoring it, which is the point — a `reason`, a `confirm`, a `rowNumbers` list or a
 * `cancelUnaccepted` flag would read as an instruction the service never receives. The cancellation's
 * meaning is not asserted in a payload at all: accepted rows stay accepted, rows not yet accepted
 * become skipped, and no record is recalled or deleted, which `@/modules/import/receipt` records and
 * the results screen states.
 */
export const cancelPayloadSchema = z.strictObject({});

/** The validated `cancelImport` payload: an empty object, so `MutationInput<CancelPayload>` sites type cleanly. */
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;
