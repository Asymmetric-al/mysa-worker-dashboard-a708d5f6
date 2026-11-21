/**
 * The Ministry Updates family's withdrawal payload schemas — `withdrawUpdate` and `withdrawLocale` —
 * and the one bound this family puts on the note a worker may attach to either.
 *
 * Plan items that put this file in scope:
 * - AAP 0.11.1: the fifth of the six schemas in `features/updates/schemas`.
 * - AAP 0.6.1: the content mutations `withdrawUpdate` and `withdrawLocale`.
 * - AAP 0.6.3: `POST /api/withdraw`, whose body is validated against one of the two schemas below.
 * - AAP 0.7.1, the "Write and release an Update" job row, where both mutations stand beside the
 *   release they end.
 * - AAP 0.8.6 and criterion 12: withdrawal is containment inside this application and never a claim
 *   of recall; one locale edition leaves its siblings readable; an unrelated invalid draft cannot
 *   block it.
 *
 * Withdrawal is a containment act, and the payload is shaped so it cannot say anything else. It stops
 * this application serving the edition: the address no longer shows the content and the discovery
 * index stops listing it. What it does not do is stated once, in `WITHDRAWAL_WORDING`, and reaches
 * the worker through the reason field's own description below rather than being written a second
 * time here.
 *
 * The decisions withdrawal involves live elsewhere. Which editions are contained, what a withdrawn
 * address answers, when the index stops listing an edition and how a release records its end belong
 * to `@/modules/content/reach.ts` and to the service that calls it. Nothing here imports or
 * reimplements that rule: a payload may not name a reach value, an opaque end notice, a withdrawal
 * instant or a media deletion, which is why both objects below are strict — a request carrying such a
 * field is refused outright instead of being quietly ignored.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, the revision the caller saw and the payload — belongs to the transport and is
 * composed once in `../hooks/use-update-mutations.ts`, so neither schema declares an operation id, a
 * scope, an expected revision or a revision alias, and neither reads a clock nor compares a revision.
 * Withdrawal has no scheduled form in this release, so no field here names a date either.
 *
 * These schemas are the client's mirror, never the authority. The service re-validates every payload
 * with its own per-mutation schema and answers with the closed outcome set — `invalid` with per-field
 * messages, `conflict` when the revision the caller saw is stale, `denied` when the scope refuses —
 * and `@/components/form-field.tsx` renders whatever it answers. A schema here only spares the worker
 * a round trip for a mistake the form can already see.
 *
 * Shape is reused rather than restated: a record identity is `contentIdSchema` and a content-locale
 * tag is `localeTagSchema`, both taken from `./draft`, so an identifier or a locale has one owner in
 * this family and a change there reaches both withdrawal payloads.
 *
 * What is deliberately absent: no end notice, reach, withdrawal instant, media-deletion, provider or
 * scheduling field; no keyword rule over the worker's free text; no clock read of any kind; no React,
 * hook or component; no synthetic store; no module belonging to another feature; and no server-only
 * renderer.
 */
import { z } from "zod";

import { WITHDRAWAL_WORDING } from "../copy/updates-copy";
import { contentIdSchema, localeTagSchema } from "./draft";

// ---------------------------------------------------------------------------------------------
// The one bound on the reason, and the reason schema derived from it
// ---------------------------------------------------------------------------------------------

/**
 * The longest reason this family accepts beside a withdrawal: 500 characters.
 *
 * This is this family's **own** bound for a short human note. It restates no limit a domain module
 * owns, because no domain module owns a withdrawal-reason limit, and the service re-validates it so a
 * stale client cannot talk the number up. Bounding the note is the whole constraint: the text is free
 * and is not scanned for keywords, because the wording rule that matters is about how the action is
 * described to the worker, and that wording belongs to `WITHDRAWAL_WORDING` rather than to a pattern
 * over what someone types.
 */
export const WITHDRAWAL_REASON_MAX_CHARS = 500;

/**
 * The optional reason a worker may attach to a withdrawal: trimmed text within the family bound.
 *
 * Absent is a complete answer. A worker who withdraws without explaining is not stopped, so the
 * action never demands a justification it does not need, and an empty field submits as no reason at
 * all rather than as one more thing to fill in. The description carries the family's withdrawal
 * wording verbatim — what the action does and what it explicitly does not — so the helper text beside
 * the field and the schema cannot disagree and no surface has to author a second version; it is
 * attached after `.optional()` so it sits on the schema a field is handed.
 */
export const withdrawalReasonSchema = z
  .string({
    error: "A withdrawal reason is text, so type it here rather than pasting formatted content.",
  })
  .trim()
  .max(
    WITHDRAWAL_REASON_MAX_CHARS,
    `Keep the reason to ${WITHDRAWAL_REASON_MAX_CHARS} characters or fewer: it is a short note ` +
      "beside the withdrawal, not a record of why the edition existed.",
  )
  .optional()
  .describe(`${WITHDRAWAL_WORDING.whatItDoes} ${WITHDRAWAL_WORDING.whatItDoesNotDo}`);

// ---------------------------------------------------------------------------------------------
// The two withdrawal payloads: every locale edition of one Update, or exactly one edition
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `withdrawUpdate`: withdraw every locale edition of one Update inside this application.
 *
 * The document identity is the unit because this mutation is the wider of the two — it ends service
 * for every locale edition of the Update and does so even while a sibling draft is invalid, since
 * containment outranks editorial state. It recalls no message already submitted and no copy a third
 * party holds, as `WITHDRAWAL_WORDING.whatItDoesNotDo` says; the reason, when a worker gives one, is
 * a note about the decision and never a claim about what the action reached.
 */
export const withdrawUpdateSchema = z.strictObject({
  documentId: contentIdSchema,
  reason: withdrawalReasonSchema,
});

/**
 * Feeds `withdrawLocale`: withdraw exactly one locale edition, leaving its siblings readable.
 *
 * The variant identity and its content locale travel together, because the address a reader was
 * given, the release head and the locale are one edition. Only the edition this payload names is
 * ended, which is what keeps "withdrawing one locale leaves the others" true for the family rule in
 * AAP 0.8.6; a payload naming a document instead would have to mean the wider mutation.
 */
export const withdrawLocaleSchema = z.strictObject({
  variantId: contentIdSchema,
  locale: localeTagSchema,
  reason: withdrawalReasonSchema,
});

// ---------------------------------------------------------------------------------------------
// Payload types: inferred from the schemas, never written beside them
// ---------------------------------------------------------------------------------------------

/** The payload `withdrawUpdate` accepts, inferred so the overview and its hook hold one shape. */
export type WithdrawUpdatePayload = z.infer<typeof withdrawUpdateSchema>;

/** The payload `withdrawLocale` accepts, inferred so a locale edition cannot restate it. */
export type WithdrawLocalePayload = z.infer<typeof withdrawLocaleSchema>;
