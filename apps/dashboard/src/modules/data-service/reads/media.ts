/** Scoped rendition serving: the one read of the data service's "Attach media" job. */
// A rendition's bytes must arrive with the rendition: the media module's serving decision receives them from its caller, the store publishes JSON documents only, and no module in `@/modules/media` opens a file. Resolving the record's reference is therefore this read's one piece of custody, delegated to the store
// module that owns the tree those bytes live in.
import { logger } from "@/lib/logger";
import { redactDenial } from "@/lib/redaction";
import { assertNever } from "@/lib/result";
import { isDirectlyReadable } from "@/modules/content/reach";
import { isScenarioId, scenarioFlagsFor } from "@/modules/dev-runtime/scenario";
import type { MediaOriginalReference, MediaRendition } from "@/modules/media/asset";
import { assertReadable, sliceRenditionBytes, type ByteRange, type MediaServingState } from "@/modules/media/serve";
import { readMediaBytes } from "@/modules/store/media";
import { instantAt } from "@/modules/time/clock";
import { canView, type ResolvedSession, type SessionSource } from "../authorize";
import { buildEnvelope, type MediaAssetKind, type MediaAssetRecord, type MediaAssetRenditionPurpose, type MediaAssetRenditionRecord, type ReadAction, type ReadEnvelope, type Scope } from "../envelope";
import { denied, unavailable, type DenialReason, type ReadResult } from "../outcome";
import { grantHeldFor, releaseStillServes, resolveRelease, resolveWorlds, scopeOf, type World } from "./audience";
/** One authorised rendition response: the bytes this read authorises sending, and the facts that must be sent with them. */
export type MediaRenditionResponse = { readonly kind: MediaAssetKind; readonly renditionId: string; readonly purpose: MediaAssetRenditionPurpose; readonly mimeType: string } & { readonly contentLength: number; readonly range: ByteRange | null; readonly bytes: Uint8Array; readonly status: 200 | 206 | 416 } & {
  readonly headers: Readonly<Record<string, string>>;
};
/** What this read answers with: the rendition's envelope, or the outcome that refused it. */
export type MediaAssetReadResult = ReadResult<ReadEnvelope<MediaRenditionResponse>>;
/** One request for one rendition. */
export type MediaAssetReadInput = { readonly assetId: string; readonly rendition: string; readonly rangeHeader?: string | null };
// Each one is stated once here so no branch of this read can word a refusal, a source or a job name differently from another.
const JOB = "readMediaAsset";
const MEDIA_SOURCE_SYSTEM = "media-source";
const READ_ATTEMPT_ID = "read";
const MEDIA_REFUSAL_REASON: DenialReason = "no-permission";
const NO_BYTES = new Uint8Array(0);
const NO_ACTIONS: readonly ReadAction[] = Object.freeze([]);
const UNAVAILABLE_GUIDANCE = "These bytes could not be read from their source right now. Try the request again shortly; nothing else about this asset changed.";
const MISSING_RENDITION_GUIDANCE = "This asset has no prepared rendition for that purpose yet, so there are no bytes to send. Retry once preparation has finished, or choose the file again in the editor.";
// The two dynamic segments of the one rendition address, bounded the way every other identifier in this transport is. The class admits every id the application mints (`${prefix}-${crypto.randomUUID()}`) and every seeded one (`rendition-video-welcome-playback`), and nothing longer than a record reference.
const SEGMENT_MAX_LENGTH = 160;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const KIND_PURPOSES: Readonly<Record<MediaAssetKind, readonly MediaAssetRenditionPurpose[]>> = { image: ["display"], video: ["playback", "poster", "captions", "transcript"] };
/** Serves one rendition of one asset to one caller — the session the request carries, or the one `source` names — re-authorising it as it stands now. Answers the rendition's `envelope` — the whole entity, a requested range or an unsatisfiable range — or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the asset cannot be read. */
export async function readMediaAsset(input: MediaAssetReadInput, source?: SessionSource): Promise<MediaAssetReadResult> {
  // Both segments are bounded before anything reads the store: an address the application could not have minted is refused without a lookup, so no comparison ever runs on an arbitrarily long value.
  if (!isMediaSegment(input.assetId) || !isMediaSegment(input.rendition)) return refused();
  // The same world resolution every receiving read performs — the caller's own world, and the published world a reader is admitted to when the development crossing applies — so this read words its session refusal and its store outage once, in one place, instead of deriving them here.
  const worlds = await resolveWorlds(JOB, source);
  if (!worlds.ok) return worlds.result;
  const { session, own, published } = worlds;
  const reading = published.sessionId !== own.sessionId;
  const asset = (reading ? published : own).state.mediaAssets.find((record) => record.assetId === input.assetId);
  if (asset === undefined) return refused();
  // One authority per world, and the answer states the scope of the one that admitted it.
  const authority = reading ? readingAuthority(worlds, asset) : ownAuthority(session, asset);
  if (authority === undefined) return refused();
  // A withdrawn edition serves nobody, and it says nothing about what it used to serve: the answer is the serving module's own tombstone, which this read answers as its single refusal. Deciding it before the rendition resolves keeps a retained address from being told apart from one that never existed.
  if (authority.state === "withdrawn") return refused();
  const purpose = requestedPurpose(asset, input.rendition);
  if (purpose === undefined) return refused();
  const rendition = asset.renditions.find((record) => record.purpose === purpose);
  if (rendition === undefined) return unavailableBytes(bytesSourceOf(asset), MISSING_RENDITION_GUIDANCE);
  // The bytes come from the store's media custody, which refuses any reference naming a file outside its own data tree — the application's `public/` directory included. A refused reference and a read failure are the same answer here: an unavailable source, never a zero-length body.
  const bytes = await readMediaBytes(rendition.bytesRef);
  if (bytes === undefined) return unavailableBytes(bytesSourceOf(asset), UNAVAILABLE_GUIDANCE);
  const serving = assertReadable(asset.assetId, preparedRendition(asset, rendition, bytes), {
    allowed: true,
    scope: authority.scope,
    assetState: authority.state,
    requestedPurpose: purpose,
    // The rendition's own bytes reference never travels: it names a location inside the store's data tree, and no response may echo one. The bytes' holder is named by the asset's opaque identity instead, which the caller already has from the request it made.
    bytesRef: bytesSourceOf(asset),
    rangeHeader: input.rangeHeader ?? null,
  });
  switch (serving.kind) {
    case "readable":
      return renditionAnswer(session, asset, authority.scope, {
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
      // The reader may have this entity; the window simply names none of it. The status and the headers carry the entity's size, and the body is empty by definition, so nothing is truncated and no size is disclosed that the caller was not already authorised to learn.
      return renditionAnswer(session, asset, authority.scope, { kind: asset.kind, renditionId: rendition.renditionId, purpose: rendition.purpose, mimeType: rendition.mimeType, contentLength: 0, range: null, bytes: NO_BYTES, status: serving.status, headers: serving.headers });
    case "unavailable":
      return unavailableBytes(serving.source, UNAVAILABLE_GUIDANCE);
    case "denied":
    case "tombstone":
      // A rendition that resolved but cannot be served is the same refusal as one that never did, which is what keeps a restricted asset from advertising that it once served.
      return refused();
    default:
      return assertNever(serving, "Unhandled media serving decision");
  }
}
// Internals: the two authorities, the envelope, the segment, the source, the asset state and the two refusals — each one a single expression of a single fact, so no branch of the read above states its own version of it.
type MediaAuthority = { readonly scope: Scope; readonly state: MediaServingState };
function ownAuthority(session: ResolvedSession, asset: MediaAssetRecord): MediaAuthority | undefined {
  // The one permission question for the caller's own world, asked of the asset's own recorded scope rather than of the context the request arrived in. `canView` runs the scope assertion for this target, so a caller admitted to another ministry, a coach, a reader and a second worker all receive the same refusal here.
  // Publication state cannot gate this path: an upload is previewed before any release places it, and a withdrawn edition must stay editable.
  const view = canView(session, { kind: "media-asset", scope: asset.scope });
  if (!view.allowed) return undefined;
  return { scope: asset.scope, state: servingStateOf(session.scenarioId) };
}
function readingAuthority(worlds: { readonly session: ResolvedSession; readonly own: World; readonly published: World }, asset: MediaAssetRecord): MediaAuthority | undefined {
  const { session, own, published } = worlds;
  // The receiving reads' own authority: the scope the caller sees the published world in, and the protected-reading grant its own membership rows hold at this instant.
  const scope = scopeOf(session, published);
  if (scope === undefined) return undefined;
  const grantHeld = grantHeldFor(session, scope, own, published);
  let liveEditions = 0;
  let withdrawnEditions = 0;
  for (const record of published.state.releases) {
    const resolved = resolveRelease(record, published.state);
    if (resolved.revision === undefined || !resolved.revision.mediaPlacements.some((placement) => placement.assetId === asset.assetId)) continue;
    if (resolved.domain === undefined || !releaseStillServes(resolved.domain)) {
      // An edition that no longer serves shows this asset to nobody, whatever audience it named.
      if (resolved.domain?.withdrawnAt !== undefined) withdrawnEditions += 1;
      continue;
    }
    liveEditions += 1;
    // A placing edition that belongs to a Page must also be one a direct link may serve: `readReceivingPage` refuses a `not-public` edition at its address, because reach decides what a direct link may serve (audience.ts:1593-1598). An Update's exact post is served whatever its reach, so the `update` family keeps the
    // audience rule alone (audience.ts:1331-1341). With no resolved document there is no family to read, so the Page rule applies and the edition fails closed.
    if (resolved.document?.family !== "update" && !isDirectlyReadable({ reach: record.reach, withdrawnAt: resolved.domain.withdrawnAt })) continue;
    // The surface's own rule, never a second one: a public edition admits every reader, and a protected edition admits the reader that holds the grant. The admitted asset's own state is the same fact on both paths, so the scenario that makes a source unavailable is answered here as it is for the scope that owns the
    // asset.
    if (record.audience === "public" || grantHeld) return { scope, state: servingStateOf(session.scenarioId) };
  }
  // An asset placed only by withdrawn editions is a withdrawn asset, which tombstones rather than answering as one that never existed. One that no live edition admits is refused like any other unauthorised read.
  return liveEditions === 0 && withdrawnEditions > 0 ? { scope, state: "withdrawn" } : undefined;
}
function isMediaSegment(value: unknown): value is string {
  return typeof value === "string" && value.length <= SEGMENT_MAX_LENGTH && SEGMENT_PATTERN.test(value);
}
function renditionAnswer(session: ResolvedSession, asset: MediaAssetRecord, scope: Scope, data: MediaRenditionResponse): MediaAssetReadResult {
  return {
    kind: "envelope",
    envelope: buildEnvelope({ data, scope, source: bytesSourceOf(asset), revision: asset.revision, asOf: instantAt(session.clockOffsetMs).toString(), coverage: { from: null, to: null, state: "complete" }, valueStates: { contentLength: data.contentLength === 0 ? "zero" : "value" }, actions: NO_ACTIONS }),
  };
}
function requestedPurpose(asset: MediaAssetRecord, segment: string): MediaAssetRenditionPurpose | undefined {
  return KIND_PURPOSES[asset.kind].find((candidate) => candidate === segment) ?? asset.renditions.find((record) => record.renditionId === segment)?.purpose;
}
function preparedRendition(asset: MediaAssetRecord, record: MediaAssetRenditionRecord, bytes: Uint8Array): MediaRendition {
  return { assetId: asset.assetId, renditionId: record.renditionId, purpose: record.purpose, mimeType: record.mimeType, bytes };
}
function bytesSourceOf(asset: MediaAssetRecord): MediaOriginalReference {
  return { system: MEDIA_SOURCE_SYSTEM, reference: asset.assetId };
}
function servingStateOf(scenarioId: string): MediaServingState {
  return !isScenarioId(scenarioId) || scenarioFlagsFor(scenarioId).mediaAsset === "unavailable" ? "unavailable" : "served";
}
function refused(): MediaAssetReadResult {
  return { kind: "denied", denied: redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: MEDIA_REFUSAL_REASON })) };
}
function unavailableBytes(source: MediaOriginalReference, guidance: string): MediaAssetReadResult {
  logger.sourceUnavailable({ job: JOB, source });
  return { kind: "unavailable", unavailable: unavailable({ operationId: READ_ATTEMPT_ID, source, guidance }) };
}
