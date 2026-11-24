import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isDevelopment } from "@/lib/guards";
import { logger } from "@/lib/logger";
import { redactDenial } from "@/lib/redaction";
import { SESSION_COOKIE, readSessionId } from "@/lib/session-cookie";
import { isExcludedSourceMembership, type AudiencePurpose, type MembershipRecord } from "@/modules/audience/membership";
import type { ContentAudience } from "@/modules/audience/resolve";
import type { SessionDocuments } from "@/modules/store/paths";
import { readSession } from "@/modules/store/repository";
import { admittedMembershipSchema, ministryIdSchema, organizationIdSchema, principalIdSchema, sameScope, sessionStateSchema, supportSubjectIdSchema, type AdmittedMembership, type CoachingGrantRecord, type MinistryId, type PrincipalId, type RecordAudience, type Scope, type SessionState } from "./envelope";
import { denied, unavailable, unavailableFromStoreFault, type DenialReason, type DeniedOutcome, type ReadResult, type UnavailableOutcome } from "./outcome";
export interface ResolvedSession {
  readonly sessionId: string;
  readonly principalId: PrincipalId;
  readonly sessionState: SessionState;
  readonly admittedMemberships: readonly AdmittedMembership[];
  readonly selected: Scope | null;
  readonly capabilities: readonly string[];
  readonly scenarioId: string;
  readonly clockOffsetMs: number;
  /** The session whose documents hold this seat's coaching records, or null when they are its own. */ readonly coachingRecordsSessionId: string | null;
}
/** A seat's coaching records may live in the world it is seated in, so the session to address is that world when one is named and the seat itself otherwise. */ export const coachingRecordsSessionIdOf = (session: ResolvedSession): string => session.coachingRecordsSessionId ?? session.sessionId;
// The publisher whose world a development preview crosses into for the memberships it holds for its readers.
const PREVIEW_PUBLISHER_SESSION_ID = "established-worker";
/** The world a session's membership rows live in — that publisher's own world for the seat that reaches across to it, the seat itself otherwise — which is the one world the reader's own page and the publisher's audience both read from. */
export const audienceRecordsSessionIdOf = (session: ResolvedSession): string => (isDevelopment() && session.admittedMemberships.length === 0 && session.sessionId !== PREVIEW_PUBLISHER_SESSION_ID ? PREVIEW_PUBLISHER_SESSION_ID : session.sessionId);
export type SessionResolution = { readonly ok: true; readonly session: ResolvedSession } | { readonly ok: false; readonly refusal: SessionRefusal };
export type SessionRefusal = { readonly kind: "denied"; readonly denied: DeniedOutcome } | { readonly kind: "unavailable"; readonly unavailable: UnavailableOutcome };
export type SessionSource = { readonly sessionId: string };
const READ_ATTEMPT_ID = "read";
const refuse = (reason: DenialReason): DeniedOutcome => redactDenial(denied({ operationId: READ_ATTEMPT_ID, reasonCode: reason }));
export const sessionDenial = (reason: DenialReason): SessionRefusal => ({ kind: "denied", denied: refuse(reason) });
const refusedSession = (reason: DenialReason): SessionResolution => ({ ok: false, refusal: sessionDenial(reason) });
export const readResultOfRefusal = <T>(refusal: SessionRefusal): ReadResult<T> => (refusal.kind === "denied" ? { kind: "denied", denied: refusal.denied } : { kind: "unavailable", unavailable: refusal.unavailable });
export const outcomeOfRefusal = (refusal: SessionRefusal, operationId: string): DeniedOutcome | UnavailableOutcome => (refusal.kind === "denied" ? denied({ operationId, reasonCode: refusal.denied.reasonCode }) : unavailable({ operationId, source: refusal.unavailable.source, guidance: refusal.unavailable.guidance }));
/** States the source an outage could not be read from when the session resolution refused the job before it could read its own document, so every `unavailable` names its source; a fault the job maps itself is reported by that job. */ export function recordRefusalOutage(job: string, refusal: SessionRefusal): void {
  if (refusal.kind === "unavailable") logger.sourceUnavailable({ job, source: refusal.unavailable.source });
}
const SESSION_GATE_REASONS: Readonly<Record<Exclude<SessionState, "signed-in">, DenialReason>> = { unavailable: "session-unavailable", expired: "session-expired", denied: "not-admitted", "no-access": "not-admitted" };
function sessionGate(session: ResolvedSession): DeniedOutcome | undefined {
  const { sessionState } = session;
  return sessionState === "signed-in" ? undefined : refuse(SESSION_GATE_REASONS[sessionState]);
}
/** The refusal a session's own state answers with before any scope is consulted: `expired`, `unavailable`, `denied` and no access each by their own reason, and nothing at all for a signed-in session. */ export const sessionStateRefusal = (session: ResolvedSession): DeniedOutcome | undefined => sessionGate(session);
const storedSessionMetaSchema = z.object({
  scenarioId: z.string().min(1),
  clockOffsetMs: z.int(),
  sessionState: sessionStateSchema,
  principalId: principalIdSchema,
  admittedMemberships: z.array(admittedMembershipSchema),
  selectedContext: z.object({ organizationId: organizationIdSchema, ministryId: ministryIdSchema, supportSubjectId: supportSubjectIdSchema }).nullable(),
  capabilities: z.array(z.string().min(1)).default([]),
  coachingRecordsSessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .nullable()
    .default(null),
});
type StoredSessionMeta = z.infer<typeof storedSessionMetaSchema>;
function selectedScope(session: { readonly principalId: PrincipalId; readonly selectedContext: StoredSessionMeta["selectedContext"] }): Scope | null {
  const { selectedContext } = session;
  return selectedContext === null ? null : { organizationId: selectedContext.organizationId, ministryId: selectedContext.ministryId, supportSubjectId: selectedContext.supportSubjectId, principalId: session.principalId };
}
function resolvedSession(sessionId: string, meta: StoredSessionMeta): ResolvedSession {
  const { principalId, sessionState, admittedMemberships, capabilities, scenarioId, clockOffsetMs, coachingRecordsSessionId } = meta;
  return { sessionId, principalId, sessionState, admittedMemberships, selected: selectedScope({ principalId: meta.principalId, selectedContext: meta.selectedContext }), capabilities, scenarioId, clockOffsetMs, coachingRecordsSessionId };
}
async function requestSessionId(): Promise<string | undefined> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return readSessionId(jar.get(SESSION_COOKIE)?.value);
}
/** Resolves the acting session from the request's cookie or from an explicit source, stating the authority it established or why none was: an unresolved cookie is `session-unavailable` rather than an anonymous reader. */ export async function resolveSession(source?: SessionSource): Promise<SessionResolution> {
  let sessionId: string | undefined;
  if (source === undefined) sessionId = await requestSessionId();
  else sessionId = readSessionId(source.sessionId);
  if (sessionId === undefined) return refusedSession("session-unavailable");
  let documents: SessionDocuments | undefined;
  try {
    documents = await readSession(sessionId);
  } catch (error) {
    const outage = unavailableFromStoreFault(READ_ATTEMPT_ID, error);
    if (outage === undefined) throw error;
    return { ok: false, refusal: { kind: "unavailable", unavailable: outage } };
  }
  if (documents === undefined) return refusedSession("session-unavailable");
  const parsed = storedSessionMetaSchema.safeParse(documents.meta);
  return !parsed.success ? refusedSession("session-unavailable") : { ok: true, session: resolvedSession(sessionId, parsed.data) };
}
export type ScopeDecision = { readonly ok: true } | { readonly ok: false; readonly denial: DeniedOutcome };
/** The authority an attempt is admitted under, together with the scope that admission establishes and a durable entry for the attempt records. */ export type AdmittedScope = { readonly ok: true; readonly scope: Scope } | { readonly ok: false; readonly denial: DeniedOutcome };
const admittedMembershipOf = (session: ResolvedSession, scope: Pick<Scope, "organizationId" | "ministryId" | "supportSubjectId">): AdmittedMembership | undefined =>
  session.admittedMemberships.find((membership) => membership.organizationId === scope.organizationId && membership.ministryId === scope.ministryId && membership.supportSubjectId === scope.supportSubjectId);
const admitsContext = (session: ResolvedSession, organizationId: string, ministryId: string): boolean => session.admittedMemberships.some((membership) => membership.organizationId === organizationId && membership.ministryId === ministryId);
export type ScopeAuthority = "membership" | "grant" | "owner";
// A membership authority always requires an admitted membership. The grant and owner authorities exist for a seat that holds no membership in the record's context at all — a coach acting under a grant, a reader acting on the record it owns — so they exempt it only from a membership it does not hold: a caller that does hold admitted memberships is still held to them, and the context it claims has to be one of theirs.
const holdsToMembership = (session: ResolvedSession, authority: ScopeAuthority): boolean => authority === "membership" || session.admittedMemberships.length > 0;
/** Admits one attempt under the authority it holds, and answers the scope it is admitted under: the matched membership's own context with the caller's principal, or, for a membership-less grant or owner seat, the claim under that same principal. The admission is the only source of that scope, so an entry recording it can state neither a principal the session resolver did not establish nor a context the caller's own memberships exclude. */
export function assertScopeAdmitted(session: ResolvedSession, claimed: Scope, authority: ScopeAuthority): AdmittedScope {
  const gate = sessionGate(session);
  if (gate !== undefined) return { ok: false, denial: gate };
  if (claimed.principalId !== session.principalId) return { ok: false, denial: refuse("not-admitted") };
  if (!holdsToMembership(session, authority)) return { ok: true, scope: { ...claimed, principalId: session.principalId } };
  const admitted = admittedMembershipOf(session, claimed);
  return admitted === undefined ? { ok: false, denial: refuse("no-membership") } : { ok: true, scope: { organizationId: admitted.organizationId, ministryId: admitted.ministryId, supportSubjectId: admitted.supportSubjectId, principalId: session.principalId } };
}
/** Admits one attempt's scope under the authority it holds, for a caller that needs only the answer; the scope the admission established comes from `assertScopeAdmitted`. */ export function assertScopeUnder(session: ResolvedSession, scope: Scope, authority: ScopeAuthority): ScopeDecision {
  const decision = assertScopeAdmitted(session, scope, authority);
  return decision.ok ? { ok: true } : decision;
}
export const assertScope = (session: ResolvedSession, scope: Scope): ScopeDecision => assertScopeUnder(session, scope, "membership");
/** Refuses a write whose context no longer matches the scope it was read under, answering the same refusal a stale revision gets. */ export function assertScopeUnchangedUnder(session: ResolvedSession, before: Scope, after: Scope, authority: ScopeAuthority): ScopeDecision {
  const started = assertScopeUnder(session, before, authority);
  if (!started.ok) return started;
  const produced = assertScopeUnder(session, after, authority);
  return !produced.ok ? produced : sameScope(before, after) ? { ok: true } : { ok: false, denial: refuse("no-permission") };
}
export type AuthorizationTarget =
  | { readonly kind: "partner"; readonly scope: Scope; readonly audience: RecordAudience; readonly authorPrincipalId: PrincipalId | null }
  | { readonly kind: "private-note"; readonly scope: Scope; readonly authorPrincipalId: PrincipalId }
  | { readonly kind: "interaction"; readonly scope: Scope }
  | { readonly kind: "task"; readonly scope: Scope; readonly ownerPrincipalId: PrincipalId }
  | { readonly kind: "series"; readonly scope: Scope; readonly ownerPrincipalId: PrincipalId }
  | { readonly kind: "initiative"; readonly scope: Scope; readonly ministryId: MinistryId; readonly responsiblePrincipalId: PrincipalId }
  | { readonly kind: "request"; readonly scope: Scope }
  | { readonly kind: "referral"; readonly scope: Scope }
  | { readonly kind: "support-subject"; readonly scope: Scope; readonly capabilities: readonly string[] }
  | { readonly kind: "content-variant"; readonly scope: Scope }
  | { readonly kind: "media-asset"; readonly scope: Scope }
  | { readonly kind: "membership"; readonly record: MembershipRecord }
  | { readonly kind: "coaching-grant"; readonly grant: CoachingGrantRecord; readonly now: Temporal.Instant }
  | { readonly kind: "cohort-subject"; readonly grant: CoachingGrantRecord; readonly module: keyof CoachingGrantRecord["modules"]; readonly now: Temporal.Instant }
  | { readonly kind: "export"; readonly scope: Scope }
  | { readonly kind: "dev-runtime" };
export type AccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly denial: DeniedOutcome };
const permitted = (): AccessDecision => ({ allowed: true });
const refused = (reason: DenialReason): AccessDecision => ({ allowed: false, denial: refuse(reason) });
const refusedBy = (denial: DeniedOutcome): AccessDecision => ({ allowed: false, denial });
type AccessQuestion = "view" | "edit";
export const canView = (session: ResolvedSession, target: AuthorizationTarget): AccessDecision => decide(session, target, "view");
export const canEdit = (session: ResolvedSession, target: AuthorizationTarget): AccessDecision => decide(session, target, "edit");
function inScope(session: ResolvedSession, scope: Scope): AccessDecision {
  const check = assertScope(session, scope);
  return check.ok ? permitted() : refusedBy(check.denial);
}
function decide(session: ResolvedSession, target: AuthorizationTarget, question: AccessQuestion): AccessDecision {
  if (target.kind === "dev-runtime") return isDevelopment() ? permitted() : refused("no-permission");
  const gate = sessionGate(session);
  if (gate !== undefined) return refusedBy(gate);
  switch (target.kind) {
    case "partner": {
      const scoped = inScope(session, target.scope);
      return !scoped.allowed ? scoped : target.audience === "shared" ? permitted() : target.authorPrincipalId === session.principalId ? permitted() : refused("no-permission");
    }
    case "private-note": {
      const scoped = inScope(session, target.scope);
      return !scoped.allowed ? scoped : target.authorPrincipalId === session.principalId ? permitted() : refused("no-permission");
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
      return !scoped.allowed ? scoped : question === "view" ? permitted() : target.ownerPrincipalId === session.principalId ? permitted() : refused("no-permission");
    }
    case "initiative": {
      const scoped = inScope(session, target.scope);
      return !scoped.allowed ? scoped : target.ministryId !== target.scope.ministryId ? refused("no-permission") : question === "view" ? permitted() : target.responsiblePrincipalId === session.principalId ? permitted() : refused("no-permission");
    }
    case "support-subject": {
      const scoped = inScope(session, target.scope);
      return !scoped.allowed ? scoped : question === "view" ? permitted() : target.capabilities.includes(GOAL_EDIT_CAPABILITY) ? permitted() : refused("capability-absent");
    }
    case "membership": {
      const isSelf = target.record.recipientId === session.principalId;
      return question === "edit" ? (isSelf ? permitted() : refused("no-permission")) : isSelf ? permitted() : admitsContext(session, target.record.scope.organizationId, target.record.scope.ministryId) ? permitted() : refused("no-permission");
    }
    case "coaching-grant": {
      const mayAct = coachingGrantIsLive(target.grant) && cutoffNotReached(target.grant, target.now);
      return session.principalId === target.grant.workerPrincipalId ? (question === "view" || mayAct ? permitted() : refused("no-permission")) : session.principalId === target.grant.coachPrincipalId ? (mayAct ? permitted() : refused("no-permission")) : refused("no-permission");
    }
    case "cohort-subject": {
      if (question === "edit") return refused("no-permission");
      return session.principalId !== target.grant.coachPrincipalId ? refused("no-permission") : target.grant.state !== "active" ? refused("no-permission") : !cutoffNotReached(target.grant, target.now) ? refused("no-permission") : target.grant.modules[target.module] ? permitted() : refused("no-permission");
    }
    case "export":
      return question === "view" ? canExport(session, target.scope) : refused("no-permission");
  }
}
const GOAL_EDIT_CAPABILITY = "canEditGoal";
const LIVE_GRANT_STATES: Readonly<Record<CoachingGrantRecord["state"], boolean>> = { invited: true, accepted: true, active: true, revoked: false, expired: false, ended: false, left: false };
const coachingGrantIsLive = (grant: CoachingGrantRecord): boolean => LIVE_GRANT_STATES[grant.state];
function cutoffNotReached(grant: CoachingGrantRecord, now: Temporal.Instant): boolean {
  const { cutoffInstant } = grant.duration;
  if (cutoffInstant === null) return true;
  try {
    return Temporal.Instant.compare(now, Temporal.Instant.from(cutoffInstant)) < 0;
  } catch {
    return false;
  }
}
/** Whether this session may export the addressed scope: an export carries the whole query, so it is authorised on its own rather than inferred from a read. */ export function canExport(session: ResolvedSession, scope: Scope): AccessDecision {
  const gate = sessionGate(session);
  return gate !== undefined ? refusedBy(gate) : session.admittedMemberships.length === 0 ? refused("no-export-permission") : inScope(session, scope);
}
export type ProtectedReader = { readonly recipientId: string; readonly publisherId: string; readonly purpose: AudiencePurpose; readonly memberships: readonly MembershipRecord[] };
export type ProtectedReadGrant = { readonly audience: ContentAudience; readonly reader: ProtectedReader | null };
/** The protected read being asked about: the audience of the exact variant or release, and the reader whose grant is in question. */ export function canReadProtected(session: ResolvedSession, grant: ProtectedReadGrant): AccessDecision {
  const gate = sessionGate(session);
  if (gate !== undefined) return refusedBy(gate);
  if (grant.audience === "public") return permitted();
  const reader = grant.reader;
  if (reader === null) return refused("no-protected-grant");
  const addressed = reader.memberships.find((membership) => membership.publisherId === reader.publisherId && membership.purpose === reader.purpose && membership.recipientId === reader.recipientId);
  return addressed === undefined ? refused("no-protected-grant") : holdsReadingGrant(addressed) ? permitted() : refused("no-protected-grant");
}
const READING_GRANT_STATES: Readonly<Record<MembershipRecord["state"], boolean>> = { active: true, off: false, "awaiting-proof": false, restricted: false };
const holdsReadingGrant = (membership: MembershipRecord): boolean => (isExcludedSourceMembership(membership) ? false : membership.state === "off" ? membership.acceptedAt !== undefined : READING_GRANT_STATES[membership.state]);
