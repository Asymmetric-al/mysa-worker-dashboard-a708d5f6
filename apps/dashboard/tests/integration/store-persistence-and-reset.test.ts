/** Store persistence, atomic writes, session isolation and the deterministic reset: success criteria 2 and 21. */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newOperationId } from "@/lib/ids";
import { mutations, reads, type MutationOutcome, type Scope } from "@/modules/data-service";
import { resolveSession } from "@/modules/data-service/authorize";
import { DEFAULT_WORKLOAD_SESSION_ID, WORKLOAD_GIFT_COUNT, WORKLOAD_PARTNER_COUNT, generateWorkload } from "@/modules/dev-runtime/generate";
import { resetSeed } from "@/modules/dev-runtime/reset";
import { SEEDED_SESSION_IDS, seed, seedSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { existsOnDisk, readJson, removeIfExists, writeJsonAtomic } from "@/modules/store/atomic";
import { DATA_ROOT, listSessionIds, sessionPaths, type SessionDocuments } from "@/modules/store/paths";
import { readSession, resetSession } from "@/modules/store/repository";
const PRIMARY_SESSION = "it-store-persistence";
const ALT_SESSION = "it-store-persistence-alt";
const SEEDED_CONTENT_SESSION = "established-worker";
const PREPARATION_NOTE = "Written by the store integration test, to prove an accepted edit reaches the disk.";
function documentsFor(sessionId: string): SessionDocuments {
  const documents = seedSessionDocuments(SEEDED_CONTENT_SESSION);
  const state = documents.state as SessionStateDocument;
  return { ...documents, state: { ...state, context: { ...state.context, sessionId } } };
}
/** Lays one session down through the store's creating path, so its files are the seed's own bytes. */
async function layDownSession(sessionId: string): Promise<void> {
  await resetSession(sessionId, documentsFor(sessionId));
}
async function stateOnDisk(sessionId: string): Promise<SessionStateDocument> {
  const state = await readJson<SessionStateDocument>(sessionPaths(sessionId).state);
  if (state === undefined) throw new Error(`The session ${JSON.stringify(sessionId)} holds no state document on disk.`);
  return state;
}
async function partnerIdsOnDisk(sessionId: string): Promise<string[]> {
  const state = await stateOnDisk(sessionId);
  return state.partners.map((record) => record.partnerId);
}
async function sha256Of(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function documentDigests(sessionId: string): Promise<{ state: string; operations: string; meta: string }> {
  const paths = sessionPaths(sessionId);
  return { state: await sha256Of(paths.state), operations: await sha256Of(paths.operations), meta: await sha256Of(paths.meta) };
}
async function ledgerOperationIds(sessionId: string): Promise<string[]> {
  const document = await readJson<{ readonly entries?: readonly { readonly operationId: string }[]; readonly records?: Readonly<Record<string, { readonly operationId: string }>> }>(sessionPaths(sessionId).operations);
  if (document === undefined) return [];
  const fromEntries = (document.entries ?? []).map((entry) => entry.operationId);
  const fromRecords = Object.values(document.records ?? {}).map((entry) => entry.operationId);
  return [...fromEntries, ...fromRecords].sort();
}
async function seededStateDigests(): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const sessionId of SEEDED_SESSION_IDS) {
    digests[sessionId] = await sha256Of(sessionPaths(sessionId).state);
  }
  return digests;
}
async function filesEndingWith(suffix: string): Promise<string[]> {
  const entries = await readdir(DATA_ROOT);
  return entries.filter((name) => name.endsWith(suffix));
}
type PreparationInput = Parameters<typeof mutations.partnerPreparation.createPrivatePreparation>[0];
/** One accepted private preparation, with the input that produced it so the same attempt can be replayed. */
interface PreparationWrite {
  readonly input: PreparationInput;
  readonly operationId: string;
  readonly revision: string;
  readonly created: readonly string[];
  readonly addedPartnerIds: readonly string[];
}
/** The context a session acts in, taken from the one resolver rather than assembled by this file. */
async function scopeOf(sessionId: string): Promise<Scope> {
  const resolution = await resolveSession({ sessionId });
  if (!resolution.ok) throw new Error(`The store session ${JSON.stringify(sessionId)} was refused (${resolution.refusal.kind}), so no change can be applied in it.`);
  if (resolution.session.selected === null) throw new Error(`The store session ${JSON.stringify(sessionId)} has selected no context, so no change can be applied in it.`);
  return resolution.session.selected;
}
function acceptedFrom(outcome: MutationOutcome, subject: string): { revision: string; created: readonly string[] } {
  if (outcome.outcome !== "accepted") throw new Error(`The ${subject} answered "${outcome.outcome}" instead of "accepted", so no accepted edit exists to persist.`);
  return { revision: outcome.revision, created: outcome.created ?? [] };
}
async function createPreparation(sessionId: string, displayName: string): Promise<PreparationWrite> {
  const scope = await scopeOf(sessionId);
  const roster = await reads.partners.findPartners({}, { sessionId });
  if (roster.kind !== "envelope") throw new Error(`The roster read for ${JSON.stringify(sessionId)} answered "${roster.kind}" instead of an envelope.`);
  const before = await partnerIdsOnDisk(sessionId);
  const operationId = newOperationId();
  const input: PreparationInput = { operationId, scope, expectedRevision: roster.envelope.revision, payload: { displayName, note: PREPARATION_NOTE } };
  const accepted = acceptedFrom(await mutations.partnerPreparation.createPrivatePreparation(input, { sessionId }), "private preparation");
  const addedPartnerIds = (await partnerIdsOnDisk(sessionId)).filter((partnerId) => !before.includes(partnerId));
  return { input, operationId, revision: accepted.revision, created: accepted.created, addedPartnerIds };
}
/** A display name no seeded record already carries, so a roster search can only match the record this case created. */
function probeName(subject: string): string {
  return `Store probe ${subject} ${newOperationId().slice(0, 8)}`;
}

describe("the file-backed store", () => {
  // Every case starts from the seed's own bytes written under this file's session ids, so no case depends
  // on what an earlier one wrote and no other suite can hand this file a session.
  beforeEach(async () => {
    await layDownSession(PRIMARY_SESSION);
    await layDownSession(ALT_SESSION);
  });
  it("keeps an accepted edit for a fresh read, an on-disk read and a re-imported module, so persistence is not a memory cache", async () => {
    const displayName = probeName("primary");
    const write = await createPreparation(PRIMARY_SESSION, displayName);
    expect(write.addedPartnerIds).toHaveLength(1);
    const [partnerId] = write.addedPartnerIds;
    if (partnerId === undefined) throw new Error("The accepted preparation added no partner record, so there is no accepted edit to persist.");
    expect(write.created[0]).toBe(partnerId);
    const reopened = await readSession(PRIMARY_SESSION);
    if (reopened === undefined) throw new Error(`The session ${PRIMARY_SESSION} was written and then read back as absent.`);
    const reopenedState = reopened.state as SessionStateDocument;
    const stored = reopenedState.partners.filter((record) => record.partnerId === partnerId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revision).toBe(write.revision);
    expect(reopenedState.privateNotes.filter((note) => note.partnerId === partnerId)).toHaveLength(1);
    expect(await partnerIdsOnDisk(PRIMARY_SESSION)).toContain(partnerId);
    // (c) A re-imported module holds no memory of the write, so whatever it answers came from disk:
    // `vi.resetModules()` plus a dynamic import stand in for the server restart a refresh survives.
    vi.resetModules();
    const restartedStore = await import("@/modules/store/repository");
    const restartedService = await import("@/modules/data-service");
    const afterRestart = await restartedStore.readSession(PRIMARY_SESSION);
    if (afterRestart === undefined) throw new Error(`The session ${PRIMARY_SESSION} was unreadable from a re-imported store module.`);
    const restartedState = afterRestart.state as SessionStateDocument;
    expect(restartedState.partners.filter((record) => record.partnerId === partnerId)).toHaveLength(1);
    const roster = await restartedService.reads.partners.findPartners({ search: displayName }, { sessionId: PRIMARY_SESSION });
    if (roster.kind !== "envelope") throw new Error(`The roster read from a re-imported service answered "${roster.kind}" instead of an envelope.`);
    expect(roster.envelope.data.rows.map((row) => row.partner.partnerId)).toEqual([partnerId]);
  }, 60_000);
  it("refuses a value it cannot serialise without truncating the document or leaving a temp file behind", async () => {
    const probePath = path.join(DATA_ROOT, `${PRIMARY_SESSION}-atomic-probe.json`);
    const previous = { version: 1, records: [{ recordId: "kept", revision: "rev-1" }] };
    await writeJsonAtomic(probePath, previous);
    const before = await readFile(probePath);
    // A circular structure has no JSON form, and neither has a bigint: both are refused before any I/O, so
    // a rejected value cannot reach the file at all.
    const circular: Record<string, unknown> = { version: 1 };
    circular.self = circular;
    await expect(writeJsonAtomic(probePath, circular)).rejects.toThrow(TypeError);
    await expect(writeJsonAtomic(probePath, { version: 1, unrepresentable: 1n })).rejects.toThrow(TypeError);
    // The target is byte for byte the document that was already there, so nothing truncated it and no
    // partial document took its place.
    const after = await readFile(probePath);
    expect(after.equals(before)).toBe(true);
    expect(await readJson(probePath)).toEqual(previous);
    // The writer's temp file is in the target's own directory and is cleaned up on failure, so a crashed
    // write leaves the previous document and nothing else.
    const leftovers = (await readdir(DATA_ROOT)).filter((name) => name.startsWith(`${PRIMARY_SESSION}-atomic-probe.json.`) && name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    await removeIfExists(probePath);
  });
  it("keeps two sessions' documents and ledgers apart, so one session's attempt never answers in the other", async () => {
    const primaryWrite = await createPreparation(PRIMARY_SESSION, probeName("isolation primary"));
    expect(primaryWrite.addedPartnerIds).toHaveLength(1);
    const primaryBefore = await documentDigests(PRIMARY_SESSION);
    const altWrite = await createPreparation(ALT_SESSION, probeName("isolation alt"));
    expect(altWrite.addedPartnerIds).toHaveLength(1);
    expect(await documentDigests(PRIMARY_SESSION)).toEqual(primaryBefore);
    // Each ledger holds exactly its own attempt. The ledger document is what a replay is answered from, so
    // the other session's identifier being absent here is a lookup in this ledger finding nothing.
    expect(await ledgerOperationIds(PRIMARY_SESSION)).toEqual([primaryWrite.operationId]);
    expect(await ledgerOperationIds(ALT_SESSION)).toEqual([altWrite.operationId]);
    const isolatedPartnerId = altWrite.addedPartnerIds[0];
    if (isolatedPartnerId === undefined) throw new Error("The second session's accepted preparation added no partner record.");
    // Replaying the attempt in the session that owns it answers from the stored record instead of applying a
    // second effect, which is what makes its absence in the other ledger the whole of the isolation claim.
    const replay = await mutations.partnerPreparation.createPrivatePreparation(altWrite.input, { sessionId: ALT_SESSION });
    expect(replay.outcome).toBe("alreadyAccepted");
    if (replay.outcome !== "alreadyAccepted") throw new Error(`The replayed preparation answered "${replay.outcome}" instead of "alreadyAccepted".`);
    expect(replay.revision).toBe(altWrite.revision);
    expect((await partnerIdsOnDisk(ALT_SESSION)).filter((partnerId) => partnerId === isolatedPartnerId)).toHaveLength(1);
    const primaryPartners = await partnerIdsOnDisk(PRIMARY_SESSION);
    expect(primaryPartners).toEqual(expect.arrayContaining([...primaryWrite.addedPartnerIds]));
    expect(primaryPartners).not.toContain(isolatedPartnerId);
    // Both sessions are reported, each exactly once: a store that merged them would answer one list for two
    // sets of documents.
    const sessionIds = await listSessionIds();
    expect(sessionIds.filter((sessionId) => sessionId === PRIMARY_SESSION)).toHaveLength(1);
    expect(sessionIds.filter((sessionId) => sessionId === ALT_SESSION)).toHaveLength(1);
  });
  it("leaves a discarded session absent and refuses it, rather than inventing a principal", async () => {
    await resetSession(ALT_SESSION);
    const paths = sessionPaths(ALT_SESSION);
    expect(await existsOnDisk(paths.state)).toBe(false);
    expect(await existsOnDisk(paths.operations)).toBe(false);
    expect(await existsOnDisk(paths.meta)).toBe(false);
    // The other session is still there, so what is absent is this session and not the store itself: an
    // absent root is an outage and `readSession` reports it as one, never as a missing record.
    expect(await readSession(PRIMARY_SESSION)).toBeDefined();
    expect(await readSession(ALT_SESSION)).toBeUndefined();
    // The resolver refuses the unknown session instead of answering for a fabricated identity, which is what
    // keeps production behaviour from falling back to fixtures.
    const resolution = await resolveSession({ sessionId: ALT_SESSION });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error(`The discarded session ${ALT_SESSION} resolved, so the resolver invented a principal for it.`);
    expect(resolution.refusal.kind).toBe("denied");
    if (resolution.refusal.kind !== "denied") throw new Error(`The discarded session ${ALT_SESSION} was refused as "${resolution.refusal.kind}" instead of a denial.`);
    expect(resolution.refusal.denied.reasonCode).toBe("session-unavailable");
  });
});

describe("the deterministic reset", () => {
  it("discards every stored session before re-seeding the root, and lays down identical bytes on every run", async () => {
    // This case runs the global reset, because `resetSeed()` discards every session the store root holds rather
    // than one session; each case here lays its own sessions down first, so a session is recreated on demand.
    // The root is shared with the other suites, so this case asserts what the reset owns: the seeded documents
    // are present and byte-identical afterwards, and the stray document and this file's own session are gone.
    //
    // The probe is a session document with no session behind it: a file directly under the root that
    // `listSessionIds()` reports and nothing can read. The reset discards every such document and every
    // media byte under the root, so a document it did not lay down cannot survive it.
    const straySession = `${PRIMARY_SESSION}-stray`;
    const strayStatePath = sessionPaths(straySession).state;
    await writeJsonAtomic(strayStatePath, { version: 1, context: { sessionId: straySession } });
    await layDownSession(ALT_SESSION);
    const first = await resetSeed();
    expect(await existsOnDisk(strayStatePath)).toBe(false);
    expect([...first.removedSessions]).toEqual(expect.arrayContaining([ALT_SESSION, straySession]));
    expect(first.clockOffsetMs).toBe(0);
    expect([...first.seededSessions].sort()).toEqual([...SEEDED_SESSION_IDS].sort());
    for (const sessionId of SEEDED_SESSION_IDS) {
      expect(await readSession(sessionId)).toBeDefined();
    }
    // Every seeded session is present afterwards, under the state document the reset laid down for it. The
    // root is shared, so presence is what the reset owns — never the absence of every other suite's documents.
    expect(await listSessionIds()).toEqual(expect.arrayContaining([...SEEDED_SESSION_IDS].sort()));
    expect(await filesEndingWith(".state.json")).toEqual(expect.arrayContaining(SEEDED_SESSION_IDS.map((sessionId) => `${sessionId}.state.json`).sort()));
    const firstDigests = await seededStateDigests();
    const second = await resetSeed();
    expect(second.clockOffsetMs).toBe(0);
    // Two runs lay down byte-identical readable seed documents, so a reset restores a known world rather
    // than building a similar one.
    expect(await seededStateDigests()).toEqual(firstDigests);
    const workloadDocuments = await filesEndingWith(".workload.json");
    expect(workloadDocuments.filter((name) => SEEDED_SESSION_IDS.some((sessionId) => name.startsWith(`${sessionId}.`)))).toEqual([]);
    const seeded = await seed();
    expect(seeded.every((session) => !Object.hasOwn(session.documents, "workload"))).toBe(true);
    const seededPartners = seeded.reduce((total, session) => total + session.documents.state.partners.length, 0);
    const seededGifts = seeded.reduce((total, session) => total + session.documents.state.gifts.length, 0);
    expect(seededPartners).toBeGreaterThan(0);
    expect(seededPartners).toBeLessThan(WORKLOAD_PARTNER_COUNT);
    expect(seededGifts).toBeLessThan(WORKLOAD_GIFT_COUNT);
    expect(SEEDED_SESSION_IDS).toContain(DEFAULT_WORKLOAD_SESSION_ID);
    expect(typeof generateWorkload).toBe("function");
  }, 180_000);
});

// This file's sessions are discarded last, so a later run starts from the store's own bytes rather than from
// this file's fixtures; `.data/` is git-ignored, so nothing here is a tracked artefact either way.
afterAll(async () => {
  await resetSession(PRIMARY_SESSION);
  await resetSession(ALT_SESSION);
});
