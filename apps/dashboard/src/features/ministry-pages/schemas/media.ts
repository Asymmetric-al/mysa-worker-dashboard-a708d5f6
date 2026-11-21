/**
 * The Worker and Project Pages family's media payload schemas: `registerMediaAsset`,
 * `replacePlacement` and `removePlacement`, together with the placement descriptor all three read.
 *
 * One schema per named mutation, each naming its own field set, so a body posted to `/api/media` can
 * only ever mean one thing: registering prepared bytes as an asset, replacing what one placement
 * shows and removing a placement are three decisions with three different risks. There is no
 * create-or-update form, no field bag and no dispatcher.
 *
 * **These schemas are the browser's copy of the service's own.** Every payload schema below is
 * annotated with the type the service infers from its own schema — `RegisterMediaAssetPayload` for a
 * registration, `PlacementTargetPayload` for a replacement or a removal — and those types are imported
 * with `import type`, which the compiler erases, so no mutation body, store or `node:fs` reaches this
 * client-loaded module. A key this file drops, adds or mistypes fails the typecheck instead of coming
 * back `invalid` at runtime, and the bounds below are the service's own numbers, repeated with the
 * source named, rather than limits invented here.
 *
 * **Registration carries the bytes; the service prepares them.** `source.bytesBase64` is the chosen
 * file as base64 — the one member of this family that is not a reference — and the service types it by
 * its content, checks it against the image or video profile, re-encodes or re-muxes it, strips its
 * metadata and keeps the original only in private custody. Nothing here states a container, a
 * dimension, a duration or a byte count: those are decided from the bytes and reported against the
 * file, and a copied profile would be a second place for it to be wrong.
 *
 * **Alternative text is required for an image; a caption track and a poster belong to a video.** The
 * service's own refinement refuses an image with no alternative text (given at the top level or in
 * `placement.altText`), an image carrying a caption track, and a poster on anything but a video; the
 * copy below repeats those three rules in the service's wording. Alternative text is what a
 * screen-reader user is told instead of the picture and what a failed video keeps as its text
 * alternative (AAP 0.8.6); every other word about the media is optional.
 *
 * **A placement names a draft.** `replacePlacement` and `removePlacement` address one placement inside
 * one draft, so both name the draft revision or the variant holding it and both refuse a payload that
 * names neither — the service validates the two with a single `placementTargetPayloadSchema` and
 * refuses the same way. `assetId` is optional there because a replacement may restate only the
 * description of the asset already placed, and a removal states none because it removes a reference:
 * neither mutation withdraws a release that already served the media, nor recalls a copy a recipient
 * already has.
 *
 * **Nothing here decides admissibility.** Whether the section admits this kind of media, whether the
 * draft revision is the one the caller saw, whether the asset is readable in this scope and what
 * preparation produced are the service's and the media module's questions. These schemas answer for
 * shape alone, so the closed outcome set — `accepted`, `alreadyAccepted`, `unchanged`, `conflict`,
 * `denied`, `invalid`, `unavailable`, `unknown` — stays the only account of what happened.
 *
 * **Removing a placement is not a withdrawal.** Removing or replacing changes the current draft
 * revision; a release that already served the media keeps serving it, so no payload says `withdraw`,
 * `reach`, `releaseId` or "offer to notify". No payload carries an amount either: a giving placement
 * names an approved designation on the page record, and no schema of this family states money.
 *
 * Plan items: AAP 0.6.3 (`POST /api/media`, `GET /api/media/[assetId]/[rendition]`), 0.6.1 "Mutations:
 * content and media", 0.6.2's media asset and rendition record, 0.7.1's job row "Attach media", 0.8.6's
 * image and video rules, 0.9.1 and 0.11.1 for this family's feature folder, and criteria 12 and 18.
 * Evidence: the page builder's image and video sections, and the video journey's assertion that a
 * protected placement, poster, caption track and transcript each re-authorise on their own request.
 */

import { z } from "zod";

// The `@/modules/data-service` barrel re-exports this same function, but it also pulls the named
// reads, which reach `node:fs`; the picker's client form imports this file, so the export is taken
// from the module that declares it.
import { mutationInputSchema, type MutationInput } from "@/modules/data-service/envelope";
// The annotation types are imported with `import type`, which the compiler erases: they hold the
// payload schemas below to the service's own types without pulling the mutation bodies, the store or
// `node:fs` into a client bundle.
import type {
  PlacementTargetPayload as ServicePlacementTargetPayload,
  RegisterMediaAssetPayload as ServiceRegisterMediaAssetPayload,
} from "@/modules/data-service/mutations/content";

// ---------------------------------------------------------------------------------------------
// Opaque references: an identifier names a record, never a file or a link
// ---------------------------------------------------------------------------------------------

/** The origins an opaque reference may not carry: each one names an address or an inlined payload. */
const ORIGIN_PREFIXES = ["data:", "blob:", "http:", "https:"] as const;

/** The refusal for an asset reference that arrived as a file path or a link. */
const ASSET_REFERENCE_MESSAGE = "Use the prepared asset, not a file path or a link.";

/** The refusal for a record identity that arrived as a file path or a link. */
const RECORD_REFERENCE_MESSAGE = "Use the record's own identity, not a file path or a link.";

/**
 * Reports whether a value carries something an opaque reference cannot: an origin prefix, a path
 * separator or a parent segment.
 *
 * Case is folded for the prefixes only, because `DATA:` and `https:` name the same scheme, while a
 * record identity is compared exactly as the service minted it.
 */
function carriesAddress(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    ORIGIN_PREFIXES.some((prefix) => lowered.startsWith(prefix)) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..")
  );
}

/**
 * One opaque reference: a non-empty string naming something the service already holds.
 *
 * A value carrying an address or a path is refused on the field that carried it — never beside the
 * payload and never repaired, because a silently cleaned identifier would be a different reference
 * that still looked accepted. The rule is safe for renditions because a rendition reference is the
 * asset identity, a colon and the purpose it serves, so it holds no path separator of its own.
 */
function opaqueReference(message: string) {
  return z
    .string({ error: message })
    .trim()
    .min(1, message)
    .superRefine((value, ctx) => {
      if (!carriesAddress(value)) return;
      ctx.addIssue({ code: "custom", message });
    });
}

// ---------------------------------------------------------------------------------------------
// The two kinds one registration names
// ---------------------------------------------------------------------------------------------

/**
 * The kinds a registration states.
 *
 * Declared here rather than imported because the module that owns the media profiles also owns the
 * native decoders, and reaching it would pull them into a client form. This is a vocabulary of two
 * words, not a profile: which containers, dimensions and durations are admitted is decided from the
 * bytes by that module, and the service reports a mismatch against the file.
 */
const KINDS = ["image", "video"] as const;

// ---------------------------------------------------------------------------------------------
// The service's own bounds and vocabularies, repeated here because it declares them privately
// ---------------------------------------------------------------------------------------------

/**
 * The longest free text one placement field may carry, in characters.
 *
 * The service bounds every placement text with its own `PLACEMENT_TEXT_MAX_CHARS` and does not export
 * it, so the number is repeated from `@/modules/data-service/mutations/content`: the same bound,
 * stated once here for the alternative text and the optional fields alike, so the picker cannot offer
 * a sentence the service will refuse.
 */
const PLACEMENT_TEXT_MAX_CHARS = 4_000;

/** The longest uploaded filename the service inspects, in characters — its own `255` bound. */
const UPLOAD_NAME_MAX_CHARS = 255;

/** The longest caption-track label the service admits, in characters — its own `120` bound. */
const CAPTION_LABEL_MAX_CHARS = 120;

/**
 * One content-locale tag, as the service validates it: a language subtag followed by hyphen-separated
 * subtags, at most 35 characters long.
 *
 * Repeated from the service for the same reason as the bounds above. A content locale is the language
 * the words are in, never the interface language, and no direction is stated here: direction travels
 * with the content locale the read envelope supplies.
 */
const localeTagSchema = z
  .string({ error: "State the content locale this media is in." })
  .trim()
  .min(2, "Use a content-locale tag such as en, fr or ar-EG.")
  .max(35, "Use a content-locale tag of at most 35 characters, such as ar-EG.")
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u,
    "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.",
  );

/**
 * One optional descriptive field: trimmed, bounded, and absent when it was not supplied.
 *
 * There is no minimum, because the service trims a blank caption or credit rather than refusing it,
 * and a browser that refused one would reject a body the service accepts.
 */
const optionalPlacementTextSchema = z
  .string({ error: "State this as text, or leave it out." })
  .trim()
  .max(
    PLACEMENT_TEXT_MAX_CHARS,
    `A placement field holds at most ${PLACEMENT_TEXT_MAX_CHARS} characters, so shorten it.`,
  )
  .optional();

/** One optional alternative text: trimmed, non-empty when stated, bounded as the service bounds it. */
const optionalAltTextSchema = z
  .string({ error: "Describe what this image or video shows." })
  .trim()
  .min(1, "Describe what this image or video shows.")
  .max(PLACEMENT_TEXT_MAX_CHARS, "Shorten the alternative text for this placement.")
  .optional();

// ---------------------------------------------------------------------------------------------
// The placement descriptor: what a reader is told about the media
// ---------------------------------------------------------------------------------------------

/**
 * What one placement says about the media it shows, as both placement mutations state it.
 *
 * This is the service's placement descriptor with every member optional, which is exactly what its
 * `placementTargetPayloadSchema` validates: alternative text, a caption and a credit. Alternative
 * text is what a screen-reader user is told instead of the picture, and a replacement restates it
 * rather than inheriting the description it replaces.
 *
 * The descriptor holds no locale, no transcript text and no poster reference: a caption track's
 * language travels with the track, a transcript is its own rendition and a poster is an asset of its
 * own — each registered rather than named here.
 *
 * The object is closed. A key this descriptor does not name — a filename, a media type, a size, a
 * measurement, a scan verdict, an address — is refused rather than dropped, so nothing a picker knows
 * about the chosen file can be persisted through a placement, and an original's name cannot reach a
 * reader by sitting in a key nobody validated.
 */
export const placementSchema = z.strictObject({
  altText: optionalAltTextSchema,
  caption: optionalPlacementTextSchema,
  credit: optionalPlacementTextSchema,
});

// ---------------------------------------------------------------------------------------------
// registerMediaAsset
// ---------------------------------------------------------------------------------------------

/**
 * One upload's bytes, and the name the pipeline may inspect but never store.
 *
 * `bytesBase64` is the chosen file as base64: the browser reads the file and posts it, and the service
 * types it by its magic bytes, never by `name`. The name is optional and bounded because no consumer
 * ever sees it — preparation stores the asset under an identity it mints — so a filename is at most a
 * diagnostic for the person who chose the file.
 */
const uploadBytesSchema = z.strictObject({
  bytesBase64: z
    .string({ error: "Choose a file to upload." })
    .min(1, "Choose a file to upload."),
  name: z
    .string({ error: "State the file's name as text, or leave it out." })
    .min(1, "State the file's name as text, or leave it out.")
    .max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`)
    .optional(),
});

/**
 * Feeds `registerMediaAsset`: one file to prepare, the kind the caller says it is, and the description
 * its placement will carry.
 *
 * The bytes travel here and the service decides everything else from them: the container, the codec,
 * the dimensions, the duration, the re-encode and the metadata strip are the media module's answers,
 * and a refusal is `invalid` with the pipeline's own reason. `kind` is the caller's statement, checked
 * against the bytes rather than trusted, and it is what the refinements below read.
 *
 * The description may be given at the top level or inside `placement`: the service takes the
 * top-level value first and falls back to the placement's, which is why alternative text satisfies
 * the requirement from either place. A poster and a caption track travel with the video they belong
 * to and are prepared as their own renditions; a transcript is text, not a track.
 */
export const registerMediaAssetPayloadSchema: z.ZodType<ServiceRegisterMediaAssetPayload> = z
  .strictObject({
    kind: z.enum(KINDS, { error: "Choose whether this file is an image or a video." }),
    source: uploadBytesSchema,
    altText: optionalAltTextSchema,
    caption: optionalPlacementTextSchema,
    credit: optionalPlacementTextSchema,
    language: localeTagSchema.optional(),
    placement: placementSchema
      .extend({ language: localeTagSchema.optional() })
      .optional(),
    poster: z
      .strictObject({
        bytesBase64: z
          .string({ error: "Choose a poster image for this video." })
          .min(1, "Choose a poster image for this video."),
        name: z
          .string({ error: "State the file's name as text, or leave it out." })
          .min(1, "State the file's name as text, or leave it out.")
          .max(UPLOAD_NAME_MAX_CHARS, `A file name holds at most ${UPLOAD_NAME_MAX_CHARS} characters.`)
          .optional(),
        altText: optionalAltTextSchema,
      })
      .optional(),
    captions: z
      .strictObject({
        vtt: z
          .string({ error: "Choose a WebVTT caption file." })
          .min(1, "Choose a WebVTT caption file."),
        language: localeTagSchema,
        label: z
          .string({ error: "State the track's label as text, or leave it out." })
          .trim()
          .min(1, "State the track's label as text, or leave it out.")
          .max(
            CAPTION_LABEL_MAX_CHARS,
            `A track label holds at most ${CAPTION_LABEL_MAX_CHARS} characters.`,
          )
          .optional(),
      })
      .optional(),
    transcript: z
      .strictObject({
        text: z
          .string({ error: "State the transcript, or leave it out." })
          .min(1, "State the transcript, or leave it out."),
      })
      .optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.kind === "image" && (payload.altText ?? payload.placement?.altText) === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["altText"],
        message:
          "An image needs alternative text describing what it shows before it can be placed, so describe it and choose the file again.",
      });
    }
    if (payload.kind === "image" && payload.captions !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["captions"],
        message: "A caption track belongs to a video, so an image carries none.",
      });
    }
    if (payload.poster !== undefined && payload.kind !== "video") {
      ctx.addIssue({
        code: "custom",
        path: ["poster"],
        message: "A poster belongs to a video, so an image carries none.",
      });
    }
  });

/**
 * The whole request `registerMediaAsset` receives: the registration payload with the operation
 * identity, the selected context and the revision the caller saw.
 */
export const registerMediaAssetInputSchema = mutationInputSchema(registerMediaAssetPayloadSchema);

/** The descriptor one media placement carries, inferred so the builder and the picker read one shape. */
export type Placement = z.infer<typeof placementSchema>;

/** The payload `registerMediaAsset` accepts, inferred so its form and its transport cannot drift apart. */
export type RegisterMediaAssetPayload = z.infer<typeof registerMediaAssetPayloadSchema>;

/** The input `registerMediaAsset` accepts, so no caller assembles the envelope by hand. */
export type RegisterMediaAssetInput = MutationInput<RegisterMediaAssetPayload>;

// ---------------------------------------------------------------------------------------------
// The draft target both placement mutations name
// ---------------------------------------------------------------------------------------------

/**
 * The two identities of one draft: its revision, or the variant that holds it.
 *
 * Both are opaque references the builder already holds, and the service accepts either, resolving a
 * variant to the draft revision it currently holds. Naming both is allowed and the revision wins;
 * naming neither is refused below, because a placement edit that named no draft could not say which
 * draft it changed.
 */
const draftTargetFields = {
  draftRevisionId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional(),
  variantId: opaqueReference(RECORD_REFERENCE_MESSAGE).optional(),
} as const;

/** The refusal a placement payload answers when it names no draft, in the service's own words. */
const NO_DRAFT_TARGET_MESSAGE =
  "Open the page's draft first: a section change names the draft revision it edits.";

/** Refuses a placement payload that names neither a draft revision nor the variant holding one. */
function refuseMissingDraftTarget(
  payload: { readonly draftRevisionId?: string; readonly variantId?: string },
  ctx: z.RefinementCtx,
): void {
  if (payload.draftRevisionId !== undefined || payload.variantId !== undefined) return;
  ctx.addIssue({ code: "custom", path: ["draftRevisionId"], message: NO_DRAFT_TARGET_MESSAGE });
}

/**
 * The one payload shape `replacePlacement` and `removePlacement` accept: the service's own
 * `placementTargetPayloadSchema` — the draft, the placement, and the optional asset and description.
 *
 * `assetId` is optional because a replacement may restate only the description of the asset already
 * placed, and the service reads its absence as exactly that rather than as an error; a removal states
 * none because it removes a reference. Both references are opaque, so a replacement or a removal can
 * never name an original, a path or a link, and the service re-authorises the asset in this scope
 * before the draft changes.
 */
const placementTargetPayloadSchema: z.ZodType<ServicePlacementTargetPayload> = z
  .strictObject({
    ...draftTargetFields,
    placementId: opaqueReference(RECORD_REFERENCE_MESSAGE),
    assetId: opaqueReference(ASSET_REFERENCE_MESSAGE).optional(),
    placement: placementSchema.optional(),
  })
  .superRefine(refuseMissingDraftTarget);

// ---------------------------------------------------------------------------------------------
// replacePlacement
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `replacePlacement`: one draft, one existing placement, the prepared asset that now fills it,
 * and the description that placement states from now on.
 *
 * The placement keeps its identity while the asset behind it changes, which is why the description is
 * stated again rather than inherited: a replacement is a fresh decision about what a reader is told,
 * and swapping a file whose description no longer matches it is exactly the mistake this shape
 * prevents. A payload naming no draft is refused, because the replacement would have no draft to
 * change.
 */
export const replacePlacementPayloadSchema = placementTargetPayloadSchema;

/**
 * The whole request `replacePlacement` receives: the replacement with its operation identity, context
 * and expected revision.
 */
export const replacePlacementInputSchema = mutationInputSchema(replacePlacementPayloadSchema);

/** The payload `replacePlacement` accepts, inferred so a replacement cannot restate a bare file. */
export type ReplacePlacementPayload = z.infer<typeof replacePlacementPayloadSchema>;

/** The input `replacePlacement` accepts, so every replacement is one identifiable attempt. */
export type ReplacePlacementInput = MutationInput<ReplacePlacementPayload>;

// ---------------------------------------------------------------------------------------------
// removePlacement
// ---------------------------------------------------------------------------------------------

/**
 * Feeds `removePlacement`: one draft and one existing placement, and nothing a removal cannot mean.
 *
 * Removing a placement removes a reference. The prepared asset stays available to every other
 * placement that uses it, a release that already served the media keeps serving it, and a copy a
 * recipient already received is not recalled by a draft change — so this payload carries no
 * withdrawal, no reach, no release identity and no "notify" choice.
 *
 * The shape is the one `replacePlacement` states, because the service validates both mutations with a
 * single schema: `assetId` and the description are members a removal does not read, and the service
 * ignores them rather than refusing them, so they are admitted here for the same reason. What a
 * removal must name is the draft and the placement, and the schema refuses a payload missing either.
 */
export const removePlacementPayloadSchema = placementTargetPayloadSchema;

/** The whole request `removePlacement` receives: the placement and its four-field envelope. */
export const removePlacementInputSchema = mutationInputSchema(removePlacementPayloadSchema);

/** The payload `removePlacement` accepts, inferred so a removal carries nothing a removal cannot mean. */
export type RemovePlacementPayload = z.infer<typeof removePlacementPayloadSchema>;

/** The input `removePlacement` accepts, so a removal is recoverable by its operation identity. */
export type RemovePlacementInput = MutationInput<RemovePlacementPayload>;
