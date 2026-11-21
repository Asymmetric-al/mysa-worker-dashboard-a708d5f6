/**
 * The reset operation: every session the store holds is discarded and every seeded session is laid
 * down again from the deterministic seed, leaving the process clock at the seed instant.
 *
 * One reset path, three callers. `bun run reset` (`scripts/reset.ts`), the Settings control (through
 * `data-service/mutations/dev.ts#resetSeed` behind `/api/dev`) and the Playwright project, which
 * resets before a spec acts so a run never inherits the previous one, all come through this function
 * rather than rebuilding a world of their own.
 *
 * What a reset leaves behind:
 * - Exactly the seeded sessions. Every session the store lists is discarded first, so a session a
 *   browser minted with its own cookie, or a row the seed no longer describes, cannot survive into
 *   the known world every criterion starts from.
 * - Exactly the seeded media bytes, in the store's own custody. `.data/media` is discarded with the
 *   sessions it belongs to — an uploaded rendition whose record has gone must not outlive it, and a byte
 *   from an earlier layout must not survive into a fresh world — and then every rendition the seed's
 *   table names is materialised there: a committed fixture is copied as it stands, and the image's display
 *   rendition is produced from the committed EXIF original by the application's own image pipeline. Each
 *   materialised rendition is then verified against the record that will serve it, because a reset that
 *   left a record contradicting its bytes would poison every criterion that starts from it.
 * - Identical bytes on a second run. Each session is written through `resetSession`, the store's only
 *   creating path, with exactly the documents `seed()` builds; the store serialises keys in a fixed
 *   order and nothing here adds a timestamp, a random id or a "last reset at" field to a document, so
 *   repeating the reset rewrites the same content. The media bytes are reproduced from the same committed
 *   fixtures by the same deterministic pipelines, so they are identical too. When the reset ran is
 *   reported in the return value, never stored.
 * - The clock back at `SEED_INSTANT`. The offset is set last, so a reset that failed part way never
 *   claims a clock it did not restore. Applying a session's own persisted offset is
 *   `scenario.ts#applySessionClock`'s job when that session becomes active.
 * - No workload document. `.workload.json` is deliberately not seeded: the large dataset is built by
 *   `bun run seed:workload`, so the readable seed stays small and the two steps stay explicit. A
 *   reset therefore removes a previously generated workload, and the measurement step must follow it.
 *
 * A failure surfaces. Every store fault is thrown to the caller — the Settings mutation maps it to
 * the `unavailable` outcome and `scripts/reset.ts` exits non-zero — because a reset reported as a
 * success it did not achieve is worse than no reset at all. Nothing is written until the whole world
 * has been built, so a seed that throws leaves the stored sessions untouched, and a rendition that cannot
 * be produced or that disagrees with its record fails with the asset, the expected and the measured value
 * rather than being written quietly.
 *
 * Ordering: the store serialises writes per session, not globally, so a reset is the operator action
 * that precedes a run and is never called concurrently with a live spec. The documented flow runs
 * Vitest before Playwright, and the browser suite resets before each spec, so the two never
 * interleave.
 *
 * Layering: a development-runtime module that imports the store's document surface and media custody, the
 * clock's one offset setter, the application's own image and video preparation, and the sibling seed
 * module. It reads no clock of its own and imports no feature, component, route or data-service value; the
 * only files it opens are the committed fixtures the seed's table names, and every write goes through the
 * store's media custody.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { prepareRendition } from "@/modules/media/asset";
import { prepareDisplayImage } from "@/modules/media/image";
import { inspectVideo } from "@/modules/media/video";
import { removeAllMedia, seededMediaReference, writeMediaBytes } from "@/modules/store/media";
import { DATA_ROOT, isSafeSessionId, listSessionIds } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { SEED_INSTANT, setClockOffset } from "@/modules/time/clock";

import {
  seed,
  SEEDED_MEDIA_BYTES,
  type SeededMediaBytes,
  type SeededSessionWithDocuments,
  type SessionStateDocument,
} from "./seed";

/**
 * The committed fixtures a reset reads the seeded renditions from.
 *
 * They are inputs to the seed and are never served: the bytes a request can reach are the ones custody keeps.
 * The directory is derived from the store's own answer for the data root — `.data` is a direct child of the
 * repository root — rather than by walking up from the working directory a second time.
 */
const COMMITTED_FIXTURE_DIRECTORY = join(
  dirname(DATA_ROOT),
  "apps",
  "dashboard",
  "public",
  "fixtures",
  "media",
);

/** One seeded asset, as the state document a session starts from stores it. */
type SeededMediaAsset = SessionStateDocument["mediaAssets"][number];

/** One seeded asset's rendition, as that same document stores it. */
type SeededRendition = SeededMediaAsset["renditions"][number];

/** What one reset did: the sessions it laid down, the ids that disappeared, and the instant it anchored. */
export interface ResetSummary {
  /**
   * The ids `seed()` returned, in seeded order. Each one had its document set replaced, whether or
   * not the store already held it.
   */
  readonly seededSessions: readonly string[];
  /**
   * The ids the store held before the reset and does not hold after it: a session a browser created
   * that the seed does not describe, or a row the seed has stopped seeding. A re-seeded id belongs to
   * `seededSessions` instead, because it was replaced rather than removed.
   */
  readonly removedSessions: readonly string[];
  /** The process clock offset the reset leaves behind, always `0`: after a reset, `now()` is `SEED_INSTANT`. */
  readonly clockOffsetMs: 0;
  /** How many partner records the seed laid down across every session, for the caller's log line. */
  readonly partners: number;
  /** `SEED_INSTANT` as ISO text, so a caller reports the anchored instant without importing the clock. */
  readonly seedInstant: string;
}

/**
 * Refuses a seeded id the store could not use as a file name, or two seeded rows claiming one id.
 *
 * `sessionPaths` would refuse an unsafe id too, but only once the existing sessions had already been
 * discarded; checking before the first write keeps a bad row from destroying a readable world.
 */
function assertSeedableSessionIds(sessionIds: readonly string[]): void {
  const claimedSessionIds = new Set<string>();

  for (const sessionId of sessionIds) {
    if (!isSafeSessionId(sessionId)) {
      throw new Error(
        `Cannot seed session ${JSON.stringify(sessionId)}: a session id becomes a file name, so it must be 1 to 64 characters drawn only from A-Z, a-z, 0-9, underscore and hyphen.`,
      );
    }

    if (claimedSessionIds.has(sessionId)) {
      throw new Error(
        `Cannot seed two sessions as ${JSON.stringify(sessionId)}: one id names one session's documents, so the second row would overwrite the first.`,
      );
    }

    claimedSessionIds.add(sessionId);
  }
}

/** Reports whether two byte sequences hold the same bytes. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** How a materialised rendition disagreed with the record that serves it, in the words the operator needs. */
function disagreement(
  entry: SeededMediaBytes,
  expected: string,
  observed: string,
  nextStep: string,
): Error {
  return new Error(
    `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record that serves them states ${expected}, and the bytes produced from ${entry.fixture} give ${observed}. ${nextStep}`,
  );
}

/**
 * Refuses a rendition whose record claims no completed metadata check.
 *
 * `tagVerification` is a claim about the bytes an asset serves, so a record that never had the check run —
 * or that found a residual descriptive tag — is not a rendition a reset may lay down: the serving read would
 * hand out bytes the record itself says were not verified.
 */
function assertRecordClaimsVerifiedBytes(entry: SeededMediaBytes, asset: SeededMediaAsset): void {
  const verification = asset.tagVerification;
  if (!verification.checked || verification.residualTags.length > 0) {
    throw new Error(
      `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record states checked=${String(verification.checked)} with residual tags ${JSON.stringify([...verification.residualTags])}, so it claims no completed metadata check for the bytes it serves. Correct the asset's tagVerification in the seed once the bytes have been verified.`,
    );
  }
}

/**
 * Verifies the image pipeline's delivered rendition against the record that will serve it.
 *
 * The record states the served bytes' own profile — the display rendition is what a request receives, so its
 * container, width and height are what a surface may show — and the pipeline is what states them. A
 * disagreement means one of the two was measured against different bytes.
 */
function assertImageMatchesRecord(
  entry: SeededMediaBytes,
  asset: SeededMediaAsset,
  rendition: SeededRendition,
  delivered: { format: string; width: number; height: number; mimeType: string },
): void {
  const profile = asset.profileCheck;
  const agrees =
    profile.container === delivered.format &&
    profile.width === delivered.width &&
    profile.height === delivered.height &&
    rendition.mimeType === delivered.mimeType;

  if (!agrees) {
    throw disagreement(
      entry,
      `${profile.container} ${String(profile.width)}x${String(profile.height)} served as ${rendition.mimeType}`,
      `${delivered.format} ${String(delivered.width)}x${String(delivered.height)} served as ${delivered.mimeType}`,
      "Re-measure the materialised rendition and correct the seeded profileCheck in seed.ts.",
    );
  }
}

/**
 * Verifies one plain-copied rendition against the record that will serve it, through the application's own
 * inspection for its purpose.
 *
 * The bytes are the committed fixture as it stands, so the record cannot state a profile of its own for them
 * the way an upload's record does: what is checkable is that the bytes are what the record says they are —
 * the admitted container for a playback rendition, an image carrying no metadata for a poster, and a WebVTT
 * document for a caption track.
 */
async function assertCopiedRenditionMatchesRecord(
  entry: SeededMediaBytes,
  asset: SeededMediaAsset,
  rendition: SeededRendition,
  bytes: Uint8Array,
): Promise<void> {
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
      const agrees =
        profile.container === measured.container &&
        profile.codec.includes(measured.codec) &&
        profile.width === measured.width &&
        profile.height === measured.height &&
        recorded !== null &&
        Math.abs(recorded - measured.durationS) < 0.01;

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
      const prepared = await prepareDisplayImage({
        bytes,
        assetId: entry.assetId,
        sourceName: entry.fixture,
      });
      if (prepared.ok === false) {
        throw new Error(
          `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the image pipeline refused the committed poster ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`,
        );
      }
      if (prepared.mimeType !== rendition.mimeType || prepared.tagVerification.residualTags.length > 0) {
        throw disagreement(
          entry,
          `${rendition.mimeType} with no residual metadata`,
          `${prepared.mimeType} with residual tags ${JSON.stringify([...prepared.tagVerification.residualTags])}`,
          "Restore the fixture with `bun scripts/make-media-fixtures.mjs --check`, or correct the rendition's mimeType in seed.ts.",
        );
      }
      return;
    }
    case "captions":
    case "transcript": {
      const prepared = await prepareRendition({
        assetId: entry.assetId,
        purpose: rendition.purpose,
        bytes,
      });
      if (prepared.state === "rejected") {
        throw new Error(
          `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the media preparation refused the committed ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`,
        );
      }
      if (prepared.rendition.mimeType !== rendition.mimeType) {
        throw disagreement(
          entry,
          rendition.mimeType,
          prepared.rendition.mimeType,
          "Correct the rendition's mimeType in seed.ts, or replace the fixture with a document of the type the record states.",
        );
      }
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
      throw new Error(
        `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: a display rendition is produced by the image pipeline, so its row cannot be a plain copy. Set producedBy to "image-display" for that row in SEEDED_MEDIA_BYTES.`,
      );
  }
}

/**
 * Produces one seeded rendition's bytes and writes them into custody, verifying them against the record that
 * will serve them first, so bytes that disagree with their record are never laid down.
 */
async function materialiseSeededRendition(
  entry: SeededMediaBytes,
  asset: SeededMediaAsset,
  rendition: SeededRendition,
): Promise<void> {
  const bytesRef = seededMediaReference(entry.assetId, entry.file);
  if (rendition.bytesRef !== bytesRef) {
    throw new Error(
      `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the record names ${JSON.stringify(rendition.bytesRef)}, and the row in SEEDED_MEDIA_BYTES is written to ${JSON.stringify(bytesRef)}. Correct the row, or the rendition the seed builds from it.`,
    );
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
  if (prepared.ok === false) {
    throw new Error(
      `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the image pipeline refused the committed original ${entry.fixture} (${prepared.code}: ${prepared.message}). Restore the fixture with \`bun scripts/make-media-fixtures.mjs --check\`.`,
    );
  }
  assertImageMatchesRecord(entry, asset, rendition, prepared);
  if (prepared.tagVerification.residualTags.length > 0) {
    throw disagreement(
      entry,
      "a display rendition with no residual metadata",
      `residual tags ${JSON.stringify([...prepared.tagVerification.residualTags])}`,
      "Re-author the original so the pipeline can strip it, or correct the asset's tagVerification in the seed.",
    );
  }
  await writeMediaBytes(bytesRef, prepared.bytes);
}

/**
 * Lays down every byte the seeded inventory serves, verified against the record that serves it.
 *
 * The seeded assets are collected from the documents `seed()` just built, so the check compares the bytes
 * against the very records the reset is about to write rather than against a second reading of the seed. A
 * row whose asset or rendition the seed no longer builds is refused for the same reason: custody would then
 * hold a file no record names.
 */
async function materialiseSeededMedia(sessions: readonly SeededSessionWithDocuments[]): Promise<void> {
  const assets = new Map<string, SeededMediaAsset>();
  for (const session of sessions) {
    for (const asset of session.documents.state.mediaAssets) {
      assets.set(asset.assetId, asset);
    }
  }

  for (const entry of SEEDED_MEDIA_BYTES) {
    const asset = assets.get(entry.assetId);
    if (asset === undefined) {
      throw new Error(
        `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: no seeded session holds that asset, so SEEDED_MEDIA_BYTES declares bytes for a record the seed does not build. Remove the row, or seed the asset it belongs to.`,
      );
    }
    const rendition = asset.renditions.find(
      (candidate) => candidate.renditionId === entry.renditionId,
    );
    if (rendition === undefined) {
      throw new Error(
        `Cannot lay down the seeded media bytes for ${entry.assetId} ${entry.renditionId}: the asset's record declares no such rendition. Remove the row, or add the rendition the seed should serve.`,
      );
    }

    await materialiseSeededRendition(entry, asset, rendition);
  }
}

/**
 * Discards every stored session, re-seeds every seeded one, returns the process clock to the seed
 * instant, and reports what the run did.
 *
 * The listing is taken before anything is written, so the removal set describes the store as the
 * caller found it rather than a store this reset had already emptied. Every listed id is discarded
 * with `resetSession` and every seeded id is then written with its three documents, so the store
 * afterwards holds exactly the seeded sessions and no document of a previous set survives. The media tree
 * goes with them — a discarded session's uploads must not outlive it — and the seeded renditions are
 * materialised last, so the bytes a record names are on disk before the reset reports success.
 */
export async function resetSeed(): Promise<ResetSummary> {
  const existingSessionIds = await listSessionIds();

  // One build of the whole world per reset, before the first write: every session comes from the same
  // deterministic pass, and a seed that throws leaves the stored sessions as they were.
  const sessions = await seed();

  const seededSessionIds = sessions.map((session) => session.sessionId);
  assertSeedableSessionIds(seededSessionIds);
  const seededIdSet = new Set(seededSessionIds);

  let partners = 0;
  for (const session of sessions) {
    partners += session.documents.state.partners.length;
  }

  // Every byte the store owns, before the sessions that name them: an upload whose record is about to be
  // discarded must not survive, and a byte from an earlier custody layout is named by nothing at all.
  await removeAllMedia();

  for (const sessionId of existingSessionIds) {
    await resetSession(sessionId);
  }

  for (const session of sessions) {
    await resetSession(session.sessionId, session.documents);
  }

  await materialiseSeededMedia(sessions);

  // Last, so a reset that threw above never claims a clock it did not restore.
  setClockOffset(0);

  return {
    seededSessions: seededSessionIds,
    removedSessions: existingSessionIds.filter((sessionId) => !seededIdSet.has(sessionId)),
    clockOffsetMs: 0,
    partners,
    seedInstant: SEED_INSTANT.toJSON(),
  };
}
