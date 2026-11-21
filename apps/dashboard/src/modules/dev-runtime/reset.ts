/** The reset operation: every session the store holds is discarded and every seeded session is laid down again from the deterministic seed, leaving the process clock at the seed instant. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prepareRendition } from "@/modules/media/asset";
import { prepareDisplayImage } from "@/modules/media/image";
import { inspectVideo } from "@/modules/media/video";
import { removeAllMedia, seededMediaReference, writeMediaBytes } from "@/modules/store/media";
import { DATA_ROOT, isSafeSessionId, listSessionIds } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { SEED_INSTANT, setClockOffset } from "@/modules/time/clock";
import { seed, SEEDED_MEDIA_BYTES, type SeededMediaBytes, type SeededSessionWithDocuments, type SessionStateDocument } from "./seed";
const COMMITTED_FIXTURE_DIRECTORY = join(dirname(DATA_ROOT), "apps", "dashboard", "public", "fixtures", "media");
type SeededMediaAsset = SessionStateDocument["mediaAssets"][number];
type SeededRendition = SeededMediaAsset["renditions"][number];
export type ResetSummary = { readonly seededSessions: readonly string[]; readonly removedSessions: readonly string[]; readonly clockOffsetMs: 0; readonly partners: number; readonly seedInstant: string };
function assertSeedableSessionIds(sessionIds: readonly string[]): void {
  const claimedSessionIds = new Set<string>();
  for (const sessionId of sessionIds) {
    if (!isSafeSessionId(sessionId)) throw new Error(`Cannot seed session ${JSON.stringify(sessionId)}: a session id becomes a file name, so it must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`);
    if (claimedSessionIds.has(sessionId)) throw new Error(`Cannot seed two sessions as ${JSON.stringify(sessionId)}: one id names one session's documents, so the second row would overwrite the first.`);
    claimedSessionIds.add(sessionId);
  }
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
const disagreement = (entry: SeededMediaBytes, expected: string, observed: string, nextStep: string): Error =>
  new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record that serves them states ${expected}, and the bytes produced from ${entry.fixture} give ${observed}. ${nextStep}`);
function assertRecordClaimsVerifiedBytes(entry: SeededMediaBytes, asset: SeededMediaAsset): void {
  const verification = asset.tagVerification;
  if (!verification.checked || verification.residualTags.length > 0) {
    throw new Error(
      `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record states checked=${String(verification.checked)} with residual tags ${JSON.stringify([...verification.residualTags])}, so it claims no completed metadata check for the bytes it serves. Correct the asset's tagVerification in the seed once the bytes have been verified.`,
    );
  }
}
function assertImageMatchesRecord(entry: SeededMediaBytes, asset: SeededMediaAsset, rendition: SeededRendition, delivered: { format: string; width: number; height: number; mimeType: string }): void {
  const profile = asset.profileCheck;
  const agrees = profile.container === delivered.format && profile.width === delivered.width && profile.height === delivered.height && rendition.mimeType === delivered.mimeType;
  if (!agrees) {
    throw disagreement(
      entry,
      `${profile.container} ${String(profile.width)}x${String(profile.height)} served as ${rendition.mimeType}`,
      `${delivered.format} ${String(delivered.width)}x${String(delivered.height)} served as ${delivered.mimeType}`,
      "Re-measure the materialised rendition and correct the seeded profileCheck in seed.ts.",
    );
  }
}
async function assertCopiedRenditionMatchesRecord(entry: SeededMediaBytes, asset: SeededMediaAsset, rendition: SeededRendition, bytes: Uint8Array): Promise<void> {
  switch (rendition.purpose) {
    case "playback": {
      const inspected = await inspectVideo({ bytes });
      if (inspected.ok === false) {
        throw new Error(
          `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the video profile refused the committed fixture ${entry.fixture} (${inspected.code}: ${inspected.message}), so the record would describe bytes the application cannot admit. Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`,
        );
      }
      const profile = asset.profileCheck;
      const recorded = profile.durationSeconds;
      const measured = inspected.profileCheck;
      const agrees = profile.container === measured.container && profile.codec.includes(measured.codec) && profile.width === measured.width && profile.height === measured.height && recorded !== null && Math.abs(recorded - measured.durationS) < 0.01;
      if (!agrees) {
        throw disagreement(
          entry,
          `${profile.container} ${profile.codec} ${String(profile.width)}x${String(profile.height)} for ${String(recorded)} s`,
          `${measured.container} ${measured.codec} ${String(measured.width)}x${String(measured.height)} for ${String(measured.durationS)} s`,
          "Re-inspect the fixture and correct the seeded profileCheck in seed.ts.",
        );
      }
      return;
    }
    case "poster": {
      const prepared = await prepareDisplayImage({ bytes, assetId: entry.assetId, sourceName: entry.fixture });
      if (prepared.ok === false) throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the image pipeline refused the committed poster ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`);
      if (prepared.mimeType !== rendition.mimeType || prepared.tagVerification.residualTags.length > 0) {
        throw disagreement(entry, `${rendition.mimeType} with no residual metadata`, `${prepared.mimeType} with residual tags ${JSON.stringify([...prepared.tagVerification.residualTags])}`, "Restore the fixture with `bun scripts/make-media-fixtures.mjs --check`, or correct the rendition's mimeType in seed.ts.");
      }
      return;
    }
    case "captions":
    case "transcript": {
      const prepared = await prepareRendition({ assetId: entry.assetId, purpose: rendition.purpose, bytes });
      if (prepared.state === "rejected") throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the media preparation refused the committed ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`);
      if (prepared.rendition.mimeType !== rendition.mimeType) throw disagreement(entry, rendition.mimeType, prepared.rendition.mimeType, "Correct the rendition's mimeType in seed.ts, or replace the fixture with a document of the type the record states.");
      if (!sameBytes(prepared.rendition.bytes, bytes)) {
        throw disagreement(
          entry,
          "the canonical UTF-8 rendition the preparation produces",
          `different bytes (${String(prepared.rendition.bytes.byteLength)} of ${String(bytes.byteLength)})`,
          "Author the fixture so that it is already the canonical rendition, or record the prepared bytes instead of the fixture in SEEDED_MEDIA_BYTES.",
        );
      }
      return;
    }
    case "display":
      throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: a display rendition is produced by the image pipeline, so its row cannot be a plain copy. Set producedBy to "image-display" for that row in SEEDED_MEDIA_BYTES.`);
  }
}
async function materialiseSeededRendition(entry: SeededMediaBytes, asset: SeededMediaAsset, rendition: SeededRendition): Promise<void> {
  const bytesRef = seededMediaReference(entry.assetId, entry.file);
  if (rendition.bytesRef !== bytesRef) {
    throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record names ${JSON.stringify(rendition.bytesRef)}, and the row in SEEDED_MEDIA_BYTES is written to ${JSON.stringify(bytesRef)}. Correct the row, or the rendition the seed builds from it.`);
  }
  assertRecordClaimsVerifiedBytes(entry, asset);
  const fixtureBytes = new Uint8Array(await readFile(join(COMMITTED_FIXTURE_DIRECTORY, entry.fixture)));
  if (entry.producedBy === "copy") {
    await assertCopiedRenditionMatchesRecord(entry, asset, rendition, fixtureBytes);
    await writeMediaBytes(bytesRef, fixtureBytes);
    return;
  }
  const prepared = await prepareDisplayImage({
    bytes: fixtureBytes,
    assetId: entry.assetId,
    // The original's own file name, so the pipeline's leak check proves the served bytes carry no copy of it.
    sourceName: entry.fixture,
  });
  if (prepared.ok === false) throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the image pipeline refused the committed original ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`);
  assertImageMatchesRecord(entry, asset, rendition, prepared);
  if (prepared.tagVerification.residualTags.length > 0) throw disagreement(entry, "a display rendition with no residual metadata", `residual tags ${JSON.stringify([...prepared.tagVerification.residualTags])}`, "Re-author the original so the pipeline can strip it, or correct the asset's tagVerification in the seed.");
  await writeMediaBytes(bytesRef, prepared.bytes);
}
async function materialiseSeededMedia(sessions: readonly SeededSessionWithDocuments[]): Promise<void> {
  const assets = new Map<string, SeededMediaAsset>();
  for (const session of sessions) for (const asset of session.documents.state.mediaAssets) assets.set(asset.assetId, asset);
  for (const entry of SEEDED_MEDIA_BYTES) {
    const asset = assets.get(entry.assetId);
    if (asset === undefined) throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: no seeded session holds that asset, so SEEDED_MEDIA_BYTES declares bytes for a record the seed does not build. Remove the row, or seed the asset it belongs to.`);
    const rendition = asset.renditions.find((candidate) => candidate.renditionId === entry.renditionId);
    if (rendition === undefined) throw new Error(`Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the asset's record declares no such rendition. Remove the row, or add the rendition the seed should serve.`);
    await materialiseSeededRendition(entry, asset, rendition);
  }
}
/** Discards every stored session, re-seeds every seeded one, returns the process clock to the seed instant, and reports what the run did. */
export async function resetSeed(): Promise<ResetSummary> {
  const existingSessionIds = await listSessionIds();
  // One build of the whole world per reset, before the first write: every session comes from the same deterministic pass, and a seed that throws leaves the stored sessions as they were.
  const sessions = await seed();
  const seededSessionIds = sessions.map((session) => session.sessionId);
  assertSeedableSessionIds(seededSessionIds);
  const seededIdSet = new Set(seededSessionIds);
  let partners = 0;
  for (const session of sessions) partners += session.documents.state.partners.length;
  // Every byte the store owns, before the sessions that name them: an upload whose record is about to be discarded must not survive, and a byte from an earlier custody layout is named by nothing at all.
  await removeAllMedia();
  for (const sessionId of existingSessionIds) await resetSession(sessionId);
  for (const session of sessions) await resetSession(session.sessionId, session.documents);
  await materialiseSeededMedia(sessions);
  // Last, so a reset that threw above never claims a clock it did not restore.
  setClockOffset(0);
  return { seededSessions: seededSessionIds, removedSessions: existingSessionIds.filter((sessionId) => !seededIdSet.has(sessionId)), clockOffsetMs: 0, partners, seedInstant: SEED_INSTANT.toJSON() };
}
