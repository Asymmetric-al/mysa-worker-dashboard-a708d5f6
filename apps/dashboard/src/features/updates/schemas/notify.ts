/**
 * The notification payload schema — `requestNotification`, the one submission that asks for a notice
 * to go to the readers already eligible for an Update release that has been published.
 *
 * The payload is deliberately the smallest one in this family: a release selection and the recipient
 * ceiling the worker was shown and acknowledged. Everything a request might otherwise be tempted to
 * state is derived on the server by the module that owns it, and none of those modules is imported
 * here:
 *
 * - **When a notice may still be submitted** belongs to `modules/time/window.ts`. Its
 *   `notificationDeadline()` decides usefulness from the intended instant and the 24-hour window, so
 *   the instant a notice is judged against is the service's own and never the browser's.
 * - **Who is eligible** belongs to `modules/audience/resolve.ts`. `eligibleRecipients()` admits and
 *   excludes per publisher, purpose and membership state, and a ceiling it accepted earlier is never
 *   enlarged by a later sign-up.
 * - **Which single rendition each recipient receives**, and the dedupe identity of the send, belong to
 *   `modules/content/notice.ts`. `resolveRendition()` pins one rendition per recipient for the release
 *   the intent names; the dedupe key of publisher, purpose, recipient and intent is fixed beside it.
 *
 * This file is a client mirror of the payload's shape and nothing else. The service re-validates the
 * payload with its own schema and stays the authority on all three questions above; `invalid` comes
 * back with per-field messages that `@/components/form-field.tsx` renders.
 *
 * `z.strictObject` is the mechanism, not a stylistic detail. A request that carried `intendedAt` or
 * `intendedInstant`, a `recipients` or `recipientIds` list, a `dedupeKey`, a recomputed `ceilingCount`
 * or any other browser-derived field would be a second owner of the send instant, of the eligible set
 * or of the outcome identity — the duplicate state ownership this architecture rules out. A strict
 * object refuses every one of those fields as an unrecognised key instead of ignoring it, so a form
 * cannot slip a browser clock or a recipient list past the service even by accident.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — is composed once in
 * `../hooks/use-update-mutations.ts`, so nothing below declares an operation id, a scope or an expected
 * revision, and nothing here reads a clock or compares a revision.
 *
 * `acknowledgedCeiling` is an acknowledgement, never an instruction. It is the count the publish review
 * screen put in front of the worker, carried so the service can see the ceiling they agreed to; it is
 * neither a recipient list nor a limit the form computes, and a number this form invented would change
 * nobody's eligibility.
 *
 * What is deliberately absent: no instant or deadline, no recipient list and no recipient identity, no
 * dedupe key, no send, acceptance, delivery or reading state, no window length (the 24-hour usefulness
 * window is `modules/time/window.ts`'s, and a copy here would be a second owner of it), no React, hook
 * or component, no synthetic store and no module belonging to another feature.
 *
 * Rule 1: the family's notification job only. The eligible set, the no-growth ceiling rule, the
 * usefulness deadline and the acceptance-versus-delivery-versus-reading distinction all stay where the
 * specification puts them, and the identifier shape is imported rather than restated so one definition
 * serves every Updates payload.
 *
 * Plan items: AAP 0.6.1 `requestNotification`, AAP 0.6.3 `POST /api/notify`, the AAP 0.9.1 tree row
 * `features/updates/**`, and the notice rules in AAP 0.8.5.
 */
import { z } from "zod";

import { contentIdSchema } from "./draft";

// ---------------------------------------------------------------------------------------------
// The one notification payload
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `requestNotification`: the exact release a notice is submitted for, and the ceiling the worker
 * acknowledged on the publish review screen.
 *
 * The three identifiers are opaque and are carried, never parsed: the document is the Update's
 * canonical identity, the variant is the edition an audience and a content locale own, and the release
 * is the **pinned** head being notified about. Stating the release is what keeps a later reread from
 * substituting a different copy for the one the worker saw, so every recipient is offered the rendition
 * of the release that was actually published rather than whatever head exists when the notice runs.
 *
 * `acknowledgedCeiling` is a whole number — the eligible count the publish review screen showed, taken
 * from `readSharePresentation` — and zero is legal: it means nobody is eligible right now, which is an
 * honest thing to acknowledge and never an invitation to resolve eligibility here. The integer check
 * also keeps the value inside the range this runtime can hold exactly, so a ceiling is never a fraction
 * and never a number that has already lost precision on the way in.
 *
 * Anything else in the body is refused rather than dropped: the object is strict for the reason the
 * file header gives, and the refusal names the two things a notice request does carry so the next
 * attempt succeeds.
 */
export const requestNotificationSchema = z.strictObject(
  {
    documentId: contentIdSchema,
    variantId: contentIdSchema,
    releaseId: contentIdSchema,
    acknowledgedCeiling: z
      .number({
        error:
          "A notice request states the ceiling you acknowledged as a number, so submit it from the " +
          "publish review screen rather than building one by hand.",
      })
      .int("State the ceiling as a whole number — the eligible count the review screen showed you.")
      .min(
        0,
        "A ceiling is a count, so the lowest it can be is zero: zero means nobody is eligible " +
          "for this notice right now.",
      ),
  },
  {
    error:
      "A notice request carries the release it is submitted for and the ceiling you acknowledged, " +
      "and nothing else, so submit it from the publish review screen.",
  },
);

// ---------------------------------------------------------------------------------------------
// Payload type: inferred from the schema, never written beside it
// ---------------------------------------------------------------------------------------------

/**
 * The payload `requestNotification` accepts, inferred so the publish review form and its hook cannot
 * hold a second shape.
 */
export type RequestNotificationPayload = z.infer<typeof requestNotificationSchema>;
