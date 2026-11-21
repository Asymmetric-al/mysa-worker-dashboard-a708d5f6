/**
 * The Ministry Updates family's publish payload schema — the one mutation that releases a document's
 * frozen candidates: `publishVariants`.
 *
 * One schema per named mutation, and this one names its own field set, so a request body posted to
 * `/api/publish` can only ever mean one thing. Withdrawing an edition, restoring an earlier revision
 * and submitting a notice are different mutations with their own payloads, so none of their fields
 * appears here.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — is composed once in
 * `../hooks/use-update-mutations.ts`, so nothing below declares an operation id, a scope, an expected
 * revision or a revision alias, and nothing reads a clock.
 *
 * These schemas are the client's mirror, never the authority. The service re-validates every payload
 * with its own per-mutation schema, re-derives every fact it acts on from the stored records, and
 * answers with the closed outcome set — `invalid` with per-field messages, `conflict` when a
 * candidate has moved on, `denied` when the scope refuses, `unknown` when an acknowledgement was
 * lost — and `@/components/form-field.tsx` renders whatever it answers. A schema here only spares the
 * worker a round trip for a mistake the form can already see.
 *
 * Exactly two rules are decided here, and both are refusals:
 *
 * - **A candidate that was not submitted under a policy admitting a notice cannot be released with
 *   notify.** Review is one step, approval of one variant approves no other, and a further round is a
 *   new submission of a new candidate rather than a quiet re-review (AAP 0.8.5). A reviewer must
 *   therefore never be able to turn Publish only into Publish and notify now, so
 *   {@link publishVariantsSchema} refuses that pairing with the family's own sentence from
 *   `../copy/updates-copy`.
 * - **One variant edition is released once in one intent.** Two selections naming the same variant
 *   would ask the service to publish one edition twice from a single operation, so the repeated entry
 *   is refused at its own index instead of being answered after submission.
 *
 * Everything else is the service's question and is deliberately absent: notification eligibility,
 * the recipient ceiling, one pinned rendition per recipient, per-variant results with a sibling's
 * prior-good head preserved, dedupe against an earlier intent, reach after release, and withdrawal.
 * Publication is kept distinct from notification here as well — this payload asks for a release and
 * states the reviewer's intent for a notice; no delivery or reading outcome is claimed, stored or
 * inferred anywhere in this file (AAP 0.8.5).
 *
 * Shape is reused rather than restated. An identifier is validated by the one `contentIdSchema` this
 * schema folder shares, and the closed publish choice is mirrored from the family's copy module with
 * a compile-time parity assertion, so a mode added to either vocabulary fails the build instead of
 * becoming silently unsendable.
 *
 * Plan items: AAP 0.6.1 "Mutations: content and media" (`publishVariants`), AAP 0.6.3
 * `POST /api/publish`, AAP 0.7.1's "Write and release an Update" job, AAP 0.8.5 ("Review is one step,
 * only where policy requires it … a reviewer cannot silently turn Publish only into Notify"), the AAP
 * 0.9.1 tree row `features/updates/**`, and criterion 9.
 */
import { z } from "zod";

import { PUBLISH_MODE_LABELS, REVIEW_ROUND_NOTE } from "../copy/updates-copy";
import { contentIdSchema } from "./draft";

// ---------------------------------------------------------------------------------------------
// The closed publish choice: one vocabulary, mirrored from the family's copy module
// ---------------------------------------------------------------------------------------------

/**
 * The two publish choices a release offers: release the edition alone, or release it and submit a
 * notice now.
 *
 * It is an array rather than a type alone because a form renders the choice as a control and
 * `z.enum()` needs the values at runtime. There is no third member: notification has no scheduled or
 * deferred variant in this release, so withholding a notice is simply Publish only, and there is one
 * immediate choice rather than a queue this application does not have (AAP 0.8.5).
 */
export const PUBLISH_MODES = ["publish-only", "publish-and-notify-now"] as const;

/**
 * One publish choice.
 *
 * This is the same union `../copy/updates-copy.ts` declares, because that module words each choice's
 * consequence and a copy leaf may not import the schema that validates it. The two are held equal
 * rather than trusted to stay equal: {@link PUBLISH_MODE_PARITY} is typed as a total map in both
 * directions, so a mode added to either vocabulary fails this file's compilation.
 */
export type PublishMode = (typeof PUBLISH_MODES)[number];

/**
 * The compile-time parity assertion between this payload's choice set and the one the copy module
 * words.
 *
 * The intersection of the two records is the whole proof. `Record<keyof typeof PUBLISH_MODE_LABELS,
 * PublishMode>` requires every choice copy words to be a choice this payload accepts, and
 * `Record<PublishMode, keyof typeof PUBLISH_MODE_LABELS>` requires every choice this payload accepts
 * to be one copy words — so neither vocabulary can gain a member the other lacks without `tsc`
 * refusing this literal. The values are the members themselves, so the map is an identity rather
 * than a renaming, and no consequence sentence is duplicated here: those belong to copy.
 */
const PUBLISH_MODE_PARITY = {
  "publish-only": "publish-only",
  "publish-and-notify-now": "publish-and-notify-now",
} as const satisfies Readonly<
  Record<keyof typeof PUBLISH_MODE_LABELS, PublishMode> &
    Record<PublishMode, keyof typeof PUBLISH_MODE_LABELS>
>;

/**
 * The one choice that submits a notice, read from the parity map so the refusal below and the
 * assertion against copy are the same literal rather than two strings that could drift apart.
 */
const NOTIFY_NOW_MODE = PUBLISH_MODE_PARITY["publish-and-notify-now"];

// ---------------------------------------------------------------------------------------------
// The selection: the frozen candidate, one choice, the candidate's own policy as the form read it
// ---------------------------------------------------------------------------------------------

/**
 * One variant edition selected for release: the exact frozen candidate, the publish choice, and the
 * candidate's notification policy as the form holds it.
 *
 * `variantId` and `revisionId` name the **frozen candidate**, never the draft. They are the pair
 * `readCandidate` hands the review screen, and a release records the same pair, so a publication
 * stays identifiable afterwards; sending a draft's revision instead would let what the reviewer
 * approved and what readers are served differ, which is the drift a frozen candidate exists to
 * prevent.
 *
 * `candidateNotifyAdmitted` is an **advisory mirror** of the frozen candidate's policy and is never
 * an authority. The service re-derives whether that candidate admits a notice from the candidate it
 * froze and ignores the submitted value, so a forged `true` changes nothing. It travels for exactly
 * one reason: it lets {@link publishVariantsSchema} refuse the illegal pairing before a request is
 * made. No form in this family may default it to `true` — a policy the form does not know is stated
 * honestly as `false`, because defaulting it would offer a reviewer the notify choice a candidate
 * never earned.
 */
export const publishSelectionSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
  mode: z.enum(PUBLISH_MODES, {
    error: "Choose how this edition is released: publish only, or publish and notify now.",
  }),
  candidateNotifyAdmitted: z.boolean({
    error:
      "This release needs the candidate's own notification policy, so reopen the review and choose " +
      "the publish choice again.",
  }),
});

// ---------------------------------------------------------------------------------------------
// Wording this payload needs and the family's copy module holds no key for
// ---------------------------------------------------------------------------------------------

/**
 * The one sentence this schema set states itself.
 *
 * `../copy/updates-copy.ts` owns the family's wording, and its `REVIEW_ROUND_NOTE` supplies the
 * notify refusal verbatim. It words nothing for a repeated variant yet, because no other surface has
 * had to refuse one; the sentence is declared here so no schema states a message inline, and it
 * belongs beside `REVIEW_ROUND_NOTE` the next time that catalogue is edited.
 */
const DUPLICATE_VARIANT_MESSAGE =
  "This release lists the same variant edition twice, so remove the repeated entry: one publication " +
  "releases each edition once.";

// ---------------------------------------------------------------------------------------------
// The payload: one document and the exact editions this intent releases
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `publishVariants`: the Update being published and the exact variant editions it releases.
 *
 * A selection names one variant edition — one audience in one content locale — so a per-variant
 * result is expressible and a single edition can be released while a sibling fails under its
 * prior-good head. There is deliberately no maximum number of selections: the document's own editions
 * bound them, and a cap here would refuse a legitimate release of more editions than it guessed.
 *
 * Two refusals are applied to the review as a whole rather than to one field: a selection asking to
 * notify on a candidate whose policy does not admit a notice (with copy's own sentence, on the
 * selection's `mode`), and a second selection of the same variant edition (on the repeated
 * `variantId`). Both name the index they belong to, so the form marks the row the reviewer must
 * change rather than the whole release.
 */
export const publishVariantsSchema = z
  .strictObject({
    documentId: contentIdSchema,
    variants: z
      .array(publishSelectionSchema)
      .min(1, "Choose at least one variant edition to release."),
  })
  .superRefine((payload, ctx) => {
    const selected = new Set<string>();
    payload.variants.forEach((selection, index) => {
      if (selection.mode === NOTIFY_NOW_MODE && selection.candidateNotifyAdmitted === false) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "mode"],
          message: REVIEW_ROUND_NOTE.reviewerCannotAddNotify,
        });
      }
      if (selected.has(selection.variantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "variantId"],
          message: DUPLICATE_VARIANT_MESSAGE,
        });
        return;
      }
      selected.add(selection.variantId);
    });
  });

// ---------------------------------------------------------------------------------------------
// Payload types: inferred from the schemas, never written beside them
// ---------------------------------------------------------------------------------------------

/** One selected variant edition, inferred so a review row and its hook cannot restate it. */
export type PublishSelection = z.infer<typeof publishSelectionSchema>;

/** The payload `publishVariants` accepts, inferred so the review form and its hook hold one shape. */
export type PublishVariantsPayload = z.infer<typeof publishVariantsSchema>;
