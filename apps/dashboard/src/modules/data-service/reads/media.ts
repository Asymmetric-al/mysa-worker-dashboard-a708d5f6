/**
 * Scoped rendition serving: the one read of the data service's "Attach media" job.
 */
// A rendition's bytes must arrive with the rendition: the media module's serving decision receives them
// from its caller, the store publishes JSON documents only, and no module in `@/modules/media` opens a
// file. Resolving the record's reference is therefore this read's one piece of custody, delegated to the
// store module that owns the tree those bytes live in.
import { z } from "zod";
import { isNonEmptyString } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import type { MediaOriginalReference, MediaRendition } from "@/modules/media/asset";
import { assertReadable, sliceRenditionBytes, type ByteRange, type MediaServingState } from "@/modules/media/serve";
import { readMediaBytes } from "@/modules/store/media";
import { readSession } from "@/modules/store/repository";
import { instantAt } from "@/modules/time/clock";
import { canView, readResultOfRefusal, resolveSession, type ResolvedSession } from "../authorize";
import {
  buildEnvelope,
  mediaAssetRecordSchema,
  type MediaAssetKind,
  type MediaAssetRecord,
  type MediaAssetRenditionPurpose,
  type MediaAssetRenditionRecord,
  type ReadAction,
  type ReadEnvelope,
  type RecordedValueState,
} from "../envelope";
import { denied, LOCAL_STORE_SYSTEM, unavailable, type DenialReason, type ReadResult } from "../outcome";
// What this read answers with
//
// The envelope every read answers with, carrying one authorised rendition and its wire facts.
/** One authorised rendition response: the bytes this read authorises sending, and the facts that must be sent with them. */
export interface MediaRenditionResponse {
  readonly kind: MediaAssetKind;
  readonly renditionId: string;
  readonly purpose: MediaAssetRenditionPurpose;
  readonly mimeType: string;
  readonly contentLength: number;
  readonly range: ByteRange | null;
  readonly bytes: Uint8Array;
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
}
/** What this read answers with: the rendition's envelope, or the outcome that refused it. */
export type MediaAssetReadResult = ReadResult<ReadEnvelope<MediaRenditionResponse>>;
/** One request for one rendition. */
export interface MediaAssetReadInput {
  readonly assetId: string;
  readonly rendition: string;
  readonly rangeHeader?: string | null;
}
// Fixed values
//
// Each one is stated once here so no branch of this read can word a refusal, a source or a job name
// differently from another.
const JOB = "readMediaAsset";

const MEDIA_SOURCE_SYSTEM = "media-source";

const READ_ATTEMPT_ID = "read";

const STORE_UNREADABLE_REFERENCE = "media-state-unreadable";

const MEDIA_REFUSAL_REASON: DenialReason = "no-permission";

const NO_BYTES = new Uint8Array(0);

const NO_ACTIONS: readonly ReadAction[] = Object.freeze([]);

const UNAVAILABLE_GUIDANCE = "These bytes could not be read from their source right now. Try the request again shortly; nothing else about this asset changed.";

const MISSING_RENDITION_GUIDANCE =
  "This asset has no prepared rendition for that purpose yet, so there are no bytes to send. Retry once preparation has finished, or choose the file again in the editor.";
const STORE_UNAVAILABLE_GUIDANCE =
  "The local synthetic store could not be read for this request, so this asset's renditions could not be established. Retry the request; if it keeps failing, reset the development data from Settings.";
const KIND_PURPOSES: Readonly<Record<MediaAssetKind, readonly MediaAssetRenditionPurpose[]>> = {
  image: ["display"],
  video: ["playback", "poster", "captions", "transcript"],
};
const storedMediaSchema = z.object({
  mediaAssets: z.array(mediaAssetRecordSchema),
});
// The read
/** Serves one rendition of one asset to one caller, re-authorising the request as it stands now. Answers the rendition's `envelope` — the whole entity, a requested range or an unsatisfiable range — or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the asset cannot be read. */
export async function readMediaAsset(input: MediaAssetReadInput): Promise<MediaAssetReadResult> {
  if (!isNonEmptyString(input.assetId) || !isNonEmptyString(input.rendition)) {
    return refused();
  }
  const resolved = await resolveSession();
  if (!resolved.ok) {
    // A request that names no session the store holds is refused; a store that could not answer is
    // the outage it is, and the caller is entitled to hear which of the two it was.
    return readResultOfRefusal(resolved.refusal);
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
  // The bytes come from the store's media custody, which refuses any reference naming a file outside
  // its own data tree — the application's `public/` directory included. A refused reference and a read
  // failure are the same answer here: an unavailable source, never a zero-length body.
  const bytes = await readMediaBytes(rendition.bytesRef);
  if (bytes === undefined) {
    return unavailableBytes(bytesSourceOf(asset), UNAVAILABLE_GUIDANCE);
  }
  const serving = assertReadable(asset.assetId, preparedRendition(asset, rendition, bytes), {
    allowed: true,
    scope: asset.scope,
    assetState: servingStateOf(session.scenarioId),
    requestedPurpose: purpose,
    // The rendition's own bytes reference never travels: it names a location inside the store's data
    // tree, and no response may echo one. The bytes' holder is named by the asset's opaque identity
    // instead, which the caller already has from the request it made.
    bytesRef: bytesSourceOf(asset),
    rangeHeader: input.rangeHeader ?? null,
  });
  switch (serving.kind) {
    case "readable":
      return renditionAnswer(session, asset, {
        kind: asset.kind,
        renditionId: serving.renditionId,
        purpose: serving.purpose,
        mimeType: serving.mimeType,
        contentLength: serving.contentLength,
        range: serving.byteRange,
        bytes: sliceRenditionBytes(bytes, serving.byteRange),
        status: serving.status,
        headers: serving.headers,
      });
    case "rangeNotSatisfiable":
      // The reader may have this entity; the window simply names none of it. The status and the headers
      // carry the entity's size, and the body is empty by definition, so nothing is truncated and no
      // size is disclosed that the caller was not already authorised to learn.
      return renditionAnswer(session, asset, {
        kind: asset.kind,
        renditionId: rendition.renditionId,
        purpose: rendition.purpose,
        mimeType: rendition.mimeType,
        contentLength: 0,
        range: null,
        bytes: NO_BYTES,
        status: serving.status,
        headers: serving.headers,
      });
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
// Internals: the envelope, the segment, the source, the asset state and the two refusals
//
// Each one is a single expression of a single fact, so no branch of the read above states its own
// version of it.
function renditionAnswer(session: ResolvedSession, asset: MediaAssetRecord, data: MediaRenditionResponse): MediaAssetReadResult {
  const valueStates: Readonly<Record<string, RecordedValueState>> = {
    contentLength: data.contentLength === 0 ? "zero" : "value",
  };
  return {
    kind: "envelope",
    envelope: buildEnvelope({
      data,
      scope: asset.scope,
      source: bytesSourceOf(asset),
      revision: asset.revision,
      asOf: instantAt(session.clockOffsetMs).toString(),
      coverage: { from: null, to: null, state: "complete" },
      valueStates,
      actions: NO_ACTIONS,
    }),
  };
}
function requestedPurpose(asset: MediaAssetRecord, segment: string): MediaAssetRenditionPurpose | undefined {
  const named = KIND_PURPOSES[asset.kind].find((candidate) => candidate === segment);
  if (named !== undefined) {
    return named;
  }
  return asset.renditions.find((record) => record.renditionId === segment)?.purpose;
}
function preparedRendition(asset: MediaAssetRecord, record: MediaAssetRenditionRecord, bytes: Uint8Array): MediaRendition {
  return {
    assetId: asset.assetId,
    renditionId: record.renditionId,
    purpose: record.purpose,
    mimeType: record.mimeType,
    bytes,
  };
}
function bytesSourceOf(asset: MediaAssetRecord): MediaOriginalReference {
  return { system: MEDIA_SOURCE_SYSTEM, reference: asset.assetId };
}
function servingStateOf(scenarioId: string): MediaServingState {
  if (!isScenarioId(scenarioId)) {
    return "unavailable";
  }
  return scenarioFlagsFor(scenarioId).mediaAsset === "unavailable" ? "unavailable" : "served";
}
function refused(): MediaAssetReadResult {
  return {
    kind: "denied",
    denied: redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: MEDIA_REFUSAL_REASON })),
  };
}
function unreadableStore(): MediaAssetReadResult {
  return unavailableBytes({ system: LOCAL_STORE_SYSTEM, reference: STORE_UNREADABLE_REFERENCE }, STORE_UNAVAILABLE_GUIDANCE);
}
function unavailableBytes(source: MediaOriginalReference, guidance: string): MediaAssetReadResult {
  logger.sourceUnavailable({ job: JOB, source });
  return {
    kind: "unavailable",
    unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }),
  };
}
