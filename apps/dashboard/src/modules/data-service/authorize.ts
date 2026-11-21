/**
 * The single scope resolver and the single place a permission question is answered.
 *
 * **Authorisation precedes enumeration.** Every function here denies without a count, a title, an
 * existence flag, a size or an echoed identifier, so search, sorting, pagination and any other
 * narrowing a caller can ask for cannot be turned into a disclosure oracle: a caller that may not
 * see a record learns the same thing whether the record exists or not. That sentence is the rule
 * this file exists to enforce, and it is why the refusal shape below never varies.
 *
 * What this module is, and is not. It derives a caller's authority from the development-session
 * cookie and the session documents the store holds, and it answers four permission questions about a
 * named record: may it be viewed, may it be edited, may a query be exported, may protected content be
 * read. It is not an authentication system: there is no password, token, OAuth flow, refresh
 * protocol, identity provider, role administration or capability registry, because the release
 * excludes all of them (AAP 0.3.3, 0.10.2) and Rule 1's first clause forbids scaffolding any of them.
 * The seam a later identity integration replaces is the {@link Scope} shape and the one resolver —
 * nothing more is built here.
 *
 * Scope comes from the request, never from its body. The session cookie names a session; the
 * session's own `.meta.json` states the principal, the admitted memberships, the admission state,
 * the scenario, the clock offset and the selected context. No request body, query parameter or
 * header can name a scope, and a field that merely looks like an organisation, ministry, support
 * subject or principal identifier grants nothing: the four are different types with different
 * owners, and equal-looking values establish neither identity nor authority (envelope.ts states
 * that rule; this module is where it is applied).
 *
 * Three permission facts stay three, evaluated on every read and never cached anywhere:
 * contactability (may a stored contact method be used), communication consent for one publisher and
 * one purpose (`audience/consent.ts`), and protected-content reader grants
 * ({@link canReadProtected}). They are not interchangeable and none is inferred from another: an
 * active membership is not contactability, a proven address is not consent for a second publisher,
 * and a reader grant admits protected content and grants nothing else. An email address establishes
 * nothing at all.
 *
 * Nothing is memoised. There is no module-level cache, no per-request wrapper and no stored
 * permission decision, because a cached grant is a grant that outlives the fact it was derived from
 * — an ended coaching relationship, a withdrawn release or a session that expired would keep reading
 * until something remembered to clear it. Every call re-reads the session documents and re-derives
 * the answer, so the cost of a permission check is one file read and one pure comparison.
 *
 * Direct callers are enforced too. The seeded second worker, the unauthorised reader and the coach
 * reach this module through the service without a browser in front of them, so no decision here may
 * depend on a UI gate, a rendered control or a client-side check that a direct caller could skip.
 *
 * Layering. This module reads `next/headers` for the session cookie, the store through
 * `repository.readSession`, the audience module for membership facts, and `lib/guards` and
 * `lib/redaction` for the development gate and the denial pass. It imports no component, no feature,
 * no application route, no provider package and no store internals: the store is reached through its
 * one read function, which is what keeps every record behind the same authorisation.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import { assertNoFixtureFallback, isDevelopment } from "@/lib/guards";
import { redactDenial } from "@/lib/redaction";
import {
  isExcludedSourceMembership,
  type AudiencePurpose,
  type MembershipRecord,
} from "@/modules/audience/membership";
import type { ContentAudience } from "@/modules/audience/resolve";
import type { SessionDocuments } from "@/modules/store/paths";
import { readSession } from "@/modules/store/repository";
import { SESSION_COOKIE, readSessionId } from "@/modules/store/sessions";

import {
  admittedMembershipSchema,
  ministryIdSchema,
  organizationIdSchema,
  principalIdSchema,
  sameScope,
  sessionStateSchema,
  supportSubjectIdSchema,
  type AdmittedMembership,
  type CoachingGrantRecord,
  type MinistryId,
  type PrincipalId,
  type RecordAudience,
  type Scope,
  type SessionState,
} from "./envelope";
import { denied, type DenialReason, type DeniedOutcome } from "./outcome";

// ---------------------------------------------------------------------------------------------
// The resolved session
// ---------------------------------------------------------------------------------------------

/**
 * A session as one request sees it: the principal it acts for, how admission stands, the contexts
 * that principal is admitted to, the context it has selected, and the scenario it runs in.
 *
 * `sessionId` identifies the development session and keys its own store documents; it is never a
 * principal, an organisation or a ministry. `sessionState` carries the closed vocabulary declared
 * once in `envelope.ts`, including `no-access`, so the shell can render the one honest outcome for a
 * person whose account exists but admits nothing — recovery guidance, never an empty workspace.
 */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly principalId: PrincipalId;
  readonly sessionState: SessionState;
  readonly admittedMemberships: readonly AdmittedMembership[];
  /** The selected context, or `null` for a session that has not chosen one (or may never choose). */
  readonly selected: Scope | null;
  /**
   * What the person acting in this session may do beyond admission: capability names their owning
   * domain modules test (`modules/support/goal.ts` owns `canEditGoal`, the only one this release has).
   *
   * It travels on the session because no record establishes it — two principals admitted to the same
   * ministry do not hold the same capabilities — and it is empty for a session document that states
   * none, so an unstated capability denies the action rather than granting it.
   */
  readonly capabilities: readonly string[];
  readonly scenarioId: string;
  /**
   * How far the session's controllable clock stands ahead of the seed instant, in milliseconds.
   *
   * It travels here because the service evaluates every window at read or command time; it is read
   * only by the service and by the development panel, and no ordinary surface is handed it.
   */
  readonly clockOffsetMs: number;
}

/**
 * The answer to "which session is this request": the resolved session, or the refusal.
 *
 * A session that exists resolves `ok: true` even when it grants nothing — `expired`, `unavailable`,
 * `denied` and `no-access` are states of a real session, and the shell has to be able to describe
 * them. Only a request that names no session the store holds is refused outright.
 */
export type SessionResolution =
  | { readonly ok: true; readonly session: ResolvedSession }
  | { readonly ok: false; readonly denial: DeniedOutcome };

/**
 * A session named directly rather than derived from the request cookie.
 *
 * The browser path never supplies one: a Route Handler and a Server Component call
 * {@link resolveSession} with no argument and take the cookie. The explicit form exists for the
 * callers that hold a session id and no request scope — the domain and integration tests that prove
 * isolation by naming a seeded session, and the operational scripts — and it is gated to a
 * development build precisely so it can never become a production path that names its own identity.
 */
export interface SessionSource {
  readonly sessionId: string;
}

/**
 * The operation identity a read refusal carries.
 *
 * A read has no attempt identity: nothing was asked to change, so nothing can be replayed. The value
 * states that instead of inventing an identifier, and it keeps the refusal's shape byte-identical to
 * a mutation's — the only field that may differ between two refusals is the reason code. A mutation
 * replaces it with its own `operationId` (`{ ...denial, operationId }`), because for a write the
 * attempt identity is the caller's recovery handle.
 */
const READ_ATTEMPT_ID = "read";

/**
 * Builds the one refusal shape.
 *
 * Every denial this module returns passes through here: the closed reason code states the caller's
 * relationship to the request and never a fact about a record, the operation identity is the read
 * marker above, and the result is redacted so a field added to the outcome later cannot carry an
 * existence flag, a count, a title or a size by accident.
 */
function refuse(reason: DenialReason): DeniedOutcome {
  return redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }));
}

/** Wraps a refusal as the failing half of {@link SessionResolution}. */
function refusedSession(reason: DenialReason): SessionResolution {
  return { ok: false, denial: refuse(reason) };
}

/**
 * The admission gate every question about a record passes through: what the session state permits.
 *
 * Only `signed-in` lets a request proceed. `expired` and `unavailable` name themselves, and a
 * `denied` or `no-access` session is not admitted to anything — it carries no authority, so every
 * read and mutation is refused while the shell may still describe the session from
 * {@link resolveSession}'s own answer.
 */
function sessionGate(session: ResolvedSession): DeniedOutcome | undefined {
  switch (session.sessionState) {
    case "signed-in":
      return undefined;
    case "unavailable":
      return refuse("session-unavailable");
    case "expired":
      return refuse("session-expired");
    case "denied":
    case "no-access":
      return refuse("not-admitted");
  }
}

// ---------------------------------------------------------------------------------------------
// The session's meta document
// ---------------------------------------------------------------------------------------------

/**
 * The members of the session's `.meta.json` this resolver reads.
 *
 * The development runtime owns that document: it is where the scenario, the clock offset, the armed
 * failure plan, the admission state, the principal, the admitted memberships and the selected
 * context are written, so it is the live root of authority rather than a copy of one. The members
 * below are validated through the record schemas `envelope.ts` declares — the single declaration of
 * the vocabulary — and the members this resolver does not need (`version`, `failurePlan`) are
 * ignored rather than refused, so a field added to the document later does not deny every request.
 *
 * The state document also carries a context record, and it is deliberately not consulted here: a
 * context switch writes the meta document, so the state record can legitimately be a step behind,
 * and reading both would make admission depend on which of two copies happened to be written last.
 */
const storedSessionMetaSchema = z.object({
  scenarioId: z.string().min(1),
  clockOffsetMs: z.int(),
  sessionState: sessionStateSchema,
  principalId: principalIdSchema,
  admittedMemberships: z.array(admittedMembershipSchema),
  selectedContext: z
    .object({
      organizationId: organizationIdSchema,
      ministryId: ministryIdSchema,
      supportSubjectId: supportSubjectIdSchema,
    })
    .nullable(),
  // A session document written before the session stated any capability resolves to none, which
  // denies every capability-gated action rather than granting one by omission.
  capabilities: z.array(z.string().min(1)).default([]),
});

/** The members {@link storedSessionMetaSchema} yields, named so the resolver's steps stay readable. */
type StoredSessionMeta = z.infer<typeof storedSessionMetaSchema>;

/**
 * Turns the selected context the meta document states into the scope a read runs under.
 *
 * The principal comes from the session, not from the document's selection: a selection names the
 * organisation, ministry and support subject, and the acting user is a separate reference that no
 * selected context can restate. `null` stays `null` — a session that has chosen no context has none,
 * and inventing one from the first admitted membership would hand a request authority it never asked
 * for.
 */
function selectedScope(session: {
  readonly principalId: PrincipalId;
  readonly selectedContext: StoredSessionMeta["selectedContext"];
}): Scope | null {
  const { selectedContext } = session;
  if (selectedContext === null) {
    return null;
  }
  return {
    organizationId: selectedContext.organizationId,
    ministryId: selectedContext.ministryId,
    supportSubjectId: selectedContext.supportSubjectId,
    principalId: session.principalId,
  };
}

/** Builds the resolved session from the id its documents are stored under and the parsed meta. */
function resolvedSession(sessionId: string, meta: StoredSessionMeta): ResolvedSession {
  return {
    sessionId,
    principalId: meta.principalId,
    sessionState: meta.sessionState,
    admittedMemberships: meta.admittedMemberships,
    selected: selectedScope({
      principalId: meta.principalId,
      selectedContext: meta.selectedContext,
    }),
    capabilities: meta.capabilities,
    scenarioId: meta.scenarioId,
    clockOffsetMs: meta.clockOffsetMs,
  };
}

/**
 * Reads the development-session cookie inside the current request.
 *
 * `next/headers` is loaded here rather than at module scope so a direct caller — the domain tests
 * that name a seeded session, an operational script — never pulls Next's request machinery into its
 * process. The cookie is the only identity a request carries; its attributes (`httpOnly`,
 * `sameSite=lax`, `path=/`) belong to the response that mints it, in the session bootstrap route.
 */
async function requestSessionId(): Promise<string | undefined> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return readSessionId(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Resolves the session this request acts for, or refuses it.
 *
 * The derivation is fixed and short: take the session id from the cookie (or from an explicit source
 * a development caller names), validate it with `store/sessions.ts#readSessionId`, read the session's
 * documents through the store's one read function, and parse the meta document. Everything after
 * that is the session's own statement about itself.
 *
 * An absent cookie, a value that cannot name a session, a session the store does not hold, a
 * document that cannot be decoded and a meta document this build cannot read all answer alike: with
 * one refusal that reveals nothing, because "there is no usable session" is the same fact in each
 * case and there is no honest retry to offer. Production never falls back to fixtures or a default
 * principal, so a request with no session is refused rather than served as somebody (AAP 0.7.2);
 * {@link SessionSource} is the one path that could be mistaken for such a fallback, and it asserts
 * the development boundary before it uses the id.
 *
 * Nothing is cached: the documents are read on every call, so a scenario change, a clock change, a
 * context switch or a reset takes effect on the next request rather than whenever something
 * remembered to invalidate an entry.
 */
export async function resolveSession(source?: SessionSource): Promise<SessionResolution> {
  let sessionId: string | undefined;
  if (source === undefined) {
    sessionId = await requestSessionId();
  } else {
    // Naming a session directly is a development affordance; resolving a named session in a
    // production build would be exactly the fixture fallback the release forbids, so the guard
    // throws there instead of quietly answering for a fabricated identity.
    assertNoFixtureFallback("resolveSession resolving a named session directly", true);
    sessionId = readSessionId(source.sessionId);
  }

  if (sessionId === undefined) {
    return refusedSession("session-unavailable");
  }

  let documents: SessionDocuments | undefined;
  try {
    documents = await readSession(sessionId);
  } catch {
    // A corrupt or unreadable document means the session cannot be established. The refusal says
    // that and nothing else: naming the document, the path or the fault would disclose where the
    // session's records live, and the caller can do nothing with that knowledge it could not do
    // with the refusal itself.
    return refusedSession("session-unavailable");
  }
  if (documents === undefined) {
    return refusedSession("session-unavailable");
  }

  const parsed = storedSessionMetaSchema.safeParse(documents.meta);
  if (!parsed.success) {
    return refusedSession("session-unavailable");
  }

  return { ok: true, session: resolvedSession(sessionId, parsed.data) };
}

// ---------------------------------------------------------------------------------------------
// Scope: the one check a read or a change runs under
// ---------------------------------------------------------------------------------------------

/**
 * The answer to a scope assertion: the scope holds, or the refusal.
 *
 * `ok` rather than `allowed` deliberately: this is not a question about a record but the precondition
 * every record question is asked from, and the two are read differently by a caller — a scope failure
 * ends the request, while a record refusal answers one question about one record.
 */
export type ScopeDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly denial: DeniedOutcome };

/** Reports whether one admitted membership is exactly this organisation, ministry and subject. */
function admitsScope(
  session: ResolvedSession,
  scope: Pick<Scope, "organizationId" | "ministryId" | "supportSubjectId">,
): boolean {
  return session.admittedMemberships.some(
    (membership) =>
      membership.organizationId === scope.organizationId &&
      membership.ministryId === scope.ministryId &&
      membership.supportSubjectId === scope.supportSubjectId,
  );
}

/**
 * Reports whether the principal is admitted to any support subject of this organisation and ministry.
 *
 * A record that names only its organisation and ministry — a membership row states exactly those two
 * — is authorised against the pair, because its support subject is not part of what the record
 * carries. It is the same admission test, answered from the facts the record actually states.
 */
function admitsContext(
  session: ResolvedSession,
  organizationId: string,
  ministryId: string,
): boolean {
  return session.admittedMemberships.some(
    (membership) =>
      membership.organizationId === organizationId && membership.ministryId === ministryId,
  );
}

/**
 * Asserts that a caller may act in a scope at all.
 *
 * Four checks, in this order, and each refusal names the caller's relationship rather than anything
 * it asked about: the session must be in an admitting state; the scope's principal must be the one
 * the session resolved to; the scope's organisation, ministry and support subject must be one
 * admitted membership, all three together; and nothing else is consulted. A well-formed identifier
 * that is not admitted reaches the third check and is refused there, so an identifier's shape,
 * length or resemblance to a real one grants nothing.
 *
 * Any admitted membership is acceptable, not only the selected context: a principal admitted to two
 * ministries may act in either, and the selection decides what a surface opens on rather than what
 * the principal is allowed to reach. A stale envelope can therefore produce a `denied` outcome when
 * its action is submitted, but never an unauthorised write.
 */
export function assertScope(session: ResolvedSession, scope: Scope): ScopeDecision {
  const gate = sessionGate(session);
  if (gate !== undefined) {
    return { ok: false, denial: gate };
  }
  if (scope.principalId !== session.principalId) {
    return { ok: false, denial: refuse("not-admitted") };
  }
  return admitsScope(session, scope)
    ? { ok: true }
    : { ok: false, denial: refuse("no-membership") };
}

/**
 * Asserts that a change kept the record inside the context it started in.
 *
 * Both scopes are authorised on their own first, then compared exactly: a change that would move a
 * record into another organisation, ministry or support subject is refused even when the caller is
 * admitted to the destination, because admission to two contexts is not permission to move a record
 * between them. This is the guard a mutation's runner calls after applying its change, and it is
 * separate from {@link assertScope} rather than folded into it so the two questions stay legible: the
 * one it started from, and the one it produced.
 */
export function assertScopeUnchanged(
  session: ResolvedSession,
  before: Scope,
  after: Scope,
): ScopeDecision {
  const started = assertScope(session, before);
  if (!started.ok) {
    return started;
  }
  const produced = assertScope(session, after);
  if (!produced.ok) {
    return produced;
  }
  return sameScope(before, after) ? { ok: true } : { ok: false, denial: refuse("no-permission") };
}

// ---------------------------------------------------------------------------------------------
// The record kinds a permission question is asked about
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of records a permission question covers, one member per record family the service
 * reads or changes.
 *
 * Each member carries the facts its own decision needs and no more, so a decision is total: a caller
 * cannot ask about a partner without saying which audience the record belongs to, and cannot ask
 * about a coaching read without saying which module and at which instant. Every member that names a
 * context does so with the four-identifier {@link Scope}, so the authority a read ran under travels
 * with the question instead of being assumed from the record.
 *
 * Two members exist that do not name a stored record: `export` is the whole-query download, which is
 * a permission of a context rather than of a row, and `dev-runtime` is the development panel, whose
 * authority is the build the application is running in. `cohort-subject` is the coach's view of a
 * worker, which is authorised from a grant rather than from a ministry membership, because a coach
 * holds no membership in the worker's ministry and must not be given one to read what was shared.
 */
export type AuthorizationTarget =
  | {
      /**
       * A partner record: a person, household, church, other organisation or the worker's own
       * preparation.
       *
       * `audience` is the record's own statement of who may read it: a `private` record is the
       * worker's preparation and is readable only by the principal whose preparation it is.
       * `authorPrincipalId` is that principal, or `null` for a shared record. A private record whose
       * author is not stated is refused: a private-preparation record exists only inside one
       * principal's own session documents, so the caller reading one knows whose it is, and
       * "nobody's" is not an author that could admit a colleague.
       */
      readonly kind: "partner";
      readonly scope: Scope;
      readonly audience: RecordAudience;
      readonly authorPrincipalId: PrincipalId | null;
    }
  | {
      /**
       * A note the worker wrote for themselves: a different record class from a shared fact, and
       * readable and editable by its author alone. Its audience is the literal `private`, so it can
       * never appear in a shared projection, an export or another record's audience.
       */
      readonly kind: "private-note";
      readonly scope: Scope;
      readonly authorPrincipalId: PrincipalId;
    }
  | {
      /** Something that actually happened, recorded in an admitted context. */
      readonly kind: "interaction";
      readonly scope: Scope;
    }
  | {
      /**
       * A task. `ownerPrincipalId` is the principal whose work it is: admission lets a colleague see
       * the ministry's work, but changing someone else's task is not implied by admission, and this
       * release has no delegation that would make it so.
       */
      readonly kind: "task";
      readonly scope: Scope;
      readonly ownerPrincipalId: PrincipalId;
    }
  | {
      /** A task series, owned like the occurrences it admits. */
      readonly kind: "series";
      readonly scope: Scope;
      readonly ownerPrincipalId: PrincipalId;
    }
  | {
      /**
       * An outreach initiative. `ministryId` is the ministry the record states for itself, and it
       * must be the ministry the scope claims, so a record that has drifted out of the scope it is
       * read in is refused rather than authorised by the caller's admission.
       */
      readonly kind: "initiative";
      readonly scope: Scope;
      readonly ministryId: MinistryId;
      readonly responsiblePrincipalId: PrincipalId;
    }
  | {
      /** One independently answerable Request inside an initiative. */
      readonly kind: "request";
      readonly scope: Scope;
    }
  | {
      /** A referral cycle, with its introduction date and the window it resolved to. */
      readonly kind: "referral";
      readonly scope: Scope;
    }
  | {
      /**
       * The finance and support projection a read is scoped to. `capabilities` is the caller's own
       * capability set as the service derived it, and the only edit it can permit is the goal: the
       * single financial write in the application, available only under the explicit goal capability
       * (owned by `modules/support/goal.ts`). Its absence answers `capability-absent`, so a surface
       * without the capability shows no edit control and learns nothing about a goal it may not see.
       */
      readonly kind: "support-subject";
      readonly scope: Scope;
      readonly capabilities: readonly string[];
    }
  | {
      /**
       * One Update or Page variant: a document's audience-and-locale edition with its own draft,
       * candidate and release.
       *
       * Which roles may draft, approve and release is the content module's review policy over the
       * same admission, not a second authority here: this release stores no per-person role, and
       * inventing a capability registry to express one is exactly what the release excludes. What
       * this file states is the authority it can derive — admission to the ministry the content
       * belongs to — and the review step, the freeze and the release head do the rest.
       */
      readonly kind: "content-variant";
      readonly scope: Scope;
    }
  | {
      /**
       * A stored media asset. `scope` is the asset's own recorded scope, not the caller's, so every
       * rendition request — playback, poster, captions, transcript, a byte range — is authorised
       * against the record rather than against whatever context the request arrived in.
       */
      readonly kind: "media-asset";
      readonly scope: Scope;
    }
  | {
      /**
       * One purpose-specific membership: a person's relationship to one publisher's Update email.
       *
       * The record carries its own organisation and ministry and the reader's own opaque identifier.
       * A person may see and change their own preferences, which is how a reader with no ministry
       * membership at all manages the one membership that is theirs; a worker admitted to the
       * ministry may see the audience but may not change anyone's consent, because consent is the
       * person's own act and never an operator's.
       */
      readonly kind: "membership";
      readonly record: MembershipRecord;
    }
  | {
      /**
       * A coaching relationship. Both parties may see it; either may act on it while it is live
       * (the worker to share, extend or revoke; the coach to accept or leave), and neither may act
       * on an ended, revoked or expired relationship. `now` is the instant the request runs at,
       * because the share-through cutoff is evaluated then: a status row that still says `active`
       * after its cutoff has passed denies the read.
       */
      readonly kind: "coaching-grant";
      readonly grant: CoachingGrantRecord;
      readonly now: Temporal.Instant;
    }
  | {
      /**
       * A worker whose granted module a coach is reading: the read-only subject of a portfolio.
       *
       * It carries the grant, the module being read and the instant, because the answer depends on
       * all three: the relationship must be active, the reader must be its coach, the module must be
       * one the worker selected, and the cutoff must not have passed. Nothing here edits: a coach
       * may not change the work they are shown.
       */
      readonly kind: "cohort-subject";
      readonly grant: CoachingGrantRecord;
      readonly module: keyof CoachingGrantRecord["modules"];
      readonly now: Temporal.Instant;
    }
  | {
      /** A whole-query export: a permission of a context, re-checked when the export is produced. */
      readonly kind: "export";
      readonly scope: Scope;
    }
  | {
      /** The development panel: available only in a development build, whatever the session says. */
      readonly kind: "dev-runtime";
    };

/**
 * The answer to one permission question: the action is permitted, or the refusal.
 *
 * It is never a bare boolean, so a surface cannot render a refusal without the reason code that goes
 * with it, and the two halves cannot be confused: `allowed: false` always carries a denial whose
 * shape says nothing about the record it was asked about.
 */
export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly denial: DeniedOutcome };

/** Permits the question. */
function permitted(): AccessDecision {
  return { allowed: true };
}

/** Refuses the question with one closed reason code. */
function refused(reason: DenialReason): AccessDecision {
  return { allowed: false, denial: refuse(reason) };
}

/** Re-expresses an already-built refusal as the answer to a record question. */
function refusedBy(denial: DeniedOutcome): AccessDecision {
  return { allowed: false, denial };
}

// ---------------------------------------------------------------------------------------------
// The four permission questions
// ---------------------------------------------------------------------------------------------

/** Which question is being asked about a target: may it be read, or may it be changed. */
type AccessQuestion = "view" | "edit";

/**
 * Reports whether the caller may read one record.
 *
 * The answer is the same shape for a record that does not exist and one that is not the caller's,
 * because a distinguishable "not found" is an existence oracle: a caller could enumerate hidden
 * records from the reason alone. What differs between a permitted and a refused answer is nothing at
 * all about the record — only whether the caller holds the authority its kind requires.
 */
export function canView(session: ResolvedSession, target: AuthorizationTarget): AccessDecision {
  return decide(session, target, "view");
}

/**
 * Reports whether the caller may change one record.
 *
 * Editing is never implied by being able to read: a colleague admitted to the ministry may see its
 * work without changing another principal's tasks, a reader may see the audience they belong to
 * without changing anyone's consent, and a coach may read what was shared without touching the
 * worker's records. A successful edit also never implies contact permission, a communication
 * consent or a protected-content grant: those are separate facts this function does not answer.
 */
export function canEdit(session: ResolvedSession, target: AuthorizationTarget): AccessDecision {
  return decide(session, target, "edit");
}

/**
 * Asserts that a scope may be acted in, expressed as a record answer.
 *
 * The one translation from {@link assertScope} to {@link AccessDecision}, so a caller composing a
 * record question does not build its own denial and cannot build a differently shaped one.
 */
function inScope(session: ResolvedSession, scope: Scope): AccessDecision {
  const check = assertScope(session, scope);
  return check.ok ? permitted() : refusedBy(check.denial);
}

/**
 * The one decision function, reached by both {@link canView} and {@link canEdit}.
 *
 * One switch serves both questions so a rule is stated once: each case decides what admission alone
 * permits and then narrows it for a change where its own record kind demands. With the development
 * panel answered above it, every remaining kind passes the admission gate first, including the ones
 * that name no scope, because a session that cannot act must not be able to read a coaching
 * relationship merely by asking a question that looks context-free.
 */
function decide(
  session: ResolvedSession,
  target: AuthorizationTarget,
  question: AccessQuestion,
): AccessDecision {
  // The development panel is authorised by the build rather than by admission, and it is answered
  // before the admission gate: switching persona, scenario or clock is how a person leaves a denied,
  // expired or unavailable session, so gating it behind admission would make those states
  // undemonstrable. It is the one question a session that grants nothing may still ask.
  if (target.kind === "dev-runtime") {
    return isDevelopment() ? permitted() : refused("no-permission");
  }

  const gate = sessionGate(session);
  if (gate !== undefined) {
    return refusedBy(gate);
  }

  switch (target.kind) {
    case "partner": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      if (target.audience === "shared") {
        return permitted();
      }
      // Private preparation belongs to one principal. The record itself carries no author field, so
      // the target states it, and an unstated author on a private record is refused rather than
      // treated as "everyone's": admitting it would let an admitted colleague read another person's
      // preparation through a record that simply omitted the field.
      return target.authorPrincipalId === session.principalId
        ? permitted()
        : refused("no-permission");
    }

    case "private-note": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      return target.authorPrincipalId === session.principalId
        ? permitted()
        : refused("no-permission");
    }

    case "interaction":
    case "request":
    case "referral":
    case "content-variant":
    case "media-asset":
      return inScope(session, target.scope);

    case "task":
    case "series": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      if (question === "view") {
        return permitted();
      }
      return target.ownerPrincipalId === session.principalId
        ? permitted()
        : refused("no-permission");
    }

    case "initiative": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      // The record states the ministry it belongs to. A record whose own ministry is not the one the
      // scope claims has drifted out of the context it is being read in, and admission to one context
      // does not authorise a record from another.
      if (target.ministryId !== target.scope.ministryId) {
        return refused("no-permission");
      }
      if (question === "view") {
        return permitted();
      }
      return target.responsiblePrincipalId === session.principalId
        ? permitted()
        : refused("no-permission");
    }

    case "support-subject": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      if (question === "view") {
        return permitted();
      }
      // The goal is the single financial write in this application, and the capability is the only
      // thing that permits it. Capabilities are named by their owner (`modules/support/goal.ts`
      // declares this one); the literal is repeated here because the authorisation layer may not
      // import a domain module's internals, and a renamed capability must fail this check closed.
      return target.capabilities.includes(GOAL_EDIT_CAPABILITY)
        ? permitted()
        : refused("capability-absent");
    }

    case "membership": {
      const isSelf = target.record.recipientId === session.principalId;
      if (question === "edit") {
        // A person's Off or Immediate decision is theirs alone. A worker admitted to the ministry may
        // read the audience; changing someone's consent is not an operator action and creates no
        // permission to send anything.
        return isSelf ? permitted() : refused("no-permission");
      }
      if (isSelf) {
        return permitted();
      }
      return admitsContext(
        session,
        target.record.scope.organizationId,
        target.record.scope.ministryId,
      )
        ? permitted()
        : refused("no-permission");
    }

    case "coaching-grant": {
      const mayAct =
        coachingGrantIsLive(target.grant) && cutoffNotReached(target.grant, target.now);
      const isWorker = session.principalId === target.grant.workerPrincipalId;
      const isCoach = session.principalId === target.grant.coachPrincipalId;
      if (isWorker) {
        // The worker owns the relationship record and sees it in every state, including one they
        // revoked, because the history of what they shared is theirs to review. Acting on it needs a
        // live relationship: a stale control on an ended grant cannot revive it.
        return question === "view" || mayAct ? permitted() : refused("no-permission");
      }
      if (isCoach) {
        return mayAct ? permitted() : refused("no-permission");
      }
      return refused("no-permission");
    }

    case "cohort-subject": {
      // A coach reads and never writes: every edit question about a shared subject is refused, so no
      // coach action can reach the worker's records even if a surface offered one.
      if (question === "edit") {
        return refused("no-permission");
      }
      if (session.principalId !== target.grant.coachPrincipalId) {
        return refused("no-permission");
      }
      if (target.grant.state !== "active") {
        return refused("no-permission");
      }
      if (!cutoffNotReached(target.grant, target.now)) {
        return refused("no-permission");
      }
      return target.grant.modules[target.module] ? permitted() : refused("no-permission");
    }

    case "export":
      return question === "view" ? canExport(session, target.scope) : refused("no-permission");
  }
}

/**
 * The one capability this file tests, named as its owner states it.
 *
 * `modules/support/goal.ts` owns the capability and answers whether a caller holds it; this file
 * answers the permission question built on it. The literal appears here because the authorisation
 * layer may not import a domain module's internals — so it is written to fail closed: if the owner
 * ever renames it, this check refuses the goal edit rather than silently permitting it.
 */
const GOAL_EDIT_CAPABILITY = "canEditGoal";

/**
 * Reports whether a coaching relationship may still be acted on at all: invited, accepted or active.
 *
 * `revoked`, `expired` and `ended` are three different fates and all three are final for new work. An
 * ended episode cannot return through a stale save, an extension or a re-enable, so nothing that
 * depends on this answer can be revived by asking twice.
 */
function coachingGrantIsLive(grant: CoachingGrantRecord): boolean {
  switch (grant.state) {
    case "invited":
    case "accepted":
    case "active":
      return true;
    case "revoked":
    case "expired":
    case "ended":
      return false;
  }
}

/**
 * Reports whether a share-through grant's cutoff has not yet been reached at `now`.
 *
 * The cutoff is the exclusive start of the civil day after the chosen Share-through date, frozen when
 * the grant was accepted, so a read at the cutoff instant itself is already denied — the comparison is
 * strict on the boundary. An ongoing grant carries no cutoff and is not limited by this test.
 *
 * A stored cutoff that cannot be read as an instant answers "reached", because a window whose end
 * cannot be evaluated cannot be shown to be open, and reading it anyway would be the one thing the
 * cutoff exists to prevent.
 */
function cutoffNotReached(grant: CoachingGrantRecord, now: Temporal.Instant): boolean {
  const { cutoffInstant } = grant.duration;
  if (cutoffInstant === null) {
    return true;
  }
  try {
    return Temporal.Instant.compare(now, Temporal.Instant.from(cutoffInstant)) < 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Export: a permission of a context, re-checked when the file is produced
// ---------------------------------------------------------------------------------------------

/**
 * Reports whether the caller may export a whole query for a scope.
 *
 * Exporting is a worker action inside an admitted ministry. A session that admits no ministry at all
 * — a coach reading what was shared, a reader whose only relationship is to one publication — has a
 * read-only relationship to this data, and is refused with `no-export-permission`; a worker asking
 * about a context they are not admitted to is refused by the scope check with `no-membership`. The
 * two are kept apart because they answer different questions, and neither says anything a caller
 * could use to learn about a record.
 *
 * The caller re-checks this when the file is produced, from the same scope and the same query as the
 * screen, so an export can never contain a row the screen withheld and can never reveal a value the
 * caller was not shown.
 */
export function canExport(session: ResolvedSession, scope: Scope): AccessDecision {
  const gate = sessionGate(session);
  if (gate !== undefined) {
    return refusedBy(gate);
  }
  if (session.admittedMemberships.length === 0) {
    return refused("no-export-permission");
  }
  return inScope(session, scope);
}

// ---------------------------------------------------------------------------------------------
// Protected content: a reader grant, decided from the audience module's facts
// ---------------------------------------------------------------------------------------------

/**
 * The reader whose access to protected content is being decided.
 *
 * Identity is publisher + purpose + the reader's own opaque identifier, never an address and never a
 * name: an email address establishes nothing, and two records holding the same address remain two
 * memberships. `memberships` is every row the caller holds for this publisher — the audience module's
 * own record type, so membership states, source dispositions and acceptance instants are read from
 * the one declaration of them rather than reinterpreted here.
 */
export interface ProtectedReader {
  readonly recipientId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly memberships: readonly MembershipRecord[];
}

/**
 * The protected read being asked about: the audience of the exact variant or release, and the reader
 * whose grant is in question.
 *
 * `audience` comes from the content record — `public` for a public edition, `approved-supporter` for
 * the protected one — so the question is always about a specific edition rather than about content
 * in general. A `public` read needs no reader at all; an `approved-supporter` read needs one, and a
 * reader of `null` is refused rather than treated as anonymous-but-allowed.
 */
export interface ProtectedReadGrant {
  readonly audience: ContentAudience;
  readonly reader: ProtectedReader | null;
}

/**
 * Reports whether a reader may open protected content.
 *
 * This answers one of the three permission facts and nothing else: a reader grant admits protected
 * content. It is deliberately not the notice question. Whether a recipient may be *sent* a notice is
 * `audience/resolve.ts`'s answer, computed from the same rows with the consent test
 * (`audience/consent.ts#hasConsent`) and the confirmation window; this function supplies the
 * `protectedReadingGranted` input that `recipientRendition` takes. Keeping them apart is what makes
 * the two honest in both directions: unsubscribing stops notices without revoking a reading grant, and
 * holding a reading grant subscribes nobody to anything.
 *
 * A membership row is the evidence a grant is decided from, never the grant itself: a row the source
 * supplied, a `restricted` row and a row whose address was never proven each hold a membership and
 * admit nothing, which is what "a membership does not imply a protected-content grant" means in
 * practice. The decision rides on the relationship rather than on the email choice: a person who
 * chose Off after joining is still a known supporter of this publisher. Every check reads the
 * audience module's own facts, so no membership, consent or eligibility rule is restated here.
 */
export function canReadProtected(
  session: ResolvedSession,
  grant: ProtectedReadGrant,
): AccessDecision {
  const gate = sessionGate(session);
  if (gate !== undefined) {
    return refusedBy(gate);
  }
  if (grant.audience === "public") {
    return permitted();
  }
  const reader = grant.reader;
  if (reader === null) {
    return refused("no-protected-grant");
  }
  const addressed = reader.memberships.find(
    (membership) =>
      membership.publisherId === reader.publisherId &&
      membership.purpose === reader.purpose &&
      membership.recipientId === reader.recipientId,
  );
  if (addressed === undefined) {
    return refused("no-protected-grant");
  }
  return holdsReadingGrant(addressed) ? permitted() : refused("no-protected-grant");
}

/**
 * Whether one membership row admits protected reading, read from the audience module's four states.
 *
 * `active` is a person who joined and receives these Updates; `off` with a recorded acceptance is
 * someone who joined and later turned email off, which is a decision about notices and not about the
 * content they were admitted to read. A row that never recorded an acceptance only ever chose Off, so
 * there is no relationship to read from. `awaiting-proof` has not proven the address and `restricted`
 * carries a source limitation, so neither admits anything.
 */
function holdsReadingGrant(membership: MembershipRecord): boolean {
  if (isExcludedSourceMembership(membership)) {
    return false;
  }
  switch (membership.state) {
    case "active":
      return true;
    case "off":
      return membership.acceptedAt !== undefined;
    case "awaiting-proof":
    case "restricted":
      return false;
  }
}
