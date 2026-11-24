/** The closed mutation contract, proven at the service boundary: the four fields every named mutation presents, the eight outcomes it may answer with, and the rejection paths that make that set closed. */
import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { newOperationId } from "@/lib/ids";
import { REDACTED } from "@/lib/redaction";
import { mutations, reads, toResponse, type MutationInput, type Scope } from "@/modules/data-service";
import { OPERATION_OUTCOME_NAMES, mutationInputSchema, type OperationOutcomeName, type OperationRecord, type PrincipalId } from "@/modules/data-service/envelope";
import { DENIAL_REASONS, LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, accepted, alreadyAccepted, conflict, denied, invalid, isOutcome, isReadResult, outcomeFromError, refusedRead, unavailable, unchanged, unknown, type MutationOutcome, type MutationResult } from "@/modules/data-service/outcome";
import { begin, emptyLedger, intentHash, lookup, readLedger, record, type OperationLedger } from "@/modules/data-service/operations";
import type { ResolvedSession, SessionSource } from "@/modules/data-service/authorize";
import { resetSeed } from "@/modules/dev-runtime/reset";
import type { FailureMode, FailureTargetKind } from "@/modules/dev-runtime/failures";
import { readSession, resetSession } from "@/modules/store/repository";
import { expectEnvelope, expectOutcome, firstSaying, required, throwing, type OutcomeNamed } from "../helpers/answers";
import { scopeOf, seededDocuments, sessionOf, storedStateOf } from "../helpers/fixtures";
// The identities this file acts as, and the seeded records it acts on
/** The seated worker: admitted to two ministries, holding `canEditGoal`, author of the seeded content. */
const HERO: SessionSource = { sessionId: "established-worker" };
/** A second principal in a second ministry. Every call it makes across that boundary must be refused. */
const OTHER_WORKER: SessionSource = { sessionId: "second-worker" };
/** A seeded shared partner of the worker's own ministry, with tags, a goal subject and recorded activity. */
const PARTNER = "partner-jo-mbeki";
/** The seeded Update document whose editions carry a draft, a candidate and a release. */
const UPDATE_DOCUMENT = "doc-update-autumn";
/** The seeded publisher whose Update-email purpose the audience mutations address. */
const PUBLISHER = "publisher-harbour";
/** The revision token an attempt presents when it creates a record rather than changing one. */
const NO_RECORD = "rev-none";
/** Builds the four-field input every named mutation presents, with a fresh attempt identity. */
const attempt = <P>(scope: Scope, expectedRevision: string, payload: P): MutationInput<P> => ({ operationId: newOperationId(), expectedRevision, payload, scope });
let session: ResolvedSession; // The world, resolved once per case: the seed lays the same sessions and the same selection down before every one
let scope: Scope;
let partnerRevision: string; // The revision the seeded partner stands at, which every case that changes it presents as the one it read.
/** Lays the seeded world down before every case. */
beforeEach(async () => {
  await resetSeed();
  session = await sessionOf(HERO);
  scope = required(session.selected, `the selected context of ${HERO.sessionId}`);
  partnerRevision = (await partnerEnvelope(PARTNER)).revision;
});
/** Clears the armed failure after every case, whatever the case did with it. */
afterEach(async () => {
  const state = expectEnvelope(await reads.dev.readDevState(HERO), "readDevState");
  if (!state.data.failurePlan.armed) return;
  expectOutcome(await mutations.dev.setFailurePlan(attempt(state.scope, state.revision, { plan: null }), HERO), "accepted"); // A plan left armed would answer a later case with an injected outcome, so a disarm that did not take is a failure of the case that armed it rather than something to leave behind.
});
const partnerEnvelope = async (partnerId: string) => expectEnvelope(await reads.partners.readPartner(partnerId, {}, HERO), `readPartner ${partnerId}`);
const interactionEnvelope = async () => expectEnvelope(await reads.interactions.readInteractions({ partnerId: PARTNER }, HERO), "readInteractions");
const goalEnvelope = async () => expectEnvelope(await reads.support.readGoal({}, HERO), "readGoal");
const taskTotal = async (): Promise<number> => expectEnvelope(await reads.work.listTasks({ list: "all", displayTimeZone: "UTC" }, HERO), "listTasks").data.total;
async function proposalSnapshot(): Promise<unknown> {
  const result = await reads.import.readImportProposal({ session: HERO });
  expect(isReadResult(result)).toBe(true);
  // A session that has never proposed a file answers `unavailable` rather than an empty proposal, and that absence is itself the state a refused proposal must leave exactly as it found it.
  return result.kind === "envelope" ? { kind: result.kind, revision: result.envelope.revision, data: result.envelope.data } : { kind: result.kind };
}
/** Arms exactly one simulated failure for the hero session, the way the development panel does. */
async function armFailure(mode: FailureMode, kind: FailureTargetKind, name: string): Promise<void> {
  const revision = expectEnvelope(await reads.dev.readDevState(HERO), "readDevState").revision;
  expectOutcome(await mutations.dev.setFailurePlan(attempt(scope, revision, { mode, target: { kind, name } }), HERO), "accepted");
}
/** Drives one attempt to `accepted` and then replays it twice. */
async function acceptedThenReplayed<P>(run: (input: MutationInput<P>) => Promise<MutationOutcome>, input: MutationInput<P>): Promise<OutcomeNamed<"accepted">> {
  const first = expectOutcome(await run(input), "accepted");
  const replay = expectOutcome(await run(input), "alreadyAccepted");
  expect(replay.revision).toBe(first.revision);
  expect([replay.created, replay.changed, replay.items]).toEqual([first.created, first.changed, first.items]);
  const again = expectOutcome(await run(input), "alreadyAccepted");
  expect(again.result).toEqual(replay.result);
  return first;
}
// The named inventory, read as names rather than as 145 lines
type NamedMember = { readonly group: string; readonly name: string; readonly member: unknown };
const namedMembersOf = (surface: typeof reads | typeof mutations): readonly NamedMember[] => Object.entries(surface).flatMap(([group, members]) => Object.entries(members).map(([name, member]) => ({ group, name, member })));
const memberNamesOf = (surface: typeof reads | typeof mutations): readonly string[] => namedMembersOf(surface).map((entry) => entry.name);
/** Every name that appears more than once, sorted: the deliberate re-uses a two-family job shares. */
const duplicateNamesOf = (names: readonly string[]): readonly string[] => [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort();
const OUTCOME_NAMES: readonly OperationOutcomeName[] = ["accepted", "alreadyAccepted", "unchanged", "conflict", "denied", "invalid", "unavailable", "unknown"];
/** One constructor per outcome, so "each has a constructor" is a fact this file checks rather than assumes. */
const OUTCOME_CONSTRUCTORS: Readonly<Record<OperationOutcomeName, (operationId: string) => MutationOutcome>> = {
  accepted: (operationId) => accepted({ operationId, revision: "rev-1" }),
  alreadyAccepted: (operationId) => alreadyAccepted({ operationId, revision: "rev-1", result: { recorded: true } }),
  unchanged: (operationId) => unchanged({ operationId, revision: "rev-1" }),
  conflict: (operationId) => conflict({ operationId, currentRevision: "rev-1", current: null, preservedInput: null, reason: "stale-revision" }),
  denied: (operationId) => denied({ operationId, reasonCode: "no-permission" }),
  invalid: (operationId) => invalid({ operationId, fields: { title: ["Give this task a title."] } }),
  unavailable: (operationId) => unavailable({ operationId, source: { system: LOCAL_STORE_SYSTEM, reference: "unreadable-ledger" }, guidance: "Retry the same request with the same operation id." }),
  unknown: (operationId) => unknown({ operationId }),
};
it("the named inventory: names every read and mutation as a function, in the counts the plan fixes", () => {
  for (const entry of namedMembersOf(reads)) expect(typeof entry.member, `${entry.group}.${entry.name} is a named read`).toBe("function");
  for (const entry of namedMembersOf(mutations)) expect(typeof entry.member, `${entry.group}.${entry.name} is a named mutation`).toBe("function");
  // 53 and 94 are the unique names: any missing name fails here, and so does any name added for a job the plan does not hold. Two reads explain the count beyond the base inventory: `readPartnerRecord` folds the record body, its activity and the caller's own preparation into the single envelope the record transport
  expect([new Set(memberNamesOf(reads)).size, new Set(memberNamesOf(mutations)).size]).toEqual([53, 94]); // answers with, so that fold is the service's rather than a handler's; and `findContentDocuments` is the content family's listing read, reachable from both content jobs.
});
it("the named inventory: repeats exactly the nine names two jobs share, and no other name", () => {
  // One preview authorisation and one listing read serve both content families, and the seven variant, draft, review, publish and locale writes are the same bindings the Page job adds its own writes to. A tenth repeated name would be a second meaning for an existing method. The deliberate re-uses are counted
  // here too, so a lost or an extra entry fails even where the unique total happens to survive it.
  expect([duplicateNamesOf(memberNamesOf(reads)), duplicateNamesOf(memberNamesOf(mutations))]).toEqual([
    ["findContentDocuments", "readPreview"],
    ["approveCandidate", "createVariant", "publishVariants", "requestChanges", "saveDraft", "submitForReview", "withdrawLocale"],
  ]);
  expect([memberNamesOf(reads).length, memberNamesOf(mutations).length]).toEqual([55, 101]);
});
it("the named inventory: closes the outcome set at the eight names, each with a constructor of its own", () => {
  expect([OPERATION_OUTCOME_NAMES.length, [...OPERATION_OUTCOME_NAMES].sort()]).toEqual([8, [...OUTCOME_NAMES].sort()]);
  for (const name of OPERATION_OUTCOME_NAMES) {
    const build = OUTCOME_CONSTRUCTORS[name];
    expect(typeof build, `the outcome "${name}" has a constructor`).toBe("function");
    const outcome = build("outcome-probe");
    expect([outcome.outcome, isOutcome(outcome)]).toEqual([name, true]);
  }
});
// The envelope, the payload, and the order between them
type GoalSavePayload = { readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: "received-gifts"; readonly effectiveFrom: string };
/** A complete four-field request, which the cases that remove or add a member start from. */
const completeAttempt = (): Record<string, unknown> => ({ ...attempt(scope, "rev-1", { title: "A follow-up call" }) });
const goalPayload = (minorUnits: number): GoalSavePayload => ({ amount: { currency: "USD", minorUnits }, measure: "received-gifts", effectiveFrom: "2026-11-20" });
const importPayload = (csv: string) => ({ fileName: "contacts.csv", contentBase64: Buffer.from(csv, "utf8").toString("base64") });
/** The one shape guard every named mutation runs before it reads or writes anything. */
const ENVELOPE_SCHEMA = mutationInputSchema(z.unknown());
const ENVELOPE_MEMBERS = ["operationId", "scope", "expectedRevision", "payload"] as const;
function withoutMember(member: (typeof ENVELOPE_MEMBERS)[number], complete: MutationInput<GoalSavePayload>): MutationInput<GoalSavePayload> {
  const rest: Record<string, unknown> = { ...complete };
  delete rest[member];
  // A call that omits one of the four does not compile — `MutationInput<P>` requires every member — so the compiler already refuses the omission. This cast models the other caller that reaches the same boundary: a JavaScript client, or a posted JSON body that never saw the type.
  return rest as unknown as MutationInput<GoalSavePayload>;
}
it("the four-field input: accepts exactly the four fields and hands them on unchanged", () => {
  const input = attempt(scope, "rev-1", { title: "A follow-up call" });
  const parsed = ENVELOPE_SCHEMA.safeParse(input);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("A complete four-field request was refused by the envelope guard.");
  expect(parsed.data).toEqual(input);
  // Nothing else travels with it: a fifth member is a field no named mutation reads, so accepting it would let a caller believe it had asked for something. The refusal names that member at the field path it occupies, so a form can point at the input to remove rather than at the whole body.
  const extra = ENVELOPE_SCHEMA.safeParse({ ...input, comment: "a field no mutation reads" });
  expect(extra.success).toBe(false);
  if (extra.success) throw new Error("A request carrying a field beyond the four was accepted.");
  const surplus = invalid({ operationId: input.operationId, fields: extra.error }).fields;
  expect(Object.keys(surplus)).toEqual(["comment"]);
  expect(Object.keys(surplus)).not.toContain(ROOT_FIELD_KEY);
});
it.each(ENVELOPE_MEMBERS)("refuses a request that states no %s, keyed by the field path", (member) => {
  const complete = completeAttempt();
  delete complete[member];
  const refused = ENVELOPE_SCHEMA.safeParse(complete);
  expect(refused.success).toBe(false);
  if (refused.success) throw new Error(`A request stating no ${member} was accepted by the envelope guard.`);
  const fields = invalid({ operationId: newOperationId(), fields: refused.error }).fields;
  expect(Object.keys(fields)).toEqual([member]);
  for (const message of fields[member] ?? []) expect(message.length).toBeGreaterThan(0);
});
it("the four-field input: refuses a malformed request before any record is read or written", async () => {
  const before = await goalEnvelope();
  const complete = attempt(scope, before.revision, goalPayload(3_000_000));
  for (const member of ENVELOPE_MEMBERS) {
    const refused = expectOutcome(await mutations.support.saveGoal(withoutMember(member, complete), HERO), "invalid");
    expect(Object.keys(refused.fields)).toContain(member);
  }
  const after = await goalEnvelope(); // Validation precedes the change: the goal stands exactly as it was, revision and figures alike.
  expect(after.revision).toBe(before.revision);
  expect(after.data).toEqual(before.data);
});
const documentRevision = async (): Promise<string> => expectEnvelope(await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: HERO }), "readVariantOverview").revision; // Accepted, then replayed — one representative mutation from each job group
// The bulk actions, and the seeded rows they act on
/** An open task of the worker's own, so a bulk action may change it. */
const OWNED_OPEN_TASK = "task-care-jo";
/** The worker's other open task, undated on purpose, so nothing about the first row's date decides it. */
const OWNED_UNDATED_TASK = "task-undated-prayer";
/** The worker's own task that is already complete, so completing it again must change nothing. */
const COMPLETED_TASK = "task-completed-intro";
/** An open task in the second worker's ministry, which the selected worker may not change. */
const FOREIGN_TASK = "task-river-invite-owen";
/** The worker's own series still in force, so a series mutation may pause it and the result can be read back. */
const OWNED_ACTIVE_SERIES = "series-weekly-call-round";
/** The private tag these cases apply. The seed sets no task tags at all, so the first attempt writes it. */
const BULK_TAG = "contract-bulk";
/** One row of a bulk action's answer, as the stored result carries it. */
const BULK_ROW_SCHEMA = z.object({ taskId: z.string(), state: z.enum(["accepted", "unchanged", "excluded", "failed"]), revision: z.string().nullable(), createdTaskId: z.string().nullable(), reasonCode: z.string().nullable(), reason: z.string().nullable() });
/** A bulk action's own answer: one row per selected task, the counts derived from those rows, and the tasks created. */
const BULK_ANSWER_SCHEMA = z.object({ items: z.array(BULK_ROW_SCHEMA), acceptedCount: z.number().int(), unchangedCount: z.number().int(), excludedCount: z.number().int(), failedCount: z.number().int(), createdTaskIds: z.array(z.string()) });
type BulkAnswer = z.infer<typeof BULK_ANSWER_SCHEMA>;
/** The answer a caller recovers after losing the acknowledgement: re-querying the accepted identity returns the stored result, which is where the per-item rows live. */
async function recoveredBulkAnswer<P>(run: (input: MutationInput<P>) => Promise<MutationOutcome>, input: MutationInput<P>): Promise<BulkAnswer> {
  const recovered = expectOutcome(await run(input), "alreadyAccepted");
  const parsed = BULK_ANSWER_SCHEMA.safeParse(recovered.result);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error(`The stored bulk answer states no per-item rows with their counts: ${parsed.error.message}`);
  return parsed.data;
}
/** One row of a bulk answer, by the task it answered for, so a missing row fails by name. */
const bulkRowOf = (answer: BulkAnswer, taskId: string): BulkAnswer["items"][number] => firstSaying(answer.items, "taskId", taskId, `The bulk answer reported no row for ${taskId}, so it answered for the selection instead of per row.`);
/** The revision one task stands at as a list reports it, so a per-item row can be held to the record it names. */
async function listedRevisionOf(taskId: string): Promise<string> {
  const rows = expectEnvelope(await reads.work.listTasks({ list: "all", displayTimeZone: "UTC", pageSize: 200 }, HERO), "listTasks").data.tasks;
  const row = firstSaying(rows, "taskId", taskId, `The task ${taskId} stands in no list the worker reads, so no record stands behind that row.`);
  return row.revision;
}
/** How much work the worker still owes: the upcoming list holds only tasks awaiting action. */
const openTotal = async (): Promise<number> => expectEnvelope(await reads.work.listTasks({ list: "upcoming", displayTimeZone: "UTC" }, HERO), "listTasks").data.total;
it("accepted, then replayed: answers accepted and replays through the shell job, returning the seeded context", async () => {
  const current = required(session.selected, "the context the seeded worker selected");
  const target = session.admittedMemberships.find((membership) => membership.ministryId !== current.ministryId) ?? throwing("The seeded worker is admitted to one ministry, so this case cannot switch context.");
  const switchPayload = { organizationId: target.organizationId, ministryId: target.ministryId, supportSubjectId: target.supportSubjectId };
  // The revision a switch presents is the one the caller read before asking. A deliberately stale token is answered with the conflict that states the current revision, which is the recovery the shell offers — re-read, then decide — rather than a silent overwrite of someone else's selection.
  const stale = expectOutcome(await mutations.context.selectContext(attempt(current, "rev-unread", switchPayload), HERO), "conflict");
  expect(stale.reason).toBe("stale-revision");
  const switched = await acceptedThenReplayed((input) => mutations.context.selectContext(input, HERO), attempt(current, stale.currentRevision, switchPayload));
  expect(switched.revision).not.toBe(stale.currentRevision);
  // The switch is exercised and then returned, so the seeded context still stands for every case after.
  expectOutcome(await mutations.context.selectContext(attempt(current, switched.revision, { organizationId: current.organizationId, ministryId: current.ministryId, supportSubjectId: current.supportSubjectId }), HERO), "accepted");
});
it("accepted, then replayed: answers a voluntary stay as unchanged, keeping the revision and the selection in force", async () => {
  const current = required(session.selected, "the context the seeded worker selected");
  const target = session.admittedMemberships.find((membership) => membership.ministryId !== current.ministryId) ?? throwing("The seeded worker is admitted to one ministry, so this case cannot ask to switch away.");
  const heldPayload = { organizationId: target.organizationId, ministryId: target.ministryId, supportSubjectId: target.supportSubjectId, resolveUnsavedWork: "stay" as const };
  const stale = expectOutcome(await mutations.context.selectContext(attempt(current, "rev-unread", heldPayload), HERO), "conflict"); // The context record's own revision, learned the way the shell learns it: an attempt on a revision the caller never read is answered with the conflict that states the current one.
  // Keeping the work is the caller's answer to the guard's question, not a stale revision: the attempt presents the revision that stands, so no staleness is claimed, no conflict surface is returned and nothing is applied.
  const stayed = expectOutcome(await mutations.context.selectContext(attempt(current, stale.currentRevision, heldPayload), HERO), "unchanged");
  expect([stayed.revision, Object.hasOwn(stayed, "reason")]).toEqual([stale.currentRevision, false]);
  const after = expectEnvelope(await reads.partners.findPartners({}, HERO), "the partner roster"); // The question was answered, not the switch: the context still in force is the one the caller was acting in, which a read states in its own scope.
  expect([after.scope.ministryId, after.scope.supportSubjectId]).toEqual([current.ministryId, current.supportSubjectId]);
});
it("accepted, then replayed: answers accepted and replays through the partners job, tagging the record once", async () => {
  const revision = partnerRevision;
  await acceptedThenReplayed((input) => mutations.partners.setTag(input, HERO), attempt(scope, revision, { partnerId: PARTNER, tag: "contract-probe", present: true }));
  const tags = (await partnerEnvelope(PARTNER)).data.partner.tags;
  expect(tags.filter((tag) => tag === "contract-probe").length).toBe(1);
});
it("accepted, then replayed: answers accepted and replays through the work job, creating one task", async () => {
  const before = await taskTotal();
  await acceptedThenReplayed((input) => mutations.work.createTask(input, HERO), attempt(scope, NO_RECORD, { title: "Call about the autumn appeal" }));
  expect(await taskTotal()).toBe(before + 1);
});
it("accepted, then replayed: answers accepted and replays through the work job's tag, reporting one row per selected task", async () => {
  // One row the worker owns and one from the second worker's ministry, so the answer has to be per item: a selection is not an authority, and the row that may not change is reported as excluded rather than quietly skipped or folded into one aggregate "done".
  const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, FOREIGN_TASK], tag: BULK_TAG });
  await acceptedThenReplayed((value) => mutations.work.bulkApplyTag(value, HERO), input);
  const answer = await recoveredBulkAnswer((value) => mutations.work.bulkApplyTag(value, HERO), input);
  expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, FOREIGN_TASK]); // One row per selected task, in the selection's own order, so nothing selected goes unanswered.
  const tagged = bulkRowOf(answer, OWNED_OPEN_TASK);
  expect(tagged.state).toBe("accepted");
  expect([tagged.revision, tagged.reasonCode]).toEqual([await listedRevisionOf(OWNED_OPEN_TASK), null]); // The row states the revision its task stands at and no reason code: nothing refused it.
  const refusedRow = bulkRowOf(answer, FOREIGN_TASK);
  expect([refusedRow.state, refusedRow.reasonCode]).toEqual(["excluded", "not-editable"]);
  expect([refusedRow.reason === null, refusedRow.revision]).toEqual([false, null]); // The excluded row states a reason and no revision: nothing of it was written, and nothing about it is disclosed to a scope that may not read it.
  expect([answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount]).toEqual([1, 0, 1, 0]); // The counts are derived from those rows rather than counted separately, and the selection tagged exactly one task.
  // Applying the same tag again under a fresh identity is no second effect: the action answers `unchanged`, which it answers only when every selected row already carries the tag as the caller's own — so the first attempt wrote the tag once and left it there.
  expectOutcome(await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO), "unchanged");
  // Beside a row that does not carry the tag yet, the tagged row is still reported per item as unchanged with `already-tagged`: it is named, the reason is stated, and the only tag written is the other row's.
  const mixedInput = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK], tag: BULK_TAG });
  expectOutcome(await mutations.work.bulkApplyTag(mixedInput, HERO), "accepted");
  const mixed = await recoveredBulkAnswer((value) => mutations.work.bulkApplyTag(value, HERO), mixedInput);
  const held = bulkRowOf(mixed, OWNED_OPEN_TASK);
  expect([[held.state, held.reasonCode], bulkRowOf(mixed, OWNED_UNDATED_TASK).state, [mixed.acceptedCount, mixed.unchangedCount]]).toEqual([["unchanged", "already-tagged"], "accepted", [1, 1]]);
});
it("accepted, then replayed: answers accepted and replays through the work job's completion, finishing only the rows it can", async () => {
  const openBefore = await openTotal();
  // Three rows in three states: the worker's open task, the worker's completed task, and the second worker's task. Completing a selection must answer for each row, because completing a task proves only that the task was completed — never a conversation, and never another ministry's work.
  const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, COMPLETED_TASK, FOREIGN_TASK] });
  const first = await acceptedThenReplayed((value) => mutations.work.bulkCompleteTasks(value, HERO), input);
  const answer = await recoveredBulkAnswer((value) => mutations.work.bulkCompleteTasks(value, HERO), input);
  expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, COMPLETED_TASK, FOREIGN_TASK]);
  const completed = bulkRowOf(answer, OWNED_OPEN_TASK);
  expect([completed.state, completed.revision]).toEqual(["accepted", await listedRevisionOf(OWNED_OPEN_TASK)]);
  expect([completed.createdTaskId, first.created]).toEqual([null, undefined]); // The completed task repeats no series, so no successor was minted: the row names no created task and the answer reports none.
  const alreadyComplete = bulkRowOf(answer, COMPLETED_TASK);
  expect([alreadyComplete.state, alreadyComplete.reasonCode]).toEqual(["unchanged", "already-complete"]);
  expect(alreadyComplete.revision).toBe(await listedRevisionOf(COMPLETED_TASK)); // An unchanged row states the revision it already stood at, which is the record nothing was written to.
  const refusedRow = bulkRowOf(answer, FOREIGN_TASK);
  expect([
    [refusedRow.state, refusedRow.reasonCode, refusedRow.revision],
    [answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount],
  ]).toEqual([
    ["excluded", "not-editable", null],
    [1, 1, 1, 0],
  ]);
  expect(await openTotal()).toBe(openBefore - 1); // Exactly one task left the work still owed, and the two replays behind this case left it there: a completion that ran twice would have taken a second row out of the worker's list.
});
it("accepted, then replayed: answers accepted and replays through the work job's follow-ups, creating one task per selected row", async () => {
  const before = await taskTotal();
  const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK], template: { title: "Call after the visit" } }); // Two rows the worker owns, and one template: the action creates one ordinary follow-up task for each selected row, not one task for the selection.
  const first = await acceptedThenReplayed((value) => mutations.work.bulkCreateTasks(value, HERO), input);
  const answer = await recoveredBulkAnswer((value) => mutations.work.bulkCreateTasks(value, HERO), input);
  expect([answer.items.map((row) => row.taskId), answer.items.every((row) => row.state === "accepted")]).toEqual([[OWNED_OPEN_TASK, OWNED_UNDATED_TASK], true]);
  const created = answer.items.map((row) => row.createdTaskId); // Each row names the task it created, and two rows never name the same task.
  expect([created.filter((createdTaskId) => createdTaskId === null), [new Set(created).size, [answer.createdTaskIds, first.created], answer.acceptedCount]]).toEqual([[], [2, [created, answer.createdTaskIds], 2]]);
  expect(await taskTotal()).toBe(before + 2); // Two tasks exist that did not before — and the two replays behind this case created no third, so the total stands at exactly the count the first attempt produced.
});
it("accepted, then replayed: answers accepted and replays through the work job's tag removal, reporting one row per selected task", async () => {
  expectOutcome(await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO), "accepted"); // The tag has to exist before it can be taken off, and the seed sets none: one attempt writes it.
  // Removing it from a row that carries it, from a row that does not, and from a row in another ministry must answer for each: removed, absent and not editable are three different facts, and only the first is a change.
  const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK, FOREIGN_TASK], tag: BULK_TAG });
  await acceptedThenReplayed((value) => mutations.work.bulkRemoveTag(value, HERO), input);
  const answer = await recoveredBulkAnswer((value) => mutations.work.bulkRemoveTag(value, HERO), input);
  expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, OWNED_UNDATED_TASK, FOREIGN_TASK]);
  const removed = bulkRowOf(answer, OWNED_OPEN_TASK);
  expect([removed.state, removed.revision]).toEqual(["accepted", await listedRevisionOf(OWNED_OPEN_TASK)]);
  const absent = bulkRowOf(answer, OWNED_UNDATED_TASK);
  expect([
    [absent.state, absent.reasonCode],
    [bulkRowOf(answer, FOREIGN_TASK).reasonCode, [answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount]],
  ]).toEqual([
    ["unchanged", "tag-absent"],
    ["not-editable", [1, 1, 1, 0]],
  ]);
  expectOutcome(await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO), "accepted"); // The tag is gone from the row: applying it again is a fresh change rather than a no-op, which is only true if the removal was written once.
});
it.each([
  { shown: "answers accepted and replays through the import job, proposing the file once", replay: async () => acceptedThenReplayed((input) => mutations.import.proposeImport(input, HERO), attempt(scope, NO_RECORD, importPayload("Name,Email\nAma Test,ama@example.org\n"))) },
  {
    shown: "answers accepted and replays through the outreach job, creating one initiative",
    replay: async () => acceptedThenReplayed((input) => mutations.outreach.createInitiative(input, HERO), attempt(scope, NO_RECORD, { name: "Autumn reconnection", purpose: "Reconnect with supporters who have not been in touch since the spring appeal." })),
  },
  { shown: "answers accepted and replays through the coaching job, setting one target", replay: async () => acceptedThenReplayed((input) => mutations.coaching.saveTarget(input, HERO), attempt(scope, NO_RECORD, { measure: "calls-made", quantity: 4, privateLabel: "Calls this week" } as const)) },
])("$shown", async ({ replay }) => {
  expect((await replay()).created?.length).toBe(1);
});
it("accepted, then replayed: answers accepted and replays through the support job, setting the one permitted financial write", async () => {
  const before = await goalEnvelope();
  const first = await acceptedThenReplayed((input) => mutations.support.saveGoal(input, HERO), attempt(scope, before.revision, goalPayload(3_000_000)));
  const after = await goalEnvelope();
  expect(after.revision).toBe(first.revision); // The write reached the goal and nothing else: the goal's own revision is the one the attempt reported, and the amount is the exact integer the caller stated.
  expect(after.data.goal?.amount).toEqual({ currency: "USD", minorUnits: 3_000_000 });
});
it("accepted, then replayed: answers accepted and replays through the content job, creating one edition", async () => {
  const revision = await documentRevision();
  const first = await acceptedThenReplayed((input) => mutations.updates.createVariant(session.sessionId, input), attempt(scope, revision, { documentId: UPDATE_DOCUMENT, locale: "de" }));
  expect([first.created?.length, expectEnvelope(await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: HERO }), "readVariantOverview").revision]).toEqual([1, first.revision]);
});
it("accepted, then replayed: answers accepted and replays through the audience job, opening one membership for the caller", async () => {
  // The identity a membership is keyed by is the caller's own principal. The address is a value on the membership and never the key: an equal-looking email address joins nothing to anything.
  const first = await acceptedThenReplayed((input) => mutations.audience.signupForPurpose(input, HERO), attempt(scope, NO_RECORD, { publisherId: PUBLISHER, purpose: "update-email", email: "worker@example.org" } as const));
  expect(first.created).toEqual([session.principalId]);
});
it("accepted, then replayed: answers accepted and replays through the development job, moving the scenario clock once", async () => {
  const revision = expectEnvelope(await reads.dev.readDevState(HERO), "readDevState").revision;
  const moved = await acceptedThenReplayed((input) => mutations.dev.setClock(input, HERO), attempt(scope, revision, { offsetIso: "2026-11-21T00:00:00Z" }));
  expect(moved.revision).not.toBe(revision);
  expect(expectEnvelope(await reads.dev.readDevState(HERO), "readDevState").revision).toBe(moved.revision);
});
it("accepted, then replayed: records the accepted attempt in the ledger, keyed by identity and intent", async () => {
  const revision = partnerRevision;
  const payload = { partnerId: PARTNER, tag: "ledger-probe", present: true };
  const input = attempt(scope, revision, payload);
  const first = expectOutcome(await mutations.partners.setTag(input, HERO), "accepted");
  // One identity with one intent hashes to one digest, and a changed payload hashes to another. That is how `changed-intent` is decided from a stored entry rather than guessed from a repeated id. The revision the
  const digest = intentHash("setTag", scope, payload); // attempt presented is the concurrency token and not part of the intent, so the digest is taken from what the attempt asks for, by which named mutation, in the scope it claims, and from nothing else.
  expect(intentHash("setTag", input.scope, input.payload)).toBe(digest);
  expect(intentHash("setTag", scope, { ...payload, tag: "another-probe" })).not.toBe(digest);
  const ledger: OperationLedger = emptyLedger(); // A ledger that never saw the attempt holds nothing under its identity, so the identity is fresh rather than a replay of something that was never accepted.
  expect(lookup(ledger, input.operationId)).toBeUndefined();
  expect(begin(ledger, input.operationId, digest).state).toBe("fresh");
  // The ledger's own three answers, stated directly: a recorded attempt is looked up by identity, and the same identity with another intent is a conflict rather than a second effect.
  const entry: OperationRecord = { operationId: input.operationId, intentHash: digest, scope, outcome: "accepted", result: { partnerId: PARTNER, tag: "ledger-probe" }, revision: first.revision, at: "2026-11-20T00:00:00Z" };
  const recorded = record(ledger, entry);
  expect([lookup(recorded, input.operationId), [begin(recorded, input.operationId, digest).state, begin(recorded, input.operationId, intentHash("setTag", scope, { ...payload, tag: "another-probe" })).state]]).toEqual([entry, ["replay", "changed-intent"]]);
});
it("conflict, both kinds: answers a stale revision with the current value and the caller's preserved input", async () => {
  const revision = partnerRevision;
  const first = expectOutcome(await mutations.partners.setTag(attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true }), HERO), "accepted");
  const submitted = { partnerId: PARTNER, tag: "newsletter", present: true };
  const stale = expectOutcome(await mutations.partners.setTag(attempt(scope, revision, submitted), HERO), "conflict");
  expect([stale.reason, stale.currentRevision]).toEqual(["stale-revision", first.revision]);
  expect(stale.current).toMatchObject({ partnerId: PARTNER, revision: first.revision });
  expect(stale.preservedInput).toEqual(submitted); // The caller's own payload comes back unchanged, field for field, so a surface can show what was typed beside what is stored and let someone decide: a conflict never silently replaces input.
  const after = await partnerEnvelope(PARTNER); // Nothing was written. The record still stands at the newer revision, and the tag the stale attempt asked for was never added.
  expect([after.revision, after.data.partner.tags.includes("follow-up"), after.data.partner.tags.includes("newsletter")]).toEqual([first.revision, true, false]);
});
it("conflict, both kinds: answers a reused identity carrying another intent as a conflict, not a second effect", async () => {
  const revision = partnerRevision;
  const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
  const first = expectOutcome(await mutations.partners.setTag(acceptedInput, HERO), "accepted");
  // One attempt identity means one attempt. The stored entry proves the id was used, so a different payload under it is a conflict rather than a second change.
  const reused = expectOutcome(await mutations.partners.setTag({ ...acceptedInput, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO), "conflict");
  expect([reused.reason, reused.operationId]).toEqual(["changed-intent", acceptedInput.operationId]);
  const after = await partnerEnvelope(PARTNER); // The record reflects the first write only: one tag, one revision, no second effect.
  expect([after.revision, after.data.partner.tags.filter((tag) => tag === "follow-up").length]).toEqual([first.revision, 1]);
  expect(after.data.partner.tags).not.toContain("newsletter");
});
it("conflict, both kinds: answers a reused identity that names another mutation of one path as a conflict, not a replay", async () => {
  // A transport strips the wire discriminant before the service sees the payload, so `completeTask` and `reopenTask` arrive as the same {taskId} and `pauseSeries` and `resumeSeries` as the same {seriesId}. Each attempt below presents one identity, one scope, one revision and one payload, and differs from its predecessor only in the mutation it names: the intent has to name the mutation, or the second call of a pair replays the first result instead of answering that the identity was reused.
  const created = expectOutcome(await mutations.work.createTask(attempt(scope, NO_RECORD, { title: "Cross-verb probe" }), HERO), "accepted");
  const taskId = required(created.created?.[0], "the task createTask created");
  const completing = attempt(scope, await listedRevisionOf(taskId), { taskId });
  expectOutcome(await mutations.work.completeTask(completing, HERO), "accepted");
  const reopening = expectOutcome(await mutations.work.reopenTask(completing, HERO), "conflict");
  expect([reopening.reason, reopening.operationId]).toEqual(["changed-intent", completing.operationId]);
  const heldTask = firstSaying(expectEnvelope(await reads.work.listTasks({ list: "all", displayTimeZone: "UTC", pageSize: 200 }, HERO), "listTasks").data.tasks, "taskId", taskId, `The task ${taskId} stands in no list, so the effect of the identity cannot be read back.`);
  expect(heldTask.status).toBe("completed"); // The completion is the only effect the identity produced: the reopen under it was refused, so nothing reopened the task.
  const seriesReading = async () => expectEnvelope(await reads.series.readSeries({ seriesId: OWNED_ACTIVE_SERIES }, HERO), `readSeries ${OWNED_ACTIVE_SERIES}`);
  const pausing = attempt(scope, (await seriesReading()).revision, { seriesId: OWNED_ACTIVE_SERIES });
  expectOutcome(await mutations.series.pauseSeries(pausing, HERO), "accepted");
  const resuming = expectOutcome(await mutations.series.resumeSeries(pausing, HERO), "conflict");
  expect([resuming.reason, resuming.operationId]).toEqual(["changed-intent", pausing.operationId]);
  expect((await seriesReading()).data.state).toBe("paused"); // The pause stands, because the resume that named another mutation under the same identity was refused rather than replayed.
});
it("conflict, both kinds: keeps the two conflict kinds distinguishable, so a caller knows whether to re-read or start again", async () => {
  const revision = partnerRevision;
  const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
  expectOutcome(await mutations.partners.setTag(acceptedInput, HERO), "accepted");
  const stale = expectOutcome(await mutations.partners.setTag(attempt(scope, revision, { partnerId: PARTNER, tag: "newsletter", present: true }), HERO), "conflict");
  const reused = expectOutcome(await mutations.partners.setTag({ ...acceptedInput, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO), "conflict");
  const reasons = [stale.reason, reused.reason];
  expect(reasons).toEqual(["stale-revision", "changed-intent"]);
  expect(reasons[0]).not.toBe(reasons[1]);
  expect(reasons.filter((reason) => !["stale-revision", "changed-intent"].includes(reason))).toEqual([]);
});
it("conflict, both kinds: recovers an accepted attempt retried with the newer revision, and still refuses another intent", async () => {
  const revision = partnerRevision;
  const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
  const first = expectOutcome(await mutations.partners.setTag(acceptedInput, HERO), "accepted");
  // A caller that lost the acknowledgement reads the record again — a read reports the revision the acceptance produced — and retries the same work under the same identity. That revision is the concurrency token rather
  const retried = expectOutcome(await mutations.partners.setTag({ ...acceptedInput, expectedRevision: first.revision }, HERO), "alreadyAccepted"); // than the intent, so the retry is the same attempt: the stored result comes back, and the recovery a lost caller needs stays reachable after the state has moved on.
  expect([retried.operationId, retried.revision]).toEqual([acceptedInput.operationId, first.revision]);
  expect(retried.result).toEqual(expectOutcome(await mutations.partners.setTag(acceptedInput, HERO), "alreadyAccepted").result);
  const after = await partnerEnvelope(PARTNER); // No second effect: the record stands at the revision the acceptance produced, with one tag.
  expect([after.revision, after.data.partner.tags.filter((tag) => tag === "follow-up").length]).toEqual([first.revision, 1]);
  const changed = expectOutcome(await mutations.partners.setTag({ ...acceptedInput, expectedRevision: first.revision, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO), "conflict"); // The same identity carrying another payload is still a changed intent, whatever revision it presents.
  expect(changed.reason).toBe("changed-intent");
  expect((await partnerEnvelope(PARTNER)).data.partner.tags).not.toContain("newsletter");
});
it("unchanged on a no-op: answers unchanged without advancing the revision or writing any activity", async () => {
  const envelope = await partnerEnvelope(PARTNER);
  const activityBefore = (await interactionEnvelope()).data.total;
  const held = required(envelope.data.partner.tags.at(0), "tag on the seeded partner");
  const noop = expectOutcome(await mutations.partners.setTag(attempt(scope, envelope.revision, { partnerId: PARTNER, tag: held, present: true }), HERO), "unchanged");
  expect(noop.revision).toBe(envelope.revision);
  // No revision advanced and no history or activity entry appeared: a no-op writes nothing at all. And there is nothing to report, because nothing happened.
  expect([(await partnerEnvelope(PARTNER)).revision, (await interactionEnvelope()).data.total, "result" in noop, "created" in noop]).toEqual([envelope.revision, activityBefore, false, false]);
});
it("unchanged on a no-op: distinguishes unchanged from accepted and from alreadyAccepted", () => {
  const operationId = newOperationId();
  const noop = unchanged({ operationId, revision: "rev-1" });
  for (const expected of [accepted({ operationId, revision: "rev-1" }).outcome, alreadyAccepted({ operationId, revision: "rev-1", result: null }).outcome]) expect(noop.outcome).not.toBe(expected);
  expect(OUTCOME_NAMES).toContain(noop.outcome);
  expect(isOutcome(noop)).toBe(true);
});
type InvalidCase = { readonly label: string; readonly field: string; readonly run: (scope: Scope, operationId: string) => Promise<MutationOutcome>; readonly snapshot: () => Promise<unknown> };
async function goalSnapshot(): Promise<unknown> {
  const envelope = await goalEnvelope();
  return { revision: envelope.revision, data: envelope.data };
}
const INVALID_CASES: readonly InvalidCase[] = [
  { label: "work.createTask with a blank title", field: "title", run: (scope, operationId) => mutations.work.createTask({ operationId, scope, expectedRevision: NO_RECORD, payload: { title: "   " } }, HERO), snapshot: taskTotal },
  { label: "work.createTask with a due date the calendar does not have", field: "dueOn", run: (scope, operationId) => mutations.work.createTask({ operationId, scope, expectedRevision: NO_RECORD, payload: { title: "Call", dueOn: "2026-02-30" } }, HERO), snapshot: taskTotal },
  { label: "support.saveGoal with a fractional minor-unit amount", field: "amount.minorUnits", run: (scope, operationId) => mutations.support.saveGoal({ operationId, scope, expectedRevision: NO_RECORD, payload: goalPayload(12.5) }, HERO), snapshot: goalSnapshot },
  { label: "import.proposeImport with no file named", field: "fileName", run: (scope, operationId) => mutations.import.proposeImport({ operationId, scope, expectedRevision: NO_RECORD, payload: { fileName: "", contentBase64: "" } }, HERO), snapshot: proposalSnapshot },
];
describe("invalid, keyed by field and free of side effects", () => {
  it.each(INVALID_CASES)("refuses $label and records nothing under the attempt's identity", async ({ run, field, snapshot }) => {
    const operationId = newOperationId();
    const before = await snapshot();
    const refused = expectOutcome(await run(scope, operationId), "invalid");
    expect(Object.keys(refused.fields)).toContain(field);
    for (const message of refused.fields[field] ?? []) expect(message.length).toBeGreaterThan(0);
    // Re-presenting the same identity with the same refused payload is refused again. Had the refused attempt been recorded, this call would answer `alreadyAccepted` and a rejected attempt would have been laundered into an
    const again = await run(scope, operationId); // acceptance that never happened. No partial write either: everything the mutation could have written stands bit-identically.
    expect([again.outcome, again.outcome === "alreadyAccepted", await snapshot()]).toEqual(["invalid", false, before]);
  });
  it("keeps invalid distinct from accepted and from denied", () => {
    const operationId = newOperationId();
    const refused = invalid({ operationId, fields: { title: ["Give this task a title."] } });
    expect(["accepted", "denied"]).not.toContain(refused.outcome);
    expect([Object.keys(refused.fields).length > 0, isOutcome(refused)]).toEqual([true, true]);
  });
});
// One convention for a name a job does not admit, and one bound on the identity a refusal echoes
/** The wording every path uses for a name the job it calls does not declare. */
const unadmittedKeyMessage = (name: string): string => `This request does not accept "${name}": every name it sends must be one the job declares, so remove it rather than having it silently ignored.`;
/** A strict payload under the shared envelope, so a surplus member can be refused at either depth. */
const STRICT_TASK_BODY = mutationInputSchema(z.strictObject({ title: z.string() }));
/** The two depths one fault class can arrive at: a member of the request envelope itself, and a member inside the payload the envelope carries. */
const SURPLUS_KEY_CASES = [
  { label: "a member of the request envelope", surplus: "comment", body: (complete: Record<string, unknown>): Record<string, unknown> => ({ ...complete, comment: "a field no mutation reads" }) },
  { label: "a member inside the payload", surplus: "audience", body: (complete: Record<string, unknown>): Record<string, unknown> => ({ ...complete, payload: { title: "A follow-up call", audience: "public" } }) },
] as const;
describe("a refusal names the field to fix, under a bounded attempt identity", () => {
  it.each(SURPLUS_KEY_CASES)("keys $label at its own path, never at the root of the body", async ({ body, surplus }) => {
    const refused = STRICT_TASK_BODY.safeParse(body(completeAttempt()));
    expect(refused.success).toBe(false);
    if (refused.success) throw new Error(`A request carrying "${surplus}" was accepted, so there is no refusal to read a field key from.`);
    const answered = toResponse(invalid({ operationId: newOperationId(), fields: refused.error }));
    expect(answered.status).toBe(422);
    const payload: unknown = await answered.json();
    expect(isOutcome(payload)).toBe(true);
    if (!isOutcome(payload) || payload.outcome !== "invalid") throw new Error(`A strict object's surplus member was answered as something other than the field-keyed refusal it is: ${JSON.stringify(payload)}`);
    // The name is the field a caller has to remove, and one wording serves the family: the same fault at a different depth must not read differently to the form that has to fix it.
    expect([Object.keys(payload.fields), Object.keys(payload.fields).includes(ROOT_FIELD_KEY), payload.fields[surplus]]).toEqual([[surplus], false, [unadmittedKeyMessage(surplus)]]);
  });
  it("echoes at most sixty-four characters of an operation id, on every outcome and over the wire", async () => {
    const claimed = "a".repeat(3_000); // An id a refusal carries is read off a body that failed validation, so it is the caller's own text rather than the canonical UUID an accepted attempt presents. Echoing it unbounded would let one request write a multi-kilobyte answer.
    for (const name of OPERATION_OUTCOME_NAMES) expect(OUTCOME_CONSTRUCTORS[name](claimed).operationId.length, `the operation id "${name}" echoes`).toBeLessThanOrEqual(64);
    const canonical = newOperationId(); // The bound is a refusal's, not a success's: the UUID an accepted attempt carries comes back whole.
    expect(OUTCOME_CONSTRUCTORS.accepted(canonical).operationId).toBe(canonical);
    const refusal = expectOutcome(outcomeFromError(claimed, new ZodError([{ code: "custom", path: ["title"], message: "Give this task a title." }])), "invalid");
    expect(refusal.operationId).toBe(claimed.slice(0, 64));
    const payload: unknown = await toResponse(refusal).json();
    expect(isOutcome(payload)).toBe(true);
    if (!isOutcome(payload)) throw new Error("The refusal answered over the wire is not one of the eight outcomes.");
    expect(payload.operationId).toBe(claimed.slice(0, 64));
  });
});
const interactionPayload = (date: string) => ({ partnerId: PARTNER, type: "call" as const, occurredOn: { precision: "date" as const, date }, outcome: "Caught up briefly", participants: [{ partnerId: PARTNER, role: "Person" }] });
/** Reads the interaction id off the stored result. */
function interactionIdOf(result: MutationResult): string {
  const fields: Readonly<Record<string, MutationResult>> = typeof result === "object" && result !== null && !Array.isArray(result) ? (result as Readonly<Record<string, MutationResult>>) : {};
  const id = fields["interactionId"];
  if (typeof id !== "string" || id.length === 0) throw new Error("The recovered result states no interaction id, so the effect it stands for cannot be found.");
  return id;
}
describe("denied", () => {
  it.each([
    { shown: "across the ministry boundary", reasonCode: "not-admitted" as const, claim: async () => scope },
    { shown: "in a scope the caller's own principal is not admitted to", reasonCode: "no-membership" as const, claim: async () => ({ ...scope, principalId: (await sessionOf(OTHER_WORKER)).principalId }) },
  ])("refuses a second worker's call $shown and discloses nothing about the record", async ({ reasonCode, claim }) => {
    const refused = expectOutcome(await mutations.partners.setTag(attempt(await claim(), NO_RECORD, { partnerId: PARTNER, tag: "not-yours", present: true }), OTHER_WORKER), "denied");
    expect([refused.reasonCode, DENIAL_REASONS.includes(reasonCode)]).toEqual([reasonCode, true]);
    // A denial states a reason code and nothing else: no identifier, count, title or size of the record it refused, which is what keeps a refusal from becoming an existence oracle.
    expect([Object.keys(refused).sort(), ["partnerId", "current", "title", "count", "size"].filter((member) => member in refused)]).toEqual([["operationId", "outcome", "reasonCode"], []]);
    expect((await partnerEnvelope(PARTNER)).data.partner.tags).not.toContain("not-yours"); // The record the refused attempt named is untouched.
  });
  it("answers an armed scope denial on a read with the same absence of any fact about the record", async () => {
    await armFailure("denied", "read", "readPartner");
    const refused = await reads.partners.readPartner(PARTNER, {}, HERO);
    expect([isReadResult(refused), refused.kind]).toEqual([true, "denied"]);
    if (refused.kind !== "denied") throw new Error(`An armed scope denial was answered "${refused.kind}" rather than as the denial it is.`);
    expect([refused.denied.outcome, DENIAL_REASONS.includes(refused.denied.reasonCode), Object.keys(refused.denied).sort(), "envelope" in refused]).toEqual(["denied", true, ["operationId", "outcome", "reasonCode"], false]);
    expect((await interactionEnvelope()).data.total).toBeGreaterThan(0); // The denial names one call, not a surface: the independent work on that surface stays usable.
  });
});
// A private record's author is the principal its own document names, never whoever addresses it
/** A session id this file owns, so a world whose stored author differs from its caller can be laid down without touching a seeded session. */
const DOCUMENT_AUTHOR_SESSION = "mutation-contract-document-author";
/** The new worker's private preparation record: its audience is private, so the author its document names decides who may change it. */
const PRIVATE_PREPARATION = "partner-nw-ada-quinn";
/** The seeded new worker, the identity that private record belongs to. */
const NEW_WORKER: SessionSource = { sessionId: "new-worker" };
/** Lays the seeded new-worker world down under this file's own session id, with the state document's own principal set to the identity the case names, and answers the scope that session acts in. */
async function layDownPrivatePreparationWorld(storedAuthorPrincipalId: PrincipalId): Promise<Scope> {
  const documents = await seededDocuments(NEW_WORKER.sessionId);
  await resetSession(DOCUMENT_AUTHOR_SESSION, { ...documents, state: { ...documents.state, context: { ...documents.state.context, sessionId: DOCUMENT_AUTHOR_SESSION, principalId: storedAuthorPrincipalId } } });
  return scopeOf({ sessionId: DOCUMENT_AUTHOR_SESSION });
}
/** The private preparation row as the store holds it: the read path refuses it to a principal that did not author it, so the store's own document is where its revision and its tags are stated. */
const privatePreparationRow = async () => firstSaying((await storedStateOf(DOCUMENT_AUTHOR_SESSION)).partners, "partnerId", PRIVATE_PREPARATION, `The state under ${DOCUMENT_AUTHOR_SESSION} holds no ${PRIVATE_PREPARATION} record, so there is no private record to address`);
describe("the author of a private record", () => {
  afterAll(async () => {
    await resetSession(DOCUMENT_AUTHOR_SESSION); // This file's own session only: the seeded worlds are left exactly as the seed wrote them.
  });
  it.each([
    { label: "the principal the record's own document names", authoredByCaller: true, expected: "accepted" as const, refusal: null, written: true },
    { label: "another principal", authoredByCaller: false, expected: "denied" as const, refusal: "no-permission", written: false },
  ])("answers $expected to a change from $label", async ({ authoredByCaller, expected, refusal, written }) => {
    const newWorker = await sessionOf(NEW_WORKER);
    const callerScope = await layDownPrivatePreparationWorld(authoredByCaller ? newWorker.principalId : session.principalId);
    const before = await privatePreparationRow();
    const tag = "contract-private-author";
    const outcome = await mutations.partners.setTag(attempt(callerScope, before.revision, { partnerId: PRIVATE_PREPARATION, tag, present: true }), { sessionId: DOCUMENT_AUTHOR_SESSION });
    const after = await privatePreparationRow();
    // The two rows differ only in the principal the stored document names, so the answer follows from the record's own author rather than from the caller's identity: an author check the caller satisfies by construction answers both rows alike, which is the defect this case pins. A refusal also writes nothing, so the claimed tag never reaches a record the caller did not author.
    expect([outcome.outcome, "reasonCode" in outcome ? outcome.reasonCode : null, after.tags.includes(tag), after.revision === before.revision]).toEqual([expected, refusal, written, !written]);
  });
});
it("unknown and unavailable: answers a lost acknowledgement with the identity, then recovers the stored result with exactly one effect", async () => {
  await armFailure("unknown", "mutation", "logInteraction");
  const before = (await interactionEnvelope()).data.total;
  const input = attempt(scope, NO_RECORD, interactionPayload("2026-11-19"));
  const lost = await mutations.interactions.logInteraction(input, HERO);
  expect([isOutcome(lost), lost.outcome]).toEqual([true, "unknown"]);
  if (lost.outcome !== "unknown") throw new Error(`A mutation whose acknowledgement was armed to be lost was answered "${lost.outcome}".`);
  expect(lost.operationId).toBe(input.operationId);
  // Only the identity travels: no success and no failure is claimed, so the surface can offer nothing but a check of this same operation.
  expect([Object.keys(lost).sort(), ["result" in lost, "revision" in lost]]).toEqual([
    ["operationId", "outcome"],
    [false, false],
  ]);
  expect(["accepted", "denied"]).not.toContain(lost.outcome);
  const recovered = expectOutcome(await mutations.interactions.logInteraction(input, HERO), "alreadyAccepted"); // Recovery is re-querying the same identity. A resend under a fresh key would be a second effect.
  expect(recovered.operationId).toBe(input.operationId);
  const recoveredId = interactionIdOf(recovered.result);
  const activity = await interactionEnvelope();
  expect([activity.data.total, activity.data.interactions.filter((row) => row.interactionId === recoveredId).length]).toEqual([before + 1, 1]);
  const again = expectOutcome(await mutations.interactions.logInteraction(input, HERO), "alreadyAccepted"); // A second recovery states the same stored bytes again, and adds nothing either.
  expect(again.result).toEqual(recovered.result);
  expect((await interactionEnvelope()).data.total).toBe(before + 1);
});
it("unknown and unavailable: maps a store fault to unavailable and an unrecognised failure to unknown under the same identity", () => {
  const operationId = newOperationId();
  const outage = expectOutcome(outcomeFromError(operationId, Object.assign(new Error("the document could not be decoded"), { name: "CorruptJsonError" })), "unavailable");
  expect([outage.source, outage.operationId, outage.guidance.length > 0]).toEqual([{ system: LOCAL_STORE_SYSTEM, reference: "CorruptJsonError" }, operationId, true]);
  expect(expectOutcome(outcomeFromError(operationId, Object.assign(new Error("permission denied"), { code: "EACCES" })), "unavailable").source).toEqual({ system: LOCAL_STORE_SYSTEM, reference: "EACCES" });
  const undecided = expectOutcome(outcomeFromError(operationId, new Error("something nobody anticipated")), "unknown"); // An unrecognised failure is neither a refusal nor a success: the effect may have happened, so the one honest answer carries the identity to re-query.
  expect(undecided.operationId).toBe(operationId);
  expect(Object.keys(expectOutcome(outcomeFromError(operationId, new ZodError([{ code: "custom", path: ["title"], message: "Give this task a title." }])), "invalid").fields)).toEqual(["title"]); // A schema failure caught at the boundary is the field-keyed refusal it is, never a bare throw.
});
it("unknown and unavailable: keeps an outage from reading as an empty result", () => {
  const outage = unavailable({ operationId: newOperationId(), source: { system: LOCAL_STORE_SYSTEM, reference: "unreadable-ledger" }, guidance: "Retry the same request with the same operation id." });
  expect(isOutcome(outage)).toBe(true);
  expect([isReadResult(outage), ["kind", "data", "envelope"].filter((member) => member in outage)]).toEqual([false, []]); // An envelope-shaped answer would let a surface render an outage as an empty list or a zero. The outage is its own answer, it names the source, and it carries no data member at all.
  expect(outage.source.system).toBe(LOCAL_STORE_SYSTEM);
});
const STATUS_BY_OUTCOME: Readonly<Record<OperationOutcomeName, number>> = {
  accepted: 200,
  alreadyAccepted: 200,
  unchanged: 200,
  conflict: 409,
  denied: 403, // A refused authority. A session that expired or could not be established answers 401 with the same body, which the cases below pin.
  invalid: 422,
  unavailable: 503,
  unknown: 202,
};
it("never a bare boolean: maps every one of the eight outcomes to its one response, so no handler re-implements the ladder", async () => {
  for (const name of OPERATION_OUTCOME_NAMES) {
    const response = toResponse(OUTCOME_CONSTRUCTORS[name]("response-probe"));
    expect(response.status, `the response for "${name}"`).toBe(STATUS_BY_OUTCOME[name]);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body: unknown = await response.json();
    expect(isOutcome(body)).toBe(true);
    if (!isOutcome(body)) throw new Error(`The body answered for "${name}" is not one of the eight outcomes.`);
    expect(body.outcome).toBe(name);
  }
  expect(() => toResponse({ outcome: "escalated" } as unknown as MutationOutcome)).toThrow("Unhandled mutation outcome"); // The mapping is total: a value outside the eight is refused rather than answered.
});
it("never a bare boolean: answers a read by its own ladder, with an envelope never cached and a refusal never an envelope", async () => {
  const envelopeResponse = toResponse({ kind: "envelope", envelope: { data: [] } });
  expect(envelopeResponse.status).toBe(200);
  expect([envelopeResponse.headers.get("cache-control"), toResponse({ kind: "denied", denied: denied({ operationId: newOperationId(), reasonCode: "no-permission" }) }).status]).toEqual(["no-store", 403]); // An envelope is scope-dependent private data whose staleness would break whole-query agreement.
  expect(toResponse({ kind: "unavailable", unavailable: unavailable({ operationId: newOperationId(), source: { system: LOCAL_STORE_SYSTEM, reference: "read" }, guidance: "Retry." }) }).status).toBe(503);
});
it("never a bare boolean: answers a session fault with 401 and a refused authority with 403, from the one redacted denial", async () => {
  // The status separates a session that expired or could not be established from a permission refusal; the body does not, because both are the one redacted `denied` outcome the closed set defines. A client that reads the
  expect(toResponse(denied({ operationId: "response-probe", reasonCode: "no-permission" })).status).toBe(403); // reason code is unaffected, and one that reads the status can tell a stale session from a permission the caller never held.
  for (const reasonCode of ["session-expired", "session-unavailable"] as const) {
    const response = toResponse(denied({ operationId: "response-probe", reasonCode }));
    expect(response.status, `the response for "${reasonCode}"`).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body: unknown = await response.json();
    expect(body).toEqual({ outcome: "denied", operationId: "response-probe", reasonCode });
  }
  // Redaction belongs to the mapper rather than to the status: a denial built by hand still loses its existence and size evidence on a 401 exactly as it does on a 403.
  const handBuilt = { outcome: "denied", operationId: "response-probe", reasonCode: "session-expired", exists: true, count: 3 } as unknown as MutationOutcome;
  const handBuiltResponse = toResponse(handBuilt);
  expect(handBuiltResponse.status).toBe(401);
  expect(await handBuiltResponse.json()).toEqual({ outcome: "denied", operationId: "response-probe", reasonCode: "session-expired", exists: REDACTED, count: REDACTED });
  expect(toResponse({ kind: "denied", denied: denied({ operationId: "read", reasonCode: "session-expired" }) }).status).toBe(401); // A read's refusal is the same answer, because one mapper decides the status of every refusal.
});
it("never a bare boolean: answers unknown with 202 and states the effect's fate in the body, which is the recorded decision", async () => {
  const response = toResponse(unknown({ operationId: "response-probe" }));
  expect(response.status).toBe(202);
  const body: unknown = await response.json();
  expect(body).toEqual({ outcome: "unknown", operationId: "response-probe" });
  // The status states that the exchange succeeded, never that the effect did: a 200 would claim an acceptance nobody observed, and a non-2xx would claim a failure the caller cannot support. The body is the authoritative statement, and `docs/architecture.md` records the choice.
  if (!isOutcome(body) || body.outcome !== "unknown") throw new Error("The 202 body did not state the unknown outcome, so the decision was left in the status.");
});
it("never a bare boolean: answers a read's refused request with the same field-keyed body a malformed mutation earns, at 422", async () => {
  const operationId = newOperationId(); // One expression writes both bodies, so a read whose own query is wrong is answered exactly as a malformed payload is: the caller is told which field to correct, and nothing claims a source failed.
  const refused = refusedRead(
    operationId,
    new ZodError([
      { code: "custom", path: ["payload", "page"], message: "State the page as a whole number from 1.", input: "abc" },
      { code: "custom", path: ["payload", "sort", "0"], message: "State the order as field:direction.", input: "name" },
    ]),
  );
  expect(refused.kind).toBe("refused");
  const response = toResponse(refused);
  expect([response.status, response.headers.get("content-type")]).toEqual([422, "application/json; charset=utf-8"]);
  const body: unknown = await response.json();
  // The keys are payload-relative: the envelope path every mutation carries is re-based away, so a read and a mutation naming the same fault name it at the same key.
  expect(body).toEqual({ outcome: "invalid", operationId, fields: { page: ["State the page as a whole number from 1."], "sort.0": ["State the order as field:direction."] } });
  for (const expected of ["source", "reasonCode"]) expect(body).not.toHaveProperty(expected); // It is neither of the two answers a read could be mistaken for: no source is named, and no reason code.
});
it("never a bare boolean: accepts a read's refused request as a read result and refuses a member that is not one", () => {
  // The arm is admitted only when it carries the one outcome a read's own refusal is: a body claiming it around an acceptance, a denial or an outage is not a refused request, and reading it as one would let a client that cannot place a fault state it as the caller's own.
  const refused = refusedRead("response-probe", { page: ["State the page as a whole number from 1."] });
  expect([isReadResult(refused), isOutcome(refused), isReadResult({ kind: "refused" }), isReadResult({ kind: "refused", refused: { outcome: "accepted", operationId: "response-probe", revision: "rev-1" } })]).toEqual([true, false, false, false]);
  expect([isReadResult({ kind: "refused", refused: { outcome: "denied", operationId: "response-probe", reasonCode: "no-permission" } }), isReadResult({ kind: "refused", refused: { outcome: "invalid", operationId: "response-probe", fields: { page: ["Correct this."] } } })]).toEqual([false, true]);
});
it("never a bare boolean: narrows a call by its predicate, never by the truthiness of its answer", async () => {
  const mutationResult = await mutations.work.createTask(attempt(scope, NO_RECORD, { title: "A predicate probe" }), HERO);
  expect([isOutcome(mutationResult), isReadResult(mutationResult)]).toEqual([true, false]);
  const readResult = await reads.partners.readPartner(PARTNER, {}, HERO);
  expect([isReadResult(readResult), isOutcome(readResult)]).toEqual([true, false]);
});

// The authority a grant- or owner-authorised attempt is admitted under comes from the caller's own memberships, and the entry it records states that admission rather than the request's claim
/** A reader holding no admitted membership of any ministry: one of the seats the owner authority exists for. */
const SUBSCRIBER: SessionSource = { sessionId: "subscriber" };
/** The operation ledger a session's own documents hold. */
const ledgerOf = async (sessionId: string): Promise<OperationLedger> => readLedger(required((await readSession(sessionId))?.operations, `The store holds no operations document under "${sessionId}", so no case here can read what the attempt recorded`));
it("the scope an attempt is admitted under: holds an owner-authority claim to the caller's own memberships, and records no entry when it refuses", async () => {
  const elsewhere = required((await sessionOf(OTHER_WORKER)).selected, `The session "${OTHER_WORKER.sessionId}" has selected no context, so no case here can name a context the established worker holds no membership of`);
  const claim: Scope = { ...elsewhere, principalId: session.principalId };
  const before = (await storedStateOf(HERO.sessionId)).memberships;
  const input = attempt(claim, NO_RECORD, { publisherId: PUBLISHER, purpose: "update-email", email: "worker@example.org" } as const);
  const refused = expectOutcome(await mutations.audience.signupForPurpose(input, HERO), "denied"); // The claim names the second worker's ministry under the worker's own principal, and an owner-authority mutation is not a way around the membership every other write of the same worker is held to.
  expect(refused.reasonCode).toBe("no-membership");
  const again = await mutations.audience.signupForPurpose(input, HERO);
  // The same identity presented again is refused on its authority rather than answered from an entry an acceptance would have left behind, which is how the refusal is shown to have recorded nothing.
  expect([isOutcome(again), again.outcome, "reasonCode" in again ? again.reasonCode : null]).toEqual([true, "denied", "no-membership"]);
  expect((await storedStateOf(HERO.sessionId)).memberships).toEqual(before); // And no row appeared in the context the caller does not hold.
});
it("the scope an attempt is admitted under: records the scope a membership-less seat's own change was admitted under", async () => {
  const reader = await sessionOf(SUBSCRIBER);
  const row = firstSaying((await storedStateOf(SUBSCRIBER.sessionId)).memberships, "membershipId", reader.principalId, `The seeded "${SUBSCRIBER.sessionId}" session holds no membership keyed by its own principal, so no case here has the reader's own record to change`);
  // A reader selects no context of its own: the scope its record sits in carries the publisher world's three references and the reader's own principal, the only authority an owner-authorised change is held to.
  const claim: Scope = { organizationId: scope.organizationId, ministryId: scope.ministryId, supportSubjectId: scope.supportSubjectId, principalId: reader.principalId };
  const input = attempt(claim, row.revision, { membershipId: reader.principalId, choice: "immediate", languagePreference: "cy" } as const);
  expect(expectOutcome(await mutations.audience.setPreference(input, SUBSCRIBER), "accepted").revision).not.toBe(row.revision);
  const entry = required(lookup(await ledgerOf(SUBSCRIBER.sessionId), input.operationId), `The ledger holds no entry under ${input.operationId}, so the accepted change recorded nothing`);
  // The membership-less seat is admitted under its own principal, and the entry states exactly the scope that admission established: its own record, in the publisher world, under its own identity. A caller holding no membership is admitted all the same, which is what keeps the owner authority doing its job.
  expect([entry.outcome, entry.scope]).toEqual(["accepted", claim]);
});
