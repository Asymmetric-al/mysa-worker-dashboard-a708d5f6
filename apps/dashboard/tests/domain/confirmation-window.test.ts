/**
 * Success criterion 10, at the domain and the service boundary: the proof flow's 168-hour
 * confirmation window, and the honesty of the states around it.
 *
 * The window is 168 elapsed hours counted from the instant the membership accepted the proof step,
 * and it is strict at equality: a confirmation one second inside the window succeeds and a
 * confirmation at exactly 168 hours is refused. That pair is the test, because either half alone
 * passes an implementation that closed the window a second early or a second late. Nothing renews
 * the window — not a reload, not a retry, not the proof issued again — and the three are asserted
 * separately, because an implementation can be right about one and wrong about another.
 *
 * Around the window the file keeps four facts apart that a careless implementation collapses:
 * membership state, the Off/Immediate choice, the reading language and proof of possession. Only
 * the explicit confirmation moves a membership out of the proof step; a `subscribed`-looking column
 * is not consent; a source-supplied row is excluded rather than activated.
 *
 * Divergences from this file's dependency brief, each forced by the modules' own contracts:
 *
 * - The world is laid down by `resetSeed` from `dev-runtime/reset`. A session exists only in the
 *   store, the store's `resetSession` is the only path that creates one, and the store may not be
 *   imported here, so the development runtime's one deterministic reset is how a seeded session is
 *   obtained — the route `tests/domain/goal.test.ts` also takes. `mutations.dev.resetSeed` cannot
 *   serve: it is a mutation over a session that must already exist.
 * - `reads.readPreferences` and `reads.readAudience` take no `SessionSource`: they read the request
 *   cookie through `next/headers`, which throws outside a request scope, so a DOM-free suite cannot
 *   call them at all. The property they would have shown — that a page load never confirms — is
 *   proven here against the reads a domain test can execute, `resolveSession` (which every read
 *   performs first) and `reads.readDevState` (which loads the whole session document), and
 *   decisively by the revision the explicit confirmation still has to match afterwards. The
 *   HTTP-level proof that a GET or HEAD never confirms belongs to `e2e/consent-notification.spec.ts`
 *   and is not duplicated here.
 * - The seeded reader personas ("subscriber" and the three readers) carry no admitted membership,
 *   and every mutation authorises its scope under a membership before its own question, so a reader
 *   session cannot sign up or confirm. The proof flow is therefore exercised as the acting person's
 *   own membership — the membership is keyed by the principal who accepted it — in the established
 *   worker's admitted session, which holds no seeded membership of its own.
 * - A mutation finds a named session only when the `SessionSource` is passed as its second
 *   argument, and an accepted outcome carries no payload, so the result a change stored (the
 *   deadline it opened, the pending proof, the state it reached) is read back by replaying the same
 *   operation id. That replay is the service's own recovery path, not a second observation channel.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { type MembershipRecord as StoredMembership, type MutationOutcome, type Scope, mutations, reads } from "@/modules/data-service";
import { type AccessDecision, type ResolvedSession, type SessionSource, canReadProtected, resolveSession } from "@/modules/data-service/authorize";
import { isOutcome } from "@/modules/data-service/outcome";
import {
  MEMBER_CHOICES,
  MEMBERSHIP_STATES,
  UPDATE_EMAIL_PURPOSE,
  type MembershipRecord,
  type MembershipScope,
  type MembershipState,
  confirmAt,
  excludedSourceMembership,
  isConfirmationOpen,
  isExcludedSourceMembership,
  isMemberChoice,
  isMembershipState,
  pendingProofResult,
  withChoice,
} from "@/modules/audience/membership";
import { SEED_INSTANT, now } from "@/modules/time/clock";
import { CONFIRMATION_WINDOW_HOURS, confirmationDeadline } from "@/modules/time/window";
import type { SeededSessionWithDocuments } from "@/modules/dev-runtime/seed";
import { seed } from "@/modules/dev-runtime/seed";
import { resetSeed } from "@/modules/dev-runtime/reset";
import { advanceClock, setClock } from "@/modules/dev-runtime/scenario";
// The world each case starts from
/** The seeded session this file acts in: signed in, admitted to one ministry, and holding no membership of its own — the person whose proof step each case opens. */
const SESSION_ID = "established-worker";

const SOURCE: SessionSource = { sessionId: SESSION_ID };
/** The window in milliseconds, derived from the module's own stated hours so the two cannot drift. */
const WINDOW_MILLISECONDS = CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000;

const SECOND_MILLISECONDS = 1_000;
/** What a creation presents where a revision would go: there is no stored value for a stale expectation to overwrite. */
const NO_TARGET_REVISION = "no-target";
/** The deadline the acceptance at the seed instant opens. Derived, never written: the reset leaves the scenario clock at the seed instant, so the acceptance every service case records is exactly this instant. */
const DEADLINE_AT_SEED = SEED_INSTANT.add({ hours: CONFIRMATION_WINDOW_HOURS });
/** A publisher the seeded records never mention, so an unsubscribe for it addresses nothing. */
const OTHER_PUBLISHER = "publisher-elsewhere";
// The arguments each named mutation takes
type SignupArgs = Parameters<typeof mutations.audience.signupForPurpose>[0];

type ConfirmArgs = Parameters<typeof mutations.audience.confirmMembership>[0];

type SetPreferenceArgs = Parameters<typeof mutations.audience.setPreference>[0];

type UnsubscribeArgs = Parameters<typeof mutations.audience.unsubscribe>[0];

type DevStateEnvelope = Extract<Awaited<ReturnType<typeof reads.dev.readDevState>>, { readonly kind: "envelope" }>["envelope"];

/** One opened proof step: the scope it acts in, the principal whose own membership it opens, the publisher it addresses, and the attempt that opened it. */
interface ProofStep {
  readonly scope: Scope;
  readonly principalId: string;
  readonly publisherId: string;
  readonly signup: SignupArgs;
}
// The world, as the seed built it
let seededDocuments: Promise<readonly SeededSessionWithDocuments[]> | undefined;

function seededWorld(): Promise<readonly SeededSessionWithDocuments[]> {
  // The seed is deterministic, so one build serves every case: a second call would produce the same
  // bytes, and this file never mutates the documents it reads.
  seededDocuments ??= seed();
  return seededDocuments;
}

async function seededAudience(): Promise<readonly StoredMembership[]> {
  const sessions = await seededWorld();
  const template = sessions.find((session) => session.sessionId === SESSION_ID);
  if (template === undefined) {
    throw new Error(`The seed lays down no "${SESSION_ID}" session, so no case in this file has an audience to read.`);
  }
  return template.documents.state.memberships;
}

async function seededPublisher(): Promise<string> {
  const audience = await seededAudience();
  const [first] = audience;
  if (first === undefined) {
    throw new Error("The seeded audience holds no membership, so no case in this file can name the publisher whose Update email it is for.");
  }
  return first.publisherId;
}

/** Every seeded membership row, loaded once for each case by the reset that starts it. */
let seededRows: readonly StoredMembership[] = [];

function seededRow(membershipId: string): StoredMembership {
  const matches = seededRows.find((row) => row.membershipId === membershipId);
  if (matches === undefined) {
    throw new Error(`The seeded audience holds no "${membershipId}" row, so no case in this file can describe it.`);
  }
  return matches;
}
// Reading the session and its documents
async function sessionOf(source: SessionSource): Promise<ResolvedSession> {
  const resolved = await resolveSession(source);
  if (!resolved.ok) {
    throw new Error(`The session "${source.sessionId}" could not be resolved, so no case in this file has an actor.`);
  }
  return resolved.session;
}

async function selectedScope(): Promise<Scope> {
  const session = await sessionOf(SOURCE);
  if (session.selected === null) {
    throw new Error(`The session "${SESSION_ID}" has selected no context, so it holds no scope for a membership to belong to.`);
  }
  return session.selected;
}

async function devStateEnvelope(): Promise<DevStateEnvelope> {
  const result = await reads.dev.readDevState(SOURCE);
  if (result.kind !== "envelope") {
    throw new Error(`The development state could not be read (it answered "${result.kind}"), so no case in this file can observe what a page load reads.`);
  }
  return result.envelope;
}

async function advanceBy(milliseconds: number): Promise<void> {
  const advanced = await advanceClock(SESSION_ID, milliseconds);
  if (!advanced.ok) {
    throw new Error(`The scenario clock refused to advance by ${String(milliseconds)} ms: ${advanced.error.code}.`);
  }
  // The session's stored offset is what a mutation reads its instant from and the process clock is
  // what every boundary function is given, so the two are asserted to agree rather than assumed to.
  expect(now().epochMilliseconds).toBe(SEED_INSTANT.epochMilliseconds + advanced.value.clockOffsetMs);
}
// The proof step, as this file opens it
async function openedProofStep(): Promise<ProofStep> {
  const scope = await selectedScope();
  const session = await sessionOf(SOURCE);
  // A reset leaves the clock at the seed instant, so every acceptance below is exactly SEED_INSTANT
  // and every expected boundary is a fixed instant rather than "about now".
  expect(now().equals(SEED_INSTANT)).toBe(true);
  const publisherId = await seededPublisher();
  const step: ProofStep = {
    scope,
    principalId: session.principalId,
    publisherId,
    signup: {
      operationId: newOperationId(),
      scope,
      expectedRevision: NO_TARGET_REVISION,
      payload: { publisherId, purpose: UPDATE_EMAIL_PURPOSE, email: "reader@example.org", languagePreference: "en" },
    },
  };
  const opened = await mutations.audience.signupForPurpose(step.signup, SOURCE);
  expect(named(opened)).toBe("accepted");
  return step;
}

function confirmInput(step: ProofStep, expectedRevision: string): ConfirmArgs {
  return { operationId: newOperationId(), scope: step.scope, expectedRevision, payload: { membershipId: step.principalId } };
}

function preferenceInput(step: ProofStep, expectedRevision: string, payload: Omit<SetPreferenceArgs["payload"], "membershipId">): SetPreferenceArgs {
  return { operationId: newOperationId(), scope: step.scope, expectedRevision, payload: { membershipId: step.principalId, ...payload } };
}

function unsubscribeInput(step: ProofStep, expectedRevision: string): UnsubscribeArgs {
  return { operationId: newOperationId(), scope: step.scope, expectedRevision, payload: { publisherId: step.publisherId, purpose: UPDATE_EMAIL_PURPOSE } };
}
// Reading an outcome
function named(outcome: MutationOutcome): MutationOutcome["outcome"] {
  // A surface runs the same guard before it trusts an outcome, so asserting it keeps this file on
  // the contract rather than on the object literal it happens to receive.
  expect(isOutcome(outcome)).toBe(true);
  return outcome.outcome;
}

function acceptedFrom(outcome: MutationOutcome): Extract<MutationOutcome, { readonly outcome: "accepted" }> {
  if (outcome.outcome !== "accepted") {
    throw new Error(`The change answered ${outcome.outcome} rather than accepted, so the case below could not continue: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

function unchangedRevision(outcome: MutationOutcome): string {
  if (outcome.outcome !== "unchanged") {
    throw new Error(`The change answered ${outcome.outcome} rather than unchanged, so the case below could not read the untouched revision: ${JSON.stringify(outcome)}`);
  }
  return outcome.revision;
}

function fieldMessages(outcome: MutationOutcome, field: string): readonly string[] {
  if (outcome.outcome !== "invalid") {
    throw new Error(`The refusal answered ${outcome.outcome} rather than invalid, so it carries no field messages: ${JSON.stringify(outcome)}`);
  }
  return outcome.fields[field] ?? [];
}

function firstMessageAbout(outcome: MutationOutcome, field: string): string {
  const [first] = fieldMessages(outcome, field);
  if (first === undefined) {
    throw new Error(`The refusal states nothing about "${field}", so the case below has no reason to read: ${JSON.stringify(outcome)}`);
  }
  return first;
}

function replayedResult(outcome: MutationOutcome): unknown {
  if (outcome.outcome !== "alreadyAccepted") {
    throw new Error(`The replay answered ${outcome.outcome} rather than alreadyAccepted, so the change it should have stored was not read back: ${JSON.stringify(outcome)}`);
  }
  return outcome.result;
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textOf(value: unknown, key: string): string {
  const field = fieldOf(value, key);
  if (typeof field !== "string") {
    throw new Error(`The stored result carries no "${key}" text, so the case below could not read it: ${JSON.stringify(value)}`);
  }
  return field;
}

function nullableTextOf(value: unknown, key: string): string | null {
  const field = fieldOf(value, key);
  if (field === null || field === undefined) {
    return null;
  }
  if (typeof field !== "string") {
    throw new Error(`The stored result carries a "${key}" that is not text, so the case below could not read it: ${JSON.stringify(value)}`);
  }
  return field;
}

function booleanOf(value: unknown, key: string): boolean {
  const field = fieldOf(value, key);
  if (typeof field !== "boolean") {
    throw new Error(`The stored result carries no "${key}" boolean, so the case below could not read it: ${JSON.stringify(value)}`);
  }
  return field;
}
// The window, in the module's own vocabulary
function openWindowAt(acceptedAt: Temporal.Instant, at: Temporal.Instant): Extract<ReturnType<typeof confirmationDeadline>, { readonly status: "within-window" }> {
  const deadline = confirmationDeadline({ acceptedAt, now: at });
  if (deadline.status !== "within-window") {
    throw new Error(`The window opened at ${acceptedAt.toString()} is already closed at ${at.toString()}, so the case below could not run inside it.`);
  }
  return deadline;
}

function closedWindowAt(acceptedAt: Temporal.Instant, at: Temporal.Instant): Extract<ReturnType<typeof confirmationDeadline>, { readonly status: "expired" }> {
  const deadline = confirmationDeadline({ acceptedAt, now: at });
  if (deadline.status !== "expired") {
    throw new Error(`The window opened at ${acceptedAt.toString()} is still open at ${at.toString()}, so the case below could not run past its end.`);
  }
  return deadline;
}

function elapsedMilliseconds(from: Temporal.Instant, to: Temporal.Instant): number {
  return to.epochMilliseconds - from.epochMilliseconds;
}

function instantsIn(text: string): readonly Temporal.Instant[] {
  return [...text.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu)].map((match) => Temporal.Instant.from(match[0]));
}
// The stored row and the domain record, as a permission question reads them
function domainRowOf(row: StoredMembership, scope: Scope): MembershipRecord {
  // The store keeps one shape and the audience module decides on another; the read layer adapts the
  // first into the second. This fixture carries across only the members `canReadProtected` decides
  // on, so it cannot state a fact the stored row does not state.
  const acceptedAt = row.acceptedAt === null ? undefined : Temporal.Instant.from(row.acceptedAt);
  const confirmation = row.confirmationDeadline === null ? undefined : Temporal.Instant.from(row.confirmationDeadline);
  const choice = row.state === "off" || row.state === "restricted" ? "off" : "immediate";
  const ordinal = Number.parseInt(row.revision.replace(/^rev-/u, ""), 10);
  return {
    membershipId: row.membershipId,
    scope: { organizationId: scope.organizationId, ministryId: scope.ministryId },
    publisherId: row.publisherId,
    purpose: row.purpose,
    recipientId: row.membershipId,
    email: row.email,
    state: row.state,
    choice,
    languagePreference: row.languagePreference ?? "",
    revision: Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1,
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
  };
}

function readingGrantFor(row: StoredMembership, scope: Scope, session: ResolvedSession): AccessDecision {
  return canReadProtected(session, {
    audience: "approved-supporter",
    reader: {
      recipientId: row.membershipId,
      publisherId: row.publisherId,
      purpose: row.purpose,
      memberships: [domainRowOf(row, scope)],
    },
  });
}
// Every case starts from the deterministic world
beforeEach(async () => {
  await resetSeed();
  seededRows = await seededAudience();
});

afterEach(async () => {
  // The clock is a scenario input, so every case leaves it at the seed instant for the next one.
  const restored = await setClock(SESSION_ID, 0);
  if (!restored.ok) {
    throw new Error(`The scenario clock could not be returned to the seed instant: ${restored.error.code}.`);
  }
});

afterAll(async () => {
  // This file changes only seeded sessions, and a reset leaves them as the world every criterion
  // starts from rather than holding the confirmations these cases accepted.
  await resetSeed();
});

describe("the deadline is the acceptance instant plus 168 elapsed hours", () => {
  it("measures 168 x 3,600,000 milliseconds from every acceptance instant it is given", () => {
    const acceptances: readonly Temporal.Instant[] = [
      SEED_INSTANT,
      Temporal.Instant.from("2027-02-28T23:59:59Z"),
      // Europe/London leaves British Summer Time at 02:00 on 2026-10-25, so a window opened on
      // 2026-10-20 crosses the transition; its end is still 168 elapsed hours away.
      Temporal.ZonedDateTime.from("2026-10-20T12:00:00+01:00[Europe/London]").toInstant(),
    ];
    for (const acceptedAt of acceptances) {
      const deadline = openWindowAt(acceptedAt, acceptedAt);
      expect(elapsedMilliseconds(acceptedAt, deadline.deadlineInstant)).toBe(WINDOW_MILLISECONDS);
      expect(deadline.remainingMilliseconds).toBe(WINDOW_MILLISECONDS);
    }
  });

  it("counts 168 elapsed hours across a daylight-saving transition rather than seven calendar days", () => {
    const acceptedLocal = Temporal.ZonedDateTime.from("2026-10-20T12:00:00+01:00[Europe/London]");
    const acceptedAt = acceptedLocal.toInstant();
    const deadline = openWindowAt(acceptedAt, acceptedAt);
    expect(elapsedMilliseconds(acceptedAt, deadline.deadlineInstant)).toBe(WINDOW_MILLISECONDS);
    const deadlineLocal = deadline.deadlineInstant.toZonedDateTimeISO("Europe/London");
    // The acceptance reads 12:00 in London and the end reads 11:00, because the zone lost an hour in
    // between. A calendar-day reading — the same clock time seven days later — would end an hour
    // later, which is exactly the reading this window must not be.
    expect(acceptedLocal.hour).toBe(12);
    expect(deadlineLocal.hour).toBe(11);
    expect(
      acceptedLocal
        .add({ days: 7 })
        .toInstant()
        .equals(deadline.deadlineInstant.add({ seconds: 3_600 })),
    ).toBe(true);
  });

  it("keeps the deadline the acceptance recorded through every read that follows it", async () => {
    const step = await openedProofStep();
    const opened = replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE));
    expect(textOf(opened, "state")).toBe("awaiting-proof");
    expect(nullableTextOf(opened, "confirmationDeadline")).toBe(DEADLINE_AT_SEED.toString());
    for (let pass = 0; pass < 3; pass += 1) {
      expect((await devStateEnvelope()).asOf).toBe(SEED_INSTANT.toString());
      expect((await sessionOf(SOURCE)).principalId).toBe(step.principalId);
    }
    const reread = replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE));
    const deadlineText = nullableTextOf(reread, "confirmationDeadline");
    expect(deadlineText).toBe(DEADLINE_AT_SEED.toString());
    expect(elapsedMilliseconds(SEED_INSTANT, Temporal.Instant.from(String(deadlineText)))).toBe(WINDOW_MILLISECONDS);
  });
});

describe("strict at equality", () => {
  it("confirms one second inside the window and records the membership as active", async () => {
    const step = await openedProofStep();
    await advanceBy(WINDOW_MILLISECONDS - SECOND_MILLISECONDS);
    const confirmation = confirmInput(step, "rev-1");
    expect(acceptedFrom(await mutations.audience.confirmMembership(confirmation, SOURCE)).revision).toBe("rev-2");
    const receipt = replayedResult(await mutations.audience.confirmMembership(confirmation, SOURCE));
    expect(textOf(receipt, "state")).toBe("active");
    expect(nullableTextOf(receipt, "confirmedAt")).toBe(DEADLINE_AT_SEED.subtract({ seconds: 1 }).toString());
  });

  it("refuses the confirmation at exactly 168 hours and leaves the row waiting for proof", async () => {
    const step = await openedProofStep();
    await advanceBy(WINDOW_MILLISECONDS);
    // The boundary instant itself is outside the window: it is the first instant the same module
    // reports as expired, and it is exactly the deadline the acceptance opened.
    expect(closedWindowAt(SEED_INSTANT, now()).deadlineInstant.equals(DEADLINE_AT_SEED)).toBe(true);
    const refused = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(named(refused)).toBe("invalid");
    const expiry = firstMessageAbout(refused, "membershipId");
    expect(expiry.startsWith("confirmation-expired:")).toBe(true);
    // The reason names the instant the window closed, and that instant is the deadline the
    // acceptance opened rather than the instant the refusal happened.
    expect(instantsIn(expiry).map((instant) => instant.toString())).toEqual([DEADLINE_AT_SEED.toString()]);
    // An active membership answers `unchanged` here and an off or restricted one answers
    // `not-awaiting-proof`; only a row still waiting for proof reaches `confirmation-expired`, so
    // the refusal is also the proof that the state was not flipped to active behind it.
    expect(expiry.startsWith("not-awaiting-proof")).toBe(false);
    // One second earlier the same row is still confirmable at the revision the caller read, so the
    // refusal neither promoted it nor moved the window it was measured against.
    const restored = await setClock(SESSION_ID, WINDOW_MILLISECONDS - SECOND_MILLISECONDS);
    expect(restored.ok).toBe(true);
    expect(acceptedFrom(await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE)).revision).toBe("rev-2");
  });
});

describe("nothing extends the window", () => {
  it("does not renew the deadline when the surface is reloaded inside it", async () => {
    const step = await openedProofStep();
    const before = nullableTextOf(replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE)), "confirmationDeadline");
    await advanceBy(WINDOW_MILLISECONDS - SECOND_MILLISECONDS);
    for (let pass = 0; pass < 3; pass += 1) {
      // A reload re-reads the session and its documents, which is what a page load performs; a read
      // that renewed anything would show up in the deadline compared below.
      expect((await devStateEnvelope()).asOf).toBe(DEADLINE_AT_SEED.subtract({ seconds: 1 }).toString());
      await sessionOf(SOURCE);
    }
    const after = nullableTextOf(replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE)), "confirmationDeadline");
    expect(after).toBe(before);
    expect(after).toBe(DEADLINE_AT_SEED.toString());
    // Having spent the last second of the window on reads, the boundary still closes where the
    // acceptance put it.
    await advanceBy(SECOND_MILLISECONDS);
    const refused = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(named(refused)).toBe("invalid");
    expect(firstMessageAbout(refused, "membershipId")).toContain(DEADLINE_AT_SEED.toString());
  });

  it("keeps a refused confirmation refused when it is tried again a second later", async () => {
    const step = await openedProofStep();
    await advanceBy(WINDOW_MILLISECONDS);
    const firstRefusal = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(named(firstRefusal)).toBe("invalid");
    await advanceBy(SECOND_MILLISECONDS);
    const retry = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(named(retry)).toBe("invalid");
    // The retry names exactly the instant the first refusal named: a retry that had opened a new
    // acceptance would name a deadline 168 hours after itself instead.
    const message = firstMessageAbout(retry, "membershipId");
    expect(message).toBe(firstMessageAbout(firstRefusal, "membershipId"));
    expect(message).toContain(DEADLINE_AT_SEED.toString());
    expect(message).not.toContain(now().add({ hours: CONFIRMATION_WINDOW_HOURS }).toString());
  });

  it("does not reset the acceptance when the proof is issued again for the same membership", async () => {
    const step = await openedProofStep();
    await advanceBy(WINDOW_MILLISECONDS + SECOND_MILLISECONDS);
    const issuedAgain = await mutations.audience.signupForPurpose({ ...step.signup, operationId: newOperationId() }, SOURCE);
    // The service offers no resend: a membership that already exists is answered as unchanged, so
    // the acceptance stays where the person's own act put it.
    expect(named(issuedAgain)).toBe("unchanged");
    const receipt = replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE));
    expect(textOf(receipt, "state")).toBe("awaiting-proof");
    expect(textOf(receipt, "revision")).toBe("rev-1");
    expect(nullableTextOf(receipt, "confirmationDeadline")).toBe(DEADLINE_AT_SEED.toString());
    const refused = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(named(refused)).toBe("invalid");
    const message = firstMessageAbout(refused, "membershipId");
    expect(message).toContain(DEADLINE_AT_SEED.toString());
    // The deadline the second signup would have opened is nowhere in the refusal.
    expect(message).not.toContain(now().add({ hours: CONFIRMATION_WINDOW_HOURS }).toString());
  });
});

describe("confirmation is an explicit action and never a read", () => {
  it("leaves the membership at the revision the caller read until it confirms explicitly", async () => {
    const step = await openedProofStep();
    for (let pass = 0; pass < 3; pass += 1) {
      expect((await devStateEnvelope()).scope.principalId).toBe(step.principalId);
      await sessionOf(SOURCE);
    }
    // Presenting the revision those reads returned is an assertion about them: a read that had
    // confirmed the address would have left the row active at rev-2, and this write would answer
    // `conflict` rather than `accepted`.
    const confirmed = await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE);
    expect(acceptedFrom(confirmed).revision).toBe("rev-2");
  });

  it("moves the row to active only on the explicit confirmation, and a repeat changes nothing", async () => {
    const step = await openedProofStep();
    const confirmation = confirmInput(step, "rev-1");
    expect(acceptedFrom(await mutations.audience.confirmMembership(confirmation, SOURCE)).revision).toBe("rev-2");
    // The same attempt arriving twice is the replay the ledger exists for: the stored result comes
    // back and no revision advances.
    const replay = await mutations.audience.confirmMembership(confirmation, SOURCE);
    expect(named(replay)).toBe("alreadyAccepted");
    const receipt = replayedResult(replay);
    expect(textOf(receipt, "state")).toBe("active");
    expect(textOf(receipt, "revision")).toBe("rev-2");
    // A fresh attempt at a membership that has already confirmed is `unchanged`, not a second
    // acceptance carrying a new revision.
    const repeated = await mutations.audience.confirmMembership(confirmInput(step, "rev-2"), SOURCE);
    expect(named(repeated)).toBe("unchanged");
    expect(unchangedRevision(repeated)).toBe("rev-2");
  });

  it("opens the proof step with a pending result that claims no message and no membership", async () => {
    const step = await openedProofStep();
    const receipt = replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE));
    expect(textOf(receipt, "state")).not.toBe("active");
    const proof = fieldOf(receipt, "proof");
    // The audience module states the one neutral pending result and the service stores exactly it:
    // pending, no mail claimed as sent, and the next step left to the person's own Confirm.
    expect(proof).toEqual(pendingProofResult());
    expect(booleanOf(proof, "claimsMailSent")).toBe(false);
    expect(textOf(proof, "status")).toBe("pending");
    expect(Object.keys(proof ?? {}).sort()).toEqual(["claimsMailSent", "nextStep", "status"]);
  });
});

describe("the states and the choices stay honest", () => {
  it("keeps exactly four membership states and refuses any other word for one", () => {
    expect(MEMBERSHIP_STATES).toHaveLength(4);
    expect([...MEMBERSHIP_STATES].sort()).toEqual(["active", "awaiting-proof", "off", "restricted"]);
    const vocabulary: readonly MembershipState[] = MEMBERSHIP_STATES;
    for (const state of vocabulary) {
      expect(isMembershipState(state)).toBe(true);
    }
    for (const word of ["subscribed", "pending", "held", "unqualified", "paused"]) {
      expect(isMembershipState(word)).toBe(false);
    }
    // Every row the seeded audience holds is one of those four, and together the rows exercise all
    // four, so a fifth state cannot appear without this failing.
    const observed = new Set(seededRows.map((row) => row.state));
    expect([...observed].sort()).toEqual([...MEMBERSHIP_STATES].sort());
  });

  it("offers exactly Off and Immediate, and refuses a cadence it does not offer", async () => {
    expect(MEMBER_CHOICES).toHaveLength(2);
    expect([...MEMBER_CHOICES]).toEqual(["off", "immediate"]);
    for (const word of ["digest", "weekly", "monthly", "daily", "all"]) {
      expect(isMemberChoice(word)).toBe(false);
    }
    const step = await openedProofStep();
    const offered = preferenceInput(step, "rev-1", { choice: "immediate" });
    // A cadence the audience does not offer is stated the way a caller could state it, and the
    // service refuses it rather than treating an unknown word as one of the two.
    const withCadence = { ...offered, payload: { ...offered.payload, choice: "digest" } } as unknown as SetPreferenceArgs;
    const refused = await mutations.audience.setPreference(withCadence, SOURCE);
    expect(named(refused)).toBe("invalid");
    expect(fieldMessages(refused, "choice").length).toBeGreaterThan(0);
  });

  it("treats a subscribed-looking column as no consent at all", async () => {
    const scope = await selectedScope();
    const session = await sessionOf(SOURCE);
    // The seed lays this row down as what an import's `subscribed` column produces: a record with
    // no acceptance behind it.
    const imported = seededRow("membership-subscribed-column");
    expect(imported.state).not.toBe("active");
    expect(imported.state).toBe("off");
    expect(imported.acceptedAt).toBeNull();
    expect(imported.confirmationDeadline).toBeNull();
    expect(isConfirmationOpen(domainRowOf(imported, scope), now())).toBe(false);
    // The permission question asked of the same row: the column grants no protected reading,
    // because nothing ever proved the address.
    const refused = readingGrantFor(imported, scope, session);
    if (refused.allowed) {
      throw new Error("A subscribed-looking import column was read as consent, and a column is not consent.");
    }
    expect(refused.denial.reasonCode).toBe("no-protected-grant");
    // The row whose person did confirm once keeps its grant although it is off, so what the case
    // separates is the acceptance, not the state the row happens to sit in.
    const unsubscribed = seededRow("membership-unsubscribed");
    expect(unsubscribed.state).toBe("off");
    expect(unsubscribed.acceptedAt).not.toBeNull();
    expect(readingGrantFor(unsubscribed, scope, session).allowed).toBe(true);
  });

  it("records a reading language without touching the state, the choice or the deadline", async () => {
    const step = await openedProofStep();
    const before = nullableTextOf(replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE)), "confirmationDeadline");
    const preference = preferenceInput(step, "rev-1", { choice: "immediate", languagePreference: "cy" });
    expect(acceptedFrom(await mutations.audience.setPreference(preference, SOURCE)).revision).toBe("rev-2");
    const receipt = replayedResult(await mutations.audience.setPreference(preference, SOURCE));
    expect(textOf(receipt, "state")).toBe("awaiting-proof");
    expect(textOf(receipt, "choice")).toBe("immediate");
    expect(textOf(receipt, "languagePreference")).toBe("cy");
    expect(fieldOf(receipt, "changed")).toEqual({ choice: false, languagePreference: true });
    const after = nullableTextOf(replayedResult(await mutations.audience.signupForPurpose(step.signup, SOURCE)), "confirmationDeadline");
    expect(after).toBe(before);
    // Proof of possession is still the person's own act, measured from the acceptance the language
    // change left untouched.
    expect(acceptedFrom(await mutations.audience.confirmMembership(confirmInput(step, "rev-2"), SOURCE)).revision).toBe("rev-3");
  });

  it.each(["held", "unqualified"] as const)("records a %s source row as excluded and never activates it", async (disposition) => {
    const scope = await selectedScope();
    const membershipScope: MembershipScope = { organizationId: scope.organizationId, ministryId: scope.ministryId };
    const excluded = excludedSourceMembership({
      membershipId: "membership-source-row",
      scope: membershipScope,
      publisherId: await seededPublisher(),
      recipientId: "membership-source-row",
      email: "source.row@example.org",
      languagePreference: "en",
      sourceDisposition: disposition,
    });
    expect(isExcludedSourceMembership(excluded)).toBe(true);
    expect(excluded.state).toBe("off");
    expect(excluded.state).not.toBe("active");
    expect(isConfirmationOpen(excluded, now())).toBe(false);
    // A deliberate choice does not activate it either: the audience module returns the row it was
    // given, so no path leads from a held or unqualified source row to an active membership.
    expect(withChoice(excluded, "immediate", now())).toBe(excluded);
    const confirmation = confirmAt(excluded, now());
    if (confirmation.status !== "refused") {
      throw new Error(`A ${disposition} source row was confirmed, and a row the source supplied is never activated by a confirmation.`);
    }
    expect(confirmation.reason).toBe("source-excluded");
    // Reading it does not promote it: the predicates and the permission question below all run
    // against the row, and it is byte-for-byte the row the source supplied afterwards.
    const untouched = { ...excluded };
    confirmationDeadline({ acceptedAt: SEED_INSTANT, now: now() });
    isConfirmationOpen(excluded, now());
    withChoice(excluded, "off", now());
    const session = await sessionOf(SOURCE);
    const grant = canReadProtected(session, {
      audience: "approved-supporter",
      reader: { recipientId: excluded.recipientId, publisherId: excluded.publisherId, purpose: excluded.purpose, memberships: [excluded] },
    });
    expect(grant.allowed).toBe(false);
    expect(excluded).toEqual(untouched);
  });

  it("unsubscribes one publisher and one purpose, and leaves every other fact alone", async () => {
    const step = await openedProofStep();
    expect(acceptedFrom(await mutations.audience.confirmMembership(confirmInput(step, "rev-1"), SOURCE)).revision).toBe("rev-2");
    const language = preferenceInput(step, "rev-2", { choice: "immediate", languagePreference: "fr" });
    expect(acceptedFrom(await mutations.audience.setPreference(language, SOURCE)).revision).toBe("rev-3");
    // Another publisher is not addressed, so the act turns nothing off and advances no revision.
    const elsewhere = await mutations.audience.unsubscribe(
      { operationId: newOperationId(), scope: step.scope, expectedRevision: "rev-3", payload: { publisherId: OTHER_PUBLISHER, purpose: UPDATE_EMAIL_PURPOSE } },
      SOURCE,
    );
    expect(named(elsewhere)).toBe("unchanged");
    expect(unchangedRevision(elsewhere)).toBe("rev-3");
    // A purpose this release keeps no memberships for is refused rather than widened to the one it
    // does keep: one purpose is the whole vocabulary.
    const otherPurpose = { ...unsubscribeInput(step, "rev-3"), payload: { publisherId: step.publisherId, purpose: "newsletter" } } as unknown as UnsubscribeArgs;
    const widened = await mutations.audience.unsubscribe(otherPurpose, SOURCE);
    expect(named(widened)).toBe("invalid");
    expect(fieldMessages(widened, "purpose").length).toBeGreaterThan(0);
    // The act this person does own.
    const addressed = unsubscribeInput(step, "rev-3");
    expect(acceptedFrom(await mutations.audience.unsubscribe(addressed, SOURCE)).revision).toBe("rev-4");
    const receipt = replayedResult(await mutations.audience.unsubscribe(addressed, SOURCE));
    expect(textOf(receipt, "publisherId")).toBe(step.publisherId);
    expect(textOf(receipt, "purpose")).toBe(UPDATE_EMAIL_PURPOSE);
    expect(textOf(receipt, "state")).toBe("off");
    expect(textOf(receipt, "choice")).toBe("off");
    // Turning notices off promises no recall of what was already sent, and it does not reach the
    // reading language the person chose: stating that language again changes nothing.
    expect(booleanOf(receipt, "claimsRecall")).toBe(false);
    const unchangedLanguage = preferenceInput(step, "rev-4", { choice: "off", languagePreference: "fr" });
    expect(named(await mutations.audience.setPreference(unchangedLanguage, SOURCE))).toBe("unchanged");
  });
});
