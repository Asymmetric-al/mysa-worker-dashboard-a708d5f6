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
 * - Identical bytes on a second run. Each session is written through `resetSession`, the store's only
 *   creating path, with exactly the documents `seed()` builds; the store serialises keys in a fixed
 *   order and nothing here adds a timestamp, a random id or a "last reset at" field to a document, so
 *   repeating the reset rewrites the same content. When the reset ran is reported in the return
 *   value, never stored.
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
 * has been built, so a seed that throws leaves the stored sessions untouched.
 *
 * Ordering: the store serialises writes per session, not globally, so a reset is the operator action
 * that precedes a run and is never called concurrently with a live spec. The documented flow runs
 * Vitest before Playwright, and the browser suite resets before each spec, so the two never
 * interleave.
 *
 * Layering: a development-runtime module that imports the store's document surface, the clock's one
 * offset setter and the sibling seed module. It reads no clock of its own, writes no file itself and
 * imports no feature, component, route or data-service value.
 */
import { isSafeSessionId, listSessionIds } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { SEED_INSTANT, setClockOffset } from "@/modules/time/clock";

import { seed } from "./seed";

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

/**
 * Discards every stored session, re-seeds every seeded one, returns the process clock to the seed
 * instant, and reports what the run did.
 *
 * The listing is taken before anything is written, so the removal set describes the store as the
 * caller found it rather than a store this reset had already emptied. Every listed id is discarded
 * with `resetSession` and every seeded id is then written with its three documents, so the store
 * afterwards holds exactly the seeded sessions and no document of a previous set survives.
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

  for (const sessionId of existingSessionIds) {
    await resetSession(sessionId);
  }

  for (const session of sessions) {
    await resetSession(session.sessionId, session.documents);
  }

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
