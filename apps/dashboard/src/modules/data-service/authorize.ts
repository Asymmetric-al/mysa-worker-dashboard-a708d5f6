/**
 * The single scope resolver and the single place a permission question is answered.
 */
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { assertNoFixtureFallback, isDevelopment } from "@/lib/guards";
import { redactDenial } from "@/lib/redaction";
import { isExcludedSourceMembership, type AudiencePurpose, type MembershipRecord } from "@/modules/audience/membership";
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
import { denied, unavailable, unavailableFromStoreFault, type DenialReason, type DeniedOutcome, type ReadResult, type UnavailableOutcome } from "./outcome";
// The resolved session
/** A session as one request sees it: the principal it acts for, how admission stands, the contexts that principal is admitted to, the context it has selected, and the scenario it runs in. */
export interface ResolvedSession {
  readonly sessionId: string;
  readonly principalId: PrincipalId;
  readonly sessionState: SessionState;
  readonly admittedMemberships: readonly AdmittedMembership[];
  readonly selected: Scope | null;
  readonly capabilities: readonly string[];
  readonly scenarioId: string;
  readonly clockOffsetMs: number;
}
/** The answer to "which session is this request": the resolved session, or the refusal. */
export type SessionResolution = { readonly ok: true; readonly session: ResolvedSession } | { readonly ok: false; readonly refusal: SessionRefusal };
/** The two facts a refused session can be, kept apart so no caller can answer one as the other. */
export type SessionRefusal = { readonly kind: "denied"; readonly denied: DeniedOutcome } | { readonly kind: "unavailable"; readonly unavailable: UnavailableOutcome };
/** A session named directly rather than derived from the request cookie. */
export interface SessionSource {
  readonly sessionId: string;
}
const READ_ATTEMPT_ID = "read";

function refuse(reason: DenialReason): DeniedOutcome {
  return redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }));
}
/** Builds the denial arm of a session refusal. */
export function sessionDenial(reason: DenialReason): SessionRefusal {
  return { kind: "denied", denied: refuse(reason) };
}
function refusedSession(reason: DenialReason): SessionResolution {
  return { ok: false, refusal: sessionDenial(reason) };
}
/** Re-expresses a session refusal as the failing half of a read result. */
export function readResultOfRefusal<T>(refusal: SessionRefusal): ReadResult<T> {
  return refusal.kind === "denied" ? { kind: "denied", denied: refusal.denied } : { kind: "unavailable", unavailable: refusal.unavailable };
}
/** Re-expresses a session refusal as the outcome a request answers with, under the attempt identity it carries. */
export function outcomeOfRefusal(refusal: SessionRefusal, operationId: string): DeniedOutcome | UnavailableOutcome {
  return refusal.kind === "denied"
    ? denied({ operationId, reasonCode: refusal.denied.reasonCode })
    : unavailable({
        operationId,
        source: refusal.unavailable.source,
        guidance: refusal.unavailable.guidance,
      });
}
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
// The session's meta document
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
type StoredSessionMeta = z.infer<typeof storedSessionMetaSchema>;

function selectedScope(session: { readonly principalId: PrincipalId; readonly selectedContext: StoredSessionMeta["selectedContext"] }): Scope | null {
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
async function requestSessionId(): Promise<string | undefined> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return readSessionId(jar.get(SESSION_COOKIE)?.value);
}
/** Resolves the session this request acts for, or refuses it. */
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
  } catch (error) {
    // A store that could not answer is an outage, not a denial: the outcome names the store's own
    // reference for the fault and the retry that is safe, and it says nothing about the document, the
    // path or the bytes, so it cannot disclose where a session's records live or what they hold.
    const outage = unavailableFromStoreFault(READ_ATTEMPT_ID, error);
    if (outage === undefined) {
      // Anything else is a defect — a bug in this application rather than a store that is down — and
      // an exception is never a presentation, so it reaches the boundary that answers one.
      throw error;
    }
    return { ok: false, refusal: { kind: "unavailable", unavailable: outage } };
  }
  if (documents === undefined) {
    // The store answered: it holds no session under this id. That is the same denial an unusable
    // cookie receives, and asking again cannot create one.
    return refusedSession("session-unavailable");
  }
  const parsed = storedSessionMetaSchema.safeParse(documents.meta);
  if (!parsed.success) {
    return refusedSession("session-unavailable");
  }
  return { ok: true, session: resolvedSession(sessionId, parsed.data) };
}
// Scope: the one check a read or a change runs under
/** The answer to a scope assertion: the scope holds, or the refusal. */
export type ScopeDecision = { readonly ok: true } | { readonly ok: false; readonly denial: DeniedOutcome };

function admitsScope(session: ResolvedSession, scope: Pick<Scope, "organizationId" | "ministryId" | "supportSubjectId">): boolean {
  return session.admittedMemberships.some(
    (membership) => membership.organizationId === scope.organizationId && membership.ministryId === scope.ministryId && membership.supportSubjectId === scope.supportSubjectId,
  );
}
function admitsContext(session: ResolvedSession, organizationId: string, ministryId: string): boolean {
  return session.admittedMemberships.some((membership) => membership.organizationId === organizationId && membership.ministryId === ministryId);
}
/** What a request's authority to act in a scope is derived from. */
export type ScopeAuthority = "membership" | "grant";
/** Asserts that a caller may act in a scope at all, under the authority its relationship states. */
export function assertScopeUnder(session: ResolvedSession, scope: Scope, authority: ScopeAuthority): ScopeDecision {
  const gate = sessionGate(session);
  if (gate !== undefined) {
    return { ok: false, denial: gate };
  }
  if (scope.principalId !== session.principalId) {
    return { ok: false, denial: refuse("not-admitted") };
  }
  if (authority === "grant") {
    return { ok: true };
  }
  return admitsScope(session, scope) ? { ok: true } : { ok: false, denial: refuse("no-membership") };
}
/** Asserts that a caller may act in a scope admitted by one of its memberships. */
export function assertScope(session: ResolvedSession, scope: Scope): ScopeDecision {
  return assertScopeUnder(session, scope, "membership");
}
/** Asserts that a change kept the record inside the context it started in. */
export function assertScopeUnchangedUnder(session: ResolvedSession, before: Scope, after: Scope, authority: ScopeAuthority): ScopeDecision {
  const started = assertScopeUnder(session, before, authority);
  if (!started.ok) {
    return started;
  }
  const produced = assertScopeUnder(session, after, authority);
  if (!produced.ok) {
    return produced;
  }
  return sameScope(before, after) ? { ok: true } : { ok: false, denial: refuse("no-permission") };
}
/** Asserts that a change kept the record inside the membership-admitted context it started in. */
export function assertScopeUnchanged(session: ResolvedSession, before: Scope, after: Scope): ScopeDecision {
  return assertScopeUnchangedUnder(session, before, after, "membership");
}
// The record kinds a permission question is asked about
/** The closed set of records a permission question covers, one member per record family the service reads or changes. */
export type AuthorizationTarget =
  | {
      readonly kind: "partner";
      readonly scope: Scope;
      readonly audience: RecordAudience;
      readonly authorPrincipalId: PrincipalId | null;
    }
  | {
      readonly kind: "private-note";
      readonly scope: Scope;
      readonly authorPrincipalId: PrincipalId;
    }
  | {
      readonly kind: "interaction";
      readonly scope: Scope;
    }
  | {
      readonly kind: "task";
      readonly scope: Scope;
      readonly ownerPrincipalId: PrincipalId;
    }
  | {
      readonly kind: "series";
      readonly scope: Scope;
      readonly ownerPrincipalId: PrincipalId;
    }
  | {
      readonly kind: "initiative";
      readonly scope: Scope;
      readonly ministryId: MinistryId;
      readonly responsiblePrincipalId: PrincipalId;
    }
  | {
      readonly kind: "request";
      readonly scope: Scope;
    }
  | {
      readonly kind: "referral";
      readonly scope: Scope;
    }
  | {
      readonly kind: "support-subject";
      readonly scope: Scope;
      readonly capabilities: readonly string[];
    }
  | {
      readonly kind: "content-variant";
      readonly scope: Scope;
    }
  | {
      readonly kind: "media-asset";
      readonly scope: Scope;
    }
  | {
      readonly kind: "membership";
      readonly record: MembershipRecord;
    }
  | {
      readonly kind: "coaching-grant";
      readonly grant: CoachingGrantRecord;
      readonly now: Temporal.Instant;
    }
  | {
      readonly kind: "cohort-subject";
      readonly grant: CoachingGrantRecord;
      readonly module: keyof CoachingGrantRecord["modules"];
      readonly now: Temporal.Instant;
    }
  | {
      readonly kind: "export";
      readonly scope: Scope;
    }
  | {
      readonly kind: "dev-runtime";
    };
/** The answer to one permission question: the action is permitted, or the refusal. */
export type AccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly denial: DeniedOutcome };

function permitted(): AccessDecision {
  return { allowed: true };
}
function refused(reason: DenialReason): AccessDecision {
  return { allowed: false, denial: refuse(reason) };
}
function refusedBy(denial: DeniedOutcome): AccessDecision {
  return { allowed: false, denial };
}
// The four permission questions
type AccessQuestion = "view" | "edit";
/** Reports whether the caller may read one record. */
export function canView(session: ResolvedSession, target: AuthorizationTarget): AccessDecision {
  return decide(session, target, "view");
}
/** Reports whether the caller may change one record. */
export function canEdit(session: ResolvedSession, target: AuthorizationTarget): AccessDecision {
  return decide(session, target, "edit");
}
function inScope(session: ResolvedSession, scope: Scope): AccessDecision {
  const check = assertScope(session, scope);
  return check.ok ? permitted() : refusedBy(check.denial);
}
function decide(session: ResolvedSession, target: AuthorizationTarget, question: AccessQuestion): AccessDecision {
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
      return target.authorPrincipalId === session.principalId ? permitted() : refused("no-permission");
    }
    case "private-note": {
      const scoped = inScope(session, target.scope);
      if (!scoped.allowed) {
        return scoped;
      }
      return target.authorPrincipalId === session.principalId ? permitted() : refused("no-permission");
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
      return target.ownerPrincipalId === session.principalId ? permitted() : refused("no-permission");
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
      return target.responsiblePrincipalId === session.principalId ? permitted() : refused("no-permission");
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
      return target.capabilities.includes(GOAL_EDIT_CAPABILITY) ? permitted() : refused("capability-absent");
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
      return admitsContext(session, target.record.scope.organizationId, target.record.scope.ministryId) ? permitted() : refused("no-permission");
    }
    case "coaching-grant": {
      const mayAct = coachingGrantIsLive(target.grant) && cutoffNotReached(target.grant, target.now);
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
const GOAL_EDIT_CAPABILITY = "canEditGoal";

function coachingGrantIsLive(grant: CoachingGrantRecord): boolean {
  switch (grant.state) {
    case "invited":
    case "accepted":
    case "active":
      return true;
    case "revoked":
    case "expired":
    case "ended":
    case "left":
      return false;
  }
}
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
// Export: a permission of a context, re-checked when the file is produced
/** Reports whether the caller may export a whole query for a scope. */
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
// Protected content: a reader grant, decided from the audience module's facts
/** The reader whose access to protected content is being decided. */
export interface ProtectedReader {
  readonly recipientId: string;
  readonly publisherId: string;
  readonly purpose: AudiencePurpose;
  readonly memberships: readonly MembershipRecord[];
}
/** The protected read being asked about: the audience of the exact variant or release, and the reader whose grant is in question. */
export interface ProtectedReadGrant {
  readonly audience: ContentAudience;
  readonly reader: ProtectedReader | null;
}
/** Reports whether a reader may open protected content. */
export function canReadProtected(session: ResolvedSession, grant: ProtectedReadGrant): AccessDecision {
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
  const addressed = reader.memberships.find((membership) => membership.publisherId === reader.publisherId && membership.purpose === reader.purpose && membership.recipientId === reader.recipientId);
  if (addressed === undefined) {
    return refused("no-protected-grant");
  }
  return holdsReadingGrant(addressed) ? permitted() : refused("no-protected-grant");
}
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
