/** Proves the authorisation boundary of success criteria 3 and 19 at the service: a refused read discloses no count, title, existence flag or size; a search, a sort or a page cannot be turned into a disclosure oracle. */ import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UPDATE_EMAIL_PURPOSE } from "@/modules/audience/membership";
import { mutations, reads, type ReadResult } from "@/modules/data-service";
import { canExport, canReadProtected, canView, resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { VALUE_STATES, buildEnvelope, recordedValueStateSchema, sameScope, type PartnerRecord, type ReadEnvelope, type RecordedValueState, type Scope, type ValueState } from "@/modules/data-service/envelope";
import { DENIAL_REASONS, type DenialReason, type DeniedOutcome } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, SEEDED_MEDIA_BYTES, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { removeIfExists } from "@/modules/store/atomic";
import { seededMediaReference, writeMediaBytes } from "@/modules/store/media";
import { sessionPaths } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { expectDenial, expectEnvelope, expectGranted, expectMembersAbsent, expectOutcome, expectOutage, expectRefused, first, firstWhere, required, throwing } from "../helpers/answers";
// This file's own sessions: a private id per seeded identity, so no other suite's world is shared
interface Fixture {
  /** The session id this file owns; every seeded document below is laid down under it. */ readonly sessionId: string;
  /** The seeded identity whose world it holds. */ readonly seedId: string;
}
const WORKER = "domain-scope-redaction-worker";
const WORKER_STUDENTS = "domain-scope-redaction-worker-students";
const SECOND_WORKER = "domain-scope-redaction-second-worker";
const FUNDRAISER = "domain-scope-redaction-fundraiser";
const COACH = "domain-scope-redaction-coach";
const READER = "domain-scope-redaction-reader";
/** The reader the published world's protected edition names in its grant, driven as a distinct seeded session. */ const SUPPORTER_READER = "domain-scope-redaction-reader-supporter";
/** A session the store holds no documents for at all: the resolver must refuse it, never invent one. */ const ABSENT_SESSION = "domain-scope-redaction-absent";
/** A session whose state document exists and whose operation ledger and meta documents do not: the store's own fault. */ const OUTAGE_SESSION = "domain-scope-redaction-outage";
/** The colleague's identity over the worker's record set: one ministry's store read by a second principal. */ const COLLEAGUE_WORLD = "domain-scope-redaction-colleague-in-worker-world";
/** A reader whose own world holds another person's membership row: the shared reader world the preferences read answers from. */ const SHARED_WORLD_READER = "domain-scope-redaction-reader-in-shared-world";
/** The four seeded session states that are not signed in, each laid down under an id of this file's own so every audience read is asked of each of them. */ const DENIED_SESSION = "domain-scope-redaction-session-denied";
const NO_ACCESS_SESSION = "domain-scope-redaction-no-access";
const EXPIRED_SESSION = "domain-scope-redaction-session-expired";
const UNAVAILABLE_SESSION = "domain-scope-redaction-session-unavailable";
const FIXTURES: readonly Fixture[] = [
  { sessionId: WORKER, seedId: DEFAULT_SESSION_ID }, // The established worker: two ministries, partial financial coverage, private notes, a private preparation record and the gifts every support read below is measured over.
  { sessionId: WORKER_STUDENTS, seedId: "established-worker-students" }, // The same worker with the students ministry selected: the same principal in a second admitted context, whose financial source covers its whole period.
  { sessionId: SECOND_WORKER, seedId: "second-worker" }, // Another ministry entirely, holding none of the first scope's records.
  { sessionId: FUNDRAISER, seedId: "deputized-fundraiser" }, // A second authorised member of the worker's own ministry, with a different principal.
  { sessionId: COACH, seedId: "coach" },
  { sessionId: READER, seedId: "reader-unauthorized" },
  { sessionId: SUPPORTER_READER, seedId: "reader-approved-supporter" }, // The other reader: the one persona the published world's protected edition holds a grant for, so the same rendition is asked of a reader it admits and one it does not.
  { sessionId: DENIED_SESSION, seedId: "session-denied" }, // The seeded `denied` state: refused with nothing disclosed.
  { sessionId: NO_ACCESS_SESSION, seedId: "no-access" }, // The seeded `no-access` state: no usable account, so account recovery is the only honest outcome.
  { sessionId: EXPIRED_SESSION, seedId: "session-expired" }, // The seeded `expired` state: the session has ended and needs signing in again.
  { sessionId: UNAVAILABLE_SESSION, seedId: "session-unavailable" }, // The seeded `unavailable` state: admission could not be resolved at all.
];
/** The seeded worlds, keyed by the session id this file laid them down under. */ const seededWorlds = new Map<string, SeededSessionDocuments>();
/** The public sessions this file resolves once, so every case acts as the identity it names. */ const sessions = new Map<string, ResolvedSession>();
const worldOf = (sessionId: string): SeededSessionDocuments => required(seededWorlds.get(sessionId), `seeded world for "${sessionId}"`);
const stateOf = (sessionId: string): SessionStateDocument => worldOf(sessionId).state;
const sessionOf = (sessionId: string): ResolvedSession => required(sessions.get(sessionId), `resolved session "${sessionId}"`);
const sourceOf = (sessionId: string): SessionSource => ({ sessionId });
beforeAll(async () => {
  for (const entry of SEEDED_MEDIA_BYTES) if (entry.producedBy === "copy") await materialiseCopiedBytes(entry.assetId, entry.file, entry.fixture); // The bytes every rendition below is served from, laid down through the store's own media custody rather than by writing its on-disk format here.
  const bySeedId = new Map((await seed()).map((row) => [row.sessionId, row]));
  for (const fixture of FIXTURES) {
    const row = required(bySeedId.get(fixture.seedId), `seeded session "${fixture.seedId}"`);
    seededWorlds.set(fixture.sessionId, row.documents);
    await resetSession(fixture.sessionId, row.documents);
  }
  // A coach is admitted to the worker's shared coaching records without becoming the worker, so its seat names this file's own worker session and reads that world's record: the coach's own document holds no coaching family at all, which is what makes the read below proof rather than a copy.
  const seatedCoach = { ...worldOf(COACH), meta: { ...worldOf(COACH).meta, coachingRecordsSessionId: WORKER } };
  seededWorlds.set(COACH, seatedCoach);
  await resetSession(COACH, seatedCoach);
  // The outage fixture: the commit marker exists and the rest of the document set does not, which is the state a store that lost a write is genuinely in, so the resolver and every read answer with the outage rather than with an empty result or a denial.
  const outage = required(bySeedId.get(DEFAULT_SESSION_ID), `seeded session "${DEFAULT_SESSION_ID}"`);
  seededWorlds.set(OUTAGE_SESSION, outage.documents);
  await resetSession(OUTAGE_SESSION, outage.documents);
  await removeIfExists(sessionPaths(OUTAGE_SESSION).operations);
  // No seeded world lays another principal's private note in front of a colleague's read, so the colleague's is the worker's record set under the colleague's own metadata: the store's own documents, composed rather than written, in the state a ministry shared by two principals is in.
  await resetSession(COLLEAGUE_WORLD, { ...required(seededWorlds.get(FUNDRAISER), "seeded world of the colleague"), state: stateOf(WORKER) });
  // No seeded reader world holds a row for anybody but its reader, so the shared one is composed: a reader's own documents carrying one membership the reader's principal does not own, which is the state a reader seat over a shared world would find.
  await resetSession(SHARED_WORLD_READER, { ...worldOf(READER), state: { ...stateOf(READER), memberships: [first(stateOf(WORKER).memberships, "seeded membership")] } });
  for (const fixture of FIXTURES) {
    const resolution = await resolveSession(sourceOf(fixture.sessionId));
    if (!resolution.ok) throw new Error(`The seeded session "${fixture.sessionId}" did not resolve: ${JSON.stringify(resolution.refusal)}.`);
    sessions.set(fixture.sessionId, resolution.session);
  }
});
afterAll(async () => {
  for (const sessionId of [...FIXTURES.map((fixture) => fixture.sessionId), OUTAGE_SESSION, ABSENT_SESSION, COLLEAGUE_WORLD, SHARED_WORLD_READER]) await resetSession(sessionId); // Only this file's own sessions are removed: the directory holds other suites' worlds.
});
/** The observable shape of one value as a surface would receive it: the whole thing, serialised. */ const textOf = (value: unknown): string => JSON.stringify(value);
/** Asserts a refusal carries none of the evidence a disclosure would need. */ const expectNoDisclosure = (denial: DeniedOutcome, what: string): void => {
  expectMembersAbsent(denial, ["data", "envelope", "total", "totalCount", "count", "size", "bytes", "length", "title", "name", "displayName", "label", "partnerId", "id", "ids", "rows", "records", "items", "exists", "found", "revision", "scope", "source", "asOf", "coverage", "valueStates", "actions"], what);
};
/** Asserts a text carries none of the needles, naming the one that would have leaked. */ const expectNoText = (haystack: string, needles: readonly string[], what: string): void => {
  for (const needle of needles) expect(haystack.includes(needle), `${what} must not carry ${JSON.stringify(needle)}`).toBe(false);
};
/** The states whose figure carries no digits: only a value, a genuine zero and the derived subtotal do. */ const STATES_CARRYING_AN_AMOUNT: readonly ValueState[] = ["value", "zero", "incomplete-subtotal"];
/** The first record of the first scope a case names by predicate, failing by the name it is known by. */ const partnerWhere = (match: (record: PartnerRecord) => boolean, what: string): PartnerRecord => first(stateOf(WORKER).partners.filter(match), what);
/** A partner in the first scope by kind, taken from the seed rather than named here. */ const partnerOfKind = (kind: PartnerRecord["kind"]): PartnerRecord => partnerWhere((record) => record.kind === kind, `"${kind}" record in the first scope`);
/** A partner in the first scope, taken from the seed rather than named here. */ const firstScopePartner = (): PartnerRecord => partnerOfKind("person");
/** Whether a record is the person the seed records as the church's warden: the representative a church's own record must not carry. */ const isChurchWarden = (record: PartnerRecord): boolean => record.kind === "person" && record.stage !== null && record.stage.toLowerCase().includes("warden");
/** The seeded private note about a shared person: the record a shared projection must never carry. */ function noteAboutSharedPerson(): { readonly partnerId: string; readonly body: string } {
  const partners = stateOf(WORKER).partners;
  return stateOf(WORKER).privateNotes.find((candidate) => partners.some((record) => record.partnerId === candidate.partnerId && record.kind === "person")) ?? throwing("private note about a shared person");
}
it("authorisation precedes enumeration: refuses the second worker the first scope's partner, and carries no count, title, name, existence flag or size", async () => {
  const denial = expectDenial(await reads.partners.readPartner(firstScopePartner().partnerId, {}, sourceOf(SECOND_WORKER)), "the second worker reading a partner of the first scope");
  expect([denial.outcome, denial.reasonCode]).toEqual(["denied", "no-permission"]);
  expect(Object.keys(denial).toSorted()).toEqual(["operationId", "outcome", "reasonCode"]); // The denial is made of three members and nothing else: a fourth would be a fact about the record.
  expectNoDisclosure(denial, "a scope denial");
});
it("authorisation precedes enumeration: answers an existing record and a non-existent identifier identically, so a denial cannot enumerate", async () => {
  const record = firstScopePartner();
  const existing = await reads.partners.readPartner(record.partnerId, {}, sourceOf(SECOND_WORKER));
  const absent = await reads.partners.readPartner("partner-that-was-never-recorded", {}, sourceOf(SECOND_WORKER));
  const existingDenial = expectDenial(existing, "the denial of an existing record");
  const absentDenial = expectDenial(absent, "the denial of a non-existent identifier");
  expect([existingDenial, Object.keys(existingDenial).toSorted()]).toEqual([absentDenial, Object.keys(absentDenial).toSorted()]); // Any difference at all — a reason code, a member, a message — lets a caller ask "does this exist?".
  expect(textOf(existing)).toBe(textOf(absent));
});
it("authorisation precedes enumeration: refuses the unauthorized reader the protected receiving read, with nothing about it disclosed", async () => {
  const reader = sessionOf(READER);
  const membership = first(stateOf(WORKER).memberships, "seeded membership");
  // The refusal is asked of the one function the receiving reads authorise with, using an empty membership list: the reader holds no membership of this publisher for this purpose.
  const grant = { audience: "approved-supporter" as const, reader: { recipientId: String(reader.principalId), publisherId: membership.publisherId, purpose: membership.purpose, memberships: [] } };
  const decision = canReadProtected(reader, grant);
  const denial = expectRefused(decision, "an unauthorized reader's protected read");
  expect(denial.reasonCode).toBe("no-protected-grant");
  // The decision is the refusal and nothing else: no audience, no edition, no title, no count. A reader the grant names at all is refused exactly as one it names nothing for, so "there is no such membership" and "there is no such reader" cannot be told apart either.
  expect(Object.keys(decision).toSorted()).toEqual(["allowed", "denial"]);
  expectNoDisclosure(denial, "a protected-read refusal");
  expect(canReadProtected(reader, { audience: "approved-supporter", reader: null })).toEqual(decision);
});
it("authorisation precedes enumeration: refuses the unauthorized reader every scoped record read, since it is admitted to no context", async () => {
  const record = firstScopePartner();
  const partnerDenial = expectDenial(await reads.partners.readPartner(record.partnerId, {}, sourceOf(READER)), "the unauthorized reader's partner read");
  expectNoDisclosure(partnerDenial, "an admission denial");
  for (const value of [partnerDenial.reasonCode, expectDenial(await reads.partners.findPartners({}, sourceOf(READER)), "the unauthorized reader's roster").reasonCode]) expect(value).toBe("not-admitted");
  const exportDenial = expectDenial(await reads.export.readExport({}, sourceOf(READER)), "the unauthorized reader's export");
  expect([DENIAL_REASONS.includes(exportDenial.reasonCode), Object.keys(exportDenial).toSorted()]).toEqual([true, ["operationId", "outcome", "reasonCode"]]);
});
it("a search, a sort and a page cannot become a disclosure oracle: reports the whole authorised total as an integer and returns no row from another scope", async () => {
  const theirs = firstScopePartner();
  const crossScope = expectEnvelope(await reads.partners.findPartners({ search: theirs.displayName.split(" ").at(-1) ?? theirs.displayName }, sourceOf(SECOND_WORKER)), "the second worker's roster search");
  expect([Number.isInteger(crossScope.data.total), crossScope.data.total, crossScope.data.rows]).toEqual([true, 0, []]); // The integer, not merely emptiness: a `total` that counted the other scope's matches would tell the caller how many records it holds.
  const roster = expectEnvelope(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
  const authorisedIds = new Set(stateOf(SECOND_WORKER).partners.map((record) => record.partnerId));
  const returnedIds = roster.data.rows.map((row) => row.partner.partnerId);
  expect([[Number.isInteger(roster.data.total), roster.data.total], new Set(returnedIds)]).toEqual([[true, returnedIds.length], authorisedIds]);
  const otherScopeIds = new Set(stateOf(WORKER).partners.map((record) => record.partnerId));
  expect(
    returnedIds.filter((partnerId) => otherScopeIds.has(partnerId)),
    "the second worker's roster must return no record of the first scope",
  ).toEqual([]);
});
it("a search, a sort and a page cannot become a disclosure oracle: answers a page beyond the authorised set with the last page it holds and an unchanged total", async () => {
  const roster = expectEnvelope(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
  const last = expectEnvelope(await reads.partners.findPartners({ page: { index: roster.data.page.totalPages - 1 } }, sourceOf(SECOND_WORKER)), "the last page the authorised set holds");
  const beyond = expectEnvelope(await reads.partners.findPartners({ page: { index: 6 } }, sourceOf(SECOND_WORKER)), "a page beyond the authorised set");
  // The unchanged total is the property that matters: an offset must not let a caller measure what it cannot see, so a page beyond the last one the authorised result holds answers that last page rather than a page index the result does not have beside no rows.
  expect([beyond.data.page.index, beyond.data.total, beyond.data.rows.map((row) => row.partner.partnerId)]).toEqual([last.data.page.index, roster.data.total, last.data.rows.map((row) => row.partner.partnerId)]);
  const authorisedIds = new Set(stateOf(SECOND_WORKER).partners.map((record) => record.partnerId));
  expect(
    beyond.data.rows.filter((row) => !authorisedIds.has(row.partner.partnerId)),
    "the last page a page beyond it answers must hold no record outside the resolved scope",
  ).toEqual([]);
});
it("a search, a sort and a page cannot become a disclosure oracle: keeps every sorted row inside the resolved scope", async () => {
  const roster = expectEnvelope(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
  const sorted = expectEnvelope(await reads.partners.findPartners({ sort: { field: "displayName", direction: "desc" } }, sourceOf(SECOND_WORKER)), "the second worker's sorted roster");
  const authorisedIds = new Set(stateOf(SECOND_WORKER).partners.map((record) => record.partnerId));
  const sortedIds = sorted.data.rows.map((row) => row.partner.partnerId);
  expect(sorted.data.total).toBe(roster.data.total);
  expect(sortedIds.toSorted()).toEqual(roster.data.rows.map((row) => row.partner.partnerId).toSorted());
  expect(
    sortedIds.filter((partnerId) => !authorisedIds.has(partnerId)),
    "sorting must return no record outside the resolved scope",
  ).toEqual([]);
});
it("a search, a sort and a page cannot become a disclosure oracle: keeps denied, empty and unavailable three distinguishable answers to the same read", async () => {
  const denied = expectDenial(await reads.partners.findPartners({}, sourceOf(READER)), "the unauthorized reader's roster");
  const empty = expectEnvelope(await reads.partners.findPartners({ search: "no recorded partner carries this phrase" }, sourceOf(SECOND_WORKER)), "an authorised empty result");
  const outage = expectOutage(await reads.partners.findPartners({}, sourceOf(OUTAGE_SESSION)), "a roster read whose source is down");
  expect([denied.outcome, DENIAL_REASONS.includes(denied.reasonCode)]).toEqual(["denied", true]); // Denied: a refusal, and no envelope at all.
  expect(empty.data.total).toBe(0); // Empty: an envelope, a genuine zero count, and no refusal inside it.
  expectMembersAbsent(empty, ["denied", "unavailable"], "an authorised empty result");
  expect(outage.outcome).toBe("unavailable"); // Unavailable: the outage itself, naming its source and its guidance, and no data.
  for (const stated of [outage.source.system, outage.guidance]) expect(stated.length).toBeGreaterThan(0);
  expectMembersAbsent(outage, ["data", "envelope", "total", "rows", "records"], "a source outage");
  expect(denied).not.toEqual(empty); // All three differ from each other on the same read, which is what a surface needs to render them differently: a denied read has no total, an empty one has zero, and an outage has neither.
  expect(outage).not.toEqual(empty);
  expect(denied.reasonCode).not.toBe(outage.outcome);
});
/** The scope the resolver selected for one of this file's sessions: the authority, never a hand-built literal. */ const selectedScopeOf = (sessionId: string): Scope => required(sessionOf(sessionId).selected, `the selected context of "${sessionId}"`);
/** Creates one private preparation record through the service and answers with the identifier it created. */ async function createPreparation(displayName: string, email: string, postal: string): Promise<string> {
  const roster = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster before a creation");
  // A creation compares no revision, because there is no stored value a stale expectation could overwrite; the caller still states the collection revision it read.
  const contactMethods = [
    { kind: "email" as const, value: email, permitted: true },
    { kind: "postal" as const, value: postal, permitted: true },
  ];
  const outcome = await mutations.partnerPreparation.createPrivatePreparation({ operationId: randomUUID(), scope: selectedScopeOf(WORKER), expectedRevision: roster.revision, payload: { displayName, contactMethods } }, sourceOf(WORKER));
  return first(expectOutcome(outcome, "accepted").created ?? [], "identifier created by createPrivatePreparation");
}
it("a private record stays private: never puts a private note body, or its first line, in the shared projection of the record it is about", async () => {
  const note = noteAboutSharedPerson();
  const shared = expectEnvelope(await reads.partners.readPartner(note.partnerId, {}, sourceOf(WORKER)), "the shared projection of a noted record");
  expectNoText(textOf(shared.data), [note.body, note.body.slice(0, 28)], "the shared projection of a noted record"); // The whole body and a truncated leading line, because a list preview leaks exactly that.
  expectMembersAbsent(shared.data, ["notes", "privateNotes"], "the shared projection of a noted record");
  const privateRead = expectEnvelope(await reads.partners.readPrivatePreparation({ partnerId: note.partnerId }, sourceOf(WORKER)), "the author's own private read");
  expect(privateRead.data.notes.map((row) => row.body)).toContain(note.body);
});
it("a private record stays private: refuses a private note to another principal admitted to the same ministry", async () => {
  const workerScope = selectedScopeOf(WORKER);
  const fundraiser = sessionOf(FUNDRAISER);
  const fundraiserScope = selectedScopeOf(FUNDRAISER);
  expect([fundraiserScope.organizationId, fundraiserScope.ministryId]).toEqual([workerScope.organizationId, workerScope.ministryId]); // Same organisation and ministry, different principal: the ministry is shared, the note is not.
  expect(fundraiserScope.principalId).not.toBe(workerScope.principalId);
  expect(sameScope(fundraiserScope, workerScope)).toBe(false);
  const colleague = expectRefused(canView(fundraiser, { kind: "private-note", scope: fundraiserScope, authorPrincipalId: sessionOf(WORKER).principalId }), "a colleague in the same ministry reading another principal's private note");
  expect(colleague.reasonCode).toBe("no-permission");
  expectNoDisclosure(colleague, "a private-note refusal");
  expectGranted(canView(sessionOf(WORKER), { kind: "private-note", scope: workerScope, authorPrincipalId: sessionOf(WORKER).principalId }), "the author reading their own private note");
});
it("a private record stays private: keeps a private preparation record author-only, at the read and at the permission question", async () => {
  const preparation = partnerOfKind("private-preparation");
  const own = expectEnvelope(await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(WORKER)), "the author's private preparation");
  expect(own.data.preparation?.partnerId).toBe(preparation.partnerId);
  const colleague = expectRefused(canView(sessionOf(FUNDRAISER), { kind: "partner", scope: selectedScopeOf(FUNDRAISER), audience: "private", authorPrincipalId: sessionOf(WORKER).principalId }), "a colleague in the same ministry reading another principal's private preparation");
  expect(colleague.reasonCode).toBe("no-permission");
  // The shared record class is admitted to that same colleague, so the refusal is about the private record rather than about the ministry.
  expectGranted(canView(sessionOf(FUNDRAISER), { kind: "partner", scope: selectedScopeOf(FUNDRAISER), audience: "shared", authorPrincipalId: null }), "a colleague in the same ministry reading a shared record");
  expect(stateOf(WORKER).privateNotes.filter((note) => note.partnerId === preparation.partnerId).length).toBeGreaterThan(0); // The record-level half of the same rule: a colleague in the same ministry is refused the record itself, so no preparation field, note body, count or existence hint reaches them.
  const colleaguePreparation = expectDenial(await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(COLLEAGUE_WORLD)), "the colleague's private read of the preparation record");
  expect(colleaguePreparation.reasonCode).toBe("no-permission");
  expectNoDisclosure(colleaguePreparation, "a colleague's private-preparation refusal");
  const notedPerson = noteAboutSharedPerson(); // The same colleague, on the shared person the worker's note is about, is refused the note and shown no preparation field.
  const colleaguePerson = expectEnvelope(await reads.partners.readPrivatePreparation({ partnerId: notedPerson.partnerId }, sourceOf(COLLEAGUE_WORLD)), "the colleague's private read of a shared person carrying the worker's note");
  expect(colleaguePerson.data.notes).toEqual([]);
  expectNoText(textOf(colleaguePerson.data), [notedPerson.body, notedPerson.body.slice(0, 28)], "the colleague's private read of a shared person");
  expect(colleaguePerson.data.preparation).toBeUndefined();
  // The author's read of that same record does carry the note, so the read filters per principal rather than answering everyone with nothing.
  const authorPerson = expectEnvelope(await reads.partners.readPrivatePreparation({ partnerId: notedPerson.partnerId }, sourceOf(WORKER)), "the author's private read of the same shared person");
  expect(authorPerson.data.notes.map((note) => note.body)).toContain(notedPerson.body);
  expect(expectDenial(await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(SECOND_WORKER)), "another ministry reading a private preparation").reasonCode).toBe("no-permission");
  expect(expectDenial(await reads.partners.readPrivatePreparation({ partnerId: preparation.partnerId }, sourceOf(READER)), "an unauthorized reader reading a private preparation").reasonCode).toBe("not-admitted");
});
it("a private record stays private: an archived preparation leaves the working roster, is named by its own facet value and returns on restore", async () => {
  const preparation = partnerOfKind("private-preparation");
  const rosterBefore = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster before an archive");
  // The seeded private preparation belongs to the working roster to begin with, so its absence below is the archive's own effect rather than a record the read never held.
  expect(rosterBefore.data.rows.map((row) => row.partner.partnerId)).toContain(preparation.partnerId);
  const own = expectEnvelope(await reads.partners.readPartner(preparation.partnerId, {}, sourceOf(WORKER)), "the preparation record the archive acts on");
  const archive = await mutations.partnerPreparation.archivePreparation({ operationId: randomUUID(), scope: selectedScopeOf(WORKER), expectedRevision: own.revision, payload: { partnerId: preparation.partnerId } }, sourceOf(WORKER));
  expectOutcome(archive, "accepted");
  // An archive takes the record out of the working list: the whole-result total falls by one, no row names it, and no row is left stating the archived state the list omits.
  const archived = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster after the archive");
  expect(archived.data.total).toBe(rosterBefore.data.total - 1);
  expect(archived.data.rows.map((row) => row.partner.partnerId)).not.toContain(preparation.partnerId);
  expect(archived.data.rows.some((row) => row.partner.archived)).toBe(false);
  const preparationFacet = firstWhere(archived.data.facets, "id", "preparation-state", "the preparation-state facet of the archived roster");
  const optionOf = (value: string) =>
    required(
      preparationFacet.options.find((option) => option.id === value),
      `the preparation-state "${value}" option`,
    );
  // The facet states where the record went rather than counting it in place: the archived value names it and counts one, while the audience it left counts nothing the list cannot show.
  expect([optionOf("archived").label, optionOf("archived").count, optionOf("private").count]).toEqual(["Archived record", 1, 0]);
  // Selecting that value is the one way back to the archived record, and it returns exactly that record, which is what keeps the record's Restore action reachable from the roster.
  const selected = expectEnvelope(await reads.partners.findPartners({ applied: { "preparation-state": ["archived"] } }, sourceOf(WORKER)), "the roster narrowed to the archived value");
  expect([selected.data.total, selected.data.rows.map((row) => row.partner.partnerId), selected.data.unappliedFacets]).toEqual([1, [preparation.partnerId], []]);
  expect(first(selected.data.rows, "the archived row").partner.archived).toBe(true);
  const archivedRecord = expectEnvelope(await reads.partners.readPartner(preparation.partnerId, {}, sourceOf(WORKER)), "the archived preparation read by its record");
  const restore = await mutations.partnerPreparation.restorePreparation({ operationId: randomUUID(), scope: selectedScopeOf(WORKER), expectedRevision: archivedRecord.revision, payload: { partnerId: preparation.partnerId } }, sourceOf(WORKER));
  expectOutcome(restore, "accepted");
  // A restore puts the record back where the archive took it from, at the whole-result total it left, so nothing the archive omitted is lost to the working list.
  const restored = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster after the restore");
  expect([restored.data.total, restored.data.rows.map((row) => row.partner.partnerId).includes(preparation.partnerId)]).toEqual([rosterBefore.data.total, true]);
});
it("a private record stays private: carries no private note and no private preparation into the export, and refuses the export where the caller holds no context", async () => {
  const preparation = partnerOfKind("private-preparation");
  const bodies = stateOf(WORKER).privateNotes.map((note) => note.body);
  expect(bodies.length).toBeGreaterThan(0);
  const heads = bodies.map((body) => body.slice(0, 28));
  const exported = expectEnvelope(await reads.export.readExport({}, sourceOf(WORKER)), "the worker's export");
  expect(exported.data.csv.length).toBeGreaterThan(0);
  expectGranted(canExport(sessionOf(WORKER), selectedScopeOf(WORKER)), "the worker's export"); // Export permission belongs to a context of membership, so it is asked of the resolver's scope and refused for a principal that holds no membership at all.
  expect(expectRefused(canExport(sessionOf(COACH), selectedScopeOf(WORKER)), "a principal holding no membership exporting the worker's scope").reasonCode).toBe("no-export-permission");
  expectNoText(exported.data.csv, [...bodies, ...heads, preparation.displayName], "the exported CSV");
  expectNoText(textOf(exported.data), [...bodies, ...heads, preparation.displayName], "the export model");
  // An export is a permission of a context: a principal that selected no context holds none.
  for (const sessionId of [READER, COACH]) {
    const refused = expectDenial(await reads.export.readExport({}, sourceOf(sessionId)), `the export attempted by "${sessionId}"`);
    expect(DENIAL_REASONS).toContain(refused.reasonCode);
    expectNoDisclosure(refused, `the export denial of "${sessionId}"`);
  }
});
it("a private record stays private: shows a coach no private label, no private note and no financial module it was not granted", async () => {
  const activeGrant = stateOf(WORKER).coachingGrants.find((record) => record.state === "active"); // The record the coach addresses is the worker's own, so the grant and the private labels the coach must not disclose are read from that world.
  const grant = required(activeGrant, "active coaching grant");
  const subject = expectEnvelope(await reads.coach.readCoachSubject({ grantId: grant.grantId }, sourceOf(COACH)), "the coach's subject read");
  const labels = stateOf(WORKER)
    .coachingTargets.map((target) => target.privateLabel)
    .filter((label) => label.length > 0);
  expect(labels.length).toBeGreaterThan(0);
  expectNoText(textOf(subject.data), [...labels, ...stateOf(WORKER).privateNotes.map((note) => note.body)], "the coach projection");
  // The admitted module set is the grant's own, so a module the worker kept unselected is not even named in the answer.
  const sharedModules = Object.entries(grant.modules)
    .filter(([, selected]) => selected)
    .map(([module]) => module);
  expect(subject.data.modules.map((view) => view.module).toSorted()).toEqual(sharedModules.toSorted());
  expect(sharedModules).not.toContain("support-results");
  expect(/gift|donor|commitment/i.test(textOf(subject.data))).toBe(false);
  expect(subject.actions.map((action) => action.name).toSorted()).toEqual(["acceptInvitation", "leaveCoaching"]); // A coach reads and never writes: the only two writes offered are accepting the invitation and leaving a relationship, and no edit, assign, complete, remind or export action appears at all.
});
it("equal-looking identifiers never join: keeps two records that share a display name, an email address and a postal address as two records", async () => {
  const displayName = "Robin Ellery";
  const email = "robin.ellery@example.org";
  const postal = "9 Quay Street, Harbourton HT1 4CD";
  const firstId = await createPreparation(displayName, email, postal);
  const secondId = await createPreparation(displayName, email, postal);
  expect(firstId).not.toBe(secondId);
  const foundIds = expectEnvelope(await reads.partners.findPartners({ search: email }, sourceOf(WORKER)), "a search on the address both records carry").data.rows.map((row) => row.partner.partnerId);
  expect([[foundIds.length, new Set(foundIds).size], foundIds]).toEqual([[2, 2], expect.arrayContaining([firstId, secondId])]); // Two rows, not one merged record: an address that matches twice does not establish identity.
  const firstRecord = expectEnvelope(await reads.partners.readPartner(firstId, {}, sourceOf(WORKER)), "the first of the two records");
  const secondRecord = expectEnvelope(await reads.partners.readPartner(secondId, {}, sourceOf(WORKER)), "the second of the two records");
  expect([firstRecord.data.partner.partnerId, secondRecord.data.partner.partnerId]).toEqual([firstId, secondId]);
  expectNoText(textOf(firstRecord.data), [secondId], "the first record");
  expectNoText(textOf(secondRecord.data), [firstId], "the second record");
  expect(firstRecord.data.partner.displayName).toBe(secondRecord.data.partner.displayName); // The fields really are equal, which is exactly why none of them may be the join.
  expect(firstRecord.data.partner.contactMethods.map((method) => method.value).toSorted()).toEqual(secondRecord.data.partner.contactMethods.map((method) => method.value).toSorted());
});
it("equal-looking identifiers never join: offers no read keyed by an email address, so a record is addressed by its opaque identifier", () => {
  const readNames = Object.values(reads).flatMap((group) => Object.keys(group));
  expect(readNames.length).toBeGreaterThan(0);
  expect(readNames).toContain("readPartner");
  expect(
    readNames.filter((name) => /email/i.test(name)),
    "an address is never a join key, so no read is keyed by one",
  ).toEqual([]);
});
it("equal-looking identifiers never join: keeps a household, a church and the person recorded for it distinct identities", async () => {
  const household = partnerOfKind("household");
  const foundVisit = stateOf(WORKER).interactions.find((interaction) => interaction.partnerId === household.partnerId); // The members are read from the visit recorded against the household, never from a name that happens to match one.
  const visit = required(foundVisit, "interaction recorded against the household");
  const memberIds = visit.participants.map((participant) => participant.partnerId).filter((partnerId): partnerId is string => partnerId !== null);
  expect(memberIds.length).toBeGreaterThan(0);
  const householdRecord = expectEnvelope(await reads.partners.readPartner(household.partnerId, {}, sourceOf(WORKER)), "the household record");
  expect(householdRecord.data.partner.kind).toBe("household");
  expectNoText(textOf(householdRecord.data), memberIds, "the household's own record");
  for (const memberId of memberIds) {
    const member = expectEnvelope(await reads.partners.readPartner(memberId, {}, sourceOf(WORKER)), "a member's own record");
    expect(member.data.partner.partnerId).toBe(memberId);
    expectNoText(textOf(member.data), [household.partnerId], `the record of ${memberId}`);
  }
  const church = partnerOfKind("church");
  const representative = partnerWhere(isChurchWarden, "person recorded as the church's warden");
  const churchRecord = expectEnvelope(await reads.partners.readPartner(church.partnerId, {}, sourceOf(WORKER)), "the church record");
  expect(churchRecord.data.partner.kind).toBe("church");
  expectNoText(textOf(churchRecord.data), [representative.partnerId], "the church's own record");
  const representativeRecord = expectEnvelope(await reads.partners.readPartner(representative.partnerId, {}, sourceOf(WORKER)), "the warden's own record");
  expect(representativeRecord.data.partner.partnerId).toBe(representative.partnerId);
  expectNoText(textOf(representativeRecord.data), [church.partnerId], "the warden's own record");
});
it("equal-looking identifiers never join: keeps the ministry and the support subject distinct, so one identifier cannot stand in for the other", async () => {
  const workerScope = selectedScopeOf(WORKER);
  const studentsScope = selectedScopeOf(WORKER_STUDENTS);
  expect([workerScope.organizationId, workerScope.principalId]).toEqual([studentsScope.organizationId, studentsScope.principalId]); // One organisation and one principal, two ministries with their own support subjects.
  expect(workerScope.ministryId).not.toBe(studentsScope.ministryId);
  expect(workerScope.supportSubjectId).not.toBe(studentsScope.supportSubjectId);
  const swapped: Scope = { ...workerScope, supportSubjectId: studentsScope.supportSubjectId };
  expect(sameScope(workerScope, swapped)).toBe(false);
  const record = firstScopePartner();
  const before = expectEnvelope(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record before a swapped write");
  const outcome = await mutations.partnerPreparation.saveContactEdits({ operationId: randomUUID(), scope: swapped, expectedRevision: before.revision, payload: { partnerId: record.partnerId, displayName: "A name nothing may adopt" } }, sourceOf(WORKER));
  expect(expectOutcome(outcome, "denied").reasonCode).toBe("no-membership"); // No membership admits the mixed triplet, so the write is refused before the record is opened.
  const after = expectEnvelope(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record after a swapped write");
  expect([after.data.partner.displayName, after.revision]).toEqual([before.data.partner.displayName, before.revision]);
});
it("linking work never copies private text into shared history: keeps a private interaction note with its author, and copies no private text onto a linked task", async () => {
  const privateInteraction = required(
    stateOf(WORKER).interactions.find((interaction) => interaction.note !== null && interaction.note.audience === "private"),
    "interaction carrying a private note",
  );
  const interactionNote = required(privateInteraction.note, "private note body of that interaction");
  const noteAuthor = required(interactionNote.authorPrincipalId, "author recorded on that private note");
  const privateNote = firstWhere(stateOf(WORKER).privateNotes, "partnerId", privateInteraction.partnerId, "private note about the same record");
  const shared = expectEnvelope(await reads.interactions.readInteractions({ partnerId: privateInteraction.partnerId }, sourceOf(WORKER)), "the shared activity of that record");
  const sameInteraction = firstWhere(shared.data.interactions, "interactionId", privateInteraction.interactionId, "the same interaction in the shared activity read");
  // Kept, and kept private: the author reads back the note they wrote, labelled with the audience that holds it, because a note stored for nobody would be silent data loss rather than a decision about who may read it.
  expect([sameInteraction.note?.audience, sameInteraction.note?.body]).toEqual(["private", interactionNote.body]);
  expectNoText(textOf(shared.data), [privateNote.body, privateNote.body.slice(0, 28)], "the shared activity read"); // A private-note record is a different record class from an interaction's note, and no read of activity carries its body.
  // Every note the read does carry is shared activity, or a private one whose author is this caller.
  for (const shown of shared.data.interactions.map((interaction) => interaction.note).filter((note) => note !== null)) expect(shown.audience === "shared" || shown.authorPrincipalId === sessionOf(WORKER).principalId).toBe(true);
  // A principal who did not write the note is refused it by the one authority the read consults, so the rule is stated here as this file states the others the store cannot show: through the function that owns it.
  expect(expectRefused(canView(sessionOf(FUNDRAISER), { kind: "private-note", scope: selectedScopeOf(FUNDRAISER), authorPrincipalId: noteAuthor }), "a principal who did not write the interaction note").reasonCode).toBe("no-permission");
  const title = "Follow up after the visit";
  const outcome = await mutations.work.createTask({ operationId: randomUUID(), scope: selectedScopeOf(WORKER), expectedRevision: shared.revision, payload: { title, partnerId: privateInteraction.partnerId } }, { sessionId: WORKER });
  expectOutcome(outcome, "accepted");
  const detail = expectEnvelope(await reads.partners.readPartner(privateInteraction.partnerId, {}, sourceOf(WORKER)), "the record after a task was linked");
  expect(detail.data.openTasks.some((task) => task.title === title)).toBe(true);
  expectNoText(textOf(detail.data), [interactionNote.body, interactionNote.body.slice(0, 28), privateNote.body, privateNote.body.slice(0, 28)], "the record a task was linked to");
});
it("the value-state map keeps each non-value its own fact: covers every value-bearing field the goal read exposes", async () => {
  const goal = expectEnvelope(await reads.support.readGoal({}, sourceOf(WORKER)), "the worker's goal read");
  for (const path of ["goal.amount", "goal.percentage"]) expect(goal.valueStates, `the value-state map must cover "${path}"`).toHaveProperty(path);
  expect(goal.data.report.summary.length).toBeGreaterThan(0);
  for (const entry of goal.data.report.summary) for (const member of ["received", "giftCount", "allocationCount", "donorCount"]) expect(goal.valueStates, `the value-state map must cover summary.${entry.currency}.${member}`).toHaveProperty(`summary.${entry.currency}.${member}`);
});
it("the value-state map keeps each non-value its own fact: derives the incomplete subtotal from partial coverage and never passes a recorded amount through", async () => {
  const partial = expectEnvelope(await reads.support.readGifts({}, sourceOf(WORKER)), "the worker's gifts ledger");
  expect(partial.coverage.state).toBe("partial");
  const currency = first(partial.data.report.summary, "summary row in the worker's ledger").currency;
  expect(partial.valueStates[`summary.${currency}.received`]).toBe("incomplete-subtotal"); // The derived member is the envelope's, not a state any read recorded: the seeded history is partial, so a subtotal over it cannot present itself as a whole period.
  for (const [path, state] of Object.entries(partial.valueStates)) expect(state === "value" || state === "zero", `${path} kept a recorded amount state over partial coverage`).toBe(false);
  const complete = expectEnvelope(await reads.support.readGifts({}, sourceOf(SECOND_WORKER)), "the second worker's gifts ledger");
  expect(complete.coverage.state).toBe("complete");
  const completeStates = Object.values(complete.valueStates);
  expect(completeStates).toContain("value");
  expect(completeStates).not.toContain("incomplete-subtotal");
  const completeCurrency = first(complete.data.report.summary, "summary row in the second worker's ledger").currency; // The same field, read over complete coverage, is plainly a value: the difference is coverage, never the figure.
  expect(complete.valueStates[`summary.${completeCurrency}.received`]).toBe("value");
});
it("the value-state map keeps each non-value its own fact: states a genuine zero as zero, apart from unknown, withheld and unavailable on the same field", async () => {
  const partner = required(
    stateOf(WORKER).partners.find((record) => record.kind === "person" && !stateOf(WORKER).privateNotes.some((note) => note.partnerId === record.partnerId)),
    "person with no private note",
  );
  const read = expectEnvelope(await reads.partners.readPrivatePreparation({ partnerId: partner.partnerId }, sourceOf(WORKER)), "a record with no private note");
  expect(read.data.notes).toEqual([]);
  const state = read.valueStates.notes;
  expect(state).toBe("zero");
  expect(["unknown", "withheld", "unavailable"]).not.toContain(state);
  expect(STATES_CARRYING_AN_AMOUNT).toContain("zero");
});
it("the value-state map keeps each non-value its own fact: carries withheld, unavailable and unknown through unchanged, and gives each of them no amount", async () => {
  const base = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster");
  const envelope = builtEnvelopeOf(base, "complete", { "summary.USD.received": "withheld", "summary.USD.giftCount": "unavailable", "summary.USD.donorCount": "unknown", "summary.USD.allocationCount": "value", "rows.0.amount": "zero" });
  expect([envelope.valueStates["summary.USD.received"], envelope.valueStates["summary.USD.giftCount"], envelope.valueStates["summary.USD.donorCount"]]).toEqual(["withheld", "unavailable", "unknown"]);
  // Each of the three is a state a surface must render without digits, and none of them is derivable from a figure: a component that printed a number would have to invent one.
  for (const path of ["summary.USD.received", "summary.USD.giftCount", "summary.USD.donorCount"]) expect(STATES_CARRYING_AN_AMOUNT).not.toContain(envelope.valueStates[path]);
  expect(STATES_CARRYING_AN_AMOUNT).toEqual(expect.arrayContaining([envelope.valueStates["summary.USD.allocationCount"], envelope.valueStates["rows.0.amount"]]));
});
it("the value-state map keeps each non-value its own fact: has exactly six value states and refuses to be told the derived one", async () => {
  expect([VALUE_STATES.length, new Set(VALUE_STATES).size]).toEqual([6, 6]);
  expect(recordedValueStateSchema.safeParse("incomplete-subtotal").success).toBe(false); // The builder takes a recorded state: `RecordedValueState` excludes the derived member, and the schema that guards a caller-supplied map refuses it at the boundary too, so no caller chooses it.
  for (const state of VALUE_STATES.filter((candidate) => candidate !== "incomplete-subtotal")) expect(recordedValueStateSchema.safeParse(state).success, `"${state}" is a state a read may record`).toBe(true);
  const base = expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster");
  const complete = builtEnvelopeOf(base, "complete", { total: "value" });
  const partial = builtEnvelopeOf(base, "partial", { total: "value" });
  expect([complete.valueStates.total, partial.valueStates.total]).toEqual(["value", "incomplete-subtotal"]);
});
/** Builds an envelope over an already-read one, so a case states only the coverage and the value states it varies. */
const builtEnvelopeOf = (base: Pick<ReadEnvelope<unknown>, "scope" | "source" | "revision" | "asOf">, coverageState: "complete" | "partial", valueStates: Readonly<Record<string, RecordedValueState>>) =>
  buildEnvelope({ data: {}, scope: base.scope, source: base.source, revision: base.revision, asOf: base.asOf, coverage: { from: null, to: null, state: coverageState }, valueStates, actions: [] });
it("the resolver is the only entry to a scope: refuses an unknown, unusable or absent session rather than inventing a principal", async () => {
  for (const sessionId of [ABSENT_SESSION, "not/a/session", ""]) {
    const resolution = await resolveSession({ sessionId });
    expect(resolution.ok, `the resolver invented a session for ${JSON.stringify(sessionId)}`).toBe(false);
    if (resolution.ok) throw new Error(`The resolver answered ${JSON.stringify(sessionId)} with a session.`);
    expect(resolution.refusal.kind).toBe("denied");
    if (resolution.refusal.kind !== "denied") throw new Error(`The refusal of ${JSON.stringify(sessionId)} was not the denial it is.`);
    expect(DENIAL_REASONS).toContain(resolution.refusal.denied.reasonCode);
    expectMembersAbsent(resolution, ["session"], "a refused session resolution");
    expectNoDisclosure(resolution.refusal.denied, `the refusal of ${JSON.stringify(sessionId)}`);
  }
  expectNoDisclosure(expectDenial(await reads.partners.readPartner(firstScopePartner().partnerId, {}, sourceOf(ABSENT_SESSION)), "a read against a session the store does not hold"), "a session refusal");
});
it("the resolver is the only entry to a scope: states the resolved scope on every read and refuses a write that claims another one", async () => {
  const workerScope = selectedScopeOf(WORKER);
  expect(expectEnvelope(await reads.partners.findPartners({}, sourceOf(WORKER)), "the worker's roster").scope).toEqual(workerScope);
  const secondRoster = expectEnvelope(await reads.partners.findPartners({}, sourceOf(SECOND_WORKER)), "the second worker's roster");
  expect(secondRoster.scope).toEqual(selectedScopeOf(SECOND_WORKER));
  expect(sameScope(secondRoster.scope, workerScope)).toBe(false);
  const record = firstScopePartner();
  const before = expectEnvelope(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record before a claimed scope");
  const outcome = await mutations.partnerPreparation.saveContactEdits({ operationId: randomUUID(), scope: selectedScopeOf(SECOND_WORKER), expectedRevision: before.revision, payload: { partnerId: record.partnerId, displayName: "A name the other organisation may not set" } }, sourceOf(WORKER));
  expect(expectOutcome(outcome, "denied").reasonCode).toBe("not-admitted"); // The claim names another principal as well as another ministry, so the authority is refused before the payload is looked at, and the record keeps the name it had.
  const after = expectEnvelope(await reads.partners.readPartner(record.partnerId, {}, sourceOf(WORKER)), "the record after a claimed scope");
  expect([after.data.partner.displayName, after.revision]).toEqual([before.data.partner.displayName, before.revision]);
});
it("the resolver is the only entry to a scope: refuses a write that names a record outside the caller's scope, and leaves that record unchanged", async () => {
  const foreign = first(stateOf(SECOND_WORKER).partners, "partner in the second scope");
  const before = expectEnvelope(await reads.partners.readPartner(foreign.partnerId, {}, sourceOf(SECOND_WORKER)), "the second worker's record before a foreign write");
  const outcome = await mutations.partnerPreparation.saveContactEdits({ operationId: randomUUID(), scope: selectedScopeOf(WORKER), expectedRevision: before.revision, payload: { partnerId: foreign.partnerId, displayName: "A name from another ministry" } }, sourceOf(WORKER));
  expect(expectOutcome(outcome, "denied").reasonCode).toBe("no-permission"); // Inside its own scope and naming a record it cannot see, the service refuses exactly as it refuses a record that does not exist.
  const after = expectEnvelope(await reads.partners.readPartner(foreign.partnerId, {}, sourceOf(SECOND_WORKER)), "the second worker's record after a foreign write");
  expect([after.data.partner.displayName, after.revision]).toEqual([before.data.partner.displayName, before.revision]);
});
// Protected media. Criterion 19 names protected media among the things a second worker must not retrieve, and criterion 18 names protected video, poster, captions and transcript. Both are decided per request by `reads.media.readMediaAsset` — the one read the rendition route calls — so every purpose below is asked of that read, with a `SessionSource`, exactly as the rest of this file asks its reads.
/** The literal session id whose world the receiving reads answer a reader from: the published world. */ const PUBLISHED_WORLD = DEFAULT_SESSION_ID;
/** An address no record carries: every refusal below is asserted identical to the refusal of this one. */ const NEVER_RECORDED_ASSET = "asset-that-was-never-recorded";
/** The video asset the protected edition places, in a custody lane of its own. */ const PROTECTED_ASSET = "asset-video-supporter-only";
/** The seed's own page edition, which places the seed's welcome video: the edition whose reach the case below changes. */ const NOT_PUBLIC_RELEASE = "release-page-en-1";
/** Every purpose a receiving read advertises for a video, the one this asset records no bytes for included. */ const VIDEO_PURPOSES = ["playback", "poster", "captions", "transcript"] as const;
/** The three purposes the protected asset serves, and so the three a reader can be admitted to. */ const PROTECTED_SERVED_PURPOSES = ["playback", "poster", "captions"] as const;
/** The committed fixture each protected rendition carries: the documents the seed serves for its own video. */ const PROTECTED_RENDITIONS = [
  { renditionId: "rendition-video-supporter-only-playback", purpose: "playback", file: "sample-h264.mp4", fixture: "sample-h264.mp4", mimeType: "video/mp4" },
  { renditionId: "rendition-video-supporter-only-poster", purpose: "poster", file: "poster.jpg", fixture: "poster.jpg", mimeType: "image/jpeg" },
  { renditionId: "rendition-video-supporter-only-captions", purpose: "captions", file: "sample.vtt", fixture: "sample.vtt", mimeType: "text/vtt" },
] as const;
/** The directory the committed media fixtures live in, which is the one a reset materialises its bytes from. */ const MEDIA_FIXTURE_DIRECTORY = fileURLToPath(new URL("../../public/fixtures/media/", import.meta.url));
/** Copies one committed fixture to the custody reference a rendition records. */ async function materialiseCopiedBytes(assetId: string, file: string, fixture: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(join(MEDIA_FIXTURE_DIRECTORY, fixture)));
  if (bytes.byteLength === 0) throw new Error(`The committed fixture ${JSON.stringify(fixture)} is empty, so this file cannot serve bytes for "${assetId}".`);
  await writeMediaBytes(seededMediaReference(assetId, file), bytes);
}
/** The video asset the first scope owns and has playback bytes for: the asset the second worker asks after. */
const firstScopeVideo = (): SessionStateDocument["mediaAssets"][number] => stateOf(WORKER).mediaAssets.find((record) => record.renditions.some((rendition) => rendition.purpose === "playback")) ?? throwing("video asset with playback bytes in the first scope");
/** The published world: the seed's own established-worker documents, plus one protected edition placing one asset. */ function protectedWorld(): SeededSessionDocuments {
  const seeded = worldOf(WORKER);
  const scope = first(seeded.state.mediaAssets, "seeded media asset").scope;
  const publisherId = first(seeded.state.memberships, "seeded membership").publisherId;
  const asset: SessionStateDocument["mediaAssets"][number] = {
    assetId: PROTECTED_ASSET,
    kind: "video",
    profileCheck: { container: "mp4", codec: "avc1.64001f", durationSeconds: 5.055, width: 960, height: 540 },
    sourceOriginalRef: "media-originals/supporter-briefing-raw.mp4", // The private original the served renditions are produced from: it is never served and never echoed.
    renditions: PROTECTED_RENDITIONS.map((record) => ({ renditionId: record.renditionId, purpose: record.purpose, bytesRef: seededMediaReference(PROTECTED_ASSET, record.file), mimeType: record.mimeType })),
    scope,
    tagVerification: { checked: true, residualTags: [] },
    revision: "rev-1",
  };
  const placement: SessionStateDocument["contentRevisions"][number]["mediaPlacements"][number] = {
    placementId: "placement-update-supporter-video",
    assetId: PROTECTED_ASSET,
    sectionElement: null, // An Update's body carries no sections, so the placement sits in the revision rather than in a section.
    position: 0,
    altText: "A short briefing for supporters on this term's costs.",
    caption: null,
    credit: "Harbour Youth",
  };
  const membership: SessionStateDocument["memberships"][number] = {
    membershipId: String(sessionOf(SUPPORTER_READER).principalId), // The grant is looked up by the reader's own principal id, so this row is that id and nothing else.
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
      contentRevisions: seeded.state.contentRevisions.map((revision) => (revision.revisionId === "rev-update-en-supporter-1" ? { ...revision, mediaPlacements: [...revision.mediaPlacements, placement] } : revision)),
    },
  };
}
/** One world with one release changed, which is all a withdrawal or a reach change sets on a release: the protected world unless a case hands in the world it reads. */
function worldWithRelease(releaseId: string, change: Partial<SeededSessionDocuments["state"]["releases"][number]>, world: SeededSessionDocuments = protectedWorld()): SeededSessionDocuments {
  return { ...world, state: { ...world.state, releases: world.state.releases.map((release) => (release.releaseId === releaseId ? { ...release, ...change } : release)) } };
}
/** Asserts the caller is refused this address, and that the refusal is the one an address that was never recorded receives — the same members, the same reason and the same serialised answer — so a caller cannot tell a recorded asset from one that was never recorded. */
async function expectNeutralRefusal(source: SessionSource, assetId: string, rendition: string, what: string, rangeHeader: string | null = null, reasonCode: DenialReason = "no-permission"): Promise<DeniedOutcome> {
  const ask = (asked: string) => (rangeHeader === null ? reads.media.readMediaAsset({ assetId: asked, rendition }, source) : reads.media.readMediaAsset({ assetId: asked, rendition, rangeHeader }, source));
  const refusedRecorded = await ask(assetId);
  const refusedNeverRecorded = await ask(NEVER_RECORDED_ASSET);
  const denial = expectDenial(refusedRecorded, what);
  expect([denial.outcome, denial.reasonCode]).toEqual(["denied", reasonCode]);
  expect(Object.keys(denial).toSorted()).toEqual(["operationId", "outcome", "reasonCode"]); // Three members and nothing else: a fourth would be a fact about the media.
  expectNoDisclosure(denial, what);
  expect(textOf(refusedRecorded)).toBe(textOf(refusedNeverRecorded));
  return denial;
}
/** Asks one scope for each whole rendition of an asset and holds every answer to the same shape, answering the delivery lengths its purposes recorded. */ async function expectServedRenditions(assetId: string, source: SessionSource, purposes: readonly string[], what: string): Promise<Map<string, number>> {
  const lengths = new Map<string, number>();
  for (const purpose of purposes) {
    const whole = expectEnvelope(await reads.media.readMediaAsset({ assetId, rendition: purpose }, source), `the ${what} ${purpose} rendition`);
    expect([whole.data.purpose, whole.data.status]).toEqual([purpose, 200]);
    expect(whole.data.bytes.byteLength).toBeGreaterThan(0); // Real bytes rather than an empty body: the scope that recorded the asset is served the asset.
    expect(whole.data.contentLength).toBe(whole.data.bytes.byteLength);
    expect(whole.data.headers["content-range"]).toBeUndefined();
    lengths.set(purpose, whole.data.contentLength);
  }
  return lengths;
}
/** Serves every whole rendition, then the first sixteen bytes of playback as a range of the length that rendition recorded, and answers the lengths it delivered. */ async function expectServedWithByteRange(assetId: string, source: SessionSource, what: string): Promise<Map<string, number>> {
  const lengths = await expectServedRenditions(assetId, source, PROTECTED_SERVED_PURPOSES, what);
  const ranged = expectEnvelope(await reads.media.readMediaAsset({ assetId, rendition: "playback", rangeHeader: "bytes=0-15" }, source), `a byte range of the ${what} playback rendition`).data;
  expect([ranged.status, ranged.bytes.byteLength, ranged.headers["content-range"]]).toEqual([206, 16, `bytes 0-15/${String(required(lengths.get("playback"), `length of the ${what} playback rendition`))}`]);
  return lengths;
}
describe("every rendition re-authorises the request that asks for it", () => {
  beforeAll(async () => {
    // The published world the receiving reads answer a reader from, laid down through the store's own `resetSession` and its media custody, never by writing the store's on-disk format here.
    for (const record of PROTECTED_RENDITIONS) await materialiseCopiedBytes(PROTECTED_ASSET, record.file, record.fixture);
    await resetSession(PUBLISHED_WORLD, protectedWorld());
  });
  afterAll(async () => {
    await resetSession(PUBLISHED_WORLD, worldOf(WORKER)); // The seed's own documents go back under the shared id, so no later suite reads this arm's edition.
  });
  it.each([
    { shown: "the second worker", source: sourceOf(SECOND_WORKER), asset: () => firstScopeVideo().assetId },
    { shown: "the unauthorized reader", source: sourceOf(READER), asset: () => PROTECTED_ASSET },
  ])("refuses $shown every purpose of the asset it may not read, a byte range included, as one neutral refusal", async ({ shown, source, asset }) => {
    const refusals: DeniedOutcome[] = [];
    for (const purpose of VIDEO_PURPOSES) refusals.push(await expectNeutralRefusal(source, asset(), purpose, `${shown}'s ${purpose} request`));
    refusals.push(await expectNeutralRefusal(source, asset(), "playback", `${shown}'s byte-range request`, "bytes=0-15")); // A range request is a rendition request: it re-authorises like the whole-entity one, so it cannot become the way around the refusal.
    // Every advertised purpose, and the range, answer the one refusal: no purpose carries a fact another does not, so asking each of them in turn tells the caller nothing about the asset.
    expect([new Set(refusals.map((refusal) => refusal.reasonCode)), new Set(refusals.map((refusal) => textOf(refusal))).size]).toEqual([new Set(["no-permission"]), 1]);
  });
  it("serves the protected edition to the reader holding the grant, in every purpose the others are refused", async () => {
    const lengths = await expectServedWithByteRange(PROTECTED_ASSET, sourceOf(SUPPORTER_READER), "approved-supporter reader's"); // The grant is about this reader rather than about the asset: the one reader it names is served the same purposes the others are refused, with real bytes.
    expect([...lengths.keys()]).toEqual([...PROTECTED_SERVED_PURPOSES]);
  });
  it("serves the owning scope its own playback, poster and captions, whole and as a byte range", async () => {
    const lengths = await expectServedWithByteRange(firstScopeVideo().assetId, sourceOf(WORKER), "owning scope's");
    expect([...lengths.keys()]).toEqual([...PROTECTED_SERVED_PURPOSES]);
  });
  it("withdraws the protected edition and refuses the reader it served a moment before", async () => {
    const before = expectEnvelope(await reads.media.readMediaAsset({ assetId: PROTECTED_ASSET, rendition: "playback" }, sourceOf(SUPPORTER_READER)), "the approved-supporter reader's rendition before the withdrawal");
    expect(before.data.status).toBe(200);
    expect(before.data.bytes.byteLength).toBeGreaterThan(0);
    await resetSession(PUBLISHED_WORLD, worldWithRelease("release-update-en-approved-supporter-1", { withdrawnAt: "2026-11-20T10:00:00Z" }));
    try {
      for (const purpose of VIDEO_PURPOSES) await expectNeutralRefusal(sourceOf(SUPPORTER_READER), PROTECTED_ASSET, purpose, `the approved-supporter reader's ${purpose} request after the withdrawal`);
      await expectNeutralRefusal(sourceOf(SUPPORTER_READER), PROTECTED_ASSET, "playback", "the approved-supporter reader's byte-range request after the withdrawal", "bytes=0-15");
    } finally {
      await resetSession(PUBLISHED_WORLD, protectedWorld()); // The live edition goes back, so the published world is what it was once this case has finished.
    }
  });
  it("refuses a not-public page edition's playback, poster and captions to every reader, and still serves the scope that owns the asset", async () => {
    // Reach decides what a direct link may serve, so an edition set to Not public places media no reader may fetch. The refusal is the same neutral one an address that was never recorded answers, for every purpose the edition advertises and for the reader holding the protected-reading grant alike.
    await resetSession(PUBLISHED_WORLD, worldWithRelease(NOT_PUBLIC_RELEASE, { reach: "not-public" }));
    try {
      const asset = firstScopeVideo();
      for (const reader of [READER, SUPPORTER_READER]) for (const purpose of PROTECTED_SERVED_PURPOSES) await expectNeutralRefusal(sourceOf(reader), asset.assetId, purpose, `"${reader}" asking a not-public edition for ${purpose}`);
      const lengths = await expectServedRenditions(asset.assetId, sourceOf(WORKER), PROTECTED_SERVED_PURPOSES, "owning scope's"); // The owning scope reads its own world, where the asset's recorded scope is the whole authority: the reach of the edition that places it takes nothing from the worker who recorded it.
      expect([...lengths.keys()]).toEqual([...PROTECTED_SERVED_PURPOSES]);
    } finally {
      await resetSession(PUBLISHED_WORLD, protectedWorld()); // The listed edition goes back, so the published world is what it was once this case has finished.
    }
  });
  it("serves a not-public page edition to the contributor whose own world holds it and refuses it to every reader at the reading crossing", async () => {
    // The reach control's own words are that only the owner can open a Not public edition, and the reading view's are that the owner's own reading view shows it, so the direct address serves the world that holds the edition. A reader reaches it across the reading crossing instead, where a link is served for a `link-public` or `listed` edition alone, so an edition set to Not public is refused there exactly as an address that was never recorded is. Both worlds carry the change because the owner reads its own world while a reader reads the published one.
    const page = { pageId: "doc-page-harbour-youth", locale: "en" };
    await resetSession(WORKER, worldWithRelease(NOT_PUBLIC_RELEASE, { reach: "not-public" }, worldOf(WORKER)));
    await resetSession(PUBLISHED_WORLD, worldWithRelease(NOT_PUBLIC_RELEASE, { reach: "not-public" }));
    try {
      const own = expectEnvelope(await reads.audience.readReceivingPage(page, sourceOf(WORKER)), "the contributing worker's own not-public edition");
      expect([own.data.state, own.data.reach]).toEqual(["served", "not-public"]);
      expect(required(own.data.html, "the served edition's rendered html").length).toBeGreaterThan(0); // The owner's reading view is the edition itself rather than a notice that names it.
      for (const reader of [READER, SUPPORTER_READER]) {
        const what = `"${reader}" asking the reading crossing for a not-public edition`;
        const denial = expectDenial(await reads.audience.readReceivingPage(page, sourceOf(reader)), what);
        expect([denial.outcome, denial.reasonCode]).toEqual(["denied", "no-permission"]);
        expectNoDisclosure(denial, what);
      }
    } finally {
      await resetSession(WORKER, worldOf(WORKER)); // The worker's own documents go back under this file's worker id, so no later case reads the reach this one set.
      await resetSession(PUBLISHED_WORLD, protectedWorld()); // And the published world is the protected world again, which is the world every other case in this arm starts from.
    }
  });
});

// The session's own state, and the rows that are the reader's own. The four seeded session states that are not signed in, and the reader the public edition admits: the one opener every audience and receiving read goes through decides the state before it looks at a scope, and the media read decides it before it looks at an asset. So neither a read nor a refusal answers for a session its own state has ended, and a refusal never states whether the asset it asked for exists. The same rule decides which membership rows a reader's preferences state: the reader's own, whatever the session holds.
/** The seeded Update, Page and notification intent the reads below are asked about: taken from the seed rather than typed in. */ const seededUpdateId = (): string =>
  first(
    stateOf(WORKER).contentDocuments.filter((document) => document.family === "update"),
    "seeded Update document",
  ).documentId;
const seededPageId = (): string =>
  first(
    stateOf(WORKER).contentDocuments.filter((document) => document.family !== "update"),
    "seeded Page document",
  ).documentId;
const seededIntentId = (): string => first(stateOf(WORKER).notificationIntents, "seeded notification intent").intentId;
/** Every audience and receiving read, each asked with the argument it needs: the eight the session gate covers. */ const AUDIENCE_READS: readonly { readonly name: string; readonly read: (source: SessionSource) => Promise<ReadResult<unknown>> }[] = [
  { name: "readAudience", read: (source) => reads.audience.readAudience({}, source) },
  { name: "readPreferences", read: (source) => reads.audience.readPreferences(source) },
  { name: "readInbox", read: (source) => reads.audience.readInbox({}, source) },
  { name: "readReceivingList", read: (source) => reads.audience.readReceivingList({}, source) },
  { name: "readReceivingPost", read: (source) => reads.audience.readReceivingPost({ updateId: seededUpdateId() }, source) },
  { name: "readDiscoveryIndex", read: (source) => reads.audience.readDiscoveryIndex({}, source) },
  { name: "readReceivingPage", read: (source) => reads.audience.readReceivingPage({ pageId: seededPageId() }, source) },
  { name: "readSendResult", read: (source) => reads.audience.readSendResult({ intentId: seededIntentId() }, source) },
];
/** Every state the session gate refuses, with the reason that state's own refusal carries. */ const NON_SIGNED_IN_STATES: readonly { readonly sessionId: string; readonly reasonCode: DenialReason }[] = [
  { sessionId: DENIED_SESSION, reasonCode: "not-admitted" },
  { sessionId: NO_ACCESS_SESSION, reasonCode: "not-admitted" },
  { sessionId: EXPIRED_SESSION, reasonCode: "session-expired" },
  { sessionId: UNAVAILABLE_SESSION, reasonCode: "session-unavailable" },
];
/** The video asset a live public edition of the published world places: the rendition a signed-in reader is served across the reading crossing. */ function publicEditionVideo(): SessionStateDocument["mediaAssets"][number] {
  const state = stateOf(WORKER);
  const publicRevisionIds = new Set(state.releases.filter((release) => release.audience === "public" && release.withdrawnAt === null && release.supersededBy === null).map((release) => release.revisionId));
  const placedAssetIds = new Set(state.contentRevisions.filter((revision) => publicRevisionIds.has(revision.revisionId)).flatMap((revision) => revision.mediaPlacements.map((placement) => placement.assetId)));
  return first(
    state.mediaAssets.filter((record) => placedAssetIds.has(record.assetId) && record.renditions.some((rendition) => rendition.purpose === "playback")),
    "video asset a live public edition places",
  );
}
describe("the receiving surfaces decide the session's own state and the reader's own rows first", () => {
  beforeAll(async () => {
    // The seed's own documents under the published id, laid down through the store's own calls, so the public edition the crossing serves is the seed's rather than an arm another case left behind.
    await resetSession(PUBLISHED_WORLD, worldOf(WORKER));
  });
  it("refuses every audience and receiving read to each state that is not signed in, with that state's own reason and no disclosure", async () => {
    for (const state of NON_SIGNED_IN_STATES) {
      for (const audienceRead of AUDIENCE_READS) {
        const what = `${audienceRead.name} as "${state.sessionId}"`;
        const denial = expectDenial(await audienceRead.read(sourceOf(state.sessionId)), what);
        expect(denial.outcome).toBe("denied");
        expect(denial.reasonCode, `${what} must answer with its session's own reason`).toBe(state.reasonCode);
        expect(Object.keys(denial).toSorted(), `${what} must state nothing but the refusal`).toEqual(["operationId", "outcome", "reasonCode"]);
        expectNoDisclosure(denial, what);
      }
    }
  });
  it("keeps the signed-in public reader's receiving reads and the public edition's rendition", async () => {
    for (const name of ["readReceivingList", "readReceivingPost", "readDiscoveryIndex", "readReceivingPage"]) {
      const audienceRead = required(
        AUDIENCE_READS.find((candidate) => candidate.name === name),
        `the "${name}" read`,
      );
      expectEnvelope(await audienceRead.read(sourceOf(READER)), `the signed-in reader's ${name}`); // A reader is admitted by the persona it previews rather than by a ministry membership, so the public reading experience stays open to it.
    }
    const asset = publicEditionVideo();
    const served = expectEnvelope(await reads.media.readMediaAsset({ assetId: asset.assetId, rendition: "playback" }, sourceOf(READER)), "the signed-in reader's public edition playback");
    expect([served.data.status, served.data.bytes.byteLength > 0]).toEqual([200, true]);
  });
  it("refuses the public edition's rendition to a session that is not signed in, identically for an asset that exists and one that was never recorded", async () => {
    const asset = publicEditionVideo();
    // The two states that hold no admitted membership are the ones that reach the reading crossing, so they are the two this case asks the media read for as well as the opener.
    const refusals: DeniedOutcome[] = [];
    for (const sessionId of [DENIED_SESSION, NO_ACCESS_SESSION]) refusals.push(await expectNeutralRefusal(sourceOf(sessionId), asset.assetId, "playback", `"${sessionId}" asking for a public edition's playback`, null, "not-admitted"));
    expect(refusals.map((refusal) => refusal.reasonCode)).toEqual(["not-admitted", "not-admitted"]); // Both sessions are refused for the same reason, which is what makes the answer neutral rather than a hint about the asset.
  });
  it("reports no membership for a reader whose world holds somebody else's row, and still reads the reader's own record", async () => {
    const foreignRow = first(stateOf(WORKER).memberships, "seeded membership");
    expect(foreignRow.membershipId).not.toBe(String(sessionOf(READER).principalId)); // The row really is somebody else's, which is the whole reason no answer may report it.
    const shared = expectEnvelope(await reads.audience.readPreferences(sourceOf(SHARED_WORLD_READER)), "the preferences of a reader whose world holds another person's row");
    expect([shared.data.email, shared.data.membershipId, shared.data.state]).toEqual([null, null, "none"]);
    expectNoText(textOf(shared.data), [foreignRow.email], "the preferences of a reader whose world holds another person's row");
    // The reader whose own row the world it reads across holds still reads that row: the published id carries the seed's own documents, and the filter is the reader's principal, never an empty answer for every reader.
    const ownRow = first(
      stateOf(WORKER).memberships.filter((row) => row.membershipId === String(sessionOf(SUPPORTER_READER).principalId)),
      "the approved-supporter reader's own membership",
    );
    const own = expectEnvelope(await reads.audience.readPreferences(sourceOf(SUPPORTER_READER)), "the approved-supporter reader's own preferences");
    expect([own.data.email, own.data.membershipId]).toEqual([ownRow.email, ownRow.membershipId]);
  });
});
