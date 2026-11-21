/**
 * The Worker and Project Pages family's draft, review, release and withdrawal payload schemas: one
 * schema per named mutation for `createVariant`, `saveDraft`, `submitForReview`, `approveCandidate`,
 * `requestChanges`, `publishVariants`, `withdrawPage` and `withdrawLocale`, each with the four-field
 * mutation request the transport composes around it.
 *
 * `rejectCandidate` is deliberately not here. The Pages family answers a frozen candidate with an
 * approval or a request for changes; a rejection belongs to the Ministry Updates review, whose schema
 * folder sits beside that family. Nothing in this folder should gain a second rejection schema to
 * "complete" the set.
 *
 * One schema per mutation, so a request body can only ever mean one thing: there is no generic
 * page-update payload, no field bag, no action discriminator that would make approval and a request
 * for changes one shape, and no dispatcher — the generalisations this application does not have.
 *
 * The lifecycle the family keeps apart is visible in the shapes themselves:
 *
 * - a **draft** carries a document (`saveDraft`), and saving one moves the edition's draft pointer and
 *   nothing else;
 * - a **candidate** is frozen by naming an exact revision (`submitForReview`), so what a reviewer
 *   answers cannot drift onto a later draft;
 * - an **approval is one step** and answers one candidate (`approveCandidate`), approving no sibling
 *   edition;
 * - a **release** is a separate action over a set of approved editions (`publishVariants`), reported
 *   per edition, which is what lets one edition fail while a sibling's prior-good release stands;
 * - a **withdrawal** names one identifier and nothing else (`withdrawPage`, `withdrawLocale`): it
 *   contains what this application serves and claims no recall of a copy someone already holds.
 *
 * A Page has no notification. `notifyMode` below admits `publish-only` and nothing else, the release
 * payload carries no mode, recipient or ceiling, and no payload here can ask for a notice — publication
 * is never presented as delivery.
 *
 * Field names are the payload's own contract with the service: each payload names exactly the fields
 * its mutation accepts in `modules/data-service/mutations/content.ts` — no more and no fewer — so a
 * payload validated here is accepted there unchanged and a message lands on the field the form renders.
 * The service's payloads are strict objects, so a key the mutation does not declare is refused as an
 * unknown field rather than ignored: a field this client invented would turn every submission into an
 * `invalid` outcome, which is why each mirror below is the service's payload and nothing beyond it.
 *
 * A schema here is the client's mirror, never the authority. The service re-validates every payload
 * with its own per-mutation schema, re-derives every fact it acts on from the stored records, and
 * answers with the closed outcome set — `invalid` with per-field messages, `conflict` when the revision
 * the caller saw is stale, `denied` when the scope refuses, `unknown` when an acknowledgement was lost
 * — and `@/components/form-field.tsx` renders whatever it answers. Validating here only spares the
 * worker a round trip for a mistake the form can already see.
 *
 * Shape is reused rather than restated. A draft body is validated by the one content profile
 * (`contentDocumentSchema` and `parseDocument()` in `modules/content/document.ts`), so this file
 * declares no second content schema and imports no editor; the audience literal is tied to
 * `ContentVariant` at compile time, so an audience renamed upstream fails the build here; the locale
 * tag takes its shape from `ContentLocale`; and the request envelope is `mutationInputSchema`, so no
 * schema below declares or re-implements an operation identity, a scope or an expected revision.
 *
 * What is deliberately absent: no publish mode beyond publish-only, no notification intent, recipient,
 * ceiling or dedupe key; no reach value (that belongs to `reach.ts`); no schedule, timestamp or publish
 * date; no media byte, filename or rendition (those belong to `media.ts`); no section, preset or
 * placement field (those belong to `sections.ts`); no amount, currency or financial field; no CMS
 * status, provider or translation-service field; no clock read and no random value; no React, hook,
 * component, store, media module or server-only renderer; and no test file.
 */
import { z } from "zod";

import {
  contentDocumentSchema,
  parseDocument,
  type ContentDocumentJson,
} from "@/modules/content/document";
import type { ContentLocale } from "@/modules/content/locale";
import type { ContentVariant } from "@/modules/content/variant";
// The envelope module is imported directly rather than through the `@/modules/data-service` barrel:
// the barrel re-exports every read and mutation, whose graph reaches `node:fs` through the synthetic
// store, and this file is loaded by client components. It is the same `mutationInputSchema`.
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";

// ---------------------------------------------------------------------------------------------
// Shared primitives: one identifier, one locale tag, one audience, one document body
// ---------------------------------------------------------------------------------------------

/**
 * The audience a page edition serves: public, and only public.
 *
 * The family has no approved-supporter edition — a Page is read by anyone who reaches it — so the
 * audience is a literal rather than the two-member union the Updates family admits. Typing the
 * constant against `ContentVariant["audience"]` is the compile-time tie: if the content variant model
 * ever renames or drops `public`, this line stops compiling rather than the payload quietly admitting
 * an audience no edition can carry. An audience axis, an audience array and an audience-by-locale
 * cross-product have no shape here, and the strict objects below refuse such a key rather than
 * ignoring it.
 */
const pageAudience = "public" satisfies ContentVariant["audience"];

/** Validates the audience of a page edition, refusing every other audience the model can name. */
const pageAudienceSchema = z.literal(
  pageAudience,
  "A page edition is public, so this family has no other audience.",
);

/**
 * One opaque record identity: a page, an edition, a revision or a candidate.
 *
 * An identifier is carried, never parsed and never compared with a name, an email address or a numeric
 * fragment of another system's id, because equal-looking values establish neither identity nor
 * authority. Only emptiness is refused here: how long an identity may be is the service's rule, and
 * this form does not restate it.
 */
const recordIdSchema = z
  .string({ error: "This action applies to one record, so reopen it from its list and try again." })
  .trim()
  .min(1, "This action applies to one record, so reopen it from its list and try again.");

/**
 * One content-locale tag: the language an edition is written in, such as `en`, `fr` or `ar-EG`.
 *
 * The shape is `ContentLocale`'s tag, so the module that owns content locales still owns its form. It
 * is a content locale and never the interface language, and which locales a page actually has an
 * edition for is a read's answer — the service resolves the edition and refuses a language with no
 * edition — so nothing here enumerates admitted tags or guesses one.
 */
const localeTagSchema: z.ZodType<ContentLocale["tag"]> = z
  .string({ error: "Choose the language edition this change applies to." })
  .trim()
  .min(1, "Choose the language edition this change applies to.");

/**
 * Where a content-profile issue sits inside this payload: the document's own path split into segments,
 * so the field a form renders is the field the issue belongs to. A numeric segment stays an array
 * index, which is how the editor addresses a paragraph or a section; a problem with the document as a
 * whole becomes an issue on the body field itself rather than a pathless message no field can show.
 */
function bodyIssuePath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) {
      continue;
    }
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}

/**
 * The draft body: the one content profile's document, plus the rules its shape cannot state.
 *
 * The declared type is the profile's `ContentDocumentJson` — never a bag of unknown fields — so a body
 * this schema accepts is exactly what a revision stores and a candidate freezes. The schema proves the
 * shape: root node, profile version, direction, prose and sections. `parseDocument()` then adds what a
 * shape cannot phrase — an unadmitted node or mark named, a heading level outside the profile, a link
 * destination that would execute, a bidi control character stored in text, content nested past the
 * recursion guard — and each of its issues is reported at its own path under the body field, so the
 * editor marks the paragraph or section field that has to change.
 */
const draftBodySchema: z.ZodType<ContentDocumentJson> = contentDocumentSchema.superRefine(
  (document, ctx) => {
    const parsed = parseDocument(document);
    if (parsed.status === "valid") {
      return;
    }
    for (const issue of parsed.issues) {
      ctx.addIssue({ code: "custom", path: bodyIssuePath(issue.path), message: issue.message });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// createVariant
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `createVariant`: the page this edition belongs to, the language it is written in, and the
 * audience it serves.
 *
 * The variant's own identity, and whether an edition for that language already exists, are the
 * service's answers — it mints the identity and reports a taken key as a conflict — so nothing here
 * names an edition. Creating one releases nothing: the new edition starts with no draft, no candidate
 * and no release, and every other edition of the page keeps the draft, candidate and release it had.
 */
export const createVariantPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  locale: localeTagSchema,
  audience: pageAudienceSchema,
});

/** The payload `createVariant` accepts, inferred so the edition list and its hook hold one shape. */
export type CreateVariantPayload = z.infer<typeof createVariantPayloadSchema>;

/** The request `createVariant` receives: this payload inside the one mutation envelope. */
export const createVariantInputSchema = mutationInputSchema(createVariantPayloadSchema);

/** The request `createVariant` receives, typed from the envelope so it cannot be restated. */
export type CreateVariantInput = MutationInput<CreateVariantPayload>;

// ---------------------------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `saveDraft`: the working document of one edition.
 *
 * Saving a draft moves the edition's draft pointer and nothing else — a candidate under review and a
 * released edition are untouched — and the field is named `body` because that is the field the
 * service's own `saveDraft` payload declares, so this payload is accepted there unchanged.
 *
 * The body is the whole document, sections included: a Page's composition is its content, so a draft
 * save is where a new section, a moved section and a section's own fields all land. No HTML, Markdown,
 * base64 or file travels here, and no checksum or revision is stated by the client: the envelope
 * carries the revision the editor saw, and the service computes and compares what it stores.
 */
export const saveDraftPayloadSchema = z.strictObject({
  variantId: recordIdSchema,
  body: draftBodySchema,
});

/** The payload `saveDraft` accepts, inferred so the builder and its hook hold one shape. */
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>;

/** The request `saveDraft` receives: this payload inside the one mutation envelope. */
export const saveDraftInputSchema = mutationInputSchema(saveDraftPayloadSchema);

/** The request `saveDraft` receives, typed from the envelope so it cannot be restated. */
export type SaveDraftInput = MutationInput<SaveDraftPayload>;

// ---------------------------------------------------------------------------------------------
// submitForReview
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `submitForReview`: the exact revision an author submits, named by its identity.
 *
 * Naming the revision is what freezes it, so the candidate a reviewer answers is the content the author
 * read rather than whatever the draft has since become. No body travels here — a submission cannot
 * smuggle a change into the frozen revision — and no release mode does either: a Page sends no notice,
 * so the service records the submission as publish-only for this family. Submitting releases nothing.
 */
export const submitForReviewPayloadSchema = z.strictObject({
  variantId: recordIdSchema,
  revisionId: recordIdSchema,
});

/** The payload `submitForReview` accepts, inferred so the builder and its hook hold one shape. */
export type SubmitForReviewPayload = z.infer<typeof submitForReviewPayloadSchema>;

/** The request `submitForReview` receives: this payload inside the one mutation envelope. */
export const submitForReviewInputSchema = mutationInputSchema(submitForReviewPayloadSchema);

/** The request `submitForReview` receives, typed from the envelope so it cannot be restated. */
export type SubmitForReviewInput = MutationInput<SubmitForReviewPayload>;

// ---------------------------------------------------------------------------------------------
// approveCandidate
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `approveCandidate`: one frozen candidate and the release mode the approval keeps.
 *
 * The payload states no answer of its own. The mutation this schema feeds *is* the approval — a
 * request for changes is a different mutation with its own payload — so a `decision` member would
 * describe the same request twice and, being a key the service's review payload does not declare,
 * would be refused as an unknown field. `notifyMode` is the field that payload does declare, it admits
 * `publish-only` and nothing else here, and the service additionally refuses a mode that differs from
 * the submitted one rather than upgrading it: a reviewer can neither add a notice to a Page release
 * nor turn the author's publish-only submission into one.
 *
 * Approving approves no sibling: not another language edition, not another audience. Review is one step,
 * and a second round is a new submission with a new candidate.
 */
export const approveCandidatePayloadSchema = z.strictObject({
  candidateId: recordIdSchema,
  notifyMode: z.literal(
    "publish-only",
    "A Page release sends no notice, so an approval releases the edition without one.",
  ),
});

/** The payload `approveCandidate` accepts, inferred so the review panel and its hook hold one shape. */
export type ApproveCandidatePayload = z.infer<typeof approveCandidatePayloadSchema>;

/** The request `approveCandidate` receives: this payload inside the one mutation envelope. */
export const approveCandidateInputSchema = mutationInputSchema(approveCandidatePayloadSchema);

/** The request `approveCandidate` receives, typed from the envelope so it cannot be restated. */
export type ApproveCandidateInput = MutationInput<ApproveCandidatePayload>;

// ---------------------------------------------------------------------------------------------
// requestChanges
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `requestChanges`: one frozen candidate and the note asking its author for a new revision.
 *
 * The note is required, because a request for changes with nothing said leaves the author guessing, and
 * it is named `reason` — the field the service's review payload reads for the same note. It is a note on
 * the review record and nothing else: nothing here is delivered to anyone, so no recipient, channel or
 * provider appears, and no wording claims a message was sent. Asking for changes clears the submission,
 * so the author's next attempt is a new submission with a new candidate rather than a silent re-review.
 */
export const requestChangesPayloadSchema = z.strictObject({
  candidateId: recordIdSchema,
  reason: z
    .string({ error: "Say what needs changing, as a note on this candidate." })
    .trim()
    .min(1, "Say what needs changing so the author can act on it."),
});

/** The payload `requestChanges` accepts, inferred so the review panel and its hook hold one shape. */
export type RequestChangesPayload = z.infer<typeof requestChangesPayloadSchema>;

/** The request `requestChanges` receives: this payload inside the one mutation envelope. */
export const requestChangesInputSchema = mutationInputSchema(requestChangesPayloadSchema);

/** The request `requestChanges` receives, typed from the envelope so it cannot be restated. */
export type RequestChangesInput = MutationInput<RequestChangesPayload>;

// ---------------------------------------------------------------------------------------------
// publishVariants
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `publishVariants`: the page and the approved editions it releases.
 *
 * The selection names approved candidates rather than a mode or a draft, because each candidate is the
 * exact frozen revision a reviewer approved — releasing a draft's revision instead would let what was
 * approved and what readers are served differ. At least one edition is required, and no maximum is
 * stated here because the page's own editions bound the list. A repeated identity is not refused here
 * either: the service answers per edition, and a second refusal from this form would fork that contract.
 *
 * Nothing about the result is stated in the payload. Per-edition outcomes, a sibling's prior-good
 * release, a reach value, a notice and a notification ceiling are the service's answers, and a request
 * carrying such a key is refused rather than quietly ignored.
 */
export const publishVariantsPayloadSchema = z.strictObject({
  documentId: recordIdSchema,
  candidateIds: z.array(recordIdSchema).min(1, "Choose at least one language edition to release."),
});

/** The payload `publishVariants` accepts, inferred so the review form and its hook hold one shape. */
export type PublishVariantsPayload = z.infer<typeof publishVariantsPayloadSchema>;

/** The request `publishVariants` receives: this payload inside the one mutation envelope. */
export const publishVariantsInputSchema = mutationInputSchema(publishVariantsPayloadSchema);

/** The request `publishVariants` receives, typed from the envelope so it cannot be restated. */
export type PublishVariantsInput = MutationInput<PublishVariantsPayload>;

// ---------------------------------------------------------------------------------------------
// withdrawPage and withdrawLocale
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `withdrawPage`: the page whose released editions stop being served.
 *
 * Withdrawal contains what this application serves — every address answers a short notice and the
 * discovery list stops naming the page — and it works while another draft of the page is invalid,
 * because containment does not wait for editorial repair. It reaches no copy a reader already holds and
 * no message already submitted, and the tombstone it leaves carries no identifying content.
 *
 * The payload names the document and nothing else: the service's `withdrawPage` payload declares no
 * note, so a stated one would be refused as an unknown field rather than recorded.
 */
export const withdrawPagePayloadSchema = z.strictObject({
  documentId: recordIdSchema,
});

/** The payload `withdrawPage` accepts, inferred so the confirmation holds one shape. */
export type WithdrawPagePayload = z.infer<typeof withdrawPagePayloadSchema>;

/** The request `withdrawPage` receives: this payload inside the one mutation envelope. */
export const withdrawPageInputSchema = mutationInputSchema(withdrawPagePayloadSchema);

/** The request `withdrawPage` receives, typed from the envelope so it cannot be restated. */
export type WithdrawPageInput = MutationInput<WithdrawPagePayload>;

/**
 * Feeds `withdrawLocale`: exactly one language edition, leaving its siblings released.
 *
 * The edition is named by its identity alone — the address a reader was given, the release head and the
 * language are one edition — so this payload cannot mean the wider withdrawal, and withdrawing one
 * language cannot end another. It recalls no copy a reader already holds and no message already
 * submitted.
 */
export const withdrawLocalePayloadSchema = z.strictObject({
  variantId: recordIdSchema,
});

/** The payload `withdrawLocale` accepts, inferred so the confirmation holds one shape. */
export type WithdrawLocalePayload = z.infer<typeof withdrawLocalePayloadSchema>;

/** The request `withdrawLocale` receives: this payload inside the one mutation envelope. */
export const withdrawLocaleInputSchema = mutationInputSchema(withdrawLocalePayloadSchema);

/** The request `withdrawLocale` receives, typed from the envelope so it cannot be restated. */
export type WithdrawLocaleInput = MutationInput<WithdrawLocalePayload>;
