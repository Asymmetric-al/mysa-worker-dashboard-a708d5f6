/** Proves the outreach initiative model (success criterion 14): a reviewed working list that holds only the partners somebody explicitly chose, three member states that stay three, a stage that is a … */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { isOutcome, type InvalidOutcome, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { mutations, reads, type MutationInput, type Scope } from "@/modules/data-service";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import type { Money } from "@/modules/money/amount";
import { readSession, resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstWhere, requiredSaying, throwing } from "../helpers/answers";
/** This file's own session: a private id, so no other suite's seeded world is shared or disturbed. */
const SESSION_ID = "domain-outreach";
const SOURCE = { sessionId: SESSION_ID } as const;
const SEEDED_INITIATIVE = "initiative-autumn-appeal";
const EXCLUDED_PARTNER = "partner-marcus-webb";
const PAUSED_SERIES = "series-fortnightly-newsletter";
/** The membership a `subscribed` column could be mistaken for: recorded, and off rather than consented. */
const required = <T>(value: T | undefined, what: string): T => requiredSaying(value, `The seeded world carries no ${what}, so this case cannot start from it.`);
let seededScope: Scope | undefined;
/** The seeded document set every case is laid down from, captured once so each case starts from the seed. */
let seededDocuments: SeededSessionDocuments | undefined;
const scope = (): Scope => requiredSaying(seededScope, "The seeded world was not laid down before this case ran.");
function scopeOf(state: SessionStateDocument): Scope {
  const { context: stored } = state;
  if (stored.selectedOrganizationId === null || stored.selectedMinistryId === null || stored.selectedSupportSubjectId === null) throw new Error("The seeded session selects no context, so no initiative can be read or changed under an authority it never chose.");
  return { organizationId: stored.selectedOrganizationId, ministryId: stored.selectedMinistryId, supportSubjectId: stored.selectedSupportSubjectId, principalId: stored.principalId };
}
async function layDownSeededSession(): Promise<void> {
  const documents = required(seededDocuments, "the seeded session's documents");
  await resetSession(SESSION_ID, documents);
  seededScope = scopeOf(documents.state);
}
beforeAll(async () => {
  seededDocuments = firstWhere(await seed(), "sessionId", DEFAULT_SESSION_ID, `session "${DEFAULT_SESSION_ID}"`).documents;
  await layDownSeededSession();
});
beforeEach(layDownSeededSession);
afterAll(async () => await resetSession(SESSION_ID));
function outcomeIs(outcome: MutationOutcome, expected: MutationOutcome["outcome"]): MutationOutcome {
  expect([isOutcome(outcome), outcome.outcome]).toEqual([true, expected]);
  return outcome;
}
const acceptedOutcome = (outcome: MutationOutcome): Extract<MutationOutcome, { outcome: "accepted" }> => (outcome.outcome === "accepted" ? outcome : throwing(`This change was expected to be applied once and was answered with ${JSON.stringify(outcome)}.`));
const invalidOutcome = (outcome: MutationOutcome): InvalidOutcome => (outcome.outcome !== "invalid" ? throwing(`This change was expected to be refused by validation and was answered with ${JSON.stringify(outcome)}.`) : outcome);
const fieldPathsOf = (outcome: InvalidOutcome): readonly string[] => Object.keys(outcome.fields).sort();
const envelopeOf = async <T>(pending: Promise<ReadResult<T>>, what: string): Promise<T> => expectEnvelope(await pending, what);
const attempt = <P>(payload: P, expectedRevision: string, acting: Scope = scope()): MutationInput<P> => ({ operationId: newOperationId(), scope: acting, expectedRevision, payload });
const initiativeDetail = async (initiativeId: string) => envelopeOf(reads.outreach.readInitiative(initiativeId, {}, SOURCE), `readInitiative(${initiativeId})`);
const initiativeResults = async (initiativeId: string) => envelopeOf(reads.outreach.readInitiativeResults(initiativeId, SOURCE), `readInitiativeResults(${initiativeId})`);
interface RecordCounts {
  readonly partners: number;
  readonly interactions: number;
  readonly tasks: number;
  readonly series: number;
  readonly initiatives: number;
  readonly initiativeMembers: number;
  readonly requests: number;
  readonly gifts: number;
  readonly commitments: number;
  readonly memberships: number;
  readonly notificationIntents: number;
  readonly notificationResults: number;
  /** The membership a `subscribed`-looking column would have created, by id, so its state is comparable. */
  readonly membershipStates: Readonly<Record<string, string>>;
}
function readArrayMember(document: unknown, key: string): readonly unknown[] {
  if (typeof document !== "object" || document === null) throw new Error("This session's state document is not an object, so its records cannot be counted.");
  const member: unknown = Reflect.get(document, key);
  if (!Array.isArray(member)) throw new Error(`This session's state document holds no "${key}" collection, so a created record there could not be seen.`);
  return member;
}
function identifierAndStateOf(value: unknown): readonly [string, string] {
  if (typeof value !== "object" || value === null) throw new Error("A stored membership record is not an object, so its state cannot be compared.");
  const membershipId: unknown = Reflect.get(value, "membershipId");
  const state: unknown = Reflect.get(value, "state");
  if (typeof membershipId !== "string" || typeof state !== "string") throw new Error("A stored membership record holds no string id and state, so it cannot be compared by identity.");
  return [membershipId, state];
}
async function recordCounts(): Promise<RecordCounts> {
  const stored = requiredSaying(await readSession(SESSION_ID), "This session is absent from the store, so its records cannot be counted.");
  const document: unknown = stored.state;
  const memberships = readArrayMember(document, "memberships");
  const membershipStates: Record<string, string> = {};
  for (const membership of memberships) {
    const [membershipId, state] = identifierAndStateOf(membership);
    membershipStates[membershipId] = state;
  }
  return {
    partners: readArrayMember(document, "partners").length,
    interactions: readArrayMember(document, "interactions").length,
    tasks: readArrayMember(document, "tasks").length,
    series: readArrayMember(document, "series").length,
    initiatives: readArrayMember(document, "initiatives").length,
    initiativeMembers: readArrayMember(document, "initiativeMembers").length,
    requests: readArrayMember(document, "requests").length,
    gifts: readArrayMember(document, "gifts").length,
    commitments: readArrayMember(document, "commitments").length,
    memberships: memberships.length,
    notificationIntents: readArrayMember(document, "notificationIntents").length,
    notificationResults: readArrayMember(document, "notificationResults").length,
    membershipStates,
  };
}
type WorkingListRows = Awaited<ReturnType<typeof initiativeDetail>>["data"]["workingList"]["items"];
const memberRowFor = (rows: WorkingListRows, partnerId: string) => firstWhere(rows, "partnerId", partnerId, `working-list member for ${partnerId}`);
const requestRowFor = (rows: Awaited<ReturnType<typeof initiativeDetail>>["data"]["requests"]["items"], requestId: string) => firstWhere(rows, "requestId", requestId, `Request ${requestId}`);
async function createInitiative(name: string, purpose: string): Promise<string> {
  const created = acceptedOutcome(await mutations.outreach.createInitiative(attempt({ name, purpose }, "rev-1"), SOURCE));
  return required(created.created?.[0], `the identifier of the initiative "${name}" it created`);
}
async function addPartners(initiativeId: string, partnerIds: readonly string[]) {
  const before = await initiativeDetail(initiativeId);
  return mutations.outreach.addMembers(attempt({ initiativeId, partnerIds }, before.revision), SOURCE);
}
/** A fresh initiative holding one seeded partner, with the member row the case acts on: the arrange every assessment case starts from. */
async function initiativeWithMember(name: string, purpose: string, partnerId: string): Promise<{ readonly initiativeId: string; readonly member: WorkingListRows[number] }> {
  const initiativeId = await createInitiative(name, purpose);
  acceptedOutcome(await addPartners(initiativeId, [partnerId]));
  return { initiativeId, member: memberRowFor((await initiativeDetail(initiativeId)).data.workingList.items, partnerId) };
}
async function draftAsk(initiativeId: string, payload: Record<string, unknown>): Promise<string> {
  const before = await initiativeDetail(initiativeId);
  const drafted = acceptedOutcome(await mutations.outreach.draftRequest(attempt({ initiativeId, purpose: "Ask set by this case", ...payload }, before.revision), SOURCE));
  return required(drafted.created?.[0], "the identifier of the Request it drafted");
}
async function presentAsk(initiativeId: string, requestId: string, presentedOn: string, versionRef: string) {
  const detail = await initiativeDetail(initiativeId);
  const row = requestRowFor(detail.data.requests.items, requestId);
  return mutations.outreach.presentRequest(attempt({ requestId, presentedOn, manner: "In person", versionRef }, row.revision), SOURCE);
}
async function answerAsk(initiativeId: string, requestId: string, facts: { readonly kind: string; readonly termsVersionRef: string; readonly respondentId: string }) {
  const detail = await initiativeDetail(initiativeId);
  const row = requestRowFor(detail.data.requests.items, requestId);
  return mutations.outreach.recordRequestResponse(attempt({ requestId, response: { ...facts, standingEvidence: null } }, row.revision), SOURCE);
}
const requestedAmount = (currency: string, minorUnits: number): Money => ({ currency, minorUnits: minorUnits as Money["minorUnits"] });
describe("a reviewed working list holds only the partners somebody chose", () => {
  it("joins the selected partners and nothing a later filter happens to match", async () => {
    const initiativeId = await createInitiative("Autumn visits", "Invite partners to a visit round.");
    expect((await initiativeDetail(initiativeId)).data.workingList.total).toBe(0);
    const matched = await envelopeOf(reads.partners.findPartners({ search: "Okafor" }, SOURCE), "findPartners");
    expect([matched.data.total, required(matched.data.rows[0], "matched roster row").partner.partnerId, (await initiativeDetail(initiativeId)).data.workingList.total]).toEqual([1, "partner-ruth-okafor", 0]);
    const added = acceptedOutcome(
      await addPartners(initiativeId, [
        "partner-ruth-okafor",
        "partner-church-st-aidan",
        "partner-prep-sunday-visitor",
        "partner-not-on-the-roster", // A partner this roster does not carry is refused per item rather than failing the whole list.
      ]),
    );
    const items = added.items ?? [];
    expect([items.filter((item) => item.state === "accepted").map((item) => item.targetId), items.filter((item) => item.state === "excluded").map((item) => item.reasonCode)]).toEqual([
      ["partner-ruth-okafor", "partner-church-st-aidan"],
      ["not-eligible", "not-eligible"],
    ]);
    expect(added.created).toHaveLength(2);
    const listed = await initiativeDetail(initiativeId);
    expect(listed.data.workingList.total).toBe(2);
    expect([listed.data.workingList.items.map((row) => row.partnerId).sort(), listed.data.workingList.items.filter((row) => row.partnerId === "partner-prep-sunday-visitor")]).toEqual([["partner-church-st-aidan", "partner-ruth-okafor"], []]);
    expect([(await envelopeOf(reads.partners.findPartners({ search: "Okafor" }, SOURCE), "findPartners")).data.total, (await initiativeDetail(initiativeId)).data.workingList.total]).toEqual([1, 2]);
  });
  it("keeps included, removed and excluded as three states, not one filtered list", async () => {
    const detail = await initiativeDetail(SEEDED_INITIATIVE);
    const states = [...new Set(detail.data.workingList.items.map((row) => row.state))];
    expect(states).toHaveLength(3);
    expect(new Set(states).size).toBe(3);
    for (const state of states) expect(["included", "removed", "excluded"]).toContain(state);
    const counts = detail.data.initiative.memberStates;
    expect(Object.keys(counts).sort()).toEqual(["excluded", "included", "removed"]);
    expect(counts.included + counts.removed + counts.excluded).toBe(detail.data.workingList.total);
    for (const state of states) expect(counts[state as keyof typeof counts]).toBeGreaterThan(0);
  });
  it("keeps the history and the obligations a removal does not own", async () => {
    const { initiativeId, member } = await initiativeWithMember("Visit follow-up", "Follow up the spring visits.", "partner-grace-adeyemi");
    const seededBefore = await initiativeDetail(SEEDED_INITIATIVE);
    const seededMember = memberRowFor(seededBefore.data.workingList.items, "partner-grace-adeyemi");
    expect(seededBefore.data.nextWork.items.map((task) => task.taskId)).toContain("task-meeting-grace");
    const tasksBefore = (await recordCounts()).tasks;
    const removed = acceptedOutcome(await mutations.outreach.removeMember(attempt({ initiativeId, memberId: member.memberId, reason: "Asked us to wait until the new year." }, member.revision), SOURCE));
    expect(removed.changed).toEqual([member.memberId]);
    const after = await initiativeDetail(initiativeId);
    const removedRow = memberRowFor(after.data.workingList.items, "partner-grace-adeyemi");
    expect([[removedRow.state, removedRow.history.length], removedRow.history.map((entry) => entry.state)]).toEqual([
      ["removed", member.history.length + 1],
      ["included", "removed"],
    ]);
    expect([removedRow.history[0]?.reason, removedRow.history[1]?.reason]).toEqual(["Added from the reviewed working list.", "Asked us to wait until the new year."]);
    const seededAfter = await initiativeDetail(SEEDED_INITIATIVE);
    const seededAfterMember = memberRowFor(seededAfter.data.workingList.items, "partner-grace-adeyemi");
    expect([seededAfterMember.state, seededAfterMember.revision, seededAfter.data.nextWork.items.find((task) => task.taskId === "task-meeting-grace")?.status, (await recordCounts()).tasks]).toEqual(["included", seededMember.revision, "open", tasksBefore]);
    expect(after.actions.find((action) => action.name === "setStage")?.available).toBe(false); // With nobody left on the list there is nothing to plan against, so planning is not offered.
    const countsBeforeReturn = await recordCounts();
    const returned = acceptedOutcome(await mutations.outreach.returnMember(attempt({ initiativeId, memberId: removedRow.memberId }, removedRow.revision), SOURCE));
    const restoredDetail = await initiativeDetail(initiativeId);
    const restored = memberRowFor(restoredDetail.data.workingList.items, "partner-grace-adeyemi");
    const countsAfterReturn = await recordCounts();
    expect([returned.changed, restored.state]).toEqual([[removedRow.memberId], "included"]);
    expect(restored.stage).toBeNull();
    expect(restored.history.map((entry) => entry.state)).toEqual(["included", "removed", "included"]);
    expect(restoredDetail.actions.find((action) => action.name === "setStage")?.available).toBe(true);
    expect(countsAfterReturn.membershipStates).toEqual(countsBeforeReturn.membershipStates);
    expect([countsAfterReturn.memberships, countsAfterReturn.notificationIntents, countsAfterReturn.notificationResults, countsAfterReturn.gifts]).toEqual([countsBeforeReturn.memberships, countsBeforeReturn.notificationIntents, countsBeforeReturn.notificationResults, countsBeforeReturn.gifts]);
    expect(countsAfterReturn.commitments).toBe(countsBeforeReturn.commitments);
  });
  it("creates no consent, no assessment and no Update audience by including a partner", async () => {
    const initiativeId = await createInitiative("Autumn calls", "Call the partners who asked to hear from us.");
    const before = await recordCounts();
    expect(before.membershipStates["membership-subscribed-column"]).toBe("off");
    const scopeOverviewBefore = await envelopeOf(reads.support.readSupportOverview({}, SOURCE), "readSupportOverview");
    acceptedOutcome(await addPartners(initiativeId, ["partner-hana-nakamura"]));
    const after = await recordCounts();
    expect(memberRowFor((await initiativeDetail(initiativeId)).data.workingList.items, "partner-hana-nakamura").stage).toBeNull();
    // Inclusion is not consent and not Update membership: the purpose-specific memberships are untouched, including the one a `subscribed` column would have created, which is off and stays off.
    expect([after.membershipStates, [after.memberships, after.notificationIntents, after.notificationResults, after.gifts, after.commitments, after.tasks]]).toEqual([before.membershipStates, [before.memberships, before.notificationIntents, before.notificationResults, before.gifts, before.commitments, before.tasks]]);
    expect(after.interactions).toBe(before.interactions);
    expect((await envelopeOf(reads.support.readSupportOverview({}, SOURCE), "readSupportOverview")).data).toEqual(scopeOverviewBefore.data);
  });
});
describe("a stage records an assessment and predicts nothing", () => {
  it("accepts only a stage the source approves", async () => {
    const { initiativeId, member } = await initiativeWithMember("Approved stages", "Check which stages are offered.", "partner-ruth-okafor");
    const approved = (await initiativeDetail(initiativeId)).data.stages.filter((option) => option.admitted).map((option) => option.value);
    expect(approved.length).toBeGreaterThan(0);
    for (const value of approved) expect(value).not.toMatch(/won|lost|closed|converted|pledged|gave|donated/iu);
    const refused = await mutations.outreach.setStage(attempt({ initiativeId, memberId: member.memberId, stage: "Won" }, member.revision), SOURCE);
    const invalid = invalidOutcome(refused);
    expect(fieldPathsOf(invalid)).toEqual(["stage"]);
    for (const messages of Object.values(invalid.fields)) {
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((message) => message.trim().length > 0)).toBe(true);
    }
    expect(memberRowFor((await initiativeDetail(initiativeId)).data.workingList.items, "partner-ruth-okafor").stage).toBeNull();
  });
  it("treats the same assessment again as no change at all", async () => {
    const { initiativeId, member } = await initiativeWithMember("Repeated assessment", "Record the same stage twice.", "partner-kenji-nakamura");
    const recorded = acceptedOutcome(await mutations.outreach.setStage(attempt({ initiativeId, memberId: member.memberId, stage: "Follow up due" }, member.revision), SOURCE));
    const afterFirst = memberRowFor((await initiativeDetail(initiativeId)).data.workingList.items, "partner-kenji-nakamura");
    expect([afterFirst.stage, afterFirst.stageState]).toEqual(["Follow up due", "admitted"]);
    expect(afterFirst.revision).not.toBe(member.revision);
    const repeated = outcomeIs(await mutations.outreach.setStage(attempt({ initiativeId, memberId: member.memberId, stage: "Follow up due" }, afterFirst.revision), SOURCE), "unchanged");
    if (repeated.outcome !== "unchanged") throw new Error("A repeated assessment was expected to answer unchanged.");
    expect([repeated.revision, recorded.revision]).toEqual([afterFirst.revision, afterFirst.revision]);
    const afterSecond = memberRowFor((await initiativeDetail(initiativeId)).data.workingList.items, "partner-kenji-nakamura");
    expect(afterSecond.revision).toBe(afterFirst.revision);
    expect(afterSecond.history).toEqual(afterFirst.history);
  });
  it("creates no task and resumes nothing", async () => {
    const { initiativeId, member } = await initiativeWithMember("Assessment side effects", "Change a stage and watch the work.", "partner-ruth-okafor");
    const tasksBefore = (await recordCounts()).tasks;
    const nextWorkBefore = (await initiativeDetail(initiativeId)).data.nextWork.total;
    expect((await envelopeOf(reads.series.readSeries({ seriesId: PAUSED_SERIES }, SOURCE), "readSeries")).data.state).toBe("paused");
    acceptedOutcome(await mutations.outreach.setStage(attempt({ initiativeId, memberId: member.memberId, stage: "Asked" }, member.revision), SOURCE));
    expect([(await recordCounts()).tasks, (await initiativeDetail(initiativeId)).data.nextWork.total, (await envelopeOf(reads.series.readSeries({ seriesId: PAUSED_SERIES }, SOURCE), "readSeries")).data.state]).toEqual([tasksBefore, nextWorkBefore, "paused"]);
  });
  it("carries the stage identity and its assessment, and no outcome beside them", async () => {
    const { initiativeId, member } = await initiativeWithMember("Stage shape", "Record a stage and read the result.", "partner-ruth-okafor");
    const detail = await initiativeDetail(initiativeId);
    for (const option of detail.data.stages) expect(Object.keys(option).sort()).toEqual(["admitted", "value"]);
    const recorded = acceptedOutcome(await mutations.outreach.setStage(attempt({ initiativeId, memberId: member.memberId, stage: "Answered" }, member.revision), SOURCE));
    expect([Object.keys(recorded).sort(), recorded.changed]).toEqual([["changed", "operationId", "outcome", "revision"], [member.memberId]]);
    expect(JSON.stringify(recorded)).not.toMatch(/won|lost|closed|converted|pledge/iu);
  });
});
describe("a Request answers the terms version it was presented", () => {
  it("keeps both versions and records the version each presentation showed", async () => {
    const initiativeId = await createInitiative("Versioned asks", "Ask in two versions.");
    const first = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", representedOrganizationId: "partner-church-st-aidan", terms: { version: 1, currency: "USD", minorUnits: 2500, cadence: "Monthly", term: "12 months" } });
    const drafted = requestRowFor((await initiativeDetail(initiativeId)).data.requests.items, first);
    expect([drafted.terms.version, drafted.recipientPartnerId, drafted.representedOrganizationId]).toEqual(["terms-v1", "partner-ruth-okafor", "partner-church-st-aidan"]);
    expect(drafted.representedOrganizationId).not.toBe(drafted.recipientPartnerId);
    acceptedOutcome(await presentAsk(initiativeId, first, "2026-11-02", "terms-v1"));
    const second = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 2, nonFinancial: { description: "Prayer support for the visit team" } } });
    acceptedOutcome(await presentAsk(initiativeId, second, "2026-11-09", "terms-v2"));
    const detail = await initiativeDetail(initiativeId);
    expect(detail.data.requests.total).toBe(2);
    const firstRow = requestRowFor(detail.data.requests.items, first);
    const secondRow = requestRowFor(detail.data.requests.items, second);
    expect([firstRow.terms.version, firstRow.presentation?.versionRef, firstRow.presentation?.citesCurrentVersion, secondRow.terms.version, secondRow.presentation?.versionRef, secondRow.presentation?.citesCurrentVersion]).toEqual(["terms-v1", "terms-v1", true, "terms-v2", "terms-v2", true]);
    expect([firstRow.presentation?.presentedOn, secondRow.presentation?.presentedOn]).toEqual(["2026-11-02", "2026-11-09"]);
  });
  it("records a late answer against the earlier version, without reopening anything", async () => {
    const before = await initiativeDetail(SEEDED_INITIATIVE);
    const seededRequest = requestRowFor(before.data.requests.items, "request-autumn-grace");
    expect([seededRequest.terms.version, seededRequest.presentation?.versionRef, before.data.initiative.state]).toEqual(["terms-v2", "terms-v1", "open"]); // The seeded world states the arrangement this rule exists for: the ask moved to v2 while the presentation, and so the answer, cite v1.
    const wrongVersion = invalidOutcome(await answerAsk(SEEDED_INITIATIVE, "request-autumn-grace", { kind: "agreed", respondentId: "partner-grace-adeyemi", termsVersionRef: "terms-v2" })); // An answer to a version that was never presented is refused rather than relabelled.
    expect(fieldPathsOf(wrongVersion)).toEqual(["response.termsVersionRef"]);
    const recorded = acceptedOutcome(await answerAsk(SEEDED_INITIATIVE, "request-autumn-grace", { kind: "agreed", respondentId: "partner-grace-adeyemi", termsVersionRef: "terms-v1" }));
    expect(recorded.changed).toEqual(["request-autumn-grace"]);
    const after = await initiativeDetail(SEEDED_INITIATIVE);
    const answered = requestRowFor(after.data.requests.items, "request-autumn-grace");
    expect([answered.response?.kind, answered.response?.termsVersionRef]).toEqual(["agreed", "terms-v1"]);
    expect(answered.response?.termsVersionRef).not.toBe(answered.terms.version);
    expect([answered.answeredEarlierTermsVersion, answered.response?.answersCurrentVersion, after.data.initiative.state, after.data.initiative.lifecycle]).toEqual([true, false, "open", "open"]);
    expect(after.data.history.some((entry) => entry.kind === "request-response" && entry.termsVersionRef === "terms-v1")).toBe(true);
    const results = await initiativeResults(SEEDED_INITIATIVE); // The results name the superseded version rather than folding it into the current one.
    const versions = new Map(results.data.termsVersions.map((version) => [version.termsVersion, version]));
    expect([required(versions.get("terms-v1"), "terms-v1 in the results").state, required(versions.get("terms-v2"), "terms-v2 in the results").state]).toEqual(["superseded", "current"]);
  });
  it("keeps the response kinds a closed set of seven", async () => {
    const results = await initiativeResults(SEEDED_INITIATIVE);
    const kinds = results.data.responseKinds.map((entry) => entry.kind);
    expect(kinds).toHaveLength(7);
    expect([new Set(kinds).size, [...kinds]]).toEqual([7, ["agreed", "conditional", "partial", "deferred", "declined", "unanswered", "needs-clarification"]]);
    acceptedOutcome(await answerAsk(SEEDED_INITIATIVE, "request-autumn-grace", { kind: "agreed", respondentId: "partner-grace-adeyemi", termsVersionRef: "terms-v1" })); // The answer the refused eighth kind must leave alone is one this case records itself, so the case holds whatever order the cases run in.
    const before = await recordCounts();
    const eighth = invalidOutcome(await answerAsk(SEEDED_INITIATIVE, "request-autumn-grace", { kind: "accepted", respondentId: "partner-grace-adeyemi", termsVersionRef: "terms-v1" }));
    expect(fieldPathsOf(eighth)).toEqual(["response.kind"]);
    const after = await recordCounts();
    expect(after.requests).toBe(before.requests);
    expect(requestRowFor((await initiativeDetail(SEEDED_INITIATIVE)).data.requests.items, "request-autumn-grace").response?.kind).toBe("agreed");
  });
});
describe("an agreement creates nothing but an answer", () => {
  it("records the answer without creating a gift, a pledge, a task or a message", async () => {
    const initiativeId = await createInitiative("Agreement leaves no trace", "Record an agreed answer in it.");
    const ask = await draftAsk(initiativeId, { recipientPartnerId: "partner-church-st-aidan", terms: { version: 1, currency: "USD", minorUnits: 12000, cadence: "One-off", term: "This year" } });
    acceptedOutcome(await presentAsk(initiativeId, ask, "2026-11-05", "terms-v1"));
    const nextWorkBefore = (await initiativeDetail(initiativeId)).data.nextWork.total;
    const before = await recordCounts();
    const recorded = acceptedOutcome(await answerAsk(initiativeId, ask, { kind: "agreed", respondentId: "partner-church-st-aidan", termsVersionRef: "terms-v1" }));
    expect(recorded.changed).toEqual([ask]);
    const after = await recordCounts();
    expect([after.gifts, after.commitments, after.tasks, after.interactions, after.notificationIntents, after.notificationResults, after.partners]).toEqual([before.gifts, before.commitments, before.tasks, before.interactions, before.notificationIntents, before.notificationResults, before.partners]);
    const detail = await initiativeDetail(initiativeId);
    expect(detail.data.nextWork.total).toBe(nextWorkBefore);
    const answered = requestRowFor(detail.data.requests.items, ask);
    expect([answered.response?.kind, answered.nextWorkIds]).toEqual(["agreed", []]);
    expect(answered.response?.respondentId).toBe(answered.recipientPartnerId);
  });
  it("keeps requested terms out of every received-support figure", async () => {
    const overviewBefore = await envelopeOf(reads.support.readSupportOverview({}, SOURCE), "readSupportOverview");
    const initiativeId = await createInitiative("Requested only", "Ask for an amount nobody has given.");
    const ask = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 1, currency: "USD", minorUnits: 987654, cadence: "Monthly", term: "24 months" } });
    acceptedOutcome(await presentAsk(initiativeId, ask, "2026-11-06", "terms-v1"));
    acceptedOutcome(await answerAsk(initiativeId, ask, { kind: "agreed", respondentId: "partner-ruth-okafor", termsVersionRef: "terms-v1" }));
    const row = requestRowFor((await initiativeDetail(initiativeId)).data.requests.items, ask);
    expect(row.terms.basis).toBe("requested-terms");
    expect(row.terms.money).toMatchObject(requestedAmount("USD", 987654));
    const overviewAfter = await envelopeOf(reads.support.readSupportOverview({}, SOURCE), "readSupportOverview");
    expect(overviewAfter.data).toEqual(overviewBefore.data);
    expect(JSON.stringify(overviewAfter.data)).not.toContain("987654");
  });
  it("states a non-financial ask with no amount beside it", async () => {
    const initiativeId = await createInitiative("Non-financial ask", "Ask for something that is not money.");
    const before = await recordCounts();
    const ask = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 3, nonFinancial: { description: "A reference for the youth programme" } } });
    const row = requestRowFor((await initiativeDetail(initiativeId)).data.requests.items, ask);
    expect(row.terms.nonFinancial).toBe("A reference for the youth programme");
    expect(row.terms.money).toBeNull();
    expect(JSON.stringify(row.terms)).not.toContain("minorUnits");
    // An ask cannot be both: the mixed shape is refused rather than reduced to one half.
    const mixed = invalidOutcome(
      await mutations.outreach.draftRequest(attempt({ initiativeId, recipientPartnerId: "partner-ruth-okafor", purpose: "Ask set by this case", terms: { version: 4, currency: "USD", minorUnits: 500, nonFinancial: { description: "And prayer" } } }, (await initiativeDetail(initiativeId)).revision), SOURCE),
    );
    expect(fieldPathsOf(mixed)).toEqual(["terms.nonFinancial"]);
    expect((await recordCounts()).requests).toBe(before.requests + 1);
  });
  it("respects a currency's exponent and never defaults an unknown one", async () => {
    const initiativeId = await createInitiative("Currency exponents", "Ask in currencies with three and zero decimals.");
    const threeDecimal = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 1, currency: "KWD", minorUnits: 1250 } });
    const zeroDecimal = await draftAsk(initiativeId, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 1, currency: "JPY", minorUnits: 5000 } });
    const detail = await initiativeDetail(initiativeId);
    expect([requestRowFor(detail.data.requests.items, threeDecimal).terms.money?.currencyExponent, requestRowFor(detail.data.requests.items, zeroDecimal).terms.money?.currencyExponent]).toEqual([3, 0]);
    const before = await recordCounts();
    const unknownCurrency = invalidOutcome(await mutations.outreach.draftRequest(attempt({ initiativeId, recipientPartnerId: "partner-ruth-okafor", purpose: "Ask set by this case", terms: { version: 2, currency: "ZZZ", minorUnits: 100 } }, (await initiativeDetail(initiativeId)).revision), SOURCE));
    expect(fieldPathsOf(unknownCurrency)).toEqual(["terms.currency"]);
    expect((await recordCounts()).requests).toBe(before.requests);
  });
});
describe("results state every count over its own base", () => {
  it("reports each count with the denominator it was measured against", async () => {
    const results = await initiativeResults(SEEDED_INITIATIVE);
    const { requests, responseKinds } = results.data;
    expect([requests.answered.denominator, requests.answered.count + requests.unanswered.count]).toEqual([requests.presented.denominator, requests.answered.denominator]);
    expect(requests.answered.denominator).toBeGreaterThan(0);
    for (const measured of [requests.presented, requests.answered, requests.unanswered, ...responseKinds]) {
      expect(measured.denominatorMeaning.trim().length).toBeGreaterThan(0);
      expect([Number.isInteger(measured.count), Number.isInteger(measured.denominator), measured.percentage]).toEqual([true, true, Math.round((measured.count * 1000) / measured.denominator) / 10]); // Exact integers, and the rate is the stated ratio rather than a figure of its own.
    }
    const included = results.data.workingList.included;
    expect(included.count + results.data.workingList.removed.count + results.data.workingList.excluded.count).toBe(included.denominator);
  });
  it("states no rate at all when the denominator is zero", async () => {
    const results = await initiativeResults(await createInitiative("Nothing asked yet", "Read results before any ask exists."));
    const measured = [results.data.workingList.included, results.data.workingList.removed, results.data.workingList.excluded, results.data.requests.presented, results.data.requests.answered, results.data.requests.unanswered, ...results.data.responseKinds];
    for (const entry of measured) {
      expect([entry.denominator, entry.count]).toEqual([0, 0]);
      expect(entry.percentage).toBeUndefined();
      expect("percentage" in entry).toBe(false);
    }
  });
});
describe("closing fences new solicitation and resolves nothing", () => {
  it("refuses a close that says nothing about the work it leaves", async () => {
    const before = await initiativeDetail(SEEDED_INITIATIVE);
    const handoffOnly = invalidOutcome(await mutations.outreach.closeInitiative(attempt({ initiativeId: SEEDED_INITIATIVE, handoff: { kind: "none", reason: "Nothing outstanding" } }, before.revision), SOURCE));
    expect(fieldPathsOf(handoffOnly)).toEqual(["disposition"]);
    const after = await initiativeDetail(SEEDED_INITIATIVE);
    expect([after.data.initiative.state, after.revision]).toEqual(["open", before.revision]);
  });
  it("closes with a disposition, fences new solicitation and still takes a late answer", async () => {
    const presentedBeforeClose = await draftAsk(SEEDED_INITIATIVE, { recipientPartnerId: "partner-ruth-okafor", terms: { version: 2, currency: "USD", minorUnits: 3000, cadence: "Monthly", term: "6 months" } });
    const unpresented = await draftAsk(SEEDED_INITIATIVE, { recipientPartnerId: "partner-hana-nakamura", terms: { version: 2, currency: "USD", minorUnits: 1000, cadence: "Monthly", term: "6 months" } });
    acceptedOutcome(await presentAsk(SEEDED_INITIATIVE, presentedBeforeClose, "2026-11-10", "terms-v2"));
    const open = await initiativeDetail(SEEDED_INITIATIVE);
    const closed = acceptedOutcome(await mutations.outreach.closeInitiative(attempt({ initiativeId: SEEDED_INITIATIVE, disposition: "Closed for this year", handoff: { kind: "none", reason: "No further visits planned" } }, open.revision), SOURCE));
    expect(closed.items?.map((item) => item.targetId)).toContain("task-meeting-grace");
    expect(closed.items?.every((item) => item.state !== "accepted")).toBe(true);
    const after = await initiativeDetail(SEEDED_INITIATIVE);
    expect([after.data.initiative.state, after.data.initiative.lifecycle]).toEqual(["closed", "closed"]);
    expect(after.data.initiative.closureDisposition).toContain("Closed for this year");
    expect([after.data.nextWork.items.find((task) => task.taskId === "task-meeting-grace")?.status, after.actions.find((action) => action.name === "presentRequest")?.available]).toEqual(["open", false]);
    const drafted = invalidOutcome(await mutations.outreach.draftRequest(attempt({ initiativeId: SEEDED_INITIATIVE, recipientPartnerId: "partner-ruth-okafor", purpose: "One more ask", terms: { version: 2, currency: "USD", minorUnits: 700 } }, after.revision), SOURCE));
    expect(fieldPathsOf(drafted)).toEqual(["initiativeId"]);
    expect(fieldPathsOf(invalidOutcome(await presentAsk(SEEDED_INITIATIVE, unpresented, "2026-11-12", "terms-v2")))).toEqual(["initiativeId"]);
    expect(fieldPathsOf(invalidOutcome(await addPartners(SEEDED_INITIATIVE, ["partner-kenji-nakamura"])))).toEqual(["initiativeId"]);
    const answered = acceptedOutcome(await answerAsk(SEEDED_INITIATIVE, presentedBeforeClose, { kind: "deferred", respondentId: "partner-ruth-okafor", termsVersionRef: "terms-v2" }));
    expect(answered.changed).toEqual([presentedBeforeClose]);
    const stillClosed = await initiativeDetail(SEEDED_INITIATIVE);
    expect([stillClosed.data.initiative.state, requestRowFor(stillClosed.data.requests.items, presentedBeforeClose).response?.kind]).toEqual(["closed", "deferred"]);
  });
  it("reopens with its closure history and its exclusions intact", async () => {
    const open = await initiativeDetail(SEEDED_INITIATIVE); // The arrangement this case turns on — a closed initiative — is one it makes for itself, with the same close the closed-initiative case performs, so the case does not depend on that case running first.
    acceptedOutcome(await mutations.outreach.closeInitiative(attempt({ initiativeId: SEEDED_INITIATIVE, disposition: "Closed for this year", handoff: { kind: "none", reason: "No further visits planned" } }, open.revision), SOURCE));
    const closed = await initiativeDetail(SEEDED_INITIATIVE);
    expect(closed.data.initiative.lifecycle).toBe("closed");
    const disposition = closed.data.initiative.closureDisposition;
    const excludedBefore = memberRowFor(closed.data.workingList.items, EXCLUDED_PARTNER);
    expect(excludedBefore.state).toBe("excluded");
    const reopened = acceptedOutcome(await mutations.outreach.reopenInitiative(attempt({ initiativeId: SEEDED_INITIATIVE, reason: "A late answer arrived" }, closed.revision), SOURCE));
    expect(reopened.changed).toEqual([SEEDED_INITIATIVE]);
    const after = await initiativeDetail(SEEDED_INITIATIVE);
    expect([after.data.initiative.state, after.data.initiative.lifecycle]).toEqual(["open", "reopened"]);
    expect(after.data.initiative.closureDisposition).toBe(disposition); // The earlier close is preserved rather than rewritten by the reopen.
    const excludedAfter = memberRowFor(after.data.workingList.items, EXCLUDED_PARTNER);
    expect([excludedAfter.state, excludedAfter.revision]).toEqual(["excluded", excludedBefore.revision]);
    const returnedExcluded = invalidOutcome(await mutations.outreach.returnMember(attempt({ initiativeId: SEEDED_INITIATIVE, memberId: excludedAfter.memberId }, excludedAfter.revision), SOURCE));
    expect(fieldPathsOf(returnedExcluded)).toEqual(["memberId"]);
    const readded = outcomeIs(await addPartners(SEEDED_INITIATIVE, [EXCLUDED_PARTNER]), "unchanged");
    if (readded.outcome !== "unchanged") throw new Error("Selecting an excluded partner again was expected to change nothing.");
    expect(readded.revision).toBe(after.revision);
    const stillExcluded = memberRowFor((await initiativeDetail(SEEDED_INITIATIVE)).data.workingList.items, EXCLUDED_PARTNER);
    expect([stillExcluded.state, stillExcluded.revision]).toEqual(["excluded", excludedAfter.revision]);
  });
});
