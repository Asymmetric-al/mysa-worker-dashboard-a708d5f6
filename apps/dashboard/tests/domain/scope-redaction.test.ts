/**
 * Proves the authorisation boundary of success criteria 3 and 19 at the service: a refused read
 * discloses no count, title, existence flag or size; a search, a sort or a page cannot be turned into
 * a disclosure oracle; a private note and a private preparation never reach a shared projection, an
 * export or a coach; two records that look identical stay two records because nothing joins on a name,
 * an email address or a postal address; and the envelope's value-state map keeps a genuine zero,
 * an unknown, a withheld value, an unavailable source and the derived incomplete subtotal five
 * separate facts.
 *
 * The second worker and the unauthorized reader reach the service through `resolveSession` over their
 * own seeded sessions, which is what makes "authorisation precedes enumeration" a property of the
 * service rather than of a screen.
 *
 * Divergences from the file brief, each settled where the service fixed a detail the brief left open:
 *
 * - The partner, interaction, support and coach-subject reads take a `SessionSource`, so a second
 *   identity is driven as a genuinely different seeded session rather than a hand-built scope. The
 *   audience and receiving reads, and the coach portfolio read, take no source at all: they resolve the
 *   request cookie. A framework-free test has no request, so the protected-read refusal is asserted
 *   through `canReadProtected`, the one function those reads authorise with (`reads/audience.ts` calls
 *   it), and the store-backed form belongs to `tests/integration/coach-read-boundary.test.ts`.
 * - No read accepts a `scope`: scope is resolved from the session, which is exactly the property under
 *   test. A claimed scope exists only on the write path, so "the scope is never taken from the request
 *   body" is asserted there, on the one input that could carry a claim.
 * - The seed states no financial value as `withheld`, and no seeded read records one, so that member is
 *   asserted on `buildEnvelope` — the single function that derives the map — beside the six-member
 *   vocabulary and the boundary schema that refuses the derived member. The seeded `zero` and
 *   `incomplete-subtotal` values, and the `unavailable` read result, are asserted on real reads.
 * - The seed carries no two records sharing a display name, an email address and a postal address, so
 *   the pair is created deliberately through two `createPrivatePreparation` attempts, then searched for.
 * - The seed copies one ministry's records into each identity's own world, and every seeded private note
 *   is authored by the principal whose session holds it, so no seeded session can put a colleague in
 *   front of another principal's note. The colleague's private read is therefore driven through a
 *   session laid down as the worker's record set under the colleague's own metadata: one ministry's
 *   store, two principals, which is the state the per-note principal test exists for.
 * - `resolveSession` answers a session whose core documents are incomplete with the store outage it is,
 *   which is the one honest route to the `unavailable` arm; the fixture that demonstrates it holds a
 *   state and a meta document and no operation ledger, so the store itself raises the fault.
 * - The protected-media arm lays the world the receiving reads answer a reader from under the literal
 *   session id they name, through `resetSession` and from the seed's own documents, plus one protected
 *   edition and the one membership row that edition's grant names. The seed's own video asset is placed
 *   by a public page edition, so every reader is genuinely admitted to it; a second asset, in a custody
 *   lane of its own and placed by the protected edition alone, is what makes an edition's media
 *   protected. Its bytes are the committed fixtures, copied with `writeMediaBytes` — the copy a reset's
 *   own branch performs — because a whole-store reset is not this file's to run.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { mutations, reads } from "@/modules/data-service";
import { canExport, canReadProtected, canView, resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import {
  VALUE_STATES,
  buildEnvelope,
  recordedValueStateSchema,
  sameScope,
  type PartnerRecord,
  type Scope,
  type ValueState,
} from "@/modules/data-service/envelope";
import { DENIAL_REASONS, isOutcome, isReadResult, type DeniedOutcome, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, SEEDED_MEDIA_BYTES, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { removeIfExists } from "@/modules/store/atomic";
import { seededMediaReference, writeMediaBytes } from "@/modules/store/media";
import { sessionPaths } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
// This file's own sessions: a private id per seeded identity, so no other suite's world is shared
interface Fixture {
  /** The session id this file owns; every seeded document below is laid down under it. */
  readonly sessionId: string;
  /** The seeded identity whose world it holds. */
  readonly seedId: string;
}

const WORKER = "domain-scope-redaction-worker";
const WORKER_STUDENTS = "domain-scope-redaction-worker-students";
const SECOND_WORKER = "domain-scope-redaction-second-worker";
const FUNDRAISER = "domain-scope-redaction-fundraiser";
const COACH = "domain-scope-redaction-coach";
const READER = "domain-scope-redaction-reader";
/** The reader the published world's protected edition names in its grant, driven as a distinct seeded session. */
const SUPPORTER_READER = "domain-scope-redaction-reader-supporter";
/** A session the store holds no documents for at all: the resolver must refuse it, never invent one. */
const ABSENT_SESSION = "domain-scope-redaction-absent";
/** A session whose state document exists and whose operation ledger and meta documents do not: the store's own fault. */
const OUTAGE_SESSION = "domain-scope-redaction-outage";
/** The colleague's identity over the worker's record set: one ministry's store read by a second principal. */
const COLLEAGUE_WORLD = "domain-scope-redaction-colleague-in-worker-world";

const FIXTURES: readonly Fixture[] = [
  // The established worker: two ministries, partial financial coverage, private notes, a private
  // preparation record and the gifts every support read below is measured over.
  { sessionId: WORKER, seedId: DEFAULT_SESSION_ID },
  // The same worker with the students ministry selected: the same principal in a second admitted
  // context, whose financial source covers its whole period.
  { sessionId: WORKER_STUDENTS, seedId: "established-worker-students" },
  // Another ministry entirely, holding none of the first scope's records.
  { sessionId: SECOND_WORKER, seedId: "second-worker" },
  // A second authorised member of the worker's own ministry, with a different principal.
  { sessionId: FUNDRAISER, seedId: "deputized-fundraiser" },
  { sessionId: COACH, seedId: "coach" },
  { sessionId: READER, seedId: "reader-unauthorized" },
  // The other reader: the one persona the published world's protected edition holds a grant for, so
  // the same rendition is asked of a reader it admits and one it does not.
  { sessionId: SUPPORTER_READER, seedId: "reader-approved-supporter" },
];

/** The seeded worlds, keyed by the session id this file laid them down under. */
const seededWorlds = new Map<string, SeededSessionDocuments>();

/** The public sessions this file resolves once, so every case acts as the identity it names. */
const sessions = new Map<string, ResolvedSession>();

function worldOf(sessionId: string): SeededSessionDocuments {
  const documents = seededWorlds.get(sessionId);
  if (documents === undefined) {
    throw new Error(`The seeded world for "${sessionId}" was not laid down, so this case cannot start from it.`);
  }
  return documents;
}
function stateOf(sessionId: string): SessionStateDocument {
  return worldOf(sessionId).state;
}
function sessionOf(sessionId: string): ResolvedSession {
  const resolved = sessions.get(sessionId);
  if (resolved === undefined) {
    throw new Error(`The session "${sessionId}" was not resolved before this case ran.`);
  }
  return resolved;
}
function sourceOf(sessionId: string): SessionSource {
  return { sessionId };
}
function required<T>(value: T | null | undefined, what: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`The seeded world carries no ${what}, so this case cannot start from it.`);
  }
  // Narrowed by the check above, which TypeScript cannot express through `T | null | undefined`.
  return value as NonNullable<T>;
}
function first<T>(items: readonly T[], what: string): T {
  return required(items.at(0), what);
}
beforeAll(async () => {
  const seeded = await seed();
  const bySeedId = new Map(seeded.map((row) => [row.sessionId, row]));
  for (const fixture of FIXTURES) {
    const row = bySeedId.get(fixture.seedId);
    if (row === undefined) {
      throw new Error(`The seed lays down no session "${fixture.seedId}", so this file cannot act as it.`);
    }
    seededWorlds.set(fixture.sessionId, row.documents);
    await resetSession(fixture.sessionId, row.documents);
  }
  // The outage fixture: the commit marker exists and the rest of the document set does not, which is
  // the state a store that lost a write is genuinely in, so the resolver and every read answer with the
  // outage rather than with an empty result or a denial.
  const outage = bySeedId.get(DEFAULT_SESSION_ID);
  if (outage === undefined) {
    throw new Error(`The seed lays down no session "${DEFAULT_SESSION_ID}", so the outage fixture cannot be built.`);
  }
  seededWorlds.set(OUTAGE_SESSION, outage.documents);
  await resetSession(OUTAGE_SESSION, outage.documents);
  await removeIfExists(sessionPaths(OUTAGE_SESSION).operations);
  // No seeded world lays another principal's private note in front of a colleague's read, so the
  // colleague's is the worker's record set under the colleague's own metadata: the store's own
  // documents, composed rather than written, in the state a ministry shared by two principals is in.
  await resetSession(COLLEAGUE_WORLD, { ...required(seededWorlds.get(FUNDRAISER), "seeded world of the colleague"), state: stateOf(WORKER) });
  for (const fixture of FIXTURES) {
    const resolution = await resolveSession(sourceOf(fixture.sessionId));
    if (!resolution.ok) {
      throw new Error(`The seeded session "${fixture.sessionId}" did not resolve: ${JSON.stringify(resolution.refusal)}.`);
    }
    sessions.set(fixture.sessionId, resolution.session);
  }
});
afterAll(async () => {
  // Only this file's own sessions are removed: the directory holds other suites' worlds.
  const sessionIds = [...FIXTURES.map((fixture) => fixture.sessionId), OUTAGE_SESSION, ABSENT_SESSION, COLLEAGUE_WORLD];
  for (const sessionId of sessionIds) {
    await resetSession(sessionId);
  }
});
// Reading the two arms of a read result without guessing at them
function envelopeOf<E>(result: ReadResult<E>, what: string): E {
  expect(isReadResult(result), `${what} must answer with a read result`).toBe(true);
  if (result.kind !== "envelope") {
    throw new Error(`${what} was expected to answer with a read envelope and answered with ${JSON.stringify(result)}.`);
  }
  return result.envelope;
}
function denialOf<T>(result: ReadResult<T>, what: string): DeniedOutcome {
  expect(isReadResult(result), `${what} must answer with a read result`).toBe(true);
  if (result.kind !== "denied") {
    throw new Error(`${what} was expected to be refused and answered with ${JSON.stringify(result)}.`);
  }
  return result.denied;
}
function outageOf<T>(result: ReadResult<T>, what: string): Extract<ReadResult<T>, { kind: "unavailable" }> {
  if (result.kind !== "unavailable") {
    throw new Error(`${what} was expected to answer with the source outage it is and answered with ${JSON.stringify(result)}.`);
  }
  return result;
}
function acceptedOutcome(outcome: MutationOutcome, what: string): Extract<MutationOutcome, { outcome: "accepted" }> {
  expect(isOutcome(outcome), `${what} must answer with one of the eight outcomes`).toBe(true);
  if (outcome.outcome !== "accepted") {
    throw new Error(`${what} was expected to be applied once and answered with ${JSON.stringify(outcome)}.`);
  }
  return outcome;
}
function deniedOutcome(outcome: MutationOutcome, what: string): DeniedOutcome {
  expect(isOutcome(outcome), `${what} must answer with one of the eight outcomes`).toBe(true);
  if (outcome.outcome !== "denied") {
    throw new Error(`${what} was expected to be refused and answered with ${JSON.stringify(outcome)}.`);
  }
  return outcome;
}
/** The observable shape of one value as a surface would receive it: the whole thing, serialised. */
function textOf(value: unknown): string {
  return JSON.stringify(value);
}
/** Asserts each named member of an object is absent, one at a time, so the report names the field that leaked. */
function expectMembersAbsent(value: object, members: readonly string[], what: string): void {
  for (const member of members) {
    expect(Object.hasOwn(value, member), `${what} must not carry "${member}"`).toBe(false);
  }
}
/** Asserts a refusal carries none of the evidence a disclosure would need. */
function expectNoDisclosure(denial: DeniedOutcome, what: string): void {
  expectMembersAbsent(
    denial,
    ["data", "envelope", "total", "totalCount", "count", "size", "bytes", "length", "title", "name", "displayName", "label", "partnerId", "id", "ids", "rows", "records", "items", "exists", "found", "revision", "scope", "source", "asOf", "coverage", "valueStates", "actions"],
    what,
  );
}
/** Asserts a text carries none of the needles, naming the one that would have leaked. */
function expectNoText(haystack: string, needles: readonly string[], what: string): void {
  for (const needle of needles) {
    expect(haystack.includes(needle), `${what} must not carry ${JSON.stringify(needle)}`).toBe(false);
  }
}
/** The states whose figure carries no digits: only a value, a genuine zero and the derived subtotal do. */
const STATES_CARRYING_AN_AMOUNT: readonly ValueState[] = ["value", "zero", "incomplete-subtotal"];

/** A partner in the first scope, taken from the seed rather than named here. */
function firstScopePartner(): PartnerRecord {
  return first(
    stateOf(WORKER).partners.filter((record) => record.kind === "person"),
    "person in the first scope",
  );
}
describe("authorisation precedes enumeration", () => {
  it("refuses the second worker the first scope's partner, and carries no count, title, name, existence flag or size", async () => {
    const record = firstScopePartner();
    const result = await reads.partners.readPartner(record.partnerId, {}, sourceOf(SECOND_WORKER));
    const denial = denialOf(result, "the second worker reading a partner of the first scope");
    expect(denial.outcome).toBe("denied");
    expect(denial.reasonCode).toBe("no-permission");
    // The denial is made of three members and nothing else: a fourth would be a fact about the record.
    expect(Object.keys(denial).toSorted()).toEqual(["operationId", "outcome", "reasonCode"]);
    expectNoDisclosure(denial, "a scope denial");
  });
  it("answers an existing record and a non-existent identifier identically, so a denial cannot enumerate", async () => {
    const record = firstScopePartner();
    const existing = await reads.partners.readPartner(record.partnerId, {}, sourceOf(SECOND_WORKER));
    const absent = await reads.partners.readPartner("partner-that-was-never-recorded", {}, sourceOf(SECOND_WORKER));
    const existingDenial = denialOf(existing, "the denial of an existing record");
    const absentDenial = denialOf(absent, "the denial of a non-existent identifier");
    // Any difference at all — a reason code, a member, a message — lets a caller ask "does this exist?".
    expect(existingDenial).toEqual(absentDenial);
    expect(Object.keys(existingDenial).toSorted()).toEqual(Object.keys(absentDenial).toSorted());
    expect(textOf(existing)).toBe(textOf(absent));
  });
  it("refuses the unauthorized reader the protected receiving read, with nothing about it disclosed", async () => {
    const reader = sessionOf(READER);
    const membership = first(stateOf(WORKER).memberships, "seeded membership");
    // The refusal is asked of the one function the receiving reads authorise with, using an empty
    // membership list: the reader holds no membership of this publisher for this purpose.
    const grant = {
      audience: "approved-supporter" as const,
      reader: { recipientId: String(reader.principalId), publisherId: membership.publisherId, purpose: membership.purpose, memberships: [] },
    };
    const decision = canReadProtected(reader, grant);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error("An unauthorized reader was granted a protected read.");
    }
    expect(decision.denial.reasonCode).toBe("no-protected-grant");
    // The decision is the refusal and nothing else: no audience, no edition, no title, no count.
    expect(Object.keys(decision).toSorted()).toEqual(["allowed", "denial"]);
    expectNoDisclosure(decision.denial, "a protected-read refusal");
    // A reader the grant names at all is refused exactly as one it names nothing for, so "there is no
    // such membership" and "there is no such reader" cannot be told apart either.
    expect(canReadProtected(reader, { audience: "approved-supporter", reader: null })).toEqual(decision);
  });
  it("refuses the unauthorized reader every scoped record read, since it is admitted to no context", async () => {
    const record = firstScopePartner();
    const partnerRead = await reads.partners.readPartner(record.partnerId, {}, sourceOf(READER));
    const partnerDenial = denialOf(partnerRead, "the unauthorized reader's partner read");
    expect(partnerDenial.reasonCode).toBe("not-admitted");
    expectNoDisclosure(partnerDenial, "an admission denial");
    const rosterRead = await reads.partners.findPartners({}, sourceOf(READER));
    expect(denialOf(rosterRead, "the unauthorized reader's roster").reasonCode).toBe("not-admitted");
    const exportRead = await reads.export.readExport({}, sourceOf(READER));
    const exportDenial = denialOf(exportRead, "the unauthorized reader's export");
    expect(DENIAL_REASONS).toContain(exportDenial.reasonCode);
    expectNoDisclosure(exportDenial, "an export denial");
  });
});
describe("a search, a sort and a page cannot become a disclosure oracle", () => {
  it("reports the whole authorised total as an integer and returns no row from another scope", async () => {
    const theirs = firstScopePartner();
    const term = theirs.displayName.split(" ").at(-1) ?? theirs.displayName;
    const crossScope = envelopeOf(await reads.partners.findPartners({ search: term }, sourceOf(SECOND_WORKER)), "the second worker's roster search");
    // The integer, not merely emptiness: a `total` that counted the other scope's matches would tell
    // the caller how many records it holds.
    expect(Number.isInteger(crossScope.data.total)).toBe(true);
    expect(crossScope.data.total).toBe(0);
    expect(crossScope.data.rows).toEqual([]);
    const roster = envelopeOf(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
    const authorisedIds = new Set(stateOf(SECOND_WORKER).partners.map((record) => record.partnerId));
    const returnedIds = roster.data.rows.map((row) => row.partner.partnerId);
    expect(Number.isInteger(roster.data.total)).toBe(true);
    expect(roster.data.total).toBe(returnedIds.length);
    expect(new Set(returnedIds)).toEqual(authorisedIds);
    const otherScopeIds = new Set(stateOf(WORKER).partners.map((record) => record.partnerId));
    for (const partnerId of returnedIds) {
      expect(otherScopeIds.has(partnerId), `the second worker's roster returned ${partnerId} from the first scope`).toBe(false);
    }
  });
  it("answers a page beyond the authorised set with an empty page and an unchanged total", async () => {
    const roster = envelopeOf(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
    const beyond = envelopeOf(await reads.partners.findPartners({ page: { index: 6 } }, sourceOf(SECOND_WORKER)), "a page beyond the authorised set");
    expect(beyond.data.rows).toEqual([]);
    // A page size or an offset that changed the total would let a caller measure what it cannot see.
    expect(beyond.data.total).toBe(roster.data.total);
  });
  it("keeps every sorted row inside the resolved scope", async () => {
    const roster = envelopeOf(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
    const sorted = envelopeOf(await reads.partners.findPartners({ sort: { field: "displayName", direction: "desc" } }, sourceOf(SECOND_WORKER)), "the second worker's sorted roster");
    const authorisedIds = new Set(stateOf(SECOND_WORKER).partners.map((record) => record.partnerId));
    const sortedIds = sorted.data.rows.map((row) => row.partner.partnerId);
    expect(sorted.data.total).toBe(roster.data.total);
    expect(sortedIds.toSorted()).toEqual(roster.data.rows.map((row) => row.partner.partnerId).toSorted());
    for (const partnerId of sortedIds) {
      expect(authorisedIds.has(partnerId), `sorting returned ${partnerId}, which is outside the resolved scope`).toBe(true);
    }
  });
  it("keeps denied, empty and unavailable three distinguishable answers to the same read", async () => {
    const refused = await reads.partners.findPartners({}, sourceOf(READER));
    const denied = denialOf(refused, "the unauthorized reader's roster");
    const empty = envelopeOf(await reads.partners.findPartners({ search: "no recorded partner carries this phrase" }, sourceOf(SECOND_WORKER)), "an authorised empty result");
    const outage = outageOf(await reads.partners.findPartners({}, sourceOf(OUTAGE_SESSION)), "a roster read whose source is down");
    // Denied: a refusal, and no envelope at all.
    expect(denied.outcome).toBe("denied");
    expect(DENIAL_REASONS).toContain(denied.reasonCode);
    // Empty: an envelope, a genuine zero count, and no refusal inside it.
    expect(empty.data.total).toBe(0);
    expectMembersAbsent(empty, ["denied", "unavailable"], "an authorised empty result");
    // Unavailable: the outage itself, naming its source and its guidance, and no data.
    expect(outage.unavailable.outcome).toBe("unavailable");
    expect(outage.unavailable.source.system.length).toBeGreaterThan(0);
    expect(outage.unavailable.guidance.length).toBeGreaterThan(0);
    expectMembersAbsent(outage.unavailable, ["data", "envelope", "total", "rows", "records"], "a source outage");
    // All three differ from each other on the same read, which is what a surface needs to render them
    // differently: a denied read has no total, an empty one has zero, and an outage has neither.
    expect(denied).not.toEqual(empty);
    expect(outage.unavailable).not.toEqual(empty);
    expect(denied.reasonCode).not.toBe(outage.unavailable.outcome);
  });
});

/** The scope the resolver selected for one of this file's sessions: the authority, never a hand-built literal. */
function selectedScopeOf(sessionId: string): Scope {
  return required(sessionOf(sessionId).selected, `the selected context of "${sessionId}"`);
}
/** Creates one private preparation record through the service and answers with the identifier it created. */
async function createPreparation(displayName: string, email: string, postal: string): Promise<string> {
  const roster = envelopeOf(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster before a creation");
  const outcome = await mutations.partnerPreparation.createPrivatePreparation(
    {
      operationId: randomUUID(),
      scope: selectedScopeOf(WORKER),
      // A creation compares no revision, because there is no stored value a stale expectation could
      // overwrite; the caller still states the collection revision it read.
      expectedRevision: roster.revision,
      payload: {
        displayName,
        contactMethods: [
          { kind: "email", value: email, permitted: true },
          { kind: "postal", value: postal, permitted: true },
        ],
      },
    },
    sourceOf(WORKER),
  );
  const accepted = acceptedOutcome(outcome, `creating a private preparation record for ${JSON.stringify(displayName)}`);
  return first(accepted.created ?? [], "identifier created by createPrivatePreparation");
}
describe("a private record stays private", () => {
  it("never puts a private note body, or its first line, in the shared projection of the record it is about", async () => {
    const partners = stateOf(WORKER).partners;
    const note = required(
      stateOf(WORKER).privateNotes.find((candidate) => partners.some((record) => record.partnerId === candidate.partnerId && record.kind === "person")),
      "private note about a shared person",
    );
    const shared = envelopeOf(await reads.partners.readPartner(note.partnerId, {}, sourceOf(WORKER)), "the shared projection of a noted record");
    // The whole body and a truncated leading line, because a list preview leaks exactly that.
    expectNoText(textOf(shared.data), [note.body, note.body.slice(0, 28)], "the shared projection of a noted record");
    expectMembersAbsent(shared.data, ["notes", "privateNotes"], "the shared projection of a noted record");
    const privateRead = envelopeOf(await reads.partners.readPrivatePreparation({ partnerId: note.partnerId }, sourceOf(WORKER)), "the author's own private read");
    expect(privateRead.data.notes.map((row) => row.body)).toContain(note.body);
  });
  it("refuses a private note to another principal admitted to the same ministry", async () => {
    const workerScope = selectedScopeOf(WORKER);
    const fundraiser = sessionOf(FUNDRAISER);
    const fundraiserScope = selectedScopeOf(FUNDRAISER);
    // Same organisation and ministry, different principal: the ministry is shared, the note is not.
    expect(fundraiserScope.organizationId).toBe(workerScope.organizationId);
    expect(fundraiserScope.ministryId).toBe(workerScope.ministryId);
    expect(fundraiserScope.principalId).not.toBe(workerScope.principalId);
    expect(sameScope(fundraiserScope, workerScope)).toBe(false);
    const colleague = canView(fundraiser, { kind: "private-note", scope: fundraiserScope, authorPrincipalId: sessionOf(WORKER).principalId });
    expect(colleague.allowed).toBe(false);
    if (colleague.allowed) {
      throw new Error("A colleague in the same ministry was granted another principal's private note.");
    }
    expect(colleague.denial.reasonCode).toBe("no-permission");
    expectNoDisclosure(colleague.denial, "a private-note refusal");
    const author = canView(sessionOf(WORKER), { kind: "private-note", scope: workerScope, authorPrincipalId: sessionOf(WORKER).principalId });
    expect(author.allowed).toBe(true);
  });
  it("keeps a private preparation record author-only, at the read and at the permission question", async () => {
    const preparation = required(
      stateOf(WORKER).partners.find((record) => record.kind === "private-preparation"),
      "private preparation record",
    );
    const own = envelopeOf(await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(WORKER)), "the author's private preparation");
    expect(own.data.preparation?.partnerId).toBe(preparation.partnerId);
    const colleague = canView(sessionOf(FUNDRAISER), { kind: "partner", scope: selectedScopeOf(FUNDRAISER), audience: "private", authorPrincipalId: sessionOf(WORKER).principalId });
    expect(colleague.allowed).toBe(false);
    if (colleague.allowed) {
      throw new Error("A colleague in the same ministry was granted another principal's private preparation.");
    }
    expect(colleague.denial.reasonCode).toBe("no-permission");
    // The shared record class is admitted to that same colleague, so the refusal is about the private
    // record rather than about the ministry.
    expect(canView(sessionOf(FUNDRAISER), { kind: "partner", scope: selectedScopeOf(FUNDRAISER), audience: "shared", authorPrincipalId: null }).allowed).toBe(true);
    // The record-level half of the same rule: a colleague in the same ministry is refused the record itself,
    // so no preparation field, note body, count or existence hint reaches them.
    const preparationNotes = stateOf(WORKER).privateNotes.filter((note) => note.partnerId === preparation.partnerId);
    expect(preparationNotes.length).toBeGreaterThan(0);
    const colleaguePreparation = denialOf(
      await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(COLLEAGUE_WORLD)),
      "the colleague's private read of the preparation record",
    );
    expect(colleaguePreparation.reasonCode).toBe("no-permission");
    expectNoDisclosure(colleaguePreparation, "a colleague's private-preparation refusal");
    // The same colleague, on the shared person the worker's note is about, is refused the note and shown no preparation field.
    const notedPerson = required(
      stateOf(WORKER).privateNotes.find((candidate) => stateOf(WORKER).partners.some((record) => record.partnerId === candidate.partnerId && record.kind === "person")),
      "private note about a shared person",
    );
    const colleaguePerson = envelopeOf(await reads.partners.readPrivatePreparation({ partnerId: notedPerson.partnerId }, sourceOf(COLLEAGUE_WORLD)), "the colleague's private read of a shared person carrying the worker's note");
    expect(colleaguePerson.data.notes).toEqual([]);
    expectNoText(textOf(colleaguePerson.data), [notedPerson.body, notedPerson.body.slice(0, 28)], "the colleague's private read of a shared person");
    expect(colleaguePerson.data.preparation).toBeUndefined();
    // The author's read of that same record does carry the note, so the read filters per principal rather than answering everyone with nothing.
    const authorPerson = envelopeOf(await reads.partners.readPrivatePreparation({ partnerId: notedPerson.partnerId }, sourceOf(WORKER)), "the author's private read of the same shared person");
    expect(authorPerson.data.notes.map((note) => note.body)).toContain(notedPerson.body);
    const otherMinistry = await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(SECOND_WORKER));
    expect(denialOf(otherMinistry, "another ministry reading a private preparation").reasonCode).toBe("no-permission");
    const reader = await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(READER));
    expect(denialOf(reader, "an unauthorized reader reading a private preparation").reasonCode).toBe("not-admitted");
  });
  it("carries no private note and no private preparation into the export, and refuses the export where the caller holds no context", async () => {
    const partners = stateOf(WORKER).partners;
    const preparation = required(
      partners.find((record) => record.kind === "private-preparation"),
      "private preparation record",
    );
    const bodies = stateOf(WORKER).privateNotes.map((note) => note.body);
    expect(bodies.length).toBeGreaterThan(0);
    const heads = bodies.map((body) => body.slice(0, 28));
    const exported = envelopeOf(await reads.export.readExport({}, sourceOf(WORKER)), "the worker's export");
    expect(exported.data.csv.length).toBeGreaterThan(0);
    // Export permission belongs to a context of membership, so it is asked of the resolver's scope and
    // refused for a principal that holds no membership at all.
    expect(canExport(sessionOf(WORKER), selectedScopeOf(WORKER)).allowed).toBe(true);
    const coachExport = canExport(sessionOf(COACH), selectedScopeOf(WORKER));
    expect(coachExport.allowed).toBe(false);
    if (coachExport.allowed) {
      throw new Error("A principal holding no membership was granted an export.");
    }
    expect(coachExport.denial.reasonCode).toBe("no-export-permission");
    expectNoText(exported.data.csv, [...bodies, ...heads, preparation.displayName], "the exported CSV");
    expectNoText(textOf(exported.data), [...bodies, ...heads, preparation.displayName], "the export model");
    // An export is a permission of a context: a principal that selected no context holds none.
    for (const sessionId of [READER, COACH]) {
      const refused = denialOf(await reads.export.readExport({}, sourceOf(sessionId)), `the export attempted by "${sessionId}"`);
      expect(DENIAL_REASONS).toContain(refused.reasonCode);
      expectNoDisclosure(refused, `the export denial of "${sessionId}"`);
    }
  });
  it("shows a coach no private label, no private note and no financial module it was not granted", async () => {
    const grant = required(
      stateOf(COACH).coachingGrants.find((record) => record.state === "active"),
      "active coaching grant",
    );
    const subject = envelopeOf(await reads.coach.readCoachSubject({ grantId: grant.grantId }, sourceOf(COACH)), "the coach's subject read");
    const labels = stateOf(COACH).coachingTargets.map((target) => target.privateLabel).filter((label) => label.length > 0);
    expect(labels.length).toBeGreaterThan(0);
    expectNoText(textOf(subject.data), labels, "the coach projection");
    expectNoText(textOf(subject.data), stateOf(WORKER).privateNotes.map((note) => note.body), "the coach projection");
    // The admitted module set is the grant's own, so a module the worker kept unselected is not even
    // named in the answer.
    const sharedModules = Object.entries(grant.modules)
      .filter(([, selected]) => selected)
      .map(([module]) => module);
    expect(subject.data.modules.map((view) => view.module).toSorted()).toEqual(sharedModules.toSorted());
    expect(sharedModules).not.toContain("support-results");
    expect(/gift|donor|commitment/i.test(textOf(subject.data))).toBe(false);
    // A coach reads and never writes: the only two writes offered are accepting the invitation and
    // leaving a relationship, and no edit, assign, complete, remind or export action appears at all.
    expect(subject.actions.map((action) => action.name).toSorted()).toEqual(["acceptInvitation", "leaveCoaching"]);
  });
});
describe("equal-looking identifiers never join", () => {
  it("keeps two records that share a display name, an email address and a postal address as two records", async () => {
    const displayName = "Robin Ellery";
    const email = "robin.ellery@example.org";
    const postal = "9 Quay Street, Harbourton HT1 4CD";
    const firstId = await createPreparation(displayName, email, postal);
    const secondId = await createPreparation(displayName, email, postal);
    expect(firstId).not.toBe(secondId);
    const search = envelopeOf(await reads.partners.findPartners({ search: email }, sourceOf(WORKER)), "a search on the address both records carry");
    const foundIds = search.data.rows.map((row) => row.partner.partnerId);
    // Two rows, not one merged record: an address that matches twice does not establish identity.
    expect(foundIds.length).toBe(2);
    expect(new Set(foundIds).size).toBe(2);
    expect(foundIds).toContain(firstId);
    expect(foundIds).toContain(secondId);
    const firstRecord = envelopeOf(await reads.partners.readPartner(firstId, {}, sourceOf(WORKER)), "the first of the two records");
    const secondRecord = envelopeOf(await reads.partners.readPartner(secondId, {}, sourceOf(WORKER)), "the second of the two records");
    expect(firstRecord.data.partner.partnerId).toBe(firstId);
    expect(secondRecord.data.partner.partnerId).toBe(secondId);
    expectNoText(textOf(firstRecord.data), [secondId], "the first record");
    expectNoText(textOf(secondRecord.data), [firstId], "the second record");
    // The fields really are equal, which is exactly why none of them may be the join.
    expect(firstRecord.data.partner.displayName).toBe(secondRecord.data.partner.displayName);
    expect(firstRecord.data.partner.contactMethods.map((method) => method.value).toSorted()).toEqual(secondRecord.data.partner.contactMethods.map((method) => method.value).toSorted());
  });
  it("offers no read keyed by an email address, so a record is addressed by its opaque identifier", () => {
    const readNames = Object.values(reads).flatMap((group) => Object.keys(group));
    expect(readNames.length).toBeGreaterThan(0);
    expect(readNames).toContain("readPartner");
    for (const name of readNames) {
      expect(/email/i.test(name), `${name} looks like an email-keyed read, and an address is never a join key`).toBe(false);
    }
  });
  it("keeps a household, a church and the person recorded for it distinct identities", async () => {
    const partners = stateOf(WORKER).partners;
    const household = required(
      partners.find((record) => record.kind === "household"),
      "household record",
    );
    // The members are read from the visit recorded against the household, never from a name that
    // happens to match one.
    const visit = required(
      stateOf(WORKER).interactions.find((interaction) => interaction.partnerId === household.partnerId),
      "interaction recorded against the household",
    );
    const memberIds = visit.participants.map((participant) => participant.partnerId).filter((partnerId): partnerId is string => partnerId !== null);
    expect(memberIds.length).toBeGreaterThan(0);
    const householdRecord = envelopeOf(await reads.partners.readPartner(household.partnerId, {}, sourceOf(WORKER)), "the household record");
    expect(householdRecord.data.partner.kind).toBe("household");
    expectNoText(textOf(householdRecord.data), memberIds, "the household's own record");
    for (const memberId of memberIds) {
      const member = envelopeOf(await reads.partners.readPartner(memberId, {}, sourceOf(WORKER)), "a member's own record");
      expect(member.data.partner.partnerId).toBe(memberId);
      expectNoText(textOf(member.data), [household.partnerId], `the record of ${memberId}`);
    }
    const church = required(
      partners.find((record) => record.kind === "church"),
      "church record",
    );
    const representative = required(
      partners.find((record) => record.kind === "person" && record.stage !== null && record.stage.toLowerCase().includes("warden")),
      "person recorded as the church's warden",
    );
    const churchRecord = envelopeOf(await reads.partners.readPartner(church.partnerId, {}, sourceOf(WORKER)), "the church record");
    expect(churchRecord.data.partner.kind).toBe("church");
    expectNoText(textOf(churchRecord.data), [representative.partnerId], "the church's own record");
    const representativeRecord = envelopeOf(await reads.partners.readPartner(representative.partnerId, {}, sourceOf(WORKER)), "the warden's own record");
    expect(representativeRecord.data.partner.partnerId).toBe(representative.partnerId);
    expectNoText(textOf(representativeRecord.data), [church.partnerId], "the warden's own record");
  });
  it("keeps the ministry and the support subject distinct, so one identifier cannot stand in for the other", async () => {
    const workerScope = selectedScopeOf(WORKER);
    const studentsScope = selectedScopeOf(WORKER_STUDENTS);
    // One organisation and one principal, two ministries with their own support subjects.
    expect(workerScope.organizationId).toBe(studentsScope.organizationId);
    expect(workerScope.principalId).toBe(studentsScope.principalId);
    expect(workerScope.ministryId).not.toBe(studentsScope.ministryId);
    expect(workerScope.supportSubjectId).not.toBe(studentsScope.supportSubjectId);
    const swapped: Scope = { ...workerScope, supportSubjectId: studentsScope.supportSubjectId };
    expect(sameScope(workerScope, swapped)).toBe(false);
    const record = firstScopePartner();
    const before = envelopeOf(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record before a swapped write");
    const outcome = await mutations.partnerPreparation.saveContactEdits(
      {
        operationId: randomUUID(),
        scope: swapped,
        expectedRevision: before.revision,
        payload: { partnerId: record.partnerId, displayName: "A name nothing may adopt" },
      },
      sourceOf(WORKER),
    );
    // No membership admits the mixed triplet, so the write is refused before the record is opened.
    expect(deniedOutcome(outcome, "a write in a scope no membership admits").reasonCode).toBe("no-membership");
    const after = envelopeOf(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record after a swapped write");
    expect(after.data.partner.displayName).toBe(before.data.partner.displayName);
    expect(after.revision).toBe(before.revision);
  });
});

describe("linking work never copies private text into shared history", () => {
  it("strips a private interaction note from the shared activity and copies no private text onto a linked task", async () => {
    const privateInteraction = required(
      stateOf(WORKER).interactions.find((interaction) => interaction.note !== null && interaction.note.audience === "private"),
      "interaction carrying a private note",
    );
    const interactionNote = required(privateInteraction.note, "private note body of that interaction");
    const privateNote = required(
      stateOf(WORKER).privateNotes.find((note) => note.partnerId === privateInteraction.partnerId),
      "private note about the same record",
    );
    const shared = envelopeOf(await reads.interactions.readInteractions({ partnerId: privateInteraction.partnerId }, sourceOf(WORKER)), "the shared activity of that record");
    const sameInteraction = required(
      shared.data.interactions.find((interaction) => interaction.interactionId === privateInteraction.interactionId),
      "the same interaction in the shared activity read",
    );
    // Removed, not shortened: a private-audience note reaches the shared read as no note at all.
    expect(sameInteraction.note).toBeNull();
    expectNoText(textOf(shared.data), [interactionNote.body, interactionNote.body.slice(0, 28), privateNote.body, privateNote.body.slice(0, 28)], "the shared activity read");
    // Any note that is present is a shared one, so the read has one rule and it holds for every row.
    const notesShown = shared.data.interactions.map((interaction) => interaction.note).filter((note) => note !== null);
    for (const shown of notesShown) {
      expect(shown.audience).toBe("shared");
    }
    const title = "Follow up after the visit";
    const outcome = await mutations.work.createTask(
      {
        operationId: randomUUID(),
        scope: selectedScopeOf(WORKER),
        expectedRevision: shared.revision,
        payload: { title, partnerId: privateInteraction.partnerId },
      },
      { sessionId: WORKER },
    );
    acceptedOutcome(outcome, "linking a task to a record that carries private preparation");
    const detail = envelopeOf(await reads.partners.readPartner(privateInteraction.partnerId, {}, sourceOf(WORKER)), "the record after a task was linked");
    expect(detail.data.openTasks.some((task) => task.title === title)).toBe(true);
    expectNoText(textOf(detail.data), [interactionNote.body, interactionNote.body.slice(0, 28), privateNote.body, privateNote.body.slice(0, 28)], "the record a task was linked to");
  });
});
describe("the value-state map keeps each non-value its own fact", () => {
  it("covers every value-bearing field the goal read exposes", async () => {
    const goal = envelopeOf(await reads.support.readGoal({}, sourceOf(WORKER)), "the worker's goal read");
    for (const path of ["goal.amount", "goal.percentage"]) {
      expect(goal.valueStates, `the value-state map must cover "${path}"`).toHaveProperty(path);
    }
    expect(goal.data.report.summary.length).toBeGreaterThan(0);
    for (const entry of goal.data.report.summary) {
      for (const member of ["received", "giftCount", "allocationCount", "donorCount"]) {
        expect(goal.valueStates, `the value-state map must cover summary.${entry.currency}.${member}`).toHaveProperty(`summary.${entry.currency}.${member}`);
      }
    }
  });
  it("derives the incomplete subtotal from partial coverage and never passes a recorded amount through", async () => {
    const partial = envelopeOf(await reads.support.readGifts({}, sourceOf(WORKER)), "the worker's gifts ledger");
    expect(partial.coverage.state).toBe("partial");
    const currency = first(partial.data.report.summary, "summary row in the worker's ledger").currency;
    // The derived member is the envelope's, not a state any read recorded: the seeded history is
    // partial, so a subtotal over it cannot present itself as a whole period.
    expect(partial.valueStates[`summary.${currency}.received`]).toBe("incomplete-subtotal");
    for (const [path, state] of Object.entries(partial.valueStates)) {
      expect(state === "value" || state === "zero", `${path} kept a recorded amount state over partial coverage`).toBe(false);
    }
    const complete = envelopeOf(await reads.support.readGifts({}, sourceOf(SECOND_WORKER)), "the second worker's gifts ledger");
    expect(complete.coverage.state).toBe("complete");
    const completeStates = Object.values(complete.valueStates);
    expect(completeStates).toContain("value");
    expect(completeStates).not.toContain("incomplete-subtotal");
    // The same field, read over complete coverage, is plainly a value: the difference is coverage,
    // never the figure.
    const completeCurrency = first(complete.data.report.summary, "summary row in the second worker's ledger").currency;
    expect(complete.valueStates[`summary.${completeCurrency}.received`]).toBe("value");
  });
  it("states a genuine zero as zero, apart from unknown, withheld and unavailable on the same field", async () => {
    const partner = required(
      stateOf(WORKER).partners.find((record) => record.kind === "person" && !stateOf(WORKER).privateNotes.some((note) => note.partnerId === record.partnerId)),
      "person with no private note",
    );
    const read = envelopeOf(await reads.partners.readPrivatePreparation({ partnerId: partner.partnerId }, sourceOf(WORKER)), "a record with no private note");
    expect(read.data.notes).toEqual([]);
    const state = read.valueStates.notes;
    expect(state).toBe("zero");
    expect(state).not.toBe("unknown");
    expect(state).not.toBe("withheld");
    expect(state).not.toBe("unavailable");
    expect(STATES_CARRYING_AN_AMOUNT).toContain("zero");
  });
  it("carries withheld, unavailable and unknown through unchanged, and gives each of them no amount", async () => {
    const base = envelopeOf(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster");
    const envelope = buildEnvelope({
      data: {},
      scope: base.scope,
      source: base.source,
      revision: base.revision,
      asOf: base.asOf,
      coverage: { from: null, to: null, state: "complete" },
      valueStates: {
        "summary.USD.received": "withheld",
        "summary.USD.giftCount": "unavailable",
        "summary.USD.donorCount": "unknown",
        "summary.USD.allocationCount": "value",
        "rows.0.amount": "zero",
      },
      actions: [],
    });
    expect(envelope.valueStates["summary.USD.received"]).toBe("withheld");
    expect(envelope.valueStates["summary.USD.giftCount"]).toBe("unavailable");
    expect(envelope.valueStates["summary.USD.donorCount"]).toBe("unknown");
    // Each of the three is a state a surface must render without digits, and none of them is derivable
    // from a figure: a component that printed a number would have to invent one.
    for (const path of ["summary.USD.received", "summary.USD.giftCount", "summary.USD.donorCount"]) {
      expect(STATES_CARRYING_AN_AMOUNT).not.toContain(envelope.valueStates[path]);
    }
    expect(STATES_CARRYING_AN_AMOUNT).toContain(envelope.valueStates["summary.USD.allocationCount"]);
    expect(STATES_CARRYING_AN_AMOUNT).toContain(envelope.valueStates["rows.0.amount"]);
  });
  it("has exactly six value states and refuses to be told the derived one", async () => {
    expect(VALUE_STATES.length).toBe(6);
    expect(new Set(VALUE_STATES).size).toBe(6);
    // The builder takes a recorded state: `RecordedValueState` excludes the derived member, and the
    // schema that guards a caller-supplied map refuses it at the boundary too, so no caller chooses it.
    expect(recordedValueStateSchema.safeParse("incomplete-subtotal").success).toBe(false);
    for (const state of VALUE_STATES.filter((candidate) => candidate !== "incomplete-subtotal")) {
      expect(recordedValueStateSchema.safeParse(state).success, `"${state}" is a state a read may record`).toBe(true);
    }
    const base = envelopeOf(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster");
    const complete = buildEnvelope({
      data: {},
      scope: base.scope,
      source: base.source,
      revision: base.revision,
      asOf: base.asOf,
      coverage: { from: null, to: null, state: "complete" },
      valueStates: { total: "value" },
      actions: [],
    });
    const partial = buildEnvelope({
      data: {},
      scope: base.scope,
      source: base.source,
      revision: base.revision,
      asOf: base.asOf,
      coverage: { from: null, to: null, state: "partial" },
      valueStates: { total: "value" },
      actions: [],
    });
    expect(complete.valueStates.total).toBe("value");
    expect(partial.valueStates.total).toBe("incomplete-subtotal");
  });
});
describe("the resolver is the only entry to a scope", () => {
  it("refuses an unknown, unusable or absent session rather than inventing a principal", async () => {
    for (const sessionId of [ABSENT_SESSION, "not/a/session", ""]) {
      const resolution = await resolveSession({ sessionId });
      expect(resolution.ok, `the resolver invented a session for ${JSON.stringify(sessionId)}`).toBe(false);
      if (resolution.ok) {
        throw new Error(`The resolver answered ${JSON.stringify(sessionId)} with a session.`);
      }
      expect(resolution.refusal.kind).toBe("denied");
      if (resolution.refusal.kind !== "denied") {
        throw new Error(`The refusal of ${JSON.stringify(sessionId)} was not the denial it is.`);
      }
      expect(DENIAL_REASONS).toContain(resolution.refusal.denied.reasonCode);
      expectMembersAbsent(resolution, ["session"], "a refused session resolution");
      expectNoDisclosure(resolution.refusal.denied, `the refusal of ${JSON.stringify(sessionId)}`);
    }
    const denial = denialOf(await reads.partners.readPartner(firstScopePartner().partnerId, {}, sourceOf(ABSENT_SESSION)), "a read against a session the store does not hold");
    expectNoDisclosure(denial, "a session refusal");
  });
  it("states the resolved scope on every read and refuses a write that claims another one", async () => {
    const workerScope = selectedScopeOf(WORKER);
    const roster = envelopeOf(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster");
    expect(roster.scope).toEqual(workerScope);
    const secondRoster = envelopeOf(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
    expect(secondRoster.scope).toEqual(selectedScopeOf(SECOND_WORKER));
    expect(sameScope(secondRoster.scope, workerScope)).toBe(false);
    const record = firstScopePartner();
    const before = envelopeOf(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record before a claimed scope");
    const outcome = await mutations.partnerPreparation.saveContactEdits(
      {
        operationId: randomUUID(),
        scope: selectedScopeOf(SECOND_WORKER),
        expectedRevision: before.revision,
        payload: { partnerId: record.partnerId, displayName: "A name the other organisation may not set" },
      },
      sourceOf(WORKER),
    );
    // The claim names another principal as well as another ministry, so the authority is refused before
    // the payload is looked at, and the record keeps the name it had.
    expect(deniedOutcome(outcome, "a write claiming another scope").reasonCode).toBe("not-admitted");
    const after = envelopeOf(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record after a claimed scope");
    expect(after.data.partner.displayName).toBe(before.data.partner.displayName);
    expect(after.revision).toBe(before.revision);
  });
  it("refuses a write that names a record outside the caller's scope, and leaves that record unchanged", async () => {
    const foreign = first(stateOf(SECOND_WORKER).partners, "partner in the second scope");
    const before = envelopeOf(await reads.partners.readPartner(foreign.partnerId, {}, sourceOf(SECOND_WORKER)), "the second worker's record before a foreign write");
    const outcome = await mutations.partnerPreparation.saveContactEdits(
      {
        operationId: randomUUID(),
        scope: selectedScopeOf(WORKER),
        expectedRevision: before.revision,
        payload: { partnerId: foreign.partnerId, displayName: "A name from another ministry" },
      },
      sourceOf(WORKER),
    );
    // Inside its own scope and naming a record it cannot see, the service refuses exactly as it refuses
    // a record that does not exist.
    expect(deniedOutcome(outcome, "a write naming a record outside the caller's scope").reasonCode).toBe("no-permission");
    const after = envelopeOf(await reads.partners.readPartner(foreign.partnerId, {}, sourceOf(SECOND_WORKER)), "the second worker's record after a foreign write");
    expect(after.data.partner.displayName).toBe(before.data.partner.displayName);
    expect(after.revision).toBe(before.revision);
  });
});

// Protected media
//
// Criterion 19 names protected media among the things a second worker must not retrieve, and criterion 18
// names protected video, poster, captions and transcript. Both are decided per request by
// `reads.media.readMediaAsset` — the one read the rendition route calls — so every purpose below is asked
// of that read, with a `SessionSource`, exactly as the rest of this file asks its reads.
/** The literal session id whose world the receiving reads answer a reader from: the published world. */
const PUBLISHED_WORLD = DEFAULT_SESSION_ID;
/** An address no record carries: every refusal below is asserted identical to the refusal of this one. */
const NEVER_RECORDED_ASSET = "asset-that-was-never-recorded";
/** The video asset the protected edition places, in a custody lane of its own. */
const PROTECTED_ASSET = "asset-video-supporter-only";
const PROTECTED_REVISION = "rev-update-en-supporter-1";
const PROTECTED_RELEASE = "release-update-en-approved-supporter-1";
const PROTECTED_PLACEMENT = "placement-update-supporter-video";
const WITHDRAWN_AT = "2026-11-20T10:00:00Z";
/** The seed's own page edition, which places the seed's welcome video: the edition whose reach the case below changes. */
const NOT_PUBLIC_RELEASE = "release-page-en-1";
/** Every purpose a receiving read advertises for a video, the one this asset records no bytes for included. */
const VIDEO_PURPOSES = ["playback", "poster", "captions", "transcript"] as const;
/** The three purposes the protected asset serves, and so the three a reader can be admitted to. */
const PROTECTED_SERVED_PURPOSES = ["playback", "poster", "captions"] as const;
/** The committed fixture each protected rendition carries: the documents the seed serves for its own video. */
const PROTECTED_RENDITIONS = [
  { renditionId: "rendition-video-supporter-only-playback", purpose: "playback", file: "sample-h264.mp4", fixture: "sample-h264.mp4", mimeType: "video/mp4" },
  { renditionId: "rendition-video-supporter-only-poster", purpose: "poster", file: "poster.jpg", fixture: "poster.jpg", mimeType: "image/jpeg" },
  { renditionId: "rendition-video-supporter-only-captions", purpose: "captions", file: "sample.vtt", fixture: "sample.vtt", mimeType: "text/vtt" },
] as const;
/** The directory the committed media fixtures live in, which is the one a reset materialises its bytes from. */
const MEDIA_FIXTURE_DIRECTORY = fileURLToPath(new URL("../../public/fixtures/media/", import.meta.url));
/**
 * Copies one committed fixture to the custody reference a rendition records. This is what a reset's own
 * copy branch does for the bytes it serves, done here for the two assets this arm reads, because a
 * whole-store reset is not this file's to run.
 */
async function materialiseCopiedBytes(assetId: string, file: string, fixture: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(join(MEDIA_FIXTURE_DIRECTORY, fixture)));
  if (bytes.byteLength === 0) {
    throw new Error(`The committed fixture ${JSON.stringify(fixture)} is empty, so this file cannot serve bytes for "${assetId}".`);
  }
  await writeMediaBytes(seededMediaReference(assetId, file), bytes);
}
/** The video asset the first scope owns and has playback bytes for: the asset the second worker asks after. */
function firstScopeVideo(): SessionStateDocument["mediaAssets"][number] {
  return required(
    stateOf(WORKER).mediaAssets.find((record) => record.renditions.some((rendition) => rendition.purpose === "playback")),
    "video asset with playback bytes in the first scope",
  );
}
/** The published world: the seed's own established-worker documents, plus one protected edition placing one asset. */
function protectedWorld(): SeededSessionDocuments {
  const seeded = worldOf(WORKER);
  const scope = first(seeded.state.mediaAssets, "seeded media asset").scope;
  const publisherId = first(seeded.state.memberships, "seeded membership").publisherId;
  const asset: SessionStateDocument["mediaAssets"][number] = {
    assetId: PROTECTED_ASSET,
    kind: "video",
    profileCheck: { container: "mp4", codec: "avc1.64001f", durationSeconds: 5.055, width: 960, height: 540 },
    // The private original the served renditions are produced from: it is never served and never echoed.
    sourceOriginalRef: "media-originals/supporter-briefing-raw.mp4",
    renditions: PROTECTED_RENDITIONS.map((record) => ({
      renditionId: record.renditionId,
      purpose: record.purpose,
      bytesRef: seededMediaReference(PROTECTED_ASSET, record.file),
      mimeType: record.mimeType,
    })),
    scope,
    tagVerification: { checked: true, residualTags: [] },
    revision: "rev-1",
  };
  const placement: SessionStateDocument["contentRevisions"][number]["mediaPlacements"][number] = {
    placementId: PROTECTED_PLACEMENT,
    assetId: PROTECTED_ASSET,
    // An Update's body carries no sections, so the placement sits in the revision rather than in a section.
    sectionElement: null,
    position: 0,
    altText: "A short briefing for supporters on this term's costs.",
    caption: null,
    credit: "Harbour Youth",
  };
  const membership: SessionStateDocument["memberships"][number] = {
    // The grant is looked up by the reader's own principal id, so this row is that id and nothing else.
    membershipId: String(sessionOf(SUPPORTER_READER).principalId),
    email: "approved.supporter@example.org",
    displayName: "Approved-supporter reader",
    publisherId,
    purpose: UPDATE_EMAIL_PURPOSE,
    state: "active",
    acceptedAt: "2026-09-01T09:00:00Z",
    confirmationDeadline: null,
    languagePreference: "en",
    revision: "rev-1",
  };
  return {
    ...seeded,
    state: {
      ...seeded.state,
      mediaAssets: [...seeded.state.mediaAssets, asset],
      memberships: [...seeded.state.memberships, membership],
      contentRevisions: seeded.state.contentRevisions.map((revision) => (revision.revisionId === PROTECTED_REVISION ? { ...revision, mediaPlacements: [...revision.mediaPlacements, placement] } : revision)),
    },
  };
}
/** The same world with its protected edition withdrawn, which is all a withdrawal sets on a release. */
function withdrawnWorld(): SeededSessionDocuments {
  const world = protectedWorld();
  return {
    ...world,
    state: {
      ...world.state,
      releases: world.state.releases.map((release) => (release.releaseId === PROTECTED_RELEASE ? { ...release, withdrawnAt: WITHDRAWN_AT } : release)),
    },
  };
}
/** The same world with the placing Page edition's reach set to `not-public`, which is all a reach change sets on a release. */
function notPublicWorld(): SeededSessionDocuments {
  const world = protectedWorld();
  return {
    ...world,
    state: {
      ...world.state,
      releases: world.state.releases.map((release) => (release.releaseId === NOT_PUBLIC_RELEASE ? { ...release, reach: "not-public" } : release)),
    },
  };
}
/**
 * Asserts the caller is refused this address, and that the refusal is the one an address that was never
 * recorded receives — the same members, the same reason and the same serialised answer — so a retained
 * rendition address cannot be told apart from one that never existed. Answers the refusal it asserted.
 */
async function expectNeutralRefusal(source: SessionSource, assetId: string, rendition: string, what: string, rangeHeader: string | null = null): Promise<DeniedOutcome> {
  const ask = (asked: string) => (rangeHeader === null ? reads.media.readMediaAsset({ assetId: asked, rendition }, source) : reads.media.readMediaAsset({ assetId: asked, rendition, rangeHeader }, source));
  const refusedRecorded = await ask(assetId);
  const refusedNeverRecorded = await ask(NEVER_RECORDED_ASSET);
  const denial = denialOf(refusedRecorded, what);
  expect(denial.outcome).toBe("denied");
  expect(denial.reasonCode).toBe("no-permission");
  // Three members and nothing else: a fourth would be a fact about the media.
  expect(Object.keys(denial).toSorted()).toEqual(["operationId", "outcome", "reasonCode"]);
  expectNoDisclosure(denial, what);
  expect(textOf(refusedRecorded)).toBe(textOf(refusedNeverRecorded));
  return denial;
}
describe("every rendition re-authorises the request that asks for it", () => {
  beforeAll(async () => {
    // The bytes both worlds' renditions are recorded to serve, and the published world the receiving reads
    // answer a reader from. Both are laid down through the store's own `resetSession` and its media custody,
    // never by writing the store's on-disk format here.
    for (const entry of SEEDED_MEDIA_BYTES) {
      if (entry.producedBy === "copy") {
        await materialiseCopiedBytes(entry.assetId, entry.file, entry.fixture);
      }
    }
    for (const record of PROTECTED_RENDITIONS) {
      await materialiseCopiedBytes(PROTECTED_ASSET, record.file, record.fixture);
    }
    await resetSession(PUBLISHED_WORLD, protectedWorld());
  });
  afterAll(async () => {
    // The seed's own documents go back under the shared id, so no later suite reads this arm's edition.
    await resetSession(PUBLISHED_WORLD, worldOf(WORKER));
  });
  it("refuses the second worker every purpose of another scope's asset, a byte range included, as one neutral refusal", async () => {
    const asset = firstScopeVideo();
    const refusals: DeniedOutcome[] = [];
    for (const purpose of VIDEO_PURPOSES) {
      refusals.push(await expectNeutralRefusal(sourceOf(SECOND_WORKER), asset.assetId, purpose, `the second worker's ${purpose} request`));
    }
    // A range request is a rendition request: it re-authorises like the whole-entity one, so it cannot
    // become the way around the refusal.
    refusals.push(await expectNeutralRefusal(sourceOf(SECOND_WORKER), asset.assetId, "playback", "the second worker's byte-range request", "bytes=0-15"));
    // Every advertised purpose, and the range, answer the one refusal: no purpose carries a fact another
    // does not, so asking each of them in turn tells the caller nothing about the asset.
    expect(new Set(refusals.map((refusal) => refusal.reasonCode))).toEqual(new Set(["no-permission"]));
    expect(new Set(refusals.map((refusal) => textOf(refusal))).size).toBe(1);
  });
  it("serves the owning scope its own playback, poster and captions, whole and as a byte range", async () => {
    const asset = firstScopeVideo();
    const lengths = new Map<string, number>();
    for (const purpose of PROTECTED_SERVED_PURPOSES) {
      const whole = envelopeOf(await reads.media.readMediaAsset({ assetId: asset.assetId, rendition: purpose }, sourceOf(WORKER)), `the owning scope's ${purpose} rendition`);
      expect(whole.data.purpose).toBe(purpose);
      expect(whole.data.status).toBe(200);
      // Real bytes rather than an empty body: the scope that recorded the asset is served the asset.
      expect(whole.data.bytes.byteLength).toBeGreaterThan(0);
      expect(whole.data.contentLength).toBe(whole.data.bytes.byteLength);
      expect(whole.data.headers["content-range"]).toBeUndefined();
      lengths.set(purpose, whole.data.contentLength);
    }
    const total = required(lengths.get("playback"), "length of the owned playback rendition");
    const ranged = envelopeOf(await reads.media.readMediaAsset({ assetId: asset.assetId, rendition: "playback", rangeHeader: "bytes=0-15" }, sourceOf(WORKER)), "a byte range of the owning scope's playback rendition");
    expect(ranged.data.status).toBe(206);
    expect(ranged.data.bytes.byteLength).toBe(16);
    expect(ranged.data.headers["content-range"]).toBe(`bytes 0-15/${String(total)}`);
  });
  it("refuses the unauthorized reader the protected edition and serves it to the reader holding the grant", async () => {
    for (const purpose of VIDEO_PURPOSES) {
      await expectNeutralRefusal(sourceOf(READER), PROTECTED_ASSET, purpose, `the unauthorized reader's ${purpose} request`);
    }
    await expectNeutralRefusal(sourceOf(READER), PROTECTED_ASSET, "playback", "the unauthorized reader's byte-range request", "bytes=0-15");
    const lengths = new Map<string, number>();
    for (const purpose of PROTECTED_SERVED_PURPOSES) {
      const served = envelopeOf(await reads.media.readMediaAsset({ assetId: PROTECTED_ASSET, rendition: purpose }, sourceOf(SUPPORTER_READER)), `the approved-supporter reader's ${purpose} rendition`);
      expect(served.data.purpose).toBe(purpose);
      expect(served.data.status).toBe(200);
      expect(served.data.bytes.byteLength).toBeGreaterThan(0);
      expect(served.data.contentLength).toBe(served.data.bytes.byteLength);
      lengths.set(purpose, served.data.contentLength);
    }
    const total = required(lengths.get("playback"), "length of the protected playback rendition");
    const ranged = envelopeOf(await reads.media.readMediaAsset({ assetId: PROTECTED_ASSET, rendition: "playback", rangeHeader: "bytes=0-15" }, sourceOf(SUPPORTER_READER)), "the approved-supporter reader's byte range of the protected playback rendition");
    expect(ranged.data.status).toBe(206);
    expect(ranged.data.bytes.byteLength).toBe(16);
    expect(ranged.data.headers["content-range"]).toBe(`bytes 0-15/${String(total)}`);
  });
  it("withdraws the protected edition and refuses the reader it served a moment before", async () => {
    const before = envelopeOf(await reads.media.readMediaAsset({ assetId: PROTECTED_ASSET, rendition: "playback" }, sourceOf(SUPPORTER_READER)), "the approved-supporter reader's rendition before the withdrawal");
    expect(before.data.status).toBe(200);
    expect(before.data.bytes.byteLength).toBeGreaterThan(0);
    await resetSession(PUBLISHED_WORLD, withdrawnWorld());
    try {
      for (const purpose of VIDEO_PURPOSES) {
        await expectNeutralRefusal(sourceOf(SUPPORTER_READER), PROTECTED_ASSET, purpose, `the approved-supporter reader's ${purpose} request after the withdrawal`);
      }
      await expectNeutralRefusal(sourceOf(SUPPORTER_READER), PROTECTED_ASSET, "playback", "the approved-supporter reader's byte-range request after the withdrawal", "bytes=0-15");
    } finally {
      // The live edition goes back, so the published world is what it was once this case has finished.
      await resetSession(PUBLISHED_WORLD, protectedWorld());
    }
  });
  it("refuses a not-public page edition's playback, poster and captions to every reader, and still serves the scope that owns the asset", async () => {
    // Reach decides what a direct link may serve, so an edition set to Not public places media no reader may
    // fetch. The refusal is the same neutral one an address that was never recorded answers, for every
    // purpose the edition advertises and for the reader holding the protected-reading grant alike.
    await resetSession(PUBLISHED_WORLD, notPublicWorld());
    try {
      const asset = firstScopeVideo();
      for (const reader of [READER, SUPPORTER_READER]) {
        for (const purpose of PROTECTED_SERVED_PURPOSES) {
          await expectNeutralRefusal(sourceOf(reader), asset.assetId, purpose, `"${reader}" asking a not-public edition for ${purpose}`);
        }
      }
      // The owning scope reads its own world, where the asset's recorded scope is the whole authority: the
      // reach of the edition that places it takes nothing from the worker who recorded it.
      for (const purpose of PROTECTED_SERVED_PURPOSES) {
        const served = envelopeOf(await reads.media.readMediaAsset({ assetId: asset.assetId, rendition: purpose }, sourceOf(WORKER)), `the owning scope's ${purpose} rendition of a not-public edition's asset`);
        expect(served.data.purpose).toBe(purpose);
        expect(served.data.status).toBe(200);
        expect(served.data.bytes.byteLength).toBeGreaterThan(0);
        expect(served.data.contentLength).toBe(served.data.bytes.byteLength);
      }
    } finally {
      // The listed edition goes back, so the published world is what it was once this case has finished.
      await resetSession(PUBLISHED_WORLD, protectedWorld());
    }
  });
});
