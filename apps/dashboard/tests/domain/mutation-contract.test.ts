/** The closed mutation contract, proven at the service boundary: the four fields every named mutation presents, the eight outcomes it may answer with, and the rejection paths that make that set … */
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { newOperationId } from "@/lib/ids";
import { REDACTED } from "@/lib/redaction";
import { mutations, reads, toResponse, type MutationInput, type Scope } from "@/modules/data-service";
import { OPERATION_OUTCOME_NAMES, mutationInputSchema, type OperationOutcomeName, type OperationRecord } from "@/modules/data-service/envelope";
import { DENIAL_REASONS, LOCAL_STORE_SYSTEM, ROOT_FIELD_KEY, accepted, alreadyAccepted, conflict, denied, invalid, isOutcome, isReadResult, outcomeFromError, refusedRead, unavailable, unchanged, unknown, type MutationOutcome, type MutationResult, type ReadResult } from "@/modules/data-service/outcome";
import { begin, emptyLedger, intentHash, lookup, record, type OperationLedger } from "@/modules/data-service/operations";
import { resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { resetSeed } from "@/modules/dev-runtime/reset";
import type { FailureMode, FailureTargetKind } from "@/modules/dev-runtime/failures";
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
// The world
/** Lays the seeded world down before every case. */
beforeEach(async () => {
  await resetSeed();
});
/** Clears the armed failure after every case, whatever the case did with it. */
afterEach(async () => {
  const state = await reads.dev.readDevState(HERO);
  if (state.kind !== "envelope" || !state.envelope.data.failurePlan.armed) {
    return;
  }
  const disarmed = await mutations.dev.setFailurePlan(attempt(state.envelope.scope, state.envelope.revision, { plan: null }), HERO);
  // A plan left armed would answer a later case with an injected outcome, so a disarm that did not take
  // is a failure of the case that armed it rather than something to leave behind.
  if (disarmed.outcome !== "accepted") {
    throw new Error(`The armed failure was not cleared, so it would answer a later case: "${disarmed.outcome}".`);
  }
});
async function sessionOf(source: SessionSource): Promise<ResolvedSession> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) {
    throw new Error(`The seeded session ${source.sessionId} could not be resolved, so no case can act as it: ${JSON.stringify(resolution.refusal)}`);
  }
  return resolution.session;
}
async function scopeOf(source: SessionSource): Promise<Scope> {
  const session = await sessionOf(source);
  if (session.selected === null) {
    throw new Error(`The seeded session ${source.sessionId} has selected no context, so no attempt can name the scope it acts in.`);
  }
  return session.selected;
}
/** Builds the four-field input every named mutation presents, with a fresh attempt identity. */
function attempt<P>(scope: Scope, expectedRevision: string, payload: P): MutationInput<P> {
  return { operationId: newOperationId(), expectedRevision, payload, scope };
}
/** Narrows a read to its envelope, so a refusal fails the case by name instead of reading as empty data. */
function envelopeOf<E>(result: ReadResult<E>, label: string): E {
  expect(isReadResult(result)).toBe(true);
  if (result.kind !== "envelope") {
    throw new Error(`${label} answered "${result.kind}" instead of an envelope, so there is nothing to assert against.`);
  }
  return result.envelope;
}
async function partnerEnvelope(partnerId: string) {
  return envelopeOf(await reads.partners.readPartner(partnerId, {}, HERO), `readPartner ${partnerId}`);
}
async function interactionEnvelope() {
  return envelopeOf(await reads.interactions.readInteractions({ partnerId: PARTNER }, HERO), "readInteractions");
}
async function goalEnvelope() {
  return envelopeOf(await reads.support.readGoal({}, HERO), "readGoal");
}
async function taskTotal(): Promise<number> {
  return envelopeOf(await reads.work.listTasks({ list: "all", displayTimeZone: "UTC" }, HERO), "listTasks").data.total;
}
async function proposalSnapshot(): Promise<unknown> {
  const result = await reads.import.readImportProposal({ session: HERO });
  expect(isReadResult(result)).toBe(true);
  // A session that has never proposed a file answers `unavailable` rather than an empty proposal, and
  // that absence is itself the state a refused proposal must leave exactly as it found it.
  return result.kind === "envelope" ? { kind: result.kind, revision: result.envelope.revision, data: result.envelope.data } : { kind: result.kind };
}
/** Arms exactly one simulated failure for the hero session, the way the development panel does. */
async function armFailure(mode: FailureMode, kind: FailureTargetKind, name: string): Promise<void> {
  const scope = await scopeOf(HERO);
  const revision = envelopeOf(await reads.dev.readDevState(HERO), "readDevState").revision;
  const armed = await mutations.dev.setFailurePlan(attempt(scope, revision, { mode, target: { kind, name } }), HERO);
  expect(armed.outcome).toBe("accepted");
}
// The outcome shapes a case narrows to
type Accepted = Extract<MutationOutcome, { readonly outcome: "accepted" }>;
/** Drives one attempt to `accepted` and then replays it twice. */
async function acceptedThenReplayed<P>(run: (input: MutationInput<P>) => Promise<MutationOutcome>, input: MutationInput<P>): Promise<Accepted> {
  const first = await run(input);
  expect(isOutcome(first)).toBe(true);
  if (first.outcome !== "accepted") {
    throw new Error(`The first attempt was answered "${first.outcome}" rather than accepted, so there is no accepted result for a replay to recover.`);
  }
  const replay = await run(input);
  expect(isOutcome(replay)).toBe(true);
  expect(replay.outcome).toBe("alreadyAccepted");
  if (replay.outcome !== "alreadyAccepted") {
    throw new Error(`Replaying the accepted attempt was answered "${replay.outcome}": one identity with one intent is the stored result, or nothing.`);
  }
  expect(replay.revision).toBe(first.revision);
  expect(replay.created).toEqual(first.created);
  expect(replay.changed).toEqual(first.changed);
  expect(replay.items).toEqual(first.items);
  const again = await run(input);
  expect(again.outcome).toBe("alreadyAccepted");
  if (again.outcome !== "alreadyAccepted") {
    throw new Error(`A second replay was answered "${again.outcome}".`);
  }
  expect(again.result).toEqual(replay.result);
  return first;
}
// The named inventory, read as names rather than as 145 lines
interface NamedMember {
  readonly group: string;
  readonly name: string;
  readonly member: unknown;
}
function namedMembersOf(surface: typeof reads | typeof mutations): readonly NamedMember[] {
  return Object.entries(surface).flatMap(([group, members]) => Object.entries(members).map(([name, member]) => ({ group, name, member })));
}
function memberNamesOf(surface: typeof reads | typeof mutations): readonly string[] {
  return namedMembersOf(surface).map((entry) => entry.name);
}
/** Every name that appears more than once, sorted: the deliberate re-uses a two-family job shares. */
function duplicateNamesOf(names: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      repeated.add(name);
    }
    seen.add(name);
  }
  return [...repeated].sort();
}
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
describe("the named inventory", () => {
  it("names every read and mutation as a function", () => {
    for (const entry of namedMembersOf(reads)) {
      expect(typeof entry.member, `${entry.group}.${entry.name} is a named read`).toBe("function");
    }
    for (const entry of namedMembersOf(mutations)) {
      expect(typeof entry.member, `${entry.group}.${entry.name} is a named mutation`).toBe("function");
    }
  });

  it("repeats exactly the nine names two jobs share, and no other name", () => {
    // One preview authorisation and one listing read serve both content families, and the seven
    // variant, draft, review, publish and locale writes are the same bindings the Page job adds its
    // own writes to. A tenth repeated name would be a second meaning for an existing method.
    expect(duplicateNamesOf(memberNamesOf(reads))).toEqual(["findContentDocuments", "readPreview"]);
    expect(duplicateNamesOf(memberNamesOf(mutations))).toEqual(["approveCandidate", "createVariant", "publishVariants", "requestChanges", "saveDraft", "submitForReview", "withdrawLocale"]);
  });

  it("closes the outcome set at the eight names, each with a constructor of its own", () => {
    expect(OPERATION_OUTCOME_NAMES.length).toBe(8);
    expect([...OPERATION_OUTCOME_NAMES].sort()).toEqual([...OUTCOME_NAMES].sort());
    for (const name of OPERATION_OUTCOME_NAMES) {
      const build = OUTCOME_CONSTRUCTORS[name];
      expect(typeof build, `the outcome "${name}" has a constructor`).toBe("function");
      const outcome = build("outcome-probe");
      expect(outcome.outcome).toBe(name);
      expect(isOutcome(outcome)).toBe(true);
    }
  });
});

// The envelope, the payload, and the order between them
type GoalSavePayload = { readonly amount: { readonly currency: string; readonly minorUnits: number }; readonly measure: "received-gifts"; readonly effectiveFrom: string };
function goalPayload(minorUnits: number): GoalSavePayload {
  return { amount: { currency: "USD", minorUnits }, measure: "received-gifts", effectiveFrom: "2026-11-20" };
}
function importPayload(csv: string) {
  return { fileName: "contacts.csv", contentBase64: Buffer.from(csv, "utf8").toString("base64") };
}
/** The one shape guard every named mutation runs before it reads or writes anything. */
const ENVELOPE_SCHEMA = mutationInputSchema(z.unknown());
const ENVELOPE_MEMBERS = ["operationId", "scope", "expectedRevision", "payload"] as const;

function withoutMember(member: (typeof ENVELOPE_MEMBERS)[number], complete: MutationInput<GoalSavePayload>): MutationInput<GoalSavePayload> {
  const rest: Record<string, unknown> = { ...complete };
  delete rest[member];
  // A call that omits one of the four does not compile — `MutationInput<P>` requires every member — so
  // the compiler already refuses the omission. This cast models the other caller that reaches the same
  // boundary: a JavaScript client, or a posted JSON body that never saw the type.
  return rest as unknown as MutationInput<GoalSavePayload>;
}
describe("the four-field input", () => {
  it("accepts exactly the four fields and hands them on unchanged", async () => {
    const scope = await scopeOf(HERO);
    const input = attempt(scope, "rev-1", { title: "A follow-up call" });
    const parsed = ENVELOPE_SCHEMA.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("A complete four-field request was refused by the envelope guard.");
    }
    expect(parsed.data).toEqual(input);
    // Nothing else travels with it: a fifth member is a field no named mutation reads, so accepting it
    // would let a caller believe it had asked for something. The refusal names that member at the field
    // path it occupies, so a form can point at the input to remove rather than at the whole body.
    const extra = ENVELOPE_SCHEMA.safeParse({ ...input, comment: "a field no mutation reads" });
    expect(extra.success).toBe(false);
    if (extra.success) {
      throw new Error("A request carrying a field beyond the four was accepted.");
    }
    const surplus = invalid({ operationId: input.operationId, fields: extra.error }).fields;
    expect(Object.keys(surplus)).toEqual(["comment"]);
    expect(Object.keys(surplus)).not.toContain(ROOT_FIELD_KEY);
  });

  it.each(ENVELOPE_MEMBERS)("refuses a request that states no %s, keyed by the field path", async (member) => {
    const scope = await scopeOf(HERO);
    const complete: Record<string, unknown> = { ...attempt(scope, "rev-1", { title: "A follow-up call" }) };
    delete complete[member];
    const refused = ENVELOPE_SCHEMA.safeParse(complete);
    expect(refused.success).toBe(false);
    if (refused.success) {
      throw new Error(`A request stating no ${member} was accepted by the envelope guard.`);
    }
    const fields = invalid({ operationId: newOperationId(), fields: refused.error }).fields;
    expect(Object.keys(fields)).toEqual([member]);
    for (const message of fields[member] ?? []) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("refuses a malformed request before any record is read or written", async () => {
    const scope = await scopeOf(HERO);
    const before = await goalEnvelope();
    const complete = attempt(scope, before.revision, goalPayload(3_000_000));
    for (const member of ENVELOPE_MEMBERS) {
      const refused = await mutations.support.saveGoal(withoutMember(member, complete), HERO);
      expect(refused.outcome, `omitting ${member} is refused`).toBe("invalid");
      if (refused.outcome !== "invalid") {
        throw new Error(`A request stating no ${member} was answered "${refused.outcome}" rather than refused as invalid.`);
      }
      expect(Object.keys(refused.fields)).toContain(member);
    }
    // Validation precedes the change: the goal stands exactly as it was, revision and figures alike.
    const after = await goalEnvelope();
    expect(after.revision).toBe(before.revision);
    expect(after.data).toEqual(before.data);
  });
});

// Accepted, then replayed — one representative mutation from each job group
async function documentRevision(): Promise<string> {
  return envelopeOf(await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: HERO }), "readVariantOverview").revision;
}
// The bulk actions, and the seeded rows they act on
/** An open task of the worker's own, so a bulk action may change it. */
const OWNED_OPEN_TASK = "task-care-jo";
/** The worker's other open task, undated on purpose, so nothing about the first row's date decides it. */
const OWNED_UNDATED_TASK = "task-undated-prayer";
/** The worker's own task that is already complete, so completing it again must change nothing. */
const COMPLETED_TASK = "task-completed-intro";
/** An open task in the second worker's ministry, which the selected worker may not change. */
const FOREIGN_TASK = "task-river-invite-owen";
/** The private tag these cases apply. The seed sets no task tags at all, so the first attempt writes it. */
const BULK_TAG = "contract-bulk";
/** One row of a bulk action's answer, as the stored result carries it. */
const BULK_ROW_SCHEMA = z.object({ taskId: z.string(), state: z.enum(["accepted", "unchanged", "excluded", "failed"]), revision: z.string().nullable(), createdTaskId: z.string().nullable(), reasonCode: z.string().nullable(), reason: z.string().nullable() });
/** A bulk action's own answer: one row per selected task, the counts derived from those rows, and the tasks created. */
const BULK_ANSWER_SCHEMA = z.object({ items: z.array(BULK_ROW_SCHEMA), acceptedCount: z.number().int(), unchangedCount: z.number().int(), excludedCount: z.number().int(), failedCount: z.number().int(), createdTaskIds: z.array(z.string()) });
type BulkAnswer = z.infer<typeof BULK_ANSWER_SCHEMA>;
/** The answer a caller recovers after losing the acknowledgement: re-querying the accepted identity returns the stored result, which is where the per-item rows live — each row's state, the task it … */
async function recoveredBulkAnswer<P>(run: (input: MutationInput<P>) => Promise<MutationOutcome>, input: MutationInput<P>): Promise<BulkAnswer> {
  const recovered = await run(input);
  expect(recovered.outcome).toBe("alreadyAccepted");
  if (recovered.outcome !== "alreadyAccepted") {
    throw new Error(`Re-querying the accepted bulk attempt was answered "${recovered.outcome}", so no stored per-item answer can be read.`);
  }
  const parsed = BULK_ANSWER_SCHEMA.safeParse(recovered.result);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    throw new Error(`The stored bulk answer states no per-item rows with their counts: ${parsed.error.message}`);
  }
  return parsed.data;
}
/** One row of a bulk answer, by the task it answered for, so a missing row fails by name. */
function bulkRowOf(answer: BulkAnswer, taskId: string): BulkAnswer["items"][number] {
  const row = answer.items.find((entry) => entry.taskId === taskId);
  if (row === undefined) {
    throw new Error(`The bulk answer reported no row for ${taskId}, so it answered for the selection instead of per row.`);
  }
  return row;
}
/** The revision one task stands at as a list reports it, so a per-item row can be held to the record it names. */
async function listedRevisionOf(taskId: string): Promise<string> {
  const rows = envelopeOf(await reads.work.listTasks({ list: "all", displayTimeZone: "UTC", pageSize: 200 }, HERO), "listTasks").data.tasks;
  const row = rows.find((entry) => entry.taskId === taskId);
  if (row === undefined) {
    throw new Error(`The task ${taskId} stands in no list the worker reads, so no record stands behind that row.`);
  }
  return row.revision;
}
/** How much work the worker still owes: the upcoming list holds only tasks awaiting action. */
async function openTotal(): Promise<number> {
  return envelopeOf(await reads.work.listTasks({ list: "upcoming", displayTimeZone: "UTC" }, HERO), "listTasks").data.total;
}
describe("accepted, then replayed", () => {
  it("answers accepted and replays through the shell job, returning the seeded context", async () => {
    const session = await sessionOf(HERO);
    const current = session.selected;
    if (current === null) {
      throw new Error("The seeded worker has selected no context, so there is no switch to make.");
    }
    const target = session.admittedMemberships.find((membership) => membership.ministryId !== current.ministryId);
    if (target === undefined) {
      throw new Error("The seeded worker is admitted to one ministry, so this case cannot switch context.");
    }
    const switchPayload = { organizationId: target.organizationId, ministryId: target.ministryId, supportSubjectId: target.supportSubjectId };
    // The revision a switch presents is the one the caller read before asking. A deliberately stale
    // token is answered with the conflict that states the current revision, which is the recovery the
    // shell offers — re-read, then decide — rather than a silent overwrite of someone else's selection.
    const stale = await mutations.context.selectContext(attempt(current, "rev-unread", switchPayload), HERO);
    expect(stale.outcome).toBe("conflict");
    if (stale.outcome !== "conflict") {
      throw new Error("A switch built on a revision the caller never read was not answered with a conflict.");
    }
    expect(stale.reason).toBe("stale-revision");
    const switched = await acceptedThenReplayed((input) => mutations.context.selectContext(input, HERO), attempt(current, stale.currentRevision, switchPayload));
    expect(switched.revision).not.toBe(stale.currentRevision);
    // The switch is exercised and then returned, so the seeded context still stands for every case after.
    const returned = await mutations.context.selectContext(attempt(current, switched.revision, { organizationId: current.organizationId, ministryId: current.ministryId, supportSubjectId: current.supportSubjectId }), HERO);
    expect(returned.outcome).toBe("accepted");
  });

  it("answers a voluntary stay as unchanged, keeping the revision and the selection in force", async () => {
    const session = await sessionOf(HERO);
    const current = session.selected;
    if (current === null) {
      throw new Error("The seeded worker has selected no context, so there is nothing to stay in.");
    }
    const target = session.admittedMemberships.find((membership) => membership.ministryId !== current.ministryId);
    if (target === undefined) {
      throw new Error("The seeded worker is admitted to one ministry, so this case cannot ask to switch away.");
    }
    const heldPayload = { organizationId: target.organizationId, ministryId: target.ministryId, supportSubjectId: target.supportSubjectId, resolveUnsavedWork: "stay" as const };
    // The context record's own revision, learned the way the shell learns it: an attempt on a revision
    // the caller never read is answered with the conflict that states the current one.
    const stale = await mutations.context.selectContext(attempt(current, "rev-unread", heldPayload), HERO);
    if (stale.outcome !== "conflict") {
      throw new Error(`A switch built on a revision the caller never read was answered "${stale.outcome}".`);
    }
    // Keeping the work is the caller's answer to the guard's question, not a stale revision: the attempt
    // presents the revision that stands, so no staleness is claimed, no conflict surface is returned and
    // nothing is applied.
    const stayed = await mutations.context.selectContext(attempt(current, stale.currentRevision, heldPayload), HERO);
    expect(stayed.outcome).toBe("unchanged");
    if (stayed.outcome !== "unchanged") {
      throw new Error(`A caller that chose to keep its work was answered "${stayed.outcome}" rather than unchanged.`);
    }
    expect(stayed.revision).toBe(stale.currentRevision);
    expect(Object.hasOwn(stayed, "reason")).toBe(false);
    // The question was answered, not the switch: the context still in force is the one the caller was
    // acting in, which a read states in its own scope.
    const after = envelopeOf(await reads.partners.findPartners({}, HERO), "the partner roster");
    expect(after.scope.ministryId).toBe(current.ministryId);
    expect(after.scope.supportSubjectId).toBe(current.supportSubjectId);
  });

  it("answers accepted and replays through the partners job, tagging the record once", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    await acceptedThenReplayed((input) => mutations.partners.setTag(input, HERO), attempt(scope, revision, { partnerId: PARTNER, tag: "contract-probe", present: true }));
    const tags = (await partnerEnvelope(PARTNER)).data.partner.tags;
    expect(tags.filter((tag) => tag === "contract-probe").length).toBe(1);
  });

  it("answers accepted and replays through the work job, creating one task", async () => {
    const scope = await scopeOf(HERO);
    const before = await taskTotal();
    await acceptedThenReplayed((input) => mutations.work.createTask(input, HERO), attempt(scope, NO_RECORD, { title: "Call about the autumn appeal" }));
    expect(await taskTotal()).toBe(before + 1);
  });

  it("answers accepted and replays through the work job's tag, reporting one row per selected task", async () => {
    const scope = await scopeOf(HERO);
    // One row the worker owns and one from the second worker's ministry, so the answer has to be per
    // item: a selection is not an authority, and the row that may not change is reported as excluded
    // rather than quietly skipped or folded into one aggregate "done".
    const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, FOREIGN_TASK], tag: BULK_TAG });
    await acceptedThenReplayed((value) => mutations.work.bulkApplyTag(value, HERO), input);
    const answer = await recoveredBulkAnswer((value) => mutations.work.bulkApplyTag(value, HERO), input);
    // One row per selected task, in the selection's own order, so nothing selected goes unanswered.
    expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, FOREIGN_TASK]);
    const tagged = bulkRowOf(answer, OWNED_OPEN_TASK);
    expect(tagged.state).toBe("accepted");
    // The row states the revision its task stands at and no reason code: nothing refused it.
    expect(tagged.revision).toBe(await listedRevisionOf(OWNED_OPEN_TASK));
    expect(tagged.reasonCode).toBeNull();
    const refusedRow = bulkRowOf(answer, FOREIGN_TASK);
    expect(refusedRow.state).toBe("excluded");
    expect(refusedRow.reasonCode).toBe("not-editable");
    // The excluded row states a reason and no revision: nothing of it was written, and nothing about it
    // is disclosed to a scope that may not read it.
    expect(refusedRow.reason).not.toBeNull();
    expect(refusedRow.revision).toBeNull();
    // The counts are derived from those rows rather than counted separately, and the selection tagged
    // exactly one task.
    expect([answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount]).toEqual([1, 0, 1, 0]);
    // Applying the same tag again under a fresh identity is no second effect: the action answers
    // `unchanged`, which it answers only when every selected row already carries the tag as the
    // caller's own — so the first attempt wrote the tag once and left it there.
    const reapplied = await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO);
    expect(reapplied.outcome).toBe("unchanged");
    // Beside a row that does not carry the tag yet, the tagged row is still reported per item as
    // unchanged with `already-tagged`: it is named, the reason is stated, and the only tag written is
    // the other row's.
    const mixedInput = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK], tag: BULK_TAG });
    expect((await mutations.work.bulkApplyTag(mixedInput, HERO)).outcome).toBe("accepted");
    const mixed = await recoveredBulkAnswer((value) => mutations.work.bulkApplyTag(value, HERO), mixedInput);
    const held = bulkRowOf(mixed, OWNED_OPEN_TASK);
    expect(held.state).toBe("unchanged");
    expect(held.reasonCode).toBe("already-tagged");
    expect(bulkRowOf(mixed, OWNED_UNDATED_TASK).state).toBe("accepted");
    expect([mixed.acceptedCount, mixed.unchangedCount]).toEqual([1, 1]);
  });

  it("answers accepted and replays through the work job's completion, finishing only the rows it can", async () => {
    const scope = await scopeOf(HERO);
    const openBefore = await openTotal();
    // Three rows in three states: the worker's open task, the worker's completed task, and the second
    // worker's task. Completing a selection must answer for each row, because completing a task proves
    // only that the task was completed — never a conversation, and never another ministry's work.
    const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, COMPLETED_TASK, FOREIGN_TASK] });
    const first = await acceptedThenReplayed((value) => mutations.work.bulkCompleteTasks(value, HERO), input);
    const answer = await recoveredBulkAnswer((value) => mutations.work.bulkCompleteTasks(value, HERO), input);
    expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, COMPLETED_TASK, FOREIGN_TASK]);
    const completed = bulkRowOf(answer, OWNED_OPEN_TASK);
    expect(completed.state).toBe("accepted");
    expect(completed.revision).toBe(await listedRevisionOf(OWNED_OPEN_TASK));
    // The completed task repeats no series, so no successor was minted: the row names no created task
    // and the answer reports none.
    expect(completed.createdTaskId).toBeNull();
    expect(first.created).toBeUndefined();
    const alreadyComplete = bulkRowOf(answer, COMPLETED_TASK);
    expect(alreadyComplete.state).toBe("unchanged");
    expect(alreadyComplete.reasonCode).toBe("already-complete");
    // An unchanged row states the revision it already stood at, which is the record nothing was written to.
    expect(alreadyComplete.revision).toBe(await listedRevisionOf(COMPLETED_TASK));
    const refusedRow = bulkRowOf(answer, FOREIGN_TASK);
    expect(refusedRow.state).toBe("excluded");
    expect(refusedRow.reasonCode).toBe("not-editable");
    expect(refusedRow.revision).toBeNull();
    expect([answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount]).toEqual([1, 1, 1, 0]);
    // Exactly one task left the work still owed, and the two replays behind this case left it there: a
    // completion that ran twice would have taken a second row out of the worker's list.
    expect(await openTotal()).toBe(openBefore - 1);
  });

  it("answers accepted and replays through the work job's follow-ups, creating one task per selected row", async () => {
    const scope = await scopeOf(HERO);
    const before = await taskTotal();
    // Two rows the worker owns, and one template: the action creates one ordinary follow-up task for
    // each selected row, not one task for the selection.
    const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK], template: { title: "Call after the visit" } });
    const first = await acceptedThenReplayed((value) => mutations.work.bulkCreateTasks(value, HERO), input);
    const answer = await recoveredBulkAnswer((value) => mutations.work.bulkCreateTasks(value, HERO), input);
    expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, OWNED_UNDATED_TASK]);
    for (const row of answer.items) {
      expect(row.state).toBe("accepted");
    }
    // Each row names the task it created, and two rows never name the same task.
    const created = answer.items.map((row) => row.createdTaskId);
    for (const createdTaskId of created) {
      expect(createdTaskId).not.toBeNull();
    }
    expect(new Set(created).size).toBe(2);
    expect(answer.createdTaskIds).toEqual(created);
    expect(first.created).toEqual(answer.createdTaskIds);
    expect(answer.acceptedCount).toBe(2);
    // Two tasks exist that did not before — and the two replays behind this case created no third, so
    // the total stands at exactly the count the first attempt produced.
    expect(await taskTotal()).toBe(before + 2);
  });

  it("answers accepted and replays through the work job's tag removal, reporting one row per selected task", async () => {
    const scope = await scopeOf(HERO);
    // The tag has to exist before it can be taken off, and the seed sets none: one attempt writes it.
    expect((await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO)).outcome).toBe("accepted");
    // Removing it from a row that carries it, from a row that does not, and from a row in another
    // ministry must answer for each: removed, absent and not editable are three different facts, and
    // only the first is a change.
    const input = attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK, OWNED_UNDATED_TASK, FOREIGN_TASK], tag: BULK_TAG });
    await acceptedThenReplayed((value) => mutations.work.bulkRemoveTag(value, HERO), input);
    const answer = await recoveredBulkAnswer((value) => mutations.work.bulkRemoveTag(value, HERO), input);
    expect(answer.items.map((row) => row.taskId)).toEqual([OWNED_OPEN_TASK, OWNED_UNDATED_TASK, FOREIGN_TASK]);
    const removed = bulkRowOf(answer, OWNED_OPEN_TASK);
    expect(removed.state).toBe("accepted");
    expect(removed.revision).toBe(await listedRevisionOf(OWNED_OPEN_TASK));
    const absent = bulkRowOf(answer, OWNED_UNDATED_TASK);
    expect(absent.state).toBe("unchanged");
    expect(absent.reasonCode).toBe("tag-absent");
    expect(bulkRowOf(answer, FOREIGN_TASK).reasonCode).toBe("not-editable");
    expect([answer.acceptedCount, answer.unchangedCount, answer.excludedCount, answer.failedCount]).toEqual([1, 1, 1, 0]);
    // The tag is gone from the row: applying it again is a fresh change rather than a no-op, which is
    // only true if the removal was written once.
    expect((await mutations.work.bulkApplyTag(attempt(scope, NO_RECORD, { taskIds: [OWNED_OPEN_TASK], tag: BULK_TAG }), HERO)).outcome).toBe("accepted");
  });

  it("answers accepted and replays through the import job, proposing the file once", async () => {
    const scope = await scopeOf(HERO);
    const first = await acceptedThenReplayed((input) => mutations.import.proposeImport(input, HERO), attempt(scope, NO_RECORD, importPayload("Name,Email\nAma Test,ama@example.org\n")));
    expect(first.created?.length).toBe(1);
  });

  it("answers accepted and replays through the outreach job, creating one initiative", async () => {
    const scope = await scopeOf(HERO);
    const first = await acceptedThenReplayed((input) => mutations.outreach.createInitiative(input, HERO), attempt(scope, NO_RECORD, { name: "Autumn reconnection", purpose: "Reconnect with supporters who have not been in touch since the spring appeal." }));
    expect(first.created?.length).toBe(1);
  });

  it("answers accepted and replays through the support job, setting the one permitted financial write", async () => {
    const scope = await scopeOf(HERO);
    const before = await goalEnvelope();
    const first = await acceptedThenReplayed((input) => mutations.support.saveGoal(input, HERO), attempt(scope, before.revision, goalPayload(3_000_000)));
    const after = await goalEnvelope();
    // The write reached the goal and nothing else: the goal's own revision is the one the attempt
    // reported, and the amount is the exact integer the caller stated.
    expect(after.revision).toBe(first.revision);
    expect(after.data.goal?.amount).toEqual({ currency: "USD", minorUnits: 3_000_000 });
  });

  it("answers accepted and replays through the content job, creating one edition", async () => {
    const scope = await scopeOf(HERO);
    const sessionId = (await sessionOf(HERO)).sessionId;
    const revision = await documentRevision();
    const first = await acceptedThenReplayed((input) => mutations.updates.createVariant(sessionId, input), attempt(scope, revision, { documentId: UPDATE_DOCUMENT, locale: "de" }));
    expect(first.created?.length).toBe(1);
    const overview = envelopeOf(await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: HERO }), "readVariantOverview");
    expect(overview.revision).toBe(first.revision);
  });

  it("answers accepted and replays through the audience job, opening one membership for the caller", async () => {
    const scope = await scopeOf(HERO);
    const session = await sessionOf(HERO);
    const first = await acceptedThenReplayed((input) => mutations.audience.signupForPurpose(input, HERO), attempt(scope, NO_RECORD, { publisherId: PUBLISHER, purpose: "update-email", email: "worker@example.org" } as const));
    // The identity a membership is keyed by is the caller's own principal. The address is a value on the
    // membership and never the key: an equal-looking email address joins nothing to anything.
    expect(first.created).toEqual([session.principalId]);
  });

  it("answers accepted and replays through the coaching job, setting one target", async () => {
    const scope = await scopeOf(HERO);
    const first = await acceptedThenReplayed((input) => mutations.coaching.saveTarget(input, HERO), attempt(scope, NO_RECORD, { measure: "calls-made", quantity: 4, privateLabel: "Calls this week" } as const));
    expect(first.created?.length).toBe(1);
  });

  it("answers accepted and replays through the development job, moving the scenario clock once", async () => {
    const scope = await scopeOf(HERO);
    const revision = envelopeOf(await reads.dev.readDevState(HERO), "readDevState").revision;
    const moved = await acceptedThenReplayed((input) => mutations.dev.setClock(input, HERO), attempt(scope, revision, { offsetIso: "2026-11-21T00:00:00Z" }));
    expect(moved.revision).not.toBe(revision);
    expect(envelopeOf(await reads.dev.readDevState(HERO), "readDevState").revision).toBe(moved.revision);
  });

  it("records the accepted attempt in the ledger, keyed by identity and intent", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    const payload = { partnerId: PARTNER, tag: "ledger-probe", present: true };
    const input = attempt(scope, revision, payload);
    const first = await mutations.partners.setTag(input, HERO);
    expect(first.outcome).toBe("accepted");
    if (first.outcome !== "accepted") {
      throw new Error("The tagging attempt this case records in the ledger was not accepted.");
    }
    // One identity with one intent hashes to one digest, and a changed payload hashes to another. That
    // is how `changed-intent` is decided from a stored entry rather than guessed from a repeated id. The
    // revision the attempt presented is the concurrency token and not part of the intent, so the digest
    // is taken from what the attempt asks for in the scope it claims, and from nothing else.
    const digest = intentHash(scope, payload);
    expect(intentHash(input.scope, input.payload)).toBe(digest);
    expect(intentHash(scope, { ...payload, tag: "another-probe" })).not.toBe(digest);
    // A ledger that never saw the attempt holds nothing under its identity, so the identity is fresh
    // rather than a replay of something that was never accepted.
    const ledger: OperationLedger = emptyLedger();
    expect(lookup(ledger, input.operationId)).toBeUndefined();
    expect(begin(ledger, input.operationId, digest).state).toBe("fresh");
    // The ledger's own three answers, stated directly: a recorded attempt is looked up by identity, and
    // the same identity with another intent is a conflict rather than a second effect.
    const entry: OperationRecord = { operationId: input.operationId, intentHash: digest, scope, outcome: "accepted", result: { partnerId: PARTNER, tag: "ledger-probe" }, revision: first.revision, at: "2026-11-20T00:00:00Z" };
    const recorded = record(ledger, entry);
    expect(lookup(recorded, input.operationId)).toEqual(entry);
    expect(begin(recorded, input.operationId, digest).state).toBe("replay");
    expect(begin(recorded, input.operationId, intentHash(scope, { ...payload, tag: "another-probe" })).state).toBe("changed-intent");
  });
});

describe("conflict, both kinds", () => {
  it("answers a stale revision with the current value and the caller's preserved input", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    const first = await mutations.partners.setTag(attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true }), HERO);
    expect(first.outcome).toBe("accepted");
    if (first.outcome !== "accepted") {
      throw new Error("The first tagging attempt was not accepted, so there is no newer revision to be stale against.");
    }
    const submitted = { partnerId: PARTNER, tag: "newsletter", present: true };
    const stale = await mutations.partners.setTag(attempt(scope, revision, submitted), HERO);
    expect(stale.outcome).toBe("conflict");
    if (stale.outcome !== "conflict") {
      throw new Error(`A write presenting the revision it read before another change replaced it was answered "${stale.outcome}".`);
    }
    expect(stale.reason).toBe("stale-revision");
    expect(stale.currentRevision).toBe(first.revision);
    expect(stale.current).toMatchObject({ partnerId: PARTNER, revision: first.revision });
    // The caller's own payload comes back unchanged, field for field, so a surface can show what was
    // typed beside what is stored and let someone decide: a conflict never silently replaces input.
    expect(stale.preservedInput).toEqual(submitted);
    // Nothing was written. The record still stands at the newer revision, and the tag the stale attempt
    // asked for was never added.
    const after = await partnerEnvelope(PARTNER);
    expect(after.revision).toBe(first.revision);
    expect(after.data.partner.tags).toContain("follow-up");
    expect(after.data.partner.tags).not.toContain("newsletter");
  });

  it("answers a reused identity carrying another intent as a conflict, not a second effect", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
    const first = await mutations.partners.setTag(acceptedInput, HERO);
    expect(first.outcome).toBe("accepted");
    if (first.outcome !== "accepted") {
      throw new Error("The attempt whose identity is reused here was not accepted.");
    }
    // One attempt identity means one attempt. The stored entry proves the id was used, so a different
    // payload under it is a conflict rather than a second change.
    const reused = await mutations.partners.setTag({ ...acceptedInput, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO);
    expect(reused.outcome).toBe("conflict");
    if (reused.outcome !== "conflict") {
      throw new Error(`A reused identity with a different payload was answered "${reused.outcome}" rather than conflicted.`);
    }
    expect(reused.reason).toBe("changed-intent");
    expect(reused.operationId).toBe(acceptedInput.operationId);
    // The record reflects the first write only: one tag, one revision, no second effect.
    const after = await partnerEnvelope(PARTNER);
    expect(after.revision).toBe(first.revision);
    expect(after.data.partner.tags.filter((tag) => tag === "follow-up").length).toBe(1);
    expect(after.data.partner.tags).not.toContain("newsletter");
  });

  it("keeps the two conflict kinds distinguishable, so a caller knows whether to re-read or start again", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
    const first = await mutations.partners.setTag(acceptedInput, HERO);
    if (first.outcome !== "accepted") {
      throw new Error("The attempt that makes this record newer was not accepted.");
    }
    const stale = await mutations.partners.setTag(attempt(scope, revision, { partnerId: PARTNER, tag: "newsletter", present: true }), HERO);
    const reused = await mutations.partners.setTag({ ...acceptedInput, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO);
    if (stale.outcome !== "conflict" || reused.outcome !== "conflict") {
      throw new Error("Both attempts this case compares were expected to conflict.");
    }
    const reasons = [stale.reason, reused.reason];
    expect(reasons).toEqual(["stale-revision", "changed-intent"]);
    expect(reasons[0]).not.toBe(reasons[1]);
    for (const reason of reasons) {
      expect(["stale-revision", "changed-intent"]).toContain(reason);
    }
  });

  it("recovers an accepted attempt retried with the newer revision, and still refuses another intent", async () => {
    const scope = await scopeOf(HERO);
    const revision = (await partnerEnvelope(PARTNER)).revision;
    const acceptedInput = attempt(scope, revision, { partnerId: PARTNER, tag: "follow-up", present: true });
    const first = await mutations.partners.setTag(acceptedInput, HERO);
    if (first.outcome !== "accepted") {
      throw new Error("The attempt whose recovery this case proves was not accepted.");
    }
    // A caller that lost the acknowledgement reads the record again — a read reports the revision the
    // acceptance produced — and retries the same work under the same identity. That revision is the
    // concurrency token rather than the intent, so the retry is the same attempt: the stored result comes
    // back, and the recovery a lost caller needs stays reachable after the state has moved on.
    const retried = await mutations.partners.setTag({ ...acceptedInput, expectedRevision: first.revision }, HERO);
    expect(retried.outcome).toBe("alreadyAccepted");
    if (retried.outcome !== "alreadyAccepted") {
      throw new Error(`The retry that re-read the record was answered "${retried.outcome}" rather than alreadyAccepted.`);
    }
    expect(retried.operationId).toBe(acceptedInput.operationId);
    expect(retried.revision).toBe(first.revision);
    const replayed = await mutations.partners.setTag(acceptedInput, HERO);
    if (replayed.outcome !== "alreadyAccepted") {
      throw new Error(`The identical replay was answered "${replayed.outcome}" rather than alreadyAccepted.`);
    }
    expect(retried.result).toEqual(replayed.result);
    // No second effect: the record stands at the revision the acceptance produced, with one tag.
    const after = await partnerEnvelope(PARTNER);
    expect(after.revision).toBe(first.revision);
    expect(after.data.partner.tags.filter((tag) => tag === "follow-up").length).toBe(1);
    // The same identity carrying another payload is still a changed intent, whatever revision it presents.
    const changed = await mutations.partners.setTag({ ...acceptedInput, expectedRevision: first.revision, payload: { partnerId: PARTNER, tag: "newsletter", present: true } }, HERO);
    expect(changed.outcome).toBe("conflict");
    if (changed.outcome !== "conflict") {
      throw new Error(`The same identity carrying another payload was answered "${changed.outcome}" rather than conflicted.`);
    }
    expect(changed.reason).toBe("changed-intent");
    expect((await partnerEnvelope(PARTNER)).data.partner.tags).not.toContain("newsletter");
  });
});

describe("unchanged on a no-op", () => {
  it("answers unchanged without advancing the revision or writing any activity", async () => {
    const scope = await scopeOf(HERO);
    const envelope = await partnerEnvelope(PARTNER);
    const activityBefore = (await interactionEnvelope()).data.total;
    const held = envelope.data.partner.tags[0];
    if (held === undefined) {
      throw new Error("The seeded partner carries no tag, so this case has no stored value to restate.");
    }
    const noop = await mutations.partners.setTag(attempt(scope, envelope.revision, { partnerId: PARTNER, tag: held, present: true }), HERO);
    expect(noop.outcome).toBe("unchanged");
    if (noop.outcome !== "unchanged") {
      throw new Error(`Restating the value already stored was answered "${noop.outcome}" rather than unchanged.`);
    }
    expect(noop.revision).toBe(envelope.revision);
    // No revision advanced and no history or activity entry appeared: a no-op writes nothing at all.
    expect((await partnerEnvelope(PARTNER)).revision).toBe(envelope.revision);
    expect((await interactionEnvelope()).data.total).toBe(activityBefore);
    // And there is nothing to report, because nothing happened.
    expect("result" in noop).toBe(false);
    expect("created" in noop).toBe(false);
  });

  it("distinguishes unchanged from accepted and from alreadyAccepted", () => {
    const operationId = newOperationId();
    const noop = unchanged({ operationId, revision: "rev-1" });
    expect(noop.outcome).not.toBe(accepted({ operationId, revision: "rev-1" }).outcome);
    expect(noop.outcome).not.toBe(alreadyAccepted({ operationId, revision: "rev-1", result: null }).outcome);
    expect(OUTCOME_NAMES).toContain(noop.outcome);
    expect(isOutcome(noop)).toBe(true);
  });
});

interface InvalidCase {
  readonly label: string;
  readonly field: string;
  readonly run: (scope: Scope, operationId: string) => Promise<MutationOutcome>;
  readonly snapshot: () => Promise<unknown>;
}
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
    const scope = await scopeOf(HERO);
    const operationId = newOperationId();
    const before = await snapshot();
    const refused = await run(scope, operationId);
    expect(refused.outcome).toBe("invalid");
    if (refused.outcome !== "invalid") {
      throw new Error(`A payload its own schema refuses was answered "${refused.outcome}".`);
    }
    expect(Object.keys(refused.fields)).toContain(field);
    for (const message of refused.fields[field] ?? []) {
      expect(message.length).toBeGreaterThan(0);
    }
    // Re-presenting the same identity with the same refused payload is refused again. Had the refused
    // attempt been recorded, this call would answer `alreadyAccepted` and a rejected attempt would have
    // been laundered into an acceptance that never happened.
    const again = await run(scope, operationId);
    expect(again.outcome).toBe("invalid");
    expect(again.outcome).not.toBe("alreadyAccepted");
    // No partial write: everything the mutation could have written stands bit-identically.
    expect(await snapshot()).toEqual(before);
  });

  it("keeps invalid distinct from accepted and from denied", () => {
    const operationId = newOperationId();
    const refused = invalid({ operationId, fields: { title: ["Give this task a title."] } });
    expect(refused.outcome).not.toBe(accepted({ operationId, revision: "rev-1" }).outcome);
    expect(refused.outcome).not.toBe(denied({ operationId, reasonCode: "no-permission" }).outcome);
    expect(Object.keys(refused.fields).length).toBeGreaterThan(0);
    expect(isOutcome(refused)).toBe(true);
  });
});

// One convention for a name a job does not admit, and one bound on the identity a refusal echoes
/** The wording every path uses for a name the job it calls does not declare. */
function unadmittedKeyMessage(name: string): string {
  return `This request does not accept "${name}": every name it sends must be one the job declares, so remove it rather than having it silently ignored.`;
}
/** A strict payload under the shared envelope, so a surplus member can be refused at either depth. */
const STRICT_TASK_BODY = mutationInputSchema(z.strictObject({ title: z.string() }));
/** The two depths one fault class can arrive at: a member of the request envelope itself, and a member inside the payload the envelope carries. */
const SURPLUS_KEY_CASES = [
  { label: "a member of the request envelope", surplus: "comment", body: (complete: Record<string, unknown>): Record<string, unknown> => ({ ...complete, comment: "a field no mutation reads" }) },
  { label: "a member inside the payload", surplus: "audience", body: (complete: Record<string, unknown>): Record<string, unknown> => ({ ...complete, payload: { title: "A follow-up call", audience: "public" } }) },
] as const;
describe("a refusal names the field to fix, under a bounded attempt identity", () => {
  it.each(SURPLUS_KEY_CASES)("keys $label at its own path, never at the root of the body", async ({ body, surplus }) => {
    const scope = await scopeOf(HERO);
    const complete: Record<string, unknown> = { ...attempt(scope, "rev-1", { title: "A follow-up call" }) };
    const refused = STRICT_TASK_BODY.safeParse(body(complete));
    expect(refused.success).toBe(false);
    if (refused.success) {
      throw new Error(`A request carrying "${surplus}" was accepted, so there is no refusal to read a field key from.`);
    }
    const answered = toResponse(invalid({ operationId: newOperationId(), fields: refused.error }));
    expect(answered.status).toBe(422);
    const payload: unknown = await answered.json();
    expect(isOutcome(payload)).toBe(true);
    if (!isOutcome(payload) || payload.outcome !== "invalid") {
      throw new Error(`A strict object's surplus member was answered as something other than the field-keyed refusal it is: ${JSON.stringify(payload)}`);
    }
    // The name is the field a caller has to remove, and one wording serves the family: the same fault
    // at a different depth must not read differently to the form that has to fix it.
    expect(Object.keys(payload.fields)).toEqual([surplus]);
    expect(Object.keys(payload.fields)).not.toContain(ROOT_FIELD_KEY);
    expect(payload.fields[surplus]).toEqual([unadmittedKeyMessage(surplus)]);
  });

  it("echoes at most sixty-four characters of an operation id, on every outcome and over the wire", async () => {
    // An id a refusal carries is read off a body that failed validation, so it is the caller's own text
    // rather than the canonical UUID an accepted attempt presents. Echoing it unbounded would let one
    // request write a multi-kilobyte answer.
    const claimed = "a".repeat(3_000);
    for (const name of OPERATION_OUTCOME_NAMES) {
      expect(OUTCOME_CONSTRUCTORS[name](claimed).operationId.length, `the operation id "${name}" echoes`).toBeLessThanOrEqual(64);
    }
    // The bound is a refusal's, not a success's: the UUID an accepted attempt carries comes back whole.
    const canonical = newOperationId();
    expect(OUTCOME_CONSTRUCTORS.accepted(canonical).operationId).toBe(canonical);
    const refusal = outcomeFromError(claimed, new ZodError([{ code: "custom", path: ["title"], message: "Give this task a title." }]));
    expect(refusal.outcome).toBe("invalid");
    if (refusal.outcome !== "invalid") {
      throw new Error(`A schema failure was answered "${refusal.outcome}" rather than refused as invalid.`);
    }
    expect(refusal.operationId).toBe(claimed.slice(0, 64));
    const answered = toResponse(refusal);
    const payload: unknown = await answered.json();
    expect(isOutcome(payload)).toBe(true);
    if (!isOutcome(payload)) {
      throw new Error("The refusal answered over the wire is not one of the eight outcomes.");
    }
    expect(payload.operationId).toBe(claimed.slice(0, 64));
  });
});

function interactionPayload(date: string) {
  return { partnerId: PARTNER, type: "call" as const, occurredOn: { precision: "date" as const, date }, outcome: "Caught up briefly", participants: [{ partnerId: PARTNER, role: "Person" }] };
}
/** Reads the interaction id off the stored result. */
function interactionIdOf(result: MutationResult): string {
  const shaped = typeof result === "object" && result !== null && !Array.isArray(result);
  const fields: Readonly<Record<string, MutationResult>> = shaped ? (result as Readonly<Record<string, MutationResult>>) : {};
  const id = fields["interactionId"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("The recovered result states no interaction id, so the effect it stands for cannot be found.");
  }
  return id;
}
describe("denied", () => {
  it("refuses a second worker's call across the ministry boundary and discloses nothing about the record", async () => {
    const foreignScope = await scopeOf(HERO);
    const refused = await mutations.partners.setTag(attempt(foreignScope, NO_RECORD, { partnerId: PARTNER, tag: "not-yours", present: true }), OTHER_WORKER);
    expect(isOutcome(refused)).toBe(true);
    expect(refused.outcome).toBe("denied");
    if (refused.outcome !== "denied") {
      throw new Error(`A second worker's call in another ministry's scope was answered "${refused.outcome}" rather than refused.`);
    }
    expect(refused.reasonCode).toBe("not-admitted");
    expect([...DENIAL_REASONS]).toContain(refused.reasonCode);
    // A denial states a reason code and nothing else: no identifier, count, title or size of the record
    // it refused, which is what keeps a refusal from becoming an existence oracle.
    expect(Object.keys(refused).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    expect("partnerId" in refused).toBe(false);
    expect("current" in refused).toBe(false);
    expect("title" in refused).toBe(false);
    expect("count" in refused).toBe(false);
    expect("size" in refused).toBe(false);
    // The record the refused attempt named is untouched.
    expect((await partnerEnvelope(PARTNER)).data.partner.tags).not.toContain("not-yours");
  });

  it("refuses a scope the caller's own principal is not admitted to, with the closed reason code", async () => {
    const heroScope = await scopeOf(HERO);
    const other = await sessionOf(OTHER_WORKER);
    const claimed = { ...heroScope, principalId: other.principalId };
    const refused = await mutations.partners.setTag(attempt(claimed, NO_RECORD, { partnerId: PARTNER, tag: "not-yours", present: true }), OTHER_WORKER);
    expect(refused.outcome).toBe("denied");
    if (refused.outcome !== "denied") {
      throw new Error(`A call in a ministry the caller is not admitted to was answered "${refused.outcome}".`);
    }
    expect(refused.reasonCode).toBe("no-membership");
    expect([...DENIAL_REASONS]).toContain(refused.reasonCode);
    expect(Object.keys(refused).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    expect((await partnerEnvelope(PARTNER)).data.partner.tags).not.toContain("not-yours");
  });

  it("answers an armed scope denial on a read with the same absence of any fact about the record", async () => {
    await armFailure("denied", "read", "readPartner");
    const refused = await reads.partners.readPartner(PARTNER, {}, HERO);
    expect(isReadResult(refused)).toBe(true);
    expect(refused.kind).toBe("denied");
    if (refused.kind !== "denied") {
      throw new Error(`An armed scope denial was answered "${refused.kind}" rather than as the denial it is.`);
    }
    expect(refused.denied.outcome).toBe("denied");
    expect([...DENIAL_REASONS]).toContain(refused.denied.reasonCode);
    expect(Object.keys(refused.denied).sort()).toEqual(["operationId", "outcome", "reasonCode"]);
    expect("envelope" in refused).toBe(false);
    // The denial names one call, not a surface: the independent work on that surface stays usable.
    expect((await interactionEnvelope()).data.total).toBeGreaterThan(0);
  });
});

describe("unknown and unavailable", () => {
  it("answers a lost acknowledgement with the identity, then recovers the stored result with exactly one effect", async () => {
    const scope = await scopeOf(HERO);
    await armFailure("unknown", "mutation", "logInteraction");
    const before = (await interactionEnvelope()).data.total;
    const input = attempt(scope, NO_RECORD, interactionPayload("2026-11-19"));
    const lost = await mutations.interactions.logInteraction(input, HERO);
    expect(isOutcome(lost)).toBe(true);
    expect(lost.outcome).toBe("unknown");
    if (lost.outcome !== "unknown") {
      throw new Error(`A mutation whose acknowledgement was armed to be lost was answered "${lost.outcome}".`);
    }
    expect(lost.operationId).toBe(input.operationId);
    // Only the identity travels: no success and no failure is claimed, so the surface can offer nothing
    // but a check of this same operation.
    expect(Object.keys(lost).sort()).toEqual(["operationId", "outcome"]);
    expect("result" in lost).toBe(false);
    expect("revision" in lost).toBe(false);
    expect(lost.outcome).not.toBe(accepted({ operationId: input.operationId, revision: "rev-1" }).outcome);
    expect(lost.outcome).not.toBe(denied({ operationId: input.operationId, reasonCode: "no-permission" }).outcome);
    // Recovery is re-querying the same identity. A resend under a fresh key would be a second effect.
    const recovered = await mutations.interactions.logInteraction(input, HERO);
    expect(recovered.outcome).toBe("alreadyAccepted");
    if (recovered.outcome !== "alreadyAccepted") {
      throw new Error(`Re-querying the lost operation was answered "${recovered.outcome}" rather than the stored result.`);
    }
    expect(recovered.operationId).toBe(input.operationId);
    const recoveredId = interactionIdOf(recovered.result);
    const activity = await interactionEnvelope();
    expect(activity.data.total).toBe(before + 1);
    expect(activity.data.interactions.filter((row) => row.interactionId === recoveredId).length).toBe(1);
    // A second recovery states the same stored bytes again, and adds nothing either.
    const again = await mutations.interactions.logInteraction(input, HERO);
    expect(again.outcome).toBe("alreadyAccepted");
    if (again.outcome !== "alreadyAccepted") {
      throw new Error(`A second re-query was answered "${again.outcome}".`);
    }
    expect(again.result).toEqual(recovered.result);
    expect((await interactionEnvelope()).data.total).toBe(before + 1);
  });

  it("maps a store fault to unavailable and an unrecognised failure to unknown under the same identity", () => {
    const operationId = newOperationId();
    const corrupt = Object.assign(new Error("the document could not be decoded"), { name: "CorruptJsonError" });
    const outage = outcomeFromError(operationId, corrupt);
    expect(outage.outcome).toBe("unavailable");
    if (outage.outcome !== "unavailable") {
      throw new Error("A corrupt store document was not reported as the outage it is.");
    }
    expect(outage.source).toEqual({ system: LOCAL_STORE_SYSTEM, reference: "CorruptJsonError" });
    expect(outage.operationId).toBe(operationId);
    expect(outage.guidance.length).toBeGreaterThan(0);
    const filesystem = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const inaccessible = outcomeFromError(operationId, filesystem);
    expect(inaccessible.outcome).toBe("unavailable");
    if (inaccessible.outcome !== "unavailable") {
      throw new Error("A filesystem fault was not reported as the outage it is.");
    }
    expect(inaccessible.source).toEqual({ system: LOCAL_STORE_SYSTEM, reference: "EACCES" });
    // An unrecognised failure is neither a refusal nor a success: the effect may have happened, so the
    // one honest answer carries the identity to re-query.
    const undecided = outcomeFromError(operationId, new Error("something nobody anticipated"));
    expect(undecided.outcome).toBe("unknown");
    if (undecided.outcome !== "unknown") {
      throw new Error("An unrecognised failure was presented as a decided outcome.");
    }
    expect(undecided.operationId).toBe(operationId);
    // A schema failure caught at the boundary is the field-keyed refusal it is, never a bare throw.
    const schemaFault = outcomeFromError(operationId, new ZodError([{ code: "custom", path: ["title"], message: "Give this task a title." }]));
    expect(schemaFault.outcome).toBe("invalid");
    if (schemaFault.outcome !== "invalid") {
      throw new Error("A schema failure was not reported as the refusal it is.");
    }
    expect(Object.keys(schemaFault.fields)).toEqual(["title"]);
  });

  it("keeps an outage from reading as an empty result", () => {
    const outage = unavailable({ operationId: newOperationId(), source: { system: LOCAL_STORE_SYSTEM, reference: "unreadable-ledger" }, guidance: "Retry the same request with the same operation id." });
    expect(isOutcome(outage)).toBe(true);
    // An envelope-shaped answer would let a surface render an outage as an empty list or a zero. The
    // outage is its own answer, it names the source, and it carries no data member at all.
    expect(isReadResult(outage)).toBe(false);
    expect("kind" in outage).toBe(false);
    expect("data" in outage).toBe(false);
    expect("envelope" in outage).toBe(false);
    expect(outage.source.system).toBe(LOCAL_STORE_SYSTEM);
  });
});

const STATUS_BY_OUTCOME: Readonly<Record<OperationOutcomeName, number>> = {
  accepted: 200,
  alreadyAccepted: 200,
  unchanged: 200,
  conflict: 409,
  // A refused authority. A session that expired or could not be established answers 401 with the same
  // body, which the cases below pin.
  denied: 403,
  invalid: 422,
  unavailable: 503,
  unknown: 202,
};
describe("never a bare boolean", () => {
  it("maps every one of the eight outcomes to its one response, so no handler re-implements the ladder", async () => {
    for (const name of OPERATION_OUTCOME_NAMES) {
      const response = toResponse(OUTCOME_CONSTRUCTORS[name]("response-probe"));
      expect(response.status, `the response for "${name}"`).toBe(STATUS_BY_OUTCOME[name]);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      const body: unknown = await response.json();
      expect(isOutcome(body)).toBe(true);
      if (!isOutcome(body)) {
        throw new Error(`The body answered for "${name}" is not one of the eight outcomes.`);
      }
      expect(body.outcome).toBe(name);
    }
    // The mapping is total: a value outside the eight is refused rather than answered.
    expect(() => toResponse({ outcome: "escalated" } as unknown as MutationOutcome)).toThrow("Unhandled mutation outcome");
  });

  it("answers a read by its own ladder, with an envelope never cached and a refusal never an envelope", async () => {
    const envelopeResponse = toResponse({ kind: "envelope", envelope: { data: [] } });
    expect(envelopeResponse.status).toBe(200);
    // An envelope is scope-dependent private data whose staleness would break whole-query agreement.
    expect(envelopeResponse.headers.get("cache-control")).toBe("no-store");
    const refusedResponse = toResponse({ kind: "denied", denied: denied({ operationId: newOperationId(), reasonCode: "no-permission" }) });
    expect(refusedResponse.status).toBe(403);
    const outageResponse = toResponse({ kind: "unavailable", unavailable: unavailable({ operationId: newOperationId(), source: { system: LOCAL_STORE_SYSTEM, reference: "read" }, guidance: "Retry." }) });
    expect(outageResponse.status).toBe(503);
  });

  it("answers a session fault with 401 and a refused authority with 403, from the one redacted denial", async () => {
    // The status separates a session that expired or could not be established from a permission refusal;
    // the body does not, because both are the one redacted `denied` outcome the closed set defines. A
    // client that reads the reason code is unaffected, and one that reads the status can tell a stale
    // session from a permission the caller never held.
    const permissionRefusal = toResponse(denied({ operationId: "response-probe", reasonCode: "no-permission" }));
    expect(permissionRefusal.status).toBe(403);
    for (const reasonCode of ["session-expired", "session-unavailable"] as const) {
      const response = toResponse(denied({ operationId: "response-probe", reasonCode }));
      expect(response.status, `the response for "${reasonCode}"`).toBe(401);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      const body: unknown = await response.json();
      expect(body).toEqual({ outcome: "denied", operationId: "response-probe", reasonCode });
    }
    // Redaction belongs to the mapper rather than to the status: a denial built by hand still loses its
    // existence and size evidence on a 401 exactly as it does on a 403.
    const handBuilt = { outcome: "denied", operationId: "response-probe", reasonCode: "session-expired", exists: true, count: 3 } as unknown as MutationOutcome;
    const handBuiltResponse = toResponse(handBuilt);
    expect(handBuiltResponse.status).toBe(401);
    expect(await handBuiltResponse.json()).toEqual({ outcome: "denied", operationId: "response-probe", reasonCode: "session-expired", exists: REDACTED, count: REDACTED });
    // A read's refusal is the same answer, because one mapper decides the status of every refusal.
    const readRefusal = toResponse({ kind: "denied", denied: denied({ operationId: "read", reasonCode: "session-expired" }) });
    expect(readRefusal.status).toBe(401);
  });

  it("answers unknown with 202 and states the effect's fate in the body, which is the recorded decision", async () => {
    const response = toResponse(unknown({ operationId: "response-probe" }));
    expect(response.status).toBe(202);
    const body: unknown = await response.json();
    expect(body).toEqual({ outcome: "unknown", operationId: "response-probe" });
    // The status states that the exchange succeeded, never that the effect did: a 200 would claim an
    // acceptance nobody observed, and a non-2xx would claim a failure the caller cannot support. The body
    // is the authoritative statement, and `docs/architecture.md` records the choice.
    if (!isOutcome(body) || body.outcome !== "unknown") {
      throw new Error("The 202 body did not state the unknown outcome, so the decision was left in the status.");
    }
  });

  it("answers a read's refused request with the same field-keyed body a malformed mutation earns, at 422", async () => {
    // One expression writes both bodies, so a read whose own query is wrong is answered exactly as a
    // malformed payload is: the caller is told which field to correct, and nothing claims a source failed.
    const operationId = newOperationId();
    const refused = refusedRead(
      operationId,
      new ZodError([
        { code: "custom", path: ["payload", "page"], message: "State the page as a whole number from 1.", input: "abc" },
        { code: "custom", path: ["payload", "sort", "0"], message: "State the order as field:direction.", input: "name" },
      ]),
    );
    expect(refused.kind).toBe("refused");
    const response = toResponse(refused);
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body: unknown = await response.json();
    // The keys are payload-relative: the envelope path every mutation carries is re-based away, so a read
    // and a mutation naming the same fault name it at the same key.
    expect(body).toEqual({ outcome: "invalid", operationId, fields: { page: ["State the page as a whole number from 1."], "sort.0": ["State the order as field:direction."] } });
    // It is neither of the two answers a read could be mistaken for: no source is named, and no reason code.
    expect(body).not.toHaveProperty("source");
    expect(body).not.toHaveProperty("reasonCode");
  });

  it("accepts a read's refused request as a read result and refuses a member that is not one", () => {
    // The arm is admitted only when it carries the one outcome a read's own refusal is: a body claiming it
    // around an acceptance, a denial or an outage is not a refused request, and reading it as one would let
    // a client that cannot place a fault state it as the caller's own.
    const refused = refusedRead("response-probe", { page: ["State the page as a whole number from 1."] });
    expect(isReadResult(refused)).toBe(true);
    expect(isOutcome(refused)).toBe(false);
    expect(isReadResult({ kind: "refused" })).toBe(false);
    expect(isReadResult({ kind: "refused", refused: { outcome: "accepted", operationId: "response-probe", revision: "rev-1" } })).toBe(false);
    expect(isReadResult({ kind: "refused", refused: { outcome: "denied", operationId: "response-probe", reasonCode: "no-permission" } })).toBe(false);
    expect(isReadResult({ kind: "refused", refused: { outcome: "invalid", operationId: "response-probe", fields: { page: ["Correct this."] } } })).toBe(true);
  });

  it("narrows a call by its predicate, never by the truthiness of its answer", async () => {
    const scope = await scopeOf(HERO);
    const mutationResult = await mutations.work.createTask(attempt(scope, NO_RECORD, { title: "A predicate probe" }), HERO);
    expect(isOutcome(mutationResult)).toBe(true);
    expect(isReadResult(mutationResult)).toBe(false);
    const readResult = await reads.partners.readPartner(PARTNER, {}, HERO);
    expect(isReadResult(readResult)).toBe(true);
    expect(isOutcome(readResult)).toBe(false);
  });
});
