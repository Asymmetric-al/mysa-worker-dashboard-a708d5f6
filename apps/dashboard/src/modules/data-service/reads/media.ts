import { assertNever } from "@/lib/result";
import { isDirectlyReadable } from "@/modules/content/reach";
import { scenarioMediaServing } from "@/modules/dev-runtime/scenario";
import type { MediaOriginalReference } from "@/modules/media/asset";
import { assertReadable, type ByteRange, type MediaServingState, type MediaSizedRendition } from "@/modules/media/serve";
import { readMediaBytes, statMediaBytes, type MediaByteWindow } from "@/modules/store/media";
import { instantAt } from "@/modules/time/clock";
import { canView, sessionStateRefusal, type ResolvedSession, type SessionSource } from "../authorize";
import type { MediaAssetKind, MediaAssetRecord, MediaAssetRenditionPurpose, MediaAssetRenditionRecord, ReadAction, ReadEnvelope, Scope } from "../envelope";
import type { DenialReason, ReadResult } from "../outcome";
import { answerOf, deniedRead, sourceUnavailableRead } from "./frame";
import { grantHeldFor, releaseStillServes, resolveRelease, resolveWorlds, scopeOf, type World } from "./audience";
export type MediaRenditionResponse = { readonly kind: MediaAssetKind; readonly renditionId: string; readonly purpose: MediaAssetRenditionPurpose; readonly mimeType: string } & { readonly contentLength: number; readonly range: ByteRange | null; readonly bytes: Uint8Array; readonly status: 200 | 206 | 416 } & {
  readonly headers: Readonly<Record<string, string>>;
};
export type MediaAssetReadResult = ReadResult<ReadEnvelope<MediaRenditionResponse>>;
export type MediaAssetReadInput = { readonly assetId: string; readonly rendition: string; readonly rangeHeader?: string | null };
const JOB = "readMediaAsset";
const MEDIA_SOURCE_SYSTEM = "media-source";
const MEDIA_REFUSAL_REASON: DenialReason = "no-permission";
const NO_BYTES = new Uint8Array(0);
const NO_ACTIONS: readonly ReadAction[] = Object.freeze([]);
const UNAVAILABLE_GUIDANCE = "These bytes could not be read from their source right now. Try the request again shortly; nothing else about this asset changed.";
const MISSING_RENDITION_GUIDANCE = "This asset has no prepared rendition for that purpose yet, so there are no bytes to send. Retry once preparation has finished, or choose the file again in the editor.";
const SEGMENT_MAX_LENGTH = 160;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const KIND_PURPOSES: Readonly<Record<MediaAssetKind, readonly MediaAssetRenditionPurpose[]>> = { image: ["display"], video: ["playback", "poster", "captions", "transcript"] };
/** Serves one rendition of one asset to one caller — the session the request carries, or the one `source` names — re-authorising it as it stands now. The session's own state is decided first, before the asset is looked up, so a session that is denied, without access, expired or unavailable answers exactly as an address that was never recorded does and cannot tell the two apart. Answers the rendition's `envelope` — the whole entity, a requested range or an unsatisfiable range — or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the asset cannot be read. */
export async function readMediaAsset(input: MediaAssetReadInput, source?: SessionSource): Promise<MediaAssetReadResult> {
  if (!isMediaSegment(input.assetId) || !isMediaSegment(input.rendition)) return refused();
  const worlds = await resolveWorlds(JOB, source);
  if (!worlds.ok) return worlds.result;
  const { session, own, published } = worlds;
  const stateRefusal = sessionStateRefusal(session);
  if (stateRefusal !== undefined) return { kind: "denied", denied: stateRefusal };
  const reading = published.sessionId !== own.sessionId;
  const asset = (reading ? published : own).state.mediaAssets.find((record) => record.assetId === input.assetId);
  if (asset === undefined) return refused();
  const authority = reading ? readingAuthority(worlds, asset) : ownAuthority(session, asset);
  if (authority === undefined) return refused();
  if (authority.state === "withdrawn") return refused();
  const purpose = requestedPurpose(asset, input.rendition);
  if (purpose === undefined) return refused();
  const rendition = asset.renditions.find((record) => record.purpose === purpose);
  if (rendition === undefined) return sourceUnavailableRead({ job: JOB, source: bytesSourceOf(asset), guidance: MISSING_RENDITION_GUIDANCE });
  // The bytes come from the store's media custody, which refuses any reference naming a file outside its own data tree — the application's `public/` directory included. Its size is probed first, because the serving decision is made on that count rather than on the bytes: a refused or unsatisfiable request costs one file-size lookup and never reads the file's contents, and a refused reference and a failed probe are the same answer here.
  const totalBytes = await statMediaBytes(rendition.bytesRef);
  if (totalBytes === undefined) return sourceUnavailableRead({ job: JOB, source: bytesSourceOf(asset), guidance: UNAVAILABLE_GUIDANCE });
  const serving = assertReadable(asset.assetId, sizedRendition(asset, rendition, totalBytes), { allowed: true, scope: authority.scope, assetState: authority.state, requestedPurpose: purpose, bytesRef: bytesSourceOf(asset), rangeHeader: input.rangeHeader ?? null });
  switch (serving.kind) {
    case "readable": {
      // Only the window the decision admitted is read, and only once it has admitted it: a 206 asks for its own range and a 200 for the whole rendition, so the I/O a response pays is the body it carries.
      const admitted = await readMediaBytes(rendition.bytesRef, admittedWindow(serving.byteRange, totalBytes));
      if (admitted === undefined) return sourceUnavailableRead({ job: JOB, source: bytesSourceOf(asset), guidance: UNAVAILABLE_GUIDANCE });
      return renditionAnswer(session, asset, authority.scope, { kind: asset.kind, renditionId: serving.renditionId, purpose: serving.purpose, mimeType: serving.mimeType, contentLength: serving.contentLength, range: serving.byteRange, bytes: admitted, status: serving.status, headers: serving.headers });
    }
    case "rangeNotSatisfiable":
      return renditionAnswer(session, asset, authority.scope, { kind: asset.kind, renditionId: rendition.renditionId, purpose: rendition.purpose, mimeType: rendition.mimeType, contentLength: 0, range: null, bytes: NO_BYTES, status: serving.status, headers: serving.headers });
    case "unavailable":
      return sourceUnavailableRead({ job: JOB, source: serving.source, guidance: UNAVAILABLE_GUIDANCE });
    case "denied":
    case "tombstone":
      return refused();
    default:
      return assertNever(serving, "Unhandled media serving decision");
  }
}
type MediaAuthority = { readonly scope: Scope; readonly state: MediaServingState };
const ownAuthority = (session: ResolvedSession, asset: MediaAssetRecord): MediaAuthority | undefined => (!canView(session, { kind: "media-asset", scope: asset.scope }).allowed ? undefined : { scope: asset.scope, state: servingStateOf(session.scenarioId) });
function readingAuthority(worlds: { readonly session: ResolvedSession; readonly own: World; readonly published: World }, asset: MediaAssetRecord): MediaAuthority | undefined {
  const { session, own, published } = worlds;
  const scope = scopeOf(session, published);
  if (scope === undefined) return undefined;
  const grantHeld = grantHeldFor(session, scope, own, published);
  let liveEditions = 0;
  let withdrawnEditions = 0;
  for (const record of published.state.releases) {
    const resolved = resolveRelease(record, published.state);
    if (resolved.revision === undefined || !resolved.revision.mediaPlacements.some((placement) => placement.assetId === asset.assetId)) continue;
    if (resolved.domain === undefined || !releaseStillServes(resolved.domain)) {
      if (resolved.domain?.withdrawnAt !== undefined) withdrawnEditions += 1;
      continue;
    }
    liveEditions += 1;
    if (resolved.document?.family !== "update" && !isDirectlyReadable({ reach: record.reach, withdrawnAt: resolved.domain.withdrawnAt })) continue;
    if (record.audience === "public" || grantHeld) return { scope, state: servingStateOf(session.scenarioId) };
  }
  return liveEditions === 0 && withdrawnEditions > 0 ? { scope, state: "withdrawn" } : undefined;
}
const isMediaSegment = (value: unknown): value is string => typeof value === "string" && value.length <= SEGMENT_MAX_LENGTH && SEGMENT_PATTERN.test(value);
function renditionAnswer(session: ResolvedSession, asset: MediaAssetRecord, scope: Scope, data: MediaRenditionResponse): MediaAssetReadResult {
  return answerOf(scope, instantAt(session.clockOffsetMs).toString(), { data, source: bytesSourceOf(asset), revision: asset.revision, valueStates: { contentLength: data.contentLength === 0 ? "zero" : "value" }, actions: NO_ACTIONS });
}
const requestedPurpose = (asset: MediaAssetRecord, segment: string): MediaAssetRenditionPurpose | undefined => KIND_PURPOSES[asset.kind].find((candidate) => candidate === segment) ?? asset.renditions.find((record) => record.renditionId === segment)?.purpose;
const sizedRendition = (asset: MediaAssetRecord, record: MediaAssetRenditionRecord, byteLength: number): MediaSizedRendition => ({ assetId: asset.assetId, renditionId: record.renditionId, purpose: record.purpose, mimeType: record.mimeType, byteLength });
/** The bytes one serving decision admitted: its own range when it named one, and the whole rendition otherwise. */
const admittedWindow = (byteRange: ByteRange | null, totalBytes: number): MediaByteWindow => (byteRange === null ? { start: 0, end: totalBytes - 1 } : { start: byteRange.start, end: byteRange.end });
const bytesSourceOf = (asset: MediaAssetRecord): MediaOriginalReference => ({ system: MEDIA_SOURCE_SYSTEM, reference: asset.assetId });
// The scenario's own media rule, read from the one place that states it: the bytes this route serves and the state every rendering surface states come from the same answer.
const servingStateOf = (scenarioId: string): MediaServingState => scenarioMediaServing(scenarioId);
/** The one refusal every failed media authorisation answers with: the request names no record this caller may read. */ const refused = (): MediaAssetReadResult => deniedRead(MEDIA_REFUSAL_REASON);
