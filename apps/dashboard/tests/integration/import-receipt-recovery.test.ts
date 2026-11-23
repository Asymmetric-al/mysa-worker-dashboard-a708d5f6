/** Contact import's durable recovery (success criterion 4; AAP 0.11.1's `import-receipt-recovery` row, 0.12.1's import criterion and 0.12.5's lost-acknowledgement arming on `acceptImportRows`). */
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "@/lib/guards";
import { newOperationId } from "@/lib/ids";
import { isOutcome, mutations, reads, type MutationOutcome, type ReadEnvelope, type ReadResult, type Scope } from "@/modules/data-service";
import { sessionOf } from "../helpers/fixtures";
import { LOCAL_STORE_SYSTEM } from "@/modules/data-service/outcome";
import { EMPTY_OPERATION_LEDGER, seed, seedWorkspace } from "@/modules/dev-runtime/seed";
import { IMPORT_ROW_RESULT_STATES, readStoredReceipt, type ImportReceipt } from "@/modules/import/receipt";
import type { SessionDocuments } from "@/modules/store/paths";
import { readSession, resetSession } from "@/modules/store/repository";
import { firstSaying, requiredSaying, throwing } from "../helpers/answers";
/** A single path segment, so the store accepts it, and unique to this file, so a sibling suite never shares it. */
const SESSION_ID = "it-import-receipt";
const SESSION = { sessionId: SESSION_ID };
const FIXTURE_NAME = "contacts-example.csv";
const FIXTURE_BYTES = new Uint8Array(readFileSync(new URL("../../public/fixtures/contacts-example.csv", import.meta.url)));
const FIXTURE_TEXT = new TextDecoder("utf-8", { fatal: true }).decode(FIXTURE_BYTES);
const FIXTURE_BASE64 = Buffer.from(FIXTURE_BYTES).toString("base64");
const CHANGED_ROW = "Imogen,Adeler,,,imogen.adeler@example.org,,,en,,,,";
const NO_REVISION_TO_COMPARE = "no-import-in-flight";
const CREATED_ROW = 1;
/** The row that shares an email address with a contact the worker already holds, so it can reuse that identity. */
const REUSED_ROW = 9;
const REUSED_CONTACT_NAME = "Ruth Okafor";
const CORRECTED_ROW = 12;
const CORRECTED_COLUMN = 5;
const CORRECTED_EMAIL = "nadia.rahman@example.org";
const SKIPPED_ROW = 13;
/** The worker's reason for leaving that row out, stated once so the recorded decision and the review agree. */
const SKIP_REASON = "The row supplies no name for the contact, so nothing would be created for it.";
/** A row the worker leaves undecided, which must be reported as still needing review rather than applied. */
const UNDECIDED_ROW = 16;
const FIXTURE_DATA_ROWS = 25;
const FIXTURE_COLUMNS = 12;
type ProposePayload = Parameters<typeof mutations.import.proposeImport>[0]["payload"];
type AcceptPayload = Parameters<typeof mutations.import.acceptImportRows>[0]["payload"];
const CONFIRMED_MAPPING: NonNullable<ProposePayload["confirmedMapping"]> = {
  columnCount: FIXTURE_COLUMNS,
  assignments: [
    { fieldId: "name-given", columnIndex: 1 },
    { fieldId: "name-family", columnIndex: 2 },
    { fieldId: "contact-email", columnIndex: 5 },
    { fieldId: "contact-phone", columnIndex: 6 },
    { fieldId: "contact-email", columnIndex: 7 },
    { fieldId: "source-reference", columnIndex: 9 },
    { fieldId: "restriction", columnIndex: 11 },
  ],
  fields: ["name-given", "name-family", "contact-email", "contact-phone", "source-reference", "restriction"],
  declined: [],
  unmapped: ["display-name", "name-organization", "contact-postal", "tag"],
  ignored: [
    { index: 3, header: "Household", occurrence: 1, reason: "excluded-topic", message: "A household is another record with its own identity, so no column here supplies one." },
    { index: 4, header: "Church or organization", occurrence: 1, reason: "unrecognised-header", message: "No contact field matches this header, so the column is left out of the mapping." },
    { index: 8, header: "Preferred language", occurrence: 1, reason: "unrecognised-header", message: "A language preference is not one of the contact fields this import supplies." },
    { index: 10, header: "Subscribed", occurrence: 1, reason: "consent-preserved-as-data", message: "A subscription statement is kept exactly as it arrived and never mapped: a subscription flag is not consent, and importing a contact never subscribes anyone." },
    { index: 12, header: "Notes", occurrence: 1, reason: "excluded-topic", message: "A note is a private preparation record rather than a contact field, so its values are not read." },
  ],
};
const envelopeOf = <T>(result: ReadResult<ReadEnvelope<T>>, what: string): ReadEnvelope<T> => (result.kind !== "envelope" ? throwing(`expected ${what}, but the read answered "${result.kind}": ${JSON.stringify(result)}`) : result.envelope);
function expectOutcome(outcome: MutationOutcome, name: MutationOutcome["outcome"]): void {
  expect(isOutcome(outcome)).toBe(true);
  if (outcome.outcome !== name) throw new Error(`expected the "${name}" outcome, but the service answered "${outcome.outcome}": ${JSON.stringify(outcome)}`);
}
let documents: SessionDocuments | undefined;
const seededDocuments = (): SessionDocuments => requiredSaying(documents, "the seeded documents are built in beforeAll, before any test establishes the session");
/** The selected context of the seeded session, resolved by the service's own resolver rather than assembled here. */
async function sessionScope(): Promise<Scope> {
  const resolved = await sessionOf(SESSION);
  if (resolved.selected === null) throw new Error(`the session ${JSON.stringify(SESSION_ID)} has selected no context, so no import could be reviewed in it`);
  return resolved.selected;
}
const storedDocuments = async (): Promise<SessionDocuments> => requiredSaying(await readSession(SESSION_ID), `the store holds no session ${JSON.stringify(SESSION_ID)}`);
interface LostAcceptance {
  readonly input: Parameters<typeof mutations.import.acceptImportRows>[0];
  readonly first: MutationOutcome;
  readonly replay: Extract<MutationOutcome, { outcome: "alreadyAccepted" }>;
  readonly retried: Extract<MutationOutcome, { outcome: "alreadyAccepted" }>;
  readonly receipt: ImportReceipt;
}
async function partnerTotal(): Promise<number> {
  const page = envelopeOf(await reads.partners.findPartners({ page: { index: 0, size: 200 } }, SESSION), "the partner roster").data;
  return page.total;
}
async function membershipRecords(): Promise<readonly unknown[]> {
  const state = (await storedDocuments()).state;
  if (!isRecord(state)) throw new Error("the session's state document is not an object, so its membership records cannot be compared");
  const memberships = state["memberships"];
  if (!Array.isArray(memberships)) throw new Error("the session's state document holds no membership collection, so an invented consent could not be detected");
  return memberships;
}
/** The existing contact the reused row shares an email address with, resolved through the roster rather than assumed. */
async function reusedIdentity(): Promise<{ system: string; reference: string }> {
  const page = envelopeOf(await reads.partners.findPartners({ search: "Ruth Okafor", page: { index: 0, size: 50 } }, SESSION), "the partner roster").data;
  const [row] = page.rows;
  if (row === undefined || page.total !== 1) throw new Error(`expected exactly one contact named ${JSON.stringify(REUSED_CONTACT_NAME)}, and the roster reported ${String(page.total)}`);
  return { system: LOCAL_STORE_SYSTEM, reference: row.partner.partnerId };
}
async function reviewedDecisions(): Promise<AcceptPayload["decisions"]> {
  return [
    { kind: "create", rowNumber: CREATED_ROW },
    { kind: "reuse", rowNumber: REUSED_ROW, candidate: await reusedIdentity() },
    { kind: "create", rowNumber: CORRECTED_ROW, corrections: [{ columnNumber: CORRECTED_COLUMN, value: CORRECTED_EMAIL }] },
    { kind: "skip", rowNumber: SKIPPED_ROW, reason: SKIP_REASON },
  ];
}
type ReviewedImport = { readonly scope: Scope; readonly importOperationId: string; readonly revision: string; readonly fileFingerprint: string; readonly recordedDecisions: AcceptPayload["decisions"] };
async function reviewTheFixtureFile(): Promise<ReviewedImport> {
  const scope = await sessionScope();
  const chosen = await mutations.import.proposeImport({ operationId: newOperationId(), scope, expectedRevision: NO_REVISION_TO_COMPARE, payload: { fileName: FIXTURE_NAME, contentBase64: FIXTURE_BASE64 } }, SESSION);
  expectOutcome(chosen, "accepted");
  const mapped = await mutations.import.proposeImport({ operationId: newOperationId(), scope, expectedRevision: NO_REVISION_TO_COMPARE, payload: { fileName: FIXTURE_NAME, contentBase64: FIXTURE_BASE64, confirmedMapping: CONFIRMED_MAPPING } }, SESSION);
  expectOutcome(mapped, "accepted");
  const proposal = envelopeOf(await reads.import.readImportProposal({ session: SESSION, pageSize: 200 }), "the import proposal in flight").data; // Step three: the worker records a decision about one row before the review is accepted, so the skip the acceptance reports comes from a decision the review actually holds.
  const skipped = await mutations.import.setRowDecision({ operationId: newOperationId(), scope, expectedRevision: proposal.revision, payload: { kind: "skip", rowNumber: SKIPPED_ROW, reason: SKIP_REASON } }, SESSION);
  expectOutcome(skipped, "accepted");
  const decided = envelopeOf(await reads.import.readImportProposal({ session: SESSION, pageSize: 200 }), "the import proposal after one decision").data;
  expect([decided.summary.skip, decided.summary.decisionsRecorded]).toEqual([1, 1]);
  return { scope, importOperationId: decided.importOperationId, revision: decided.revision, fileFingerprint: decided.fileFingerprint, recordedDecisions: decided.recordedDecisions };
}
async function armLostAcknowledgement(): Promise<void> {
  const state = envelopeOf(await reads.dev.readDevState(SESSION), "this session's development state");
  const armed = await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: state.scope, expectedRevision: state.revision, payload: { mode: "unknown", target: { kind: "mutation", name: "acceptImportRows" } } }, SESSION);
  expectOutcome(armed, "accepted");
}
/** Disarms whatever is armed, so one test's simulated failure never reaches the next one. */
async function clearFailurePlan(): Promise<void> {
  const state = await reads.dev.readDevState(SESSION);
  if (state.kind !== "envelope") return;
  const armed = state.envelope.data.failurePlan.armed;
  const cleared = await mutations.dev.setFailurePlan({ operationId: newOperationId(), scope: state.envelope.scope, expectedRevision: state.envelope.revision, payload: { plan: null } }, SESSION);
  expect(cleared.outcome).toBe(armed ? "accepted" : "unchanged");
}
async function ledgerEntriesFor(operationId: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const operations = (await storedDocuments()).operations;
  if (!isRecord(operations)) throw new Error("the session's operations document is not an object, so its ledger cannot be counted");
  const keyed: unknown[] = isRecord(operations["records"]) ? Object.values(operations["records"]) : [];
  const listed: unknown[] = Array.isArray(operations["entries"]) ? operations["entries"] : [];
  return [...keyed, ...listed].filter((entry): entry is Readonly<Record<string, unknown>> => isRecord(entry) && entry["operationId"] === operationId);
}
async function acceptUnderLostAcknowledgement(scope: Scope, revision: string, fileFingerprint: string): Promise<LostAcceptance> {
  const input = { operationId: newOperationId(), scope, expectedRevision: revision, payload: { acknowledged: true as const, fileFingerprint, decisions: await reviewedDecisions() } };
  await armLostAcknowledgement();
  const first = await mutations.import.acceptImportRows(input, SESSION);
  const replay = await mutations.import.acceptImportRows(input, SESSION);
  if (replay.outcome !== "alreadyAccepted") throw new Error(`replaying the acceptance answered "${replay.outcome}" instead of "alreadyAccepted": ${JSON.stringify(replay)}`);
  const stored = readStoredReceipt(replay.result, replay.operationId);
  if (stored.kind !== "found") throw new Error(`the replayed result is not the receipt the operation stored: ${JSON.stringify(stored)}`);
  // The recovery a worker actually performs after "check the result": that read reports the revision the acceptance produced, and the same work is retried under the same identity. The revision presented is the concurrency token rather than the intent, so the stored receipt comes back rather than a conflict.
  const retried = await mutations.import.acceptImportRows({ ...input, expectedRevision: replay.revision }, SESSION);
  if (retried.outcome !== "alreadyAccepted") throw new Error(`retrying the acceptance with the revision it reported answered "${retried.outcome}" instead of "alreadyAccepted": ${JSON.stringify(retried)}`);
  await clearFailurePlan(); // The simulated failure covers one attempt. Once the recovered result is in hand it is disarmed, so the rest of a test's journey runs against the application's own behaviour and inherits no injected outcome.
  return { input, first, replay, retried, receipt: stored.receipt };
}
describe("contact import: recovering an acceptance whose acknowledgement was lost", () => {
  beforeAll(async () => {
    // `setFailurePlan` is development-gated by `assertDevelopmentOnly`, which reads `NODE_ENV`. The gate is stated here rather than weakened: this file needs the development runtime's one simulated failure, so it runs in the environment that control exists in and `afterAll` restores what it found.
    vi.stubEnv("NODE_ENV", "development");
    const seeded = await seed();
    const template = firstSaying(seeded, "sessionId", "established-worker", "the seed lays down no established worker, so there is no session with contacts for an import to be reviewed in");
    documents = {
      state: seedWorkspace({ ...template, sessionId: SESSION_ID }), // The seed's own workspace builder, run for this file's session id, so the state document's context names the session that owns the records rather than another session's.
      operations: EMPTY_OPERATION_LEDGER, // No operation has been accepted in this session yet, so a replay of any identity is a first attempt.
      meta: template.documents.meta,
    };
  });
  beforeEach(async () => {
    await resetSession(SESSION_ID, seededDocuments()); // Each test establishes its own session, so a sibling suite's reset can never strand this one and no test inherits a record, a receipt or a plan from the test before it.
  });
  afterEach(async () => await clearFailurePlan());
  afterAll(async () => {
    await resetSession(SESSION_ID);
    vi.unstubAllEnvs(); // Whatever this file stubbed is undone here, so no suite running after it inherits the environment.
  });
  it("answers a lost acknowledgement with `unknown`, under the attempt's own identity", async () => {
    const { scope, revision, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    expect([isOutcome(acceptance.first), acceptance.first.outcome]).toEqual([true, "unknown"]);
    if (acceptance.first.outcome !== "unknown") throw new Error(`the acceptance answered "${acceptance.first.outcome}" instead of "unknown": ${JSON.stringify(acceptance.first)}`);
    expect(acceptance.first.operationId).toBe(acceptance.input.operationId);
    expect(Object.keys(acceptance.first).sort()).toEqual(["operationId", "outcome"]);
  });
  it("returns the stored receipt on a byte-identical replay, with exactly one ledger record", async () => {
    const { scope, revision, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    expect(acceptance.replay.operationId).toBe(acceptance.input.operationId);
    expect(acceptance.replay.result).toEqual(acceptance.receipt);
    const readBack = envelopeOf(await reads.import.readImportReceipt(acceptance.replay.operationId, { session: SESSION, pageSize: 200 }), "the acceptance's receipt").data;
    expect(readBack.importOperationId).toBe(acceptance.input.operationId);
    expect(readBack.counts).toEqual(acceptance.receipt.counts);
    expect(readBack.revision).toContain(acceptance.receipt.fingerprint.checksum);
    // The receipt publishes the file identity it was accepted under and the decisions it recorded, in the input shape a further acceptance posts back: a worker reads them from the receipt rather than guessing that some other identifier stands for the file.
    expect(readBack.fileFingerprint).toBe(acceptance.receipt.fingerprint.checksum);
    expect(readBack.recordedDecisions).toHaveLength(acceptance.input.payload.decisions.length);
    expect(readBack.recordedDecisions).toContainEqual({ kind: "create", rowNumber: CORRECTED_ROW, corrections: [{ columnNumber: CORRECTED_COLUMN, value: CORRECTED_EMAIL }] });
    expect(readBack.recordedDecisions).toContainEqual({ kind: "skip", rowNumber: SKIPPED_ROW, reason: SKIP_REASON });
    // The recovery retry presents the revision the acceptance reported, once the record has moved on. The revision is the concurrency token rather than the intent, so the retry is the same attempt: the same stored receipt, the same revision, and no second effect.
    expect([[acceptance.retried.operationId, acceptance.retried.revision], acceptance.retried.result]).toEqual([[acceptance.input.operationId, acceptance.replay.revision], acceptance.receipt]);
    const entries = await ledgerEntriesFor(acceptance.input.operationId); // One identity, one effect, one entry: the replay wrote nothing, so the ledger holds the attempt once.
    expect(entries).toHaveLength(1);
    expect([[entries[0]?.["outcome"], entries[0]?.["revision"]], entries[0]?.["result"]]).toEqual([["accepted", acceptance.replay.revision], acceptance.receipt]);
  });
  it("creates one private record per accepted row, and no duplicate when the attempt is replayed", async () => {
    const before = await partnerTotal();
    const reused = await reusedIdentity();
    const { scope, revision, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    const after = await partnerTotal();
    expect(after - before).toBe(3); // Three rows were accepted — one created, one corrected and one reused — so a second effect would show here.
    const accepted = acceptance.receipt.results.filter((result) => result.state === "accepted" || result.state === "already-accepted");
    expect(accepted.map((result) => result.rowNumber)).toEqual([CREATED_ROW, REUSED_ROW, CORRECTED_ROW]);
    const contacts = new Set<string>();
    for (const result of accepted) {
      if (result.route === null || result.route.kind !== "partner") throw new Error(`row ${String(result.rowNumber)} is ${result.state} without the contact it points at`);
      contacts.add(result.route.partnerRef.reference);
      const detail = envelopeOf(await reads.partners.readPartner(result.route.partnerRef.reference, {}, SESSION), `the record row ${String(result.rowNumber)} points at`).data;
      expect([detail.partner.kind, detail.partner.audience]).toEqual(["private-preparation", "private"]);
    }
    expect(contacts.size).toBe(3);
    const reusedResult = acceptance.receipt.results.find((result) => result.rowNumber === REUSED_ROW); // The reused row's private entry points at the contact it reuses rather than becoming a second copy of it.
    if (reusedResult?.route === null || reusedResult?.route === undefined || reusedResult.route.kind !== "partner") throw new Error(`row ${String(REUSED_ROW)} is ${String(reusedResult?.state)} without the contact it points at`);
    const reusedEntry = envelopeOf(await reads.partners.readPartner(reusedResult.route.partnerRef.reference, {}, SESSION), "the private entry the reused row created").data;
    expect(reusedEntry.partner.source).toEqual(reused);
    expect(reusedEntry.partner.partnerId).not.toBe(reused.reference);
    expectOutcome(await mutations.import.acceptImportRows(acceptance.input, SESSION), "alreadyAccepted");
    expect(await partnerTotal()).toBe(after);
  });
  it("records no membership and no consent for the rows it accepts", async () => {
    const before = await membershipRecords();
    expect(before.length).toBeGreaterThan(0); // The comparison has teeth only because the seeded audience is not empty.
    const { scope, revision, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    // AAP 0.8.5: "A `subscribed` flag is not consent", and importing a contact never subscribes anyone. The fixture's `Subscribed` column is preserved as data on the row, so the membership records must be exactly the records that stood before the import: the same count, the same states, the same choices.
    expect(await membershipRecords()).toEqual(before);
    expect(acceptance.receipt.facts).toEqual({ memberships: 0, consentRecords: 0, audienceMembers: 0, safetyQualified: false, externalEffects: 0 }); // The receipt states the same fact in the record it stores, so the result step cannot claim otherwise.
  });
  it("reports a state and a route for every data row, from the closed vocabulary", async () => {
    const { scope, revision, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    const receipt = acceptance.receipt;
    expect(receipt.results).toHaveLength(FIXTURE_DATA_ROWS);
    expect(receipt.counts).toEqual({ accepted: 3, alreadyAccepted: 0, skipped: 1, needsReview: FIXTURE_DATA_ROWS - 4, failed: 0, total: FIXTURE_DATA_ROWS });
    const states = new Set(receipt.results.map((result) => result.state));
    expect([states.has("accepted"), states.has("skipped"), states.has("needs-review")]).toEqual([true, true, true]);
    const permittedRoutes = receipt.results.map((result) => ({
      rowNumber: result.rowNumber,
      state: result.state,
      expected: result.state === "accepted" || result.state === "already-accepted" ? "partner" : result.state === "skipped" ? "none" : "correction",
      actual: result.route === null ? "none" : result.route.kind,
      correctionRow: result.route !== null && result.route.kind === "correction" ? result.route.rowNumber : null,
    }));
    for (const route of permittedRoutes) expect(IMPORT_ROW_RESULT_STATES).toContain(route.state);
    expect(permittedRoutes.map((route) => route.actual)).toEqual(permittedRoutes.map((route) => route.expected));
    const corrections = permittedRoutes.filter((route) => route.correctionRow !== null);
    expect(corrections.length).toBeGreaterThan(0);
    expect([corrections.every((route) => route.correctionRow === route.rowNumber), receipt.results.find((result) => result.rowNumber === CREATED_ROW)?.reasonCode, receipt.results.find((result) => result.rowNumber === REUSED_ROW)?.reasonCode]).toEqual([true, "applied", "reused-identity"]);
    expect(receipt.results.find((result) => result.rowNumber === SKIPPED_ROW)?.reasonCode).toBe("worker-skipped");
    const undecided = receipt.results.find((result) => result.rowNumber === UNDECIDED_ROW);
    expect([undecided?.state, undecided?.reasonCode]).toEqual(["needs-review", "undecided"]);
  });
  it("cancels only what acceptance had not already applied", async () => {
    const { scope, revision, importOperationId, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    const acceptedTotal = await partnerTotal();
    const reviewed = envelopeOf(await reads.import.readImportProposal({ session: SESSION, importOperationId, pageSize: 200 }), "the accepted import's proposal").data;
    expect(reviewed.inFlight).toBe(false);
    const cancelOperationId = newOperationId();
    const cancelled = await mutations.import.cancelImport({ operationId: cancelOperationId, scope, expectedRevision: reviewed.revision, payload: {} }, SESSION);
    expectOutcome(cancelled, "accepted");
    const cancellation = envelopeOf(await reads.import.readImportReceipt(cancelOperationId, { session: SESSION, pageSize: 200 }), "the cancellation's receipt").data;
    expect([cancellation.cancelled, cancellation.cancellation?.acceptedRowsRetained, cancellation.cancellation?.stoppedRows, cancellation.counts.accepted]).toEqual([true, 3, FIXTURE_DATA_ROWS - 3, 3]);
    expect(cancellation.rows.filter((row) => row.state === "skipped")).toHaveLength(FIXTURE_DATA_ROWS - 3);
    expect(await partnerTotal()).toBe(acceptedTotal);
    for (const result of acceptance.receipt.results.filter((entry) => entry.state === "accepted")) {
      if (result.route === null || result.route.kind !== "partner") throw new Error(`row ${String(result.rowNumber)} is ${result.state} without the contact it points at`);
      const detail = envelopeOf(await reads.partners.readPartner(result.route.partnerRef.reference, {}, SESSION), `the record row ${String(result.rowNumber)} points at`).data;
      expect(detail.partner.partnerId).toBe(result.route.partnerRef.reference);
    }
    const untouched = envelopeOf(await reads.import.readImportReceipt(acceptance.input.operationId, { session: SESSION, pageSize: 200 }), "the acceptance's receipt").data;
    expect(untouched.cancelled).toBe(false);
    expect(untouched.counts).toEqual(acceptance.receipt.counts);
  });
  it("publishes the file fingerprint, the recorded decisions and a reconciled summary an acceptance takes", async () => {
    const { scope } = await reviewTheFixtureFile();
    const inFlight = envelopeOf(await reads.import.readImportProposal({ session: SESSION, pageSize: 200 }), "the import proposal in flight").data; // A second decision, so what the read publishes is more than the one skip the review already holds.
    const decided = await mutations.import.setRowDecision({ operationId: newOperationId(), scope, expectedRevision: inFlight.revision, payload: { kind: "create", rowNumber: CREATED_ROW } }, SESSION);
    expectOutcome(decided, "accepted");
    const published = envelopeOf(await reads.import.readImportProposal({ session: SESSION, pageSize: 200 }), "the import proposal after two decisions").data;
    expect(published.fileFingerprint).toMatch(/^csv-1-[0-9a-f]{16}$/);
    expect(published.recordedDecisions).toEqual([
      { kind: "create", rowNumber: CREATED_ROW, corrections: [] },
      { kind: "skip", rowNumber: SKIPPED_ROW, reason: SKIP_REASON },
    ]);
    expect(published.summary.needsReview).toBeLessThanOrEqual(published.summary.rowCount); // One row awaiting a decision is one row however many reasons it carries, so the summary a worker reads before accepting cannot report more rows than the file holds and cannot undercount what is left.
    expect(published.summary.needsReview).toBeGreaterThanOrEqual(published.summary.unresolved);
    const before = await partnerTotal();
    const acceptance = await mutations.import.acceptImportRows({ operationId: newOperationId(), scope, expectedRevision: published.revision, payload: { acknowledged: true, fileFingerprint: published.fileFingerprint, decisions: published.recordedDecisions } }, SESSION);
    expectOutcome(acceptance, "accepted");
    if (acceptance.outcome !== "accepted") throw new Error(`accepting the values the read published was answered "${acceptance.outcome}": ${JSON.stringify(acceptance)}`);
    expect(acceptance.created).toEqual([`partner-import-${published.importOperationId}-${String(CREATED_ROW)}`]);
    expect(await partnerTotal()).toBe(before + 1);
  });
  it("requires a fresh review when the chosen file's content changes", async () => {
    const { scope, revision, importOperationId, fileFingerprint } = await reviewTheFixtureFile();
    const acceptance = await acceptUnderLostAcknowledgement(scope, revision, fileFingerprint);
    const changedBytes = Buffer.from(`${FIXTURE_TEXT.trimEnd()}\n${CHANGED_ROW}\n`, "utf8"); // One more data row is a different file: its content fingerprint hashes the headers and every cell, and its row count is part of it, so the two files cannot share a checksum.
    expect(changedBytes.byteLength).not.toBe(FIXTURE_BYTES.byteLength);
    const proposed = await mutations.import.proposeImport({ operationId: newOperationId(), scope, expectedRevision: NO_REVISION_TO_COMPARE, payload: { fileName: FIXTURE_NAME, contentBase64: changedBytes.toString("base64"), confirmedMapping: CONFIRMED_MAPPING } }, SESSION);
    expect([isOutcome(proposed), proposed.outcome]).toEqual([true, "accepted"]);
    if (proposed.outcome !== "accepted") throw new Error(`proposing the changed file answered "${proposed.outcome}" instead of "accepted": ${JSON.stringify(proposed)}`);
    const changedIdentity = proposed.created?.[0];
    expect(changedIdentity).toBeDefined();
    expect(changedIdentity).not.toBe(importOperationId);
    if (changedIdentity === undefined) throw new Error("the changed file's proposal named no import identity, so its review cannot be read back");
    const changed = envelopeOf(await reads.import.readImportProposal({ session: SESSION, importOperationId: changedIdentity, pageSize: 200 }), "the changed file's proposal").data;
    expect([changed.inFlight, changed.importOperationId, changed.file.rowCount, changed.file.columnCount, changed.file.bytes, changed.summary.decisionsRecorded]).toEqual([true, changedIdentity, FIXTURE_DATA_ROWS + 1, FIXTURE_COLUMNS, changedBytes.byteLength, 0]);
    expect(changed.summary.unresolved).toBe(FIXTURE_DATA_ROWS + 1);
    // Every row of an undecided review awaits a decision exactly once, so the summary a worker reads before deciding anything counts the rows themselves: a row that is both undecided and still blocked is one row needing review, and the count can never run past the rows the file holds.
    expect(changed.summary.needsReview).toBe(changed.summary.rowCount);
    const changedAcceptanceId = newOperationId();
    const changedAccepted = await mutations.import.acceptImportRows({ operationId: changedAcceptanceId, scope, expectedRevision: changed.revision, payload: { acknowledged: true, fileFingerprint: changed.fileFingerprint, decisions: [{ kind: "create", rowNumber: FIXTURE_DATA_ROWS + 1 }] } }, SESSION);
    expectOutcome(changedAccepted, "accepted");
    const changedReceipt = envelopeOf(await reads.import.readImportReceipt(changedAcceptanceId, { session: SESSION, pageSize: 200 }), "the changed file's receipt").data;
    expect(changedReceipt.file.rowCount).toBe(FIXTURE_DATA_ROWS + 1);
    expect(changedReceipt.revision).not.toContain(acceptance.receipt.fingerprint.checksum); // Each receipt states its own file's checksum in its revision, so the two files cannot be confused.
    const firstReceipt = envelopeOf(await reads.import.readImportReceipt(acceptance.input.operationId, { session: SESSION, pageSize: 200 }), "the first acceptance's receipt").data;
    expect(firstReceipt.file.rowCount).toBe(FIXTURE_DATA_ROWS);
    expect(firstReceipt.revision).toContain(acceptance.receipt.fingerprint.checksum);
  });
  it("answers an identical second proposal as unchanged, and reads the review back by the attempt's own identity", async () => {
    const scope = await sessionScope();
    const first = newOperationId();
    const repeated = newOperationId();
    const payload = { fileName: FIXTURE_NAME, contentBase64: FIXTURE_BASE64 };
    expectOutcome(await mutations.import.proposeImport({ operationId: first, scope, expectedRevision: NO_REVISION_TO_COMPARE, payload }, SESSION), "accepted");
    // The same file proposed again under an identity of its own changes nothing, so it is answered `unchanged` rather than as a second acceptance of the import the first attempt started.
    const again = await mutations.import.proposeImport({ operationId: repeated, scope, expectedRevision: NO_REVISION_TO_COMPARE, payload }, SESSION);
    expectOutcome(again, "unchanged");
    if (again.outcome !== "unchanged") throw new Error(`proposing the same file under a fresh identity answered "${again.outcome}" instead of "unchanged": ${JSON.stringify(again)}`);
    expect(again.operationId).toBe(repeated);
    // A journey that left the review and came back holds the identity it minted and nothing else, so that identity has to name the review the attempt found.
    const byFirst = envelopeOf(await reads.import.readImportProposal({ importOperationId: first, session: SESSION, pageSize: 200 }), "the proposal the first attempt wrote").data;
    const byRepeated = envelopeOf(await reads.import.readImportProposal({ importOperationId: repeated, session: SESSION, pageSize: 200 }), "the proposal the attempt that changed nothing found").data;
    expect([byRepeated.importOperationId, byRepeated.revision, byRepeated.fileFingerprint, byRepeated.summary]).toEqual([first, again.revision, byFirst.fileFingerprint, byFirst.summary]);
    const replayed = await mutations.import.proposeImport({ operationId: repeated, scope, expectedRevision: NO_REVISION_TO_COMPARE, payload }, SESSION); // Replaying that attempt still changes nothing, and the proposal stands at the revision both answers named.
    if (replayed.outcome !== "unchanged") throw new Error(`replaying the attempt that changed nothing answered "${replayed.outcome}" instead of "unchanged": ${JSON.stringify(replayed)}`);
    expect(replayed.revision).toBe(again.revision);
    expect(envelopeOf(await reads.import.readImportProposal({ importOperationId: first, session: SESSION, pageSize: 200 }), "the proposal after the replay").data.revision).toBe(byFirst.revision);
    const entries = await ledgerEntriesFor(repeated); // The attempt that changed nothing is recorded as such, stating the import it found: that record is what the read above resolved the caller's own identity through.
    expect([entries.length, entries[0]?.["outcome"], entries[0]?.["result"]]).toEqual([1, "unchanged", { importOperationId: first }]);
    // An identity that names neither a proposal nor an attempt is still refused, and the refusal states nothing about what was asked for beyond the code every unreachable identity answers.
    const unrecorded = await reads.import.readImportProposal({ importOperationId: newOperationId(), session: SESSION, pageSize: 200 });
    if (unrecorded.kind !== "denied") throw new Error(`an identity that names no import answered "${unrecorded.kind}" instead of a refusal: ${JSON.stringify(unrecorded)}`);
    expect([unrecorded.denied.reasonCode, Object.keys(unrecorded.denied).sort()]).toEqual(["no-permission", ["operationId", "outcome", "reasonCode"]]);
  });
});
