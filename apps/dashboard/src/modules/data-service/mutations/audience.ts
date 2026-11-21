/**
 * The audience and consent mutations: a deliberate signup, an explicit confirmation, the Off or
 * Immediate choice with a language preference that stands on its own, and an unsubscribe for one
 * publisher and one purpose.
 *
 * Plan items that put this file in scope: AAP 0.6.1's "Mutations: audience" row
 * (`signupForPurpose`, `confirmMembership`, `setPreference`, `unsubscribe`), 0.7.1's *Reach readers*
 * job group, the 0.9.1 tree and the 0.11.1 deliverable row for the nine mutation files. The behaviour
 * they carry is 0.8.5 — consent is never a flag, the audience offers only Off and Immediate, a
 * `subscribed` column, a contact edit and an imported row are never consent, and a language
 * preference is separate from consent and from proof of an address — together with 0.8.7, where the
 * confirmation window is one week of elapsed hours from acceptance and is strict at equality.
 * Success criterion 10 is the evidence for all four.
 *
 * Five facts stay five facts, and no mutation here merges two of them:
 * 1. the membership state (`active`, `awaiting-proof`, `off`, `restricted`);
 * 2. the Off/Immediate choice, which is the person's own decision for one publisher and one purpose;
 * 3. proof of the address, which only an explicit confirmation establishes;
 * 4. the language preference, which neither subscribes nor unsubscribes and never extends a window;
 * 5. the contact methods a partner record holds, which nothing here reads or writes.
 * Publication, notification submission, provider acceptance, delivery and reading stay five further
 * outcomes: no mutation here is a send, and the unsubscribe claims no recall of a copy the local
 * submission already accepted.
 *
 * **The person is the record's identity.** A membership is identified by publisher, purpose and
 * recipient, and the recipient is the acting person's own opaque identifier: a deliberate signup
 * therefore records the membership under the principal the session resolved to, never under the
 * address. An email address is a value on the record — it establishes neither identity nor consent,
 * it is never a join key, and it is never compared with a partner row, an imported row or a
 * `subscribed`-looking column. That identity is what makes the rule the surface states true rather
 * than merely asserted: a reader reaches their own membership, another person's membership is not
 * reachable, and `authorize.ts#canEdit` decides it.
 *
 * **Where each decision lives.** The proof journey, the four states, the two choices and the
 * confirmation transition are `@/modules/audience/membership`; the off transition with its "one
 * publisher, one purpose, everything else untouched" guarantee is `@/modules/audience/consent`; the
 * elapsed-hour window and its strict-at-equality boundary are `@/modules/time/window`. This file
 * composes them through `runMutation`, which owns validation, authorisation, the replay check, the
 * revision comparison, one transaction and one ledger entry, and answers with exactly one of the
 * eight outcomes. No state machine, consent rule or deadline is restated here, no transaction is
 * opened here and no ledger entry is written here.
 *
 * **Why the authority question is asked twice.** The runner asks a mutation's own authority question
 * before the transaction opens, so only the session and the identity the request claims are in hand
 * at that moment; the stored row is reached afterwards, inside `apply`. The ownership rule is applied
 * from the claim first — a request that names a membership which is not the caller's own is refused
 * before anything is read — and then re-asked against the stored record through
 * `authorize.ts#canEdit`, whose membership rule is the one implementation of it.
 *
 * Layering: a data-service mutation module. It imports the audience domain modules, the scenario
 * clock, its sibling contracts and `zod`. It imports no component, no feature, no application route,
 * no provider package and no store module: the store is reached only through the runner. It writes
 * no diagnostic of its own — `runMutation` logs the outcome — so no address, no display name and no
 * message body is ever logged, and no result it stores in the ledger carries the address either.
 *
 * Rule 1 obligations this file keeps. Clause 1: the proof journey stays deliberately local and tiny —
 * no provider client, no outward mail, no token endpoint, no queue and no webhook is scaffolded here.
 * Clause 2: one runner, one ledger, one schema per mutation and one membership model, reusing the
 * domain transitions instead of a second state machine or a second preference store. Clause 3: a
 * pending confirmation is not active, a language preference is not consent, a preference is not
 * contactability, an accepted notice is not delivery, and an undetermined effect stays `unknown` and
 * is recovered by its `operationId` rather than by sending the work again.
 */
import { Temporal } from "temporal-polyfill";
import { ZodError, z } from "zod";

import { unsubscribe as recordOffChoice } from "@/modules/audience/consent";
import {
  MEMBER_CHOICES,
  UPDATE_EMAIL_PURPOSE,
  confirmAt,
  newPendingMembership,
  withChoice,
  withLanguagePreference,
  type AudiencePurpose,
  type ConfirmationRefusalReason,
  type MemberChoice,
  type MembershipRecord as DomainMembership,
  type MembershipScope,
  type MembershipState,
} from "@/modules/audience/membership";
import { instantAt } from "@/modules/time/clock";
import { confirmationDeadline } from "@/modules/time/window";

import {
  canEdit,
  outcomeOfRefusal,
  resolveSession,
  sessionDenial,
  type ResolvedSession,
  type ScopeDecision,
  type SessionRefusal,
  type SessionSource,
} from "../authorize";
import {
  membershipRecordSchema,
  type MembershipRecord as StoredMembership,
  type MutationInput,
} from "../envelope";
import { denied, type MutationOutcome } from "../outcome";
import {
  runMutation,
  type ApplyResult,
  type CurrentTarget,
  type MutationContext,
} from "../operations";

// ---------------------------------------------------------------------------------------------
// The attempt: the session it acts for, and the identity it is logged under
// ---------------------------------------------------------------------------------------------

/**
 * The identity a request that states no usable `operationId` is answered under.
 *
 * Read before validation, exactly as the runner reads it: a request from a browser is untrusted, and
 * a refusal still needs an identity to answer under even when the body states none.
 */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** Reads the attempt identity from a request body without trusting its type. */
function operationIdOf(input: unknown): string {
  if (!isPlainObject(input)) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const candidate: unknown = Reflect.get(input, "operationId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : UNIDENTIFIED_ATTEMPT;
}

/**
 * The session this attempt acts for, or the refusal that ends it.
 *
 * The two halves are stated apart rather than collapsing a refusal into `undefined`, so the answer a
 * request receives carries the refusal the resolver actually gave instead of a coded-in default — a
 * denial when the request names no stored session, and the store's own outage when it could not answer.
 */
type AttemptSession =
  | { readonly ok: true; readonly session: ResolvedSession }
  | { readonly ok: false; readonly refusal: SessionRefusal };

/**
 * Resolves the session this attempt acts for, or the refusal that ends it.
 *
 * A mutation's request envelope carries no session identifier, because a request body may never name
 * its own authority: the identity is the development-session cookie, read through
 * `authorize.ts#resolveSession`, which is the service's one resolver. A caller that holds a session
 * id and no request scope — a domain or integration test, an operational script — names it through
 * `source`, which `resolveSession` gates to a development build and which can never become a
 * production path that names its own identity.
 *
 * A resolver that cannot answer at all (no request scope to read a cookie from, or a named session
 * refused outside a development build) is the one refusal it names for that case: nothing authorises
 * this attempt, and no retry can change that.
 */
async function attemptSession(source?: SessionSource): Promise<AttemptSession> {
  try {
    const resolved = await resolveSession(source);
    return resolved.ok
      ? { ok: true, session: resolved.session }
      : { ok: false, refusal: resolved.refusal };
  } catch {
    return { ok: false, refusal: sessionDenial("session-unavailable") };
  }
}

// ---------------------------------------------------------------------------------------------
// The stored state document: the only members this file reads and writes
// ---------------------------------------------------------------------------------------------

/**
 * The one part of a session's documents a membership change touches.
 *
 * The store hands a mutation its whole documents with the state document opaque (`unknown`), because
 * the store owns no record shape. This interface names the only member read here, so the helpers
 * below accept the runner's documents without importing a store type and without claiming to know
 * the rest of the document — which is what lets every family this file does not touch be carried
 * through a write unchanged.
 */
interface StateDocumentHolder {
  state: unknown;
}

/**
 * The fault name `outcome.ts` recognises as "this stored document cannot be decoded".
 *
 * A session whose state document this build cannot read is not a session that holds no memberships:
 * answering it as empty would silently permit a second membership or lose every row on the next
 * write. The runner converts this fault into `unavailable` for the local store, which is the honest
 * answer, and the name is the marker that module documents for it.
 */
const CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

/** Raises the unreadable-document condition without naming a path, an entry or a payload. */
class UnreadableStateDocumentError extends Error {
  constructor(part: string) {
    super(`The session's state document cannot be read: ${part}. Nothing was written.`);
    this.name = CORRUPT_DOCUMENT_FAULT;
    // Keeps `instanceof` working where a built-in subclass is downlevelled past ES2015 semantics.
    Object.setPrototypeOf(this, UnreadableStateDocumentError.prototype);
  }
}

/** Reports whether a value is a plain object, as a stored JSON object is once decoded. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the membership rows out of a session's state document, or refuses the document.
 *
 * The parse is narrow on purpose: only `memberships` is validated, through the one stored schema
 * `envelope.ts` declares, and every other family stays untouched in the raw document so the write
 * below can carry it forward. A document that is not an object, or whose rows do not parse, is
 * refused rather than read as an empty collection.
 */
function membershipsOf(holder: StateDocumentHolder): StoredMembership[] {
  const state: unknown = holder.state;
  if (!isPlainObject(state)) {
    throw new UnreadableStateDocumentError("it is not an object");
  }
  const parsed = z.array(membershipRecordSchema).safeParse(state.memberships);
  if (!parsed.success) {
    throw new UnreadableStateDocumentError("it holds no readable membership rows");
  }
  return [...parsed.data];
}

/**
 * Writes the membership rows back, leaving every other family exactly as it was found.
 *
 * The document is replaced rather than mutated in place, so the transaction's draft holds one new
 * state value and no reader of the old one can observe a half-applied write.
 */
function withMemberships(
  holder: StateDocumentHolder,
  memberships: readonly StoredMembership[],
): void {
  const state: unknown = holder.state;
  if (!isPlainObject(state)) {
    throw new UnreadableStateDocumentError("it is not an object");
  }
  holder.state = { ...state, memberships };
}

// ---------------------------------------------------------------------------------------------
// Stored form and domain record: the one adapter each needs
// ---------------------------------------------------------------------------------------------

/** Reads a stored instant, or `undefined` when the value is not one this build can resolve. */
function instantOf(value: string | null): Temporal.Instant | undefined {
  if (value === null || value.length === 0) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}

/**
 * The change counter a stored revision token states.
 *
 * The stored form states its counter as a token (`rev-1`) while the domain record carries a number
 * that only its own transitions advance. The digits of the token are read, and a token with none
 * counts as its first state — the same reading `data-service/reads/audience.ts` makes of the same
 * token, so a read and a change agree about how many changes a record has seen.
 */
function revisionOrdinal(revision: string): number {
  const digits = /([0-9]+)$/u.exec(revision);
  if (digits === null) {
    return 1;
  }
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The stored token for a change counter. The stored shape of a membership states `rev-<counter>`,
 * and every write this file makes mints its token here, so a token always advances past the one the
 * caller presented.
 */
function revisionTokenOf(ordinal: number): string {
  return `rev-${String(ordinal)}`;
}

/**
 * Adapts one stored membership to the record the audience module decides from.
 *
 * The two shapes state the same facts differently, and this is the single place the difference is
 * bridged here:
 * - the person's identity is the membership's own identifier, which is also the recipient a
 *   notification outcome addresses and never an address or a name;
 * - the Off/Immediate choice follows the state, because the stored form keeps one field and a row
 *   that is `off` or `restricted` already carries Off;
 * - a confirmation instant is stated only for an `active` row, which is the only state that means the
 *   address was proven. An `off` row cannot say whether it was proven before it was turned off, so
 *   this reads it as unproven and a later Immediate reopens the proof step rather than assuming
 *   consent: proof is asked for again rather than inferred, which is the safe direction for the one
 *   fact a notice depends on;
 * - the scope is the context the request acts in, because the stored form addresses a membership by
 *   publisher and purpose and leaves its context to the session that holds it.
 * The counter is stated as the ordinal the token carries so the transitions advance from the truth,
 * and the token minted after them is what a caller presents next.
 */
function domainMembershipOf(record: StoredMembership, scope: MembershipScope): DomainMembership {
  const acceptedAt = instantOf(record.acceptedAt);
  const confirmation = instantOf(record.confirmationDeadline);
  const choice: MemberChoice =
    record.state === "off" || record.state === "restricted" ? "off" : "immediate";
  return {
    membershipId: record.membershipId,
    scope,
    publisherId: record.publisherId,
    purpose: record.purpose,
    recipientId: record.membershipId,
    email: record.email,
    state: record.state,
    choice,
    languagePreference: record.languagePreference ?? "",
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(acceptedAt !== undefined && record.state === "active" ? { confirmedAt: acceptedAt } : {}),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
    revision: revisionOrdinal(record.revision),
  };
}

/**
 * The acceptance instant the stored form records for a transitioned record.
 *
 * The stored form carries one instant for two facts — when the person accepted, and when the address
 * was proven — and it is what separates an `off` row that was proven and then turned off from one
 * that only ever chose Off. So the instant written is the confirmation when there is one, and the
 * live acceptance while the proof step is still open; a row that left the proof step without
 * confirming records no acceptance, because writing the abandoned acceptance would let a
 * never-proven row read as though the address had been proven.
 */
function storedAcceptanceOf(previous: StoredMembership, next: DomainMembership): string | null {
  if (next.state === "awaiting-proof") {
    return next.acceptedAt === undefined ? null : next.acceptedAt.toString();
  }
  if (next.confirmedAt !== undefined) {
    return next.confirmedAt.toString();
  }
  return next.state === "active" ? (next.acceptedAt?.toString() ?? previous.acceptedAt) : null;
}

/**
 * Writes a transitioned domain record back as the stored record, advancing its revision token.
 *
 * Only the members the transitions own are taken from the domain record. The address, the display
 * name, the publisher and the purpose come from the row that was found, because no mutation here
 * changes which address is addressed or whose publisher it is — a new address needs its own proof and
 * is not expressible from these payloads. An empty language preference is stored as `null`, which is
 * how the stored form states that no language has been chosen, and a record that no longer holds an
 * acceptance holds no confirmation deadline either, so no window is left dangling beside it.
 */
function storedMembershipFrom(
  previous: StoredMembership,
  next: DomainMembership,
): StoredMembership {
  const acceptedAt = storedAcceptanceOf(previous, next);
  return {
    membershipId: previous.membershipId,
    email: previous.email,
    displayName: previous.displayName,
    publisherId: previous.publisherId,
    purpose: previous.purpose,
    state: next.state,
    acceptedAt,
    confirmationDeadline:
      acceptedAt === null
        ? null
        : next.confirmationDeadline === undefined
          ? previous.confirmationDeadline
          : next.confirmationDeadline.toString(),
    languagePreference:
      next.languagePreference.length === 0 ? previous.languagePreference : next.languagePreference,
    revision: revisionTokenOf(next.revision),
  };
}

/** The stored record a signup creates, from the pending membership the domain module opened. */
function newStoredMembership(
  membership: DomainMembership,
  displayName: string | null,
): StoredMembership {
  return {
    membershipId: membership.membershipId,
    email: membership.email,
    displayName,
    publisherId: membership.publisherId,
    purpose: membership.purpose,
    state: membership.state,
    acceptedAt: membership.acceptedAt === undefined ? null : membership.acceptedAt.toString(),
    confirmationDeadline:
      membership.confirmationDeadline === undefined
        ? null
        : membership.confirmationDeadline.toString(),
    languagePreference:
      membership.languagePreference.length === 0 ? null : membership.languagePreference,
    revision: revisionTokenOf(membership.revision),
  };
}

/**
 * What a conflict reports as the record's current value: its standing, never its address or name.
 *
 * A conflict is shown beside the caller's preserved input, and the comparison it exists for is about
 * state, choice, language and revision. The address and the display name are left out because they
 * take no part in that comparison and because a value that looks like an address must never become
 * something two records are matched by.
 */
type MembershipStanding = {
  readonly membershipId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly state: MembershipState;
  readonly acceptedAt: string | null;
  readonly confirmationDeadline: string | null;
  readonly languagePreference: string | null;
  readonly revision: string;
};

/** Projects one stored membership to the standing a conflict reports. */
function standingOf(record: StoredMembership): MembershipStanding {
  return {
    membershipId: record.membershipId,
    publisherId: record.publisherId,
    purpose: record.purpose,
    state: record.state,
    acceptedAt: record.acceptedAt,
    confirmationDeadline: record.confirmationDeadline,
    languagePreference: record.languagePreference,
    revision: record.revision,
  };
}

/**
 * Locates one row in the transaction's documents and states its current revision.
 *
 * `readCurrent` is how a mutation tells the runner which stored revision a stale expectation must be
 * compared against. An absent row states `absent` rather than a fabricated revision, so a change whose
 * target this build cannot find answers `unchanged` instead of claiming a conflict it cannot describe.
 */
function currentTargetOf(
  holder: StateDocumentHolder,
  locate: (memberships: readonly StoredMembership[]) => StoredMembership | undefined,
): CurrentTarget {
  const record = locate(membershipsOf(holder));
  return record === undefined
    ? { kind: "absent" }
    : { kind: "record", revision: record.revision, value: standingOf(record) };
}

// ---------------------------------------------------------------------------------------------
// The closed payload vocabularies
// ---------------------------------------------------------------------------------------------

/**
 * The shape of a language tag: a two- or three-letter primary subtag followed by its hyphenated
 * subtags (`en`, `fr-CA`, `ar`, `zh-Hant-TW`).
 *
 * Shape only. Matching a tag to an edition, and resolving the fallback when this publisher has no
 * edition in that language, belong to the content module; nothing here decides direction, fallback or
 * directionality, and nothing here treats a reading language as consent.
 */
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

/**
 * The one purpose a membership can be for.
 *
 * Closed rather than an open string: this release keeps memberships for one publisher's topic-specific
 * Update email, and a second purpose — an announcement, an appeal, a digest — is a product change
 * carrying its own consent, not a value a request may introduce.
 */
const purposeSchema = z.literal(
  UPDATE_EMAIL_PURPOSE,
  `This release keeps memberships for one purpose only (${UPDATE_EMAIL_PURPOSE}); another purpose would need its own consent.`,
);

/**
 * The two choices the audience offers, closed to the pair the membership module declares.
 *
 * There is no digest, no cadence and no "occasionally": each would need its own consent and its own
 * scheduling of an effect this release deliberately does not perform.
 */
const choiceSchema = z.enum(
  MEMBER_CHOICES,
  `The audience offers Off and Immediate only; ${MEMBER_CHOICES.join(" and ")} are the two choices.`,
);

/** A publisher reference: the opaque value the record stores, never parsed and never an address. */
const publisherIdSchema = z
  .string()
  .min(1, "A membership names the publisher whose Update email it is for.")
  .max(200, "A publisher reference is at most 200 characters.");

/**
 * The address the person wants notices sent to: a value with an address shape, and nothing more.
 *
 * It is stored on the membership as a value. It establishes neither identity nor consent, it is never
 * a join key, and it is never compared with a partner row, an imported row or a source column.
 */
const emailSchema = z.email(
  "This is not a complete email address. The address is stored as a value on the membership and is never used to find, merge or link a record.",
);

/** An optional display name: the person's own wording, never an identity and never a key. */
const displayNameSchema = z
  .string()
  .min(1, "A display name is at least one character, or left out.")
  .max(120, "A display name is at most 120 characters.");

/** An optional reading language, held apart from the choice and from proof of the address. */
const languagePreferenceSchema = z
  .string()
  .regex(LANGUAGE_TAG_SHAPE, "A language preference is a BCP-47 tag such as en, fr-CA or ar.")
  .max(35, "A language tag is at most 35 characters.");

/**
 * A membership identifier: the opaque identity of one person's membership inside one context.
 *
 * It is the recipient identity a notification outcome addresses, so it is never an address, a name or
 * a value that merely looks like one.
 */
const membershipIdSchema = z
  .string()
  .min(1, "This request names the membership it addresses.")
  .max(200, "A membership identifier is at most 200 characters.");

/**
 * A deliberate signup for one publisher's Update email.
 *
 * Every schema in this file is stated without a transform, and that is deliberate: the mutation's
 * `apply` reads the payload the request carried, so a schema that trimmed or normalised a value would
 * make what is written differ from what the runner validated. A value outside the accepted shape is
 * refused as `invalid` with the field's own message rather than repaired here.
 */
const signupPayloadSchema = z.strictObject({
  publisherId: publisherIdSchema,
  purpose: purposeSchema,
  email: emailSchema,
  displayName: displayNameSchema.optional(),
  languagePreference: languagePreferenceSchema.optional(),
});

/** An explicit confirmation of one membership's address. */
const confirmPayloadSchema = z.strictObject({ membershipId: membershipIdSchema });

/**
 * The Off or Immediate decision, with an optional change of reading language in the same request.
 *
 * The two are separate effects and each is reported separately, because a language is not consent:
 * changing it neither subscribes nor unsubscribes, it never resets a confirmation window and it never
 * widens access to a protected edition.
 */
const preferencePayloadSchema = z.strictObject({
  membershipId: membershipIdSchema,
  choice: choiceSchema,
  languagePreference: languagePreferenceSchema.optional(),
});

/** An unsubscribe for exactly one publisher and one purpose. */
const unsubscribePayloadSchema = z.strictObject({
  publisherId: publisherIdSchema,
  purpose: purposeSchema,
});

/** What a deliberate signup states. */
type SignupPayload = z.infer<typeof signupPayloadSchema>;

/** What an explicit confirmation states. */
type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;

/** What a preference change states. */
type PreferencePayload = z.infer<typeof preferencePayloadSchema>;

/** What an unsubscribe states. */
type UnsubscribePayload = z.infer<typeof unsubscribePayloadSchema>;

// ---------------------------------------------------------------------------------------------
// The authority question
// ---------------------------------------------------------------------------------------------

/**
 * The identity the authority question is answered under.
 *
 * A question is not an attempt: it changes nothing, so it can never be replayed and mints no
 * identity of its own. The runner rebuilds the denial it receives with the request's own
 * `operationId`, which is why only the reason code travels out of here.
 */
const AUTHORITY_QUESTION_ID = "authority-question";

/**
 * Reports whether the request addresses the caller's own membership.
 *
 * A membership's identity is publisher, purpose and recipient, and the recipient is the person's own
 * opaque identifier. So the question a record-addressed audience mutation must answer before anything
 * is read is whether the membership the request names is the caller's own — and a request that names
 * another person's membership is refused here, with a reason code that says nothing about whether
 * that membership exists.
 *
 * The runner asks this before it opens a transaction, so the stored row is not in hand yet; `apply`
 * asks the same question again against the record it finds, through `authorize.ts#canEdit`, which is
 * where the rule is implemented. An undefined claim is refused for the same reason a mismatched one
 * is: the request has not established that it addresses the caller's own row.
 */
function addressedByCaller(
  session: ResolvedSession,
  membershipId: string | undefined,
): ScopeDecision {
  if (membershipId === undefined || membershipId !== session.principalId) {
    return {
      ok: false,
      denial: denied({ operationId: AUTHORITY_QUESTION_ID, reasonCode: "no-permission" }),
    };
  }
  return { ok: true };
}

/**
 * Reads the membership identity a request claims to address, from the untrusted envelope.
 *
 * A request body is untrusted, so the value is read structurally rather than assumed. By the time the
 * runner asks a mutation's authority question the payload has already been validated against the
 * schema above, so a well-formed request yields its identity here and a malformed one is answered
 * `invalid` before it can reach the question at all; the identity it names is checked, never trusted.
 */
function claimedMembershipId(input: unknown): string | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }
  const payload: unknown = Reflect.get(input, "payload");
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const candidate: unknown = Reflect.get(payload, "membershipId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * The context a membership write acts in, as the audience module states it.
 *
 * The stored form leaves a membership's context to the session that holds it, so this is the scope the
 * request brought — already asserted as one the caller is admitted to — reduced to the two identifiers
 * the domain record states.
 */
function membershipScopeOf(scope: MutationInput<unknown>["scope"]): MembershipScope {
  return { organizationId: scope.organizationId, ministryId: scope.ministryId };
}

// ---------------------------------------------------------------------------------------------
// What each mutation answers with
// ---------------------------------------------------------------------------------------------

/**
 * What a deliberate signup answers with: the membership it opened and the neutral pending step.
 *
 * `proof.claimsMailSent` is false because this application submits no mail: the confirmation message
 * is rendered here, and no surface may read this result as a message that left the application.
 */
type SignupResult = {
  readonly membershipId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly state: MembershipState;
  readonly revision: string;
  readonly confirmationDeadline: string | null;
  readonly proof: {
    readonly status: "pending";
    readonly claimsMailSent: false;
    readonly nextStep: "confirm-from-the-rendered-message";
  };
};

/** What an explicit confirmation answers with: the membership now standing as active. */
type ConfirmResult = {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly confirmedAt: string | null;
  readonly revision: string;
};

/**
 * What a preference change answers with, including which of its two effects actually changed.
 *
 * The two are reported apart so a surface can say that a language changed and the choice did not, and
 * treating a language as consent is impossible when the result states them separately.
 */
type PreferenceResult = {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly choice: MemberChoice;
  readonly languagePreference: string | null;
  readonly revision: string;
  readonly changed: {
    readonly choice: boolean;
    readonly languagePreference: boolean;
  };
};

/**
 * What an unsubscribe answers with.
 *
 * `claimsRecall` is false and cannot be anything else: the decision stops future notices for this
 * publisher and purpose, and no surface may present it as having recalled a copy the local submission
 * already accepted or one whose outcome is unknown.
 */
type UnsubscribeResult = {
  readonly membershipId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly state: MembershipState;
  readonly choice: MemberChoice;
  readonly revision: string;
  readonly claimsRecall: false;
};

// ---------------------------------------------------------------------------------------------
// A refused confirmation
// ---------------------------------------------------------------------------------------------

/**
 * Builds the `invalid` payload a refused confirmation answers with.
 *
 * The closed outcome set has no member for a domain refusal and no free-form reason beside an outcome,
 * so a refusal the domain module reports travels as the per-field message of `invalid` — the one arm
 * that carries a message, performs no side effect and leaves the record untouched. The message opens
 * with the domain module's own closed reason, so the reason a person is shown and the reason a test
 * reads are the same words rather than a paraphrase.
 */
function refusedConfirmation(reason: ConfirmationRefusalReason, message: string): ZodError {
  return new ZodError([
    { code: "custom", path: ["membershipId"], message: `${reason}: ${message}` },
  ]);
}

/**
 * States why a confirmation the domain module refused cannot be honoured, and refuses it.
 *
 * Nothing here extends a window: the deadline is a function of the acceptance already recorded, which
 * is why a reload, a retry and a message sent again all reach the same instant.
 */
function refuseConfirmation(
  record: StoredMembership,
  reason: ConfirmationRefusalReason,
  at: Temporal.Instant,
): never {
  switch (reason) {
    case "confirmation-expired": {
      const acceptedAt = instantOf(record.acceptedAt);
      const closedAt =
        acceptedAt === undefined
          ? undefined
          : confirmationDeadline({ acceptedAt, now: at }).deadlineInstant;
      throw refusedConfirmation(
        reason,
        closedAt === undefined
          ? "This membership records no acceptance, so there is no window for a confirmation to fall inside."
          : `The confirmation window ended at ${closedAt.toString()}, so a confirmation at that instant or later is refused. The window is fixed by the acceptance already recorded: a reload, a retry and a message sent again never extend it.`,
      );
    }
    case "not-awaiting-proof":
      throw refusedConfirmation(
        reason,
        record.state === "active"
          ? "This membership is already active, so there is nothing for a confirmation to prove."
          : `This membership is ${record.state}, so it is not waiting for proof. Only a membership in the proof step can be confirmed: an off or restricted membership is never turned on by a confirmation, and choosing Immediate is the person's own act.`,
      );
    case "source-excluded":
      throw refusedConfirmation(
        reason,
        "This row was supplied by a source system and is excluded, so no confirmation activates it.",
      );
  }
}

// ---------------------------------------------------------------------------------------------
// The changes
// ---------------------------------------------------------------------------------------------

/**
 * Opens one purpose-specific membership in the proof step, and claims nothing beyond that.
 *
 * The new row takes the caller's own identity as its membership identifier, so the person who asked
 * is the person the membership is addressed to. A repeat signup for the same publisher and purpose —
 * whatever address or name it states — finds that row and answers `unchanged`: it creates no second
 * membership, re-addresses no existing one and never activates a row that is off, restricted or
 * excluded. Importing or editing a contact reaches none of this, which is why a `subscribed`-looking
 * column produces no membership and no consent.
 */
function applySignup(
  context: MutationContext,
  payload: SignupPayload,
  scope: MembershipScope,
): ApplyResult<SignupResult> {
  const at = instantAt(context.session.clockOffsetMs);
  const memberships = membershipsOf(context.docs);
  const identity = context.session.principalId;

  const existing = memberships.find(
    (row) =>
      row.publisherId === payload.publisherId &&
      row.purpose === payload.purpose &&
      row.membershipId === identity,
  );
  if (existing !== undefined) {
    return { changed: false };
  }

  const { membership, proof } = newPendingMembership(
    {
      membershipId: identity,
      scope,
      publisherId: payload.publisherId,
      purpose: payload.purpose,
      recipientId: identity,
      email: payload.email,
      languagePreference: payload.languagePreference ?? "",
    },
    at,
  );
  const stored = newStoredMembership(membership, payload.displayName ?? null);
  withMemberships(context.docs, [...memberships, stored]);

  return {
    changed: true,
    revision: stored.revision,
    created: [stored.membershipId],
    result: {
      membershipId: stored.membershipId,
      publisherId: stored.publisherId,
      purpose: stored.purpose,
      state: stored.state,
      revision: stored.revision,
      confirmationDeadline: stored.confirmationDeadline,
      proof: {
        status: proof.status,
        claimsMailSent: proof.claimsMailSent,
        nextStep: proof.nextStep,
      },
    },
  };
}

/**
 * Confirms one membership's address, and only that fact.
 *
 * The address is proven for this publisher and purpose alone: no protected-reading grant follows, no
 * donation changes and no preference is set here. A membership that is already active answers
 * `unchanged`, because there is nothing left to prove; a membership that is off, restricted or outside
 * its window is refused through {@link refuseConfirmation} with the domain module's own reason.
 */
function applyConfirmation(
  context: MutationContext,
  payload: ConfirmPayload,
  scope: MembershipScope,
): ApplyResult<ConfirmResult> {
  const at = instantAt(context.session.clockOffsetMs);
  const memberships = membershipsOf(context.docs);
  const record = memberships.find((row) => row.membershipId === payload.membershipId);
  if (record === undefined) {
    // Nothing of the caller's is addressed here, so nothing changes and nothing is disclosed.
    return { changed: false };
  }

  const domain = domainMembershipOf(record, scope);
  const access = canEdit(context.session, { kind: "membership", record: domain });
  if (!access.allowed) {
    return { changed: false };
  }

  const confirmed = confirmAt(domain, at);
  if (confirmed.status === "refused") {
    if (confirmed.reason === "not-awaiting-proof" && record.state === "active") {
      return { changed: false };
    }
    return refuseConfirmation(record, confirmed.reason, at);
  }

  const stored = storedMembershipFrom(record, confirmed.membership);
  withMemberships(
    context.docs,
    memberships.map((row) => (row.membershipId === stored.membershipId ? stored : row)),
  );

  return {
    changed: true,
    revision: stored.revision,
    changedIds: [stored.membershipId],
    result: {
      membershipId: stored.membershipId,
      state: stored.state,
      confirmedAt: stored.acceptedAt,
      revision: stored.revision,
    },
  };
}

/**
 * Records the person's Off or Immediate decision and, separately, a reading-language change.
 *
 * Both effects are applied by the membership module's own transitions, so "Immediate on a record that
 * has not passed proof reopens the proof step without extending a window that is already running" is
 * stated once, in that module. A restricted row is returned by that transition unchanged: a source
 * restriction is not a preference, so no choice turns one on. Neither effect grants protected reading,
 * changes a donation or constitutes contact permission.
 */
function applyPreference(
  context: MutationContext,
  payload: PreferencePayload,
  scope: MembershipScope,
): ApplyResult<PreferenceResult> {
  const at = instantAt(context.session.clockOffsetMs);
  const memberships = membershipsOf(context.docs);
  const record = memberships.find((row) => row.membershipId === payload.membershipId);
  if (record === undefined) {
    return { changed: false };
  }

  const domain = domainMembershipOf(record, scope);
  const access = canEdit(context.session, { kind: "membership", record: domain });
  if (!access.allowed) {
    return { changed: false };
  }

  const afterChoice = withChoice(domain, payload.choice, at);
  const choiceChanged = afterChoice !== domain;
  const afterLanguage =
    payload.languagePreference === undefined
      ? afterChoice
      : withLanguagePreference(afterChoice, payload.languagePreference);
  const languageChanged = afterLanguage !== afterChoice;
  if (!choiceChanged && !languageChanged) {
    return { changed: false };
  }

  const stored = storedMembershipFrom(record, afterLanguage);
  withMemberships(
    context.docs,
    memberships.map((row) => (row.membershipId === stored.membershipId ? stored : row)),
  );

  return {
    changed: true,
    revision: stored.revision,
    changedIds: [stored.membershipId],
    result: {
      membershipId: stored.membershipId,
      state: stored.state,
      choice: stored.state === "off" || stored.state === "restricted" ? "off" : "immediate",
      languagePreference: stored.languagePreference,
      revision: stored.revision,
      changed: { choice: choiceChanged, languagePreference: languageChanged },
    },
  };
}

/**
 * Turns one person's membership for one publisher and one purpose off, and touches nothing else.
 *
 * The row is located by publisher, purpose and the caller's own identity, so a membership for another
 * publisher, another purpose or another person keeps its state, its choice and its history. The
 * transition is the audience module's own unsubscribe, which keeps the record — the membership state
 * is the record that this person is off, so there is no second suppression list to disagree with it —
 * and which claims no recall of a copy already accepted.
 */
function applyUnsubscribe(
  context: MutationContext,
  payload: UnsubscribePayload,
  scope: MembershipScope,
): ApplyResult<UnsubscribeResult> {
  const at = instantAt(context.session.clockOffsetMs);
  const memberships = membershipsOf(context.docs);
  const identity = context.session.principalId;

  const record = memberships.find(
    (row) =>
      row.publisherId === payload.publisherId &&
      row.purpose === payload.purpose &&
      row.membershipId === identity,
  );
  if (record === undefined) {
    return { changed: false };
  }

  const domain = domainMembershipOf(record, scope);
  const access = canEdit(context.session, { kind: "membership", record: domain });
  if (!access.allowed) {
    return { changed: false };
  }

  const transition = recordOffChoice(
    {
      memberships: [domain],
      publisherId: record.publisherId,
      purpose: record.purpose,
      recipientId: record.membershipId,
    },
    at,
  );
  const next = transition.memberships[0];
  if (transition.changedMembershipId === null || next === undefined) {
    return { changed: false };
  }

  const stored = storedMembershipFrom(record, next);
  withMemberships(
    context.docs,
    memberships.map((row) => (row.membershipId === stored.membershipId ? stored : row)),
  );

  return {
    changed: true,
    revision: stored.revision,
    changedIds: [stored.membershipId],
    result: {
      membershipId: stored.membershipId,
      publisherId: stored.publisherId,
      purpose: stored.purpose,
      state: stored.state,
      choice: "off",
      revision: stored.revision,
      claimsRecall: false,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The four named mutations
// ---------------------------------------------------------------------------------------------

/**
 * Opens one purpose-specific membership for the caller and leaves it waiting for proof.
 *
 * Outcomes: `accepted` (a new membership in `awaiting-proof`, with the neutral pending step),
 * `alreadyAccepted` (a replay of this attempt, answered from the ledger), `unchanged` (the caller
 * already holds a membership for this publisher and purpose), `invalid` (the payload's own field
 * messages), `denied` (no usable session, no admitted context, or no authority),
 * `conflict` (a reused attempt identity with changed intent), `unavailable` (the local store could not
 * answer) and `unknown` (the effect may have been applied and the acknowledgement was lost).
 */
export async function signupForPurpose(
  input: MutationInput<SignupPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const attempt = await attemptSession(source);
  if (!attempt.ok) {
    return outcomeOfRefusal(attempt.refusal, operationIdOf(input));
  }

  return runMutation<SignupPayload, SignupResult>({
    sessionId: attempt.session.sessionId,
    input,
    schema: signupPayloadSchema,
    name: "signupForPurpose",
    authorize: () => ({ ok: true }),
    apply: (context) => applySignup(context, input.payload, membershipScopeOf(input.scope)),
  });
}

/**
 * Confirms one membership's address, on the person's explicit action and inside its window only.
 *
 * This is reached by a deliberate confirmation and by nothing else: no read, page load, link preview
 * or repeated view calls it, so no confirmation happens because a surface rendered. The window is one
 * week of elapsed hours from the acceptance already recorded, strict at equality, and the closed
 * reason it refuses with is the audience module's own `confirmation-expired`.
 *
 * Outcomes: `accepted` (the membership is now active), `alreadyAccepted` (a replay), `unchanged` (it
 * was already active, or no membership of the caller's is addressed here), `invalid` (the payload, or
 * a confirmation the domain module refused, with the reason in the field message), `denied`,
 * `conflict`, `unavailable`, `unknown`.
 */
export async function confirmMembership(
  input: MutationInput<ConfirmPayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const attempt = await attemptSession(source);
  if (!attempt.ok) {
    return outcomeOfRefusal(attempt.refusal, operationIdOf(input));
  }

  return runMutation<ConfirmPayload, ConfirmResult>({
    sessionId: attempt.session.sessionId,
    input,
    schema: confirmPayloadSchema,
    name: "confirmMembership",
    authorize: (resolved) => addressedByCaller(resolved, claimedMembershipId(input)),
    readCurrent: (docs) =>
      currentTargetOf(docs, (memberships) =>
        memberships.find((row) => row.membershipId === claimedMembershipId(input)),
      ),
    apply: (context) => applyConfirmation(context, input.payload, membershipScopeOf(input.scope)),
  });
}

/**
 * Records the person's Off or Immediate decision, and a reading language if the request states one.
 *
 * The choice and the language are two effects: each is reported separately in the result, the
 * language neither subscribes nor unsubscribes, and neither resets nor cancels a notification intent
 * already accepted. A preference is not contactability, not protected reading and not a donation.
 *
 * Outcomes: `accepted` (one or both effects changed), `alreadyAccepted` (a replay), `unchanged` (the
 * membership already stands as requested, or a restriction left it as it was), `invalid`, `denied`,
 * `conflict`, `unavailable`, `unknown`.
 */
export async function setPreference(
  input: MutationInput<PreferencePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const attempt = await attemptSession(source);
  if (!attempt.ok) {
    return outcomeOfRefusal(attempt.refusal, operationIdOf(input));
  }

  return runMutation<PreferencePayload, PreferenceResult>({
    sessionId: attempt.session.sessionId,
    input,
    schema: preferencePayloadSchema,
    name: "setPreference",
    authorize: (resolved) => addressedByCaller(resolved, claimedMembershipId(input)),
    readCurrent: (docs) =>
      currentTargetOf(docs, (memberships) =>
        memberships.find((row) => row.membershipId === claimedMembershipId(input)),
      ),
    apply: (context) => applyPreference(context, input.payload, membershipScopeOf(input.scope)),
  });
}

/**
 * Turns the caller's membership for one publisher and one purpose off, and leaves every other
 * membership untouched.
 *
 * It claims no recall: a copy the local submission already accepted, and one whose outcome is still
 * unknown, stay exactly as recorded, and the receipt this answers with says so in its own shape.
 *
 * Outcomes: `accepted` (the membership is now off), `alreadyAccepted` (a replay), `unchanged` (it was
 * already off, or the caller holds no membership for this publisher and purpose), `invalid`,
 * `denied`, `conflict`, `unavailable`, `unknown`.
 */
export async function unsubscribe(
  input: MutationInput<UnsubscribePayload>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  const attempt = await attemptSession(source);
  if (!attempt.ok) {
    return outcomeOfRefusal(attempt.refusal, operationIdOf(input));
  }

  return runMutation<UnsubscribePayload, UnsubscribeResult>({
    sessionId: attempt.session.sessionId,
    input,
    schema: unsubscribePayloadSchema,
    name: "unsubscribe",
    authorize: () => ({ ok: true }),
    readCurrent: (docs) =>
      currentTargetOf(docs, (memberships) =>
        memberships.find(
          (row) =>
            row.publisherId === input.payload.publisherId &&
            row.purpose === input.payload.purpose &&
            row.membershipId === attempt.session.principalId,
        ),
      ),
    apply: (context) => applyUnsubscribe(context, input.payload, membershipScopeOf(input.scope)),
  });
}
