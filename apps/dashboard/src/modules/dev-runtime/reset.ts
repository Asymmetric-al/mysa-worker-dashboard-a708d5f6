/**
 * The reset operation: every session the store holds is discarded and every seeded session is laid
 * down again from the deterministic seed.
 *
 * Plan items that put this file in scope:
 * - AAP 0.7.2 "The reset path" — `bun run reset` deletes `.data/` and re-seeds every session
 *   scenario deterministically, and the Settings screen exposes the same operation through
 *   `resetSeed` with a confirmation. Both produce byte-identical content for the readable seed, which
 *   is what lets every criterion start "from a freshly reset seed".
 * - AAP 0.6.1 "Development runtime" — `resetSeed()` is one of the names the service exposes, and it
 *   lives here rather than inside the script so the same operation serves both callers.
 * - AAP 0.12.1 criterion 21 and AAP 0.12.6 — `bun run reset` succeeds on a clean checkout.
 *
 * Two properties this module owes its callers.
 * - Repeating it leaves identical bytes. Each session is written through `resetSession`, the store's
 *   only creating path, with exactly the documents the seed builds, so a second run rewrites the same
 *   content and no document of a previous run survives into the new one.
 * - A failure surfaces. Every store fault is thrown at the caller, so a reset that could not finish
 *   is reported as a failure rather than presented as a partial success.
 *
 * Layering: a development-runtime module that imports the store's document surface, the clock's one
 * offset setter and the sibling seed module. It reads no clock of its own, writes no file itself, and
 * imports no feature, component, route or data-service value.
 */
import { DATA_ROOT, listSessionIds } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { setClockOffset } from "@/modules/time/clock";

import { SEEDED_SESSION_IDS, seedSessionDocuments } from "./seed";

/** What one reset did: where the store lives, what it removed, and what it laid down. */
export interface ResetSeedReport {
  readonly storePath: string;
  readonly removedSessionIds: readonly string[];
  readonly seededSessionIds: readonly string[];
}

/**
 * Discards every stored session and re-seeds every seeded one, returning what the run did.
 *
 * The listing comes from the store itself, so a session a browser created with its own cookie is
 * removed too — a reset that left one behind would not be the known world the criteria start from.
 * The process clock is returned to the seed instant only after every document is written, so a
 * failed reset never claims a clock it did not restore. The store directory itself is left in place:
 * it belongs to the store, and an empty one is exactly what a reset of nothing leaves behind.
 */
export async function resetSeed(): Promise<ResetSeedReport> {
  const removedSessionIds = await listSessionIds();
  for (const sessionId of removedSessionIds) {
    await resetSession(sessionId);
  }

  const seededSessionIds: string[] = [];
  for (const sessionId of SEEDED_SESSION_IDS) {
    await resetSession(sessionId, seedSessionDocuments(sessionId));
    seededSessionIds.push(sessionId);
  }

  setClockOffset(0);
  return { storePath: DATA_ROOT, removedSessionIds, seededSessionIds };
}
