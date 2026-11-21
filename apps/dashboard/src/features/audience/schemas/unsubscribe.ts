/**
 * The Audience family's unsubscribe payload schema: the client half of `unsubscribe`, the one
 * mutation that turns a person's Update email from a single publisher for a single purpose off.
 *
 * Plan items that put this file in scope:
 * - AAP 0.9.1's `features/audience/` tree row and AAP 0.11.1's deliverable row for it, whose folder
 *   brief asks this folder for the preference, unsubscribe and confirmation payload schemas.
 * - AAP 0.6.1's "Mutations: audience" row (`unsubscribe`) and AAP 0.7.1's *Reach readers* job group,
 *   where every mutation takes `{ operationId, scope, expectedRevision, payload }` and the `payload`
 *   is validated before any state change.
 * - AAP 0.8.5 and success criterion 10: the audience acts on one publisher and one purpose, a
 *   preference is not consent, and turning notices off claims no recall of one already submitted.
 *
 * One publisher and one purpose is the whole of this payload's scope, and the schema is what makes a
 * wider one unrepresentable. `publisherId` is one non-empty reference rather than a list, `purpose`
 * is the closed purpose the membership module declares rather than free text, and the object is
 * strict — so a payload naming two publishers, naming a second purpose or carrying a field this
 * action has no business deciding is refused outright instead of being quietly ignored.
 *
 * What the payload does not claim: it removes one person from one publisher's Update email purpose
 * and changes nothing else. It recalls no notice already submitted and no copy kept anywhere else; it
 * does not reach a second membership, a contact record, a partner, a consent record or an account
 * state; and it names no consent value, no membership state, no reason, no cadence and no channel,
 * because none of those is a question this action answers.
 *
 * The service is the authority. `@/modules/data-service/mutations/audience.ts` owns the schema this
 * one mirrors: the same two field names, the same closed purpose, the same strictness and the same
 * bound on the publisher reference. The service wins wherever the two could disagree, because it
 * re-validates every payload with its own schema and answers the closed outcome set, while a schema
 * here only spares the worker a round trip for a mistake the form can already see. The mirror is of
 * the contract and not of the source: nothing is imported from the service and no line of it is
 * copied here.
 *
 * Layering: a feature-layer payload contract whose only imports are `zod` and the purpose constant
 * from the domain module that declares it. It reads no clock — an unsubscribe touches no window, no
 * deadline and no instant — and it knows nothing of a component, the synthetic store, the data
 * service, a provider or a transport. The four-field mutation input is composed by the hook that
 * calls this schema, so no operation identity, scope or expected revision is declared here.
 */
import { z } from "zod";

import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";

// ---------------------------------------------------------------------------------------------
// The payload: one publisher, one purpose, and nothing else
// ---------------------------------------------------------------------------------------------

/**
 * The longest publisher reference this schema accepts.
 *
 * It is the bound the service's own publisher field carries, repeated so the form refuses a value the
 * service would refuse and shows the field's message instead of a round trip. It is neither tightened
 * nor loosened against the service: a client-only bound in either direction would let the form and
 * the service disagree about one and the same value.
 */
const PUBLISHER_REFERENCE_MAX_LENGTH = 200;

/**
 * Feeds `unsubscribe`: turn off this person's Update email from one publisher for one purpose.
 *
 * `publisherId` is the opaque publisher reference the record stores — never an address, never a name,
 * never parsed for meaning — and it is not trimmed, because a value this schema silently altered
 * would differ from the one the request carried and the service writes.
 *
 * `purpose` is a literal of the one purpose this release keeps memberships for, which makes every
 * other purpose unrepresentable rather than merely unvalidated: a second purpose would carry its own
 * consent and its own scheduling, so it is a product change and not a value a request may introduce.
 *
 * Strict by construction: the object rejects every key it does not declare, so an extra key — a
 * second publisher, a second purpose, a membership reference, or a consent, state or reason field —
 * is an error rather than something silently dropped. This release has no global or all-publishers
 * unsubscribe, and no field here could express one.
 *
 * No `.default()`, `.catch()`, `.transform()`, `.preprocess()` or `.pipe()` appears on either field:
 * each would make the schema's input type differ from its output and let the value written differ
 * from the value validated, which is exactly what the mutation contract relies on not happening.
 */
export const unsubscribePayloadSchema = z.strictObject({
  publisherId: z
    .string({ error: "Select the one publisher this unsubscribe applies to." })
    .min(1, "Select the one publisher this unsubscribe applies to.")
    .max(
      PUBLISHER_REFERENCE_MAX_LENGTH,
      `A publisher reference is at most ${PUBLISHER_REFERENCE_MAX_LENGTH} characters.`,
    ),
  purpose: z.literal(UPDATE_EMAIL_PURPOSE, "Select the one purpose this unsubscribe applies to."),
});

/**
 * The payload `unsubscribe` accepts, inferred so the preferences surface and its hook hold one shape
 * and no caller restates a field.
 */
export type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;
