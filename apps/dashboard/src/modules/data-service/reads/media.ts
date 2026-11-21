/**
 * Scoped rendition serving: the one read of the data service's "Attach media" job.
 *
 * `readMediaAsset()` answers one request for one rendition of one asset — a display still, a playback
 * stream, a poster, a caption track or a transcript — by re-deriving the caller's authority on every
 * call, handing the serving decision to `@/modules/media/serve`'s `assertReadable()`, and answering
 * with either the wire facts of a response that may be sent or one of the two refusals a read can
 * make. It backs `GET /api/media/[assetId]/[rendition]`, which is the only address a rendition has.
 *
 * The invariants this read holds for its caller:
 *
 * - **Authorisation precedes enumeration.** The session is resolved first, the asset is looked up
 *   second, and the asset's own recorded scope is asserted third through the one scope resolver.
 *   A caller that may not read the asset receives the same refusal whether the asset exists, belongs
 *   to another ministry, was never prepared or names a purpose this application does not serve: no
 *   count, no title, no size, no media type and no existence flag. That is what stops a caption,
 *   poster or transcript address from answering "does this exist, and may someone else see it?".
 * - **Every retained request re-authorises.** Playback, poster, captions, transcript and every byte
 *   range are one decision made afresh, so a restricted asset stops being served on the very next
 *   read. Nothing here is remembered: there is no cached decision, no token, no signed address and no
 *   map of bytes, which is also why a copied URL grants nothing it did not already grant.
 * - **Renditions only; the original is private.** The asset's `sourceOriginalRef` names the uploaded
 *   original and is never served by this read — only `renditions[]` are, each by its own purpose — so
 *   no original sits behind a permanent public address and no upload has a serving path at all.
 *   Nothing identifying is echoed either: no file name, no title, no scope identifier and no byte size
 *   of an asset the caller may not have.
 * - **A refusal promises no recall.** Restriction stops application playback and rejects subsequent
 *   reads; it says nothing about a copy a reader already holds, so no wording here claims a purge.
 * - **Honest states stay distinct.** An asset whose bytes cannot be read right now is `unavailable`
 *   with the source that failed, and an asset with no prepared rendition for the requested purpose is
 *   `unavailable` too — never an empty success and never a placeholder image. Only the caller's
 *   relationship to the request takes the one refusal: an absent asset, another scope's asset, a
 *   purpose this asset cannot serve and a rendition that may no longer be served.
 * - **Serving proves only that these bytes were sent.** It is not evidence that anything was released,
 *   delivered or read, and no surface may present it as any of those.
 *
 * The documented exception to the read envelope. Every other read in this folder answers with a
 * scoped envelope, and this one deliberately does not: a byte stream carries no per-field states, no
 * period statement and no available actions, so the read answers with {@link MediaRenditionResponse} —
 * the authorised bytes and the wire facts that go with them — and its two failure modes travel as the
 * ordinary `denied` and `unavailable` outcomes. `outcome.ts` names this exception in its own header,
 * and the type below states it again where a reader will look for an envelope and not find one.
 *
 * Where the bytes come from. A rendition's bytes are named by its record's `bytesRef`, and the media
 * module's serving decision requires the bytes to *arrive* with the rendition ("bytes stay the
 * caller's"), so resolving that reference is this read's job and nobody else's: the store publishes
 * JSON documents only, and no module in `@/modules/media` opens a file. The resolution is deliberately
 * narrow — one plain read under one of two contained roots, refusing anything that could name a path
 * outside them — and a reference that cannot be honoured is an `unavailable` source, never a
 * zero-length body. Preparation itself is local processing and is labelled as such by the surface that
 * triggers it; nothing here scans, transcodes or claims to.
 *
 * Scope: AAP 0.6.1 (`readMediaAsset`), 0.6.3 (`GET /api/media/[assetId]/[rendition]`), 0.7.1's job row
 * "Attach media", 0.7.2 (opaque rendition identities, re-authorised per request including byte ranges),
 * 0.8.6 (every retained media request rechecks current scope; the private original; the six media
 * states) and 0.3.2 (renderer-level scope enforcement). Evidence: success criteria 18 and 19.
 *
 * Layering: a data-service read. It imports the one session resolver and permission question, the
 * shared outcome and record contracts, the store's single read function, the development scenario
 * registry that owns the "media unavailable" world, the media module's serving decision, and the
 * framework-free helpers. It imports no component, no feature, no route, no provider package, and it
 * writes no document: this read changes nothing.
 */
// A rendition's bytes must arrive with the rendition: the media module's serving decision receives them
// from its caller, the store publishes JSON documents only, and no module in `@/modules/media` opens a
// file. Resolving the record's reference is therefore this read's one piece of custody, kept to a single
// contained read under the two roots below, so a later media-custody owner replaces one seam.
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { isNonEmptyString } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import type { MediaOriginalReference, MediaRendition } from "@/modules/media/asset";
import {
  assertReadable,
  sliceRenditionBytes,
  type ByteRange,
  type MediaServingState,
} from "@/modules/media/serve";
import { DATA_ROOT } from "@/modules/store/paths";
import { readSession } from "@/modules/store/repository";

import { canView, resolveSession } from "../authorize";
import {
  mediaAssetRecordSchema,
  type MediaAssetKind,
  type MediaAssetRecord,
  type MediaAssetRenditionPurpose,
  type MediaAssetRenditionRecord,
} from "../envelope";
import {
  denied,
  LOCAL_STORE_SYSTEM,
  unavailable,
  type DenialReason,
  type ReadResult,
} from "../outcome";

// ---------------------------------------------------------------------------------------------
// What this read answers with
//
// The one place in `data-service/reads` that is not a read envelope, and the reason is in the type.
// ---------------------------------------------------------------------------------------------

/**
 * One authorised rendition response: the bytes this read authorises sending, and the facts that must
 * be sent with them.
 *
 * This type is the documented exception to the envelope contract, and it is deliberately not an
 * envelope in disguise. A per-field state map, a period statement, an available-actions list and a
 * revision all answer questions about numbers and collections; a rendition is bytes, and the only
 * facts a caller needs about them are the media type, the length, the window and the status.
 * Attaching an empty set of those envelope members "for consistency" would be the half-wrapped
 * exception the plan names as a defect, so the two failure modes travel as `denied` and `unavailable`
 * and nothing else is bolted on.
 *
 * `status` and `headers` are carried rather than derived by the route layer because the serving
 * decision owns them: the media module states the one cache policy this application sets and the
 * `content-range` of a partial response, and a route handler that recomputed either would be a second
 * statement of the same policy, free to drift into a cacheable refusal.
 */
export interface MediaRenditionResponse {
  /** The kind of asset the rendition belongs to, as its content established it — never a file name. */
  readonly kind: MediaAssetKind;
  /** Opaque identity of the rendition being sent. Never a header: it is not a cache key. */
  readonly renditionId: string;
  /** The purpose these bytes were prepared for, taken from the rendition itself. */
  readonly purpose: MediaAssetRenditionPurpose;
  /** The media type taken from the rendition, never guessed from a name or an extension. */
  readonly mimeType: string;
  /** Length of the body to send, in bytes: the whole rendition, or exactly the requested window. */
  readonly contentLength: number;
  /** The inclusive window this response carries, or null when the whole rendition is sent. */
  readonly range: ByteRange | null;
  /** The bytes to send, already narrowed to `range` when one was requested. A view, never a copy. */
  readonly bytes: Uint8Array;
  /**
   * The status the bytes must be sent with.
   *
   * `200` is the whole entity and `206` is the requested window. `416` is the third case and it is not
   * a refusal of the caller: an *authorised* reader whose `Range` names no byte of the entity gets the
   * unsatisfiable-range status, which carries no body and states the entity's size in its own content
   * range header. It is carried here rather than as a `denied` or `unavailable`
   * outcome because neither would be true — the reader may have these bytes, and the source is up —
   * and because the read union this file answers with has no `invalid` member to express a malformed
   * request. A malformed or unit-less `Range` header is not an error at all: RFC 9110 permits a server
   * to ignore it, and the one parser this repository uses does exactly that, so such a request is
   * served whole rather than truncated.
   */
  readonly status: 200 | 206 | 416;
  /** The complete header set for this response: the cache policy, type, length, window and range. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * One request for one rendition.
 *
 * The scope is deliberately absent: this read derives the caller's authority from the session on every
 * call and never from an argument a caller could state for itself. `rendition` is whatever the route's
 * second segment held — one of the five purposes, or a specific rendition's identity — and it is
 * matched against the asset's own record rather than parsed for meaning.
 */
export interface MediaAssetReadInput {
  /** The asset the request named. An unknown or unadmitted asset is refused identically. */
  readonly assetId: string;
  /** The requested purpose or rendition identity, exactly as the request stated it. Never repaired. */
  readonly rendition: string;
  /** The request's `Range` header verbatim, or nothing when it carried none. */
  readonly rangeHeader?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Fixed values
//
// Each one is stated once here so no branch of this read can word a refusal, a source or a job name
// differently from another.
// ---------------------------------------------------------------------------------------------

/**
 * The job name a diagnostic line carries.
 *
 * A read has no attempt identity to log, so this is the whole of what an `unavailable` line says about
 * the work: which job could not be answered, and which source failed it.
 */
const JOB = "readMediaAsset";

/**
 * The source system named when a rendition's bytes could not be read.
 *
 * It names the custody side of this application, not a provider: media custody is a documented seam
 * (AAP 0.6.1, 0.10.2), and a later owner replaces what sits behind this name without any surface
 * learning that it changed.
 */
const MEDIA_SOURCE_SYSTEM = "media-source";

/**
 * The attempt identity a read refusal carries.
 *
 * Nothing was asked to change, so nothing can be replayed and no attempt identity exists to invent.
 * The value states that, and it is the same marker `authorize.ts` puts on its own refusals, so a caller
 * sees one shape whichever layer refused it.
 */
const READ_ATTEMPT_ID = "read";

/**
 * The source reference used when the store's own document cannot be read or no longer matches the
 * record schema. It names the fault, never a record, a path or a value.
 */
const STORE_UNREADABLE_REFERENCE = "media-state-unreadable";

/**
 * The one reason code a media refusal carries.
 *
 * It is the closed vocabulary's only statement that is true of every cause — an unresolvable session,
 * an asset held by another ministry, an absent asset, an unservable purpose and a rendition that may no
 * longer be served — so the refusal says the same thing in each case. Naming a different code for a
 * resolved-but-out-of-scope asset than for an absent one would turn this address into an existence
 * oracle.
 */
const MEDIA_REFUSAL_REASON: DenialReason = "no-permission";

/** The bytes of a response that carries no body: the unsatisfiable-range case, and nothing else. */
const NO_BYTES = new Uint8Array(0);

/** The suffix the store's data directory carries, used to derive the repository root from it. */
const DATA_ROOT_SUFFIX = "/.data";

/** Longest `bytesRef` this read will resolve; far beyond any reference the record schema admits. */
const MAX_BYTES_REF_LENGTH = 512;

/**
 * What a caller is told when a rendition's bytes could not be read right now.
 *
 * It names the source problem rather than blaming the file, promises no recovery and reveals nothing
 * about the asset — not its size, not its purpose, not which of its renditions failed.
 */
const UNAVAILABLE_GUIDANCE =
  "These bytes could not be read from their source right now. Try the request again shortly; nothing else about this asset changed.";

/**
 * What a caller is told when the asset exists and is theirs, but has no prepared rendition for the
 * purpose it asked for.
 *
 * This is the honest answer for a placement whose preparation never completed: the surface keeps the
 * poster or the text alternative and offers the retry, which it cannot do if the read pretends the
 * asset is absent.
 */
const MISSING_RENDITION_GUIDANCE =
  "This asset has no prepared rendition for that purpose yet, so there are no bytes to send. Retry once preparation has finished, or choose the file again in the editor.";

/** What a caller is told when the store could not be read for this request at all. */
const STORE_UNAVAILABLE_GUIDANCE =
  "The local synthetic store could not be read for this request, so this asset's renditions could not be established. Retry the request; if it keeps failing, reset the development data from Settings.";

/**
 * The rendered purposes each kind of asset can carry.
 *
 * A purpose is admitted by the kind before it is looked up, so a request that this asset could never
 * satisfy — a transcript of a still image, a playback stream of a photo — is refused rather than
 * answered with retry advice the worker can never use. `display` is the still image's own rendition;
 * a video's stills are its poster, because a poster is defined by the playback it precedes.
 */
const KIND_PURPOSES: Readonly<Record<MediaAssetKind, readonly MediaAssetRenditionPurpose[]>> = {
  image: ["display"],
  video: ["playback", "poster", "captions", "transcript"],
};

/**
 * The two directories a `bytesRef` may name anything inside: the repository root, which is where the
 * committed development fixtures live, and the store's own data directory, which is where a registered
 * upload's bytes are kept.
 *
 * The repository root is derived from the store's own answer rather than by walking up from the
 * working directory again: `store/paths.ts` is the one module that resolved it, and a second walk could
 * land somewhere else. A reference outside both roots is refused, which is what stops a stored
 * reference from becoming a read of any file on the machine.
 */
const MEDIA_BYTE_ROOTS: readonly string[] = Object.freeze([repositoryRootOf(DATA_ROOT), DATA_ROOT]);

/**
 * The stored shape this read needs from a session's state document: its media assets, validated by the
 * one schema that declares them.
 *
 * The asset record belongs to `envelope.ts`, so this projection takes that schema rather than restating
 * a field of it. Only `mediaAssets` is read here: a serving decision needs the asset's own scope, its
 * kind and its renditions, and nothing else from the document.
 */
const storedMediaSchema = z.object({
  mediaAssets: z.array(mediaAssetRecordSchema),
});

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/**
 * Serves one rendition of one asset to one caller, re-authorising the request as it stands now.
 *
 * The order below is the contract, and each step is where it is because of what the step before it
 * makes safe:
 *
 * 1. The session is resolved, so a request that names no session the store holds is refused before
 *    anything is looked up.
 * 2. The state document is read and its media assets are validated. A document that cannot be decoded
 *    or no longer matches the record schema is an `unavailable` source: the asset was never established,
 *    which is not the same fact as the asset being absent.
 * 3. An asset the session does not hold is refused, and so is an asset whose scope the caller is not
 *    admitted to: the two answers are identical, so neither can be used to learn that something exists
 *    elsewhere.
 * 4. The asset's own recorded scope is asserted through `canView`, which runs the one scope assertion —
 *    the caller's principal and one admitted membership of the asset's organisation, ministry and
 *    support subject.
 * 5. The requested segment is resolved against the asset's own records: a purpose its kind admits, or a
 *    rendition identity it actually carries. Anything else is refused, including a request for the
 *    private original, which has no purpose and therefore no serving path.
 * 6. Missing bytes, whether because preparation never produced the rendition or because its source
 *    cannot be read right now, are `unavailable` — the reader is entitled to the item, so telling them
 *    the source is down is the truth, while an empty success or a fabricated refusal would both lie.
 * 7. Only then does `assertReadable` decide, with the authorisation this read derived, the asset state
 *    the development scenario states, and the `Range` header exactly as it arrived.
 *
 * Byte ranges get no shortcut. A range request is authorised identically to a whole-entity one, its
 * window is parsed only after every check above has passed, and an unsatisfiable window is answered
 * with the range's own status and the entity's size rather than with a truncated body.
 */
export async function readMediaAsset(
  input: MediaAssetReadInput,
): Promise<ReadResult<MediaRenditionResponse>> {
  if (!isNonEmptyString(input.assetId) || !isNonEmptyString(input.rendition)) {
    return refused();
  }

  const resolved = await resolveSession();
  if (!resolved.ok) {
    return refused();
  }
  const { session } = resolved;

  let documents: Awaited<ReturnType<typeof readSession>>;
  try {
    documents = await readSession(session.sessionId);
  } catch {
    // A corrupt or unreadable document means the assets cannot be established. The answer says the
    // source could not be read and nothing else: naming the document, the path or the fault would
    // disclose where the session's records live, and the caller can do nothing with that.
    return unreadableStore();
  }
  if (documents === undefined) {
    return refused();
  }

  const stored = storedMediaSchema.safeParse(documents.state);
  if (!stored.success) {
    return unreadableStore();
  }

  const asset = stored.data.mediaAssets.find((record) => record.assetId === input.assetId);
  if (asset === undefined) {
    return refused();
  }

  // The one permission question, asked of the asset's own recorded scope rather than of the context
  // the request arrived in. `canView` runs the scope assertion for this target, so a caller admitted to
  // another ministry, a coach, a reader and a second worker all receive the same refusal here.
  const view = canView(session, { kind: "media-asset", scope: asset.scope });
  if (!view.allowed) {
    return refused();
  }

  const purpose = requestedPurpose(asset, input.rendition);
  if (purpose === undefined) {
    return refused();
  }

  const rendition = asset.renditions.find((record) => record.purpose === purpose);
  if (rendition === undefined) {
    return unavailableBytes(bytesSourceOf(asset), MISSING_RENDITION_GUIDANCE);
  }

  const bytes = await readRenditionBytes(rendition.bytesRef);
  if (bytes === undefined) {
    return unavailableBytes(bytesSourceOf(asset), UNAVAILABLE_GUIDANCE);
  }

  const serving = assertReadable(asset.assetId, preparedRendition(asset, rendition, bytes), {
    allowed: true,
    scope: asset.scope,
    assetState: servingStateOf(session.scenarioId),
    requestedPurpose: purpose,
    // The rendition's own bytes reference never travels: it names a path inside this repository, and no
    // response may echo one. The bytes' holder is named by the asset's opaque identity instead, which
    // the caller already has from the request it made.
    bytesRef: bytesSourceOf(asset),
    rangeHeader: input.rangeHeader ?? null,
  });

  switch (serving.kind) {
    case "readable":
      return {
        kind: "envelope",
        envelope: {
          kind: asset.kind,
          renditionId: serving.renditionId,
          purpose: serving.purpose,
          mimeType: serving.mimeType,
          contentLength: serving.contentLength,
          range: serving.byteRange,
          bytes: sliceRenditionBytes(bytes, serving.byteRange),
          status: serving.status,
          headers: serving.headers,
        },
      };

    case "rangeNotSatisfiable":
      // The reader may have this entity; the window simply names none of it. The status and the headers
      // carry the entity's size, and the body is empty by definition, so nothing is truncated and no
      // size is disclosed that the caller was not already authorised to learn.
      return {
        kind: "envelope",
        envelope: {
          kind: asset.kind,
          renditionId: rendition.renditionId,
          purpose: rendition.purpose,
          mimeType: rendition.mimeType,
          contentLength: 0,
          range: null,
          bytes: NO_BYTES,
          status: serving.status,
          headers: serving.headers,
        },
      };

    case "unavailable":
      return unavailableBytes(serving.source, UNAVAILABLE_GUIDANCE);

    case "denied":
    case "tombstone":
      // A rendition that resolved but cannot be served is the same refusal as one that never did, which
      // is what keeps a restricted asset from advertising that it once served.
      return refused();

    default:
      return assertNever(serving, "Unhandled media serving decision");
  }
}

// ---------------------------------------------------------------------------------------------
// Internals: the segment, the source, the asset state and the two refusals
//
// Each one is a single expression of a single fact, so no branch of the read above states its own
// version of it.
// ---------------------------------------------------------------------------------------------

/**
 * Resolves the request's second segment against this asset's own records.
 *
 * Two forms are accepted, in this order: one of the five purposes, taken from the set the asset's kind
 * admits, and a rendition identity the asset actually carries. A purpose is matched exactly — never
 * case-folded, trimmed into shape or otherwise repaired — because an equal-looking value grants nothing,
 * and a rendition identity is matched only within this asset, so one asset's identity cannot address
 * another's bytes.
 *
 * `undefined` means the segment named nothing this asset can serve, which the caller answers with the
 * same refusal as a scope failure: whether the purpose exists elsewhere, whether the asset carries some
 * other rendition, and whether an original by that name exists are all facts this read will not state.
 */
function requestedPurpose(
  asset: MediaAssetRecord,
  segment: string,
): MediaAssetRenditionPurpose | undefined {
  const named = KIND_PURPOSES[asset.kind].find((candidate) => candidate === segment);
  if (named !== undefined) {
    return named;
  }
  return asset.renditions.find((record) => record.renditionId === segment)?.purpose;
}

/**
 * Presents one stored rendition as the media module's own value, with its bytes attached.
 *
 * The record and the media module's type say the same five purposes in their own vocabularies; this is
 * the one conversion between them, so no caller has to reinterpret a record's fields. Nothing but the
 * identity, the purpose, the media type and the bytes travels: a placement's caption, credit and
 * alternative text belong to the content revision that states them, never to the bytes.
 */
function preparedRendition(
  asset: MediaAssetRecord,
  record: MediaAssetRenditionRecord,
  bytes: Uint8Array,
): MediaRendition {
  return {
    assetId: asset.assetId,
    renditionId: record.renditionId,
    purpose: record.purpose,
    mimeType: record.mimeType,
    bytes,
  };
}

/**
 * The source identity a diagnostic and an `unavailable` outcome name for this asset's bytes.
 *
 * It is the asset's opaque identity, not the record's `bytesRef`: a reference names a location inside
 * this repository, and an outcome travels to a browser. The asset identity is already in the request
 * the caller made, so naming it discloses nothing it did not already have.
 */
function bytesSourceOf(asset: MediaAssetRecord): MediaOriginalReference {
  return { system: MEDIA_SOURCE_SYSTEM, reference: asset.assetId };
}

/**
 * The state of the asset's bytes as the session's development scenario states it.
 *
 * `media-unavailable` is the one world in which a placement's source is down while its prose, its
 * poster's alternative text and the rest of the workspace stay usable, so that is the one flag consulted.
 * A scenario identifier this release does not define cannot establish that anything is up, so it answers
 * `unavailable` rather than serving on an assumption: the honest failure is a source that cannot be read,
 * not bytes sent under a state no scenario declared.
 */
function servingStateOf(scenarioId: string): MediaServingState {
  if (!isScenarioId(scenarioId)) {
    return "unavailable";
  }
  return scenarioFlagsFor(scenarioId).mediaAsset === "unavailable" ? "unavailable" : "served";
}

/**
 * Reads one rendition's bytes from the reference its record states.
 *
 * The reference is resolved under {@link MEDIA_BYTE_ROOTS} only — the repository root for the committed
 * development fixtures, then the store's data directory for a registered upload — and anything that could
 * name a path outside them (an absolute path, a parent segment, a backslash, a drive letter, a NUL byte,
 * an empty segment) is refused before a filesystem call is made. A reference that resolves to nothing is
 * the same answer as one that could not be read: `undefined`, which the read reports as an unavailable
 * source. Nothing about either the reference or the failure is logged or returned.
 */
async function readRenditionBytes(bytesRef: string): Promise<Uint8Array | undefined> {
  const relative = containedRelativePath(bytesRef);
  if (relative === undefined) {
    return undefined;
  }
  for (const root of MEDIA_BYTE_ROOTS) {
    try {
      // A copy rather than a view over the read buffer: the serving decision hands out a subarray of
      // these bytes, and nothing served may alias a pooled buffer another read could reuse.
      return new Uint8Array(await readFile(`${root}/${relative}`));
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Whether a stored reference is a plain relative path this read may resolve, and that path when it is. */
function containedRelativePath(bytesRef: string): string | undefined {
  const reference = bytesRef.trim();
  if (reference.length === 0 || reference.length > MAX_BYTES_REF_LENGTH) {
    return undefined;
  }
  if (reference.startsWith("/") || reference.includes("\\") || reference.includes("\0")) {
    return undefined;
  }
  if (/^[A-Za-z]:/.test(reference)) {
    return undefined;
  }
  const segments = reference.split("/");
  const contained = segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
  return contained ? segments.join("/") : undefined;
}

/**
 * The repository root, derived from the data directory the store itself resolved.
 *
 * `store/paths.ts` walks up to the workspace marker once, at module load, and this is that answer with
 * the store's own directory removed. Deriving it here rather than walking again keeps one answer to
 * "where is this repository", which is the same reason the store owns the walk.
 */
function repositoryRootOf(dataRoot: string): string {
  return dataRoot.endsWith(DATA_ROOT_SUFFIX)
    ? dataRoot.slice(0, dataRoot.length - DATA_ROOT_SUFFIX.length)
    : dataRoot;
}

/**
 * The one refusal this read returns, whatever produced it.
 *
 * An unresolvable session, an asset another ministry holds, an asset that does not exist, a purpose
 * this asset could never serve, a request for the private original and a rendition that may no longer
 * be served are answered identically: the relationship is stated as `no-permission`, no bytes are
 * sent, and no size, media type, title or existence flag travels with it. Any difference between those
 * cases — a status, a code, a content length — would let a poster, caption or transcript address
 * answer "does this exist, and may someone else see it?", which is exactly the disclosure a single
 * answer prevents; `serve.ts` makes the same choice on the wire, where its refusal and its tombstone
 * are field for field identical. The outcome is redacted on the way out as well, so a field added to it
 * later cannot carry an existence flag by accident.
 */
function refused(): ReadResult<MediaRenditionResponse> {
  return {
    kind: "denied",
    denied: redactDenial(
      denied({ operationId: READ_ATTEMPT_ID, reasonCode: MEDIA_REFUSAL_REASON }),
    ),
  };
}

/** The answer when the session's own documents cannot be read: an unavailable store, never a refusal. */
function unreadableStore(): ReadResult<MediaRenditionResponse> {
  return unavailableBytes(
    { system: LOCAL_STORE_SYSTEM, reference: STORE_UNREADABLE_REFERENCE },
    STORE_UNAVAILABLE_GUIDANCE,
  );
}

/**
 * The answer when the asset is the caller's but its bytes are not available, with the source named.
 *
 * The diagnostic line carries the job and the source and nothing else — no bytes, no file name, no
 * asset title, no size — because the line names what failed rather than what the asset holds.
 */
function unavailableBytes(
  source: MediaOriginalReference,
  guidance: string,
): ReadResult<MediaRenditionResponse> {
  logger.sourceUnavailable({ job: JOB, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}
