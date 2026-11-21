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
 * - `resolveSession` answers a session whose core documents are incomplete with the store outage it is,
 *   which is the one honest route to the `unavailable` arm; the fixture that demonstrates it holds a
 *   state and a meta document and no operation ledger, so the store itself raises the fault.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
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
/** A session the store holds no documents for at all: the resolver must refuse it, never invent one. */
const ABSENT_SESSION = "domain-scope-redaction-absent";
/** A session whose state document exists and whose operation ledger and meta documents do not: the store's own fault. */
const OUTAGE_SESSION = "domain-scope-redaction-outage";

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
];

const DOCUMENT_KEYS = ["state", "operations", "meta"] as const;

type DocumentKey = (typeof DOCUMENT_KEYS)[number];

const DATA_ROOT = fileURLToPath(new URL("../../../../.data/", import.meta.url));

/** The seeded worlds, keyed by the session id this file laid them down under. */
const seededWorlds = new Map<string, SeededSessionDocuments>();

/** The public sessions this file resolves once, so every case acts as the identity it names. */
const sessions = new Map<string, ResolvedSession>();

function documentPath(sessionId: string, key: DocumentKey): string {
  return join(DATA_ROOT, `${sessionId}.${key}.json`);
}
function serialiseDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
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
  await mkdir(DATA_ROOT, { recursive: true });
  for (const fixture of FIXTURES) {
    const row = bySeedId.get(fixture.seedId);
    if (row === undefined) {
      throw new Error(`The seed lays down no session "${fixture.seedId}", so this file cannot act as it.`);
    }
    seededWorlds.set(fixture.sessionId, row.documents);
    for (const key of DOCUMENT_KEYS) {
      await writeFile(documentPath(fixture.sessionId, key), serialiseDocument(row.documents[key]), "utf8");
    }
  }
  // The outage fixture: the commit marker exists and the rest of the document set does not, which is
  // the state a store that lost a write is genuinely in, so the resolver and every read answer with the
  // outage rather than with an empty result or a denial.
  const outage = bySeedId.get(DEFAULT_SESSION_ID);
  if (outage === undefined) {
    throw new Error(`The seed lays down no session "${DEFAULT_SESSION_ID}", so the outage fixture cannot be built.`);
  }
  seededWorlds.set(OUTAGE_SESSION, outage.documents);
  await writeFile(documentPath(OUTAGE_SESSION, "state"), serialiseDocument(outage.documents.state), "utf8");
  await writeFile(documentPath(OUTAGE_SESSION, "meta"), serialiseDocument(outage.documents.meta), "utf8");
  await rm(documentPath(OUTAGE_SESSION, "operations"), { force: true });
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
  const sessionIds = [...FIXTURES.map((fixture) => fixture.sessionId), OUTAGE_SESSION, ABSENT_SESSION];
  for (const sessionId of sessionIds) {
    for (const key of DOCUMENT_KEYS) {
      await rm(documentPath(sessionId, key), { force: true });
    }
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
