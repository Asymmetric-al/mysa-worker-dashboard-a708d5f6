/**
 * The Ministry Updates family's draft-side payload schemas — `createVariant`, `saveDraft` and
 * `submitForReview` — together with the five primitives the rest of this schema folder imports.
 *
 * One schema per named mutation, and nothing shared between them beyond those primitives. A body can
 * therefore only ever mean one thing: there is no generic field bag, no create-or-update form and no
 * universal command shape, which is the dispatcher this application deliberately does not have.
 *
 * A schema here validates the **payload alone**. The four-field mutation input — operation identity,
 * selected context, expected revision and the payload — belongs to the transport and is composed once
 * in `../hooks/use-update-mutations.ts`, so no schema below declares an operation id, a scope, an
 * expected revision or a revision alias, and none reads a clock or compares a revision.
 *
 * These schemas are the client's mirror, never the authority. The service re-validates every payload
 * with its own per-mutation schema and answers with the closed outcome set — `invalid` with per-field
 * messages, `conflict` when the revision the caller saw is stale, `denied` when the scope refuses —
 * and `@/components/form-field.tsx` renders whatever it answers. A schema here only spares the worker
 * a round trip for a mistake the form can already see.
 *
 * Shape is reused rather than restated. A draft body is validated by the one content profile through
 * `parseDocument()`, so this file never re-declares a ProseMirror or Tiptap schema and never imports
 * Tiptap; whether a variant key is permitted is asked of `variantKeyAllowed()`, so the family's
 * audience rule has one implementation. The two axes below are declared as total maps over the content
 * modules' own unions, so an audience or rendition purpose added to a domain model fails this file's
 * compilation instead of quietly going unselectable.
 *
 * The three states this file keeps apart (AAP 0.8.5, 0.8.6): a **draft** is a working revision whose
 * save moves only the draft pointer, a **candidate** freezes the exact revision the author submits, and
 * a **release** is a separate record that only publication creates. `submitForReviewSchema` therefore
 * carries the revision identity and nothing else — no body, no checksum re-entry — so the frozen
 * candidate is the revision the author actually read.
 *
 * What is deliberately absent: no scheduling, provider, delivery, translation or merge field; no clock
 * read of any kind; no React, hook or component; no synthetic store; no module belonging to another
 * feature; and no server-only renderer.
 */
import { z } from "zod";

import { parseDocument } from "@/modules/content/document";
import {
  variantKeyAllowed,
  type ContentVariant,
  type VariantAudience,
  type VariantFamily,
} from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";

import { VARIANT_AXIS_NOTE } from "../copy/updates-copy";

// ---------------------------------------------------------------------------------------------
// Shared primitives: one identifier shape, one family, one audience axis, one locale, one placement
// ---------------------------------------------------------------------------------------------

/**
 * The content family every payload in this file submits for.
 *
 * An Update is a ministry post; a Worker Page and a Project Page are guided public pages with their
 * own section catalogues, so their payloads live in `features/ministry-pages`. Tying the constant to
 * the variant module's family union means the family name cannot drift out of the domain model.
 */
export const UPDATE_FAMILY = "update" as const satisfies VariantFamily;

/**
 * The one identifier shape for every record reference this family sends: `createVariant`'s document,
 * `saveDraft`'s variant, `submitForReview`'s variant and revision, and a placement's asset.
 *
 * An identifier is **opaque**. It is carried, never parsed, never interpreted, and never compared with
 * a name, an email address or a numeric fragment of another system's id — equal-looking identifiers
 * establish neither identity nor authority (AAP 0.7.1). Only the length is bounded, so a pasted
 * address or a stray paragraph is refused while any identity the application mints is accepted.
 */
export const contentIdSchema = z
  .string({ error: "This action applies to one record, so open the record again and retry." })
  .trim()
  .min(1, "This action applies to one record, so open the record again and retry.")
  .max(
    128,
    "That reference is too long to be one record identity, so open the record from its list rather " +
      "than pasting an address.",
  );

/**
 * The audience axis an Update variant may serve, declared as a total map over the content variant
 * module's own audience union.
 *
 * The map is the compile-time parity check: if `ContentVariant["audience"]` gains or loses a member,
 * this literal stops satisfying `Record<…, VariantAudience>` and the build fails here instead of a new
 * audience silently becoming unselectable. Which audience a family actually permits is not decided
 * here — `variantKeyAllowed()` answers that, and it is the single source of the rule.
 */
const AUDIENCE_AXIS = {
  public: "public",
  "approved-supporter": "approved-supporter",
} as const satisfies Readonly<Record<ContentVariant["audience"], VariantAudience>>;

/**
 * The audience one variant serves: public, or approved supporters.
 *
 * The two are separate editions rather than two languages of one notice — each keeps its own draft,
 * candidate and release — and the family rule that no audience-by-locale cross-product exists is
 * enforced by {@link createVariantSchema} through the variant module's own predicate.
 */
export const audienceSchema = z.enum(Object.values(AUDIENCE_AXIS), {
  error: "Choose the audience this edition serves: public or approved supporters.",
});

/**
 * A content-locale tag: the exact language an edition is written in, such as `en`, `fr` or `ar-EG`.
 *
 * This is a **content** locale, never the interface language, and it deliberately carries no direction:
 * direction is read from the content locale the read envelope supplies, because it is a property of
 * the content and never an inference from a language's name. The shape is checked permissively — a
 * language subtag followed by hyphen-separated subtags — so a tag the interface has no display name
 * for is still a valid edition rather than being coerced to a known one.
 */
export const localeTagSchema = z
  .string({ error: "State the content locale this edition is written in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/,
    "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated " +
      "subtags.",
  );

/**
 * The rendition purposes a draft placement may name, declared as a total map over the media module's
 * own purpose union so a purpose added there fails this file's compilation rather than becoming
 * unplaceable.
 *
 * There is deliberately no `original` entry: the uploaded bytes are never a rendition and have no
 * serving path, so a draft cannot reference them.
 */
const PLACEABLE_RENDITION_PURPOSES = {
  display: "display",
  playback: "playback",
  poster: "poster",
  captions: "captions",
  transcript: "transcript",
} as const satisfies Readonly<Record<MediaRenditionPurpose, MediaRenditionPurpose>>;

/**
 * A draft's reference to one already-registered media asset, for one rendition purpose.
 *
 * It names only what already exists: an opaque asset identity and the purpose the placement uses. No
 * bytes, filename, MIME type or URL travels here — the bytes were validated and re-encoded by
 * `registerMediaAsset` before this reference could exist, and every read of the rendition re-authorises
 * on its own, so a placement is never a route around an asset's scope.
 */
export const mediaPlacementRefSchema = z.strictObject({
  assetId: contentIdSchema,
  purpose: z.enum(Object.values(PLACEABLE_RENDITION_PURPOSES), {
    error:
      "Choose the rendition this placement uses: display, playback, poster, captions or transcript.",
  }),
});

// ---------------------------------------------------------------------------------------------
// The three mutation payloads
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `createVariant`: one document, one permitted audience, one exact content locale.
 *
 * The document identity is the only context the form holds. A variant's own identity, and whether its
 * key is still free among the document's other editions, are the service's questions — it mints the id
 * and answers `conflict` when the key is taken — so nothing here names a variant.
 *
 * The family rule is applied before a request is made: a pairing the variant model does not admit is
 * refused here with the family's own sentence, so the form cannot propose an audience-by-locale
 * cross-product. For the Updates family the model currently admits both audiences in any locale, so
 * this guard passes in ordinary use and exists so that a change to the family rule is enforced in the
 * form the moment it lands, rather than after a refused round trip.
 */
export const createVariantSchema = z
  .strictObject({
    documentId: contentIdSchema,
    audience: audienceSchema,
    locale: localeTagSchema,
  })
  .superRefine((payload, ctx) => {
    if (!variantKeyAllowed(UPDATE_FAMILY, payload.audience)) {
      ctx.addIssue({ code: "custom", path: ["audience"], message: VARIANT_AXIS_NOTE });
    }
  });

/**
 * Where a content-profile issue sits inside this payload.
 *
 * `parseDocument()` reports a dot-joined path from the document root — `sections.2.presentation.imageFit`
 * — and reports no path at all when the document as a whole cannot be read. A form addresses the
 * payload, so every issue is rooted at the `body` field it belongs to: the document's own segments
 * follow as path segments, a numeric segment stays an array index, and a problem with the whole
 * document becomes an issue on `body` itself rather than a pathless message no field can display.
 */
function bodyFieldPath(documentPath: string): (string | number)[] {
  const segments: (string | number)[] = ["body"];
  for (const segment of documentPath.split(".")) {
    if (segment.length === 0) {
      continue;
    }
    segments.push(/^\d+$/.test(segment) ? Number(segment) : segment);
  }
  return segments;
}

/**
 * Feeds `saveDraft`: the working revision of one variant, which moves the draft pointer and nothing
 * else — no candidate and no release changes because a draft was saved.
 *
 * `body` is accepted as `unknown` and validated only by the content profile, so the document schema has
 * one implementation rather than a second, weaker copy here, and every issue it reports becomes a
 * field issue this form can show. `body` is required, which the Zod type cannot express because an
 * unknown field admits `undefined`, so its presence is checked in the same refinement.
 *
 * `contentChecksum` is carried, never recomputed: the editor holds the checksum of what it saved and
 * the service compares it with the stored revision, which is how an unchanged save answers
 * `unchanged`. `mediaPlacements` reference assets that already exist; a purpose an asset does not serve
 * is the service's refusal, not a rule this form can decide.
 */
export const saveDraftSchema = z
  .strictObject({
    variantId: contentIdSchema,
    body: z.unknown(),
    contentChecksum: z
      .string({ error: "A checksum is either left out or stated as the value the editor holds." })
      .trim()
      .min(1, "A checksum is either left out or stated as the value the editor holds.")
      .max(
        64,
        "That checksum is longer than any this application produces, so save the draft from the " +
          "editor again rather than pasting one.",
      )
      .optional(),
    mediaPlacements: z.array(mediaPlacementRefSchema).optional(),
  })
  .superRefine((payload, ctx) => {
    if (!Object.hasOwn(payload, "body") || payload.body === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message:
          "A saved draft carries the document body, so save it from the editor rather than here.",
      });
      return;
    }
    const parsed = parseDocument(payload.body);
    if (parsed.status === "valid") {
      return;
    }
    for (const issue of parsed.issues) {
      ctx.addIssue({ code: "custom", path: bodyFieldPath(issue.path), message: issue.message });
    }
  });

/**
 * Feeds `submitForReview`: the exact revision the author saw, submitted as the candidate to freeze.
 *
 * Nothing else travels, deliberately. A candidate freezes a revision, so re-sending the body would let
 * what the reviewer reads differ from the text the author submitted, and re-entering a checksum would
 * invite this form to vouch for content it did not validate. A revision that has moved on since the
 * author read it is the service's `conflict`, answered against the revision stated here, with the
 * author's input preserved for comparison.
 */
export const submitForReviewSchema = z.strictObject({
  variantId: contentIdSchema,
  revisionId: contentIdSchema,
});

// ---------------------------------------------------------------------------------------------
// Payload types: inferred from the schemas, never written beside them
// ---------------------------------------------------------------------------------------------

/** The payload `createVariant` accepts, inferred so a form and its hook cannot hold a second shape. */
export type CreateVariantPayload = z.infer<typeof createVariantSchema>;

/** The payload `saveDraft` accepts, inferred so the editor and its hook read one shape. */
export type SaveDraftPayload = z.infer<typeof saveDraftSchema>;

/** The payload `submitForReview` accepts, inferred so the review step cannot restate it. */
export type SubmitForReviewPayload = z.infer<typeof submitForReviewSchema>;
